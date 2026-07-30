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

// xProd (e demais TString da NFe): o schema proíbe espaço no início/fim e
// caracteres de controle. Descrições da Erbon vêm com espaço no fim
// ("PIZZA MOZZARELLA DE BUFALA ") → rejeição 225. Normaliza e limita a 120.
function sanitizeXProd(s?: string): string {
  return (s || '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'PRODUTO';
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
  chave: string; tpAmb: string; ambiente: Ambiente;
}): string {
  const { chave, tpAmb } = params;
  const baseUrl = QRCODE_URLS[params.ambiente];
  // QR-Code v3.00 (NT 2025.001, obrigatório desde 01/09/2025): apenas
  // chave|versao|tpAmb. O CSC + hash SHA-1 foi substituído pela assinatura
  // digital da própria NFC-e; não usa mais CDATA no elemento qrCode.
  return `${baseUrl}?p=${chave}|3|${tpAmb}`;
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
  doc_tipo: 'cpf' | 'cnpj' | 'passaporte' | null;
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
  // PIS/COFINS — quando pis_cst é 01/02 emite PISAliq/COFINSAliq com alíquota;
  // caso contrário (ou vazio) cai no padrão CST 99 zerado.
  pis_cst?: string;
  pis_aliquota?: number;
  cofins_cst?: string;
  cofins_aliquota?: number;
  // IBS/CBS (NT 2025.002 — obrigatório CRT 3 a partir de 03/Ago/2026)
  ibs_cbs_cst?: string;        // CST IBS/CBS — 000=tributado integral
  ibs_cbs_cClassTrib?: string; // Código Classificação Tributária (6 dígitos)
  ibs_aliquota?: number;       // % IBS do item — fallback DEFAULT_IBS_RATE (0,10% teste 2026)
  cbs_aliquota?: number;       // % CBS do item — fallback DEFAULT_CBS_RATE (0,90% teste 2026)
}

// Monta o grupo PIS ou COFINS de um item. CST 01/02 (tributável por alíquota)
// → grupo *Aliq com vBC/pAliq/vAliq; qualquer outro CST (ou ausência) → grupo
// *Outr com CST 99 zerado (comportamento antigo, seguro para Simples).
function buildPisCofins(tag: 'PIS' | 'COFINS', vProd: number, cst?: string, aliquota?: number): string {
  // O GRUPO (Aliq/NT/Outr) é definido pelo CST, não pela alíquota. CST 01/02
  // SEMPRE vai em *Aliq (mesmo com alíquota 0); mandar CST 01 em *Outr é
  // rejeição 225. CST 04-09 = não tributado (*NT); demais = *Outr.
  const c = (cst || '').trim() || '99';
  const p = aliquota ?? 0;
  const pTag = tag === 'PIS' ? 'pPIS' : 'pCOFINS';
  const vTag = tag === 'PIS' ? 'vPIS' : 'vCOFINS';
  if (c === '01' || c === '02') {
    const vBC = Math.round(vProd * 100) / 100;
    const v = Math.round(vBC * p) / 100;
    return `<${tag}><${tag}Aliq><CST>${c}</CST><vBC>${fmtDec(vBC)}</vBC>` +
      `<${pTag}>${fmtDec(p)}</${pTag}><${vTag}>${fmtDec(v)}</${vTag}></${tag}Aliq></${tag}>`;
  }
  if (['04', '05', '06', '07', '08', '09'].includes(c)) {
    return `<${tag}><${tag}NT><CST>${c}</CST></${tag}NT></${tag}>`;
  }
  const outr = tag === 'PIS' ? 'PISOutr' : 'COFINSOutr';
  return `<${tag}><${outr}><CST>${c}</CST><vBC>0.00</vBC>` +
    `<${pTag}>0.00</${pTag}><${vTag}>0.00</${vTag}></${outr}></${tag}>`;
}

// Monta um <detPag>. NT 2023.004 (regra N17.1-10): SEFAZ exige o grupo <card>
// para tPag 03/04/10-13/15/17-19/26-29. Sem ele dá rejeição 391.
// tpIntegra=2 (pagamento NÃO integrado) é o mínimo aceito.
function buildDetPag(p: { tPag: string; vPag: number }): string {
  const needsCard = new Set([
    '03', '04', '10', '11', '12', '13', '15',
    '17', '18', '19', '26', '27', '28', '29',
  ]);
  const card = needsCard.has(p.tPag) ? `<card><tpIntegra>2</tpIntegra></card>` : '';
  return `<detPag><tPag>${p.tPag}</tPag><vPag>${fmtDec(p.vPag)}</vPag>${card}</detPag>`;
}

export interface NFCeConfig {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: Ambiente;
  serie: string;
  csc_id: string;
  csc_token: string;
  ibs_cbs_enabled?: boolean; // nf_hotel_config.nfce_ibs_cbs_enabled (opt-in por hotel)
}

export interface NFCeResult {
  /** XML assinado que foi enviado a SEFAZ (com o infNFeSupl do QR-Code).
   *  Guardado na nota porque e o documento fiscal a conservar e a unica
   *  forma de comprovar o que foi declarado, grupos de IBS/CBS inclusive.
   *  Antes so a resposta de protocolo era gravada. */
  xml_enviado?: string;
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
//
// Prazos (NT 2025.002 v1.40, publicada em 20/05/2026):
//   · CRT=3 (regime normal): homologação obrigatória 01/07/2026,
//     PRODUÇÃO OBRIGATÓRIA 03/08/2026 — sem os grupos a nota é rejeitada.
//   · CRT=1/2/4 (Simples Nacional/MEI): só em Jan/2027 — por isso o builder
//     devolve vazio para esses CRTs (hoje só Costa do Sol é CRT 3).
//   · Envio voluntário liberado desde 10/11/2025.
//
// Estrutura conferida contra o leiaute publicado (grupos UB no item e W03 no
// total). O que estava errado e causava a rejeição 225 anterior: o grupo
// IBSCBSTot era montado "achatado" (<vIBSUF> direto sob <IBSCBSTot>), quando o
// leiaute exige o aninhamento IBSCBSTot › gIBS › gIBSUF/gIBSMun e IBSCBSTot ›
// gCBS. Corrigido em buildIBSCBSTot abaixo.
//
// vNF NÃO muda: em 2026 os valores de IBS/CBS não entram no total do ICMSTot
// (seriam "por fora", mas a regra de transição manda não somar). O total com os
// novos tributos vai no campo próprio <vNFTot>, irmão de <IBSCBSTot> dentro de
// <total>. Isso mantém vNF = somatório dos pagamentos (vPag) e evita quebrar o
// fechamento do caixa/PDV.
//
// Liga/desliga: opt-in por hotel via nf_hotel_config.nfce_ibs_cbs_enabled
// (NFCeConfig.ibs_cbs_enabled), com kill switch por env var — NFCE_IBSCBS=0
// desliga para todos os hotéis sem depender de acesso ao banco, NFCE_IBSCBS=1
// liga para todos. Ver ibsCbsEnabled() abaixo.

// Alíquotas de transição 2026 (mesmas para todo item, período de teste da
// reforma). Usadas como fallback quando o item (produto/prato/serviço) não
// tem ibs_aliquota/cbs_aliquota próprios cadastrados — ver
// ibs_cbs_reform_fields e ibs_cbs_aliquotas migrations.
const DEFAULT_IBS_UF_RATE = 0.10; // 0,1% IBS estadual (teste 2026)
const DEFAULT_IBS_MUN_RATE = 0.00; // 0% IBS municipal (teste 2026)
const DEFAULT_CBS_RATE = 0.90;    // 0,9% CBS federal (teste 2026)

function ibsCbsEnabled(config: { ibs_cbs_enabled?: boolean }): boolean {
  if (process.env.NFCE_IBSCBS === '0') return false; // kill switch global
  if (process.env.NFCE_IBSCBS === '1') return true;  // força ligado (testes)
  return !!config.ibs_cbs_enabled;
}

interface IBSCBSItemResult {
  xml: string;
  vIBSUF: number;
  vIBSMun: number;
  vIBS: number;
  vCBS: number;
  vBC: number;
}

function buildIBSCBSItem(item: NFCeItem, crt: number, enabled: boolean): IBSCBSItemResult {
  // CRT 1/2/4 (Simples Nacional/MEI): adiado para Jan/2027
  if (!enabled || crt !== 3) return { xml: '', vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0, vBC: 0 };

  const cstIbsCbs = item.ibs_cbs_cst || '000';
  const cClassTrib = item.ibs_cbs_cClassTrib || '000003';
  const vBC = item.vProd;
  // ibs_aliquota do item é o total (IBS UF+Mun); enquanto a parcela municipal
  // de teste é 0%, tratamos o valor cadastrado como 100% estadual.
  const ibsUfRate = item.ibs_aliquota ?? DEFAULT_IBS_UF_RATE;
  const ibsMunRate = DEFAULT_IBS_MUN_RATE;
  const cbsRate = item.cbs_aliquota ?? DEFAULT_CBS_RATE;
  const vIBSUF = +(vBC * ibsUfRate / 100).toFixed(2);
  const vIBSMun = +(vBC * ibsMunRate / 100).toFixed(2);
  const vIBS = +(vIBSUF + vIBSMun).toFixed(2);
  const vCBS = +(vBC * cbsRate / 100).toFixed(2);

  const xml =
    `<IBSCBS>` +
    `<CST>${cstIbsCbs}</CST>` +
    `<cClassTrib>${cClassTrib}</cClassTrib>` +
    `<gIBSCBS>` +
    `<vBC>${fmtDec(vBC)}</vBC>` +
    `<gIBSUF>` +
    `<pIBSUF>${fmtDec(ibsUfRate, 4)}</pIBSUF>` +
    `<vIBSUF>${fmtDec(vIBSUF)}</vIBSUF>` +
    `</gIBSUF>` +
    `<gIBSMun>` +
    `<pIBSMun>${fmtDec(ibsMunRate, 4)}</pIBSMun>` +
    `<vIBSMun>${fmtDec(vIBSMun)}</vIBSMun>` +
    `</gIBSMun>` +
    `<vIBS>${fmtDec(vIBS)}</vIBS>` +
    `<gCBS>` +
    `<pCBS>${fmtDec(cbsRate, 4)}</pCBS>` +
    `<vCBS>${fmtDec(vCBS)}</vCBS>` +
    `</gCBS>` +
    `</gIBSCBS>` +
    `</IBSCBS>`;

  return { xml, vIBSUF, vIBSMun, vIBS, vCBS, vBC };
}

// Grupo W03 (total/IBSCBSTot). Aninhamento obrigatório pelo leiaute:
//   IBSCBSTot › vBCIBSCBS
//             › gIBS › gIBSUF (vDif, vDevTrib, vIBSUF)
//                    › gIBSMun (vDif, vDevTrib, vIBSMun)
//                    › vIBS, vCredPres, vCredPresCondSus
//             › gCBS (vDif, vDevTrib, vCBS, vCredPres, vCredPresCondSus)
// Os totalizadores têm de ser a soma exata dos itens: divergência de
// arredondamento aqui rejeita a nota inteira, por isso os valores vêm
// acumulados item a item (já arredondados) e não recalculados sobre o total.
function buildIBSCBSTot(totalVBC: number, totalVIBSUF: number, totalVIBSMun: number, totalVCBS: number): string {
  const totalVIBS = +(totalVIBSUF + totalVIBSMun).toFixed(2);
  if (totalVBC === 0 && totalVIBS === 0 && totalVCBS === 0) return '';
  return (
    `<IBSCBSTot>` +
    `<vBCIBSCBS>${fmtDec(totalVBC)}</vBCIBSCBS>` +
    `<gIBS>` +
    `<gIBSUF>` +
    `<vDif>0.00</vDif>` +
    `<vDevTrib>0.00</vDevTrib>` +
    `<vIBSUF>${fmtDec(totalVIBSUF)}</vIBSUF>` +
    `</gIBSUF>` +
    `<gIBSMun>` +
    `<vDif>0.00</vDif>` +
    `<vDevTrib>0.00</vDevTrib>` +
    `<vIBSMun>${fmtDec(totalVIBSMun)}</vIBSMun>` +
    `</gIBSMun>` +
    `<vIBS>${fmtDec(totalVIBS)}</vIBS>` +
    `<vCredPres>0.00</vCredPres>` +
    `<vCredPresCondSus>0.00</vCredPresCondSus>` +
    `</gIBS>` +
    `<gCBS>` +
    `<vDif>0.00</vDif>` +
    `<vDevTrib>0.00</vDevTrib>` +
    `<vCBS>${fmtDec(totalVCBS)}</vCBS>` +
    `<vCredPres>0.00</vCredPres>` +
    `<vCredPresCondSus>0.00</vCredPresCondSus>` +
    `</gCBS>` +
    `</IBSCBSTot>`
  );
}

// <vNFTot> — "Valor total da NF-e com IBS/CBS/IS", irmão de <IBSCBSTot> dentro
// de <total> e último elemento do grupo. Só é emitido quando existe IBS/CBS na
// nota; sem os novos tributos o campo não se aplica e vNF já é o total.
function buildVNFTot(vNF: number, totalVIBS: number, totalVCBS: number): string {
  if (totalVIBS === 0 && totalVCBS === 0) return '';
  return `<vNFTot>${fmtDec(vNF + totalVIBS + totalVCBS)}</vNFTot>`;
}

// ── Montar XML da NFC-e ─────────────────────────────────────────────────────

// Exportado para permitir validar a estrutura do XML (grupos da Reforma
// Tributaria, totais) sem certificado e sem chamar a SEFAZ.
export function buildNFCeXml(params: {
  emitente: NFCeEmitente;
  destinatario: NFCeDestinatario;
  items: NFCeItem[];
  config: NFCeConfig;
  nNF: number;
  tPag: string;
  pagamentos?: { tPag: string; vPag: number }[];
  acrescimo?: number;
  taxaNaBaseIcms?: boolean;
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

  // Acréscimo (ex.: taxa de serviço) → vOutro distribuído proporcionalmente
  // entre os produtos. A soma dos vOutro dos itens tem que bater com o total.
  const isRegimeNormal = emitente.crt === 3;
  const taxaNaBase = !!params.taxaNaBaseIcms && isRegimeNormal;
  const vProdTotal = items.reduce((s, it) => s + it.vProd, 0);
  const vOutroTotal = Math.round((params.acrescimo || 0) * 100) / 100;
  const vOutroItem: number[] = [];
  {
    let acc = 0;
    items.forEach((it, idx) => {
      const v = (vOutroTotal > 0 && vProdTotal > 0)
        ? (idx === items.length - 1
            ? Math.round((vOutroTotal - acc) * 100) / 100
            : Math.round((vOutroTotal * it.vProd / vProdTotal) * 100) / 100)
        : 0;
      acc = Math.round((acc + v) * 100) / 100;
      vOutroItem[idx] = v;
    });
  }

  // Totais (acumulados no loop de itens)
  let vProd = 0;
  let vICMS = 0;
  let vBC = 0;
  let vOutroSum = 0;

  // QR Code
  const qrCodeUrl = buildQRCodeUrl({
    chave, tpAmb, ambiente: config.ambiente,
  });

  // det (items)
  let detXml = '';
  let totIBSUF = 0, totIBSMun = 0, totIBS = 0, totCBS = 0, totBCIBSCBS = 0;
  const ibsCbsOn = ibsCbsEnabled(config);
  let totPIS = 0, totCOFINS = 0;
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const vOutro_i = vOutroItem[idx] || 0;
    vOutroSum = Math.round((vOutroSum + vOutro_i) * 100) / 100;
    vProd += it.vProd;
    // Base do ICMS: inclui o acréscimo (vOutro) só se configurado e regime normal
    const baseVBC = it.icms_vBC ?? it.vProd;
    const vBC_i = taxaNaBase ? Math.round((baseVBC + vOutro_i) * 100) / 100 : baseVBC;
    const pICMS_i = it.icms_pICMS ?? 0;
    const vICMS_i = taxaNaBase ? Math.round(vBC_i * pICMS_i) / 100 : (it.icms_vICMS ?? 0);
    vBC += vBC_i;
    vICMS += vICMS_i;
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
          `<modBC>0</modBC><vBC>${fmtDec(vBC_i)}</vBC>` +
          `<pICMS>${fmtDec(pICMS_i)}</pICMS>` +
          `<vICMS>${fmtDec(vICMS_i)}</vICMS></ICMS00>`;
      } else if (cst === '40' || cst === '41' || cst === '50') {
        icmsXml = `<ICMS40><orig>${it.icms_orig}</orig><CST>${cst}</CST></ICMS40>`;
      } else if (cst === '60') {
        icmsXml = `<ICMS60><orig>${it.icms_orig}</orig><CST>60</CST></ICMS60>`;
      } else {
        icmsXml = `<ICMS00><orig>${it.icms_orig}</orig><CST>${cst}</CST>` +
          `<modBC>0</modBC><vBC>${fmtDec(vBC_i)}</vBC>` +
          `<pICMS>${fmtDec(pICMS_i)}</pICMS>` +
          `<vICMS>${fmtDec(vICMS_i)}</vICMS></ICMS00>`;
      }
    }

    const ibsCbs = buildIBSCBSItem(it, emitente.crt, ibsCbsOn);
    totIBSUF += ibsCbs.vIBSUF;
    totIBSMun += ibsCbs.vIBSMun;
    totIBS += ibsCbs.vIBS;
    totCBS += ibsCbs.vCBS;
    totBCIBSCBS += ibsCbs.vBC;

    detXml +=
      `<det nItem="${it.nItem}">` +
      `<prod>` +
      `<cProd>${xmlEsc(it.cProd)}</cProd>` +
      `<cEAN>SEM GTIN</cEAN>` +
      `<xProd>${xmlEsc(tpAmb === '2' && it.nItem === 1 ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : sanitizeXProd(it.xProd))}</xProd>` +
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
      (vOutro_i > 0 ? `<vOutro>${fmtDec(vOutro_i)}</vOutro>` : '') +
      `<indTot>1</indTot>` +
      `</prod>` +
      `<imposto>` +
      `<ICMS>${icmsXml}</ICMS>` +
      buildPisCofins('PIS', it.vProd, it.pis_cst, it.pis_aliquota) +
      buildPisCofins('COFINS', it.vProd, it.cofins_cst, it.cofins_aliquota) +
      ibsCbs.xml +
      `</imposto>` +
      `</det>`;

    if ((it.pis_cst === '01' || it.pis_cst === '02') && (it.pis_aliquota ?? 0) > 0)
      totPIS = Math.round(totPIS * 100 + (Math.round(it.vProd * 100) / 100) * (it.pis_aliquota ?? 0)) / 100;
    if ((it.cofins_cst === '01' || it.cofins_cst === '02') && (it.cofins_aliquota ?? 0) > 0)
      totCOFINS = Math.round(totCOFINS * 100 + (Math.round(it.vProd * 100) / 100) * (it.cofins_aliquota ?? 0)) / 100;
  }

  // dest (optional for NFC-e)
  let destXml = '';
  if (destinatario.cpf_cnpj) {
    const docLimpo = destinatario.cpf_cnpj.replace(/\D/g, '');
    const isCnpj = destinatario.doc_tipo === 'cnpj' || docLimpo.length === 14;
    const isEstrangeiro = destinatario.doc_tipo === 'passaporte';
    if (isEstrangeiro) {
      const idEst = destinatario.cpf_cnpj.trim().substring(0, 20);
      destXml = '<dest>';
      destXml += `<idEstrangeiro>${xmlEsc(idEst)}</idEstrangeiro>`;
      if (destinatario.nome) destXml += `<xNome>${xmlEsc(destinatario.nome)}</xNome>`;
      destXml += '<indIEDest>9</indIEDest>';
      destXml += '</dest>';
    } else if ((isCnpj && docLimpo.length === 14) || (!isCnpj && docLimpo.length === 11)) {
      destXml = '<dest>';
      destXml += isCnpj ? `<CNPJ>${docLimpo}</CNPJ>` : `<CPF>${docLimpo}</CPF>`;
      if (destinatario.nome) destXml += `<xNome>${xmlEsc(destinatario.nome)}</xNome>`;
      destXml += '<indIEDest>9</indIEDest>';
      destXml += '</dest>';
    }
  }

  // Formas de pagamento: uma ou várias (grupo <pag> com N <detPag>)
  const totalNota = +(vProd + vOutroSum).toFixed(2);
  const pagList = (params.pagamentos && params.pagamentos.length > 0)
    ? params.pagamentos
    : [{ tPag, vPag: totalNota }];
  const pagXml = `<pag>` +
    pagList.map(buildDetPag).join('') +
    `</pag>`;

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
    `<vPIS>${fmtDec(totPIS)}</vPIS>` +
    `<vCOFINS>${fmtDec(totCOFINS)}</vCOFINS>` +
    `<vOutro>${fmtDec(vOutroSum)}</vOutro>` +
    `<vNF>${fmtDec(vProd + vOutroSum)}</vNF>` +
    `</ICMSTot>` +
    buildIBSCBSTot(totBCIBSCBS, totIBSUF, totIBSMun, totCBS) +
    buildVNFTot(vProd + vOutroSum, totIBS, totCBS) +
    `</total>` +
    `<transp><modFrete>9</modFrete></transp>` +
    pagXml +
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
  pagamentos?: { tPag: string; vPag: number }[];
  acrescimo?: number;
  taxaNaBaseIcms?: boolean;
}): Promise<NFCeResult> {
  const tPag = params.tPag || '01'; // 01=dinheiro default

  // 1. Build XML
  const { xml: nfeUnsigned, chave, qrCodeUrl } = buildNFCeXml({ ...params, tPag });

  // 2. Sign
  const nfeId = `NFe${chave}`;
  const { key, cert } = extractPemFromPfx(params.config.certificado_base64, params.config.certificado_senha);
  const nfeSigned = signNFe(nfeUnsigned, nfeId, key, cert);

  // 2b. Inserir infNFeSupl (QR-Code + urlChave) entre infNFe e Signature.
  // Ordem do schema NFe: infNFe → infNFeSupl → Signature. O infNFeSupl NÃO é
  // assinado (fora da Reference), então inserir após a assinatura é seguro.
  const urlChave = CONSULTA_URLS[params.config.ambiente];
  const infNFeSupl =
    `<infNFeSupl>` +
    `<qrCode>${qrCodeUrl}</qrCode>` +
    `<urlChave>${urlChave}</urlChave>` +
    `</infNFeSupl>`;
  const nfeComSupl = nfeSigned.replace('<Signature', infNFeSupl + '<Signature');

  // 3. Build enviNFe (synchronous, indSinc=1)
  const idLote = Date.now().toString().slice(-15);
  const enviNFe =
    `<enviNFe xmlns="${NFE_NS}" versao="4.00">` +
    `<idLote>${idLote}</idLote>` +
    `<indSinc>1</indSinc>` +
    nfeComSupl +
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
      xml_enviado: nfeComSupl,
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
        xml_enviado: nfeComSupl,
        message: `NFC-e ${params.nNF} autorizada. Protocolo: ${innerProt}`,
      };
    }

    return {
      success: false, numero_nf: null, serie: null, chave_acesso: chave,
      numero_protocolo: null, codigo_verificacao: null,
      qrcode_url: null, url_consulta: null,
      xml_retorno: body,
      xml_enviado: nfeComSupl,
      message: `Rejeição ${innerStat}: ${innerMotivo}`,
    };
  }

  return {
    success: false, numero_nf: null, serie: null, chave_acesso: chave,
    numero_protocolo: null, codigo_verificacao: null,
    qrcode_url: null, url_consulta: null,
    xml_retorno: body,
    xml_enviado: nfeComSupl,
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
  doc_tipo: 'cpf' | 'cnpj' | 'passaporte';
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
  ibs_cbs_enabled?: boolean; // nf_hotel_config.nfce_ibs_cbs_enabled (opt-in por hotel)
}

export function buildNFeXml(params: {
  emitente: NFCeEmitente;
  destinatario: NFeDestinatario;
  items: NFCeItem[];
  config: NFeConfig;
  nNF: number;
  natOp: string;
  tPag: string;
  pagamentos?: { tPag: string; vPag: number }[];
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
  let totIBSUF = 0, totIBSMun = 0, totIBS = 0, totCBS = 0, totBCIBSCBS = 0;
  const ibsCbsOn = ibsCbsEnabled(config);
  for (const it of items) {
    const vOutro_i = 0; // NF-e (modelo 55) não usa acréscimo de taxa de serviço
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

    const ibsCbs = buildIBSCBSItem(it, emitente.crt, ibsCbsOn);
    totIBSUF += ibsCbs.vIBSUF;
    totIBSMun += ibsCbs.vIBSMun;
    totIBS += ibsCbs.vIBS;
    totCBS += ibsCbs.vCBS;
    totBCIBSCBS += ibsCbs.vBC;

    detXml +=
      `<det nItem="${it.nItem}">` +
      `<prod>` +
      `<cProd>${xmlEsc(it.cProd)}</cProd>` +
      `<cEAN>SEM GTIN</cEAN>` +
      `<xProd>${xmlEsc(tpAmb === '2' && it.nItem === 1 ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : sanitizeXProd(it.xProd))}</xProd>` +
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
      (vOutro_i > 0 ? `<vOutro>${fmtDec(vOutro_i)}</vOutro>` : '') +
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
  const isCnpj = destinatario.doc_tipo === 'cnpj' || docLimpo.length === 14;
  const isEstrangeiro55 = destinatario.doc_tipo === 'passaporte';
  let destXml = '<dest>';
  if (isEstrangeiro55) {
    const idEst = destinatario.cpf_cnpj.trim().substring(0, 20);
    destXml += `<idEstrangeiro>${xmlEsc(idEst)}</idEstrangeiro>`;
  } else {
    destXml += isCnpj ? `<CNPJ>${docLimpo}</CNPJ>` : `<CPF>${docLimpo}</CPF>`;
  }
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

  // Formas de pagamento (grupo <pag> com N <detPag>)
  const pagListNfe = (params.pagamentos && params.pagamentos.length > 0)
    ? params.pagamentos
    : [{ tPag, vPag: +vProd.toFixed(2) }];
  const pagXmlNfe = `<pag>` +
    pagListNfe.map(buildDetPag).join('') +
    `</pag>`;

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
    buildIBSCBSTot(totBCIBSCBS, totIBSUF, totIBSMun, totCBS) +
    buildVNFTot(vProd, totIBS, totCBS) +
    `</total>` +
    `<transp><modFrete>9</modFrete></transp>` +
    pagXmlNfe +
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
  pagamentos?: { tPag: string; vPag: number }[];
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
      xml_enviado: nfeSigned,
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
        xml_enviado: nfeSigned,
        message: `NF-e ${params.nNF} autorizada. Protocolo: ${innerProt}`,
      };
    }

    return {
      success: false, numero_nf: null, serie: null, chave_acesso: chave,
      numero_protocolo: null, codigo_verificacao: null,
      qrcode_url: null, url_consulta: null,
      xml_retorno: body,
      xml_enviado: nfeSigned,
      message: `Rejeição ${innerStat}: ${innerMotivo}`,
    };
  }

  return {
    success: false, numero_nf: null, serie: null, chave_acesso: chave,
    numero_protocolo: null, codigo_verificacao: null,
    qrcode_url: null, url_consulta: null,
    xml_retorno: body,
    xml_enviado: nfeSigned,
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
