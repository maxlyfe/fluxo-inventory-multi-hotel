import React, { useState, useEffect, useCallback } from 'react';
import {
  HandCoins, Plus, X, Loader2, AlertTriangle, Trash2, PiggyBank, Ticket, CircleDollarSign,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { inflowService, MoneyInflow, InflowType, INFLOW_TYPE_LABELS } from '../../lib/inflowService';
import { apService, BankAccount, splitInstallments, addMonths, PaymentMethod } from '../../lib/apService';
import { ModalShell } from '../../components/financial/Fornecedores';
import { fmtBRL, fmtDate, todayISO, SummaryCard, PAYMENT_METHOD_LABELS } from '../../components/financial/shared';

const TYPE_ICONS: Record<InflowType, React.ReactNode> = {
  ingresso_externo: <Ticket className="w-4 h-4 text-blue-500" />,
  aporte: <PiggyBank className="w-4 h-4 text-emerald-500" />,
  emprestimo: <HandCoins className="w-4 h-4 text-amber-500" />,
  outros: <CircleDollarSign className="w-4 h-4 text-gray-500" />,
};

function InflowModal({ hotelId, onClose, onSaved }: {
  hotelId: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<MoneyInflow>({
    hotel_id: hotelId, type: 'ingresso_externo', description: '', amount: 0,
    inflow_date: todayISO(), payment_method: 'pix',
  });
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apService.listBankAccounts(hotelId).then(setBanks).catch(() => {});
  }, [hotelId]);

  const set = (k: keyof MoneyInflow, v: any) => setForm(f => ({ ...f, [k]: v }));

  const isLoan = form.type === 'emprestimo';
  const previewInstallments = isLoan && form.repayment_installments && form.amount > 0
    ? (form.installment_amount && form.installment_amount > 0
        ? Array(form.repayment_installments).fill(form.installment_amount)
        : splitInstallments(form.amount, form.repayment_installments))
    : [];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) { setError('Descrição obrigatória'); return; }
    if (!form.amount || form.amount <= 0) { setError('Valor inválido'); return; }
    if (isLoan && form.repayment_installments && !form.first_due_date) {
      setError('Informe o 1º vencimento do empréstimo'); return;
    }
    setSaving(true); setError('');
    try { await inflowService.create({ ...form, description: form.description.trim() }); onSaved(); }
    catch (err: any) { setError(err.message ?? 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4 flex flex-col" style={{ maxHeight: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-emerald-500" /> Nova Entrada
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-sm">Tipo *</label>
              <select className="input-field" value={form.type} onChange={e => set('type', e.target.value)}>
                {Object.entries(INFLOW_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label-sm">Data *</label>
              <input className="input-field" type="date" value={form.inflow_date} onChange={e => set('inflow_date', e.target.value)} required />
            </div>
            <div className="col-span-2">
              <label className="label-sm">Descrição *</label>
              <input className="input-field" value={form.description} onChange={e => set('description', e.target.value)} required
                placeholder={isLoan ? 'Empréstimo Banco X' : 'Ingressos passeio, aporte sócio...'} />
            </div>
            <div>
              <label className="label-sm">Valor *</label>
              <input className="input-field" type="number" step="0.01" min="0.01" value={form.amount || ''}
                onChange={e => set('amount', parseFloat(e.target.value) || 0)} required />
            </div>
            <div>
              <label className="label-sm">Forma de entrada</label>
              <select className="input-field" value={form.payment_method ?? ''} onChange={e => set('payment_method', e.target.value || null)}>
                <option value="">—</option>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label-sm">Conta / Banco</label>
              <select className="input-field" value={form.bank_account_id ?? ''} onChange={e => set('bank_account_id', e.target.value || null)}>
                <option value="">—</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          {isLoan && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                Devolução do empréstimo — vira Contas a Pagar automaticamente
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label-sm">Parcelas</label>
                  <input className="input-field" type="number" min="1" max="240" value={form.repayment_installments ?? ''}
                    onChange={e => set('repayment_installments', parseInt(e.target.value) || null)} />
                </div>
                <div>
                  <label className="label-sm">1º vencimento</label>
                  <input className="input-field" type="date" value={form.first_due_date ?? ''}
                    onChange={e => set('first_due_date', e.target.value || null)} />
                </div>
                <div>
                  <label className="label-sm">Valor da parcela</label>
                  <input className="input-field" type="number" step="0.01" min="0" value={form.installment_amount ?? ''}
                    placeholder="auto" onChange={e => set('installment_amount', parseFloat(e.target.value) || null)} />
                </div>
              </div>
              {previewInstallments.length > 0 && form.first_due_date && (
                <div className="text-xs text-amber-800 dark:text-amber-200 max-h-28 overflow-y-auto space-y-0.5">
                  {previewInstallments.map((v: number, i: number) => (
                    <p key={i}>Parcela {i + 1}/{previewInstallments.length} — {fmtDate(addMonths(form.first_due_date!, i))} — {fmtBRL(v)}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

export default function OutrasEntradasPage() {
  const { selectedHotel } = useHotel();
  const [inflows, setInflows] = useState<MoneyInflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);

  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true); setError('');
    try { setInflows(await inflowService.list(selectedHotel.id)); }
    catch (err: any) { setError(err.message ?? 'Erro ao carregar'); }
    finally { setLoading(false); }
  }, [selectedHotel?.id]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (i: MoneyInflow) => {
    const msg = i.type === 'emprestimo'
      ? 'Excluir esta entrada? As parcelas não pagas do empréstimo também serão removidas do Contas a Pagar.'
      : 'Excluir esta entrada?';
    if (!window.confirm(msg)) return;
    try { await inflowService.delete(i.id!); load(); } catch (err: any) { setError(err.message); }
  };

  const total = inflows.reduce((s, i) => s + Number(i.amount), 0);
  const totalLoans = inflows.filter(i => i.type === 'emprestimo').reduce((s, i) => s + Number(i.amount), 0);
  const totalAportes = inflows.filter(i => i.type === 'aporte').reduce((s, i) => s + Number(i.amount), 0);

  if (!selectedHotel?.id) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <HandCoins className="h-8 w-8 text-emerald-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Outras Entradas</h1>
        </div>
        <button onClick={() => setModal(true)} className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
          <Plus className="w-4 h-4" /> Nova entrada
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <SummaryCard label="Total registrado" value={fmtBRL(total)} color="text-emerald-600 dark:text-emerald-400" />
        <SummaryCard label="Empréstimos" value={fmtBRL(totalLoans)} color="text-amber-600 dark:text-amber-400" />
        <SummaryCard label="Aportes" value={fmtBRL(totalAportes)} color="text-blue-600 dark:text-blue-400" />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">Descrição</th>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Forma</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-left px-4 py-3">Devolução</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></td></tr>
              ) : inflows.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-500">Nenhuma entrada registrada.</td></tr>
              ) : inflows.map(i => (
                <tr key={i.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">{TYPE_ICONS[i.type]}{INFLOW_TYPE_LABELS[i.type]}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{i.description}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDate(i.inflow_date)}</td>
                  <td className="px-4 py-3">{i.payment_method ? PAYMENT_METHOD_LABELS[i.payment_method] : '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtBRL(Number(i.amount))}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {i.type === 'emprestimo' && i.repayment_installments
                      ? `${i.repayment_installments}x a partir de ${fmtDate(i.first_due_date)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(i)} className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
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
        <InflowModal hotelId={selectedHotel.id} onClose={() => setModal(false)} onSaved={() => { setModal(false); load(); }} />
      )}
    </div>
  );
}
