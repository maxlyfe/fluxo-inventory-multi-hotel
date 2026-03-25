// netlify/functions/whatsapp-webhook.ts
// Webhook endpoint para receber eventos da Meta WhatsApp Cloud API
// Usado na Etapa 3 da configuração: https://developers.facebook.com/apps/.../whatsapp-business/wa-dev-console
//
// URL de callback: https://<seu-site>.netlify.app/.netlify/functions/whatsapp-webhook
// Verify token: definido na env var WHATSAPP_WEBHOOK_VERIFY_TOKEN

import type { Handler, HandlerEvent } from '@netlify/functions';

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'fluxo_whatsapp_verify_2024';

const handler: Handler = async (event: HandlerEvent) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  // ── GET: Verificação do webhook pela Meta ──────────────────────────────
  // A Meta envia um GET com hub.mode, hub.verify_token e hub.challenge
  // Devemos retornar hub.challenge se o token bater
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[WhatsApp Webhook] Verificação bem-sucedida');
      return {
        statusCode: 200,
        headers,
        body: challenge || '',
      };
    }

    console.warn('[WhatsApp Webhook] Verificação falhou — token inválido');
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Verification failed' }),
    };
  }

  // ── POST: Receber notificações da Meta ─────────────────────────────────
  // Eventos: mensagens recebidas, status updates (sent, delivered, read, failed)
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');

      // Log para debug (visível no Netlify Functions log)
      console.log('[WhatsApp Webhook] Evento recebido:', JSON.stringify(body, null, 2));

      // Estrutura do payload Meta:
      // body.entry[].changes[].value.messages[] — mensagens recebidas
      // body.entry[].changes[].value.statuses[] — status updates
      const entries = body.entry || [];

      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value || {};

          // ── Status updates (delivered, read, failed) ───────────────
          if (value.statuses && Array.isArray(value.statuses)) {
            for (const status of value.statuses) {
              console.log(`[WhatsApp Webhook] Status: ${status.status} para msg ${status.id}`);
              // Aqui podemos atualizar o whatsapp_message_log no futuro
              // via Supabase service role key
            }
          }

          // ── Mensagens recebidas ────────────────────────────────────
          if (value.messages && Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              console.log(`[WhatsApp Webhook] Mensagem de ${msg.from}: ${msg.type}`);
              // Para o futuro: processar respostas de fornecedores
            }
          }
        }
      }

      // Meta espera 200 rápido, senão tenta reenviar
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'ok' }),
      };
    } catch (err) {
      console.error('[WhatsApp Webhook] Erro ao processar:', err);
      // Retorna 200 mesmo com erro para a Meta não reenviar
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'ok' }),
      };
    }
  }

  // Outros métodos
  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: 'Method not allowed' }),
  };
};

export { handler };
