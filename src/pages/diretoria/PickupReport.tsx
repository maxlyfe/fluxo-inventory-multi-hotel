// src/pages/diretoria/PickupReport.tsx
import React, { useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Plus, X, Search, Loader2,
  Users, BedDouble, DollarSign, CalendarRange, BarChart2, AlertCircle, ChevronDown,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { erbonService } from '../../lib/erbonService';
import { useHotel } from '../../context/HotelContext';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface HotelOption { id: string; name: string; code?: string | null; }

type Period = { id: string; label: string; from: string; to: string; color: string; };

interface PeriodMetrics {
  totalGuests: number;
  totalUHs: number;
  avgADR: number;
  avgPerGuest: number;
  totalRevenue: number;
  avgDailyRevenue: number;
  days: number;
  dailyRevenue: { date: string; revenue: number; uhs: number; adr: number }[];
}

// ── Constantes ───────────────────────────────────────────────────────────────

const PERIOD_COLORS = ['#0085ae', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444'];

function nextColor(periods: Period[]): string {
  return PERIOD_COLORS[periods.length % PERIOD_COLORS.length];
}

function parseGuests(raw: string): number {
  if (!raw) return 0;
  // Se for apenas um número, retorna ele
  if (/^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  
  // Tenta o formato "Adults:2,Children:1" ou "Adultos: 2"
  return raw.split(',').reduce((sum, part) => {
    const segments = part.split(':');
    const valStr = segments.length > 1 ? segments[1] : segments[0];
    const val = parseInt(valStr.trim() || '0', 10);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
}

function fmtBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

function fmtNum(value: number): string {
  return value.toLocaleString('pt-BR');
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y?.slice(2)}`;
}

// ── Fetch de métricas por período ────────────────────────────────────────────

async function fetchPeriodMetrics(hotelId: string, from: string, to: string): Promise<PeriodMetrics> {
  const [otb, occupancy] = await Promise.all([
    erbonService.fetchOTB(hotelId, from, to),
    erbonService.fetchOccupancyWithPension(hotelId, from, to),
  ]);

  const totalGuests = occupancy.reduce((s, d) => s + parseGuests(d.totalGuestByType), 0);
  
  // Soma todas as categorias de UH vendida para precisão total (conforme seasonHelper)
  const totalUHs = occupancy.reduce((s, d) => {
    const sold = (d.roomSalledConfirmed || 0) +
                 (d.roomSalledRateDefault || 0) +
                 (d.roomSalledPending || 0) +
                 (d.roomSalledInvited || 0) +
                 (d.roomSalledHouseUse || 0) +
                 (d.roomSalledPermut || 0) +
                 (d.roomSalledCrewMember || 0) +
                 (d.roomSalledDayUse || 0);
    return s + sold;
  }, 0);

  const totalRevenue = occupancy.reduce((s, d) => s + (d.totalRevenue ?? 0), 0);
  const totalNetRevenue = otb.reduce((s, d) => s + (d.netRoomRevenueTransient ?? 0), 0);
  const avgADR = totalUHs > 0 ? totalNetRevenue / totalUHs : 0;
  const avgPerGuest = totalGuests > 0 ? totalRevenue / totalGuests : 0;
  const avgDailyRevenue = occupancy.length > 0 ? totalRevenue / occupancy.length : 0;

  const dailyRevenue = occupancy.map(d => {
    const sold = (d.roomSalledConfirmed || 0) +
                 (d.roomSalledRateDefault || 0) +
                 (d.roomSalledPending || 0) +
                 (d.roomSalledInvited || 0) +
                 (d.roomSalledHouseUse || 0) +
                 (d.roomSalledPermut || 0) +
                 (d.roomSalledCrewMember || 0) +
                 (d.roomSalledDayUse || 0);
    return {
      date: d.date,
      revenue: d.totalRevenue ?? 0,
      uhs: sold,
      adr: d.adr ?? 0,
    };
  });

  return { totalGuests, totalUHs, avgADR, avgPerGuest, totalRevenue, avgDailyRevenue, days: occupancy.length, dailyRevenue };
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function TrendBadge({ value, base }: { value: number; base: number }) {
  if (base === 0) return null;
  const pct = ((value - base) / base) * 100;
  const up = pct > 0.5;
  const down = pct < -0.5;
  const color = up ? '#22c55e' : down ? '#ef4444' : '#94a3b8';
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color, background: `${color}18`, borderRadius: 6, padding: '2px 6px' }}>
      <Icon size={11} />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  subValue?: string;
}

function MetricCard({ label, value, icon, color, subValue }: MetricCardProps) {
  return (
    <div style={{
      background: 'rgba(30,41,59,0.7)',
      border: '1px solid rgba(148,163,184,0.12)',
      borderRadius: 16,
      padding: '1.1rem 1.3rem',
      display: 'flex', flexDirection: 'column', gap: 6,
      backdropFilter: 'blur(12px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(148,163,184,0.8)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: 'clamp(1.3rem, 3vw, 1.7rem)', fontWeight: 800, color: '#f1f5f9', lineHeight: 1.1 }}>{value}</div>
      {subValue && <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.6)' }}>{subValue}</div>}
    </div>
  );
}

const DARK_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'rgba(15,23,42,0.96)',
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 10,
  padding: '8px 12px',
  fontSize: 12,
  color: '#f1f5f9',
};

function CustomTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={DARK_TOOLTIP_STYLE}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#94a3b8', fontSize: 11 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ color: '#cbd5e1' }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: p.color }}>{formatter ? formatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function PickupReport() {
  const { selectedHotel } = useHotel();

  const [hotels, setHotels] = useState<HotelOption[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string>(selectedHotel?.id ?? '');

  const [periods, setPeriods] = useState<Period[]>([
    { id: 'p1', label: 'Período 1', from: '', to: '', color: PERIOD_COLORS[0] },
  ]);
  const [view, setView] = useState<'individual' | 'comparativo'>('individual');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Map<string, PeriodMetrics>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [globalError, setGlobalError] = useState('');

  // ── Carregar hotéis ──
  useEffect(() => {
    supabase.from('hotels').select('id, name, code').order('name').then(({ data }) => {
      setHotels(data ?? []);
      if (!selectedHotelId && data?.length) setSelectedHotelId(data[0].id);
    });
  }, []);

  // ── Período helpers ──
  function addPeriod() {
    if (periods.length >= 5) return;
    const n = periods.length + 1;
    setPeriods(prev => [...prev, { id: `p${Date.now()}`, label: `Período ${n}`, from: '', to: '', color: nextColor(prev) }]);
  }

  function removePeriod(id: string) {
    setPeriods(prev => prev.filter(p => p.id !== id));
    setResults(prev => { const m = new Map(prev); m.delete(id); return m; });
    setErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
  }

  function updatePeriod(id: string, field: keyof Period, value: string) {
    setPeriods(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }

  const canSearch = selectedHotelId && periods.every(p => p.from && p.to && p.from <= p.to);

  // ── Buscar dados ──
  async function handleSearch() {
    if (!canSearch) return;
    setLoading(true);
    setGlobalError('');
    setErrors(new Map());
    const newResults = new Map<string, PeriodMetrics>();
    const newErrors = new Map<string, string>();

    await Promise.all(periods.map(async (p) => {
      try {
        const metrics = await fetchPeriodMetrics(selectedHotelId, p.from, p.to);
        newResults.set(p.id, metrics);
      } catch (err: any) {
        newErrors.set(p.id, err.message || 'Erro ao buscar dados');
      }
    }));

    setResults(newResults);
    setErrors(newErrors);
    if (newResults.size === 0) setGlobalError('Nenhum dado retornado. Verifique se o hotel possui integração Erbon configurada.');
    setLoading(false);
  }

  const hasResults = results.size > 0;
  const periodsWithResults = periods.filter(p => results.has(p.id));

  // ── Dados para gráficos ──
  const adrChartData = periodsWithResults.map(p => ({
    name: p.label,
    ADR: parseFloat((results.get(p.id)!.avgADR).toFixed(2)),
    color: p.color,
  }));

  const uhsChartData = periodsWithResults.map(p => ({
    name: p.label,
    UHs: results.get(p.id)!.totalUHs,
    color: p.color,
  }));

  const revenueChartData = (() => {
    if (!periodsWithResults.length) return [];
    const maxDays = Math.max(...periodsWithResults.map(p => results.get(p.id)!.dailyRevenue.length));
    return Array.from({ length: maxDays }, (_, i) => {
      const row: Record<string, any> = { day: `Dia ${i + 1}` };
      periodsWithResults.forEach(p => {
        const day = results.get(p.id)!.dailyRevenue[i];
        row[p.label] = day?.revenue ?? null;
      });
      return row;
    });
  })();

  const base = periodsWithResults.length > 0 ? results.get(periodsWithResults[0].id) : undefined;

  // ── Render ──
  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#f1f5f9' }}>
      <style>{`
        .pickup-period-card { transition: box-shadow 0.2s; }
        .pickup-period-card:hover { box-shadow: 0 0 0 1px rgba(148,163,184,0.2), 0 4px 16px rgba(0,0,0,0.4); }
        .pickup-hotel-select { appearance: none; -webkit-appearance: none; background-image: none; }
        .pickup-tab { transition: all 0.2s; cursor: pointer; }
        .pickup-tab:hover { background: rgba(148,163,184,0.08); }
        .pickup-search-btn { transition: all 0.18s; }
        .pickup-search-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
        .pickup-search-btn:active:not(:disabled) { transform: translateY(0); }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom: '1px solid rgba(148,163,184,0.1)', padding: '1.5rem 2rem', background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(16px)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #0085ae, #0059a8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TrendingUp size={22} color="#fff" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 'clamp(1.1rem, 3vw, 1.5rem)', fontWeight: 800, color: '#f1f5f9', letterSpacing: -0.3 }}>Pick-up</h1>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b', fontWeight: 500 }}>Análise comparativa de períodos</p>
            </div>
          </div>

          {/* Hotel selector */}
          <div style={{ position: 'relative', minWidth: 220 }}>
            <select
              className="pickup-hotel-select"
              value={selectedHotelId}
              onChange={e => setSelectedHotelId(e.target.value)}
              style={{
                width: '100%', padding: '0.55rem 2.5rem 0.55rem 0.9rem',
                background: 'rgba(30,41,59,0.9)', border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: 10, color: '#f1f5f9', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="" disabled>Selecionar hotel</option>
              {hotels.map(h => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <ChevronDown size={14} color="#64748b" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* ── Bloco de períodos ── */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Períodos de análise</h2>
            {periods.length < 5 && (
              <button
                onClick={addPeriod}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '0.45rem 1rem',
                  background: 'rgba(0,133,174,0.15)', border: '1px solid rgba(0,133,174,0.35)',
                  borderRadius: 8, color: '#0085ae', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <Plus size={15} /> Adicionar período
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: '1rem' }}>
            {periods.map((p) => (
              <div key={p.id} className="pickup-period-card" style={{
                background: 'rgba(15,23,42,0.7)',
                border: `1px solid rgba(148,163,184,0.12)`,
                borderLeft: `4px solid ${p.color}`,
                borderRadius: 14,
                padding: '1.1rem 1.3rem',
                position: 'relative',
              }}>
                {periods.length > 1 && (
                  <button
                    onClick={() => removePeriod(p.id)}
                    style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: 6, padding: 4, cursor: 'pointer', display: 'flex' }}
                  >
                    <X size={14} color="#ef4444" />
                  </button>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  <input
                    type="text"
                    value={p.label}
                    onChange={e => updatePeriod(p.id, 'label', e.target.value)}
                    style={{
                      background: 'transparent', border: 'none', outline: 'none',
                      color: '#f1f5f9', fontSize: 13, fontWeight: 700, width: '100%',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>De</label>
                    <input
                      type="date"
                      value={p.from}
                      onChange={e => updatePeriod(p.id, 'from', e.target.value)}
                      style={{
                        width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.7rem',
                        background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(148,163,184,0.2)',
                        borderRadius: 8, color: '#f1f5f9', fontSize: 12, outline: 'none',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Até</label>
                    <input
                      type="date"
                      value={p.to}
                      min={p.from}
                      onChange={e => updatePeriod(p.id, 'to', e.target.value)}
                      style={{
                        width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.7rem',
                        background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(148,163,184,0.2)',
                        borderRadius: 8, color: '#f1f5f9', fontSize: 12, outline: 'none',
                      }}
                    />
                  </div>
                </div>

                {errors.has(p.id) && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', color: '#fca5a5', fontSize: 11 }}>
                    <AlertCircle size={13} color="#ef4444" />
                    {errors.get(p.id)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Botão buscar */}
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center' }}>
            <button
              className="pickup-search-btn"
              onClick={handleSearch}
              disabled={!canSearch || loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '0.8rem 2.5rem', borderRadius: 50, border: 'none',
                background: canSearch && !loading ? 'linear-gradient(135deg, #0085ae, #0059a8)' : 'rgba(0,133,174,0.3)',
                color: '#fff', fontWeight: 700, fontSize: '1rem', cursor: canSearch && !loading ? 'pointer' : 'not-allowed',
                boxShadow: canSearch && !loading ? '0 4px 20px rgba(0,133,174,0.4)' : 'none',
                opacity: !canSearch ? 0.5 : 1,
              }}
            >
              {loading
                ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Buscando...</>
                : <><Search size={18} /> Buscar Pick-up</>
              }
            </button>
          </div>
        </div>

        {/* ── Erro global ── */}
        {globalError && (
          <div style={{ marginBottom: '1.5rem', display: 'flex', gap: 10, alignItems: 'center', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '0.9rem 1.2rem', color: '#fca5a5' }}>
            <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
            {globalError}
          </div>
        )}

        {/* ── Resultados ── */}
        {hasResults && (
          <>
            {/* Toggle view */}
            <div style={{ display: 'flex', gap: 4, background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 12, padding: 4, width: 'fit-content', marginBottom: '1.5rem' }}>
              {(['individual', 'comparativo'] as const).map(v => (
                <button
                  key={v}
                  className="pickup-tab"
                  onClick={() => setView(v)}
                  style={{
                    padding: '0.5rem 1.2rem', borderRadius: 9, border: 'none',
                    background: view === v ? 'rgba(0,133,174,0.9)' : 'transparent',
                    color: view === v ? '#fff' : '#94a3b8',
                    fontWeight: 600, fontSize: 13, textTransform: 'capitalize',
                  }}
                >
                  {v === 'individual' ? 'Individual' : 'Comparativo'}
                </button>
              ))}
            </div>

            {/* ── View Individual ── */}
            {view === 'individual' && periodsWithResults.map((p) => {
              const m = results.get(p.id)!;
              return (
                <div key={p.id} style={{ marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                    <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#f1f5f9' }}>{p.label}</h3>
                    <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{fmtDate(p.from)} – {fmtDate(p.to)}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: '0.9rem' }}>
                    <MetricCard label="Hóspedes" value={fmtNum(m.totalGuests)} icon={<Users size={14} />} color={p.color} subValue="atendidos no período" />
                    <MetricCard label="UHs Vendidas" value={fmtNum(m.totalUHs)} icon={<BedDouble size={14} />} color={p.color} subValue="quartos ocupados" />
                    <MetricCard label="ADR Médio" value={fmtBRL(m.avgADR)} icon={<BarChart2 size={14} />} color={p.color} subValue="receita líq. / UH" />
                    <MetricCard label="Valor Médio / Hóspede" value={fmtBRL(m.avgPerGuest)} icon={<DollarSign size={14} />} color={p.color} subValue="receita total / hóspedes" />
                    <MetricCard label="Total do Período" value={fmtBRL(m.totalRevenue)} icon={<TrendingUp size={14} />} color={p.color} subValue={`${m.days} dias`} />
                    <MetricCard label="Média Diária" value={fmtBRL(m.avgDailyRevenue)} icon={<CalendarRange size={14} />} color={p.color} subValue="receita / dia" />
                    <MetricCard label="Dias Analisados" value={fmtNum(m.days)} icon={<CalendarRange size={14} />} color={p.color} subValue={`${fmtDate(p.from)} a ${fmtDate(p.to)}`} />
                  </div>
                </div>
              );
            })}

            {/* ── View Comparativo ── */}
            {view === 'comparativo' && periodsWithResults.length >= 1 && (
              <>
                {/* Tabela comparativa */}
                <div style={{ overflowX: 'auto', marginBottom: '2rem', borderRadius: 16, border: '1px solid rgba(148,163,184,0.12)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'rgba(15,23,42,0.9)', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
                        <th style={{ padding: '1rem 1.3rem', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, whiteSpace: 'nowrap' }}>Métrica</th>
                        {periodsWithResults.map(p => (
                          <th key={p.id} style={{ padding: '1rem 1.3rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                              <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{p.label}</span>
                            </div>
                            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 400, marginTop: 2 }}>{fmtDate(p.from)} – {fmtDate(p.to)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        { key: 'totalGuests',    label: 'Hóspedes',              fmt: fmtNum,  icon: <Users size={13} /> },
                        { key: 'totalUHs',       label: 'UHs Vendidas',          fmt: fmtNum,  icon: <BedDouble size={13} /> },
                        { key: 'avgADR',         label: 'ADR Médio',             fmt: fmtBRL,  icon: <BarChart2 size={13} /> },
                        { key: 'avgPerGuest',    label: 'Valor Médio/Hóspede',   fmt: fmtBRL,  icon: <DollarSign size={13} /> },
                        { key: 'totalRevenue',   label: 'Valor Total do Período', fmt: fmtBRL, icon: <TrendingUp size={13} /> },
                        { key: 'avgDailyRevenue',label: 'Média Diária',          fmt: fmtBRL,  icon: <CalendarRange size={13} /> },
                        { key: 'days',           label: 'Dias Analisados',       fmt: fmtNum,  icon: <CalendarRange size={13} /> },
                      ] as { key: keyof PeriodMetrics; label: string; fmt: (v: number) => string; icon: React.ReactNode }[]).map((row, ri) => (
                        <tr key={row.key} style={{ background: ri % 2 === 0 ? 'rgba(15,23,42,0.5)' : 'rgba(30,41,59,0.3)', borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                          <td style={{ padding: '0.85rem 1.3rem', color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                            <span style={{ color: '#64748b' }}>{row.icon}</span>
                            {row.label}
                          </td>
                          {periodsWithResults.map((p, pi) => {
                            const m = results.get(p.id)!;
                            const v = m[row.key] as number;
                            const baseVal = pi > 0 && base ? (base[row.key] as number) : 0;
                            return (
                              <td key={p.id} style={{ padding: '0.85rem 1.3rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                                  <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>{row.fmt(v)}</span>
                                  {pi > 0 && <TrendBadge value={v} base={baseVal} />}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Gráficos */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>

                  {/* ADR por período */}
                  <div style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 18, padding: '1.5rem' }}>
                    <h4 style={{ margin: '0 0 1.2rem', fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.7 }}>ADR por Período</h4>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={adrChartData} barSize={42}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={v => `R$${v}`} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={70} />
                        <Tooltip content={<CustomTooltip formatter={fmtBRL} />} />
                        <Bar dataKey="ADR" radius={[8, 8, 0, 0]}>
                          {adrChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                          <LabelList dataKey="ADR" position="top" formatter={(v: number) => `R$${v.toFixed(0)}`} style={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* UHs por período */}
                  <div style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 18, padding: '1.5rem' }}>
                    <h4 style={{ margin: '0 0 1.2rem', fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.7 }}>UHs Vendidas por Período</h4>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={uhsChartData} barSize={42}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                        <Tooltip content={<CustomTooltip formatter={fmtNum} />} />
                        <Bar dataKey="UHs" radius={[8, 8, 0, 0]}>
                          {uhsChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                          <LabelList dataKey="UHs" position="top" style={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Gráfico de receita diária */}
                {revenueChartData.length > 0 && (
                  <div style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 18, padding: '1.5rem', marginBottom: '2rem' }}>
                    <h4 style={{ margin: '0 0 1.2rem', fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.7 }}>Receita Diária por Período</h4>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={revenueChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" vertical={false} />
                        <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={60} />
                        <Tooltip content={<CustomTooltip formatter={fmtBRL} />} />
                        <Legend wrapperStyle={{ paddingTop: 12, fontSize: 12, color: '#94a3b8' }} />
                        {periodsWithResults.map(p => (
                          <Line
                            key={p.id}
                            type="monotone"
                            dataKey={p.label}
                            stroke={p.color}
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 5, fill: p.color, strokeWidth: 0 }}
                            connectNulls={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
