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
  type DPSConfig,
  type DPSTomador,
  type DPSItem,
} from './lib/adn-nfse';
import {
  emitirNfsePrefeitura,
  cancelarNfsePrefeitura,
  consultarNfsePorRps,
  consultarNfseServicoPrestado,
  consultarNfsePorFaixa,
  recepcionarLoteRpsSincrono,
  substituirNfse,
  testarConexaoPrefeitura,
} from './lib/nfse-prefeitura';
import {
  emitirNFCe,
  cancelarNFCe,
  statusServicoNFCe,
  emitirNFe,
  cancelarNFe,
  statusServicoNFe,
} from './lib/nfce-sefaz';
import {
  emitirNfseELNacional,
  cancelarNfseELNacional,
  consultarNfseELNacional,
} from './lib/el-nacional-nfse';

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

  // ─── Test Connection NFS-e Prefeitura ─────────────────────────────────────

  if (action === 'test-nfse') {
    let payload: { certificado_base64: string; certificado_senha: string; ambiente: string; cnpj?: string; inscricao_municipal?: string };
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    if (!payload.certificado_base64 || !payload.certificado_senha) {
      return jsonResponse(400, { error: 'Certificado e senha são obrigatórios' });
    }

    try {
      const result = await testarConexaoPrefeitura({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        ambiente: (payload.ambiente === 'producao' ? 'producao' : 'homologacao'),
        cnpj: payload.cnpj,
        inscricao_municipal: payload.inscricao_municipal,
      });
      return jsonResponse(200, result);
    } catch (err: any) {
      return jsonResponse(500, { success: false, message: `Erro: ${err.message}` });
    }
  }

  if (action === 'test-nfe') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const { certificado_base64, certificado_senha, ambiente } = payload;
    if (!certificado_base64 || !certificado_senha) {
      return jsonResponse(400, { error: 'Certificado e senha são obrigatórios' });
    }

    const result = await statusServicoNFe({
      certificado_base64,
      certificado_senha,
      ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
    });

    return jsonResponse(200, result);
  }

  // ─── Emit NFS-e Prefeitura (integração real ABRASF 2.02) ────────────────

  if (action === 'emit') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const {
      certificado_base64, certificado_senha, ambiente,
      cnpj, inscricao_municipal,
      tomador_nome, tomador_cpf_cnpj, tomador_doc_tipo, tomador_email,
      tomador_endereco, tomador_numero, tomador_bairro,
      tomador_codigo_municipio, tomador_uf, tomador_cep,
      items, codigo_municipio, codigo_servico, codigo_cnae, codigo_tributacao_municipio, aliquota_iss,
      regime_tributario, optante_simples, valor_deducoes,
      numero_rps, serie_rps,
    } = payload;

    if (!certificado_base64 || !certificado_senha) {
      return jsonResponse(400, { error: 'Certificado e senha são obrigatórios' });
    }
    if (!cnpj || !inscricao_municipal) {
      return jsonResponse(400, { error: 'CNPJ e Inscrição Municipal do prestador são obrigatórios' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return jsonResponse(400, { error: 'Itens da nota são obrigatórios' });
    }

    try {
      console.log('[NFS-e Prefeitura] Emitindo RPS', numero_rps, 'para CNPJ', cnpj, 'ambiente:', ambiente);
      const result = await emitirNfsePrefeitura({
        prestador: { cnpj, inscricao_municipal },
        tomador: {
          cpf_cnpj: tomador_cpf_cnpj || null,
          doc_tipo: tomador_doc_tipo || null,
          razao_social: tomador_nome || 'Consumidor Final',
          email: tomador_email || null,
          endereco: tomador_endereco || null,
          numero: tomador_numero || null,
          bairro: tomador_bairro || null,
          codigo_municipio: tomador_codigo_municipio || null,
          uf: tomador_uf || null,
          cep: tomador_cep || null,
        },
        items: items.map((it: any) => ({
          description: it.description || 'Serviço',
          quantidade: it.quantidade || 1,
          valor_unitario: it.valor_unitario || it.amount || 0,
          valor_total: it.valor_total || it.amount || 0,
        })),
        config: {
          certificado_base64,
          certificado_senha,
          ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
          codigo_municipio: codigo_municipio || '3300233',
          codigo_servico: codigo_servico || '09.01',
          codigo_cnae: codigo_cnae || null,
          codigo_tributacao_municipio: codigo_tributacao_municipio || null,
          aliquota_iss: aliquota_iss ?? 5,
          regime_tributario: regime_tributario || null,
          optante_simples: !!optante_simples,
          valor_deducoes: Number(valor_deducoes) || 0,
        },
        numeroRps: numero_rps || 1,
        serieRps: serie_rps || 'RPS',
      });

      console.log('[NFS-e Prefeitura] Resultado:', result.success ? 'SUCESSO' : 'FALHA',
        '| NF:', result.numero_nf, '| Msg:', result.message);
      if (!result.success) {
        console.log('[NFS-e Prefeitura] XML retorno (primeiros 2000 chars):', result.xml_retorno?.slice(0, 2000));
      }

      return jsonResponse(200, {
        success: result.success,
        numero_nf: result.numero_nf,
        serie: result.serie,
        chave_acesso: result.chave_acesso,
        numero_protocolo: result.numero_protocolo,
        codigo_verificacao: result.codigo_verificacao,
        xml_retorno: result.xml_retorno,
        pdf_url: null,
        message: result.message,
      });
    } catch (err: any) {
      return jsonResponse(500, {
        success: false,
        numero_nf: null, serie: null, chave_acesso: null,
        numero_protocolo: null, codigo_verificacao: null,
        xml_retorno: '', pdf_url: null,
        message: `Erro na emissão: ${err.message}`,
      });
    }
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

  // ─── Emit NFC-e (integração real SEFAZ via SVRS) ─────────────────────────

  if (action === 'emit-nfce') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const {
      certificado_base64, certificado_senha, ambiente,
      cnpj, razao_social, nome_fantasia, inscricao_estadual, crt,
      endereco_logradouro, endereco_numero, endereco_bairro,
      endereco_cidade, endereco_uf, endereco_cep, endereco_codigo_municipio,
      telefone,
      tomador_nome, tomador_cpf_cnpj, tomador_doc_tipo,
      items, serie_nfce, nfce_csc_id, nfce_csc_token,
      numero_nfce, tPag, acrescimo, taxa_na_base_icms, pagamentos,
      ibs_cbs_enabled,
    } = payload;

    if (!certificado_base64 || !certificado_senha) {
      return jsonResponse(400, { error: 'Certificado e senha são obrigatórios' });
    }
    if (!cnpj || !inscricao_estadual) {
      return jsonResponse(400, { error: 'CNPJ e IE são obrigatórios para NFC-e' });
    }
    if (!nfce_csc_id || !nfce_csc_token) {
      return jsonResponse(400, { error: 'CSC ID e Token são obrigatórios para NFC-e' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return jsonResponse(400, { error: 'Itens da nota são obrigatórios' });
    }

    try {
      const result = await emitirNFCe({
        emitente: {
          cnpj,
          razao_social: razao_social || 'Empresa',
          nome_fantasia: nome_fantasia || undefined,
          inscricao_estadual,
          crt: crt || 1,
          endereco_logradouro: endereco_logradouro || '',
          endereco_numero: endereco_numero || 'S/N',
          endereco_bairro: endereco_bairro || '',
          endereco_cidade: endereco_cidade || '',
          endereco_uf: endereco_uf || 'RJ',
          endereco_cep: endereco_cep || '',
          endereco_codigo_municipio: endereco_codigo_municipio || '3300233',
          telefone: telefone || undefined,
        },
        destinatario: {
          cpf_cnpj: tomador_cpf_cnpj || null,
          doc_tipo: tomador_doc_tipo || null,
          nome: tomador_nome || null,
        },
        items: items.map((it: any, idx: number) => ({
          nItem: idx + 1,
          cProd: it.cProd || String(idx + 1),
          xProd: it.description || it.xProd || 'Produto',
          ncm: it.ncm || '00000000',
          cfop: it.cfop || '5102',
          uCom: it.uCom || 'UN',
          qCom: it.quantidade ?? it.qCom ?? 1,
          vUnCom: it.valor_unitario ?? it.vUnCom ?? 0,
          vProd: it.valor_total ?? it.vProd ?? 0,
          icms_orig: it.icms_orig || '0',
          icms_cst: it.icms_cst || undefined,
          icms_csosn: it.icms_csosn || undefined,
          icms_vBC: it.icms_vBC ?? 0,
          icms_pICMS: it.icms_pICMS ?? 0,
          icms_vICMS: it.icms_vICMS ?? 0,
          pis_cst: it.pis_cst || undefined,
          pis_aliquota: it.pis_aliquota ?? undefined,
          cofins_cst: it.cofins_cst || undefined,
          cofins_aliquota: it.cofins_aliquota ?? undefined,
          // IBS/CBS (Reforma Tributária) — grupo ainda desligado por padrão
          // em nfce-sefaz.ts (NFCE_IBSCBS); propagado aqui para já chegar ao
          // builder quando a flag for religada após validação em homologação.
          ibs_cbs_cst: it.ibs_cbs_cst || undefined,
          ibs_cbs_cClassTrib: it.ibs_cbs_cClassTrib || undefined,
          ibs_aliquota: it.ibs_aliquota ?? undefined,
          cbs_aliquota: it.cbs_aliquota ?? undefined,
        })),
        config: {
          certificado_base64,
          certificado_senha,
          ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
          serie: serie_nfce || '1',
          csc_id: nfce_csc_id,
          csc_token: nfce_csc_token,
          // Reforma Tributária: opt-in por hotel (nfce_ibs_cbs_enabled).
          // Kill switch global fica em nfce-sefaz.ts (env NFCE_IBSCBS=0).
          ibs_cbs_enabled: !!ibs_cbs_enabled,
        },
        nNF: numero_nfce || 1,
        tPag: tPag || '01',
        pagamentos: Array.isArray(pagamentos) && pagamentos.length ? pagamentos : undefined,
        acrescimo: Number(acrescimo) || 0,
        taxaNaBaseIcms: !!taxa_na_base_icms,
      });

      console.log('[NFC-e] Resultado:', result.success ? 'SUCESSO' : 'FALHA',
        '| NF:', result.numero_nf, '| Chave:', result.chave_acesso, '| Msg:', result.message);

      return jsonResponse(200, {
        success: result.success,
        numero_nf: result.numero_nf,
        serie: result.serie,
        chave_acesso: result.chave_acesso,
        numero_protocolo: result.numero_protocolo,
        codigo_verificacao: result.codigo_verificacao,
        qrcode_url: result.qrcode_url,
        url_consulta: result.url_consulta,
        xml_retorno: result.xml_retorno,
        pdf_url: null,
        message: result.message,
      });
    } catch (err: any) {
      console.error('[NFC-e] Erro:', err.message);
      return jsonResponse(500, {
        success: false,
        numero_nf: null, serie: null, chave_acesso: null,
        numero_protocolo: null, codigo_verificacao: null,
        qrcode_url: null, url_consulta: null,
        xml_retorno: '', pdf_url: null,
        message: `Erro na emissão NFC-e: ${err.message}`,
      });
    }
  }

  // ─── Test NFC-e (Status do Serviço SEFAZ) ────────────────────────────────

  if (action === 'test-nfce') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const { certificado_base64, certificado_senha, ambiente } = payload;
    if (!certificado_base64 || !certificado_senha) {
      return jsonResponse(400, { error: 'Certificado e senha são obrigatórios' });
    }

    const result = await statusServicoNFCe({
      certificado_base64,
      certificado_senha,
      ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
    });

    return jsonResponse(200, result);
  }

  // ─── Cancel NFC-e (integração real SEFAZ) ────────────────────────────────

  if (action === 'cancel-nfce') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const { certificado_base64, certificado_senha, ambiente, cnpj, chave_acesso, numero_protocolo, motivo } = payload;

    if (!certificado_base64 || !certificado_senha || !chave_acesso || !numero_protocolo) {
      return jsonResponse(400, { error: 'Certificado, chave e protocolo são obrigatórios para cancelar NFC-e' });
    }

    try {
      const result = await cancelarNFCe({
        certificado_base64,
        certificado_senha,
        ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
        cnpj: cnpj || '',
        chave: chave_acesso,
        nProt: numero_protocolo,
        xJust: motivo || 'Cancelamento solicitado pelo emitente',
      });

      return jsonResponse(200, result);
    } catch (err: any) {
      return jsonResponse(500, { success: false, xml: '', message: `Erro: ${err.message}` });
    }
  }

  // ─── Emit NF-e Produtos (modelo 55, integração real SEFAZ via SVRS) ──────

  if (action === 'emit-nfe') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const {
      certificado_base64, certificado_senha, ambiente,
      cnpj, razao_social, nome_fantasia, inscricao_estadual, crt,
      endereco_logradouro, endereco_numero, endereco_bairro,
      endereco_cidade, endereco_uf, endereco_cep, endereco_codigo_municipio,
      telefone,
      tomador_nome, tomador_cpf_cnpj, tomador_doc_tipo, tomador_ie, tomador_ind_ie,
      tomador_email, tomador_endereco, tomador_numero, tomador_bairro,
      tomador_cidade, tomador_codigo_municipio, tomador_uf, tomador_cep,
      items, serie_nfe, numero_nfe, natureza_operacao, tPag, pagamentos,
      ibs_cbs_enabled,
    } = payload;

    if (!certificado_base64 || !certificado_senha) {
      return jsonResponse(400, { error: 'Certificado e senha são obrigatórios' });
    }
    if (!cnpj || !inscricao_estadual) {
      return jsonResponse(400, { error: 'CNPJ e IE são obrigatórios para NF-e' });
    }
    if (!tomador_cpf_cnpj || !tomador_nome) {
      return jsonResponse(400, { error: 'Destinatário (nome e documento) é obrigatório para NF-e modelo 55' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return jsonResponse(400, { error: 'Itens da nota são obrigatórios' });
    }

    try {
      const result = await emitirNFe({
        emitente: {
          cnpj,
          razao_social: razao_social || 'Empresa',
          nome_fantasia: nome_fantasia || undefined,
          inscricao_estadual,
          crt: crt || 1,
          endereco_logradouro: endereco_logradouro || '',
          endereco_numero: endereco_numero || 'S/N',
          endereco_bairro: endereco_bairro || '',
          endereco_cidade: endereco_cidade || '',
          endereco_uf: endereco_uf || 'RJ',
          endereco_cep: endereco_cep || '',
          endereco_codigo_municipio: endereco_codigo_municipio || '3300233',
          telefone: telefone || undefined,
        },
        destinatario: {
          cpf_cnpj: tomador_cpf_cnpj,
          doc_tipo: tomador_doc_tipo === 'cnpj' ? 'cnpj' : tomador_doc_tipo === 'passaporte' ? 'passaporte' : 'cpf',
          nome: tomador_nome,
          ie: tomador_ie || null,
          indIEDest: tomador_ind_ie || '9',
          email: tomador_email || null,
          endereco_logradouro: tomador_endereco || undefined,
          endereco_numero: tomador_numero || undefined,
          endereco_bairro: tomador_bairro || undefined,
          endereco_cidade: tomador_cidade || undefined,
          endereco_codigo_municipio: tomador_codigo_municipio || undefined,
          endereco_uf: tomador_uf || undefined,
          endereco_cep: tomador_cep || undefined,
        },
        items: items.map((it: any, idx: number) => ({
          nItem: idx + 1,
          cProd: it.cProd || String(idx + 1),
          xProd: it.description || it.xProd || 'Produto',
          ncm: it.ncm || '00000000',
          cfop: it.cfop || '5102',
          uCom: it.uCom || 'UN',
          qCom: it.quantidade ?? it.qCom ?? 1,
          vUnCom: it.valor_unitario ?? it.vUnCom ?? 0,
          vProd: it.valor_total ?? it.vProd ?? 0,
          icms_orig: it.icms_orig || '0',
          icms_cst: it.icms_cst || undefined,
          icms_csosn: it.icms_csosn || undefined,
          icms_vBC: it.icms_vBC ?? 0,
          icms_pICMS: it.icms_pICMS ?? 0,
          icms_vICMS: it.icms_vICMS ?? 0,
          ibs_cbs_cst: it.ibs_cbs_cst || undefined,
          ibs_cbs_cClassTrib: it.ibs_cbs_cClassTrib || undefined,
          ibs_aliquota: it.ibs_aliquota ?? undefined,
          cbs_aliquota: it.cbs_aliquota ?? undefined,
        })),
        config: {
          certificado_base64,
          certificado_senha,
          ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
          serie: serie_nfe || '1',
          ibs_cbs_enabled: !!ibs_cbs_enabled,
        },
        nNF: numero_nfe || 1,
        natOp: natureza_operacao || 'VENDA DE MERCADORIA',
        tPag: tPag || '01',
        pagamentos: Array.isArray(pagamentos) && pagamentos.length ? pagamentos : undefined,
      });

      console.log('[NF-e] Resultado:', result.success ? 'SUCESSO' : 'FALHA',
        '| NF:', result.numero_nf, '| Chave:', result.chave_acesso, '| Msg:', result.message);

      return jsonResponse(200, {
        success: result.success,
        numero_nf: result.numero_nf,
        serie: result.serie,
        chave_acesso: result.chave_acesso,
        numero_protocolo: result.numero_protocolo,
        codigo_verificacao: result.codigo_verificacao,
        qrcode_url: result.qrcode_url,
        url_consulta: result.url_consulta,
        xml_retorno: result.xml_retorno,
        pdf_url: null,
        message: result.message,
      });
    } catch (err: any) {
      console.error('[NF-e] Erro:', err.message);
      return jsonResponse(500, {
        success: false,
        numero_nf: null, serie: null, chave_acesso: null,
        numero_protocolo: null, codigo_verificacao: null,
        qrcode_url: null, url_consulta: null,
        xml_retorno: '', pdf_url: null,
        message: `Erro na emissão NF-e: ${err.message}`,
      });
    }
  }

  // ─── Cancel NF-e Produtos (modelo 55, integração real) ───────────────────

  if (action === 'cancel-nfe') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const { certificado_base64, certificado_senha, ambiente, cnpj, chave_acesso, numero_protocolo, motivo } = payload;

    if (!certificado_base64 || !certificado_senha || !chave_acesso || !numero_protocolo) {
      return jsonResponse(400, { error: 'Certificado, chave e protocolo são obrigatórios para cancelar NF-e' });
    }

    try {
      const result = await cancelarNFe({
        certificado_base64,
        certificado_senha,
        ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
        cnpj: cnpj || '',
        chave: chave_acesso,
        nProt: numero_protocolo,
        xJust: motivo || 'Cancelamento solicitado pelo emitente',
      });

      return jsonResponse(200, result);
    } catch (err: any) {
      return jsonResponse(500, { success: false, xml: '', message: `Erro: ${err.message}` });
    }
  }

  // ─── Cancel NFS-e Prefeitura (integração real) ───────────────────────────

  if (action === 'cancel') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const { certificado_base64, certificado_senha, ambiente, cnpj, inscricao_municipal, numero_nf, codigo_municipio } = payload;

    if (!certificado_base64 || !certificado_senha || !numero_nf) {
      return jsonResponse(400, { error: 'Certificado, senha e número da NF são obrigatórios' });
    }

    try {
      const result = await cancelarNfsePrefeitura({
        certificado_base64,
        certificado_senha,
        ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
        cnpj: cnpj || '',
        inscricao_municipal: inscricao_municipal || '',
        numero_nf,
        codigo_municipio: codigo_municipio || '3300233',
      });

      return jsonResponse(200, {
        success: result.success,
        xml_cancelamento: result.xml_cancelamento,
        message: result.message,
      });
    } catch (err: any) {
      return jsonResponse(500, {
        success: false,
        xml_cancelamento: '',
        message: `Erro no cancelamento: ${err.message}`,
      });
    }
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
      const result = await emitirDPS({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        config: payload.config,
        tomador: payload.tomador,
        items: payload.items,
        serie: payload.serie || 'NFS',
        numeroDPS: payload.numeroDPS || 1,
        ambiente,
      });

      return jsonResponse(result.success ? 200 : 502, {
        success: result.success,
        numero_nf: result.numeroNFSe,
        chave_acesso: result.chaveAcesso,
        numero_protocolo: result.protocolo,
        codigo_verificacao: result.codigoVerificacao,
        xml_retorno: result.xmlRetorno,
        xml_dps: result.dpsXml,
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
      cnpj?: string;
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
    // O pedido de registro de evento leva <CNPJAutor>, então o CNPJ do emitente
    // é obrigatório aqui (antes o cancelamento ia sem ele).
    if (!payload.cnpj) {
      return jsonResponse(400, { error: 'CNPJ do emitente é obrigatório para cancelar no Sefin Nacional.' });
    }

    try {
      const result = await registrarEvento({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        cnpj: payload.cnpj,
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

  // ─── Consultar NFS-e Serviço Prestado (retroativo) ────────────────────────

  if (action === 'consultar-nfse-prestado') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    if (!payload.certificado_base64 || !payload.certificado_senha || !payload.cnpj || !payload.inscricao_municipal) {
      return jsonResponse(400, { error: 'Certificado, CNPJ e Inscrição Municipal são obrigatórios' });
    }

    console.log(`[consultar-nfse-prestado] cnpj="${payload.cnpj}", im="${payload.inscricao_municipal}", ambiente="${payload.ambiente}" → resolved="${payload.ambiente === 'producao' ? 'producao' : 'homologacao'}"`);

    try {
      const result = await consultarNfseServicoPrestado({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        ambiente: payload.ambiente === 'producao' ? 'producao' : 'homologacao',
        cnpj: payload.cnpj,
        inscricao_municipal: payload.inscricao_municipal,
        data_inicial: payload.data_inicial,
        data_final: payload.data_final,
        pagina: payload.pagina,
        tomador_cpf_cnpj: payload.tomador_cpf_cnpj,
      });
      console.log(`[consultar-nfse-prestado] success=${result.success}, notas=${result.notas.length}, msg=${result.message}`);
      if (result.xml_retorno) {
        console.log(`[consultar-nfse-prestado] xml_retorno (1000 chars): ${result.xml_retorno.slice(0, 1000)}`);
      }
      return jsonResponse(200, {
        ...result,
        xml_retorno: result.xml_retorno ? result.xml_retorno.slice(0, 2000) : undefined,
      });
    } catch (err: any) {
      return jsonResponse(500, { success: false, notas: [], message: `Erro: ${err.message}` });
    }
  }

  // ─── Consultar NFS-e por Faixa ──────────────────────────────────────────

  if (action === 'consultar-nfse-faixa') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    if (!payload.certificado_base64 || !payload.certificado_senha || !payload.cnpj || !payload.inscricao_municipal) {
      return jsonResponse(400, { error: 'Certificado, CNPJ e Inscrição Municipal são obrigatórios' });
    }

    try {
      const result = await consultarNfsePorFaixa({
        certificado_base64: payload.certificado_base64,
        certificado_senha: payload.certificado_senha,
        ambiente: payload.ambiente === 'producao' ? 'producao' : 'homologacao',
        cnpj: payload.cnpj,
        inscricao_municipal: payload.inscricao_municipal,
        numero_inicial: payload.numero_inicial || 1,
        numero_final: payload.numero_final || 9999,
        pagina: payload.pagina,
      });
      return jsonResponse(200, result);
    } catch (err: any) {
      return jsonResponse(500, { success: false, notas: [], message: `Erro: ${err.message}` });
    }
  }

  // ─── Emissão em Lote Síncrono ───────────────────────────────────────────

  if (action === 'emit-lote-nfse') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    try {
      const result = await recepcionarLoteRpsSincrono({
        prestador: payload.prestador,
        tomadores: payload.tomadores,
        itemsPerRps: payload.itemsPerRps,
        config: payload.config,
        numerosRps: payload.numerosRps,
        serieRps: payload.serieRps,
      });
      return jsonResponse(200, result);
    } catch (err: any) {
      return jsonResponse(500, { success: false, resultados: [], message: `Erro: ${err.message}` });
    }
  }

  // ─── Substituir NFS-e ───────────────────────────────────────────────────

  if (action === 'substituir-nfse') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    try {
      const result = await substituirNfse({
        prestador: payload.prestador,
        tomador: payload.tomador,
        items: payload.items,
        config: payload.config,
        numeroRps: payload.numeroRps,
        serieRps: payload.serieRps,
        numero_nfse_substituida: payload.numero_nfse_substituida,
      });
      return jsonResponse(200, result);
    } catch (err: any) {
      return jsonResponse(500, { success: false, message: `Erro: ${err.message}` });
    }
  }

  // ─── E&L Nacional: Emissão de NFS-e (DPS) ─────────────────────────────────

  if (action === 'emit-nfse-el-nacional') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    if (!payload.certificado_base64 || !payload.certificado_senha) {
      return jsonResponse(400, { error: 'Certificado digital A1 e senha são obrigatórios.' });
    }
    if (!payload.token) {
      return jsonResponse(400, { error: 'Token de integração E&L é obrigatório.' });
    }

    try {
      const result = await emitirNfseELNacional({
        config: {
          certificado_base64: payload.certificado_base64,
          certificado_senha: payload.certificado_senha,
          token: payload.token,
          ambiente: payload.ambiente === 'producao' ? 'producao' : 'homologacao',
          cnpj: payload.cnpj,
          inscricao_municipal: payload.inscricao_municipal,
          codigo_municipio: payload.codigo_municipio || '3300233',
          codigo_servico: payload.codigo_servico || '9.01',
          codigo_servico_municipal: payload.codigo_servico_municipal || null,
          aliquota_iss: payload.aliquota_iss ?? 5,
          optante_simples: !!payload.optante_simples,
          telefone: payload.telefone || null,
          ibs_cbs_cst: payload.ibs_cbs_cst || null,
          ibs_cbs_cclasstrib: payload.ibs_cbs_cclasstrib || null,
          fin_nfse: payload.fin_nfse ?? null,
          ind_final: payload.ind_final ?? null,
          c_ind_op: payload.c_ind_op || null,
          ind_dest: payload.ind_dest ?? null,
        },
        tomador: {
          cpf_cnpj: payload.tomador_cpf_cnpj || null,
          doc_tipo: payload.tomador_doc_tipo || null,
          razao_social: payload.tomador_nome || 'Consumidor Final',
          endereco: payload.tomador_endereco || null,
          numero: payload.tomador_numero || null,
          bairro: payload.tomador_bairro || null,
          codigo_municipio: payload.tomador_codigo_municipio || null,
          cep: payload.tomador_cep || null,
        },
        items: (payload.items || []).map((it: any) => ({
          description: it.description || it.descricao || 'Serviço',
          quantidade: it.quantidade || 1,
          valor_unitario: it.valor_unitario || it.amount || 0,
          valor_total: it.valor_total || it.amount || 0,
        })),
        serie: payload.serie || 'NFS',
        numeroDPS: payload.numeroDPS || 1,
      });

      return jsonResponse(result.success ? 200 : 502, {
        success: result.success,
        numero_nf: result.numero_nf,
        chave_acesso: result.chave_acesso,
        codigo_verificacao: result.codigo_verificacao,
        xml_retorno: result.xml_retorno,
        message: result.message,
        error: result.success ? undefined : result.message,
      });
    } catch (err: any) {
      return jsonResponse(500, { success: false, message: `Erro na emissão E&L Nacional: ${err.message}` });
    }
  }

  // ─── E&L Nacional: Cancelamento de NFS-e ─────────────────────────────────

  if (action === 'cancel-nfse-el-nacional') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    if (!payload.certificado_base64 || !payload.certificado_senha || !payload.token || !payload.chave_acesso) {
      return jsonResponse(400, { error: 'Certificado, token e chave de acesso são obrigatórios.' });
    }

    try {
      const result = await cancelarNfseELNacional({
        config: {
          certificado_base64: payload.certificado_base64,
          certificado_senha: payload.certificado_senha,
          token: payload.token,
          ambiente: payload.ambiente === 'producao' ? 'producao' : 'homologacao',
          cnpj: payload.cnpj,
        },
        chave_acesso: payload.chave_acesso,
        motivo: payload.motivo,
      });

      return jsonResponse(result.success ? 200 : 502, {
        success: result.success,
        message: result.message,
        xml_cancelamento: result.xml_retorno,
        error: result.success ? undefined : result.message,
      });
    } catch (err: any) {
      return jsonResponse(500, { success: false, message: `Erro no cancelamento E&L Nacional: ${err.message}` });
    }
  }

  // ─── E&L Nacional: Consulta NFS-e por chave ──────────────────────────────

  if (action === 'consulta-nfse-el-nacional') {
    let payload: any;
    try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    if (!payload.token || !payload.chave_acesso) {
      return jsonResponse(400, { error: 'Token e chave de acesso são obrigatórios.' });
    }

    try {
      const result = await consultarNfseELNacional({
        token: payload.token,
        ambiente: payload.ambiente === 'producao' ? 'producao' : 'homologacao',
        chave_acesso: payload.chave_acesso,
      });

      return jsonResponse(result.success ? 200 : 502, {
        success: result.success,
        message: result.message,
        xml: result.xml,
        error: result.success ? undefined : result.message,
      });
    } catch (err: any) {
      return jsonResponse(500, { success: false, message: `Erro na consulta E&L Nacional: ${err.message}` });
    }
  }

  return jsonResponse(400, { error: `Ação desconhecida: ${action}` });
};

export { handler };
