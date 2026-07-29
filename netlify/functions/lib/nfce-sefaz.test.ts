// Estrutura dos grupos da Reforma Tributária (NT 2025.002) na NFC-e e NF-e.
//
// Estes testes existem porque a rejeição 225 da SEFAZ não diz qual elemento
// está fora de lugar: ela só reprova o XML contra o XSD. O grupo IBSCBSTot já
// foi enviado uma vez "achatado" (<vIBSUF> direto sob <IBSCBSTot>) e a nota foi
// rejeitada — os testes abaixo travam o aninhamento correto do leiaute para que
// isso não volte silenciosamente.
import { describe, it, expect } from 'vitest';
import { buildNFCeXml, buildNFeXml } from './nfce-sefaz';

const emitente = (crt: number) => ({
  cnpj: '39232073000144',
  razao_social: 'MERIDIANA TURISMO LTDA',
  nome_fantasia: 'Costa do Sol Boutique Hotel',
  inscricao_estadual: '15101946',
  crt,
  endereco_logradouro: 'Rua Neli da Costa Carvalho',
  endereco_numero: '595',
  endereco_bairro: 'Alto da Brava',
  endereco_cidade: 'Armacao dos Buzios',
  endereco_uf: 'RJ',
  endereco_cep: '28950410',
  endereco_codigo_municipio: '3300233',
  telefone: '2299947660',
}) as any;

// 17,00 + 74,90 = 91,90 → IBS 0,10% = 0,02 + 0,07 ; CBS 0,90% = 0,15 + 0,67
const items = [
  {
    nItem: 1, cProd: '001', xProd: 'AGUA MINERAL 500ML', ncm: '22011000', cfop: '5102',
    uCom: 'UN', qCom: 2, vUnCom: 8.5, vProd: 17,
    icms_orig: '0', icms_cst: '00', icms_vBC: 17, icms_pICMS: 18, icms_vICMS: 3.06,
    ibs_cbs_cst: '000', ibs_cbs_cClassTrib: '000001', ibs_aliquota: 0.1, cbs_aliquota: 0.9,
  },
  {
    nItem: 2, cProd: '002', xProd: 'REFEICAO EXECUTIVA', ncm: '21069090', cfop: '5102',
    uCom: 'UN', qCom: 1, vUnCom: 74.9, vProd: 74.9,
    icms_orig: '0', icms_cst: '00', icms_vBC: 74.9, icms_pICMS: 18, icms_vICMS: 13.48,
    ibs_cbs_cst: '000', ibs_cbs_cClassTrib: '000001', ibs_aliquota: 0.1, cbs_aliquota: 0.9,
  },
] as any[];

const nfceConfig = (ibs_cbs_enabled: boolean) => ({
  certificado_base64: '', certificado_senha: '',
  ambiente: 'homologacao' as const, serie: '1',
  csc_id: '000001', csc_token: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
  ibs_cbs_enabled,
});

function nfce(crt: number, ibsCbsOn: boolean): string {
  return buildNFCeXml({
    emitente: emitente(crt),
    destinatario: {} as any,
    items,
    config: nfceConfig(ibsCbsOn),
    nNF: 1,
    tPag: '01',
    pagamentos: [{ tPag: '01', vPag: 91.9 }],
  }).xml;
}

describe('NFC-e — grupos IBS/CBS da Reforma Tributária', () => {
  it('não emite nenhum grupo da reforma quando o hotel está desligado', () => {
    const xml = nfce(3, false);
    expect(xml).not.toContain('<IBSCBS>');
    expect(xml).not.toContain('<IBSCBSTot>');
    expect(xml).not.toContain('<vNFTot>');
  });

  it('não emite os grupos para Simples Nacional/MEI mesmo com a chave ligada (prazo Jan/2027)', () => {
    for (const crt of [1, 2, 4]) {
      const xml = nfce(crt, true);
      expect(xml, `CRT ${crt}`).not.toContain('<IBSCBS>');
      expect(xml, `CRT ${crt}`).not.toContain('<IBSCBSTot>');
    }
  });

  it('monta o grupo do item na ordem do leiaute (CST, cClassTrib, gIBSCBS)', () => {
    const xml = nfce(3, true);
    expect(xml).toContain(
      '<IBSCBS>' +
      '<CST>000</CST>' +
      '<cClassTrib>000001</cClassTrib>' +
      '<gIBSCBS>' +
      '<vBC>17.00</vBC>' +
      '<gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>0.02</vIBSUF></gIBSUF>' +
      '<gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun>' +
      '<vIBS>0.02</vIBS>' +
      '<gCBS><pCBS>0.9000</pCBS><vCBS>0.15</vCBS></gCBS>' +
      '</gIBSCBS>' +
      '</IBSCBS>'
    );
  });

  it('aninha IBSCBSTot em gIBS/gIBSUF/gIBSMun e gCBS (causa da rejeição 225)', () => {
    const xml = nfce(3, true);
    // Somatório exato dos itens: IBS 0,02 + 0,07 = 0,09 · CBS 0,15 + 0,67 = 0,82
    expect(xml).toContain(
      '<IBSCBSTot>' +
      '<vBCIBSCBS>91.90</vBCIBSCBS>' +
      '<gIBS>' +
      '<gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>0.09</vIBSUF></gIBSUF>' +
      '<gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun>' +
      '<vIBS>0.09</vIBS>' +
      '<vCredPres>0.00</vCredPres>' +
      '<vCredPresCondSus>0.00</vCredPresCondSus>' +
      '</gIBS>' +
      '<gCBS>' +
      '<vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>0.82</vCBS>' +
      '<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus>' +
      '</gCBS>' +
      '</IBSCBSTot>'
    );
    // Nunca "achatado": vIBSUF não pode ser filho direto de IBSCBSTot
    expect(xml).not.toMatch(/<IBSCBSTot><vBCIBSCBS>[\d.]+<\/vBCIBSCBS><vIBSUF>/);
  });

  it('mantém vNF sem IBS/CBS (regra de 2026) e coloca o total novo em vNFTot', () => {
    const xml = nfce(3, true);
    expect(xml).toContain('<vNF>91.90</vNF>');   // igual ao somatório dos pagamentos
    expect(xml).toContain('<vNFTot>92.81</vNFTot>'); // 91,90 + 0,09 + 0,82
  });

  it('emite IBSCBSTot e vNFTot dentro de <total>, depois de ICMSTot', () => {
    const xml = nfce(3, true);
    const total = xml.match(/<total>[\s\S]*?<\/total>/)?.[0] ?? '';
    expect(total).toContain('<IBSCBSTot>');
    expect(total.indexOf('</ICMSTot>')).toBeLessThan(total.indexOf('<IBSCBSTot>'));
    expect(total.indexOf('</IBSCBSTot>')).toBeLessThan(total.indexOf('<vNFTot>'));
  });
});

describe('NF-e (modelo 55) — grupos IBS/CBS', () => {
  const destinatario = {
    cpf_cnpj: '39232073000225', nome: 'CLIENTE TESTE', doc_tipo: 'cnpj', indIEDest: '9',
    endereco_logradouro: 'Rua Geraldo de Jesus', endereco_numero: '567', endereco_bairro: 'Brava',
    endereco_cidade: 'Armacao dos Buzios', endereco_uf: 'RJ', endereco_cep: '28950425',
    endereco_codigo_municipio: '3300233',
  } as any;

  const build = (ibs_cbs_enabled: boolean) => buildNFeXml({
    emitente: emitente(3),
    destinatario,
    items,
    config: { certificado_base64: '', certificado_senha: '', ambiente: 'homologacao', serie: '1', ibs_cbs_enabled },
    nNF: 1,
    natOp: 'VENDA DE MERCADORIA',
    tPag: '01',
  }).xml;

  it('usa o mesmo aninhamento de IBSCBSTot da NFC-e', () => {
    const xml = build(true);
    expect(xml).toContain('<IBSCBSTot><vBCIBSCBS>91.90</vBCIBSCBS><gIBS><gIBSUF>');
    expect(xml).toContain('<vIBS>0.09</vIBS>');
    expect(xml).toContain('<vNFTot>92.81</vNFTot>');
  });

  it('não emite nada da reforma quando desligado', () => {
    const xml = build(false);
    expect(xml).not.toContain('<IBSCBSTot>');
    expect(xml).not.toContain('<vNFTot>');
  });
});
