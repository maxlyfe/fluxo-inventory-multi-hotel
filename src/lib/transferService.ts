import { supabase } from './supabase';

interface TransferItem {
  product_id: string;
  quantity: number;
}

/**
 * Invoca a função 'transfer_products_between_hotels' no Supabase.
 */
export const transferMultipleProducts = async (
  sourceHotelId: string,
  destinationHotelId: string,
  itemsToTransfer: TransferItem[],
  performedBy: string
) => {
  const { data, error } = await supabase.rpc('transfer_products_between_hotels', {
    source_hotel_id: sourceHotelId,
    destination_hotel_id: destinationHotelId,
    items_to_transfer: itemsToTransfer,
    performed_by: performedBy
  });

  if (error) {
    console.error("Erro ao chamar a função de transferência:", error);
    return { success: false, message: error.message };
  }

  return data;
};