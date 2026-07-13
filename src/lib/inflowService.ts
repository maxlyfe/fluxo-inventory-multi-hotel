import { supabase } from './supabase';
import { addMonths, splitInstallments, PaymentMethod } from './apService';

export type InflowType = 'ingresso_externo' | 'aporte' | 'emprestimo' | 'outros';

export interface MoneyInflow {
  id?: string;
  hotel_id: string;
  type: InflowType;
  description: string;
  amount: number;
  inflow_date: string;
  payment_method?: PaymentMethod | null;
  bank_account_id?: string | null;
  // loan repayment
  repayment_installments?: number | null;
  first_due_date?: string | null;
  installment_amount?: number | null;
  interest_percent?: number | null;
  notes?: string | null;
  created_at?: string;
}

export const INFLOW_TYPE_LABELS: Record<InflowType, string> = {
  ingresso_externo: 'Ingresso externo',
  aporte: 'Aporte / Investimento',
  emprestimo: 'Empréstimo',
  outros: 'Outros',
};

export const inflowService = {
  async list(hotelId: string): Promise<MoneyInflow[]> {
    const { data, error } = await supabase
      .from('money_inflows')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('inflow_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Creates the inflow; if it is a loan with repayment data, the repayment
   * installments are auto-created in accounts payable (origin='loan').
   */
  async create(inflow: MoneyInflow): Promise<void> {
    const { data, error } = await supabase
      .from('money_inflows')
      .insert(inflow)
      .select()
      .single();
    if (error) throw error;

    if (inflow.type === 'emprestimo' && inflow.repayment_installments && inflow.first_due_date) {
      const n = inflow.repayment_installments;
      const perInstallment = inflow.installment_amount && inflow.installment_amount > 0
        ? Array(n).fill(inflow.installment_amount)
        : splitInstallments(inflow.amount, n);
      const rows = perInstallment.map((amount: number, i: number) => ({
        hotel_id: inflow.hotel_id,
        description: `Empréstimo — ${inflow.description}`,
        origin: 'loan' as const,
        origin_id: data.id,
        installment_number: i + 1,
        installment_total: n,
        amount,
        issue_date: inflow.inflow_date,
        due_date: addMonths(inflow.first_due_date!, i),
      }));
      const { error: e2 } = await supabase.from('ap_titles').insert(rows);
      if (e2) throw e2;
    }
  },

  async delete(id: string): Promise<void> {
    await supabase.from('ap_titles')
      .delete().eq('origin', 'loan').eq('origin_id', id).eq('amount_paid', 0);
    const { error } = await supabase.from('money_inflows').delete().eq('id', id);
    if (error) throw error;
  },
};
