// src/lib/expensesReportService.ts
// Serviço de dados para o relatório flexível de Despesas por Hóspede.
// Gerencia categorias, fornecedores e lançamentos mensais.

import { supabase } from './supabase';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface ExpenseCategory {
  id: string;
  name: string;
  color_hex: string;
  icon: string;
  sort_order: number;
  /** Preenchido ao carregar por hotel — indica se está oculta a partir de quando */
  hidden_from?: string | null;
}

export interface ExpenseSupplier {
  id: string;
  hotel_id: string;
  category_id: string;
  name: string;
  hidden_from: string | null;
  sort_order: number;
}

export interface SupplierEntry {
  id?: string;
  supplier_id: string;
  hotel_id: string;
  month_date: string;                  // 'YYYY-MM-01'
  first_fortnight_value: number;
  second_fortnight_value: number;
}

export interface GuestCount {
  month_date: string;
  first_fortnight_guests: number;
  second_fortnight_guests: number;
}

export interface MonthlyExpense {
  month_date: string;
  expense_category: string;
  first_fortnight_expense: number;
  second_fortnight_expense: number;
}

// ── Hóspedes (tabela legada mantida) ─────────────────────────────────────────

export async function getGuestsForRange(hotelId: string, startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('guest_counts')
    .select('*')
    .eq('hotel_id', hotelId)
    .gte('month_date', startDate)
    .lte('month_date', endDate)
    .order('month_date');
  return { data: data as GuestCount[] | null, error };
}

export async function saveGuestCount(
  hotelId: string,
  monthDate: string,
  firstFortnight: number,
  secondFortnight: number,
) {
  const { error } = await supabase
    .from('guest_counts')
    .upsert({
      hotel_id: hotelId,
      month_date: monthDate,
      first_fortnight_guests:  firstFortnight,
      second_fortnight_guests: secondFortnight,
    }, { onConflict: 'hotel_id,month_date' });
  return { error };
}

// ── Categorias ────────────────────────────────────────────────────────────────

/**
 * Retorna todas as categorias globais, enriquecidas com hidden_from do hotel.
 */
export async function getCategoriesForHotel(hotelId: string): Promise<{
  data: ExpenseCategory[] | null;
  error: any;
}> {
  const [catRes, hotelCatRes] = await Promise.all([
    supabase.from('expense_categories').select('*').order('sort_order'),
    supabase
      .from('hotel_expense_categories')
      .select('category_id, hidden_from')
      .eq('hotel_id', hotelId),
  ]);

  if (catRes.error)      return { data: null, error: catRes.error };
  if (hotelCatRes.error) return { data: null, error: hotelCatRes.error };

  const hotelMap = new Map(
    (hotelCatRes.data || []).map(h => [h.category_id, h.hidden_from])
  );

  const enriched: ExpenseCategory[] = (catRes.data || []).map(c => ({
    ...c,
    hidden_from: hotelMap.get(c.id) ?? null,
  }));

  return { data: enriched, error: null };
}

/** Cria nova categoria global */
export async function createCategory(name: string, colorHex: string, icon: string) {
  const { data, error } = await supabase
    .from('expense_categories')
    .insert({ name: name.trim(), color_hex: colorHex, icon })
    .select()
    .single();
  return { data, error };
}

/** Atualiza categoria global */
export async function updateCategory(
  id: string,
  updates: Partial<Pick<ExpenseCategory, 'name' | 'color_hex' | 'icon'>>,
) {
  const { error } = await supabase
    .from('expense_categories')
    .update(updates)
    .eq('id', id);
  return { error };
}

/** Oculta ou reativa uma categoria para um hotel específico */
export async function setHotelCategoryVisibility(
  hotelId: string,
  categoryId: string,
  hiddenFrom: string | null,   // 'YYYY-MM-01' ou null para reativar
) {
  if (hiddenFrom === null) {
    // Reativar: remover o registro ou setar null
    const { error } = await supabase
      .from('hotel_expense_categories')
      .upsert(
        { hotel_id: hotelId, category_id: categoryId, hidden_from: null },
        { onConflict: 'hotel_id,category_id' },
      );
    return { error };
  }
  const { error } = await supabase
    .from('hotel_expense_categories')
    .upsert(
      { hotel_id: hotelId, category_id: categoryId, hidden_from: hiddenFrom },
      { onConflict: 'hotel_id,category_id' },
    );
  return { error };
}

// ── Fornecedores ──────────────────────────────────────────────────────────────

export async function getSuppliersForHotel(hotelId: string): Promise<{
  data: ExpenseSupplier[] | null;
  error: any;
}> {
  const { data, error } = await supabase
    .from('expense_suppliers')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('sort_order')
    .order('name');
  return { data: data as ExpenseSupplier[] | null, error };
}

export async function createSupplier(
  hotelId: string,
  categoryId: string,
  name: string,
): Promise<{ data: ExpenseSupplier | null; error: any }> {
  const { data, error } = await supabase
    .from('expense_suppliers')
    .insert({ hotel_id: hotelId, category_id: categoryId, name: name.trim() })
    .select()
    .single();
  return { data: data as ExpenseSupplier | null, error };
}

export async function updateSupplier(
  id: string,
  updates: Partial<Pick<ExpenseSupplier, 'name' | 'hidden_from'>>,
) {
  const { error } = await supabase
    .from('expense_suppliers')
    .update(updates)
    .eq('id', id);
  return { error };
}

export async function deleteSupplier(id: string) {
  const { error } = await supabase
    .from('expense_suppliers')
    .delete()
    .eq('id', id);
  return { error };
}

// ── Lançamentos ───────────────────────────────────────────────────────────────

export async function getEntriesForRange(
  hotelId: string,
  startDate: string,
  endDate: string,
): Promise<{ data: SupplierEntry[] | null; error: any }> {
  const { data, error } = await supabase
    .from('expense_supplier_entries')
    .select('*')
    .eq('hotel_id', hotelId)
    .gte('month_date', startDate)
    .lte('month_date', endDate)
    .order('month_date');
  return { data: data as SupplierEntry[] | null, error };
}

export async function upsertEntry(entry: SupplierEntry): Promise<{ error: any }> {
  const { error } = await supabase
    .from('expense_supplier_entries')
    .upsert(
      {
        supplier_id:              entry.supplier_id,
        hotel_id:                 entry.hotel_id,
        month_date:               entry.month_date,
        first_fortnight_value:    entry.first_fortnight_value,
        second_fortnight_value:   entry.second_fortnight_value,
      },
      { onConflict: 'supplier_id,month_date' },
    );
  return { error };
}

export async function upsertEntriesBatch(entries: SupplierEntry[]): Promise<{ error: any }> {
  if (entries.length === 0) return { error: null };
  const { error } = await supabase
    .from('expense_supplier_entries')
    .upsert(entries, { onConflict: 'supplier_id,month_date' });
  return { error };
}

// ── Dados legados (compatibilidade retroativa) ────────────────────────────────
// Mantém compatibilidade com a tabela antiga enquanto a migração é feita

export async function getExpensesAndGuestsForYear(hotelId: string, yearDate: Date) {
  const year = yearDate.getFullYear();
  const startDate = `${year}-01-01`;
  const endDate   = `${year}-12-01`;

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
      .lte('month_date', endDate),
  ]);

  return {
    guestData:   guestRes.data   as GuestCount[]      | null,
    expenseData: expenseRes.data as MonthlyExpense[]   | null,
    error:       guestRes.error  || expenseRes.error   || null,
  };
}

export async function saveMonthlyData(
  hotelId: string,
  monthDate: string,
  guests: { first_fortnight_guests: number; second_fortnight_guests: number },
  expenses: { expense_category: string; first_fortnight_expense: number; second_fortnight_expense: number }[],
) {
  const [guestRes] = await Promise.all([
    supabase.from('guest_counts').upsert(
      { hotel_id: hotelId, month_date: monthDate, ...guests },
      { onConflict: 'hotel_id,month_date' },
    ),
  ]);

  for (const exp of expenses) {
    await supabase.from('monthly_expenses').upsert(
      { hotel_id: hotelId, month_date: monthDate, ...exp },
      { onConflict: 'hotel_id,month_date,expense_category' },
    );
  }

  return { error: guestRes.error };
}