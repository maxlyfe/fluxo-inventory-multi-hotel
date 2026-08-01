// netlify/functions/email-config-save.ts
// Grava o remetente de e-mail de uma unidade, cifrando a senha de app.
//
// O browser NUNCA escreve a senha direto na tabela: a cifragem precisa acontecer
// aqui, onde a EMAIL_CONFIG_KEY existe. É o que impede a senha de virar mais um
// segredo em texto puro no banco, como aconteceu com o certificado A1.

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  requireUser, requireHotelAccess, requirePermission,
  corsHeaders, jsonResponse, errorResponse, serviceClient, HttpError,
} from './lib/auth';
import { encryptSecret, isCryptoConfigured } from './lib/crypto';

interface Payload {
  hotel_id: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  /** Senha de app em claro. Ausente ou vazia = manter a que já está gravada. */
  smtp_password?: string;
  from_name?: string | null;
  from_email?: string;
  reply_to?: string | null;
  active?: boolean;
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(event, 405, { ok: false, error: 'Método não permitido' });
  }

  try {
    const body = JSON.parse(event.body || '{}') as Payload;
    if (!body.hotel_id) throw new HttpError(400, 'hotel_id obrigatório');

    const { userId } = await requireUser(event);
    await requireHotelAccess(userId, body.hotel_id);
    await requirePermission(userId, 'finances.billing.sender', 'finances');

    if (body.smtp_password && !isCryptoConfigured()) {
      throw new HttpError(
        503,
        'EMAIL_CONFIG_KEY não configurada no ambiente da Netlify. Sem ela a senha de app ' +
        'não pode ser guardada com segurança. Gere com: openssl rand -base64 32'
      );
    }

    const svc = serviceClient();
    const { data: existing } = await svc
      .from('hotel_email_config').select('id, smtp_password_enc')
      .eq('hotel_id', body.hotel_id).maybeSingle();

    const hasStoredPassword = !!(existing as any)?.smtp_password_enc;
    if (body.active && !body.smtp_password && !hasStoredPassword) {
      throw new HttpError(400, 'Informe a senha de app antes de ativar o remetente.');
    }

    const patch: Record<string, unknown> = {
      hotel_id: body.hotel_id,
      smtp_host: body.smtp_host ?? 'smtp.gmail.com',
      smtp_port: body.smtp_port ?? 587,
      smtp_secure: body.smtp_secure ?? false,
      smtp_user: body.smtp_user ?? null,
      from_name: body.from_name ?? null,
      from_email: body.from_email ?? null,
      reply_to: body.reply_to ?? null,
      active: body.active ?? false,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    // Senha vazia = "não mexer". É o que permite editar o nome do remetente sem
    // obrigar a gerar uma senha de app nova a cada ajuste.
    if (body.smtp_password) {
      patch.smtp_password_enc = encryptSecret(body.smtp_password);
      // Trocou a credencial: o último teste não vale mais.
      patch.last_test_ok = null;
      patch.last_test_error = null;
      patch.last_test_at = null;
    }

    const { error } = existing
      ? await svc.from('hotel_email_config').update(patch).eq('id', (existing as any).id)
      : await svc.from('hotel_email_config').insert(patch);
    if (error) throw new HttpError(500, error.message);

    return jsonResponse(event, 200, { ok: true });
  } catch (err) {
    return errorResponse(event, err);
  }
};

export { handler };
