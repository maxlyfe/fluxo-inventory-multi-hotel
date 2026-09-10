// src/lib/payslipParser.test.ts
//
// Trava o comportamento do parser contra o contracheque real que originou o
// módulo (competência 03/2026, Meridiana Turismo LTDA, matrícula 000118).
//
// O fixture é montado à mão como `PdfTextLine[]` em vez de sair de um PDF de
// verdade porque é exatamente o que o PDF.js entrega: fragmentos de texto com
// coordenada X. Escrever o fixture assim mantém o teste sem depender do CDN,
// sem canvas e sem arquivo binário no repo — e, mais importante, deixa as
// COLUNAS explícitas, que é a parte que o parser pode errar em silêncio.

import { describe, it, expect } from 'vitest';
import {
  parsePayslip,
  matchEmployee,
  parseBrNumber,
  resolveColumns,
  HIGH_CONFIDENCE,
  findSignatureAnchor,
  type MatchableEmployee,
} from './payslipParser';
import type { PdfTextLine } from './pdfjsLoader';

// ── Fixture ──────────────────────────────────────────────────────────────────

// Pagina do fixture, em pontos, para as coordenadas normalizadas baterem.
const PAGE_W = 800;
const PAGE_H = 780;

/**
 * Monta uma linha a partir de pares [x, texto], como o loader devolveria.
 *
 * Normaliza x/y do mesmo jeito que `groupTextItemsIntoLines`, inclusive a
 * inversao do eixo Y (no PDF cresce para cima, na imagem para baixo). A largura
 * do fragmento e estimada em 5pt por caractere, o suficiente para o calculo do
 * CENTRO do rotulo, que e o que a ancora usa.
 */
function line(y: number, parts: [number, string][]): PdfTextLine {
  const mapped = parts.map(([x, text]) => ({
    x,
    text,
    xNorm: x / PAGE_W,
    widthNorm: (text.length * 5) / PAGE_W,
    heightNorm: 7 / PAGE_H,
  }));
  return {
    y,
    parts: mapped,
    text: mapped.map(p => p.text).join(' ').replace(/\s+/g, ' ').trim(),
    yNorm: 1 - y / PAGE_H,
  };
}

// Colunas do layout: Cód. 40 | Descrição 90 | Referência 390 |
// Vencimentos 520 | Descontos 650. Os valores são impressos alinhados à
// direita, por isso caem alguns pontos depois do início do título.
const COL_CODE = 40;
const COL_DESC = 90;
const COL_REF = 390;
const COL_EARN = 520;
const COL_DED = 650;

function payslipFixture(): PdfTextLine[] {
  return [
    line(760, [[40, '00437 MERIDIANA TURISMO LTDA'], [560, 'Demonstrativo de Pagamento de Salário']]),
    line(748, [[40, 'R NELI DA COSTA CARVALHO, SN LOTE 13 LOTE 15 LOTEAMENTO AREA UM']]),
    line(736, [[40, '01/03/2026 a 31/03/2026'], [250, 'TURISMO'], [640, '39.232.073/0001-44']]),
    line(722, [[40, '000118 MAXIMILIANO GONZALO LOPEZ Y FERNANDEZ'], [660, 'COMPRADOR']]),
    line(706, [
      [COL_CODE, 'Cód.'], [COL_DESC + 90, 'Descrição'], [COL_REF, 'Referência'],
      [COL_EARN, 'Vencimentos'], [COL_DED, 'Descontos'],
    ]),
    line(688, [[COL_CODE, '001'], [COL_DESC, 'SALÁRIO BASE'], [400, '220:00'], [545, '2.625,00']]),
    line(674, [[COL_CODE, '046'], [COL_DESC, 'BONIFICAÇÃO'], [545, '1.050,00']]),
    line(660, [[COL_CODE, '085'], [COL_DESC, 'REEMBOLSO 50% SINDICATO'], [562, '55,00']]),
    line(646, [[COL_CODE, '613'], [COL_DESC, 'CONTRIBUICAO SINDICAL'], [678, '110,00']]),
    line(632, [[COL_CODE, '903'], [COL_DESC, 'INSS Folha'], [675, '329,58']]),
    // Linha de totais: sem rótulo, dois valores alinhados às colunas.
    line(300, [[545, '3.730,00'], [675, '439,58']]),
    line(284, [[COL_EARN, 'Valor Líquido'], [675, '3.290,42']]),
    line(258, [
      [60, 'Saldo Base'], [150, 'Sal. Contri. INSS'], [290, 'Base Cál. FGTS'],
      [430, 'F.G.T.S do mês'], [540, 'Base Cálc. IRRF'], [660, 'Faixa IRRF'],
    ]),
    line(244, [[62, '2.625,00'], [152, '3.675,00'], [230, '8,97'], [292, '3.675,00'], [440, '294,00'], [545, '3.067,80']]),
    line(220, [[40, 'DECLARO TER RECEBIDO A IMPORTÂNCIA LÍQUIDA DISCRIMINADA NESTE RECIBO']]),
    // Rodape do recibo: campo de data a esquerda, rotulo da assinatura sob o traco.
    line(196, [[95, 'DATA'], [470, 'ASSINATURA DO FUNCIONÁRIO']]),
  ];
}

// ── parseBrNumber ────────────────────────────────────────────────────────────

describe('parseBrNumber', () => {
  it('lê o formato brasileiro', () => {
    expect(parseBrNumber('3.730,00')).toBe(3730);
    expect(parseBrNumber('439,58')).toBe(439.58);
    expect(parseBrNumber('8,97')).toBe(8.97);
    expect(parseBrNumber('2.625,00')).toBe(2625);
  });

  it('recusa o que não é número', () => {
    // "220:00" é referência de horas, não valor — se virasse 220 entraria como
    // verba e a soma deixaria de fechar.
    expect(parseBrNumber('220:00')).toBeNull();
    expect(parseBrNumber('COMPRADOR')).toBeNull();
    expect(parseBrNumber('')).toBeNull();
    expect(parseBrNumber(null)).toBeNull();
  });
});

// ── resolveColumns ───────────────────────────────────────────────────────────

describe('resolveColumns', () => {
  it('acha a régua pelos títulos do próprio documento', () => {
    expect(resolveColumns(payslipFixture())).toEqual({
      reference: COL_REF,
      earnings: COL_EARN,
      deductions: COL_DED,
    });
  });

  it('devolve régua vazia quando não há cabeçalho', () => {
    expect(resolveColumns([line(10, [[0, 'qualquer coisa']])])).toEqual({
      reference: null, earnings: null, deductions: null,
    });
  });
});

// ── parsePayslip ─────────────────────────────────────────────────────────────

describe('parsePayslip', () => {
  const parsed = parsePayslip(payslipFixture());

  it('lê o empregador', () => {
    expect(parsed.employerName).toBe('MERIDIANA TURISMO LTDA');
    expect(parsed.employerCnpj).toBe('39.232.073/0001-44');
  });

  it('lê matrícula e nome, não confundindo com a linha da empresa', () => {
    expect(parsed.payrollCode).toBe('000118');
    expect(parsed.employeeName).toContain('MAXIMILIANO GONZALO LOPEZ Y FERNANDEZ');
  });

  it('lê o período e deriva a competência', () => {
    expect(parsed.periodStart).toBe('2026-03-01');
    expect(parsed.periodEnd).toBe('2026-03-31');
    expect(parsed.referenceMonth).toBe('2026-03-01');
  });

  it('separa vencimento de desconto pela coluna', () => {
    expect(parsed.lines).toHaveLength(5);

    expect(parsed.lines[0]).toEqual({
      code: '001', description: 'SALÁRIO BASE', reference: '220:00',
      earning: 2625, deduction: null,
    });
    expect(parsed.lines[1]).toEqual({
      code: '046', description: 'BONIFICAÇÃO', reference: null,
      earning: 1050, deduction: null,
    });
    expect(parsed.lines[2]).toEqual({
      code: '085', description: 'REEMBOLSO 50% SINDICATO', reference: null,
      earning: 55, deduction: null,
    });

    // As duas últimas estão na coluna da direita: descontos, não vencimentos.
    expect(parsed.lines[3]).toEqual({
      code: '613', description: 'CONTRIBUICAO SINDICAL', reference: null,
      earning: null, deduction: 110,
    });
    expect(parsed.lines[4]).toEqual({
      code: '903', description: 'INSS Folha', reference: null,
      earning: null, deduction: 329.58,
    });
  });

  it('lê os totais e o líquido', () => {
    expect(parsed.totalEarnings).toBe(3730);
    expect(parsed.totalDeductions).toBe(439.58);
    expect(parsed.netPay).toBe(3290.42);
  });

  it('lê as bases do rodapé pela coluna, não pela ordem', () => {
    expect(parsed.baseSalary).toBe(2625);
    expect(parsed.baseInss).toBe(3675);
    expect(parsed.baseFgts).toBe(3675);
    expect(parsed.fgtsMonth).toBe(294);
    expect(parsed.baseIrrf).toBe(3067.8);
  });

  it('fecha a aritmética sem avisos', () => {
    // A conferência é o que protege contra inversão de coluna, que é o erro
    // silencioso perigoso: os valores estariam todos lá, só do lado errado.
    expect(parsed.warnings).toEqual([]);
  });

  it('acusa inversão de coluna quando a soma não fecha', () => {
    const broken = payslipFixture().map(l =>
      // Joga o INSS para a coluna dos vencimentos.
      l.text.startsWith('903')
        ? line(l.y, [[COL_CODE, '903'], [COL_DESC, 'INSS Folha'], [545, '329,58']])
        : l,
    );
    const result = parsePayslip(broken);
    expect(result.lines[4].earning).toBe(329.58);
    expect(result.warnings.some(w => w.includes('vencimentos'))).toBe(true);
  });

  it('não lança em documento sem camada de texto', () => {
    const result = parsePayslip([]);
    expect(result.employeeName).toBeNull();
    expect(result.lines).toEqual([]);
    expect(result.warnings[0]).toContain('sem camada de texto');
  });
});

// ── findSignatureAnchor ──────────────────────────────────────────────────────

describe('findSignatureAnchor', () => {
  it('acha a linha de assinatura pelo rótulo do próprio documento', () => {
    const anchor = findSignatureAnchor(payslipFixture());
    expect(anchor).not.toBeNull();

    // Centro do rótulo, não onde ele começa: o rótulo é centrado sob o traço,
    // então ancorar no início jogaria a rubrica para a direita da linha.
    const labelStart = 470 / PAGE_W;
    expect(anchor!.signatureCenterX).toBeGreaterThan(labelStart);
    expect(anchor!.signatureCenterX).toBeLessThan(1);

    // Y invertido: o rodapé fica na parte de baixo da imagem.
    expect(anchor!.signatureBaselineY).toBeCloseTo(1 - 196 / PAGE_H, 5);
    expect(anchor!.signatureBaselineY).toBeGreaterThan(0.5);
  });

  it('acha o campo DATA na mesma faixa do rodapé', () => {
    const anchor = findSignatureAnchor(payslipFixture());
    expect(anchor!.dateCenterX).not.toBeNull();
    // O campo de data fica à esquerda da assinatura.
    expect(anchor!.dateCenterX!).toBeLessThan(anchor!.signatureCenterX);
  });

  it('ignora "data" fora da faixa do rodapé', () => {
    // Um rótulo "Data" no cabeçalho não é o campo de assinar.
    const lines = [
      line(760, [[40, 'Data de emissão']]),
      line(196, [[470, 'ASSINATURA DO FUNCIONÁRIO']]),
    ];
    const anchor = findSignatureAnchor(lines);
    expect(anchor).not.toBeNull();
    expect(anchor!.dateCenterX).toBeNull();
  });

  it('aceita variações do rótulo', () => {
    const anchor = findSignatureAnchor([line(196, [[400, 'Assinatura do Colaborador']])]);
    expect(anchor).not.toBeNull();
  });

  it('devolve null sem camada de texto', () => {
    expect(findSignatureAnchor([])).toBeNull();
  });

  it('devolve null quando o documento não tem linha de assinatura', () => {
    expect(findSignatureAnchor([line(400, [[40, 'Relatório qualquer']])])).toBeNull();
  });
});

describe('parsePayslip — âncora de assinatura', () => {
  it('expõe a âncora no resultado, sem aviso', () => {
    const parsed = parsePayslip(payslipFixture());
    expect(parsed.signatureAnchor).not.toBeNull();
    expect(parsed.warnings).toEqual([]);
  });

  it('avisa quando não localiza a linha de assinatura', () => {
    const withoutFooter = payslipFixture().filter(l => !l.text.includes('ASSINATURA'));
    const parsed = parsePayslip(withoutFooter);
    expect(parsed.signatureAnchor).toBeNull();
    expect(parsed.warnings.some(w => w.includes('assinatura'))).toBe(true);
  });
});

// ── matchEmployee ────────────────────────────────────────────────────────────

describe('matchEmployee', () => {
  const parsed = parsePayslip(payslipFixture());

  const emp = (over: Partial<MatchableEmployee>): MatchableEmployee => ({
    id: 'x', name: 'Sem Nome', ...over,
  });

  it('casa pela matrícula ignorando zeros à esquerda', () => {
    // A folha imprime "000118"; o cadastro costuma guardar "118".
    const match = matchEmployee(parsed, [
      emp({ id: 'a', name: 'Outra Pessoa', payroll_code: '117' }),
      emp({ id: 'b', name: 'Nome Que Nem Parece', payroll_code: '118' }),
    ]);
    expect(match.employee?.id).toBe('b');
    expect(match.reason).toBe('payroll_code');
    expect(match.confidence).toBe(1);
    expect(match.ambiguous).toBe(false);
  });

  it('casa pelo CPF com formatações diferentes dos dois lados', () => {
    const withCpf = { ...parsed, employeeCpf: '123.456.789-00', payrollCode: null };
    const match = matchEmployee(withCpf, [
      emp({ id: 'a', name: 'Alguem', cpf: '12345678900' }),
    ]);
    expect(match.employee?.id).toBe('a');
    expect(match.reason).toBe('cpf');
  });

  it('casa pelo nome quando o cadastro é prefixo do que foi lido', () => {
    // O nome lido carrega o cargo colado: "... FERNANDEZ COMPRADOR".
    const match = matchEmployee(parsed, [
      emp({ id: 'a', name: 'Maximiliano Gonzalo Lopez Y Fernandez' }),
    ]);
    expect(match.employee?.id).toBe('a');
    expect(match.reason).toBe('exact_name');
    expect(match.confidence).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
  });

  it('marca homônimo como ambíguo em vez de escolher sozinho', () => {
    const match = matchEmployee(parsed, [
      emp({ id: 'a', name: 'Maximiliano Gonzalo Lopez Y Fernandez' }),
      emp({ id: 'b', name: 'Maximiliano Gonzalo Lopez Y Fernandez' }),
    ]);
    expect(match.ambiguous).toBe(true);
    expect(match.confidence).toBeLessThan(HIGH_CONFIDENCE);
  });

  it('casa nome abreviado abaixo da alta confiança', () => {
    const match = matchEmployee(parsed, [
      emp({ id: 'a', name: 'Maximiliano Fernandez' }),
    ]);
    expect(match.employee?.id).toBe('a');
    expect(match.reason).toBe('name_terms');
    expect(match.confidence).toBeLessThan(HIGH_CONFIDENCE);
  });

  it('não inventa colaborador quando não há candidato', () => {
    const match = matchEmployee(parsed, [emp({ id: 'a', name: 'Joana Pereira Silva' })]);
    expect(match.employee).toBeNull();
    expect(match.reason).toBe('none');
    expect(match.confidence).toBe(0);
  });

  it('a matrícula vence o nome quando os dois apontam para pessoas diferentes', () => {
    // Cenário real do grupo: contracheque emitido no CNPJ de outra unidade,
    // com um homônimo cadastrado na unidade errada.
    const match = matchEmployee(parsed, [
      emp({ id: 'nome', name: 'Maximiliano Gonzalo Lopez Y Fernandez' }),
      emp({ id: 'matricula', name: 'M. G. Lopez Fernandez', payroll_code: '000118' }),
    ]);
    expect(match.employee?.id).toBe('matricula');
    expect(match.reason).toBe('payroll_code');
  });
});
