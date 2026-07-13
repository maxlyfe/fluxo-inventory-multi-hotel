import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApOrigin = 'purchase' | 'manual' | 'payroll' | 'recurring' | 'loan';
export type ApStatus = 'aberto' | 'parcial' | 'pago' | 'cancelado';
export type PaymentMethod = 'pix' | 'boleto' | 'transferencia' | 'cartao' | 'dinheiro' | 'cheque';

export interface ApTitle {
  id: string;
  hotel_id: string;
  description: string;
  supplier_id: string | null;
  chart_account_sub_id: string | null;
  origin: ApOrigin;
  origin_id: string | null;
  installment_number: number;
  installment_total: number;
  amount: number;
  amount_paid: number;
  issue_date: string | null;
  due_date: string;
  status: ApStatus;
  notes: string | null;
  created_at: string;
  // joined
  suppliers?: { nome: string | null; nome_fantasia: string | null; razao_social: string | null } | null;
  chart_of_accounts_sub?: { name: string; chart_of_accounts: { name: string } | null } | null;
}

export interface ApPayment {
  id?: string;
  ap_title_id: string;
  hotel_id: string;
  payment_date: string;
  amount: number;
  payment_method: PaymentMethod;
  bank_account_id?: string | null;
  notes?: string | null;
}

export interface BankAccount {
  id?: string;
  hotel_id: string;
  name: string;
  bank_name?: string | null;
  account_type: 'corrente' | 'poupanca' | 'caixa';
  initial_balance: number;
  active: boolean;
}

export interface ApFilters {
  status?: ApStatus | 'vencido';
  origin?: ApOrigin;
  supplierId?: string;
  chartAccountSubId?: string;
  from?: string; // due_date >=
  to?: string;   // due_date <=
  search?: string;
}

export interface NewManualTitle {
  hotel_id: string;
  description: string;
  supplier_id?: string | null;
  chart_account_sub_id?: string | null;
  amount: number;
  issue_date?: string | null;
  first_due_date: string;
  installments: number;
  notes?: string | null;
}

const TITLE_SELECT =
  '*, suppliers(nome, nome_fantasia, razao_social), chart_of_accounts_sub(name, chart_of_accounts(name))';

export function supplierDisplay(t: ApTitle): string {
  const s = t.suppliers;
  if (!s) return '—';
  return s.nome_fantasia || s.razao_social || s.nome || '—';
}

export function addMonths(dateISO: string, months: number): string {
  const d = new Date(dateISO + 'T12:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Divide amount into n installments, last one absorbs rounding. */
export function splitInstallments(amount: number, n: number): number[] {
  const each = Math.round((amount / n) * 100) / 100;
  const arr = Array(n).fill(each);
  arr[n - 1] = Math.round((amount - each * (n - 1)) * 100) / 100;
  return arr;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const apService = {
  async list(hotelId: string, filters: ApFilters = {}): Promise<ApTitle[]> {
    let q = supabase
      .from('ap_titles')
      .select(TITLE_SELECT)
      .eq('hotel_id', hotelId)
      .order('due_date', { ascending: true });

    if (filters.origin) q = q.eq('origin', filters.origin);
    if (filters.supplierId) q = q.eq('supplier_id', filters.supplierId);
    if (filters.chartAccountSubId) q = q.eq('chart_account_sub_id', filters.chartAccountSubId);
    if (filters.from) q = q.gte('due_date', filters.from);
    if (filters.to) q = q.lte('due_date', filters.to);
    if (filters.status === 'vencido') {
      q = q.in('status', ['aberto', 'parcial']).lt('due_date', new Date().toISOString().slice(0, 10));
    } else if (filters.status) {
      q = q.eq('status', filters.status);
    }

    const { data, error } = await q;
    if (error) throw error;
    let rows = (data ?? []) as ApTitle[];
    if (filters.search) {
      const s = filters.search.toLowerCase();
      rows = rows.filter(t =>
        t.description.toLowerCase().includes(s) || supplierDisplay(t).toLowerCase().includes(s));
    }
    return rows;
  },

  async createManual(input: NewManualTitle): Promise<void> {
    const amounts = splitInstallments(input.amount, input.installments);
    const originId = crypto.randomUUID(); // groups the installments
    const rows = amounts.map((amount, i) => ({
      hotel_id: input.hotel_id,
      description: input.description,
      supplier_id: input.supplier_id ?? null,
      chart_account_sub_id: input.chart_account_sub_id ?? null,
      origin: 'manual' as const,
      origin_id: input.installments > 1 ? originId : null,
      installment_number: i + 1,
      installment_total: input.installments,
      amount,
      issue_date: input.issue_date ?? null,
      due_date: addMonths(input.first_due_date, i),
      notes: input.notes ?? null,
    }));
    const { error } = await supabase.from('ap_titles').insert(rows);
    if (error) throw error;
  },

  async update(id: string, patch: Partial<ApTitle>): Promise<void> {
    const { error } = await supabase
      .from('ap_titles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async cancel(id: string): Promise<void> {
    return this.update(id, { status: 'cancelado' } as Partial<ApTitle>);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('ap_titles').delete().eq('id', id);
    if (error) throw error;
  },

  async registerPayment(payment: ApPayment): Promise<void> {
    const { error } = await supabase.from('ap_payments').insert(payment);
    if (error) throw error;
  },

  async listPayments(apTitleId: string) {
    const { data, error } = await supabase
      .from('ap_payments')
      .select('*, bank_accounts(name)')
      .eq('ap_title_id', apTitleId)
      .order('payment_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async deletePayment(id: string): Promise<void> {
    const { error } = await supabase.from('ap_payments').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Bank accounts ──
  async listBankAccounts(hotelId: string): Promise<BankAccount[]> {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('name');
    if (error) throw error;
    return data ?? [];
  },

  async saveBankAccount(acc: BankAccount): Promise<void> {
    if (acc.id) {
      const { id, ...patch } = acc;
      const { error } = await supabase
        .from('bank_accounts')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('bank_accounts').insert(acc);
      if (error) throw error;
    }
  },

  async deleteBankAccount(id: string): Promise<void> {
    const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
    if (error) throw error;
  },
};
