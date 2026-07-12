// netlify/functions/pickup-daily-snapshot.ts
// Job diário: captura o snapshot OTB do Pick-up Report para TODOS os hotéis com
// Erbon ativo, sem depender de alguém abrir a tela /grupo/<slug>/diretoria/pickup.
//
// Receita futura vem de GET /hotel/{id}/hospedagem — uma linha por reserva por
// dia de estadia com o VALOR REAL da diária (campo `diaria`), o que o /sales/otb
// não fornece para datas futuras. Também captura /booking/segmentsview
// (diária + segmento + origem) para análises futuras.
//
// Executa às 11:00 UTC = 08:00 BRT (UTC-3)

import { schedule } from '@netlify/functions';
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

/** Futuro: agrega as diárias do /hospedagem por dia de estadia (exclui canceladas). */
function aggregateHospedagem(hotelId: string, today: string, hosp: any[]): SnapshotRow[] {
  const byDay = new Map<string, { rooms: number; rev: number }>();
  for (const h of hosp) {
    if (h.status === 'CANCELED') continue;
    const day = String(h.datA_HOSPEDAGEM ?? '').split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
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

const handler = schedule('0 11 * * *', async () => {
  console.log('[Pickup Daily] Iniciando às', new Date().toISOString());

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

      // 1. Hospedagem: diária a diária de cada reserva (hoje → +90d)
      let hosp: any[] = [];
      try {
        const data = await erbonGet(cfg, token, `/hotel/${cfg.erbon_hotel_id}/hospedagem`, {
          stayDateStart: today, stayDateEnd: horizon,
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
    } catch (e: any) {
      console.error(`[Pickup Daily] ${hotelId} — ERRO: ${e.message}`);
    }
  }

  console.log('[Pickup Daily] Concluído às', new Date().toISOString());
  return { statusCode: 200 };
});

export { handler };
