// src/components/financial/BillingEmailFields.tsx
// Seção de cobrança por e-mail do modal de regra de canal.
//
// Só aparece quando trigger_event = 'faturamento'. Nasce colapsada com um resumo
// de uma linha: quem só quer "30 dias, parceiro ACME" não precisa encarar
// template de e-mail.
//
// renderBillingTemplate espelha fn_render_billing_template do Postgres. As duas
// existem de propósito: a pré-visualização precisa ser instantânea no browser, e
// o envio precisa gravar o texto renderizado no dispatch para auditoria. Se uma
// mudar, a outra tem que mudar junto.

import React, { useState, useRef } from 'react';
import {
  Mail, Eye, EyeOff, ChevronDown, ChevronUp, AlertTriangle, Paperclip, Send, Hand,
} from 'lucide-react';
import { EmailChipsInput, isValidEmail } from './shared';
import type { BillingDispatchMode } from '../../lib/arService';

/** Variáveis aceitas no assunto e no corpo. Espelha a lista da RPC. */
export const BILLING_VARS = [
  'parceiro', 'razao_social', 'cnpj', 'numero_nf', 'chave_nf', 'link_nf',
  'valor', 'reserva', 'hospede', 'checkin', 'checkout', 'vencimento',
  'hotel', 'dias_prazo',
] as const;

export type BillingVar = typeof BILLING_VARS[number];

export const DEFAULT_SUBJECT = 'Cobrança NF {{numero_nf}} - {{hotel}}';
export const DEFAULT_BODY = [
  'Prezados {{parceiro}},',
  '',
  'Segue a nota fiscal {{numero_nf}} no valor de R$ {{valor}}, referente à reserva {{reserva}}.',
  'Vencimento: {{vencimento}} ({{dias_prazo}} dias).',
  '',
  'Documento: {{link_nf}}',
].join('\n');

/** Substituição literal de {{chave}}. Mesma semântica da função no Postgres. */
export function renderBillingTemplate(template: string, vars: Record<string, string>): string {
  let out = template ?? '';
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v ?? '');
  return out;
}

/** Variáveis usadas no template que o sistema não sabe substituir. */
export function unknownVars(...templates: string[]): string[] {
  const found = new Set<string>();
  for (const t of templates) {
    for (const m of (t ?? '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
      const key = m[1].toLowerCase();
      if (!BILLING_VARS.includes(key as BillingVar)) found.add(key);
    }
  }
  return Array.from(found);
}

const PREVIEW_VARS: Record<string, string> = {
  parceiro: 'ACME TURISMO LTDA', razao_social: 'ACME TURISMO LTDA',
  cnpj: '12.345.678/0001-00', numero_nf: '1234',
  chave_nf: '3326 0812 3456 7800 0100 5500 1000 0012 3410 0000 0017',
  link_nf: 'https://.../danfse/1234.pdf', valor: '2.400,00',
  reserva: '88123', hospede: 'João da Silva',
  checkin: '10/07/2026', checkout: '12/07/2026', vencimento: '11/08/2026',
  hotel: 'Costa do Sol Boutique Hotel', dias_prazo: '30',
};

export interface BillingConfig {
  billing_email: string | null;
  billing_cc_emails: string[];
  billing_subject_template: string | null;
  billing_body_template: string | null;
  billing_attach_nf: boolean;
  billing_dispatch_mode: BillingDispatchMode;
}

export default function BillingEmailFields({
  value, onChange, partnerEmail, senderConfigured, disabled,
}: {
  value: BillingConfig;
  onChange: (patch: Partial<BillingConfig>) => void;
  /** E-mail do cadastro do fornecedor, oferecido como default. */
  partnerEmail?: string | null;
  /**
   * false = a unidade ainda não configurou remetente. O modo automático fica
   * avisado: prometer envio que não acontece é o oposto do requisito antifalha.
   */
  senderConfigured?: boolean;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const subject = value.billing_subject_template ?? DEFAULT_SUBJECT;
  const body = value.billing_body_template ?? DEFAULT_BODY;
  const recipients = value.billing_email
    ? value.billing_email.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const unknown = unknownVars(subject, body);
  const invalid = [...recipients, ...(value.billing_cc_emails ?? [])].filter(e => !isValidEmail(e));

  const setRecipients = (list: string[]) => onChange({ billing_email: list.join(', ') || null });

  /** Insere a variável na posição do cursor do corpo. */
  const insertVar = (v: string) => {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) { onChange({ billing_body_template: `${body}${token}` }); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    const next = body.slice(0, start) + token + body.slice(end);
    onChange({ billing_body_template: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const resumo = [
    recipients.length ? `${recipients.length} destinatário(s)` : 'sem destinatário',
    value.billing_attach_nf ? 'com anexo' : 'sem anexo',
    value.billing_dispatch_mode === 'automatico' ? 'envio automático' : 'envio manual',
  ].join(' · ');

  return (
    <div className="rounded-xl border dark:border-gray-700 overflow-hidden">
      <button type="button" onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-left">
        <span className="flex items-center gap-2 min-w-0">
          <Mail className="w-4 h-4 text-purple-500 shrink-0" />
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Cobrança por e-mail</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate hidden sm:inline">· {resumo}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {(!recipients.length || invalid.length > 0) && (
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          )}
          <span className="text-xs text-gray-500">{expanded ? 'Recolher' : 'Personalizar'}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 py-3 space-y-3 border-t dark:border-gray-700">
          <div>
            <label className="label-sm">Destinatários *</label>
            <EmailChipsInput value={recipients} onChange={setRecipients} disabled={disabled}
              placeholder="cobranca@parceiro.com" />
            {!recipients.length && partnerEmail && (
              <button type="button" onClick={() => setRecipients([partnerEmail])}
                className="mt-1 text-[11px] text-blue-600 hover:underline">
                Usar o e-mail do cadastro do fornecedor ({partnerEmail})
              </button>
            )}
            {!recipients.length && !partnerEmail && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                O fornecedor não tem e-mail cadastrado. Informe pelo menos um endereço.
              </p>
            )}
          </div>

          <div>
            <label className="label-sm">Cópia (cc)</label>
            <EmailChipsInput value={value.billing_cc_emails ?? []} disabled={disabled}
              onChange={list => onChange({ billing_cc_emails: list })}
              placeholder="financeiro@meridianahoteles.com" />
          </div>

          <div>
            <label className="label-sm">Assunto *</label>
            <input className="input-field" value={subject} disabled={disabled}
              onChange={e => onChange({ billing_subject_template: e.target.value })} />
          </div>

          <div>
            <label className="label-sm">Corpo *</label>
            <textarea ref={bodyRef} rows={7} value={body} disabled={disabled}
              onChange={e => onChange({ billing_body_template: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-800 dark:text-gray-200" />
            <div className="flex flex-wrap gap-1 mt-2">
              {BILLING_VARS.map(v => (
                <button key={v} type="button" onClick={() => insertVar(v)} disabled={disabled}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 disabled:opacity-50">
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {unknown.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Variável desconhecida: {unknown.map(u => `{{${u}}}`).join(', ')}. Vai sair literal no e-mail.
            </p>
          )}
          {invalid.length > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Endereço inválido: {invalid.join(', ')}
            </p>
          )}

          <button type="button" onClick={() => setPreview(p => !p)}
            className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 hover:underline">
            {preview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {preview ? 'Esconder pré-visualização' : 'Pré-visualizar'}
          </button>

          {preview && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border dark:border-gray-700 p-3 text-xs space-y-1">
              <p className="text-gray-500">Dados de exemplo, só para conferir o texto.</p>
              <p><span className="text-gray-500">Para:</span> {recipients.join(', ') || '—'}</p>
              {(value.billing_cc_emails ?? []).length > 0 && (
                <p><span className="text-gray-500">Cc:</span> {value.billing_cc_emails.join(', ')}</p>
              )}
              <p><span className="text-gray-500">Assunto:</span>{' '}
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  {renderBillingTemplate(subject, PREVIEW_VARS)}
                </span>
              </p>
              <pre className="mt-2 pt-2 border-t dark:border-gray-700 whitespace-pre-wrap font-sans text-gray-700 dark:text-gray-300">
                {renderBillingTemplate(body, PREVIEW_VARS)}
              </pre>
              {value.billing_attach_nf && (
                <p className="pt-2 border-t dark:border-gray-700 text-gray-500 flex items-center gap-1">
                  <Paperclip className="w-3 h-3" /> Anexos: XML e PDF/DANFSE da nota
                </p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={value.billing_attach_nf} disabled={disabled}
              onChange={e => onChange({ billing_attach_nf: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Anexar XML e PDF/DANFSE da nota</span>
          </label>

          <div>
            <label className="label-sm">Disparo</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                ['automatico', 'Automático ao emitir a NF', <Send key="i" className="w-3.5 h-3.5" />],
                ['manual', 'Manual, eu marco na fila', <Hand key="i" className="w-3.5 h-3.5" />],
              ] as [BillingDispatchMode, string, React.ReactNode][]).map(([k, label, icon]) => (
                <button key={k} type="button" disabled={disabled}
                  onClick={() => onChange({ billing_dispatch_mode: k })}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs text-left transition-colors ${
                    value.billing_dispatch_mode === k
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300'
                      : 'dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}>
                  {icon}{label}
                </button>
              ))}
            </div>
            {value.billing_dispatch_mode === 'automatico' && !senderConfigured && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Esta unidade ainda não configurou um remetente de e-mail. Até configurar, as
                cobranças ficam na fila "Cobranças a disparar" para envio manual.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
