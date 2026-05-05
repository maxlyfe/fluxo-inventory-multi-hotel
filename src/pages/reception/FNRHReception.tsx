// src/pages/reception/FNRHReception.tsx
// Fichas Enviadas + Consulta Gov — acessível pela recepção (módulo 'reception')

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText, ClipboardList, Search,
  Loader2, CheckCircle, XCircle, AlertTriangle, RefreshCw,
  ChevronDown, ChevronUp, RotateCcw, Clock, Filter,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { fnrhService, FNRHSyncLog } from '../../lib/fnrhService';

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

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'logs' | 'consulta';

// ── Status options for Consulta Gov ──────────────────────────────────────────

const CONSULTA_STATUS_OPTIONS = [
  { value: '',                    label: 'Todos os status' },
  { value: 'CHECKIN_REALIZADO',   label: 'Check-in Realizado' },
  { value: 'CHECKOUT_REALIZADO',  label: 'Check-out Realizado' },
  { value: 'NOSHOW',              label: 'No-Show' },
  { value: 'PENDENTE',            label: 'Pendente' },
  { value: 'CANCELADO',           label: 'Cancelado' },
  { value: 'ATIVO',               label: 'Ativo' },
];

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  SUCESSO:          { label: 'Sucesso',           cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',   icon: <CheckCircle className="w-3 h-3" /> },
  CHECKOUT_ENVIADO: { label: 'Check-out Enviado', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',      icon: <CheckCircle className="w-3 h-3" /> },
  PENDENTE:         { label: 'Pendente',          cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',   icon: <Clock className="w-3 h-3" /> },
  ERRO:             { label: 'Erro',              cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',           icon: <XCircle className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${m[action] ?? 'bg-gray-100 text-gray-600'}`}>
      {action}
    </span>
  );
}

// ── JSON viewer ───────────────────────────────────────────────────────────────

function JsonBlock({ label, data }: { label: string; data: unknown }) {
  if (!data) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <pre className="text-[11px] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 overflow-x-auto text-gray-700 dark:text-gray-300 leading-relaxed max-h-64">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

// ── Log row ───────────────────────────────────────────────────────────────────

function LogRow({
  log,
  onReenviar,
}: {
  log: FNRHSyncLog;
  onReenviar: (id: string) => void;
}) {
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
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
        <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{dateLabel}</span>
        <ActionBadge action={log.action} />
        <StatusBadge status={log.status} />
        <span className="font-medium text-sm text-gray-800 dark:text-gray-100 flex-1 min-w-[120px] truncate">
          {log.guest_name || '—'}
        </span>
        {log.numero_reserva && (
          <span className="text-xs text-gray-400 dark:text-gray-500">Res. #{log.numero_reserva}</span>
        )}
        {log.guest_document && (
          <span className="text-xs text-gray-400 dark:text-gray-500">{log.guest_document}</span>
        )}
        {log.retry_count > 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500">{log.retry_count} tentativa(s)</span>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {canResend && (
            <button
              type="button"
              onClick={handleReenviar}
              disabled={sending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold border border-amber-200 dark:border-amber-700/40 transition-colors disabled:opacity-60"
            >
              {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              Reenviar
            </button>
          )}
          <button type="button" onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-4 space-y-4">
          {log.error_detail && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="text-xs text-red-700 dark:text-red-300 space-y-0.5">
                {(log.error_detail as any).code    && <p><strong>Código:</strong> {(log.error_detail as any).code}</p>}
                {(log.error_detail as any).message && <p><strong>Mensagem:</strong> {(log.error_detail as any).message}</p>}
                {(log.error_detail as any).body    && (
                  <pre className="whitespace-pre-wrap break-all mt-1 text-[11px]">{(log.error_detail as any).body}</pre>
                )}
              </div>
            </div>
          )}
          {log.fnrh_reserva_id && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <strong>FNRH Reserva ID:</strong> {log.fnrh_reserva_id}
              {log.fnrh_hospede_id && <> · <strong>Hóspede ID:</strong> {log.fnrh_hospede_id}</>}
              {log.fnrh_pessoa_id  && <> · <strong>Pessoa ID:</strong>  {log.fnrh_pessoa_id}</>}
            </p>
          )}
          <JsonBlock label="Payload enviado" data={log.request_payload} />
          <JsonBlock label="Resposta da API"  data={log.response_payload} />
        </div>
      )}
    </div>
  );
}

// ── Tab: Fichas Enviadas (Logs Grouped) ───────────────────────────────────────

function TabLogs({ hotelId }: { hotelId: string }) {
  const { addNotification } = useNotification();
  const [logs,         setLogs]    = useState<FNRHSyncLog[]>([]);
  const [loading,      setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom,     setDateFrom] = useState('');
  const [dateTo,       setDateTo]   = useState('');

  const loadLogs = useCallback(async (opts?: { status?: string; from?: string; to?: string }) => {
    setLoading(true);
    try {
      const s  = opts?.status !== undefined ? opts.status : filterStatus;
      const fi = opts?.from   !== undefined ? opts.from   : dateFrom;
      const ft = opts?.to     !== undefined ? opts.to     : dateTo;
      const data = await fnrhService.buscarLogs(hotelId, {
        status:     s  || undefined,
        dataInicio: fi || undefined,
        dataFim:    ft || undefined,
        limit:      200,
      });
      setLogs(data);
    } catch (e: any) {
      addNotification(e.message || 'Erro ao carregar logs', 'error');
    } finally {
      setLoading(false);
    }
  }, [hotelId, filterStatus, dateFrom, dateTo]);

  useEffect(() => { loadLogs(); }, [hotelId]);

  async function handleReenviar(logId: string) {
    try {
      await fnrhService.reenviar(logId, hotelId);
      addNotification('Reenvio realizado com sucesso!', 'success');
      loadLogs();
    } catch (e: any) {
      addNotification(e.message || 'Erro no reenvio', 'error');
    }
  }

  // Agrupar logs por número de reserva
  const grouped = logs.reduce((acc, log) => {
    const key = log.numero_reserva || 'Sem Reserva';
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {} as Record<string, FNRHSyncLog[]>);

  const bookingNumbers = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">Todos</option>
              <option value="SUCESSO">Sucesso</option>
              <option value="CHECKOUT_ENVIADO">Check-out Enviado</option>
              <option value="PENDENTE">Pendente</option>
              <option value="ERRO">Erro</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>De</label>
            <input type="date" className={inputCls} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Até</label>
            <input type="date" className={inputCls} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => loadLogs()} disabled={loading} className={`${btnPrimary} flex-1`}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
              Filtrar
            </button>
            <button type="button" onClick={() => loadLogs()} disabled={loading}
              title="Atualizar" className={btnSecondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16">
          <div className="inline-flex p-4 rounded-2xl bg-gray-100 dark:bg-gray-800 mb-3">
            <ClipboardList className="w-8 h-8 text-gray-300 dark:text-gray-600" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 font-medium">Nenhum log encontrado</p>
        </div>
      ) : (
        <div className="space-y-6">
          {bookingNumbers.map(bn => (
            <div key={bn} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reserva</span>
                <span className="text-sm font-black text-blue-600 dark:text-blue-400">#{bn}</span>
                <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800 ml-2" />
              </div>
              <div className="space-y-2">
                {grouped[bn].map(log => (
                  <LogRow key={log.id} log={log} onReenviar={handleReenviar} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Pendentes (Unsent Checkins) ──────────────────────────────────────────

function TabPendentes({ hotelId }: { hotelId: string }) {
  const { addNotification } = useNotification();
  const [fichas, setFichas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPendentes = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Buscar fichas assinadas recentes (últimos 3 dias)
      const { data: rawFichas, error: fErr } = await supabase
        .from('wci_checkin_fichas')
        .select(`
          id, booking_number, guest_name, checkin_date, created_at,
          wci_checkin_guests(*)
        `)
        .eq('hotel_id', hotelId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (fErr) throw fErr;

      // 2. Buscar logs de SUCESSO para filtrar o que já foi enviado
      const { data: sentLogs } = await supabase
        .from('fnrh_sync_log')
        .select('numero_reserva, status')
        .eq('hotel_id', hotelId)
        .eq('status', 'SUCESSO')
        .eq('action', 'CHECKIN');

      const sentReservas = new Set((sentLogs || []).map(l => l.numero_reserva));
      
      // 3. Filtrar apenas o que não tem log de sucesso
      const pending = (rawFichas || []).filter(f => !sentReservas.has(f.booking_number));
      setFichas(pending);
    } catch (e: any) {
      addNotification('Erro ao buscar fichas pendentes', 'error');
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => { loadPendentes(); }, [hotelId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">Fichas assinadas aguardando transmissão</h3>
        <button onClick={loadPendentes} className="text-xs text-blue-600 font-bold uppercase hover:underline">Atualizar</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>
      ) : fichas.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
           <p className="text-gray-500 dark:text-gray-400">Nenhuma ficha pendente de envio encontrada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {fichas.map(f => (
            <div key={f.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-black text-blue-600 dark:text-blue-400 uppercase tracking-tighter mb-0.5">Reserva #{f.booking_number || '—'}</p>
                <h4 className="font-bold text-gray-900 dark:text-white truncate">{f.guest_name}</h4>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold">
                  {f.wci_checkin_guests?.length || 0} hóspede(s) • Assinado em {new Date(f.created_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                 <button 
                  onClick={() => addNotification('Envio manual em lote em desenvolvimento. O job noturno processará esta ficha às 23:50.', 'info')}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold shadow-sm hover:bg-emerald-700 transition-all"
                 >
                   Enviar ao Gov
                 </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Consulta Gov ─────────────────────────────────────────────────────────

// ── Main ──────────────────────────────────────────────────────────────────────

type TabId = 'logs' | 'pendentes' | 'consulta';

export default function FNRHReception() {
  const { selectedHotel } = useHotel();
  const [activeTab, setActiveTab] = useState<TabId>('logs');

  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'logs',      label: 'Fichas Enviadas', icon: <ClipboardList className="w-4 h-4" /> },
    { id: 'pendentes', label: 'Pendentes de Envio', icon: <Clock className="w-4 h-4" /> },
    { id: 'consulta',  label: 'Consulta Gov',    icon: <Search        className="w-4 h-4" /> },
  ];

  if (!selectedHotel) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10 text-center">
        <p className="text-gray-500 dark:text-gray-400">Selecione um hotel para ver as fichas FNRH.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 shrink-0">
          <FileText className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">FNRH Gov — Fichas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Gerencie o envio de fichas ao Governo e consulte o status em tempo real.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'logs'      && <TabLogs      hotelId={selectedHotel.id} />}
        {activeTab === 'pendentes' && <TabPendentes hotelId={selectedHotel.id} />}
        {activeTab === 'consulta'  && <TabConsulta  hotelId={selectedHotel.id} />}
      </div>
    </div>
  );
}
