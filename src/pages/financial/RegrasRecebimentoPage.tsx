import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings2, Plus, X, Loader2, AlertTriangle, Trash2, Edit2,
  CreditCard, Landmark, Waypoints, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import {
  arService, ChannelReceivingRule, CardAcquirer, CardAcquirerRule, TriggerEvent,
} from '../../lib/arService';
import { apService, BankAccount } from '../../lib/apService';
import { ModalShell } from '../../components/financial/Fornecedores';

type Tab = 'canais' | 'adquirentes' | 'bancos';

const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  checkout: 'Check-out', checkin: 'Check-in', faturamento: 'Faturamento',
};

const BRANDS = ['visa', 'master', 'elo', 'amex', 'hipercard', 'outros'];
const BRAND_LABELS: Record<string, string> = {
  visa: 'Visa', master: 'Mastercard', elo: 'Elo', amex: 'Amex', hipercard: 'Hipercard', outros: 'Outras',
};

// ─── Channel rule modal ───────────────────────────────────────────────────────

function ChannelRuleModal({ hotelId, initial, acquirers, knownChannels, onClose, onSaved }: {
  hotelId: string;
  initial?: ChannelReceivingRule;
  acquirers: CardAcquirer[];
  knownChannels: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ChannelReceivingRule>(initial ?? {
    hotel_id: hotelId, channel: '', trigger_event: 'checkout', days_to_receive: 0,
    receiving_method: 'deposito', acquirer_id: null, default_fee_percent: 0, active: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof ChannelReceivingRule, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.channel.trim()) { setError('Canal obrigatório'); return; }
    setSaving(true); setError('');
    try { await arService.saveRule({ ...form, channel: form.channel.trim() }); onSaved(); }
    catch (err: any) { setError(err.message ?? 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Waypoints className="w-4 h-4 text-purple-500" />
            {initial?.id ? 'Editar Regra de Canal' : 'Nova Regra de Canal'}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="px-5 py-4 space-y-3">
          <div>
            <label className="label-sm">Canal de venda *</label>
            <input className="input-field" list="known-channels" value={form.channel}
              onChange={e => set('channel', e.target.value)} placeholder="BOOKING, DECOLAR, Direto..." required />
            <datalist id="known-channels">
              {knownChannels.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-sm">Evento de referência</label>
              <select className="input-field" value={form.trigger_event} onChange={e => set('trigger_event', e.target.value)}>
                {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label-sm">Dias até receber</label>
              <input className="input-field" type="number" min="0" value={form.days_to_receive}
                onChange={e => set('days_to_receive', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label className="label-sm">Forma de recebimento</label>
              <select className="input-field" value={form.receiving_method} onChange={e => set('receiving_method', e.target.value)}>
                <option value="deposito">Depósito / Transferência</option>
                <option value="cartao">Cartão de crédito</option>
              </select>
            </div>
            <div>
              <label className="label-sm">Taxa / comissão (%)</label>
              <input className="input-field" type="number" step="0.001" min="0" value={form.default_fee_percent}
                onChange={e => set('default_fee_percent', parseFloat(e.target.value) || 0)} />
            </div>
            {form.receiving_method === 'cartao' && (
              <div className="col-span-2">
                <label className="label-sm">Adquirente</label>
                <select className="input-field" value={form.acquirer_id ?? ''} onChange={e => set('acquirer_id', e.target.value || null)}>
                  <option value="">—</option>
                  {acquirers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} className="rounded border-gray-300" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Regra ativa</span>
          </label>
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

// ─── Acquirer card with inline rules ──────────────────────────────────────────

function AcquirerCard({ acquirer, onDeleted, onError }: {
  acquirer: CardAcquirer; onDeleted: () => void; onError: (m: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rules, setRules] = useState<CardAcquirerRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<CardAcquirerRule | null>(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try { setRules(await arService.listAcquirerRules(acquirer.id!)); }
    catch (err: any) { onError(err.message); }
    finally { setLoading(false); }
  }, [acquirer.id, onError]);

  useEffect(() => { if (expanded) loadRules(); }, [expanded, loadRules]);

  const emptyRule = (): CardAcquirerRule => ({
    acquirer_id: acquirer.id!, card_brand: 'visa', modality: 'credito',
    installment_from: 1, installment_to: 1, fee_percent: 0, settlement_days: 30,
  });

  const saveDraft = async () => {
    if (!draft) return;
    try { await arService.saveAcquirerRule(draft); setDraft(null); loadRules(); }
    catch (err: any) { onError(err.message); }
  };

  const deleteRule = async (id: string) => {
    try { await arService.deleteAcquirerRule(id); loadRules(); }
    catch (err: any) { onError(err.message); }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Remover a adquirente ${acquirer.name} e suas regras?`)) return;
    try { await arService.deleteAcquirer(acquirer.id!); onDeleted(); }
    catch (err: any) { onError(err.message); }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <CreditCard className="w-5 h-5 text-indigo-500" />
          <p className="font-semibold text-gray-800 dark:text-gray-200">{acquirer.name}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setExpanded(p => !p)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button onClick={handleDelete} className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t dark:border-gray-700 px-4 py-3">
          {loading ? (
            <div className="py-4 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[560px]">
                <thead className="text-gray-500 uppercase">
                  <tr>
                    <th className="text-left py-2">Bandeira</th>
                    <th className="text-left py-2">Modalidade</th>
                    <th className="text-center py-2">Parcelas</th>
                    <th className="text-right py-2">Taxa (%)</th>
                    <th className="text-right py-2">Prazo (dias)</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id} className="border-t dark:border-gray-700">
                      <td className="py-2">{BRAND_LABELS[r.card_brand] ?? r.card_brand}</td>
                      <td className="py-2">{r.modality === 'credito' ? 'Crédito' : 'Débito'}</td>
                      <td className="py-2 text-center">{r.installment_from === r.installment_to ? r.installment_from : `${r.installment_from}–${r.installment_to}`}x</td>
                      <td className="py-2 text-right">{r.fee_percent}%</td>
                      <td className="py-2 text-right">{r.settlement_days}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => setDraft(r)} className="p-1 text-gray-400 hover:text-blue-600"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteRule(r.id!)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                  {rules.length === 0 && !draft && (
                    <tr><td colSpan={6} className="py-3 text-center text-gray-400">Nenhuma regra cadastrada.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {draft ? (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <div>
                <label className="label-sm">Bandeira</label>
                <select className="input-field text-xs" value={draft.card_brand} onChange={e => setDraft({ ...draft, card_brand: e.target.value })}>
                  {BRANDS.map(b => <option key={b} value={b}>{BRAND_LABELS[b]}</option>)}
                </select>
              </div>
              <div>
                <label className="label-sm">Modalidade</label>
                <select className="input-field text-xs" value={draft.modality} onChange={e => setDraft({ ...draft, modality: e.target.value as any })}>
                  <option value="credito">Crédito</option>
                  <option value="debito">Débito</option>
                </select>
              </div>
              <div>
                <label className="label-sm">Parc. de</label>
                <input className="input-field text-xs" type="number" min="1" value={draft.installment_from}
                  onChange={e => setDraft({ ...draft, installment_from: parseInt(e.target.value) || 1 })} />
              </div>
              <div>
                <label className="label-sm">Parc. até</label>
                <input className="input-field text-xs" type="number" min="1" value={draft.installment_to}
                  onChange={e => setDraft({ ...draft, installment_to: parseInt(e.target.value) || 1 })} />
              </div>
              <div>
                <label className="label-sm">Taxa (%)</label>
                <input className="input-field text-xs" type="number" step="0.001" min="0" value={draft.fee_percent}
                  onChange={e => setDraft({ ...draft, fee_percent: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="label-sm">Prazo (dias)</label>
                <input className="input-field text-xs" type="number" min="0" value={draft.settlement_days}
                  onChange={e => setDraft({ ...draft, settlement_days: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="col-span-2 sm:col-span-6 flex justify-end gap-2">
                <button onClick={() => setDraft(null)} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
                <button onClick={saveDraft} className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Salvar regra</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setDraft(emptyRule())} className="mt-3 flex items-center gap-1 text-xs text-indigo-600 hover:underline">
              <Plus className="w-3.5 h-3.5" /> Adicionar regra de taxa/prazo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RegrasRecebimentoPage() {
  const { selectedHotel } = useHotel();
  const [tab, setTab] = useState<Tab>('canais');
  const [rules, setRules] = useState<ChannelReceivingRule[]>([]);
  const [acquirers, setAcquirers] = useState<CardAcquirer[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [knownChannels, setKnownChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ruleModal, setRuleModal] = useState<{ open: boolean; data?: ChannelReceivingRule }>({ open: false });
  const [newAcquirerName, setNewAcquirerName] = useState('');
  const [bankDraft, setBankDraft] = useState<BankAccount | null>(null);

  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true); setError('');
    try {
      const [r, a, b] = await Promise.all([
        arService.listRules(selectedHotel.id),
        arService.listAcquirers(selectedHotel.id),
        apService.listBankAccounts(selectedHotel.id),
      ]);
      setRules(r); setAcquirers(a); setBanks(b);
      arService.listKnownChannels(selectedHotel.id).then(setKnownChannels).catch(() => {});
    } catch (err: any) { setError(err.message ?? 'Erro ao carregar'); }
    finally { setLoading(false); }
  }, [selectedHotel?.id]);

  useEffect(() => { load(); }, [load]);

  const deleteChannelRule = async (id: string) => {
    if (!window.confirm('Remover esta regra?')) return;
    try { await arService.deleteRule(id); load(); } catch (err: any) { setError(err.message); }
  };

  const addAcquirer = async () => {
    if (!newAcquirerName.trim() || !selectedHotel?.id) return;
    try {
      await arService.saveAcquirer({ hotel_id: selectedHotel.id, name: newAcquirerName.trim(), active: true });
      setNewAcquirerName(''); load();
    } catch (err: any) { setError(err.message); }
  };

  const saveBank = async () => {
    if (!bankDraft || !bankDraft.name.trim()) return;
    try { await apService.saveBankAccount(bankDraft); setBankDraft(null); load(); }
    catch (err: any) { setError(err.message); }
  };

  const deleteBank = async (id: string) => {
    if (!window.confirm('Remover esta conta?')) return;
    try { await apService.deleteBankAccount(id); load(); } catch (err: any) { setError(err.message); }
  };

  if (!selectedHotel?.id) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Settings2 className="h-8 w-8 text-purple-500" />
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Regras de Recebimento</h1>
      </div>

      <div className="flex gap-2 mb-6">
        {([
          ['canais', 'Canais de Venda', <Waypoints key="i" className="w-4 h-4" />],
          ['adquirentes', 'Adquirentes de Cartão', <CreditCard key="i" className="w-4 h-4" />],
          ['bancos', 'Contas Bancárias', <Landmark key="i" className="w-4 h-4" />],
        ] as [Tab, string, React.ReactNode][]).map(([k, label, icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === k ? 'bg-purple-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" /></div>
      ) : tab === 'canais' ? (
        <>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">
              Defina, por canal (OTA, agência, balcão…), quantos dias após o evento você recebe e a taxa cobrada.
            </p>
            <button onClick={() => setRuleModal({ open: true })}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 shrink-0">
              <Plus className="w-4 h-4" /> Nova regra
            </button>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3">Canal</th>
                    <th className="text-left px-4 py-3">Evento</th>
                    <th className="text-center px-4 py-3">Dias</th>
                    <th className="text-left px-4 py-3">Forma</th>
                    <th className="text-right px-4 py-3">Taxa (%)</th>
                    <th className="text-center px-4 py-3">Ativa</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 ? (
                    <tr><td colSpan={7} className="py-10 text-center text-gray-500">
                      Nenhuma regra. Crie uma regra por canal — ex.: BOOKING recebe 15 dias após o check-out com 15% de comissão.
                    </td></tr>
                  ) : rules.map(r => (
                    <tr key={r.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{r.channel}</td>
                      <td className="px-4 py-3">{TRIGGER_LABELS[r.trigger_event]}</td>
                      <td className="px-4 py-3 text-center">{r.days_to_receive}</td>
                      <td className="px-4 py-3">{r.receiving_method === 'cartao' ? 'Cartão' : 'Depósito'}</td>
                      <td className="px-4 py-3 text-right">{r.default_fee_percent}%</td>
                      <td className="px-4 py-3 text-center">{r.active ? '✓' : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setRuleModal({ open: true, data: r })} className="p-1.5 text-gray-400 hover:text-blue-600"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => deleteChannelRule(r.id!)} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : tab === 'adquirentes' ? (
        <>
          <div className="flex gap-2 mb-4">
            <input className="input-field flex-1" placeholder="Nome da adquirente (Cielo, Stone, Rede...)"
              value={newAcquirerName} onChange={e => setNewAcquirerName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addAcquirer()} />
            <button onClick={addAcquirer} className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shrink-0">
              <Plus className="w-4 h-4" /> Adicionar
            </button>
          </div>
          <div className="space-y-3">
            {acquirers.length === 0 ? (
              <p className="py-10 text-center text-gray-500 text-sm">Nenhuma adquirente cadastrada.</p>
            ) : acquirers.map(a => (
              <AcquirerCard key={a.id} acquirer={a} onDeleted={load} onError={setError} />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">Contas e caixas usados nos pagamentos e recebimentos.</p>
            {!bankDraft && (
              <button onClick={() => setBankDraft({ hotel_id: selectedHotel.id, name: '', bank_name: '', account_type: 'corrente', initial_balance: 0, active: true })}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shrink-0">
                <Plus className="w-4 h-4" /> Nova conta
              </button>
            )}
          </div>
          {bankDraft && (
            <div className="mb-4 grid grid-cols-2 sm:grid-cols-5 gap-2 items-end bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4">
              <div className="col-span-2">
                <label className="label-sm">Nome *</label>
                <input className="input-field" value={bankDraft.name} onChange={e => setBankDraft({ ...bankDraft, name: e.target.value })} placeholder="Conta principal" />
              </div>
              <div>
                <label className="label-sm">Banco</label>
                <input className="input-field" value={bankDraft.bank_name ?? ''} onChange={e => setBankDraft({ ...bankDraft, bank_name: e.target.value })} />
              </div>
              <div>
                <label className="label-sm">Tipo</label>
                <select className="input-field" value={bankDraft.account_type} onChange={e => setBankDraft({ ...bankDraft, account_type: e.target.value as any })}>
                  <option value="corrente">Corrente</option>
                  <option value="poupanca">Poupança</option>
                  <option value="caixa">Caixa</option>
                </select>
              </div>
              <div>
                <label className="label-sm">Saldo inicial</label>
                <input className="input-field" type="number" step="0.01" value={bankDraft.initial_balance}
                  onChange={e => setBankDraft({ ...bankDraft, initial_balance: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="col-span-2 sm:col-span-5 flex justify-end gap-2">
                <button onClick={() => setBankDraft(null)} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
                <button onClick={saveBank} className="px-4 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Salvar conta</button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {banks.length === 0 ? (
              <p className="col-span-2 py-10 text-center text-gray-500 text-sm">Nenhuma conta cadastrada.</p>
            ) : banks.map(b => (
              <div key={b.id} className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Landmark className="w-5 h-5 text-emerald-500" />
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-gray-200">{b.name}</p>
                    <p className="text-xs text-gray-500">
                      {b.bank_name ? `${b.bank_name} · ` : ''}
                      {b.account_type === 'corrente' ? 'Conta corrente' : b.account_type === 'poupanca' ? 'Poupança' : 'Caixa'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setBankDraft(b)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => deleteBank(b.id!)} className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {ruleModal.open && (
        <ChannelRuleModal
          hotelId={selectedHotel.id}
          initial={ruleModal.data}
          acquirers={acquirers}
          knownChannels={knownChannels}
          onClose={() => setRuleModal({ open: false })}
          onSaved={() => { setRuleModal({ open: false }); load(); }}
        />
      )}
    </div>
  );
}
