// netlify/functions/lib/dfe.ts
// Consulta à Distribuição DF-e do Ambiente Nacional (NFeDistribuicaoDFe).
// Autenticação por TLS mútuo com o certificado A1 (.pfx) — sem assinatura de
// XML nem CSC. Compartilhado entre nf-proxy (consulta manual) e nf-dfe-sync
// (job agendado).

import https from 'https';
import zlib from 'zlib';
import crypto from 'crypto';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

const DFE_HOSTS = {
  producao: 'www1.nfe.fazenda.gov.br',
  homologacao: 'hom1.nfe.fazenda.gov.br',
} as const;

// www1 (mesmo host da Distribuição DF-e): o www.nfe.fazenda.gov.br entrega uma
// cadeia TLS que o runtime do Netlify não valida ("unable to get local issuer
// certificate"); o www1 atende o mesmo serviço com cadeia válida.
const EVENTO_HOSTS = {
  producao: 'www1.nfe.fazenda.gov.br',
  homologacao: 'hom1.nfe.fazenda.gov.br',
} as const;

const EVENTO_DESC: Record<string, string> = {
  '210210': 'Ciencia da Operacao',
  '210200': 'Confirmacao da Operacao',
  '210220': 'Desconhecimento da Operacao',
  '210240': 'Operacao nao Realizada',
};

export type TipoManifestacao = '210210' | '210200' | '210220' | '210240';

export interface ManifestacaoResult {
  cStat: string;
  xMotivo: string;
  nProt: string | null;
  chNFe: string;
  tpEvento: string;
}

export interface DFeDoc {
  nsu: string;
  schema: string;
  tipo: 'resumo' | 'completa';
  xml: string;
  chave_acesso: string | null;
  numero_nf: string | null;
  serie: string | null;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  valor_total: number | null;
  data_emissao: string | null;
}

export interface DFeResult {
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  docs: DFeDoc[];
}

function xmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function httpsPost(options: https.RequestOptions, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('Timeout na comunicação com a SEFAZ')));
    req.write(body);
    req.end();
  });
}

export async function consultaDFe(params: {
  certificado_base64: string;
  certificado_senha: string;
  cnpj: string;
  ambiente: 'producao' | 'homologacao';
  ultNSU: string;
}): Promise<DFeResult> {
  const cnpj = params.cnpj.replace(/\D/g, '');
  const tpAmb = params.ambiente === 'producao' ? '1' : '2';
  const ultNSU = (params.ultNSU || '0').replace(/\D/g, '').padStart(15, '0');

  const distDFeInt =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${tpAmb}</tpAmb><cUFAutor>33</cUFAutor><CNPJ>${cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${ultNSU}</ultNSU></distNSU></distDFeInt>`;

  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
    `<nfeDadosMsg>${distDFeInt}</nfeDadosMsg>` +
    `</nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;

  const res = await httpsPost({
    host: DFE_HOSTS[params.ambiente],
    path: '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    method: 'POST',
    pfx: Buffer.from(params.certificado_base64, 'base64'),
    passphrase: params.certificado_senha,
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
  }, envelope);

  if (res.status !== 200) {
    throw new Error(`SEFAZ respondeu HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }

  const cStat = xmlTag(res.body, 'cStat') ?? '';
  const xMotivo = xmlTag(res.body, 'xMotivo') ?? '';
  const newUltNSU = xmlTag(res.body, 'ultNSU') ?? ultNSU;
  const maxNSU = xmlTag(res.body, 'maxNSU') ?? newUltNSU;

  const docs: DFeDoc[] = [];
  const docZipRe = /<docZip NSU="(\d+)" schema="([^"]+)">([\s\S]*?)<\/docZip>/g;
  let m: RegExpExecArray | null;
  while ((m = docZipRe.exec(res.body)) !== null) {
    const [, nsu, schema, b64] = m;
    let xml: string;
    try {
      xml = zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
    } catch {
      continue; // documento corrompido — ignora
    }

    const isProc = schema.startsWith('procNFe');
    const isRes = schema.startsWith('resNFe');
    if (!isProc && !isRes) continue; // eventos (resEvento/procEvento) não interessam aqui

    let doc: DFeDoc;
    if (isProc) {
      const infNFe = xmlTag(xml, 'infNFe') ?? xml;
      const ide = xmlTag(infNFe, 'ide') ?? '';
      const emit = xmlTag(infNFe, 'emit') ?? '';
      const total = xmlTag(infNFe, 'total') ?? '';
      const chave = (xml.match(/<infNFe[^>]*Id="NFe(\d{44})"/) || [])[1] ?? xmlTag(xml, 'chNFe');
      doc = {
        nsu, schema, tipo: 'completa', xml,
        chave_acesso: chave ?? null,
        numero_nf: xmlTag(ide, 'nNF'),
        serie: xmlTag(ide, 'serie'),
        emitente_nome: xmlTag(emit, 'xNome'),
        emitente_cnpj: xmlTag(emit, 'CNPJ'),
        valor_total: parseFloat(xmlTag(total, 'vNF') ?? '') || null,
        data_emissao: xmlTag(ide, 'dhEmi'),
      };
    } else {
      const chave = xmlTag(xml, 'chNFe');
      doc = {
        nsu, schema, tipo: 'resumo', xml,
        chave_acesso: chave,
        numero_nf: chave ? chave.slice(25, 34).replace(/^0+/, '') : null,
        serie: chave ? chave.slice(22, 25).replace(/^0+/, '') : null,
        emitente_nome: xmlTag(xml, 'xNome'),
        emitente_cnpj: xmlTag(xml, 'CNPJ'),
        valor_total: parseFloat(xmlTag(xml, 'vNF') ?? '') || null,
        data_emissao: xmlTag(xml, 'dhEmi'),
      };
    }
    if (doc.chave_acesso) docs.push(doc);
  }

  return { cStat, xMotivo, ultNSU: newUltNSU, maxNSU, docs };
}

// ─── Manifestação do Destinatário (nfeRecepcaoEvento) ──────────────────────

function extractPemFromPfx(pfxBase64: string, passphrase: string): { key: string; cert: string } {
  const pfxDer = forge.util.decode64(pfxBase64);
  const asn1 = forge.asn1.fromDer(pfxDer);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase);

  let privateKey: forge.pki.rsa.PrivateKey | null = null;
  const certs: forge.pki.Certificate[] = [];

  for (const safeContent of p12.safeContents) {
    for (const bag of safeContent.safeBags) {
      if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag && bag.key) {
        privateKey = bag.key as forge.pki.rsa.PrivateKey;
      } else if (bag.type === forge.pki.oids.certBag && bag.cert) {
        certs.push(bag.cert);
      }
    }
  }

  if (!privateKey || certs.length === 0) {
    throw new Error('Não foi possível extrair chave/certificado do arquivo .pfx');
  }

  // O .pfx traz a cadeia inteira (AC raiz, intermediárias e o certificado da
  // empresa) — seleciona o certificado cuja chave pública casa com a privada.
  const keyModulus = privateKey.n.toString(16);
  const certificate = certs.find(c =>
    (c.publicKey as forge.pki.rsa.PublicKey).n?.toString(16) === keyModulus,
  );
  if (!certificate) {
    throw new Error('Certificado correspondente à chave privada não encontrado no .pfx');
  }

  return {
    key: forge.pki.privateKeyToPem(privateKey),
    cert: forge.pki.certificateToPem(certificate),
  };
}

export async function manifestarNFe(params: {
  certificado_base64: string;
  certificado_senha: string;
  cnpj: string;
  chNFe: string;
  tpEvento: TipoManifestacao;
  nSeqEvento?: string;
  xJust?: string;
  ambiente: 'producao' | 'homologacao';
}): Promise<ManifestacaoResult> {
  const cnpj = params.cnpj.replace(/\D/g, '');
  const tpAmb = params.ambiente === 'producao' ? '1' : '2';
  const nSeq = params.nSeqEvento || '1';
  const eventId = `ID${params.tpEvento}${params.chNFe}${nSeq.padStart(2, '0')}`;
  // Horário de Brasília (UTC-3) no formato exigido: AAAA-MM-DDThh:mm:ss-03:00
  const dhEvento = new Date(Date.now() - 3 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, '-03:00');
  const descEvento = EVENTO_DESC[params.tpEvento];

  let detEventoInner = `<descEvento>${descEvento}</descEvento>`;
  if (params.tpEvento === '210240' && params.xJust) {
    detEventoInner += `<xJust>${params.xJust}</xJust>`;
  }

  const infEventoXml =
    `<infEvento Id="${eventId}">` +
    `<cOrgao>91</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${params.chNFe}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>${params.tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeq}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">${detEventoInner}</detEvento>` +
    `</infEvento>`;

  const eventoUnsigned =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    infEventoXml +
    `</evento>`;

  const { key, cert } = extractPemFromPfx(params.certificado_base64, params.certificado_senha);

  // O schema de assinatura da NF-e exige C14N clássica (não exclusiva)
  const sig = new SignedXml({
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    privateKey: crypto.createPrivateKey(key),
    publicCert: cert,
  });
  sig.addReference({
    xpath: `//*[@Id='${eventId}']`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });
  sig.computeSignature(eventoUnsigned, {
    location: { reference: '//*[local-name()="evento"]', action: 'append' },
  });
  const eventoSigned = sig.getSignedXml();

  const idLote = Date.now().toString();
  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>${idLote}</idLote>` +
    eventoSigned +
    `</envEvento>`;

  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    // Document/literal: o WSDL declara nfeDadosMsg como elemento direto do
    // body (sem wrapper de operação, diferente da Distribuição DF-e).
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${envEvento}</nfeDadosMsg>` +
    `</soap12:Body></soap12:Envelope>`;

  const res = await httpsPost({
    host: EVENTO_HOSTS[params.ambiente],
    path: '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    method: 'POST',
    pfx: Buffer.from(params.certificado_base64, 'base64'),
    passphrase: params.certificado_senha,
    headers: {
      // Este serviço exige o "action" no Content-Type (SOAP 1.2)
      'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEventoNF"',
    },
  }, envelope);

  if (res.status !== 200) {
    throw new Error(`SEFAZ respondeu HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }

  const retEvento = xmlTag(res.body, 'retEvento') ?? res.body;
  const infEvento = xmlTag(retEvento, 'infEvento') ?? retEvento;

  return {
    cStat: xmlTag(infEvento, 'cStat') ?? '',
    xMotivo: xmlTag(infEvento, 'xMotivo') ?? '',
    nProt: xmlTag(infEvento, 'nProt') ?? null,
    chNFe: params.chNFe,
    tpEvento: params.tpEvento,
  };
}
