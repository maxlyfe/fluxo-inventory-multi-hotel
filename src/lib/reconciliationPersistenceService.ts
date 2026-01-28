import { supabase } from './supabase';

export interface SectorCountPair {
  sector_id: string | null;
  start_count_id: string;
  end_count_id: string;
}

export interface SavedReconciliationReport {
  id: string;
  hotel_id: string;
  start_count_id: string | null;
  end_count_id: string | null;
  status: 'draft' | 'finalized';
  created_at: string;
  updated_at: string;
  start_count?: { finished_at: string };
  end_count?: { finished_at: string };
  sector_counts?: {
    sector_id: string | null;
    start_count_id: string;
    end_count_id: string;
  }[];
}

export const reconciliationPersistenceService = {
  async listReports(hotelId: string): Promise<SavedReconciliationReport[]> {
    const { data, error } = await supabase
      .from('reconciliation_reports')
      .select(`
        *,
        start_count:stock_counts!start_count_id(finished_at),
        end_count:stock_counts!end_count_id(finished_at),
        sector_counts:reconciliation_report_sector_counts(sector_id, start_count_id, end_count_id)
      `)
      .eq('hotel_id', hotelId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return (data || []) as any[];
  },

  async saveReport(hotelId: string, sectorCountPairs: SectorCountPair[], items: any[], reportId?: string): Promise<string> {
    const reportData: any = {
      hotel_id: hotelId,
      updated_at: new Date().toISOString(),
      status: 'draft',
      start_count_id: null,
      end_count_id: null,
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

    if (!currentReportId) throw new Error('Falha ao obter ID do relatório');

    // Salvar pares de contagens
    const sectorCountsToSave = sectorCountPairs.map(pair => ({
      report_id: currentReportId,
      sector_id: pair.sector_id,
      start_count_id: pair.start_count_id,
      end_count_id: pair.end_count_id,
    }));

    await supabase
      .from('reconciliation_report_sector_counts')
      .delete()
      .eq('report_id', currentReportId);

    const { error: insertError } = await supabase
      .from('reconciliation_report_sector_counts')
      .insert(sectorCountsToSave);
    
    if (insertError) throw insertError;

    // Salvar itens
    if (items.length > 0) {
      const reportItems = items.map(item => ({
        report_id: currentReportId,
        product_id: item.productId,
        sector_id: item.sectorId,
        sales: item.sales || 0,
        consumption: item.consumption || 0
      }));
      
      const { error: itemsError } = await supabase
        .from('reconciliation_report_items')
        .upsert(reportItems, { onConflict: 'report_id,product_id,sector_id' });
      
      if (itemsError) throw itemsError;
    }
    
    return currentReportId;
  },

  async getSavedItems(reportId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('reconciliation_report_items')
      .select('*')
      .eq('report_id', reportId);
    if (error) throw error;
    return data || [];
  },

  async finalizeReport(reportId: string): Promise<void> {
    const { error } = await supabase
      .from('reconciliation_reports')
      .update({ status: 'finalized', updated_at: new Date().toISOString() })
      .eq('id', reportId);
    if (error) throw error;
  },

  async deleteReport(reportId: string): Promise<void> {
    const { error } = await supabase
      .from('reconciliation_reports')
      .delete()
      .eq('id', reportId);
    if (error) throw error;
  }
};
