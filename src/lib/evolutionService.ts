// src/lib/evolutionService.ts
// Cliente do Evolution API v2 (self-hosted, Baileys) via netlify/functions/evolution-proxy.
//
// Diferenças relevantes em relação à Meta Cloud API:
//   • Não existe template aprovado. O corpo da mensagem é texto puro.
//   • Não existe janela de 24h. Texto livre pode ser enviado a qualquer momento.
//   • O número é identificado por JID (5522999476601@s.whatsapp.net).
//   • O id da mensagem é o key.id do Baileys, não um wamid.

const EVOLUTION_PROXY = '/.netlify/functions/evolution-proxy';

/**
 * Eventos que o Fluxo consome.
 *
 * SEND_MESSAGE é necessário: quando a mensagem sai pela API, o Evolution emite
 * 'send.message', não 'messages.upsert'. Sem assinar, tudo que o sistema envia
 * (link de cotação, disparo em massa, imagem do pedido) fica invisível no inbox,
 * porque só o sendText do inbox grava a linha localmente.
 *
 * Não duplica: o índice único em whatsapp_message_id, combinado com upsert
 * ignoreDuplicates no webhook, descarta o eco do que já foi gravado no envio.
 */
export const EVOLUTION_WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'SEND_MESSAGE',
  'CONNECTION_UPDATE',
] as const;

export type EvolutionConnectionState = 'open' | 'connecting' | 'close' | 'unknown';

export interface EvolutionCredentials {
  base_url: string;
  api_key: string;
  instance_name: string;
}

export interface EvolutionQrCode {
  /** data URI pronto para <img src>, ou null se a instância já está conectada */
  base64: string | null;
  pairingCode: string | null;
  state: EvolutionConnectionState;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converte número em dígitos para o JID usado pelo WhatsApp */
export function toJid(digits: string): string {
  return `${digits.replace(/\D/g, '')}@s.whatsapp.net`;
}

/** Extrai os dígitos do número a partir de um JID do Evolution */
export function fromJid(jid: string): string {
  return (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** true quando o JID é de um grupo, que o inbox não trata */
export function isGroupJid(jid: string): boolean {
  return (jid || '').endsWith('@g.us');
}

/**
 * Interpola bodyParams em um corpo com placeholders {{1}}, {{2}}, ...
 * Mantém compatibilidade com os mesmos bodyParams enviados para a Meta.
 */
export function renderTemplateBody(bodyText: string, bodyParams?: string[]): string {
  if (!bodyParams || bodyParams.length === 0) return bodyText;
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, idx) => {
    const value = bodyParams[Number(idx) - 1];
    return value !== undefined ? value : match;
  });
}

async function call<T = any>(
  cfg: EvolutionCredentials,
  action: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T; error?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-evo-base-url': cfg.base_url,
    'x-evo-api-key': cfg.api_key,
    'x-evo-instance': cfg.instance_name,
    'x-evo-action': action,
  };

  const res = await fetch(EVOLUTION_PROXY, {
    method: body !== undefined ? 'POST' : 'GET',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

  // O Evolution devolve o motivo em response.message (array ou string) ou em error
  const error = !res.ok
    ? (Array.isArray(data?.response?.message) ? data.response.message.join('; ')
      : data?.response?.message || data?.message || data?.error || `HTTP ${res.status}`)
    : undefined;

  return { ok: res.ok, status: res.status, data, error };
}

// ── API ──────────────────────────────────────────────────────────────────────

export const evolutionApi = {

  /**
   * Cria a instância no Evolution e já registra o webhook.
   * Idempotente do ponto de vista da UI: se a instância existe, o Evolution
   * responde 403 e tratamos como "já criada".
   */
  async createInstance(
    cfg: EvolutionCredentials,
    webhookUrl: string,
  ): Promise<{ success: boolean; alreadyExists?: boolean; error?: string }> {
    const payload = {
      instanceName: cfg.instance_name,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      // Grupos ficam fora: o inbox é 1:1 com fornecedor ou hóspede
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      rejectCall: false,
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
      },
    };

    const res = await call(cfg, 'create', payload);

    if (res.ok) return { success: true };

    // 403 com "already in use" significa que a instância já existe
    const msg = (res.error || '').toLowerCase();
    if (res.status === 403 || msg.includes('already') || msg.includes('in use')) {
      return { success: true, alreadyExists: true };
    }

    return { success: false, error: res.error };
  },

  /**
   * Solicita o QR Code. Se a instância já estiver conectada, o Evolution
   * responde com o estado em vez do QR.
   */
  async connect(cfg: EvolutionCredentials): Promise<{ success: boolean; qr?: EvolutionQrCode; error?: string }> {
    const res = await call(cfg, 'connect');
    if (!res.ok) return { success: false, error: res.error };

    const d = res.data || {};

    // Já conectado
    if (d.instance?.state) {
      return {
        success: true,
        qr: { base64: null, pairingCode: null, state: d.instance.state as EvolutionConnectionState },
      };
    }

    const base64 = d.base64 || d.qrcode?.base64 || null;
    return {
      success: true,
      qr: {
        // O Evolution às vezes devolve o data URI completo, às vezes só o base64
        base64: base64
          ? (base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`)
          : null,
        pairingCode: d.pairingCode || d.qrcode?.pairingCode || null,
        state: 'connecting',
      },
    };
  },

  async getState(cfg: EvolutionCredentials): Promise<{ success: boolean; state: EvolutionConnectionState; error?: string }> {
    const res = await call(cfg, 'state');
    if (!res.ok) return { success: false, state: 'unknown', error: res.error };
    const state = (res.data?.instance?.state || res.data?.state || 'unknown') as EvolutionConnectionState;
    return { success: true, state };
  },

  /**
   * Verifica se o socket com o WhatsApp está realmente vivo.
   *
   * connectionState devolve estado em cache: quando o processo do Evolution é
   * suspenso (Android em doze, máquina hibernando), o socket do Baileys morre mas
   * a instância continua reportando 'open'. O envio então falha com
   * "Connection Closed" e HTTP 428, que o proxy repassa como 400.
   *
   * Consulta o próprio número da instância, o que exige o socket e não envia
   * mensagem nenhuma.
   */
  async pingSocket(cfg: EvolutionCredentials): Promise<{ alive: boolean; error?: string }> {
    const instancias = await call(cfg, 'fetch-instances');
    if (!instancias.ok) return { alive: false, error: instancias.error };

    const lista = Array.isArray(instancias.data) ? instancias.data : [];
    const minha = lista.find((i: any) => i?.name === cfg.instance_name);
    const ownerJid: string | undefined = minha?.ownerJid;

    // Sem ownerJid a instância nunca completou o pareamento
    if (!ownerJid) return { alive: false, error: 'Instância sem número pareado. Leia o QR Code.' };

    const numero = fromJid(ownerJid);
    const res = await call(cfg, 'check-numbers', { numbers: [numero] });

    if (res.ok) return { alive: true };

    const msg = (res.error || '').toLowerCase();
    if (msg.includes('connection closed') || res.status === 428) {
      return {
        alive: false,
        error: 'A instância reporta conectado, mas o socket com o WhatsApp caiu. '
          + 'Reinicie o processo do Evolution e verifique o wake lock.',
      };
    }

    return { alive: false, error: res.error };
  },

  /**
   * Descriptografa uma mídia recebida e devolve base64.
   *
   * A mídia no WhatsApp é criptografada: a url que vem no payload não abre no
   * navegador. Quem descriptografa é o Evolution, mas ele precisa do
   * WebMessageInfo original, e roda aqui com DATABASE_SAVE_DATA_NEW_MESSAGE
   * desligado para não inflar o banco. Por isso o webhook guarda o objeto bruto
   * em content.raw e ele é devolvido aqui.
   */
  async getMediaBase64(
    cfg: EvolutionCredentials,
    rawMessage: unknown,
  ): Promise<{ success: boolean; base64?: string; mimetype?: string; error?: string }> {
    if (!rawMessage) {
      return { success: false, error: 'Mensagem original não foi guardada, não há como descriptografar.' };
    }

    const res = await call(cfg, 'get-media-base64', {
      message: rawMessage,
      convertToMp4: false,
    });

    if (!res.ok) return { success: false, error: res.error };

    const base64: string | undefined = res.data?.base64 || res.data?.media;
    if (!base64) return { success: false, error: 'O Evolution respondeu sem a mídia.' };

    return { success: true, base64, mimetype: res.data?.mimetype };
  },

  async logout(cfg: EvolutionCredentials): Promise<{ success: boolean; error?: string }> {
    const res = await call(cfg, 'logout');
    return res.ok ? { success: true } : { success: false, error: res.error };
  },

  async deleteInstance(cfg: EvolutionCredentials): Promise<{ success: boolean; error?: string }> {
    const res = await call(cfg, 'delete');
    return res.ok ? { success: true } : { success: false, error: res.error };
  },

  /** Reaplica a configuração de webhook em uma instância existente */
  async setWebhook(cfg: EvolutionCredentials, webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    const res = await call(cfg, 'set-webhook', {
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
      },
    });
    return res.ok ? { success: true } : { success: false, error: res.error };
  },

  async findWebhook(cfg: EvolutionCredentials): Promise<{ success: boolean; url?: string; enabled?: boolean; error?: string }> {
    const res = await call(cfg, 'find-webhook');
    if (!res.ok) return { success: false, error: res.error };
    return { success: true, url: res.data?.url, enabled: res.data?.enabled };
  },

  /**
   * Envia texto. `number` deve conter apenas dígitos com código do país.
   * `delay` é o tempo de digitação simulado, útil para reduzir risco de bloqueio.
   */
  async sendText(
    cfg: EvolutionCredentials,
    params: { number: string; text: string; delay?: number },
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const res = await call(cfg, 'send-text', {
      number: params.number.replace(/\D/g, ''),
      text: params.text,
      delay: params.delay ?? 1200,
      linkPreview: true,
    });

    if (!res.ok) return { success: false, error: res.error };
    return { success: true, messageId: res.data?.key?.id || undefined };
  },

  /** Envia mídia por URL pública */
  async sendMedia(
    cfg: EvolutionCredentials,
    params: {
      number: string;
      media: string;
      mediatype: 'image' | 'video' | 'document' | 'audio';
      caption?: string;
      fileName?: string;
      mimetype?: string;
      delay?: number;
    },
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const res = await call(cfg, 'send-media', {
      number: params.number.replace(/\D/g, ''),
      mediatype: params.mediatype,
      media: params.media,
      caption: params.caption,
      fileName: params.fileName,
      mimetype: params.mimetype,
      delay: params.delay ?? 1200,
    });

    if (!res.ok) return { success: false, error: res.error };
    return { success: true, messageId: res.data?.key?.id || undefined };
  },
};

/** Rótulo legível do estado da conexão */
export function connectionStateLabel(state: EvolutionConnectionState): string {
  switch (state) {
    case 'open':       return 'Conectado';
    case 'connecting': return 'Aguardando leitura do QR Code';
    case 'close':      return 'Desconectado';
    default:           return 'Estado desconhecido';
  }
}
