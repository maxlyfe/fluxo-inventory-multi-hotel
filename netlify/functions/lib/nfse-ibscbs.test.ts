// Bloco <IBSCBS> da DPS da NFS-e Nacional (NT 004/007/009 SE/CGNFS-e).
//
// Obrigatório a partir de 03/08/2026 para prestadores do regime regular. O
// bloco é o ÚLTIMO filho de <infDPS>, depois de <valores> — se subir de posição
// o XML é reprovado no schema antes de chegar à Plataforma Nacional.
//
// Cobre os dois formatos alternativos à Nota Nacional da prefeitura:
//   · 'el-nacional' — DPS Nacional via API E&L (XML assinado)
//   · 'adn'         — DPS via ADN do Governo Federal (JSON)
// Os dois leem a MESMA configuração por hotel (nfse_ibs_cbs_*), então trocar de
// formato não exige reconfigurar a reforma.
import { describe, it, expect } from 'vitest';
import { buildDpsXml } from './el-nacional-nfse';
import { buildDPS } from './adn-nfse';

const REFORMA = {
  ibs_cbs_cst: '000',
  ibs_cbs_cclasstrib: '000001',
  fin_nfse: 0,
  ind_final: 1,
  c_ind_op: '100301',
  ind_dest: 0,
};

const elConfig = (reforma: boolean) => ({
  token: 'tok', ambiente: 'homologacao' as const,
  certificado_base64: '', certificado_senha: '',
  cnpj: '39232073000144', inscricao_municipal: '1607893',
  codigo_municipio: '3300233',
  codigo_servico: '090101', aliquota_iss: 5, optante_simples: false,
  telefone: '2299947660',
  ...(reforma ? REFORMA : {}),
}) as any;

const elTomador = {
  cpf_cnpj: '39232073000225', doc_tipo: 'cnpj', razao_social: 'CLIENTE TESTE',
} as any;

const elItems = [
  { description: 'HOSPEDAGEM DIARIA', quantidade: 1, valor_unitario: 450, valor_total: 450 },
] as any[];

describe("NFS-e Nacional via E&L ('el-nacional') — bloco IBSCBS", () => {
  it('não emite o bloco quando o hotel não tem CST/cClassTrib configurados', () => {
    const { xml } = buildDpsXml(elConfig(false), elTomador, elItems, '1', 1);
    expect(xml).not.toContain('<IBSCBS>');
  });

  it('emite o bloco na ordem do leiaute, como último filho de infDPS', () => {
    const { xml } = buildDpsXml(elConfig(true), elTomador, elItems, '1', 1);
    expect(xml).toContain(
      '<IBSCBS>' +
      '<finNFSe>0</finNFSe>' +
      '<indFinal>1</indFinal>' +
      '<cIndOp>100301</cIndOp>' +
      '<indDest>0</indDest>' +
      '<valores><trib><gIBSCBS>' +
      '<CST>000</CST>' +
      '<cClassTrib>000001</cClassTrib>' +
      '</gIBSCBS></trib></valores>' +
      '</IBSCBS>'
    );
    // Posição: depois de </valores> do serviço e imediatamente antes de </infDPS>
    expect(xml).toContain('</valores><IBSCBS>');
    expect(xml).toContain('</IBSCBS></infDPS>');
  });
});

describe("NFS-e via ADN do Governo Federal ('adn') — bloco IBSCBS", () => {
  const adnConfig = (reforma: boolean) => ({
    cnpj: '39232073000144', inscricao_municipal: '1607893',
    codigo_municipio: '3300233', razao_social: 'MERIDIANA TURISMO LTDA',
    codigo_servico: '090101', aliquota_iss: 5,
    ...(reforma ? REFORMA : {}),
  }) as any;

  const adnTomador = { cpf_cnpj: '39232073000225', doc_tipo: 'cnpj', nome: 'CLIENTE TESTE' } as any;
  const adnItems = [
    { descricao: 'HOSPEDAGEM DIARIA', quantidade: 1, valor_unitario: 450, valor_total: 450 },
  ] as any[];

  it('não inclui IBSCBS sem CST/cClassTrib configurados', () => {
    const dps = buildDPS(adnConfig(false), adnTomador, adnItems, 'NFS', 1, 'homologacao');
    expect(dps.infDPS.IBSCBS).toBeUndefined();
  });

  it('inclui IBSCBS com os mesmos valores usados no formato el-nacional', () => {
    const dps = buildDPS(adnConfig(true), adnTomador, adnItems, 'NFS', 1, 'homologacao');
    expect(dps.infDPS.IBSCBS).toEqual({
      finNFSe: 0,
      indFinal: 1,
      cIndOp: '100301',
      indDest: 0,
      valores: { trib: { gIBSCBS: { CST: '000', cClassTrib: '000001' } } },
    });
  });

  it('mantém IBSCBS como última chave de infDPS (paridade com o XML)', () => {
    const dps = buildDPS(adnConfig(true), adnTomador, adnItems, 'NFS', 1, 'homologacao');
    const keys = Object.keys(dps.infDPS);
    expect(keys[keys.length - 1]).toBe('IBSCBS');
  });
});
