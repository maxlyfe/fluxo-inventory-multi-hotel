import { supabase } from './supabase';
import { DynamicReconciliationRow } from './dynamicReconciliationService';

export interface SavedReconciliationReport {
  id: string;
  hotel_id: string;
  start_count_id: string;
  end_count_id: string;
  status: 'draft' | 'finalized';
  created_at: string;
  updated_at: string;
  start_count?: { finished_at: string };
  end_count?: { finished_at: string };
}

export const reconciliationPersistenceService = {
  async listReports(hotelId: string) {
    const { data, error } = await supabase
      .from('reconciliation_reports')
      .select(`
        *,
        start_count:stock_counts!start_count_id(finished_at),
        end_count:stock_counts!end_count_id(finished_at)
      `)
      .eq('hotel_id', hotelId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as SavedReconciliationReport[];
  },

  async saveReport(hotelId: string, startCountId: string, endCountId: string, items: any[], reportId?: string) {
    // 1. Criar ou atualizar o cabeçalho
    const reportData = {
      hotel_id: hotelId,
      start_count_id: startCountId,
      end_count_id: endCountId,
      updated_at: new Date().toISOString(),
      status: 'draft' as const
    };

    let currentReportId = reportId;

    if (currentReportId) {
      const { error } = await supabase
        .from('reconciliation_reports')
        .update(reportData)
        .eq('id', currentReportId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from('reconciliation_reports')
        .insert(reportData)
        .select()
        .single();
      if (error) throw error;
      currentReportId = data.id;
    }

    // 2. Salvar os itens (vendas e consumo)
    if (items.length > 0 && currentReportId) {
      const reportItems = items.map(item => ({
        report_id: currentReportId,
        product_id: item.productId,
        sector_id: item.sectorId,
        sales: item.sales || 0,
        consumption: item.consumption || 0
      }));

      const { error } = await supabase
        .from('reconciliation_report_items')
        .upsert(reportItems, { onConflict: 'report_id,product_id,sector_id' });
      
      if (error) throw error;
    }

    return currentReportId;
  },

  async getSavedItems(reportId: string) {
    const { data, error } = await supabase
      .from('reconciliation_report_items')
      .select('*')
      .eq('report_id', reportId);

    if (error) throw error;
    return data;
  },

  async finalizeReport(reportId: string) {
    const { error } = await supabase
      .from('reconciliation_reports')
      .update({ status: 'finalized', updated_at: new Date().toISOString() })
      .eq('id', reportId);
    
    if (error) throw error;
  },

  async deleteReport(reportId: string) {
    const { error } = await supabase
      .from('reconciliation_reports')
      .delete()
      .eq('id', reportId);
    
    if (error) throw error;
  }
};
