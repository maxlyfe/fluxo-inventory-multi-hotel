import { supabase } from './supabase';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// --- INTERFACES DE DADOS PARA O RELATÓRIO DINÂMICO ---

export interface DynamicReconciliationRow {
  productId: string;
  productName: string;
  category: string;
  isStarred: boolean;
  mainStock: {
    initialStock: number;
    purchases: number;
    deliveredToSectors: number;
    calculatedFinalStock: number;
    actualFinalStock: number;
    loss: number;
  };
  sectorStocks: Record<string, {
    initialStock: number;
    received: number;
    calculatedFinalStock: number;
    actualFinalStock: number;
    loss: number;
  }>;
}

export interface DynamicReconciliationData {
  sectors: { id: string; name: string }[];
  rows: DynamicReconciliationRow[];
}

// --- INTERFACES DE DADOS PARA O RELATÓRIO DE ITENS FAVORITADOS ---

export interface ReconciliationReportRow {
  productId: string;
  productName: string;
  isStarred: boolean;
  imageUrl?: string;
  category: string;
  mainStock: MainStockData;
  sectorStocks: Record<string, SectorStockData>;
}

export interface MainStockData {
  initialStock: number;
  purchases: number;
  deliveredToSectors: number;
  calculatedFinalStock: number;
  currentActualStock: number;
  loss: number;
}

export interface SectorStockData {
  sectorId: string;
  sectorName: string;
  initialStock: number;
  receivedFromMain: number;
  consumption: number;
  sales: number;
  calculatedFinalStock: number;
}

export interface ReportData {
  weekStartDate: Date;
  weekEndDate: Date;
  sectors: { id: string; name: string }[];
  reportRows: ReconciliationReportRow[];
}

// --- FUNÇÕES PARA O RELATÓRIO DINÂMICO ---

export const getHotelStockCounts = async (hotelId: string, sectorId?: string) => {
  let query = supabase
    .from('stock_counts')
    .select('id, finished_at, notes')
    .eq('hotel_id', hotelId)
    .order('finished_at', { ascending: false });

  if (sectorId) {
    query = query.eq('sector_id', sectorId);
  } else {
    query = query.is('sector_id', null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const generateDynamicReconciliation = async (
  hotelId: string,
  startCountId: string,
  endCountId: string
): Promise<DynamicReconciliationData> => {
  // 1. Buscar as duas conferências
  const { data: counts, error: countsError } = await supabase
    .from('stock_counts')
    .select(`
      id, finished_at, sector_id,
      items:stock_count_items(product_id, counted_quantity)
    `)
    .in('id', [startCountId, endCountId]);

  if (countsError) throw countsError;
  if (counts.length < 2) throw new Error('Selecione duas conferências válidas.');

  const startCount = counts.find(c => c.id === startCountId)!;
  const endCount = counts.find(c => c.id === endCountId)!;

  const startDate = startCount.finished_at;
  const endDate = endCount.finished_at;

  // 2. Buscar todos os produtos e setores
  const [productsRes, sectorsRes] = await Promise.all([
    supabase.from('products').select('id, name, category, is_starred').eq('hotel_id', hotelId).eq('is_active', true),
    supabase.from('sectors').select('id, name').eq('hotel_id', hotelId)
  ]);

  if (productsRes.error) throw productsRes.error;
  if (sectorsRes.error) throw sectorsRes.error;

  const products = productsRes.data;
  const sectors = sectorsRes.data;

  // 3. Buscar movimentações no período
  const [purchasesRes, requisitionsRes] = await Promise.all([
    supabase.from('purchase_items')
      .select('product_id, quantity, purchases!inner(purchase_date)')
      .eq('purchases.hotel_id', hotelId)
      .gte('purchases.purchase_date', startDate)
      .lte('purchases.purchase_date', endDate),
    supabase.from('requisitions')
      .select('product_id, substituted_product_id, delivered_quantity, sector_id, updated_at')
      .eq('hotel_id', hotelId)
      .eq('status', 'delivered')
      .gte('updated_at', startDate)
      .lte('updated_at', endDate)
  ]);

  if (purchasesRes.error) throw purchasesRes.error;
  if (requisitionsRes.error) throw requisitionsRes.error;

  // 4. Processar mapas de dados
  const startItemsMap = new Map(startCount.items.map((i: any) => [i.product_id, i.counted_quantity]));
  const endItemsMap = new Map(endCount.items.map((i: any) => [i.product_id, i.counted_quantity]));

  const purchasesMap = new Map<string, number>();
  purchasesRes.data.forEach(p => {
    purchasesMap.set(p.product_id, (purchasesMap.get(p.product_id) || 0) + p.quantity);
  });

  const deliveriesMap = new Map<string, number>();
  const sectorReceivedMap = new Map<string, Map<string, number>>();

  requisitionsRes.data.forEach(r => {
    const pId = r.substituted_product_id || r.product_id;
    if (!pId) return;
    deliveriesMap.set(pId, (deliveriesMap.get(pId) || 0) + (r.delivered_quantity || 0));
    
    if (r.sector_id) {
      if (!sectorReceivedMap.has(r.sector_id)) sectorReceivedMap.set(r.sector_id, new Map());
      const sMap = sectorReceivedMap.get(r.sector_id)!;
      sMap.set(pId, (sMap.get(pId) || 0) + (r.delivered_quantity || 0));
    }
  });

  // 5. Montar as linhas do relatório
  const rows: DynamicReconciliationRow[] = products.map(p => {
    const initialStock = startItemsMap.get(p.id) || 0;
    const purchases = purchasesMap.get(p.id) || 0;
    const delivered = deliveriesMap.get(p.id) || 0;
    const actualFinal = endItemsMap.get(p.id) || 0;
    const calculatedFinal = initialStock + purchases - delivered;

    const sectorStocks: Record<string, any> = {};
    sectors.forEach(s => {
      const sInitial = startItemsMap.get(p.id) || 0;
      const sReceived = sectorReceivedMap.get(s.id)?.get(p.id) || 0;
      const sActual = endItemsMap.get(p.id) || 0;
      
      sectorStocks[s.id] = {
        initialStock: sInitial,
        received: sReceived,
        calculatedFinalStock: sInitial + sReceived,
        actualFinalStock: sActual,
        loss: 0
      };
    });

    return {
      productId: p.id,
      productName: p.name,
      category: p.category || 'Sem Categoria',
      isStarred: !!p.is_starred,
      mainStock: {
        initialStock,
        purchases,
        deliveredToSectors: delivered,
        calculatedFinalStock: calculatedFinal,
        actualFinalStock: actualFinal,
        loss: actualFinal - calculatedFinal
      },
      sectorStocks
    };
  });

  return { sectors, rows };
};

// --- FUNÇÕES PARA O RELATÓRIO DE ITENS FAVORITADOS (RESTAURADAS) ---

const generateReconciliationReportBase = async (hotelId: string, weekStartDate: Date, onlyStarred: boolean): Promise<{ success: boolean, data?: ReportData, error?: string }> => {
  const weekEndDate = endOfWeek(weekStartDate, { locale: ptBR, weekStartsOn: 1 });
  const startDateStr = format(weekStartDate, 'yyyy-MM-dd');
  const endDateStr = format(weekEndDate, 'yyyy-MM-dd HH:mm:ss');

  try {
    let productsQuery = supabase.from('products')
      .select('id, name, quantity, is_starred, image_url, category')
      .eq('hotel_id', hotelId)
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (onlyStarred) {
      productsQuery = productsQuery.eq('is_starred', true);
    }

    const [productsRes, sectorsRes, consumptionRes] = await Promise.all([
      productsQuery,
      supabase.from('sectors').select('id, name').eq('hotel_id', hotelId),
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

    if (allProducts.length === 0) {
      return { success: true, data: { weekStartDate, weekEndDate, sectors: allSectors, reportRows: [] } };
    }
    
    const productNameToIdMap = new Map(allProducts.map(p => [p.name, p.id]));

    const [purchasesRes, requisitionsRes, sectorBalancesRes] = await Promise.all([
      supabase.from('purchase_items').select('product_id, quantity, purchases!inner(purchase_date)').eq('purchases.hotel_id', hotelId).gte('purchases.purchase_date', startDateStr).lte('purchases.purchase_date', endDateStr),
      supabase.from('requisitions').select('product_id, substituted_product_id, delivered_quantity, sector_id').eq('hotel_id', hotelId).eq('status', 'delivered').gte('updated_at', startDateStr).lte('updated_at', endDateStr),
      supabase.rpc('get_last_sector_balances', { p_hotel_id: hotelId, p_balance_date: startDateStr })
    ]);

    if (purchasesRes.error) throw purchasesRes.error;
    if (requisitionsRes.error) throw requisitionsRes.error;
    if (sectorBalancesRes.error) throw sectorBalancesRes.error;

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

    const consumptionBySectorAndProduct = allConsumption.reduce((acc, item) => {
      const productId = productNameToIdMap.get(item.item_name);
      if (productId && item.sector_id) {
        if (!acc[item.sector_id]) acc[item.sector_id] = {};
        acc[item.sector_id][productId] = (acc[item.sector_id][productId] || 0) + item.quantity;
      }
      return acc;
    }, {} as Record<string, Record<string, number>>);

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
        const sales = 0;
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

export const generateWeeklyReconciliationReport = (hotelId: string, weekStartDate: Date) => {
  return generateReconciliationReportBase(hotelId, weekStartDate, false);
};

export const generateStarredItemsReconciliationReport = (hotelId: string, weekStartDate: Date) => {
  return generateReconciliationReportBase(hotelId, weekStartDate, true);
};
