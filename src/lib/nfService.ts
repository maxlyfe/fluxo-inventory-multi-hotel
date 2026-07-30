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

// Tradução de erros SEFAZ para linguagem acessível ao operador
function translateSefazError(raw: string): string {
  if (!raw) return raw;

  // Extrair código cStat e mensagem
  const cStatMatch = raw.match(/SEFAZ\s+(\d{3})/i);
  const cStat = cStatMatch?.[1];

  // Elemento do schema que falhou (rejeição 225)
  const elemMatch = raw.match(/Elemento:\s*([^\)]+)/i);
  const elem = elemMatch?.[1]?.trim();

  const translations: Record<string, string> = {
    '204': 'Duplicidade de NF-e — já existe uma nota com essa numeração.',
    '207': 'CNPJ do emitente inválido ou não cadastrado na SEFAZ.',
    '209': 'Inscrição Estadual do emitente inválida.',
    '215': 'Rejeição de schema: o XML da nota tem um campo fora do formato obrigatório.',
    '225': 'Campo obrigatório ausente ou formato inválido no XML da nota.',
    '233': 'Série/numeração da NF-e inválida ou duplicada.',
    '301': 'Uso denegado — emitente com irregularidade fiscal.',
    '302': 'Uso denegado — destinatário com irregularidade fiscal.',
    '316': 'Chave de acesso duplicada — a nota já foi transmitida anteriormente.',
    '388': 'Código do município do emitente inválido.',
    '391': 'Rejeição no grupo de pagamento — campo obrigatório ausente (ex: tpIntegra para cartão).',
    '394': 'QR-Code inválido — verifique as configurações de CSC.',
    '539': 'Duplicidade de NFC-e com diferença de valores.',
    '613': 'Em homologação o nome do produto do primeiro item precisa ser o texto padrão.',
    '778': 'Informado NCM inexistente na tabela de NCM.',
  };

  // Tradução específica por elemento do schema (225)
  const elemTranslations: Record<string, string> = {
    'dest/CPF': 'CPF do destinatário ausente ou com formato inválido (precisa ter 11 dígitos, só números).',
    'dest/CNPJ': 'CNPJ do destinatário ausente ou com formato inválido (precisa ter 14 dígitos, só números).',
    'emit/CNPJ': 'CNPJ do emitente não configurado ou inválido.',
    'emit/IE': 'Inscrição Estadual do emitente não configurada ou inválida.',
    'prod/NCM': 'NCM de um produto está com formato inválido (precisa ter 8 dígitos, só números).',
    'prod/CFOP': 'CFOP de um produto está inválido.',
    'prod/cEAN': 'Código de barras (EAN) de um produto está inválido.',
    'prod/xProd': 'Nome do produto está vazio ou com caracteres inválidos.',
    'ICMSTot': 'Totalizador de ICMS com valor incorreto.',
    'infNFeSupl': 'Informações suplementares da NFC-e (QR-Code) com formato inválido.',
    'pag/detPag': 'Dados de pagamento incompletos ou com formato inválido.',
    'pag/detPag/tPag': 'Código da forma de pagamento não informado ou inválido.',
  };

  let friendly = '';

  if (cStat === '225' && elem) {
    // Tentar encontrar tradução pelo elemento mais específico primeiro
    for (const [key, msg] of Object.entries(elemTranslations)) {
      if (elem.includes(key)) {
        friendly = msg;
        break;
      }
    }
    if (!friendly) {
      friendly = `Campo com problema no XML: "${elem}". Verifique os dados preenchidos.`;
    }
  } else if (cStat && translations[cStat]) {
    friendly = translations[cStat];
  }

  if (!friendly) return raw;
  return `${friendly}\n\n(Código SEFAZ ${cStat}: ${raw})`;
}

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
  source: 'product' | 'dish_ingredient' | 'dish_fiscal' | 'unmapped';
  dish_name: string | null;
  warnings: string[];
  // Dados fiscais próprios da ficha (quando a ficha tem NCM cadastrado) — usados
  // no lugar da decomposição por ingredientes. cfop já flui à NFC-e; os demais
  // ficam disponíveis para a emissão honrar por item.
  cfop?: string | null;
  cest?: string | null;
  origem?: string | null;
  csosn?: string | null;
  cst?: string | null;
  unidade?: string | null;
  codigo?: string | null;
  pis_cst?: string | null;
  pis_aliquota?: number | null;
  cofins_cst?: string | null;
  cofins_aliquota?: number | null;
  ibs_cbs_cst?: string | null;
  ibs_cbs_cclasstrib?: string | null;
  ibs_aliquota?: number | null;
  cbs_aliquota?: number | null;
}

export interface FiscalResolutionResult {
  items: FiscalLineItem[];
  warnings: string[];
  hasErrors: boolean;
}

// ─── Mapeamento Erbon: índice único + matcher com preferência de departamento ─
//
// Um produto Erbon pode ter mais de um mapeamento por hotel: uma linha
// "default" (erbon_department_id = 0), que decide a baixa de estoque e serve
// de fallback fiscal, e opcionalmente linhas de "override" por departamento
// (erbon_department_id > 0, só com service_id) que reclassificam o lançamento
// como serviço quando vem de um departamento específico (ex.: MAP/FAP).

export interface ErbonMappingRow {
  erbon_service_id: number;
  erbon_service_description: string | null;
  /** 0 = mapeamento padrão (todos os departamentos); >0 = override específico */
  erbon_department_id: number;
  product_id: string | null;
  dish_id: string | null;
  service_id: string | null;
}

/** Busca todos os mapeamentos Erbon do hotel de uma vez (default + overrides
 *  por departamento). Ponto único de fetch reutilizado pela classificação
 *  produto/serviço e pelas duas resoluções fiscais abaixo, para garantir que
 *  todas usem exatamente o mesmo snapshot. */
export async function getErbonMappingIndex(hotelId: string): Promise<ErbonMappingRow[]> {
  const { data, error } = await supabase
    .from('erbon_product_mappings')
    .select('erbon_service_id, erbon_service_description, erbon_department_id, product_id, dish_id, service_id')
    .eq('hotel_id', hotelId);
  if (error) throw error;
  return (data ?? []) as ErbonMappingRow[];
}

/** Casa um lançamento (por description, fuzzy substring — a Erbon não expõe
 *  erbon_service_id no CurrentAccountEntry) a um mapeamento, preferindo:
 *  1) override exato do departamento do lançamento;
 *  2) linha default (erbon_department_id = 0);
 *  3) primeiro match encontrado (mesma tolerância do comportamento legado). */
export function findMapping(
  mappings: ErbonMappingRow[],
  description: string,
  idDepartment?: number | null,
): ErbonMappingRow | null {
  const desc = (description || '').toLowerCase();
  if (!desc) return null;
  const matches = mappings.filter(m => {
    const d = (m.erbon_service_description || '').toLowerCase();
    return d.length > 0 && (desc.includes(d) || d === desc);
  });
  if (matches.length === 0) return null;

  const dept = idDepartment ?? 0;
  if (dept !== 0) {
    const exact = matches.find(m => m.erbon_department_id === dept);
    if (exact) return exact;
  }
  const def = matches.find(m => m.erbon_department_id === 0);
  if (def) return def;
  return matches[0];
}

/** Heurística legada por palavra-chave — fallback quando não há mapeamento
 *  Erbon algum para o lançamento (ex.: "Diária", "Taxa de turismo", que não
 *  vêm de um produto do PDV mapeado em erbon_product_mappings). */
export function isServiceEntry(entry: { description: string }): boolean {
  const desc = (entry.description || '').toLowerCase();
  return (
    desc.includes('diária') ||
    desc.includes('diaria') ||
    desc.includes('hospedagem') ||
    desc.includes('taxa') ||
    desc.includes('no show') ||
    desc.includes('room charge') ||
    desc.includes('turismo') ||
    desc.includes('iss') ||
    desc.includes('serviço') ||
    desc.includes('servico')
  );
}

/** Classificação canônica produto vs serviço: o mapeamento Erbon (com
 *  preferência de departamento) tem prioridade — permite que o MESMO produto
 *  (ex. "Milanesa a Parmegiana") vire produto no Restaurante e serviço no
 *  MAP/FAP. Sem mapeamento algum, cai para a heurística de palavra-chave
 *  (comportamento 100% preservado para lançamentos nunca mapeados). */
export function isServiceEntryMapped(
  entry: { description: string; idDepartment?: number },
  mappings: ErbonMappingRow[],
): boolean {
  const m = findMapping(mappings, entry.description, entry.idDepartment);
  if (m) {
    if (m.service_id) return true;
    if (m.product_id || m.dish_id) return false;
  }
  return isServiceEntry(entry);
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
  preloadedMappings?: ErbonMappingRow[],
): Promise<FiscalResolutionResult> {
  const globalWarnings: string[] = [];
  const items: FiscalLineItem[] = [];

  // 1. Buscar todos os mapeamentos Erbon do hotel (default + overrides por
  //    departamento) — ou reaproveitar um índice já carregado pelo chamador.
  const mappings = preloadedMappings ?? await getErbonMappingIndex(hotelId);

  // 2. Coletar todos os dish_ids e product_ids que vamos precisar.
  // Nota: o erbon_service_id não vem no CurrentAccountEntry, então o match é
  // por description (fuzzy), com preferência de departamento — ver findMapping.
  const neededDishIds = new Set<string>();
  const neededProductIds = new Set<string>();

  for (const entry of entries) {
    const map = findMapping(mappings, entry.description, entry.idDepartment);
    if (map?.dish_id) neededDishIds.add(map.dish_id);
    if (map?.product_id) neededProductIds.add(map.product_id);
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

  // Dados fiscais próprios da ficha (NCM cadastrado → produto fiscal único)
  const dishFiscalMap = new Map<string, {
    name: string; ncm: string | null; cfop: string | null; cest: string | null;
    origem: string | null; csosn: string | null; cst: string | null;
    icms_aliquota: number; unidade: string | null; codigo: string | null;
    pis_cst: string | null; pis_aliquota: number | null;
    cofins_cst: string | null; cofins_aliquota: number | null;
    ibs_cbs_cst: string | null; ibs_cbs_cclasstrib: string | null;
    ibs_aliquota: number | null; cbs_aliquota: number | null;
  }>();

  if (neededDishIds.size > 0) {
    const { data: dishes } = await supabase
      .from('dishes')
      .select('id, name, nfce_ncm, nfce_cfop, nfce_cest, nfce_origem, nfce_csosn, nfce_cst, nfce_icms_aliquota, nfce_unidade, nfce_codigo, nfce_pis_cst, nfce_pis_aliquota, nfce_cofins_cst, nfce_cofins_aliquota, ibs_cbs_cst, ibs_cbs_cclasstrib, ibs_aliquota, cbs_aliquota')
      .in('id', Array.from(neededDishIds));

    const dishNameMap = new Map<string, string>();
    (dishes ?? []).forEach((d: any) => {
      dishNameMap.set(d.id, d.name);
      dishFiscalMap.set(d.id, {
        name: d.name,
        ncm: d.nfce_ncm || null,
        cfop: d.nfce_cfop || null,
        cest: d.nfce_cest || null,
        origem: d.nfce_origem || null,
        csosn: d.nfce_csosn || null,
        cst: d.nfce_cst || null,
        icms_aliquota: d.nfce_icms_aliquota ?? 0,
        unidade: d.nfce_unidade || null,
        codigo: d.nfce_codigo || null,
        pis_cst: d.nfce_pis_cst || null,
        pis_aliquota: d.nfce_pis_aliquota ?? null,
        cofins_cst: d.nfce_cofins_cst || null,
        cofins_aliquota: d.nfce_cofins_aliquota ?? null,
        ibs_cbs_cst: d.ibs_cbs_cst || null,
        ibs_cbs_cclasstrib: d.ibs_cbs_cclasstrib || null,
        ibs_aliquota: d.ibs_aliquota ?? null,
        cbs_aliquota: d.cbs_aliquota ?? null,
      });
    });

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
    const found = findMapping(mappings, entry.description, entry.idDepartment);
    const mapping = found
      ? { product_id: found.product_id, dish_id: found.dish_id, desc: found.erbon_service_description, svcId: found.erbon_service_id }
      : null;

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
      // A.0: Ficha com NCM próprio → produto fiscal único (não decompõe em
      // ingredientes). Usa os impostos cadastrados na ficha técnica.
      const df = dishFiscalMap.get(mapping.dish_id);
      if (df && df.ncm) {
        items.push({
          erbon_entry_id: entry.id,
          erbon_description: entry.description,
          erbon_service_id: mapping.svcId,
          quantidade: 1,
          valor_unitario: entry.amount,
          valor_total: entry.amount,
          product_id: null,
          product_name: df.name,
          ncm: df.ncm,
          tax_percentage: df.icms_aliquota ?? 0,
          source: 'dish_fiscal',
          dish_name: df.name,
          warnings: [],
          cfop: df.cfop,
          cest: df.cest,
          origem: df.origem,
          csosn: df.csosn,
          cst: df.cst,
          unidade: df.unidade,
          codigo: df.codigo,
          pis_cst: df.pis_cst,
          pis_aliquota: df.pis_aliquota,
          cofins_cst: df.cofins_cst,
          cofins_aliquota: df.cofins_aliquota,
          ibs_cbs_cst: df.ibs_cbs_cst,
          ibs_cbs_cclasstrib: df.ibs_cbs_cclasstrib,
          ibs_aliquota: df.ibs_aliquota,
          cbs_aliquota: df.cbs_aliquota,
        });
        continue;
      }

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
  entries: Array<{ id: number; description: string; amount: number; service_id?: string | null; idDepartment?: number }>,
  preloadedMappings?: ErbonMappingRow[],
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

  // Mapeamentos Erbon → serviço do catálogo (default + overrides por
  // departamento — findMapping escolhe o melhor por entry.idDepartment).
  const mappings = preloadedMappings ?? await getErbonMappingIndex(hotelId);
  const serviceIds = [...new Set(mappings.map(m => m.service_id).filter(Boolean))] as string[];
  const serviceDataById = new Map<string, { id: string; name: string; description: string | null; lc116_code: string | null; iss_rate: number | null; iss_retained: boolean; is_active: boolean }>();
  if (serviceIds.length > 0) {
    const { data: svcs } = await supabase
      .from('services')
      .select('id, name, description, lc116_code, iss_rate, iss_retained, is_active')
      .in('id', serviceIds);
    (svcs ?? []).forEach((s: any) => serviceDataById.set(s.id, s));
  }

  // Fallback: tributação única do hotel
  const { data: cfg } = await supabase
    .from('nf_hotel_config')
    .select('codigo_servico, aliquota_iss')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  const items: ServiceFiscalItem[] = entries.map(entry => {
    // 1º: serviço apontado diretamente pelo lançamento (reservas internas)
    const direct = entry.service_id ? directServices.get(entry.service_id) : undefined;
    // 2º: mapeamento Erbon por descrição, com preferência de departamento —
    // o CurrentAccountEntry da Erbon não expõe erbon_service_id diretamente.
    const found = direct ? null : findMapping(mappings, entry.description, entry.idDepartment);
    const matchService = found?.service_id ? serviceDataById.get(found.service_id) : null;
    const match = matchService?.is_active ? matchService : null;

    if (direct || match) {
      const s = (direct || match!)!;
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

/** Ambiente de emissão do TIPO de nota (não global): uma NFS-e em produção
 *  bloqueia reemissão mesmo que a NFC-e esteja em homologação, e vice-versa. */
export function isHomologForTipo(config: NFHotelConfig | null, tipo: NFTipo): boolean {
  if (!config) return true;
  if (tipo === 'nfse') {
    // Mesmos defaults usados na emissão (emitInvoice)
    if (config.nfse_provider === 'adn') return (config.adn_ambiente || 'homologacao') === 'homologacao';
    if (config.nfse_provider === 'el-nacional') return (config.el_ambiente || 'homologacao') === 'homologacao';
    return (config.ambiente || 'producao') === 'homologacao';
  }
  return (config.ambiente || 'homologacao') === 'homologacao';
}

async function getEmittedEntries(hotelId: string): Promise<Map<number, string>> {
  const config = await getConfig(hotelId);

  // Considera apenas notas válidas (autorizada/contingência) cujo TIPO foi
  // emitido em produção. Em homologação daquele tipo, libera reemissão.
  const { data, error } = await supabase
    .from('nf_emitted_entries')
    .select('erbon_entry_id, invoice_id, nf_invoices!inner(tipo, status)')
    .eq('hotel_id', hotelId);
  if (error) throw error;

  const map = new Map<number, string>();
  (data ?? []).forEach((row: any) => {
    const inv = row.nf_invoices;
    if (!inv) return;
    if (inv.status !== 'autorizada' && inv.status !== 'contingencia') return;
    if (isHomologForTipo(config, inv.tipo)) return;
    map.set(row.erbon_entry_id, row.invoice_id);
  });
  return map;
}

// Notas emitidas (autorizadas/contingência) de uma reserva — para reimpressão.
// Independe do ambiente: sempre lista o que já foi emitido para aquela reserva.
async function getInvoicesByBooking(
  hotelId: string,
  erbonBookingId: number | null,
  bookingNumber?: string | null,
): Promise<NFInvoice[]> {
  let query = supabase
    .from('nf_invoices')
    .select('*')
    .eq('hotel_id', hotelId)
    .in('status', ['autorizada', 'contingencia'])
    .order('created_at', { ascending: false });

  if (erbonBookingId != null) {
    query = query.eq('erbon_booking_id', erbonBookingId);
  } else if (bookingNumber) {
    query = query.eq('booking_number', bookingNumber);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as NFInvoice[];
}

// Serviços do catálogo marcados para emitir em NFC-e/NF-e (tratar como produto).
// Ex.: "Taxa de serviço" 10%. Usado para reclassificar lançamentos da reserva.
export interface NfceEligibleService {
  name: string;      // normalizado (minúsculo, sem acento)
  /** Nomes alternativos para match: nome do serviço + descrições Erbon mapeadas */
  matchers: string[];
  ncm: string | null;
  cfop: string;
}

async function getNfceEligibleServices(hotelId: string): Promise<NfceEligibleService[]> {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, nfce_ncm, nfce_cfop')
    .eq('hotel_id', hotelId)
    .eq('nfce_eligible', true)
    .eq('is_active', true);
  if (error) throw error;
  const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  // Descrições Erbon mapeadas para estes serviços — o lançamento da conta chega
  // com a descrição da Erbon, que pode não conter o nome do serviço do catálogo
  const ids = (data ?? []).map((r: any) => r.id);
  const aliasesByService = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: maps } = await supabase
      .from('erbon_product_mappings')
      .select('service_id, erbon_service_description')
      .eq('hotel_id', hotelId)
      .in('service_id', ids);
    (maps ?? []).forEach((m: any) => {
      const d = norm(m.erbon_service_description);
      if (!d) return;
      const arr = aliasesByService.get(m.service_id) || [];
      arr.push(d);
      aliasesByService.set(m.service_id, arr);
    });
  }

  return (data ?? []).map((r: any) => {
    const name = norm(r.name);
    return {
      name,
      matchers: [name, ...(aliasesByService.get(r.id) || [])].filter(s => s.length > 0),
      ncm: r.nfce_ncm || null,
      cfop: r.nfce_cfop || '5102',
    };
  }).filter(s => s.matchers.length > 0);
}

/** Um lançamento casa com um serviço elegível se a descrição contém o nome do
 *  serviço OU uma das descrições Erbon mapeadas (e vice-versa p/ descrições curtas). */
export function matchesEligibleService(description: string, svc: NfceEligibleService): boolean {
  const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const desc = norm(description);
  if (!desc) return false;
  return svc.matchers.some(m => desc.includes(m) || m.includes(desc));
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
  // Endereço estruturado: a DPS da NFS-e Nacional precisa de <endNac><cMun> +
  // <CEP> em campos separados (rejeição E0234 quando o bloco não vai).
  tomador_logradouro?: string | null;
  tomador_numero?: string | null;
  tomador_complemento?: string | null;
  tomador_bairro?: string | null;
  tomador_cidade?: string | null;
  tomador_uf?: string | null;
  tomador_cep?: string | null;
  tomador_codigo_municipio?: string | null;
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
    pis_cst?: string | null;
    pis_aliquota?: number | null;
    cofins_cst?: string | null;
    cofins_aliquota?: number | null;
    codigo_servico?: string | null;
    iss_aliquota?: number | null;
    iss_valor?: number | null;
    ibs_cbs_cst?: string | null;
    ibs_cbs_cclasstrib?: string | null;
    ibs_aliquota?: number | null;
    cbs_aliquota?: number | null;
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
      tomador_logradouro: input.tomador_logradouro ?? null,
      tomador_numero: input.tomador_numero ?? null,
      tomador_complemento: input.tomador_complemento ?? null,
      tomador_bairro: input.tomador_bairro ?? null,
      tomador_cidade: input.tomador_cidade ?? null,
      tomador_uf: input.tomador_uf ?? null,
      tomador_cep: input.tomador_cep ?? null,
      tomador_codigo_municipio: input.tomador_codigo_municipio ?? null,
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
    pis_cst: it.pis_cst ?? null,
    pis_aliquota: it.pis_aliquota ?? null,
    cofins_cst: it.cofins_cst ?? null,
    cofins_aliquota: it.cofins_aliquota ?? null,
    codigo_servico: it.codigo_servico ?? null,
    iss_aliquota: it.iss_aliquota ?? null,
    iss_valor: it.iss_valor ?? null,
    ibs_cbs_cst: it.ibs_cbs_cst ?? null,
    ibs_cbs_cclasstrib: it.ibs_cbs_cclasstrib ?? null,
    ibs_aliquota: it.ibs_aliquota ?? null,
    cbs_aliquota: it.cbs_aliquota ?? null,
  }));

  const { error: itemsErr } = await supabase.from('nf_invoice_items').insert(itemRows);
  if (itemsErr) throw itemsErr;

  return invoice as NFInvoice;
}

async function emitInvoice(invoiceId: string, hotelId: string, pagamentos?: { tPag: string; vPag: number }[]): Promise<{ success: boolean; message: string; invoice?: NFInvoice }> {
  try {
    const { data: inv } = await supabase
      .from('nf_invoices')
      .select('tipo, status, tomador_nome, tomador_cpf_cnpj, tomador_doc_tipo, tomador_email, tomador_endereco, tomador_logradouro, tomador_numero, tomador_complemento, tomador_bairro, tomador_cidade, tomador_uf, tomador_cep, tomador_codigo_municipio')
      .eq('id', invoiceId)
      .single();

    // Nota já autorizada não pode ser emitida de novo
    if (inv?.status === 'autorizada') {
      return { success: false, message: 'Esta nota fiscal já foi autorizada. Para emitir novamente, cancele a nota primeiro.' };
    }

    const config = await getConfig(hotelId);

    // Trava anti-duplicidade em PRODUÇÃO: se algum lançamento desta nota já
    // consta em outra nota válida (autorizada/contingência) emitida em
    // produção, bloqueia antes de contatar o fisco. Só cancelar libera.
    if (inv && !isHomologForTipo(config, inv.tipo as NFTipo)) {
      const { data: draftItems } = await supabase
        .from('nf_invoice_items')
        .select('erbon_entry_id, descricao')
        .eq('invoice_id', invoiceId)
        .not('erbon_entry_id', 'is', null);
      const entryIds = (draftItems || []).map((i: any) => i.erbon_entry_id).filter((id: any) => id != null);
      if (entryIds.length > 0) {
        const emitted = await getEmittedEntries(hotelId);
        const dups = (draftItems || []).filter((i: any) => {
          const otherInv = emitted.get(i.erbon_entry_id);
          return otherInv && otherInv !== invoiceId;
        });
        if (dups.length > 0) {
          return {
            success: false,
            message: `Emissão bloqueada: ${dups.length} lançamento(s) já possuem NF emitida em produção (${dups.map((d: any) => d.descricao).slice(0, 3).join(', ')}${dups.length > 3 ? '…' : ''}). Cancele a nota anterior para reemitir.`,
          };
        }
      }
    }
    const useADN = inv?.tipo === 'nfse' && config?.nfse_provider === 'adn';
    const useELNacional = inv?.tipo === 'nfse' && config?.nfse_provider === 'el-nacional';
    // Redirecionamento de NFC-e: se ligado, emite com a identidade fiscal de
    // outra unidade do grupo (a numeração incrementa na unidade responsável).
    let nfceEmitCfg: any = null;
    let nfceEmitHotelId: string | null = null;

    let proxyAction: string;
    let bodyPayload: Record<string, unknown>;

    if (useELNacional) {
      const { data: items } = await supabase
        .from('nf_invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId);

      proxyAction = 'emit-nfse-el-nacional';
      bodyPayload = {
        action: proxyAction,
        certificado_base64: config!.certificado_base64,
        certificado_senha: config!.certificado_senha,
        token: (config as any).el_token,
        ambiente: (config as any).el_ambiente || 'homologacao',
        cnpj: config!.cnpj,
        inscricao_municipal: config!.inscricao_municipal,
        codigo_municipio: config!.endereco_codigo_municipio || '3300233',
        codigo_servico: config!.codigo_servico || '9.01',
        // cIntContrib da DPS Nacional -- campo dedicado, independente do
        // codigo_servico_municipal usado pelo SOAP ABRASF (ver migration
        // 20260730190000_nfse_cint_contrib.sql).
        codigo_servico_municipal: (config as any).nfse_cint_contrib || null,
        aliquota_iss: config!.aliquota_iss ?? 5,
        // Código NBS: obrigatório na DPS quando ela leva o bloco IBS/CBS (E0322)
        codigo_nbs: (config as any).nfse_codigo_nbs ?? null,
        optante_simples: config!.regime_tributario_nfse === '6',
        telefone: config!.telefone,
        // Reforma Tributária (IBS/CBS) — bloco <IBSCBS> por nota (config por
        // hotel, ver Fase 1 da migration de preparação da Nota Nacional)
        ibs_cbs_cst: (config as any).nfse_ibs_cbs_cst ?? null,
        ibs_cbs_cclasstrib: (config as any).nfse_ibs_cbs_cclasstrib ?? null,
        fin_nfse: (config as any).nfse_fin_nfse ?? null,
        ind_final: (config as any).nfse_ind_final ?? null,
        c_ind_op: (config as any).nfse_c_ind_op ?? null,
        ind_dest: (config as any).nfse_ind_dest ?? null,
        tomador_nome: inv!.tomador_nome,
        tomador_cpf_cnpj: inv!.tomador_cpf_cnpj,
        tomador_doc_tipo: inv!.tomador_doc_tipo,
        tomador_email: inv!.tomador_email,
        tomador_endereco: inv!.tomador_logradouro || inv!.tomador_endereco,
        tomador_numero: inv!.tomador_numero,
        tomador_bairro: inv!.tomador_bairro,
        tomador_codigo_municipio: inv!.tomador_codigo_municipio,
        tomador_cep: inv!.tomador_cep,
        items: (items || []).map((i: NFInvoiceItem) => ({
          description: i.descricao,
          quantidade: i.quantidade,
          valor_unitario: i.valor_unitario,
          valor_total: i.valor_total,
        })),
        serie: config!.serie_nfse || 'NFS',
        numeroDPS: config!.proximo_numero_nfse || 1,
      };
    } else if (useADN) {
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
          codigo_nbs: (config as any).nfse_codigo_nbs ?? null,
          aliquota_iss: config!.aliquota_iss,
          // Reforma Tributária (IBS/CBS) — bloco <IBSCBS> por nota, paridade
          // com o formato 'el-nacional' (config por hotel)
          ibs_cbs_cst: (config as any).nfse_ibs_cbs_cst ?? null,
          ibs_cbs_cclasstrib: (config as any).nfse_ibs_cbs_cclasstrib ?? null,
          fin_nfse: (config as any).nfse_fin_nfse ?? null,
          ind_final: (config as any).nfse_ind_final ?? null,
          c_ind_op: (config as any).nfse_c_ind_op ?? null,
          ind_dest: (config as any).nfse_ind_dest ?? null,
        },
        tomador: {
          nome: inv!.tomador_nome,
          doc_tipo: inv!.tomador_doc_tipo,
          doc_numero: inv!.tomador_cpf_cnpj,
          email: inv!.tomador_email,
          // Endereço estruturado: vira <end><endNac> na DPS. Sem cMun e CEP a
          // Plataforma Nacional rejeita com E0234.
          endereco: inv!.tomador_logradouro || inv!.tomador_endereco,
          numero: inv!.tomador_numero,
          bairro: inv!.tomador_bairro,
          codigo_municipio: inv!.tomador_codigo_municipio,
          cep: inv!.tomador_cep,
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

      const { data: svcRow } = await supabase
        .from('services')
        .select('cnae')
        .eq('hotel_id', hotelId)
        .not('cnae', 'is', null)
        .limit(1)
        .maybeSingle();

      // Taxa de turismo isenta (sai da base do ISS via ValorDeducoes). Match por
      // nome de serviço marcado como isento na descrição do lançamento.
      const { data: isentaSvcs } = await supabase
        .from('services')
        .select('name')
        .eq('hotel_id', hotelId)
        .eq('nfse_taxa_isenta', true)
        .eq('is_active', true);
      const normIsenta = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const isentaNames = (isentaSvcs || []).map((r: any) => normIsenta(r.name)).filter((n: string) => n.length > 0);
      const valorDeducoes = (items || [])
        .filter((i: NFInvoiceItem) => isentaNames.some(n => normIsenta(i.descricao).includes(n)))
        .reduce((s: number, i: NFInvoiceItem) => s + Number(i.valor_total || 0), 0);

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
        codigo_servico: config!.codigo_servico || '09.01',
        codigo_cnae: svcRow?.cnae || null,
        codigo_tributacao_municipio: (config as any).codigo_servico_municipal || null,
        aliquota_iss: config!.aliquota_iss ?? 5,
        regime_tributario: config!.regime_tributario_nfse,
        optante_simples: config!.regime_tributario_nfse === '1',
        valor_deducoes: Math.round(valorDeducoes * 100) / 100,
        numero_rps: config!.proximo_numero_nfse || 1,
        serie_rps: config!.serie_nfse || 'RPS',
      };
    } else if (inv?.tipo === 'nfce') {
      const { data: items } = await supabase
        .from('nf_invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId);

      // Serviços marcados como acréscimo (ex.: taxa de serviço 10%) NÃO viram
      // <det> na NFC-e: somam em vOutro. Match por nome do serviço na descrição.
      const eligibleAcr = await getNfceEligibleServices(hotelId);
      const allNfceItems = items || [];
      const isAcr = (i: NFInvoiceItem) => eligibleAcr.some(e => matchesEligibleService(i.descricao, e));
      const productItems = allNfceItems.filter((i: NFInvoiceItem) => !isAcr(i));
      const acrescimoTotal = allNfceItems.filter(isAcr).reduce((s: number, i: NFInvoiceItem) => s + Number(i.valor_total || 0), 0);

      // Identidade fiscal do emissor: a própria unidade OU a responsável (redirecionamento)
      let fiscalCfg: any = config!;
      if ((config as any)?.nfce_emit_redirect_enabled && (config as any)?.nfce_emit_redirect_hotel_id) {
        const emitter = await getConfig((config as any).nfce_emit_redirect_hotel_id);
        if (emitter) { fiscalCfg = emitter; nfceEmitCfg = emitter; nfceEmitHotelId = (config as any).nfce_emit_redirect_hotel_id; }
      }

      proxyAction = 'emit-nfce';
      bodyPayload = {
        action: proxyAction,
        certificado_base64: fiscalCfg.certificado_base64,
        certificado_senha: fiscalCfg.certificado_senha,
        ambiente: fiscalCfg.ambiente || 'homologacao',
        cnpj: fiscalCfg.cnpj,
        razao_social: fiscalCfg.razao_social,
        nome_fantasia: fiscalCfg.nome_fantasia,
        inscricao_estadual: fiscalCfg.inscricao_estadual,
        crt: fiscalCfg.crt || 1,
        endereco_logradouro: fiscalCfg.endereco_logradouro,
        endereco_numero: fiscalCfg.endereco_numero,
        endereco_bairro: fiscalCfg.endereco_bairro,
        endereco_cidade: fiscalCfg.endereco_cidade,
        endereco_uf: fiscalCfg.endereco_uf,
        endereco_cep: fiscalCfg.endereco_cep,
        endereco_codigo_municipio: fiscalCfg.endereco_codigo_municipio,
        telefone: fiscalCfg.telefone,
        tomador_nome: inv.tomador_nome,
        tomador_cpf_cnpj: inv.tomador_cpf_cnpj,
        tomador_doc_tipo: inv.tomador_doc_tipo,
        items: productItems.map((i: NFInvoiceItem) => ({
          description: i.descricao,
          quantidade: i.quantidade,
          valor_unitario: i.valor_unitario,
          valor_total: i.valor_total,
          ncm: i.ncm || '00000000',
          cfop: i.cfop || '5102',
          icms_orig: '0',
          icms_csosn: (fiscalCfg.crt === 1 || fiscalCfg.crt === 2) ? '102' : undefined,
          icms_cst: (fiscalCfg.crt === 3) ? '00' : undefined,
          icms_vBC: (fiscalCfg.crt === 3) ? i.valor_total : 0,
          icms_pICMS: (fiscalCfg.crt === 3) ? (i.icms_aliquota ?? 0) : 0,
          icms_vICMS: (fiscalCfg.crt === 3) ? (i.icms_valor ?? 0) : 0,
          // PIS/COFINS: valor do item (ficha) e, na falta, padrão do hotel
          pis_cst: (i as any).pis_cst ?? fiscalCfg.prod_pis_cst ?? undefined,
          pis_aliquota: (i as any).pis_aliquota ?? fiscalCfg.prod_pis_aliquota ?? undefined,
          cofins_cst: (i as any).cofins_cst ?? fiscalCfg.prod_cofins_cst ?? undefined,
          cofins_aliquota: (i as any).cofins_aliquota ?? fiscalCfg.prod_cofins_aliquota ?? undefined,
          // IBS/CBS (Reforma Tributária) — grupo montado quando o hotel está
          // com nfce_ibs_cbs_enabled e CRT=3 (ver ibs_cbs_enabled abaixo).
          ibs_cbs_cst: i.ibs_cbs_cst ?? undefined,
          ibs_cbs_cClassTrib: i.ibs_cbs_cclasstrib ?? undefined,
          ibs_aliquota: i.ibs_aliquota ?? undefined,
          cbs_aliquota: i.cbs_aliquota ?? undefined,
        })),
        acrescimo: Math.round(acrescimoTotal * 100) / 100,
        taxa_na_base_icms: !!fiscalCfg.nfce_taxa_na_base_icms,
        // Reforma Tributária (NT 2025.002): obrigatório em produção para CRT=3
        // a partir de 03/08/2026. Opt-in por hotel para permitir desligar sem
        // deploy caso a SEFAZ rejeite.
        ibs_cbs_enabled: !!fiscalCfg.nfce_ibs_cbs_enabled,
        serie_nfce: fiscalCfg.serie_nfce || '1',
        nfce_csc_id: fiscalCfg.nfce_csc_id,
        nfce_csc_token: fiscalCfg.nfce_csc_token,
        numero_nfce: fiscalCfg.proximo_numero_nfce || 1,
        tPag: pagamentos?.[0]?.tPag || '01',
        pagamentos,
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
          ibs_cbs_cst: i.ibs_cbs_cst ?? undefined,
          ibs_cbs_cClassTrib: i.ibs_cbs_cclasstrib ?? undefined,
          ibs_aliquota: i.ibs_aliquota ?? undefined,
          cbs_aliquota: i.cbs_aliquota ?? undefined,
        })),
        ibs_cbs_enabled: !!(config as any).nfce_ibs_cbs_enabled,
        serie_nfe: config!.serie_nfe || '1',
        numero_nfe: config!.proximo_numero_nfe || 1,
        natureza_operacao: 'VENDA DE MERCADORIA',
        tPag: pagamentos?.[0]?.tPag || '01',
        pagamentos,
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
      // Guardar a DPS enviada e o provedor TAMBÉM na rejeição: é justamente aí
      // que o XML é necessário para diagnosticar. Sem isso, cada rejeição
      // obrigava a reproduzir o payload à mão para descobrir o que foi enviado.
      await supabase
        .from('nf_invoices')
        .update({
          status: 'rejeitada',
          xml_retorno: result.xml_retorno || null,
          xml_envio: result.xml_envio || null,
          xml_dps: result.xml_dps || null,
          nfse_provider: inv?.tipo === 'nfse' ? (config?.nfse_provider ?? null) : null,
        })
        .eq('id', invoiceId);
      const rawMsg = result.message || result.error || 'Erro ao emitir nota fiscal';
      return { success: false, message: translateSefazError(rawMsg) };
    }

    const updateData: Record<string, unknown> = {
      status: 'autorizada',
      numero_nf: result.numero_nf || null,
      serie: result.serie || null,
      chave_acesso: result.chave_acesso || null,
      numero_protocolo: result.numero_protocolo || null,
      codigo_verificacao: result.codigo_verificacao || null,
      xml_retorno: result.xml_retorno || null,
      // XML assinado enviado a SEFAZ. Antes so o protocolo era gravado, ou
      // seja o documento fiscal em si nao ficava guardado em lugar nenhum.
      xml_envio: result.xml_envio || null,
      pdf_url: result.pdf_url || null,
      qrcode_url: result.qrcode_url || null,
      url_consulta: result.url_consulta || null,
      forma_pagamento: (inv?.tipo === 'nfce' || inv?.tipo === 'nfe') ? (pagamentos?.[0]?.tPag ?? null) : null,
      pagamentos: (inv?.tipo === 'nfce' || inv?.tipo === 'nfe') ? (pagamentos ?? null) : null,
    };

    if (useADN || useELNacional) {
      updateData.nfse_provider = useADN ? 'adn' : 'el-nacional';
      updateData.xml_dps = result.xml_dps || null;
      updateData.id_dps = result.id_dps || null;
      // A Plataforma Nacional pode aceitar a DPS e devolver a NFS-e "em
      // processamento", sem número nem chave. Marcar isso como 'autorizada'
      // criava uma nota que parecia pronta e não tinha nenhum dado fiscal.
      // 'emitida' é o estado correto até a autorização chegar, e a reconsulta
      // (reconsultarDpsNacional) completa o resto.
      if (!result.chave_acesso && !result.numero_nf) updateData.status = 'emitida';
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

    // A API Nacional aceita a DPS e responde "em processamento" por tempo
    // indeterminado, enquanto a NFS-e JA existe no municipio. Sem buscar o
    // numero aqui, a nota fica marcada como nao emitida e sem documento para
    // imprimir, obrigando o usuario a clicar em reconsultar depois de toda
    // emissao. Busca best-effort: se falhar, a nota segue como 'emitida' e o
    // botao de reconsulta continua disponivel.
    let notaFinal = updated as NFInvoice;
    if (useELNacional && result.success && !result.numero_nf) {
      try {
        const r = await reconsultarDpsNacional(invoiceId);
        console.log('[NFS-e] Busca automatica do numero:', r.message);
        if (!r.processando) {
          // Reler a nota: `updated` foi capturado antes da reconsulta e ainda
          // esta sem numero, o que faria a tela mostrar a nota como pendente
          // mesmo depois de a busca ter dado certo.
          const { data: rec } = await supabase.from('nf_invoices').select().eq('id', invoiceId).single();
          if (rec) notaFinal = rec as NFInvoice;
        }
      } catch (e) {
        console.log('[NFS-e] Busca automatica do numero falhou:', e);
      }
    }

    // Incrementar próximo número
    if (config && result.success) {
      if (inv?.tipo === 'nfse') {
        await supabase
          .from('nf_hotel_config')
          .update({ proximo_numero_nfse: (config.proximo_numero_nfse || 1) + 1 })
          .eq('hotel_id', hotelId);
      } else if (inv?.tipo === 'nfce') {
        // Numeração incrementa na unidade responsável (se redirecionado) ou na própria
        const numHotelId = nfceEmitHotelId || hotelId;
        const numBase = (nfceEmitCfg?.proximo_numero_nfce ?? config.proximo_numero_nfce) || 1;
        await supabase
          .from('nf_hotel_config')
          .update({ proximo_numero_nfce: numBase + 1 })
          .eq('hotel_id', numHotelId);
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

    return { success: true, message: 'Nota fiscal autorizada com sucesso', invoice: notaFinal };
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
        cnpj: config?.cnpj, // vai em <CNPJAutor> do pedido de registro de evento
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
  pagamentosById?: Record<string, { tPag: string; vPag: number }[]>,
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

    const result = await emitInvoice(invoiceId, hotelId, pagamentosById?.[invoiceId]);
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

// ─── Helpers de normalização (compartilhados) ──────────────────────────────

const normNum = (v: string | null) => (v || '').replace(/\D/g, '').replace(/^0+/, '');

const normName = (v: string | null) =>
  (v || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const namesSimilar = (a: string | null, b: string | null) => {
  const na = normName(a), nb = normName(b);
  if (na.length < 4 || nb.length < 4) return false;
  return na.includes(nb) || nb.includes(na);
};

// ─── Busca de NF recebida por número de nota ────────────────────────────────

async function findReceivedByInvoiceNumber(
  hotelId: string,
  invoiceNumber: string,
  supplierCnpj?: string | null,
): Promise<NFReceived[]> {
  const target = normNum(invoiceNumber);
  if (!target) return [];

  const { data, error } = await supabase
    .from('nf_received')
    .select('*')
    .eq('hotel_id', hotelId)
    .not('numero_nf', 'is', null)
    .order('data_emissao', { ascending: false, nullsFirst: false });
  if (error) throw error;

  const rows = (data ?? []) as NFReceived[];
  const matched = rows.filter(r => normNum(r.numero_nf) === target);
  if (!matched.length) return [];

  if (!supplierCnpj) return matched;

  const cleanCnpj = supplierCnpj.replace(/\D/g, '');
  return matched.sort((a, b) => {
    const aMatch = (a.emitente_cnpj || '').replace(/\D/g, '') === cleanCnpj ? 0 : 1;
    const bMatch = (b.emitente_cnpj || '').replace(/\D/g, '') === cleanCnpj ? 0 : 1;
    return aMatch - bMatch;
  });
}

// ─── Vínculo retroativo NF ↔ Compra ────────────────────────────────────────

/**
 * Casa notas recebidas ainda "novas" com compras já registradas no histórico.
 * Exige o mesmo número de NF E confirmação de fornecedor (CNPJ ou nome).
 * Também revalida vínculos anteriores e desfaz os incorretos.
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
  const supplierCnpjMap = new Map<string, string>();
  if (supplierIds.length > 0) {
    const { data: sups } = await supabase
      .from('suppliers')
      .select('id, cnpj')
      .in('id', supplierIds);
    (sups ?? []).forEach((s: { id: string; cnpj: string | null }) => {
      if (s.cnpj) supplierCnpjMap.set(s.id, s.cnpj.replace(/\D/g, ''));
    });
  }

  interface Candidate { id: string; cnpj: string | null; supplierName: string | null }
  const purchasesByNum = new Map<string, Candidate[]>();
  const purchaseById = new Map<string, { num: string; cnpj: string | null; supplierName: string | null }>();
  for (const p of purchases ?? []) {
    const n = normNum(p.invoice_number);
    if (!n) continue;
    const cand: Candidate = {
      id: p.id,
      cnpj: p.supplier_id ? supplierCnpjMap.get(p.supplier_id) || null : null,
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
    if (!config.certificado_base64 || !config.cnpj || !config.inscricao_municipal) {
      return { success: false, notas: [], message: 'Configure o certificado, CNPJ e Inscrição Municipal antes de consultar.' };
    }

    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nf-action': 'consultar-nfse-prestado' },
      body: JSON.stringify({
        action: 'consultar-nfse-prestado',
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

  if (!config.certificado_base64 || !config.cnpj || !config.inscricao_municipal) {
    return { success: false, notas: [], message: 'Configure o certificado, CNPJ e Inscrição Municipal antes de consultar.' };
  }

  try {
    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nf-action': 'consultar-nfse-faixa' },
      body: JSON.stringify({
        action: 'consultar-nfse-faixa',
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

// ─── Reconsulta de NFS-e Nacional pendente ──────────────────────────────────
//
// A API Nacional pode aceitar a DPS e devolver a NFS-e "<em processamento adn
// nacional>". Nesse caso a nota fica sem número, chave e código de verificação,
// e é esta função que completa os dados quando a autorização sai.
async function reconsultarDpsNacional(invoiceId: string): Promise<{
  success: boolean;
  processando: boolean;
  message: string;
}> {
  const { data: inv } = await supabase
    .from('nf_invoices')
    .select('id, hotel_id, id_dps, chave_acesso, nfse_provider, xml_retorno')
    .eq('id', invoiceId)
    .single();

  if (!inv) return { success: false, processando: false, message: 'Nota não encontrada.' };
  if (inv.chave_acesso) {
    return { success: true, processando: false, message: 'Esta nota já está autorizada.' };
  }

  // Notas emitidas antes de o id_dps passar a ser gravado ficaram com a coluna
  // nula, e sem ela não havia como reconsultar. O id está no JSON de retorno da
  // própria nota, então recuperamos de lá e persistimos, em vez de exigir
  // correção manual no banco.
  let idDps = inv.id_dps;
  if (!idDps && inv.xml_retorno) {
    idDps = /"idDPS"\s*:\s*"([^"]+)"/.exec(inv.xml_retorno)?.[1] ?? null;
    if (idDps) await supabase.from('nf_invoices').update({ id_dps: idDps }).eq('id', invoiceId);
  }
  if (!idDps) {
    return { success: false, processando: false, message: 'Esta nota não tem id da DPS, nem no retorno da API, então não há o que reconsultar.' };
  }

  const config = await getConfig(inv.hotel_id);
  if (!config || !(config as any).el_token) {
    return { success: false, processando: false, message: 'Token da API Nacional não configurado para este hotel.' };
  }

  const res = await fetch(NF_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nf-action': 'consulta-dps-el-nacional' },
    body: JSON.stringify({
      action: 'consulta-dps-el-nacional',
      token: (config as any).el_token,
      ambiente: (config as any).el_ambiente || 'homologacao',
      id_dps: idDps,
      // Para o fallback municipal (ConsultarNfsePorRps) quando a Plataforma
      // Nacional ainda estiver processando: a nota ja existe no municipio.
      certificado_base64: config.certificado_base64,
      certificado_senha: config.certificado_senha,
      cnpj: config.cnpj,
      inscricao_municipal: config.inscricao_municipal,
      ambiente_abrasf: config.ambiente,
    }),
  });
  const result = await res.json();

  if (!res.ok || result.success === false) {
    return { success: false, processando: false, message: result.message || result.error || 'Falha na reconsulta.' };
  }
  if (result.processando) {
    return { success: true, processando: true, message: result.message };
  }

  // A nota pode ter vindo da Plataforma Nacional ou do municipio (fallback por
  // RPS). Nos dois casos ela esta autorizada e ja pode ser impressa; o que muda
  // e a chave de acesso, que so a representacao nacional tem.
  await supabase
    .from('nf_invoices')
    .update({
      status: 'autorizada',
      numero_nf: result.numero_nf || null,
      chave_acesso: result.chave_acesso || null,
      codigo_verificacao: result.codigo_verificacao || null,
      xml_retorno: result.xml_retorno || null,
    })
    .eq('id', invoiceId);

  return { success: true, processando: false, message: result.message };
}

export const nfService = {
  getConfig,
  saveConfig,
  getInvoices,
  getInvoiceItems,
  getEmittedEntries,
  getInvoicesByBooking,
  getNfceEligibleServices,
  markEntriesAsEmitted,
  createDraftInvoice,
  emitInvoice,
  cancelInvoice,
  reconsultarDpsNacional,
  testConnection,
  resolveEntryFiscalData,
  resolveServiceFiscalData,
  getErbonMappingIndex,
  findMapping,
  isServiceEntry,
  isServiceEntryMapped,
  emitContingencia,
  retryContingencyInvoices,
  getContingencyCount,
  lookupWCIGuest,
  syncNFRecebidas,
  getReceivedNFs,
  updateReceivedSituacao,
  resetDFeNSU,
  findReceivedByInvoiceNumber,
  linkReceivedToPurchases,
  manifestarNFe,
  fetchDANFSE,
  batchEmitInvoices,
  consultarNfseEmitidas,
  consultarNfsePorFaixa,
};

export type { CreateInvoiceInput, WCIGuestData, FiscalLineItem, FiscalResolutionResult, BatchEmissionProgress };
