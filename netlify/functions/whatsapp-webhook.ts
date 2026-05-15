// netlify/functions/whatsapp-webhook.ts
// Webhook endpoint para receber eventos da Meta WhatsApp Cloud API
// Persiste mensagens recebidas e status updates no Supabase.

import type { Handler, HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'fluxo_whatsapp_verify_2024';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const handler: Handler = async (event: HandlerEvent) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  // ── GET: Verificação do webhook pela Meta ───────────────────────────────
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const mode      = params['hub.mode'];
    const token     = params['hub.verify_token'];
    const challenge = params['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return { statusCode: 200, headers, body: challenge || '' };
    }
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Verification failed' }) };
  }

  // ── POST: Receber notificações da Meta ──────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const entries = body.entry || [];

      for (const entry of entries) {
        for (const change of (entry.changes || [])) {
          const value = change.value || {};
          const phoneNumberId: string = value.metadata?.phone_number_id || '';

          // Resolve hotel_id from whatsapp_configs
          let hotelId: string | null = null;
          if (phoneNumberId) {
            const { data: cfg } = await supabaseAdmin
              .from('whatsapp_configs')
              .select('hotel_id')
              .eq('phone_number_id', phoneNumberId)
              .eq('is_active', true)
              .maybeSingle();
            hotelId = cfg?.hotel_id || null;
          }

          // ── Status updates (delivered, read, failed) ──────────────────
          if (Array.isArray(value.statuses)) {
            for (const st of value.statuses) {
              await supabaseAdmin
                .from('whatsapp_messages')
                .update({ status: st.status === 'read' ? 'read' : st.status === 'delivered' ? 'delivered' : st.status === 'failed' ? 'failed' : 'sent' })
                .eq('whatsapp_message_id', st.id);
            }
          }

          // ── Incoming messages ─────────────────────────────────────────
          if (Array.isArray(value.messages)) {
            const contacts: Record<string, string> = {};
            for (const c of (value.contacts || [])) {
              contacts[c.wa_id] = c.profile?.name || c.wa_id;
            }

            for (const msg of value.messages) {
              const senderPhone: string = msg.from;
              const senderName: string  = contacts[senderPhone] || senderPhone;

              // Upsert conversation
              const { data: conv } = await supabaseAdmin
                .from('whatsapp_conversations')
                .upsert({
                  hotel_id: hotelId,
                  contact_phone: senderPhone,
                  contact_name: senderName,
                  status: 'open',
                  last_message_at: new Date().toISOString(),
                  last_customer_message_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'hotel_id,contact_phone', ignoreDuplicates: false })
                .select('id, unread_count')
                .maybeSingle();

              if (!conv) continue;

              // Extract message content
              let type: string = msg.type || 'unknown';
              let content: Record<string, unknown> = {};
              let preview = '';

              switch (type) {
                case 'text':
                  content = { text: msg.text?.body || '' };
                  preview = msg.text?.body?.slice(0, 80) || '';
                  break;
                case 'image':
                  content = { media_id: msg.image?.id, caption: msg.image?.caption, mime_type: msg.image?.mime_type };
                  preview = msg.image?.caption ? `📷 ${msg.image.caption}` : '📷 Imagem';
                  break;
                case 'audio':
                  content = { media_id: msg.audio?.id, mime_type: msg.audio?.mime_type };
                  preview = '🎵 Áudio';
                  break;
                case 'video':
                  content = { media_id: msg.video?.id, caption: msg.video?.caption };
                  preview = msg.video?.caption ? `🎥 ${msg.video.caption}` : '🎥 Vídeo';
                  break;
                case 'document':
                  content = { media_id: msg.document?.id, filename: msg.document?.filename, caption: msg.document?.caption };
                  preview = msg.document?.filename ? `📄 ${msg.document.filename}` : '📄 Documento';
                  break;
                case 'location':
                  content = { latitude: msg.location?.latitude, longitude: msg.location?.longitude, name: msg.location?.name };
                  preview = `📍 ${msg.location?.name || 'Localização'}`;
                  break;
                case 'interactive':
                  content = { interactive: msg.interactive };
                  preview = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '📋 Interativo';
                  break;
                default:
                  content = { raw: msg };
                  preview = `[${type}]`;
              }

              // Insert message
              await supabaseAdmin.from('whatsapp_messages').insert({
                conversation_id: conv.id,
                hotel_id: hotelId,
                whatsapp_message_id: msg.id,
                direction: 'inbound',
                type,
                content,
                status: 'delivered',
                sent_at: new Date(Number(msg.timestamp) * 1000).toISOString(),
              });

              // Update conversation preview + unread
              await supabaseAdmin.from('whatsapp_conversations').update({
                last_message_preview: preview,
                last_message_at: new Date().toISOString(),
                last_customer_message_at: new Date().toISOString(),
                unread_count: (conv.unread_count || 0) + 1,
                status: 'open',
                updated_at: new Date().toISOString(),
              }).eq('id', conv.id);

              // Auto-responses (only for text messages)
              if (type === 'text' && hotelId) {
                await processAutoResponses(hotelId, conv.id, senderPhone, msg.text?.body || '', phoneNumberId);
              }
            }
          }
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
    } catch (err) {
      console.error('[WhatsApp Webhook] Erro:', err);
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

// ── Auto-response logic ────────────────────────────────────────────────────────

async function processAutoResponses(
  hotelId: string,
  conversationId: string,
  recipientPhone: string,
  incomingText: string,
  phoneNumberId: string,
): Promise<void> {
  try {
    const { data: rules } = await supabaseAdmin
      .from('whatsapp_auto_responses')
      .select('*')
      .or(`hotel_id.eq.${hotelId},hotel_id.is.null`)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (!rules || rules.length === 0) return;

    const { data: cfg } = await supabaseAdmin
      .from('whatsapp_configs')
      .select('access_token')
      .eq('phone_number_id', phoneNumberId)
      .eq('is_active', true)
      .maybeSingle();

    if (!cfg) return;

    const textLower = incomingText.toLowerCase().trim();

    // Check message count (for first_message trigger)
    const { count } = await supabaseAdmin
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound');

    const isFirstMessage = (count || 0) <= 1;

    for (const rule of rules) {
      let shouldRespond = false;

      if (rule.trigger_type === 'always') {
        shouldRespond = true;
      } else if (rule.trigger_type === 'first_message' && isFirstMessage) {
        shouldRespond = true;
      } else if (rule.trigger_type === 'keyword' && rule.trigger_keywords?.length) {
        shouldRespond = rule.trigger_keywords.some((kw: string) =>
          textLower.includes(kw.toLowerCase()),
        );
      } else if (rule.trigger_type === 'out_of_hours') {
        const hour = new Date().getHours();
        shouldRespond = hour < 7 || hour >= 22;
      }

      if (!shouldRespond) continue;

      // Send auto-response
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'text',
        text: { preview_url: false, body: rule.response_text },
      };

      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        const waId = data?.messages?.[0]?.id || null;

        await supabaseAdmin.from('whatsapp_messages').insert({
          conversation_id: conversationId,
          hotel_id: hotelId,
          whatsapp_message_id: waId,
          direction: 'outbound',
          type: 'text',
          content: { text: rule.response_text, auto_response: true },
          status: 'sent',
          sent_at: new Date().toISOString(),
        });

        await supabaseAdmin.from('whatsapp_conversations').update({
          last_message_preview: rule.response_text.slice(0, 80),
          last_message_at: new Date().toISOString(),
        }).eq('id', conversationId);
      }

      break; // only first matching rule fires
    }
  } catch (err) {
    console.error('[AutoResponse] Erro:', err);
  }
}

export { handler };
