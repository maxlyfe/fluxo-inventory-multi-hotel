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

export const dynamicReconciliationService = {
  generateReport: async (
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
      // Para setores, precisamos de conferências específicas do setor
      // Mas o usuário seleciona o período global. 
      // Se a conferência for global (sector_id is null), pegamos os itens dela.
      // Se for de setor, pegamos os itens dela.
      const sInitial = startItemsMap.get(p.id) || 0;
      const sReceived = sectorReceivedMap.get(s.id)?.get(p.id) || 0;
      const sActual = endItemsMap.get(p.id) || 0;
      
      sectorStocks[s.id] = {
        initialStock: sInitial,
        received: sReceived,
        calculatedFinalStock: sInitial + sReceived, // Vendas e Consumo serão editáveis no front
        actualFinalStock: sActual,
        loss: 0 // Calculado no front
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
  }
};
