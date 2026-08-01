import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SupplierType = 'fisica' | 'juridica';
export type SupplierStatus = 'ativo' | 'inativo';

export interface Supplier {
  id?: string;
  hotel_id?: string;
  type: SupplierType;
  status: SupplierStatus;

  // Pessoa Física
  employee_id?: string | null;
  nome?: string;
  cpf?: string;
  rg?: string;
  birth_date?: string;

  // Pessoa Jurídica
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  situacao?: string;
  situacao_cadastral?: string;
  tipo_empresa?: string;
  data_abertura?: string;
  porte?: string;
  capital_social?: number;
  natureza_juridica?: string;
  cnae_principal_id?: string;
  cnae_principal_desc?: string;
  atividade_economica?: AtividadeEconomica[];
  simples_nacional?: boolean;
  mei?: boolean;
  ibs?: string;
  cbs?: string;
  lista_exclusao?: ListaExclusao[];

  // Contato
  email?: string;
  telefone?: string;

  // Endereço
  endereco_cep?: string;
  endereco_logradouro?: string;
  endereco_numero?: string;
  endereco_complemento?: string;
  endereco_bairro?: string;
  endereco_municipio?: string;
  endereco_uf?: string;

  notes?: string;
  default_chart_account_sub_id?: string | null;
  created_at?: string;
  updated_at?: string;

  // joined
  employees?: { name: string; cpf: string | null };
}

export interface AtividadeEconomica {
  id: string;
  text: string;
  principal: boolean;
}

export interface ListaExclusao {
  date?: string;
  text?: string;
}

// ─── cnpja.com API ────────────────────────────────────────────────────────────

const CNPJA_BASE = 'https://api.cnpja.com';
const CNPJA_PROXY = '/.netlify/functions/cnpj-lookup';

/**
 * Caminho legado: chamada direta do navegador com a chave no bundle.
 *
 * A chave ficava HARDCODED aqui, portanto estava pública no JS servido a
 * qualquer visitante. Agora o caminho padrão é a Netlify Function
 * cnpj-lookup, que guarda a chave (CNPJA_API_KEY) só no servidor e exige
 * usuário logado.
 *
 * Esta variável existe apenas para não derrubar a consulta enquanto a env do
 * servidor não estiver configurada. Deixá-la vazia é o estado desejado.
 *
 * ATENÇÃO: a chave que estava neste arquivo precisa ser ROTACIONADA na cnpja —
 * ela esteve no bundle público e no histórico do Git, então deve ser
 * considerada comprometida.
 */
const CNPJA_FALLBACK_KEY = (import.meta as any).env?.VITE_CNPJA_API_KEY ?? '';

export interface CnpjaResult {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao: string;
  situacao_cadastral: string;
  tipo_empresa: string;
  data_abertura: string;
  porte: string;
  capital_social: number;
  natureza_juridica: string;
  cnae_principal_id: string;
  cnae_principal_desc: string;
  atividade_economica: AtividadeEconomica[];
  simples_nacional: boolean;
  mei: boolean;
  ibs: string;
  cbs: string;
  lista_exclusao: ListaExclusao[];
  email: string;
  telefone: string;
  endereco_cep: string;
  endereco_logradouro: string;
  endereco_numero: string;
  endereco_complemento: string;
  endereco_bairro: string;
  endereco_municipio: string;
  endereco_uf: string;
}

/**
 * Consulta o CNPJ na Receita (cnpja.com) pela Netlify Function.
 *
 * Devolve null quando a function não está disponível (404 em dev sem
 * `netlify dev`, ou 503 quando CNPJA_API_KEY não foi configurada), para o
 * chamador cair no caminho legado. Erro de verdade é propagado.
 */
async function lookupCnpjViaProxy(clean: string, hotelId?: string): Promise<CnpjaResult | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;

  let res: Response;
  try {
    res = await fetch(CNPJA_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cnpj: clean, hotel_id: hotelId }),
    });
  } catch {
    return null; // sem rede até a function: tenta o caminho legado
  }

  if (res.status === 404 || res.status === 503) return null;

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error ?? `Erro ao consultar CNPJ (${res.status})`);
  }
  return mapCnpjaResponse(body.data);
}

export async function lookupCnpj(cnpj: string, hotelId?: string): Promise<CnpjaResult> {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14) throw new Error('CNPJ deve ter 14 dígitos');

  const viaProxy = await lookupCnpjViaProxy(clean, hotelId);
  if (viaProxy) return viaProxy;

  if (!CNPJA_FALLBACK_KEY) {
    throw new Error(
      'Consulta de CNPJ indisponível: configure CNPJA_API_KEY nas variáveis de ambiente da Netlify. ' +
      'Você pode cadastrar o fornecedor manualmente enquanto isso.'
    );
  }

  const res = await fetch(`${CNPJA_BASE}/office/${clean}?simples=true&registrations=BR`, {
    headers: { Authorization: CNPJA_FALLBACK_KEY },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Erro ao consultar CNPJ (${res.status}): ${body || res.statusText}`);
  }

  return mapCnpjaResponse(await res.json());
}

function mapCnpjaResponse(d: any): CnpjaResult {
  const phone = d.phones?.[0];
  const tel = phone ? `(${phone.area}) ${phone.number}` : '';

  const addr = d.address ?? {};
  const cep  = addr.zip?.replace(/\D/g, '') ?? '';

  const activities: AtividadeEconomica[] = [];
  if (d.mainActivity) {
    activities.push({ id: String(d.mainActivity.id), text: d.mainActivity.text, principal: true });
  }
  (d.sideActivities ?? []).forEach((a: any) =>
    activities.push({ id: String(a.id), text: a.text, principal: false })
  );

  const simples   = d.company?.simples;
  const simplesOk = simples?.optant ?? false;
  const meiOk     = simples?.mei    ?? false;

  // Exclusões do Simples Nacional
  const exclusoes: ListaExclusao[] = (simples?.history ?? [])
    .filter((h: any) => h.optant === false)
    .map((h: any) => ({ date: h.date, text: h.text ?? '' }));

  return {
    cnpj:                d.taxId ?? '',
    razao_social:        d.company?.name ?? '',
    nome_fantasia:       d.alias ?? '',
    situacao:            d.status?.text ?? '',
    situacao_cadastral:  d.status?.text ?? '',
    tipo_empresa:        d.head ? 'Matriz' : 'Filial',
    data_abertura:       d.founded ?? '',
    porte:               d.company?.size?.text ?? '',
    capital_social:      d.company?.equity ?? 0,
    natureza_juridica:   d.company?.nature?.text ?? '',
    cnae_principal_id:   d.mainActivity ? String(d.mainActivity.id) : '',
    cnae_principal_desc: d.mainActivity?.text ?? '',
    atividade_economica: activities,
    simples_nacional:    simplesOk,
    mei:                 meiOk,
    ibs:                 d.registrations?.find((r: any) => r.type === 'IBS')?.number ?? '',
    cbs:                 d.registrations?.find((r: any) => r.type === 'CBS')?.number ?? '',
    lista_exclusao:      exclusoes,
    email:               d.emails?.[0]?.address ?? '',
    telefone:            tel,
    endereco_cep:        cep,
    endereco_logradouro: addr.street ?? '',
    endereco_numero:     addr.number ?? '',
    endereco_complemento: addr.details ?? '',
    endereco_bairro:     addr.district ?? '',
    endereco_municipio:  addr.city ?? '',
    endereco_uf:         addr.state ?? '',
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/** Campos de um fornecedor PJ montados a partir da consulta à Receita. */
export function supplierFromCnpja(hotelId: string, d: CnpjaResult): Supplier {
  return {
    type: 'juridica',
    status: 'ativo',
    hotel_id: hotelId,
    cnpj: d.cnpj,
    razao_social: d.razao_social,
    nome_fantasia: d.nome_fantasia,
    situacao: d.situacao,
    situacao_cadastral: d.situacao_cadastral,
    tipo_empresa: d.tipo_empresa,
    data_abertura: d.data_abertura,
    porte: d.porte,
    capital_social: d.capital_social,
    natureza_juridica: d.natureza_juridica,
    cnae_principal_id: d.cnae_principal_id,
    cnae_principal_desc: d.cnae_principal_desc,
    atividade_economica: d.atividade_economica,
    simples_nacional: d.simples_nacional,
    mei: d.mei,
    ibs: d.ibs,
    cbs: d.cbs,
    lista_exclusao: d.lista_exclusao,
    email: d.email,
    telefone: d.telefone,
    endereco_cep: d.endereco_cep,
    endereco_logradouro: d.endereco_logradouro,
    endereco_numero: d.endereco_numero,
    endereco_complemento: d.endereco_complemento,
    endereco_bairro: d.endereco_bairro,
    endereco_municipio: d.endereco_municipio,
    endereco_uf: d.endereco_uf,
  };
}

export interface FindOrCreateResult {
  supplier: Supplier;
  /** true = veio da Receita e foi cadastrado agora. */
  created: boolean;
  source: 'local' | 'cnpja';
}

export const supplierService = {
  /**
   * Busca pontual e indexada por CNPJ dentro do hotel. Não consome crédito de API.
   *
   * Usa limit(1) em vez de maybeSingle() de propósito: o índice único
   * `uq_suppliers_hotel_cnpj` só existe depois da migration
   * 20260802180000, e ela depende de deduplicação manual do dado legado
   * (docs/sql-scripts/suppliers_dedup_cnpj.sql). Com maybeSingle, um CNPJ
   * duplicado legado faria a busca lançar erro e travar o cadastro de parceiro
   * inteiro. Preferindo o mais antigo, o comportamento fica estável antes e
   * depois da deduplicação.
   */
  async findByCnpj(hotelId: string, cnpj: string): Promise<Supplier | null> {
    const clean = (cnpj ?? '').replace(/\D/g, '');
    if (clean.length !== 14) return null;
    const { data, error } = await supabase
      .from('suppliers').select('*')
      .eq('hotel_id', hotelId).eq('cnpj', clean)
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw error;
    return (data?.[0] as Supplier) ?? null;
  },

  /**
   * Resolve um CNPJ para um fornecedor do hotel em UMA ação:
   * busca no cadastro local (não consome crédito de API), e só se não achar
   * consulta a Receita e cadastra.
   *
   * Era o padrão duplicado dentro do NFeXMLImportModal. Consultar a API sem
   * checar o cadastro antes queima crédito a cada chamada.
   */
  async findOrCreateByCnpj(hotelId: string, cnpj: string): Promise<FindOrCreateResult> {
    const clean = (cnpj ?? '').replace(/\D/g, '');
    if (clean.length !== 14) throw new Error('CNPJ inválido: precisa ter 14 dígitos');

    const existing = await this.findByCnpj(hotelId, clean);
    if (existing) return { supplier: existing, created: false, source: 'local' };

    const fromApi = await lookupCnpj(clean, hotelId);
    // O CNPJ gravado é o normalizado, para o unique (hotel_id, cnpj) e a busca
    // por CNPJ funcionarem independente da formatação devolvida pela API.
    const saved = await this.save({ ...supplierFromCnpja(hotelId, fromApi), cnpj: clean });
    return { supplier: saved, created: true, source: 'cnpja' };
  },

  async list(hotelId: string): Promise<Supplier[]> {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*, employees(name, cpf)')
      .eq('hotel_id', hotelId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async save(supplier: Supplier): Promise<Supplier> {
    const { employees: _e, ...payload } = supplier;
    const now = new Date().toISOString();

    if (supplier.id) {
      const { data, error } = await supabase
        .from('suppliers')
        .update({ ...payload, updated_at: now })
        .eq('id', supplier.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('suppliers')
      .insert({ ...payload, updated_at: now })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw error;
  },

  async listEmployees(hotelId: string) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, cpf, email, phone, address_street, address_number, address_neighborhood, address_city, address_state, address_cep')
      .eq('hotel_id', hotelId)
      .order('name');
    if (error) throw error;
    return data ?? [];
  },
};

export function formatCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function formatCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
