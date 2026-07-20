// netlify/functions/lib/nfce-sefaz.ts
// NFC-e (modelo 65) e NF-e (modelo 55) — integração real com SEFAZ via SVRS (RJ).
// Layout 4.00 · SOAP 1.2 · mTLS com certificado A1 · XMLDSig RSA-SHA1.

import crypto from 'crypto';
import { SignedXml } from 'xml-crypto';
import { extractPemFromPfx, httpsPost } from './dfe';

// ── SVRS endpoints (RJ usa Sefaz Virtual RS) ────────────────────────────────

const SVRS_HOSTS_NFCE = {
  producao: 'nfce.svrs.rs.gov.br',
  homologacao: 'nfce-homologacao.svrs.rs.gov.br',
} as const;

const SVRS_HOSTS_NFE = {
  producao: 'nfe.svrs.rs.gov.br',
  homologacao: 'nfe-homologacao.svrs.rs.gov.br',
} as const;

type Modelo = '55' | '65';

const WS_PATHS = {
  autorizacao:  '/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: '/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consulta:     '/ws/NfeConsulta/NfeConsulta4.asmx',
  status:       '/ws/NfeStatusServico/NfeStatusServico4.asmx',
  evento:       '/ws/recepcaoevento/recepcaoevento4.asmx',
  inutilizacao: '/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
} as const;

const SOAP_ACTIONS = {
  autorizacao:  'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
  retAutorizacao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4/nfeRetAutorizacaoLote',
  consulta:     'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF',
  status:       'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
  evento:       'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEventoNF',
} as const;

const WSDL_NS = {
  autorizacao:  'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4',
  retAutorizacao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4',
  consulta:     'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4',
  status:       'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
  evento:       'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4',
} as const;

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const CUF_RJ = '33';

const QRCODE_URLS = {
  producao: 'http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode',
  homologacao: 'http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode',
} as const;

const CONSULTA_URLS = {
  producao: 'https://www.nfce.fazenda.rj.gov.br/consulta',
  homologacao: 'https://www.nfce.fazenda.rj.gov.br/consulta',
} as const;

type Ambiente = 'producao' | 'homologacao';

// ── Helpers ─────────────────────────────────────────────────────────────────

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?${tag}>`));
  return m ? m[1].trim() : null;
}

function pad(n: number | string, len: number): string {
  return String(n).padStart(len, '0');
}

// NCM: schema exige 2 ou 8 dígitos, sem pontos. Cadastro pode gravar "2202.10.00".
function sanitizeNCM(ncm?: string): string {
  const d = (ncm || '').replace(/\D/g, '');
  return d.length === 8 || d.length === 2 ? d : '00000000';
}

function fmtDec(v: number, decimals = 2): string {
  return v.toFixed(decimals);
}

function brasilia(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function dhBrasilia(): string {
  return brasilia().toISOString().replace(/\.\d{3}Z$/, '-03:00');
}

// ── Chave de acesso ─────────────────────────────────────────────────────────

function calcDigitoVerificador(chave43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  for (let i = chave43.length - 1, p = 0; i >= 0; i--, p++) {
    soma += parseInt(chave43[i]) * pesos[p % 8];
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return String(dv);
}

function buildChaveAcesso(params: {
  cUF: string; aamm: string; cnpj: string; mod: string;
  serie: string; nNF: number; tpEmis: string; cNF: string;
}): string {
  const chave43 =
    pad(params.cUF, 2) +
    params.aamm +
    params.cnpj.replace(/\D/g, '').padStart(14, '0') +
    pad(params.mod, 2) +
    pad(params.serie, 3) +
    pad(params.nNF, 9) +
    params.tpEmis +
    params.cNF;
  return chave43 + calcDigitoVerificador(chave43);
}

// ── QR Code NFC-e (versão 2) ────────────────────────────────────────────────

function buildQRCodeUrl(params: {
  chave: string; tpAmb: string; cscId: string; cscToken: string; ambiente: Ambiente;
}): string {
  const { chave, tpAmb, cscId, cscToken } = params;
  const cscIdPad = pad(cscId, 6);
  const concat = `${chave}|2|${tpAmb}|${cscIdPad}${cscToken}`;
  const hash = crypto.createHash('sha1').update(concat).digest('hex').toUpperCase();
  const baseUrl = QRCODE_URLS[params.ambiente];
  return `${baseUrl}?p=${chave}|2|${tpAmb}|${cscIdPad}|${hash}`;
}

// ── SOAP 1.2 ────────────────────────────────────────────────────────────────

function soap12(wsdlNs: string, soapAction: string, innerXml: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="${wsdlNs}">${innerXml}</nfeDadosMsg>` +
    `</soap12:Body></soap12:Envelope>`
  );
}

async function sefazPost(params: {
  ambiente: Ambiente;
  service: keyof typeof WS_PATHS;
  xml: string;
  pfxBase64: string;
  pfxSenha: string;
  modelo?: Modelo;
}): Promise<{ status: number; body: string }> {
  const hosts = (params.modelo === '55') ? SVRS_HOSTS_NFE : SVRS_HOSTS_NFCE;
  const host = hosts[params.ambiente];
  const path = WS_PATHS[params.service];
  const action = SOAP_ACTIONS[params.service as keyof typeof SOAP_ACTIONS];
  const wsdlNs = WSDL_NS[params.service as keyof typeof WSDL_NS];

  const envelope = soap12(wsdlNs, action, params.xml);

  // rejectUnauthorized: false — a cadeia TLS do SVRS não é validada
  // pelo runtime do Netlify (ICP-Brasil CA ausente), mesmo padrão de dfe.ts.
  return httpsPost({
    host,
    path,
    method: 'POST',
    pfx: Buffer.from(params.pfxBase64, 'base64'),
    passphrase: params.pfxSenha,
    rejectUnauthorized: false,
    headers: {
      'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
    },
  }, envelope);
}

// ── XMLDSig (mesmo padrão de dfe.ts) ────────────────────────────────────────

function signNFe(xml: string, refId: string, keyPem: string, certPem: string): string {
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
  // Signature deve ficar como IRMÃ do infNFe (depois dele, dentro de <NFe>),
  // não como filha (action 'append' colocava dentro do infNFe → rejeição 225).
  sig.computeSignature(xml, {
    location: { reference: `//*[@Id='${refId}']`, action: 'after' },
  });
  return sig.getSignedXml();
}

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface NFCeEmitente {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string;
  inscricao_estadual: string;
  crt: number; // 1=SN, 2=SN excesso, 3=Normal
  endereco_logradouro: string;
  endereco_numero: string;
  endereco_bairro: string;
  endereco_cidade: string;
  endereco_uf: string;
  endereco_cep: string;
  endereco_codigo_municipio: string;
  telefone?: string;
}

export interface NFCeDestinatario {
  cpf_cnpj: string | null;
  doc_tipo: 'cpf' | 'cnpj' | null;
  nome: string | null;
  email?: string | null;
}

export interface NFCeItem {
  nItem: number;
  cProd: string;
  xProd: string;
  ncm: string;
  cfop: string;
  uCom: string;
  qCom: number;
  vUnCom: number;
  vProd: number;
  // ICMS
  icms_orig: string;     // 0=Nacional
  icms_cst?: string;     // CST (regime normal) — 00, 20, 60, etc.
  icms_csosn?: string;   // CSOSN (Simples Nacional) — 102, 500, etc.
  icms_vBC?: number;
  icms_pICMS?: number;
  icms_vICMS?: number;
  // IBS/CBS (NT 2025.002 — obrigatório CRT 3 a partir de 03/Ago/2026)
  ibs_cbs_cst?: string;        // CST IBS/CBS — 000=tributado integral
  ibs_cbs_cClassTrib?: string; // Código Classificação Tributária (6 dígitos)
}

export interface NFCeConfig {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: Ambiente;
  serie: string;
  csc_id: string;
  csc_token: string;
}

export interface NFCeResult {
  success: boolean;
  numero_nf: string | null;
  serie: string | null;
  chave_acesso: string | null;
  numero_protocolo: string | null;
  codigo_verificacao: string | null;
  qrcode_url: string | null;
  url_consulta: string | null;
  xml_retorno: string;
  message: string;
}

// ── IBS/CBS helpers (NT 2025.002 — Reforma Tributária) ─────────────────────

const IBS_UF_RATE = 0.10;   // 0,1% IBS estadual (teste 2026)
const IBS_MUN_RATE = 0.00;  // 0% IBS municipal (teste 2026)
const CBS_RATE = 0.90;      // 0,9% CBS federal (teste 2026)

// Grupo IBS/CBS da reforma desligado por padrão: a estrutura atual não bate com
// o schema atual da SVRS (rejeição 225 em IBSCBSTot/vIBSUF). Enquanto não for
// implementado contra o XSD oficial da reforma, mantém-se opt-in por env var
// (NFCE_IBSCBS=1) — o grupo é informativo/transitório em 2026, não obriga a nota.
const IBSCBS_ENABLED = process.env.NFCE_IBSCBS === '1';

function buildIBSCBSItem(item: NFCeItem, crt: number): { xml: string; vIBS: number; vCBS: number; vBC: number } {
  // CRT 1/2/4 (Simples Nacional/MEI): adiado para Jan/2027
  if (!IBSCBS_ENABLED || crt !== 3) return { xml: '', vIBS: 0, vCBS: 0, vBC: 0 };

  const cstIbsCbs = item.ibs_cbs_cst || '000';
  const cClassTrib = item.ibs_cbs_cClassTrib || '000003';
  const vBC = item.vProd;
  const vIBSUF = +(vBC * IBS_UF_RATE / 100).toFixed(2);
  const vIBSMun = +(vBC * IBS_MUN_RATE / 100).toFixed(2);
  const vIBS = +(vIBSUF + vIBSMun).toFixed(2);
  const vCBS = +(vBC * CBS_RATE / 100).toFixed(2);

  const xml =
    `<IBSCBS>` +
    `<CST>${cstIbsCbs}</CST>` +
    `<cClassTrib>${cClassTrib}</cClassTrib>` +
    `<gIBSCBS>` +
    `<vBC>${fmtDec(vBC)}</vBC>` +
    `<gIBSUF>` +
    `<pIBSUF>${fmtDec(IBS_UF_RATE, 4)}</pIBSUF>` +
    `<vIBSUF>${fmtDec(vIBSUF)}</vIBSUF>` +
    `</gIBSUF>` +
    `<gIBSMun>` +
    `<pIBSMun>${fmtDec(IBS_MUN_RATE, 4)}</pIBSMun>` +
    `<vIBSMun>${fmtDec(vIBSMun)}</vIBSMun>` +
    `</gIBSMun>` +
    `<vIBS>${fmtDec(vIBS)}</vIBS>` +
    `<gCBS>` +
    `<pCBS>${fmtDec(CBS_RATE, 4)}</pCBS>` +
    `<vCBS>${fmtDec(vCBS)}</vCBS>` +
    `</gCBS>` +
    `</gIBSCBS>` +
    `</IBSCBS>`;

  return { xml, vIBS, vCBS, vBC };
}

function buildIBSCBSTot(totalVBC: number, totalVIBS: number, totalVCBS: number): string {
  if (totalVBC === 0 && totalVIBS === 0 && totalVCBS === 0) return '';
  return (
    `<IBSCBSTot>` +
    `<vBCIBSCBS>${fmtDec(totalVBC)}</vBCIBSCBS>` +
    `<vIBSUF>${fmtDec(+(totalVIBS * IBS_UF_RATE / (IBS_UF_RATE + IBS_MUN_RATE || 1)).toFixed(2))}</vIBSUF>` +
    `<vIBSMun>0.00</vIBSMun>` +
    `<vIBS>${fmtDec(totalVIBS)}</vIBS>` +
    `<vCBS>${fmtDec(totalVCBS)}</vCBS>` +
    `</IBSCBSTot>`
  );
}

// ── Montar XML da NFC-e ─────────────────────────────────────────────────────

function buildNFCeXml(params: {
  emitente: NFCeEmitente;
  destinatario: NFCeDestinatario;
  items: NFCeItem[];
  config: NFCeConfig;
  nNF: number;
  tPag: string;
}): { xml: string; chave: string; qrCodeUrl: string } {
  const { emitente, destinatario, items, config, nNF, tPag } = params;
  const cnpj = emitente.cnpj.replace(/\D/g, '');
  const tpAmb = config.ambiente === 'producao' ? '1' : '2';
  const now = brasilia();
  const aamm = now.toISOString().slice(2, 4) + now.toISOString().slice(5, 7);
  const dhEmi = dhBrasilia();
  const cNF = pad(Math.floor(Math.random() * 99999999), 8);
  const tpEmis = '1'; // normal

  const chave = buildChaveAcesso({
    cUF: CUF_RJ, aamm, cnpj, mod: '65',
    serie: config.serie, nNF, tpEmis, cNF,
  });
  const nfeId = `NFe${chave}`;

  // Totais
  let vProd = 0;
  let vICMS = 0;
  let vBC = 0;
  for (const it of items) {
    vProd += it.vProd;
    vICMS += it.icms_vICMS ?? 0;
    vBC += it.icms_vBC ?? 0;
  }

  // QR Code
  const qrCodeUrl = buildQRCodeUrl({
    chave, tpAmb, cscId: config.csc_id, cscToken: config.csc_token, ambiente: config.ambiente,
  });

  // det (items)
  let detXml = '';
  let totIBS = 0, totCBS = 0, totBCIBSCBS = 0;
  for (const it of items) {
    let icmsXml: string;
    if (emitente.crt === 1 || emitente.crt === 2) {
      const csosn = it.icms_csosn || '102';
      if (csosn === '102' || csosn === '103' || csosn === '300' || csosn === '400') {
        icmsXml = `<ICMSSN102><orig>${it.icms_orig}</orig><CSOSN>${csosn}</CSOSN></ICMSSN102>`;
      } else if (csosn === '500') {
        icmsXml = `<ICMSSN500><orig>${it.icms_orig}</orig><CSOSN>500</CSOSN></ICMSSN500>`;
      } else {
        icmsXml = `<ICMSSN102><orig>${it.icms_orig}</orig><CSOSN>102</CSOSN></ICMSSN102>`;
      }
    } else {
      const cst = it.icms_cst || '00';
      if (cst === '00') {
        icmsXml =
          `<ICMS00><orig>${it.icms_orig}</orig><CST>00</CST>` +
          `<modBC>0</modBC><vBC>${fmtDec(it.icms_vBC ?? it.vProd)}</vBC>` +
          `<pICMS>${fmtDec(it.icms_pICMS ?? 0)}</pICMS>` +
          `<vICMS>${fmtDec(it.icms_vICMS ?? 0)}</vICMS></ICMS00>`;
      } else if (cst === '40' || cst === '41' || cst === '50') {
        icmsXml = `<ICMS40><orig>${it.icms_orig}</orig><CST>${cst}</CST></ICMS40>`;
      } else if (cst === '60') {
        icmsXml = `<ICMS60><orig>${it.icms_orig}</orig><CST>60</CST></ICMS60>`;
      } else {
        icmsXml = `<ICMS00><orig>${it.icms_orig}</orig><CST>${cst}</CST>` +
          `<modBC>0</modBC><vBC>${fmtDec(it.icms_vBC ?? 0)}</vBC>` +
          `<pICMS>${fmtDec(it.icms_pICMS ?? 0)}</pICMS>` +
          `<vICMS>${fmtDec(it.icms_vICMS ?? 0)}</vICMS></ICMS00>`;
      }
    }

    const ibsCbs = buildIBSCBSItem(it, emitente.crt);
    totIBS += ibsCbs.vIBS;
    totCBS += ibsCbs.vCBS;
    totBCIBSCBS += ibsCbs.vBC;

    detXml +=
      `<det nItem="${it.nItem}">` +
      `<prod>` +
      `<cProd>${xmlEsc(it.cProd)}</cProd>` +
      `<cEAN>SEM GTIN</cEAN>` +
      `<xProd>${xmlEsc(tpAmb === '2' && it.nItem === 1 ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : it.xProd)}</xProd>` +
      `<NCM>${sanitizeNCM(it.ncm)}</NCM>` +
      `<CFOP>${it.cfop}</CFOP>` +
      `<uCom>${xmlEsc(it.uCom)}</uCom>` +
      `<qCom>${fmtDec(it.qCom, 4)}</qCom>` +
      `<vUnCom>${fmtDec(it.vUnCom, 4)}</vUnCom>` +
      `<vProd>${fmtDec(it.vProd)}</vProd>` +
      `<cEANTrib>SEM GTIN</cEANTrib>` +
      `<uTrib>${xmlEsc(it.uCom)}</uTrib>` +
      `<qTrib>${fmtDec(it.qCom, 4)}</qTrib>` +
      `<vUnTrib>${fmtDec(it.vUnCom, 4)}</vUnTrib>` +
      `<indTot>1</indTot>` +
      `</prod>` +
      `<imposto>` +
      `<ICMS>${icmsXml}</ICMS>` +
      `<PIS><PISOutr><CST>99</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
      `<COFINS><COFINSOutr><CST>99</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>` +
      ibsCbs.xml +
      `</imposto>` +
      `</det>`;
  }

  // dest (optional for NFC-e)
  let destXml = '';
  if (destinatario.cpf_cnpj) {
    const docLimpo = destinatario.cpf_cnpj.replace(/\D/g, '');
    const isCnpj = destinatario.doc_tipo === 'cnpj' || docLimpo.length > 11;
    destXml = '<dest>';
    destXml += isCnpj ? `<CNPJ>${docLimpo}</CNPJ>` : `<CPF>${docLimpo}</CPF>`;
    if (destinatario.nome) destXml += `<xNome>${xmlEsc(destinatario.nome)}</xNome>`;
    destXml += '<indIEDest>9</indIEDest>';
    destXml += '</dest>';
  }

  const infNFe =
    `<infNFe Id="${nfeId}" versao="4.00">` +
    `<ide>` +
    `<cUF>${CUF_RJ}</cUF>` +
    `<cNF>${cNF}</cNF>` +
    `<natOp>VENDA AO CONSUMIDOR</natOp>` +
    `<mod>65</mod>` +
    `<serie>${parseInt(String(config.serie), 10) || 0}</serie>` +
    `<nNF>${nNF}</nNF>` +
    `<dhEmi>${dhEmi}</dhEmi>` +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    `<cMunFG>${emitente.endereco_codigo_municipio}</cMunFG>` +
    `<tpImp>4</tpImp>` +
    `<tpEmis>${tpEmis}</tpEmis>` +
    `<cDV>${chave[43]}</cDV>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<finNFe>1</finNFe>` +
    `<indFinal>1</indFinal>` +
    `<indPres>1</indPres>` +
    `<procEmi>0</procEmi>` +
    `<verProc>Fluxo1.0</verProc>` +
    `</ide>` +
    `<emit>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<xNome>${xmlEsc(emitente.razao_social)}</xNome>` +
    (emitente.nome_fantasia ? `<xFant>${xmlEsc(emitente.nome_fantasia)}</xFant>` : '') +
    `<enderEmit>` +
    `<xLgr>${xmlEsc(emitente.endereco_logradouro)}</xLgr>` +
    `<nro>${xmlEsc(emitente.endereco_numero)}</nro>` +
    `<xBairro>${xmlEsc(emitente.endereco_bairro)}</xBairro>` +
    `<cMun>${emitente.endereco_codigo_municipio}</cMun>` +
    `<xMun>${xmlEsc(emitente.endereco_cidade)}</xMun>` +
    `<UF>${emitente.endereco_uf}</UF>` +
    `<CEP>${emitente.endereco_cep.replace(/\D/g, '')}</CEP>` +
    `<cPais>1058</cPais><xPais>Brasil</xPais>` +
    (emitente.telefone ? `<fone>${emitente.telefone.replace(/\D/g, '')}</fone>` : '') +
    `</enderEmit>` +
    `<IE>${emitente.inscricao_estadual.replace(/\D/g, '')}</IE>` +
    `<CRT>${emitente.crt}</CRT>` +
    `</emit>` +
    destXml +
    detXml +
    `<total><ICMSTot>` +
    `<vBC>${fmtDec(vBC)}</vBC>` +
    `<vICMS>${fmtDec(vICMS)}</vICMS>` +
    `<vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST>` +
    `<vST>0.00</vST>` +
    `<vFCPST>0.00</vFCPST>` +
    `<vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${fmtDec(vProd)}</vProd>` +
    `<vFrete>0.00</vFrete>` +
    `<vSeg>0.00</vSeg>` +
    `<vDesc>0.00</vDesc>` +
    `<vII>0.00</vII>` +
    `<vIPI>0.00</vIPI>` +
    `<vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>0.00</vPIS>` +
    `<vCOFINS>0.00</vCOFINS>` +
    `<vOutro>0.00</vOutro>` +
    `<vNF>${fmtDec(vProd)}</vNF>` +
    `</ICMSTot>` +
    buildIBSCBSTot(totBCIBSCBS, totIBS, totCBS) +
    `</total>` +
    `<transp><modFrete>9</modFrete></transp>` +
    `<pag><detPag>` +
    `<tPag>${tPag}</tPag>` +
    `<vPag>${fmtDec(vProd)}</vPag>` +
    `</detPag></pag>` +
    `<infAdic><infCpl>NFC-e emitida pelo sistema Fluxo.</infCpl></infAdic>` +
    `</infNFe>`;

  const nfeXml =
    `<NFe xmlns="${NFE_NS}">${infNFe}</NFe>`;

  return { xml: nfeXml, chave, qrCodeUrl };
}

// ── Emitir NFC-e (NFeAutorizacao4 — síncrono) ──────────────────────────────

export async function emitirNFCe(params: {
  emitente: NFCeEmitente;
  destinatario: NFCeDestinatario;
  items: NFCeItem[];
  config: NFCeConfig;
  nNF: number;
  tPag?: string;
}): Promise<NFCeResult> {
  const tPag = params.tPag || '01'; // 01=dinheiro default

  // 1. Build XML
  const { xml: nfeUnsigned, chave, qrCodeUrl } = buildNFCeXml({ ...params, tPag });

  // 2. Sign
  const nfeId = `NFe${chave}`;
  const { key, cert } = extractPemFromPfx(params.config.certificado_base64, params.config.certificado_senha);
  const nfeSigned = signNFe(nfeUnsigned, nfeId, key, cert);

  // 3. Build enviNFe (synchronous, indSinc=1)
  const idLote = Date.now().toString().slice(-15);
  const enviNFe =
    `<enviNFe xmlns="${NFE_NS}" versao="4.00">` +
    `<idLote>${idLote}</idLote>` +
    `<indSinc>1</indSinc>` +
    nfeSigned +
    `</enviNFe>`;

  console.log(`[NFC-e] Emitindo NFC-e ${params.nNF} chave ${chave}`);

  // 4. Send to SEFAZ
  const res = await sefazPost({
    ambiente: params.config.ambiente,
    service: 'autorizacao',
    xml: enviNFe,
    pfxBase64: params.config.certificado_base64,
    pfxSenha: params.config.certificado_senha,
  });

  console.log(`[NFC-e] SEFAZ HTTP ${res.status}`);
  console.log(`[NFC-e] Resposta (2000 chars):`, res.body.slice(0, 2000));

  if (res.status !== 200) {
    return {
      success: false, numero_nf: null, serie: null, chave_acesso: null,
      numero_protocolo: null, codigo_verificacao: null,
      qrcode_url: null, url_consulta: null,
      xml_retorno: res.body,
      message: `SEFAZ respondeu HTTP ${res.status}: ${res.body.slice(0, 500)}`,
    };
  }

  // 5. Parse response
  const body = res.body;
  const cStat = xmlTag(body, 'cStat');
  const xMotivo = xmlTag(body, 'xMotivo');
  const nProt = xmlTag(body, 'nProt');
  const dhRecbto = xmlTag(body, 'dhRecbto');

  // 100 = Autorizado, 150 = Autorizado fora de prazo
  if (cStat === '100' || cStat === '150') {
    return {
      success: true,
      numero_nf: String(params.nNF),
      serie: params.config.serie,
      chave_acesso: chave,
      numero_protocolo: nProt,
      codigo_verificacao: null,
      qrcode_url: qrCodeUrl,
      url_consulta: CONSULTA_URLS[params.config.ambiente],
      xml_retorno: body,
      message: `NFC-e ${params.nNF} autorizada. Protocolo: ${nProt}`,
    };
  }

  // 104 = Lote processado (check inner protNFe)
  if (cStat === '104') {
    const protNFe = xmlTag(body, 'protNFe') ?? body;
    const innerStat = xmlTag(protNFe, 'cStat');
    const innerMotivo = xmlTag(protNFe, 'xMotivo');
    const innerProt = xmlTag(protNFe, 'nProt');

    if (innerStat === '100' || innerStat === '150') {
      return {
        success: true,
        numero_nf: String(params.nNF),
        serie: params.config.serie,
        chave_acesso: chave,
        numero_protocolo: innerProt,
        codigo_verificacao: null,
        qrcode_url: qrCodeUrl,
        url_consulta: CONSULTA_URLS[params.config.ambiente],
        xml_retorno: body,
        message: `NFC-e ${params.nNF} autorizada. Protocolo: ${innerProt}`,
      };
    }

    return {
      success: false, numero_nf: null, serie: null, chave_acesso: chave,
      numero_protocolo: null, codigo_verificacao: null,
      qrcode_url: null, url_consulta: null,
      xml_retorno: body,
      message: `Rejeição ${innerStat}: ${innerMotivo}`,
    };
  }

  return {
    success: false, numero_nf: null, serie: null, chave_acesso: chave,
    numero_protocolo: null, codigo_verificacao: null,
    qrcode_url: null, url_consulta: null,
    xml_retorno: body,
    message: `SEFAZ ${cStat}: ${xMotivo}`,
  };
}

// ── Cancelar NFC-e ──────────────────────────────────────────────────────────

export async function cancelarNFCe(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: Ambiente;
  cnpj: string;
  chave: string;
  nProt: string;
  xJust: string;
}): Promise<{ success: boolean; xml: string; message: string }> {
  const cnpj = params.cnpj.replace(/\D/g, '');
  const tpAmb = params.ambiente === 'producao' ? '1' : '2';
  const dhEvento = dhBrasilia();
  const eventId = `ID110111${params.chave}01`;

  const infEventoXml =
    `<infEvento Id="${eventId}">` +
    `<cOrgao>${CUF_RJ}</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${params.chave}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>110111</tpEvento>` +
    `<nSeqEvento>1</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>Cancelamento</descEvento>` +
    `<nProt>${params.nProt}</nProt>` +
    `<xJust>${xmlEsc(params.xJust)}</xJust>` +
    `</detEvento>` +
    `</infEvento>`;

  const eventoUnsigned =
    `<evento xmlns="${NFE_NS}" versao="1.00">${infEventoXml}</evento>`;

  const { key, cert } = extractPemFromPfx(params.certificado_base64, params.certificado_senha);
  const eventoSigned = signNFe(eventoUnsigned, eventId, key, cert);

  const envEvento =
    `<envEvento xmlns="${NFE_NS}" versao="1.00">` +
    `<idLote>${Date.now()}</idLote>` +
    eventoSigned +
    `</envEvento>`;

  const res = await sefazPost({
    ambiente: params.ambiente,
    service: 'evento',
    xml: envEvento,
    pfxBase64: params.certificado_base64,
    pfxSenha: params.certificado_senha,
  });

  if (res.status !== 200) {
    return { success: false, xml: res.body, message: `SEFAZ HTTP ${res.status}` };
  }

  const cStat = xmlTag(res.body, 'cStat');
  const xMotivo = xmlTag(res.body, 'xMotivo');

  // 135 = Evento registrado e vinculado, 155 = Cancelamento homologado fora prazo
  if (cStat === '135' || cStat === '155') {
    return { success: true, xml: res.body, message: `NFC-e cancelada. ${xMotivo}` };
  }

  return { success: false, xml: res.body, message: `Erro ${cStat}: ${xMotivo}` };
}

// ── Status do Serviço (teste de conexão) ────────────────────────────────────

export async function statusServicoNFCe(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: Ambiente;
}): Promise<{ success: boolean; message: string; cStat?: string }> {
  try {
    extractPemFromPfx(params.certificado_base64, params.certificado_senha);
  } catch (err: any) {
    return { success: false, message: `Erro no certificado: ${err.message}` };
  }

  try {
    const tpAmb = params.ambiente === 'producao' ? '1' : '2';
    const consStatServ =
      `<consStatServ xmlns="${NFE_NS}" versao="4.00">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<cUF>${CUF_RJ}</cUF>` +
      `<xServ>STATUS</xServ>` +
      `</consStatServ>`;

    const res = await sefazPost({
      ambiente: params.ambiente,
      service: 'status',
      xml: consStatServ,
      pfxBase64: params.certificado_base64,
      pfxSenha: params.certificado_senha,
    });

    console.log(`[NFC-e StatusServico] HTTP ${res.status}, body: ${res.body.slice(0, 500)}`);

    if (res.status !== 200) {
      return { success: false, message: `SEFAZ respondeu HTTP ${res.status}` };
    }

    const cStat = xmlTag(res.body, 'cStat');
    const xMotivo = xmlTag(res.body, 'xMotivo');

    // 107 = Serviço em Operação
    if (cStat === '107') {
      return { success: true, message: `SEFAZ NFC-e (SVRS) em operação. ${xMotivo}`, cStat };
    }

    return { success: false, message: `SEFAZ ${cStat}: ${xMotivo}`, cStat };
  } catch (err: any) {
    return { success: false, message: `Falha na conexão com SEFAZ: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NF-e (modelo 55) — mesma infraestrutura SVRS, endpoints nfe.svrs.rs.gov.br
// ═══════════════════════════════════════════════════════════════════════════

export interface NFeDestinatario {
  cpf_cnpj: string;
  doc_tipo: 'cpf' | 'cnpj';
  nome: string;
  ie?: string | null;
  indIEDest: '1' | '2' | '9'; // 1=contribuinte, 2=isento, 9=não contribuinte
  email?: string | null;
  endereco_logradouro?: string;
  endereco_numero?: string;
  endereco_bairro?: string;
  endereco_cidade?: string;
  endereco_codigo_municipio?: string;
  endereco_uf?: string;
  endereco_cep?: string;
}

export interface NFeConfig {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: Ambiente;
  serie: string;
}

function buildNFeXml(params: {
  emitente: NFCeEmitente;
  destinatario: NFeDestinatario;
  items: NFCeItem[];
  config: NFeConfig;
  nNF: number;
  natOp: string;
  tPag: string;
}): { xml: string; chave: string } {
  const { emitente, destinatario, items, config, nNF, natOp, tPag } = params;
  const cnpj = emitente.cnpj.replace(/\D/g, '');
  const tpAmb = config.ambiente === 'producao' ? '1' : '2';
  const now = brasilia();
  const aamm = now.toISOString().slice(2, 4) + now.toISOString().slice(5, 7);
  const dhEmi = dhBrasilia();
  const cNF = pad(Math.floor(Math.random() * 99999999), 8);
  const tpEmis = '1';

  const chave = buildChaveAcesso({
    cUF: CUF_RJ, aamm, cnpj, mod: '55',
    serie: config.serie, nNF, tpEmis, cNF,
  });
  const nfeId = `NFe${chave}`;

  let vProd = 0, vICMS = 0, vBC = 0;
  for (const it of items) {
    vProd += it.vProd;
    vICMS += it.icms_vICMS ?? 0;
    vBC += it.icms_vBC ?? 0;
  }

  // det (items) — mesmo builder da NFC-e
  let detXml = '';
  let totIBS = 0, totCBS = 0, totBCIBSCBS = 0;
  for (const it of items) {
    let icmsXml: string;
    if (emitente.crt === 1 || emitente.crt === 2) {
      const csosn = it.icms_csosn || '102';
      if (csosn === '102' || csosn === '103' || csosn === '300' || csosn === '400') {
        icmsXml = `<ICMSSN102><orig>${it.icms_orig}</orig><CSOSN>${csosn}</CSOSN></ICMSSN102>`;
      } else if (csosn === '500') {
        icmsXml = `<ICMSSN500><orig>${it.icms_orig}</orig><CSOSN>500</CSOSN></ICMSSN500>`;
      } else {
        icmsXml = `<ICMSSN102><orig>${it.icms_orig}</orig><CSOSN>102</CSOSN></ICMSSN102>`;
      }
    } else {
      const cst = it.icms_cst || '00';
      if (cst === '00') {
        icmsXml =
          `<ICMS00><orig>${it.icms_orig}</orig><CST>00</CST>` +
          `<modBC>0</modBC><vBC>${fmtDec(it.icms_vBC ?? it.vProd)}</vBC>` +
          `<pICMS>${fmtDec(it.icms_pICMS ?? 0)}</pICMS>` +
          `<vICMS>${fmtDec(it.icms_vICMS ?? 0)}</vICMS></ICMS00>`;
      } else if (cst === '40' || cst === '41' || cst === '50') {
        icmsXml = `<ICMS40><orig>${it.icms_orig}</orig><CST>${cst}</CST></ICMS40>`;
      } else if (cst === '60') {
        icmsXml = `<ICMS60><orig>${it.icms_orig}</orig><CST>60</CST></ICMS60>`;
      } else {
        icmsXml = `<ICMS00><orig>${it.icms_orig}</orig><CST>${cst}</CST>` +
          `<modBC>0</modBC><vBC>${fmtDec(it.icms_vBC ?? 0)}</vBC>` +
          `<pICMS>${fmtDec(it.icms_pICMS ?? 0)}</pICMS>` +
          `<vICMS>${fmtDec(it.icms_vICMS ?? 0)}</vICMS></ICMS00>`;
      }
    }

    const ibsCbs = buildIBSCBSItem(it, emitente.crt);
    totIBS += ibsCbs.vIBS;
    totCBS += ibsCbs.vCBS;
    totBCIBSCBS += ibsCbs.vBC;

    detXml +=
      `<det nItem="${it.nItem}">` +
      `<prod>` +
      `<cProd>${xmlEsc(it.cProd)}</cProd>` +
      `<cEAN>SEM GTIN</cEAN>` +
      `<xProd>${xmlEsc(tpAmb === '2' && it.nItem === 1 ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : it.xProd)}</xProd>` +
      `<NCM>${sanitizeNCM(it.ncm)}</NCM>` +
      `<CFOP>${it.cfop}</CFOP>` +
      `<uCom>${xmlEsc(it.uCom)}</uCom>` +
      `<qCom>${fmtDec(it.qCom, 4)}</qCom>` +
      `<vUnCom>${fmtDec(it.vUnCom, 4)}</vUnCom>` +
      `<vProd>${fmtDec(it.vProd)}</vProd>` +
      `<cEANTrib>SEM GTIN</cEANTrib>` +
      `<uTrib>${xmlEsc(it.uCom)}</uTrib>` +
      `<qTrib>${fmtDec(it.qCom, 4)}</qTrib>` +
      `<vUnTrib>${fmtDec(it.vUnCom, 4)}</vUnTrib>` +
      `<indTot>1</indTot>` +
      `</prod>` +
      `<imposto>` +
      `<ICMS>${icmsXml}</ICMS>` +
      `<PIS><PISOutr><CST>99</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
      `<COFINS><COFINSOutr><CST>99</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>` +
      ibsCbs.xml +
      `</imposto>` +
      `</det>`;
  }

  // dest (obrigatório para NF-e modelo 55)
  const docLimpo = destinatario.cpf_cnpj.replace(/\D/g, '');
  const isCnpj = destinatario.doc_tipo === 'cnpj' || docLimpo.length > 11;
  let destXml = '<dest>';
  destXml += isCnpj ? `<CNPJ>${docLimpo}</CNPJ>` : `<CPF>${docLimpo}</CPF>`;
  destXml += `<xNome>${xmlEsc(destinatario.nome)}</xNome>`;
  if (destinatario.endereco_logradouro) {
    destXml += '<enderDest>';
    destXml += `<xLgr>${xmlEsc(destinatario.endereco_logradouro)}</xLgr>`;
    destXml += `<nro>${xmlEsc(destinatario.endereco_numero || 'S/N')}</nro>`;
    destXml += `<xBairro>${xmlEsc(destinatario.endereco_bairro || '')}</xBairro>`;
    destXml += `<cMun>${destinatario.endereco_codigo_municipio || ''}</cMun>`;
    destXml += `<xMun>${xmlEsc(destinatario.endereco_cidade || '')}</xMun>`;
    destXml += `<UF>${destinatario.endereco_uf || 'RJ'}</UF>`;
    if (destinatario.endereco_cep) destXml += `<CEP>${destinatario.endereco_cep.replace(/\D/g, '')}</CEP>`;
    destXml += '<cPais>1058</cPais><xPais>Brasil</xPais>';
    destXml += '</enderDest>';
  }
  destXml += `<indIEDest>${destinatario.indIEDest}</indIEDest>`;
  if (destinatario.ie && destinatario.indIEDest === '1') {
    destXml += `<IE>${destinatario.ie.replace(/\D/g, '')}</IE>`;
  }
  if (destinatario.email) destXml += `<email>${xmlEsc(destinatario.email)}</email>`;
  destXml += '</dest>';

  const infNFe =
    `<infNFe Id="${nfeId}" versao="4.00">` +
    `<ide>` +
    `<cUF>${CUF_RJ}</cUF>` +
    `<cNF>${cNF}</cNF>` +
    `<natOp>${xmlEsc(natOp)}</natOp>` +
    `<mod>55</mod>` +
    `<serie>${parseInt(String(config.serie), 10) || 0}</serie>` +
    `<nNF>${nNF}</nNF>` +
    `<dhEmi>${dhEmi}</dhEmi>` +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    `<cMunFG>${emitente.endereco_codigo_municipio}</cMunFG>` +
    `<tpImp>1</tpImp>` +
    `<tpEmis>${tpEmis}</tpEmis>` +
    `<cDV>${chave[43]}</cDV>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<finNFe>1</finNFe>` +
    `<indFinal>1</indFinal>` +
    `<indPres>0</indPres>` +
    `<procEmi>0</procEmi>` +
    `<verProc>Fluxo1.0</verProc>` +
    `</ide>` +
    `<emit>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<xNome>${xmlEsc(emitente.razao_social)}</xNome>` +
    (emitente.nome_fantasia ? `<xFant>${xmlEsc(emitente.nome_fantasia)}</xFant>` : '') +
    `<enderEmit>` +
    `<xLgr>${xmlEsc(emitente.endereco_logradouro)}</xLgr>` +
    `<nro>${xmlEsc(emitente.endereco_numero)}</nro>` +
    `<xBairro>${xmlEsc(emitente.endereco_bairro)}</xBairro>` +
    `<cMun>${emitente.endereco_codigo_municipio}</cMun>` +
    `<xMun>${xmlEsc(emitente.endereco_cidade)}</xMun>` +
    `<UF>${emitente.endereco_uf}</UF>` +
    `<CEP>${emitente.endereco_cep.replace(/\D/g, '')}</CEP>` +
    `<cPais>1058</cPais><xPais>Brasil</xPais>` +
    (emitente.telefone ? `<fone>${emitente.telefone.replace(/\D/g, '')}</fone>` : '') +
    `</enderEmit>` +
    `<IE>${emitente.inscricao_estadual.replace(/\D/g, '')}</IE>` +
    `<CRT>${emitente.crt}</CRT>` +
    `</emit>` +
    destXml +
    detXml +
    `<total><ICMSTot>` +
    `<vBC>${fmtDec(vBC)}</vBC>` +
    `<vICMS>${fmtDec(vICMS)}</vICMS>` +
    `<vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST>` +
    `<vST>0.00</vST>` +
    `<vFCPST>0.00</vFCPST>` +
    `<vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${fmtDec(vProd)}</vProd>` +
    `<vFrete>0.00</vFrete>` +
    `<vSeg>0.00</vSeg>` +
    `<vDesc>0.00</vDesc>` +
    `<vII>0.00</vII>` +
    `<vIPI>0.00</vIPI>` +
    `<vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>0.00</vPIS>` +
    `<vCOFINS>0.00</vCOFINS>` +
    `<vOutro>0.00</vOutro>` +
    `<vNF>${fmtDec(vProd)}</vNF>` +
    `</ICMSTot>` +
    buildIBSCBSTot(totBCIBSCBS, totIBS, totCBS) +
    `</total>` +
    `<transp><modFrete>9</modFrete></transp>` +
    `<pag><detPag>` +
    `<tPag>${tPag}</tPag>` +
    `<vPag>${fmtDec(vProd)}</vPag>` +
    `</detPag></pag>` +
    `<infAdic><infCpl>NF-e emitida pelo sistema Fluxo.</infCpl></infAdic>` +
    `</infNFe>`;

  return { xml: `<NFe xmlns="${NFE_NS}">${infNFe}</NFe>`, chave };
}

// ── Emitir NF-e (modelo 55) ─────────────────────────────────────────────────

export async function emitirNFe(params: {
  emitente: NFCeEmitente;
  destinatario: NFeDestinatario;
  items: NFCeItem[];
  config: NFeConfig;
  nNF: number;
  natOp?: string;
  tPag?: string;
}): Promise<NFCeResult> {
  const natOp = params.natOp || 'VENDA DE MERCADORIA';
  const tPag = params.tPag || '01';

  const { xml: nfeUnsigned, chave } = buildNFeXml({ ...params, natOp, tPag });

  const nfeId = `NFe${chave}`;
  const { key, cert } = extractPemFromPfx(params.config.certificado_base64, params.config.certificado_senha);
  const nfeSigned = signNFe(nfeUnsigned, nfeId, key, cert);

  const idLote = Date.now().toString().slice(-15);
  const enviNFe =
    `<enviNFe xmlns="${NFE_NS}" versao="4.00">` +
    `<idLote>${idLote}</idLote>` +
    `<indSinc>1</indSinc>` +
    nfeSigned +
    `</enviNFe>`;

  console.log(`[NF-e] Emitindo NF-e ${params.nNF} chave ${chave}`);

  const res = await sefazPost({
    ambiente: params.config.ambiente,
    service: 'autorizacao',
    xml: enviNFe,
    pfxBase64: params.config.certificado_base64,
    pfxSenha: params.config.certificado_senha,
    modelo: '55',
  });

  console.log(`[NF-e] SEFAZ HTTP ${res.status}`);
  console.log(`[NF-e] Resposta (2000 chars):`, res.body.slice(0, 2000));

  if (res.status !== 200) {
    return {
      success: false, numero_nf: null, serie: null, chave_acesso: null,
      numero_protocolo: null, codigo_verificacao: null,
      qrcode_url: null, url_consulta: null,
      xml_retorno: res.body,
      message: `SEFAZ respondeu HTTP ${res.status}: ${res.body.slice(0, 500)}`,
    };
  }

  const body = res.body;
  const cStat = xmlTag(body, 'cStat');
  const xMotivo = xmlTag(body, 'xMotivo');
  const nProt = xmlTag(body, 'nProt');

  if (cStat === '100' || cStat === '150') {
    return {
      success: true,
      numero_nf: String(params.nNF),
      serie: params.config.serie,
      chave_acesso: chave,
      numero_protocolo: nProt,
      codigo_verificacao: null,
      qrcode_url: null,
      url_consulta: null,
      xml_retorno: body,
      message: `NF-e ${params.nNF} autorizada. Protocolo: ${nProt}`,
    };
  }

  if (cStat === '104') {
    const protNFe = xmlTag(body, 'protNFe') ?? body;
    const innerStat = xmlTag(protNFe, 'cStat');
    const innerMotivo = xmlTag(protNFe, 'xMotivo');
    const innerProt = xmlTag(protNFe, 'nProt');

    if (innerStat === '100' || innerStat === '150') {
      return {
        success: true,
        numero_nf: String(params.nNF),
        serie: params.config.serie,
        chave_acesso: chave,
        numero_protocolo: innerProt,
        codigo_verificacao: null,
        qrcode_url: null, url_consulta: null,
        xml_retorno: body,
        message: `NF-e ${params.nNF} autorizada. Protocolo: ${innerProt}`,
      };
    }

    return {
      success: false, numero_nf: null, serie: null, chave_acesso: chave,
      numero_protocolo: null, codigo_verificacao: null,
      qrcode_url: null, url_consulta: null,
      xml_retorno: body,
      message: `Rejeição ${innerStat}: ${innerMotivo}`,
    };
  }

  return {
    success: false, numero_nf: null, serie: null, chave_acesso: chave,
    numero_protocolo: null, codigo_verificacao: null,
    qrcode_url: null, url_consulta: null,
    xml_retorno: body,
    message: `SEFAZ ${cStat}: ${xMotivo}`,
  };
}

// ── Cancelar NF-e (modelo 55) ───────────────────────────────────────────────

export async function cancelarNFe(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: Ambiente;
  cnpj: string;
  chave: string;
  nProt: string;
  xJust: string;
}): Promise<{ success: boolean; xml: string; message: string }> {
  const cnpj = params.cnpj.replace(/\D/g, '');
  const tpAmb = params.ambiente === 'producao' ? '1' : '2';
  const dhEvento = dhBrasilia();
  const eventId = `ID110111${params.chave}01`;

  const infEventoXml =
    `<infEvento Id="${eventId}">` +
    `<cOrgao>${CUF_RJ}</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${params.chave}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>110111</tpEvento>` +
    `<nSeqEvento>1</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>Cancelamento</descEvento>` +
    `<nProt>${params.nProt}</nProt>` +
    `<xJust>${xmlEsc(params.xJust)}</xJust>` +
    `</detEvento>` +
    `</infEvento>`;

  const eventoUnsigned =
    `<evento xmlns="${NFE_NS}" versao="1.00">${infEventoXml}</evento>`;

  const { key, cert } = extractPemFromPfx(params.certificado_base64, params.certificado_senha);
  const eventoSigned = signNFe(eventoUnsigned, eventId, key, cert);

  const envEvento =
    `<envEvento xmlns="${NFE_NS}" versao="1.00">` +
    `<idLote>${Date.now()}</idLote>` +
    eventoSigned +
    `</envEvento>`;

  const res = await sefazPost({
    ambiente: params.ambiente,
    service: 'evento',
    xml: envEvento,
    pfxBase64: params.certificado_base64,
    pfxSenha: params.certificado_senha,
    modelo: '55',
  });

  if (res.status !== 200) {
    return { success: false, xml: res.body, message: `SEFAZ HTTP ${res.status}` };
  }

  const cStat = xmlTag(res.body, 'cStat');
  const xMotivo = xmlTag(res.body, 'xMotivo');

  if (cStat === '135' || cStat === '155') {
    return { success: true, xml: res.body, message: `NF-e cancelada. ${xMotivo}` };
  }

  return { success: false, xml: res.body, message: `Erro ${cStat}: ${xMotivo}` };
}

// ── Status do Serviço NF-e (modelo 55) ──────────────────────────────────────

export async function statusServicoNFe(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: Ambiente;
}): Promise<{ success: boolean; message: string; cStat?: string }> {
  try {
    extractPemFromPfx(params.certificado_base64, params.certificado_senha);
  } catch (err: any) {
    return { success: false, message: `Erro no certificado: ${err.message}` };
  }

  try {
    const tpAmb = params.ambiente === 'producao' ? '1' : '2';
    const consStatServ =
      `<consStatServ xmlns="${NFE_NS}" versao="4.00">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<cUF>${CUF_RJ}</cUF>` +
      `<xServ>STATUS</xServ>` +
      `</consStatServ>`;

    const res = await sefazPost({
      ambiente: params.ambiente,
      service: 'status',
      xml: consStatServ,
      pfxBase64: params.certificado_base64,
      pfxSenha: params.certificado_senha,
      modelo: '55',
    });

    console.log(`[NF-e StatusServico] HTTP ${res.status}, body: ${res.body.slice(0, 500)}`);

    if (res.status !== 200) {
      return { success: false, message: `SEFAZ respondeu HTTP ${res.status}` };
    }

    const cStat = xmlTag(res.body, 'cStat');
    const xMotivo = xmlTag(res.body, 'xMotivo');

    if (cStat === '107') {
      return { success: true, message: `SEFAZ NF-e (SVRS) em operação. ${xMotivo}`, cStat };
    }

    return { success: false, message: `SEFAZ ${cStat}: ${xMotivo}`, cStat };
  } catch (err: any) {
    return { success: false, message: `Falha na conexão com SEFAZ: ${err.message}` };
  }
}
