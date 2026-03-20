import { supabase } from './supabase';

interface TransferItem {
  product_id: string;
  quantity: number;
  unit_value?: number;
}

interface TransferResult {
  success: boolean;
  transferred_count?: number;
  message?: string;
}

/**
 * Transfere múltiplos produtos entre hotéis (e opcionalmente entre setores).
 *
 * Para cada item:
 *  1. Insere uma linha em `hotel_transfers` com status='pending'
 *  2. Atualiza essa linha para status='completed', o que dispara o trigger
 *     `handle_hotel_transfer` que ajusta os estoques automaticamente.
 */
export const transferMultipleProducts = async (
  sourceHotelId: string,
  destinationHotelId: string,
  itemsToTransfer: TransferItem[],
  performedBy: string,
  options?: {
    notes?: string;
    source_sector_id?: string;
    destination_sector_id?: string;
  }
): Promise<TransferResult> => {
  try {
    let transferredCount = 0;

    for (const item of itemsToTransfer) {
      // 1. Inserir transferência com status 'pending'
      const { data: inserted, error: insertError } = await supabase
        .from('hotel_transfers')
        .insert({
          source_hotel_id: sourceHotelId,
          destination_hotel_id: destinationHotelId,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_value: item.unit_value ?? null,
          status: 'pending',
          notes: options?.notes ?? null,
          ...(options?.source_sector_id ? { source_sector_id: options.source_sector_id } : {}),
          ...(options?.destination_sector_id ? { destination_sector_id: options.destination_sector_id } : {}),
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('Erro ao inserir transferência:', insertError);
        return {
          success: false,
          message: `Erro ao criar transferência do produto ${item.product_id}: ${insertError.message}`,
        };
      }

      // 2. Atualizar para 'completed' — dispara o trigger handle_hotel_transfer
      const { error: updateError } = await supabase
        .from('hotel_transfers')
        .update({ status: 'completed' })
        .eq('id', inserted.id);

      if (updateError) {
        console.error('Erro ao completar transferência:', updateError);
        return {
          success: false,
          message: `Erro ao completar transferência do produto ${item.product_id}: ${updateError.message}`,
        };
      }

      transferredCount++;
    }

    return { success: true, transferred_count: transferredCount };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido na transferência';
    console.error('Erro inesperado na transferência:', err);
    return { success: false, message };
  }
};
