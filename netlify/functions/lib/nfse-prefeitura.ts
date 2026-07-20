// netlify/functions/lib/nfse-prefeitura.ts
// Integração real com webservice NFS-e da Prefeitura de Armação dos Búzios.
// Padrão ABRASF 2.02 · Provedor E&L (Modernização Pública).
// Certificado A1 usado para assinatura XMLDSig; transporte via HTTP.

import https from 'https';
import crypto from 'crypto';
import { SignedXml } from 'xml-crypto';
import { extractPemFromPfx } from './dfe';

// ── Hosts por ambiente (E&L Cloud — Búzios) ─────────────────────────────────

const NFSE_CONFIG = {
  producao:    { host: 'rj-buzios-pm-nfs-backend.cloud.el.com.br', path: '/producao35/NfseWSService' },
  homologacao: { host: 'rj-buzios-pm-nfs-backend.cloud.el.com.br', path: '/producao35/NfseWSService' },
} as const;

const ABRASF_NS = 'http://www.abrasf.org.br/nfse.xsd';
const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const NFSE_ACTION_NS = 'http://nfse.abrasf.org.br';

// ── HTTP POST (E&L usa HTTP, não HTTPS) ─────────────────────────────────────

function httpsPost(
  options: { host: string; path: string; headers: Record<string, string> },
  body: string,
  timeoutMs = 60000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: options.host, port: 443, path: options.path, method: 'POST', headers: options.headers },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout na comunicação com a Prefeitura')));
    req.write(body);
    req.end();
  });
}

async function httpPost(
  options: { host: string; path: string; headers: Record<string, string> },
  body: string,
): Promise<{ status: number; body: string }> {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await httpsPost(options, body);
      if (res.status === 503 && attempt < maxRetries) {
        const delay = (attempt + 1) * 3000;
        console.log(`[NFS-e] HTTP 503, retry ${attempt + 1}/${maxRetries} em ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err: any) {
      if (attempt < maxRetries && (err.message?.includes('Timeout') || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED')) {
        const delay = (attempt + 1) * 3000;
        console.log(`[NFS-e] ${err.message}, retry ${attempt + 1}/${maxRetries} em ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Máximo de tentativas excedido');
}

// ── XML helpers ──────────────────────────────────────────────────────────────

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[\\w]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function unescapeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractOutputXml(soapBody: string): string {
  const outputXml = xmlTag(soapBody, 'outputXML');
  if (outputXml) {
    return unescapeXmlEntities(outputXml);
  }
  return soapBody;
}

function soapEnvelope(operation: string, cabecMsg: string, dadosMsg: string): string {
  // E&L Cloud XSD: each operation wraps input in {Operation}Request element
  // containing nfseCabecMsg/nfseDadosMsg (form="qualified").
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_NS}" xmlns:nfse="${NFSE_ACTION_NS}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<nfse:${operation}>` +
    `<nfse:${operation}Request>` +
    `<nfseCabecMsg><![CDATA[${cabecMsg}]]></nfseCabecMsg>` +
    `<nfseDadosMsg><![CDATA[${dadosMsg}]]></nfseDadosMsg>` +
    `</nfse:${operation}Request>` +
    `</nfse:${operation}>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

function cabecalhoXml(): string {
  return (
    `<cabecalho xmlns="${ABRASF_NS}" versao="2.02">` +
    `<versaoDados>2.02</versaoDados>` +
    `</cabecalho>`
  );
}

// ── Assinatura XMLDSig ───────────────────────────────────────────────────────

function signRps(xml: string, refId: string, keyPem: string, certPem: string): string {
  const sig = new SignedXml({
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    privateKey: crypto.createPrivateKey(keyPem),
    publicCert: certPem,
  });
  sig.addReference({
    xpath: `//*[@Id='${refId}']`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });
  sig.computeSignature(xml, {
    location: { reference: `//*[@Id='${refId}']`, action: 'after' },
  });
  return sig.getSignedXml();
}

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface NfsePrestador {
  cnpj: string;
  inscricao_municipal: string;
}

export interface NfseTomador {
  cpf_cnpj: string | null;
  doc_tipo: 'cpf' | 'cnpj' | 'passaporte' | null;
  razao_social: string;
  email: string | null;
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  codigo_municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
}

export interface NfseItem {
  description: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
}

export interface NfseConfig {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: 'producao' | 'homologacao';
  codigo_municipio: string;
  codigo_servico: string;
  aliquota_iss: number;
  regime_tributario: string | null;
  optante_simples: boolean;
}

export interface EmissaoNfseResult {
  success: boolean;
  numero_nf: string | null;
  serie: string | null;
  codigo_verificacao: string | null;
  numero_protocolo: string | null;
  chave_acesso: string | null;
  xml_retorno: string;
  message: string;
}

export interface CancelamentoNfseResult {
  success: boolean;
  xml_cancelamento: string;
  message: string;
}

// ── Montar XML do RPS (ABRASF 2.02) ─────────────────────────────────────────

function buildRpsXml(
  prestador: NfsePrestador,
  tomador: NfseTomador,
  items: NfseItem[],
  config: NfseConfig,
  numeroRps: number,
  serieRps: string,
): string {
  const cnpjPrestador = prestador.cnpj.replace(/\D/g, '');
  const im = prestador.inscricao_municipal.replace(/\D/g, '');
  const valorServicos = items.reduce((s, it) => s + it.valor_total, 0);
  const aliquota = config.aliquota_iss / 100;
  const valorIss = +(valorServicos * aliquota).toFixed(2);

  const discriminacao = items
    .map(it => `${it.description} - Qtd: ${it.quantidade} x R$ ${it.valor_unitario.toFixed(2)} = R$ ${it.valor_total.toFixed(2)}`)
    .join('\n');

  const rawCodigo = config.codigo_servico || '09.01';
  const codigoServico = rawCodigo.includes('.') ? rawCodigo : rawCodigo.replace(/^(\d{2})(\d{2})$/, '$1.$2');
  const codigoMunicipio = config.codigo_municipio || '3300233';
  const optanteSN = config.optante_simples ? '1' : '2';

  // ExigibilidadeISS: 1 = Exigível
  const exigibilidade = '1';

  const rpsId = `rps_${numeroRps}`;

  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dataEmissao = now.toISOString().slice(0, 10);
  const competencia = now.toISOString().slice(0, 10);

  // Tomador XML
  let tomadorXml = '<TomadorServico>';
  if (tomador.cpf_cnpj && tomador.doc_tipo !== 'passaporte') {
    const docLimpo = tomador.cpf_cnpj.replace(/\D/g, '');
    const isCnpj = tomador.doc_tipo === 'cnpj' || docLimpo.length > 11;
    tomadorXml += '<IdentificacaoTomador><CpfCnpj>';
    tomadorXml += isCnpj ? `<Cnpj>${docLimpo}</Cnpj>` : `<Cpf>${docLimpo}</Cpf>`;
    tomadorXml += '</CpfCnpj></IdentificacaoTomador>';
  }
  tomadorXml += `<RazaoSocial>${xmlEsc(tomador.razao_social)}</RazaoSocial>`;

  if (tomador.endereco) {
    tomadorXml += '<Endereco>';
    tomadorXml += `<Endereco>${xmlEsc(tomador.endereco)}</Endereco>`;
    if (tomador.numero) tomadorXml += `<Numero>${xmlEsc(tomador.numero)}</Numero>`;
    if (tomador.bairro) tomadorXml += `<Bairro>${xmlEsc(tomador.bairro)}</Bairro>`;
    if (tomador.codigo_municipio) tomadorXml += `<CodigoMunicipio>${tomador.codigo_municipio}</CodigoMunicipio>`;
    if (tomador.uf) tomadorXml += `<Uf>${tomador.uf}</Uf>`;
    if (tomador.cep) tomadorXml += `<Cep>${tomador.cep.replace(/\D/g, '')}</Cep>`;
    tomadorXml += '</Endereco>';
  }

  if (tomador.email) {
    tomadorXml += `<Contato><Email>${xmlEsc(tomador.email)}</Email></Contato>`;
  }
  tomadorXml += '</TomadorServico>';

  // Regime especial: 1=Microempresa, 2=Estimativa, 3=Sociedade Profissionais, 4=Cooperativa, 6=MEI
  const regimeEspecial = config.regime_tributario
    ? `<RegimeEspecialTributacao>${config.regime_tributario}</RegimeEspecialTributacao>`
    : '';

  const infDPS =
    `<InfDeclaracaoPrestacaoServico Id="${rpsId}">` +
    `<Rps>` +
    `<IdentificacaoRps>` +
    `<Numero>${numeroRps}</Numero>` +
    `<Serie>${xmlEsc(serieRps)}</Serie>` +
    `<Tipo>1</Tipo>` +
    `</IdentificacaoRps>` +
    `<DataEmissao>${dataEmissao}</DataEmissao>` +
    `<Status>1</Status>` +
    `</Rps>` +
    `<Competencia>${competencia}</Competencia>` +
    `<Servico>` +
    `<Valores>` +
    `<ValorServicos>${valorServicos.toFixed(2)}</ValorServicos>` +
    `<ValorIss>${valorIss.toFixed(2)}</ValorIss>` +
    `<Aliquota>${aliquota.toFixed(2)}</Aliquota>` +
    `</Valores>` +
    `<IssRetido>2</IssRetido>` +
    `<ItemListaServico>${codigoServico}</ItemListaServico>` +
    `<CodigoTributacaoMunicipio>${codigoServico}</CodigoTributacaoMunicipio>` +
    `<Discriminacao>${xmlEsc(discriminacao)}</Discriminacao>` +
    `<CodigoMunicipio>${codigoMunicipio}</CodigoMunicipio>` +
    `<ExigibilidadeISS>${exigibilidade}</ExigibilidadeISS>` +
    `<MunicipioIncidencia>${codigoMunicipio}</MunicipioIncidencia>` +
    `</Servico>` +
    `<Prestador>` +
    `<CpfCnpj><Cnpj>${cnpjPrestador}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `</Prestador>` +
    tomadorXml +
    regimeEspecial +
    `<OptanteSimplesNacional>${optanteSN}</OptanteSimplesNacional>` +
    `<IncentivoFiscal>2</IncentivoFiscal>` +
    `</InfDeclaracaoPrestacaoServico>`;

  return (
    `<GerarNfseEnvio xmlns="${ABRASF_NS}">` +
    `<Rps>${infDPS}</Rps>` +
    `</GerarNfseEnvio>`
  );
}

// ── Emitir NFS-e (GerarNfse) ─────────────────────────────────────────────────

export async function emitirNfsePrefeitura(params: {
  prestador: NfsePrestador;
  tomador: NfseTomador;
  items: NfseItem[];
  config: NfseConfig;
  numeroRps: number;
  serieRps: string;
}): Promise<EmissaoNfseResult> {
  const { prestador, tomador, items, config, numeroRps, serieRps } = params;
  const rpsId = `rps_${numeroRps}`;

  // 1. Montar XML do RPS
  let rpsXml = buildRpsXml(prestador, tomador, items, config, numeroRps, serieRps);

  // 2. Assinar XML com certificado A1
  const { key, cert } = extractPemFromPfx(config.certificado_base64, config.certificado_senha);
  rpsXml = signRps(rpsXml, rpsId, key, cert);

  // 3. Montar envelope SOAP
  const envelope = soapEnvelope('GerarNfse', cabecalhoXml(), rpsXml);

  // 4. Enviar via HTTP para E&L
  const { host, path: wsPath } = NFSE_CONFIG[config.ambiente];
  console.log(`[NFS-e SOAP] Enviando para https://${host}${wsPath}`);
  console.log('[NFS-e SOAP] Envelope (primeiros 2000 chars):', envelope.slice(0, 2000));
  const res = await httpPost(
    { host, path: wsPath, headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': `${NFSE_ACTION_NS}/GerarNfse` } },
    envelope,
  );

  if (res.status !== 200) {
    return {
      success: false,
      numero_nf: null, serie: null, codigo_verificacao: null,
      numero_protocolo: null, chave_acesso: null,
      xml_retorno: res.body,
      message: `Prefeitura respondeu HTTP ${res.status}: ${res.body.slice(0, 500)}`,
    };
  }

  // 5. Parsear resposta SOAP
  const respBody = extractOutputXml(res.body);
  console.log('[NFS-e SOAP] Status HTTP:', res.status);
  console.log('[NFS-e SOAP] Resposta (primeiros 3000 chars):', respBody.slice(0, 3000));

  // Verificar erros ABRASF
  const codigoErro = xmlTag(respBody, 'Codigo');
  const mensagemErro = xmlTag(respBody, 'Mensagem');
  const correcao = xmlTag(respBody, 'Correcao');

  // Verificar se tem ListaMensagemRetorno com erros
  if (xmlTag(respBody, 'ListaMensagemRetorno') && codigoErro) {
    return {
      success: false,
      numero_nf: null, serie: null, codigo_verificacao: null,
      numero_protocolo: null, chave_acesso: null,
      xml_retorno: respBody,
      message: `Erro ${codigoErro}: ${mensagemErro || 'Erro desconhecido'}${correcao ? ` — ${correcao}` : ''}`,
    };
  }

  // Extrair dados da NFS-e gerada
  const numeroNf = xmlTag(respBody, 'Numero');
  const codigoVerificacao = xmlTag(respBody, 'CodigoVerificacao');
  const dataEmissaoNf = xmlTag(respBody, 'DataEmissao');

  if (!numeroNf) {
    return {
      success: false,
      numero_nf: null, serie: null, codigo_verificacao: null,
      numero_protocolo: null, chave_acesso: null,
      xml_retorno: respBody,
      message: `Resposta inesperada da prefeitura (sem número de NFS-e): ${respBody.slice(0, 500)}`,
    };
  }

  return {
    success: true,
    numero_nf: numeroNf,
    serie: serieRps,
    codigo_verificacao: codigoVerificacao,
    numero_protocolo: null,
    chave_acesso: null,
    xml_retorno: respBody,
    message: `NFS-e ${numeroNf} emitida com sucesso pela Prefeitura de Búzios.`,
  };
}

// ── Cancelar NFS-e ───────────────────────────────────────────────────────────

export async function cancelarNfsePrefeitura(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: 'producao' | 'homologacao';
  cnpj: string;
  inscricao_municipal: string;
  numero_nf: string;
  codigo_municipio: string;
  codigo_cancelamento?: string;
}): Promise<CancelamentoNfseResult> {
  const cnpj = params.cnpj.replace(/\D/g, '');
  const im = params.inscricao_municipal.replace(/\D/g, '');
  const codCanc = params.codigo_cancelamento || '2';

  const pedidoId = `cancel_${params.numero_nf}`;

  const cancelXml =
    `<CancelarNfseEnvio xmlns="${ABRASF_NS}">` +
    `<Pedido>` +
    `<InfPedidoCancelamento Id="${pedidoId}">` +
    `<IdentificacaoNfse>` +
    `<Numero>${params.numero_nf}</Numero>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `<CodigoMunicipio>${params.codigo_municipio}</CodigoMunicipio>` +
    `</IdentificacaoNfse>` +
    `<CodigoCancelamento>${codCanc}</CodigoCancelamento>` +
    `</InfPedidoCancelamento>` +
    `</Pedido>` +
    `</CancelarNfseEnvio>`;

  const { key, cert } = extractPemFromPfx(params.certificado_base64, params.certificado_senha);
  const cancelSigned = signRps(cancelXml, pedidoId, key, cert);

  const envelope = soapEnvelope('CancelarNfse', cabecalhoXml(), cancelSigned);

  const { host, path: wsPath } = NFSE_CONFIG[params.ambiente];
  const res = await httpPost(
    { host, path: wsPath, headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': `${NFSE_ACTION_NS}/CancelarNfse` } },
    envelope,
  );

  if (res.status !== 200) {
    return {
      success: false,
      xml_cancelamento: res.body,
      message: `Prefeitura respondeu HTTP ${res.status}: ${res.body.slice(0, 500)}`,
    };
  }

  const xmlCancel = extractOutputXml(res.body);

  const codigoErro = xmlTag(xmlCancel, 'Codigo');
  const mensagemErro = xmlTag(xmlCancel, 'Mensagem');

  if (xmlTag(xmlCancel, 'ListaMensagemRetorno') && codigoErro) {
    return {
      success: false,
      xml_cancelamento: xmlCancel,
      message: `Erro ${codigoErro}: ${mensagemErro || 'Erro ao cancelar'}`,
    };
  }

  return {
    success: true,
    xml_cancelamento: xmlCancel,
    message: `NFS-e ${params.numero_nf} cancelada com sucesso.`,
  };
}

// ── Consultar NFS-e por RPS ──────────────────────────────────────────────────

export async function consultarNfsePorRps(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: 'producao' | 'homologacao';
  cnpj: string;
  inscricao_municipal: string;
  numero_rps: number;
  serie_rps: string;
}): Promise<{ success: boolean; numero_nf: string | null; codigo_verificacao: string | null; xml: string; message: string }> {
  const cnpj = params.cnpj.replace(/\D/g, '');
  const im = params.inscricao_municipal.replace(/\D/g, '');

  const consultaXml =
    `<ConsultarNfseRpsEnvio xmlns="${ABRASF_NS}">` +
    `<IdentificacaoRps>` +
    `<Numero>${params.numero_rps}</Numero>` +
    `<Serie>${xmlEsc(params.serie_rps)}</Serie>` +
    `<Tipo>1</Tipo>` +
    `</IdentificacaoRps>` +
    `<Prestador>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `</Prestador>` +
    `</ConsultarNfseRpsEnvio>`;

  const envelope = soapEnvelope('ConsultarNfsePorRps', cabecalhoXml(), consultaXml);

  const { host, path: wsPath } = NFSE_CONFIG[params.ambiente];
  const res = await httpPost(
    { host, path: wsPath, headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': `${NFSE_ACTION_NS}/ConsultarNfsePorRps` } },
    envelope,
  );

  if (res.status !== 200) {
    return { success: false, numero_nf: null, codigo_verificacao: null, xml: res.body, message: `HTTP ${res.status}` };
  }

  const xmlRps = extractOutputXml(res.body);
  const numero = xmlTag(xmlRps, 'Numero');
  const codVerif = xmlTag(xmlRps, 'CodigoVerificacao');

  return {
    success: !!numero,
    numero_nf: numero,
    codigo_verificacao: codVerif,
    xml: xmlRps,
    message: numero ? `NFS-e ${numero} encontrada.` : 'NFS-e não encontrada para o RPS informado.',
  };
}

// ── Testar Conexão ───────────────────────────────────────────────────────────

export async function testarConexaoPrefeitura(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: 'producao' | 'homologacao';
  cnpj?: string;
  inscricao_municipal?: string;
}): Promise<{ success: boolean; message: string }> {
  try {
    extractPemFromPfx(params.certificado_base64, params.certificado_senha);
  } catch (err: any) {
    return { success: false, message: `Erro no certificado: ${err.message}` };
  }

  try {
    const { host, path: wsPath } = NFSE_CONFIG[params.ambiente];
    const cnpj = (params.cnpj || '').replace(/\D/g, '');
    const im = (params.inscricao_municipal || '').replace(/\D/g, '');

    if (!cnpj || !im) {
      return { success: false, message: 'CNPJ e Inscrição Municipal são obrigatórios para testar conexão com a Prefeitura.' };
    }

    const res = await httpPost(
      { host, path: wsPath, headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': `${NFSE_ACTION_NS}/ConsultarNfseServicoPrestado` } },
      soapEnvelope('ConsultarNfseServicoPrestado', cabecalhoXml(),
        `<ConsultarNfseServicoPrestadoEnvio xmlns="${ABRASF_NS}">` +
        `<Prestador><CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
        `<InscricaoMunicipal>${im}</InscricaoMunicipal></Prestador>` +
        `<PeriodoEmissao><DataInicial>2025-01-01</DataInicial><DataFinal>2025-01-02</DataFinal></PeriodoEmissao>` +
        `<Pagina>1</Pagina>` +
        `</ConsultarNfseServicoPrestadoEnvio>`
      ),
    );

    console.log(`[NFS-e Test] https://${host}${wsPath} → HTTP ${res.status}`);
    console.log('[NFS-e Test] Resposta:', res.body.slice(0, 1000));

    if (res.status === 200) {
      return { success: true, message: `Conexão com a Prefeitura de Búzios (${params.ambiente}) via E&L Cloud estabelecida com sucesso.` };
    }

    // SOAP fault com dados válidos ainda indica conexão funcional
    if (res.body.includes('Fault') && !res.body.includes('NullPointerException') && !res.body.includes('método de despacho')) {
      const faultMsg = xmlTag(res.body, 'faultstring') || '';
      return { success: true, message: `Conexão E&L Cloud OK. Servidor respondeu: ${faultMsg.slice(0, 200)}` };
    }

    return { success: false, message: `Prefeitura respondeu HTTP ${res.status}. Resposta: ${res.body.slice(0, 300)}` };
  } catch (err: any) {
    return { success: false, message: `Falha na conexão: ${err.message}` };
  }
}

// ── Consultar NFS-e Serviço Prestado (retroativo) ──────────────────────────

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

export interface ConsultaNfseResult {
  success: boolean;
  notas: NfseConsultaItem[];
  total: number;
  pagina: number;
  xml_retorno: string;
  message: string;
}

function parseNfseList(xml: string): NfseConsultaItem[] {
  const notas: NfseConsultaItem[] = [];
  const nfseRegex = /<(?:[\w]+:)?CompNfse[^>]*>([\s\S]*?)<\/(?:[\w]+:)?CompNfse>/g;
  let match;
  while ((match = nfseRegex.exec(xml)) !== null) {
    const block = match[1];
    const numero = xmlTag(block, 'Numero');
    if (!numero) continue;

    const tomadorBlock = xmlTag(block, 'TomadorServico') || xmlTag(block, 'Tomador') || '';
    const tomadorDoc = xmlTag(tomadorBlock, 'Cpf') || xmlTag(tomadorBlock, 'Cnpj');
    const tomadorNome = xmlTag(tomadorBlock, 'RazaoSocial') || xmlTag(tomadorBlock, 'NomeFantasia');

    const aliqRaw = xmlTag(block, 'Aliquota');
    const aliq = aliqRaw ? (parseFloat(aliqRaw) * 100).toFixed(2) : null;

    notas.push({
      numero,
      codigo_verificacao: xmlTag(block, 'CodigoVerificacao'),
      data_emissao: xmlTag(block, 'DataEmissao'),
      competencia: xmlTag(block, 'Competencia'),
      valor_servicos: xmlTag(block, 'ValorServicos'),
      valor_iss: xmlTag(block, 'ValorIss'),
      aliquota: aliq,
      tomador_nome: tomadorNome,
      tomador_cpf_cnpj: tomadorDoc,
      discriminacao: xmlTag(block, 'Discriminacao'),
      situacao: xmlTag(block, 'Situacao'),
    });
  }
  return notas;
}

export async function consultarNfseServicoPrestado(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: 'producao' | 'homologacao';
  cnpj: string;
  inscricao_municipal: string;
  data_inicial: string;
  data_final: string;
  pagina?: number;
  tomador_cpf_cnpj?: string;
}): Promise<ConsultaNfseResult> {
  const cnpj = params.cnpj.replace(/\D/g, '');
  const im = params.inscricao_municipal.replace(/\D/g, '');
  const pagina = params.pagina || 1;

  let filtroTomador = '';
  if (params.tomador_cpf_cnpj) {
    const docLimpo = params.tomador_cpf_cnpj.replace(/\D/g, '');
    const isCnpj = docLimpo.length > 11;
    filtroTomador =
      `<Tomador><CpfCnpj>` +
      (isCnpj ? `<Cnpj>${docLimpo}</Cnpj>` : `<Cpf>${docLimpo}</Cpf>`) +
      `</CpfCnpj></Tomador>`;
  }

  const consultaXml =
    `<ConsultarNfseServicoPrestadoEnvio xmlns="${ABRASF_NS}">` +
    `<Prestador>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `</Prestador>` +
    filtroTomador +
    `<PeriodoEmissao>` +
    `<DataInicial>${params.data_inicial}</DataInicial>` +
    `<DataFinal>${params.data_final}</DataFinal>` +
    `</PeriodoEmissao>` +
    `<Pagina>${pagina}</Pagina>` +
    `</ConsultarNfseServicoPrestadoEnvio>`;

  const envelope = soapEnvelope('ConsultarNfseServicoPrestado', cabecalhoXml(), consultaXml);

  const { host, path: wsPath } = NFSE_CONFIG[params.ambiente];
  console.log(`[NFS-e Consulta] Buscando NFS-e prestadas, CNPJ=${cnpj}, IM=${im}, período ${params.data_inicial} a ${params.data_final}, página ${pagina}`);

  const res = await httpPost(
    { host, path: wsPath, headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': `${NFSE_ACTION_NS}/ConsultarNfseServicoPrestado` } },
    envelope,
  );

  if (res.status !== 200) {
    return {
      success: false, notas: [], total: 0, pagina,
      xml_retorno: res.body,
      message: `Prefeitura respondeu HTTP ${res.status}: ${res.body.slice(0, 500)}`,
    };
  }

  const xml = extractOutputXml(res.body);

  const codigoErro = xmlTag(xml, 'Codigo');
  const mensagemErro = xmlTag(xml, 'Mensagem');

  if (xmlTag(xml, 'ListaMensagemRetorno') && codigoErro) {
    return {
      success: false, notas: [], total: 0, pagina,
      xml_retorno: xml,
      message: `Erro ${codigoErro}: ${mensagemErro || 'Erro na consulta'}`,
    };
  }

  const notas = parseNfseList(xml);

  return {
    success: true,
    notas,
    total: notas.length,
    pagina,
    xml_retorno: res.body,
    message: notas.length > 0 ? `${notas.length} NFS-e encontrada(s).` : 'Nenhuma NFS-e encontrada no período.',
  };
}

// ── Consultar NFS-e por Faixa de Números ────────────────────────────────────

export async function consultarNfsePorFaixa(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: 'producao' | 'homologacao';
  cnpj: string;
  inscricao_municipal: string;
  numero_inicial: number;
  numero_final: number;
  pagina?: number;
}): Promise<ConsultaNfseResult> {
  const cnpj = params.cnpj.replace(/\D/g, '');
  const im = params.inscricao_municipal.replace(/\D/g, '');
  const pagina = params.pagina || 1;

  const consultaXml =
    `<ConsultarNfseFaixaEnvio xmlns="${ABRASF_NS}">` +
    `<Prestador>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `</Prestador>` +
    `<Faixa>` +
    `<NumeroNfseInicial>${params.numero_inicial}</NumeroNfseInicial>` +
    `<NumeroNfseFinal>${params.numero_final}</NumeroNfseFinal>` +
    `</Faixa>` +
    `<Pagina>${pagina}</Pagina>` +
    `</ConsultarNfseFaixaEnvio>`;

  const envelope = soapEnvelope('ConsultarNfsePorFaixa', cabecalhoXml(), consultaXml);

  const { host, path: wsPath } = NFSE_CONFIG[params.ambiente];

  const res = await httpPost(
    { host, path: wsPath, headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': `${NFSE_ACTION_NS}/ConsultarNfsePorFaixa` } },
    envelope,
  );

  if (res.status !== 200) {
    return {
      success: false, notas: [], total: 0, pagina,
      xml_retorno: res.body,
      message: `Prefeitura respondeu HTTP ${res.status}: ${res.body.slice(0, 500)}`,
    };
  }

  const xml = extractOutputXml(res.body);

  const codigoErro = xmlTag(xml, 'Codigo');
  const mensagemErro = xmlTag(xml, 'Mensagem');

  if (xmlTag(xml, 'ListaMensagemRetorno') && codigoErro) {
    return {
      success: false, notas: [], total: 0, pagina,
      xml_retorno: xml,
      message: `Erro ${codigoErro}: ${mensagemErro || 'Erro na consulta'}`,
    };
  }

  const notas = parseNfseList(xml);

  return {
    success: true,
    notas,
    total: notas.length,
    pagina,
    xml_retorno: res.body,
    message: notas.length > 0 ? `${notas.length} NFS-e encontrada(s).` : 'Nenhuma NFS-e na faixa informada.',
  };
}

// ── Emissão em Lote Síncrono ────────────────────────────────────────────────

export async function recepcionarLoteRpsSincrono(params: {
  prestador: NfsePrestador;
  tomadores: NfseTomador[];
  itemsPerRps: NfseItem[][];
  config: NfseConfig;
  numerosRps: number[];
  serieRps: string;
}): Promise<{ success: boolean; resultados: EmissaoNfseResult[]; xml_retorno: string; message: string }> {
  const { prestador, tomadores, itemsPerRps, config, numerosRps, serieRps } = params;
  const { key, cert } = extractPemFromPfx(config.certificado_base64, config.certificado_senha);
  const cnpj = prestador.cnpj.replace(/\D/g, '');
  const im = prestador.inscricao_municipal.replace(/\D/g, '');

  const loteId = Date.now().toString();
  let rpsListXml = '';

  for (let i = 0; i < numerosRps.length; i++) {
    const rpsXml = buildRpsXml(prestador, tomadores[i], itemsPerRps[i], config, numerosRps[i], serieRps);
    const rpsId = `rps_${numerosRps[i]}`;
    const signed = signRps(rpsXml, rpsId, key, cert);
    const inner = signed.replace(/<GerarNfseEnvio[^>]*>/, '').replace(/<\/GerarNfseEnvio>/, '');
    rpsListXml += inner;
  }

  const loteXml =
    `<EnviarLoteRpsSincronoEnvio xmlns="${ABRASF_NS}">` +
    `<LoteRps Id="lote_${loteId}" versao="2.02">` +
    `<NumeroLote>${loteId}</NumeroLote>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `<QuantidadeRps>${numerosRps.length}</QuantidadeRps>` +
    `<ListaRps>${rpsListXml}</ListaRps>` +
    `</LoteRps>` +
    `</EnviarLoteRpsSincronoEnvio>`;

  const envelope = soapEnvelope('RecepcionarLoteRpsSincrono', cabecalhoXml(), loteXml);

  const { host, path: wsPath } = NFSE_CONFIG[config.ambiente];
  console.log(`[NFS-e Lote] Enviando lote com ${numerosRps.length} RPS`);

  const res = await httpPost(
    { host, path: wsPath, headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': `${NFSE_ACTION_NS}/RecepcionarLoteRpsSincrono` } },
    envelope,
  );

  if (res.status !== 200) {
    return {
      success: false, resultados: [],
      xml_retorno: res.body,
      message: `Prefeitura respondeu HTTP ${res.status}: ${res.body.slice(0, 500)}`,
    };
  }

  const xml = extractOutputXml(res.body);

  const codigoErro = xmlTag(xml, 'Codigo');
  const mensagemErro = xmlTag(xml, 'Mensagem');

  if (xmlTag(xml, 'ListaMensagemRetorno') && codigoErro) {
    return {
      success: false, resultados: [],
      xml_retorno: xml,
      message: `Erro ${codigoErro}: ${mensagemErro || 'Erro no lote'}`,
    };
  }

  const notasRetorno = parseNfseList(xml);
  const resultados: EmissaoNfseResult[] = notasRetorno.map(n => ({
    success: true,
    numero_nf: n.numero,
    serie: serieRps,
    codigo_verificacao: n.codigo_verificacao,
    numero_protocolo: null,
    chave_acesso: null,
    xml_retorno: res.body,
    message: `NFS-e ${n.numero} emitida com sucesso.`,
  }));

  return {
    success: true,
    resultados,
    xml_retorno: res.body,
    message: `Lote processado: ${resultados.length} NFS-e emitida(s).`,
  };
}

// ── Substituir NFS-e ────────────────────────────────────────────────────────

export async function substituirNfse(params: {
  prestador: NfsePrestador;
  tomador: NfseTomador;
  items: NfseItem[];
  config: NfseConfig;
  numeroRps: number;
  serieRps: string;
  numero_nfse_substituida: string;
}): Promise<EmissaoNfseResult> {
  const { prestador, tomador, items, config, numeroRps, serieRps } = params;
  const rpsId = `rps_${numeroRps}`;

  let rpsXml = buildRpsXml(prestador, tomador, items, config, numeroRps, serieRps);

  const { key, cert } = extractPemFromPfx(config.certificado_base64, config.certificado_senha);
  rpsXml = signRps(rpsXml, rpsId, key, cert);

  const cnpj = prestador.cnpj.replace(/\D/g, '');
  const im = prestador.inscricao_municipal.replace(/\D/g, '');

  const subsXml =
    `<SubstituirNfseEnvio xmlns="${ABRASF_NS}">` +
    `<SubstituicaoNfse Id="sub_${params.numero_nfse_substituida}">` +
    `<Pedido>` +
    `<InfPedidoCancelamento Id="cancel_${params.numero_nfse_substituida}">` +
    `<IdentificacaoNfse>` +
    `<Numero>${params.numero_nfse_substituida}</Numero>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `<CodigoMunicipio>${config.codigo_municipio}</CodigoMunicipio>` +
    `</IdentificacaoNfse>` +
    `<CodigoCancelamento>4</CodigoCancelamento>` +
    `</InfPedidoCancelamento>` +
    `</Pedido>` +
    rpsXml +
    `</SubstituicaoNfse>` +
    `</SubstituirNfseEnvio>`;

  const envelope = soapEnvelope('SubstituirNfse', cabecalhoXml(), subsXml);

  const { host, path: wsPath } = NFSE_CONFIG[config.ambiente];
  const res = await httpPost(
    { host, path: wsPath, headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': `${NFSE_ACTION_NS}/SubstituirNfse` } },
    envelope,
  );

  if (res.status !== 200) {
    return {
      success: false,
      numero_nf: null, serie: null, codigo_verificacao: null,
      numero_protocolo: null, chave_acesso: null,
      xml_retorno: res.body,
      message: `Prefeitura respondeu HTTP ${res.status}: ${res.body.slice(0, 500)}`,
    };
  }

  const xml = extractOutputXml(res.body);

  const codigoErro = xmlTag(xml, 'Codigo');
  const mensagemErro = xmlTag(xml, 'Mensagem');

  if (xmlTag(xml, 'ListaMensagemRetorno') && codigoErro) {
    return {
      success: false,
      numero_nf: null, serie: null, codigo_verificacao: null,
      numero_protocolo: null, chave_acesso: null,
      xml_retorno: xml,
      message: `Erro ${codigoErro}: ${mensagemErro || 'Erro ao substituir'}`,
    };
  }

  const numeroNf = xmlTag(xml, 'Numero');
  const codigoVerificacao = xmlTag(xml, 'CodigoVerificacao');

  return {
    success: !!numeroNf,
    numero_nf: numeroNf,
    serie: serieRps,
    codigo_verificacao: codigoVerificacao,
    numero_protocolo: null,
    chave_acesso: null,
    xml_retorno: xml,
    message: numeroNf
      ? `NFS-e ${params.numero_nfse_substituida} substituída por NFS-e ${numeroNf}.`
      : `Resposta inesperada: ${res.body.slice(0, 500)}`,
  };
}
