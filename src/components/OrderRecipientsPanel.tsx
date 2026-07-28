// src/components/OrderRecipientsPanel.tsx
// Vincula um contato de WhatsApp a cada fornecedor da lista de compras.
//
// O vínculo é manual de propósito: o nome que o fornecedor digita na cotação
// pública é texto livre e o mesmo link vai para vários, então não há como
// deduzir com segurança quem respondeu o quê. Aqui o operador decide.
//
// Na aprovação, cada fornecedor com contato recebe a imagem do pedido contendo
// só os itens dele. Sem contato, o pedido fica em 'aprovado' para envio manual.

import React, { useEffect, useState } from 'react';
import { Send, Phone, Loader2, CheckCircle2, AlertCircle, Users } from 'lucide-react';
import { whatsappService, SupplierContact, isValidWhatsAppNumber } from '../lib/whatsappService';

export interface RecipientChoice {
  contactId: string | null;
  whatsappNumber: string;
}

export type RecipientMap = Record<string, RecipientChoice>;

interface Props {
  /** Fornecedores distintos presentes na lista */
  suppliers: string[];
  value: RecipientMap;
  onChange: (next: RecipientMap) => void;
  disabled?: boolean;
}

const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';
const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50';

const OrderRecipientsPanel: React.FC<Props> = ({ suppliers, value, onChange, disabled }) => {
  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const data = await whatsappService.getContacts();
        if (ativo) setContacts(data);
      } catch {
        // Sem contatos cadastrados o painel ainda serve para digitar o número
      } finally {
        if (ativo) setLoading(false);
      }
    })();
    return () => { ativo = false; };
  }, []);

  const set = (supplier: string, patch: Partial<RecipientChoice>) => {
    const atual = value[supplier] || { contactId: null, whatsappNumber: '' };
    onChange({ ...value, [supplier]: { ...atual, ...patch } });
  };

  /** Sugere o contato cujo nome de empresa mais se aproxima do fornecedor */
  const suggestFor = (supplier: string): SupplierContact | undefined => {
    const norm = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const alvo = norm(supplier);
    if (!alvo || alvo === 'não especificado') return undefined;
    return (
      contacts.find(c => norm(c.company_name) === alvo)
      || contacts.find(c => norm(c.company_name).includes(alvo) || alvo.includes(norm(c.company_name)))
    );
  };

  if (suppliers.length === 0) return null;

  const vinculados = suppliers.filter(s => {
    const v = value[s];
    return v && (v.contactId || v.whatsappNumber.trim());
  }).length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 sm:p-6 mb-6">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white flex items-center gap-2">
          <Send className="h-4 w-4 text-blue-500" />
          Envio automático do pedido
        </h2>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
          vinculados === suppliers.length
            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
            : vinculados > 0
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
        }`}>
          {vinculados} de {suppliers.length} com contato
        </span>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Quando o orçamento for aprovado, cada fornecedor com contato recebe a imagem
        do pedido pelo WhatsApp, contendo apenas os itens dele. Sem contato, o pedido
        fica como aprovado para envio manual. Preencher é opcional.
      </p>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-3">
          {suppliers.map(supplier => {
            const v = value[supplier] || { contactId: null, whatsappNumber: '' };
            const sugestao = !v.contactId && !v.whatsappNumber.trim() ? suggestFor(supplier) : undefined;
            const numeroInvalido = Boolean(
              !v.contactId && v.whatsappNumber.trim() && !isValidWhatsAppNumber(v.whatsappNumber),
            );
            const ok = Boolean(v.contactId || (v.whatsappNumber.trim() && !numeroInvalido));

            return (
              <div
                key={supplier}
                className={`rounded-xl border p-3 ${
                  ok
                    ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center gap-2 mb-2.5">
                  {ok
                    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    : <AlertCircle className="h-4 w-4 text-gray-300 dark:text-gray-600 shrink-0" />}
                  <span className="text-sm font-bold text-gray-900 dark:text-white truncate">
                    {supplier}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className={labelCls}>
                      <Users className="inline h-3 w-3 mr-1" />
                      Contato cadastrado
                    </label>
                    <select
                      value={v.contactId || ''}
                      onChange={e => set(supplier, {
                        contactId: e.target.value || null,
                        // Escolher contato limpa o número digitado, para não haver dois destinos
                        whatsappNumber: e.target.value ? '' : v.whatsappNumber,
                      })}
                      disabled={disabled}
                      className={inputCls}
                    >
                      <option value="">Nenhum</option>
                      {contacts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.company_name}{c.contact_name ? ` (${c.contact_name})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>
                      <Phone className="inline h-3 w-3 mr-1" />
                      Ou número direto
                    </label>
                    <input
                      value={v.whatsappNumber}
                      onChange={e => set(supplier, { whatsappNumber: e.target.value, contactId: null })}
                      placeholder="22 99999 9999"
                      disabled={disabled || Boolean(v.contactId)}
                      className={`${inputCls} ${numeroInvalido ? 'border-red-400 dark:border-red-600' : ''}`}
                    />
                    {numeroInvalido && (
                      <p className="text-[11px] text-red-500 mt-1">Número incompleto.</p>
                    )}
                  </div>
                </div>

                {sugestao && (
                  <button
                    type="button"
                    onClick={() => set(supplier, { contactId: sugestao.id, whatsappNumber: '' })}
                    disabled={disabled}
                    className="mt-2 text-xs font-bold text-blue-500 hover:text-blue-600 disabled:opacity-50"
                  >
                    Usar {sugestao.company_name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrderRecipientsPanel;
