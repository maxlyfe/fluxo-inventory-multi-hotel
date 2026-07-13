import { supabase } from './supabase';

export interface PayrollEntry {
  id?: string;
  hotel_id: string;
  employee_id: string;
  competence: string; // yyyy-mm-01
  base_salary: number;
  encargos: number;
  beneficios: number;
  descontos: number;
  total?: number; // generated column
  due_date: string;
  chart_account_sub_id?: string | null;
  status: 'previsto' | 'lancado';
  notes?: string | null;
  // joined
  employees?: { name: string } | null;
}

export const payrollService = {
  async listEmployees(hotelId: string): Promise<{ id: string; name: string }[]> {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name')
      .eq('hotel_id', hotelId)
      .order('name');
    if (error) throw error;
    return data ?? [];
  },

  async listMonth(hotelId: string, competence: string): Promise<PayrollEntry[]> {
    const { data, error } = await supabase
      .from('payroll_entries')
      .select('*, employees(name)')
      .eq('hotel_id', hotelId)
      .eq('competence', competence)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  },

  async save(entry: PayrollEntry): Promise<void> {
    const { employees: _e, total: _t, ...payload } = entry;
    if (entry.id) {
      const { id, ...patch } = payload as any;
      const { error } = await supabase
        .from('payroll_entries')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', entry.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('payroll_entries').insert(payload);
      if (error) throw error;
    }
  },

  async delete(id: string): Promise<void> {
    // remove the linked AP title too, if not yet paid
    await supabase.from('ap_titles')
      .delete().eq('origin', 'payroll').eq('origin_id', id).eq('amount_paid', 0);
    const { error } = await supabase.from('payroll_entries').delete().eq('id', id);
    if (error) throw error;
  },

  /** Copies previous month's entries into the given competence (skips existing). */
  async generateFromPreviousMonth(hotelId: string, competence: string): Promise<number> {
    const prev = new Date(competence + 'T12:00:00');
    prev.setMonth(prev.getMonth() - 1);
    const prevCompetence = prev.toISOString().slice(0, 8) + '01';

    const [prevEntries, currentEntries] = await Promise.all([
      this.listMonth(hotelId, prevCompetence),
      this.listMonth(hotelId, competence),
    ]);
    const existing = new Set(currentEntries.map(e => e.employee_id));
    const toInsert = prevEntries
      .filter(e => !existing.has(e.employee_id))
      .map(e => {
        const due = new Date(e.due_date + 'T12:00:00');
        due.setMonth(due.getMonth() + 1);
        return {
          hotel_id: hotelId,
          employee_id: e.employee_id,
          competence,
          base_salary: e.base_salary,
          encargos: e.encargos,
          beneficios: e.beneficios,
          descontos: e.descontos,
          due_date: due.toISOString().slice(0, 10),
          chart_account_sub_id: e.chart_account_sub_id ?? null,
          status: 'previsto' as const,
        };
      });
    if (!toInsert.length) return 0;
    const { error } = await supabase.from('payroll_entries').insert(toInsert);
    if (error) throw error;
    return toInsert.length;
  },

  /** Posts all 'previsto' entries of the month to accounts payable. */
  async postMonthToAp(hotelId: string, competence: string): Promise<number> {
    const entries = await this.listMonth(hotelId, competence);
    const pending = entries.filter(e => e.status === 'previsto' && (e.total ?? 0) > 0);
    if (!pending.length) return 0;

    const monthLabel = competence.slice(0, 7);
    const rows = pending.map(e => ({
      hotel_id: hotelId,
      description: `Folha ${monthLabel} — ${e.employees?.name ?? 'Funcionário'}`,
      chart_account_sub_id: e.chart_account_sub_id ?? null,
      origin: 'payroll' as const,
      origin_id: e.id!,
      installment_number: 1,
      installment_total: 1,
      amount: e.total ?? 0,
      issue_date: competence,
      due_date: e.due_date,
    }));
    const { error } = await supabase
      .from('ap_titles')
      .upsert(rows, { onConflict: 'origin,origin_id,installment_number', ignoreDuplicates: true });
    if (error) throw error;

    const { error: e2 } = await supabase
      .from('payroll_entries')
      .update({ status: 'lancado', updated_at: new Date().toISOString() })
      .in('id', pending.map(e => e.id!));
    if (e2) throw e2;
    return pending.length;
  },
};
