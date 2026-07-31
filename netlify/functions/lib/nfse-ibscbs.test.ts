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
import { buildDpsXmlADN } from './adn-nfse';

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
  codigo_servico: '090101', codigo_nbs: '103031100', aliquota_iss: 5, optante_simples: false,
  telefone: '2299947660',
  ...(reforma ? REFORMA : {}),
}) as any;

const elTomador = {
  cpf_cnpj: '39232073000225', doc_tipo: 'cnpj', razao_social: 'CLIENTE TESTE',
} as any;

const elItems = [
  { description: 'HOSPEDAGEM DIARIA', quantidade: 1, valor_unitario: 450, valor_total: 450 },
] as any[];

describe('DPS Nacional — código de serviço municipal em cIntContrib', () => {
  // Búzios exige o código de serviço municipal em <cIntContrib> (EL84 quando
  // ausente, E35 quando não reconhecido), mas o schema do campo tem pattern
  // [a-zA-Z0-9]{1,20} e reprova o ponto de '9.01' com E1235. O valor é enviado
  // como configurado, só filtrando o que o schema não aceita, para que a tela
  // permita ajustar a forma exata sem deploy.
  it('envia o valor configurado, filtrando pontuação', () => {
    const { xml } = buildDpsXml({ ...elConfig(true), codigo_servico_municipal: '0901' }, elTomador, elItems, '1', 1);
    expect(xml).toContain('<cIntContrib>0901</cIntContrib>');
  });

  it('preserva zeros à esquerda, que distinguem 0901 de 901', () => {
    const a = buildDpsXml({ ...elConfig(true), codigo_servico_municipal: '0901' }, elTomador, elItems, '1', 1).xml;
    const b = buildDpsXml({ ...elConfig(true), codigo_servico_municipal: '901' }, elTomador, elItems, '1', 1).xml;
    expect(a).toContain('<cIntContrib>0901</cIntContrib>');
    expect(b).toContain('<cIntContrib>901</cIntContrib>');
  });

  it('é o último elemento de cServ, depois de cNBS', () => {
    const { xml } = buildDpsXml({ ...elConfig(true), codigo_servico_municipal: '0901' }, elTomador, elItems, '1', 1);
    expect(xml).toContain('<cNBS>103031100</cNBS><cIntContrib>0901</cIntContrib></cServ>');
  });

  it('omite a tag quando não há código configurado', () => {
    const { xml } = buildDpsXml({ ...elConfig(true), codigo_servico_municipal: null }, elTomador, elItems, '1', 1);
    expect(xml).not.toContain('<cIntContrib>');
  });
});

describe('DPS Nacional — código NBS (rejeição E0322)', () => {
  it('emite <cNBS> depois de xDescServ, na ordem do leiaute de cServ', () => {
    const { xml } = buildDpsXml(elConfig(true), elTomador, elItems, '1', 1);
    expect(xml).toMatch(/<\/xDescServ><cNBS>103031100<\/cNBS>/);
  });

  it('aceita a NBS escrita com pontos e envia só os dígitos', () => {
    const { xml } = buildDpsXml({ ...elConfig(true), codigo_nbs: '1.0303.11.00' }, elTomador, elItems, '1', 1);
    expect(xml).toContain('<cNBS>103031100</cNBS>');
  });

  it('omite a tag quando não há NBS configurada', () => {
    const { xml } = buildDpsXml({ ...elConfig(true), codigo_nbs: null }, elTomador, elItems, '1', 1);
    expect(xml).not.toContain('<cNBS>');
  });
});

describe('DPS Nacional — endereço do tomador (rejeição E0234)', () => {
  const comEndereco = {
    ...elTomador,
    endereco: 'Rua Neli da Costa Carvalho',
    numero: '595',
    bairro: 'Alto da Brava',
    codigo_municipio: '3300233',
    cep: '28950-410',
  };

  it('monta <end><endNac> com código IBGE e CEP quando o endereço existe', () => {
    const { xml } = buildDpsXml(elConfig(true), comEndereco, elItems, '1', 1);
    expect(xml).toContain(
      '<end>' +
      '<endNac><cMun>3300233</cMun><CEP>28950410</CEP></endNac>' +
      '<xLgr>Rua Neli da Costa Carvalho</xLgr>' +
      '<nro>595</nro>' +
      '<xBairro>Alto da Brava</xBairro>' +
      '</end>'
    );
  });

  it('omite o bloco quando falta o código do município (não dá para montar endNac)', () => {
    const { xml } = buildDpsXml(elConfig(true), { ...comEndereco, codigo_municipio: null }, elItems, '1', 1);
    expect(xml).not.toContain('<end>');
  });
});

describe('DPS Nacional — retenção de ISSQN (tribMun)', () => {
  it('marca o ISSQN como não retido por padrão', () => {
    // tpRetISSQN=2 (retido pelo tomador) era o valor fixo antigo: além de ser
    // falso para hospedagem, disparava a rejeição E0237, que exige o endereço
    // nacional do tomador sempre que o ISSQN é retido por ele.
    const { xml } = buildDpsXml(elConfig(true), elTomador, elItems, '1', 1);
    expect(xml).toContain('<tpRetISSQN>1</tpRetISSQN>');
  });

  it('informa pAliq mesmo sem retenção (Búzios exige, rejeição EL0496)', () => {
    const { xml } = buildDpsXml(elConfig(true), elTomador, elItems, '1', 1);
    expect(xml).toContain('<tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN><pAliq>5.00</pAliq></tribMun>');
  });

  it('mantém pAliq quando há retenção pelo tomador', () => {
    const { xml } = buildDpsXml({ ...elConfig(true), tp_ret_issqn: 2 }, elTomador, elItems, '1', 1);
    expect(xml).toContain('<tpRetISSQN>2</tpRetISSQN><pAliq>5.00</pAliq>');
  });
});

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

describe("NFS-e via Sefin Nacional ('adn') — bloco IBSCBS", () => {
  const adnConfig = (reforma: boolean) => ({
    cnpj: '39232073000144', inscricao_municipal: '1607893',
    endereco_codigo_municipio: '3300233', razao_social: 'MERIDIANA TURISMO LTDA',
    codigo_servico: '090101', aliquota_iss: 5, telefone: '2299947660',
    ...(reforma ? REFORMA : {}),
  }) as any;

  const adnTomador = { nome: 'CLIENTE TESTE', doc_tipo: 'cnpj', doc_numero: '39232073000225' } as any;
  const adnItems = [
    { descricao: 'HOSPEDAGEM DIARIA', quantidade: 1, valor_unitario: 450, valor_total: 450 },
  ] as any[];

  const build = (reforma: boolean) =>
    buildDpsXmlADN(adnConfig(reforma), adnTomador, adnItems, '1', 1, 'homologacao').xml;

  it('não inclui IBSCBS sem CST/cClassTrib configurados', () => {
    expect(build(false)).not.toContain('<IBSCBS>');
  });

  it('gera exatamente o mesmo bloco IBSCBS do formato el-nacional', () => {
    const bloco = build(true).match(/<IBSCBS>[\s\S]*?<\/IBSCBS>/)?.[0];
    const blocoEl = buildDpsXml(elConfig(true), elTomador, elItems, '1', 1).xml
      .match(/<IBSCBS>[\s\S]*?<\/IBSCBS>/)?.[0];
    expect(bloco).toBeTruthy();
    expect(bloco).toBe(blocoEl);
  });

  it('mantém IBSCBS como último filho de infDPS', () => {
    expect(build(true)).toContain('</IBSCBS></infDPS>');
  });
});

describe('DPS Nacional — grupo <toma> obrigatório (rejeição E0187)', () => {
  // O grupo do tomador é exigido para o indicador de operação que emitimos.
  // Antes ele era omitido quando o hóspede não tinha CPF/CNPJ brasileiro, e a
  // nota de qualquer estrangeiro voltava com E0187.
  const buildToma = (tomador: any) =>
    buildDpsXml(elConfig(true), tomador, elItems, '1', 1).xml.match(/<toma>[\s\S]*?<\/toma>/)?.[0];

  it('identifica o tomador por CPF quando o documento tem 11 dígitos', () => {
    const toma = buildToma({ cpf_cnpj: '011.909.259-07', doc_tipo: 'cpf', razao_social: 'FULANO' });
    expect(toma).toBe('<toma><CPF>01190925907</CPF><xNome>FULANO</xNome></toma>');
  });

  it('identifica por CNPJ quando o documento tem 14 dígitos', () => {
    const toma = buildToma({ cpf_cnpj: '39.232.073/0002-25', doc_tipo: 'cnpj', razao_social: 'EMPRESA' });
    expect(toma).toContain('<CNPJ>39232073000225</CNPJ>');
  });

  // Búzios recusa cNaoNIF com EL0024 ("deve ser informado o CNPJ, CPF ou NIF
  // do tomador"). O prefixo EL é validação do município, que exige um dos três
  // identificadores — e o passaporte é o único que o hotel tem.
  it('emite o passaporte do hóspede estrangeiro em <NIF> (rejeição EL0024)', () => {
    const toma = buildToma({ cpf_cnpj: '25130937', doc_tipo: 'passaporte', razao_social: 'CARLOS LEONEL MERLO GIMENEZ' });
    expect(toma).toBe('<toma><NIF>25130937</NIF><xNome>CARLOS LEONEL MERLO GIMENEZ</xNome></toma>');
  });

  it('preserva as letras do passaporte e descarta pontuação (TSNIF é alfanumérico)', () => {
    const toma = buildToma({ cpf_cnpj: 'ab-123 456/x', doc_tipo: 'passaporte', razao_social: 'ESTRANGEIRO' });
    expect(toma).toContain('<NIF>AB123456X</NIF>');
  });

  it('respeita o teto de 40 caracteres do TSNIF', () => {
    const toma = buildToma({ cpf_cnpj: 'X'.repeat(60), doc_tipo: 'passaporte', razao_social: 'ESTRANGEIRO' });
    expect(toma).toContain(`<NIF>${'X'.repeat(40)}</NIF>`);
  });

  it('usa cNaoNIF quando o documento tem tamanho invalido para CPF/CNPJ', () => {
    const toma = buildToma({ cpf_cnpj: '000000', doc_tipo: 'cpf', razao_social: 'não identificado' });
    expect(toma).toContain('<cNaoNIF>2</cNaoNIF>');
    expect(toma).not.toContain('<CPF>');
  });

  it('usa cNaoNIF para estrangeiro sem nenhum documento', () => {
    const toma = buildToma({ cpf_cnpj: '', doc_tipo: 'passaporte', razao_social: 'ESTRANGEIRO' });
    expect(toma).toContain('<cNaoNIF>2</cNaoNIF>');
    expect(toma).not.toContain('<NIF>');
  });

  it('usa cNaoNIF quando não há documento nenhum', () => {
    const toma = buildToma({ cpf_cnpj: null, doc_tipo: null, razao_social: 'CONSUMIDOR' });
    expect(toma).toContain('<cNaoNIF>2</cNaoNIF>');
  });

  it('mantém o endereço nacional quando o tomador tem CEP e município', () => {
    const toma = buildToma({
      cpf_cnpj: '01190925907', doc_tipo: 'cpf', razao_social: 'FULANO',
      endereco: 'Rua das Pedras', numero: '10', bairro: 'Centro',
      codigo_municipio: '3300233', cep: '28950-000',
    });
    expect(toma).toContain('<end><endNac><cMun>3300233</cMun><CEP>28950000</CEP></endNac>');
    expect(toma).toContain('<nro>10</nro>');
  });
});

describe('DPS Nacional — local da prestação com tomador estrangeiro (rejeição EL0391)', () => {
  // TCLocPrest é escolha exclusiva: ou o município IBGE, ou o país ISO.
  const estrangeiro = { cpf_cnpj: '25130937', doc_tipo: 'passaporte', razao_social: 'ESTRANGEIRO' } as any;

  it('envia cPaisPrestacao=76 quando o tomador tem NIF', () => {
    const { xml } = buildDpsXml(elConfig(true), estrangeiro, elItems, '1', 1);
    expect(xml).toContain('<locPrest><cPaisPrestacao>76</cPaisPrestacao></locPrest>');
    expect(xml).not.toContain('<cLocPrestacao>');
  });

  it('mantém o município da prestação para tomador brasileiro', () => {
    const { xml } = buildDpsXml(elConfig(true), elTomador, elItems, '1', 1);
    expect(xml).toContain('<locPrest><cLocPrestacao>3300233</cLocPrestacao></locPrest>');
    expect(xml).not.toContain('<cPaisPrestacao>');
  });

  it('mantém o município quando o estrangeiro não tem documento (vai por cNaoNIF)', () => {
    const { xml } = buildDpsXml(elConfig(true), { ...estrangeiro, cpf_cnpj: '' }, elItems, '1', 1);
    expect(xml).toContain('<cLocPrestacao>3300233</cLocPrestacao>');
  });
});
