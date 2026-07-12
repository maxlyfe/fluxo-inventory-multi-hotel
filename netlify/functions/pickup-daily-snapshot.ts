// netlify/functions/pickup-daily-snapshot.ts
// Job diário: captura o snapshot OTB do Pick-up Report para TODOS os hotéis com
// Erbon ativo, sem depender de alguém abrir a tela /grupo/<slug>/diretoria/pickup.
// Também captura /hotel/{hotelID}/hospedagem (dia a dia, valores e características
// de cada reserva) em erbon_hospedagem_daily para análise futura das diárias vendidas.
// Executa às 11:00 UTC = 08:00 BRT (UTC-3)

import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL         = process.env.SUPABASE_URL         || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

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

async function erbonGetToken(cfg: ErbonCfg): Promise<string> {
  const res = await fetch(`${erbonBase(cfg)}/hotel/${cfg.erbon_hotel_id}/auth/token`, {
    method: 'GET',
    headers: { 'username': cfg.erbon_username, 'password': cfg.erbon_password },
  });
  if (!res.ok) throw new Error(`Erbon auth failed: ${res.status}`);
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Erbon: access_token missing');
  return data.access_token;
}

async function erbonGet(cfg: ErbonCfg, token: string, path: string, extraHeaders: Record<string, string>): Promise<any> {
  const res = await fetch(`${erbonBase(cfg)}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, ...extraHeaders },
  });
  if (!res.ok) throw new Error(`Erbon GET ${path} → ${res.status}`);
  return await res.json();
}

// ── Snapshot OTB (mesma lógica do ensureSnapshot da tela PickupReport) ───────

interface SnapshotRow {
  hotel_id: string; snapshot_date: string; stay_date: string;
  rooms_otb: number; net_room_revenue: number; adr: number;
}

async function captureSnapshot(
  db: ReturnType<typeof createClient>,
  hotelId: string, cfg: ErbonCfg, token: string, today: string
): Promise<number> {
  // 1. OTB futuro: hoje → +90 dias
  const otbData: any[] = await erbonGet(cfg, token, `/hotel/${cfg.erbon_hotel_id}/sales/otb`, {
    dateFrom: today, dateTo: addDays(today, 90),
  });

  const futureRows: SnapshotRow[] = (Array.isArray(otbData) ? otbData : []).map(d => {
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

  // 2. Actuals passados: últimos 30 dias (receita real de quartos)
  let pastRows: SnapshotRow[] = [];
  try {
    const occData: any[] = await erbonGet(cfg, token, `/hotel/${cfg.erbon_hotel_id}/occupancy/withpension`, {
      dateFrom: addDays(today, -30), dateTo: addDays(today, -1), currency: '0',
    });
    pastRows = (Array.isArray(occData) ? occData : []).map(o => {
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
  } catch (e: any) {
    console.warn(`[Pickup] ${hotelId} — actuals indisponíveis: ${e.message}`);
  }

  const allRows = [...pastRows, ...futureRows];
  if (!allRows.length) return 0;

  const { error } = await db
    .from('diretoria_pickup_snapshots')
    .upsert(allRows, { onConflict: 'hotel_id,snapshot_date,stay_date' });
  if (error) throw error;
  return allRows.length;
}

// ── Hospedagem diária (/hotel/{hotelID}/hospedagem) ──────────────────────────

function pickStayDate(item: any): string | null {
  const raw = item?.stayDate ?? item?.date ?? item?.day ?? item?.dataDiaria ?? null;
  if (!raw) return null;
  const s = String(raw).split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function pickBookingId(item: any): number | null {
  const raw = item?.bookingInternalID ?? item?.bookingInternalId ?? item?.bookingID ?? item?.bookingId ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function captureHospedagem(
  db: ReturnType<typeof createClient>,
  hotelId: string, cfg: ErbonCfg, token: string, today: string
): Promise<number> {
  const data = await erbonGet(cfg, token, `/hotel/${cfg.erbon_hotel_id}/hospedagem`, {
    dateFrom: today, dateTo: addDays(today, 90),
  });
  const items: any[] = Array.isArray(data) ? data : data ? [data] : [];
  if (!items.length) return 0;

  // Idempotência: remove a captura de hoje antes de regravar
  const { error: delErr } = await db
    .from('erbon_hospedagem_daily')
    .delete()
    .eq('hotel_id', hotelId)
    .eq('snapshot_date', today);
  if (delErr) throw delErr;

  const rows = items.map(item => ({
    hotel_id:            hotelId,
    snapshot_date:       today,
    stay_date:           pickStayDate(item),
    booking_internal_id: pickBookingId(item),
    payload:             item,
  }));

  // Insere em lotes para não estourar o limite de payload do PostgREST
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from('erbon_hospedagem_daily').insert(rows.slice(i, i + CHUNK));
    if (error) throw error;
  }
  return rows.length;
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

      const snapRows = await captureSnapshot(db, hotelId, cfg, token, today);
      console.log(`[Pickup Daily] ${hotelId} — snapshot OTB: ${snapRows} linhas`);

      try {
        const hospRows = await captureHospedagem(db, hotelId, cfg, token, today);
        console.log(`[Pickup Daily] ${hotelId} — hospedagem: ${hospRows} registros`);
      } catch (e: any) {
        // Endpoint pode não existir em todas as versões da Erbon — não bloqueia o snapshot
        console.warn(`[Pickup Daily] ${hotelId} — hospedagem falhou: ${e.message}`);
      }
    } catch (e: any) {
      console.error(`[Pickup Daily] ${hotelId} — ERRO: ${e.message}`);
    }
  }

  console.log('[Pickup Daily] Concluído às', new Date().toISOString());
  return { statusCode: 200 };
});

export { handler };
