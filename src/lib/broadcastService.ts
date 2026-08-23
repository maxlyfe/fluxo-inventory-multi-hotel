// src/lib/broadcastService.ts
// Estado persistido do disparo em massa.
//
// Por que isto existe: o envio roda no navegador, um contato por vez, com
// intervalo de 3 a 8 segundos no Evolution. Uma lista de 400 contatos leva mais
// de meia hora com a aba aberta. Enquanto a linha de whatsapp_broadcasts só era
// gravada no fim, qualquer F5 no meio do caminho matava o envio e não deixava
// rastro: nem quantos foram, nem para quem, nem de onde continuar.
//
// Agora a linha nasce antes do primeiro envio e é atualizada a cada mensagem.
// Isso dá três coisas que não existiam: acompanhar o disparo de outra aba,
// saber que ele foi interrompido, e retomar de onde parou.

import { supabase } from './supabase';

export type BroadcastStatus = 'running' | 'completed' | 'canceled' | 'interrupted';

export interface BroadcastTargetState {
  phone: string;
  name: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string;
  waMessageId?: string;
}

export interface BroadcastParam {
  key: string;
  value: string;
}

export interface BroadcastRow {
  id: string;
  hotel_id: string;
  template_name: string;
  total: number;
  sent: number;
  failed: number;
  params: BroadcastParam[];
  targets: BroadcastTargetState[];
  provider: string | null;
  body_text: string | null;
  image_name: string | null;
  status: BroadcastStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/**
 * Depois disto sem batimento, um disparo "running" está morto — a aba que
 * enviava foi fechada, recarregada ou perdeu a rede. O intervalo entre envios
 * chega a 8s, então 60s é folgado o bastante para não acusar falso positivo
 * durante um envio lento.
 */
export const BROADCAST_STALE_MS = 60_000;

/** true quando o disparo está marcado como em andamento mas parou de bater */
export function isBroadcastStale(row: Pick<BroadcastRow, 'status' | 'updated_at'>): boolean {
  if (row.status !== 'running') return false;
  return Date.now() - new Date(row.updated_at).getTime() > BROADCAST_STALE_MS;
}

/** Quantos ainda não foram tentados */
export function pendingTargets(row: Pick<BroadcastRow, 'targets'>): BroadcastTargetState[] {
  return (row.targets || []).filter(t => t.status === 'pending');
}

export const broadcastService = {
  /**
   * Cria a linha do disparo já com todos os destinatários em 'pending'.
   * Chamado ANTES do primeiro envio, de propósito.
   */
  async start(input: {
    hotelId: string;
    templateName: string;
    provider: string | null;
    bodyText: string | null;
    imageName: string | null;
    params: BroadcastParam[];
    targets: Array<{ phone: string; name: string }>;
  }): Promise<BroadcastRow> {
    const targets: BroadcastTargetState[] = input.targets.map(t => ({
      phone: t.phone,
      name: t.name,
      status: 'pending',
    }));

    const { data, error } = await supabase
      .from('whatsapp_broadcasts')
      .insert({
        hotel_id: input.hotelId,
        template_name: input.templateName,
        provider: input.provider,
        body_text: input.bodyText,
        image_name: input.imageName,
        params: input.params,
        targets,
        total: targets.length,
        sent: 0,
        failed: 0,
        status: 'running',
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data as BroadcastRow;
  },

  /**
   * Grava o progresso. É chamado a cada mensagem: com intervalo de segundos
   * entre envios, o custo é irrelevante perto de perder o disparo inteiro.
   * O `updated_at` aqui é o batimento que denuncia uma aba morta.
   */
  async saveProgress(
    id: string,
    progress: { sent: number; failed: number; targets: BroadcastTargetState[] },
  ): Promise<void> {
    await supabase
      .from('whatsapp_broadcasts')
      .update({
        sent: progress.sent,
        failed: progress.failed,
        targets: progress.targets,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  },

  /** Fecha o disparo com o status final */
  async finish(id: string, status: Exclude<BroadcastStatus, 'running'>): Promise<void> {
    await supabase
      .from('whatsapp_broadcasts')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
  },

  /**
   * Disparo marcado como em andamento neste hotel, se houver. Serve para a tela
   * mostrar o que está acontecendo mesmo em outra aba, outro computador, ou
   * depois de um F5.
   */
  async getActive(hotelId: string): Promise<BroadcastRow | null> {
    const { data } = await supabase
      .from('whatsapp_broadcasts')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('status', 'running')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return (data as BroadcastRow) || null;
  },

  async getById(id: string): Promise<BroadcastRow | null> {
    const { data } = await supabase
      .from('whatsapp_broadcasts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    return (data as BroadcastRow) || null;
  },
};
