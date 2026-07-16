// nfService.ts — CRUD de configuração e notas fiscais (NF-e / NFS-e)

import { supabase } from './supabase';
import type {
  NFHotelConfig,
  NFInvoice,
  NFInvoiceItem,
  NFEmittedEntry,
  NFTipo,
  NFDocTipo,
  NFReceived,
  TipoManifestacao,
} from '../types/nf';

const NF_PROXY = import.meta.env.PROD
  ? '/.netlify/functions/nf-proxy'
  : '/.netlify/functions/nf-proxy';

// ─── Tipos para resolução fiscal ─────────────────────────────────────────────

export interface FiscalLineItem {
  erbon_entry_id: number;
  erbon_description: string;
  erbon_service_id: number | null;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  // Dados fiscais resolvidos
  product_id: string | null;
  product_name: string | null;
  ncm: string | null;
  tax_percentage: number;
  // Origem
  source: 'product' | 'dish_ingredient' | 'unmapped';
  dish_name: string | null;
  warnings: string[];
}

export interface FiscalResolutionResult {
  items: FiscalLineItem[];
  warnings: string[];
  hasErrors: boolean;
}

// ─── Resolução fiscal: Erbon entry → NCM + imposto ──────────────────────────

async function resolveEntryFiscalData(
  hotelId: string,
  entries: Array<{
    id: number;
    description: string;
    amount: number;
    idDepartment: number;
  }>,
): Promise<FiscalResolutionResult> {
  const globalWarnings: string[] = [];
  const items: FiscalLineItem[] = [];

  // 1. Buscar todos os mapeamentos Erbon do hotel
  const { data: mappings, error: mapErr } = await supabase
    .from('erbon_product_mappings')
    .select('erbon_service_id, product_id, dish_id, erbon_service_description')
    .eq('hotel_id', hotelId);
  if (mapErr) throw mapErr;

  const mappingByService = new Map<number, { product_id: string | null; dish_id: string | null; desc: string | null }>();
  (mappings ?? []).forEach((m: { erbon_service_id: number; product_id: string | null; dish_id: string | null; erbon_service_description: string | null }) => {
    mappingByService.set(m.erbon_service_id, {
      product_id: m.product_id,
      dish_id: m.dish_id,
      desc: m.erbon_service_description,
    });
  });

  // 2. Coletar todos os dish_ids e product_ids que vamos precisar
  const neededDishIds = new Set<string>();
  const neededProductIds = new Set<string>();

  // Primeiro pass: identificar o que precisamos buscar
  // Nota: o erbon_service_id não vem no CurrentAccountEntry, então tentamos
  // encontrar o mapeamento pela description (match parcial) ou usamos todos
  // os mapeamentos disponíveis
  for (const entry of entries) {
    // Tentar encontrar mapeamento: procurar por description match
    let matched = false;
    for (const [_svcId, map] of mappingByService) {
      if (map.desc && entry.description.toLowerCase().includes(map.desc.toLowerCase())) {
        if (map.dish_id) neededDishIds.add(map.dish_id);
        if (map.product_id) neededProductIds.add(map.product_id);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Tentar match exato pela description como service_description
      for (const [_svcId, map] of mappingByService) {
        if (map.desc && map.desc.toLowerCase() === entry.description.toLowerCase()) {
          if (map.dish_id) neededDishIds.add(map.dish_id);
          if (map.product_id) neededProductIds.add(map.product_id);
          matched = true;
          break;
        }
      }
    }
  }

  // 3. Buscar fichas técnicas (dishes) e seus ingredientes
  let dishIngredients: Array<{
    dish_id: string;
    dish_name: string;
    ingredient_id: string;
    quantity: number;
    product_id: string | null;
    product_name: string | null;
    ncm: string | null;
    tax_percentage: number;
  }> = [];

  if (neededDishIds.size > 0) {
    const { data: dishes } = await supabase
      .from('dishes')
      .select('id, name')
      .in('id', Array.from(neededDishIds));

    const dishNameMap = new Map<string, string>();
    (dishes ?? []).forEach((d: { id: string; name: string }) => dishNameMap.set(d.id, d.name));

    const { data: diRows } = await supabase
      .from('dish_ingredients')
      .select(`
        dish_id,
        quantity,
        ingredient_id,
        ingredients!inner (
          id,
          name,
          product_id,
          products (
            id,
            name,
            mcu_code,
            tax_percentage
          )
        )
      `)
      .in('dish_id', Array.from(neededDishIds));

    (diRows ?? []).forEach((row: any) => {
      const ing = row.ingredients;
      const prod = ing?.products;
      dishIngredients.push({
        dish_id: row.dish_id,
        dish_name: dishNameMap.get(row.dish_id) || '?',
        ingredient_id: ing?.id || row.ingredient_id,
        quantity: row.quantity || 1,
        product_id: prod?.id || ing?.product_id || null,
        product_name: prod?.name || ing?.name || null,
        ncm: prod?.mcu_code || null,
        tax_percentage: prod?.tax_percentage ?? 0,
      });
    });
  }

  // 4. Buscar produtos diretos
  let directProducts: Map<string, { name: string; ncm: string | null; tax_percentage: number }> = new Map();
  if (neededProductIds.size > 0) {
    const { data: prods } = await supabase
      .from('products')
      .select('id, name, mcu_code, tax_percentage')
      .in('id', Array.from(neededProductIds));

    (prods ?? []).forEach((p: { id: string; name: string; mcu_code: string | null; tax_percentage: number | null }) => {
      directProducts.set(p.id, {
        name: p.name,
        ncm: p.mcu_code,
        tax_percentage: p.tax_percentage ?? 0,
      });
    });
  }

  // 5. Resolver cada entry
  for (const entry of entries) {
    let mapping: { product_id: string | null; dish_id: string | null; desc: string | null; svcId: number } | null = null;

    // Buscar mapeamento por description
    for (const [svcId, map] of mappingByService) {
      if (map.desc && (
        entry.description.toLowerCase().includes(map.desc.toLowerCase()) ||
        map.desc.toLowerCase() === entry.description.toLowerCase()
      )) {
        mapping = { ...map, svcId };
        break;
      }
    }

    if (!mapping) {
      // Sem mapeamento encontrado
      items.push({
        erbon_entry_id: entry.id,
        erbon_description: entry.description,
        erbon_service_id: null,
        quantidade: 1,
        valor_unitario: entry.amount,
        valor_total: entry.amount,
        product_id: null,
        product_name: null,
        ncm: null,
        tax_percentage: 0,
        source: 'unmapped',
        dish_name: null,
        warnings: [`Produto "${entry.description}" não possui mapeamento Erbon → Fluxo`],
      });
      globalWarnings.push(`"${entry.description}" sem mapeamento`);
      continue;
    }

    // Rota A: Ficha técnica (dish)
    if (mapping.dish_id) {
      const ingredients = dishIngredients.filter(di => di.dish_id === mapping!.dish_id);
      if (ingredients.length === 0) {
        items.push({
          erbon_entry_id: entry.id,
          erbon_description: entry.description,
          erbon_service_id: mapping.svcId,
          quantidade: 1,
          valor_unitario: entry.amount,
          valor_total: entry.amount,
          product_id: null,
          product_name: null,
          ncm: null,
          tax_percentage: 0,
          source: 'dish_ingredient',
          dish_name: dishIngredients.find(d => d.dish_id === mapping!.dish_id)?.dish_name || entry.description,
          warnings: [`Ficha técnica sem ingredientes cadastrados`],
        });
        globalWarnings.push(`Ficha técnica de "${entry.description}" sem ingredientes`);
        continue;
      }

      // Calcular proporção de cada ingrediente no valor total
      const totalIngQty = ingredients.reduce((s, i) => s + i.quantity, 0);

      for (const ing of ingredients) {
        const proportion = totalIngQty > 0 ? ing.quantity / totalIngQty : 1 / ingredients.length;
        const valorItem = Math.round(entry.amount * proportion * 100) / 100;
        const w: string[] = [];

        if (!ing.product_id) w.push(`Ingrediente "${ing.product_name || '?'}" sem produto vinculado`);
        if (!ing.ncm) w.push(`NCM ausente para "${ing.product_name || '?'}"`);

        if (w.length) globalWarnings.push(...w);

        items.push({
          erbon_entry_id: entry.id,
          erbon_description: entry.description,
          erbon_service_id: mapping.svcId,
          quantidade: ing.quantity,
          valor_unitario: totalIngQty > 0 ? Math.round((entry.amount / totalIngQty) * 100) / 100 : valorItem,
          valor_total: valorItem,
          product_id: ing.product_id,
          product_name: ing.product_name,
          ncm: ing.ncm,
          tax_percentage: ing.tax_percentage,
          source: 'dish_ingredient',
          dish_name: ing.dish_name,
          warnings: w,
        });
      }
      continue;
    }

    // Rota B: Produto direto
    if (mapping.product_id) {
      const prod = directProducts.get(mapping.product_id);
      const w: string[] = [];

      if (!prod) w.push(`Produto mapeado não encontrado no banco`);
      if (prod && !prod.ncm) w.push(`NCM ausente para "${prod.name}"`);

      if (w.length) globalWarnings.push(...w);

      items.push({
        erbon_entry_id: entry.id,
        erbon_description: entry.description,
        erbon_service_id: mapping.svcId,
        quantidade: 1,
        valor_unitario: entry.amount,
        valor_total: entry.amount,
        product_id: mapping.product_id,
        product_name: prod?.name || entry.description,
        ncm: prod?.ncm || null,
        tax_percentage: prod?.tax_percentage ?? 0,
        source: 'product',
        dish_name: null,
        warnings: w,
      });
      continue;
    }

    // Nenhum target
    items.push({
      erbon_entry_id: entry.id,
      erbon_description: entry.description,
      erbon_service_id: mapping.svcId,
      quantidade: 1,
      valor_unitario: entry.amount,
      valor_total: entry.amount,
      product_id: null,
      product_name: null,
      ncm: null,
      tax_percentage: 0,
      source: 'unmapped',
      dish_name: null,
      warnings: ['Mapeamento existe mas sem produto nem ficha técnica vinculados'],
    });
    globalWarnings.push(`"${entry.description}" mapeado sem target`);
  }

  const hasErrors = items.some(i =>
    i.source === 'unmapped' || i.warnings.some(w => w.includes('NCM ausente') || w.includes('sem mapeamento'))
  );

  return { items, warnings: globalWarnings, hasErrors };
}

// ─── Resolução fiscal de SERVIÇOS: entry → serviço do catálogo ───────────────
// Usa os mapeamentos Erbon (erbon_product_mappings.service_id) para atrelar o
// lançamento da conta corrente a um serviço do catálogo e obter a tributação
// NFS-e por item. Sem mapeamento → fallback para nf_hotel_config.

export interface ServiceFiscalItem {
  erbon_entry_id: number;
  service_id: string | null;
  service_name: string | null;
  /** Discriminação padrão do serviço (usada na nota se existir) */
  descricao_padrao: string | null;
  codigo_servico: string | null;   // item LC 116
  iss_aliquota: number | null;
  iss_retained: boolean;
  source: 'service' | 'fallback';
  warnings: string[];
}

export interface ServiceFiscalResult {
  items: ServiceFiscalItem[];
  warnings: string[];
}

async function resolveServiceFiscalData(
  hotelId: string,
  entries: Array<{ id: number; description: string; amount: number; service_id?: string | null }>,
): Promise<ServiceFiscalResult> {
  const globalWarnings: string[] = [];

  // Serviços apontados diretamente (lançamentos internos já trazem service_id)
  const directIds = [...new Set(entries.map(e => e.service_id).filter(Boolean))] as string[];
  const directServices = new Map<string, { id: string; name: string; description: string | null; lc116_code: string | null; iss_rate: number | null; iss_retained: boolean }>();
  if (directIds.length > 0) {
    const { data: svcs } = await supabase
      .from('services')
      .select('id, name, description, lc116_code, iss_rate, iss_retained')
      .in('id', directIds);
    (svcs ?? []).forEach((s: any) => directServices.set(s.id, s));
  }

  // Mapeamentos Erbon → serviço do catálogo (com a tributação do serviço)
  const { data: mappings, error: mapErr } = await supabase
    .from('erbon_product_mappings')
    .select(`
      erbon_service_id,
      erbon_service_description,
      service_id,
      services (
        id, name, description, lc116_code, iss_rate, iss_retained, is_active
      )
    `)
    .eq('hotel_id', hotelId)
    .not('service_id', 'is', null);
  if (mapErr) throw mapErr;

  // Fallback: tributação única do hotel
  const { data: cfg } = await supabase
    .from('nf_hotel_config')
    .select('codigo_servico, aliquota_iss')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  interface MappedService {
    desc: string | null;
    service: { id: string; name: string; description: string | null; lc116_code: string | null; iss_rate: number | null; iss_retained: boolean; is_active: boolean } | null;
  }
  const mapped: MappedService[] = (mappings ?? []).map((m: any) => ({
    desc: m.erbon_service_description,
    service: m.services ?? null,
  }));

  const items: ServiceFiscalItem[] = entries.map(entry => {
    // 1º: serviço apontado diretamente pelo lançamento (reservas internas)
    const direct = entry.service_id ? directServices.get(entry.service_id) : undefined;
    // 2º: match por descrição — o CurrentAccountEntry da Erbon não expõe
    // erbon_service_id (mesma heurística da resolução de produtos)
    const entryDesc = entry.description.toLowerCase();
    const match = direct ? null : mapped.find(m =>
      m.service?.is_active && m.desc && (
        entryDesc.includes(m.desc.toLowerCase()) ||
        m.desc.toLowerCase() === entryDesc
      )
    );

    if (direct || match?.service) {
      const s = (direct || match!.service)!;
      const w: string[] = [];
      if (!s.lc116_code) w.push(`Serviço "${s.name}" sem código LC 116 cadastrado`);
      if (s.iss_rate == null) w.push(`Serviço "${s.name}" sem alíquota ISS cadastrada`);
      if (w.length) globalWarnings.push(...w);
      return {
        erbon_entry_id: entry.id,
        service_id: s.id,
        service_name: s.name,
        descricao_padrao: s.description,
        codigo_servico: s.lc116_code,
        iss_aliquota: s.iss_rate,
        iss_retained: s.iss_retained,
        source: 'service' as const,
        warnings: w,
      };
    }

    // Fallback para a config do hotel
    const w = [`"${entry.description}" sem serviço do catálogo mapeado — usando tributação padrão do hotel`];
    globalWarnings.push(...w);
    return {
      erbon_entry_id: entry.id,
      service_id: null,
      service_name: null,
      descricao_padrao: null,
      codigo_servico: cfg?.codigo_servico ?? null,
      iss_aliquota: cfg?.aliquota_iss ?? null,
      iss_retained: false,
      source: 'fallback' as const,
      warnings: w,
    };
  });

  return { items, warnings: globalWarnings };
}

// ─── Config CRUD ─────────────────────────────────────────────────────────────

async function getConfig(hotelId: string): Promise<NFHotelConfig | null> {
  const { data, error } = await supabase
    .from('nf_hotel_config')
    .select('*')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  if (error) throw error;
  return data as NFHotelConfig | null;
}

async function saveConfig(hotelId: string, config: Partial<NFHotelConfig>): Promise<NFHotelConfig> {
  const payload = { ...config, hotel_id: hotelId, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('nf_hotel_config')
    .upsert(payload, { onConflict: 'hotel_id' })
    .select()
    .single();
  if (error) throw error;
  return data as NFHotelConfig;
}

// ─── Invoices CRUD ───────────────────────────────────────────────────────────

async function getInvoices(
  hotelId: string,
  filters?: { tipo?: NFTipo; bookingId?: number; status?: string },
): Promise<NFInvoice[]> {
  let query = supabase
    .from('nf_invoices')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false });

  if (filters?.tipo) query = query.eq('tipo', filters.tipo);
  if (filters?.bookingId) query = query.eq('erbon_booking_id', filters.bookingId);
  if (filters?.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as NFInvoice[];
}

async function getInvoiceItems(invoiceId: string): Promise<NFInvoiceItem[]> {
  const { data, error } = await supabase
    .from('nf_invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as NFInvoiceItem[];
}

// ─── Emitted Entries (rastreio de itens já faturados) ────────────────────────

async function getEmittedEntries(hotelId: string): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from('nf_emitted_entries')
    .select('erbon_entry_id, invoice_id')
    .eq('hotel_id', hotelId);
  if (error) throw error;
  const map = new Map<number, string>();
  (data ?? []).forEach((row: NFEmittedEntry) => map.set(row.erbon_entry_id, row.invoice_id));
  return map;
}

async function markEntriesAsEmitted(
  hotelId: string,
  entryIds: number[],
  invoiceId: string,
): Promise<void> {
  const rows = entryIds.map((eid) => ({
    hotel_id: hotelId,
    erbon_entry_id: eid,
    invoice_id: invoiceId,
  }));
  const { error } = await supabase.from('nf_emitted_entries').insert(rows);
  if (error) throw error;
}

// ─── Draft + Emit ────────────────────────────────────────────────────────────

interface CreateInvoiceInput {
  hotel_id: string;
  tipo: NFTipo;
  erbon_booking_id: number | null;
  booking_number: string | null;
  room_description: string | null;
  tomador_nome: string;
  tomador_cpf_cnpj: string | null;
  tomador_doc_tipo: NFDocTipo;
  tomador_nacionalidade: string | null;
  tomador_email: string | null;
  tomador_endereco: string | null;
  items: Array<{
    erbon_entry_id: number | null;
    descricao: string;
    quantidade: number;
    valor_unitario: number;
    valor_total: number;
    ncm?: string | null;
    cfop?: string | null;
    icms_aliquota?: number | null;
    icms_valor?: number | null;
    codigo_servico?: string | null;
    iss_aliquota?: number | null;
    iss_valor?: number | null;
  }>;
  emitido_por: string | null;
}

async function createDraftInvoice(input: CreateInvoiceInput): Promise<NFInvoice> {
  const valorTotal = input.items.reduce((sum, i) => sum + i.valor_total, 0);

  const { data: invoice, error: invErr } = await supabase
    .from('nf_invoices')
    .insert({
      hotel_id: input.hotel_id,
      tipo: input.tipo,
      erbon_booking_id: input.erbon_booking_id,
      booking_number: input.booking_number,
      room_description: input.room_description,
      tomador_nome: input.tomador_nome,
      tomador_cpf_cnpj: input.tomador_cpf_cnpj,
      tomador_doc_tipo: input.tomador_doc_tipo,
      tomador_nacionalidade: input.tomador_nacionalidade,
      tomador_email: input.tomador_email,
      tomador_endereco: input.tomador_endereco,
      valor_total: valorTotal,
      status: 'rascunho',
      emitido_por: input.emitido_por,
    })
    .select()
    .single();
  if (invErr) throw invErr;

  const itemRows = input.items.map((it) => ({
    invoice_id: invoice.id,
    erbon_entry_id: it.erbon_entry_id,
    descricao: it.descricao,
    quantidade: it.quantidade,
    valor_unitario: it.valor_unitario,
    valor_total: it.valor_total,
    ncm: it.ncm ?? null,
    cfop: it.cfop ?? null,
    icms_aliquota: it.icms_aliquota ?? null,
    icms_valor: it.icms_valor ?? null,
    codigo_servico: it.codigo_servico ?? null,
    iss_aliquota: it.iss_aliquota ?? null,
    iss_valor: it.iss_valor ?? null,
  }));

  const { error: itemsErr } = await supabase.from('nf_invoice_items').insert(itemRows);
  if (itemsErr) throw itemsErr;

  return invoice as NFInvoice;
}

async function emitInvoice(invoiceId: string, hotelId: string): Promise<{ success: boolean; message: string; invoice?: NFInvoice }> {
  try {
    const { data: inv } = await supabase
      .from('nf_invoices')
      .select('tipo, tomador_nome, tomador_cpf_cnpj, tomador_doc_tipo, tomador_email, tomador_endereco')
      .eq('id', invoiceId)
      .single();

    const config = await getConfig(hotelId);
    const useADN = inv?.tipo === 'nfse' && config?.nfse_provider === 'adn';

    let proxyAction: string;
    let bodyPayload: Record<string, unknown>;

    if (useADN) {
      const { data: items } = await supabase
        .from('nf_invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId);

      proxyAction = 'emit-nfse-adn';
      bodyPayload = {
        action: proxyAction,
        certificado_base64: config!.certificado_base64,
        certificado_senha: config!.certificado_senha,
        ambiente: config!.adn_ambiente || 'homologacao',
        config: {
          cnpj: config!.cnpj,
          inscricao_municipal: config!.inscricao_municipal,
          razao_social: config!.razao_social,
          nome_fantasia: config!.nome_fantasia,
          endereco_logradouro: config!.endereco_logradouro,
          endereco_numero: config!.endereco_numero,
          endereco_complemento: config!.endereco_complemento,
          endereco_bairro: config!.endereco_bairro,
          endereco_cidade: config!.endereco_cidade,
          endereco_uf: config!.endereco_uf,
          endereco_cep: config!.endereco_cep,
          endereco_codigo_municipio: config!.endereco_codigo_municipio,
          telefone: config!.telefone,
          email: config!.email,
          regime_tributario_nfse: config!.regime_tributario_nfse,
          codigo_servico: config!.codigo_servico,
          aliquota_iss: config!.aliquota_iss,
        },
        tomador: {
          nome: inv!.tomador_nome,
          doc_tipo: inv!.tomador_doc_tipo,
          doc_numero: inv!.tomador_cpf_cnpj,
          email: inv!.tomador_email,
          endereco: inv!.tomador_endereco,
        },
        items: (items || []).map((i: NFInvoiceItem) => ({
          descricao: i.descricao,
          quantidade: i.quantidade,
          valor_unitario: i.valor_unitario,
          valor_total: i.valor_total,
          codigo_servico: i.codigo_servico,
          iss_aliquota: i.iss_aliquota,
        })),
        serie: config!.serie_nfse || 'NFS',
        numeroDPS: config!.proximo_numero_nfse || 1,
      };
    } else if (inv?.tipo === 'nfse') {
      // NFS-e via Prefeitura (ABRASF 2.02 real)
      const { data: items } = await supabase
        .from('nf_invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId);

      proxyAction = 'emit';
      bodyPayload = {
        action: proxyAction,
        certificado_base64: config!.certificado_base64,
        certificado_senha: config!.certificado_senha,
        ambiente: config!.ambiente || 'producao',
        cnpj: config!.cnpj,
        inscricao_municipal: config!.inscricao_municipal,
        tomador_nome: inv.tomador_nome,
        tomador_cpf_cnpj: inv.tomador_cpf_cnpj,
        tomador_doc_tipo: inv.tomador_doc_tipo,
        tomador_email: inv.tomador_email,
        tomador_endereco: inv.tomador_endereco,
        items: (items || []).map((i: NFInvoiceItem) => ({
          description: i.descricao,
          quantidade: i.quantidade,
          valor_unitario: i.valor_unitario,
          valor_total: i.valor_total,
        })),
        codigo_municipio: config!.endereco_codigo_municipio || '3300233',
        codigo_servico: config!.codigo_servico || '0901',
        aliquota_iss: config!.aliquota_iss ?? 5,
        regime_tributario: config!.regime_tributario_nfse,
        optante_simples: config!.regime_tributario_nfse === '1',
        numero_rps: config!.proximo_numero_nfse || 1,
        serie_rps: config!.serie_nfse || 'RPS',
      };
    } else if (inv?.tipo === 'nfce') {
      const { data: items } = await supabase
        .from('nf_invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId);

      proxyAction = 'emit-nfce';
      bodyPayload = {
        action: proxyAction,
        certificado_base64: config!.certificado_base64,
        certificado_senha: config!.certificado_senha,
        ambiente: config!.ambiente || 'homologacao',
        cnpj: config!.cnpj,
        razao_social: config!.razao_social,
        nome_fantasia: config!.nome_fantasia,
        inscricao_estadual: config!.inscricao_estadual,
        crt: config!.crt || 1,
        endereco_logradouro: config!.endereco_logradouro,
        endereco_numero: config!.endereco_numero,
        endereco_bairro: config!.endereco_bairro,
        endereco_cidade: config!.endereco_cidade,
        endereco_uf: config!.endereco_uf,
        endereco_cep: config!.endereco_cep,
        endereco_codigo_municipio: config!.endereco_codigo_municipio,
        telefone: config!.telefone,
        tomador_nome: inv.tomador_nome,
        tomador_cpf_cnpj: inv.tomador_cpf_cnpj,
        tomador_doc_tipo: inv.tomador_doc_tipo,
        items: (items || []).map((i: NFInvoiceItem) => ({
          description: i.descricao,
          quantidade: i.quantidade,
          valor_unitario: i.valor_unitario,
          valor_total: i.valor_total,
          ncm: i.ncm || '00000000',
          cfop: i.cfop || '5102',
          icms_orig: '0',
          icms_csosn: (config!.crt === 1 || config!.crt === 2) ? '102' : undefined,
          icms_cst: (config!.crt === 3) ? '00' : undefined,
          icms_vBC: (config!.crt === 3) ? i.valor_total : 0,
          icms_pICMS: (config!.crt === 3) ? (i.icms_aliquota ?? 0) : 0,
          icms_vICMS: (config!.crt === 3) ? (i.icms_valor ?? 0) : 0,
        })),
        serie_nfce: config!.serie_nfce || '1',
        nfce_csc_id: config!.nfce_csc_id,
        nfce_csc_token: config!.nfce_csc_token,
        numero_nfce: config!.proximo_numero_nfce || 1,
        tPag: '01',
      };
    } else if (inv?.tipo === 'nfe') {
      const { data: items } = await supabase
        .from('nf_invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId);

      // indIEDest: 1=contribuinte ICMS, 2=isento, 9=não contribuinte (consumidor)
      const isCnpj = inv.tomador_doc_tipo === 'cnpj';
      const indIE: '1' | '2' | '9' = isCnpj ? '1' : '9';

      proxyAction = 'emit-nfe';
      bodyPayload = {
        action: proxyAction,
        certificado_base64: config!.certificado_base64,
        certificado_senha: config!.certificado_senha,
        ambiente: config!.ambiente || 'homologacao',
        cnpj: config!.cnpj,
        razao_social: config!.razao_social,
        nome_fantasia: config!.nome_fantasia,
        inscricao_estadual: config!.inscricao_estadual,
        crt: config!.crt || 1,
        endereco_logradouro: config!.endereco_logradouro,
        endereco_numero: config!.endereco_numero,
        endereco_bairro: config!.endereco_bairro,
        endereco_cidade: config!.endereco_cidade,
        endereco_uf: config!.endereco_uf,
        endereco_cep: config!.endereco_cep,
        endereco_codigo_municipio: config!.endereco_codigo_municipio,
        telefone: config!.telefone,
        tomador_nome: inv.tomador_nome,
        tomador_cpf_cnpj: inv.tomador_cpf_cnpj,
        tomador_doc_tipo: inv.tomador_doc_tipo,
        tomador_ind_ie: indIE,
        tomador_email: inv.tomador_email,
        tomador_endereco: inv.tomador_endereco,
        items: (items || []).map((i: NFInvoiceItem) => ({
          description: i.descricao,
          quantidade: i.quantidade,
          valor_unitario: i.valor_unitario,
          valor_total: i.valor_total,
          ncm: i.ncm || '00000000',
          cfop: i.cfop || '5102',
          icms_orig: '0',
          icms_csosn: (config!.crt === 1 || config!.crt === 2) ? '102' : undefined,
          icms_cst: (config!.crt === 3) ? '00' : undefined,
          icms_vBC: (config!.crt === 3) ? i.valor_total : 0,
          icms_pICMS: (config!.crt === 3) ? (i.icms_aliquota ?? 0) : 0,
          icms_vICMS: (config!.crt === 3) ? (i.icms_valor ?? 0) : 0,
        })),
        serie_nfe: config!.serie_nfe || '1',
        numero_nfe: config!.proximo_numero_nfe || 1,
        natureza_operacao: 'VENDA DE MERCADORIA',
        tPag: '01',
      };
    } else {
      proxyAction = 'emit';
      bodyPayload = { action: proxyAction, invoiceId, hotelId };
    }

    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nf-action': proxyAction,
      },
      body: JSON.stringify(bodyPayload),
    });

    const result = await res.json();

    if (!res.ok || result.success === false) {
      await supabase
        .from('nf_invoices')
        .update({
          status: 'rejeitada',
          xml_retorno: result.xml_retorno || null,
        })
        .eq('id', invoiceId);
      return { success: false, message: result.message || result.error || 'Erro ao emitir nota fiscal' };
    }

    const updateData: Record<string, unknown> = {
      status: 'autorizada',
      numero_nf: result.numero_nf || null,
      serie: result.serie || null,
      chave_acesso: result.chave_acesso || null,
      numero_protocolo: result.numero_protocolo || null,
      codigo_verificacao: result.codigo_verificacao || null,
      xml_retorno: result.xml_retorno || null,
      pdf_url: result.pdf_url || null,
      qrcode_url: result.qrcode_url || null,
      url_consulta: result.url_consulta || null,
    };

    if (useADN) {
      updateData.nfse_provider = 'adn';
      updateData.xml_dps = result.xml_dps || null;
    } else {
      updateData.nfse_provider = inv?.tipo === 'nfse' ? 'prefeitura' : null;
    }

    const { data: updated, error } = await supabase
      .from('nf_invoices')
      .update(updateData)
      .eq('id', invoiceId)
      .select()
      .single();
    if (error) throw error;

    // Incrementar próximo número
    if (config && result.success) {
      if (inv?.tipo === 'nfse') {
        await supabase
          .from('nf_hotel_config')
          .update({ proximo_numero_nfse: (config.proximo_numero_nfse || 1) + 1 })
          .eq('hotel_id', hotelId);
      } else if (inv?.tipo === 'nfce') {
        await supabase
          .from('nf_hotel_config')
          .update({ proximo_numero_nfce: (config.proximo_numero_nfce || 1) + 1 })
          .eq('hotel_id', hotelId);
      } else if (inv?.tipo === 'nfe') {
        await supabase
          .from('nf_hotel_config')
          .update({ proximo_numero_nfe: (config.proximo_numero_nfe || 1) + 1 })
          .eq('hotel_id', hotelId);
      }
    }

    // Marcar entries como emitidas
    const { data: items } = await supabase
      .from('nf_invoice_items')
      .select('erbon_entry_id')
      .eq('invoice_id', invoiceId);

    if (items?.length) {
      const entryIds = items
        .map((i: { erbon_entry_id: number | null }) => i.erbon_entry_id)
        .filter((id): id is number => id != null);
      if (entryIds.length > 0) {
        await markEntriesAsEmitted(hotelId, entryIds, invoiceId);
      }
    }

    return { success: true, message: 'Nota fiscal autorizada com sucesso', invoice: updated as NFInvoice };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, message };
  }
}

async function cancelInvoice(
  invoiceId: string,
  motivo: string,
  canceladoPor: string | null,
): Promise<{ success: boolean; message: string }> {
  try {
    const { data: inv } = await supabase
      .from('nf_invoices')
      .select('nfse_provider, chave_acesso, hotel_id')
      .eq('id', invoiceId)
      .single();

    const config = await getConfig(inv!.hotel_id);
    let proxyAction = 'cancel';
    let bodyPayload: Record<string, unknown>;

    if (inv?.nfse_provider === 'adn' && inv.chave_acesso) {
      proxyAction = 'cancel-nfse-adn';
      bodyPayload = {
        action: proxyAction,
        certificado_base64: config?.certificado_base64,
        certificado_senha: config?.certificado_senha,
        chaveAcesso: inv.chave_acesso,
        motivo,
        ambiente: config?.adn_ambiente || 'homologacao',
      };
    } else {
      const { data: invFull } = await supabase
        .from('nf_invoices')
        .select('numero_nf')
        .eq('id', invoiceId)
        .single();

      bodyPayload = {
        action: 'cancel',
        certificado_base64: config?.certificado_base64,
        certificado_senha: config?.certificado_senha,
        ambiente: config?.ambiente || 'producao',
        cnpj: config?.cnpj,
        inscricao_municipal: config?.inscricao_municipal,
        numero_nf: invFull?.numero_nf,
        codigo_municipio: config?.endereco_codigo_municipio || '3300233',
        motivo,
      };
    }

    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nf-action': proxyAction,
      },
      body: JSON.stringify(bodyPayload),
    });

    const result = await res.json();

    if (!res.ok) {
      return { success: false, message: result.error || 'Erro ao cancelar nota fiscal' };
    }

    await supabase
      .from('nf_invoices')
      .update({
        status: 'cancelada',
        cancelada_em: new Date().toISOString(),
        motivo_cancelamento: motivo,
        xml_cancelamento: result.xml_cancelamento || null,
        cancelado_por: canceladoPor,
      })
      .eq('id', invoiceId);

    // Remover rastreio das entries emitidas
    await supabase
      .from('nf_emitted_entries')
      .delete()
      .eq('invoice_id', invoiceId);

    return { success: true, message: 'Nota fiscal cancelada com sucesso' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, message };
  }
}

// ─── DANFSE (PDF do ADN) ───────────────────────────────────────────────────

async function fetchDANFSE(
  invoiceId: string,
): Promise<{ success: boolean; pdfBase64?: string; message: string }> {
  try {
    const { data: inv } = await supabase
      .from('nf_invoices')
      .select('chave_acesso, hotel_id, nfse_provider')
      .eq('id', invoiceId)
      .single();

    if (!inv?.chave_acesso || inv.nfse_provider !== 'adn') {
      return { success: false, message: 'DANFSE disponível apenas para NFS-e emitidas via ADN.' };
    }

    const config = await getConfig(inv.hotel_id);
    if (!config?.certificado_base64) {
      return { success: false, message: 'Certificado digital não configurado.' };
    }

    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nf-action': 'danfse-adn',
      },
      body: JSON.stringify({
        action: 'danfse-adn',
        certificado_base64: config.certificado_base64,
        certificado_senha: config.certificado_senha,
        chaveAcesso: inv.chave_acesso,
        ambiente: config.adn_ambiente || 'homologacao',
      }),
    });

    const result = await res.json();

    if (!res.ok || !result.success) {
      return { success: false, message: result.error || 'Erro ao obter DANFSE.' };
    }

    return { success: true, pdfBase64: result.pdfBase64, message: 'DANFSE obtido com sucesso.' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, message };
  }
}

// ─── Emissão em lote ────────────────────────────────────────────────────────

export interface BatchEmissionProgress {
  total: number;
  current: number;
  successes: number;
  failures: number;
  currentLabel: string;
}

async function batchEmitInvoices(
  invoiceIds: string[],
  hotelId: string,
  onProgress?: (progress: BatchEmissionProgress) => void,
  delayMs = 1000,
): Promise<{ successes: string[]; failures: Array<{ invoiceId: string; error: string }> }> {
  const successes: string[] = [];
  const failures: Array<{ invoiceId: string; error: string }> = [];

  for (let i = 0; i < invoiceIds.length; i++) {
    const invoiceId = invoiceIds[i];
    onProgress?.({
      total: invoiceIds.length,
      current: i + 1,
      successes: successes.length,
      failures: failures.length,
      currentLabel: `Emitindo nota ${i + 1} de ${invoiceIds.length}...`,
    });

    const result = await emitInvoice(invoiceId, hotelId);
    if (result.success) {
      successes.push(invoiceId);
    } else {
      failures.push({ invoiceId, error: result.message });
    }

    // Delay entre emissões para respeitar rate limits
    if (i < invoiceIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return { successes, failures };
}

// ─── Contingência ───────────────────────────────────────────────────────────

async function emitContingencia(
  invoiceId: string,
  hotelId: string,
  motivo: string,
): Promise<{ success: boolean; message: string; invoice?: NFInvoice }> {
  try {
    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nf-action': 'contingencia',
      },
      body: JSON.stringify({ action: 'contingencia', invoiceId, hotelId, motivo }),
    });

    const result = await res.json();

    const { data: updated, error } = await supabase
      .from('nf_invoices')
      .update({
        status: 'contingencia',
        contingencia_motivo: motivo,
        contingencia_em: new Date().toISOString(),
        numero_rps: result.numero_rps || null,
        contingencia_protocolo: result.contingencia_protocolo || null,
      })
      .eq('id', invoiceId)
      .select()
      .single();
    if (error) throw error;

    // Marcar entries como emitidas (em contingência, já vale)
    const { data: items } = await supabase
      .from('nf_invoice_items')
      .select('erbon_entry_id')
      .eq('invoice_id', invoiceId);

    if (items?.length) {
      const entryIds = items
        .map((i: { erbon_entry_id: number | null }) => i.erbon_entry_id)
        .filter((id): id is number => id != null);
      if (entryIds.length > 0) {
        await markEntriesAsEmitted(hotelId, entryIds, invoiceId);
      }
    }

    return {
      success: true,
      message: `Nota emitida em contingência (RPS/EPEC). Será retransmitida automaticamente.`,
      invoice: updated as NFInvoice,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, message };
  }
}

async function retryContingencyInvoices(hotelId: string): Promise<{
  total: number;
  success: number;
  failed: number;
  results: Array<{ invoiceId: string; success: boolean; message: string }>;
}> {
  const { data: pending } = await supabase
    .from('nf_invoices')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('status', 'contingencia')
    .order('created_at');

  if (!pending?.length) return { total: 0, success: 0, failed: 0, results: [] };

  const results: Array<{ invoiceId: string; success: boolean; message: string }> = [];
  let successCount = 0;
  let failedCount = 0;

  for (const inv of pending) {
    const emitResult = await emitInvoice(inv.id, hotelId);
    if (emitResult.success) {
      await supabase
        .from('nf_invoices')
        .update({ retransmitido_em: new Date().toISOString() })
        .eq('id', inv.id);
      successCount++;
    } else {
      await supabase
        .from('nf_invoices')
        .update({ retry_count: (await supabase.from('nf_invoices').select('retry_count').eq('id', inv.id).single()).data?.retry_count + 1 || 1 })
        .eq('id', inv.id);
      failedCount++;
    }
    results.push({ invoiceId: inv.id, success: emitResult.success, message: emitResult.message });
  }

  return { total: pending.length, success: successCount, failed: failedCount, results };
}

async function getContingencyCount(hotelId: string): Promise<number> {
  const { count } = await supabase
    .from('nf_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('hotel_id', hotelId)
    .eq('status', 'contingencia');
  return count ?? 0;
}

// ─── FNRH / WCI Guest Lookup ────────────────────────────────────────────────

interface WCIGuestData {
  name: string;
  document_type: string | null;
  document_number: string | null;
  nationality: string | null;
  email: string | null;
  phone: string | null;
  address_street: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zipcode: string | null;
  address_country: string | null;
}

async function lookupWCIGuest(
  hotelId: string,
  bookingNumber: string,
  guestName: string,
): Promise<WCIGuestData | null> {
  const { data: fichas } = await supabase
    .from('wci_checkin_fichas')
    .select(`
      id,
      booking_number,
      wci_checkin_guests (
        name,
        is_main_guest,
        document_type,
        document_number,
        nationality,
        email,
        phone,
        address_street,
        address_neighborhood,
        address_city,
        address_state,
        address_zipcode,
        address_country
      )
    `)
    .eq('hotel_id', hotelId)
    .eq('booking_number', bookingNumber)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!fichas?.length) return null;

  const normalizedTarget = guestName.toLowerCase().trim();

  for (const ficha of fichas) {
    const guests = (ficha as any).wci_checkin_guests || [];
    // Try exact match first, then partial match
    const match = guests.find((g: any) =>
      g.name?.toLowerCase().trim() === normalizedTarget
    ) || guests.find((g: any) =>
      g.is_main_guest && normalizedTarget.includes(g.name?.toLowerCase().trim().split(' ')[0] || '___')
    );

    if (match) return match as WCIGuestData;
  }

  return null;
}

// ─── NF Recebidas (Distribuição DF-e — notas emitidas contra o CNPJ) ─────────

interface DFeSyncResult {
  success: boolean;
  message: string;
  novas: number;
}

async function syncNFRecebidas(hotelId: string): Promise<DFeSyncResult> {
  const config = await getConfig(hotelId);
  if (!config?.nf_recebidas_enabled) {
    return { success: false, message: 'Consulta de NF recebidas não está habilitada nas configurações.', novas: 0 };
  }
  if (!config.certificado_base64 || !config.certificado_senha) {
    return { success: false, message: 'Certificado digital A1 não configurado. Configure na aba Certificado.', novas: 0 };
  }
  if (!config.cnpj) {
    return { success: false, message: 'CNPJ da empresa não configurado.', novas: 0 };
  }

  let ultNSU = config.dfe_ultimo_nsu || '0';
  let maxNSU = '';
  let novas = 0;
  let lastMessage = '';

  // A SEFAZ retorna até ~50 docs por lote — itera enquanto houver mais (limite de segurança)
  for (let i = 0; i < 8; i++) {
    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nf-action': 'dfe-consulta' },
      body: JSON.stringify({
        action: 'dfe-consulta',
        certificado_base64: config.certificado_base64,
        certificado_senha: config.certificado_senha,
        cnpj: config.cnpj,
        // NF-e reais de fornecedores só existem no ambiente de produção da
        // SEFAZ — o ambiente de homologação (usado para testar emissão) não
        // distribui documentos reais e é instável.
        ambiente: 'producao',
        ultNSU,
      }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      return { success: false, message: result.error || 'Erro na consulta à SEFAZ', novas };
    }

    lastMessage = result.message || '';
    ultNSU = result.ultNSU || ultNSU;
    maxNSU = result.maxNSU || maxNSU;

    for (const doc of result.docs || []) {
      const { error } = await supabase
        .from('nf_received')
        .upsert({
          hotel_id: hotelId,
          nsu: doc.nsu,
          schema_doc: doc.schema,
          tipo: doc.tipo,
          chave_acesso: doc.chave_acesso,
          numero_nf: doc.numero_nf,
          serie: doc.serie,
          emitente_nome: doc.emitente_nome,
          emitente_cnpj: doc.emitente_cnpj,
          valor_total: doc.valor_total,
          data_emissao: doc.data_emissao,
          xml: doc.xml,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'hotel_id,chave_acesso', ignoreDuplicates: false });
      if (!error) novas++;
    }

    // Persiste progresso do NSU a cada lote
    await supabase
      .from('nf_hotel_config')
      .update({ dfe_ultimo_nsu: ultNSU, dfe_ultima_consulta: new Date().toISOString() })
      .eq('hotel_id', hotelId);

    if (!result.hasMore) break;
  }

  const nsuInfo = maxNSU ? ` (NSU ${Number(ultNSU)} de ${Number(maxNSU)})` : '';
  return {
    success: true,
    message: novas > 0
      ? `${novas} documento(s) sincronizado(s)${nsuInfo}.`
      : `${lastMessage || 'Nenhum documento novo encontrado'}${nsuInfo}.`,
    novas,
  };
}

/**
 * Vínculo retroativo: casa notas recebidas ainda "novas" com compras já
 * registradas no histórico. Exige o mesmo número de NF E uma confirmação de
 * fornecedor: CNPJ igual ao emitente ou, quando a compra não tem CNPJ
 * cadastrado, nome do fornecedor semelhante ao emitente — número sozinho não
 * basta (fornecedores diferentes repetem numeração).
 * Também revalida vínculos automáticos anteriores e desfaz os incorretos.
 * Retorna quantas notas foram vinculadas.
 */
async function linkReceivedToPurchases(hotelId: string): Promise<number> {
  const { data: rows, error: pendErr } = await supabase
    .from('nf_received')
    .select('id, numero_nf, emitente_cnpj, emitente_nome, situacao, purchase_id')
    .eq('hotel_id', hotelId)
    .in('situacao', ['nova', 'lancada'])
    .not('numero_nf', 'is', null);
  if (pendErr) throw pendErr;
  if (!rows?.length) return 0;

  const { data: purchases, error: purErr } = await supabase
    .from('purchases')
    .select('id, invoice_number, supplier_id, supplier')
    .eq('hotel_id', hotelId)
    .not('invoice_number', 'is', null);
  if (purErr) throw purErr;

  // CNPJs dos fornecedores das compras
  const supplierIds = [...new Set((purchases ?? []).map(p => p.supplier_id).filter(Boolean))] as string[];
  const supplierCnpj = new Map<string, string>();
  if (supplierIds.length > 0) {
    const { data: sups } = await supabase
      .from('suppliers')
      .select('id, cnpj')
      .in('id', supplierIds);
    (sups ?? []).forEach((s: { id: string; cnpj: string | null }) => {
      if (s.cnpj) supplierCnpj.set(s.id, s.cnpj.replace(/\D/g, ''));
    });
  }

  // Número de NF normalizado: só dígitos, sem zeros à esquerda
  const normNum = (v: string | null) => (v || '').replace(/\D/g, '').replace(/^0+/, '');
  // Nome normalizado para comparação: maiúsculas, sem acentos nem pontuação
  const normName = (v: string | null) =>
    (v || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const namesSimilar = (a: string | null, b: string | null) => {
    const na = normName(a), nb = normName(b);
    if (na.length < 4 || nb.length < 4) return false;
    return na.includes(nb) || nb.includes(na);
  };

  interface Candidate { id: string; cnpj: string | null; supplierName: string | null }
  const purchasesByNum = new Map<string, Candidate[]>();
  const purchaseById = new Map<string, { num: string; cnpj: string | null; supplierName: string | null }>();
  for (const p of purchases ?? []) {
    const n = normNum(p.invoice_number);
    if (!n) continue;
    const cand: Candidate = {
      id: p.id,
      cnpj: p.supplier_id ? supplierCnpj.get(p.supplier_id) || null : null,
      supplierName: p.supplier || null,
    };
    const list = purchasesByNum.get(n) || [];
    list.push(cand);
    purchasesByNum.set(n, list);
    purchaseById.set(p.id, { num: n, cnpj: cand.cnpj, supplierName: cand.supplierName });
  }

  const isValidMatch = (nf: { emitente_cnpj: string | null; emitente_nome: string | null }, c: Candidate | { cnpj: string | null; supplierName: string | null }) => {
    const nfCnpj = (nf.emitente_cnpj || '').replace(/\D/g, '');
    if (c.cnpj && nfCnpj) return c.cnpj === nfCnpj;
    // Sem CNPJ dos dois lados para comparar → exige nome semelhante
    return namesSimilar(c.supplierName, nf.emitente_nome);
  };

  let linked = 0;
  for (const nf of rows) {
    if (nf.situacao === 'nova') {
      const candidates = purchasesByNum.get(normNum(nf.numero_nf)) || [];
      const match = candidates.find(c => c.cnpj && isValidMatch(nf, c))
        || candidates.find(c => !c.cnpj && isValidMatch(nf, c));
      if (!match) continue;
      const { error } = await supabase
        .from('nf_received')
        .update({ situacao: 'lancada', purchase_id: match.id, updated_at: new Date().toISOString() })
        .eq('id', nf.id);
      if (!error) linked++;
    } else if (nf.situacao === 'lancada' && nf.purchase_id) {
      // Revalidação: desfaz vínculos automáticos que não passam na regra atual
      const p = purchaseById.get(nf.purchase_id);
      const stillValid = !!p && p.num === normNum(nf.numero_nf) && isValidMatch(nf, p);
      if (!stillValid) {
        await supabase
          .from('nf_received')
          .update({ situacao: 'nova', purchase_id: null, updated_at: new Date().toISOString() })
          .eq('id', nf.id);
      }
    }
  }

  return linked;
}

/** Zera o NSU para reconsultar todo o histórico (90 dias) na próxima busca. */
async function resetDFeNSU(hotelId: string): Promise<void> {
  const { error } = await supabase
    .from('nf_hotel_config')
    .update({ dfe_ultimo_nsu: '0', updated_at: new Date().toISOString() })
    .eq('hotel_id', hotelId);
  if (error) throw error;
}

async function getReceivedNFs(
  hotelId: string,
  filters?: { situacao?: string; search?: string },
): Promise<NFReceived[]> {
  let query = supabase
    .from('nf_received')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('data_emissao', { ascending: false, nullsFirst: false });

  if (filters?.situacao) query = query.eq('situacao', filters.situacao);

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data ?? []) as NFReceived[];
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(r =>
      (r.emitente_nome || '').toLowerCase().includes(q) ||
      (r.emitente_cnpj || '').includes(q.replace(/\D/g, '') || q) ||
      (r.numero_nf || '').includes(q) ||
      r.chave_acesso.includes(q),
    );
  }
  return rows;
}

async function updateReceivedSituacao(
  id: string,
  situacao: NFReceived['situacao'],
  purchaseId?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('nf_received')
    .update({
      situacao,
      ...(purchaseId !== undefined ? { purchase_id: purchaseId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

// ─── Manifestação do Destinatário ────────────────────────────────────────────

async function manifestarNFe(
  hotelId: string,
  chaveAcesso: string,
  tipoEvento: TipoManifestacao,
  xJust?: string,
): Promise<{ success: boolean; message: string }> {
  const config = await getConfig(hotelId);
  if (!config?.certificado_base64 || !config?.certificado_senha) {
    return { success: false, message: 'Certificado digital A1 não configurado.' };
  }
  if (!config.cnpj) {
    return { success: false, message: 'CNPJ da empresa não configurado.' };
  }

  const res = await fetch(NF_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nf-action': 'dfe-manifestar' },
    body: JSON.stringify({
      action: 'dfe-manifestar',
      certificado_base64: config.certificado_base64,
      certificado_senha: config.certificado_senha,
      cnpj: config.cnpj,
      chaveAcesso,
      tipoEvento,
      xJust,
      ambiente: 'producao',
    }),
  });
  const result = await res.json();

  if (res.ok && result.success) {
    await supabase
      .from('nf_received')
      .update({
        manifestacao: tipoEvento,
        manifestacao_at: new Date().toISOString(),
        manifestacao_protocolo: result.nProt || null,
        updated_at: new Date().toISOString(),
      })
      .eq('hotel_id', hotelId)
      .eq('chave_acesso', chaveAcesso);

    return { success: true, message: result.message };
  }

  return { success: false, message: result.error || 'Erro na manifestação.' };
}

// ─── Test Connection ─────────────────────────────────────────────────────────

async function testConnection(
  tipo: NFTipo,
  config: Partial<NFHotelConfig>,
): Promise<{ success: boolean; message: string }> {
  try {
    const actionName = tipo === 'nfse' ? 'test-nfse' : tipo === 'nfce' ? 'test-nfce' : 'test-nfe';
    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nf-action': actionName,
      },
      body: JSON.stringify({ action: actionName, ...config }),
    });
    const result = await res.json();
    return {
      success: result.success ?? res.ok,
      message: result.message || (result.success ? 'Conexão bem-sucedida' : 'Falha na conexão'),
    };
  } catch {
    return { success: false, message: 'Erro de rede ao testar conexão' };
  }
}

// ─── Consultar NFS-e Emitidas (Prefeitura — retroativo) ─────────────────────

export interface NfseConsultaItem {
  numero: string;
  codigo_verificacao: string | null;
  data_emissao: string | null;
  competencia: string | null;
  valor_servicos: string | null;
  valor_iss: string | null;
  aliquota: string | null;
  tomador_nome: string | null;
  tomador_cpf_cnpj: string | null;
  discriminacao: string | null;
  situacao: string | null;
}

async function consultarNfseEmitidas(
  hotelId: string,
  dataInicial: string,
  dataFinal: string,
  pagina = 1,
  tomadorCpfCnpj?: string,
): Promise<{ success: boolean; notas: NfseConsultaItem[]; message: string }> {
  const config = await getConfig(hotelId);
  if (!config) return { success: false, notas: [], message: 'Configuração NF não encontrada.' };

  try {
    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nf-action': 'consultar-nfse-prestado' },
      body: JSON.stringify({
        certificado_base64: config.certificado_base64,
        certificado_senha: config.certificado_senha,
        ambiente: config.ambiente,
        cnpj: config.cnpj,
        inscricao_municipal: config.inscricao_municipal,
        data_inicial: dataInicial,
        data_final: dataFinal,
        pagina,
        tomador_cpf_cnpj: tomadorCpfCnpj,
      }),
    });
    const result = await res.json();
    return {
      success: result.success ?? false,
      notas: result.notas || [],
      message: result.message || '',
    };
  } catch {
    return { success: false, notas: [], message: 'Erro de rede ao consultar NFS-e.' };
  }
}

async function consultarNfsePorFaixa(
  hotelId: string,
  numeroInicial: number,
  numeroFinal: number,
  pagina = 1,
): Promise<{ success: boolean; notas: NfseConsultaItem[]; message: string }> {
  const config = await getConfig(hotelId);
  if (!config) return { success: false, notas: [], message: 'Configuração NF não encontrada.' };

  try {
    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nf-action': 'consultar-nfse-faixa' },
      body: JSON.stringify({
        certificado_base64: config.certificado_base64,
        certificado_senha: config.certificado_senha,
        ambiente: config.ambiente,
        cnpj: config.cnpj,
        inscricao_municipal: config.inscricao_municipal,
        numero_inicial: numeroInicial,
        numero_final: numeroFinal,
        pagina,
      }),
    });
    const result = await res.json();
    return {
      success: result.success ?? false,
      notas: result.notas || [],
      message: result.message || '',
    };
  } catch {
    return { success: false, notas: [], message: 'Erro de rede ao consultar NFS-e.' };
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const nfService = {
  getConfig,
  saveConfig,
  getInvoices,
  getInvoiceItems,
  getEmittedEntries,
  markEntriesAsEmitted,
  createDraftInvoice,
  emitInvoice,
  cancelInvoice,
  testConnection,
  resolveEntryFiscalData,
  resolveServiceFiscalData,
  emitContingencia,
  retryContingencyInvoices,
  getContingencyCount,
  lookupWCIGuest,
  syncNFRecebidas,
  getReceivedNFs,
  updateReceivedSituacao,
  resetDFeNSU,
  linkReceivedToPurchases,
  manifestarNFe,
  fetchDANFSE,
  batchEmitInvoices,
  consultarNfseEmitidas,
  consultarNfsePorFaixa,
};

export type { CreateInvoiceInput, WCIGuestData, FiscalLineItem, FiscalResolutionResult, BatchEmissionProgress };
