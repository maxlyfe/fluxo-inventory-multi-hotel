import { supabase } from './supabase';
import { PaymentMethod } from './apService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArOrigin = 'erbon' | 'omnibees' | 'manual' | 'inflow' | 'faturado';
export type ArStatus = 'previsto' | 'parcial' | 'recebido' | 'cancelado';
export type TriggerEvent = 'checkout' | 'checkin' | 'faturamento';

/**
 * Estado da cobrança de um título faturado.
 *  nao_aplicavel        → não é faturamento (OTA, direto, cartão)
 *  aguardando_nf        → tem regra de faturamento, mas a NF ainda não saiu
 *  aguardando_cobranca  → NF emitida, cobrança ainda não enviada
 *  cobranca_enviada     → cobrança enviada; a partir daqui a data é firme
 *
 * Nos dois estados de espera expected_date é NULL, e é isso que mantém o título
 * fora da previsão de caixa (cashflowService filtra por gte/lte, e NULL não
 * satisfaz nenhum dos dois).
 */
export type ArBillingStatus =
  | 'nao_aplicavel' | 'aguardando_nf' | 'aguardando_cobranca' | 'cobranca_enviada';

export type CardBrand = 'visa' | 'master' | 'elo' | 'amex' | 'hipercard' | 'outros';
export type CardModality = 'debito' | 'credito';
/** De onde veio a informação de bandeira/parcelas — a Erbon devolve rótulo livre. */
export type CardDataSource = 'erbon' | 'manual' | 'regra_default' | 'indefinido';
export type BillingDispatchMode = 'manual' | 'automatico';

export interface ArTitle {
  id: string;
  hotel_id: string;
  description: string | null;
  origin: ArOrigin;
  origin_ref: string | null;
  channel: string | null;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  amount_received: number;
  /** NULL quando billing_status é aguardando_nf ou aguardando_cobranca. */
  expected_date: string | null;
  status: ArStatus;
  acquirer_id: string | null;
  card_brand: string | null;
  installments: number | null;
  installment_number: number;
  notes: string | null;
  created_at: string;

  // ── Faturamento por parceiro ──
  supplier_id: string | null;
  channel_rule_id: string | null;
  billing_status: ArBillingStatus;
  billed_at: string | null;

  // ── Reserva de origem ──
  booking_ref: string | null;
  guest_name: string | null;
  checkin_date: string | null;
  checkout_date: string | null;

  // ── Cartão ──
  card_modality: CardModality | null;
  card_data_source: CardDataSource | null;
  installment_total: number | null;
  acquirer_rule_id: string | null;

  /** true = ajustado à mão; rpc_ar_upsert_generated nunca sobrescreve. */
  manual_override: boolean;
}

/** Resultado de uma regeneração de títulos a partir das reservas. */
export interface GenerateResult {
  inserted: number;
  preserved: number;
  deleted: number;
  /**
   * Canais presentes nas reservas do período que não têm regra própria.
   * Antes disso a ausência de regra era silenciosa: o título caía na regra
   * "Direto" ou em taxa 0% com data de check-out, e ninguém ficava sabendo.
   */
  channels_without_rule: ChannelImpact[];
}

/** Quanto dinheiro está preso num canal sem regra de recebimento. */
export interface ChannelImpact {
  channel: string;
  count: number;
  gross_amount: number;
}

/**
 * Recebível lançado à mão. Tipo próprio em vez de Omit<ArTitle, ...> porque o
 * ArTitle cresceu com os campos de faturamento e cartão, que o formulário
 * manual não preenche.
 */
export interface NewManualArTitle {
  hotel_id: string;
  description: string;
  channel?: string | null;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  expected_date: string;
  supplier_id?: string | null;
  notes?: string | null;
}

export interface ArReceipt {
  id?: string;
  ar_title_id: string;
  hotel_id: string;
  receipt_date: string;
  amount: number;
  payment_method: PaymentMethod;
  bank_account_id?: string | null;
  notes?: string | null;
}

export interface ChannelReceivingRule {
  id?: string;
  hotel_id: string;
  channel: string;
  trigger_event: TriggerEvent;
  days_to_receive: number;
  receiving_method: 'deposito' | 'cartao';
  acquirer_id?: string | null;
  default_fee_percent: number;
  active: boolean;

  // ── Parceiro faturado ──
  supplier_id?: string | null;
  /** Somente dígitos (14). Denormalizado de suppliers.cnpj de propósito. */
  partner_cnpj?: string | null;

  // ── Template de cobrança (só usado em trigger_event = 'faturamento') ──
  billing_email?: string | null;
  billing_cc_emails?: string[];
  billing_subject_template?: string | null;
  billing_body_template?: string | null;
  billing_attach_nf?: boolean;
  billing_dispatch_mode?: BillingDispatchMode;

  // ── Defaults de cartão quando a Erbon não informa ──
  card_default_brand?: CardBrand | null;
  card_default_modality?: CardModality | null;
  card_default_installments?: number | null;
}

/** Regra do mesmo CNPJ em outra unidade do grupo, para copiar ou vincular. */
export interface GroupPartnerRule extends ChannelReceivingRule {
  hotel_name?: string | null;
}

export interface CardAcquirer {
  id?: string;
  hotel_id: string;
  name: string;
  active: boolean;
}

export interface CardAcquirerRule {
  id?: string;
  acquirer_id: string;
  /** Preenchido a partir da Fase 4; herdado do adquirente nas linhas antigas. */
  hotel_id?: string;
  card_brand: string;
  modality: 'debito' | 'credito';
  installment_from: number;
  installment_to: number;
  fee_percent: number;
  settlement_days: number;
  /** Intervalo entre parcelas do mesmo pagamento. Fase 4. */
  installment_interval_days?: number;
  active?: boolean;
}

export interface ArFilters {
  status?: ArStatus | 'atrasado';
  origin?: ArOrigin;
  channel?: string;
  from?: string;
  to?: string;
  search?: string;
  billing_status?: ArBillingStatus;
  supplier_id?: string;
  acquirer_id?: string;
  /** true = traz também os títulos sem data firme (aguardando cobrança). */
  include_undated?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function addDays(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface BookingAgg {
  ref: string;
  bookingRef: string;
  guestName?: string | null;
  channel: string;
  checkin: string;
  checkout: string;
  total: number;
}

/**
 * Resolve a regra do canal.
 *
 * O fallback para a regra "Direto" existe para o caso comum (canal novo da OTA
 * que ninguém cadastrou ainda), mas NUNCA pode herdar 'faturamento': se a regra
 * de "Direto" for de faturamento, todo canal sem regra própria passaria a ser
 * faturado por herança, entrando na fila de cobrança sem nenhum parceiro para
 * cobrar. Faturamento é sempre uma decisão explícita por parceiro.
 */
function findRule(rules: ChannelReceivingRule[], channel: string): ChannelReceivingRule | undefined {
  const c = channel.trim().toLowerCase();
  const exact = rules.find(r => r.active && r.channel.trim().toLowerCase() === c);
  if (exact) return exact;
  const fallback = rules.find(r => r.active && r.channel.trim().toLowerCase() === 'direto');
  return fallback && fallback.trigger_event !== 'faturamento' ? fallback : undefined;
}

/** Linha pronta para a RPC rpc_ar_upsert_generated (chaves em snake_case). */
type ArTitleDraft = Record<string, unknown>;

/** Informação de cartão inferida de um rótulo livre. */
export interface CardInfo {
  brand: CardBrand | null;
  modality: CardModality | null;
  installments: number | null;
  source: CardDataSource;
}

const BRAND_PATTERNS: [CardBrand, RegExp][] = [
  ['visa',      /\bvisa\b/i],
  ['master',    /\bmaster( ?card)?\b|\bmc\b/i],
  ['elo',       /\belo\b/i],
  ['amex',      /\bamex\b|american express/i],
  ['hipercard', /\bhiper ?card\b|\bhiper\b/i],
];

/**
 * Tenta extrair bandeira, modalidade e parcelas de um rótulo de pagamento.
 *
 * É HEURÍSTICA, não dado estruturado: a Erbon devolve texto livre
 * ("Cartão de Débito", "Integrado via Bee2Pay Rede Master Card") e o número de
 * parcelas normalmente não vem. Por isso o resultado carrega `source`: a tela
 * mostra de onde a informação saiu e permite corrigir por título. Projetar caixa
 * em 3x para algo que caiu à vista é pior do que não projetar.
 */
export function parseCardInfo(paymentType?: string | null, description?: string | null): CardInfo {
  const text = `${paymentType ?? ''} ${description ?? ''}`.trim();
  if (!text) return { brand: null, modality: null, installments: null, source: 'indefinido' };

  const brand = BRAND_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;

  let modality: CardModality | null = null;
  if (/d[ée]bito|debit/i.test(text)) modality = 'debito';
  else if (/cr[ée]dito|credit/i.test(text)) modality = 'credito';

  // "3x", "em 3 vezes", "3 parcelas"
  const m = text.match(/(\d{1,2})\s*(?:x\b|vezes|parcelas?)/i);
  const installments = m ? Math.min(24, Math.max(1, parseInt(m[1], 10))) : null;

  const known = brand || modality || installments;
  return { brand, modality, installments, source: known ? 'erbon' : 'indefinido' };
}

/** Taxa e prazo efetivos de um recebimento em cartão. */
interface CardTerms {
  feePercent: number;
  settlementDays: number;
  intervalDays: number;
  installments: number;
  brand: CardBrand | null;
  modality: CardModality | null;
  acquirerRuleId: string | null;
  source: CardDataSource;
}

/**
 * Resolve a faixa da adquirente. Espelha fn_card_acquirer_rule: bandeira exata
 * ganha de 'outros', e a faixa mais estreita ganha da mais ampla.
 * Sem faixa aplicável, cai na taxa e no prazo da regra de canal.
 */
function resolveCardTerms(
  rule: ChannelReceivingRule,
  acquirerRules: CardAcquirerRule[],
  card: CardInfo,
): CardTerms {
  const brand = card.brand ?? rule.card_default_brand ?? null;
  const modality = card.modality ?? rule.card_default_modality ?? 'credito';
  const installments = card.installments ?? rule.card_default_installments ?? 1;
  const source: CardDataSource =
    card.source === 'erbon' ? 'erbon'
      : (rule.card_default_brand || rule.card_default_installments) ? 'regra_default'
      : 'indefinido';

  const candidates = acquirerRules
    .filter(r => r.acquirer_id === rule.acquirer_id)
    .filter(r => r.active !== false)
    .filter(r => r.modality === modality)
    .filter(r => r.card_brand === (brand ?? 'outros') || r.card_brand === 'outros')
    .filter(r => installments >= r.installment_from && installments <= r.installment_to)
    .sort((a, b) => {
      const exact = Number(b.card_brand === brand) - Number(a.card_brand === brand);
      if (exact !== 0) return exact;
      return (a.installment_to - a.installment_from) - (b.installment_to - b.installment_from);
    });

  const match = candidates[0];
  if (!match) {
    return {
      feePercent: rule.default_fee_percent ?? 0,
      settlementDays: rule.days_to_receive ?? 0,
      intervalDays: 30,
      installments,
      brand, modality,
      acquirerRuleId: null,
      source: 'indefinido',
    };
  }

  return {
    // A taxa da adquirente SUBSTITUI a taxa do canal: é ela que a maquininha
    // efetivamente cobra.
    feePercent: match.fee_percent,
    settlementDays: match.settlement_days,
    intervalDays: match.installment_interval_days ?? 30,
    installments,
    brand, modality,
    acquirerRuleId: match.id ?? null,
    source,
  };
}

/** Divide um valor em n parcelas, com o resto na última. */
function splitAmount(total: number, n: number): number[] {
  const each = Math.round((total / n) * 100) / 100;
  const arr = Array(n).fill(each);
  arr[n - 1] = Math.round((total - each * (n - 1)) * 100) / 100;
  return arr;
}

/**
 * Monta as linhas de um recebível. Devolve N linhas quando o recebimento é em
 * cartão parcelado, uma por installment_number.
 */
function buildTitles(
  origin: ArOrigin,
  b: BookingAgg,
  rule: ChannelReceivingRule | undefined,
  acquirerRules: CardAcquirerRule[] = [],
  card: CardInfo = { brand: null, modality: null, installments: null, source: 'indefinido' },
): ArTitleDraft[] {
  const gross = Math.round(b.total * 100) / 100;
  const eventDate = rule?.trigger_event === 'checkin' ? b.checkin : b.checkout;
  const isFaturado = rule?.trigger_event === 'faturamento';

  const common = {
    origin,
    origin_ref: b.ref,
    channel: b.channel,
    booking_ref: b.bookingRef,
    guest_name: b.guestName ?? null,
    checkin_date: b.checkin || null,
    checkout_date: b.checkout || null,
    channel_rule_id: rule?.id ?? null,
    acquirer_id: rule?.acquirer_id ?? null,
  };

  // ── Cartão: uma linha por parcela ──
  if (rule && rule.receiving_method === 'cartao' && rule.acquirer_id) {
    const terms = resolveCardTerms(rule, acquirerRules, card);
    const n = Math.max(1, terms.installments);
    const parts = splitAmount(gross, n);

    return parts.map((amount, i) => {
      const fee = Math.round(amount * terms.feePercent) / 100;
      return {
        ...common,
        description: n > 1
          ? `Reserva ${b.bookingRef} · ${b.channel} · ${i + 1}/${n}`
          : `Reserva ${b.bookingRef} · ${b.channel}`,
        gross_amount: amount,
        fee_amount: fee,
        net_amount: Math.round((amount - fee) * 100) / 100,
        expected_date: addDays(eventDate, terms.settlementDays + i * terms.intervalDays),
        installment_number: i + 1,
        installments: n,
        installment_total: n,
        card_brand: terms.brand,
        card_modality: terms.modality,
        card_data_source: terms.source,
        acquirer_rule_id: terms.acquirerRuleId,
        billing_status: 'nao_aplicavel',
        supplier_id: null,
        notes: terms.acquirerRuleId
          ? null
          : 'Sem faixa de adquirente para esta bandeira e parcela: taxa e prazo estimados pela regra do canal.',
      };
    });
  }

  // ── Depósito, transferência e faturado ──
  const feePercent = rule?.default_fee_percent ?? 0;
  const fee = Math.round(gross * feePercent) / 100;

  // Faturado não tem data firme: o prazo só começa a contar quando a NF sai e a
  // cobrança é enviada (rpc_ar_mark_billing_sent grava a data definitiva).
  const expected = isFaturado ? null : rule ? addDays(eventDate, rule.days_to_receive) : b.checkout;

  return [{
    ...common,
    description: `Reserva ${b.bookingRef} · ${b.channel}`,
    gross_amount: gross,
    fee_amount: fee,
    net_amount: Math.round((gross - fee) * 100) / 100,
    expected_date: expected,
    installment_number: 1,
    supplier_id: isFaturado ? rule?.supplier_id ?? null : null,
    billing_status: isFaturado ? 'aguardando_nf' : 'nao_aplicavel',
    notes: rule ? null : 'Canal sem regra de recebimento: data e taxa estimadas.',
  }];
}

/**
 * Regeneração idempotente via RPC.
 *
 * Substitui o upsert com ignoreDuplicates que existia aqui, e que nunca
 * corrigia um título já gravado — o operador ajustava a regra, regerava, e a
 * previsão continuava errada em silêncio. A RPC apaga e reinsere dentro de uma
 * transação, preservando título com recebimento, cancelado, já cobrado ou
 * ajustado à mão.
 */
async function upsertTitles(hotelId: string, rows: ArTitleDraft[]): Promise<GenerateResult> {
  const empty: GenerateResult = { inserted: 0, preserved: 0, deleted: 0, channels_without_rule: [] };
  if (!rows.length) return empty;

  const acc = { ...empty };
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await supabase.rpc('rpc_ar_upsert_generated', {
      p_hotel_id: hotelId,
      p_rows: rows.slice(i, i + CHUNK),
    });
    if (error) throw error;
    acc.inserted  += Number((data as any)?.inserted  ?? 0);
    acc.preserved += Number((data as any)?.preserved ?? 0);
    acc.deleted   += Number((data as any)?.deleted   ?? 0);
  }
  return acc;
}

/** Agrega o impacto financeiro dos canais que ficaram sem regra própria. */
function collectChannelsWithoutRule(
  bookings: BookingAgg[],
  rules: ChannelReceivingRule[],
): ChannelImpact[] {
  const map = new Map<string, ChannelImpact>();
  for (const b of bookings) {
    if (findRule(rules, b.channel)) continue;
    const cur = map.get(b.channel);
    if (cur) { cur.count += 1; cur.gross_amount += b.total; }
    else map.set(b.channel, { channel: b.channel, count: 1, gross_amount: b.total });
  }
  return Array.from(map.values())
    .map(c => ({ ...c, gross_amount: Math.round(c.gross_amount * 100) / 100 }))
    .sort((a, b) => b.gross_amount - a.gross_amount);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const arService = {
  // ── Titles ──
  async list(hotelId: string, filters: ArFilters = {}): Promise<ArTitle[]> {
    let q = supabase
      .from('ar_titles')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('expected_date', { ascending: true });
    if (filters.origin) q = q.eq('origin', filters.origin);
    if (filters.channel) q = q.eq('channel', filters.channel);
    if (filters.billing_status) q = q.eq('billing_status', filters.billing_status);
    if (filters.supplier_id) q = q.eq('supplier_id', filters.supplier_id);
    if (filters.acquirer_id) q = q.eq('acquirer_id', filters.acquirer_id);

    // Título aguardando cobrança tem expected_date NULL, e NULL não satisfaz
    // gte nem lte. Sem include_undated ele simplesmente não aparece — que é o
    // comportamento certo para a previsão de caixa, mas errado para a tela, que
    // precisa mostrar "aguardando cobrança" em card separado.
    if (filters.from || filters.to) {
      const range: string[] = [];
      if (filters.from) range.push(`expected_date.gte.${filters.from}`);
      if (filters.to) range.push(`expected_date.lte.${filters.to}`);
      if (filters.include_undated) {
        q = q.or(`expected_date.is.null,and(${range.join(',')})`);
      } else {
        if (filters.from) q = q.gte('expected_date', filters.from);
        if (filters.to) q = q.lte('expected_date', filters.to);
      }
    }

    if (filters.status === 'atrasado') {
      q = q.in('status', ['previsto', 'parcial']).lt('expected_date', new Date().toISOString().slice(0, 10));
    } else if (filters.status) {
      q = q.eq('status', filters.status);
    }
    const { data, error } = await q;
    if (error) throw error;
    let rows = (data ?? []) as ArTitle[];
    if (filters.search) {
      const s = filters.search.toLowerCase();
      rows = rows.filter(t =>
        (t.description ?? '').toLowerCase().includes(s) || (t.channel ?? '').toLowerCase().includes(s));
    }
    return rows;
  },

  async createManual(input: NewManualArTitle): Promise<void> {
    const { error } = await supabase.from('ar_titles').insert({
      ...input,
      origin: 'manual',
      origin_ref: null,
      installment_number: 1,
      billing_status: 'nao_aplicavel',
      // Lançado à mão = a RPC de regeneração nunca sobrescreve.
      manual_override: true,
    });
    if (error) throw error;
  },

  async update(id: string, patch: Partial<ArTitle>): Promise<void> {
    const { error } = await supabase
      .from('ar_titles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async cancel(id: string): Promise<void> {
    return this.update(id, { status: 'cancelado' } as Partial<ArTitle>);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('ar_titles').delete().eq('id', id);
    if (error) throw error;
  },

  async registerReceipt(receipt: ArReceipt): Promise<void> {
    const { error } = await supabase.from('ar_receipts').insert(receipt);
    if (error) throw error;
  },

  async listReceipts(arTitleId: string) {
    const { data, error } = await supabase
      .from('ar_receipts')
      .select('*, bank_accounts(name)')
      .eq('ar_title_id', arTitleId)
      .order('receipt_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async deleteReceipt(id: string): Promise<void> {
    const { error } = await supabase.from('ar_receipts').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Channel rules ──
  async listRules(hotelId: string): Promise<ChannelReceivingRule[]> {
    const { data, error } = await supabase
      .from('channel_receiving_rules')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('channel');
    if (error) throw error;
    return data ?? [];
  },

  async saveRule(rule: ChannelReceivingRule): Promise<ChannelReceivingRule> {
    // hotel_name e hotels vêm do join quando a regra foi lida de outra unidade
    // (findGroupRulesByCnpj) e não são colunas: mandar junto quebra o insert.
    const { id, hotel_name: _hn, hotels: _h, ...rest } = rule as any;
    const payload = {
      ...rest,
      channel: rule.channel.trim(),
      // O banco exige 14 dígitos (chk_channel_rules_partner_cnpj) e é por este
      // campo que a NF é casada, então normaliza aqui, não na UI.
      partner_cnpj: rule.partner_cnpj ? rule.partner_cnpj.replace(/\D/g, '') || null : null,
    };

    if (id) {
      const { data, error } = await supabase
        .from('channel_receiving_rules')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as ChannelReceivingRule;
    }
    const { data, error } = await supabase
      .from('channel_receiving_rules').insert(payload).select().single();
    if (error) throw error;
    return data as ChannelReceivingRule;
  },

  async deleteRule(id: string): Promise<void> {
    const { error } = await supabase.from('channel_receiving_rules').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Parceiro e replicação entre unidades do grupo ─────────────────────────

  /** Unidades ativas do grupo, para o multiselect de replicação. */
  async listGroupHotels(groupId?: string | null): Promise<{ id: string; name: string }[]> {
    let q = supabase.from('hotels').select('id, name, group_id, is_active').order('name');
    if (groupId) q = q.eq('group_id', groupId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? [])
      .filter((h: any) => h.is_active !== false)
      .map((h: any) => ({ id: h.id, name: h.name }));
  },

  /**
   * Regras do mesmo CNPJ em OUTRAS unidades, para oferecer "copiar esta
   * configuração" em vez de o operador redigitar prazo, taxa e template.
   *
   * hotelIds vem do chamador (unidades do grupo) porque a RLS de
   * channel_receiving_rules ainda é permissiva: filtrar aqui é o que impede
   * enxergar regra de outro grupo.
   */
  async findGroupRulesByCnpj(
    cnpj: string,
    hotelIds: string[],
    excludeHotelId: string,
  ): Promise<GroupPartnerRule[]> {
    const clean = (cnpj ?? '').replace(/\D/g, '');
    const others = hotelIds.filter(id => id !== excludeHotelId);
    if (clean.length !== 14 || !others.length) return [];

    const { data, error } = await supabase
      .from('channel_receiving_rules')
      .select('*, hotels(name)')
      .eq('partner_cnpj', clean)
      .in('hotel_id', others);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ ...r, hotel_name: r.hotels?.name ?? null }));
  },

  /**
   * Garante que o fornecedor do CNPJ existe no hotel destino, CLONANDO a linha
   * do hotel de origem. Clonar em vez de chamar findOrCreateByCnpj é
   * deliberado: a consulta à Receita custa crédito e os dados já estão aqui.
   */
  async ensureSupplierInHotel(sourceSupplierId: string, targetHotelId: string): Promise<string | null> {
    const { data: source, error: e1 } = await supabase
      .from('suppliers').select('*').eq('id', sourceSupplierId).maybeSingle();
    if (e1) throw e1;
    if (!source) return null;

    const cnpj = (source as any).cnpj as string | null;
    if (!cnpj) return null;

    const { data: existing } = await supabase
      .from('suppliers').select('id')
      .eq('hotel_id', targetHotelId).eq('cnpj', cnpj).maybeSingle();
    if (existing) return (existing as any).id;

    const { id: _id, created_at: _c, updated_at: _u, hotel_id: _h, ...rest } = source as any;
    const { data: inserted, error: e2 } = await supabase
      .from('suppliers')
      .insert({ ...rest, hotel_id: targetHotelId, updated_at: new Date().toISOString() })
      .select('id').single();
    if (e2) {
      // 23505 = corrida com outro clique/aba. O registro existe: basta relê-lo.
      if ((e2 as any).code === '23505') {
        const { data: again } = await supabase
          .from('suppliers').select('id')
          .eq('hotel_id', targetHotelId).eq('cnpj', cnpj).maybeSingle();
        return again ? (again as any).id : null;
      }
      throw e2;
    }
    return (inserted as any).id;
  },

  /**
   * Replica uma regra para outras unidades do grupo, garantindo o fornecedor em
   * cada destino. Resultado item a item: replicar em 4 unidades e ter 1 falha
   * não pode virar "deu erro" sem dizer onde.
   */
  async replicateRule(
    rule: ChannelReceivingRule,
    targetHotelIds: string[],
  ): Promise<{ hotel_id: string; status: 'criada' | 'atualizada' | 'falhou'; error?: string }[]> {
    const out: { hotel_id: string; status: 'criada' | 'atualizada' | 'falhou'; error?: string }[] = [];

    for (const hotelId of targetHotelIds) {
      if (hotelId === rule.hotel_id) continue;
      try {
        const supplierId = rule.supplier_id
          ? await this.ensureSupplierInHotel(rule.supplier_id, hotelId)
          : null;

        const { id: _id, hotel_id: _h, ...base } = rule;
        const payload = { ...base, hotel_id: hotelId, supplier_id: supplierId };

        // Procura pela mesma chave que o banco usa: parceiro por CNPJ, ou canal
        // normalizado quando a regra é genérica.
        let existingId: string | null = null;
        if (rule.partner_cnpj) {
          const { data } = await supabase
            .from('channel_receiving_rules').select('id')
            .eq('hotel_id', hotelId).eq('partner_cnpj', rule.partner_cnpj).maybeSingle();
          existingId = data ? (data as any).id : null;
        } else {
          const { data } = await supabase
            .from('channel_receiving_rules').select('id, channel')
            .eq('hotel_id', hotelId).is('partner_cnpj', null);
          const target = rule.channel.trim().toLowerCase();
          existingId = (data ?? []).find((r: any) => r.channel.trim().toLowerCase() === target)?.id ?? null;
        }

        if (existingId) {
          const { error } = await supabase
            .from('channel_receiving_rules')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', existingId);
          if (error) throw error;
          out.push({ hotel_id: hotelId, status: 'atualizada' });
        } else {
          const { error } = await supabase.from('channel_receiving_rules').insert(payload);
          if (error) throw error;
          out.push({ hotel_id: hotelId, status: 'criada' });
        }
      } catch (err: any) {
        out.push({ hotel_id: hotelId, status: 'falhou', error: err?.message ?? 'erro desconhecido' });
      }
    }
    return out;
  },

  // ── Card acquirers ──
  async listAcquirers(hotelId: string): Promise<CardAcquirer[]> {
    const { data, error } = await supabase
      .from('card_acquirers')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('name');
    if (error) throw error;
    return data ?? [];
  },

  async saveAcquirer(acq: CardAcquirer): Promise<CardAcquirer> {
    if (acq.id) {
      const { id, ...patch } = acq;
      const { data, error } = await supabase
        .from('card_acquirers').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await supabase.from('card_acquirers').insert(acq).select().single();
    if (error) throw error;
    return data;
  },

  async deleteAcquirer(id: string): Promise<void> {
    const { error } = await supabase.from('card_acquirers').delete().eq('id', id);
    if (error) throw error;
  },

  async listAcquirerRules(acquirerId: string): Promise<CardAcquirerRule[]> {
    const { data, error } = await supabase
      .from('card_acquirer_rules')
      .select('*')
      .eq('acquirer_id', acquirerId)
      .order('card_brand')
      .order('installment_from');
    if (error) throw error;
    return data ?? [];
  },

  /** Todas as faixas de todos os adquirentes do hotel, para a geração em lote. */
  async listAllAcquirerRules(hotelId: string): Promise<CardAcquirerRule[]> {
    const { data, error } = await supabase
      .from('card_acquirer_rules')
      .select('*')
      .eq('hotel_id', hotelId);
    // Antes da migration da Fase 4 a coluna hotel_id não existe: sem ela o
    // cálculo simplesmente não usa faixas, em vez de derrubar a geração inteira.
    if (error) {
      console.warn('[arService] Não foi possível carregar as faixas de adquirente:', error.message);
      return [];
    }
    return (data ?? []) as CardAcquirerRule[];
  },

  async saveAcquirerRule(rule: CardAcquirerRule): Promise<void> {
    // installment_range é coluna gerada: mandar de volta no update dá erro.
    const { id, installment_range: _r, ...patch } = rule as any;
    if (id) {
      const { error } = await supabase
        .from('card_acquirer_rules')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('card_acquirer_rules').insert(patch);
      if (error) throw error;
    }
  },

  /**
   * Corrige bandeira, modalidade e parcelas de um título e recalcula taxa e
   * datas. A informação de cartão que vem do PMS é heurística: sem esta correção
   * manual, um erro de inferência ficaria congelado na previsão.
   */
  async setTitleCardInfo(
    hotelId: string,
    title: ArTitle,
    info: { acquirer_id?: string | null; card_brand?: CardBrand | null; card_modality?: CardModality | null; installments?: number | null },
  ): Promise<void> {
    if (title.amount_received > 0) {
      throw new Error('Título já recebido: taxa e prazo não podem ser recalculados.');
    }
    const acquirerId = info.acquirer_id ?? title.acquirer_id;
    const acquirerRules = acquirerId ? await this.listAllAcquirerRules(hotelId) : [];
    const rules = await this.listRules(hotelId);
    const rule = rules.find(r => r.id === title.channel_rule_id);
    if (!rule) throw new Error('Regra de canal do título não encontrada.');

    const terms = resolveCardTerms(
      { ...rule, acquirer_id: acquirerId },
      acquirerRules,
      {
        brand: info.card_brand ?? null,
        modality: info.card_modality ?? null,
        installments: info.installments ?? null,
        source: 'manual',
      },
    );

    const base = title.checkout_date ?? title.expected_date;
    if (!base) throw new Error('Título sem data de referência para recalcular.');

    const fee = Math.round(title.gross_amount * terms.feePercent) / 100;
    await this.update(title.id, {
      acquirer_id: acquirerId,
      acquirer_rule_id: terms.acquirerRuleId,
      card_brand: terms.brand,
      card_modality: terms.modality,
      card_data_source: 'manual',
      fee_amount: fee,
      net_amount: Math.round((title.gross_amount - fee) * 100) / 100,
      expected_date: addDays(base, terms.settlementDays + (title.installment_number - 1) * terms.intervalDays),
      manual_override: true,
    } as Partial<ArTitle>);
  },

  async deleteAcquirerRule(id: string): Promise<void> {
    const { error } = await supabase.from('card_acquirer_rules').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Generation from sales channels ────────────────────────────────────────

  /**
   * Generates AR titles from the latest Erbon snapshot in erbon_hospedagem_daily.
   * One title per reserva with checkout within [from, to]. Idempotent.
   */
  async generateFromErbon(hotelId: string, from: string, to: string): Promise<GenerateResult> {
    const rules = await this.listRules(hotelId);
    const empty: GenerateResult = { inserted: 0, preserved: 0, deleted: 0, channels_without_rule: [] };

    // Latest snapshot
    const { data: last, error: e1 } = await supabase
      .from('erbon_hospedagem_daily')
      .select('snapshot_date')
      .eq('hotel_id', hotelId)
      .order('snapshot_date', { ascending: false })
      .limit(1);
    if (e1) throw e1;
    const snap = last?.[0]?.snapshot_date;
    if (!snap) return empty;

    // Page through snapshot payloads
    const PAGE = 1000;
    const raw: any[] = [];
    for (let idx = 0; ; idx += PAGE) {
      const { data, error } = await supabase
        .from('erbon_hospedagem_daily')
        .select('payload')
        .eq('hotel_id', hotelId)
        .eq('snapshot_date', snap)
        .order('id', { ascending: true })
        .range(idx, idx + PAGE - 1);
      if (error) throw error;
      raw.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }

    // Group by reserva (same convention as SalesReport: agente > canal > Direto)
    const byRes = new Map<string, BookingAgg>();
    for (const row of raw) {
      const r: any = row.payload;
      if (!r || r.status === 'CANCELED') continue;
      const ref = String(r.iD_RESERVA ?? '');
      if (!ref) continue;
      const cur = byRes.get(ref);
      if (cur) {
        cur.total += Number(r.diaria) || 0;
      } else {
        byRes.set(ref, {
          ref: `erbon-${hotelId}-${ref}`,
          // Número cru da reserva: é por ele que a fila de cobranças pesquisa e
          // que a NF é casada. origin_ref embute o hotel e exigiria LIKE.
          bookingRef: ref,
          // O payload de /hospedagem não traz nome de hóspede (só iD_HOSPEDE).
          guestName: null,
          channel: String(r.agente || r.canal || 'Direto').trim() || 'Direto',
          checkin: String(r.datA_ENTRADA ?? '').split('T')[0],
          checkout: String(r.datA_SAIDA ?? '').split('T')[0],
          total: Number(r.diaria) || 0,
        });
      }
    }

    const bookings = Array.from(byRes.values())
      .filter(b => b.checkout >= from && b.checkout <= to && b.total > 0);

    // Carregado uma vez para todo o lote: sem isso, cada reserva de cartão faria
    // uma consulta própria de faixas.
    const acquirerRules = await this.listAllAcquirerRules(hotelId);

    const result = await upsertTitles(
      hotelId,
      bookings.flatMap(b => buildTitles('erbon', b, findRule(rules, b.channel), acquirerRules)),
    );
    return { ...result, channels_without_rule: collectChannelsWithoutRule(bookings, rules) };
  },

  /**
   * Generates AR titles from internal_bookings (source='omnibees' and direct),
   * one per booking with checkout within [from, to]. Idempotent.
   */
  async generateFromBookings(hotelId: string, from: string, to: string): Promise<GenerateResult> {
    const rules = await this.listRules(hotelId);
    const { data, error } = await supabase
      .from('internal_bookings')
      .select('id, code, guest_name, checkin, checkout, total_rate, status, source, channel')
      .eq('hotel_id', hotelId)
      .gte('checkout', from)
      .lte('checkout', to);
    if (error) throw error;

    const bookings: { agg: BookingAgg; origin: ArOrigin }[] = (data ?? [])
      .filter((b: any) => b.status !== 'cancelled' && b.status !== 'canceled' && Number(b.total_rate) > 0)
      .map((b: any) => ({
        origin: (b.source === 'omnibees' ? 'omnibees' : 'manual') as ArOrigin,
        agg: {
          ref: `booking-${b.id}`,
          bookingRef: String(b.code || b.id),
          guestName: b.guest_name ?? null,
          channel: String(b.channel || (b.source === 'omnibees' ? 'Omnibees' : 'Direto')).trim() || 'Direto',
          checkin: b.checkin,
          checkout: b.checkout,
          total: Number(b.total_rate) || 0,
        },
      }));

    const acquirerRules = await this.listAllAcquirerRules(hotelId);

    const result = await upsertTitles(
      hotelId,
      bookings.flatMap(({ agg, origin }) =>
        buildTitles(origin, agg, findRule(rules, agg.channel), acquirerRules)),
    );
    return {
      ...result,
      channels_without_rule: collectChannelsWithoutRule(bookings.map(b => b.agg), rules),
    };
  },

  /** Distinct channels present in data — helps building rules. */
  async listKnownChannels(hotelId: string): Promise<string[]> {
    const channels = new Set<string>();
    const { data: last } = await supabase
      .from('erbon_hospedagem_daily')
      .select('snapshot_date')
      .eq('hotel_id', hotelId)
      .order('snapshot_date', { ascending: false })
      .limit(1);
    const snap = last?.[0]?.snapshot_date;
    if (snap) {
      const { data } = await supabase
        .from('erbon_hospedagem_daily')
        .select('payload')
        .eq('hotel_id', hotelId)
        .eq('snapshot_date', snap)
        .limit(1000);
      for (const row of data ?? []) {
        const r: any = (row as any).payload;
        const c = String(r?.agente || r?.canal || '').trim();
        if (c) channels.add(c);
      }
    }
    const { data: ib } = await supabase
      .from('internal_bookings')
      .select('channel, source')
      .eq('hotel_id', hotelId)
      .limit(1000);
    for (const b of ib ?? []) {
      const c = String((b as any).channel || ((b as any).source === 'omnibees' ? 'Omnibees' : '')).trim();
      if (c) channels.add(c);
    }
    channels.add('Direto');
    return Array.from(channels).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  },
};
