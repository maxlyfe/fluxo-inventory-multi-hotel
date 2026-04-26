// src/pages/diretoria/PickupReport.tsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
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
import { useTheme } from '../../context/ThemeContext';

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

const PERIOD_COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#f43f5e'];

function nextColor(periods: Period[]): string {
  return PERIOD_COLORS[periods.length % PERIOD_COLORS.length];
}

function parseGuests(raw: string): number {
  if (!raw) return 0;
  if (/^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
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
    return { date: d.date, revenue: d.totalRevenue ?? 0, uhs: sold, adr: d.adr ?? 0 };
  });

  return { totalGuests, totalUHs, avgADR, avgPerGuest, totalRevenue, avgDailyRevenue, days: occupancy.length, dailyRevenue };
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function TrendBadgeCompact({ value, base, color, isDark }: { value: number; base: number; color: string; isDark: boolean }) {
  if (base === 0) return null;
  const pct = ((value - base) / base) * 100;
  const up = pct > 0.01;
  const down = pct < -0.01;
  const statusColor = up ? '#10b981' : down ? '#f43f5e' : isDark ? '#94a3b8' : '#64748b';
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  
  return (
    <span style={{ 
      display: 'inline-flex', alignItems: 'center', gap: 2, 
      fontSize: 9, fontWeight: 700, color: statusColor, 
      padding: '0 4px',
      borderLeft: `2px solid ${color}`,
      transition: 'all 0.3s ease'
    }}>
      <Icon size={8} />
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function MetricCard({ label, value, icon, color, subValue, isDark }: { label: string; value: string; icon: React.ReactNode; color: string; subValue?: string; isDark: boolean }) {
  return (
    <div style={{
      background: isDark 
        ? 'linear-gradient(135deg, rgba(30,41,59,0.7) 0%, rgba(15,23,42,0.8) 100%)'
        : 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(241,245,249,1) 100%)',
      border: isDark ? '1px solid rgba(148,163,184,0.12)' : '1px solid rgba(203,213,225,0.5)',
      borderRadius: 20, padding: '1.25rem',
      display: 'flex', flexDirection: 'column', gap: 8, backdropFilter: 'blur(16px)',
      boxShadow: isDark ? '0 10px 25px -5px rgba(0,0,0,0.3)' : '0 10px 15px -3px rgba(148,163,184,0.1)',
    }}>
      <div style={{ 
        display: 'flex', alignItems: 'center', gap: 10, 
        color: isDark ? 'rgba(148,163,184,0.7)' : 'rgba(71,85,105,0.8)', 
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 
      }}>
        <div style={{ background: `${color}15`, padding: 8, borderRadius: 10, color }}>{icon}</div>
        {label}
      </div>
      <div style={{ fontSize: '1.75rem', fontWeight: 900, color: isDark ? '#f8fafc' : '#1e293b', letterSpacing: -0.5, marginTop: 4 }}>{value}</div>
      {subValue && <div style={{ fontSize: 11, color: isDark ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.6)', fontWeight: 500 }}>{subValue}</div>}
    </div>
  );
}

function CustomTooltip({ active, payload, label, formatter, isDark }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ 
      background: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.98)', 
      border: `1px solid ${isDark ? 'rgba(148,163,184,0.2)' : 'rgba(203,213,225,0.8)'}`, 
      borderRadius: 12, padding: '10px 14px', fontSize: 12, 
      color: isDark ? '#f1f5f9' : '#1e293b', 
      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.2)' 
    }}>
      <div style={{ fontWeight: 800, marginBottom: 8, color: isDark ? '#94a3b8' : '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
          <span style={{ color: isDark ? '#cbd5e1' : '#475569' }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: p.color }}>{formatter ? formatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function PickupReport() {
  const { selectedHotel } = useHotel();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [hotels, setHotels] = useState<HotelOption[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string>(selectedHotel?.id ?? '');
  const [periods, setPeriods] = useState<Period[]>([
    { id: 'p1', label: 'Período 1', from: '', to: '', color: PERIOD_COLORS[0] },
  ]);
  const [view, setView] = useState<'individual' | 'comparativo'>('individual');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Map<string, PeriodMetrics>>(new Map());
  const [globalError, setGlobalError] = useState('');

  // Estados para iluminação tecnológica
  const [activeCell, setActiveCell] = useState<{ periodId: string; metricKey: string } | null>(null);

  useEffect(() => {
    supabase.from('hotels').select('id, name, code').order('name').then(({ data }) => {
      setHotels(data ?? []);
      if (!selectedHotelId && data?.length) setSelectedHotelId(data[0].id);
    });
  }, []);

  function addPeriod() {
    if (periods.length >= 5) return;
    setPeriods(prev => [...prev, { id: `p${Date.now()}`, label: `Período ${prev.length + 1}`, from: '', to: '', color: nextColor(prev) }]);
  }
  function removePeriod(id: string) {
    setPeriods(prev => prev.filter(p => p.id !== id));
    setResults(prev => { const m = new Map(prev); m.delete(id); return m; });
  }
  function updatePeriod(id: string, field: keyof Period, value: string) {
    setPeriods(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }

  async function handleSearch() {
    if (!selectedHotelId || !periods.every(p => p.from && p.to)) return;
    setLoading(true);
    setGlobalError('');
    const newResults = new Map<string, PeriodMetrics>();
    await Promise.all(periods.map(async (p) => {
      try {
        const metrics = await fetchPeriodMetrics(selectedHotelId, p.from, p.to);
        newResults.set(p.id, metrics);
      } catch (err: any) { console.error(err); }
    }));
    setResults(newResults);
    if (newResults.size === 0) setGlobalError('Erro ao buscar dados.');
    setLoading(false);
  }

  const periodsWithResults = periods.filter(p => results.has(p.id));
  
  const METRICS_LIST = useMemo(() => [
    { key: 'totalRevenue',   label: 'Receita Total', fmt: fmtBRL, icon: <TrendingUp size={14} /> },
    { key: 'totalUHs',       label: 'UHs Vendidas',  fmt: fmtNum, icon: <BedDouble size={14} /> },
    { key: 'avgADR',         label: 'ADR Médio',     fmt: fmtBRL, icon: <BarChart2 size={14} /> },
    { key: 'totalGuests',    label: 'Total Hóspedes', fmt: fmtNum, icon: <Users size={14} /> },
    { key: 'avgDailyRevenue',label: 'Média Diária',  fmt: fmtBRL, icon: <CalendarRange size={14} /> },
  ] as const, []);

  // Gráficos calculados dentro do componente
  const adrChartData = periodsWithResults.map(p => ({ 
    name: p.label, 
    ADR: parseFloat((results.get(p.id)!.avgADR).toFixed(2)), 
    color: p.color 
  }));

  const uhsChartData = periodsWithResults.map(p => ({ 
    name: p.label, 
    UHs: results.get(p.id)!.totalUHs, 
    color: p.color 
  }));

  const revenueChartData = (() => {
    if (!periodsWithResults.length) return [];
    const maxDays = Math.max(...periodsWithResults.map(p => results.get(p.id)!.dailyRevenue.length));
    return Array.from({ length: maxDays }, (_, i) => {
      const row: any = { day: `Dia ${i + 1}` };
      periodsWithResults.forEach(p => row[p.label] = results.get(p.id)!.dailyRevenue[i]?.revenue ?? null);
      return row;
    });
  })();

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: isDark ? '#020617' : '#f8fafc', 
      color: isDark ? '#f8fafc' : '#1e293b', 
      fontFamily: 'Inter, sans-serif',
      transition: 'background-color 0.3s ease'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .pickup-period-card { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .pickup-period-card:hover { transform: translateY(-4px); box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); border-color: ${isDark ? 'rgba(148,163,184,0.3)' : 'rgba(148,163,184,0.5)'} !important; }
        .pickup-hotel-select { appearance: none; -webkit-appearance: none; background-image: none; }
        .pickup-tab { transition: all 0.2s ease; cursor: pointer; }
        .pickup-search-btn { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .pickup-search-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-2px); box-shadow: 0 10px 20px -5px rgba(14,165,233,0.3); }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: ${isDark ? 'invert(0.8)' : 'none'}; cursor: pointer; }
        
        .matrix-cell { transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); border: 1px solid transparent; position: relative; overflow: hidden; }
        .cell-base-active { background: ${isDark ? 'rgba(14,165,233,0.1)' : 'rgba(14,165,233,0.05)'} !important; border-color: #0ea5e9 !important; box-shadow: 0 0 30px ${isDark ? 'rgba(14,165,233,0.2)' : 'rgba(14,165,233,0.1)'}; transform: scale(1.02); z-index: 10; }
        .cell-target-active { filter: ${isDark ? 'brightness(1.2)' : 'brightness(0.95)'}; z-index: 5; }
        .lighting-beam { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; transition: opacity 0.5s; background: linear-gradient(90deg, transparent, ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)'}, transparent); }
        .cell-target-active .lighting-beam { opacity: 1; animation: shine 2s infinite; }
        
        @keyframes shine { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${isDark ? 'rgba(148,163,184,0.08)' : 'rgba(203,213,225,0.5)'}`, padding: '1.25rem 2rem', background: isDark ? 'rgba(2,6,23,0.85)' : 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 8px 16px -4px rgba(14,165,233,0.4)' }}><TrendingUp size={24} color="#fff" /></div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, color: isDark ? '#f8fafc' : '#1e293b', letterSpacing: -0.8 }}>Relatório Pick-up</h1>
              <p style={{ margin: 0, fontSize: 13, color: isDark ? '#94a3b8' : '#64748b', fontWeight: 500 }}>Inteligência e performance hoteleira</p>
            </div>
          </div>
          <div style={{ position: 'relative', minWidth: 260 }}>
            <select className="pickup-hotel-select" value={selectedHotelId} onChange={e => setSelectedHotelId(e.target.value)} style={{ width: '100%', padding: '0.65rem 2.5rem 0.65rem 1rem', background: isDark ? 'rgba(30,41,59,0.5)' : '#fff', border: `1px solid ${isDark ? 'rgba(148,163,184,0.2)' : 'rgba(203,213,225,0.8)'}`, borderRadius: 12, color: isDark ? '#f1f5f9' : '#1e293b', fontSize: 14, fontWeight: 700 }}>
              <option value="" disabled>Selecione o hotel</option>
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <ChevronDown size={16} color={isDark ? '#94a3b8' : '#64748b'} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '2.5rem 2rem' }}>
        {/* Configuração de Períodos */}
        <div style={{ marginBottom: '3rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 800, color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.5 }}>Períodos de Análise</h2>
            {periods.length < 5 && <button onClick={addPeriod} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 1.2rem', background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.3)', borderRadius: 12, color: '#0ea5e9', fontSize: 14, fontWeight: 700 }}><Plus size={16} /> Adicionar</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))', gap: '1.5rem' }}>
            {periods.map(p => (
              <div key={p.id} className="pickup-period-card" style={{ background: isDark ? 'rgba(15,23,42,0.6)' : '#fff', border: `1px solid ${isDark ? 'rgba(148,163,184,0.1)' : 'rgba(203,213,225,0.5)'}`, borderLeft: `4px solid ${p.color}`, borderRadius: 20, padding: '1.5rem', position: 'relative', backdropFilter: 'blur(10px)' }}>
                {periods.length > 1 && <button onClick={() => removePeriod(p.id)} style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(244,63,94,0.1)', border: 'none', borderRadius: 8, padding: 6 }}><X size={16} color="#f43f5e" /></button>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 4, background: p.color }} />
                  <input type="text" value={p.label} onChange={e => updatePeriod(p.id, 'label', e.target.value)} style={{ background: 'transparent', border: 'none', outline: 'none', color: isDark ? '#f8fafc' : '#1e293b', fontSize: 15, fontWeight: 800, width: '100%' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, color: '#64748b', fontWeight: 800, marginBottom: 6, textTransform: 'uppercase' }}>Início</label>
                    <input type="date" value={p.from} onChange={e => updatePeriod(p.id, 'from', e.target.value)} style={{ width: '100%', padding: '0.65rem 0.8rem', background: isDark ? 'rgba(30,41,59,0.4)' : '#f1f5f9', border: `1px solid ${isDark ? 'rgba(148,163,184,0.15)' : 'rgba(203,213,225,0.8)'}`, borderRadius: 10, color: isDark ? '#f1f5f9' : '#1e293b', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, color: '#64748b', fontWeight: 800, marginBottom: 6, textTransform: 'uppercase' }}>Fim</label>
                    <input type="date" value={p.to} min={p.from} onChange={e => updatePeriod(p.id, 'to', e.target.value)} style={{ width: '100%', padding: '0.65rem 0.8rem', background: isDark ? 'rgba(30,41,59,0.4)' : '#f1f5f9', border: `1px solid ${isDark ? 'rgba(148,163,184,0.15)' : 'rgba(203,213,225,0.8)'}`, borderRadius: 10, color: isDark ? '#f1f5f9' : '#1e293b', fontSize: 13 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '2.5rem', display: 'flex', justifyContent: 'center' }}>
            <button className="pickup-search-btn" onClick={handleSearch} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '1rem 3.5rem', borderRadius: 16, border: 'none', background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: '#fff', fontWeight: 800, fontSize: '1.1rem', cursor: 'pointer', boxShadow: '0 10px 25px -5px rgba(14,165,233,0.4)' }}>
              {loading ? <><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Processando...</> : <><Search size={20} /> Analisar Performance</>}
            </button>
          </div>
        </div>

        {periodsWithResults.length > 0 && (
          <div style={{ animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', gap: 6, background: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.8)', border: `1px solid ${isDark ? 'rgba(148,163,184,0.1)' : 'rgba(203,213,225,0.5)'}`, borderRadius: 16, padding: 6, width: 'fit-content', marginBottom: '2.5rem' }}>
              {(['individual', 'comparativo'] as const).map(v => (
                <button key={v} className="pickup-tab" onClick={() => setView(v)} style={{ padding: '0.75rem 1.75rem', borderRadius: 12, border: 'none', background: view === v ? '#0ea5e9' : 'transparent', color: view === v ? '#fff' : isDark ? '#94a3b8' : '#64748b', fontWeight: 800, fontSize: 14 }}>
                  {v === 'individual' ? 'Visão Individual' : 'Matriz de Inteligência'}
                </button>
              ))}
            </div>

            {view === 'individual' && periodsWithResults.map(p => {
              const m = results.get(p.id)!;
              return (
                <div key={p.id} style={{ marginBottom: '3rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, background: p.color }} />
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 900 }}>{p.label} <span style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 500 }}>({fmtDate(p.from)} – {fmtDate(p.to)})</span></h3>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', gap: '1.25rem' }}>
                    <MetricCard label="Receita" value={fmtBRL(m.totalRevenue)} icon={<TrendingUp size={16} />} color={p.color} subValue={`${m.days} dias`} isDark={isDark} />
                    <MetricCard label="ADR" value={fmtBRL(m.avgADR)} icon={<BarChart2 size={16} />} color={p.color} subValue="Líquido" isDark={isDark} />
                    <MetricCard label="UHs" value={fmtNum(m.totalUHs)} icon={<BedDouble size={16} />} color={p.color} subValue="Vendidas" isDark={isDark} />
                    <MetricCard label="Hóspedes" value={fmtNum(m.totalGuests)} icon={<Users size={16} />} color={p.color} isDark={isDark} />
                  </div>
                </div>
              );
            })}

            {view === 'comparativo' && (
              <div className="matrix-container" style={{ position: 'relative', background: isDark ? 'rgba(15,23,42,0.4)' : '#fff', borderRadius: 32, border: `1px solid ${isDark ? 'rgba(148,163,184,0.1)' : 'rgba(203,213,225,0.5)'}`, padding: '2.5rem', backdropFilter: 'blur(12px)', marginBottom: '4rem' }}>
                <div style={{ marginBottom: '2.5rem' }}>
                  <h3 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: -0.5 }}>Análise Comparativa Unificada</h3>
                  <p style={{ fontSize: 13, color: isDark ? '#94a3b8' : '#64748b' }}>Valores sempre visíveis. Interaja para **iluminar** as conexões de performance.</p>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 24px' }}>
                    <thead>
                      <tr style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                        <th style={{ textAlign: 'left', padding: '0 1.5rem' }}>Métrica</th>
                        {periodsWithResults.map(p => (
                          <th key={p.id} style={{ textAlign: 'right', padding: '0 1.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                              {p.label}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody onMouseLeave={() => setActiveCell(null)}>
                      {METRICS_LIST.map(row => (
                        <tr key={row.key} style={{ background: isDark ? 'rgba(30,41,59,0.1)' : 'rgba(241,245,249,0.5)', borderRadius: 24 }}>
                          <td style={{ padding: '2rem 1.5rem', borderTopLeftRadius: 24, borderBottomLeftRadius: 24, minWidth: 160 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: isDark ? '#94a3b8' : '#475569', fontWeight: 700 }}>
                              <div style={{ color: '#0ea5e9' }}>{row.icon}</div>
                              {row.label}
                            </div>
                          </td>
                          {periodsWithResults.map((p, pIdx) => {
                            const val = results.get(p.id)![row.key] as number;
                            const isActiveBase = activeCell?.periodId === p.id && activeCell?.metricKey === row.key;
                            const isComparisonTarget = activeCell?.metricKey === row.key && activeCell?.periodId !== p.id;

                            return (
                              <td key={p.id} style={{ 
                                padding: '0 1rem', textAlign: 'right', verticalAlign: 'middle',
                                borderTopRightRadius: pIdx === periodsWithResults.length - 1 ? 24 : 0,
                                borderBottomRightRadius: pIdx === periodsWithResults.length - 1 ? 24 : 0
                              }}>
                                <div 
                                  className={`matrix-cell ${isActiveBase ? 'cell-base-active' : ''} ${isComparisonTarget ? 'cell-target-active' : ''}`}
                                  onMouseEnter={() => setActiveCell({ periodId: p.id, metricKey: row.key })}
                                  onClick={() => setActiveCell({ periodId: p.id, metricKey: row.key })}
                                  style={{ 
                                    padding: '1.25rem', borderRadius: 16,
                                    minHeight: 80, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                                    border: isActiveBase ? `1px solid ${p.color}` : isComparisonTarget ? `1px solid ${p.color}50` : `1px solid ${isDark ? 'transparent' : 'rgba(203,213,225,0.3)'}`,
                                    boxShadow: isActiveBase ? `0 0 30px ${p.color}40` : isComparisonTarget ? `0 0 20px ${p.color}20` : 'none',
                                    background: isActiveBase ? `${p.color}15` : (isDark ? 'rgba(15,23,42,0.3)' : '#fff'),
                                  }}
                                >
                                  <div className="lighting-beam" />
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, position: 'relative', zIndex: 2 }}>
                                    <span style={{ 
                                      fontWeight: 900, 
                                      color: isActiveBase ? p.color : isComparisonTarget ? p.color : isDark ? '#f8fafc' : '#1e293b', 
                                      fontSize: isActiveBase ? 18 : 16, 
                                      transition: 'all 0.3s ease',
                                      textShadow: isActiveBase ? `0 0 10px ${p.color}40` : 'none'
                                    }}>
                                      {row.fmt(val)}
                                    </span>
                                    
                                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '4px 8px', maxWidth: 220 }}>
                                      {periodsWithResults.filter(other => other.id !== p.id).map(other => (
                                        <TrendBadgeCompact 
                                          key={other.id}
                                          value={val} 
                                          base={results.get(other.id)![row.key] as number} 
                                          color={other.color}
                                          isDark={isDark}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 500px), 1fr))', gap: '2rem', marginBottom: '3rem' }}>
              <div style={{ background: isDark ? 'rgba(15,23,42,0.6)' : '#fff', border: `1px solid ${isDark ? 'rgba(148,163,184,0.1)' : 'rgba(203,213,225,0.5)'}`, borderRadius: 24, padding: '2rem' }}>
                <h4 style={{ margin: '0 0 2rem', fontSize: 13, fontWeight: 800, color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.5 }}>ADR Benchmarking</h4>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={adrChartData} barSize={50}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(148,163,184,0.06)" : "rgba(203,213,225,0.2)"} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: isDark ? '#94a3b8' : '#64748b', fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v => `R$${v}`} tick={{ fill: isDark ? '#64748b' : '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip content={<CustomTooltip formatter={fmtBRL} isDark={isDark} />} cursor={{ fill: isDark ? 'rgba(148,163,184,0.05)' : 'rgba(203,213,225,0.1)' }} />
                    <Bar dataKey="ADR" radius={[12, 12, 0, 0]}>
                      {adrChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      <LabelList dataKey="ADR" position="top" formatter={(v: number) => `R$${v.toFixed(0)}`} style={{ fill: isDark ? '#f8fafc' : '#1e293b', fontSize: 12, fontWeight: 800 }} offset={10} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: isDark ? 'rgba(15,23,42,0.6)' : '#fff', border: `1px solid ${isDark ? 'rgba(148,163,184,0.1)' : 'rgba(203,213,225,0.5)'}`, borderRadius: 24, padding: '2rem' }}>
                <h4 style={{ margin: '0 0 2rem', fontSize: 13, fontWeight: 800, color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.5 }}>Volume de UHs</h4>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={uhsChartData} barSize={50} margin={{ top: 30, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(148,163,184,0.06)" : "rgba(203,213,225,0.2)"} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: isDark ? '#94a3b8' : '#64748b', fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.15)]} hide />
                    <Tooltip content={<CustomTooltip formatter={fmtNum} isDark={isDark} />} cursor={{ fill: isDark ? 'rgba(148,163,184,0.05)' : 'rgba(203,213,225,0.1)' }} />
                    <Bar dataKey="UHs" radius={[12, 12, 0, 0]}>
                      {uhsChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      <LabelList dataKey="UHs" position="top" style={{ fill: isDark ? '#f8fafc' : '#1e293b', fontSize: 12, fontWeight: 800 }} offset={10} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {revenueChartData.length > 0 && (
              <div style={{ background: isDark ? 'rgba(15,23,42,0.6)' : '#fff', border: `1px solid ${isDark ? 'rgba(148,163,184,0.1)' : 'rgba(203,213,225,0.5)'}`, borderRadius: 24, padding: '2rem', marginBottom: '4rem' }}>
                <h4 style={{ margin: '0 0 2rem', fontSize: 13, fontWeight: 800, color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.5 }}>Curva de Receita Diária</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={revenueChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(148,163,184,0.06)" : "rgba(203,213,225,0.2)"} vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: isDark ? '#64748b' : '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} tick={{ fill: isDark ? '#64748b' : '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip formatter={fmtBRL} isDark={isDark} />} />
                    <Legend iconType="circle" />
                    {periodsWithResults.map(p => (
                      <Line key={p.id} type="monotone" dataKey={p.label} stroke={p.color} strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
