// src/lib/emailConfigService.ts
// Remetente de e-mail por unidade.
//
// A leitura usa a view v_hotel_email_config, que NÃO expõe a senha cifrada,
// apenas has_password. A gravação e o teste passam por Netlify Functions, porque
// a chave de cifragem existe só no servidor.

import { supabase } from './supabase';

export interface HotelEmailConfig {
  id?: string;
  hotel_id: string;
  smtp_host: string;
  smtp_port: number;
  /** false = STARTTLS na 587 (Workspace); true = TLS direto na 465. */
  smtp_secure: boolean;
  smtp_user: string | null;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  active: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  /** A senha em si nunca chega ao browser. */
  has_password: boolean;
}

export interface SaveEmailConfigInput {
  hotel_id: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  /** Vazio = manter a senha já gravada. */
  smtp_password?: string;
  from_name?: string | null;
  from_email: string;
  reply_to?: string | null;
  active: boolean;
}

export function defaultEmailConfig(hotelId: string): HotelEmailConfig {
  return {
    hotel_id: hotelId,
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: null,
    from_name: null,
    from_email: null,
    reply_to: null,
    active: false,
    last_test_at: null,
    last_test_ok: null,
    last_test_error: null,
    has_password: false,
  };
}

async function authedPost(path: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');

  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (res.status === 404) {
    throw new Error(
      'A função de servidor não está disponível neste ambiente. ' +
      'Rode com "npm run dev:netlify" ou publique na Netlify.'
    );
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Falha na requisição (${res.status})`);
  return json;
}

export const emailConfigService = {
  async get(hotelId: string): Promise<HotelEmailConfig | null> {
    const { data, error } = await supabase
      .from('v_hotel_email_config')
      .select('*')
      .eq('hotel_id', hotelId)
      .maybeSingle();
    if (error) throw error;
    return (data as HotelEmailConfig) ?? null;
  },

  /** Quais unidades já podem enviar, para avisar no modal de regra. */
  async isConfigured(hotelId: string): Promise<boolean> {
    const cfg = await this.get(hotelId).catch(() => null);
    return !!cfg?.active && !!cfg.has_password;
  },

  async save(input: SaveEmailConfigInput): Promise<void> {
    await authedPost('/.netlify/functions/email-config-save', input);
  },

  /**
   * Envia um teste. O destino é sempre o e-mail do usuário logado, decidido no
   * servidor, para a tela não poder ser usada como relay.
   */
  async test(hotelId: string): Promise<{ ok: boolean; sent_to?: string; error?: string; auth_failure?: boolean }> {
    return authedPost('/.netlify/functions/email-config-test', { hotel_id: hotelId });
  },
};
