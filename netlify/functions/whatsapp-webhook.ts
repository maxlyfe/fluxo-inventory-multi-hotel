// netlify/functions/whatsapp-webhook.ts
// Webhook único para os dois providers de WhatsApp:
//   • Meta Cloud API → payload com { entry: [{ changes: [...] }] }
//   • Evolution API  → payload com { event, instance, data }
// Persiste mensagens recebidas, status updates e dispara auto respostas.

import type { Handler, HandlerEvent } from '@netlify/functions';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'fluxo_whatsapp_verify_2024';

/**
 * Cliente criado sob demanda, não no carregamento do módulo.
 *
 * Com createClient no topo do arquivo, SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY
 * ausentes derrubavam a função inteira com 502 antes de qualquer linha rodar.
 * O provider interpretava como falha temporária, tentava de novo algumas vezes e
 * desistia, então a mensagem recebida se perdia sem nenhum rastro de diagnóstico.
 */
let _supabase: SupabaseClient | null = null;

/**
 * Aceita as duas grafias, igual às outras functions do projeto.
 *
 * Manter só SUPABASE_URL obrigava a cadastrar no Netlify uma variável cujo valor
 * também está escrito em arquivos do repositório (scripts SQL de cron, Chatbot).
 * O secrets scanning do Netlify então reprova o build inteiro. Como VITE_SUPABASE_URL
 * já existe, tem o mesmo valor e não é tratada como segredo, ela serve de fallback.
 * A URL do projeto não é segredo: já vai no bundle do navegador.
 */
function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

function supabaseServiceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
}

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const url = supabaseUrl();
  const key = supabaseServiceKey();

  const missing = [
    !url && 'SUPABASE_URL (ou VITE_SUPABASE_URL)',
    !key && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Variáveis de ambiente ausentes no Netlify: ${missing.join(', ')}. ` +
      'Configure em Site settings › Environment variables e refaça o deploy.',
    );
  }

  _supabase = createClient(url!, key!);
  return _supabase;
}

// SEND_MESSAGE ('send.message') é o evento do que sai pela API. Sem ele, tudo que
// o sistema envia fica invisível no inbox, porque só o sendText do inbox grava a
// linha localmente. Ver comentário em src/lib/evolutionService.ts.
const EVOLUTION_WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'];

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

    // Health check: GET sem os parâmetros da Meta reporta se o ambiente está
    // configurado. Só booleanos, nunca o valor das credenciais.
    if (!mode && !token) {
      const ok = Boolean(supabaseUrl()) && Boolean(supabaseServiceKey());
      return {
        statusCode: ok ? 200 : 503,
        headers,
        body: JSON.stringify({
          status: ok ? 'ok' : 'misconfigured',
          env: {
            url: Boolean(supabaseUrl()),
            serviceKey: Boolean(supabaseServiceKey()),
          },
          hint: ok
            ? undefined
            : 'Configure as variáveis em Netlify › Site settings › Environment variables e refaça o deploy.',
        }),
      };
    }

    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Verification failed' }) };
  }

  // ── POST: Receber notificações ──────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');

      if (body.event && body.instance) {
        await handleEvolution(body);
      } else {
        await handleMeta(body);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
    } catch (err) {
      console.error('[WhatsApp Webhook] Erro:', err);
      // Sempre 200 para o provider não entrar em retry infinito
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

// ═══════════════════════════════════════════════════════════════════════════════
// Evolution API
// ═══════════════════════════════════════════════════════════════════════════════

interface EvolutionConfig {
  id: string;
  hotel_id: string | null;
  base_url: string;
  api_key: string;
  instance_name: string;
}

/** Extrai os dígitos do número a partir de um JID (5522999476601@s.whatsapp.net) */
function fromJid(jid: string): string {
  return (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function isGroupJid(jid: string): boolean {
  return (jid || '').endsWith('@g.us');
}

async function handleEvolution(body: any): Promise<void> {
  const instanceName: string = body.instance;
  const evtRaw: string = body.event || '';
  // O Evolution manda "messages.upsert"; normalizamos para MESSAGES_UPSERT
  const evt = evtRaw.replace(/\./g, '_').toUpperCase();

  if (!EVOLUTION_WEBHOOK_EVENTS.includes(evt)) return;

  const { data: cfg } = await getSupabase()
    .from('whatsapp_configs')
    .select('id, hotel_id, base_url, api_key, instance_name')
    .eq('provider', 'evolution')
    .eq('instance_name', instanceName)
    .eq('is_active', true)
    .maybeSingle();

  if (!cfg) {
    console.warn(`[Evolution Webhook] Instância desconhecida ou inativa: ${instanceName}`);
    return;
  }

  const config = cfg as EvolutionConfig;

  switch (evt) {
    case 'CONNECTION_UPDATE': {
      const state = body.data?.state || body.data?.instance?.state;
      if (!state) return;
      await getSupabase()
        .from('whatsapp_configs')
        .update({
          connection_status: state,
          connected_at: state === 'open' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', config.id);
      return;
    }

    case 'MESSAGES_UPDATE': {
      // data pode vir como objeto único ou array
      const updates = Array.isArray(body.data) ? body.data : [body.data];
      for (const u of updates) {
        const waId = u?.keyId || u?.messageId || u?.key?.id;
        if (!waId) continue;
        const mapped = mapEvolutionStatus(u?.status);
        if (!mapped) continue;
        await getSupabase()
          .from('whatsapp_messages')
          .update({ status: mapped })
          .eq('whatsapp_message_id', waId);
      }
      return;
    }

    case 'MESSAGES_UPSERT':
    case 'SEND_MESSAGE': {
      // Mesmo formato de payload nos dois. A diferença é a origem: messages.upsert
      // traz o que chega e o que o operador manda pelo celular; send.message traz
      // o que sai pela API. Em send.message forçamos fromMe, porque é sempre nosso.
      const items = Array.isArray(body.data) ? body.data : [body.data];
      for (const item of items) {
        await processEvolutionMessage(config, item, evt === 'SEND_MESSAGE');
      }
      return;
    }
  }
}

/** DELIVERY_ACK e afins → status interno */
function mapEvolutionStatus(status?: string): string | null {
  switch ((status || '').toUpperCase()) {
    case 'PENDING':      return 'pending';
    case 'SERVER_ACK':   return 'sent';
    case 'DELIVERY_ACK': return 'delivered';
    case 'READ':
    case 'PLAYED':       return 'read';
    case 'ERROR':        return 'failed';
    default:             return null;
  }
}

/** Traduz o objeto message do Baileys para o formato interno { type, content, preview } */
function parseEvolutionContent(msg: any): { type: string; content: Record<string, unknown>; preview: string } {
  const m = msg?.message || {};

  // Mensagens efêmeras e "view once" vêm embrulhadas
  const inner = m.ephemeralMessage?.message
    || m.viewOnceMessage?.message
    || m.viewOnceMessageV2?.message
    || m.documentWithCaptionMessage?.message
    || m;

  if (typeof inner.conversation === 'string') {
    return { type: 'text', content: { text: inner.conversation }, preview: inner.conversation.slice(0, 80) };
  }

  if (inner.extendedTextMessage?.text) {
    const text = inner.extendedTextMessage.text;
    return { type: 'text', content: { text }, preview: text.slice(0, 80) };
  }

  if (inner.imageMessage) {
    const im = inner.imageMessage;
    return {
      type: 'image',
      content: { caption: im.caption, mime_type: im.mimetype, media_url: im.url, media_key: im.mediaKey },
      preview: im.caption ? `📷 ${im.caption}`.slice(0, 80) : '📷 Imagem',
    };
  }

  if (inner.audioMessage) {
    const am = inner.audioMessage;
    return {
      type: 'audio',
      content: { mime_type: am.mimetype, media_url: am.url, media_key: am.mediaKey, seconds: am.seconds },
      preview: '🎵 Áudio',
    };
  }

  if (inner.videoMessage) {
    const vm = inner.videoMessage;
    return {
      type: 'video',
      content: { caption: vm.caption, mime_type: vm.mimetype, media_url: vm.url, media_key: vm.mediaKey },
      preview: vm.caption ? `🎥 ${vm.caption}`.slice(0, 80) : '🎥 Vídeo',
    };
  }

  if (inner.documentMessage) {
    const dm = inner.documentMessage;
    return {
      type: 'document',
      content: { filename: dm.fileName, caption: dm.caption, mime_type: dm.mimetype, media_url: dm.url, media_key: dm.mediaKey },
      preview: dm.fileName ? `📄 ${dm.fileName}`.slice(0, 80) : '📄 Documento',
    };
  }

  if (inner.stickerMessage) {
    return { type: 'sticker', content: { mime_type: inner.stickerMessage.mimetype }, preview: 'Figurinha' };
  }

  if (inner.locationMessage) {
    const lm = inner.locationMessage;
    return {
      type: 'location',
      content: { latitude: lm.degreesLatitude, longitude: lm.degreesLongitude, name: lm.name },
      preview: `📍 ${lm.name || 'Localização'}`.slice(0, 80),
    };
  }

  if (inner.buttonsResponseMessage || inner.listResponseMessage || inner.templateButtonReplyMessage) {
    const title = inner.buttonsResponseMessage?.selectedDisplayText
      || inner.listResponseMessage?.title
      || inner.templateButtonReplyMessage?.selectedDisplayText
      || 'Resposta interativa';
    return { type: 'interactive', content: { interactive: inner }, preview: title.slice(0, 80) };
  }

  if (inner.reactionMessage) {
    const emoji = inner.reactionMessage.text || '';
    return { type: 'unknown', content: { reaction: emoji, target: inner.reactionMessage.key?.id }, preview: `Reagiu ${emoji}` };
  }

  const kind = msg?.messageType || Object.keys(inner)[0] || 'unknown';
  return { type: 'unknown', content: { raw: inner }, preview: `[${kind}]` };
}

/**
 * Nome da empresa a partir do número, para conversas criadas por mensagem que sai.
 *
 * Compara pelos 8 últimos dígitos porque whatsapp_number é digitado à mão e varia
 * em formatação, código de país e nono dígito.
 */
async function lookupContactName(phone: string): Promise<string | null> {
  const ultimos = phone.replace(/\D/g, '').slice(-8);
  if (ultimos.length < 8) return null;

  const { data } = await getSupabase()
    .from('supplier_contacts')
    .select('company_name')
    .ilike('whatsapp_number', `%${ultimos}%`)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  return data?.company_name || null;
}

async function processEvolutionMessage(
  config: EvolutionConfig,
  item: any,
  forceFromMe = false,
): Promise<void> {
  const key = item?.key || {};
  const remoteJid: string = key.remoteJid || '';
  const waMessageId: string = key.id || '';

  if (!remoteJid || !waMessageId) return;
  // Grupos e status broadcast ficam fora do inbox
  if (isGroupJid(remoteJid) || remoteJid === 'status@broadcast') return;

  const fromMe: boolean = forceFromMe || key.fromMe === true;
  const contactPhone = fromJid(remoteJid);
  if (!contactPhone) return;

  // Em mensagem que sai não existe pushName. Sem isso, cada link de cotação
  // enviado criaria uma conversa nomeada só com o número cru.
  const contactName: string = fromMe
    ? (await lookupContactName(contactPhone) || contactPhone)
    : (item.pushName || contactPhone);
  const sentAt = item.messageTimestamp
    ? new Date(Number(item.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString();

  const { type, content, preview } = parseEvolutionContent(item);

  const conv = await findOrCreateConversation(config.hotel_id, contactPhone, contactName);
  if (!conv) return;

  // Upsert por whatsapp_message_id: o Evolution reenvia messages.upsert em
  // reconexão, e o envio pelo Fluxo já gravou a linha outbound. Com
  // ignoreDuplicates, uma linha já existente volta como array vazio, o que
  // sinaliza replay e evita incrementar unread_count de novo.
  const { data: inserted, error: insertErr } = await getSupabase()
    .from('whatsapp_messages')
    .upsert({
      conversation_id: conv.id,
      hotel_id: config.hotel_id,
      whatsapp_message_id: waMessageId,
      direction: fromMe ? 'outbound' : 'inbound',
      type,
      content,
      status: fromMe ? 'sent' : 'delivered',
      sent_at: sentAt,
    }, { onConflict: 'whatsapp_message_id', ignoreDuplicates: true })
    .select('id');

  if (insertErr) {
    console.error('[Evolution Webhook] Falha ao gravar mensagem:', insertErr);
    return;
  }

  if (!inserted || inserted.length === 0) return; // já processada

  const convUpdate: Record<string, unknown> = {
    last_message_preview: preview,
    last_message_at: sentAt,
    status: 'open',
    updated_at: new Date().toISOString(),
  };

  if (!fromMe) {
    convUpdate.last_customer_message_at = sentAt;
    convUpdate.unread_count = (conv.unread_count || 0) + 1;
  }

  await getSupabase().from('whatsapp_conversations').update(convUpdate).eq('id', conv.id);

  // Auto respostas apenas para texto recebido do contato
  if (!fromMe && type === 'text' && config.hotel_id) {
    await processAutoResponses({
      hotelId: config.hotel_id,
      conversationId: conv.id,
      recipientPhone: contactPhone,
      incomingText: String(content.text || ''),
      sender: { provider: 'evolution', config },
    });
  }
}

/**
 * Localiza ou cria a conversa. Não usa upsert porque hotel_id pode ser NULL
 * (config global) e o índice UNIQUE(hotel_id, contact_phone) trata NULLs como
 * distintos, o que criaria uma conversa nova a cada mensagem.
 */
async function findOrCreateConversation(
  hotelId: string | null,
  contactPhone: string,
  contactName: string,
): Promise<{ id: string; unread_count: number } | null> {
  let q = getSupabase()
    .from('whatsapp_conversations')
    .select('id, unread_count, contact_name')
    .eq('contact_phone', contactPhone);

  q = hotelId ? q.eq('hotel_id', hotelId) : q.is('hotel_id', null);

  const { data: existing } = await q.maybeSingle();

  if (existing) {
    // Preenche o nome quando o contato ainda estava só com o número
    if (contactName && contactName !== contactPhone && existing.contact_name !== contactName) {
      await getSupabase()
        .from('whatsapp_conversations')
        .update({ contact_name: contactName })
        .eq('id', existing.id);
    }
    return { id: existing.id, unread_count: existing.unread_count || 0 };
  }

  const { data: created, error } = await getSupabase()
    .from('whatsapp_conversations')
    .insert({
      hotel_id: hotelId,
      contact_phone: contactPhone,
      contact_name: contactName,
      status: 'open',
      last_message_at: new Date().toISOString(),
    })
    .select('id, unread_count')
    .maybeSingle();

  if (error) {
    // Corrida entre dois eventos simultâneos: relê a linha criada pelo outro
    const { data: retry } = await (hotelId
      ? getSupabase().from('whatsapp_conversations').select('id, unread_count').eq('contact_phone', contactPhone).eq('hotel_id', hotelId)
      : getSupabase().from('whatsapp_conversations').select('id, unread_count').eq('contact_phone', contactPhone).is('hotel_id', null)
    ).maybeSingle();
    if (retry) return { id: retry.id, unread_count: retry.unread_count || 0 };
    console.error('[Webhook] Falha ao criar conversa:', error);
    return null;
  }

  return created ? { id: created.id, unread_count: created.unread_count || 0 } : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Meta Cloud API
// ═══════════════════════════════════════════════════════════════════════════════

async function handleMeta(body: any): Promise<void> {
  const entries = body.entry || [];

  for (const entry of entries) {
    for (const change of (entry.changes || [])) {
      const value = change.value || {};
      const phoneNumberId: string = value.metadata?.phone_number_id || '';

      // Resolve hotel_id from whatsapp_configs
      let hotelId: string | null = null;
      let accessToken: string | null = null;
      if (phoneNumberId) {
        const { data: cfg } = await getSupabase()
          .from('whatsapp_configs')
          .select('hotel_id, access_token')
          .eq('provider', 'meta')
          .eq('phone_number_id', phoneNumberId)
          .eq('is_active', true)
          .maybeSingle();
        hotelId = cfg?.hotel_id || null;
        accessToken = cfg?.access_token || null;
      }

      // ── Status updates (delivered, read, failed) ──────────────────
      if (Array.isArray(value.statuses)) {
        for (const st of value.statuses) {
          await getSupabase()
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

          const conv = await findOrCreateConversation(hotelId, senderPhone, senderName);
          if (!conv) continue;

          // Extract message content
          const type: string = msg.type || 'unknown';
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

          const { data: inserted } = await getSupabase().from('whatsapp_messages').upsert({
            conversation_id: conv.id,
            hotel_id: hotelId,
            whatsapp_message_id: msg.id,
            direction: 'inbound',
            type,
            content,
            status: 'delivered',
            sent_at: new Date(Number(msg.timestamp) * 1000).toISOString(),
          }, { onConflict: 'whatsapp_message_id', ignoreDuplicates: true }).select('id');

          // Reentrega do mesmo evento pela Meta: não conta como nova mensagem
          if (!inserted || inserted.length === 0) continue;

          await getSupabase().from('whatsapp_conversations').update({
            last_message_preview: preview,
            last_message_at: new Date().toISOString(),
            last_customer_message_at: new Date().toISOString(),
            unread_count: (conv.unread_count || 0) + 1,
            status: 'open',
            updated_at: new Date().toISOString(),
          }).eq('id', conv.id);

          if (type === 'text' && hotelId && accessToken) {
            await processAutoResponses({
              hotelId,
              conversationId: conv.id,
              recipientPhone: senderPhone,
              incomingText: msg.text?.body || '',
              sender: { provider: 'meta', phoneNumberId, accessToken },
            });
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auto respostas (comum aos dois providers)
// ═══════════════════════════════════════════════════════════════════════════════

type AutoResponseSender =
  | { provider: 'meta'; phoneNumberId: string; accessToken: string }
  | { provider: 'evolution'; config: EvolutionConfig };

async function processAutoResponses(args: {
  hotelId: string;
  conversationId: string;
  recipientPhone: string;
  incomingText: string;
  sender: AutoResponseSender;
}): Promise<void> {
  const { hotelId, conversationId, recipientPhone, incomingText, sender } = args;

  try {
    const { data: rules } = await getSupabase()
      .from('whatsapp_auto_responses')
      .select('*')
      .or(`hotel_id.eq.${hotelId},hotel_id.is.null`)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (!rules || rules.length === 0) return;

    const textLower = incomingText.toLowerCase().trim();

    // Conta mensagens recebidas para o gatilho first_message
    const { count } = await getSupabase()
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

      const sent = await sendAutoResponse(sender, recipientPhone, rule.response_text);

      if (sent.success) {
        await getSupabase().from('whatsapp_messages').upsert({
          conversation_id: conversationId,
          hotel_id: hotelId,
          whatsapp_message_id: sent.messageId || null,
          direction: 'outbound',
          type: 'text',
          content: { text: rule.response_text, auto_response: true },
          status: 'sent',
          sent_at: new Date().toISOString(),
        }, { onConflict: 'whatsapp_message_id', ignoreDuplicates: true });

        await getSupabase().from('whatsapp_conversations').update({
          last_message_preview: rule.response_text.slice(0, 80),
          last_message_at: new Date().toISOString(),
        }).eq('id', conversationId);
      } else {
        console.error('[AutoResponse] Falha no envio:', sent.error);
      }

      break; // só a primeira regra que casar dispara
    }
  } catch (err) {
    console.error('[AutoResponse] Erro:', err);
  }
}

async function sendAutoResponse(
  sender: AutoResponseSender,
  recipientPhone: string,
  text: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    if (sender.provider === 'evolution') {
      const { base_url, api_key, instance_name } = sender.config;
      const res = await fetch(`${base_url.replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(instance_name)}`, {
        method: 'POST',
        headers: { apikey: api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: recipientPhone.replace(/\D/g, ''),
          text,
          // Atraso de digitação: uma resposta instantânea é sinal de automação
          delay: 1500,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.response?.message || data?.message || `HTTP ${res.status}` };
      return { success: true, messageId: data?.key?.id };
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${sender.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sender.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data?.error?.message || `HTTP ${res.status}` };
    return { success: true, messageId: data?.messages?.[0]?.id };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro desconhecido' };
  }
}

export { handler };
