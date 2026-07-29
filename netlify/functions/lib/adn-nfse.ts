// netlify/functions/lib/adn-nfse.ts
// Integração com o ADN (Ambiente de Dados Nacional) para emissão de NFS-e
// via Sistema Nacional NFS-e (Receita Federal / Serpro).
// Autenticação: mTLS com certificado A1 (.pfx) — mesmo padrão de dfe.ts.

import https from 'https';
import {
  buildDpsXml,
  signDps,
  gzipB64,
  gunzipB64,
  parseNfseXml,
  buildPedRegEventoXml,
  type ELNacionalConfig,
  type ELNacionalTomador,
  type ELNacionalItem,
} from './el-nacional-nfse';
import { extractPemFromPfx } from './dfe';

// API do Sefin Nacional (emissão, consulta, eventos, DANFSE).
//
// ATENÇÃO ao host: `www.nfse.gov.br` é o PORTAL (site institucional em IIS), não
// a API. Apontar para lá devolve uma página HTML de "403 Forbidden" em
// iso-8859-1 em vez de um erro JSON da API — foi exatamente esse o sintoma que
// fez a emissão por ADN falhar. A API vive no host `sefin.`.
const SEFIN_HOSTS = {
  producao: 'sefin.nfse.gov.br',
  homologacao: 'sefin.producaorestrita.nfse.gov.br', // "produção restrita"
} as const;

// ADN propriamente dito: API de DISTRIBUIÇÃO (baixar NFS-e recebidas por
// terceiros). Não serve para emitir nem para consultar nota própria.
const ADN_HOSTS = {
  producao: 'adn.nfse.gov.br',
  homologacao: 'adn.producaorestrita.nfse.gov.br',
} as const;

type Ambiente = 'producao' | 'homologacao';

// ─── HTTP helpers ───────────────────────────────────────────────────────────

function httpsRequest(
  options: https.RequestOptions & { body?: string },
): Promise<{ status: number; body: string; rawBuffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 0,
          body: rawBuffer.toString('utf8'),
          rawBuffer,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout na comunicação com o ADN')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function pfxBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

// ─── DPS Builder ────────────────────────────────────────────────────────────

export interface DPSConfig {
  cnpj: string;
  inscricao_municipal: string;
  razao_social: string;
  nome_fantasia?: string;
  endereco_logradouro?: string;
  endereco_numero?: string;
  endereco_complemento?: string;
  endereco_bairro?: string;
  endereco_cidade?: string;
  endereco_uf?: string;
  endereco_cep?: string;
  endereco_codigo_municipio: string;
  telefone?: string;
  email?: string;
  regime_tributario_nfse?: string;
  codigo_servico: string;
  aliquota_iss: number;
  // Reforma Tributária (IBS/CBS, NT 2025.002) — bloco IBSCBS por DPS. Mesmos
  // campos de nf_hotel_config usados no formato 'el-nacional' (paridade entre
  // os dois formatos alternativos à Nota Nacional ABRASF).
  ibs_cbs_cst?: string | null;
  ibs_cbs_cclasstrib?: string | null;
  fin_nfse?: number | null;
  ind_final?: number | null;
  c_ind_op?: string | null;
  ind_dest?: number | null;
}

export interface DPSTomador {
  nome: string;
  doc_tipo: 'cpf' | 'cnpj' | 'passaporte' | null;
  doc_numero: string | null;
  nacionalidade?: string | null;
  email?: string | null;
  // Endereço nacional do tomador. Obrigatório quando o ISSQN é retido pelo
  // tomador (rejeição E0237); fora desse caso é opcional, mas mandamos quando
  // existe para a NFS-e sair completa.
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  codigo_municipio?: string | null;
  cep?: string | null;
}

export interface DPSItem {
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  codigo_servico?: string;
  iss_aliquota?: number;
}

// ─── Mapeamento para a DPS compartilhada ────────────────────────────────────
//
// A DPS enviada ao Sefin Nacional é o MESMO XML assinado usado no formato
// 'el-nacional'; a única diferença é o transporte (mTLS direto aqui, wrapper
// com token lá). Por isso reaproveitamos buildDpsXml em vez de manter um
// segundo builder — foi um builder JSON paralelo que fez esta integração
// enviar um corpo que a API não aceita.

function toELConfig(config: DPSConfig, ambiente: Ambiente, cert: string, senha: string): ELNacionalConfig {
  return {
    token: '', // não se aplica: o Sefin Nacional autentica por mTLS
    ambiente,
    certificado_base64: cert,
    certificado_senha: senha,
    cnpj: config.cnpj,
    inscricao_municipal: config.inscricao_municipal,
    codigo_municipio: config.endereco_codigo_municipio,
    codigo_servico: config.codigo_servico,
    aliquota_iss: config.aliquota_iss,
    // regime_tributario_nfse '6' = optante do Simples Nacional (mesma
    // convenção usada em nfService ao montar o payload de NFS-e)
    optante_simples: config.regime_tributario_nfse === '6',
    telefone: config.telefone ?? null,
    ibs_cbs_cst: config.ibs_cbs_cst ?? null,
    ibs_cbs_cclasstrib: config.ibs_cbs_cclasstrib ?? null,
    fin_nfse: config.fin_nfse ?? null,
    ind_final: config.ind_final ?? null,
    c_ind_op: config.c_ind_op ?? null,
    ind_dest: config.ind_dest ?? null,
  };
}

function toELTomador(tomador: DPSTomador): ELNacionalTomador {
  return {
    cpf_cnpj: tomador.doc_numero ?? null,
    doc_tipo: tomador.doc_tipo,
    razao_social: tomador.nome,
    endereco: tomador.endereco ?? null,
    numero: tomador.numero ?? null,
    bairro: tomador.bairro ?? null,
    codigo_municipio: tomador.codigo_municipio ?? null,
    cep: tomador.cep ?? null,
  };
}

function toELItems(items: DPSItem[]): ELNacionalItem[] {
  return items.map(i => ({
    description: i.descricao,
    quantidade: i.quantidade,
    valor_unitario: i.valor_unitario,
    valor_total: i.valor_total,
  }));
}

// Monta e assina a DPS que será enviada ao Sefin Nacional. Exportada para
// permitir validar a estrutura (incluindo o bloco <IBSCBS>) sem rede.
export function buildDpsXmlADN(
  config: DPSConfig,
  tomador: DPSTomador,
  items: DPSItem[],
  serie: string,
  numeroDPS: number,
  ambiente: Ambiente,
): { xml: string; dpsId: string } {
  return buildDpsXml(
    toELConfig(config, ambiente, '', ''),
    toELTomador(tomador),
    toELItems(items),
    serie,
    numeroDPS,
  );
}

// ─── Emissão de DPS (Declaração de Prestação de Serviço) ────────────────────

export interface EmissaoDPSResult {
  success: boolean;
  idDPS?: string;
  chaveAcesso?: string;
  numeroNFSe?: string;
  codigoVerificacao?: string;
  protocolo?: string;
  xmlRetorno?: string;
  dpsXml?: string; // DPS assinada que foi enviada, para auditoria
  mensagem: string;
  cStat?: string;
}

// A API do Sefin Nacional recebe a DPS como XML ASSINADO, comprimido em GZip e
// codificado em Base64, dentro de { dpsXmlGZipB64 }. Antes esta função enviava
// o objeto DPS como JSON cru, que a API não aceita.
export async function emitirDPS(params: {
  certificado_base64: string;
  certificado_senha: string;
  config: DPSConfig;
  tomador: DPSTomador;
  items: DPSItem[];
  serie: string;
  numeroDPS: number;
  ambiente: Ambiente;
}): Promise<EmissaoDPSResult> {
  // 1. Montar e assinar a DPS (mesmo builder do formato 'el-nacional')
  const { xml, dpsId } = buildDpsXmlADN(
    params.config, params.tomador, params.items, params.serie, params.numeroDPS, params.ambiente,
  );
  const { key, cert } = extractPemFromPfx(params.certificado_base64, params.certificado_senha);
  const signed = signDps(xml, dpsId, key, cert);
  console.log('[NFS-e ADN] DPS montada e assinada, id:', dpsId);

  // 2. GZip + Base64 e envio via mTLS
  const body = JSON.stringify({ dpsXmlGZipB64: gzipB64(signed) });
  const res = await httpsRequest({
    host: SEFIN_HOSTS[params.ambiente],
    path: '/SefinNacional/nfse',
    method: 'POST',
    pfx: pfxBuffer(params.certificado_base64),
    passphrase: params.certificado_senha,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  console.log('[NFS-e ADN] POST /SefinNacional/nfse →', res.status, res.body.slice(0, 500));

  if (res.status === 200 || res.status === 201) {
    let data: any = {};
    try {
      data = JSON.parse(res.body);
    } catch {
      return { success: true, idDPS: dpsId, xmlRetorno: res.body, mensagem: 'NFS-e processada (resposta não-JSON)' };
    }

    // A NFS-e autorizada volta pronta, também em GZip+Base64
    let nfseXml = '';
    if (data.nfseXmlGZipB64 && !String(data.nfseXmlGZipB64).startsWith('<')) {
      try { nfseXml = gunzipB64(data.nfseXmlGZipB64); } catch { /* sem XML utilizável */ }
    }
    const parsed = nfseXml ? parseNfseXml(nfseXml) : { numero: null, chave: null, codigoVerificacao: null };

    return {
      success: true,
      idDPS: data.idDPS ?? dpsId,
      chaveAcesso: data.chaveAcesso ?? parsed.chave ?? undefined,
      numeroNFSe: parsed.numero ?? data.nNFSe ?? undefined,
      codigoVerificacao: parsed.codigoVerificacao ?? undefined,
      protocolo: data.nProt ?? data.protocolo,
      xmlRetorno: nfseXml || res.body,
      dpsXml: signed,
      mensagem: nfseXml ? 'NFS-e autorizada pela Plataforma Nacional' : (data.xMotivo ?? data.mensagem ?? 'DPS recebida'),
      cStat: data.cStat,
    };
  }

  return { success: false, idDPS: dpsId, dpsXml: signed, mensagem: describeSefinError(res), cStat: String(res.status) };
}

// Traduz a resposta de erro do Sefin Nacional. A API devolve JSON, mas um host
// errado ou um bloqueio de borda devolve HTML — detectar isso evita despejar
// uma página inteira na tela do usuário.
function describeSefinError(res: { status: number; body: string }): string {
  const body = res.body ?? '';
  const isHtml = /^\s*<(!doctype|html)/i.test(body);

  if (isHtml) {
    if (res.status === 403) {
      return 'Sefin Nacional respondeu 403 (Forbidden) com uma página HTML, não com um erro da API. '
        + 'Isso indica que o certificado não está habilitado para emitir por este ambiente, ou que o '
        + 'município não delegou a emissão ao Sistema Nacional. Confirme a adesão do município e a '
        + 'habilitação do CNPJ antes de tentar de novo.';
    }
    return `Sefin Nacional respondeu HTTP ${res.status} com uma página HTML em vez de um erro da API.`;
  }

  let detalhe = body.slice(0, 300);
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data?.erros) && data.erros.length > 0) {
      detalhe = data.erros
        .map((e: any) => `${e.Codigo ?? e.codigo ?? ''}: ${e.Descricao ?? e.descricao ?? JSON.stringify(e)}`)
        .join(' | ');
    } else {
      detalhe = data.mensagem ?? data.message ?? data.xMotivo ?? detalhe;
    }
  } catch { /* mantém o corpo cru */ }

  return `Sefin Nacional respondeu HTTP ${res.status}: ${detalhe}`;
}

// ─── Consulta NFS-e por chave ───────────────────────────────────────────────

export interface ConsultaNFSeResult {
  success: boolean;
  data?: any;
  mensagem: string;
}

export async function consultarNFSe(params: {
  certificado_base64: string;
  certificado_senha: string;
  chaveAcesso: string;
  ambiente: Ambiente;
}): Promise<ConsultaNFSeResult> {
  // Nota PRÓPRIA se consulta no Sefin Nacional. O host adn.* + /contribuintes é
  // a API de distribuição (notas recebidas de terceiros), outro serviço.
  const res = await httpsRequest({
    host: SEFIN_HOSTS[params.ambiente],
    path: `/SefinNacional/nfse/${params.chaveAcesso}`,
    method: 'GET',
    pfx: pfxBuffer(params.certificado_base64),
    passphrase: params.certificado_senha,
    headers: { 'Accept': 'application/json' },
  });

  if (res.status === 200) {
    try {
      const data = JSON.parse(res.body);
      return { success: true, data, mensagem: 'Consulta realizada com sucesso' };
    } catch {
      return { success: true, data: res.body, mensagem: 'Consulta ok (resposta não-JSON)' };
    }
  }

  return { success: false, mensagem: describeSefinError(res) };
}

// ─── Registro de Evento (cancelamento) ──────────────────────────────────────

export interface EventoNFSeResult {
  success: boolean;
  protocolo?: string;
  mensagem: string;
  cStat?: string;
}

// Cancelamento: POST /SefinNacional/nfse/{chave}/eventos, com o pedido de
// registro de evento em XML ASSINADO + GZip + Base64 (mesma forma da emissão).
// Antes esta função postava um JSON solto em /SefinNacional/nfse/evento, rota
// que não existe.
export async function registrarEvento(params: {
  certificado_base64: string;
  certificado_senha: string;
  cnpj: string;
  chaveAcesso: string;
  tipoEvento: 'cancelamento';
  codigoCancelamento?: string;
  motivo: string;
  ambiente: Ambiente;
}): Promise<EventoNFSeResult> {
  const { xml, pedId } = buildPedRegEventoXml(
    params.cnpj, params.ambiente, params.chaveAcesso, params.motivo,
  );
  const { key, cert } = extractPemFromPfx(params.certificado_base64, params.certificado_senha);
  const signed = signDps(xml, pedId, key, cert);

  const body = JSON.stringify({ pedidoRegistroEventoXmlGZipB64: gzipB64(signed) });
  const res = await httpsRequest({
    host: SEFIN_HOSTS[params.ambiente],
    path: `/SefinNacional/nfse/${params.chaveAcesso}/eventos`,
    method: 'POST',
    pfx: pfxBuffer(params.certificado_base64),
    passphrase: params.certificado_senha,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  console.log('[NFS-e ADN] Cancelamento →', res.status, res.body.slice(0, 500));

  if (res.status === 200 || res.status === 201) {
    let data: any = {};
    try { data = JSON.parse(res.body); } catch { /* resposta não-JSON */ }
    return {
      success: true,
      protocolo: data.nProt ?? data.protocolo,
      mensagem: data.xMotivo ?? data.mensagem ?? 'Cancelamento registrado na Plataforma Nacional',
      cStat: data.cStat,
    };
  }

  return { success: false, mensagem: describeSefinError(res), cStat: String(res.status) };
}

// ─── Buscar DANFSE (PDF) ────────────────────────────────────────────────────

export interface DANFSEResult {
  success: boolean;
  pdfBase64?: string;
  contentType?: string;
  mensagem: string;
}

export async function buscarDANFSE(params: {
  certificado_base64: string;
  certificado_senha: string;
  chaveAcesso: string;
  ambiente: Ambiente;
}): Promise<DANFSEResult> {
  const res = await httpsRequest({
    host: SEFIN_HOSTS[params.ambiente],
    path: `/SefinNacional/danfse/${params.chaveAcesso}`,
    method: 'GET',
    pfx: pfxBuffer(params.certificado_base64),
    passphrase: params.certificado_senha,
    headers: { 'Accept': 'application/pdf' },
  });

  if (res.status === 200) {
    return {
      success: true,
      pdfBase64: res.rawBuffer.toString('base64'),
      contentType: 'application/pdf',
      mensagem: 'DANFSE obtido com sucesso',
    };
  }

  return { success: false, mensagem: describeSefinError(res) };
}

// ─── Teste de conexão ───────────────────────────────────────────────────────

export async function testarConexaoADN(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: Ambiente;
}): Promise<{ success: boolean; mensagem: string }> {
  try {
    const res = await httpsRequest({
      host: SEFIN_HOSTS[params.ambiente],
      path: '/SefinNacional/',
      method: 'GET',
      pfx: pfxBuffer(params.certificado_base64),
      passphrase: params.certificado_senha,
      headers: { 'Accept': 'application/json' },
    });

    // Antes qualquer status < 500 era tratado como sucesso, o que fazia o teste
    // dizer "conexão estabelecida com sucesso. HTTP 403" e esconder justamente o
    // problema que impedia a emissão. TLS de pé não significa acesso liberado.
    if (res.status === 403 || res.status === 401) {
      return {
        success: false,
        mensagem: `O Sefin Nacional (${params.ambiente}) aceitou o certificado no TLS mas negou o acesso `
          + `(HTTP ${res.status}). Verifique se o CNPJ está habilitado a emitir pelo Sistema Nacional e se o `
          + `município delegou a emissão ao ambiente nacional.`,
      };
    }
    if (res.status >= 200 && res.status < 500) {
      return {
        success: true,
        mensagem: `Conexão mTLS com o Sefin Nacional (${params.ambiente}) estabelecida. HTTP ${res.status}`,
      };
    }
    return {
      success: false,
      mensagem: `Sefin Nacional respondeu HTTP ${res.status}. Verifique o certificado e o ambiente selecionado.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    const friendly = /mac verify|invalid password|pkcs/i.test(msg)
      ? 'Senha do certificado incorreta ou arquivo .pfx inválido.'
      : msg;
    return { success: false, mensagem: `Falha na conexão com ADN: ${friendly}` };
  }
}
