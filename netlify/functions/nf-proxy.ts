// netlify/functions/nf-proxy.ts
// Proxy server-side para emissão de NF-e (SEFAZ-RJ), NFS-e (Prefeitura Búzios)
// e NFS-e via ADN (Governo Federal / Receita Federal / Serpro).

import type { Handler, HandlerEvent } from '@netlify/functions';
import { consultaDFe, manifestarNFe } from './lib/dfe';
import type { TipoManifestacao } from './lib/dfe';
import {
  emitirDPS,
  consultarNFSe,
  registrarEvento,
  buscarDANFSE,
  testarConexaoADN,
  buildDPS,
  type DPSConfig,
  type DPSTomador,
  type DPSItem,
} from './lib/adn-nfse';

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

  // ─── Manifestação do Destinatário ─────────────────────────────────────────

  if (action === 'dfe-manifestar') {
    let payload: {
      certificado_base64?: string;
      certificado_senha?: string;
      cnpj?: string;
      chaveAcesso?: string;
      tipoEvento?: string;
      nSeqEvento?: string;
      xJust?: string;
      ambiente?: string;
    };
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Body JSON inválido' });
    }

    if (!payload.certificado_base64 || !payload.certificado_senha) {
      return jsonResponse(400, { error: 'Certificado digital A1 e senha são obrigatórios.' });
    }
    if (!payload.cnpj || payload.cnpj.replace(/\D/g, '').length !== 14) {
      return jsonResponse(400, { error: 'CNPJ inválido ou ausente.' });
    }
    if (!payload.chaveAcesso || payload.chaveAcesso.replace(/\D/g, '').length !== 44) {
      return jsonResponse(400, { error: 'Chave de acesso inválida (deve ter 44 dígitos).' });
    }
    const validEvents = ['210210', '210200', '210220', '210240'];
    if (!payload.tipoEvento || !validEvents.includes(payload.tipoEvento)) {
      return jsonResponse(400, { error: 'Tipo de evento inválido.' });
    }
    if (payload.tipoEvento === '210240' && !payload.xJust) {
      return jsonResponse(400, { error: 'Justificativa obrigatória para Operação não Realizada.' });
    }

    try {
      const result = await manifestarNFe({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        cnpj: payload.cnpj,
        chNFe: payload.chaveAcesso,
        tpEvento: payload.tipoEvento as TipoManifestacao,
        nSeqEvento: payload.nSeqEvento,
        xJust: payload.xJust,
        ambiente: payload.ambiente === 'homologacao' ? 'homologacao' : 'producao',
      });

      const ok = result.cStat === '135' || result.cStat === '573';
      return jsonResponse(ok ? 200 : 502, {
        success: ok,
        cStat: result.cStat,
        message: result.xMotivo,
        nProt: result.nProt,
        error: ok ? undefined : `SEFAZ: ${result.cStat} — ${result.xMotivo}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      const friendly = /mac verify|invalid password|pkcs/i.test(msg)
        ? 'Senha do certificado incorreta ou arquivo .pfx inválido.'
        : msg;
      return jsonResponse(502, { error: `Falha na manifestação: ${friendly}` });
    }
  }

  // ─── ADN: Teste de Conexão ─────────────────────────────────────────────────

  if (action === 'test-nfse-adn') {
    let payload: {
      certificado_base64?: string;
      certificado_senha?: string;
      ambiente?: string;
    };
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Body JSON inválido' });
    }

    if (!payload.certificado_base64 || !payload.certificado_senha) {
      return jsonResponse(400, { error: 'Certificado digital A1 e senha são obrigatórios.' });
    }

    const result = await testarConexaoADN({
      certificado_base64: payload.certificado_base64,
      certificado_senha: payload.certificado_senha,
      ambiente: payload.ambiente === 'producao' ? 'producao' : 'homologacao',
    });

    return jsonResponse(result.success ? 200 : 502, {
      success: result.success,
      message: result.mensagem,
    });
  }

  // ─── ADN: Emissão de NFS-e (DPS) ─────────────────────────────────────────

  if (action === 'emit-nfse-adn') {
    let payload: {
      certificado_base64?: string;
      certificado_senha?: string;
      ambiente?: string;
      config?: DPSConfig;
      tomador?: DPSTomador;
      items?: DPSItem[];
      serie?: string;
      numeroDPS?: number;
    };
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Body JSON inválido' });
    }

    if (!payload.certificado_base64 || !payload.certificado_senha) {
      return jsonResponse(400, { error: 'Certificado digital A1 e senha são obrigatórios.' });
    }
    if (!payload.config || !payload.tomador || !payload.items?.length) {
      return jsonResponse(400, { error: 'config, tomador e items são obrigatórios.' });
    }

    const ambiente = payload.ambiente === 'producao' ? 'producao' as const : 'homologacao' as const;

    try {
      const dps = buildDPS(
        payload.config,
        payload.tomador,
        payload.items,
        payload.serie || 'NFS',
        payload.numeroDPS || 1,
        ambiente,
      );

      const result = await emitirDPS({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        dps,
        ambiente,
      });

      return jsonResponse(result.success ? 200 : 502, {
        success: result.success,
        numero_nf: result.numeroNFSe,
        chave_acesso: result.chaveAcesso,
        numero_protocolo: result.protocolo,
        codigo_verificacao: result.codigoVerificacao,
        xml_retorno: result.xmlRetorno,
        xml_dps: JSON.stringify(dps),
        message: result.mensagem,
        error: result.success ? undefined : result.mensagem,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      const friendly = /mac verify|invalid password|pkcs/i.test(msg)
        ? 'Senha do certificado incorreta ou arquivo .pfx inválido.'
        : msg;
      return jsonResponse(502, { error: `Falha na emissão ADN: ${friendly}` });
    }
  }

  // ─── ADN: Cancelamento de NFS-e ───────────────────────────────────────────

  if (action === 'cancel-nfse-adn') {
    let payload: {
      certificado_base64?: string;
      certificado_senha?: string;
      chaveAcesso?: string;
      motivo?: string;
      codigoCancelamento?: string;
      ambiente?: string;
    };
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Body JSON inválido' });
    }

    if (!payload.certificado_base64 || !payload.certificado_senha) {
      return jsonResponse(400, { error: 'Certificado digital A1 e senha são obrigatórios.' });
    }
    if (!payload.chaveAcesso) {
      return jsonResponse(400, { error: 'Chave de acesso da NFS-e é obrigatória.' });
    }
    if (!payload.motivo) {
      return jsonResponse(400, { error: 'Motivo do cancelamento é obrigatório.' });
    }

    try {
      const result = await registrarEvento({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        chaveAcesso: payload.chaveAcesso,
        tipoEvento: 'cancelamento',
        codigoCancelamento: payload.codigoCancelamento,
        motivo: payload.motivo,
        ambiente: payload.ambiente === 'producao' ? 'producao' : 'homologacao',
      });

      return jsonResponse(result.success ? 200 : 502, {
        success: result.success,
        protocolo: result.protocolo,
        message: result.mensagem,
        xml_cancelamento: result.success ? JSON.stringify({ protocolo: result.protocolo }) : undefined,
        error: result.success ? undefined : result.mensagem,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      return jsonResponse(502, { error: `Falha no cancelamento ADN: ${msg}` });
    }
  }

  // ─── ADN: Consulta NFS-e por chave ────────────────────────────────────────

  if (action === 'consulta-nfse-adn') {
    let payload: {
      certificado_base64?: string;
      certificado_senha?: string;
      chaveAcesso?: string;
      ambiente?: string;
    };
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Body JSON inválido' });
    }

    if (!payload.certificado_base64 || !payload.certificado_senha) {
      return jsonResponse(400, { error: 'Certificado digital A1 e senha são obrigatórios.' });
    }
    if (!payload.chaveAcesso) {
      return jsonResponse(400, { error: 'Chave de acesso da NFS-e é obrigatória.' });
    }

    try {
      const result = await consultarNFSe({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        chaveAcesso: payload.chaveAcesso,
        ambiente: payload.ambiente === 'producao' ? 'producao' : 'homologacao',
      });

      return jsonResponse(result.success ? 200 : 502, {
        success: result.success,
        data: result.data,
        message: result.mensagem,
        error: result.success ? undefined : result.mensagem,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      return jsonResponse(502, { error: `Falha na consulta ADN: ${msg}` });
    }
  }

  // ─── ADN: Buscar DANFSE (PDF) ─────────────────────────────────────────────

  if (action === 'danfse-adn') {
    let payload: {
      certificado_base64?: string;
      certificado_senha?: string;
      chaveAcesso?: string;
      ambiente?: string;
    };
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Body JSON inválido' });
    }

    if (!payload.certificado_base64 || !payload.certificado_senha) {
      return jsonResponse(400, { error: 'Certificado digital A1 e senha são obrigatórios.' });
    }
    if (!payload.chaveAcesso) {
      return jsonResponse(400, { error: 'Chave de acesso da NFS-e é obrigatória.' });
    }

    try {
      const result = await buscarDANFSE({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        chaveAcesso: payload.chaveAcesso,
        ambiente: payload.ambiente === 'producao' ? 'producao' : 'homologacao',
      });

      return jsonResponse(result.success ? 200 : 502, {
        success: result.success,
        pdfBase64: result.pdfBase64,
        contentType: result.contentType,
        message: result.mensagem,
        error: result.success ? undefined : result.mensagem,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      return jsonResponse(502, { error: `Falha ao obter DANFSE: ${msg}` });
    }
  }

  return jsonResponse(400, { error: `Ação desconhecida: ${action}` });
};

export { handler };
