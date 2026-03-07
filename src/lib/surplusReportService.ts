import { supabase } from './supabase';

// --- Types ---
export interface SurplusReport {
  id: string;
  hotel_id: string;
  report_date: string;
  logged_by: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface SurplusReportItem {
  id: string;
  report_id: string;
  qty_out: string;
  description: string;
  qty_return: string;
  destination: string;
  sort_order: number;
}

export interface SurplusReportWithItems extends SurplusReport {
  items: SurplusReportItem[];
}

// --- Service Functions ---

export const getSurplusReports = async (hotelId: string) => {
  const { data, error } = await supabase
    .from('surplus_reports')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('report_date', { ascending: false });
  return { data: data as SurplusReport[] | null, error };
};

export const getSurplusReportsByMonth = async (hotelId: string, year: number, month: number) => {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const { data, error } = await supabase
    .from('surplus_reports')
    .select('*')
    .eq('hotel_id', hotelId)
    .gte('report_date', startDate)
    .lt('report_date', endDate)
    .order('report_date', { ascending: false });
  return { data: data as SurplusReport[] | null, error };
};

export const getSurplusReportWithItems = async (reportId: string) => {
  const [reportRes, itemsRes] = await Promise.all([
    supabase.from('surplus_reports').select('*').eq('id', reportId).single(),
    supabase.from('surplus_report_items').select('*').eq('report_id', reportId).order('sort_order', { ascending: true }),
  ]);

  if (reportRes.error) return { data: null, error: reportRes.error };
  if (itemsRes.error) return { data: null, error: itemsRes.error };

  return {
    data: { ...reportRes.data, items: itemsRes.data || [] } as SurplusReportWithItems,
    error: null,
  };
};

export const createSurplusReport = async (
  hotelId: string,
  reportDate: string,
  loggedBy: string,
  userId: string
) => {
  const { data, error } = await supabase
    .from('surplus_reports')
    .insert({
      hotel_id: hotelId,
      report_date: reportDate,
      logged_by: loggedBy,
      created_by: userId,
    })
    .select()
    .single();
  return { data: data as SurplusReport | null, error };
};

export const updateSurplusReport = async (
  reportId: string,
  updates: { logged_by?: string; updated_at?: string }
) => {
  const { data, error } = await supabase
    .from('surplus_reports')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', reportId)
    .select()
    .single();
  return { data: data as SurplusReport | null, error };
};

export const deleteSurplusReport = async (reportId: string) => {
  const { error } = await supabase
    .from('surplus_reports')
    .delete()
    .eq('id', reportId);
  return { error };
};

export const saveSurplusReportItems = async (
  reportId: string,
  items: Omit<SurplusReportItem, 'id' | 'report_id' | 'created_at'>[]
) => {
  // Delete existing items and re-insert
  const { error: deleteError } = await supabase
    .from('surplus_report_items')
    .delete()
    .eq('report_id', reportId);

  if (deleteError) return { error: deleteError };

  if (items.length === 0) return { error: null };

  const rows = items.map((item, idx) => ({
    report_id: reportId,
    qty_out: item.qty_out,
    description: item.description,
    qty_return: item.qty_return,
    destination: item.destination,
    sort_order: idx,
  }));

  const { error } = await supabase
    .from('surplus_report_items')
    .insert(rows);
  return { error };
};

export const getDistinctDestinations = async (hotelId: string): Promise<{ data: string[] | null; error: any }> => {
  const { data, error } = await supabase
    .from('surplus_report_items')
    .select('destination, surplus_reports!inner(hotel_id)')
    .eq('surplus_reports.hotel_id', hotelId)
    .neq('destination', '');

  if (error) return { data: null, error };

  const unique = [...new Set((data || []).map((r: any) => r.destination as string))].filter(Boolean).sort();
  return { data: unique, error: null };
};

export const getAvailableMonths = async (hotelId: string) => {
  const { data, error } = await supabase
    .from('surplus_reports')
    .select('report_date')
    .eq('hotel_id', hotelId)
    .order('report_date', { ascending: false });

  if (error) return { data: null, error };

  // Extract unique year-month combinations
  const months = new Set<string>();
  (data || []).forEach((r: { report_date: string }) => {
    months.add(r.report_date.substring(0, 7)); // "YYYY-MM"
  });

  return { data: Array.from(months).sort().reverse(), error: null };
};
