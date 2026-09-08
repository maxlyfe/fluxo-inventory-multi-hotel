// src/components/WhatsAppContactPicker.tsx
// Modal para escolher destinatários e enviar o link de orçamento por WhatsApp.
//
// Duas abas:
//  - Destinatários: contatos vinculados ao orçamento, agenda completa e números
//    avulsos digitados na hora (com opção de salvar na agenda e de somar o
//    contato ao cadastro dos produtos do orçamento, sem apagar os já ligados).
//  - Mensagem: edição do texto com prévia real, aplicável só a este envio ou
//    salva como padrão para os próximos.
//
// Placeholders: {saudacao}, {contato}, {link}

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  MessageSquare, X, Loader2, AlertCircle, Send, CheckCircle2, XCircle,
  Info, Search, Plus, Trash2, Users, Phone, Link2, Save, RotateCcw,
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import {
  whatsappService,
  SupplierContact,
  getGreeting,
  isValidWhatsAppNumber,
  formatWhatsAppNumber,
} from '../lib/whatsappService';
import { searchMatchAll } from '../utils/search';

interface SendStatus {
  recipientId: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  error?: string;
}

/** Número avulso digitado no modal, ainda não necessariamente na agenda */
interface ManualEntry {
  id: string;
  name: string;
  number: string;
  /** Gravar em supplier_contacts ao enviar */
  saveToAgenda: boolean;
  /** Somar aos fornecedores dos produtos deste orçamento (implica saveToAgenda) */
  linkToProducts: boolean;
}

/** Destinatário resolvido, venha da agenda ou digitado na hora */
interface Recipient {
  id: string;
  contactId: string | null;
  label: string;
  number: string;
}

interface WhatsAppContactPickerProps {
  isOpen: boolean;
  onClose: () => void;
  budgetIds: string[];
  links: { budgetId: string; link: string; hotelName?: string }[];
  isUnified?: boolean;
  /**
   * Link do orçamento unificado. Quando existe, é ele que vai na mensagem: uma
   * cotação unificada propaga as respostas para os hotéis do grupo, enquanto
   * mandar o link de um hotel só deixa os outros sem nenhuma resposta.
   */
  unifiedLink?: string;
  groupName?: string;
}

// Placeholders disponíveis
const PLACEHOLDERS = [
  { tag: '{saudacao}', label: 'Saudação', desc: 'Bom dia / Boa tarde / Boa noite' },
  { tag: '{contato}', label: 'Contato', desc: 'Nome da empresa do contato' },
  { tag: '{link}', label: 'Link', desc: 'Link do orçamento' },
];

const DEFAULT_MESSAGE_SINGLE = `{saudacao}, somos do hotel e gostaríamos de solicitar uma cotação.

Acesse o link abaixo para preencher seus preços:
{link}

Obrigado!`;

const DEFAULT_MESSAGE_GROUP = `{saudacao}, somos do grupo e gostaríamos de solicitar uma cotação unificada.

Acesse o link abaixo:
{link}

Obrigado!`;

const LS_KEY_SINGLE = 'whatsapp_msg_template_single';
const LS_KEY_GROUP = 'whatsapp_msg_template_group';

const WhatsAppContactPicker: React.FC<WhatsAppContactPickerProps> = ({
  isOpen, onClose, budgetIds, links, isUnified = false, unifiedLink, groupName,
}) => {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [tab, setTab] = useState<'recipients' | 'message'>('recipients');

  const [loading, setLoading] = useState(true);
  /** Contatos sugeridos: vinculados aos produtos do orçamento */
  const [budgetContacts, setBudgetContacts] = useState<SupplierContact[]>([]);
  /** Agenda completa, para escolher quem não está vinculado */
  const [allContacts, setAllContacts] = useState<SupplierContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contactSearch, setContactSearch] = useState('');
  const [showAgenda, setShowAgenda] = useState(false);

  // Números avulsos
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [newSave, setNewSave] = useState(true);
  const [newLink, setNewLink] = useState(true);

  const [sending, setSending] = useState(false);
  const [sendStatuses, setSendStatuses] = useState<SendStatus[]>([]);
  const [done, setDone] = useState(false);

  // Mensagem editável e escopo do que for editado
  const lsKey = isUnified ? LS_KEY_GROUP : LS_KEY_SINGLE;
  const defaultMessage = isUnified ? DEFAULT_MESSAGE_GROUP : DEFAULT_MESSAGE_SINGLE;
  const [messageTemplate, setMessageTemplate] = useState('');
  const [savedTemplate, setSavedTemplate] = useState('');
  /** 'once' = vale só para este disparo; 'always' = vira o padrão salvo */
  const [scope, setScope] = useState<'once' | 'always'>('once');
  const [scopeSavedAt, setScopeSavedAt] = useState<number | null>(null);

  // O pai monta budgetIds inline (novo array a cada render): usar o array como
  // dependência do efeito recarregaria os contatos em loop.
  const budgetKey = budgetIds.join(',');

  // ── Carregar contatos e template ──
  useEffect(() => {
    if (!isOpen) return;

    const stored = localStorage.getItem(lsKey) || defaultMessage;
    setSavedTemplate(stored);
    setMessageTemplate(stored);
    setScope('once');
    setScopeSavedAt(null);
    setTab('recipients');

    const load = async () => {
      setLoading(true);
      try {
        const [linked, agenda] = await Promise.all([
          (async () => {
            const acc: SupplierContact[] = [];
            const seen = new Set<string>();
            for (const bId of budgetIds) {
              const bc = await whatsappService.getBudgetContacts(bId);
              for (const c of bc) {
                if (!seen.has(c.id)) { seen.add(c.id); acc.push(c); }
              }
            }
            return acc;
          })(),
          whatsappService.getContacts().catch(() => [] as SupplierContact[]),
        ]);
        setBudgetContacts(linked);
        setAllContacts(agenda);
        // Vinculados já vêm marcados; o resto da agenda entra por escolha.
        setSelectedIds(new Set(linked.map(c => c.id)));
      } catch {
        setBudgetContacts([]);
        setAllContacts([]);
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, budgetKey, isUnified]);

  // Reset ao fechar
  useEffect(() => {
    if (!isOpen) {
      setSendStatuses([]);
      setDone(false);
      setSending(false);
      setManualEntries([]);
      setNewName('');
      setNewNumber('');
      setContactSearch('');
      setShowAgenda(false);
    }
  }, [isOpen]);

  // ── Contatos ──
  const budgetContactIds = useMemo(
    () => new Set(budgetContacts.map(c => c.id)),
    [budgetContacts]
  );

  /** Agenda menos os que já aparecem na lista de vinculados */
  const agendaContacts = useMemo(() => {
    return allContacts.filter(c => {
      if (budgetContactIds.has(c.id)) return false;
      return searchMatchAll(contactSearch, c.company_name, c.contact_name, c.whatsapp_number);
    });
  }, [allContacts, budgetContactIds, contactSearch]);

  const contactById = useMemo(() => {
    const map = new Map<string, SupplierContact>();
    for (const c of [...budgetContacts, ...allContacts]) map.set(c.id, c);
    return map;
  }, [budgetContacts, allContacts]);

  const toggleContact = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllLinked = () => {
    const allLinkedSelected = budgetContacts.every(c => selectedIds.has(c.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const c of budgetContacts) {
        allLinkedSelected ? next.delete(c.id) : next.add(c.id);
      }
      return next;
    });
  };

  // ── Números avulsos ──
  const numberAlreadyListed = (num: string) => {
    const formatted = formatWhatsAppNumber(num);
    if (manualEntries.some(m => formatWhatsAppNumber(m.number) === formatted)) return true;
    return [...selectedIds].some(id => {
      const c = contactById.get(id);
      return c ? formatWhatsAppNumber(c.whatsapp_number) === formatted : false;
    });
  };

  const [manualError, setManualError] = useState<string | null>(null);

  const addManualEntry = () => {
    const number = newNumber.trim();
    if (!isValidWhatsAppNumber(number)) {
      setManualError('Número inválido. Informe DDD + número (ou +código do país).');
      return;
    }
    if (numberAlreadyListed(number)) {
      setManualError('Este número já está na lista de envio.');
      return;
    }
    setManualEntries(prev => [...prev, {
      id: `manual-${Date.now()}-${prev.length}`,
      name: newName.trim(),
      number,
      saveToAgenda: newSave || newLink,
      linkToProducts: newLink,
    }]);
    setNewName('');
    setNewNumber('');
    setManualError(null);
  };

  const removeManualEntry = (id: string) => {
    setManualEntries(prev => prev.filter(m => m.id !== id));
  };

  const updateManualEntry = (id: string, patch: Partial<ManualEntry>) => {
    setManualEntries(prev => prev.map(m => {
      if (m.id !== id) return m;
      const next = { ...m, ...patch };
      // Vincular ao produto exige o contato existir na agenda.
      if (next.linkToProducts) next.saveToAgenda = true;
      return next;
    }));
  };

  // ── Destinatários finais ──
  const recipients: Recipient[] = useMemo(() => {
    const fromContacts: Recipient[] = [...selectedIds]
      .map(id => contactById.get(id))
      .filter((c): c is SupplierContact => !!c)
      .map(c => ({
        id: c.id,
        contactId: c.id,
        label: c.company_name || c.contact_name || c.whatsapp_number,
        number: c.whatsapp_number,
      }));
    const fromManual: Recipient[] = manualEntries.map(m => ({
      id: m.id,
      contactId: null,
      label: m.name || m.number,
      number: m.number,
    }));
    return [...fromContacts, ...fromManual];
  }, [selectedIds, contactById, manualEntries]);

  // ── Mensagem ──
  const insertPlaceholder = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMessageTemplate(prev => prev + tag);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = messageTemplate.slice(0, start) + tag + messageTemplate.slice(end);
    setMessageTemplate(newText);
    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = start + tag.length;
      textarea.setSelectionRange(newPos, newPos);
    });
  };

  /**
   * Link que vai na mensagem.
   *
   * Com cotação unificada é o link unificado, porque ele propaga as respostas do
   * fornecedor para todos os hotéis do grupo. Mandar o link de um hotel só faria
   * os demais orçamentos ficarem sem nenhuma resposta.
   */
  const mainLink = (isUnified && unifiedLink) ? unifiedLink : (links[0]?.link || '');

  const resolveMessage = (label: string): string => messageTemplate
    .replace(/\{saudacao\}/gi, getGreeting())
    .replace(/\{contato\}/gi, label)
    .replace(/\{link\}/gi, mainLink);

  const previewMessage = messageTemplate
    .replace(/\{saudacao\}/gi, getGreeting())
    .replace(/\{contato\}/gi, recipients[0]?.label || 'Empresa Exemplo')
    .replace(/\{link\}/gi, mainLink || 'https://...');

  const templateChanged = messageTemplate !== savedTemplate;

  /** Grava o texto atual como padrão dos próximos envios */
  const persistTemplate = () => {
    if (messageTemplate === defaultMessage) {
      localStorage.removeItem(lsKey);
    } else {
      localStorage.setItem(lsKey, messageTemplate);
    }
    setSavedTemplate(messageTemplate);
    setScopeSavedAt(Date.now());
  };

  const restoreDefault = () => {
    setMessageTemplate(defaultMessage);
    if (scope === 'always') {
      localStorage.removeItem(lsKey);
      setSavedTemplate(defaultMessage);
    }
  };

  const greeting = getGreeting();
  const hotelName = selectedHotel?.name || 'Hotel';

  // ── Envio ──
  const handleSend = async () => {
    if (!selectedHotel || recipients.length === 0) return;
    setSending(true);

    // O escopo "todos os envios futuros" grava antes do disparo: se algum envio
    // falhar, o texto que a pessoa aprovou não se perde.
    if (scope === 'always' && templateChanged) persistTemplate();

    // Números avulsos que devem entrar na agenda / no cadastro dos produtos.
    // Feito antes do loop para que o log já saia com o contact_id certo.
    const manualContactIds = new Map<string, string>();
    const toLink = manualEntries.filter(m => m.saveToAgenda || m.linkToProducts);
    if (toLink.length > 0) {
      let productIds: string[] = [];
      if (toLink.some(m => m.linkToProducts)) {
        productIds = await whatsappService.getBudgetProductIds(budgetIds).catch(() => []);
      }
      for (const m of toLink) {
        try {
          const saved = await whatsappService.saveContact({
            company_name: m.name || m.number,
            whatsapp_number: formatWhatsAppNumber(m.number),
            contact_name: null,
            // Contato global: a agenda é compartilhada entre as unidades.
            hotel_id: undefined,
          });
          manualContactIds.set(m.id, saved.id);
          if (m.linkToProducts && productIds.length > 0) {
            // Soma aos fornecedores já ligados ao produto, nunca substitui.
            await whatsappService.addProductContacts(productIds, saved.id);
          }
        } catch {
          // Falhar ao cadastrar não pode impedir o envio da cotação: segue sem
          // contact_id e a mensagem vai do mesmo jeito.
        }
      }
    }

    const statuses: SendStatus[] = recipients.map(r => ({ recipientId: r.id, status: 'pending' }));
    setSendStatuses([...statuses]);

    const templateKey = isUnified ? 'budget_link_group' : 'budget_link_single';
    const templateName = isUnified ? 'fluxo_cotacao_grupo' : 'fluxo_cotacao_individual';

    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      statuses[i].status = 'sending';
      setSendStatuses([...statuses]);

      const contactId = r.contactId || manualContactIds.get(r.id) || null;
      const body = resolveMessage(r.label);

      try {
        const result = await whatsappService.sendTemplate({
          hotelId: selectedHotel.id,
          recipientPhone: r.number,
          templateName,
          bodyParams: isUnified
            ? [greeting, groupName || hotelName, mainLink]
            : [greeting, hotelName, mainLink],
          // A Meta ignora este campo e usa o template aprovado. O Evolution envia
          // a mensagem personalizada exatamente como aparece na prévia.
          bodyText: body,
        });

        if (result.success) {
          statuses[i].status = 'sent';
          await whatsappService.logMessage({
            hotel_id: selectedHotel.id,
            contact_id: contactId ?? undefined,
            template_key: templateKey,
            whatsapp_message_id: result.messageId,
            status: 'sent',
            metadata: { budget_ids: budgetIds, link: mainLink, custom_message: body, recipient_phone: r.number },
            sent_by: user?.id,
          });
        } else {
          statuses[i].status = 'failed';
          statuses[i].error = result.error;
          await whatsappService.logMessage({
            hotel_id: selectedHotel.id,
            contact_id: contactId ?? undefined,
            template_key: templateKey,
            status: 'failed',
            error_message: result.error,
            metadata: { budget_ids: budgetIds, recipient_phone: r.number },
            sent_by: user?.id,
          });
        }
      } catch (err: unknown) {
        statuses[i].status = 'failed';
        statuses[i].error = err instanceof Error ? err.message : 'Erro';
      }
      setSendStatuses([...statuses]);
    }

    setSending(false);
    setDone(true);
  };

  if (!isOpen) return null;

  const sentCount = sendStatuses.filter(s => s.status === 'sent').length;
  const failedCount = sendStatuses.filter(s => s.status === 'failed').length;
  const locked = sending || done;

  const statusIcon = (id: string) => {
    const st = sendStatuses.find(s => s.recipientId === id);
    if (!st) return null;
    if (st.status === 'sending') return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    if (st.status === 'sent') return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (st.status === 'failed') return <span title={st.error}><XCircle className="w-4 h-4 text-red-500" /></span>;
    return null;
  };

  const contactRow = (c: SupplierContact) => (
    <label key={c.id}
      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
        selectedIds.has(c.id)
          ? 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10'
          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
      } ${locked ? 'pointer-events-none' : ''}`}>
      <input type="checkbox" checked={selectedIds.has(c.id)}
        onChange={() => toggleContact(c.id)} disabled={locked}
        className="h-4 w-4 rounded text-green-600 border-gray-300 focus:ring-green-500" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.company_name}</p>
        <p className="text-xs text-gray-400 truncate">
          {c.whatsapp_number}{c.contact_name && ` — ${c.contact_name}`}
        </p>
      </div>
      <div className="flex-shrink-0">{statusIcon(c.id)}</div>
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-green-500" />
            Enviar via WhatsApp
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas */}
        <div className="flex-shrink-0 flex border-b border-gray-200 dark:border-gray-700 px-5">
          {([
            { key: 'recipients' as const, label: `Destinatários (${recipients.length})`, icon: Users },
            { key: 'message' as const, label: 'Mensagem', icon: MessageSquare },
          ]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
          ) : tab === 'recipients' ? (
            <>
              {/* ── Vinculados ao orçamento ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Vinculados aos produtos
                  </span>
                  {budgetContacts.length > 0 && (
                    <button onClick={toggleAllLinked} disabled={locked}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium disabled:opacity-50">
                      {budgetContacts.every(c => selectedIds.has(c.id)) ? 'Desmarcar todos' : 'Selecionar todos'}
                    </button>
                  )}
                </div>
                {budgetContacts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-center">
                    <AlertCircle className="w-6 h-6 text-gray-300 mx-auto mb-1.5" />
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Nenhum contato vinculado aos produtos deste orçamento.
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Escolha na agenda abaixo ou adicione um número manualmente.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">{budgetContacts.map(contactRow)}</div>
                )}
              </div>

              {/* ── Agenda completa ── */}
              <div className="space-y-2">
                <button onClick={() => setShowAgenda(v => !v)}
                  className="w-full flex items-center justify-between text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-200">
                  <span>Outros contatos da agenda ({agendaContacts.length})</span>
                  <span className="text-[10px] normal-case font-medium">{showAgenda ? 'ocultar' : 'mostrar'}</span>
                </button>

                {showAgenda && (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input value={contactSearch} onChange={e => setContactSearch(e.target.value)}
                        disabled={locked}
                        placeholder="Buscar por empresa, contato ou número..."
                        className="w-full pl-9 pr-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                    </div>
                    {agendaContacts.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-3">Nenhum contato encontrado.</p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {agendaContacts.map(contactRow)}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Números avulsos ── */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Adicionar número manualmente
                </span>

                {manualEntries.map(m => (
                  <div key={m.id}
                    className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10 p-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <Phone className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {m.name || 'Sem nome'}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{formatWhatsAppNumber(m.number)}</p>
                      </div>
                      {statusIcon(m.id)}
                      {!locked && (
                        <button onClick={() => removeManualEntry(m.id)}
                          className="text-gray-400 hover:text-red-500 flex-shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pl-7">
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                        <input type="checkbox" checked={m.saveToAgenda} disabled={locked || m.linkToProducts}
                          onChange={e => updateManualEntry(m.id, { saveToAgenda: e.target.checked })}
                          className="h-3.5 w-3.5 rounded text-green-600 border-gray-300 focus:ring-green-500" />
                        Salvar na agenda
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                        <input type="checkbox" checked={m.linkToProducts} disabled={locked}
                          onChange={e => updateManualEntry(m.id, { linkToProducts: e.target.checked })}
                          className="h-3.5 w-3.5 rounded text-green-600 border-gray-300 focus:ring-green-500" />
                        <Link2 className="w-3 h-3" /> Incluir nos produtos do orçamento
                      </label>
                    </div>
                  </div>
                ))}

                {!locked && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input value={newName} onChange={e => setNewName(e.target.value)}
                        placeholder="Nome / empresa (opcional)"
                        className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                      <input value={newNumber} onChange={e => { setNewNumber(e.target.value); setManualError(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManualEntry(); } }}
                        placeholder="22 99999-9999"
                        className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                        <input type="checkbox" checked={newSave || newLink} disabled={newLink}
                          onChange={e => setNewSave(e.target.checked)}
                          className="h-3.5 w-3.5 rounded text-green-600 border-gray-300 focus:ring-green-500" />
                        Salvar na agenda
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                        <input type="checkbox" checked={newLink}
                          onChange={e => setNewLink(e.target.checked)}
                          className="h-3.5 w-3.5 rounded text-green-600 border-gray-300 focus:ring-green-500" />
                        <Link2 className="w-3 h-3" /> Incluir nos produtos do orçamento
                      </label>
                    </div>
                    {manualError && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {manualError}
                      </p>
                    )}
                    <button onClick={addManualEntry} disabled={!newNumber.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
                      <Plus className="w-3.5 h-3.5" /> Adicionar à lista
                    </button>
                    <p className="text-xs text-gray-400 flex items-start gap-1">
                      <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      Vincular ao produto soma este contato aos fornecedores já cadastrados, sem remover nenhum.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* ── Aba Mensagem ── */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map(p => (
                    <button key={p.tag} type="button"
                      onClick={() => insertPlaceholder(p.tag)}
                      disabled={locked}
                      className="px-2.5 py-1 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-semibold hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50"
                      title={p.desc}>
                      + {p.label}
                    </button>
                  ))}
                </div>

                <textarea
                  ref={textareaRef}
                  value={messageTemplate}
                  onChange={e => setMessageTemplate(e.target.value)}
                  disabled={locked}
                  rows={7}
                  className="w-full p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors resize-none disabled:opacity-60"
                  placeholder="Escreva sua mensagem usando os placeholders acima..."
                />
              </div>

              {/* Prévia real */}
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <p className="text-xs font-bold text-green-700 dark:text-green-300 mb-1">
                  Prévia {recipients[0] ? `(${recipients[0].label})` : ''}
                </p>
                <p className="text-sm text-green-800 dark:text-green-200 whitespace-pre-line">{previewMessage}</p>
              </div>

              {/* Escopo da alteração */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Aplicar alteração
                </span>
                {([
                  { key: 'once' as const, title: 'Somente neste envio', desc: 'O texto padrão continua o mesmo na próxima cotação.' },
                  { key: 'always' as const, title: 'Salvar para os próximos envios', desc: 'Vira o texto padrão deste tipo de cotação.' },
                ]).map(opt => (
                  <label key={opt.key}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      scope === opt.key
                        ? 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    } ${locked ? 'pointer-events-none opacity-60' : ''}`}>
                    <input type="radio" name="msg-scope" checked={scope === opt.key} disabled={locked}
                      onChange={() => setScope(opt.key)}
                      className="mt-0.5 h-4 w-4 text-green-600 border-gray-300 focus:ring-green-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{opt.title}</p>
                      <p className="text-xs text-gray-400">{opt.desc}</p>
                    </div>
                  </label>
                ))}

                <div className="flex flex-wrap items-center gap-2">
                  {scope === 'always' && (
                    <button onClick={persistTemplate} disabled={locked || !templateChanged}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
                      <Save className="w-3.5 h-3.5" /> Salvar padrão agora
                    </button>
                  )}
                  <button onClick={restoreDefault} disabled={locked || messageTemplate === defaultMessage}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
                    <RotateCcw className="w-3.5 h-3.5" /> Restaurar texto padrão
                  </button>
                  {scopeSavedAt && !templateChanged && (
                    <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Padrão salvo
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Resultado */}
          {done && (
            <div className={`p-3 rounded-lg text-sm ${
              failedCount === 0
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300'
            }`}>
              {sentCount > 0 && <p>{sentCount} mensagem(ns) enviada(s) com sucesso.</p>}
              {failedCount > 0 && <p>{failedCount} falha(s) no envio. Verifique o log.</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose}
            className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            {done ? 'Fechar' : 'Cancelar'}
          </button>
          {!done && (
            <button onClick={handleSend}
              disabled={sending || recipients.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar ({recipients.length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default WhatsAppContactPicker;
