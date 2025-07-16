import { supabase } from './supabase';
import { format, parseISO } from 'date-fns';

// --- Tipos de Dados ---
export interface LaundryItem { id: string; name: string; display_order: number; price: number; }
export interface DailyGuestCount { date: string; guest_count: number; }
export interface DailyUhCount { date: string; uh_count: number; }
export interface LaundryEntry { item_id: string; entry_date: string; quantity: number; }
export interface LaundryReport { id: string; report_name: string; start_date: string; end_date: string; }
export interface FortnightDefinition { id?: string; hotel_id: string; month_date: string; fortnight_1_start: string; fortnight_1_end: string; fortnight_2_start: string; fortnight_2_end: string; }
export interface FullReportData {
  items: LaundryItem[];
  guestCounts: DailyGuestCount[];
  uhCounts: DailyUhCount[];
  laundryEntries: LaundryEntry[];
  definition: FortnightDefinition | null;
}

// --- Funções de Serviço ---

export const getExistingReports = async (hotelId: string) => {
  const { data, error } = await supabase.from('laundry_reports').select('id, report_name, start_date, end_date').eq('hotel_id', hotelId).order('start_date', { ascending: false });
  return { data, error };
}

export const createLaundryReport = async (hotelId: string, name: string, startDate: string, endDate: string) => {
    const { data, error } = await supabase.from('laundry_reports').insert({ hotel_id: hotelId, report_name: name, start_date: startDate, end_date: endDate }).select().single();
    return { data, error };
}

// --- CORREÇÃO: Função adicionada ---
export const deleteLaundryReport = async (reportId: string) => {
    const { error } = await supabase.from('laundry_reports').delete().eq('id', reportId);
    return { error };
}

export const getReportDetails = async (reportId: string, hotelId: string, startDate: string): Promise<{ data: FullReportData | null, error: any }> => {
    const [itemsRes, guestsRes, uhsRes, entriesRes, defRes] = await Promise.all([
      supabase.rpc('get_laundry_items_with_prices', { p_hotel_id: hotelId, p_reference_date: startDate }),
      supabase.from('daily_guest_counts').select('date, guest_count').eq('report_id', reportId),
      supabase.from('daily_uh_counts').select('date, uh_count').eq('report_id', reportId),
      supabase.from('laundry_entries').select('item_id, entry_date, quantity').eq('report_id', reportId),
      supabase.from('fortnight_definitions').select('*').eq('hotel_id', hotelId).eq('month_date', format(parseISO(startDate), 'yyyy-MM-01')).maybeSingle()
    ]);
    const anyError = itemsRes.error || guestsRes.error || uhsRes.error || entriesRes.error || defRes.error;
    if(anyError) return { data: null, error: anyError };

    return { data: { items: itemsRes.data || [], guestCounts: guestsRes.data || [], uhCounts: uhsRes.data || [], laundryEntries: entriesRes.data || [], definition: defRes.data || null }, error: null };
}

export const saveLaundryReportData = async ( reportId: string, guestCounts: { date: string, guest_count: number }[], uhCounts: { date: string, uh_count: number }[], laundryEntries: { item_id: string, entry_date: string, quantity: number }[] ) => {
    const guestUpserts = guestCounts.map(gc => ({ report_id: reportId, date: gc.date, guest_count: gc.guest_count }));
    const uhUpserts = uhCounts.map(uc => ({ report_id: reportId, date: uc.date, uh_count: uc.uh_count }));
    const laundryUpserts = laundryEntries.map(le => ({ report_id: reportId, item_id: le.item_id, entry_date: le.entry_date, quantity: le.quantity }));
    
    if (guestUpserts.length > 0) await supabase.from('daily_guest_counts').upsert(guestUpserts, { onConflict: 'report_id, date' });
    if (uhUpserts.length > 0) await supabase.from('daily_uh_counts').upsert(uhUpserts, { onConflict: 'report_id, date' });
    if (laundryUpserts.length > 0) await supabase.from('laundry_entries').upsert(laundryUpserts, { onConflict: 'report_id, item_id, entry_date' });
    
    return { error: null };
}

export const saveItemPrice = async (itemId: string, newPrice: number, effectiveDate: string) => {
    const { error } = await supabase.from('laundry_item_prices').upsert({ item_id: itemId, price: newPrice, effective_date: effectiveDate }, { onConflict: 'item_id, effective_date' });
    return { error };
}

export const saveFortnightDefinition = async (definition: Omit<FortnightDefinition, 'id'>) => {
    const { error } = await supabase.from('fortnight_definitions').upsert({ ...definition, updated_at: new Date().toISOString() }, { onConflict: 'hotel_id, month_date'});
    return { error };
}