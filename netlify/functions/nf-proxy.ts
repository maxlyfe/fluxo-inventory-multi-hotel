// netlify/functions/nf-proxy.ts
// Proxy server-side para emissão de NF-e (SEFAZ-RJ) e NFS-e (Prefeitura Búzios)
// STUB: retorna respostas simuladas enquanto a integração real não é implementada

import type { Handler, HandlerEvent } from '@netlify/functions';

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

  const action = (event.headers['x-nf-action'] || '').toLowerCase();

  if (!action) {
    return jsonResponse(400, { error: 'Header x-nf-action ausente' });
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

  return jsonResponse(400, { error: `Ação desconhecida: ${action}` });
};

export { handler };
