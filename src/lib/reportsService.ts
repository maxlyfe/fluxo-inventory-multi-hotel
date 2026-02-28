import { supabase } from './supabase';

/**
 * Interface para os dados consolidados de um item principal (favoritado).
 */
export interface StarredItemReportData {
  id: string;
  name: string;
  category: string;
  image_url?: string;
  quantity: number; // Estoque atual
  min_quantity: number;
  average_price: number; // Preço médio para cálculo de valor
  total_value: number; // Valor total em estoque (quantity * average_price)
  last_purchase_date?: string;
  last_purchase_price?: number;
}

/**
 * Busca e consolida os dados para o relatório de itens principais (favoritados).
 * @param hotelId O ID do hotel para o qual o relatório será gerado.
 * @returns Uma promessa que resolve para um objeto com o resultado da operação.
 */
export const getStarredItemsReport = async (hotelId: string): Promise<{ data: StarredItemReportData[] | null; error: Error | null; }> => {
  try {
    // Busca todos os produtos marcados como 'is_starred = true' para o hotel selecionado.
    const { data, error } = await supabase
      .from('products')
      .select(`
        id,
        name,
        category,
        image_url,
        quantity,
        min_quantity,
        average_price,
        last_purchase_date,
        last_purchase_price
      `)
      .eq('hotel_id', hotelId)
      .eq('is_starred', true)
      .order('name');

    if (error) {
      // Se houver um erro na consulta, lança o erro para ser capturado pelo bloco catch.
      throw error;
    }

    // Mapeia os dados brutos do banco para o formato do relatório,
    // calculando o valor total em estoque para cada item.
    const reportData: StarredItemReportData[] = (data || []).map(product => {
      const average_price = product.average_price || 0;
      const quantity = product.quantity || 0;
      return {
        ...product,
        average_price,
        quantity,
        total_value: quantity * average_price,
      };
    });

    return { data: reportData, error: null };

  } catch (err: any) {
    // Captura qualquer erro ocorrido durante o processo e o retorna.
    console.error("Erro ao gerar relatório de itens principais:", err);
    return { data: null, error: new Error(err.message || 'Erro desconhecido no servidor.') };
  }
};
