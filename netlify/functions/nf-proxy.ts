// netlify/functions/nf-proxy.ts
// Proxy server-side para emissão de NF-e (SEFAZ-RJ) e NFS-e (Prefeitura Búzios)
// STUB: retorna respostas simuladas enquanto a integração real não é implementada

import type { Handler, HandlerEvent } from '@netlify/functions';
import https from 'https';
import zlib from 'zlib';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type',
    'x-nf-action',
  ].join(', '),
};

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function generateMockNFNumber() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

function generateMockKey() {
  let key = '';
  for (let i = 0; i < 44; i++) key += Math.floor(Math.random() * 10);
  return key;
}

// ─── Distribuição DF-e (consulta de NF-e emitidas contra o CNPJ) ─────────────
// Serviço NFeDistribuicaoDFe do Ambiente Nacional. Autenticação por TLS mútuo
// com o certificado A1 (.pfx) — não requer assinatura de XML nem CSC.

const DFE_HOSTS = {
  producao: 'www1.nfe.fazenda.gov.br',
  homologacao: 'hom1.nfe.fazenda.gov.br',
} as const;

interface DFeDoc {
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

async function consultaDFe(params: {
  certificado_base64: string;
  certificado_senha: string;
  cnpj: string;
  ambiente: 'producao' | 'homologacao';
  ultNSU: string;
}): Promise<{ cStat: string; xMotivo: string; ultNSU: string; maxNSU: string; docs: DFeDoc[] }> {
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

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Método não permitido' });
  }

  // Ler action do header OU do body (fallback — CDN pode remover headers custom)
  let action = (event.headers['x-nf-action'] || '').toLowerCase();

  if (!action && event.body) {
    try {
      const parsed = JSON.parse(event.body);
      action = (parsed.action || '').toLowerCase();
    } catch {
      // body não é JSON válido — ignorar
    }
  }

  if (!action) {
    return jsonResponse(400, {
      error: 'Header x-nf-action ausente e campo "action" não encontrado no body',
      debug: {
        receivedHeaders: Object.keys(event.headers),
        hasBody: !!event.body,
      },
    });
  }

  // ─── Test Connection (stub) ──────────────────────────────────────────────

  if (action === 'test-nfse') {
    return jsonResponse(200, {
      success: true,
      message: '[STUB] Conexão com Prefeitura de Búzios simulada com sucesso. Integração real pendente.',
    });
  }

  if (action === 'test-nfe') {
    return jsonResponse(200, {
      success: true,
      message: '[STUB] Conexão com SEFAZ-RJ simulada com sucesso. Integração real pendente.',
    });
  }

  // ─── Emit Invoice (stub) ─────────────────────────────────────────────────

  if (action === 'emit') {
    const mockNumber = generateMockNFNumber();
    const mockKey = generateMockKey();
    const mockProtocol = `${Date.now()}`;

    return jsonResponse(200, {
      success: true,
      numero_nf: mockNumber,
      serie: '1',
      chave_acesso: mockKey,
      numero_protocolo: mockProtocol,
      codigo_verificacao: mockKey.substring(0, 8),
      xml_retorno: `<nf_stub>autorizada numero="${mockNumber}"</nf_stub>`,
      pdf_url: null,
      message: `[STUB] Nota fiscal ${mockNumber} autorizada (simulação). Integração real pendente.`,
    });
  }

  // ─── Contingência (stub — RPS para NFS-e, EPEC para NF-e) ────────────────

  if (action === 'contingencia') {
    const rpsNumber = `RPS-${Date.now().toString().slice(-8)}`;
    return jsonResponse(200, {
      success: true,
      numero_rps: rpsNumber,
      contingencia_protocolo: `CONT-${Date.now()}`,
      message: `[STUB] Nota emitida em contingência (${rpsNumber}). Retransmissão automática pendente.`,
    });
  }

  // ─── Emit NFC-e (stub — modelo 65, QR Code) ──────────────────────────────

  if (action === 'emit-nfce') {
    const mockNumber = generateMockNFNumber();
    const mockKey = generateMockKey();
    const mockProtocol = `${Date.now()}`;
    const qrCode = `https://www.nfce.fazenda.rj.gov.br/consulta?chave=${mockKey}`;

    return jsonResponse(200, {
      success: true,
      numero_nf: mockNumber,
      serie: '1',
      chave_acesso: mockKey,
      numero_protocolo: mockProtocol,
      codigo_verificacao: mockKey.substring(0, 8),
      qrcode_url: qrCode,
      url_consulta: 'https://www.nfce.fazenda.rj.gov.br/consulta',
      xml_retorno: `<nfce_stub>autorizada numero="${mockNumber}" modelo="65"</nfce_stub>`,
      pdf_url: null,
      message: `[STUB] NFC-e ${mockNumber} autorizada (simulação). Integração real pendente.`,
    });
  }

  // ─── Cancel Invoice (stub) ───────────────────────────────────────────────

  if (action === 'cancel') {
    return jsonResponse(200, {
      success: true,
      xml_cancelamento: '<cancel_stub>cancelado</cancel_stub>',
      message: '[STUB] Nota fiscal cancelada (simulação). Integração real pendente.',
    });
  }

  // ─── Consulta DF-e (NF-e emitidas contra o CNPJ — integração real) ────────

  if (action === 'dfe-consulta') {
    let payload: {
      certificado_base64?: string;
      certificado_senha?: string;
      cnpj?: string;
      ambiente?: string;
      ultNSU?: string;
    };
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Body JSON inválido' });
    }

    if (!payload.certificado_base64 || !payload.certificado_senha) {
      return jsonResponse(400, { error: 'Certificado digital A1 e senha são obrigatórios para a consulta.' });
    }
    if (!payload.cnpj || payload.cnpj.replace(/\D/g, '').length !== 14) {
      return jsonResponse(400, { error: 'CNPJ da empresa inválido ou ausente.' });
    }

    try {
      const result = await consultaDFe({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        cnpj: payload.cnpj,
        ambiente: payload.ambiente === 'homologacao' ? 'homologacao' : 'producao',
        ultNSU: payload.ultNSU || '0',
      });

      // cStat: 137 = nenhum documento novo; 138 = documentos localizados
      const ok = result.cStat === '137' || result.cStat === '138';
      return jsonResponse(ok ? 200 : 502, {
        success: ok,
        cStat: result.cStat,
        message: result.xMotivo,
        ultNSU: result.ultNSU,
        maxNSU: result.maxNSU,
        hasMore: ok && result.ultNSU < result.maxNSU,
        docs: result.docs,
        error: ok ? undefined : `SEFAZ: ${result.cStat} — ${result.xMotivo}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      const friendly = /mac verify|invalid password|pkcs/i.test(msg)
        ? 'Senha do certificado incorreta ou arquivo .pfx inválido.'
        : msg;
      return jsonResponse(502, { error: `Falha na consulta à SEFAZ: ${friendly}` });
    }
  }

  return jsonResponse(400, { error: `Ação desconhecida: ${action}` });
};

export { handler };
