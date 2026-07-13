import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, X, Loader2, AlertTriangle, Trash2, Send, Copy, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { payrollService, PayrollEntry } from '../../lib/payrollService';
import { ModalShell } from '../../components/financial/Fornecedores';
import ChartAccountSelect from '../../components/financial/ChartAccountSelect';
import { fmtBRL, fmtDate, FinStatusBadge, SummaryCard } from '../../components/financial/shared';

function competenceLabel(c: string) {
  const d = new Date(c + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function getCompetence(offset: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 8) + '01';
}

function EntryModal({ hotelId, entry, employees, onClose, onSaved }: {
  hotelId: string;
  entry?: PayrollEntry;
  employees: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PayrollEntry>(entry ?? {
    hotel_id: hotelId, employee_id: '', competence: getCompetence(0),
    base_salary: 0, encargos: 0, beneficios: 0, descontos: 0,
    due_date: '', status: 'previsto',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof PayrollEntry, v: any) => setForm(f => ({ ...f, [k]: v }));
  const computed = (form.base_salary || 0) + (form.encargos || 0) + (form.beneficios || 0) - (form.descontos || 0);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employee_id) { setError('Selecione um funcionário'); return; }
    if (!form.due_date) { setError('Informe o vencimento'); return; }
    setSaving(true); setError('');
    try { await payrollService.save(form); onSaved(); }
    catch (err: any) { setError(err.message ?? 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4 flex flex-col" style={{ maxHeight: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-500" /> {entry ? 'Editar' : 'Novo'} Lançamento
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label-sm">Funcionário *</label>
              <select className="input-field" value={form.employee_id} onChange={e => set('employee_id', e.target.value)} required>
                <option value="">Selecione...</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label-sm">Salário base</label>
              <input className="input-field" type="number" step="0.01" min="0" value={form.base_salary || ''} onChange={e => set('base_salary', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="label-sm">Encargos</label>
              <input className="input-field" type="number" step="0.01" min="0" value={form.encargos || ''} onChange={e => set('encargos', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="label-sm">Benefícios</label>
              <input className="input-field" type="number" step="0.01" min="0" value={form.beneficios || ''} onChange={e => set('beneficios', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="label-sm">Descontos</label>
              <input className="input-field" type="number" step="0.01" min="0" value={form.descontos || ''} onChange={e => set('descontos', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="col-span-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 text-sm font-semibold text-gray-800 dark:text-white">
              Total: {fmtBRL(computed)}
            </div>
            <div>
              <label className="label-sm">Vencimento *</label>
              <input className="input-field" type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} required />
            </div>
            <div>
              <label className="label-sm">Plano de contas</label>
              <ChartAccountSelect hotelId={hotelId} value={form.chart_account_sub_id ?? ''} onChange={v => set('chart_account_sub_id', v || null)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

export default function FolhaPagamentoPage() {
  const { selectedHotel } = useHotel();
  const [monthOffset, setMonthOffset] = useState(0);
  const competence = getCompetence(monthOffset);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<PayrollEntry | true | null>(null);
  const [busy, setBusy] = useState('');

  const hotelId = selectedHotel?.id;

  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true); setError('');
    try {
      const [e, emps] = await Promise.all([
        payrollService.listMonth(hotelId, competence),
        payrollService.listEmployees(hotelId),
      ]);
      setEntries(e);
      setEmployees(emps);
    } catch (err: any) { setError(err.message ?? 'Erro ao carregar'); }
    finally { setLoading(false); }
  }, [hotelId, competence]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!hotelId) return;
    setBusy('generate');
    try {
      const n = await payrollService.generateFromPreviousMonth(hotelId, competence);
      if (n === 0) alert('Nenhum lançamento novo — mês anterior vazio ou todos já existem.');
      load();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(''); }
  };

  const handlePost = async () => {
    if (!hotelId) return;
    const pending = entries.filter(e => e.status === 'previsto');
    if (!pending.length) { alert('Nenhum lançamento previsto para enviar.'); return; }
    if (!window.confirm(`Lançar ${pending.length} entrada(s) no Contas a Pagar?`)) return;
    setBusy('post');
    try {
      await payrollService.postMonthToAp(hotelId, competence);
      load();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(''); }
  };

  const handleDelete = async (entry: PayrollEntry) => {
    if (!window.confirm('Excluir este lançamento? Se já lançado, o AP não pago também será removido.')) return;
    try { await payrollService.delete(entry.id!); load(); }
    catch (err: any) { setError(err.message); }
  };

  const totalPrevisto = entries.filter(e => e.status === 'previsto').reduce((s, e) => s + Number(e.total ?? 0), 0);
  const totalLancado = entries.filter(e => e.status === 'lancado').reduce((s, e) => s + Number(e.total ?? 0), 0);

  if (!hotelId) return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-purple-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Folha de Pagamento</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleGenerate} disabled={!!busy} className="flex items-center gap-2 px-3 py-2 text-sm border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
            {busy === 'generate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
            Copiar mês anterior
          </button>
          <button onClick={handlePost} disabled={!!busy} className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {busy === 'post' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Lançar no AP
          </button>
          <button onClick={() => setModal(true)} className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">
            <Plus className="w-4 h-4" /> Novo
          </button>
        </div>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <button onClick={() => setMonthOffset(o => o - 1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronLeft className="w-5 h-5" /></button>
        <span className="text-lg font-semibold text-gray-800 dark:text-white capitalize">{competenceLabel(competence)}</span>
        <button onClick={() => setMonthOffset(o => o + 1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronRight className="w-5 h-5" /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <SummaryCard label="Previsto" value={fmtBRL(totalPrevisto)} color="text-blue-600 dark:text-blue-400" />
        <SummaryCard label="Lançado no AP" value={fmtBRL(totalLancado)} color="text-green-600 dark:text-green-400" />
        <SummaryCard label="Total mês" value={fmtBRL(totalPrevisto + totalLancado)} color="text-purple-600 dark:text-purple-400" />
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
                <th className="text-left px-4 py-3">Funcionário</th>
                <th className="text-right px-4 py-3">Salário</th>
                <th className="text-right px-4 py-3">Encargos</th>
                <th className="text-right px-4 py-3">Benefícios</th>
                <th className="text-right px-4 py-3">Descontos</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-left px-4 py-3">Vencimento</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-gray-500">Nenhum lançamento neste mês.</td></tr>
              ) : entries.map(e => (
                <tr key={e.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{e.employees?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{fmtBRL(Number(e.base_salary))}</td>
                  <td className="px-4 py-3 text-right">{fmtBRL(Number(e.encargos))}</td>
                  <td className="px-4 py-3 text-right">{fmtBRL(Number(e.beneficios))}</td>
                  <td className="px-4 py-3 text-right">{fmtBRL(Number(e.descontos))}</td>
                  <td className="px-4 py-3 text-right font-semibold">{fmtBRL(Number(e.total ?? 0))}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDate(e.due_date)}</td>
                  <td className="px-4 py-3"><FinStatusBadge status={e.status} dueDate={e.due_date} /></td>
                  <td className="px-4 py-3 text-right flex items-center gap-1 justify-end">
                    <button onClick={() => setModal(e)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="Editar">
                      <Plus className="w-4 h-4 rotate-45" />
                    </button>
                    <button onClick={() => handleDelete(e)} className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="Excluir">
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
        <EntryModal
          hotelId={hotelId}
          entry={modal === true ? undefined : modal}
          employees={employees}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
