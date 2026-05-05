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

// ── Tab: Fichas Enviadas (Logs) ───────────────────────────────────────────────

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

  const counts = {
    sucesso:  logs.filter(l => l.status === 'SUCESSO' || l.status === 'CHECKOUT_ENVIADO').length,
    pendente: logs.filter(l => l.status === 'PENDENTE').length,
    erro:     logs.filter(l => l.status === 'ERRO').length,
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Enviados',  count: counts.sucesso,  cls: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
          { label: 'Pendentes', count: counts.pendente, cls: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { label: 'Com Erro',  count: counts.erro,     cls: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-900/20'     },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-black ${s.cls}`}>{s.count}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
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

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16">
          <div className="inline-flex p-4 rounded-2xl bg-gray-100 dark:bg-gray-800 mb-3">
            <ClipboardList className="w-8 h-8 text-gray-300 dark:text-gray-600" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 font-medium">Nenhum log encontrado</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Os logs aparecerão aqui após o job noturno ou envios manuais.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <LogRow key={log.id} log={log} onReenviar={handleReenviar} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Consulta Gov ─────────────────────────────────────────────────────────

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

function GovRecordCard({ record, isDark }: { record: FNRHGovRecord; isDark: boolean }) {
  const statusCls = record.Status === 'CHECK_OUT_CONFIRMADO' 
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusCls}`}>
              {record.StatusFichaLabel || record.Status}
            </span>
            <span className="text-[10px] text-gray-400 font-mono">ID: {record.Id.split('-')[0]}...</span>
          </div>
          <h4 className="font-bold text-gray-900 dark:text-white truncate">{record.Nome}</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {record.TipoDocumentoId}: {record.NumeroDocumento} • {record.PaisNacionalidade_id}
            {record.UF && ` • ${record.UF}`}
          </p>
        </div>
        
        <div className="text-right shrink-0">
          <div className="flex flex-col gap-1">
             <div className="flex items-center justify-end gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <Clock className="w-3 h-3 text-emerald-500" />
                <span>In: {new Date(record.CheckinEm).toLocaleDateString('pt-BR')}</span>
             </div>
             <div className="flex items-center justify-end gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <div className="w-3 h-3 border-b border-r border-gray-400" />
                <span>Out: {new Date(record.SaidaPrevistaEm).toLocaleDateString('pt-BR')}</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabConsulta({ hotelId }: { hotelId: string }) {
  const { addNotification } = useNotification();
  const [isDark]         = useState(document.documentElement.classList.contains('dark'));
  const [loading,      setLoading]      = useState(false);
  const [data,         setData]         = useState<any>(null);
  const [page,         setPage]         = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');

  async function handleConsultar(pg: number = page) {
    const cfg = await fnrhService.getConfig(hotelId);
    if (!cfg?.is_active) {
      addNotification('A integração FNRH não está ativa para este hotel. Configure em Admin → FNRH Gov.', 'error');
      return;
    }
    setLoading(true);
    setData(null);
    try {
      const result = await fnrhService.consultarFichas(cfg, {
        page_number:  pg,
        status:       statusFilter || undefined,
        data_inicial: dateFrom     || undefined,
        data_final:   dateTo       || undefined,
      });
      setData(result);
    } catch (e: any) {
      addNotification(e.message || 'Erro ao consultar FNRH Gov', 'error');
    } finally {
      setLoading(false);
    }
  }

  const govRecords = (data?.dados || []) as FNRHGovRecord[];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <Search className="w-4 h-4 text-emerald-500" /> Consultar Fichas no Gov
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>Página</label>
            <input type="number" min={1} className={inputCls} value={page}
              onChange={e => setPage(Number(e.target.value) || 1)} />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select
              className={inputCls}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              {CONSULTA_STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Data Inicial</label>
            <input type="date" className={inputCls} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Data Final</label>
            <input type="date" className={inputCls} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-3 flex-wrap items-center">
          <button type="button" onClick={() => handleConsultar(page)} disabled={loading} className={btnPrimary}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Consultar FNRH Gov
          </button>
          
          {pagination && (
            <span className="text-xs text-gray-500 font-medium">
              Página {pagination.PaginaAtual} de {pagination.TotalPaginas} ({pagination.TotalRegistros} fichas)
            </span>
          )}

          {data && (
            <div className="flex gap-2 ml-auto">
              <button type="button"
                onClick={() => { const p = Math.max(1, page - 1); setPage(p); handleConsultar(p); }}
                disabled={loading || page <= 1} className={btnSecondary}>
                ← Anterior
              </button>
              <button type="button"
                onClick={() => { const p = page + 1; setPage(p); handleConsultar(p); }}
                disabled={loading || (pagination && page >= pagination.TotalPaginas)} className={btnSecondary}>
                Próxima →
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>
      ) : govRecords.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {govRecords.map(record => (
            <GovRecordCard key={record.Id} record={record} isDark={isDark} />
          ))}
        </div>
      ) : data && (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
           <p className="text-gray-500 dark:text-gray-400">Nenhum registro retornado pelo Governo para este filtro.</p>
        </div>
      )}
      
      {/* Botão para ver JSON bruto (debug) */}
      {data && (
        <button 
          onClick={() => console.log('FNRH Raw:', data)}
          className="text-[10px] text-gray-400 hover:text-gray-600 underline block mx-auto"
        >
          Ver dados técnicos no console
        </button>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FNRHReception() {
  const { selectedHotel } = useHotel();
  const [activeTab, setActiveTab] = useState<TabId>('logs');

  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'logs',     label: 'Fichas Enviadas', icon: <ClipboardList className="w-4 h-4" /> },
    { id: 'consulta', label: 'Consulta Gov',    icon: <Search        className="w-4 h-4" /> },
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
            Fichas enviadas ao Governo Federal e consulta na API FNRH SERPRO
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
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
        {activeTab === 'logs'     && <TabLogs     hotelId={selectedHotel.id} />}
        {activeTab === 'consulta' && <TabConsulta hotelId={selectedHotel.id} />}
      </div>
    </div>
  );
}
