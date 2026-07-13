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

const CNPJA_API_KEY = '0b013673-073e-4b97-8b36-ed5bdaf6cc22-9dd54422-51a8-48d0-8b5a-121eaf8cbb50';
const CNPJA_BASE    = 'https://api.cnpja.com';

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

export async function lookupCnpj(cnpj: string): Promise<CnpjaResult> {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14) throw new Error('CNPJ deve ter 14 dígitos');

  const res = await fetch(`${CNPJA_BASE}/office/${clean}?simples=true&registrations=BR`, {
    headers: { Authorization: CNPJA_API_KEY },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Erro ao consultar CNPJ (${res.status}): ${body || res.statusText}`);
  }

  const data = await res.json();
  return mapCnpjaResponse(data);
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

export const supplierService = {
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
