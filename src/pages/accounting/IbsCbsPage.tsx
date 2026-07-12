// src/pages/accounting/IbsCbsPage.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Calculator, ChevronLeft, ChevronRight, Loader2, AlertTriangle,
  Plus, Trash2, RefreshCw, TrendingUp, TrendingDown, Minus,
  Receipt, Building2, Check, X, Info, BarChart2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  accountingService, PeriodSummary, PurchaseCreditRow, IbsCbsUsage,
} from '../../lib/accountingService';
import { nfService } from '../../lib/nfService';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { formatCnpj } from '../../lib/supplierService';

// ── helpers ───────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

;

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try { return format(parseISO(s), 'dd/MM/yyyy'); } catch { return s; }
}

const MONTHS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

// ── Summary card ─────────────────────────────────────────────────────────────

interface CardProps {
  label: string;
  value: number;
  sub?: string;
  color?: 'default' | 'green' | 'red' | 'blue' | 'amber';
  icon?: React.ReactNode;
}

function SummaryCard({ label, value, sub, color = 'default', icon }: CardProps) {
  const colors = {
    default: 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700',
    green:   'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
    red:     'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    blue:    'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    amber:   'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  };
  const textColors = {
    default: 'text-gray-900 dark:text-white',
    green:   'text-emerald-700 dark:text-emerald-300',
    red:     'text-red-700 dark:text-red-300',
    blue:    'text-blue-700 dark:text-blue-300',
    amber:   'text-amber-700 dark:text-amber-300',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 leading-tight">{label}</p>
        {icon && <span className={`shrink-0 opacity-60 ${textColors[color]}`}>{icon}</span>}
      </div>
      <p className={`text-xl font-bold tabular-nums ${textColors[color]}`}>{fmtBRL(value)}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Usage modal ───────────────────────────────────────────────────────────────

interface UsageModalProps {
  hotelId: string;
  periodYear: number;
  periodMonth: number;
  ibsAvailable: number;
  cbsAvailable: number;
  onClose: () => void;
  onSaved: () => void;
}

function UsageModal({
  hotelId, periodYear, periodMonth,
  ibsAvailable, cbsAvailable,
  onClose, onSaved,
}: UsageModalProps) {
  const { addNotification } = useNotification();
  const [form, setForm] = useState({
    usage_date: new Date().toISOString().split('T')[0],
    period_month: periodMonth,
    period_year: periodYear,
    ibs_used: '',
    cbs_used: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ibsVal = parseFloat(form.ibs_used.replace(',', '.')) || 0;
  const cbsVal = parseFloat(form.cbs_used.replace(',', '.')) || 0;
  const ibsRem = ibsAvailable - ibsVal;
  const cbsRem = cbsAvailable - cbsVal;

  const handleSave = async () => {
    setError('');
    if (ibsVal <= 0 && cbsVal <= 0) { setError('Informe ao menos um valor de IBS ou CBS'); return; }
    if (ibsVal > ibsAvailable) { setError(`IBS disponível: ${fmtBRL(ibsAvailable)}`); return; }
    if (cbsVal > cbsAvailable) { setError(`CBS disponível: ${fmtBRL(cbsAvailable)}`); return; }
    setSaving(true);
    try {
      await accountingService.addUsage(hotelId, {
        usage_date:   form.usage_date,
        period_month: Number(form.period_month),
        period_year:  Number(form.period_year),
        ibs_used:     ibsVal,
        cbs_used:     cbsVal,
        description:  form.description || null,
      } as any);
      addNotification('Uso registrado!', 'success');
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  // Prevent body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-6">
        <div
          className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl flex flex-col my-4"
          style={{ maxHeight: 'calc(100dvh - 2rem)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Calculator className="w-4 h-4 text-teal-500 shrink-0" />
              Registrar Uso de Crédito
            </h2>
            <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

            {/* Available info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-teal-50 dark:bg-teal-900/20 rounded-xl p-3 text-center border border-teal-100 dark:border-teal-800">
                <p className="text-xs text-teal-600 dark:text-teal-400 font-medium mb-1">IBS Disponível</p>
                <p className="text-base font-bold text-teal-700 dark:text-teal-300 tabular-nums">{fmtBRL(ibsAvailable)}</p>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-3 text-center border border-purple-100 dark:border-purple-800">
                <p className="text-xs text-purple-600 dark:text-purple-400 font-medium mb-1">CBS Disponível</p>
                <p className="text-base font-bold text-purple-700 dark:text-purple-300 tabular-nums">{fmtBRL(cbsAvailable)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label-sm">Data do Uso</label>
                <input type="date" className="input-field" value={form.usage_date} onChange={e => setForm(f => ({ ...f, usage_date: e.target.value }))} />
              </div>
              <div>
                <label className="label-sm">Período de Referência</label>
                <div className="flex gap-1">
                  <select className="input-field" value={form.period_month} onChange={e => setForm(f => ({ ...f, period_month: Number(e.target.value) }))}>
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m.slice(0, 3)}</option>)}
                  </select>
                  <input type="number" className="input-field w-24 shrink-0" value={form.period_year} onChange={e => setForm(f => ({ ...f, period_year: Number(e.target.value) }))} min={2024} max={2099} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-sm">IBS a Utilizar (R$)</label>
                <input type="text" inputMode="decimal" className="input-field" placeholder="0,00"
                  value={form.ibs_used} onChange={e => setForm(f => ({ ...f, ibs_used: e.target.value }))} />
                {ibsVal > 0 && (
                  <p className={`text-xs mt-1 ${ibsRem < 0 ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    Restará: {fmtBRL(Math.max(0, ibsRem))}
                  </p>
                )}
              </div>
              <div>
                <label className="label-sm">CBS a Utilizar (R$)</label>
                <input type="text" inputMode="decimal" className="input-field" placeholder="0,00"
                  value={form.cbs_used} onChange={e => setForm(f => ({ ...f, cbs_used: e.target.value }))} />
                {cbsVal > 0 && (
                  <p className={`text-xs mt-1 ${cbsRem < 0 ? 'text-red-500' : 'text-purple-600 dark:text-purple-400'}`}>
                    Restará: {fmtBRL(Math.max(0, cbsRem))}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="label-sm">Descrição / Referência</label>
              <input type="text" className="input-field" placeholder="Ex: DARF competência Jun/2025"
                value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-4 h-4 shrink-0" />{error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-5 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 shrink-0 rounded-b-2xl">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 flex items-center gap-2 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Registrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Yearly bar chart (mini) ───────────────────────────────────────────────────

interface YearBarProps {
  month: number;
  ibs: number;
  cbs: number;
  maxVal: number;
  active: boolean;
  onClick: () => void;
}

function YearBar({ month, ibs, cbs, maxVal, active, onClick }: YearBarProps) {
  const ibsPct = maxVal > 0 ? (ibs / maxVal) * 100 : 0;
  const cbsPct = maxVal > 0 ? (cbs / maxVal) * 100 : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-1.5 rounded-xl transition-colors min-w-0 ${
        active ? 'bg-teal-50 dark:bg-teal-900/30 ring-1 ring-teal-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      <div className="flex items-end gap-0.5 h-10 w-full">
        <div className="flex-1 rounded-t-sm bg-teal-400 dark:bg-teal-500 transition-all" style={{ height: `${ibsPct}%`, minHeight: ibsPct > 0 ? 2 : 0 }} />
        <div className="flex-1 rounded-t-sm bg-purple-400 dark:bg-purple-500 transition-all" style={{ height: `${cbsPct}%`, minHeight: cbsPct > 0 ? 2 : 0 }} />
      </div>
      <span className={`text-[10px] font-medium ${active ? 'text-teal-700 dark:text-teal-300' : 'text-gray-500 dark:text-gray-400'}`}>
        {MONTHS[month - 1].slice(0, 3)}
      </span>
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type Tab = 'credits' | 'usage';

export default function IbsCbsPage() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [summary,  setSummary]  = useState<PeriodSummary | null>(null);
  const [yearly,   setYearly]   = useState<any[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [tab,      setTab]      = useState<Tab>('credits');
  const [modal,    setModal]    = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [linking,  setLinking]  = useState(false);

  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true); setError('');
    try {
      const [s, y] = await Promise.all([
        accountingService.getPeriodSummary(selectedHotel.id, year, month),
        accountingService.getYearlySummary(selectedHotel.id, year),
      ]);
      setSummary(s); setYearly(y);
    } catch (err: any) {
      setError(err.message ?? 'Erro ao carregar dados');
    } finally { setLoading(false); }
  }, [selectedHotel?.id, year, month]);

  useEffect(() => { load(); }, [load]);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const handleRetroCheck = async () => {
    if (!selectedHotel?.id || linking) return;
    setLinking(true);
    try {
      const linked = await nfService.linkReceivedToPurchases(selectedHotel.id);
      addNotification(
        linked > 0
          ? `${linked} NF(s) vinculada(s) retroativamente às compras.`
          : 'Nenhuma NF nova para vincular — tudo já sincronizado.',
        'success',
      );
      await load();
    } catch (err: any) {
      addNotification(err.message ?? 'Erro na verificação retroativa', 'error');
    } finally { setLinking(false); }
  };

  const handleDelete = async (usage: IbsCbsUsage) => {
    if (!window.confirm('Remover este registro de uso?')) return;
    setDeleting(usage.id);
    try {
      await accountingService.deleteUsage(usage.id);
      addNotification('Registro removido.', 'success');
      load();
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally { setDeleting(null); }
  };

  const yearlyMax = Math.max(...yearly.map(m => Math.max(m.ibs_credit, m.cbs_credit)), 1);

  if (!selectedHotel?.id) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Selecione um hotel para ver os créditos.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Period navigation ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-xl bg-white dark:bg-gray-800 border dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="min-w-[160px] text-center">
            <p className="text-lg font-bold text-gray-900 dark:text-white capitalize">
              {MONTHS[month - 1]} {year}
            </p>
          </div>
          <button onClick={nextMonth} className="p-2 rounded-xl bg-white dark:bg-gray-800 border dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm">
            <ChevronRight className="w-4 h-4" />
          </button>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="input-field w-24 text-sm">
            {Array.from({ length: 10 }, (_, i) => now.getFullYear() - 2 + i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRetroCheck}
            disabled={linking || loading}
            title="Vincula NFs recebidas às compras já registradas e atualiza os créditos"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border dark:border-gray-700 text-teal-700 dark:text-teal-300 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors shadow-sm disabled:opacity-50"
          >
            {linking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Receipt className="w-3.5 h-3.5" />}
            Verificação Retroativa
          </button>
          <button onClick={load} disabled={loading} className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* ── Yearly mini chart ──────────────────────────────────────────── */}
          {yearly.some(m => m.ibs_credit > 0 || m.cbs_credit > 0) && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="w-4 h-4 text-teal-500" />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Visão Anual {year}</p>
                <div className="flex items-center gap-3 ml-auto text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-teal-400 inline-block" />IBS</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-400 inline-block" />CBS</span>
                </div>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {yearly.map(m => (
                  <YearBar
                    key={m.month}
                    month={m.month}
                    ibs={m.ibs_credit}
                    cbs={m.cbs_credit}
                    maxVal={yearlyMax}
                    active={m.month === month}
                    onClick={() => setMonth(m.month)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Summary cards ──────────────────────────────────────────────── */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <SummaryCard
                label="Compras com Crédito"
                value={summary.total_purchases_amount}
                sub={`${summary.purchases_count} compra${summary.purchases_count !== 1 ? 's' : ''}`}
                icon={<Receipt className="w-4 h-4" />}
              />
              <SummaryCard
                label="Crédito IBS Gerado"
                value={summary.ibs_total}
                color="blue"
                icon={<TrendingUp className="w-4 h-4" />}
              />
              <SummaryCard
                label="Crédito CBS Gerado"
                value={summary.cbs_total}
                color="blue"
                icon={<TrendingUp className="w-4 h-4" />}
              />
              <SummaryCard
                label="IBS Utilizado"
                value={summary.ibs_used}
                color={summary.ibs_used > 0 ? 'amber' : 'default'}
                icon={<TrendingDown className="w-4 h-4" />}
              />
              <SummaryCard
                label="CBS Utilizado"
                value={summary.cbs_used}
                color={summary.cbs_used > 0 ? 'amber' : 'default'}
                icon={<TrendingDown className="w-4 h-4" />}
              />
              <SummaryCard
                label="IBS + CBS Disponível"
                value={summary.ibs_available + summary.cbs_available}
                sub={`IBS ${fmtBRL(summary.ibs_available)} · CBS ${fmtBRL(summary.cbs_available)}`}
                color={summary.ibs_available + summary.cbs_available > 0 ? 'green' : 'default'}
                icon={<Calculator className="w-4 h-4" />}
              />
            </div>
          )}

          {/* ── Tabs ───────────────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 overflow-hidden">

            {/* Tab bar */}
            <div className="flex items-center justify-between border-b dark:border-gray-700 px-4">
              <div className="flex">
                {([
                  { key: 'credits' as Tab, label: 'Créditos por Compra' },
                  { key: 'usage'   as Tab, label: 'Uso de Créditos' },
                ] as const).map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      tab === t.key
                        ? 'border-teal-500 text-teal-700 dark:text-teal-300'
                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {t.label}
                    {t.key === 'credits' && summary && summary.rows.length > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">
                        {summary.rows.length}
                      </span>
                    )}
                    {t.key === 'usage' && summary && summary.usages.length > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                        {summary.usages.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {tab === 'usage' && (
                <button
                  onClick={() => setModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Registrar Uso
                </button>
              )}
            </div>

            {/* ── Credits tab ────────────────────────────────────────────── */}
            {tab === 'credits' && (
              <div className="overflow-x-auto">
                {!summary || summary.rows.length === 0 ? (
                  <div className="py-14 text-center">
                    <Info className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Nenhuma NF lançada com crédito neste período.</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Só entram no cálculo as entradas de mercadoria sincronizadas com uma NF recebida marcada como "lançada". Vincule o fornecedor na compra e informe as alíquotas IBS/CBS no cadastro do fornecedor.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-900/40 text-left">
                        {['Data','NF','Fornecedor','CNPJ','Valor Compra','Créd. IBS','Créd. CBS'].map(h => (
                          <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {summary.rows.map((row: PurchaseCreditRow) => (
                        <tr key={row.purchase_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-400">{fmtDate(row.purchase_date)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {row.nf_numero
                              ? <span className="text-xs font-mono text-gray-700 dark:text-gray-300" title={row.nf_chave || undefined}>{row.nf_numero}</span>
                              : <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900 dark:text-white truncate max-w-[180px]">{row.supplier_name}</p>
                            {row.supplier_razao && row.supplier_razao !== row.supplier_name && (
                              <p className="text-xs text-gray-400 truncate max-w-[180px]">{row.supplier_razao}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {row.supplier_cnpj ? (
                              <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{formatCnpj(row.supplier_cnpj)}</span>
                            ) : '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right font-mono font-medium text-gray-900 dark:text-white">
                            {fmtBRL(row.total_amount)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right font-mono font-semibold text-teal-700 dark:text-teal-300">
                            {row.ibs_credit > 0 ? fmtBRL(row.ibs_credit) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right font-mono font-semibold text-purple-700 dark:text-purple-300">
                            {row.cbs_credit > 0 ? fmtBRL(row.cbs_credit) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* Totals footer */}
                    {summary.rows.length > 1 && (
                      <tfoot>
                        <tr className="bg-gray-50 dark:bg-gray-900/40 font-semibold">
                          <td colSpan={4} className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                            Total — {summary.rows.length} compras
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-900 dark:text-white">
                            {fmtBRL(summary.total_purchases_amount)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-teal-700 dark:text-teal-300">
                            {fmtBRL(summary.ibs_total)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-purple-700 dark:text-purple-300">
                            {fmtBRL(summary.cbs_total)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
              </div>
            )}

            {/* ── Usage tab ──────────────────────────────────────────────── */}
            {tab === 'usage' && (
              <div>
                {!summary || summary.usages.length === 0 ? (
                  <div className="py-14 text-center">
                    <Minus className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Nenhum uso registrado neste período.</p>
                    <button onClick={() => setModal(true)} className="mt-3 text-sm text-teal-600 hover:underline flex items-center gap-1 mx-auto">
                      <Plus className="w-4 h-4" /> Registrar primeiro uso
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-900/40 text-left">
                          {['Data','Período','IBS Utilizado','CBS Utilizado','Descrição',''].map(h => (
                            <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {summary.usages.map((u: IbsCbsUsage) => (
                          <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-400">{fmtDate(u.usage_date)}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                              {MONTHS[u.period_month - 1]}/{u.period_year}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right font-mono font-semibold text-teal-700 dark:text-teal-300">
                              {u.ibs_used > 0 ? fmtBRL(u.ibs_used) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right font-mono font-semibold text-purple-700 dark:text-purple-300">
                              {u.cbs_used > 0 ? fmtBRL(u.cbs_used) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">
                              {u.description || <span className="text-gray-300 dark:text-gray-600 italic">sem descrição</span>}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => handleDelete(u)}
                                disabled={deleting === u.id}
                                className="p-1.5 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {deleting === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {summary.usages.length > 1 && (
                        <tfoot>
                          <tr className="bg-gray-50 dark:bg-gray-900/40 font-semibold">
                            <td colSpan={2} className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide">
                              Total utilizado
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-teal-700 dark:text-teal-300">
                              {fmtBRL(summary.ibs_used)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-purple-700 dark:text-purple-300">
                              {fmtBRL(summary.cbs_used)}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Usage modal */}
      {modal && summary && (
        <UsageModal
          hotelId={selectedHotel.id}
          periodYear={year}
          periodMonth={month}
          ibsAvailable={summary.ibs_available}
          cbsAvailable={summary.cbs_available}
          onClose={() => setModal(false)}
          onSaved={() => { setModal(false); load(); }}
        />
      )}
    </div>
  );
}
