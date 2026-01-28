import { supabase } from './supabase';
import { DynamicReconciliationRow } from './dynamicReconciliationService';

// Nova interface para a estrutura de contagens por setor
export interface SectorCountPair {
  sector_id: string | null; // null para estoque principal
  start_count_id: string;
  end_count_id: string;
}

export interface SavedReconciliationReport {
  id: string;
  hotel_id: string;
  // Estas colunas agora são opcionais e serão usadas apenas para relatórios antigos
  start_count_id: string | null;
  end_count_id: string | null;
  status: 'draft' | 'finalized';
  created_at: string;
  updated_at: string;
  start_count?: { finished_at: string };
  end_count?: { finished_at: string };
  // Novo campo para as contagens por setor
  sector_counts?: {
    sector_id: string | null;
    start_count_id: string;
    end_count_id: string;
  }[];
}

export const reconciliationPersistenceService = {
  async listReports(hotelId: string) {
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
    return data as SavedReconciliationReport[];
  },

  /**
   * Salva ou atualiza um relatório de reconciliação.
   * @param hotelId ID do hotel.
   * @param sectorCountPairs Array de pares de contagens (inicial/final) por setor.
   * @param items Itens de consumo/venda a serem salvos.
   * @param reportId ID do relatório a ser atualizado (opcional).
   * @returns ID do relatório salvo.
   */
  async saveReport(hotelId: string, sectorCountPairs: SectorCountPair[], items: any[], reportId?: string) {
    // 1. Criar ou atualizar o cabeçalho
    const reportData = {
      hotel_id: hotelId,
      updated_at: new Date().toISOString(),
      status: 'draft' as const,
      // Para novos relatórios, as colunas antigas start_count_id e end_count_id serão nulas
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

    // 2. Salvar os pares de contagens por setor
    if (currentReportId) {
      const sectorCountsToSave = sectorCountPairs.map(pair => ({
        report_id: currentReportId,
        sector_id: pair.sector_id,
        start_count_id: pair.start_count_id,
        end_count_id: pair.end_count_id,
      }));

      // Primeiro, removemos as contagens antigas para evitar conflitos de chave primária
      // e garantir que apenas as contagens atuais sejam salvas.
      const { error: deleteError } = await supabase
        .from('reconciliation_report_sector_counts')
        .delete()
        .eq('report_id', currentReportId);
      
      if (deleteError) throw deleteError;

      // Em seguida, inserimos as novas contagens
      const { error: insertError } = await supabase
        .from('reconciliation_report_sector_counts')
        .insert(sectorCountsToSave);
      
      if (insertError) throw insertError;
    }

    // 3. Salvar os itens (vendas e consumo)
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
