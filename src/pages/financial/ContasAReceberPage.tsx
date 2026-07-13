import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowUpCircle, Plus, Search, X, Loader2, AlertTriangle, RefreshCw,
  Banknote, Trash2, Ban, Zap, Settings2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useHotel } from '../../context/HotelContext';
import { arService, ArTitle, ArStatus, ArOrigin } from '../../lib/arService';
import { apService, BankAccount, PaymentMethod } from '../../lib/apService';
import { ModalShell } from '../../components/financial/Fornecedores';
import {
  fmtBRL, fmtDate, todayISO, FinStatusBadge, PeriodFilter, Period,
  defaultPeriod, SummaryCard, PAYMENT_METHOD_LABELS,
} from '../../components/financial/shared';

const ORIGIN_LABELS: Record<ArOrigin, string> = {
  erbon: 'Erbon', omnibees: 'Omnibees', manual: 'Manual', inflow: 'Entrada',
};

// ─── Receipt modal ────────────────────────────────────────────────────────────

function ReceiptModal({ title, hotelId, onClose, onSaved }: {
  title: ArTitle; hotelId: string; onClose: () => void; onSaved: () => void;
}) {
  const remaining = title.net_amount - title.amount_received;
  const [amount, setAmount] = useState(String(remaining.toFixed(2)));
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [bankAccountId, setBankAccountId] = useState('');
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apService.listBankAccounts(hotelId).then(setBanks).catch(() => {});
  }, [hotelId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = parseFloat(amount);
    if (!v || v <= 0) { setError('Valor inválido'); return; }
    setSaving(true); setError('');
    try {
      await arService.registerReceipt({
        ar_title_id: title.id,
        hotel_id: hotelId,
        receipt_date: date,
        amount: v,
        payment_method: method,
        bank_account_id: bankAccountId || null,
        notes: notes || null,
      });
      onSaved();
    } catch (err: any) { setError(err.message ?? 'Erro ao registrar recebimento'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Banknote className="w-4 h-4 text-green-500" /> Registrar Recebimento
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="px-5 py-4 space-y-3">
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 text-sm">
            <p className="font-medium text-gray-800 dark:text-gray-200">{title.description ?? title.channel}</p>
            <p className="text-gray-500 mt-0.5">
              Previsto {fmtDate(title.expected_date)} · Em aberto: <span className="font-semibold">{fmtBRL(remaining)}</span>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-sm">Valor *</label>
              <input className="input-field" type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
            </div>
            <div>
              <label className="label-sm">Data *</label>
              <input className="input-field" type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div>
              <label className="label-sm">Forma</label>
              <select className="input-field" value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label-sm">Conta / Banco</label>
              <select className="input-field" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
                <option value="">—</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label-sm">Observações</label>
              <input className="input-field" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

// ─── Manual AR modal ──────────────────────────────────────────────────────────

function ArTitleModal({ hotelId, onClose, onSaved }: {
  hotelId: string; onClose: () => void; onSaved: () => void;
}) {
  const [description, setDescription] = useState('');
  const [channel, setChannel] = useState('');
  const [gross, setGross] = useState('');
  const [fee, setFee] = useState('0');
  const [expected, setExpected] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const g = parseFloat(gross);
    const f = parseFloat(fee) || 0;
    if (!description.trim()) { setError('Descrição obrigatória'); return; }
    if (!g || g <= 0) { setError('Valor inválido'); return; }
    setSaving(true); setError('');
    try {
      await arService.createManual({
        hotel_id: hotelId,
        description: description.trim(),
        origin: 'manual',
        origin_ref: null,
        channel: channel || null,
        gross_amount: g,
        fee_amount: f,
        net_amount: Math.round((g - f) * 100) / 100,
        expected_date: expected,
        acquirer_id: null,
        card_brand: null,
        installments: null,
        installment_number: 1,
        notes: null,
      });
      onSaved();
    } catch (err: any) { setError(err.message ?? 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4 text-green-500" /> Novo Recebível
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="px-5 py-4 space-y-3">
          <div>
            <label className="label-sm">Descrição *</label>
            <input className="input-field" value={description} onChange={e => setDescription(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-sm">Canal</label>
              <input className="input-field" value={channel} onChange={e => setChannel(e.target.value)} placeholder="Booking, Balcão..." />
            </div>
            <div>
              <label className="label-sm">Previsão *</label>
              <input className="input-field" type="date" value={expected} onChange={e => setExpected(e.target.value)} required />
            </div>
            <div>
              <label className="label-sm">Valor bruto *</label>
              <input className="input-field" type="number" step="0.01" min="0.01" value={gross} onChange={e => setGross(e.target.value)} required />
            </div>
            <div>
              <label className="label-sm">Taxa (R$)</label>
              <input className="input-field" type="number" step="0.01" min="0" value={fee} onChange={e => setFee(e.target.value)} />
            </div>
          </div>
          {parseFloat(gross) > 0 && (
            <p className="text-xs text-gray-500">Líquido: {fmtBRL((parseFloat(gross) || 0) - (parseFloat(fee) || 0))}</p>
          )}
          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContasAReceberPage() {
  const { selectedHotel } = useHotel();
  const [titles, setTitles] = useState<ArTitle[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [status, setStatus] = useState<'' | ArStatus | 'atrasado'>('');
  const [channelFilter, setChannelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [receiptModal, setReceiptModal] = useState<ArTitle | null>(null);
  const [newModal, setNewModal] = useState(false);

  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true); setError('');
    try {
      const filters: any = { from: period.from, to: period.to };
      if (status) filters.status = status;
      setTitles(await arService.list(selectedHotel.id, filters));
    } catch (err: any) { setError(err.message ?? 'Erro ao carregar'); }
    finally { setLoading(false); }
  }, [selectedHotel?.id, period, status]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!selectedHotel?.id) return;
    setGenerating(true); setError(''); setInfo('');
    try {
      const [erbon, bookings] = await Promise.all([
        arService.generateFromErbon(selectedHotel.id, period.from, period.to).catch(() => 0),
        arService.generateFromBookings(selectedHotel.id, period.from, period.to).catch(() => 0),
      ]);
      const n = erbon + bookings;
      setInfo(n > 0
        ? `${n} novo(s) recebível(is) gerado(s) a partir das reservas (Erbon: ${erbon}, Reservas/Omnibees: ${bookings}).`
        : 'Nenhum recebível novo — tudo já estava gerado para o período.');
      load();
    } catch (err: any) { setError(err.message ?? 'Erro ao gerar recebíveis'); }
    finally { setGenerating(false); }
  };

  const channels = Array.from(new Set(titles.map(t => t.channel).filter(Boolean))) as string[];

  const filtered = titles.filter(t => {
    if (channelFilter && t.channel !== channelFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (t.description ?? '').toLowerCase().includes(q) || (t.channel ?? '').toLowerCase().includes(q);
  });

  const today = todayISO();
  const open = filtered.filter(t => t.status === 'previsto' || t.status === 'parcial');
  const totalOpen = open.reduce((s, t) => s + (t.net_amount - t.amount_received), 0);
  const totalLate = open.filter(t => t.expected_date < today).reduce((s, t) => s + (t.net_amount - t.amount_received), 0);
  const totalReceived = filtered.reduce((s, t) => s + t.amount_received, 0);
  const totalFees = filtered.reduce((s, t) => s + t.fee_amount, 0);

  const handleCancel = async (t: ArTitle) => {
    if (!window.confirm('Cancelar este recebível?')) return;
    try { await arService.cancel(t.id); load(); } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (t: ArTitle) => {
    if (!window.confirm('Excluir este recebível?')) return;
    try { await arService.delete(t.id); load(); } catch (err: any) { setError(err.message); }
  };

  if (!selectedHotel?.id) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <ArrowUpCircle className="h-8 w-8 text-green-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Contas a Receber</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/finances/regras-recebimento"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <Settings2 className="w-4 h-4" /> Regras
          </Link>
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Gerar das reservas
          </button>
          <button onClick={() => setNewModal(true)} className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Novo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="A receber no período" value={fmtBRL(totalOpen)} color="text-blue-600 dark:text-blue-400" />
        <SummaryCard label="Atrasado" value={fmtBRL(totalLate)} color="text-red-600 dark:text-red-400" />
        <SummaryCard label="Recebido" value={fmtBRL(totalReceived)} color="text-green-600 dark:text-green-400" />
        <SummaryCard label="Taxas / comissões" value={fmtBRL(totalFees)} color="text-amber-600 dark:text-amber-400" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <PeriodFilter period={period} onChange={setPeriod} />
        <select className="input-field !w-auto text-sm" value={status} onChange={e => setStatus(e.target.value as any)}>
          <option value="">Todos os status</option>
          <option value="previsto">Previsto</option>
          <option value="parcial">Parcial</option>
          <option value="atrasado">Atrasado</option>
          <option value="recebido">Recebido</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <select className="input-field !w-auto text-sm" value={channelFilter} onChange={e => setChannelFilter(e.target.value)}>
          <option value="">Todos os canais</option>
          {channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={load} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}
      {info && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
          {info}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Descrição</th>
                <th className="text-left px-4 py-3">Canal</th>
                <th className="text-left px-4 py-3">Origem</th>
                <th className="text-left px-4 py-3">Previsão</th>
                <th className="text-right px-4 py-3">Bruto</th>
                <th className="text-right px-4 py-3">Taxa</th>
                <th className="text-right px-4 py-3">Líquido</th>
                <th className="text-right px-4 py-3">Recebido</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="py-12 text-center text-gray-500">
                  Nenhum recebível no período. Use "Gerar das reservas" para importar Erbon/Omnibees.
                </td></tr>
              ) : filtered.map(t => (
                <tr key={t.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800 dark:text-gray-200 line-clamp-1">{t.description ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{t.channel ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{ORIGIN_LABELS[t.origin]}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDate(t.expected_date)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtBRL(t.gross_amount)}</td>
                  <td className="px-4 py-3 text-right text-amber-600 whitespace-nowrap">{t.fee_amount > 0 ? fmtBRL(t.fee_amount) : '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtBRL(t.net_amount)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">{t.amount_received > 0 ? fmtBRL(t.amount_received) : '—'}</td>
                  <td className="px-4 py-3 text-center"><FinStatusBadge status={t.status} dueDate={t.expected_date} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {(t.status === 'previsto' || t.status === 'parcial') && (
                        <button onClick={() => setReceiptModal(t)} title="Registrar recebimento"
                          className="p-1.5 text-gray-400 hover:text-green-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                          <Banknote className="w-4 h-4" />
                        </button>
                      )}
                      {t.status !== 'cancelado' && t.status !== 'recebido' && (
                        <button onClick={() => handleCancel(t)} title="Cancelar"
                          className="p-1.5 text-gray-400 hover:text-amber-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                      {t.origin === 'manual' && t.amount_received === 0 && (
                        <button onClick={() => handleDelete(t)} title="Excluir"
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {receiptModal && (
        <ReceiptModal
          title={receiptModal} hotelId={selectedHotel.id}
          onClose={() => setReceiptModal(null)}
          onSaved={() => { setReceiptModal(null); load(); }}
        />
      )}
      {newModal && (
        <ArTitleModal
          hotelId={selectedHotel.id}
          onClose={() => setNewModal(false)}
          onSaved={() => { setNewModal(false); load(); }}
        />
      )}
    </div>
  );
}
