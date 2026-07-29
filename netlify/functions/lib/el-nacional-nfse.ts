// netlify/functions/lib/el-nacional-nfse.ts
// Integração com a API Nacional NFS-e hospedada pelo E&L (Búzios).
// Modelo DPS (layout nacional v1.01, namespace sped.fazenda.gov.br/nfse):
// XML assinado (XMLDSig) → GZip → Base64 → POST JSON com token de integração.
// Docs: "Orientações - API de Integração NFS-e Nacional" (E&L).

import https from 'https';
import crypto from 'crypto';
import zlib from 'zlib';
import { SignedXml } from 'xml-crypto';
import { extractPemFromPfx } from './dfe';

const EL_HOST = 'rj-buzios-pm-nfs-backend.cloud.el.com.br';
const EL_BASE_PATH = '/producao35/api/nacional';

const DPS_NS = 'http://www.sped.fazenda.gov.br/nfse';

type Ambiente = 'producao' | 'homologacao';

// Doc oficial E&L ("Orientações - API de Integração NFS-e Nacional"):
//   Homologação: .../producao35/api/nacional/homologacao/nfse
//   Produção:    .../producao35/api/nacional/nfse   (SEM segmento de ambiente)
// Ou seja, ao contrário do padrão usual, o segmento "/homologacao" só existe
// para homologação — produção usa o path base direto.
function elPath(ambiente: Ambiente, suffix: string): string {
  const envSegment = ambiente === 'producao' ? '' : `/${ambiente}`;
  return `${EL_BASE_PATH}${envSegment}${suffix}`;
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function httpsJson(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 60000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        host: EL_HOST,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout na comunicação com a API Nacional E&L')));
    if (payload) req.write(payload);
    req.end();
  });
}

function gzipB64(xml: string): string {
  return zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

function gunzipB64(b64: string): string {
  return zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
}

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface ELNacionalConfig {
  certificado_base64: string;
  certificado_senha: string;
  token: string;                       // token de integração gerado no portal do município
  ambiente: Ambiente;
  cnpj: string;
  inscricao_municipal: string;
  codigo_municipio: string;            // IBGE 7 dígitos (Búzios 3300233)
  codigo_servico: string;              // LC116 (ex. 9.01) → cTribNac 090101
  codigo_servico_municipal?: string | null; // cIntContrib (obrigatório p/ E&L)
  aliquota_iss: number;                // percentual (ex. 5)
  optante_simples: boolean;
  telefone?: string | null;
  // Reforma Tributária (IBS/CBS, NT 2025.002) — bloco <IBSCBS> por DPS (não por
  // item: nf_invoice_items ainda não tem vínculo com services.id).
  ibs_cbs_cst?: string | null;         // CST IBS/CBS (3 díg). '000' = tributação integral
  ibs_cbs_cclasstrib?: string | null;  // cClassTrib (6 díg). '000001' = tributação integral
  fin_nfse?: number | null;            // Finalidade da NFS-e (0 = normal)
  ind_final?: number | null;           // 1 = consumidor final; 0 = não
  c_ind_op?: string | null;            // Código do indicador da operação (tabela nacional)
  ind_dest?: number | null;            // Indicador de destino da operação
}

export interface ELNacionalTomador {
  cpf_cnpj: string | null;
  doc_tipo: 'cpf' | 'cnpj' | 'passaporte' | null;
  razao_social: string;
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  codigo_municipio?: string | null;
  cep?: string | null;
}

export interface ELNacionalItem {
  description: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
}

export interface ELNacionalResult {
  success: boolean;
  id_dps: string | null;
  chave_acesso: string | null;
  numero_nf: string | null;
  codigo_verificacao: string | null;
  xml_retorno: string;
  message: string;
}

// ── Montagem do XML da DPS (layout nacional v1.01) ──────────────────────────

function buildDpsId(cMun: string, cnpj: string, serie: string, numero: number): string {
  // DPS + cLocEmi(7) + tpInscFederal(2=CNPJ) + inscricao(14) + serie(5) + numero(15)
  const serieNum = (serie.replace(/\D/g, '') || '1').padStart(5, '0');
  return `DPS${cMun}2${cnpj}${serieNum}${String(numero).padStart(15, '0')}`;
}

// Bloco <IBSCBS> da DPS (Reforma Tributária, NT 2025.002). Estrutura simples
// (finNFSe/indFinal/cIndOp/indDest + CST/cClassTrib), conforme exemplo oficial
// de DPS com IBSCBS — sem valores monetários explícitos (vBC/vIBS/vCBS), que
// são calculados pela Plataforma Nacional a partir do valor do serviço e das
// alíquotas vigentes. Omitido por completo se a config não tiver CST/cClassTrib
// definidos (hotel ainda não configurado para a reforma).
function buildIbsCbsXml(config: ELNacionalConfig): string {
  const cst = config.ibs_cbs_cst;
  const cClassTrib = config.ibs_cbs_cclasstrib;
  if (!cst || !cClassTrib) return '';

  const finNFSe = config.fin_nfse ?? 0;
  const indFinal = config.ind_final ?? 1;
  const cIndOp = config.c_ind_op || '100301';
  const indDest = config.ind_dest ?? 0;

  return (
    `<IBSCBS>` +
    `<finNFSe>${finNFSe}</finNFSe>` +
    `<indFinal>${indFinal}</indFinal>` +
    `<cIndOp>${xmlEsc(cIndOp)}</cIndOp>` +
    `<indDest>${indDest}</indDest>` +
    `<valores><trib><gIBSCBS>` +
    `<CST>${xmlEsc(cst)}</CST>` +
    `<cClassTrib>${xmlEsc(cClassTrib)}</cClassTrib>` +
    `</gIBSCBS></trib></valores>` +
    `</IBSCBS>`
  );
}

// Exportado para permitir validar a estrutura da DPS (incluindo o bloco
// <IBSCBS> da Reforma Tributaria) sem certificado e sem chamar a API.
export function buildDpsXml(
  config: ELNacionalConfig,
  tomador: ELNacionalTomador,
  items: ELNacionalItem[],
  serie: string,
  numeroDPS: number,
): { xml: string; dpsId: string } {
  const cnpj = config.cnpj.replace(/\D/g, '');
  const im = config.inscricao_municipal.replace(/\D/g, '');
  const cMun = config.codigo_municipio || '3300233';
  const tpAmb = config.ambiente === 'producao' ? 1 : 2;

  const digits = (config.codigo_servico || '9.01').replace(/\D/g, '');
  const cTribNac = digits.replace(/^0?(\d{1,2})(\d{2})$/, (_, g, s) => g.padStart(2, '0') + s + '01');
  const cIntContrib = (config.codigo_servico_municipal || '').replace(/\s/g, '');

  const dpsId = buildDpsId(cMun, cnpj, serie, numeroDPS);

  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const dhEmi = brt.toISOString().slice(0, 19) + '-03:00';
  const dCompet = brt.toISOString().slice(0, 10);

  const valorServicos = items.reduce((s, it) => s + it.valor_total, 0);
  const aliq = config.aliquota_iss;

  const discriminacao = items
    .map(it => `${it.description} - Qtd: ${it.quantidade} x R$ ${it.valor_unitario.toFixed(2)} = R$ ${it.valor_total.toFixed(2)}`)
    .join(' | ');

  // Tomador
  let tomaXml = '';
  if (tomador.cpf_cnpj && tomador.doc_tipo !== 'passaporte') {
    const doc = tomador.cpf_cnpj.replace(/\D/g, '');
    const isCnpj = tomador.doc_tipo === 'cnpj' || doc.length > 11;
    tomaXml += '<toma>';
    tomaXml += isCnpj ? `<CNPJ>${doc}</CNPJ>` : `<CPF>${doc}</CPF>`;
    tomaXml += `<xNome>${xmlEsc(tomador.razao_social)}</xNome>`;
    if (tomador.endereco && tomador.codigo_municipio && tomador.cep) {
      tomaXml += '<end>';
      tomaXml += `<endNac><cMun>${tomador.codigo_municipio}</cMun><CEP>${tomador.cep.replace(/\D/g, '')}</CEP></endNac>`;
      tomaXml += `<xLgr>${xmlEsc(tomador.endereco)}</xLgr>`;
      tomaXml += `<nro>${xmlEsc(tomador.numero || 'S/N')}</nro>`;
      tomaXml += `<xBairro>${xmlEsc(tomador.bairro || 'Centro')}</xBairro>`;
      tomaXml += '</end>';
    }
    tomaXml += '</toma>';
  }

  // opSimpNac: 1=Não optante, 2=MEI, 3=ME/EPP (Simples Nacional)
  const opSimpNac = config.optante_simples ? 3 : 1;

  const infDPS =
    `<infDPS Id="${dpsId}">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<dhEmi>${dhEmi}</dhEmi>` +
    `<verAplic>FLUXO1.0</verAplic>` +
    `<serie>${serie.replace(/\D/g, '') || '1'}</serie>` +
    `<nDPS>${numeroDPS}</nDPS>` +
    `<dCompet>${dCompet}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    `<cLocEmi>${cMun}</cLocEmi>` +
    `<prest>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<IM>${im}</IM>` +
    (config.telefone ? `<fone>${config.telefone.replace(/\D/g, '')}</fone>` : '') +
    `<regTrib>` +
    `<opSimpNac>${opSimpNac}</opSimpNac>` +
    `<regEspTrib>0</regEspTrib>` +
    `</regTrib>` +
    `</prest>` +
    tomaXml +
    `<serv>` +
    `<locPrest><cLocPrestacao>${cMun}</cLocPrestacao></locPrest>` +
    `<cServ>` +
    `<cTribNac>${cTribNac}</cTribNac>` +
    `<xDescServ>${xmlEsc(discriminacao)}</xDescServ>` +
    (cIntContrib ? `<cIntContrib>${xmlEsc(cIntContrib)}</cIntContrib>` : '') +
    `</cServ>` +
    `</serv>` +
    `<valores>` +
    `<vServPrest><vServ>${valorServicos.toFixed(2)}</vServ></vServPrest>` +
    `<trib>` +
    `<tribMun>` +
    `<tribISSQN>1</tribISSQN>` +
    `<tpRetISSQN>2</tpRetISSQN>` +
    `<pAliq>${aliq.toFixed(2)}</pAliq>` +
    `</tribMun>` +
    `<totTrib>` +
    `<vTotTrib>` +
    `<vTotTribFed>0.00</vTotTribFed>` +
    `<vTotTribEst>0.00</vTotTribEst>` +
    `<vTotTribMun>0.00</vTotTribMun>` +
    `</vTotTrib>` +
    `</totTrib>` +
    `</trib>` +
    `</valores>` +
    buildIbsCbsXml(config) +
    `</infDPS>`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DPS xmlns="${DPS_NS}" versao="1.01">` +
    infDPS +
    `</DPS>`;

  return { xml, dpsId };
}

// ── Assinatura (enveloped, Reference no Id do infDPS, Signature após) ──────

function signDps(xml: string, dpsId: string, keyPem: string, certPem: string): string {
  const sig = new SignedXml({
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    privateKey: crypto.createPrivateKey(keyPem),
    publicCert: certPem,
  });
  sig.addReference({
    xpath: `//*[@Id='${dpsId}']`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });
  sig.computeSignature(xml, {
    location: { reference: `//*[@Id='${dpsId}']`, action: 'after' },
  });
  return sig.getSignedXml();
}

// ── Parse da NFSe retornada (XML nacional) ──────────────────────────────────

function parseNfseXml(nfseXml: string): { numero: string | null; chave: string | null; codigoVerificacao: string | null } {
  const nNFSe = nfseXml.match(/<nNFSe>([^<]+)<\/nNFSe>/)?.[1] ?? null;
  const chave = nfseXml.match(/Id="NFS([^"]+)"/)?.[1]
    ?? nfseXml.match(/<chNFSe>([^<]+)<\/chNFSe>/)?.[1] ?? null;
  const cVerif = nfseXml.match(/<cVerif>([^<]+)<\/cVerif>/)?.[1] ?? null;
  return { numero: nNFSe, chave, codigoVerificacao: cVerif };
}

function formatErros(data: any): string {
  if (Array.isArray(data?.erros) && data.erros.length > 0) {
    return data.erros
      .map((e: any) => `${e.Codigo ?? e.codigo ?? ''}: ${e.Descricao ?? e.descricao ?? JSON.stringify(e)}`)
      .join(' | ');
  }
  return '';
}

// ── Emissão ──────────────────────────────────────────────────────────────────

export async function emitirNfseELNacional(params: {
  config: ELNacionalConfig;
  tomador: ELNacionalTomador;
  items: ELNacionalItem[];
  serie: string;
  numeroDPS: number;
}): Promise<ELNacionalResult> {
  const { config } = params;

  // 1. Montar e assinar a DPS
  const { xml, dpsId } = buildDpsXml(config, params.tomador, params.items, params.serie, params.numeroDPS);
  const { key, cert } = extractPemFromPfx(config.certificado_base64, config.certificado_senha);
  const signed = signDps(xml, dpsId, key, cert);
  console.log('[NFS-e EL Nacional] DPS montada, id:', dpsId);

  // 2. GZip + Base64 e envio
  const payload = { dpsXmlGZipB64: gzipB64(signed) };
  const sendPath = elPath(config.ambiente, `/nfse?token=${encodeURIComponent(config.token)}`);
  const res = await httpsJson('POST', sendPath, payload);
  console.log('[NFS-e EL Nacional] POST nfse →', res.status, res.body.slice(0, 500));

  let data: any = {};
  try { data = JSON.parse(res.body); } catch { /* resposta não-JSON */ }

  const erros = formatErros(data);
  if ((res.status !== 200 && res.status !== 201) || erros) {
    return {
      success: false,
      id_dps: data.idDPS ?? dpsId,
      chave_acesso: null,
      numero_nf: null,
      codigo_verificacao: null,
      xml_retorno: res.body,
      message: erros || `API Nacional E&L respondeu HTTP ${res.status}: ${res.body.slice(0, 300)}`,
    };
  }

  const idDPS: string = data.idDPS ?? dpsId;

  // 3. Se a NFSe já veio pronta, extrair; senão, poll no endpoint de consulta
  let nfseXml = '';
  if (data.nfseXmlGZipB64 && !String(data.nfseXmlGZipB64).startsWith('<')) {
    try { nfseXml = gunzipB64(data.nfseXmlGZipB64); } catch { /* ainda processando */ }
  }

  let chaveAcesso: string | null = null;
  for (let attempt = 0; attempt < 4 && !nfseXml; attempt++) {
    await new Promise(r => setTimeout(r, 2500));
    const cRes = await httpsJson('GET', elPath(config.ambiente, `/nfseDps/${idDPS}?token=${encodeURIComponent(config.token)}`));
    console.log(`[NFS-e EL Nacional] Poll ${attempt + 1} →`, cRes.status, cRes.body.slice(0, 300));
    let cData: any = {};
    try { cData = JSON.parse(cRes.body); } catch { continue; }
    const cErros = formatErros(cData);
    if (cErros) {
      return {
        success: false,
        id_dps: idDPS,
        chave_acesso: null,
        numero_nf: null,
        codigo_verificacao: null,
        xml_retorno: cRes.body,
        message: cErros,
      };
    }
    chaveAcesso = cData.chaveAcesso ?? chaveAcesso;
    if (cData.nfseXmlGZipB64 && !String(cData.nfseXmlGZipB64).startsWith('<')) {
      try { nfseXml = gunzipB64(cData.nfseXmlGZipB64); } catch { /* ainda processando */ }
    }
  }

  const parsed = nfseXml ? parseNfseXml(nfseXml) : { numero: null, chave: null, codigoVerificacao: null };

  return {
    success: true,
    id_dps: idDPS,
    chave_acesso: chaveAcesso ?? parsed.chave,
    numero_nf: parsed.numero,
    codigo_verificacao: parsed.codigoVerificacao,
    xml_retorno: nfseXml || res.body,
    message: nfseXml
      ? 'NFS-e autorizada pela Plataforma Nacional'
      : `DPS recebida pelo município (id ${idDPS}); NFS-e em processamento no ambiente nacional`,
  };
}

// ── Cancelamento (evento e101101) ────────────────────────────────────────────

export async function cancelarNfseELNacional(params: {
  config: Pick<ELNacionalConfig, 'certificado_base64' | 'certificado_senha' | 'token' | 'ambiente' | 'cnpj'>;
  chave_acesso: string;
  motivo?: string;
}): Promise<{ success: boolean; message: string; xml_retorno: string }> {
  const { config } = params;
  const cnpj = config.cnpj.replace(/\D/g, '');
  const tpAmb = config.ambiente === 'producao' ? 1 : 2;
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dhEvento = now.toISOString().slice(0, 19) + '-03:00';
  // Id: PRE + chave(50) + tpEvento(101101) + nSeq... — layout: PRE + chNFSe + codigo evento
  const pedId = `PRE${params.chave_acesso}101101`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<pedRegEvento xmlns="${DPS_NS}" versao="1.01">` +
    `<infPedReg Id="${pedId}">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<verAplic>FLUXO1.0</verAplic>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<CNPJAutor>${cnpj}</CNPJAutor>` +
    `<chNFSe>${params.chave_acesso}</chNFSe>` +
    `<e101101>` +
    `<xDesc>Cancelamento de NFS-e</xDesc>` +
    `<cMotivo>1</cMotivo>` +
    `<xMotivo>${xmlEsc(params.motivo || 'Erro na emissão')}</xMotivo>` +
    `</e101101>` +
    `</infPedReg>` +
    `</pedRegEvento>`;

  const { key, cert } = extractPemFromPfx(config.certificado_base64, config.certificado_senha);
  const signed = signDps(xml, pedId, key, cert);

  const path = elPath(config.ambiente, `/nfse/${params.chave_acesso}/eventos?token=${encodeURIComponent(config.token)}`);
  const res = await httpsJson('POST', path, { pedidoRegistroEventoXmlGZipB64: gzipB64(signed) });
  console.log('[NFS-e EL Nacional] Cancelamento →', res.status, res.body.slice(0, 500));

  let data: any = {};
  try { data = JSON.parse(res.body); } catch { /* não-JSON */ }
  const erros = formatErros(data);

  if ((res.status === 200 || res.status === 201) && !erros) {
    let eventoXml = '';
    if (data.eventoXmlGZipB64) {
      try { eventoXml = gunzipB64(data.eventoXmlGZipB64); } catch { /* ignora */ }
    }
    return { success: true, message: 'Cancelamento registrado na Plataforma Nacional', xml_retorno: eventoXml || res.body };
  }
  return {
    success: false,
    message: erros || `API Nacional E&L respondeu HTTP ${res.status}: ${res.body.slice(0, 300)}`,
    xml_retorno: res.body,
  };
}

// ── Consulta por chave de acesso ────────────────────────────────────────────

export async function consultarNfseELNacional(params: {
  token: string;
  ambiente: Ambiente;
  chave_acesso: string;
}): Promise<{ success: boolean; message: string; xml: string | null }> {
  const path = elPath(params.ambiente, `/nfse/${params.chave_acesso}?token=${encodeURIComponent(params.token)}`);
  const res = await httpsJson('GET', path);
  let data: any = {};
  try { data = JSON.parse(res.body); } catch { /* não-JSON */ }
  const erros = formatErros(data);
  if (res.status === 200 && !erros && data.nfseXmlGZipB64) {
    try {
      return { success: true, message: 'NFS-e encontrada', xml: gunzipB64(data.nfseXmlGZipB64) };
    } catch { /* cai no retorno de erro */ }
  }
  return { success: false, message: erros || `HTTP ${res.status}`, xml: null };
}
