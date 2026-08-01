// netlify/functions/lib/email.ts
// Camada fina de envio de e-mail. O provedor fica isolado atrás de sendEmail()
// para que a lógica de cobrança não saiba de SMTP.
//
// EMAIL_PROVIDER controla o adapter:
//   smtp (padrão) → nodemailer com a configuração da UNIDADE (hotel_email_config)
//   log           → grava a tentativa e devolve ok:true SEM enviar nada
//
// O adapter 'log' é o único modo seguro em staging e é como se valida o corpo
// renderizado antes de qualquer parceiro real receber alguma coisa.

import nodemailer from 'nodemailer';

export interface EmailTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Senha de app em claro. Vem de decryptSecret, nunca do banco direto. */
  pass: string;
  fromName?: string | null;
  fromEmail: string;
  replyTo?: string | null;
}

export interface EmailAttachment {
  filename: string;
  content?: Buffer;
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  /** true quando o erro é de autenticação SMTP (535): senha de app revogada. */
  authFailure?: boolean;
}

const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const ATTACHMENT_TIMEOUT_MS = 8000;

/**
 * Baixa um anexo por URL, com teto de tamanho e timeout.
 *
 * Devolve null em qualquer falha DE PROPÓSITO: pdf_url e danfse_url apontam para
 * servidores de terceiros (prefeitura, ADN) que saem do ar. Falha ao anexar não
 * pode impedir a cobrança de sair, porque o corpo já traz {{link_nf}}.
 */
export async function resolveAttachment(url: string, filename: string): Promise<EmailAttachment | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTACHMENT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_ATTACHMENT_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) return null;

    return {
      filename,
      content: buf,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.responseCode;
  return code === 535 || code === 534 || /invalid login|username and password not accepted|5\.7\.8/i.test(msg);
}

export async function sendEmail(msg: EmailMessage, transport: EmailTransportConfig): Promise<EmailResult> {
  const provider = process.env.EMAIL_PROVIDER || 'smtp';

  if (provider === 'log') {
    console.log('[email:log] NÃO ENVIADO (EMAIL_PROVIDER=log)', {
      from: transport.fromEmail,
      to: msg.to,
      cc: msg.cc,
      subject: msg.subject,
      bodyPreview: msg.text.slice(0, 300),
      attachments: (msg.attachments ?? []).map(a => a.filename),
    });
    return { ok: true, provider: 'log', messageId: 'log-only' };
  }

  try {
    const tx = nodemailer.createTransport({
      host: transport.host,
      port: transport.port,
      secure: transport.secure,
      auth: { user: transport.user, pass: transport.pass },
    });

    const info = await tx.sendMail({
      from: transport.fromName
        ? `"${transport.fromName}" <${transport.fromEmail}>`
        : transport.fromEmail,
      to: msg.to,
      cc: msg.cc?.length ? msg.cc.join(', ') : undefined,
      replyTo: transport.replyTo || undefined,
      subject: msg.subject,
      text: msg.text,
      attachments: (msg.attachments ?? []).map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    return { ok: true, provider: 'smtp', messageId: info.messageId };
  } catch (err) {
    return {
      ok: false,
      provider: 'smtp',
      error: err instanceof Error ? err.message : 'Erro desconhecido no envio',
      authFailure: isAuthFailure(err),
    };
  }
}
