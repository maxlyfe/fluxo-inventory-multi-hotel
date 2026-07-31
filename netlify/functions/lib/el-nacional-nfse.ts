// netlify/functions/lib/el-nacional-nfse.ts
// Integração com a API Nacional NFS-e hospedada pelo E&L (Búzios).
// Modelo DPS (layout nacional v1.01, namespace sped.fazenda.gov.br/nfse):
// XML assinado (XMLDSig) → GZip → Base64 → POST JSON com token de integração.
// Docs: "Orientações - API de Integração NFS-e Nacional" (E&L).

import https from 'https';
import crypto from 'crypto';
import zlib from 'zlib';
import { SignedXml } from 'xml-crypto';
import { extractPemFromPfx } from './dfe';
import { buildDiscriminacao } from './nfse-discriminacao';

const EL_HOST = 'rj-buzios-pm-nfs-backend.cloud.el.com.br';
const EL_BASE_PATH = '/producao35/api/nacional';

const DPS_NS = 'http://www.sped.fazenda.gov.br/nfse';

// Os helpers de DPS (buildDpsXml, signDps, gzipB64/gunzipB64, parseNfseXml,
// formatErros) sao exportados porque o formato 'adn' (Sefin Nacional, mTLS)
// usa exatamente a MESMA DPS assinada: muda so o transporte. Manter um unico
// builder evita os dois formatos divergirem, sobretudo no bloco <IBSCBS>.

type Ambiente = 'producao' | 'homologacao';

// Doc oficial E&L ("Orientações - API de Integração NFS-e Nacional"):
//   Homologação: .../producao35/api/nacional/homologacao/nfse
//   Produção:    .../producao35/api/nacional/nfse   (SEM segmento de ambiente)
// Ou seja, ao contrário do padrão usual, o segmento "/homologacao" só existe
// para homologação — produção usa o path base direto.
function elPath(ambiente: Ambiente, suffix: string): string {
  const envSegment = ambiente === 'producao' ? '' : `/${ambiente}`;
  return `${EL_BASE_PATH}${envSegment}${suffix}`;
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function httpsJson(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 60000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        host: EL_HOST,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout na comunicação com a API Nacional E&L')));
    if (payload) req.write(payload);
    req.end();
  });
}

export function gzipB64(xml: string): string {
  return zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

export function gunzipB64(b64: string): string {
  return zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
}

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface ELNacionalConfig {
  certificado_base64: string;
  certificado_senha: string;
  token: string;                       // token de integração gerado no portal do município
  ambiente: Ambiente;
  cnpj: string;
  inscricao_municipal: string;
  codigo_municipio: string;            // IBGE 7 dígitos (Búzios 3300233)
  codigo_servico: string;              // LC116 (ex. 9.01) → cTribNac 090101
  // Código de serviço municipal → <cIntContrib>.
  //
  // Pelo leiaute nacional cIntContrib é o "código interno do contribuinte",
  // livre. Búzios o usa como código de serviço municipal e o valida contra a
  // legislação: EL84 ("para este município é obrigatório informar o código
  // serviço municipal neste campo") quando ausente, E35 ("inválido, confira se
  // o código de serviço existe na legislação municipal") quando não reconhecido.
  //
  // Complicação: o schema do tipo TSCodigoInternoContribuinte tem pattern
  // [a-zA-Z0-9]{1,20}, então o ponto do código municipal ('9.01') reprova com
  // E1235. O valor precisa ser a forma SEM pontuação que a tabela do município
  // reconhece, e '901' já foi recusado com E35. Por isso este campo é enviado
  // exatamente como configurado (só filtrando o que o schema não aceita): é na
  // tela que se ajusta o valor, sem precisar de deploy para cada tentativa.
  codigo_servico_municipal?: string | null;
  // Código NBS de 9 dígitos, sem pontos (1.0303.11.00 → 103031100). Vira
  // <cNBS> e é OBRIGATÓRIO quando a DPS leva o bloco <IBSCBS> da reforma:
  // sem ele a Plataforma Nacional rejeita com E0322.
  codigo_nbs?: string | null;
  aliquota_iss: number;                // percentual (ex. 5)
  optante_simples: boolean;
  telefone?: string | null;
  // 1 = ISSQN não retido (padrão, caso da hospedagem) · 2 = retido pelo tomador
  // · 3 = retido pelo intermediário. Ver tribMun em buildDpsXml.
  tp_ret_issqn?: 1 | 2 | 3 | null;
  // Reforma Tributária (IBS/CBS, NT 2025.002) — bloco <IBSCBS> por DPS (não por
  // item: nf_invoice_items ainda não tem vínculo com services.id).
  ibs_cbs_cst?: string | null;         // CST IBS/CBS (3 díg). '000' = tributação integral
  ibs_cbs_cclasstrib?: string | null;  // cClassTrib (6 díg). '000001' = tributação integral
  fin_nfse?: number | null;            // Finalidade da NFS-e (0 = normal)
  ind_final?: number | null;           // 1 = consumidor final; 0 = não
  c_ind_op?: string | null;            // Código do indicador da operação (tabela nacional)
  ind_dest?: number | null;            // Indicador de destino da operação
}

export interface ELNacionalTomador {
  cpf_cnpj: string | null;
  doc_tipo: 'cpf' | 'cnpj' | 'passaporte' | null;
  razao_social: string;
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  codigo_municipio?: string | null;
  cep?: string | null;
}

export interface ELNacionalItem {
  description: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
}

export interface ELNacionalResult {
  success: boolean;
  /** DPS assinada que foi enviada. Guardada na nota para diagnóstico: sem ela,
   *  toda rejeição obriga a reproduzir o payload à mão. */
  xml_dps?: string;
  id_dps: string | null;
  chave_acesso: string | null;
  numero_nf: string | null;
  codigo_verificacao: string | null;
  xml_retorno: string;
  message: string;
}

// ── Montagem do XML da DPS (layout nacional v1.01) ──────────────────────────

function buildDpsId(cMun: string, cnpj: string, serie: string, numero: number): string {
  // DPS + cLocEmi(7) + tpInscFederal(2=CNPJ) + inscricao(14) + serie(5) + numero(15)
  const serieNum = (serie.replace(/\D/g, '') || '1').padStart(5, '0');
  return `DPS${cMun}2${cnpj}${serieNum}${String(numero).padStart(15, '0')}`;
}

// Bloco <IBSCBS> da DPS (Reforma Tributária, NT 2025.002). Estrutura simples
// (finNFSe/indFinal/cIndOp/indDest + CST/cClassTrib), conforme exemplo oficial
// de DPS com IBSCBS — sem valores monetários explícitos (vBC/vIBS/vCBS), que
// são calculados pela Plataforma Nacional a partir do valor do serviço e das
// alíquotas vigentes. Omitido por completo se a config não tiver CST/cClassTrib
// definidos (hotel ainda não configurado para a reforma).
function buildIbsCbsXml(config: ELNacionalConfig): string {
  const cst = config.ibs_cbs_cst;
  const cClassTrib = config.ibs_cbs_cclasstrib;
  if (!cst || !cClassTrib) return '';

  const finNFSe = config.fin_nfse ?? 0;
  const indFinal = config.ind_final ?? 1;
  const cIndOp = config.c_ind_op || '100301';
  const indDest = config.ind_dest ?? 0;

  return (
    `<IBSCBS>` +
    `<finNFSe>${finNFSe}</finNFSe>` +
    `<indFinal>${indFinal}</indFinal>` +
    `<cIndOp>${xmlEsc(cIndOp)}</cIndOp>` +
    `<indDest>${indDest}</indDest>` +
    `<valores><trib><gIBSCBS>` +
    `<CST>${xmlEsc(cst)}</CST>` +
    `<cClassTrib>${xmlEsc(cClassTrib)}</cClassTrib>` +
    `</gIBSCBS></trib></valores>` +
    `</IBSCBS>`
  );
}

// Exportado para permitir validar a estrutura da DPS (incluindo o bloco
// <IBSCBS> da Reforma Tributaria) sem certificado e sem chamar a API.
export function buildDpsXml(
  config: ELNacionalConfig,
  tomador: ELNacionalTomador,
  items: ELNacionalItem[],
  serie: string,
  numeroDPS: number,
): { xml: string; dpsId: string } {
  const cnpj = config.cnpj.replace(/\D/g, '');
  const im = config.inscricao_municipal.replace(/\D/g, '');
  const cMun = config.codigo_municipio || '3300233';
  const tpAmb = config.ambiente === 'producao' ? 1 : 2;

  // Retenção de ISSQN pelo tomador é exceção (serviço tomado por PJ obrigada a
  // reter). Para hospedagem o padrão é 1 = não retido.
  const tpRetISSQN = config.tp_ret_issqn ?? 1;

  const digits = (config.codigo_servico || '9.01').replace(/\D/g, '');
  const cTribNac = digits.replace(/^0?(\d{1,2})(\d{2})$/, (_, g, s) => g.padStart(2, '0') + s + '01');
  // Pattern do schema: [a-zA-Z0-9]{1,20}. Filtra pontuação e limita o tamanho,
  // preservando o resto exatamente como foi configurado.
  const cIntContrib = (config.codigo_servico_municipal || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  const cNBS = (config.codigo_nbs || '').replace(/\D/g, '');

  const dpsId = buildDpsId(cMun, cnpj, serie, numeroDPS);

  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const dhEmi = brt.toISOString().slice(0, 19) + '-03:00';
  const dCompet = brt.toISOString().slice(0, 10);

  const valorServicos = items.reduce((s, it) => s + it.valor_total, 0);
  const aliq = config.aliquota_iss;

  // <xDescServ> é TSDesc2000 — estourar o limite volta como rejeição E1235.
  const discriminacao = buildDiscriminacao(items, ' | ');

  // Tomador. O grupo <toma> é obrigatório para o indicador de operação que
  // emitimos (rejeição E0187), então ele sai sempre que houver nome — o que
  // muda é só COMO a pessoa é identificada.
  //
  // TCInfoPessoa aceita, em escolha exclusiva, CNPJ | CPF | NIF | cNaoNIF.
  // Passaporte não é NIF (número fiscal emitido por administração tributária
  // estrangeira) e não cabe em nenhum outro campo do grupo, então hóspede
  // estrangeiro entra como cNaoNIF, cujos únicos valores válidos são
  // 1 (dispensado do NIF) e 2 (não exigência do NIF).
  // Manual de Integração NFS-e Nacional v1.01, tipo TCInfoPessoa.
  //
  // CPF e CNPJ também exigem tamanho exato no schema, então documento de
  // tamanho estranho (o "000000" que a recepção digita em hóspede não
  // identificado) vai por cNaoNIF em vez de reprovar no schema.
  let tomaXml = '';
  if (tomador.razao_social) {
    const doc = (tomador.cpf_cnpj || '').replace(/\D/g, '');
    const docBrValido = tomador.doc_tipo !== 'passaporte' && (doc.length === 11 || doc.length === 14);
    tomaXml += '<toma>';
    if (docBrValido) {
      tomaXml += doc.length === 14 ? `<CNPJ>${doc}</CNPJ>` : `<CPF>${doc}</CPF>`;
    } else {
      tomaXml += '<cNaoNIF>2</cNaoNIF>';
    }
    tomaXml += `<xNome>${xmlEsc(tomador.razao_social)}</xNome>`;
    if (tomador.endereco && tomador.codigo_municipio && tomador.cep) {
      tomaXml += '<end>';
      tomaXml += `<endNac><cMun>${tomador.codigo_municipio}</cMun><CEP>${tomador.cep.replace(/\D/g, '')}</CEP></endNac>`;
      tomaXml += `<xLgr>${xmlEsc(tomador.endereco)}</xLgr>`;
      tomaXml += `<nro>${xmlEsc(tomador.numero || 'S/N')}</nro>`;
      tomaXml += `<xBairro>${xmlEsc(tomador.bairro || 'Centro')}</xBairro>`;
      tomaXml += '</end>';
    }
    tomaXml += '</toma>';
  }

  // opSimpNac: 1=Não optante, 2=MEI, 3=ME/EPP (Simples Nacional)
  const opSimpNac = config.optante_simples ? 3 : 1;

  const infDPS =
    `<infDPS Id="${dpsId}">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<dhEmi>${dhEmi}</dhEmi>` +
    `<verAplic>FLUXO1.0</verAplic>` +
    `<serie>${serie.replace(/\D/g, '') || '1'}</serie>` +
    `<nDPS>${numeroDPS}</nDPS>` +
    `<dCompet>${dCompet}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    `<cLocEmi>${cMun}</cLocEmi>` +
    `<prest>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<IM>${im}</IM>` +
    (config.telefone ? `<fone>${config.telefone.replace(/\D/g, '')}</fone>` : '') +
    `<regTrib>` +
    `<opSimpNac>${opSimpNac}</opSimpNac>` +
    `<regEspTrib>0</regEspTrib>` +
    `</regTrib>` +
    `</prest>` +
    tomaXml +
    `<serv>` +
    `<locPrest><cLocPrestacao>${cMun}</cLocPrestacao></locPrest>` +
    `<cServ>` +
    // Ordem do leiaute em cServ: cTribNac, cTribMun, xDescServ, cNBS, cIntContrib
    `<cTribNac>${cTribNac}</cTribNac>` +
    `<xDescServ>${xmlEsc(discriminacao)}</xDescServ>` +
    (cNBS ? `<cNBS>${cNBS}</cNBS>` : '') +
    (cIntContrib ? `<cIntContrib>${cIntContrib}</cIntContrib>` : '') +
    `</cServ>` +
    `</serv>` +
    `<valores>` +
    `<vServPrest><vServ>${valorServicos.toFixed(2)}</vServ></vServPrest>` +
    `<trib>` +
    `<tribMun>` +
    `<tribISSQN>1</tribISSQN>` +
    // tpRetISSQN: 1=não retido · 2=retido pelo tomador · 3=retido pelo
    // intermediário. Estava fixo em 2, o que é falso para hospedagem (o hotel
    // recolhe o próprio ISS) e disparava a rejeição E0237, que exige o endereço
    // nacional do tomador sempre que o ISSQN é retido por ele.
    `<tpRetISSQN>${tpRetISSQN}</tpRetISSQN>` +
    // pAliq é SEMPRE informado, inclusive sem retenção.
    //
    // Houve uma tentativa de omitir o campo quando tpRetISSQN=1, por causa da
    // rejeição E0625 ("não é permitido informar alíquota quando não há
    // indicação de retenção do ISSQN") e da nota de que a alíquota é fornecida
    // pelo sistema nos municípios conveniados. Na prática, Búzios recusou:
    // EL0496 ("alíquota do ISSQN deve ser informada para o município. Campo
    // 'pAliq' não informado"). O prefixo EL indica validação do próprio
    // município, que é quem manda aqui — ele exige a alíquota mesmo sem
    // retenção. Se algum município passar a devolver E0625 por causa deste
    // campo, aí sim vale condicionar por município, e não por retenção.
    `<pAliq>${aliq.toFixed(2)}</pAliq>` +
    `</tribMun>` +
    `<totTrib>` +
    `<vTotTrib>` +
    `<vTotTribFed>0.00</vTotTribFed>` +
    `<vTotTribEst>0.00</vTotTribEst>` +
    `<vTotTribMun>0.00</vTotTribMun>` +
    `</vTotTrib>` +
    `</totTrib>` +
    `</trib>` +
    `</valores>` +
    buildIbsCbsXml(config) +
    `</infDPS>`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DPS xmlns="${DPS_NS}" versao="1.01">` +
    infDPS +
    `</DPS>`;

  return { xml, dpsId };
}

// ── Assinatura (enveloped, Reference no Id do infDPS, Signature após) ──────

export function signDps(xml: string, dpsId: string, keyPem: string, certPem: string): string {
  const sig = new SignedXml({
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    privateKey: crypto.createPrivateKey(keyPem),
    publicCert: certPem,
  });
  sig.addReference({
    xpath: `//*[@Id='${dpsId}']`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });
  sig.computeSignature(xml, {
    location: { reference: `//*[@Id='${dpsId}']`, action: 'after' },
  });
  return sig.getSignedXml();
}

// ── Parse da NFSe retornada (XML nacional) ──────────────────────────────────

export function parseNfseXml(nfseXml: string): { numero: string | null; chave: string | null; codigoVerificacao: string | null } {
  const nNFSe = nfseXml.match(/<nNFSe>([^<]+)<\/nNFSe>/)?.[1] ?? null;
  const chave = nfseXml.match(/Id="NFS([^"]+)"/)?.[1]
    ?? nfseXml.match(/<chNFSe>([^<]+)<\/chNFSe>/)?.[1] ?? null;
  const cVerif = nfseXml.match(/<cVerif>([^<]+)<\/cVerif>/)?.[1] ?? null;
  return { numero: nNFSe, chave, codigoVerificacao: cVerif };
}

// A API devolve `descricao` genérica ("Falha no esquema XML do DF-e") e joga o
// diagnóstico de verdade em `complemento` (linha, coluna, elemento e motivo).
// Ignorar o complemento transformava um erro perfeitamente diagnosticável em
// "E1235: Falha no esquema XML do DF-e", que não diz nada a quem opera.
export function formatErros(data: any): string {
  if (!Array.isArray(data?.erros) || data.erros.length === 0) return '';

  const vistos = new Set<string>();
  const linhas: string[] = [];

  for (const e of data.erros) {
    const codigo = e.Codigo ?? e.codigo ?? '';
    const descricao = e.Descricao ?? e.descricao ?? '';
    const complemento = e.Complemento ?? e.complemento ?? '';
    const texto = [codigo && `${codigo}:`, descricao, complemento && `(${complemento})`]
      .filter(Boolean).join(' ').trim() || JSON.stringify(e);
    // A API repete o mesmo erro em variações (ex.: cvc-pattern-valid e
    // cvc-type.3.1.3 para o mesmo campo); sem dedup a mensagem dobra de tamanho.
    if (vistos.has(texto)) continue;
    vistos.add(texto);
    linhas.push(texto);
  }

  return linhas.join(' | ');
}

// ── Emissão ──────────────────────────────────────────────────────────────────

export async function emitirNfseELNacional(params: {
  config: ELNacionalConfig;
  tomador: ELNacionalTomador;
  items: ELNacionalItem[];
  serie: string;
  numeroDPS: number;
}): Promise<ELNacionalResult> {
  const { config } = params;

  // 1. Montar e assinar a DPS
  const { xml, dpsId } = buildDpsXml(config, params.tomador, params.items, params.serie, params.numeroDPS);
  const { key, cert } = extractPemFromPfx(config.certificado_base64, config.certificado_senha);
  const signed = signDps(xml, dpsId, key, cert);
  console.log('[NFS-e EL Nacional] DPS montada, id:', dpsId);

  // 2. GZip + Base64 e envio
  const payload = { dpsXmlGZipB64: gzipB64(signed) };
  const sendPath = elPath(config.ambiente, `/nfse?token=${encodeURIComponent(config.token)}`);
  const res = await httpsJson('POST', sendPath, payload);
  console.log('[NFS-e EL Nacional] POST nfse →', res.status, res.body.slice(0, 500));

  let data: any = {};
  try { data = JSON.parse(res.body); } catch { /* resposta não-JSON */ }

  const erros = formatErros(data);
  if ((res.status !== 200 && res.status !== 201) || erros) {
    return {
      success: false,
      xml_dps: signed,
      id_dps: data.idDPS ?? dpsId,
      chave_acesso: null,
      numero_nf: null,
      codigo_verificacao: null,
      xml_retorno: res.body,
      message: erros || `API Nacional E&L respondeu HTTP ${res.status}: ${res.body.slice(0, 300)}`,
    };
  }

  const idDPS: string = data.idDPS ?? dpsId;

  // 3. Se a NFSe já veio pronta, extrair; senão, poll no endpoint de consulta
  let nfseXml = '';
  if (data.nfseXmlGZipB64 && !String(data.nfseXmlGZipB64).startsWith('<')) {
    try { nfseXml = gunzipB64(data.nfseXmlGZipB64); } catch { /* ainda processando */ }
  }

  let chaveAcesso: string | null = null;
  for (let attempt = 0; attempt < 4 && !nfseXml; attempt++) {
    await new Promise(r => setTimeout(r, 2500));
    const cRes = await httpsJson('GET', elPath(config.ambiente, `/nfseDps/${idDPS}?token=${encodeURIComponent(config.token)}`));
    console.log(`[NFS-e EL Nacional] Poll ${attempt + 1} →`, cRes.status, cRes.body.slice(0, 300));
    let cData: any = {};
    try { cData = JSON.parse(cRes.body); } catch { continue; }
    const cErros = formatErros(cData);
    if (cErros) {
      return {
        success: false,
        xml_dps: signed,
        id_dps: idDPS,
        chave_acesso: null,
        numero_nf: null,
        codigo_verificacao: null,
        xml_retorno: cRes.body,
        message: cErros,
      };
    }
    chaveAcesso = cData.chaveAcesso ?? chaveAcesso;
    if (cData.nfseXmlGZipB64 && !String(cData.nfseXmlGZipB64).startsWith('<')) {
      try { nfseXml = gunzipB64(cData.nfseXmlGZipB64); } catch { /* ainda processando */ }
    }
  }

  const parsed = nfseXml ? parseNfseXml(nfseXml) : { numero: null, chave: null, codigoVerificacao: null };

  return {
    success: true,
    xml_dps: signed,
    id_dps: idDPS,
    chave_acesso: chaveAcesso ?? parsed.chave,
    numero_nf: parsed.numero,
    codigo_verificacao: parsed.codigoVerificacao,
    xml_retorno: nfseXml || res.body,
    message: nfseXml
      ? 'NFS-e autorizada pela Plataforma Nacional'
      : `DPS recebida pelo município (id ${idDPS}); NFS-e em processamento no ambiente nacional`,
  };
}

// ── Cancelamento (evento e101101) ────────────────────────────────────────────

// Pedido de registro de evento de cancelamento (e101101). Compartilhado com o
// formato 'adn': os dois enviam o mesmo XML assinado, muda só o transporte.
export function buildPedRegEventoXml(
  cnpjEmitente: string,
  ambiente: Ambiente,
  chaveAcesso: string,
  motivo?: string,
): { xml: string; pedId: string } {
  const cnpj = cnpjEmitente.replace(/\D/g, '');
  const tpAmb = ambiente === 'producao' ? 1 : 2;
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dhEvento = now.toISOString().slice(0, 19) + '-03:00';
  // Id: PRE + chNFSe(50) + codigo do evento
  const pedId = `PRE${chaveAcesso}101101`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<pedRegEvento xmlns="${DPS_NS}" versao="1.01">` +
    `<infPedReg Id="${pedId}">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<verAplic>FLUXO1.0</verAplic>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<CNPJAutor>${cnpj}</CNPJAutor>` +
    `<chNFSe>${chaveAcesso}</chNFSe>` +
    `<e101101>` +
    `<xDesc>Cancelamento de NFS-e</xDesc>` +
    `<cMotivo>1</cMotivo>` +
    `<xMotivo>${xmlEsc(motivo || 'Erro na emissão')}</xMotivo>` +
    `</e101101>` +
    `</infPedReg>` +
    `</pedRegEvento>`;

  return { xml, pedId };
}


export async function cancelarNfseELNacional(params: {
  config: Pick<ELNacionalConfig, 'certificado_base64' | 'certificado_senha' | 'token' | 'ambiente' | 'cnpj'>;
  chave_acesso: string;
  motivo?: string;
}): Promise<{ success: boolean; message: string; xml_retorno: string }> {
  const { config } = params;
  const { xml, pedId } = buildPedRegEventoXml(config.cnpj, config.ambiente, params.chave_acesso, params.motivo);

  const { key, cert } = extractPemFromPfx(config.certificado_base64, config.certificado_senha);
  const signed = signDps(xml, pedId, key, cert);

  const path = elPath(config.ambiente, `/nfse/${params.chave_acesso}/eventos?token=${encodeURIComponent(config.token)}`);
  const res = await httpsJson('POST', path, { pedidoRegistroEventoXmlGZipB64: gzipB64(signed) });
  console.log('[NFS-e EL Nacional] Cancelamento →', res.status, res.body.slice(0, 500));

  let data: any = {};
  try { data = JSON.parse(res.body); } catch { /* não-JSON */ }
  const erros = formatErros(data);

  if ((res.status === 200 || res.status === 201) && !erros) {
    let eventoXml = '';
    if (data.eventoXmlGZipB64) {
      try { eventoXml = gunzipB64(data.eventoXmlGZipB64); } catch { /* ignora */ }
    }
    return { success: true, message: 'Cancelamento registrado na Plataforma Nacional', xml_retorno: eventoXml || res.body };
  }
  return {
    success: false,
    message: erros || `API Nacional E&L respondeu HTTP ${res.status}: ${res.body.slice(0, 300)}`,
    xml_retorno: res.body,
  };
}

// ── Consulta por chave de acesso ────────────────────────────────────────────

// Reconsulta a NFS-e pelo idDPS. Necessário porque a API pode aceitar a DPS e
// responder que a NFS-e está "<em processamento adn nacional>": os polls curtos
// feitos na emissão não bastam quando o processamento nacional demora, e sem
// esta consulta a nota fica sem número, chave e código de verificação para
// sempre.
export async function consultarDpsELNacional(params: {
  token: string;
  ambiente: Ambiente;
  id_dps: string;
}): Promise<{
  success: boolean;
  processando: boolean;
  chave_acesso: string | null;
  numero_nf: string | null;
  codigo_verificacao: string | null;
  xml: string | null;
  message: string;
}> {
  const path = elPath(params.ambiente, `/nfseDps/${params.id_dps}?token=${encodeURIComponent(params.token)}`);
  const res = await httpsJson('GET', path);
  console.log('[NFS-e EL Nacional] Reconsulta DPS →', res.status, res.body.slice(0, 300));

  let data: any = {};
  try { data = JSON.parse(res.body); } catch { /* resposta não-JSON */ }

  const erros = formatErros(data);
  if (erros) {
    return { success: false, processando: false, chave_acesso: null, numero_nf: null, codigo_verificacao: null, xml: null, message: erros };
  }
  if (res.status !== 200 && res.status !== 201) {
    return {
      success: false, processando: false, chave_acesso: null, numero_nf: null, codigo_verificacao: null, xml: null,
      message: `API Nacional E&L respondeu HTTP ${res.status}: ${res.body.slice(0, 300)}`,
    };
  }

  // Enquanto processa, o campo vem com um texto entre < > em vez do gzip
  const bruto = data.nfseXmlGZipB64;
  if (!bruto || String(bruto).startsWith('<')) {
    return {
      success: true, processando: true,
      chave_acesso: data.chaveAcesso ?? null, numero_nf: null, codigo_verificacao: null, xml: null,
      message: 'NFS-e ainda em processamento na Plataforma Nacional. Tente novamente em alguns minutos.',
    };
  }

  let nfseXml = '';
  try { nfseXml = gunzipB64(bruto); } catch {
    return {
      success: false, processando: true, chave_acesso: data.chaveAcesso ?? null,
      numero_nf: null, codigo_verificacao: null, xml: null,
      message: 'A Plataforma devolveu a NFS-e em formato inesperado.',
    };
  }

  const parsed = parseNfseXml(nfseXml);
  return {
    success: true, processando: false,
    chave_acesso: data.chaveAcesso ?? parsed.chave,
    numero_nf: parsed.numero,
    codigo_verificacao: parsed.codigoVerificacao,
    xml: nfseXml,
    message: 'NFS-e autorizada pela Plataforma Nacional',
  };
}

export async function consultarNfseELNacional(params: {
  token: string;
  ambiente: Ambiente;
  chave_acesso: string;
}): Promise<{ success: boolean; message: string; xml: string | null }> {
  const path = elPath(params.ambiente, `/nfse/${params.chave_acesso}?token=${encodeURIComponent(params.token)}`);
  const res = await httpsJson('GET', path);
  let data: any = {};
  try { data = JSON.parse(res.body); } catch { /* não-JSON */ }
  const erros = formatErros(data);
  if (res.status === 200 && !erros && data.nfseXmlGZipB64) {
    try {
      return { success: true, message: 'NFS-e encontrada', xml: gunzipB64(data.nfseXmlGZipB64) };
    } catch { /* cai no retorno de erro */ }
  }
  return { success: false, message: erros || `HTTP ${res.status}`, xml: null };
}
