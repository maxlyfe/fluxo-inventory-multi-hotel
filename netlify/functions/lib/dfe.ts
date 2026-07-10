// netlify/functions/lib/dfe.ts
// Consulta à Distribuição DF-e do Ambiente Nacional (NFeDistribuicaoDFe).
// Autenticação por TLS mútuo com o certificado A1 (.pfx) — sem assinatura de
// XML nem CSC. Compartilhado entre nf-proxy (consulta manual) e nf-dfe-sync
// (job agendado).

import https from 'https';
import zlib from 'zlib';

const DFE_HOSTS = {
  producao: 'www1.nfe.fazenda.gov.br',
  homologacao: 'hom1.nfe.fazenda.gov.br',
} as const;

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
