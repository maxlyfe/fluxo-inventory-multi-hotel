import { supabase } from './supabase';
// --- CORREÇÃO: Funções que faltavam foram adicionadas aqui ---
import { startOfYear, endOfYear, format } from 'date-fns';

export interface GuestCount {
  id?: string;
  hotel_id: string;
  month_date: string; // YYYY-MM-DD
  first_fortnight_guests: number;
  second_fortnight_guests: number;
}

export interface MonthlyExpense {
  id?: string;
  hotel_id: string;
  month_date: string; // YYYY-MM-DD
  expense_category: 'HORTIFRUTI' | 'LAVANDERIA' | 'PADARIA';
  first_fortnight_expense: number;
  second_fortnight_expense: number;
}

// Busca todos os dados do ano para um hotel específico
export const getExpensesAndGuestsForYear = async (hotelId: string, year: Date) => {
  const startDate = format(startOfYear(year), 'yyyy-MM-dd');
  const endDate = format(endOfYear(year), 'yyyy-MM-dd');

  const [guestRes, expenseRes] = await Promise.all([
    supabase
      .from('guest_counts')
      .select('*')
      .eq('hotel_id', hotelId)
      .gte('month_date', startDate)
      .lte('month_date', endDate),
    supabase
      .from('monthly_expenses')
      .select('*')
      .eq('hotel_id', hotelId)
      .gte('month_date', startDate)
      .lte('month_date', endDate)
  ]);

  return {
    guestData: guestRes.data,
    expenseData: expenseRes.data,
    error: guestRes.error || expenseRes.error,
  };
};

// Salva (cria ou atualiza) os dados de um mês inteiro
export const saveMonthlyData = async (
  hotelId: string,
  monthDate: string, // YYYY-MM-01
  guestData: { first_fortnight_guests: number; second_fortnight_guests: number },
  expensesData: { expense_category: string; first_fortnight_expense: number; second_fortnight_expense: number }[]
) => {
  // Salva ou atualiza a contagem de hóspedes
  const { error: guestError } = await supabase
    .from('guest_counts')
    .upsert(
      {
        hotel_id: hotelId,
        month_date: monthDate,
        first_fortnight_guests: guestData.first_fortnight_guests,
        second_fortnight_guests: guestData.second_fortnight_guests,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hotel_id, month_date' }
    );

  if (guestError) return { error: guestError };

  // Prepara os dados de despesas para o upsert
  const expensesToUpsert = expensesData.map(exp => ({
    hotel_id: hotelId,
    month_date: monthDate,
    expense_category: exp.expense_category,
    first_fortnight_expense: exp.first_fortnight_expense,
    second_fortnight_expense: exp.second_fortnight_expense,
    updated_at: new Date().toISOString(),
  }));

  // Salva ou atualiza todas as categorias de despesa
  const { error: expenseError } = await supabase
    .from('monthly_expenses')
    .upsert(expensesToUpsert, { onConflict: 'hotel_id, month_date, expense_category' });
  
  return { error: expenseError };
};