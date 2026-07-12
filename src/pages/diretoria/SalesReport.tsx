// src/pages/diretoria/SalesReport.tsx
// Relatório de Vendas & Ocupação — vendas de reservas por data de check-in,
// por data de check-out e dashboard gráfico de ocupação anual/mensal.
//
// Fonte de dados por unidade (resolvida automaticamente):
//   1. Erbon PMS ativo   → /hospedagem (diária a diária, canal, status) e
//                          /occupancy/withpension (ocupação real).
//   2. Sem Erbon         → internal_bookings (reservas próprias + Omnibees
//                          sincronizadas) + hotel_rooms para % de ocupação.

import React, { useEffect, useState, useCallback } from 'react';
import {
  Loader2, AlertCircle, Users, BedDouble, BarChart2,
  CalendarRange, DollarSign, LogIn, LogOut, Percent, Database,
} from 'lucide-react';
import {
  Bar, Line, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { erbonService } from '../../lib/erbonService';
import { useHotel } from '../../context/HotelContext';
import { useTheme } from '../../context/ThemeContext';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type DataSource = 'erbon' | 'internal' | 'none';
type ActiveTab  = 'checkin' | 'checkout' | 'occupancy';

/** Reserva unificada, independente da fonte */
interface UnifiedBooking {
  id: string;
  checkin: string;   // yyyy-mm-dd
  checkout: string;  // yyyy-mm-dd
  nights: number;
  roomNights: number; // diárias vendidas (linhas de hospedagem no período)
  total: number;     // receita de hospedagem da reserva
  paxs: number;      // total hóspedes (adultos + crianças)
  channel: string;      // origem detalhada (agente: BOOKING, DECOLAR…)
  channelGroup: string; // canal Erbon (Omnibees, E-mail, Telefone, Balcão…)
  origin: 'erbon' | 'omnibees' | 'internal';
}

interface DayBucket  { date: string; count: number; nights: number; revenue: number; adr: number; }
interface MonthOcc   { month: string; occ: number; prevOcc: number | null; roomNights: number; revenue: number; adr: number; }

// ── Utilitários ───────────────────────────────────────────────────────────────

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtShortDate(iso: string): string {
  if (!iso) return '';
  const [, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}`;
}
function fmtFullDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y?.slice(2)}`;
}
function todayStr(): string { return new Date().toISOString().split('T')[0]; }
function addDaysStr(base: string, n: number): string {
  const d = new Date(base + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}
function nightsBetween(from: string, to: string): number {
  const a = new Date(from + 'T12:00:00Z').getTime();
  const b = new Date(to + 'T12:00:00Z').getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000));
}
function monthStart(): string { return todayStr().slice(0, 8) + '01'; }
function monthEnd(): string {
  const t = todayStr();
  const [y, m] = t.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0];
}
function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

// ── Carregamento de reservas unificadas ──────────────────────────────────────

/** Agrupa linhas do /hospedagem (uma por reserva por dia) em reservas unificadas. */
function groupHospedagem(rows: any[]): UnifiedBooking[] {
  const byRes = new Map<number, { checkin: string; checkout: string; total: number; roomNights: number; paxs: number; channel: string; channelGroup: string }>();
  for (const r of rows) {
    if (!r || r.status === 'CANCELED') continue;
    const cur = byRes.get(r.iD_RESERVA);
    const checkin  = String(r.datA_ENTRADA ?? '').split('T')[0];
    const checkout = String(r.datA_SAIDA   ?? '').split('T')[0];
    const pax = (Number(r.qtD_ADL) || 0) + (Number(r.qtD_CHD) || 0) + (Number(r.qtD_CHD_FREE) || 0);
    if (cur) {
      cur.total += Number(r.diaria) || 0;
      cur.roomNights++;
    } else {
      byRes.set(r.iD_RESERVA, {
        checkin, checkout,
        total: Number(r.diaria) || 0,
        roomNights: 1,
        paxs: pax,
        // Origem detalhada como no relatório Erbon: `agente` traz o parceiro
        // real (BOOKING, DECOLAR, HOTELBEDS…); `canal` agrupa quase tudo
        // em "Omnibees" e só serve de fallback.
        channel: String(r.agente || r.canal || 'Direto').trim() || 'Direto',
        channelGroup: String(r.canal ?? '').trim(),
      });
    }
  }
  return Array.from(byRes.entries()).map(([id, b]) => ({
    id: String(id),
    checkin: b.checkin,
    checkout: b.checkout,
    nights: nightsBetween(b.checkin, b.checkout),
    roomNights: b.roomNights,
    total: b.total,
    paxs: b.paxs,
    channel: b.channel,
    channelGroup: b.channelGroup,
    origin: 'erbon' as const,
  }));
}

/**
 * Erbon (tempo real): /hospedagem em blocos MENSAIS com concorrência 3.
 * Pedir o ano inteiro de uma vez estoura o timeout de 26s do proxy (502).
 * Retorna também as linhas brutas para regravar no cache do banco.
 */
async function loadErbonBookings(hotelId: string, from: string, to: string): Promise<{ list: UnifiedBooking[]; raw: any[] }> {
  const start = addDaysStr(from, -60);
  const end   = addDaysStr(to, 60);
  const months: string[] = [];
  let cur = start.slice(0, 7);
  const last = end.slice(0, 7);
  while (cur <= last) { months.push(cur); const [y, m] = cur.split('-').map(Number); cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }

  const allRows: any[] = [];
  const queue = [...months];
  async function worker() {
    while (queue.length) {
      const mo = queue.shift()!;
      const mStart = `${mo}-01`;
      const [yy, mm] = mo.split('-').map(Number);
      const mEnd = new Date(Date.UTC(yy, mm, 0)).toISOString().split('T')[0];
      try {
        const rows = await erbonService.fetchHospedagem(hotelId, mStart, mEnd);
        allRows.push(...rows);
      } catch { /* mês indisponível */ }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { list: groupHospedagem(allRows), raw: allRows };
}

/**
 * Regrava o snapshot de hoje em erbon_hospedagem_daily com o resultado do
 * refresh — o próximo acesso pinta o painel direto do banco, sem esperar a
 * Erbon. Roda em segundo plano (não bloqueia a navegação).
 */
async function saveHospedagemCache(hotelId: string, raw: any[]): Promise<void> {
  if (!raw.length) return;
  const today = todayStr();
  try {
    // Snapshot de hoje é substituído por completo (mesma idempotência do job)
    await supabase.from('erbon_hospedagem_daily')
      .delete()
      .eq('hotel_id', hotelId)
      .eq('snapshot_date', today);
    const rows = raw.map(item => ({
      hotel_id:            hotelId,
      snapshot_date:       today,
      stay_date:           String(item.datA_HOSPEDAGEM ?? '').split('T')[0] || null,
      booking_internal_id: Number(item.iD_RESERVA) || null,
      daily_rate:          Number(item.diaria) || 0,
      status:              item.status ?? null,
      payload:             item,
    }));
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from('erbon_hospedagem_daily').insert(rows.slice(i, i + CHUNK));
      if (error) { console.warn('[Vendas] cache de hospedagem:', error.message); return; }
    }
  } catch (e: any) {
    console.warn('[Vendas] cache de hospedagem:', e?.message);
  }
}

/**
 * TTL de frescor por sessão: se acabamos de atualizar da Erbon, a navegação
 * seguinte usa só o banco — sem refazer as chamadas lentas.
 */
const FRESH_TTL_MS = 10 * 60 * 1000;
function isFresh(key: string): boolean {
  try {
    const t = Number(localStorage.getItem(`sv-fresh:${key}`));
    return t > 0 && Date.now() - t < FRESH_TTL_MS;
  } catch { return false; }
}
function markFresh(key: string): void {
  try { localStorage.setItem(`sv-fresh:${key}`, String(Date.now())); } catch { /* storage cheio/indisponível */ }
}

/**
 * Erbon (cache): captura mais recente do job diário em erbon_hospedagem_daily.
 * Renderiza o painel na hora enquanto o refresh em tempo real roda por trás.
 */
async function loadErbonBookingsCache(hotelId: string): Promise<{ list: UnifiedBooking[]; snapshotDate: string } | null> {
  const { data: last } = await supabase
    .from('erbon_hospedagem_daily')
    .select('snapshot_date')
    .eq('hotel_id', hotelId)
    .order('snapshot_date', { ascending: false })
    .limit(1);
  const snap = (last as any)?.[0]?.snapshot_date;
  if (!snap) return null;

  // PostgREST limita cada resposta a 1000 linhas — paginamos até o fim,
  // senão o snapshot do ano (9k+ linhas) vem truncado.
  const PAGE = 1000;
  const rows: any[] = [];
  for (let fromIdx = 0; ; fromIdx += PAGE) {
    const { data, error } = await supabase
      .from('erbon_hospedagem_daily')
      .select('payload')
      .eq('hotel_id', hotelId)
      .eq('snapshot_date', snap)
      .order('id', { ascending: true })
      .range(fromIdx, fromIdx + PAGE - 1);
    if (error) return rows.length ? { list: groupHospedagem(rows.map((r: any) => r.payload)), snapshotDate: String(snap) } : null;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  if (!rows.length) return null;

  return { list: groupHospedagem(rows.map((r: any) => r.payload)), snapshotDate: String(snap) };
}

/** Sem Erbon: reservas próprias + Omnibees gravadas em internal_bookings. */
async function loadInternalBookings(hotelId: string, from: string, to: string): Promise<UnifiedBooking[]> {
  const { data, error } = await supabase
    .from('internal_bookings')
    .select('id, checkin, checkout, total_rate, status, source, channel, adults, children')
    .eq('hotel_id', hotelId)
    .neq('status', 'cancelled')
    .gte('checkout', addDaysStr(from, -60))
    .lte('checkin', addDaysStr(to, 60));
  if (error) throw error;
  return (data ?? []).map((b: any) => {
    const n = nightsBetween(b.checkin, b.checkout);
    return {
      id: b.id,
      checkin: b.checkin,
      checkout: b.checkout,
      nights: n,
      roomNights: n,
      total: Number(b.total_rate) || 0,
      paxs: (Number(b.adults) || 1) + (Number(b.children) || 0),
      channel: b.channel || (b.source === 'omnibees' ? 'Omnibees' : 'Direto'),
      channelGroup: b.source === 'omnibees' ? 'Omnibees' : '',
      origin: (b.source === 'omnibees' ? 'omnibees' : 'internal') as UnifiedBooking['origin'],
    };
  });
}

/** Agrupa reservas por uma data-chave (checkin ou checkout) dentro do período. */
function bucketByDate(bookings: UnifiedBooking[], key: 'checkin' | 'checkout', from: string, to: string): DayBucket[] {
  const map = new Map<string, { count: number; nights: number; revenue: number }>();
  for (const b of bookings) {
    const d = b[key];
    if (!d || d < from || d > to) continue;
    const cur = map.get(d) ?? { count: 0, nights: 0, revenue: 0 };
    map.set(d, { count: cur.count + 1, nights: cur.nights + b.nights, revenue: cur.revenue + b.total });
  }
  return Array.from(map.entries()).sort().map(([date, v]) => ({
    date, ...v, adr: v.nights > 0 ? v.revenue / v.nights : 0,
  }));
}

// ── Ocupação mensal/anual ────────────────────────────────────────────────────

interface OccAgg   { occ: number[]; roomNights: number[]; revenue: number[] }
interface OccDaily { date: string; occupancy: number; roomsSold: number; roomRevenue: number }

/** Agrega dias em médias/somas mensais do ano. */
function aggOccMonthly(days: OccDaily[], year: number): OccAgg {
  const occ = Array(12).fill(0) as number[];
  const cnt = Array(12).fill(0) as number[];
  const roomNights = Array(12).fill(0) as number[];
  const revenue = Array(12).fill(0) as number[];
  for (const d of days) {
    if (!d.date.startsWith(`${year}-`)) continue;
    const m = Number(d.date.split('-')[1]) - 1;
    if (m < 0 || m > 11) continue;
    occ[m] += d.occupancy;
    cnt[m]++;
    roomNights[m] += d.roomsSold;
    revenue[m]    += d.roomRevenue;
  }
  return { occ: occ.map((s, i) => (cnt[i] ? s / cnt[i] : 0)), roomNights, revenue };
}

/** Cache: ocupação diária gravada pelo job das 8h (erbon_occupancy_daily). */
async function loadOccCache(hotelId: string, year: number): Promise<OccDaily[]> {
  const { data, error } = await supabase
    .from('erbon_occupancy_daily')
    .select('date, occupancy, rooms_sold, room_revenue')
    .eq('hotel_id', hotelId)
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`);
  if (error) return [];
  return (data ?? []).map((r: any) => ({
    date:        String(r.date),
    occupancy:   Number(r.occupancy)    || 0,
    roomsSold:   Number(r.rooms_sold)   || 0,
    roomRevenue: Number(r.room_revenue) || 0,
  }));
}

/**
 * Tempo real: busca o ano na Erbon em 12 blocos MENSAIS com concorrência 3 —
 * pedir o ano inteiro numa chamada só estoura o timeout do proxy (502), e
 * 12 chamadas simultâneas derrubam parte delas (a API da Erbon degrada).
 * Medido ao vivo: 12/12 meses em ~28s com 3 workers.
 *
 * Para datas futuras onde /occupancy/withpension retorna totalDailyRate=0
 * (comportamento confirmado da Erbon), complementa a receita via /hospedagem.
 */
async function fetchOccYearLive(hotelId: string, year: number): Promise<OccDaily[]> {
  const out: OccDaily[] = [];
  let okCount = 0;
  const queue = Array.from({ length: 12 }, (_, m) => m);

  async function worker() {
    while (queue.length) {
      const m = queue.shift()!;
      const from = `${year}-${String(m + 1).padStart(2, '0')}-01`;
      const to   = new Date(Date.UTC(year, m + 1, 0)).toISOString().split('T')[0];
      try {
        const data = await erbonService.fetchOccupancyWithPension(hotelId, from, to);
        okCount++;
        for (const o of data) {
          const rooms = (o.roomSalledConfirmed ?? 0) + (o.roomSalledRateDefault ?? 0)
            + (o.roomSalledPending ?? 0) + (o.roomSalledInvited ?? 0)
            + (o.roomSalledHouseUse ?? 0) + (o.roomSalledPermut ?? 0)
            + (o.roomSalledCrewMember ?? 0) + (o.roomSalledDayUse ?? 0);
          const sellable = rooms + (o.roomAvailable ?? 0);
          out.push({
            date:        String(o.date).split('T')[0],
            occupancy:   sellable > 0 ? (rooms / sellable) * 100 : 0,
            roomsSold:   rooms,
            roomRevenue: o.totalDailyRate ?? 0,
          });
        }
      } catch { /* mês indisponível — segue os demais */ }
    }
  }

  await Promise.all([worker(), worker(), worker()]);
  if (okCount === 0) throw new Error('Erbon não respondeu para nenhum mês');

  // Suplementa receita futura via /hospedagem onde occupancy retorna R$0
  const today = todayStr();
  const futureMissing = out.filter(d => d.date >= today && d.roomRevenue === 0 && d.roomsSold > 0);
  if (futureMissing.length) {
    const revByDay = await fetchHospedagemRevByDay(hotelId, today, `${year}-12-31`);
    for (const d of out) {
      if (d.date >= today && d.roomRevenue === 0 && revByDay.has(d.date)) {
        d.roomRevenue = revByDay.get(d.date)!;
      }
    }
  }

  return out;
}

/**
 * Busca /hospedagem em blocos mensais (concorrência 3) e retorna a receita
 * agregada por dia (soma de `diaria` excluindo CANCELED).
 */
async function fetchHospedagemRevByDay(hotelId: string, from: string, to: string): Promise<Map<string, number>> {
  const months: string[] = [];
  let cur = from.slice(0, 7);
  const last = to.slice(0, 7);
  while (cur <= last) {
    months.push(cur);
    const [y, m] = cur.split('-').map(Number);
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }

  const revMap = new Map<string, number>();
  const queue = [...months];
  async function worker() {
    while (queue.length) {
      const mo = queue.shift()!;
      const mStart = `${mo}-01`;
      const [yy, mm] = mo.split('-').map(Number);
      const mEnd = new Date(Date.UTC(yy, mm, 0)).toISOString().split('T')[0];
      try {
        const rows = await erbonService.fetchHospedagem(hotelId, mStart, mEnd);
        for (const r of rows) {
          if (r.status === 'CANCELED') continue;
          const d = String(r.datA_HOSPEDAGEM ?? '').split('T')[0];
          if (d >= from && d <= to) {
            revMap.set(d, (revMap.get(d) || 0) + (Number(r.diaria) || 0));
          }
        }
      } catch { /* mês indisponível */ }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return revMap;
}

/** Grava o resultado do refresh no cache — o próximo acesso abre instantâneo. */
function upsertOccCache(hotelId: string, days: OccDaily[]): void {
  if (!days.length) return;
  const rows = days.map(d => ({
    hotel_id:     hotelId,
    date:         d.date,
    occupancy:    d.occupancy,
    rooms_sold:   d.roomsSold,
    room_revenue: d.roomRevenue,
    adr:          d.roomsSold > 0 ? d.roomRevenue / d.roomsSold : 0,
    synced_at:    new Date().toISOString(),
  }));
  supabase.from('erbon_occupancy_daily')
    .upsert(rows, { onConflict: 'hotel_id,date' })
    .then(({ error }) => { if (error) console.warn('[Vendas] cache de ocupação:', error.message); });
}

async function loadInternalOccupancy(hotelId: string, year: number): Promise<{ occ: number[]; roomNights: number[]; revenue: number[] }> {
  const [{ count: roomCount }, { data: bookings, error }] = await Promise.all([
    supabase.from('hotel_rooms').select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId).eq('is_active', true),
    supabase.from('internal_bookings')
      .select('checkin, checkout, total_rate, status')
      .eq('hotel_id', hotelId)
      .neq('status', 'cancelled')
      .lte('checkin', `${year}-12-31`)
      .gte('checkout', `${year}-01-01`),
  ]);
  if (error) throw error;

  const roomNights = Array(12).fill(0) as number[];
  const revenue = Array(12).fill(0) as number[];
  for (const b of (bookings ?? []) as any[]) {
    const nights = nightsBetween(b.checkin, b.checkout);
    const perNight = nights > 0 ? (Number(b.total_rate) || 0) / nights : 0;
    // Expande noite a noite (checkin inclusivo, checkout exclusivo)
    let cur = b.checkin as string;
    for (let i = 0; i < nights && i < 400; i++) {
      const [y, m] = cur.split('-').map(Number);
      if (y === year) {
        roomNights[m - 1]++;
        revenue[m - 1] += perNight;
      }
      cur = addDaysStr(cur, 1);
    }
  }
  const rooms = roomCount || 0;
  const occ = roomNights.map((n, i) => rooms > 0 ? (n / (rooms * daysInMonth(year, i))) * 100 : 0);
  return { occ, roomNights, revenue };
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, isDark }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: isDark ? 'rgba(15,23,42,0.97)' : 'rgba(255,255,255,0.98)',
      border: `1px solid ${isDark ? 'rgba(148,163,184,0.2)' : 'rgba(203,213,225,0.8)'}`,
      borderRadius: 12, padding: '10px 14px', fontSize: 12,
      color: isDark ? '#f1f5f9' : '#1e293b',
      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.2)',
    }}>
      <div style={{ fontWeight: 800, marginBottom: 8, color: isDark ? '#94a3b8' : '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      {payload.map((p: any) => {
        const isMoney = /receita|adr/i.test(p.name);
        const isPct   = /ocupa/i.test(p.name);
        return (
          <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color || p.stroke, flexShrink: 0 }} />
            <span style={{ color: isDark ? '#cbd5e1' : '#475569' }}>{p.name}:</span>
            <span style={{ fontWeight: 700, color: p.color || p.stroke }}>
              {isMoney ? fmtBRL(p.value) : isPct ? `${Number(p.value).toFixed(1)}%` : Number(p.value).toFixed(0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function SalesReport() {
  const { selectedHotel } = useHotel();
  const { theme }         = useTheme();
  const isDark            = theme === 'dark';
  const hotelId           = selectedHotel?.id ?? '';

  const [activeTab, setActiveTab] = useState<ActiveTab>('checkin');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [source,    setSource]    = useState<DataSource>('none');
  const [hasOmnibees, setHasOmnibees] = useState(false);

  // Estado do refresh em tempo real (cache abre na hora; Erbon atualiza por trás)
  const [refreshing,  setRefreshing]  = useState(false);
  const [refreshNote, setRefreshNote] = useState('');
  const [lastSync,    setLastSync]    = useState('');

  // Período das abas de vendas (padrão: ano corrente como no relatório Erbon)
  const [dateFrom, setDateFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [dateTo,   setDateTo]   = useState(() => `${new Date().getFullYear()}-12-31`);

  // Ano do dashboard de ocupação
  const [occYear, setOccYear] = useState<number>(() => new Date().getFullYear());

  const [bookings,   setBookings]   = useState<UnifiedBooking[]>([]);
  const [monthlyOcc, setMonthlyOcc] = useState<MonthOcc[]>([]);

  // ── Resolução da fonte + carga de reservas (cache primeiro, Erbon por trás) ─

  const nowTime = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    if (!hotelId || activeTab === 'occupancy') return;
    let cancelled = false;
    (async () => {
      setError(''); setRefreshNote('');
      try {
        const cfg = await erbonService.getConfig(hotelId).catch(() => null);
        const isErbon = !!(cfg && (cfg as any).is_active);

        if (!isErbon) {
          // Dados próprios/Omnibees: o banco já é a fonte — leitura direta
          setSource('internal'); setLoading(true);
          const list = await loadInternalBookings(hotelId, dateFrom, dateTo);
          if (cancelled) return;
          setHasOmnibees(list.some(b => b.origin === 'omnibees'));
          setBookings(list);
          setLastSync(nowTime());
          return;
        }

        setSource('erbon'); setHasOmnibees(false);

        // 1. Cache mais recente do banco: pinta o painel na hora
        const cached = await loadErbonBookingsCache(hotelId);
        if (cancelled) return;
        if (cached) {
          setBookings(cached.list);
          setLoading(false);
        } else {
          setLoading(true);
        }

        // 2. Refresh em tempo real na Erbon — só se o cache não for recente.
        //    Após atualizar, regrava no banco: a próxima navegação abre direto
        //    do banco sem esperar a Erbon.
        const freshKey = `hosp|${hotelId}|${dateFrom}|${dateTo}`;
        if (cached && isFresh(freshKey)) {
          setLastSync(nowTime());
          return;
        }
        setRefreshing(true);
        try {
          const live = await loadErbonBookings(hotelId, dateFrom, dateTo);
          if (!cancelled) {
            setBookings(live.list);
            setLastSync(nowTime());
          }
          markFresh(freshKey);
          void saveHospedagemCache(hotelId, live.raw);
        } catch (e: any) {
          if (!cancelled) {
            if (cached) setRefreshNote(`Erbon indisponível — dados salvos de ${fmtFullDate(cached.snapshotDate)}`);
            else setError('Erro ao carregar reservas: ' + e.message);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError('Erro ao carregar reservas: ' + e.message);
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [hotelId, dateFrom, dateTo, activeTab]);

  // ── Carga da ocupação ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!hotelId || activeTab !== 'occupancy') return;
    let cancelled = false;

    const build = (curr: OccAgg, prev: OccAgg | null): MonthOcc[] => MONTH_LABELS.map((label, i) => ({
      month: label,
      occ:        Number(curr.occ[i].toFixed(1)),
      prevOcc:    prev ? Number(prev.occ[i].toFixed(1)) : null,
      roomNights: curr.roomNights[i],
      revenue:    curr.revenue[i],
      adr:        curr.roomNights[i] > 0 ? curr.revenue[i] / curr.roomNights[i] : 0,
    }));

    (async () => {
      setError(''); setRefreshNote('');
      try {
        const cfg = await erbonService.getConfig(hotelId).catch(() => null);
        const isErbon = !!(cfg && (cfg as any).is_active);
        setSource(isErbon ? 'erbon' : 'internal');

        if (!isErbon) {
          // Dados próprios: o banco já é a fonte — leitura direta
          setLoading(true);
          const [curr, prev] = await Promise.all([
            loadInternalOccupancy(hotelId, occYear),
            loadInternalOccupancy(hotelId, occYear - 1).catch(() => null),
          ]);
          if (!cancelled) { setMonthlyOcc(build(curr, prev)); setLastSync(nowTime()); }
          return;
        }

        // 1. Cache do job diário: pinta o dashboard na hora
        const [currCache, prevCache] = await Promise.all([
          loadOccCache(hotelId, occYear),
          loadOccCache(hotelId, occYear - 1),
        ]);
        if (cancelled) return;
        const hasCache = currCache.length > 0;
        if (hasCache) {
          setMonthlyOcc(build(
            aggOccMonthly(currCache, occYear),
            prevCache.length ? aggOccMonthly(prevCache, occYear - 1) : null,
          ));
          setLoading(false);
        } else {
          setLoading(true);
        }

        // 2. Refresh em tempo real na Erbon (12 blocos mensais) — pulado se o
        //    cache acabou de ser atualizado nesta sessão
        const freshKey = `occ|${hotelId}|${occYear}`;
        if (hasCache && isFresh(freshKey)) {
          setLastSync(nowTime());
          return;
        }
        setRefreshing(true);
        try {
          const currLive = await fetchOccYearLive(hotelId, occYear);
          const prevHasRealData = prevCache.some(d => d.occupancy > 0);
          let prevDays = prevHasRealData ? prevCache : [];
          if (!prevDays.length) {
            prevDays = await fetchOccYearLive(hotelId, occYear - 1).catch(() => []);
            if (prevDays.length) upsertOccCache(hotelId, prevDays);
          }
          if (!cancelled) {
            setMonthlyOcc(build(
              aggOccMonthly(currLive, occYear),
              prevDays.length ? aggOccMonthly(prevDays, occYear - 1) : null,
            ));
            setLastSync(nowTime());
          }
          markFresh(freshKey);
          upsertOccCache(hotelId, currLive);
        } catch (e: any) {
          if (!cancelled) {
            if (hasCache) setRefreshNote('Erbon indisponível — exibindo dados salvos');
            else setError('Erro ao carregar ocupação: ' + e.message);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError('Erro ao carregar ocupação: ' + e.message);
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [hotelId, occYear, activeTab]);

  // ── Agregações das abas de vendas ─────────────────────────────────────────

  const dateKey: 'checkin' | 'checkout' = activeTab === 'checkout' ? 'checkout' : 'checkin';
  const buckets = bucketByDate(bookings, dateKey, dateFrom, dateTo);
  const totCount   = buckets.reduce((s, b) => s + b.count, 0);
  const totNights  = buckets.reduce((s, b) => s + b.nights, 0);
  const totRevenue = buckets.reduce((s, b) => s + b.revenue, 0);
  const avgADR     = totNights > 0 ? totRevenue / totNights : 0;

  // Canais do período (reservas cuja data-chave cai no período) — estrutura do relatório Erbon
  const chanMap = new Map<string, { channelGroup: string; count: number; roomNights: number; paxs: number; revenue: number }>();
  for (const b of bookings) {
    const d = b[dateKey];
    if (!d || d < dateFrom || d > dateTo) continue;
    const cur = chanMap.get(b.channel) ?? { channelGroup: b.channelGroup, count: 0, roomNights: 0, paxs: 0, revenue: 0 };
    chanMap.set(b.channel, {
      channelGroup: cur.channelGroup || b.channelGroup,
      count: cur.count + 1,
      roomNights: cur.roomNights + b.roomNights,
      paxs: cur.paxs + b.paxs,
      revenue: cur.revenue + b.total,
    });
  }
  const channels = Array.from(chanMap.entries())
    .map(([channel, v]) => ({ channel, ...v, adr: v.roomNights > 0 ? v.revenue / v.roomNights : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  const chanTotals = channels.reduce((t, c) => ({
    count: t.count + c.count, roomNights: t.roomNights + c.roomNights,
    paxs: t.paxs + c.paxs, revenue: t.revenue + c.revenue,
  }), { count: 0, roomNights: 0, paxs: 0, revenue: 0 });

  // KPIs da ocupação
  const yearAvgOcc     = monthlyOcc.length ? monthlyOcc.reduce((s, m) => s + m.occ, 0) / 12 : 0;
  const yearRoomNights = monthlyOcc.reduce((s, m) => s + m.roomNights, 0);
  const yearRevenue    = monthlyOcc.reduce((s, m) => s + m.revenue, 0);
  const yearADR        = yearRoomNights > 0 ? yearRevenue / yearRoomNights : 0;

  // ── Visual ────────────────────────────────────────────────────────────────

  const cardBg   = isDark ? 'rgba(15,23,42,0.6)'  : '#fff';
  const cardBdr  = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(203,213,225,0.5)';
  const headBg   = isDark ? 'rgba(2,6,23,0.88)'   : 'rgba(255,255,255,0.88)';
  const textMute = isDark ? '#64748b' : '#94a3b8';
  const textSub  = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(203,213,225,0.4)';

  const sourceBadge = source === 'erbon'
    ? { label: 'Erbon PMS', color: '#0ea5e9' }
    : hasOmnibees
      ? { label: 'Próprias + Omnibees', color: '#f59e0b' }
      : { label: 'Reservas próprias', color: '#8b5cf6' };

  const kpis = activeTab === 'occupancy'
    ? [
        { label: `Ocupação média ${occYear}`, val: `${yearAvgOcc.toFixed(1)}%`, icon: <Percent size={18} />,   color: '#0ea5e9' },
        { label: 'Diárias vendidas',           val: yearRoomNights.toLocaleString('pt-BR'), icon: <BedDouble size={18} />, color: '#8b5cf6' },
        { label: 'Receita de hospedagem',      val: fmtBRL(yearRevenue), icon: <DollarSign size={18} />, color: '#10b981' },
        { label: 'ADR médio',                  val: fmtBRL(yearADR),     icon: <BarChart2 size={18} />,  color: '#f59e0b' },
      ]
    : [
        { label: 'Reservas',        val: chanTotals.count.toLocaleString('pt-BR'),      icon: <Users size={18} />,      color: '#0ea5e9' },
        { label: 'Total diárias',   val: chanTotals.roomNights.toLocaleString('pt-BR'), icon: <BedDouble size={18} />,  color: '#8b5cf6' },
        { label: 'Receita',         val: fmtBRL(chanTotals.revenue),                    icon: <DollarSign size={18} />, color: '#10b981' },
        { label: 'DM (ADR)',        val: fmtBRL(chanTotals.roomNights > 0 ? chanTotals.revenue / chanTotals.roomNights : 0), icon: <BarChart2 size={18} />, color: '#f59e0b' },
      ];

  return (
    <div style={{ minHeight: '100vh', background: isDark ? '#020617' : '#f8fafc', color: isDark ? '#f8fafc' : '#1e293b', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .sv-tab { transition: all 0.2s ease; cursor: pointer; border: none; }
        .sv-row:hover td { background: ${isDark ? 'rgba(14,165,233,0.05)' : 'rgba(14,165,233,0.03)'} !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.4s ease; }
        .sv-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
        .sv-table th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; color: ${textMute}; padding: 0.65rem 0.75rem; white-space: nowrap; }
        .sv-table td { font-size: 13px; padding: 0.6rem 0.75rem; white-space: nowrap; }
        .sv-table tbody tr { border-top: 1px solid ${cardBdr}; }
        .sv-table tbody tr:nth-child(even) td { background: ${isDark ? 'rgba(148,163,184,0.03)' : 'rgba(100,116,139,0.03)'}; }
        .sv-scroll { overflow: auto; }
        .sv-scroll thead th { position: sticky; top: 0; background: ${isDark ? '#0b1424' : '#fff'}; z-index: 2; box-shadow: inset 0 -1px 0 ${cardBdr}; }
        .sv-scroll tfoot td { position: sticky; bottom: 0; background: ${isDark ? '#0b1424' : '#fff'}; box-shadow: inset 0 2px 0 ${cardBdr}; }
        .sv-total td { font-weight: 900; font-size: 13px; padding: 0.65rem 0.75rem; white-space: nowrap; }
        @media (prefers-reduced-motion: reduce) { .fade-up { animation: none; } }
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom: `1px solid ${cardBdr}`, padding: '1.25rem 2rem', background: headBg, backdropFilter: 'blur(20px)', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 16px -4px rgba(16,185,129,0.4)', flexShrink: 0 }}>
                <DollarSign size={24} color="#fff" />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, letterSpacing: -0.8 }}>Vendas & Ocupação</h1>
                <p style={{ margin: 0, fontSize: 13, color: textSub, fontWeight: 500 }}>
                  Reservas por check-in, check-out e ocupação anual/mensal
                </p>
              </div>
            </div>

            {/* Badges: fonte de dados + estado da atualização */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.9rem', background: isDark ? 'rgba(30,41,59,0.6)' : '#f1f5f9', borderRadius: 10, fontSize: 12, fontWeight: 700, color: sourceBadge.color, border: `1px solid ${sourceBadge.color}30` }}>
                <Database size={13} />
                Fonte: {sourceBadge.label}
              </div>
              {refreshing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.9rem', background: isDark ? 'rgba(14,165,233,0.12)' : 'rgba(14,165,233,0.08)', borderRadius: 10, fontSize: 12, fontWeight: 700, color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.3)' }}>
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                  Atualizando da fonte...
                </div>
              ) : refreshNote ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.9rem', background: isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.08)', borderRadius: 10, fontSize: 12, fontWeight: 700, color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <AlertCircle size={13} />
                  {refreshNote}
                </div>
              ) : lastSync ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.9rem', background: isDark ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.08)', borderRadius: 10, fontSize: 12, fontWeight: 700, color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981' }} />
                  Atualizado {lastSync}
                </div>
              ) : null}
            </div>
          </div>

          {/* Tabs + filtros */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4, background: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.8)', border: `1px solid ${cardBdr}`, borderRadius: 14, padding: 4 }}>
              {([
                { id: 'checkin',   label: 'Por Check-in',  icon: <LogIn size={14} /> },
                { id: 'checkout',  label: 'Por Check-out', icon: <LogOut size={14} /> },
                { id: 'occupancy', label: 'Ocupação',      icon: <Percent size={14} /> },
              ] as { id: ActiveTab; label: string; icon: React.ReactNode }[]).map(t => (
                <button key={t.id} className="sv-tab" onClick={() => setActiveTab(t.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.55rem 1.1rem', borderRadius: 11, background: activeTab === t.id ? '#10b981' : 'transparent', color: activeTab === t.id ? '#fff' : textSub, fontWeight: 700, fontSize: 13 }}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>

            {activeTab !== 'occupancy' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: textMute, textTransform: 'uppercase', letterSpacing: 1 }}>Período</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0.3rem 0.7rem', background: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.9)', border: `1px solid ${cardBdr}`, borderRadius: 9 }}>
                  <CalendarRange size={12} color={textMute} />
                  <input type="date" value={dateFrom} onChange={e => e.target.value && setDateFrom(e.target.value)}
                    style={{ border: 'none', background: 'transparent', color: isDark ? '#f8fafc' : '#1e293b', fontSize: 12, fontWeight: 700, outline: 'none', cursor: 'pointer', width: 118 }} />
                  <span style={{ color: textMute, fontSize: 12 }}>→</span>
                  <input type="date" value={dateTo} onChange={e => e.target.value && setDateTo(e.target.value)}
                    style={{ border: 'none', background: 'transparent', color: isDark ? '#f8fafc' : '#1e293b', fontSize: 12, fontWeight: 700, outline: 'none', cursor: 'pointer', width: 118 }} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: textMute, textTransform: 'uppercase', letterSpacing: 1 }}>Ano</span>
                <div style={{ display: 'flex', gap: 3, background: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.9)', border: `1px solid ${cardBdr}`, borderRadius: 12, padding: 3 }}>
                  {[occYear - 2, occYear - 1, occYear, occYear + 1].filter(y => y <= new Date().getFullYear() + 1).map(y => (
                    <button key={y} className="sv-tab" onClick={() => setOccYear(y)}
                      style={{ padding: '0.35rem 0.8rem', borderRadius: 9, background: occYear === y ? '#8b5cf6' : 'transparent', color: occYear === y ? '#fff' : textSub, fontWeight: 700, fontSize: 12 }}>
                      {y}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '2rem 2rem' }}>
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: isDark ? 'rgba(239,68,68,0.1)' : '#fef2f2', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, padding: '1rem 1.5rem', marginBottom: '2rem' }}>
            <AlertCircle size={18} color="#ef4444" />
            <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 600 }}>{error}</span>
          </div>
        )}

        {loading && !error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '4rem', color: textSub }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontWeight: 600 }}>Carregando dados...</span>
          </div>
        )}

        {!loading && !error && (
          <div className="fade-up">
            {/* ── KPIs ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
              {kpis.map((k, i) => (
                <div key={i} style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, padding: '1.25rem', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: `${k.color}15`, color: k.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {k.icon}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: textSub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.label}</p>
                    <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900 }}>{k.val}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Abas de vendas (check-in / check-out) ── */}
            {activeTab !== 'occupancy' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Gráfico receita + reservas por dia */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '1.25rem 1.5rem', borderBottom: `1px solid ${cardBdr}`, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
                      Receita por data de {activeTab === 'checkin' ? 'check-in' : 'check-out'}
                    </h3>
                    <span style={{ fontSize: 12, color: textSub, fontWeight: 600 }}>{fmtFullDate(dateFrom)} → {fmtFullDate(dateTo)}</span>
                  </div>
                  {buckets.length === 0 ? (
                    <p style={{ color: textSub, fontSize: 13, padding: '2.5rem', textAlign: 'center', margin: 0 }}>Nenhuma reserva no período selecionado.</p>
                  ) : (
                    <div style={{ padding: '1.25rem 1.5rem 1.5rem' }}>
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={buckets.map(b => ({ ...b, label: fmtShortDate(b.date) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: textSub }} />
                        <YAxis yAxisId="rev" tick={{ fontSize: 11, fill: textSub }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                        <YAxis yAxisId="cnt" orientation="right" tick={{ fontSize: 11, fill: textSub }} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip isDark={isDark} />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar yAxisId="rev" dataKey="revenue" name="Receita" fill="#10b981" radius={[6, 6, 0, 0]} />
                        <Line yAxisId="cnt" dataKey="count" name="Reservas" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Canais — relatório principal estilo Erbon, largura total */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '1.25rem 1.5rem', borderBottom: `1px solid ${cardBdr}`, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
                      Venda por canal — {activeTab === 'checkin' ? 'check-in' : 'check-out'}
                    </h3>
                    <span style={{ fontSize: 12, color: textSub, fontWeight: 600 }}>{channels.length} origens · ordenado por receita</span>
                  </div>
                  {channels.length === 0 ? (
                    <p style={{ color: textSub, fontSize: 13, padding: '2.5rem', textAlign: 'center', margin: 0 }}>Sem dados no período.</p>
                  ) : (
                    <div className="sv-scroll" style={{ maxHeight: 520 }}>
                      <table className="sv-table">
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left'  }}>Origem</th>
                            <th style={{ textAlign: 'left'  }}>Canal</th>
                            <th style={{ textAlign: 'right' }}>Reservas</th>
                            <th style={{ textAlign: 'right' }}>Diárias</th>
                            <th style={{ textAlign: 'right' }}>PAXs</th>
                            <th style={{ textAlign: 'right' }}>DM</th>
                            <th style={{ textAlign: 'right' }}>Receita</th>
                            <th style={{ textAlign: 'left', width: 160 }}>Participação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {channels.map(c => {
                            const share = chanTotals.revenue > 0 ? (c.revenue / chanTotals.revenue) * 100 : 0;
                            return (
                              <tr key={c.channel} className="sv-row">
                                <td style={{ fontWeight: 700 }}>{c.channel}</td>
                                <td style={{ color: textSub }}>{c.channelGroup && c.channelGroup !== c.channel ? c.channelGroup : '—'}</td>
                                <td style={{ textAlign: 'right' }}>{c.count.toLocaleString('pt-BR')}</td>
                                <td style={{ textAlign: 'right' }}>{c.roomNights.toLocaleString('pt-BR')}</td>
                                <td style={{ textAlign: 'right' }}>{c.paxs.toLocaleString('pt-BR')}</td>
                                <td style={{ textAlign: 'right' }}>{fmtBRL(c.adr)}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: '#10b981' }}>{fmtBRL(c.revenue)}</td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.12)', overflow: 'hidden', minWidth: 60 }}>
                                      <div style={{ width: `${Math.max(share, 1)}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
                                    </div>
                                    <span style={{ fontSize: 11.5, fontWeight: 700, color: textSub, width: 42, textAlign: 'right' }}>{share.toFixed(1)}%</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="sv-total">
                            <td>Total</td>
                            <td />
                            <td style={{ textAlign: 'right' }}>{chanTotals.count.toLocaleString('pt-BR')}</td>
                            <td style={{ textAlign: 'right' }}>{chanTotals.roomNights.toLocaleString('pt-BR')}</td>
                            <td style={{ textAlign: 'right' }}>{chanTotals.paxs.toLocaleString('pt-BR')}</td>
                            <td style={{ textAlign: 'right' }}>{chanTotals.roomNights > 0 ? fmtBRL(chanTotals.revenue / chanTotals.roomNights) : 'R$ 0'}</td>
                            <td style={{ textAlign: 'right', color: '#10b981' }}>{fmtBRL(chanTotals.revenue)}</td>
                            <td style={{ fontWeight: 700, color: textSub }}>100%</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                {/* Detalhe por dia — largura total, rolagem interna com cabeçalho e total fixos */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '1.25rem 1.5rem', borderBottom: `1px solid ${cardBdr}`, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
                      Detalhe por data de {activeTab === 'checkin' ? 'check-in' : 'check-out'}
                    </h3>
                    <span style={{ fontSize: 12, color: textSub, fontWeight: 600 }}>{buckets.length} dias com movimento</span>
                  </div>
                  {buckets.length === 0 ? (
                    <p style={{ color: textSub, fontSize: 13, padding: '2.5rem', textAlign: 'center', margin: 0 }}>Nenhuma reserva no período selecionado.</p>
                  ) : (
                    <div className="sv-scroll" style={{ maxHeight: 520 }}>
                      <table className="sv-table">
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left'  }}>Data</th>
                            <th style={{ textAlign: 'right' }}>Reservas</th>
                            <th style={{ textAlign: 'right' }}>Noites</th>
                            <th style={{ textAlign: 'right' }}>Receita</th>
                            <th style={{ textAlign: 'right' }}>ADR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {buckets.map(b => (
                            <tr key={b.date} className="sv-row">
                              <td style={{ fontWeight: 700 }}>{fmtFullDate(b.date)}</td>
                              <td style={{ textAlign: 'right' }}>{b.count}</td>
                              <td style={{ textAlign: 'right' }}>{b.nights}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700, color: '#10b981' }}>{fmtBRL(b.revenue)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtBRL(b.adr)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="sv-total">
                            <td>Total</td>
                            <td style={{ textAlign: 'right' }}>{totCount.toLocaleString('pt-BR')}</td>
                            <td style={{ textAlign: 'right' }}>{totNights.toLocaleString('pt-BR')}</td>
                            <td style={{ textAlign: 'right', color: '#10b981' }}>{fmtBRL(totRevenue)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtBRL(avgADR)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Dashboard de ocupação ── */}
            {activeTab === 'occupancy' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Ocupação mensal (com comparação ano anterior) */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '1.25rem 1.5rem', borderBottom: `1px solid ${cardBdr}`, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Ocupação mensal — {occYear}</h3>
                    <span style={{ fontSize: 12, color: textSub, fontWeight: 600 }}>comparado com {occYear - 1}</span>
                  </div>
                  <div style={{ padding: '1.25rem 1.5rem 1.5rem' }}>
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={monthlyOcc}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="month" tick={{ fontSize: 12, fill: textSub }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: textSub }} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip content={<ChartTooltip isDark={isDark} />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="occ" name={`Ocupação ${occYear}`} fill="#8b5cf6" radius={[6, 6, 0, 0]}>
                        <LabelList dataKey="occ" position="top" formatter={(v: number) => v > 0 ? `${v.toFixed(0)}%` : ''} style={{ fontSize: 10, fontWeight: 700, fill: textSub }} />
                      </Bar>
                      <Line dataKey="prevOcc" name={`Ocupação ${occYear - 1}`} stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                  </div>
                </div>

                {/* Receita + ADR mensal */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '1.25rem 1.5rem', borderBottom: `1px solid ${cardBdr}`, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Receita de hospedagem e ADR — {occYear}</h3>
                    <span style={{ fontSize: 12, color: textSub, fontWeight: 600 }}>mensal</span>
                  </div>
                  <div style={{ padding: '1.25rem 1.5rem 1.5rem' }}>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={monthlyOcc}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="month" tick={{ fontSize: 12, fill: textSub }} />
                      <YAxis yAxisId="rev" tick={{ fontSize: 11, fill: textSub }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                      <YAxis yAxisId="adr" orientation="right" tick={{ fontSize: 11, fill: textSub }} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
                      <Tooltip content={<ChartTooltip isDark={isDark} />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar yAxisId="rev" dataKey="revenue" name="Receita" fill="#10b981" radius={[6, 6, 0, 0]} />
                      <Line yAxisId="adr" dataKey="adr" name="ADR" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  </div>
                </div>

                {/* Tabela mensal */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '1.25rem 1.5rem', borderBottom: `1px solid ${cardBdr}`, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Resumo mensal — {occYear}</h3>
                    <span style={{ fontSize: 12, color: textSub, fontWeight: 600 }}>ocupação comparada com {occYear - 1}</span>
                  </div>
                  <div className="sv-scroll">
                    <table className="sv-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left'  }}>Mês</th>
                          <th style={{ textAlign: 'right' }}>Ocupação</th>
                          <th style={{ textAlign: 'right' }}>{occYear - 1}</th>
                          <th style={{ textAlign: 'right' }}>Diárias</th>
                          <th style={{ textAlign: 'right' }}>Receita</th>
                          <th style={{ textAlign: 'right' }}>ADR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyOcc.map(m => (
                          <tr key={m.month} className="sv-row">
                            <td style={{ fontWeight: 700 }}>{m.month}</td>
                            <td style={{ textAlign: 'right', fontWeight: 800, color: '#8b5cf6' }}>{m.occ.toFixed(1)}%</td>
                            <td style={{ textAlign: 'right', color: textSub }}>{m.prevOcc !== null ? `${m.prevOcc.toFixed(1)}%` : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{m.roomNights.toLocaleString('pt-BR')}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#10b981' }}>{fmtBRL(m.revenue)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtBRL(m.adr)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="sv-total">
                          <td>Ano</td>
                          <td style={{ textAlign: 'right', color: '#8b5cf6' }}>{yearAvgOcc.toFixed(1)}%</td>
                          <td />
                          <td style={{ textAlign: 'right' }}>{yearRoomNights.toLocaleString('pt-BR')}</td>
                          <td style={{ textAlign: 'right', color: '#10b981' }}>{fmtBRL(yearRevenue)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtBRL(yearADR)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
