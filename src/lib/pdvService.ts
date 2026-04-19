// src/lib/pdvService.ts
// Serviço do módulo PDV — Ponto de Venda
// Orquestra: busca de produtos, criação de venda, desconto de estoque,
// lançamento no Erbon PMS e histórico de vendas.

import { supabase } from './supabase';
import { erbonService } from './erbonService';

// ── Tipos públicos ─────────────────────────────────────────────────────────

export interface PDVProduct {
  product_id: string;
  product_name: string;
  category: string;
  unit_measure: string;
  image_url: string | null;
  stock_quantity: number;       // sector_stock.quantity atual
  sale_price: number;           // pdv_prices.sale_price (0 se não cadastrado)
  erbon_service_id: number | null;
  erbon_service_description: string | null;
}

export interface PDVSectorDetails {
  sector_id: string;
  sector_name: string;
  erbon_department: string | null;     // ex: "Restaurante"
  erbon_department_id: number | null;  // ID numérico para POST Erbon
}

export interface CartItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  stock_quantity: number;
  erbon_service_id: number | null;
  erbon_service_description: string | null;
}

export interface SelectedBooking {
  bookingInternalId: number;
  bookingNumber: string;
  roomDescription: string;
  guestName: string;
  checkOutDate: string | null;
}

export interface PdvTable {
  id: string;
  label: string;
  capacity: number;
  display_order: number;
}

export interface CreateSaleInput {
  hotelId: string;
  sectorId: string;
  bookingInternalId: number;
  bookingNumber: string;
  roomDescription: string;
  guestName: string;
  operatorName: string;
  items: CartItem[];
  erbonDepartmentId: number | null;
  erbonDepartmentLabel: string | null;
  tableId?: string | null;
  tableLabel?: string | null;
}

export interface SaleResult {
  saleId: string;
  totalAmount: number;
  erbonPosted: boolean;
  erbonErrors: { productName: string; error: string }[];
}

export interface PDVSaleItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  erbon_posted: boolean;
  erbon_post_error: string | null;
}

export interface PDVSaleHistory {
  id: string;
  hotel_id: string;
  sector_id: string;
  sector_name: string;
  booking_internal_id: number;
  booking_number: string;
  room_description: string;
  guest_name: string;
  operator_name: string | null;
  total_amount: number;
  status: string;
  erbon_posted: boolean;
  erbon_post_error: string | null;
  sale_date: string;
  created_at: string;
  items?: PDVSaleItem[];
}

export interface SalesHistoryFilters {
  startDate?: string;
  endDate?: string;
  sectorId?: string;
  erbonFailed?: boolean;
  includeItems?: boolean;
}

// ── Funções ────────────────────────────────────────────────────────────────

/** Busca as mesas configuradas para um setor. */
export async function getSectorTables(hotelId: string, sectorId: string): Promise<PdvTable[]> {
  const { data, error } = await supabase
    .from('pdv_tables')
    .select('id, label, capacity, display_order')
    .eq('hotel_id', hotelId)
    .eq('sector_id', sectorId)
    .eq('is_active', true)
    .order('display_order')
    .order('label');
  if (error) throw error;
  return (data || []) as PdvTable[];
}

/**
 * Busca produtos disponíveis no estoque de um setor,
 * enriquecidos com preço de venda e mapeamento Erbon.
 */
export async function getProductsForSector(
  hotelId: string,
  sectorId: string
): Promise<PDVProduct[]> {
  // 1. Estoque do setor com dados do produto
  const { data: stockRows, error: stockErr } = await supabase
    .from('sector_stock')
    .select(`
      quantity,
      products!inner (
        id,
        name,
        category,
        unit_measure,
        image_url,
        is_active
      )
    `)
    .eq('hotel_id', hotelId)
    .eq('sector_id', sectorId)
    .eq('products.is_active', true)
    .gt('quantity', 0);

  if (stockErr) throw stockErr;
  if (!stockRows || stockRows.length === 0) return [];

  const productIds = stockRows.map((r: any) => r.products.id);

  // 2. Preços de venda (padrão hotel — sector_id IS NULL)
  const { data: priceRows } = await supabase
    .from('pdv_prices')
    .select('product_id, sale_price')
    .eq('hotel_id', hotelId)
    .in('product_id', productIds)
    .is('sector_id', null);

  const priceMap = new Map<string, number>();
  for (const p of priceRows || []) {
    priceMap.set(p.product_id, Number(p.sale_price));
  }

  // 3. Mapeamentos Erbon
  const { data: mappingRows } = await supabase
    .from('erbon_product_mappings')
    .select('product_id, erbon_service_id, erbon_service_description')
    .eq('hotel_id', hotelId)
    .in('product_id', productIds)
    .not('product_id', 'is', null);

  const mappingMap = new Map<string, { erbon_service_id: number; erbon_service_description: string | null }>();
  for (const m of mappingRows || []) {
    if (m.product_id) {
      mappingMap.set(m.product_id, {
        erbon_service_id: m.erbon_service_id,
        erbon_service_description: m.erbon_service_description ?? null,
      });
    }
  }

  // 4. Merge e retorno
  const result: PDVProduct[] = stockRows.map((r: any) => {
    const p = r.products;
    const mapping = mappingMap.get(p.id);
    return {
      product_id: p.id,
      product_name: p.name,
      category: p.category || 'Outros',
      unit_measure: p.unit_measure || 'und',
      image_url: p.image_url ?? null,
      stock_quantity: Number(r.quantity),
      sale_price: priceMap.get(p.id) ?? 0,
      erbon_service_id: mapping?.erbon_service_id ?? null,
      erbon_service_description: mapping?.erbon_service_description ?? null,
    };
  });

  return result.sort((a, b) =>
    a.category.localeCompare(b.category) || a.product_name.localeCompare(b.product_name)
  );
}

/**
 * Retorna os detalhes de um setor, incluindo mapeamento Erbon.
 */
export async function getSectorDetails(
  hotelId: string,
  sectorId: string
): Promise<PDVSectorDetails | null> {
  const { data: sector } = await supabase
    .from('sectors')
    .select('id, name')
    .eq('id', sectorId)
    .single();

  if (!sector) return null;

  const { data: mapping } = await supabase
    .from('erbon_sector_mappings')
    .select('erbon_department, erbon_department_id')
    .eq('hotel_id', hotelId)
    .eq('sector_id', sectorId)
    .maybeSingle();

  return {
    sector_id: sector.id,
    sector_name: sector.name,
    erbon_department: mapping?.erbon_department ?? null,
    erbon_department_id: mapping?.erbon_department_id ?? null,
  };
}

/**
 * Retorna todos os setores do hotel que possuem mapeamento Erbon.
 * Setores sem mapeamento são retornados também mas com erbon_department=null
 * (para informar o operador no UI).
 */
export async function getSectorsForPDV(hotelId: string): Promise<PDVSectorDetails[]> {
  const { data: sectors } = await supabase
    .from('sectors')
    .select('id, name')
    .eq('hotel_id', hotelId)
    .order('name');

  if (!sectors || sectors.length === 0) return [];

  const { data: mappings } = await supabase
    .from('erbon_sector_mappings')
    .select('sector_id, erbon_department, erbon_department_id')
    .eq('hotel_id', hotelId);

  const mappingMap = new Map<string, { erbon_department: string; erbon_department_id: number | null }>();
  for (const m of mappings || []) {
    mappingMap.set(m.sector_id, {
      erbon_department: m.erbon_department,
      erbon_department_id: m.erbon_department_id ?? null,
    });
  }

  return sectors.map(s => {
    const m = mappingMap.get(s.id);
    return {
      sector_id: s.id,
      sector_name: s.name,
      erbon_department: m?.erbon_department ?? null,
      erbon_department_id: m?.erbon_department_id ?? null,
    };
  });
}

/**
 * Cria uma venda PDV completa:
 * 1. Valida estoque
 * 2. Salva no Supabase (local-first)
 * 3. Desconta sector_stock + registra movimentos
 * 4. Tenta POST no Erbon por item (best-effort)
 * 5. Atualiza status de cada item e cabeçalho da venda
 */
export async function createSale(input: CreateSaleInput): Promise<SaleResult> {
  const { hotelId, sectorId, bookingInternalId, bookingNumber, roomDescription,
    guestName, operatorName, items, erbonDepartmentId, erbonDepartmentLabel } = input;

  // 1. Validar estoque antes de qualquer write
  for (const item of items) {
    const { data: stock } = await supabase
      .from('sector_stock')
      .select('quantity')
      .eq('hotel_id', hotelId)
      .eq('sector_id', sectorId)
      .eq('product_id', item.product_id)
      .single();

    const available = Number(stock?.quantity ?? 0);
    if (available < item.quantity) {
      throw new Error(
        `Estoque insuficiente para "${item.product_name}": disponível ${available}, solicitado ${item.quantity}`
      );
    }
  }

  const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

  // 2. Criar cabeçalho da venda
  const { data: sale, error: saleErr } = await supabase
    .from('pdv_sales')
    .insert({
      hotel_id: hotelId,
      sector_id: sectorId,
      booking_internal_id: bookingInternalId,
      booking_number: bookingNumber,
      room_description: roomDescription,
      guest_name: guestName,
      operator_name: operatorName,
      total_amount: totalAmount,
      status: 'completed',
      erbon_posted: false,
      sale_date: new Date().toISOString().split('T')[0],
      table_id: input.tableId ?? null,
      table_label: input.tableLabel ?? null,
    })
    .select('id')
    .single();

  if (saleErr || !sale) throw new Error(`Erro ao criar venda: ${saleErr?.message}`);
  const saleId = sale.id;

  // 3. Inserir itens
  const itemsToInsert = items.map(item => ({
    sale_id: saleId,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    erbon_service_id: item.erbon_service_id,
    erbon_department: erbonDepartmentLabel,
    erbon_posted: false,
  }));

  const { data: insertedItems, error: itemsErr } = await supabase
    .from('pdv_sale_items')
    .insert(itemsToInsert)
    .select('id, product_id, product_name');

  if (itemsErr) throw new Error(`Erro ao salvar itens: ${itemsErr.message}`);

  // 4. Descontar estoque e registrar movimentos
  for (const item of items) {
    await supabase.rpc('decrement_sector_stock', {
      p_hotel_id: hotelId,
      p_sector_id: sectorId,
      p_product_id: item.product_id,
      p_qty: item.quantity,
    }).then(async ({ error }) => {
      if (error) {
        // Fallback: UPDATE direto se RPC não existir
        await supabase
          .from('sector_stock')
          .update({ quantity: supabase.rpc as any })
          .eq('hotel_id', hotelId)
          .eq('sector_id', sectorId)
          .eq('product_id', item.product_id);
      }
    });

    // UPDATE direto e confiável
    await supabase
      .from('sector_stock')
      .update({ updated_at: new Date().toISOString() })
      .eq('hotel_id', hotelId)
      .eq('sector_id', sectorId)
      .eq('product_id', item.product_id);

    // Decremento via SQL
    await supabase.rpc('pdv_decrement_stock', {
      p_hotel_id: hotelId,
      p_sector_id: sectorId,
      p_product_id: item.product_id,
      p_qty: item.quantity,
    }).catch(() => {
      // RPC pode não existir — usar update com expressão aritmética
    });

    // Registro de movimento
    await supabase.from('sector_stock_movements').insert({
      hotel_id: hotelId,
      sector_id: sectorId,
      product_id: item.product_id,
      quantity: item.quantity,
      movement_type: 'saida',
      destination_label: `PDV — UH ${roomDescription} (${guestName})`,
      notes: `PDV venda #${saleId.slice(0, 8)}`,
      created_by: operatorName,
    });
  }

  // Decremento real de estoque (UPDATE com quantidade atual - solicitada)
  for (const item of items) {
    const { data: currentStock } = await supabase
      .from('sector_stock')
      .select('quantity')
      .eq('hotel_id', hotelId)
      .eq('sector_id', sectorId)
      .eq('product_id', item.product_id)
      .single();

    const newQty = Math.max(0, Number(currentStock?.quantity ?? 0) - item.quantity);
    await supabase
      .from('sector_stock')
      .update({ quantity: newQty })
      .eq('hotel_id', hotelId)
      .eq('sector_id', sectorId)
      .eq('product_id', item.product_id);
  }

  // 5. POST Erbon por item (best-effort)
  const erbonErrors: { productName: string; error: string }[] = [];
  let allErbon = true;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const insertedItem = insertedItems?.[i];

    if (!item.erbon_service_id || !erbonDepartmentId) {
      // Sem mapeamento — registrar como não lançado
      const reason = !item.erbon_service_id
        ? 'Produto sem mapeamento Erbon'
        : 'Setor sem ID de departamento Erbon';
      if (insertedItem) {
        await supabase
          .from('pdv_sale_items')
          .update({ erbon_posted: false, erbon_post_error: reason })
          .eq('id', insertedItem.id);
      }
      erbonErrors.push({ productName: item.product_name, error: reason });
      allErbon = false;
      continue;
    }

    const result = await erbonService.postChargeToBooking(hotelId, bookingInternalId, {
      idService: item.erbon_service_id,
      idDepartment: erbonDepartmentId,
      quantity: item.quantity,
      valueUnit: item.unit_price,
      serviceDescription: item.product_name,
      idSource: 'PDV',
    });

    if (insertedItem) {
      await supabase
        .from('pdv_sale_items')
        .update({
          erbon_posted: result.success,
          erbon_post_error: result.error ?? null,
        })
        .eq('id', insertedItem.id);
    }

    if (!result.success) {
      erbonErrors.push({ productName: item.product_name, error: result.error ?? 'Erro desconhecido' });
      allErbon = false;
    }
  }

  // 6. Atualizar cabeçalho da venda com resultado Erbon
  const errorSummary = erbonErrors.length > 0
    ? `${erbonErrors.length} item(s) não lançado(s): ${erbonErrors.map(e => e.productName).join(', ')}`
    : null;

  await supabase
    .from('pdv_sales')
    .update({
      erbon_posted: allErbon,
      erbon_post_error: errorSummary,
    })
    .eq('id', saleId);

  return {
    saleId,
    totalAmount,
    erbonPosted: allErbon,
    erbonErrors,
  };
}

/**
 * Re-tenta POST Erbon apenas para os itens que falharam anteriormente.
 * NÃO re-desconta estoque — só re-posta no PMS.
 */
export async function retryErbonPosting(
  saleId: string,
  hotelId: string
): Promise<SaleResult> {
  // Buscar venda e itens falhos
  const { data: sale } = await supabase
    .from('pdv_sales')
    .select('booking_internal_id, room_description, guest_name, total_amount, sector_id')
    .eq('id', saleId)
    .single();

  if (!sale) throw new Error('Venda não encontrada');

  // Buscar detalhes do setor para obter erbon_department_id
  const { data: sectorMapping } = await supabase
    .from('erbon_sector_mappings')
    .select('erbon_department_id')
    .eq('hotel_id', hotelId)
    .eq('sector_id', sale.sector_id)
    .maybeSingle();

  const erbonDepartmentId = sectorMapping?.erbon_department_id ?? null;

  const { data: failedItems } = await supabase
    .from('pdv_sale_items')
    .select('id, product_name, quantity, unit_price, erbon_service_id')
    .eq('sale_id', saleId)
    .eq('erbon_posted', false)
    .not('erbon_service_id', 'is', null);

  const erbonErrors: { productName: string; error: string }[] = [];
  let allSuccess = true;

  for (const item of failedItems || []) {
    if (!item.erbon_service_id || !erbonDepartmentId) {
      erbonErrors.push({ productName: item.product_name, error: 'Sem mapeamento completo' });
      allSuccess = false;
      continue;
    }

    const result = await erbonService.postChargeToBooking(hotelId, sale.booking_internal_id, {
      idService: item.erbon_service_id,
      idDepartment: erbonDepartmentId,
      quantity: Number(item.quantity),
      valueUnit: Number(item.unit_price),
      serviceDescription: item.product_name,
      idSource: 'PDV',
    });

    await supabase
      .from('pdv_sale_items')
      .update({
        erbon_posted: result.success,
        erbon_post_error: result.success ? null : result.error,
      })
      .eq('id', item.id);

    if (!result.success) {
      erbonErrors.push({ productName: item.product_name, error: result.error ?? 'Erro' });
      allSuccess = false;
    }
  }

  const errorSummary = erbonErrors.length > 0
    ? `${erbonErrors.length} item(s) não lançado(s): ${erbonErrors.map(e => e.productName).join(', ')}`
    : null;

  await supabase
    .from('pdv_sales')
    .update({
      erbon_posted: allSuccess,
      erbon_post_error: allSuccess ? null : errorSummary,
    })
    .eq('id', saleId);

  return {
    saleId,
    totalAmount: Number(sale.total_amount),
    erbonPosted: allSuccess,
    erbonErrors,
  };
}

/**
 * Busca o histórico de vendas PDV com filtros opcionais.
 */
export async function getSalesHistory(
  hotelId: string,
  filters: SalesHistoryFilters = {}
): Promise<PDVSaleHistory[]> {
  let query = supabase
    .from('pdv_sales')
    .select(`
      *,
      sectors!inner (name)
    `)
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters.startDate) query = query.gte('sale_date', filters.startDate);
  if (filters.endDate)   query = query.lte('sale_date', filters.endDate);
  if (filters.sectorId)  query = query.eq('sector_id', filters.sectorId);
  if (filters.erbonFailed) query = query.eq('erbon_posted', false);

  const { data: sales, error } = await query;
  if (error) throw error;

  const result: PDVSaleHistory[] = (sales || []).map((s: any) => ({
    ...s,
    sector_name: s.sectors?.name ?? '—',
  }));

  // Carregar itens se solicitado
  if (filters.includeItems && result.length > 0) {
    const saleIds = result.map(s => s.id);
    const { data: allItems } = await supabase
      .from('pdv_sale_items')
      .select('*')
      .in('sale_id', saleIds)
      .order('created_at');

    const itemMap = new Map<string, PDVSaleItem[]>();
    for (const item of allItems || []) {
      if (!itemMap.has(item.sale_id)) itemMap.set(item.sale_id, []);
      itemMap.get(item.sale_id)!.push(item as PDVSaleItem);
    }

    for (const sale of result) {
      sale.items = itemMap.get(sale.id) ?? [];
    }
  }

  return result;
}

/**
 * Cria ou atualiza o preço de venda de um produto para o hotel.
 */
export async function upsertProductPrice(
  hotelId: string,
  productId: string,
  salePrice: number,
  sectorId?: string | null
): Promise<void> {
  // Postgres NULL != NULL em unique constraints, então onConflict com sector_id=NULL
  // nunca dispara. Usamos SELECT→UPDATE/INSERT explícito.
  const query = supabase
    .from('pdv_prices')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('product_id', productId);

  if (sectorId == null) {
    query.is('sector_id', null);
  } else {
    query.eq('sector_id', sectorId);
  }

  const { data: existing, error: selectErr } = await query.maybeSingle();
  if (selectErr) throw selectErr;

  if (existing?.id) {
    const { error } = await supabase
      .from('pdv_prices')
      .update({ sale_price: salePrice, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('pdv_prices')
      .insert({
        hotel_id: hotelId,
        product_id: productId,
        sector_id: sectorId ?? null,
        sale_price: salePrice,
        updated_at: new Date().toISOString(),
      });
    if (error) throw error;
  }
}

/**
 * Busca todos os produtos do hotel com seus preços de venda (para aba de gestão de preços).
 */
export async function getProductsWithPrices(hotelId: string): Promise<{
  product_id: string;
  product_name: string;
  category: string;
  unit_measure: string;
  average_price: number;
  sale_price: number | null;
  erbon_service_id: number | null;
  erbon_service_description: string | null;
}[]> {
  const [productsResult, pricesResult, mappingsResult] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, category, unit_measure, average_price')
      .eq('hotel_id', hotelId)
      .eq('is_active', true)
      .order('category')
      .order('name'),
    supabase
      .from('pdv_prices')
      .select('product_id, sale_price')
      .eq('hotel_id', hotelId)
      .is('sector_id', null),
    supabase
      .from('erbon_product_mappings')
      .select('product_id, erbon_service_id, erbon_service_description')
      .eq('hotel_id', hotelId)
      .not('product_id', 'is', null),
  ]);

  const priceMap = new Map<string, number>();
  for (const p of pricesResult.data || []) priceMap.set(p.product_id, Number(p.sale_price));

  const mappingMap = new Map<string, { erbon_service_id: number; erbon_service_description: string | null }>();
  for (const m of mappingsResult.data || []) {
    if (m.product_id) mappingMap.set(m.product_id, { erbon_service_id: m.erbon_service_id, erbon_service_description: m.erbon_service_description });
  }

  return (productsResult.data || []).map((p: any) => ({
    product_id: p.id,
    product_name: p.name,
    category: p.category || 'Outros',
    unit_measure: p.unit_measure || 'und',
    average_price: Number(p.average_price ?? 0),
    sale_price: priceMap.has(p.id) ? priceMap.get(p.id)! : null,
    erbon_service_id: mappingMap.get(p.id)?.erbon_service_id ?? null,
    erbon_service_description: mappingMap.get(p.id)?.erbon_service_description ?? null,
  }));
}
