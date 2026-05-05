// src/lib/fnrhService.ts
// Serviço de integração com a API FNRH Gov (SERPRO) v2

import { supabase } from './supabase';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface FNRHConfig {
  id: string;
  hotel_id: string;
  usuario: string;
  senha: string;
  cpf_responsavel: string;
  ambiente: 'producao' | 'homologacao';
  is_active: boolean;
}

export type FNRHSyncStatus = 'PENDENTE' | 'SUCESSO' | 'CHECKOUT_ENVIADO' | 'ERRO';
export type FNRHAction = 'CHECKIN' | 'CHECKOUT' | 'NOSHOW';

export interface FNRHSyncLog {
  id: string;
  hotel_id: string;
  erbon_booking_id: string;
  numero_reserva: string | null;
  guest_name: string | null;
  guest_document: string | null;
  action: FNRHAction;
  status: FNRHSyncStatus;
  fnrh_reserva_id: string | null;
  fnrh_hospede_id: string | null;
  fnrh_pessoa_id: string | null;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  error_detail: { code?: number; message?: string; body?: string } | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface FNRHHospedePayload {
  is_principal: boolean;
  situacao_hospede: 'CHECKIN_REALIZADO' | 'PRECHECKIN_PENDENTE';
  check_in_em: string;   // ISO 8601 UTC
  check_out_em: string;
  dados_pessoais: {
    nome: string;
    nome_social: string;
    PaisNacionalidade_id: string;   // ISO alpha-2
    genero_id: string;              // HOMEM | MULHER | OUTRO | NAOINFORMADO
    GeneroDescricao: string;
    data_nascimento: string;        // YYYY-MM-DD
    raca_id: string;                // AMARELA | BRANCA | INDIGENA | PARDA | PRETA | NAOINFORMAR
    deficiencia_id: string;         // SIM | NAO | NAOINFORMAR
    tipo_deficiencia_id: string;    // FISICA | AUDITIVA_SURDEZ | VISUAL | INTELECTUAL | MULTIPLA (se SIM)
    documento_id: {
      numero_documento: string;
      tipo_documento_id: 'CPF' | 'PASSAPORTE';
    };
    contato: {
      email: string;
      telefone: string;
      cep: string;
      logradouro: string;
      numero: string;
      complemento: string;
      bairro: string;
      PaisResidencia_id: string;
      cidade_id: number | null;
      estado_id: string;
    };
  };
  responsavel: {
    numero_documento: string;
    tipo_documento_id: string;
  };
  dados_ficha: {
    motivo_viagem_id: string;      // LAZER_FERIAS | NEGOCIOS | COMPRAS | etc.
    meio_transporte_id: string;    // AUTOMOVEL | AVIAO | ONIBUS | etc.
    grau_parentesco_id?: string;   // Apenas menores: PAI|MAE|AVO|IRMAO|TIO|RESPONSAVEL_LEGAL|TUTOR|OUTRO
  };
}

export interface FNRHRegistrarPayload {
  reserva: {
    numero_reserva: string;
    numero_reserva_ota: string;
    data_entrada: string;           // YYYY-MM-DD
    data_saida: string;
    quantidade_hospede_adulto: number;
    quantidade_hospede_menor: number;
    origem_reserva_id: 'MEIOHOSPEDAGEM' | 'OTA';
  };
  dados_hospede: FNRHHospedePayload[];
}

// ── Proxy URL ─────────────────────────────────────────────────────────────────

function fnrhProxyUrl(): string {
  if (import.meta.env.DEV) return '/.netlify/functions/fnrh-proxy';
  return '/.netlify/functions/fnrh-proxy';
}

function proxyHeaders(config: Pick<FNRHConfig, 'usuario' | 'senha' | 'cpf_responsavel' | 'ambiente'>, path: string, method: string = 'GET'): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-fnrh-usuario': config.usuario,
    'x-fnrh-senha': config.senha,
    'x-fnrh-cpf': config.cpf_responsavel,
    'x-fnrh-ambiente': config.ambiente,
    'x-fnrh-path': path,
    'x-fnrh-method': method,
  };
}

async function fnrhFetch(
  config: Pick<FNRHConfig, 'usuario' | 'senha' | 'cpf_responsavel' | 'ambiente'>,
  path: string,
  method: string = 'GET',
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(fnrhProxyUrl(), {
    method: 'POST',           // sempre POST para o proxy — método real vai no header
    headers: proxyHeaders(config, path, method),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// ── Config ────────────────────────────────────────────────────────────────────

export const fnrhService = {

  async getConfig(hotelId: string): Promise<FNRHConfig | null> {
    const { data, error } = await supabase
      .from('fnrh_hotel_configs')
      .select('*')
      .eq('hotel_id', hotelId)
      .maybeSingle();
    if (error || !data) return null;
    return data as FNRHConfig;
  },

  async saveConfig(config: Omit<FNRHConfig, 'id'>): Promise<void> {
    const { error } = await supabase
      .from('fnrh_hotel_configs')
      .upsert(
        { ...config, updated_at: new Date().toISOString() },
        { onConflict: 'hotel_id' }
      );
    if (error) throw error;
  },

  async testConnection(config: Pick<FNRHConfig, 'usuario' | 'senha' | 'cpf_responsavel' | 'ambiente'>): Promise<{ ok: boolean; message: string }> {
    try {
      const { status, data } = await fnrhFetch(config, '/dominios/fnrh/meios_transporte', 'GET');
      if (status === 200) {
        return { ok: true, message: 'Conexão estabelecida com sucesso!' };
      }
      const msg = (data as any)?.erro || (data as any)?.mensagem || `HTTP ${status}`;
      return { ok: false, message: `Erro ${status}: ${msg}` };
    } catch (e: any) {
      return { ok: false, message: e.message || 'Erro de conexão' };
    }
  },

  // ── Operações FNRH Gov ─────────────────────────────────────────────────────

  async registrarHospedagem(
    config: Pick<FNRHConfig, 'usuario' | 'senha' | 'cpf_responsavel' | 'ambiente'>,
    payload: FNRHRegistrarPayload
  ): Promise<{ reserva_id: string; hospede_id: string; pessoa_id: string }> {
    const { status, data } = await fnrhFetch(config, '/hospedagem/registrar', 'POST', payload);
    if (status !== 200) {
      throw { code: status, message: (data as any)?.mensagem || 'Erro ao registrar hospedagem', body: JSON.stringify(data) };
    }
    const d = data as any;
    return {
      reserva_id: d?.dados?.reserva?.reserva_id || '',
      hospede_id: d?.dados?.dados_hospedes?.[0]?.hospede_id || '',
      pessoa_id:  d?.dados?.dados_hospedes?.[0]?.hospede?.pessoa_id || '',
    };
  },

  async enviarCheckout(
    config: Pick<FNRHConfig, 'usuario' | 'senha' | 'cpf_responsavel' | 'ambiente'>,
    fnrhReservaId: string,
    dateTimeUTC: string   // ISO 8601 UTC
  ): Promise<void> {
    const { status, data } = await fnrhFetch(
      config,
      `/reservas/${fnrhReservaId}/checkout`,
      'POST',
      dateTimeUTC   // body é string plain (conforme docs FNRH)
    );
    if (status !== 200) {
      throw { code: status, message: (data as any)?.mensagem || 'Erro ao enviar checkout', body: JSON.stringify(data) };
    }
  },

  async enviarNoShow(
    config: Pick<FNRHConfig, 'usuario' | 'senha' | 'cpf_responsavel' | 'ambiente'>,
    fnrhReservaId: string
  ): Promise<void> {
    const { status, data } = await fnrhFetch(config, `/reservas/${fnrhReservaId}/noshow`, 'POST');
    if (status !== 200) {
      throw { code: status, message: (data as any)?.mensagem || 'Erro ao enviar no-show', body: JSON.stringify(data) };
    }
  },

  async consultarFichas(
    config: Pick<FNRHConfig, 'usuario' | 'senha' | 'cpf_responsavel' | 'ambiente'>,
    params: { page_number?: number; status?: string; data_inicial?: string; data_final?: string }
  ): Promise<unknown> {
    const qs = new URLSearchParams();
    qs.set('page_number', String(params.page_number ?? 1));
    if (params.status)       qs.set('status', params.status);
    if (params.data_inicial) qs.set('data_inicial', params.data_inicial);
    if (params.data_final)   qs.set('data_final', params.data_final);
    const { status, data } = await fnrhFetch(config, `/fichas?${qs.toString()}`, 'GET');
    if (status !== 200) throw new Error(`HTTP ${status}`);
    return data;
  },

  // ── Log helpers ────────────────────────────────────────────────────────────

  async salvarLog(entry: Omit<FNRHSyncLog, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const { data, error } = await supabase
      .from('fnrh_sync_log')
      .insert({ ...entry, updated_at: new Date().toISOString() })
      .select('id')
      .single();
    if (error) throw error;
    return (data as any).id as string;
  },

  async atualizarLog(id: string, updates: Partial<Omit<FNRHSyncLog, 'id' | 'created_at'>>): Promise<void> {
    const { error } = await supabase
      .from('fnrh_sync_log')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async buscarLogPorBooking(hotelId: string, erbonBookingId: string, action: FNRHAction = 'CHECKIN'): Promise<FNRHSyncLog | null> {
    const { data, error } = await supabase
      .from('fnrh_sync_log')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('erbon_booking_id', erbonBookingId)
      .eq('action', action)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as FNRHSyncLog;
  },

  async buscarLogs(
    hotelId: string,
    filtros: { status?: string; dataInicio?: string; dataFim?: string; limit?: number } = {}
  ): Promise<FNRHSyncLog[]> {
    let q = supabase
      .from('fnrh_sync_log')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('created_at', { ascending: false })
      .limit(filtros.limit ?? 200);

    if (filtros.status)     q = q.eq('status', filtros.status);
    if (filtros.dataInicio) q = q.gte('created_at', filtros.dataInicio);
    if (filtros.dataFim)    q = q.lte('created_at', filtros.dataFim + 'T23:59:59Z');

    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as FNRHSyncLog[];
  },

  async reenviar(logId: string, hotelId: string): Promise<void> {
    // Busca log original
    const { data: log, error } = await supabase
      .from('fnrh_sync_log')
      .select('*')
      .eq('id', logId)
      .single();
    if (error || !log) throw new Error('Log não encontrado');

    const cfg = await this.getConfig(hotelId);
    if (!cfg?.is_active) throw new Error('FNRH não está configurado para este hotel');

    const entry = log as FNRHSyncLog;

    // Incrementa contador de tentativas
    await this.atualizarLog(logId, { retry_count: entry.retry_count + 1 });

    if (entry.action === 'CHECKIN' && entry.request_payload) {
      try {
        const result = await this.registrarHospedagem(cfg, entry.request_payload as FNRHRegistrarPayload);
        await this.atualizarLog(logId, {
          status: 'SUCESSO',
          fnrh_reserva_id: result.reserva_id,
          fnrh_hospede_id: result.hospede_id,
          fnrh_pessoa_id:  result.pessoa_id,
          error_detail: null,
        });
      } catch (e: any) {
        await this.atualizarLog(logId, { status: 'ERRO', error_detail: e });
        throw e;
      }
    } else if (entry.action === 'CHECKOUT' && entry.fnrh_reserva_id) {
      const dtUTC = new Date().toISOString();
      try {
        await this.enviarCheckout(cfg, entry.fnrh_reserva_id, dtUTC);
        await this.atualizarLog(logId, { status: 'CHECKOUT_ENVIADO', error_detail: null });
      } catch (e: any) {
        await this.atualizarLog(logId, { status: 'ERRO', error_detail: e });
        throw e;
      }
    } else {
      throw new Error('Não é possível reenviar este tipo de registro sem os dados necessários');
    }
  },
};

export default fnrhService;
