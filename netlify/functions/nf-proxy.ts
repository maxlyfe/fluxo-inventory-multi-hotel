// netlify/functions/nf-proxy.ts
// Proxy server-side para emissão de NF-e (SEFAZ-RJ) e NFS-e (Prefeitura Búzios)
// STUB: retorna respostas simuladas enquanto a integração real não é implementada

import type { Handler, HandlerEvent } from '@netlify/functions';
import { consultaDFe } from './lib/dfe';

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
