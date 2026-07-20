export type NFTipo = 'nfse' | 'nfe' | 'nfce';
export type NFStatus = 'rascunho' | 'emitida' | 'autorizada' | 'rejeitada' | 'cancelada' | 'contingencia';
export type NFAmbiente = 'homologacao' | 'producao';
export type NFDocTipo = 'cpf' | 'cnpj' | 'passaporte';
export type NFSEProvider = 'prefeitura' | 'adn' | 'el-nacional';

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

  nfce_enabled: boolean;
  serie_nfce: string | null;
  proximo_numero_nfce: number | null;
  nfce_csc_id: string | null;
  nfce_csc_token: string | null;

  certificado_base64: string | null;
  certificado_senha: string | null;
  certificado_validade: string | null;

  nfse_provider: NFSEProvider;
  adn_ambiente: NFAmbiente;
  el_token: string | null;
  el_ambiente: NFAmbiente;
  codigo_servico_municipal: string | null;
  logo_url: string | null;

  nf_recebidas_enabled: boolean;
  dfe_ultimo_nsu: string | null;
  dfe_ultima_consulta: string | null;

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
  tomador_doc_tipo: NFDocTipo;
  tomador_nacionalidade: string | null;
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
  qrcode_url: string | null;
  url_consulta: string | null;

  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  xml_cancelamento: string | null;

  contingencia_motivo: string | null;
  numero_rps: string | null;
  contingencia_protocolo: string | null;
  contingencia_em: string | null;
  retransmitido_em: string | null;
  retry_count: number;

  nfse_provider: NFSEProvider | null;
  xml_dps: string | null;
  danfse_url: string | null;

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

export type NFReceivedSituacao = 'nova' | 'lancada' | 'ignorada';
export type TipoManifestacao = '210210' | '210200' | '210220' | '210240';

export interface NFReceived {
  id: string;
  hotel_id: string;
  nsu: string | null;
  schema_doc: string | null;
  tipo: 'resumo' | 'completa';
  chave_acesso: string;
  numero_nf: string | null;
  serie: string | null;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  valor_total: number | null;
  data_emissao: string | null;
  xml: string | null;
  situacao: NFReceivedSituacao;
  purchase_id: string | null;
  manifestacao: TipoManifestacao | null;
  manifestacao_at: string | null;
  manifestacao_protocolo: string | null;
  created_at: string;
  updated_at: string;
}

export interface NFEmittedEntry {
  id: string;
  hotel_id: string;
  erbon_entry_id: number;
  invoice_id: string;
  created_at: string;
}
