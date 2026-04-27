// src/pages/diretoria/PickupReport.tsx
// Relatório de Pick-up real — velocidade de reservas, snapshots OTB diários,
// janela de antecedência, canal de origem e pace vs STLY.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  TrendingUp, TrendingDown, Minus, Loader2, AlertCircle,
  Users, BedDouble, BarChart2, CalendarRange, RefreshCw,
  Upload, Plus, Trash2, Download, X, History, CheckCircle2,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { erbonService } from '../../lib/erbonService';
import { useHotel } from '../../context/HotelContext';
import { useTheme } from '../../context/ThemeContext';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface OTBRow {
  stayDate:      string;
  currentOTB:    number;
  comparisonOTB: number;
  deltaRooms:    number;
}

interface WindowBucket { label: string; count: number; revenue: number; }
interface ChannelBucket { channel: string; count: number; revenue: number; }
interface PacePoint    { snapshotDate: string; currentOTB: number; stlyOTB: number; }

type ActiveTab = 'table' | 'window' | 'channel' | 'pace';

const QUICK_OFFSETS = [
  { label: 'Ontem',   days: 1  },
  { label: '7 dias',  days: 7  },
  { label: '30 dias', days: 30 },
] as const;

// ── Utilitários ───────────────────────────────────────────────────────────────

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

function addDays(base: string, n: number): string {
  const d = new Date(base); d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function subDays(base: string, n: number): string { return addDays(base, -n); }

function subYears(base: string, n: number): string {
  const d = new Date(base); d.setFullYear(d.getFullYear() - n);
  return d.toISOString().split('T')[0];
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function DeltaCell({ val, isDark }: { val: number; isDark: boolean }) {
  const color = val > 0 ? '#10b981' : val < 0 ? '#f43f5e' : isDark ? '#94a3b8' : '#64748b';
  const Icon  = val > 0 ? TrendingUp : val < 0 ? TrendingDown : Minus;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 800, color }}>
      <Icon size={13} />
      {val > 0 ? '+' : ''}{val}
    </span>
  );
}

function CustomTooltip({ active, payload, label, isDark }: any) {
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
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
          <span style={{ color: isDark ? '#cbd5e1' : '#475569' }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: p.color }}>
            {typeof p.value === 'number' ? p.value.toFixed(0) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Constantes visuais ────────────────────────────────────────────────────────

const BUCKET_COLORS   = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e'];
const CHANNEL_COLORS  = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#14b8a6', '#ec4899', '#64748b'];

// ── Componente principal ──────────────────────────────────────────────────────

export default function PickupReport() {
  const { selectedHotel } = useHotel();
  const { theme }         = useTheme();
  const isDark            = theme === 'dark';
  const hotelId           = selectedHotel?.id ?? '';

  // Estado
  const [compDate,     setCompDate]     = useState<string>(() => subDays(todayStr(), 7));
  const [activeTab,    setActiveTab]    = useState<ActiveTab>('table');
  const [snapLoading,  setSnapLoading]  = useState(false);
  const [dataLoading,  setDataLoading]  = useState(false);
  const [error,        setError]        = useState('');
  const [noErbon,      setNoErbon]      = useState(false);
  const [snapTime,     setSnapTime]     = useState('');

  const [otbRows,      setOtbRows]      = useState<OTBRow[]>([]);
  const [winBuckets,   setWinBuckets]   = useState<WindowBucket[]>([]);
  const [chanBuckets,  setChanBuckets]  = useState<ChannelBucket[]>([]);
  const [pacePoints,   setPacePoints]   = useState<PacePoint[]>([]);

  // ── Estado do modal de importação histórica ───────────────────────────────────
  interface ManualRow { stayDate: string; roomsOtb: string; }
  interface ExcelPreviewRow { snapshot_date: string; stay_date: string; rooms_otb: number; }

  const [showImport,     setShowImport]     = useState(false);
  const [importTab,      setImportTab]      = useState<'manual' | 'excel'>('manual');
  const [snapDateInput,  setSnapDateInput]  = useState('');
  const [manualRows,     setManualRows]     = useState<ManualRow[]>([{ stayDate: '', roomsOtb: '' }]);
  const [importSaving,   setImportSaving]   = useState(false);
  const [importMsg,      setImportMsg]      = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [excelPreview,   setExcelPreview]   = useState<ExcelPreviewRow[]>([]);
  const [excelFileName,  setExcelFileName]  = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Auto-snapshot ────────────────────────────────────────────────────────────

  const ensureSnapshot = useCallback(async (hId: string): Promise<boolean> => {
    const today = todayStr();
    const { data: existing, error: chkErr } = await supabase
      .from('diretoria_pickup_snapshots')
      .select('stay_date').eq('hotel_id', hId).eq('snapshot_date', today).limit(1);
    if (chkErr) throw chkErr;
    if (existing && existing.length > 0) {
      setSnapTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      return false; // já existia
    }

    const endDate = addDays(today, 90);
    const otbData = await erbonService.fetchOTB(hId, today, endDate);
    if (!otbData.length) return false;

    const rows = otbData.map(d => ({
      hotel_id:         hId,
      snapshot_date:    today,
      stay_date:        d.stayDate.split('T')[0],
      rooms_otb:        d.totalRoomsDeductedTransient ?? 0,
      net_room_revenue: d.netRoomRevenueTransient ?? 0,
      adr:              (d.totalRoomsDeductedTransient ?? 0) > 0
                          ? (d.netRoomRevenueTransient ?? 0) / (d.totalRoomsDeductedTransient ?? 1)
                          : 0,
    }));

    const { error: upsErr } = await supabase
      .from('diretoria_pickup_snapshots')
      .upsert(rows, { onConflict: 'hotel_id,snapshot_date,stay_date' });
    if (upsErr) throw upsErr;

    setSnapTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    return true; // capturado agora
  }, []);

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadOTBTable = useCallback(async (hId: string, cDate: string): Promise<OTBRow[]> => {
    const today = todayStr();

    const [{ data: todaySnap, error: e1 }, { data: compSnap, error: e2 }] = await Promise.all([
      supabase.from('diretoria_pickup_snapshots')
        .select('stay_date,rooms_otb')
        .eq('hotel_id', hId).eq('snapshot_date', today)
        .gte('stay_date', today).order('stay_date'),
      supabase.from('diretoria_pickup_snapshots')
        .select('stay_date,rooms_otb')
        .eq('hotel_id', hId).eq('snapshot_date', cDate)
        .gte('stay_date', today).order('stay_date'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    const compMap = new Map((compSnap ?? []).map((r: any) => [r.stay_date, r]));

    return (todaySnap ?? []).map((r: any) => {
      const c: any = compMap.get(r.stay_date) ?? { rooms_otb: 0 };
      return {
        stayDate:      r.stay_date,
        currentOTB:    r.rooms_otb,
        comparisonOTB: c.rooms_otb,
        deltaRooms:    r.rooms_otb - c.rooms_otb,
      };
    });
  }, []);

  const loadBookingAnalysis = useCallback(async (hId: string) => {
    const today = todayStr();

    // A API Erbon filtra por data de check-in ESPECÍFICA (não por intervalo).
    // Fazemos 30 chamadas paralelas (uma por dia) e deduplicamos pelo bookingInternalID.
    const DAYS_AHEAD = 30;
    const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

    const settled = await Promise.allSettled(
      dates.map(date => erbonService.searchBookings(hId, { checkin: date }))
    );

    const seen = new Set<number>();
    const bookings: any[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        for (const b of r.value) {
          if (b.status !== 'CANCELLED' && !seen.has(b.bookingInternalID)) {
            seen.add(b.bookingInternalID);
            bookings.push(b);
          }
        }
      }
    }

    const buckets: WindowBucket[] = [
      { label: '0-7d',  count: 0, revenue: 0 },
      { label: '8-15d', count: 0, revenue: 0 },
      { label: '16-30d', count: 0, revenue: 0 },
      { label: '31-60d', count: 0, revenue: 0 },
      { label: '61+d',  count: 0, revenue: 0 },
    ];
    const chanMap = new Map<string, ChannelBucket>();

    bookings.forEach((b: any) => {
      const days = Math.max(0, Math.floor(
        (new Date(b.checkInDateTime).getTime() - new Date(b.createdAt).getTime()) / 86_400_000
      ));
      const rev = b.totalBookingRate ?? 0;
      const bi  = days <= 7 ? 0 : days <= 15 ? 1 : days <= 30 ? 2 : days <= 60 ? 3 : 4;
      buckets[bi].count++;
      buckets[bi].revenue += rev;

      const ch = b.sourceDesc || 'N/A';
      if (!chanMap.has(ch)) chanMap.set(ch, { channel: ch, count: 0, revenue: 0 });
      const e = chanMap.get(ch)!;
      e.count++;
      e.revenue += rev;
    });

    return {
      winBuckets: buckets,
      chanBuckets: Array.from(chanMap.values()).sort((a, b) => b.count - a.count),
    };
  }, []);

  const loadPace = useCallback(async (hId: string): Promise<PacePoint[]> => {
    const today  = todayStr();
    const from60 = subDays(today, 60);

    const { data, error: pErr } = await supabase
      .from('diretoria_pickup_snapshots')
      .select('snapshot_date,rooms_otb')
      .eq('hotel_id', hId)
      .gte('snapshot_date', from60)
      .lte('snapshot_date', today)
      .gte('stay_date', today);
    if (pErr) throw pErr;

    const byDate = new Map<string, number>();
    (data ?? []).forEach((r: any) =>
      byDate.set(r.snapshot_date, (byDate.get(r.snapshot_date) ?? 0) + r.rooms_otb)
    );

    // STLY actuals: ocupação real do mesmo período no ano anterior
    const stlyStart = subYears(today, 1);
    const stlyEnd   = addDays(stlyStart, 90);
    const stlyMap   = new Map<string, number>();
    try {
      const occ = await erbonService.fetchOccupancyWithPension(hId, stlyStart, stlyEnd);
      occ.forEach(o => stlyMap.set(o.date.split('T')[0], o.roomSalledConfirmed ?? 0));
    } catch { /* STLY indisponível — linha vazia */ }

    return Array.from(byDate.keys()).sort().map(snapDate => {
      const stlyKey = subYears(snapDate, 1);
      return {
        snapshotDate: snapDate,
        currentOTB:   byDate.get(snapDate) ?? 0,
        stlyOTB:      stlyMap.get(stlyKey) ?? 0,
      };
    });
  }, []);

  // ── Efeito principal ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hotelId) return;
    let cancelled = false;

    async function run() {
      setError(''); setNoErbon(false); setSnapLoading(true);
      try {
        const cfg = await erbonService.getConfig(hotelId);
        if (!cfg || !(cfg as any).is_active) { setNoErbon(true); return; }
        await ensureSnapshot(hotelId);
      } catch (e: any) {
        if (!cancelled) setError('Erro ao capturar snapshot: ' + e.message);
        return;
      } finally {
        if (!cancelled) setSnapLoading(false);
      }

      if (cancelled) return;
      setDataLoading(true);
      try {
        const [rows, bookAna, pace] = await Promise.all([
          loadOTBTable(hotelId, compDate),
          loadBookingAnalysis(hotelId),
          loadPace(hotelId),
        ]);
        if (!cancelled) {
          setOtbRows(rows);
          setWinBuckets(bookAna.winBuckets);
          setChanBuckets(bookAna.chanBuckets);
          setPacePoints(pace);
        }
      } catch (e: any) {
        if (!cancelled) setError('Erro ao carregar dados: ' + e.message);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [hotelId, compDate, ensureSnapshot, loadOTBTable, loadBookingAnalysis, loadPace]);

  // ── Funções de importação histórica ──────────────────────────────────────────

  /** Converte dd/mm/yyyy ou yyyy-mm-dd para yyyy-mm-dd */
  function parseDate(raw: string): string {
    const s = String(raw ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [d, m, y] = s.split('/');
      return `${y}-${m}-${d}`;
    }
    // Tenta converter número serial do Excel
    const n = Number(s);
    if (!isNaN(n) && n > 40000) {
      const d = new Date((n - 25569) * 86400 * 1000);
      return d.toISOString().split('T')[0];
    }
    return '';
  }

  function downloadTemplate() {
    const rows = [
      ['Data Snapshot', 'Data Estadia', 'Quartos OTB'],
      ['20/04/2026', '01/05/2026', 15],
      ['20/04/2026', '02/05/2026', 12],
      ['21/04/2026', '01/05/2026', 16],
    ];
    const ws   = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 14 }];
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pickup Histórico');
    XLSX.writeFile(wb, 'template_pickup_historico.xlsx');
  }

  function handleExcelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelFileName(file.name);
    setImportMsg(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb   = XLSX.read(ev.target?.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const preview: ExcelPreviewRow[] = [];
        for (let i = 1; i < data.length; i++) {
          const [snap, stay, rooms] = data[i];
          const sd = parseDate(String(snap));
          const st = parseDate(String(stay));
          const ro = Number(String(rooms).replace(',', '.'));
          if (sd && st && !isNaN(ro) && ro >= 0) {
            preview.push({ snapshot_date: sd, stay_date: st, rooms_otb: ro });
          }
        }
        setExcelPreview(preview);
        if (!preview.length) setImportMsg({ type: 'err', text: 'Nenhuma linha válida encontrada. Verifique o formato do arquivo.' });
      } catch (err: any) {
        setImportMsg({ type: 'err', text: 'Erro ao ler arquivo: ' + err.message });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function saveManual() {
    setImportMsg(null);
    if (!snapDateInput) { setImportMsg({ type: 'err', text: 'Selecione a data do snapshot.' }); return; }
    const rows = manualRows
      .filter(r => r.stayDate && r.roomsOtb !== '')
      .map(r => ({
        hotel_id:         hotelId,
        snapshot_date:    snapDateInput,
        stay_date:        r.stayDate,
        rooms_otb:        Math.round(Number(r.roomsOtb.replace(',', '.')) || 0),
        net_room_revenue: 0,
        adr:              0,
      }));
    if (!rows.length) { setImportMsg({ type: 'err', text: 'Adicione ao menos uma linha com data e quartos.' }); return; }
    setImportSaving(true);
    try {
      const { error } = await supabase
        .from('diretoria_pickup_snapshots')
        .upsert(rows, { onConflict: 'hotel_id,snapshot_date,stay_date' });
      if (error) throw error;
      setImportMsg({ type: 'ok', text: `${rows.length} linha(s) salvas com sucesso!` });
      setManualRows([{ stayDate: '', roomsOtb: '' }]);
      setSnapDateInput('');
    } catch (e: any) {
      setImportMsg({ type: 'err', text: 'Erro ao salvar: ' + e.message });
    } finally {
      setImportSaving(false);
    }
  }

  async function saveExcel() {
    if (!excelPreview.length) return;
    setImportSaving(true);
    setImportMsg(null);
    try {
      const rows = excelPreview.map(r => ({
        hotel_id:         hotelId,
        snapshot_date:    r.snapshot_date,
        stay_date:        r.stay_date,
        rooms_otb:        r.rooms_otb,
        net_room_revenue: 0,
        adr:              0,
      }));
      const { error } = await supabase
        .from('diretoria_pickup_snapshots')
        .upsert(rows, { onConflict: 'hotel_id,snapshot_date,stay_date' });
      if (error) throw error;
      setImportMsg({ type: 'ok', text: `${rows.length} linha(s) importadas com sucesso!` });
      setExcelPreview([]);
      setExcelFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      setImportMsg({ type: 'err', text: 'Erro ao importar: ' + e.message });
    } finally {
      setImportSaving(false);
    }
  }

  function closeImport() {
    setShowImport(false);
    setImportMsg(null);
    setExcelPreview([]);
    setExcelFileName('');
    setManualRows([{ stayDate: '', roomsOtb: '' }]);
    setSnapDateInput('');
  }

  // ── Render helpers ────────────────────────────────────────────────────────────

  const isLoading = snapLoading || dataLoading;
  const totalBookings = chanBuckets.reduce((s, c) => s + c.count, 0);

  const cardBg   = isDark ? 'rgba(15,23,42,0.6)'  : '#fff';
  const cardBdr  = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(203,213,225,0.5)';
  const headBg   = isDark ? 'rgba(2,6,23,0.88)'   : 'rgba(255,255,255,0.88)';
  const textMute = isDark ? '#64748b' : '#94a3b8';
  const textSub  = isDark ? '#94a3b8' : '#64748b';

  // ── JSX ───────────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: isDark ? '#020617' : '#f8fafc', color: isDark ? '#f8fafc' : '#1e293b', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .pu-tab { transition: all 0.2s ease; cursor: pointer; border: none; }
        .pu-offset-pill { transition: all 0.2s ease; cursor: pointer; border: none; }
        .pu-row:hover td { background: ${isDark ? 'rgba(14,165,233,0.05)' : 'rgba(14,165,233,0.03)'} !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.4s ease; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom: `1px solid ${cardBdr}`, padding: '1.25rem 2rem', background: headBg, backdropFilter: 'blur(20px)', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>

          {/* Título */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 16px -4px rgba(14,165,233,0.4)', flexShrink: 0 }}>
              <TrendingUp size={24} color="#fff" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, color: isDark ? '#f8fafc' : '#1e293b', letterSpacing: -0.8 }}>Pick-up Report</h1>
              <p style={{ margin: 0, fontSize: 13, color: textSub, fontWeight: 500 }}>Velocidade de reservas · Próximos 90 dias</p>
            </div>
          </div>

          {/* Snapshot badge + offset pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Snapshot status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 1rem', background: isDark ? 'rgba(30,41,59,0.6)' : '#f1f5f9', borderRadius: 10, fontSize: 12, fontWeight: 600, color: textSub }}>
              {snapLoading
                ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Capturando snapshot...</>
                : snapTime
                  ? <><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} /> Snapshot: {snapTime}</>
                  : <><div style={{ width: 8, height: 8, borderRadius: '50%', background: textMute }} /> Aguardando...</>
              }
            </div>

            {/* Separador */}
            <div style={{ width: 1, height: 24, background: cardBdr }} />

            {/* Botão Importar Histórico */}
            <button onClick={() => { setShowImport(true); setImportMsg(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 1rem', borderRadius: 10, background: isDark ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.08)', border: `1px solid ${isDark ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.2)'}`, color: '#8b5cf6', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              <History size={14} /> Importar Histórico
            </button>

            {/* Separador */}
            <div style={{ width: 1, height: 24, background: cardBdr }} />

            {/* Comparação: pills rápidos + date picker livre */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: textMute, textTransform: 'uppercase', letterSpacing: 0.8 }}>vs</span>

              {/* Quick pills */}
              <div style={{ display: 'flex', gap: 4, background: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.8)', border: `1px solid ${cardBdr}`, borderRadius: 12, padding: 4 }}>
                {QUICK_OFFSETS.map(({ label, days }) => {
                  const target = subDays(todayStr(), days);
                  const active = compDate === target;
                  return (
                    <button key={days} className="pu-offset-pill" onClick={() => setCompDate(target)}
                      style={{ padding: '0.4rem 0.9rem', borderRadius: 8, background: active ? '#0ea5e9' : 'transparent', color: active ? '#fff' : textSub, fontWeight: 800, fontSize: 13 }}>
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Date picker livre */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.35rem 0.75rem', background: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.8)', border: `1px solid ${QUICK_OFFSETS.some(({ days }) => subDays(todayStr(), days) === compDate) ? cardBdr : '#0ea5e9'}`, borderRadius: 10 }}>
                <CalendarRange size={13} color={QUICK_OFFSETS.some(({ days }) => subDays(todayStr(), days) === compDate) ? textMute : '#0ea5e9'} />
                <input
                  type="date"
                  value={compDate}
                  max={subDays(todayStr(), 1)}
                  onChange={e => e.target.value && setCompDate(e.target.value)}
                  style={{ border: 'none', background: 'transparent', color: isDark ? '#f8fafc' : '#1e293b', fontSize: 13, fontWeight: 700, outline: 'none', cursor: 'pointer', width: 130 }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '2rem 2rem' }}>

        {/* Sem Erbon */}
        {noErbon && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: isDark ? 'rgba(239,68,68,0.1)' : '#fef2f2', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, padding: '1.5rem 2rem', marginBottom: '2rem' }}>
            <AlertCircle size={24} color="#ef4444" />
            <div>
              <p style={{ margin: 0, fontWeight: 800, color: '#ef4444' }}>Erbon PMS não configurado</p>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: isDark ? '#fca5a5' : '#b91c1c' }}>Configure a integração Erbon para {selectedHotel?.name ?? 'este hotel'} em Configurações → Erbon PMS.</p>
            </div>
          </div>
        )}

        {/* Erro */}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: isDark ? 'rgba(239,68,68,0.1)' : '#fef2f2', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, padding: '1rem 1.5rem', marginBottom: '2rem' }}>
            <AlertCircle size={18} color="#ef4444" />
            <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 600 }}>{error}</span>
          </div>
        )}

        {/* Loading global */}
        {isLoading && !noErbon && !error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '4rem', color: textSub }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontWeight: 600 }}>{snapLoading ? 'Capturando snapshot OTB...' : 'Carregando análise...'}</span>
          </div>
        )}

        {/* Conteúdo principal */}
        {!isLoading && !noErbon && !error && (
          <div className="fade-up">

            {/* ── Tabs ── */}
            <div style={{ display: 'flex', gap: 4, background: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.8)', border: `1px solid ${cardBdr}`, borderRadius: 16, padding: 4, width: 'fit-content', marginBottom: '2rem', flexWrap: 'wrap' }}>
              {([
                { id: 'table',   label: 'Tabela OTB',         icon: <BedDouble size={14} /> },
                { id: 'window',  label: 'Janela de Reserva',  icon: <CalendarRange size={14} /> },
                { id: 'channel', label: 'Canais',              icon: <Users size={14} /> },
                { id: 'pace',    label: 'Pace vs STLY',       icon: <BarChart2 size={14} /> },
              ] as { id: ActiveTab; label: string; icon: React.ReactNode }[]).map(t => (
                <button key={t.id} className="pu-tab" onClick={() => setActiveTab(t.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.65rem 1.25rem', borderRadius: 12, background: activeTab === t.id ? '#0ea5e9' : 'transparent', color: activeTab === t.id ? '#fff' : textSub, fontWeight: 700, fontSize: 13 }}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>

            {/* ── Tab: Tabela OTB ── */}
            {activeTab === 'table' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Info banner */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.75rem 1.25rem', background: isDark ? 'rgba(14,165,233,0.08)' : 'rgba(14,165,233,0.06)', border: `1px solid ${isDark ? 'rgba(14,165,233,0.2)' : 'rgba(14,165,233,0.15)'}`, borderRadius: 12, fontSize: 12, color: isDark ? '#7dd3fc' : '#0369a1', fontWeight: 500 }}>
                  <BedDouble size={14} style={{ flexShrink: 0 }} />
                  <span>
                    O endpoint OTB do Erbon retorna receita apenas para datas passadas (actuals). Para datas futuras, a tabela exibe quartos confirmados — a métrica principal de pick-up.
                  </span>
                </div>

                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 24, overflow: 'hidden' }}>
                  {otbRows.length === 0 ? (
                    <div style={{ padding: '4rem', textAlign: 'center', color: textSub }}>
                      <BedDouble size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                      <p style={{ fontWeight: 600, margin: 0 }}>Nenhum dado OTB disponível para hoje.</p>
                      <p style={{ fontSize: 13, margin: '8px 0 0', opacity: 0.7 }}>O snapshot de comparação ({fmtFullDate(compDate)}) pode não existir ainda. Use "Importar Histórico" para alimentar datas anteriores.</p>
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${cardBdr}` }}>
                            {['Data Estadia', 'OTB Hoje', `OTB em ${fmtFullDate(compDate)}`, 'Δ Quartos'].map(h => (
                              <th key={h} style={{ padding: '1rem 1.25rem', textAlign: h === 'Data Estadia' ? 'left' : 'right', fontSize: 10, fontWeight: 800, color: textMute, textTransform: 'uppercase', letterSpacing: 1.2, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {otbRows.map((r, i) => (
                            <tr key={r.stayDate} className="pu-row" style={{ borderBottom: i < otbRows.length - 1 ? `1px solid ${isDark ? 'rgba(148,163,184,0.06)' : 'rgba(203,213,225,0.3)'}` : 'none' }}>
                              <td style={{ padding: '0.85rem 1.25rem', fontWeight: 700, color: isDark ? '#f1f5f9' : '#1e293b', whiteSpace: 'nowrap' }}>{fmtFullDate(r.stayDate)}</td>
                              <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right', fontWeight: 900, color: isDark ? '#f8fafc' : '#1e293b' }}>{r.currentOTB}</td>
                              <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right', color: textSub }}>{r.comparisonOTB}</td>
                              <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}><DeltaCell val={r.deltaRooms} isDark={isDark} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab: Janela de Reserva ── */}
            {activeTab === 'window' && (
              <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 24, padding: '2rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: 13, fontWeight: 800, color: textMute, textTransform: 'uppercase', letterSpacing: 1.5 }}>Distribuição por Janela de Reserva</h4>
                <p style={{ margin: '0 0 2rem', fontSize: 12, color: textSub }}>Antecedência com que as reservas dos próximos 90 dias foram feitas.</p>
                {winBuckets.every(b => b.count === 0) ? (
                  <div style={{ textAlign: 'center', padding: '3rem', color: textSub }}>
                    <CalendarRange size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                    <p style={{ fontWeight: 600, margin: 0 }}>Sem reservas nos próximos 90 dias.</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={winBuckets} barSize={52} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(148,163,184,0.06)' : 'rgba(203,213,225,0.2)'} vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: textSub, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: textMute, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip isDark={isDark} />} cursor={{ fill: isDark ? 'rgba(148,163,184,0.05)' : 'rgba(203,213,225,0.1)' }} />
                      <Bar dataKey="count" name="Reservas" radius={[10, 10, 0, 0]}>
                        {winBuckets.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i % BUCKET_COLORS.length]} />)}
                        <LabelList dataKey="count" position="top" style={{ fill: isDark ? '#f8fafc' : '#1e293b', fontSize: 12, fontWeight: 800 }} offset={8} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}

            {/* ── Tab: Canais ── */}
            {activeTab === 'channel' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 480px), 1fr))', gap: '1.5rem' }}>
                {/* Bar chart */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 24, padding: '2rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: 13, fontWeight: 800, color: textMute, textTransform: 'uppercase', letterSpacing: 1.5 }}>Reservas por Canal</h4>
                  <p style={{ margin: '0 0 2rem', fontSize: 12, color: textSub }}>Reservas confirmadas para os próximos 90 dias.</p>
                  {chanBuckets.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: textSub }}>
                      <Users size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                      <p style={{ fontWeight: 600, margin: 0 }}>Sem reservas para analisar.</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={chanBuckets} layout="vertical" barSize={22} margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(148,163,184,0.06)' : 'rgba(203,213,225,0.2)'} horizontal={false} />
                        <XAxis type="number" tick={{ fill: textMute, fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="channel" width={120} tick={{ fill: textSub, fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip isDark={isDark} />} cursor={{ fill: isDark ? 'rgba(148,163,184,0.05)' : 'rgba(203,213,225,0.1)' }} />
                        <Bar dataKey="count" name="Reservas" radius={[0, 8, 8, 0]}>
                          {chanBuckets.map((_, i) => <Cell key={i} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Share list */}
                <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 24, padding: '2rem' }}>
                  <h4 style={{ margin: '0 0 2rem', fontSize: 13, fontWeight: 800, color: textMute, textTransform: 'uppercase', letterSpacing: 1.5 }}>Share de Canais</h4>
                  {chanBuckets.length === 0 ? (
                    <p style={{ color: textSub, fontSize: 13, textAlign: 'center' }}>Sem dados</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {chanBuckets.map((d, i) => {
                        const pct = totalBookings > 0 ? (d.count / totalBookings) * 100 : 0;
                        const color = CHANNEL_COLORS[i % CHANNEL_COLORS.length];
                        return (
                          <div key={d.channel}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: isDark ? '#f1f5f9' : '#1e293b', fontWeight: 600 }}>
                                <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
                                {d.channel}
                                <span style={{ color: textMute, fontWeight: 500 }}>({d.count})</span>
                              </span>
                              <span style={{ fontWeight: 800, color }}>{pct.toFixed(1)}%</span>
                            </div>
                            <div style={{ height: 5, background: isDark ? 'rgba(148,163,184,0.1)' : '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.8s ease' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab: Pace vs STLY ── */}
            {activeTab === 'pace' && (
              <div style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 24, padding: '2rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: 13, fontWeight: 800, color: textMute, textTransform: 'uppercase', letterSpacing: 1.5 }}>Curva de Pace — OTB Atual vs STLY</h4>
                <p style={{ margin: '0 0 2rem', fontSize: 12, color: textSub }}>
                  Total de quartos OTB capturado por dia (últimos 60 dias). STLY = ocupação real do mesmo período do ano anterior.
                </p>
                {pacePoints.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem', color: textSub }}>
                    <BarChart2 size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                    <p style={{ fontWeight: 600, margin: 0 }}>Dados de pace acumulam após os primeiros dias de uso.</p>
                    <p style={{ fontSize: 13, margin: '8px 0 0', opacity: 0.7 }}>Abra este relatório diariamente para construir o histórico.</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={340}>
                    <LineChart data={pacePoints} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(148,163,184,0.06)' : 'rgba(203,213,225,0.2)'} vertical={false} />
                      <XAxis dataKey="snapshotDate" tickFormatter={fmtShortDate} tick={{ fill: textMute, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: textMute, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip isDark={isDark} />} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="currentOTB" name="OTB Atual" stroke="#0ea5e9" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="stlyOTB" name="STLY" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modal: Importar Histórico ── */}
      {showImport && (
        <div
          onClick={closeImport}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: isDark ? '#0f172a' : '#fff', border: `1px solid ${cardBdr}`, borderRadius: 24, width: '100%', maxWidth: 680, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>

            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.75rem', borderBottom: `1px solid ${cardBdr}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <History size={18} color="#fff" />
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: isDark ? '#f8fafc' : '#1e293b' }}>Importar Histórico de Pick-up</p>
                  <p style={{ margin: 0, fontSize: 12, color: textSub }}>Alimente snapshots anteriores para ativar a comparação</p>
                </div>
              </div>
              <button onClick={closeImport} style={{ background: 'none', border: 'none', cursor: 'pointer', color: textSub, padding: 4, borderRadius: 8 }}>
                <X size={20} />
              </button>
            </div>

            {/* Tabs do modal */}
            <div style={{ display: 'flex', gap: 4, padding: '1rem 1.75rem 0', borderBottom: `1px solid ${cardBdr}` }}>
              {([
                { id: 'manual', label: 'Entrada Manual' },
                { id: 'excel',  label: 'Importar Excel' },
              ] as { id: 'manual' | 'excel'; label: string }[]).map(t => (
                <button key={t.id} onClick={() => { setImportTab(t.id); setImportMsg(null); }}
                  style={{ padding: '0.5rem 1.25rem', marginBottom: -1, borderRadius: '8px 8px 0 0', fontWeight: 700, fontSize: 13, cursor: 'pointer', border: 'none', borderBottom: importTab === t.id ? `2px solid #8b5cf6` : '2px solid transparent', background: 'transparent', color: importTab === t.id ? '#8b5cf6' : textSub }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Modal body */}
            <div style={{ overflowY: 'auto', padding: '1.5rem 1.75rem', flex: 1 }}>

              {/* ── Aba: Entrada Manual ── */}
              {importTab === 'manual' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: textSub, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                      Data do Snapshot <span style={{ color: '#f43f5e' }}>*</span>
                    </label>
                    <input type="date" value={snapDateInput} onChange={e => setSnapDateInput(e.target.value)}
                      max={todayStr()}
                      style={{ padding: '0.6rem 0.9rem', borderRadius: 10, border: `1px solid ${isDark ? 'rgba(148,163,184,0.2)' : '#e2e8f0'}`, background: isDark ? 'rgba(30,41,59,0.6)' : '#f8fafc', color: isDark ? '#f8fafc' : '#1e293b', fontSize: 14, width: '100%', outline: 'none' }} />
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: textMute }}>
                      A data em que o OTB foi anotado no caderno — não a data de estadia.
                    </p>
                  </div>

                  {/* Tabela de linhas */}
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: textSub, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                      Datas de Estadia e Quartos OTB
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {/* Header */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 36px', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: textMute, textTransform: 'uppercase', letterSpacing: 0.8 }}>Data Estadia</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: textMute, textTransform: 'uppercase', letterSpacing: 0.8 }}>Quartos OTB</span>
                        <span />
                      </div>
                      {manualRows.map((row, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 36px', gap: 8, alignItems: 'center' }}>
                          <input type="date" value={row.stayDate}
                            onChange={e => setManualRows(prev => prev.map((r, idx) => idx === i ? { ...r, stayDate: e.target.value } : r))}
                            style={{ padding: '0.55rem 0.8rem', borderRadius: 8, border: `1px solid ${isDark ? 'rgba(148,163,184,0.2)' : '#e2e8f0'}`, background: isDark ? 'rgba(30,41,59,0.6)' : '#f8fafc', color: isDark ? '#f8fafc' : '#1e293b', fontSize: 13, outline: 'none' }} />
                          <input type="text" inputMode="numeric" placeholder="ex: 15" value={row.roomsOtb}
                            onChange={e => setManualRows(prev => prev.map((r, idx) => idx === i ? { ...r, roomsOtb: e.target.value } : r))}
                            style={{ padding: '0.55rem 0.8rem', borderRadius: 8, border: `1px solid ${isDark ? 'rgba(148,163,184,0.2)' : '#e2e8f0'}`, background: isDark ? 'rgba(30,41,59,0.6)' : '#f8fafc', color: isDark ? '#f8fafc' : '#1e293b', fontSize: 13, outline: 'none' }} />
                          <button onClick={() => setManualRows(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i))}
                            style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: isDark ? 'rgba(244,63,94,0.1)' : '#fef2f2', color: '#f43f5e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button onClick={() => setManualRows(prev => [...prev, { stayDate: '', roomsOtb: '' }])}
                      style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 1rem', borderRadius: 8, border: `1px dashed ${isDark ? 'rgba(148,163,184,0.3)' : '#cbd5e1'}`, background: 'transparent', color: textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      <Plus size={14} /> Adicionar linha
                    </button>
                  </div>
                </div>
              )}

              {/* ── Aba: Importar Excel ── */}
              {importTab === 'excel' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* Download template */}
                  <div style={{ background: isDark ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.05)', border: `1px solid ${isDark ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.15)'}`, borderRadius: 14, padding: '1.25rem' }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 14, color: isDark ? '#f8fafc' : '#1e293b' }}>1. Baixe o template</p>
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: textSub }}>Preencha com os dados do caderno. Colunas: <strong>Data Snapshot</strong> · <strong>Data Estadia</strong> · <strong>Quartos OTB</strong></p>
                    <p style={{ margin: '0 0 12px', fontSize: 11, color: textMute }}>Formato aceito: <code>dd/mm/yyyy</code> — múltiplas datas de snapshot no mesmo arquivo</p>
                    <button onClick={downloadTemplate}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.55rem 1.1rem', borderRadius: 8, border: `1px solid ${isDark ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.25)'}`, background: isDark ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.08)', color: '#8b5cf6', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      <Download size={14} /> Baixar Template Excel
                    </button>
                  </div>

                  {/* Upload */}
                  <div>
                    <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 14, color: isDark ? '#f8fafc' : '#1e293b' }}>2. Faça upload do arquivo preenchido</p>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.85rem 1.1rem', borderRadius: 12, border: `2px dashed ${isDark ? 'rgba(148,163,184,0.25)' : '#e2e8f0'}`, cursor: 'pointer', background: isDark ? 'rgba(30,41,59,0.3)' : '#f8fafc' }}>
                      <Upload size={18} color={textSub} />
                      <span style={{ fontSize: 13, color: textSub, fontWeight: 500 }}>
                        {excelFileName || 'Clique para selecionar o arquivo .xlsx ou .xls'}
                      </span>
                      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleExcelFile} style={{ display: 'none' }} />
                    </label>
                  </div>

                  {/* Preview */}
                  {excelPreview.length > 0 && (
                    <div>
                      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: isDark ? '#f8fafc' : '#1e293b' }}>
                        {excelPreview.length} linha(s) encontradas — prévia:
                      </p>
                      <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${cardBdr}`, borderRadius: 12 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${cardBdr}`, background: isDark ? 'rgba(15,23,42,0.8)' : '#f1f5f9' }}>
                              {['Snapshot', 'Estadia', 'Quartos OTB'].map(h => (
                                <th key={h} style={{ padding: '0.5rem 0.85rem', textAlign: 'left', fontWeight: 700, color: textMute, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {excelPreview.slice(0, 50).map((r, i) => (
                              <tr key={i} style={{ borderBottom: `1px solid ${isDark ? 'rgba(148,163,184,0.06)' : 'rgba(203,213,225,0.3)'}` }}>
                                <td style={{ padding: '0.45rem 0.85rem', color: textSub }}>{fmtFullDate(r.snapshot_date)}</td>
                                <td style={{ padding: '0.45rem 0.85rem', color: isDark ? '#f1f5f9' : '#1e293b', fontWeight: 600 }}>{fmtFullDate(r.stay_date)}</td>
                                <td style={{ padding: '0.45rem 0.85rem', fontWeight: 800, color: '#0ea5e9' }}>{r.rooms_otb}</td>
                              </tr>
                            ))}
                            {excelPreview.length > 50 && (
                              <tr><td colSpan={3} style={{ padding: '0.5rem 0.85rem', color: textMute, fontSize: 11, textAlign: 'center' }}>...e mais {excelPreview.length - 50} linhas</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Mensagem de resultado */}
              {importMsg && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.75rem 1rem', borderRadius: 10, marginTop: '1rem', background: importMsg.type === 'ok' ? (isDark ? 'rgba(16,185,129,0.1)' : '#f0fdf4') : (isDark ? 'rgba(244,63,94,0.1)' : '#fef2f2'), border: `1px solid ${importMsg.type === 'ok' ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}` }}>
                  {importMsg.type === 'ok'
                    ? <CheckCircle2 size={16} color="#10b981" />
                    : <AlertCircle size={16} color="#f43f5e" />}
                  <span style={{ fontSize: 13, fontWeight: 600, color: importMsg.type === 'ok' ? '#10b981' : '#f43f5e' }}>{importMsg.text}</span>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '1rem 1.75rem', borderTop: `1px solid ${cardBdr}` }}>
              <button onClick={closeImport}
                style={{ padding: '0.6rem 1.25rem', borderRadius: 10, border: `1px solid ${cardBdr}`, background: 'transparent', color: textSub, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Fechar
              </button>
              <button
                onClick={importTab === 'manual' ? saveManual : saveExcel}
                disabled={importSaving || (importTab === 'excel' && excelPreview.length === 0)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.6rem 1.4rem', borderRadius: 10, border: 'none', background: importSaving ? textMute : '#8b5cf6', color: '#fff', fontWeight: 700, fontSize: 13, cursor: importSaving ? 'not-allowed' : 'pointer', opacity: (importTab === 'excel' && excelPreview.length === 0 && !importSaving) ? 0.4 : 1 }}>
                {importSaving
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Salvando...</>
                  : <><Upload size={14} /> {importTab === 'manual' ? 'Salvar Snapshot' : `Importar ${excelPreview.length > 0 ? excelPreview.length + ' linhas' : ''}`}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
