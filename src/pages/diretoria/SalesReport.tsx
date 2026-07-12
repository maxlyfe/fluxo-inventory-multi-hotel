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
  total: number;     // receita de hospedagem da reserva
  channel: string;
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

/**
 * Erbon: /hospedagem devolve uma linha por reserva por dia. Buscamos com folga
 * de 60 dias em cada ponta para que reservas que atravessam o período tenham
 * todas as suas diárias somadas, e agrupamos por iD_RESERVA.
 */
async function loadErbonBookings(hotelId: string, from: string, to: string): Promise<UnifiedBooking[]> {
  const rows = await erbonService.fetchHospedagem(hotelId, addDaysStr(from, -60), addDaysStr(to, 60));
  const byRes = new Map<number, { checkin: string; checkout: string; total: number; channel: string }>();
  for (const r of rows) {
    if (r.status === 'CANCELED') continue;
    const cur = byRes.get(r.iD_RESERVA);
    const checkin  = String(r.datA_ENTRADA ?? '').split('T')[0];
    const checkout = String(r.datA_SAIDA   ?? '').split('T')[0];
    if (cur) {
      cur.total += Number(r.diaria) || 0;
    } else {
      byRes.set(r.iD_RESERVA, {
        checkin, checkout,
        total: Number(r.diaria) || 0,
        channel: r.canal || r.agente || 'Direto',
      });
    }
  }
  return Array.from(byRes.entries()).map(([id, b]) => ({
    id: String(id),
    checkin: b.checkin,
    checkout: b.checkout,
    nights: nightsBetween(b.checkin, b.checkout),
    total: b.total,
    channel: b.channel,
    origin: 'erbon' as const,
  }));
}

/** Sem Erbon: reservas próprias + Omnibees gravadas em internal_bookings. */
async function loadInternalBookings(hotelId: string, from: string, to: string): Promise<UnifiedBooking[]> {
  const { data, error } = await supabase
    .from('internal_bookings')
    .select('id, checkin, checkout, total_rate, status, source, channel')
    .eq('hotel_id', hotelId)
    .neq('status', 'cancelled')
    .gte('checkout', addDaysStr(from, -60))
    .lte('checkin', addDaysStr(to, 60));
  if (error) throw error;
  return (data ?? []).map((b: any) => ({
    id: b.id,
    checkin: b.checkin,
    checkout: b.checkout,
    nights: nightsBetween(b.checkin, b.checkout),
    total: Number(b.total_rate) || 0,
    channel: b.channel || (b.source === 'omnibees' ? 'Omnibees' : 'Direto'),
    origin: (b.source === 'omnibees' ? 'omnibees' : 'internal') as UnifiedBooking['origin'],
  }));
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

async function loadErbonOccupancy(hotelId: string, year: number): Promise<{ occ: number[]; roomNights: number[]; revenue: number[] }> {
  const occ = Array(12).fill(0) as number[];
  const cnt = Array(12).fill(0) as number[];
  const roomNights = Array(12).fill(0) as number[];
  const revenue = Array(12).fill(0) as number[];
  const data = await erbonService.fetchOccupancyWithPension(hotelId, `${year}-01-01`, `${year}-12-31`);
  for (const d of data) {
    const day = String(d.date).split('T')[0];
    const m = Number(day.split('-')[1]) - 1;
    if (m < 0 || m > 11) continue;
    occ[m] += d.occupancy ?? 0;
    cnt[m]++;
    roomNights[m] += d.roomSalledConfirmed ?? 0;
    revenue[m]    += d.totalDailyRate ?? 0;
  }
  return { occ: occ.map((s, i) => (cnt[i] ? s / cnt[i] : 0)), roomNights, revenue };
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

  // Período das abas de vendas (padrão: mês corrente)
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo,   setDateTo]   = useState(monthEnd());

  // Ano do dashboard de ocupação
  const [occYear, setOccYear] = useState<number>(() => new Date().getFullYear());

  const [bookings,   setBookings]   = useState<UnifiedBooking[]>([]);
  const [monthlyOcc, setMonthlyOcc] = useState<MonthOcc[]>([]);

  // ── Resolução da fonte + carga de reservas ─────────────────────────────────

  const loadBookings = useCallback(async (hId: string, from: string, to: string) => {
    const cfg = await erbonService.getConfig(hId).catch(() => null);
    if (cfg && (cfg as any).is_active) {
      setSource('erbon');
      setHasOmnibees(false);
      return await loadErbonBookings(hId, from, to);
    }
    const list = await loadInternalBookings(hId, from, to);
    setSource('internal');
    setHasOmnibees(list.some(b => b.origin === 'omnibees'));
    return list;
  }, []);

  useEffect(() => {
    if (!hotelId || activeTab === 'occupancy') return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const list = await loadBookings(hotelId, dateFrom, dateTo);
        if (!cancelled) setBookings(list);
      } catch (e: any) {
        if (!cancelled) setError('Erro ao carregar reservas: ' + e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hotelId, dateFrom, dateTo, activeTab, loadBookings]);

  // ── Carga da ocupação ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!hotelId || activeTab !== 'occupancy') return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const cfg = await erbonService.getConfig(hotelId).catch(() => null);
        const isErbon = !!(cfg && (cfg as any).is_active);
        setSource(isErbon ? 'erbon' : 'internal');

        const loader = isErbon ? loadErbonOccupancy : loadInternalOccupancy;
        const [curr, prev] = await Promise.all([
          loader(hotelId, occYear),
          loader(hotelId, occYear - 1).catch(() => null),
        ]);
        if (cancelled) return;
        setMonthlyOcc(MONTH_LABELS.map((label, i) => ({
          month: label,
          occ:        Number(curr.occ[i].toFixed(1)),
          prevOcc:    prev ? Number(prev.occ[i].toFixed(1)) : null,
          roomNights: curr.roomNights[i],
          revenue:    curr.revenue[i],
          adr:        curr.roomNights[i] > 0 ? curr.revenue[i] / curr.roomNights[i] : 0,
        })));
      } catch (e: any) {
        if (!cancelled) setError('Erro ao carregar ocupação: ' + e.message);
      } finally {
        if (!cancelled) setLoading(false);
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

  // Canais do período (reservas cuja data-chave cai no período)
  const chanMap = new Map<string, { count: number; revenue: number }>();
  for (const b of bookings) {
    const d = b[dateKey];
    if (!d || d < dateFrom || d > dateTo) continue;
    const cur = chanMap.get(b.channel) ?? { count: 0, revenue: 0 };
    chanMap.set(b.channel, { count: cur.count + 1, revenue: cur.revenue + b.total });
  }
  const channels = Array.from(chanMap.entries())
    .map(([channel, v]) => ({ channel, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

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
        { label: 'Reservas',        val: totCount.toLocaleString('pt-BR'),  icon: <Users size={18} />,      color: '#0ea5e9' },
        { label: 'Noites vendidas', val: totNights.toLocaleString('pt-BR'), icon: <BedDouble size={18} />,  color: '#8b5cf6' },
        { label: 'Receita',         val: fmtBRL(totRevenue),                icon: <DollarSign size={18} />, color: '#10b981' },
        { label: 'ADR médio',       val: fmtBRL(avgADR),                    icon: <BarChart2 size={18} />,  color: '#f59e0b' },
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

            {/* Badge da fonte de dados */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.9rem', background: isDark ? 'rgba(30,41,59,0.6)' : '#f1f5f9', borderRadius: 10, fontSize: 12, fontWeight: 700, color: sourceBadge.color, border: `1px solid ${sourceBadge.color}30` }}>
              <Database size={13} />
              Fonte: {sourceBadge.label}
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
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, padding: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem', fontSize: 14, fontWeight: 800 }}>
                    Receita por data de {activeTab === 'checkin' ? 'check-in' : 'check-out'}
                  </h3>
                  {buckets.length === 0 ? (
                    <p style={{ color: textSub, fontSize: 13, padding: '2rem', textAlign: 'center' }}>Nenhuma reserva no período selecionado.</p>
                  ) : (
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
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
                  {/* Tabela por dia */}
                  <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, padding: '1.5rem', overflowX: 'auto' }}>
                    <h3 style={{ margin: '0 0 1rem', fontSize: 14, fontWeight: 800 }}>
                      Detalhe por data de {activeTab === 'checkin' ? 'check-in' : 'check-out'}
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: textMute, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          <th style={{ textAlign: 'left',  padding: '0.5rem' }}>Data</th>
                          <th style={{ textAlign: 'right', padding: '0.5rem' }}>Reservas</th>
                          <th style={{ textAlign: 'right', padding: '0.5rem' }}>Noites</th>
                          <th style={{ textAlign: 'right', padding: '0.5rem' }}>Receita</th>
                          <th style={{ textAlign: 'right', padding: '0.5rem' }}>ADR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buckets.map(b => (
                          <tr key={b.date} className="sv-row" style={{ borderTop: `1px solid ${cardBdr}` }}>
                            <td style={{ padding: '0.55rem 0.5rem', fontWeight: 700 }}>{fmtFullDate(b.date)}</td>
                            <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right' }}>{b.count}</td>
                            <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right' }}>{b.nights}</td>
                            <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', fontWeight: 700, color: '#10b981' }}>{fmtBRL(b.revenue)}</td>
                            <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right' }}>{fmtBRL(b.adr)}</td>
                          </tr>
                        ))}
                        {buckets.length > 0 && (
                          <tr style={{ borderTop: `2px solid ${cardBdr}`, fontWeight: 900 }}>
                            <td style={{ padding: '0.55rem 0.5rem' }}>Total</td>
                            <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right' }}>{totCount}</td>
                            <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right' }}>{totNights}</td>
                            <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', color: '#10b981' }}>{fmtBRL(totRevenue)}</td>
                            <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right' }}>{fmtBRL(avgADR)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Canais */}
                  <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, padding: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 1rem', fontSize: 14, fontWeight: 800 }}>Por canal de venda</h3>
                    {channels.length === 0 ? (
                      <p style={{ color: textSub, fontSize: 13, padding: '1rem', textAlign: 'center' }}>Sem dados no período.</p>
                    ) : channels.map(c => {
                      const pct = totRevenue > 0 ? (c.revenue / totRevenue) * 100 : 0;
                      return (
                        <div key={c.channel} style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>
                            <span>{c.channel} <span style={{ color: textMute, fontWeight: 500 }}>({c.count})</span></span>
                            <span style={{ color: '#10b981' }}>{fmtBRL(c.revenue)}</span>
                          </div>
                          <div style={{ height: 7, borderRadius: 4, background: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(203,213,225,0.4)' }}>
                            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #10b981, #0ea5e9)' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── Dashboard de ocupação ── */}
            {activeTab === 'occupancy' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Ocupação mensal (com comparação ano anterior) */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, padding: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem', fontSize: 14, fontWeight: 800 }}>
                    Ocupação mensal {occYear} <span style={{ color: textMute, fontWeight: 500 }}>vs {occYear - 1}</span>
                  </h3>
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

                {/* Receita + ADR mensal */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, padding: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem', fontSize: 14, fontWeight: 800 }}>Receita de hospedagem e ADR por mês — {occYear}</h3>
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

                {/* Tabela mensal */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 20, padding: '1.5rem', overflowX: 'auto' }}>
                  <h3 style={{ margin: '0 0 1rem', fontSize: 14, fontWeight: 800 }}>Resumo mensal — {occYear}</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: textMute, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        <th style={{ textAlign: 'left',  padding: '0.5rem' }}>Mês</th>
                        <th style={{ textAlign: 'right', padding: '0.5rem' }}>Ocupação</th>
                        <th style={{ textAlign: 'right', padding: '0.5rem' }}>{occYear - 1}</th>
                        <th style={{ textAlign: 'right', padding: '0.5rem' }}>Diárias</th>
                        <th style={{ textAlign: 'right', padding: '0.5rem' }}>Receita</th>
                        <th style={{ textAlign: 'right', padding: '0.5rem' }}>ADR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyOcc.map(m => (
                        <tr key={m.month} className="sv-row" style={{ borderTop: `1px solid ${cardBdr}` }}>
                          <td style={{ padding: '0.55rem 0.5rem', fontWeight: 700 }}>{m.month}</td>
                          <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', fontWeight: 800, color: '#8b5cf6' }}>{m.occ.toFixed(1)}%</td>
                          <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', color: textSub }}>{m.prevOcc !== null ? `${m.prevOcc.toFixed(1)}%` : '—'}</td>
                          <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right' }}>{m.roomNights.toLocaleString('pt-BR')}</td>
                          <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', fontWeight: 700, color: '#10b981' }}>{fmtBRL(m.revenue)}</td>
                          <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right' }}>{fmtBRL(m.adr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
