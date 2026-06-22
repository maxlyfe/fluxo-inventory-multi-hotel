export type NFTipo = 'nfse' | 'nfe';
export type NFStatus = 'rascunho' | 'emitida' | 'autorizada' | 'rejeitada' | 'cancelada';
export type NFAmbiente = 'homologacao' | 'producao';

export interface NFHotelConfig {
  id: string;
  hotel_id: string;
  ambiente: NFAmbiente;

  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  endereco_logradouro: string | null;
  endereco_numero: string | null;
  endereco_complemento: string | null;
  endereco_bairro: string | null;
  endereco_cidade: string | null;
  endereco_uf: string | null;
  endereco_cep: string | null;
  endereco_codigo_municipio: string | null;
  telefone: string | null;
  email: string | null;

  nfse_enabled: boolean;
  inscricao_municipal: string | null;
  regime_tributario_nfse: string | null;
  codigo_servico: string | null;
  aliquota_iss: number | null;
  serie_nfse: string | null;
  proximo_numero_nfse: number | null;
  prefeitura_login: string | null;
  prefeitura_senha: string | null;

  nfe_enabled: boolean;
  inscricao_estadual: string | null;
  crt: number | null;
  serie_nfe: string | null;
  proximo_numero_nfe: number | null;
  csc_id: string | null;
  csc_token: string | null;

  certificado_base64: string | null;
  certificado_senha: string | null;
  certificado_validade: string | null;

  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NFInvoice {
  id: string;
  hotel_id: string;
  tipo: NFTipo;

  erbon_booking_id: number | null;
  booking_number: string | null;
  room_description: string | null;

  tomador_nome: string;
  tomador_cpf_cnpj: string | null;
  tomador_email: string | null;
  tomador_endereco: string | null;

  valor_total: number;
  valor_deducoes: number;
  valor_iss: number;
  base_calculo: number;
  aliquota: number;

  status: NFStatus;

  numero_nf: string | null;
  serie: string | null;
  chave_acesso: string | null;
  numero_protocolo: string | null;
  codigo_verificacao: string | null;
  xml_envio: string | null;
  xml_retorno: string | null;
  pdf_url: string | null;

  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  xml_cancelamento: string | null;

  emitido_por: string | null;
  cancelado_por: string | null;
  created_at: string;
}

export interface NFInvoiceItem {
  id: string;
  invoice_id: string;
  erbon_entry_id: number | null;

  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;

  ncm: string | null;
  cfop: string | null;
  icms_aliquota: number | null;
  icms_valor: number | null;

  codigo_servico: string | null;
  iss_aliquota: number | null;
  iss_valor: number | null;

  created_at: string;
}

export interface NFEmittedEntry {
  id: string;
  hotel_id: string;
  erbon_entry_id: number;
  invoice_id: string;
  created_at: string;
}
