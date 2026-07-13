import { supabase } from './supabase';
import { PaymentMethod } from './apService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArOrigin = 'erbon' | 'omnibees' | 'manual' | 'inflow';
export type ArStatus = 'previsto' | 'parcial' | 'recebido' | 'cancelado';
export type TriggerEvent = 'checkout' | 'checkin' | 'faturamento';

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
  expected_date: string;
  status: ArStatus;
  acquirer_id: string | null;
  card_brand: string | null;
  installments: number | null;
  installment_number: number;
  notes: string | null;
  created_at: string;
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
  card_brand: string;
  modality: 'debito' | 'credito';
  installment_from: number;
  installment_to: number;
  fee_percent: number;
  settlement_days: number;
}

export interface ArFilters {
  status?: ArStatus | 'atrasado';
  origin?: ArOrigin;
  channel?: string;
  from?: string;
  to?: string;
  search?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function addDays(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface BookingAgg {
  ref: string;
  channel: string;
  checkin: string;
  checkout: string;
  total: number;
}

function findRule(rules: ChannelReceivingRule[], channel: string): ChannelReceivingRule | undefined {
  const c = channel.trim().toLowerCase();
  return (
    rules.find(r => r.active && r.channel.trim().toLowerCase() === c) ??
    rules.find(r => r.active && r.channel.trim().toLowerCase() === 'direto')
  );
}

function buildTitle(hotelId: string, origin: ArOrigin, b: BookingAgg, rule: ChannelReceivingRule | undefined) {
  const feePercent = rule?.default_fee_percent ?? 0;
  const fee = Math.round(b.total * feePercent) / 100;
  const eventDate = rule?.trigger_event === 'checkin' ? b.checkin : b.checkout;
  const expected = rule ? addDays(eventDate, rule.days_to_receive) : b.checkout;
  return {
    hotel_id: hotelId,
    description: `Reserva ${b.ref} — ${b.channel}`,
    origin,
    origin_ref: b.ref,
    channel: b.channel,
    gross_amount: Math.round(b.total * 100) / 100,
    fee_amount: fee,
    net_amount: Math.round((b.total - fee) * 100) / 100,
    expected_date: expected,
    acquirer_id: rule?.acquirer_id ?? null,
    installment_number: 1,
  };
}

/** Idempotent upsert: never touches titles that already had receipts. */
async function upsertTitles(rows: ReturnType<typeof buildTitle>[]): Promise<number> {
  if (!rows.length) return 0;
  let count = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('ar_titles')
      .upsert(chunk, { onConflict: 'origin,origin_ref,installment_number', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    count += data?.length ?? 0;
  }
  return count;
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
    if (filters.from) q = q.gte('expected_date', filters.from);
    if (filters.to) q = q.lte('expected_date', filters.to);
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

  async createManual(input: Omit<ArTitle, 'id' | 'amount_received' | 'status' | 'created_at'>): Promise<void> {
    const { error } = await supabase.from('ar_titles').insert(input);
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

  async saveRule(rule: ChannelReceivingRule): Promise<void> {
    if (rule.id) {
      const { id, ...patch } = rule;
      const { error } = await supabase
        .from('channel_receiving_rules')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('channel_receiving_rules').insert(rule);
      if (error) throw error;
    }
  },

  async deleteRule(id: string): Promise<void> {
    const { error } = await supabase.from('channel_receiving_rules').delete().eq('id', id);
    if (error) throw error;
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

  async saveAcquirerRule(rule: CardAcquirerRule): Promise<void> {
    if (rule.id) {
      const { id, ...patch } = rule;
      const { error } = await supabase.from('card_acquirer_rules').update(patch).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('card_acquirer_rules').insert(rule);
      if (error) throw error;
    }
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
  async generateFromErbon(hotelId: string, from: string, to: string): Promise<number> {
    const rules = await this.listRules(hotelId);

    // Latest snapshot
    const { data: last, error: e1 } = await supabase
      .from('erbon_hospedagem_daily')
      .select('snapshot_date')
      .eq('hotel_id', hotelId)
      .order('snapshot_date', { ascending: false })
      .limit(1);
    if (e1) throw e1;
    const snap = last?.[0]?.snapshot_date;
    if (!snap) return 0;

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
          channel: String(r.agente || r.canal || 'Direto').trim() || 'Direto',
          checkin: String(r.datA_ENTRADA ?? '').split('T')[0],
          checkout: String(r.datA_SAIDA ?? '').split('T')[0],
          total: Number(r.diaria) || 0,
        });
      }
    }

    const rows = Array.from(byRes.values())
      .filter(b => b.checkout >= from && b.checkout <= to && b.total > 0)
      .map(b => buildTitle(hotelId, 'erbon', b, findRule(rules, b.channel)));

    return upsertTitles(rows);
  },

  /**
   * Generates AR titles from internal_bookings (source='omnibees' and direct),
   * one per booking with checkout within [from, to]. Idempotent.
   */
  async generateFromBookings(hotelId: string, from: string, to: string): Promise<number> {
    const rules = await this.listRules(hotelId);
    const { data, error } = await supabase
      .from('internal_bookings')
      .select('id, checkin, checkout, total_rate, status, source, channel')
      .eq('hotel_id', hotelId)
      .gte('checkout', from)
      .lte('checkout', to);
    if (error) throw error;

    const rows = (data ?? [])
      .filter((b: any) => b.status !== 'cancelled' && b.status !== 'canceled' && Number(b.total_rate) > 0)
      .map((b: any) => {
        const agg: BookingAgg = {
          ref: `booking-${b.id}`,
          channel: String(b.channel || (b.source === 'omnibees' ? 'Omnibees' : 'Direto')).trim() || 'Direto',
          checkin: b.checkin,
          checkout: b.checkout,
          total: Number(b.total_rate) || 0,
        };
        return buildTitle(hotelId, b.source === 'omnibees' ? 'omnibees' : 'manual', agg, findRule(rules, agg.channel));
      });

    return upsertTitles(rows);
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
