// src/lib/autoRequisitionService.ts
import { supabase } from './supabase';
import { detectSeason, getApplicableMinMax } from './seasonHelper';

export interface RequisitionPreviewItem {
  sector_id: string;
  sector_name: string;
  product_id: string;
  product_name: string;
  current_quantity: number;
  applicable_min: number;
  applicable_max: number;
  suggested_quantity: number;
  included: boolean;
}

export async function generateRequisitionPreview(
  hotelId: string,
  sectorId?: string
): Promise<RequisitionPreviewItem[]> {
  const seasonInfo = await detectSeason(hotelId);

  let query = supabase
    .from('sector_stock')
    .select(`
      sector_id, product_id, quantity, min_quantity, max_quantity,
      min_quantity_low, max_quantity_low, min_quantity_high, max_quantity_high,
      products!inner(id, name, is_active),
      sectors!inner(id, name)
    `)
    .eq('hotel_id', hotelId);

  if (sectorId) query = query.eq('sector_id', sectorId);

  const { data: stockItems, error } = await query;
  if (error) throw error;

  const preview: RequisitionPreviewItem[] = [];

  for (const item of (stockItems || [])) {
    const product = (item as any).products;
    const sector = (item as any).sectors;
    if (!product?.is_active) continue;

    const { min, max } = getApplicableMinMax({
      min_quantity: item.min_quantity || 0,
      max_quantity: item.max_quantity || 100,
      min_quantity_low: item.min_quantity_low,
      max_quantity_low: item.max_quantity_low,
      min_quantity_high: item.min_quantity_high,
      max_quantity_high: item.max_quantity_high,
    }, seasonInfo.season);

    const currentQty = item.quantity || 0;
    if (currentQty <= min) {
      preview.push({
        sector_id: item.sector_id, sector_name: sector?.name || '',
        product_id: item.product_id, product_name: product?.name || '',
        current_quantity: currentQty, applicable_min: min, applicable_max: max,
        suggested_quantity: Math.max(0, max - currentQty), included: true,
      });
    }
  }

  preview.sort((a, b) => {
    const s = a.sector_name.localeCompare(b.sector_name);
    return s !== 0 ? s : a.product_name.localeCompare(b.product_name);
  });

  return preview;
}

export async function commitRequisitions(
  hotelId: string,
  items: RequisitionPreviewItem[]
): Promise<number> {
  const included = items.filter(i => i.included && i.suggested_quantity > 0);
  if (included.length === 0) return 0;

  const rows = included.map(item => ({
    sector_id: item.sector_id, product_id: item.product_id, item_name: item.product_name,
    quantity: Math.ceil(item.suggested_quantity), status: 'pending', is_custom: false,
    hotel_id: hotelId, notes: 'Requisição gerada automaticamente',
  }));

  const { error } = await supabase.from('requisitions').insert(rows);
  if (error) throw error;
  return included.length;
}
