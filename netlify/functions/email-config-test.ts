// netlify/functions/email-config-test.ts
// Envia um e-mail de teste com a configuração da unidade.
//
// O destino é SEMPRE o e-mail do próprio usuário logado, nunca um endereço
// informado no corpo: caso contrário esta tela seria um relay aberto, capaz de
// mandar mensagem para qualquer um usando a caixa do hotel.

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  requireUser, requireHotelAccess, requirePermission,
  corsHeaders, jsonResponse, errorResponse, serviceClient, HttpError,
} from './lib/auth';
import { decryptSecret } from './lib/crypto';
import { sendEmail } from './lib/email';
import { createClient } from '@supabase/supabase-js';

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(event, 405, { ok: false, error: 'Método não permitido' });
  }

  try {
    const body = JSON.parse(event.body || '{}') as { hotel_id?: string };
    if (!body.hotel_id) throw new HttpError(400, 'hotel_id obrigatório');

    const { userId, token } = await requireUser(event);
    await requireHotelAccess(userId, body.hotel_id);
    await requirePermission(userId, 'finances.billing.sender', 'finances');

    // E-mail do usuário logado, lido do próprio token.
    const anon = createClient(
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: userData } = await anon.auth.getUser(token);
    const destino = userData?.user?.email;
    if (!destino) throw new HttpError(400, 'Sua conta não tem e-mail para receber o teste.');

    const svc = serviceClient();
    const { data, error } = await svc
      .from('hotel_email_config').select('*')
      .eq('hotel_id', body.hotel_id).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(400, 'Nenhuma configuração de remetente salva para esta unidade.');

    const cfg = data as any;
    if (!cfg.smtp_password_enc) throw new HttpError(400, 'Salve a senha de app antes de testar.');
    if (!cfg.smtp_user || !cfg.from_email) throw new HttpError(400, 'Preencha o usuário SMTP e o e-mail remetente.');

    const { data: hotel } = await svc.from('hotels').select('name').eq('id', body.hotel_id).maybeSingle();
    const hotelName = (hotel as any)?.name ?? 'a unidade';

    const result = await sendEmail(
      {
        to: destino,
        subject: `Teste de envio de cobrança · ${hotelName}`,
        text: [
          `Este é um e-mail de teste do Fluxo para ${hotelName}.`,
          '',
          `Remetente configurado: ${cfg.from_email}`,
          `Servidor: ${cfg.smtp_host}:${cfg.smtp_port}`,
          '',
          'Se você recebeu esta mensagem, o envio está funcionando.',
          'Confira nos detalhes do e-mail se SPF e DKIM passaram: sem isso a cobrança',
          'tende a cair no spam do parceiro mesmo com o envio funcionando.',
        ].join('\n'),
      },
      {
        host: cfg.smtp_host,
        port: cfg.smtp_port,
        secure: cfg.smtp_secure,
        user: cfg.smtp_user,
        pass: decryptSecret(cfg.smtp_password_enc),
        fromName: cfg.from_name,
        fromEmail: cfg.from_email,
        replyTo: cfg.reply_to,
      },
    );

    await svc.from('hotel_email_config').update({
      last_test_at: new Date().toISOString(),
      last_test_ok: result.ok,
      last_test_error: result.error ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', cfg.id);

    return jsonResponse(event, 200, {
      ok: result.ok,
      sent_to: result.ok ? destino : undefined,
      provider: result.provider,
      error: result.error,
      // 535 é quase sempre senha de app colada com espaços ou revogada.
      auth_failure: result.authFailure ?? false,
    });
  } catch (err) {
    return errorResponse(event, err);
  }
};

export { handler };
