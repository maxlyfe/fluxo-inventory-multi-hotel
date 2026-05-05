// src/pages/reception/FNRHReception.tsx
// Gerenciamento completo de Fichas FNRH Gov (SERPRO)
// Agrupamento por reserva, consulta em tempo real e lista de pendentes.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, ClipboardList, Search,
  Loader2, CheckCircle, XCircle, AlertTriangle, RefreshCw,
  ChevronDown, ChevronUp, RotateCcw, Clock, Filter,
  Users, User, Home, BookOpen
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { fnrhService, FNRHSyncLog } from '../../lib/fnrhService';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type TabId = 'logs' | 'pendentes' | 'consulta';

interface FNRHGovRecord {
  Id: string;
  Status: string;
  StatusFichaLabel: string;
  Nome: string;
  NumeroDocumento: string;
  TipoDocumentoId: string;
  PaisNacionalidade_id: string;
  CheckinEm: string;
  SaidaPrevistaEm: string;
  UF?: string;
  Cidade?: string;
}

// ── CSS helpers ───────────────────────────────────────────────────────────────

const inputCls =
  'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 ' +
  'rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors';

const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

const btnPrimary =
  'flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white ' +
  'rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';

const btnSecondary =
  'flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 ' +
  'rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const CONSULTA_STATUS_OPTIONS = [
  { value: '',                    label: 'Todos os status' },
  { value: 'CHECKIN_REALIZADO',   label: 'Check-in Realizado' },
  { value: 'CHECKOUT_REALIZADO',  label: 'Check-out Realizado' },
  { value: 'NOSHOW',              label: 'No-Show' },
  { value: 'PENDENTE',            label: 'Pendente' },
  { value: 'CANCELADO',           label: 'Cancelado' },
  { value: 'ATIVO',               label: 'Ativo' },
];

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  SUCESSO:          { label: 'Sucesso',           cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',   icon: <CheckCircle className="w-3 h-3" /> },
  CHECKOUT_ENVIADO: { label: 'Check-out Enviado', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',      icon: <CheckCircle className="w-3 h-3" /> },
  PENDENTE:         { label: 'Pendente',          cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',   icon: <Clock className="w-3 h-3" /> },
  ERRO:             { label: 'Erro',              cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',           icon: <XCircle className="w-3 h-3" /> },
};

// ── Sub-componentes ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${meta.cls}`}>
      {meta.icon} {meta.label}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const m: Record<string, string> = {
    CHECKIN:  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    CHECKOUT: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    NOSHOW:   'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${m[action] ?? 'bg-gray-100 text-gray-600'}`}>
      {action}
    </span>
  );
}

function LogRow({ log, onReenviar }: { log: FNRHSyncLog; onReenviar: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [sending,  setSending]  = useState(false);

  const dateLabel = (() => {
    try {
      return new Date(log.created_at).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return log.created_at; }
  })();

  async function handleReenviar() {
    setSending(true);
    try { await onReenviar(log.id); } finally { setSending(false); }
  }

  const canResend = log.status === 'ERRO' || log.status === 'PENDENTE';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
        <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">{dateLabel}</span>
        <ActionBadge action={log.action} />
        <StatusBadge status={log.status} />
        <span className="font-bold text-sm text-gray-800 dark:text-gray-100 flex-1 min-w-[120px] truncate">
          {log.guest_name || '—'}
        </span>
        
        <div className="flex items-center gap-2 ml-auto">
          {canResend && (
            <button type="button" onClick={handleReenviar} disabled={sending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 text-amber-700 dark:text-amber-400 text-[10px] font-black uppercase border border-amber-200 dark:border-amber-700/40 disabled:opacity-60">
              {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Reenviar
            </button>
          )}
          <button type="button" onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-4 space-y-3 bg-gray-50/30 dark:bg-gray-900/20">
          {log.error_detail && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 text-[11px] text-red-700 dark:text-red-300">
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-black uppercase"><AlertTriangle size={12}/> Detalhe da Falha</div>
              { (log.error_detail as any).message || 'Erro desconhecido retornado pelo Governo.' }
            </div>
          )}
          <div className="text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-6 gap-y-1 font-medium">
            <div><span className="opacity-60 uppercase mr-1">FNRH Reserva:</span> {log.fnrh_reserva_id || '—'}</div>
            <div><span className="opacity-60 uppercase mr-1">Documento:</span> {log.guest_document || '—'}</div>
            <div><span className="opacity-60 uppercase mr-1">Tentaivas:</span> {log.retry_count}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function GovRecordCard({ record, isDark }: { record: FNRHGovRecord; isDark: boolean }) {
  const statusCls = record.Status === 'CHECK_OUT_CONFIRMADO' 
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm hover:border-emerald-500/30 transition-all">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${statusCls}`}>
              {record.StatusFichaLabel || record.Status}
            </span>
          </div>
          <h4 className="font-black text-gray-900 dark:text-white truncate uppercase tracking-tight">{record.Nome}</h4>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 font-bold">
            {record.TipoDocumentoId}: {record.NumeroDocumento} • {record.PaisNacionalidade_id}
          </p>
        </div>
        <div className="text-right shrink-0">
           <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-1.5 border dark:border-slate-700">
             <p className="text-[10px] text-gray-600 dark:text-gray-300 font-bold whitespace-nowrap leading-tight">In: {new Date(record.CheckinEm).toLocaleDateString('pt-BR')}</p>
             <p className="text-[10px] text-gray-600 dark:text-gray-300 font-bold whitespace-nowrap leading-tight mt-1">Out: {new Date(record.SaidaPrevistaEm).toLocaleDateString('pt-BR')}</p>
           </div>
        </div>
      </div>
    </div>
  );
}

// ── ABAS ──────────────────────────────────────────────────────────────────────

function TabLogs({ hotelId }: { hotelId: string }) {
  const { addNotification } = useNotification();
  const [logs, setLogs] = useState<FNRHSyncLog[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fnrhService.buscarLogs(hotelId, { limit: 150 });
      setLogs(data || []);
    } catch (e: any) {
      addNotification('Erro ao carregar logs do servidor.', 'error');
    } finally {
      setLoading(false);
    }
  }, [hotelId, addNotification]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  async function handleReenviar(logId: string) {
    try {
      await fnrhService.reenviar(logId, hotelId);
      addNotification('Reenvio realizado com sucesso!', 'success');
      loadLogs();
    } catch (e: any) {
      addNotification(e.message || 'Erro no reenvio', 'error');
    }
  }

  const grouped = useMemo(() => {
    const map = logs.reduce((acc, log) => {
      const key = log.numero_reserva || 'Reserva não identificada';
      if (!acc[key]) acc[key] = [];
      acc[key].push(log);
      return acc;
    }, {} as Record<string, FNRHSyncLog[]>);
    return map;
  }, [logs]);

  const sortedBookingKeys = useMemo(() => 
    Object.keys(grouped).sort((a, b) => b.localeCompare(a)), 
  [grouped]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-emerald-500" /></div>;

  return (
    <div className="space-y-6">
      {sortedBookingKeys.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-3xl border border-dashed border-gray-300 dark:border-gray-700">
          <ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-4 opacity-50" />
          <p className="text-gray-500 font-bold uppercase text-xs tracking-widest">Nenhum histórico de envio encontrado</p>
          <p className="text-xs text-gray-400 mt-2">O job noturno às 23:50 processará as novas fichas.</p>
        </div>
      ) : (
        sortedBookingKeys.map(bn => (
          <div key={bn} className="space-y-3">
            <div className="flex items-center gap-3 px-1">
              <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter leading-none mb-0.5">Reserva Erbon</p>
                <p className="text-sm font-black text-slate-800 dark:text-white leading-none tracking-tight">#{bn}</p>
              </div>
              <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              {grouped[bn].map(log => <LogRow key={log.id} log={log} onReenviar={handleReenviar} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TabPendentes({ hotelId }: { hotelId: string }) {
  const { addNotification } = useNotification();
  const [fichas, setFichas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPendentes = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Buscar fichas assinadas recentes
      const { data: rawFichas, error: fErr } = await supabase
        .from('wci_checkin_fichas')
        .select('id, booking_number, guest_name, checkin_date, created_at')
        .eq('hotel_id', hotelId)
        .order('created_at', { ascending: false })
        .limit(60);
      if (fErr) throw fErr;

      // 2. Buscar números de reserva que já tiveram sucesso
      const { data: sentLogs } = await supabase
        .from('fnrh_sync_log')
        .select('numero_reserva')
        .eq('hotel_id', hotelId)
        .eq('status', 'SUCESSO')
        .eq('action', 'CHECKIN');

      const sentReservas = new Set((sentLogs || []).map(l => l.numero_reserva).filter(Boolean));
      const pending = (rawFichas || []).filter(f => !sentReservas.has(f.booking_number));
      
      setFichas(pending);
    } catch (e: any) {
      addNotification('Falha ao processar lista de pendências.', 'error');
    } finally {
      setLoading(false);
    }
  }, [hotelId, addNotification]);

  useEffect(() => { loadPendentes(); }, [loadPendentes]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-emerald-500" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Aguardando Transmissão</h3>
        </div>
        <button onClick={loadPendentes} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
          <RefreshCw size={14} className="text-blue-500" />
        </button>
      </div>

      {fichas.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-3xl border border-dashed border-gray-300 dark:border-gray-700">
           <CheckCircle className="w-10 h-10 text-emerald-500/40 mx-auto mb-3" />
           <p className="text-gray-500 font-bold uppercase text-[10px] tracking-widest">Tudo em dia! Nenhuma ficha pendente.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {fichas.map(f => (
            <div key={f.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between shadow-sm hover:border-emerald-500/50 transition-all">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase mb-0.5">Reserva #{f.booking_number || '???'}</p>
                <h4 className="font-bold text-gray-900 dark:text-white truncate uppercase text-sm tracking-tight">{f.guest_name}</h4>
                <p className="text-[9px] text-gray-500 font-bold mt-1 uppercase">Assinado {new Date(f.created_at).toLocaleDateString('pt-BR')}</p>
              </div>
              <button onClick={() => addNotification('O sistema enviará esta ficha hoje à noite. Envio manual em lote em desenvolvimento.', 'info')}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase shadow-lg shadow-emerald-600/20 active:scale-95 transition-all">
                Enviar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabConsulta({ hotelId }: { hotelId: string }) {
  const { addNotification } = useNotification();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  
  // Datas padrão: últimos 10 dias (otimizado para evitar timeouts)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 10);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  
  const isDark = document.documentElement.classList.contains('dark');

  const handleConsultar = useCallback(async (pg: number = page) => {
    const cfg = await fnrhService.getConfig(hotelId);
    if (!cfg?.is_active) { 
      addNotification('A integração FNRH não está ativa para este hotel.', 'error'); 
      return; 
    }

    // Validação de intervalo (Máx 31 dias recomendado pelo SERPRO para performance)
    const d1 = new Date(dateFrom);
    const d2 = new Date(dateTo);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > 31) {
      addNotification('Por favor, selecione um período de no máximo 31 dias para evitar lentidão.', 'warning');
      return;
    }

    setLoading(true);
    setData(null);
    try {
      const result = await fnrhService.consultarFichas(cfg, { 
        page_number: pg, 
        status: statusFilter || undefined,
        data_inicial: dateFrom || undefined,
        data_final:   dateTo   || undefined
      });
      setData(result);
    } catch (e: any) {
      if (e.message?.includes('504') || e.message?.includes('Timeout')) {
        addNotification('O servidor do Governo demorou muito para responder (Timeout). Tente um período menor ou aguarde alguns instantes.', 'error');
      } else {
        addNotification('Falha ao consultar Governo. Verifique suas credenciais ou o período.', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [hotelId, page, statusFilter, dateFrom, dateTo, addNotification]);

  // Consulta automática ao carregar o componente
  useEffect(() => {
    handleConsultar(1);
  }, [hotelId]);

  const govRecords = (data?.dados || []) as FNRHGovRecord[];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 p-6 space-y-4 shadow-sm">
        <h3 className="text-sm font-black text-gray-700 dark:text-gray-200 flex items-center gap-2 uppercase tracking-widest"><Search className="w-4 h-4 text-emerald-500" /> Consulta no Governo</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          <div><label className={labelCls}>Página</label><input type="number" min={1} className={inputCls} value={page} onChange={e => setPage(Number(e.target.value) || 1)} /></div>
          <div><label className={labelCls}>Status Ficha</label><select className={inputCls} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>{CONSULTA_STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
          <div><label className={labelCls}>Data Inicial</label><input type="date" className={inputCls} value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
          <div><label className={labelCls}>Data Final</label><input type="date" className={inputCls} value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap gap-3 items-center pt-2">
          <button onClick={() => { setPage(1); handleConsultar(1); }} disabled={loading} className={btnPrimary}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Consultar</button>
          {pagination && <div className="text-[10px] font-black text-gray-400 uppercase bg-gray-100 dark:bg-gray-900 px-3 py-1.5 rounded-full">Total: {pagination.TotalRegistros}</div>}
          {data && (
            <div className="flex gap-2 ml-auto">
              <button disabled={loading || page <= 1} onClick={() => { const p = page - 1; setPage(p); handleConsultar(p); }} className={btnSecondary}>←</button>
              <button disabled={loading || (pagination && page >= pagination.TotalPaginas)} onClick={() => { const p = page + 1; setPage(p); handleConsultar(p); }} className={btnSecondary}>→</button>
            </div>
          )}
        </div>
      </div>
      {loading ? <div className="flex justify-center py-12"><Loader2 className="w-10 h-10 animate-spin text-emerald-500" /></div> : govRecords.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-in fade-in slide-in-from-bottom-4 duration-500">{govRecords.map(record => <GovRecordCard key={record.Id} record={record} isDark={isDark} />)}</div>
      ) : data && <div className="text-center py-16 text-gray-500 font-bold uppercase text-xs tracking-widest">Nenhum registro encontrado para este filtro.</div>}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function FNRHReception() {
  const { selectedHotel } = useHotel();
  const [activeTab, setActiveTab] = useState<TabId>('logs');

  if (!selectedHotel) return (
    <div className="max-w-5xl mx-auto px-4 py-20 text-center">
      <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
      <p className="text-gray-500 font-black uppercase tracking-widest text-xs">Selecione um hotel para gerenciar FNRH</p>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20"><FileText className="w-6 h-6 text-white" /></div>
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">FNRH Gov — Fichas</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">Sincronização oficial com o Governo Federal (SERPRO)</p>
        </div>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-700 flex gap-1 overflow-x-auto no-scrollbar">
        {[
          { id: 'logs',      label: 'Fichas Enviadas', icon: <ClipboardList className="w-4 h-4" /> },
          { id: 'pendentes', label: 'Pendentes de Envio', icon: <Clock className="w-4 h-4" /> },
          { id: 'consulta',  label: 'Consulta Gov',    icon: <Search className="w-4 h-4" /> }
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as TabId)}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-black uppercase tracking-widest border-b-2 transition-all whitespace-nowrap ${
              activeTab === tab.id ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-gray-400 dark:hover:text-gray-300'
            }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6 animate-in fade-in duration-300">
        {activeTab === 'logs'      && <TabLogs      hotelId={selectedHotel.id} />}
        {activeTab === 'pendentes' && <TabPendentes hotelId={selectedHotel.id} />}
        {activeTab === 'consulta'  && <TabConsulta  hotelId={selectedHotel.id} />}
      </div>
    </div>
  );
}
