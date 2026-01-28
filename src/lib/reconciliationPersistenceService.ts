import { supabase } from './supabase';

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

export interface SectorCountSelection {
  sector_id: string | null;
  start_count_id: string;
  end_count_id: string;
}

export const dynamicReconciliationService = {
  generateReport: async (
    hotelId: string,
    selections: SectorCountSelection[]
  ): Promise<DynamicReconciliationData> => {
    if (selections.length === 0) throw new Error('Selecione pelo menos um setor para o relatório.');

    const allCountIds = selections.flatMap(s => [s.start_count_id, s.end_count_id]);
    
    const { data: counts, error: countsError } = await supabase
      .from('stock_counts')
      .select('id, finished_at, sector_id, items:stock_count_items(product_id, counted_quantity)')
      .in('id', allCountIds);

    if (countsError) throw countsError;
    if (!counts || counts.length === 0) throw new Error('Nenhuma conferência encontrada.');

    const allDates = counts.map(c => new Date(c.finished_at).getTime());
    const startDate = new Date(Math.min(...allDates)).toISOString();
    const endDate = new Date(Math.max(...allDates)).toISOString();

    const [productsRes, sectorsRes] = await Promise.all([
      supabase.from('products').select('id, name, category, is_starred').eq('hotel_id', hotelId).eq('is_active', true),
      supabase.from('sectors').select('id, name').eq('hotel_id', hotelId)
    ]);

    if (productsRes.error) throw productsRes.error;
    if (sectorsRes.error) throw sectorsRes.error;

    const products = productsRes.data || [];
    const sectors = sectorsRes.data || [];

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

    const countItemsMap = new Map<string, Map<string, number>>();
    counts.forEach((count: any) => {
      const itemMap = new Map<string, number>();
      (count.items || []).forEach((item: any) => {
        itemMap.set(item.product_id, item.counted_quantity);
      });
      countItemsMap.set(count.id, itemMap);
    });

    const purchasesMap = new Map<string, number>();
    (purchasesRes.data || []).forEach((p: any) => {
      purchasesMap.set(p.product_id, (purchasesMap.get(p.product_id) || 0) + p.quantity);
    });

    const deliveriesMap = new Map<string, number>();
    const sectorReceivedMap = new Map<string, Map<string, number>>();
    (requisitionsRes.data || []).forEach((r: any) => {
      const pId = r.substituted_product_id || r.product_id;
      if (!pId) return;
      deliveriesMap.set(pId, (deliveriesMap.get(pId) || 0) + (r.delivered_quantity || 0));
      
      if (r.sector_id) {
        if (!sectorReceivedMap.has(r.sector_id)) sectorReceivedMap.set(r.sector_id, new Map());
        const sMap = sectorReceivedMap.get(r.sector_id)!;
        sMap.set(pId, (sMap.get(pId) || 0) + (r.delivered_quantity || 0));
      }
    });

    const rows: DynamicReconciliationRow[] = products.map(p => {
      const mainSelection = selections.find(s => s.sector_id === null);
      let mainData = {
        initialStock: 0,
        purchases: purchasesMap.get(p.id) || 0,
        deliveredToSectors: deliveriesMap.get(p.id) || 0,
        calculatedFinalStock: 0,
        actualFinalStock: 0,
        loss: 0
      };

      if (mainSelection) {
        mainData.initialStock = countItemsMap.get(mainSelection.start_count_id)?.get(p.id) || 0;
        mainData.actualFinalStock = countItemsMap.get(mainSelection.end_count_id)?.get(p.id) || 0;
        mainData.calculatedFinalStock = mainData.initialStock + mainData.purchases - mainData.deliveredToSectors;
        mainData.loss = mainData.actualFinalStock - mainData.calculatedFinalStock;
      }

      const sectorStocks: Record<string, any> = {};
      sectors.forEach(s => {
        const sectorSelection = selections.find(sel => sel.sector_id === s.id);
        if (sectorSelection) {
          const sInitial = countItemsMap.get(sectorSelection.start_count_id)?.get(p.id) || 0;
          const sReceived = sectorReceivedMap.get(s.id)?.get(p.id) || 0;
          const sActual = countItemsMap.get(sectorSelection.end_count_id)?.get(p.id) || 0;
          
          sectorStocks[s.id] = {
            initialStock: sInitial,
            received: sReceived,
            calculatedFinalStock: sInitial + sReceived,
            actualFinalStock: sActual,
            loss: 0
          };
        }
      });

      return {
        productId: p.id,
        productName: p.name,
        category: p.category || 'Sem Categoria',
        isStarred: !!p.is_starred,
        mainStock: mainData,
        sectorStocks
      };
    });

    const activeSectors = sectors.filter(s => selections.some(sel => sel.sector_id === s.id));
    return { sectors: activeSectors, rows };
  }
};
