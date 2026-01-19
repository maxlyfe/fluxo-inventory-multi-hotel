import { supabase } from './supabase';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { generateWeeklyReport, WeeklyReportData } from './weeklyReportService';

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

// --- INTERFACES DE DADOS PARA O RELATÓRIO DE ITENS FAVORITADOS (ADAPTADAS) ---

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

// --- FUNÇÕES PARA O RELATÓRIO DE ITENS FAVORITADOS (ATUALIZADAS PARA USAR A NOVA LÓGICA) ---

export const generateStarredItemsReconciliationReport = async (hotelId: string, weekStartDate: Date): Promise<{ success: boolean, data?: ReportData, error?: string }> => {
  try {
    // 1. Gerar o relatório semanal usando a nova lógica robusta
    const result = await generateWeeklyReport(hotelId, weekStartDate);
    
    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Erro ao gerar relatório base.' };
    }

    const weeklyData: WeeklyReportData = result.data;
    const weekEndDate = endOfWeek(weekStartDate, { locale: ptBR, weekStartsOn: 1 });

    // 2. Buscar informações adicionais dos produtos (is_starred, image_url, category)
    const { data: productsInfo, error: productsError } = await supabase
      .from('products')
      .select('id, is_starred, image_url, category')
      .eq('hotel_id', hotelId)
      .eq('is_starred', true);

    if (productsError) throw productsError;

    const starredProductsMap = new Map(productsInfo.map(p => [p.id, p]));

    // 3. Buscar todos os setores para garantir que o modal tenha a lista completa
    const { data: sectors, error: sectorsError } = await supabase
      .from('sectors')
      .select('id, name')
      .eq('hotel_id', hotelId);

    if (sectorsError) throw sectorsError;

    // 4. Filtrar apenas os itens favoritados e mapear para o formato esperado pelo modal
    const reportRows: ReconciliationReportRow[] = weeklyData.items
      .filter(item => item.product_id && starredProductsMap.has(item.product_id))
      .map(item => {
        const info = starredProductsMap.get(item.product_id!)!;
        
        // Mapear movimentos de setor
        const sectorStocks: Record<string, SectorStockData> = {};
        sectors.forEach(s => {
          const movement = item.sector_movements.find(sm => sm.sector_name === s.name);
          sectorStocks[s.id] = {
            sectorId: s.id,
            sectorName: s.name,
            initialStock: 0, // A nova lógica foca em movimentos, o estoque inicial por setor é complexo
            receivedFromMain: movement?.quantity_moved || 0,
            consumption: 0,
            sales: 0,
            calculatedFinalStock: movement?.quantity_moved || 0
          };
        });

        return {
          productId: item.product_id!,
          productName: item.product_name,
          isStarred: true,
          imageUrl: info.image_url,
          category: info.category || 'Sem Categoria',
          mainStock: {
            initialStock: item.initial_stock,
            purchases: item.purchases_in_week,
            deliveredToSectors: item.sector_movements.reduce((sum, sm) => sum + sm.quantity_moved, 0),
            calculatedFinalStock: item.final_stock + item.losses_in_week + item.sales_in_week,
            currentActualStock: item.final_stock,
            loss: item.losses_in_week
          },
          sectorStocks
        };
      });

    return {
      success: true,
      data: {
        weekStartDate,
        weekEndDate,
        sectors: sectors || [],
        reportRows
      }
    };

  } catch (err: any) {
    console.error('Erro ao gerar relatório de itens principais:', err);
    return { success: false, error: err.message };
  }
};

// Mantendo para compatibilidade se necessário
export const generateWeeklyReconciliationReport = async (hotelId: string, weekStartDate: Date) => {
  return generateStarredItemsReconciliationReport(hotelId, weekStartDate);
};
