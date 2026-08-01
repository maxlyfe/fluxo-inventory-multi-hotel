import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings2, Plus, X, Loader2, AlertTriangle, Trash2, Edit2,
  CreditCard, Landmark, Waypoints, ChevronDown, ChevronUp, Mail,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useHotel } from '../../context/HotelContext';
import { useGroup } from '../../context/GroupContext';
import {
  arService, ChannelReceivingRule, CardAcquirer, CardAcquirerRule, TriggerEvent,
  GroupPartnerRule,
} from '../../lib/arService';
import { apService, BankAccount } from '../../lib/apService';
import { supplierService, formatCnpj } from '../../lib/supplierService';
import { ModalShell, SectionTitle } from '../../components/financial/Fornecedores';
import PartnerPicker, { LinkedPartner, supplierToPartner } from '../../components/financial/PartnerPicker';
import BillingEmailFields, { BillingConfig } from '../../components/financial/BillingEmailFields';
import EmailSenderTab from '../../components/financial/EmailSenderTab';
import { emailConfigService } from '../../lib/emailConfigService';
import { ErrorBanner } from '../../components/financial/shared';

type Tab = 'canais' | 'adquirentes' | 'bancos' | 'remetente';

const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  checkout: 'Check-out', checkin: 'Check-in', faturamento: 'Faturamento',
};

const BRANDS = ['visa', 'master', 'elo', 'amex', 'hipercard', 'outros'];
const BRAND_LABELS: Record<string, string> = {
  visa: 'Visa', master: 'Mastercard', elo: 'Elo', amex: 'Amex', hipercard: 'Hipercard', outros: 'Outras',
};

// ─── Channel rule modal ───────────────────────────────────────────────────────

/** Texto do prazo, que muda de significado conforme o evento de referência. */
const TRIGGER_HINTS: Record<TriggerEvent, string> = {
  checkout: 'Contamos os dias a partir da data do check-out.',
  checkin: 'Contamos os dias a partir da data do check-in.',
  faturamento:
    'Contamos os dias a partir do dia em que a cobrança for ENVIADA ao parceiro. ' +
    'Até lá o recebível fica sem data firme e não entra na previsão de caixa.',
};

function ChannelRuleModal({ hotelId, initial, acquirers, knownChannels, groupHotels, senderConfigured, onClose, onSaved }: {
  hotelId: string;
  initial?: ChannelReceivingRule;
  acquirers: CardAcquirer[];
  knownChannels: string[];
  groupHotels: { id: string; name: string }[];
  /** false = a unidade não tem remetente ativo; o modo automático fica avisado. */
  senderConfigured: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ChannelReceivingRule>(initial ?? emptyRule(hotelId));
  const [partner, setPartner] = useState<LinkedPartner | null>(null);
  const [groupRules, setGroupRules] = useState<GroupPartnerRule[]>([]);
  const [replicateTo, setReplicateTo] = useState<Set<string>>(new Set());
  const [replicateResult, setReplicateResult] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isFaturamento = form.trigger_event === 'faturamento';
  const others = groupHotels.filter(h => h.id !== hotelId);

  const set = (k: keyof ChannelReceivingRule, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setBilling = (patch: Partial<BillingConfig>) => setForm(f => ({ ...f, ...patch }));

  // Editando uma regra que já tem parceiro: recarrega o fornecedor para exibir
  // nome, e-mail e situação no card.
  useEffect(() => {
    if (!initial?.supplier_id) return;
    supplierService.findByCnpj(hotelId, initial.partner_cnpj ?? '')
      .then(s => { if (s) setPartner(supplierToPartner(s, 'local')); })
      .catch(() => {});
  }, [initial?.supplier_id, initial?.partner_cnpj, hotelId]);

  // Vínculo do parceiro: grava CNPJ e supplier_id, oferece o e-mail do cadastro
  // e procura a mesma empresa nas outras unidades do grupo.
  const handlePartner = (p: LinkedPartner | null) => {
    setPartner(p);
    setForm(f => ({
      ...f,
      supplier_id: p?.supplier_id ?? null,
      partner_cnpj: p?.cnpj ?? null,
      billing_email: f.billing_email ?? p?.email ?? null,
    }));
    setGroupRules([]);
    if (p) {
      arService
        .findGroupRulesByCnpj(p.cnpj, groupHotels.map(h => h.id), hotelId)
        .then(setGroupRules)
        .catch(() => {});
    }
  };

  /** Copia prazo, taxa e template de uma regra de outra unidade. */
  const copyFromGroupRule = (r: GroupPartnerRule) => {
    setForm(f => ({
      ...f,
      channel: f.channel || r.channel,
      trigger_event: r.trigger_event,
      days_to_receive: r.days_to_receive,
      receiving_method: r.receiving_method,
      default_fee_percent: r.default_fee_percent,
      billing_email: r.billing_email ?? f.billing_email,
      billing_cc_emails: r.billing_cc_emails ?? [],
      billing_subject_template: r.billing_subject_template ?? null,
      billing_body_template: r.billing_body_template ?? null,
      billing_attach_nf: r.billing_attach_nf ?? true,
      billing_dispatch_mode: r.billing_dispatch_mode ?? 'manual',
      // acquirer_id NÃO é copiado: adquirente é cadastro por hotel, o id de
      // outra unidade não existe aqui.
      acquirer_id: null,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.channel.trim()) { setError('Informe o canal de venda.'); return; }
    if (isFaturamento && !form.partner_cnpj) {
      setError('Escolha o parceiro: é o CNPJ dele que casa a NF emitida com a cobrança.');
      return;
    }
    if (isFaturamento && !form.billing_email) {
      setError('Informe pelo menos um e-mail para envio da cobrança.');
      return;
    }
    if (form.receiving_method === 'cartao' && !form.acquirer_id) {
      setError('Recebimento por cartão precisa da adquirente, senão taxa e prazo ficam estimados.');
      return;
    }

    setSaving(true); setError(''); setReplicateResult('');
    try {
      const saved = await arService.saveRule(form);

      if (replicateTo.size > 0) {
        const results = await arService.replicateRule(saved, Array.from(replicateTo));
        const nameOf = (id: string) => groupHotels.find(h => h.id === id)?.name ?? id;
        const ok = results.filter(r => r.status !== 'falhou');
        const fail = results.filter(r => r.status === 'falhou');
        if (fail.length) {
          setReplicateResult(
            `Regra salva. Replicada em ${ok.length} unidade(s). Falhou em: ` +
            fail.map(f => `${nameOf(f.hotel_id)} (${f.error})`).join(', ')
          );
          setSaving(false);
          return; // não fecha: o operador precisa ver onde falhou
        }
      }
      onSaved();
    } catch (err: any) {
      // 23505 = violação de unique. A mensagem crua do Postgres não diz nada
      // para quem está usando a tela.
      if (err?.code === '23505') {
        setError(
          form.partner_cnpj
            ? `Já existe uma regra para o CNPJ ${formatCnpj(form.partner_cnpj)} neste hotel. Edite a regra existente.`
            : `Já existe uma regra para o canal "${form.channel.trim()}" neste hotel. Edite a regra existente.`
        );
      } else {
        setError(err?.message ?? 'Erro ao salvar');
      }
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <ModalShell onClose={onClose}>
      <div
        className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4 flex flex-col"
        style={{ maxHeight: 'calc(100dvh - 2rem)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Waypoints className="w-4 h-4 text-purple-500" />
            {initial?.id ? 'Editar Regra de Canal' : 'Nova Regra de Canal'}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>

        <form id="channel-rule-form" onSubmit={handleSave} className="px-5 py-4 space-y-5 overflow-y-auto">
          {/* 1 · Canal */}
          <div>
            <SectionTitle>1 · Canal</SectionTitle>
            <div className="space-y-3">
              <div>
                <label className="label-sm">Canal de venda *</label>
                <input className="input-field" list="known-channels" value={form.channel}
                  onChange={e => set('channel', e.target.value)}
                  placeholder="BOOKING, DECOLAR, FATURADO ACME..." required />
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
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{TRIGGER_HINTS[form.trigger_event]}</p>
            </div>
          </div>

          {/* 2 · Recebimento */}
          <div>
            <SectionTitle>2 · Recebimento</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
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
                  <label className="label-sm">Adquirente *</label>
                  <select className="input-field" value={form.acquirer_id ?? ''} onChange={e => set('acquirer_id', e.target.value || null)}>
                    <option value="">Selecione</option>
                    {acquirers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    A taxa e o prazo por bandeira e parcela vêm da aba Adquirentes e substituem
                    a taxa acima quando a bandeira é conhecida.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 3 · Parceiro */}
          <div>
            <SectionTitle>
              <span className="inline-flex items-center gap-2">
                3 · Parceiro / tomador da NF
                {isFaturamento && (
                  <span className="normal-case tracking-normal px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    obrigatório
                  </span>
                )}
              </span>
            </SectionTitle>
            <PartnerPicker hotelId={hotelId} value={partner} onChange={handlePartner} required={isFaturamento} />

            {groupRules.length > 0 && (
              <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-xs font-medium text-blue-800 dark:text-blue-300">
                  Este parceiro já tem regra em outra unidade do grupo:
                </p>
                <ul className="mt-1.5 space-y-1">
                  {groupRules.map(r => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
                      <span className="font-semibold">{r.hotel_name ?? 'outra unidade'}</span>
                      <span>
                        {TRIGGER_LABELS[r.trigger_event]} · {r.days_to_receive} dias · {r.default_fee_percent}%
                      </span>
                      <button type="button" onClick={() => copyFromGroupRule(r)}
                        className="underline hover:no-underline">Copiar esta configuração</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 4 · Cobrança — só em faturamento */}
          {isFaturamento && (
            <div>
              <SectionTitle>4 · Cobrança por e-mail</SectionTitle>
              <BillingEmailFields
                value={{
                  billing_email: form.billing_email ?? null,
                  billing_cc_emails: form.billing_cc_emails ?? [],
                  billing_subject_template: form.billing_subject_template ?? null,
                  billing_body_template: form.billing_body_template ?? null,
                  billing_attach_nf: form.billing_attach_nf ?? true,
                  billing_dispatch_mode: form.billing_dispatch_mode ?? 'manual',
                }}
                onChange={setBilling}
                partnerEmail={partner?.email}
                senderConfigured={senderConfigured}
              />
            </div>
          )}

          {/* 5 · Replicar e ativar */}
          <div>
            <SectionTitle>{isFaturamento ? '5' : '4'} · Replicar e ativar</SectionTitle>
            {others.length > 0 && (
              <div className="mb-3">
                <label className="label-sm">Também criar esta regra em</label>
                <div className="flex flex-wrap gap-2">
                  {others.map(h => {
                    const on = replicateTo.has(h.id);
                    return (
                      <button key={h.id} type="button"
                        onClick={() => setReplicateTo(prev => {
                          const next = new Set(prev);
                          if (next.has(h.id)) next.delete(h.id); else next.add(h.id);
                          return next;
                        })}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                          on
                            ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300'
                            : 'dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}>
                        {h.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  O fornecedor é criado na unidade de destino a partir dos dados já consultados,
                  sem nova consulta à Receita.
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600" />
              <span className="text-sm text-gray-700 dark:text-gray-300">Regra ativa</span>
            </label>
          </div>
        </form>

        <div className="px-5 py-4 border-t dark:border-gray-700 shrink-0">
          {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
          {replicateResult && (
            <p className="mb-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-1">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{replicateResult}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              {replicateResult ? 'Fechar' : 'Cancelar'}
            </button>
            <button type="submit" form="channel-rule-form" disabled={saving}
              className="px-5 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar regra
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Acquirer card with inline rules ──────────────────────────────────────────

function AcquirerCard({ acquirer, hotelId, onDeleted, onError }: {
  acquirer: CardAcquirer; hotelId: string; onDeleted: () => void; onError: (m: string) => void;
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
    acquirer_id: acquirer.id!, hotel_id: hotelId, card_brand: 'visa', modality: 'credito',
    installment_from: 1, installment_to: 1, fee_percent: 0, settlement_days: 30,
    installment_interval_days: 30, active: true,
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
                    <th className="text-right py-2">1ª parcela</th>
                    <th className="text-right py-2">Intervalo</th>
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
                      <td className="py-2 text-right">{r.settlement_days}d</td>
                      <td className="py-2 text-right">
                        {r.installment_to > 1 ? `+${r.installment_interval_days ?? 30}d` : '—'}
                      </td>
                      <td className="py-2 text-right">
                        <button onClick={() => setDraft(r)} className="p-1 text-gray-400 hover:text-blue-600"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteRule(r.id!)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                  {rules.length === 0 && !draft && (
                    <tr><td colSpan={7} className="py-3 text-center text-gray-400">Nenhuma regra cadastrada.</td></tr>
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
                <label className="label-sm">1ª parcela (dias)</label>
                <input className="input-field text-xs" type="number" min="0" value={draft.settlement_days}
                  onChange={e => setDraft({ ...draft, settlement_days: parseInt(e.target.value) || 0 })} />
              </div>
              {draft.installment_to > 1 && (
                <div>
                  <label className="label-sm">Intervalo entre parcelas</label>
                  <input className="input-field text-xs" type="number" min="0"
                    value={draft.installment_interval_days ?? 30}
                    onChange={e => setDraft({ ...draft, installment_interval_days: parseInt(e.target.value) || 0 })} />
                </div>
              )}
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

/** Regra vazia, usada como base do modal de criação e do deep link. */
function emptyRule(hotelId: string, channel = ''): ChannelReceivingRule {
  return {
    hotel_id: hotelId, channel, trigger_event: 'checkout', days_to_receive: 0,
    receiving_method: 'deposito', acquirer_id: null, default_fee_percent: 0, active: true,
    supplier_id: null, partner_cnpj: null,
    billing_email: null, billing_cc_emails: [],
    billing_subject_template: null, billing_body_template: null,
    billing_attach_nf: true, billing_dispatch_mode: 'manual',
  };
}

export default function RegrasRecebimentoPage() {
  const { selectedHotel } = useHotel();
  const { currentGroup } = useGroup();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('canais');
  const [rules, setRules] = useState<ChannelReceivingRule[]>([]);
  const [acquirers, setAcquirers] = useState<CardAcquirer[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [knownChannels, setKnownChannels] = useState<string[]>([]);
  const [groupHotels, setGroupHotels] = useState<{ id: string; name: string }[]>([]);
  const [senderConfigured, setSenderConfigured] = useState(false);
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
      arService.listGroupHotels(currentGroup?.id).then(setGroupHotels).catch(() => {});
      // Define se o modo "Automático" da regra pode ser prometido nesta unidade.
      emailConfigService.isConfigured(selectedHotel.id).then(setSenderConfigured).catch(() => {});
    } catch (err: any) { setError(err.message ?? 'Erro ao carregar'); }
    finally { setLoading(false); }
  }, [selectedHotel?.id, currentGroup?.id]);

  useEffect(() => { load(); }, [load]);

  // Deep link do aviso "canal sem regra" em Contas a Receber:
  // /finances/regras-recebimento?novo=1&canal=DECOLAR abre o modal preenchido.
  // Os params são consumidos na hora para o modal não reabrir a cada render.
  useEffect(() => {
    if (searchParams.get('novo') !== '1' || !selectedHotel?.id) return;
    const canal = searchParams.get('canal') ?? '';
    setTab('canais');
    setRuleModal({ open: true, data: emptyRule(selectedHotel.id, canal) });
    const next = new URLSearchParams(searchParams);
    next.delete('novo'); next.delete('canal');
    setSearchParams(next, { replace: true });
  }, [searchParams, selectedHotel?.id, setSearchParams]);

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
          ['remetente', 'Remetente de E-mail', <Mail key="i" className="w-4 h-4" />],
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
                    <th className="text-left px-4 py-3">Parceiro</th>
                    <th className="text-left px-4 py-3">Evento</th>
                    <th className="text-center px-4 py-3">Dias</th>
                    <th className="text-left px-4 py-3">Forma</th>
                    <th className="text-right px-4 py-3">Taxa (%)</th>
                    <th className="text-center px-4 py-3">Cobrança</th>
                    <th className="text-center px-4 py-3">Ativa</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 ? (
                    <tr><td colSpan={9} className="py-10 text-center text-gray-500">
                      Nenhuma regra. Crie uma regra por canal — ex.: BOOKING recebe 15 dias após o check-out com 15% de comissão.
                    </td></tr>
                  ) : rules.map(r => (
                    <tr key={r.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{r.channel}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {r.partner_cnpj ? formatCnpj(r.partner_cnpj) : '—'}
                      </td>
                      <td className="px-4 py-3">{TRIGGER_LABELS[r.trigger_event]}</td>
                      <td className="px-4 py-3 text-center">{r.days_to_receive}</td>
                      <td className="px-4 py-3">{r.receiving_method === 'cartao' ? 'Cartão' : 'Depósito'}</td>
                      <td className="px-4 py-3 text-right">{r.default_fee_percent}%</td>
                      <td className="px-4 py-3 text-center text-xs">
                        {r.trigger_event !== 'faturamento' ? (
                          <span className="text-gray-400">—</span>
                        ) : r.billing_dispatch_mode === 'automatico' ? (
                          <span className="text-green-600 dark:text-green-400">Automática</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">Manual</span>
                        )}
                      </td>
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
      ) : tab === 'remetente' ? (
        <EmailSenderTab hotelId={selectedHotel.id} hotelName={selectedHotel.name} />
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
              <AcquirerCard key={a.id} acquirer={a} hotelId={selectedHotel.id} onDeleted={load} onError={setError} />
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
          groupHotels={groupHotels}
          senderConfigured={senderConfigured}
          onClose={() => setRuleModal({ open: false })}
          onSaved={() => { setRuleModal({ open: false }); load(); }}
        />
      )}
    </div>
  );
}
