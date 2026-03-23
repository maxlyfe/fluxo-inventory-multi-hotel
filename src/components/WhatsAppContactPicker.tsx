// src/components/WhatsAppContactPicker.tsx
// Modal para selecionar contatos e enviar link de orçamento via WhatsApp
// Mensagem editável com placeholders: {saudacao}, {contato}, {link}

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, X, Loader2, AlertCircle, Send, CheckCircle2, XCircle,
  Info,
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import {
  whatsappService,
  SupplierContact,
  getGreeting,
} from '../lib/whatsappService';

interface SendStatus {
  contactId: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  error?: string;
}

interface WhatsAppContactPickerProps {
  isOpen: boolean;
  onClose: () => void;
  budgetIds: string[];
  links: { budgetId: string; link: string; hotelName?: string }[];
  isUnified?: boolean;
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
  isOpen, onClose, budgetIds, links, isUnified = false, groupName,
}) => {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendStatuses, setSendStatuses] = useState<SendStatus[]>([]);
  const [done, setDone] = useState(false);

  // Mensagem editável
  const [messageTemplate, setMessageTemplate] = useState('');

  // Carregar contatos vinculados aos orçamentos
  useEffect(() => {
    if (!isOpen || budgetIds.length === 0) return;
    // Carregar mensagem salva do localStorage ou usar default
    const lsKey = isUnified ? LS_KEY_GROUP : LS_KEY_SINGLE;
    const saved = localStorage.getItem(lsKey);
    setMessageTemplate(saved || (isUnified ? DEFAULT_MESSAGE_GROUP : DEFAULT_MESSAGE_SINGLE));
    const load = async () => {
      setLoading(true);
      try {
        const allContacts: SupplierContact[] = [];
        const seenIds = new Set<string>();
        for (const bId of budgetIds) {
          const bc = await whatsappService.getBudgetContacts(bId);
          for (const c of bc) {
            if (!seenIds.has(c.id)) {
              seenIds.add(c.id);
              allContacts.push(c);
            }
          }
        }
        setContacts(allContacts);
        setSelectedIds(new Set(allContacts.map(c => c.id)));
      } catch {
        setContacts([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isOpen, budgetIds, isUnified]);

  // Persistir mensagem editada no localStorage
  useEffect(() => {
    if (!messageTemplate) return;
    const lsKey = isUnified ? LS_KEY_GROUP : LS_KEY_SINGLE;
    const defaultMsg = isUnified ? DEFAULT_MESSAGE_GROUP : DEFAULT_MESSAGE_SINGLE;
    // Só salvar se diferente do default
    if (messageTemplate !== defaultMsg) {
      localStorage.setItem(lsKey, messageTemplate);
    }
  }, [messageTemplate, isUnified]);

  // Reset ao fechar
  useEffect(() => {
    if (!isOpen) {
      setSendStatuses([]);
      setDone(false);
      setSending(false);
    }
  }, [isOpen]);

  const toggleContact = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map(c => c.id)));
    }
  };

  // Inserir placeholder na posição do cursor
  const insertPlaceholder = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMessageTemplate(prev => prev + tag);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = messageTemplate.slice(0, start);
    const after = messageTemplate.slice(end);
    const newText = before + tag + after;
    setMessageTemplate(newText);
    // Reposicionar cursor após o placeholder
    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = start + tag.length;
      textarea.setSelectionRange(newPos, newPos);
    });
  };

  // Resolver placeholders para um contato específico
  const resolveMessage = (contact: SupplierContact): string => {
    const greeting = getGreeting();
    const mainLink = links[0]?.link || '';
    return messageTemplate
      .replace(/\{saudacao\}/gi, greeting)
      .replace(/\{contato\}/gi, contact.company_name || contact.contact_name || '')
      .replace(/\{link\}/gi, mainLink);
  };

  // Preview com o primeiro contato selecionado
  const previewContact = contacts.find(c => selectedIds.has(c.id)) || contacts[0];
  const previewMessage = previewContact
    ? resolveMessage(previewContact)
    : messageTemplate
        .replace(/\{saudacao\}/gi, getGreeting())
        .replace(/\{contato\}/gi, 'Empresa Exemplo')
        .replace(/\{link\}/gi, links[0]?.link || 'https://...');

  const greeting = getGreeting();
  const hotelName = selectedHotel?.name || 'Hotel';
  const mainLink = links[0]?.link || '';

  const handleSend = async () => {
    if (!selectedHotel || selectedIds.size === 0) return;
    setSending(true);

    const selected = contacts.filter(c => selectedIds.has(c.id));
    const statuses: SendStatus[] = selected.map(c => ({ contactId: c.id, status: 'pending' }));
    setSendStatuses([...statuses]);

    const templateKey = isUnified ? 'budget_link_group' : 'budget_link_single';
    const templateName = isUnified ? 'fluxo_cotacao_grupo' : 'fluxo_cotacao_individual';

    for (let i = 0; i < selected.length; i++) {
      const contact = selected[i];
      statuses[i].status = 'sending';
      setSendStatuses([...statuses]);

      try {
        const result = await whatsappService.sendTemplate({
          hotelId: selectedHotel.id,
          recipientPhone: contact.whatsapp_number,
          templateName,
          bodyParams: isUnified
            ? [greeting, groupName || hotelName, mainLink]
            : [greeting, hotelName, mainLink],
        });

        if (result.success) {
          statuses[i].status = 'sent';
          await whatsappService.logMessage({
            hotel_id: selectedHotel.id,
            contact_id: contact.id,
            template_key: templateKey,
            whatsapp_message_id: result.messageId,
            status: 'sent',
            metadata: { budget_ids: budgetIds, link: mainLink, custom_message: resolveMessage(contact) },
            sent_by: user?.id,
          });
        } else {
          statuses[i].status = 'failed';
          statuses[i].error = result.error;
          await whatsappService.logMessage({
            hotel_id: selectedHotel.id,
            contact_id: contact.id,
            template_key: templateKey,
            status: 'failed',
            error_message: result.error,
            metadata: { budget_ids: budgetIds },
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">
                Nenhum contato vinculado aos produtos deste orçamento.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Vincule fornecedores aos produtos no Inventário para que apareçam aqui.
              </p>
            </div>
          ) : (
            <>
              {/* ── Mensagem editável ────────────────────────── */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Mensagem
                </label>

                {/* Placeholder buttons */}
                <div className="flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map(p => (
                    <button key={p.tag} type="button"
                      onClick={() => insertPlaceholder(p.tag)}
                      disabled={sending || done}
                      className="px-2.5 py-1 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-semibold hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50"
                      title={p.desc}>
                      + {p.label}
                    </button>
                  ))}
                </div>

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={messageTemplate}
                  onChange={e => setMessageTemplate(e.target.value)}
                  disabled={sending || done}
                  rows={6}
                  className="w-full p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors resize-none disabled:opacity-60"
                  placeholder="Escreva sua mensagem usando os placeholders acima..."
                />

                <p className="text-xs text-gray-400 flex items-start gap-1">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  Use os botões acima para inserir variáveis. Elas serão substituídas automaticamente ao enviar.
                </p>
              </div>

              {/* ── Preview ──────────────────────────────────── */}
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <p className="text-xs font-bold text-green-700 dark:text-green-300 mb-1">
                  Preview {previewContact ? `(${previewContact.company_name})` : ''}:
                </p>
                <p className="text-sm text-green-800 dark:text-green-200 whitespace-pre-line">{previewMessage}</p>
              </div>

              {/* ── Contatos ─────────────────────────────────── */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {selectedIds.size} de {contacts.length} selecionado{selectedIds.size !== 1 ? 's' : ''}
                </span>
                <button onClick={toggleAll}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium">
                  {selectedIds.size === contacts.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>

              <div className="space-y-2">
                {contacts.map(contact => {
                  const status = sendStatuses.find(s => s.contactId === contact.id);
                  return (
                    <label key={contact.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                        selectedIds.has(contact.id)
                          ? 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      } ${sending || done ? 'pointer-events-none' : ''}`}>
                      <input type="checkbox" checked={selectedIds.has(contact.id)}
                        onChange={() => toggleContact(contact.id)} disabled={sending || done}
                        className="h-4 w-4 rounded text-green-600 border-gray-300 focus:ring-green-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {contact.company_name}
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {contact.whatsapp_number}
                          {contact.contact_name && ` — ${contact.contact_name}`}
                        </p>
                      </div>
                      {status && (
                        <div className="flex-shrink-0">
                          {status.status === 'sending' && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                          {status.status === 'sent' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                          {status.status === 'failed' && (
                            <span title={status.error}><XCircle className="w-4 h-4 text-red-500" /></span>
                          )}
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* Result summary */}
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
              disabled={sending || selectedIds.size === 0 || contacts.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar ({selectedIds.size})
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default WhatsAppContactPicker;
