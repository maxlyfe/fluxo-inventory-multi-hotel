import { supabase } from './supabase';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// --- INTERFACES DE DADOS PARA O RELATÓRIO ---

// Representa a linha principal de dados para um único produto no relatório
export interface ReconciliationReportRow {
  productId: string;
  productName: string;
  isStarred: boolean; // --- NOVO: Adicionado para saber se o item é favorito ---
  mainStock: MainStockData;
  sectorStocks: Record<string, SectorStockData>; // Chave é o ID do setor
}

// Dados específicos do inventário principal (Almoxarifado)
export interface MainStockData {
  initialStock: number;
  purchases: number;
  deliveredToSectors: number;
  calculatedFinalStock: number;
  currentActualStock: number;
  loss: number;
}

// Dados específicos do estoque de um setor
export interface SectorStockData {
  sectorId: string;
  sectorName: string;
  initialStock: number;
  receivedFromMain: number;
  currentStock: number;
  sales: number;
  consumption: number;
  calculatedConsumption?: number;
  loss: number;
}

/**
 * Função principal que gera todos os dados para o Relatório de Reconciliação Semanal.
 * @param hotelId O ID do hotel para o qual o relatório será gerado.
 * @param weekStartDate A data de início da semana do relatório.
 * @returns Um objeto contendo os dados consolidados do relatório.
 */
export const generateWeeklyReconciliationReport = async (hotelId: string, weekStartDate: Date) => {
  // Define o intervalo da semana (início e fim)
  const weekEndDate = endOfWeek(weekStartDate, { locale: ptBR, weekStartsOn: 1 });
  const startDateStr = format(weekStartDate, 'yyyy-MM-dd');
  const endDateStr = format(weekEndDate, 'yyyy-MM-dd HH:mm:ss');

  try {
    // 1. Buscar todas as entidades necessárias em paralelo para otimização
    const [productsRes, sectorsRes] = await Promise.all([
      // --- ALTERAÇÃO: Adicionado 'is_starred' à consulta de produtos ---
      supabase.from('products').select('id, name, quantity, is_starred').eq('hotel_id', hotelId),
      supabase.from('sectors').select('id, name').eq('hotel_id', hotelId)
    ]);

    if (productsRes.error) throw productsRes.error;
    if (sectorsRes.error) throw sectorsRes.error;

    const allProducts = productsRes.data || [];
    const allSectors = sectorsRes.data || [];

    // 2. Buscar todas as movimentações da semana
    const [purchasesRes, requisitionsRes, sectorBalancesRes] = await Promise.all([
      // Compras da semana
      supabase.from('purchase_items')
        .select('product_id, quantity, purchases!inner(purchase_date)')
        .eq('purchases.hotel_id', hotelId)
        .gte('purchases.purchase_date', startDateStr)
        .lte('purchases.purchase_date', endDateStr),
      // Requisições entregues na semana
      supabase.from('requisitions')
        .select('product_id, substituted_product_id, delivered_quantity, sector_id')
        .eq('hotel_id', hotelId)
        .eq('status', 'delivered')
        .gte('updated_at', startDateStr)
        .lte('updated_at', endDateStr),
      // Últimos balanços de setor feitos ANTES do início da semana atual
      supabase.rpc('get_last_sector_balances', {
        p_hotel_id: hotelId,
        p_balance_date: startDateStr
      })
    ]);

    if (purchasesRes.error) throw purchasesRes.error;
    if (requisitionsRes.error) throw requisitionsRes.error;
    if (sectorBalancesRes.error) throw sectorBalancesRes.error;

    // 3. Organizar os dados buscados em mapas para acesso rápido
    const purchasesByProduct = (purchasesRes.data || []).reduce((acc, item) => {
      if (item.product_id) acc[item.product_id] = (acc[item.product_id] || 0) + item.quantity;
      return acc;
    }, {} as Record<string, number>);

    const requisitionsByProduct = (requisitionsRes.data || []).reduce((acc, item) => {
      const productId = item.substituted_product_id || item.product_id;
      if (productId) acc[productId] = (acc[productId] || 0) + (item.delivered_quantity || 0);
      return acc;
    }, {} as Record<string, number>);
    
    const requisitionsBySectorAndProduct = (requisitionsRes.data || []).reduce((acc, item) => {
        const productId = item.substituted_product_id || item.product_id;
        if (productId && item.sector_id) {
            if (!acc[item.sector_id]) acc[item.sector_id] = {};
            acc[item.sector_id][productId] = (acc[item.sector_id][productId] || 0) + (item.delivered_quantity || 0);
        }
        return acc;
    }, {} as Record<string, Record<string, number>>);

    const lastSectorBalances = (sectorBalancesRes.data || []).reduce((acc, item) => {
        if (!acc[item.sector_id]) acc[item.sector_id] = {};
        acc[item.sector_id][item.product_id] = item.current_quantity;
        return acc;
    }, {} as Record<string, Record<string, number>>);

    // 4. Montar a estrutura de dados final para cada produto
    const reportRows: ReconciliationReportRow[] = allProducts.map(product => {
      const purchases = purchasesByProduct[product.id] || 0;
      const deliveredToSectors = requisitionsByProduct[product.id] || 0;
      const initialStock = product.quantity - purchases + deliveredToSectors;
      const calculatedFinalStock = initialStock + purchases - deliveredToSectors;
      const loss = calculatedFinalStock - product.quantity;

      const mainStock: MainStockData = {
        initialStock: Math.max(0, initialStock),
        purchases, deliveredToSectors, calculatedFinalStock,
        currentActualStock: product.quantity, loss,
      };

      const sectorStocks: Record<string, SectorStockData> = {};
      allSectors.forEach(sector => {
        const initialSectorStock = lastSectorBalances[sector.id]?.[product.id] || 0;
        const receivedFromMain = requisitionsBySectorAndProduct[sector.id]?.[product.id] || 0;
        const currentStock = initialSectorStock + receivedFromMain; 
        sectorStocks[sector.id] = {
          sectorId: sector.id, sectorName: sector.name, initialStock: initialSectorStock,
          receivedFromMain, currentStock, sales: 0, consumption: 0, loss: 0,
        };
      });

      return {
        productId: product.id,
        productName: product.name,
        isStarred: product.is_starred || false, // --- NOVO: Adiciona o status de favorito ---
        mainStock,
        sectorStocks,
      };
    });

    return {
      success: true,
      data: {
        weekStartDate,
        weekEndDate,
        sectors: allSectors,
        reportRows,
      },
    };

  } catch (err: any) {
    console.error("Erro ao gerar relatório de reconciliação:", err);
    return { success: false, error: err.message };
  }
};
