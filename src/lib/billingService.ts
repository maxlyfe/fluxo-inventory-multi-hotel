// src/lib/billingService.ts
// Cobrança de parceiros faturados: fila, marcação (inclusive retroativa e em
// lote) e log de disparo.
//
// Service próprio para não engordar o arService, que já concentra títulos,
// recibos, regras de canal e adquirentes.

import { supabase } from './supabase';
import type { ArBillingStatus, BillingDispatchMode } from './arService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DispatchStatus = 'pendente' | 'enviado' | 'falha' | 'manual' | 'cancelado';

/** Uma linha da view v_ar_billing_queue. */
export interface BillingQueueRow {
  ar_title_id: string;
  hotel_id: string;
  booking_ref: string | null;
  description: string | null;
  channel: string | null;
  guest_name: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  gross_amount: number;
  net_amount: number;
  amount_received: number;
  billing_status: ArBillingStatus;
  billed_at: string | null;
  expected_date: string | null;
  ar_status: string;

  supplier_id: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  supplier_cnpj: string | null;
  supplier_email: string | null;

  channel_rule_id: string | null;
  days_to_receive: number | null;
  billing_email: string | null;
  billing_attach_nf: boolean | null;
  billing_dispatch_mode: BillingDispatchMode | null;

  nf_invoice_id: string | null;
  numero_nf: string | null;
  nf_status: string | null;
  pdf_url: string | null;
  danfse_url: string | null;
  nf_created_at: string | null;

  dispatch_id: string | null;
  dispatch_status: DispatchStatus | null;
  dispatch_to_email: string | null;
  from_email: string | null;
  attempts: number | null;
  dispatch_error: string | null;
  sent_at: string | null;
  marked_manually: boolean | null;

  dias_parado: number | null;
}

export interface BillingQueueFilters {
  billing_status?: ArBillingStatus[];
  supplier_id?: string;
  channel?: string;
  search?: string;
  /** Período pela data de EMISSÃO da NF, não pela previsão de recebimento. */
  from?: string;
  to?: string;
}

export interface MarkBilledResult {
  updated_count: number;
  updated: string[];
  skipped: { id: string; booking_ref: string | null; reason: string }[];
  refs_nao_encontradas: string[];
}

export interface ResolvedRef {
  booking_ref: string | null;
  ar_title_id: string;
  description: string | null;
  gross_amount: number;
  net_amount: number;
  billing_status: ArBillingStatus;
  expected_date: string | null;
  numero_nf: string | null;
  nf_status: string | null;
}

/** Resultado de uma colagem de números de reserva, em três baldes. */
export interface RefLookup {
  found: ResolvedRef[];
  alreadyBilled: ResolvedRef[];
  notFound: string[];
}

/** Resultado do reprocessamento de NFs já emitidas. */
export interface BackfillResult {
  scanned: number;
  prepared: number;
  already: number;
  skipped: number;
  /** motivo → quantidade */
  reasons: Record<string, number>;
  details: {
    nf_invoice_id: string;
    numero_nf: string | null;
    booking_ref: string | null;
    tomador: string | null;
    valor: number | null;
    emitida_em: string;
    reason: string;
  }[];
  details_truncated: boolean;
  from: string;
  to: string;
}

/**
 * Texto do motivo em português, com a ação correspondente.
 * O motivo cru ('sem_regra_faturamento') não diz ao operador o que fazer.
 */
export const BACKFILL_REASON_LABELS: Record<string, string> = {
  sem_regra_faturamento:
    'O CNPJ do tomador não tem regra de faturamento cadastrada. Crie a regra em Regras de Recebimento e rode de novo.',
  tomador_nao_e_cnpj:
    'Tomador é pessoa física. Nota de hóspede não vira cobrança de parceiro.',
  nf_sem_status_valido:
    'A nota não está autorizada, emitida nem em contingência.',
  nf_nao_encontrada:
    'A nota não foi encontrada. Pode ter sido excluída.',
  titulo_nao_resolvido:
    'Não foi possível criar nem localizar o recebível desta nota. Verifique se o título da reserva está cancelado.',
  desconhecido: 'Motivo não identificado.',
};

export interface DispatchAttempt {
  id: string;
  dispatch_id: string;
  attempt_no: number;
  status: 'enviado' | 'falha';
  provider: string | null;
  provider_message_id: string | null;
  error: string | null;
  http_status: number | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Separa uma colagem de números de reserva.
 * Aceita quebra de linha, vírgula, ponto e vírgula, tab e espaço, porque o
 * operador cola de WhatsApp, de planilha e de e-mail, e cada um vem diferente.
 */
export function parseBookingRefsInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? '').split(/[\s,;]+/)) {
    const ref = part.trim();
    if (!ref) continue;
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export function partnerName(row: BillingQueueRow): string {
  return row.nome_fantasia || row.razao_social || 'Sem parceiro';
}

function addDays(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Previsão que será gravada, agrupada por parceiro e prazo. */
export interface ExpectedPreviewGroup {
  partner: string;
  days: number;
  count: number;
  amount: number;
  expected: string;
}

export function previewExpectedDates(rows: BillingQueueRow[], billedOn: string): ExpectedPreviewGroup[] {
  const map = new Map<string, ExpectedPreviewGroup>();
  for (const r of rows) {
    const days = r.days_to_receive ?? 0;
    const key = `${partnerName(r)}|${days}`;
    const cur = map.get(key);
    const amount = r.net_amount - r.amount_received;
    if (cur) { cur.count += 1; cur.amount += amount; }
    else {
      map.set(key, {
        partner: partnerName(r), days, count: 1, amount,
        expected: addDays(billedOn, days),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.partner.localeCompare(b.partner, 'pt-BR'));
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const billingService = {
  async listQueue(hotelId: string, filters: BillingQueueFilters = {}): Promise<BillingQueueRow[]> {
    let q = supabase
      .from('v_ar_billing_queue')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('nf_created_at', { ascending: false, nullsFirst: false });

    if (filters.billing_status?.length) q = q.in('billing_status', filters.billing_status);
    if (filters.supplier_id) q = q.eq('supplier_id', filters.supplier_id);
    if (filters.channel) q = q.eq('channel', filters.channel);
    if (filters.from) q = q.gte('nf_created_at', `${filters.from}T00:00:00`);
    if (filters.to) q = q.lte('nf_created_at', `${filters.to}T23:59:59`);

    const { data, error } = await q;
    if (error) throw error;

    let rows = (data ?? []) as BillingQueueRow[];
    if (filters.search) {
      const s = filters.search.toLowerCase();
      rows = rows.filter(r =>
        (r.booking_ref ?? '').toLowerCase().includes(s) ||
        (r.numero_nf ?? '').toLowerCase().includes(s) ||
        (r.guest_name ?? '').toLowerCase().includes(s) ||
        partnerName(r).toLowerCase().includes(s) ||
        (r.description ?? '').toLowerCase().includes(s));
    }
    return rows;
  },

  /**
   * Resolve números de reserva colados em três baldes distintos.
   * "Não encontrado" e "já cobrado" precisam ser respostas diferentes: a
   * primeira significa que falta emitir a NF ou criar a regra, a segunda que o
   * trabalho já foi feito.
   */
  async lookupRefs(hotelId: string, refs: string[]): Promise<RefLookup> {
    if (!refs.length) return { found: [], alreadyBilled: [], notFound: [] };

    const { data, error } = await supabase.rpc('rpc_ar_resolve_booking_refs', {
      p_hotel_id: hotelId,
      p_refs: refs,
    });
    if (error) throw error;

    const rows = (data ?? []) as ResolvedRef[];
    const matched = new Set(rows.map(r => (r.booking_ref ?? '').trim().toLowerCase()));

    return {
      found: rows.filter(r => r.billing_status === 'aguardando_cobranca'),
      alreadyBilled: rows.filter(r => r.billing_status === 'cobranca_enviada'),
      notFound: refs.filter(r => !matched.has(r.trim().toLowerCase())),
    };
  },

  /**
   * Marca cobrança efetuada em lote, com data possivelmente retroativa.
   * Devolve o resultado item a item: a RPC usa FOR UPDATE, então dois operadores
   * marcando o mesmo lote serializam e o segundo recebe skipped 'ja_cobrado'.
   * Quem chama TEM que exibir o skipped, senão o segundo vê "tudo certo" sem
   * nada ter acontecido.
   */
  async markBilled(args: {
    hotelId: string;
    billedOn: string;
    arTitleIds?: string[];
    bookingRefs?: string[];
    manual?: boolean;
    note?: string | null;
    force?: boolean;
  }): Promise<MarkBilledResult> {
    const { data, error } = await supabase.rpc('rpc_ar_mark_billing_sent', {
      p_hotel_id: args.hotelId,
      p_billed_on: args.billedOn,
      p_ar_title_ids: args.arTitleIds ?? null,
      p_booking_refs: args.bookingRefs ?? null,
      p_manual: args.manual ?? true,
      p_note: args.note ?? null,
      p_force: args.force ?? false,
    });
    if (error) throw error;
    return {
      updated_count: Number((data as any)?.updated_count ?? 0),
      updated: ((data as any)?.updated ?? []) as string[],
      skipped: ((data as any)?.skipped ?? []) as MarkBilledResult['skipped'],
      refs_nao_encontradas: ((data as any)?.refs_nao_encontradas ?? []) as string[],
    };
  },

  /** Chamada pelo nfService após a autorização da NF. */
  async prepareForNf(nfInvoiceId: string) {
    const { data, error } = await supabase.rpc('rpc_ar_prepare_billing_for_nf', {
      p_nf_invoice_id: nfInvoiceId,
    });
    if (error) throw error;
    return data as {
      ok: boolean; reason?: string; ar_title_id?: string;
      dispatch_mode?: BillingDispatchMode; to_email?: string | null; has_email?: boolean;
    };
  },

  /**
   * Reprocessa NFs JÁ EMITIDAS no período e traz para a fila as que casam com
   * regra de parceiro faturado.
   *
   * É o caminho para o caso mais comum na adoção: a nota saiu antes de alguém
   * cadastrar o parceiro, então o engate da emissão devolveu
   * 'sem_regra_faturamento' e nada apareceu na fila.
   *
   * Seguro repetir: a RPC de preparação preserva cobrança já enviada ou marcada
   * à mão.
   */
  async backfillFromEmittedNfs(hotelId: string, from: string, to: string): Promise<BackfillResult> {
    const { data, error } = await supabase.rpc('rpc_ar_backfill_billing_for_period', {
      p_hotel_id: hotelId,
      p_from: from,
      p_to: to,
    });
    if (error) throw error;
    const d = (data ?? {}) as any;
    return {
      scanned: Number(d.scanned ?? 0),
      prepared: Number(d.prepared ?? 0),
      already: Number(d.already ?? 0),
      skipped: Number(d.skipped ?? 0),
      reasons: (d.reasons ?? {}) as Record<string, number>,
      details: (d.details ?? []) as BackfillResult['details'],
      details_truncated: Boolean(d.details_truncated),
      from: String(d.from ?? from),
      to: String(d.to ?? to),
    };
  },

  /** Chamada pelo nfService após o cancelamento da NF. */
  async revertForNf(nfInvoiceId: string) {
    const { data, error } = await supabase.rpc('rpc_ar_revert_billing_for_nf', {
      p_nf_invoice_id: nfInvoiceId,
    });
    if (error) throw error;
    return data as { ok: boolean; reason?: string; reverted?: string[]; kept_with_receipts?: string[] };
  },

  async listAttempts(dispatchId: string): Promise<DispatchAttempt[]> {
    const { data, error } = await supabase
      .from('ar_billing_dispatch_attempts')
      .select('*')
      .eq('dispatch_id', dispatchId)
      .order('attempt_no', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DispatchAttempt[];
  },

  /**
   * Dispara o envio pela Netlify Function.
   *
   * O envio nunca acontece no browser: em emissão em lote o operador fecha a aba
   * no meio e as cobranças pendentes se perderiam em silêncio.
   */
  async send(hotelId: string, arTitleIds: string[]): Promise<{
    sent: { dispatch_id: string; ar_title_id: string }[];
    failed: { dispatch_id: string; ar_title_id: string; error: string }[];
    skipped: { dispatch_id: string; ar_title_id: string; reason: string }[];
  }> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Sessão expirada. Entre novamente.');

    const res = await fetch('/.netlify/functions/ar-billing-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ hotel_id: hotelId, ar_title_ids: arTitleIds }),
    });

    if (res.status === 404) {
      throw new Error(
        'A função de envio não está disponível neste ambiente. ' +
        'Rode com "npm run dev:netlify" ou publique na Netlify. ' +
        'Você pode marcar as cobranças como efetuadas manualmente enquanto isso.'
      );
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Falha no envio (${res.status})`);
    return { sent: json.sent ?? [], failed: json.failed ?? [], skipped: json.skipped ?? [] };
  },

  async cancelDispatch(dispatchId: string): Promise<void> {
    const { error } = await supabase
      .from('ar_billing_dispatches')
      .update({ status: 'cancelado', next_retry_at: null, updated_at: new Date().toISOString() })
      .eq('id', dispatchId);
    if (error) throw error;
  },

  /** Fornecedores que aparecem na fila, para o filtro de parceiro. */
  async listQueuePartners(hotelId: string): Promise<{ id: string; name: string }[]> {
    const { data, error } = await supabase
      .from('v_ar_billing_queue')
      .select('supplier_id, nome_fantasia, razao_social')
      .eq('hotel_id', hotelId)
      .not('supplier_id', 'is', null);
    if (error) throw error;
    const map = new Map<string, string>();
    for (const r of data ?? []) {
      const id = (r as any).supplier_id as string;
      if (!map.has(id)) map.set(id, (r as any).nome_fantasia || (r as any).razao_social || 'Sem nome');
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  },
};
