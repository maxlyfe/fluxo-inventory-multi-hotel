// src/lib/erbonStockDeductionService.ts
import { supabase } from './supabase';

export interface DeductionResult {
  processed: number;
  skipped: number;
  errors: string[];
  details: {
    product_name: string;
    sector_name: string;
    quantity: number;
    type: 'direct' | 'decomposed';
  }[];
}

export async function processErbonSalesDeductions(
  hotelId: string,
  startDate: string,
  endDate: string,
  processedBy: string
): Promise<DeductionResult> {
  const result: DeductionResult = { processed: 0, skipped: 0, errors: [], details: [] };

  const { data: txCache, error: txError } = await supabase
    .from('erbon_transaction_cache')
    .select('erbon_service_id, erbon_department, quantity, transaction_date')
    .eq('hotel_id', hotelId)
    .eq('is_canceled', false)
    .gte('transaction_date', startDate)
    .lte('transaction_date', endDate);

  if (txError) throw txError;
  if (!txCache || txCache.length === 0) return result;

  const { data: productMappings } = await supabase
    .from('erbon_product_mappings')
    .select('product_id, dish_id, erbon_service_id, erbon_service_description')
    .eq('hotel_id', hotelId);

  const { data: sectorMappings } = await supabase
    .from('erbon_sector_mappings')
    .select('sector_id, erbon_department')
    .eq('hotel_id', hotelId);

  const { data: alreadyProcessed } = await supabase
    .from('erbon_sales_processed')
    .select('erbon_service_id, erbon_department, transaction_date')
    .eq('hotel_id', hotelId)
    .gte('transaction_date', startDate)
    .lte('transaction_date', endDate);

  const serviceToMapping = new Map<number, { product_id: string | null; dish_id: string | null; desc: string | null }>();
  (productMappings || []).forEach(m =>
    serviceToMapping.set(m.erbon_service_id, { product_id: m.product_id, dish_id: m.dish_id, desc: m.erbon_service_description })
  );

  const deptToSector = new Map<string, string>();
  (sectorMappings || []).forEach(m => deptToSector.set(m.erbon_department, m.sector_id));

  const processedSet = new Set<string>();
  (alreadyProcessed || []).forEach(p =>
    processedSet.add(`${p.erbon_service_id}|${p.erbon_department}|${p.transaction_date}`)
  );

  const { data: allProducts } = await supabase.from('products').select('id, name').eq('hotel_id', hotelId);
  const { data: allSectors } = await supabase.from('sectors').select('id, name').eq('hotel_id', hotelId);
  const productNames = new Map((allProducts || []).map(p => [p.id, p.name]));
  const sectorNames = new Map((allSectors || []).map(s => [s.id, s.name]));

  const aggregated = new Map<string, { service_id: number; department: string; date: string; qty: number }>();
  for (const tx of txCache) {
    const key = `${tx.erbon_service_id}|${tx.erbon_department}|${tx.transaction_date}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.qty += tx.quantity || 0;
    } else {
      aggregated.set(key, { service_id: tx.erbon_service_id, department: tx.erbon_department, date: tx.transaction_date, qty: tx.quantity || 0 });
    }
  }

  for (const [key, agg] of aggregated) {
    if (processedSet.has(key)) { result.skipped++; continue; }

    const mapping = serviceToMapping.get(agg.service_id);
    if (!mapping) { result.skipped++; continue; }

    const sectorId = deptToSector.get(agg.department);
    if (!sectorId && mapping.product_id) { result.skipped++; continue; }

    try {
      if (mapping.product_id) {
        await deductDirectProduct(hotelId, sectorId!, mapping.product_id, agg.qty, agg.date, processedBy);
        result.details.push({
          product_name: productNames.get(mapping.product_id) || mapping.desc || 'Desconhecido',
          sector_name: sectorNames.get(sectorId!) || agg.department,
          quantity: agg.qty, type: 'direct',
        });
        await supabase.from('erbon_sales_processed').insert({
          hotel_id: hotelId, erbon_service_id: agg.service_id, erbon_department: agg.department,
          transaction_date: agg.date, quantity: agg.qty, sector_id: sectorId,
          product_id: mapping.product_id, deduction_type: 'direct', processed_by: processedBy,
        });
        result.processed++;
      } else if (mapping.dish_id) {
        await deductDecomposedDish(hotelId, mapping.dish_id, agg.qty, agg.date, processedBy, result, productNames, sectorNames);
        await supabase.from('erbon_sales_processed').insert({
          hotel_id: hotelId, erbon_service_id: agg.service_id, erbon_department: agg.department,
          transaction_date: agg.date, quantity: agg.qty, sector_id: null,
          dish_id: mapping.dish_id, deduction_type: 'decomposed', processed_by: processedBy,
        });
        result.processed++;
      } else {
        result.skipped++;
      }
    } catch (err: any) {
      result.errors.push(`Serviço ${agg.service_id} (${mapping.desc || '?'}): ${err.message}`);
    }
  }

  return result;
}

async function deductDirectProduct(hotelId: string, sectorId: string, productId: string, quantity: number, date: string, processedBy: string) {
  const { data: stockRow } = await supabase
    .from('sector_stock').select('id, quantity')
    .eq('hotel_id', hotelId).eq('sector_id', sectorId).eq('product_id', productId).single();

  if (stockRow) {
    const newQty = Math.max(0, (stockRow.quantity || 0) - quantity);
    await supabase.from('sector_stock').update({ quantity: newQty }).eq('id', stockRow.id);
  }

  await supabase.from('sector_stock_movements').insert({
    hotel_id: hotelId, sector_id: sectorId, product_id: productId, quantity,
    movement_type: 'saida', notes: `Baixa automática Erbon PDV - ${date}`,
    created_by: processedBy, destination_label: 'Venda PDV',
  });
}

async function deductDecomposedDish(
  hotelId: string, dishId: string, dishQuantity: number, date: string, processedBy: string,
  result: DeductionResult, productNames: Map<string, string>, sectorNames: Map<string, string>
) {
  const { data: dish } = await supabase.from('dishes').select('id, name, production_sector_id').eq('id', dishId).single();
  if (!dish) throw new Error(`Prato ${dishId} não encontrado`);
  if (!dish.production_sector_id) throw new Error(`Prato "${dish.name}" sem setor de produção definido`);

  const sectorId = dish.production_sector_id;
  const { data: dishIngredients } = await supabase
    .from('dish_ingredients').select('quantity, ingredient:ingredients(id, name, product_id)').eq('dish_id', dishId);
  const { data: dishSides } = await supabase
    .from('dish_sides').select('quantity, side_id').eq('dish_id', dishId);

  const ingredientDeductions: { product_id: string; name: string; quantity: number }[] = [];

  for (const di of (dishIngredients || [])) {
    const ing = di.ingredient as any;
    if (ing?.product_id) {
      ingredientDeductions.push({ product_id: ing.product_id, name: ing.name, quantity: (di.quantity || 0) * dishQuantity });
    }
  }

  for (const ds of (dishSides || [])) {
    const { data: sideIngredients } = await supabase
      .from('side_ingredients').select('quantity, ingredient:ingredients(id, name, product_id)').eq('side_id', ds.side_id);
    for (const si of (sideIngredients || [])) {
      const ing = si.ingredient as any;
      if (ing?.product_id) {
        ingredientDeductions.push({ product_id: ing.product_id, name: ing.name, quantity: (si.quantity || 0) * (ds.quantity || 1) * dishQuantity });
      }
    }
  }

  const aggregatedDeductions = new Map<string, { name: string; qty: number }>();
  for (const d of ingredientDeductions) {
    const existing = aggregatedDeductions.get(d.product_id);
    if (existing) { existing.qty += d.quantity; } else { aggregatedDeductions.set(d.product_id, { name: d.name, qty: d.quantity }); }
  }

  for (const [productId, { name, qty }] of aggregatedDeductions) {
    await deductDirectProduct(hotelId, sectorId, productId, qty, date, processedBy);
    result.details.push({
      product_name: productNames.get(productId) || name,
      sector_name: sectorNames.get(sectorId) || 'Setor de Produção',
      quantity: qty, type: 'decomposed',
    });
  }
}
