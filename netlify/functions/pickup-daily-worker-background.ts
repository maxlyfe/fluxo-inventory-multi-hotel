// netlify/functions/pickup-daily-worker-background.ts
// Worker BACKGROUND (sufixo -background → budget de 15 min) disparado pelo
// gatilho agendado pickup-daily-snapshot às 8h BRT. Captura, para todos os
// hotéis com Erbon ativo:
//   1. /hospedagem (−60d → +90d): diária a diária de cada reserva → cache
//      erbon_hospedagem_daily + snapshot OTB futuro do Pick-up Report.
//   2. /booking/segmentsview: diária + segmento + origem → erbon_segmentsview_daily.
//   3. /occupancy/withpension em blocos MENSAIS → erbon_occupancy_daily
//      (dashboard de ocupação anual/mensal abre instantâneo do banco).
// A soma das chamadas Erbon (~2,5–7s cada) não cabe nos 26s de uma function
// síncrona — por isso o padrão trigger → background.

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL         = process.env.SUPABASE_URL         || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getDb() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ── Datas (fuso de Brasília) ──────────────────────────────────────────────────

function todayBRT(): string {
  const nowBRT = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return nowBRT.toISOString().substring(0, 10);
}

function addDays(base: string, n: number): string {
  const d = new Date(base + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

// ── Erbon (chamadas diretas server-side, sem proxy/CORS) ─────────────────────

interface ErbonCfg {
  erbon_base_url: string; erbon_hotel_id: string;
  erbon_username: string; erbon_password: string;
}

function erbonBase(cfg: ErbonCfg): string {
  return cfg.erbon_base_url.replace(/\/swagger(\/index\.html)?$/i, '').replace(/\/+$/, '');
}

// Autenticação: POST /auth/login com body JSON → { bearerToken }
// (mesmo fluxo do erbonService.authenticate do frontend)
async function erbonGetToken(cfg: ErbonCfg): Promise<string> {
  const res = await fetch(`${erbonBase(cfg)}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.erbon_username, password: cfg.erbon_password }),
  });
  if (!res.ok) throw new Error(`Erbon auth failed: ${res.status}`);
  const raw = await res.text();
  try {
    const parsed = JSON.parse(raw);
    const token = typeof parsed === 'string'
      ? parsed
      : (parsed.bearerToken ?? parsed.token ?? parsed.access_token);
    if (token) return token;
  } catch {
    if (raw.length > 20) return raw.trim(); // API pode devolver o token como string pura
  }
  throw new Error('Erbon: token missing in /auth/login response');
}

async function erbonGet(cfg: ErbonCfg, token: string, path: string, extraHeaders: Record<string, string>): Promise<any> {
  const res = await fetch(`${erbonBase(cfg)}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, ...extraHeaders },
  });
  if (!res.ok) throw new Error(`Erbon GET ${path} → ${res.status}`);
  return await res.json();
}

// ── Snapshot OTB ──────────────────────────────────────────────────────────────

interface SnapshotRow {
  hotel_id: string; snapshot_date: string; stay_date: string;
  rooms_otb: number; net_room_revenue: number; adr: number;
}

/** Futuro: agrega as diárias do /hospedagem por dia de estadia (exclui canceladas).
 *  Só dias >= hoje — o passado vem do /occupancy/withpension (actuals). */
function aggregateHospedagem(hotelId: string, today: string, hosp: any[]): SnapshotRow[] {
  const byDay = new Map<string, { rooms: number; rev: number }>();
  for (const h of hosp) {
    if (h.status === 'CANCELED') continue;
    const day = String(h.datA_HOSPEDAGEM ?? '').split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today) continue;
    const cur = byDay.get(day) ?? { rooms: 0, rev: 0 };
    byDay.set(day, { rooms: cur.rooms + 1, rev: cur.rev + (Number(h.diaria) || 0) });
  }
  return Array.from(byDay.entries()).sort().map(([day, v]) => ({
    hotel_id:         hotelId,
    snapshot_date:    today,
    stay_date:        day,
    rooms_otb:        v.rooms,
    net_room_revenue: v.rev,
    adr:              v.rooms > 0 ? v.rev / v.rooms : 0,
  }));
}

/** Fallback: OTB agregado (sem receita futura confiável, mas mantém quartos). */
async function fetchOTBRows(hotelId: string, cfg: ErbonCfg, token: string, today: string): Promise<SnapshotRow[]> {
  const otbData: any[] = await erbonGet(cfg, token, `/hotel/${cfg.erbon_hotel_id}/sales/otb`, {
    dateFrom: today, dateTo: addDays(today, 90),
  });
  return (Array.isArray(otbData) ? otbData : []).map(d => {
    const rooms = (d.totalRoomsDeductedTransient ?? 0) + (d.totalRoomsDeductedBlocks ?? 0);
    const rev   = (d.netRoomRevenueTransient   ?? 0) + (d.netRoomRevenueBlocks   ?? 0);
    return {
      hotel_id:         hotelId,
      snapshot_date:    today,
      stay_date:        String(d.stayDate).split('T')[0],
      rooms_otb:        rooms,
      net_room_revenue: rev,
      adr:              rooms > 0 ? rev / rooms : 0,
    };
  });
}

/** Passado: receita real de quartos dos últimos 30 dias. */
async function fetchPastRows(hotelId: string, cfg: ErbonCfg, token: string, today: string): Promise<SnapshotRow[]> {
  const occData: any[] = await erbonGet(cfg, token, `/hotel/${cfg.erbon_hotel_id}/occupancy/withpension`, {
    dateFrom: addDays(today, -30), dateTo: addDays(today, -1), currency: '0',
  });
  return (Array.isArray(occData) ? occData : []).map(o => {
    const rooms = o.roomSalledConfirmed ?? 0;
    const rev   = o.totalDailyRate      ?? 0;
    return {
      hotel_id:         hotelId,
      snapshot_date:    today,
      stay_date:        String(o.date).split('T')[0],
      rooms_otb:        rooms,
      net_room_revenue: rev,
      adr:              rooms > 0 ? rev / rooms : (o.adr ?? 0),
    };
  });
}

// ── Sincronização de ocupação (cache do dashboard anual/mensal) ──────────────

/** Meses 'yyyy-mm' entre duas datas (inclusive). */
function monthsBetween(from: string, to: string): string[] {
  const res: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ey, em] = to.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    res.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return res;
}

function monthLastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().substring(0, 10);
}

/**
 * Mantém erbon_occupancy_daily atualizada em blocos MENSAIS (uma chamada por
 * mês — pedir o ano inteiro à Erbon estoura timeout). Janela rolante de
 * −45d a +90d todo dia, mais backfill de até 6 meses sem dados desde
 * 1º de janeiro do ano anterior (completa o histórico ao longo dos dias).
 */
async function syncOccupancy(
  db: ReturnType<typeof createClient>,
  hotelId: string, cfg: ErbonCfg, token: string, today: string,
  hospRows?: any[]
): Promise<number> {
  const backfillStart = `${Number(today.slice(0, 4)) - 1}-01-01`;
  const rolling = monthsBetween(addDays(today, -45), addDays(today, 90));

  const { data: existing } = await db
    .from('erbon_occupancy_daily')
    .select('date')
    .eq('hotel_id', hotelId)
    .gte('date', backfillStart);
  const monthsWithData = new Set((existing ?? []).map((r: any) => String(r.date).slice(0, 7)));

  const missing = monthsBetween(backfillStart, today)
    .filter(m => !rolling.includes(m) && !monthsWithData.has(m))
    .slice(0, 6);

  let total = 0;
  for (const month of [...rolling, ...missing]) {
    try {
      const data: any[] = await erbonGet(cfg, token, `/hotel/${cfg.erbon_hotel_id}/occupancy/withpension`, {
        dateFrom: `${month}-01`, dateTo: monthLastDay(month), currency: '0',
      });
      const rows = (Array.isArray(data) ? data : []).map(o => {
        const rooms = (o.roomSalledConfirmed ?? 0) + (o.roomSalledRateDefault ?? 0)
          + (o.roomSalledPending ?? 0) + (o.roomSalledInvited ?? 0)
          + (o.roomSalledHouseUse ?? 0) + (o.roomSalledPermut ?? 0)
          + (o.roomSalledCrewMember ?? 0) + (o.roomSalledDayUse ?? 0);
        const sellable = rooms + (o.roomAvailable ?? 0);
        const occ = sellable > 0 ? (rooms / sellable) * 100 : 0;
        const rev = o.totalDailyRate ?? 0;
        return {
          hotel_id:     hotelId,
          date:         String(o.date).split('T')[0],
          occupancy:    Number(occ.toFixed(1)),
          rooms_sold:   rooms,
          room_revenue: rev,
          adr:          rooms > 0 ? rev / rooms : (o.adr ?? 0),
          payload:      o,
          synced_at:    new Date().toISOString(),
        };
      }).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
      if (rows.length) {
        const { error } = await db.from('erbon_occupancy_daily')
          .upsert(rows, { onConflict: 'hotel_id,date' });
        if (error) throw error;
        total += rows.length;
      }
    } catch (e: any) {
      console.warn(`[Pickup Daily] ${hotelId} — ocupação ${month} falhou: ${e.message}`);
    }
  }

  // Suplementa receita futura via hospedagem já capturada
  if (hospRows?.length) {
    const revByDay = new Map<string, number>();
    for (const r of hospRows) {
      if (!r || r.status === 'CANCELED') continue;
      const d = String(r.datA_HOSPEDAGEM ?? '').split('T')[0];
      if (d >= today) revByDay.set(d, (revByDay.get(d) || 0) + (Number(r.diaria) || 0));
    }
    if (revByDay.size) {
      const { data: zeroRevRows } = await db.from('erbon_occupancy_daily')
        .select('date, rooms_sold')
        .eq('hotel_id', hotelId)
        .gte('date', today)
        .eq('room_revenue', 0)
        .gt('rooms_sold', 0);
      const patches = (zeroRevRows ?? [])
        .filter((r: any) => revByDay.has(r.date))
        .map((r: any) => ({
          hotel_id:     hotelId,
          date:         r.date,
          room_revenue: revByDay.get(r.date)!,
          adr:          r.rooms_sold > 0 ? revByDay.get(r.date)! / r.rooms_sold : 0,
          synced_at:    new Date().toISOString(),
        }));
      if (patches.length) {
        await db.from('erbon_occupancy_daily')
          .upsert(patches, { onConflict: 'hotel_id,date' });
        console.log(`[Pickup Daily] ${hotelId} — receita futura patcheada: ${patches.length} dias`);
      }
    }
  }

  return total;
}

// ── Persistência das capturas brutas ─────────────────────────────────────────

async function replaceDailyRows(
  db: ReturnType<typeof createClient>,
  table: string, hotelId: string, today: string, rows: Record<string, unknown>[]
): Promise<void> {
  // Idempotência: remove a captura de hoje antes de regravar
  const { error: delErr } = await db.from(table).delete()
    .eq('hotel_id', hotelId).eq('snapshot_date', today);
  if (delErr) throw delErr;

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) throw error;
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

const handler: Handler = async (event) => {
  // Só o gatilho agendado (que compartilha as env vars) pode disparar o worker
  const expectedKey = SUPABASE_SERVICE_KEY.slice(-24);
  if (!expectedKey || event.headers['x-job-key'] !== expectedKey) {
    return { statusCode: 401, body: 'unauthorized' };
  }

  console.log('[Pickup Daily] Worker iniciando às', new Date().toISOString());

  let db: ReturnType<typeof createClient>;
  try {
    db = getDb();
  } catch (err: any) {
    console.error('[Pickup Daily] DB init error:', err.message);
    return { statusCode: 500 };
  }

  const today = todayBRT();
  const horizon = addDays(today, 90);

  const { data: configs, error: cfgErr } = await db
    .from('erbon_hotel_config')
    .select('hotel_id, erbon_base_url, erbon_hotel_id, erbon_username, erbon_password')
    .eq('is_active', true);

  if (cfgErr || !configs?.length) {
    console.log('[Pickup Daily] Nenhum hotel com Erbon ativo.', cfgErr?.message ?? '');
    return { statusCode: 200 };
  }

  for (const row of configs) {
    const hotelId = (row as any).hotel_id as string;
    const cfg = row as unknown as ErbonCfg;
    try {
      const token = await erbonGetToken(cfg);

      // 1. Hospedagem: diária a diária de cada reserva (−60d → +90d).
      //    O passado alimenta as abas de vendas por check-in/check-out da tela
      //    Vendas & Ocupação sem precisar esperar a Erbon responder.
      let hosp: any[] = [];
      try {
        const data = await erbonGet(cfg, token, `/hotel/${cfg.erbon_hotel_id}/hospedagem`, {
          stayDateStart: addDays(today, -60), stayDateEnd: horizon,
        });
        hosp = Array.isArray(data) ? data : [];
        await replaceDailyRows(db, 'erbon_hospedagem_daily', hotelId, today, hosp.map(item => ({
          hotel_id:            hotelId,
          snapshot_date:       today,
          stay_date:           String(item.datA_HOSPEDAGEM ?? '').split('T')[0] || null,
          booking_internal_id: Number(item.iD_RESERVA) || null,
          daily_rate:          Number(item.diaria) || 0,
          status:              item.status ?? null,
          payload:             item,
        })));
        console.log(`[Pickup Daily] ${hotelId} — hospedagem: ${hosp.length} registros`);
      } catch (e: any) {
        console.warn(`[Pickup Daily] ${hotelId} — hospedagem falhou: ${e.message}`);
      }

      // 2. Segments view: diária + segmento + origem (hoje → +90d)
      try {
        const data = await erbonGet(cfg, token, `/hotel/${cfg.erbon_hotel_id}/booking/segmentsview`, {
          startDate: today, endDate: horizon,
        });
        const seg: any[] = Array.isArray(data) ? data : [];
        await replaceDailyRows(db, 'erbon_segmentsview_daily', hotelId, today, seg.map(item => ({
          hotel_id:      hotelId,
          snapshot_date: today,
          stay_date:     String(item.stayDate ?? '').split('T')[0] || null,
          booking_id:    Number(item.bookingID) || null,
          daily_rate:    Number(item.dailyRate) || 0,
          segment:       item.segment ?? null,
          source:        item.source ?? null,
          payload:       item,
        })));
        console.log(`[Pickup Daily] ${hotelId} — segmentsview: ${seg.length} registros`);
      } catch (e: any) {
        console.warn(`[Pickup Daily] ${hotelId} — segmentsview falhou: ${e.message}`);
      }

      // 3. Snapshot OTB: futuro pela hospedagem (receita real por diária);
      //    fallback /sales/otb se a hospedagem vier vazia
      let futureRows = aggregateHospedagem(hotelId, today, hosp);
      if (!futureRows.length) {
        console.warn(`[Pickup Daily] ${hotelId} — sem hospedagem, usando fallback /sales/otb`);
        futureRows = await fetchOTBRows(hotelId, cfg, token, today);
      }

      let pastRows: SnapshotRow[] = [];
      try {
        pastRows = await fetchPastRows(hotelId, cfg, token, today);
      } catch (e: any) {
        console.warn(`[Pickup Daily] ${hotelId} — actuals indisponíveis: ${e.message}`);
      }

      const allRows = [...pastRows, ...futureRows];
      if (allRows.length) {
        const { error } = await db
          .from('diretoria_pickup_snapshots')
          .upsert(allRows, { onConflict: 'hotel_id,snapshot_date,stay_date' });
        if (error) throw error;
      }
      console.log(`[Pickup Daily] ${hotelId} — snapshot OTB: ${allRows.length} linhas (${futureRows.length} futuras)`);

      // 4. Ocupação diária: cache do dashboard anual/mensal (Vendas & Ocupação)
      try {
        const occRows = await syncOccupancy(db, hotelId, cfg, token, today, hosp);
        console.log(`[Pickup Daily] ${hotelId} — ocupação: ${occRows} dias sincronizados`);
      } catch (e: any) {
        console.warn(`[Pickup Daily] ${hotelId} — sync de ocupação falhou: ${e.message}`);
      }
    } catch (e: any) {
      console.error(`[Pickup Daily] ${hotelId} — ERRO: ${e.message}`);
    }
  }

  console.log('[Pickup Daily] Worker concluído às', new Date().toISOString());
  return { statusCode: 200 };
};

export { handler };
