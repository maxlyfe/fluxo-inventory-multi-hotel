import React, { useState, useEffect, useCallback } from 'react';
import {
  Repeat, Plus, X, Loader2, AlertTriangle, Trash2, Edit2, Zap, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { recurringService, RecurringExpense } from '../../lib/recurringService';
import { ModalShell } from '../../components/financial/Fornecedores';
import ChartAccountSelect from '../../components/financial/ChartAccountSelect';
import { fmtBRL, fmtDate, SummaryCard, todayISO } from '../../components/financial/shared';
import { supabase } from '../../lib/supabase';

const FREQ_LABELS: Record<string, string> = {
  semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', anual: 'Anual',
};

function supplierName(s: RecurringExpense['suppliers']) {
  if (!s) return null;
  return s.nome_fantasia || s.razao_social || s.nome || null;
}

function TemplateModal({ hotelId, template, onClose, onSaved }: {
  hotelId: string; template?: RecurringExpense; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<RecurringExpense>(template ?? {
    hotel_id: hotelId, description: '', amount: 0, frequency: 'mensal',
    due_day: 5, start_date: todayISO(), active: true,
  });
  const [suppliers, setSuppliers] = useState<{ id: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('suppliers').select('id, nome, nome_fantasia, razao_social').eq('hotel_id', hotelId).order('nome_fantasia')
      .then(({ data }) => {
        setSuppliers((data ?? []).map((s: any) => ({
          id: s.id, label: s.nome_fantasia || s.razao_social || s.nome || '—',
        })));
      });
  }, [hotelId]);

  const set = (k: keyof RecurringExpense, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) { setError('Descrição obrigatória'); return; }
    if (!form.amount || form.amount <= 0) { setError('Valor inválido'); return; }
    setSaving(true); setError('');
    try { await recurringService.save({ ...form, description: form.description.trim() }); onSaved(); }
    catch (err: any) { setError(err.message ?? 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4 flex flex-col" style={{ maxHeight: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Repeat className="w-4 h-4 text-orange-500" /> {template ? 'Editar' : 'Novo'} Gasto Recorrente
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label-sm">Descrição *</label>
              <input className="input-field" value={form.description} onChange={e => set('description', e.target.value)} required placeholder="Aluguel, energia, internet..." />
            </div>
            <div>
              <label className="label-sm">Valor *</label>
              <input className="input-field" type="number" step="0.01" min="0.01" value={form.amount || ''} onChange={e => set('amount', parseFloat(e.target.value) || 0)} required />
            </div>
            <div>
              <label className="label-sm">Frequência</label>
              <select className="input-field" value={form.frequency} onChange={e => set('frequency', e.target.value)}>
                {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label-sm">Dia do vencimento</label>
              <input className="input-field" type="number" min="1" max="31" value={form.due_day} onChange={e => set('due_day', parseInt(e.target.value) || 1)} />
            </div>
            <div>
              <label className="label-sm">Início</label>
              <input className="input-field" type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="label-sm">Fim (opcional)</label>
              <input className="input-field" type="date" value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value || null)} />
            </div>
            <div>
              <label className="label-sm">Fornecedor</label>
              <select className="input-field" value={form.supplier_id ?? ''} onChange={e => set('supplier_id', e.target.value || null)}>
                <option value="">—</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label-sm">Plano de contas</label>
              <ChartAccountSelect hotelId={hotelId} value={form.chart_account_sub_id ?? ''} onChange={v => set('chart_account_sub_id', v || null)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

function GenerateModal({ hotelId, onClose, onDone }: {
  hotelId: string; onClose: () => void; onDone: () => void;
}) {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const n = await recurringService.generateApTitles(hotelId, from, to);
      setResult(n);
      onDone();
    } catch { }
    finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-500" /> Gerar previsão no AP
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-sm">De</label>
              <input className="input-field" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label-sm">Até</label>
              <input className="input-field" type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
          {result !== null && (
            <p className="text-sm text-green-700 dark:text-green-400">{result} título(s) criado(s) no Contas a Pagar.</p>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Fechar</button>
            <button onClick={handleGenerate} disabled={busy} className="px-5 py-2 text-sm bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Gerar
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export default function GastosRecorrentesPage() {
  const { selectedHotel } = useHotel();
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<RecurringExpense | true | null>(null);
  const [genModal, setGenModal] = useState(false);

  const hotelId = selectedHotel?.id;

  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true); setError('');
    try { setItems(await recurringService.list(hotelId)); }
    catch (err: any) { setError(err.message ?? 'Erro ao carregar'); }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (t: RecurringExpense) => {
    if (!window.confirm('Excluir este gasto recorrente? Títulos AP não pagos vinculados também serão removidos.')) return;
    try { await recurringService.delete(t.id!); load(); }
    catch (err: any) { setError(err.message); }
  };

  const handleToggle = async (t: RecurringExpense) => {
    try { await recurringService.save({ ...t, active: !t.active }); load(); }
    catch (err: any) { setError(err.message); }
  };

  const active = items.filter(i => i.active);
  const totalMensal = active.reduce((s, i) => {
    if (i.frequency === 'mensal') return s + Number(i.amount);
    if (i.frequency === 'semanal') return s + Number(i.amount) * 4;
    if (i.frequency === 'quinzenal') return s + Number(i.amount) * 2;
    if (i.frequency === 'anual') return s + Number(i.amount) / 12;
    return s;
  }, 0);

  if (!hotelId) return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Repeat className="h-8 w-8 text-orange-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Gastos Recorrentes</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setGenModal(true)} className="flex items-center gap-2 px-3 py-2 text-sm border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <Zap className="w-4 h-4 text-yellow-500" /> Gerar previsão
          </button>
          <button onClick={() => setModal(true)} className="flex items-center gap-2 px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700">
            <Plus className="w-4 h-4" /> Novo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <SummaryCard label="Templates ativos" value={String(active.length)} color="text-orange-600 dark:text-orange-400" />
        <SummaryCard label="Estimativa mensal" value={fmtBRL(totalMensal)} color="text-red-600 dark:text-red-400" />
        <SummaryCard label="Total cadastrados" value={String(items.length)} color="text-gray-600 dark:text-gray-400" />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Descrição</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-left px-4 py-3">Frequência</th>
                <th className="text-left px-4 py-3">Dia vcto</th>
                <th className="text-left px-4 py-3">Fornecedor</th>
                <th className="text-left px-4 py-3">Plano de contas</th>
                <th className="text-left px-4 py-3">Período</th>
                <th className="text-center px-4 py-3">Ativo</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-gray-500">Nenhum gasto recorrente cadastrado.</td></tr>
              ) : items.map(t => (
                <tr key={t.id} className={`border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${!t.active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{t.description}</td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtBRL(Number(t.amount))}</td>
                  <td className="px-4 py-3">{FREQ_LABELS[t.frequency]}</td>
                  <td className="px-4 py-3">{t.due_day}</td>
                  <td className="px-4 py-3 text-gray-500">{supplierName(t.suppliers) ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{t.chart_of_accounts_sub?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {fmtDate(t.start_date)}{t.end_date ? ` → ${fmtDate(t.end_date)}` : ' →'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleToggle(t)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                      {t.active ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right flex items-center gap-1 justify-end">
                    <button onClick={() => setModal(t)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(t)} className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <TemplateModal
          hotelId={hotelId}
          template={modal === true ? undefined : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
      {genModal && (
        <GenerateModal hotelId={hotelId} onClose={() => setGenModal(false)} onDone={load} />
      )}
    </div>
  );
}
