// netlify/functions/lib/ar-billing.ts
// Loop de envio de cobranças, compartilhado entre ar-billing-send (acionada pela
// tela) e ar-billing-retry (agendada). Está aqui para a lógica de backoff e de
// consolidação da data existir em UM lugar só.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendEmail, resolveAttachment, isDryRunProvider,
  type EmailTransportConfig, type EmailAttachment,
} from './email';
import { decryptSecret } from './crypto';

export interface SendOutcome {
  sent: {
    dispatch_id: string;
    ar_title_id: string;
    provider_message_id?: string;
    /** E-mail saiu, mas algo depois dele falhou (ex.: consolidação do prazo). */
    warning?: string;
  }[];
  failed: { dispatch_id: string; ar_title_id: string; error: string }[];
  skipped: { dispatch_id: string; ar_title_id: string; reason: string }[];
}

const MAX_ATTEMPTS = Number(process.env.AR_BILLING_MAX_ATTEMPTS ?? 5);

/** Backoff 5min * 2^tentativas, com teto de 12h. */
function nextRetryAt(attempts: number): string {
  const minutes = Math.min(720, 5 * Math.pow(2, Math.max(0, attempts - 1)));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Carrega o remetente da UNIDADE. Devolve null quando o hotel não configurou.
 * Não existe fallback para um remetente global de propósito: cada unidade tem
 * CNPJ próprio e fala com o parceiro pela própria caixa.
 */
async function loadTransport(
  svc: SupabaseClient,
  hotelId: string,
): Promise<EmailTransportConfig | null> {
  const { data, error } = await svc
    .from('hotel_email_config')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as any;
  if (!row.smtp_password_enc || !row.smtp_user || !row.from_email) return null;

  return {
    host: row.smtp_host,
    port: row.smtp_port,
    secure: row.smtp_secure,
    user: row.smtp_user,
    pass: decryptSecret(row.smtp_password_enc),
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to,
  };
}

/** Anexos da nota: XML e PDF/DANFSE, quando a regra pede e as URLs respondem. */
async function buildAttachments(svc: SupabaseClient, nfInvoiceId: string | null, attachUrl: string | null) {
  const out: EmailAttachment[] = [];
  if (!nfInvoiceId) return out;

  const { data } = await svc
    .from('nf_invoices')
    .select('numero_nf, xml_retorno, xml_dps, danfse_url, pdf_url')
    .eq('id', nfInvoiceId)
    .maybeSingle();
  const nf = data as any;
  if (!nf) return out;

  const nome = nf.numero_nf || 'nota';
  const xml = nf.xml_retorno || nf.xml_dps;
  if (xml) {
    out.push({ filename: `${nome}.xml`, content: Buffer.from(xml, 'utf8'), contentType: 'application/xml' });
  }

  const pdfUrl = attachUrl || nf.danfse_url || nf.pdf_url;
  if (pdfUrl) {
    const pdf = await resolveAttachment(pdfUrl, `${nome}.pdf`);
    if (pdf) out.push(pdf);
  }
  return out;
}

/**
 * Processa uma lista de disparos.
 *
 * Idempotente sob duplo clique: só age em status pendente ou falha, então um
 * disparo já enviado sai em `skipped` em vez de mandar o e-mail duas vezes.
 */
export async function processDispatches(
  svc: SupabaseClient,
  dispatchIds: string[],
  opts: { hotelId?: string } = {},
): Promise<SendOutcome> {
  const outcome: SendOutcome = { sent: [], failed: [], skipped: [] };
  if (!dispatchIds.length) return outcome;

  let q = svc.from('ar_billing_dispatches').select('*').in('id', dispatchIds);
  if (opts.hotelId) q = q.eq('hotel_id', opts.hotelId);
  const { data: rows, error } = await q;
  if (error) throw error;

  // Uma configuração por hotel, carregada uma vez para o lote.
  const transports = new Map<string, EmailTransportConfig | null>();

  for (const raw of rows ?? []) {
    const d = raw as any;

    if (!['pendente', 'falha'].includes(d.status)) {
      outcome.skipped.push({ dispatch_id: d.id, ar_title_id: d.ar_title_id, reason: `ja_${d.status}` });
      continue;
    }
    if (!d.to_email) {
      // Nunca marca como enviado sem destinatário: seria registrar cobrança que
      // não existe e travar o prazo numa data falsa.
      await svc.from('ar_billing_dispatches').update({
        error: 'Sem e-mail de destino cadastrado', next_retry_at: null, updated_at: new Date().toISOString(),
      }).eq('id', d.id);
      outcome.skipped.push({ dispatch_id: d.id, ar_title_id: d.ar_title_id, reason: 'sem_email' });
      continue;
    }

    // Modo de teste: sai ANTES de contar tentativa e antes de qualquer escrita
    // que pareça sucesso. Nunca marca como enviado nem consolida o prazo — o
    // corpo renderizado já está gravado no próprio disparo para conferência.
    if (isDryRunProvider()) {
      await svc.from('ar_billing_dispatches').update({
        error: 'EMAIL_PROVIDER=log: modo de teste, nenhum e-mail foi enviado. '
             + 'Troque para smtp na Netlify para enviar de verdade.',
        next_retry_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', d.id);
      outcome.skipped.push({
        dispatch_id: d.id, ar_title_id: d.ar_title_id, reason: 'modo_teste_email_provider_log',
      });
      continue;
    }

    if (!transports.has(d.hotel_id)) {
      transports.set(d.hotel_id, await loadTransport(svc, d.hotel_id));
    }
    const transport = transports.get(d.hotel_id) ?? null;
    if (!transport) {
      await svc.from('ar_billing_dispatches').update({
        error: 'A unidade não tem remetente de e-mail configurado e ativo',
        next_retry_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', d.id);
      outcome.skipped.push({
        dispatch_id: d.id, ar_title_id: d.ar_title_id, reason: 'sem_remetente_configurado',
      });
      continue;
    }

    const attempt = (d.attempts ?? 0) + 1;
    await svc.from('ar_billing_dispatches').update({
      attempts: attempt, last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', d.id);

    const attachments = await buildAttachments(svc, d.nf_invoice_id, d.attachment_url);
    const result = await sendEmail(
      {
        to: d.to_email,
        cc: d.cc_emails ?? [],
        subject: d.subject ?? 'Cobrança',
        text: d.body ?? '',
        attachments,
      },
      transport,
    );

    await svc.from('ar_billing_dispatch_attempts').insert({
      hotel_id: d.hotel_id,
      dispatch_id: d.id,
      attempt_no: attempt,
      status: result.ok ? 'enviado' : 'falha',
      provider: result.provider,
      provider_message_id: result.messageId ?? null,
      error: result.error ?? null,
    });

    if (result.ok) {
      await svc.from('ar_billing_dispatches').update({
        status: 'enviado',
        sent_at: new Date().toISOString(),
        from_email: transport.fromEmail,
        provider: result.provider,
        provider_message_id: result.messageId ?? null,
        error: null,
        next_retry_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', d.id);

      // Consolida a previsão: o prazo conta da data do envio.
      //
      // O erro TEM que ser checado. supabase-js devolve {error} em vez de lançar,
      // e um `await svc.rpc(...)` solto engolia a exceção da RPC — foi assim que
      // o guarda de service role passou despercebido: o e-mail saía, o disparo
      // virava 'enviado', e o recebível ficava sem data firme, invisível na
      // previsão de caixa e eternamente na aba "A disparar".
      const { error: markError } = await svc.rpc('rpc_ar_mark_billing_sent', {
        p_hotel_id: d.hotel_id,
        p_billed_on: new Date().toISOString().slice(0, 10),
        p_ar_title_ids: [d.ar_title_id],
        p_booking_refs: null,
        p_manual: false,
        p_note: null,
        p_force: false,
      });

      if (markError) {
        // O e-mail já saiu: é irreversível e NÃO pode ser reportado como falha de
        // envio (levaria o operador a mandar de novo). Registra a inconsistência
        // no disparo para ela ficar visível na fila em vez de silenciosa.
        const aviso =
          'E-mail enviado, mas a previsão de recebimento NÃO foi consolidada: '
          + markError.message
          + '. Marque a cobrança manualmente com a data de hoje para acertar o prazo.';
        await svc.from('ar_billing_dispatches').update({
          error: aviso, updated_at: new Date().toISOString(),
        }).eq('id', d.id);
        console.error(`[AR Billing] ${d.id}: ${aviso}`);
      }

      outcome.sent.push({
        dispatch_id: d.id,
        ar_title_id: d.ar_title_id,
        provider_message_id: result.messageId,
        warning: markError
          ? 'enviada, mas a previsão de recebimento não foi consolidada'
          : undefined,
      });
    } else {
      const esgotou = attempt >= MAX_ATTEMPTS;
      await svc.from('ar_billing_dispatches').update({
        status: 'falha',
        error: result.error,
        // Esgotou as tentativas: para de tentar e o item fica visível na fila com
        // dias_parado. O e-mail nunca é a última linha de defesa, a fila é.
        next_retry_at: esgotou ? null : nextRetryAt(attempt),
        updated_at: new Date().toISOString(),
      }).eq('id', d.id);

      // Senha de app revogada: desativa a config em vez de queimar tentativa em
      // TODAS as cobranças da unidade contra uma credencial morta.
      if (result.authFailure) {
        await svc.from('hotel_email_config').update({
          active: false,
          last_test_ok: false,
          last_test_error: `Autenticação SMTP recusada: ${result.error}`,
          last_test_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('hotel_id', d.hotel_id);
        transports.set(d.hotel_id, null);
      }

      outcome.failed.push({
        dispatch_id: d.id, ar_title_id: d.ar_title_id, error: result.error ?? 'erro desconhecido',
      });
    }
  }

  return outcome;
}

/** Disparos vencidos para retentativa, respeitando o teto de tentativas. */
export async function listRetryable(svc: SupabaseClient, limit = 100): Promise<string[]> {
  const { data, error } = await svc
    .from('ar_billing_dispatches')
    .select('id')
    .in('status', ['pendente', 'falha'])
    .not('to_email', 'is', null)
    .lte('next_retry_at', new Date().toISOString())
    .lt('attempts', MAX_ATTEMPTS)
    .order('next_retry_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.id);
}
