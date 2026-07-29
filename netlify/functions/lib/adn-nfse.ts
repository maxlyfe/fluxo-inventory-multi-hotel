// netlify/functions/lib/adn-nfse.ts
// Integração com o ADN (Ambiente de Dados Nacional) para emissão de NFS-e
// via Sistema Nacional NFS-e (Receita Federal / Serpro).
// Autenticação: mTLS com certificado A1 (.pfx) — mesmo padrão de dfe.ts.

import https from 'https';

const SEFIN_HOSTS = {
  producao: 'www.nfse.gov.br',
  homologacao: 'www.producaorestrita.nfse.gov.br',
} as const;

const ADN_HOSTS = {
  producao: 'adn.nfse.gov.br',
  homologacao: 'adn.producaorestrita.nfse.gov.br',
} as const;

type Ambiente = 'producao' | 'homologacao';

// ─── HTTP helpers ───────────────────────────────────────────────────────────

function httpsRequest(
  options: https.RequestOptions & { body?: string },
): Promise<{ status: number; body: string; rawBuffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 0,
          body: rawBuffer.toString('utf8'),
          rawBuffer,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout na comunicação com o ADN')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function pfxBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

// ─── DPS Builder ────────────────────────────────────────────────────────────

export interface DPSConfig {
  cnpj: string;
  inscricao_municipal: string;
  razao_social: string;
  nome_fantasia?: string;
  endereco_logradouro?: string;
  endereco_numero?: string;
  endereco_complemento?: string;
  endereco_bairro?: string;
  endereco_cidade?: string;
  endereco_uf?: string;
  endereco_cep?: string;
  endereco_codigo_municipio: string;
  telefone?: string;
  email?: string;
  regime_tributario_nfse?: string;
  codigo_servico: string;
  aliquota_iss: number;
  // Reforma Tributária (IBS/CBS, NT 2025.002) — bloco IBSCBS por DPS. Mesmos
  // campos de nf_hotel_config usados no formato 'el-nacional' (paridade entre
  // os dois formatos alternativos à Nota Nacional ABRASF).
  ibs_cbs_cst?: string | null;
  ibs_cbs_cclasstrib?: string | null;
  fin_nfse?: number | null;
  ind_final?: number | null;
  c_ind_op?: string | null;
  ind_dest?: number | null;
}

export interface DPSTomador {
  nome: string;
  doc_tipo: 'cpf' | 'cnpj' | 'passaporte' | null;
  doc_numero: string | null;
  nacionalidade?: string | null;
  email?: string | null;
  endereco?: string | null;
}

export interface DPSItem {
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  codigo_servico?: string;
  iss_aliquota?: number;
}

export interface DPSPayload {
  infDPS: {
    tpAmb: number;
    dhEmi: string;
    verAplic: string;
    serie: string;
    nDPS: number;
    dCompet: string;
    tpEmit: number;
    cLocEmi: number;
    subst?: null;
    prest: {
      CNPJ: string;
      IM: string;
      regimeTributario?: number;
      xNome: string;
      xFant?: string;
      end?: {
        xLgr?: string;
        nro?: string;
        xCpl?: string;
        xBairro?: string;
        cMun: number;
        UF: string;
        CEP?: string;
      };
      fone?: string;
      email?: string;
    };
    toma?: {
      CNPJ?: string;
      CPF?: string;
      NIF?: string;
      xNome: string;
      end?: {
        xLgr?: string;
        nro?: string;
        xBairro?: string;
        cMun?: number;
        UF?: string;
        CEP?: string;
      };
      fone?: string;
      email?: string;
    } | null;
    serv: {
      cServ: {
        cTribNac: string;
        cTribMun?: string;
        xDescServ: string;
        CNAE?: string;
      };
      cPais?: number;
      cMun?: number;
      vServ: number;
      vDesc?: number;
      vLiq: number;
      trib: {
        totTrib: {
          pTotTribSN?: number;
          indTotTrib: number;
          pTotTrib?: number;
        };
        ISSQN: {
          cLocIncid: number;
          cPaisResult?: number;
          tpImunidade?: number;
          BM?: {
            tpSusp?: number;
            nProcesso?: string;
            pAliq: number;
            tpRetISSQN?: number;
            vLiq: number;
            vBaseCalc: number;
            vISSQN: number;
          };
        };
      };
    };
    vDPS: number;
    // Reforma Tributária (IBS/CBS) — bloco opcional, omitido quando o hotel
    // não tem CST/cClassTrib configurados (ver DPSConfig.ibs_cbs_cst).
    IBSCBS?: {
      finNFSe: number;
      indFinal: number;
      cIndOp: string;
      indDest: number;
      valores: {
        trib: {
          gIBSCBS: {
            CST: string;
            cClassTrib: string;
          };
        };
      };
    };
  };
}

export function buildDPS(
  config: DPSConfig,
  tomador: DPSTomador,
  items: DPSItem[],
  serie: string,
  numeroDPS: number,
  ambiente: Ambiente,
): DPSPayload {
  const cnpj = config.cnpj.replace(/\D/g, '');
  const tpAmb = ambiente === 'producao' ? 1 : 2;

  const now = new Date();
  const dhEmi = now.toISOString().replace(/\.\d{3}Z$/, '-03:00');
  const dCompet = now.toISOString().slice(0, 10);

  const valorServico = items.reduce((s, i) => s + i.valor_total, 0);
  const aliquota = items[0]?.iss_aliquota ?? config.aliquota_iss;
  const valorISS = Number((valorServico * (aliquota / 100)).toFixed(2));
  const codigoServico = items[0]?.codigo_servico ?? config.codigo_servico;
  const cMun = Number(config.endereco_codigo_municipio);

  const descricaoItens = items
    .map(i => `${i.descricao} (${i.quantidade}x R$${i.valor_unitario.toFixed(2)})`)
    .join('; ');

  const prest: DPSPayload['infDPS']['prest'] = {
    CNPJ: cnpj,
    IM: config.inscricao_municipal.replace(/\D/g, ''),
    xNome: config.razao_social,
  };
  if (config.nome_fantasia) prest.xFant = config.nome_fantasia;
  if (config.regime_tributario_nfse) {
    prest.regimeTributario = Number(config.regime_tributario_nfse) || undefined;
  }
  if (config.endereco_logradouro) {
    prest.end = {
      xLgr: config.endereco_logradouro,
      nro: config.endereco_numero || 'S/N',
      xCpl: config.endereco_complemento || undefined,
      xBairro: config.endereco_bairro || undefined,
      cMun,
      UF: config.endereco_uf || 'RJ',
      CEP: config.endereco_cep?.replace(/\D/g, '') || undefined,
    };
  }
  if (config.telefone) prest.fone = config.telefone.replace(/\D/g, '');
  if (config.email) prest.email = config.email;

  let toma: DPSPayload['infDPS']['toma'] = null;
  if (tomador.nome && tomador.doc_numero) {
    toma = { xNome: tomador.nome };
    const docNum = tomador.doc_numero.replace(/\D/g, '');
    if (tomador.doc_tipo === 'cnpj') {
      toma.CNPJ = docNum;
    } else if (tomador.doc_tipo === 'cpf') {
      toma.CPF = docNum;
    } else if (tomador.doc_tipo === 'passaporte') {
      toma.NIF = tomador.doc_numero;
    }
    if (tomador.email) toma.email = tomador.email;
  }

  // Bloco IBSCBS: omitido por completo se o hotel não tiver CST/cClassTrib
  // configurados (mesmo critério do formato 'el-nacional' — ver
  // buildIbsCbsXml em el-nacional-nfse.ts).
  let ibsCbs: DPSPayload['infDPS']['IBSCBS'];
  if (config.ibs_cbs_cst && config.ibs_cbs_cclasstrib) {
    ibsCbs = {
      finNFSe: config.fin_nfse ?? 0,
      indFinal: config.ind_final ?? 1,
      cIndOp: config.c_ind_op || '100301',
      indDest: config.ind_dest ?? 0,
      valores: {
        trib: {
          gIBSCBS: {
            CST: config.ibs_cbs_cst,
            cClassTrib: config.ibs_cbs_cclasstrib,
          },
        },
      },
    };
  }

  return {
    infDPS: {
      tpAmb,
      dhEmi,
      verAplic: 'FLUXO1.0',
      serie,
      nDPS: numeroDPS,
      dCompet,
      tpEmit: 1,
      cLocEmi: cMun,
      prest,
      toma,
      serv: {
        cServ: {
          cTribNac: codigoServico,
          xDescServ: descricaoItens,
        },
        cMun,
        vServ: Number(valorServico.toFixed(2)),
        vLiq: Number(valorServico.toFixed(2)),
        trib: {
          totTrib: {
            indTotTrib: 0,
            pTotTrib: aliquota,
          },
          ISSQN: {
            cLocIncid: cMun,
            BM: {
              pAliq: aliquota,
              vLiq: Number(valorServico.toFixed(2)),
              vBaseCalc: Number(valorServico.toFixed(2)),
              vISSQN: valorISS,
            },
          },
        },
      },
      vDPS: Number(valorServico.toFixed(2)),
      ...(ibsCbs ? { IBSCBS: ibsCbs } : {}),
    },
  };
}

// ─── Emissão de DPS (Declaração de Prestação de Serviço) ────────────────────

export interface EmissaoDPSResult {
  success: boolean;
  idDPS?: string;
  chaveAcesso?: string;
  numeroNFSe?: string;
  codigoVerificacao?: string;
  protocolo?: string;
  xmlRetorno?: string;
  mensagem: string;
  cStat?: string;
}

export async function emitirDPS(params: {
  certificado_base64: string;
  certificado_senha: string;
  dps: DPSPayload;
  ambiente: Ambiente;
}): Promise<EmissaoDPSResult> {
  const dpsJson = JSON.stringify(params.dps);

  const res = await httpsRequest({
    host: SEFIN_HOSTS[params.ambiente],
    path: '/SefinNacional/nfse',
    method: 'POST',
    pfx: pfxBuffer(params.certificado_base64),
    passphrase: params.certificado_senha,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(dpsJson),
    },
    body: dpsJson,
  });

  if (res.status === 200 || res.status === 201) {
    let data: any;
    try {
      data = JSON.parse(res.body);
    } catch {
      return {
        success: true,
        xmlRetorno: res.body,
        mensagem: 'NFS-e processada (resposta não-JSON)',
      };
    }
    return {
      success: true,
      idDPS: data.idDPS ?? data.id,
      chaveAcesso: data.chaveAcesso ?? data.chNFSe,
      numeroNFSe: data.numeroNFSe ?? data.nNFSe ?? data.numero,
      codigoVerificacao: data.codigoVerificacao ?? data.cVerif,
      protocolo: data.nProt ?? data.protocolo,
      xmlRetorno: JSON.stringify(data),
      mensagem: data.xMotivo ?? data.mensagem ?? 'NFS-e autorizada com sucesso',
      cStat: data.cStat,
    };
  }

  let errorMsg = `ADN respondeu HTTP ${res.status}`;
  try {
    const errData = JSON.parse(res.body);
    errorMsg += `: ${errData.mensagem ?? errData.message ?? errData.xMotivo ?? res.body.slice(0, 300)}`;
  } catch {
    errorMsg += `: ${res.body.slice(0, 300)}`;
  }
  return { success: false, mensagem: errorMsg, cStat: String(res.status) };
}

// ─── Consulta NFS-e por chave ───────────────────────────────────────────────

export interface ConsultaNFSeResult {
  success: boolean;
  data?: any;
  mensagem: string;
}

export async function consultarNFSe(params: {
  certificado_base64: string;
  certificado_senha: string;
  chaveAcesso: string;
  ambiente: Ambiente;
}): Promise<ConsultaNFSeResult> {
  const res = await httpsRequest({
    host: ADN_HOSTS[params.ambiente],
    path: `/contribuintes/nfse/${params.chaveAcesso}`,
    method: 'GET',
    pfx: pfxBuffer(params.certificado_base64),
    passphrase: params.certificado_senha,
    headers: { 'Accept': 'application/json' },
  });

  if (res.status === 200) {
    try {
      const data = JSON.parse(res.body);
      return { success: true, data, mensagem: 'Consulta realizada com sucesso' };
    } catch {
      return { success: true, data: res.body, mensagem: 'Consulta ok (resposta não-JSON)' };
    }
  }

  return {
    success: false,
    mensagem: `Consulta falhou HTTP ${res.status}: ${res.body.slice(0, 300)}`,
  };
}

// ─── Registro de Evento (cancelamento) ──────────────────────────────────────

export interface EventoNFSeResult {
  success: boolean;
  protocolo?: string;
  mensagem: string;
  cStat?: string;
}

export async function registrarEvento(params: {
  certificado_base64: string;
  certificado_senha: string;
  chaveAcesso: string;
  tipoEvento: 'cancelamento';
  codigoCancelamento?: string;
  motivo: string;
  ambiente: Ambiente;
}): Promise<EventoNFSeResult> {
  const evento = {
    chNFSe: params.chaveAcesso,
    tpEvento: params.tipoEvento === 'cancelamento' ? 'e101101' : params.tipoEvento,
    cMotCanc: params.codigoCancelamento ?? '1',
    xMotivo: params.motivo,
  };

  const body = JSON.stringify(evento);

  const res = await httpsRequest({
    host: SEFIN_HOSTS[params.ambiente],
    path: '/SefinNacional/nfse/evento',
    method: 'POST',
    pfx: pfxBuffer(params.certificado_base64),
    passphrase: params.certificado_senha,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  if (res.status === 200 || res.status === 201) {
    try {
      const data = JSON.parse(res.body);
      return {
        success: true,
        protocolo: data.nProt ?? data.protocolo,
        mensagem: data.xMotivo ?? data.mensagem ?? 'Evento registrado com sucesso',
        cStat: data.cStat,
      };
    } catch {
      return { success: true, mensagem: 'Evento registrado (resposta não-JSON)' };
    }
  }

  let errorMsg = `Evento falhou HTTP ${res.status}`;
  try {
    const errData = JSON.parse(res.body);
    errorMsg += `: ${errData.mensagem ?? errData.message ?? res.body.slice(0, 300)}`;
  } catch {
    errorMsg += `: ${res.body.slice(0, 300)}`;
  }
  return { success: false, mensagem: errorMsg, cStat: String(res.status) };
}

// ─── Buscar DANFSE (PDF) ────────────────────────────────────────────────────

export interface DANFSEResult {
  success: boolean;
  pdfBase64?: string;
  contentType?: string;
  mensagem: string;
}

export async function buscarDANFSE(params: {
  certificado_base64: string;
  certificado_senha: string;
  chaveAcesso: string;
  ambiente: Ambiente;
}): Promise<DANFSEResult> {
  const res = await httpsRequest({
    host: ADN_HOSTS[params.ambiente],
    path: `/danfse/nfse/${params.chaveAcesso}`,
    method: 'GET',
    pfx: pfxBuffer(params.certificado_base64),
    passphrase: params.certificado_senha,
    headers: { 'Accept': 'application/pdf' },
  });

  if (res.status === 200) {
    return {
      success: true,
      pdfBase64: res.rawBuffer.toString('base64'),
      contentType: 'application/pdf',
      mensagem: 'DANFSE obtido com sucesso',
    };
  }

  return {
    success: false,
    mensagem: `DANFSE falhou HTTP ${res.status}: ${res.body.slice(0, 300)}`,
  };
}

// ─── Teste de conexão ───────────────────────────────────────────────────────

export async function testarConexaoADN(params: {
  certificado_base64: string;
  certificado_senha: string;
  ambiente: Ambiente;
}): Promise<{ success: boolean; mensagem: string }> {
  try {
    const res = await httpsRequest({
      host: SEFIN_HOSTS[params.ambiente],
      path: '/SefinNacional/',
      method: 'GET',
      pfx: pfxBuffer(params.certificado_base64),
      passphrase: params.certificado_senha,
      headers: { 'Accept': 'application/json' },
    });

    if (res.status >= 200 && res.status < 500) {
      return {
        success: true,
        mensagem: `Conexão mTLS com ADN (${params.ambiente}) estabelecida com sucesso. HTTP ${res.status}`,
      };
    }
    return {
      success: false,
      mensagem: `ADN respondeu HTTP ${res.status}. Verifique o certificado e o ambiente selecionado.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    const friendly = /mac verify|invalid password|pkcs/i.test(msg)
      ? 'Senha do certificado incorreta ou arquivo .pfx inválido.'
      : msg;
    return { success: false, mensagem: `Falha na conexão com ADN: ${friendly}` };
  }
}
