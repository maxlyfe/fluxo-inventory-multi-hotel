import { supabase } from './supabase';

export interface RecurringExpense {
  id?: string;
  hotel_id: string;
  description: string;
  amount: number;
  frequency: 'semanal' | 'quinzenal' | 'mensal' | 'anual';
  due_day: number;
  supplier_id?: string | null;
  chart_account_sub_id?: string | null;
  start_date: string;
  end_date?: string | null;
  active: boolean;
  // joined
  suppliers?: { nome: string | null; nome_fantasia: string | null; razao_social: string | null } | null;
  chart_of_accounts_sub?: { name: string } | null;
}

/** Occurrence dates of a template within [from, to]. */
export function occurrencesBetween(t: RecurringExpense, from: string, to: string): string[] {
  const out: string[] = [];
  const start = t.start_date > from ? t.start_date : from;
  const end = t.end_date && t.end_date < to ? t.end_date : to;
  if (start > end) return out;

  if (t.frequency === 'semanal' || t.frequency === 'quinzenal') {
    const step = t.frequency === 'semanal' ? 7 : 15;
    const d = new Date(t.start_date + 'T12:00:00');
    while (d.toISOString().slice(0, 10) < start) d.setDate(d.getDate() + step);
    while (d.toISOString().slice(0, 10) <= end) {
      out.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + step);
    }
    return out;
  }

  // mensal / anual: due_day of each period
  const cursor = new Date(start.slice(0, 7) + '-01T12:00:00');
  const endDate = new Date(end + 'T12:00:00');
  const stepMonths = t.frequency === 'anual' ? 12 : 1;
  const startMonth = t.start_date.slice(0, 7);
  while (cursor <= endDate) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    if (t.frequency !== 'anual' || cursor.toISOString().slice(5, 7) === startMonth.slice(5, 7)) {
      const lastDay = new Date(y, m + 1, 0).getDate();
      const day = Math.min(t.due_day, lastDay);
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (iso >= start && iso <= end) out.push(iso);
    }
    cursor.setMonth(cursor.getMonth() + (t.frequency === 'anual' ? stepMonths : 1));
  }
  return out;
}

/** Stable index of an occurrence since start_date (idempotency key). */
function occurrenceIndex(t: RecurringExpense, dateISO: string): number {
  const start = new Date(t.start_date + 'T12:00:00');
  const d = new Date(dateISO + 'T12:00:00');
  if (t.frequency === 'semanal') return Math.round((+d - +start) / (7 * 864e5)) + 1;
  if (t.frequency === 'quinzenal') return Math.round((+d - +start) / (15 * 864e5)) + 1;
  const months = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
  return (t.frequency === 'anual' ? Math.round(months / 12) : months) + 1;
}

export const recurringService = {
  async list(hotelId: string): Promise<RecurringExpense[]> {
    const { data, error } = await supabase
      .from('recurring_expenses')
      .select('*, suppliers(nome, nome_fantasia, razao_social), chart_of_accounts_sub(name)')
      .eq('hotel_id', hotelId)
      .order('description');
    if (error) throw error;
    return data ?? [];
  },

  async save(t: RecurringExpense): Promise<void> {
    const { suppliers: _s, chart_of_accounts_sub: _c, ...payload } = t;
    if (t.id) {
      const { id, ...patch } = payload as any;
      const { error } = await supabase
        .from('recurring_expenses')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', t.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('recurring_expenses').insert(payload);
      if (error) throw error;
    }
  },

  async delete(id: string): Promise<void> {
    await supabase.from('ap_titles')
      .delete().eq('origin', 'recurring').eq('origin_id', id).eq('amount_paid', 0)
      .in('status', ['aberto']);
    const { error } = await supabase.from('recurring_expenses').delete().eq('id', id);
    if (error) throw error;
  },

  /** Materializes AP titles for all active templates within [from, to]. Idempotent. */
  async generateApTitles(hotelId: string, from: string, to: string): Promise<number> {
    const templates = (await this.list(hotelId)).filter(t => t.active);
    const rows: any[] = [];
    for (const t of templates) {
      for (const date of occurrencesBetween(t, from, to)) {
        rows.push({
          hotel_id: hotelId,
          description: t.description,
          supplier_id: t.supplier_id ?? null,
          chart_account_sub_id: t.chart_account_sub_id ?? null,
          origin: 'recurring',
          origin_id: t.id!,
          installment_number: occurrenceIndex(t, date),
          installment_total: 1,
          amount: t.amount,
          due_date: date,
        });
      }
    }
    if (!rows.length) return 0;
    const { data, error } = await supabase
      .from('ap_titles')
      .upsert(rows, { onConflict: 'origin,origin_id,installment_number', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  },
};
