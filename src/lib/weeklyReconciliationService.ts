// Importa o cliente Supabase e funções de manipulação de datas da biblioteca 'date-fns'.
import { supabase } from './supabase';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// --- INTERFACES DE DADOS PARA O RELATÓRIO ---

// Representa a linha principal de dados para um único produto no relatório.
export interface ReconciliationReportRow {
  productId: string;
  productName: string;
  isStarred: boolean;
  imageUrl?: string;
  category: string; // --- NOVO: Adicionado campo para a categoria do produto. ---
  mainStock: MainStockData;
  sectorStocks: Record<string, SectorStockData>;
}

// Dados específicos do inventário principal (Almoxarifado).
export interface MainStockData {
  initialStock: number;
  purchases: number;
  deliveredToSectors: number;
  calculatedFinalStock: number;
  currentActualStock: number;
  loss: number;
}

// Dados específicos do estoque de um setor.
export interface SectorStockData {
  sectorId: string;
  sectorName: string;
  initialStock: number;
  receivedFromMain: number;
  consumption: number; // Consumo registrado na semana.
  sales: number; // Vendas registradas na semana (atualmente 0, mas preparado para o futuro).
  calculatedFinalStock: number; // Estoque final calculado (inicial + recebidos - consumo - vendas).
}

// Interface para os dados completos do relatório.
export interface ReportData {
  weekStartDate: Date;
  weekEndDate: Date;
  sectors: { id: string; name: string }[];
  reportRows: ReconciliationReportRow[];
}


/**
 * Função de base reutilizável para gerar relatórios de reconciliação.
 * @param hotelId O ID do hotel.
 * @param weekStartDate A data de início da semana.
 * @param onlyStarred Se true, busca apenas produtos favoritados.
 * @returns Um objeto com os dados consolidados do relatório.
 */
const generateReconciliationReportBase = async (hotelId: string, weekStartDate: Date, onlyStarred: boolean): Promise<{ success: boolean, data?: ReportData, error?: string }> => {
  // Define o intervalo da semana (início e fim).
  const weekEndDate = endOfWeek(weekStartDate, { locale: ptBR, weekStartsOn: 1 });
  const startDateStr = format(weekStartDate, 'yyyy-MM-dd');
  const endDateStr = format(weekEndDate, 'yyyy-MM-dd HH:mm:ss');

  try {
    // 1. Monta a query de produtos dinamicamente.
    let productsQuery = supabase.from('products')
      // --- ALTERAÇÃO: Adicionado 'category' ao SELECT. ---
      .select('id, name, quantity, is_starred, image_url, category')
      .eq('hotel_id', hotelId)
      .eq('is_active', true)
      // --- ALTERAÇÃO: Adicionada ordenação por categoria e depois por nome. ---
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (onlyStarred) {
      // Se 'onlyStarred' for true, adiciona o filtro.
      productsQuery = productsQuery.eq('is_starred', true);
    }

    // 2. Buscar todas as entidades necessárias em paralelo.
    const [productsRes, sectorsRes, consumptionRes] = await Promise.all([
      productsQuery,
      supabase.from('sectors').select('id, name').eq('hotel_id', hotelId),
      // A query de consumo agora faz um JOIN implícito com a tabela 'sectors'
      // para filtrar pelo 'hotel_id' do setor.
      supabase.from('item_consumption')
        .select('item_name, quantity, sector_id, sectors!inner(hotel_id)')
        .eq('sectors.hotel_id', hotelId)
        .gte('consumed_at', startDateStr)
        .lte('consumed_at', endDateStr)
    ]);

    if (productsRes.error) throw productsRes.error;
    if (sectorsRes.error) throw sectorsRes.error;
    if (consumptionRes.error) throw consumptionRes.error;

    const allProducts = productsRes.data || [];
    const allSectors = sectorsRes.data || [];
    const allConsumption = consumptionRes.data || [];

    // Se não houver produtos, retorna uma estrutura de dados vazia.
    if (allProducts.length === 0) {
      return { success: true, data: { weekStartDate, weekEndDate, sectors: allSectors, reportRows: [] } };
    }
    
    // Mapeia nome do produto para ID para otimizar a busca de consumo.
    const productNameToIdMap = new Map(allProducts.map(p => [p.name, p.id]));

    // 3. Buscar as demais movimentações da semana.
    const [purchasesRes, requisitionsRes, sectorBalancesRes] = await Promise.all([
      supabase.from('purchase_items').select('product_id, quantity, purchases!inner(purchase_date)').eq('purchases.hotel_id', hotelId).gte('purchases.purchase_date', startDateStr).lte('purchases.purchase_date', endDateStr),
      supabase.from('requisitions').select('product_id, substituted_product_id, delivered_quantity, sector_id').eq('hotel_id', hotelId).eq('status', 'delivered').gte('updated_at', startDateStr).lte('updated_at', endDateStr),
      supabase.rpc('get_last_sector_balances', { p_hotel_id: hotelId, p_balance_date: startDateStr })
    ]);

    if (purchasesRes.error) throw purchasesRes.error;
    if (requisitionsRes.error) throw requisitionsRes.error;
    if (sectorBalancesRes.error) throw sectorBalancesRes.error;

    // 4. Organizar os dados buscados em mapas para acesso rápido.
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

    // Agrega o consumo por setor e produto.
    const consumptionBySectorAndProduct = allConsumption.reduce((acc, item) => {
      const productId = productNameToIdMap.get(item.item_name);
      if (productId && item.sector_id) {
        if (!acc[item.sector_id]) acc[item.sector_id] = {};
        acc[item.sector_id][productId] = (acc[item.sector_id][productId] || 0) + item.quantity;
      }
      return acc;
    }, {} as Record<string, Record<string, number>>);

    // 5. Montar a estrutura de dados final para cada produto.
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
        const consumption = consumptionBySectorAndProduct[sector.id]?.[product.id] || 0;
        const sales = 0; // Placeholder para futuras implementações de vendas.
        const calculatedSectorFinalStock = initialSectorStock + receivedFromMain - consumption - sales;

        sectorStocks[sector.id] = {
          sectorId: sector.id,
          sectorName: sector.name,
          initialStock: initialSectorStock,
          receivedFromMain,
          consumption,
          sales,
          calculatedFinalStock: calculatedSectorFinalStock,
        };
      });

      return {
        productId: product.id,
        productName: product.name,
        isStarred: product.is_starred || false,
        imageUrl: product.image_url,
        // --- ALTERAÇÃO: Adiciona a categoria ao objeto de retorno. ---
        category: product.category || 'Sem Categoria',
        mainStock,
        sectorStocks,
      };
    });

    return {
      success: true,
      data: { weekStartDate, weekEndDate, sectors: allSectors, reportRows },
    };

  } catch (err: any) {
    console.error(`Erro ao gerar relatório (onlyStarred: ${onlyStarred}):`, err);
    return { success: false, error: err.message };
  }
};

/**
 * Função pública para gerar o relatório de reconciliação COMPLETO.
 */
export const generateWeeklyReconciliationReport = (hotelId: string, weekStartDate: Date) => {
  return generateReconciliationReportBase(hotelId, weekStartDate, false);
};

/**
 * Função pública para gerar o relatório de reconciliação APENAS DOS ITENS FAVORITADOS.
 */
export const generateStarredItemsReconciliationReport = (hotelId: string, weekStartDate: Date) => {
  return generateReconciliationReportBase(hotelId, weekStartDate, true);
};
