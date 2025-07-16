// Funções para o relatório semanal de inventário - VERSÃO CORRIGIDA
// Corrige o problema de URL muito longa dividindo consultas em lotes

import { supabase } from './supabase';
import { startOfWeek, endOfWeek, format, subWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Interfaces
export interface WeeklyReportItem {
  id: string;
  product_id: string | null;
  product_name: string;
  initial_stock: number;
  purchases_in_week: number;
  sales_in_week: number;
  losses_in_week: number;
  final_stock: number;
  sector_movements: SectorMovement[];
  hotel_transfers: HotelTransfer[];
}

export interface SectorMovement {
  sector_name: string;
  quantity_moved: number;
}

export interface HotelTransfer {
  hotel_name: string;
  quantity_transferred: number;
}

export interface WeeklyReportData {
  report: {
    id: string;
    start_date: string;
    end_date: string;
    created_at: string;
    updated_at: string;
  };
  items: WeeklyReportItem[];
}

// Constante para tamanho do lote (batch)
const BATCH_SIZE = 50; // Reduzido para evitar URLs muito longas

/**
 * Divide um array em lotes menores
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Busca ou cria um relatório semanal
 */
export const getOrCreateWeeklyReport = async (
  hotelId: string,
  weekStartDate: Date
) => {
  try {
    const weekEndDate = endOfWeek(weekStartDate, { locale: ptBR, weekStartsOn: 1 });
    const startDateStr = format(weekStartDate, 'yyyy-MM-dd');
    const endDateStr = format(weekEndDate, 'yyyy-MM-dd');

    console.log('Buscando relatório para:', { hotelId, startDateStr, endDateStr });

    // Verificar se já existe um relatório para esta semana
    const { data: existingReport, error: reportError } = await supabase
      .from('weekly_inventory_reports')
      .select('id, start_date, end_date, created_at, updated_at')
      .eq('hotel_id', hotelId)
      .eq('start_date', startDateStr)
      .eq('end_date', endDateStr)
      .single();

    if (reportError && reportError.code !== 'PGRST116') {
      throw reportError;
    }

    if (existingReport) {
      console.log('Relatório existente encontrado:', existingReport.id);
      return { success: true, data: existingReport };
    }

    // Criar novo relatório
    console.log('Criando novo relatório...');
    const { data: newReport, error: createError } = await supabase
      .from('weekly_inventory_reports')
      .insert({
        hotel_id: hotelId,
        start_date: startDateStr,
        end_date: endDateStr
      })
      .select()
      .single();

    if (createError) throw createError;

    console.log('Novo relatório criado:', newReport.id);
    return { success: true, data: newReport };

  } catch (err) {
    console.error('Erro ao buscar/criar relatório:', err);
    const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, error: errorMessage };
  }
};

/**
 * Calcula o estoque inicial usando snapshots ou cálculo reverso
 */
export const calculateInitialStock = async (
  hotelId: string,
  productId: string,
  weekStartDate: Date
) => {
  try {
    const startDateStr = format(weekStartDate, 'yyyy-MM-dd');

    // Tentar encontrar snapshot mais próximo antes da data de início
    const { data: snapshots, error: snapshotError } = await supabase
      .from('inventory_snapshots')
      .select('id, snapshot_date')
      .eq('hotel_id', hotelId)
      .lte('snapshot_date', startDateStr)
      .order('snapshot_date', { ascending: false })
      .limit(1);

    if (snapshotError) throw snapshotError;

    if (snapshots && snapshots.length > 0) {
      // Buscar quantidade no snapshot
      const { data: snapshotItem, error: itemError } = await supabase
        .from('inventory_snapshot_items')
        .select('quantity')
        .eq('snapshot_id', snapshots[0].id)
        .eq('product_id', productId)
        .single();

      if (itemError && itemError.code !== 'PGRST116') throw itemError;

      if (snapshotItem) {
        return snapshotItem.quantity;
      }
    }

    // Se não há snapshot, calcular baseado no estoque atual menos movimentos da semana
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('quantity')
      .eq('id', productId)
      .single();

    if (productError) throw productError;

    const weekEndDate = endOfWeek(weekStartDate, { locale: ptBR, weekStartsOn: 1 });
    const endDateStr = format(weekEndDate, 'yyyy-MM-dd');

    // Buscar movimentos da semana
    const { data: movements, error: movementsError } = await supabase
      .from('inventory_movements')
      .select('quantity_change')
      .eq('product_id', productId)
      .gte('created_at', startDateStr)
      .lte('created_at', endDateStr + 'T23:59:59.999Z');

    if (movementsError) throw movementsError;

    const weeklyChange = movements?.reduce((sum, mov) => sum + (mov.quantity_change || 0), 0) || 0;
    return Math.max(0, (product.quantity || 0) - weeklyChange);

  } catch (err) {
    console.error('Erro ao calcular estoque inicial:', err);
    return 0;
  }
};

/**
 * Calcula compras da semana
 */
export const calculateWeeklyPurchases = async (
  hotelId: string,
  productId: string,
  weekStartDate: Date
) => {
  try {
    const weekEndDate = endOfWeek(weekStartDate, { locale: ptBR, weekStartsOn: 1 });
    const startDateStr = format(weekStartDate, 'yyyy-MM-dd');
    const endDateStr = format(weekEndDate, 'yyyy-MM-dd');

    const { data: movements, error } = await supabase
      .from('inventory_movements')
      .select('quantity_change')
      .eq('hotel_id', hotelId)
      .eq('product_id', productId)
      .eq('movement_type', 'entrada')
      .gte('created_at', startDateStr)
      .lte('created_at', endDateStr + 'T23:59:59.999Z');

    if (error) throw error;

    return movements?.reduce((sum, mov) => sum + Math.max(0, mov.quantity_change || 0), 0) || 0;

  } catch (err) {
    console.error('Erro ao calcular compras semanais:', err);
    return 0;
  }
};

/**
 * Calcula movimentos por setor da semana - VERSÃO CORRIGIDA COM LOTES
 */
export const calculateWeeklySectorMovements = async (
  hotelId: string,
  productId: string,
  weekStartDate: Date
) => {
  try {
    const weekEndDate = endOfWeek(weekStartDate, { locale: ptBR, weekStartsOn: 1 });
    const startDateStr = format(weekStartDate, 'yyyy-MM-dd');
    const endDateStr = format(weekEndDate, 'yyyy-MM-dd');

    // Buscar setores do hotel
    const { data: sectors, error: sectorsError } = await supabase
      .from('sectors')
      .select('id, name')
      .eq('hotel_id', hotelId);

    if (sectorsError) throw sectorsError;

    if (!sectors || sectors.length === 0) {
      return [];
    }

    const sectorMap = new Map(sectors.map(s => [s.id, s.name]));

    // Buscar consumo por setor para este produto específico
    const { data: consumption, error: consumptionError } = await supabase
      .from('item_consumption')
      .select('sector_id, quantity')
      .eq('product_id', productId)
      .in('sector_id', sectors.map(s => s.id))
      .gte('consumed_at', startDateStr)
      .lte('consumed_at', endDateStr + 'T23:59:59.999Z');

    if (consumptionError) throw consumptionError;

    // Agrupar por setor
    const sectorMovements = new Map<string, number>();
    
    consumption?.forEach(item => {
      const sectorName = sectorMap.get(item.sector_id);
      if (sectorName) {
        const current = sectorMovements.get(sectorName) || 0;
        sectorMovements.set(sectorName, current + (item.quantity || 0));
      }
    });

    return Array.from(sectorMovements.entries())
      .filter(([_, quantity]) => quantity > 0)
      .map(([sector_name, quantity_moved]) => ({
        sector_name,
        quantity_moved
      }));

  } catch (err) {
    console.error('Erro ao calcular movimentos por setor:', err);
    return [];
  }
};

/**
 * Calcula transferências entre hotéis da semana
 */
export const calculateWeeklyHotelTransfers = async (
  hotelId: string,
  productId: string,
  weekStartDate: Date
) => {
  try {
    const weekEndDate = endOfWeek(weekStartDate, { locale: ptBR, weekStartsOn: 1 });
    const startDateStr = format(weekStartDate, 'yyyy-MM-dd');
    const endDateStr = format(weekEndDate, 'yyyy-MM-dd');

    const { data: transfers, error } = await supabase
      .from('hotel_transfers')
      .select(`
        quantity,
        destination_hotel:hotels!destination_hotel_id(name)
      `)
      .eq('source_hotel_id', hotelId)
      .eq('product_id', productId)
      .eq('status', 'completed')
      .gte('completed_at', startDateStr)
      .lte('completed_at', endDateStr + 'T23:59:59.999Z');

    if (error) throw error;

    // Agrupar por hotel de destino
    const hotelTransfers = new Map<string, number>();
    
    transfers?.forEach(transfer => {
      const hotelName = transfer.destination_hotel?.name;
      if (hotelName) {
        const current = hotelTransfers.get(hotelName) || 0;
        hotelTransfers.set(hotelName, current + (transfer.quantity || 0));
      }
    });

    return Array.from(hotelTransfers.entries())
      .filter(([_, quantity]) => quantity > 0)
      .map(([hotel_name, quantity_transferred]) => ({
        hotel_name,
        quantity_transferred
      }));

  } catch (err) {
    console.error('Erro ao calcular transferências entre hotéis:', err);
    return [];
  }
};

/**
 * Cria ou atualiza itens do relatório semanal - VERSÃO CORRIGIDA COM LOTES
 */
export const createOrUpdateReportItems = async (
  reportId: string,
  hotelId: string,
  weekStartDate: Date
) => {
  try {
    console.log('Buscando produtos do hotel...');
    
    // Buscar todos os produtos do hotel
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, quantity')
      .eq('hotel_id', hotelId)
      .order('name');

    if (productsError) throw productsError;

    if (!products || products.length === 0) {
      console.log('Nenhum produto encontrado para o hotel');
      return { success: true, data: [] };
    }

    console.log('Produtos encontrados:', products.length);

    // Verificar se já existem itens para este relatório
    console.log('Verificando itens existentes...');
    const { data: existingItems, error: existingError } = await supabase
      .from('weekly_inventory_report_items')
      .select('id, product_id')
      .eq('report_id', reportId);

    if (existingError) throw existingError;

    if (existingItems && existingItems.length > 0) {
      console.log('Itens existentes encontrados, retornando dados...');
      return { success: true, data: existingItems };
    }

    console.log('Criando novos itens do relatório...');

    // Dividir produtos em lotes para processamento
    const productBatches = chunkArray(products, BATCH_SIZE);
    const allReportItems: any[] = [];

    for (let batchIndex = 0; batchIndex < productBatches.length; batchIndex++) {
      const batch = productBatches[batchIndex];
      console.log(`Processando lote ${batchIndex + 1}/${productBatches.length} (${batch.length} produtos)`);

      const batchItems = await Promise.all(
        batch.map(async (product) => {
          try {
            const [initialStock, purchases, sectorMovements, hotelTransfers] = await Promise.all([
              calculateInitialStock(hotelId, product.id, weekStartDate),
              calculateWeeklyPurchases(hotelId, product.id, weekStartDate),
              calculateWeeklySectorMovements(hotelId, product.id, weekStartDate),
              calculateWeeklyHotelTransfers(hotelId, product.id, weekStartDate)
            ]);

            return {
              report_id: reportId,
              product_id: product.id,
              initial_stock: initialStock,
              purchases_in_week: purchases,
              sales_in_week: 0, // Será preenchido manualmente
              losses_in_week: 0, // Será preenchido manualmente
              final_stock: product.quantity || 0
            };
          } catch (err) {
            console.error(`Erro ao processar produto ${product.name}:`, err);
            return {
              report_id: reportId,
              product_id: product.id,
              initial_stock: 0,
              purchases_in_week: 0,
              sales_in_week: 0,
              losses_in_week: 0,
              final_stock: product.quantity || 0
            };
          }
        })
      );

      allReportItems.push(...batchItems);

      // Pequena pausa entre lotes para não sobrecarregar o servidor
      if (batchIndex < productBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('Inserindo itens no banco de dados...');

    // Inserir todos os itens de uma vez
    const { data: insertedItems, error: insertError } = await supabase
      .from('weekly_inventory_report_items')
      .insert(allReportItems)
      .select();

    if (insertError) throw insertError;

    console.log('Itens criados com sucesso:', insertedItems?.length || 0);

    // Agora processar movimentos de setor e transferências em lotes
    if (insertedItems && insertedItems.length > 0) {
      await createSectorMovementsAndTransfers(insertedItems, hotelId, weekStartDate);
    }

    return { success: true, data: insertedItems };

  } catch (err) {
    console.error('Erro ao criar/atualizar itens do relatório:', err);
    const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, error: errorMessage };
  }
};

/**
 * Cria movimentos de setor e transferências em lotes - NOVA FUNÇÃO
 */
const createSectorMovementsAndTransfers = async (
  reportItems: any[],
  hotelId: string,
  weekStartDate: Date
) => {
  try {
    console.log('Criando movimentos de setor e transferências...');

    // Dividir itens em lotes
    const itemBatches = chunkArray(reportItems, BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < itemBatches.length; batchIndex++) {
      const batch = itemBatches[batchIndex];
      console.log(`Processando movimentos - lote ${batchIndex + 1}/${itemBatches.length}`);

      const sectorMovements: any[] = [];
      const hotelTransfers: any[] = [];

      for (const item of batch) {
        try {
          // Calcular movimentos de setor
          const sectorMoves = await calculateWeeklySectorMovements(hotelId, item.product_id, weekStartDate);
          sectorMoves.forEach(move => {
            sectorMovements.push({
              report_item_id: item.id,
              sector_name: move.sector_name,
              quantity_moved: move.quantity_moved
            });
          });

          // Calcular transferências
          const transfers = await calculateWeeklyHotelTransfers(hotelId, item.product_id, weekStartDate);
          transfers.forEach(transfer => {
            hotelTransfers.push({
              report_item_id: item.id,
              hotel_name: transfer.hotel_name,
              quantity_transferred: transfer.quantity_transferred
            });
          });
        } catch (err) {
          console.error(`Erro ao processar movimentos para item ${item.id}:`, err);
        }
      }

      // Inserir movimentos de setor se houver
      if (sectorMovements.length > 0) {
        const { error: sectorError } = await supabase
          .from('weekly_inventory_sector_movements')
          .insert(sectorMovements);

        if (sectorError) {
          console.error('Erro ao inserir movimentos de setor:', sectorError);
        }
      }

      // Inserir transferências se houver
      if (hotelTransfers.length > 0) {
        const { error: transferError } = await supabase
          .from('weekly_inventory_hotel_transfers')
          .insert(hotelTransfers);

        if (transferError) {
          console.error('Erro ao inserir transferências:', transferError);
        }
      }

      // Pausa entre lotes
      if (batchIndex < itemBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log('Movimentos e transferências criados com sucesso');

  } catch (err) {
    console.error('Erro ao criar movimentos e transferências:', err);
  }
};

/**
 * Gera um relatório semanal completo
 */
export const generateWeeklyReport = async (
  hotelId: string,
  weekStartDate: Date
) => {
  try {
    console.log('Iniciando geração de relatório semanal:', { hotelId, weekStartDate });

    // 1. Buscar ou criar relatório
    const reportResult = await getOrCreateWeeklyReport(hotelId, weekStartDate);
    if (!reportResult.success || !reportResult.data) {
      throw new Error(reportResult.error || 'Erro ao criar relatório');
    }

    const report = reportResult.data;

    // 2. Criar ou atualizar itens do relatório
    const itemsResult = await createOrUpdateReportItems(report.id, hotelId, weekStartDate);
    if (!itemsResult.success) {
      throw new Error(itemsResult.error || 'Erro ao criar itens do relatório');
    }

    // 3. Buscar dados completos do relatório
    const dataResult = await getWeeklyReportData(report.id);
    if (!dataResult.success) {
      throw new Error(dataResult.error || 'Erro ao buscar dados do relatório');
    }

    console.log('Relatório gerado com sucesso');
    return dataResult;

  } catch (err) {
    console.error('Erro ao gerar relatório semanal:', err);
    const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, error: errorMessage };
  }
};

/**
 * Busca dados completos de um relatório semanal - VERSÃO CORRIGIDA COM LOTES
 */
export const getWeeklyReportData = async (reportId: string): Promise<{ success: boolean; data?: WeeklyReportData; error?: string }> => {
  try {
    console.log('Obtendo dados do relatório:', reportId);

    // Buscar dados do relatório
    const { data: report, error: reportError } = await supabase
      .from('weekly_inventory_reports')
      .select('id, start_date, end_date, created_at, updated_at')
      .eq('id', reportId)
      .single();

    if (reportError) throw reportError;

    // Buscar itens do relatório
    const { data: items, error: itemsError } = await supabase
      .from('weekly_inventory_report_items')
      .select(`
        id,
        product_id,
        initial_stock,
        purchases_in_week,
        sales_in_week,
        losses_in_week,
        final_stock,
        products(name)
      `)
      .eq('report_id', reportId)
      .order('products(name)');

    if (itemsError) throw itemsError;

    if (!items || items.length === 0) {
      return {
        success: true,
        data: {
          report,
          items: []
        }
      };
    }

    console.log('Buscando movimentos e transferências em lotes...');

    // Dividir itens em lotes para buscar movimentos
    const itemBatches = chunkArray(items, BATCH_SIZE);
    const allSectorMovements: any[] = [];
    const allHotelTransfers: any[] = [];

    for (let batchIndex = 0; batchIndex < itemBatches.length; batchIndex++) {
      const batch = itemBatches[batchIndex];
      const itemIds = batch.map(item => item.id);

      console.log(`Buscando movimentos - lote ${batchIndex + 1}/${itemBatches.length} (${itemIds.length} itens)`);

      // Buscar movimentos de setor para este lote
      const { data: sectorMovements, error: sectorError } = await supabase
        .from('weekly_inventory_sector_movements')
        .select('*')
        .in('report_item_id', itemIds);

      if (sectorError) {
        console.error('Erro ao buscar movimentos de setor:', sectorError);
      } else if (sectorMovements) {
        allSectorMovements.push(...sectorMovements);
      }

      // Buscar transferências para este lote
      const { data: hotelTransfers, error: transferError } = await supabase
        .from('weekly_inventory_hotel_transfers')
        .select('*')
        .in('report_item_id', itemIds);

      if (transferError) {
        console.error('Erro ao buscar transferências:', transferError);
      } else if (hotelTransfers) {
        allHotelTransfers.push(...hotelTransfers);
      }

      // Pausa entre lotes
      if (batchIndex < itemBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Mapear movimentos por item
    const sectorMovementsByItem = new Map<string, SectorMovement[]>();
    const hotelTransfersByItem = new Map<string, HotelTransfer[]>();

    allSectorMovements.forEach(movement => {
      const itemId = movement.report_item_id;
      if (!sectorMovementsByItem.has(itemId)) {
        sectorMovementsByItem.set(itemId, []);
      }
      sectorMovementsByItem.get(itemId)!.push({
        sector_name: movement.sector_name,
        quantity_moved: movement.quantity_moved
      });
    });

    allHotelTransfers.forEach(transfer => {
      const itemId = transfer.report_item_id;
      if (!hotelTransfersByItem.has(itemId)) {
        hotelTransfersByItem.set(itemId, []);
      }
      hotelTransfersByItem.get(itemId)!.push({
        hotel_name: transfer.hotel_name,
        quantity_transferred: transfer.quantity_transferred
      });
    });

    // Montar dados finais
    const reportItems: WeeklyReportItem[] = items.map(item => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.products?.name || 'Produto Desconhecido',
      initial_stock: item.initial_stock,
      purchases_in_week: item.purchases_in_week,
      sales_in_week: item.sales_in_week,
      losses_in_week: item.losses_in_week,
      final_stock: item.final_stock,
      sector_movements: sectorMovementsByItem.get(item.id) || [],
      hotel_transfers: hotelTransfersByItem.get(item.id) || []
    }));

    console.log('Dados do relatório obtidos com sucesso');

    return {
      success: true,
      data: {
        report,
        items: reportItems
      }
    };

  } catch (err) {
    console.error('Erro ao buscar dados do relatório:', err);
    const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, error: errorMessage };
  }
};

/**
 * Atualiza vendas e perdas de um item do relatório
 */
export const updateWeeklyReportItem = async (
  itemId: string,
  sales: number,
  losses: number
) => {
  try {
    const { data, error } = await supabase
      .from('weekly_inventory_report_items')
      .update({
        sales_in_week: sales,
        losses_in_week: losses,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .select();

    if (error) throw error;

    return { success: true, data };

  } catch (err) {
    console.error('Erro ao atualizar item do relatório:', err);
    const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, error: errorMessage };
  }
};

/**
 * Deleta um relatório semanal e todos os dados relacionados
 */
export const deleteWeeklyReport = async (reportId: string) => {
  try {
    // O banco deve ter CASCADE configurado, mas vamos deletar explicitamente para garantir
    
    // 1. Deletar movimentos de setor
    await supabase
      .from('weekly_inventory_sector_movements')
      .delete()
      .in('report_item_id', 
        supabase
          .from('weekly_inventory_report_items')
          .select('id')
          .eq('report_id', reportId)
      );

    // 2. Deletar transferências
    await supabase
      .from('weekly_inventory_hotel_transfers')
      .delete()
      .in('report_item_id', 
        supabase
          .from('weekly_inventory_report_items')
          .select('id')
          .eq('report_id', reportId)
      );

    // 3. Deletar itens do relatório
    await supabase
      .from('weekly_inventory_report_items')
      .delete()
      .eq('report_id', reportId);

    // 4. Deletar o relatório
    const { error } = await supabase
      .from('weekly_inventory_reports')
      .delete()
      .eq('id', reportId);

    if (error) throw error;

    return { success: true };

  } catch (err) {
    console.error('Erro ao deletar relatório:', err);
    const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, error: errorMessage };
  }
};

