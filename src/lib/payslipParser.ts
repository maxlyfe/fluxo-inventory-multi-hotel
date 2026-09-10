// src/lib/payslipParser.ts
//
// Leitura do "Demonstrativo de Pagamento de Salário" e casamento com o
// colaborador cadastrado.
//
// Módulo puro (sem React, sem Supabase) porque é a peça mais frágil do módulo:
// depende do layout de um sistema de folha que não controlamos. Sendo puro, dá
// para travar o comportamento em teste com o texto de um contracheque real,
// e a regressão aparece no `npm test` em vez de aparecer numa competência
// inteira conciliada errado.
//
// Duas decisões que importam:
//
// 1. **A coluna define a natureza da verba, não o código.** No layout, o mesmo
//    `329,58` é vencimento ou desconto pela coluna em que está impresso. Por
//    isso o parser trabalha sobre `PdfTextLine` (com as coordenadas X) e não
//    sobre texto plano: as posições dos títulos "Vencimentos"/"Descontos" dão a
//    régua, o que sobrevive a mudança de largura de página ou de fonte.
//
// 2. **O CPF não está no documento.** O layout traz matrícula + nome + CNPJ do
//    empregador. A matrícula (`employees.payroll_code`) é a chave boa; o nome é
//    fallback e o CPF entra só se algum layout futuro passar a trazê-lo.

import { normalizeText, searchMatchAll } from '../utils/search';
import type { PdfTextLine } from './pdfjsLoader';

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Uma verba do contracheque. Vencimento e desconto são mutuamente exclusivos. */
export interface PayslipLine {
  code: string | null;
  description: string;
  reference: string | null;
  earning: number | null;
  deduction: number | null;
}

/**
 * Onde estampar a assinatura no proprio documento.
 *
 * Tudo normalizado (0 a 1 da pagina), porque o PDF final e A4 e o documento
 * original nao necessariamente e. Origem no canto superior esquerdo.
 */
export interface SignatureAnchor {
  /** Centro horizontal da linha de assinatura */
  signatureCenterX: number;
  /** Linha de base do rotulo "ASSINATURA DO FUNCIONARIO" */
  signatureBaselineY: number;
  /** Centro horizontal do campo de data, quando o documento tem um */
  dateCenterX: number | null;
  dateBaselineY: number | null;
}

export interface ParsedPayslip {
  employerName: string | null;
  employerCnpj: string | null;
  payrollCode: string | null;
  employeeName: string | null;
  employeeCpf: string | null;
  periodStart: string | null;   // ISO (yyyy-mm-dd)
  periodEnd: string | null;     // ISO
  referenceMonth: string | null; // ISO, dia 1 do mês de competência
  lines: PayslipLine[];
  totalEarnings: number | null;
  totalDeductions: number | null;
  netPay: number | null;
  baseSalary: number | null;
  baseInss: number | null;
  baseFgts: number | null;
  fgtsMonth: number | null;
  baseIrrf: number | null;
  irrfBracket: string | null;
  /**
   * Posicao da linha de assinatura no documento, quando encontrada. Null em
   * imagem ou PDF escaneado (sem camada de texto).
   */
  signatureAnchor: SignatureAnchor | null;
  /** Sinais de leitura incompleta, mostrados na tela de conciliação. */
  warnings: string[];
}

/** Só o que o casamento precisa saber sobre um colaborador. */
export interface MatchableEmployee {
  id: string;
  name: string;
  cpf?: string | null;
  payroll_code?: string | null;
  hotel_id?: string | null;
  sector?: string | null;
  status?: string | null;
}

export type MatchReason =
  | 'payroll_code'
  | 'cpf'
  | 'exact_name'
  | 'name_terms'
  | 'none';

export interface EmployeeMatch<T extends MatchableEmployee = MatchableEmployee> {
  employee: T | null;
  /** 0 a 1. Acima de HIGH_CONFIDENCE a tela permite confirmar em lote. */
  confidence: number;
  reason: MatchReason;
  /** Mais de um candidato com a mesma pontuação: exige escolha manual. */
  ambiguous: boolean;
}

/** Piso para "confirmar automaticamente os de alta confiança". */
export const HIGH_CONFIDENCE = 0.9;

// ── Helpers numéricos ────────────────────────────────────────────────────────

/**
 * Converte número em formato brasileiro (`3.730,00`) para `number`.
 *
 * Não usa `useFormatters().parseNumber` porque aquele é hook e este módulo é
 * puro. A regra é a mesma: ponto é separador de milhar, vírgula é decimal.
 */
export function parseBrNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** Só os dígitos — CPF e CNPJ chegam formatados de um lado e crus do outro. */
export function onlyDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

/** Reconhece um valor monetário brasileiro: exige a parte decimal. */
const MONEY = /^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/;

function isMoney(token: string): boolean {
  return MONEY.test(token.trim());
}

/** `dd/mm/yyyy` para ISO. Devolve null em data inválida. */
function brDateToIso(value: string): string | null {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d), month = Number(mo), year = Number(y);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`.length === 10 && year > 1900
    ? `${y}-${mo}-${d}`
    : null;
}

// ── Régua de colunas ─────────────────────────────────────────────────────────

interface Columns {
  reference: number | null;
  earnings: number | null;
  deductions: number | null;
}

/**
 * Acha o X dos títulos das colunas de valores.
 *
 * Auto-calibração: em vez de fixar "o desconto fica depois do pixel N", lê onde
 * o próprio documento imprimiu os títulos. Se o layout mudar de largura, a régua
 * acompanha.
 */
export function resolveColumns(lines: PdfTextLine[]): Columns {
  const header = lines.find(l => {
    const t = normalizeText(l.text);
    return t.includes('vencimento') && t.includes('desconto');
  });

  if (!header) return { reference: null, earnings: null, deductions: null };

  const findX = (needle: string): number | null => {
    const part = header.parts.find(p => normalizeText(p.text).includes(needle));
    return part ? part.x : null;
  };

  return {
    reference: findX('referencia'),
    earnings: findX('vencimento'),
    deductions: findX('desconto'),
  };
}

// ── Parser ───────────────────────────────────────────────────────────────────

/** Linha de verba: começa com o código de 3+ dígitos da rubrica. */
const VERBA = /^(\d{3,4})\s+(.+)$/;

/**
 * Sufixo de razão social, usado para separar a linha da EMPRESA da linha do
 * COLABORADOR — as duas começam com um código numérico zero-padded seguido de
 * nome em maiúsculas, e no exemplo real o código da empresa (`00437`) e o do
 * colaborador (`000118`) têm comprimentos parecidos, então não há como
 * distinguir pelo formato.
 *
 * `\b...\b` importa: sem as bordas, `SA` casaria dentro de "SALÁRIO" e a
 * primeira linha de verba seria lida como razão social.
 */
const COMPANY_SUFFIX = /\b(LTDA|EIRELI|MEI|EPP|S\/A|S\.A\.?|SA)\b/i;

/**
 * Lê um contracheque a partir das linhas posicionadas de UMA página.
 *
 * Nunca lança: um layout inesperado devolve o que deu para ler mais os avisos
 * em `warnings`, e a tela de conciliação pede confirmação manual. Lançar aqui
 * derrubaria o lote inteiro por causa de uma página torta.
 */
export function parsePayslip(lines: PdfTextLine[]): ParsedPayslip {
  const warnings: string[] = [];
  const result: ParsedPayslip = {
    employerName: null, employerCnpj: null,
    payrollCode: null, employeeName: null, employeeCpf: null,
    periodStart: null, periodEnd: null, referenceMonth: null,
    lines: [],
    totalEarnings: null, totalDeductions: null, netPay: null,
    baseSalary: null, baseInss: null, baseFgts: null,
    fgtsMonth: null, baseIrrf: null, irrfBracket: null,
    signatureAnchor: null,
    warnings,
  };

  if (lines.length === 0) {
    warnings.push('Documento sem camada de texto (imagem ou PDF escaneado) — atribuição manual.');
    return result;
  }

  const all = lines.map(l => l.text);
  const joined = all.join('\n');

  // ── Empregador ────────────────────────────────────────────────────────────
  const cnpj = joined.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/);
  if (cnpj) result.employerCnpj = cnpj[1];

  // O cabeçalho é "00437 MERIDIANA TURISMO LTDA Demonstrativo de Pagamento...".
  // O código da empresa e o título à direita saem fora.
  const employerLine = all.find(t => /^\d{3,7}\s+\S/.test(t) && COMPANY_SUFFIX.test(t));
  if (employerLine) {
    const m = employerLine.match(/^\d{3,7}\s+(.+?)(?:\s+Demonstrativo.*)?$/i);
    if (m) result.employerName = m[1].trim();
  }

  // ── Período de competência ────────────────────────────────────────────────
  const period = joined.match(/(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
  if (period) {
    result.periodStart = brDateToIso(period[1]);
    result.periodEnd = brDateToIso(period[2]);
    if (result.periodStart) result.referenceMonth = `${result.periodStart.slice(0, 7)}-01`;
  } else {
    warnings.push('Período de competência não encontrado.');
  }

  // ── Colaborador ───────────────────────────────────────────────────────────
  // Linha "000118 MAXIMILIANO GONZALO LOPEZ Y FERNANDEZ COMPRADOR": matrícula
  // zero-padded, nome em maiúsculas, cargo à direita. O cargo não é separável
  // do nome com segurança (ambos em maiúsculas, sem delimitador), então fica
  // dentro de `employeeName` e o casamento por termos lida com o ruído.
  //
  // Buscada entre o topo e o cabeçalho da tabela de verbas, e é a ÚLTIMA
  // candidata: a linha da empresa tem o mesmo formato e vem antes. Excluir por
  // COMPANY_SUFFIX sozinho não bastaria numa razão social sem sufixo.
  const columnsHeaderIndex = lines.findIndex(l => {
    const t = normalizeText(l.text);
    return t.includes('vencimento') && t.includes('desconto');
  });
  const searchLimit = columnsHeaderIndex === -1 ? all.length : columnsHeaderIndex;

  const employeeCandidates = all
    .slice(0, searchLimit)
    .filter(t => /^0\d{4,7}\s+\p{Lu}/u.test(t) && !COMPANY_SUFFIX.test(t));

  const employeeLine = employeeCandidates[employeeCandidates.length - 1];
  if (employeeLine) {
    const m = employeeLine.match(/^(0\d{4,7})\s+(.+)$/u);
    if (m) {
      result.payrollCode = m[1];
      result.employeeName = m[2].replace(/\s+/g, ' ').trim();
    }
  } else {
    warnings.push('Matrícula e nome do colaborador não encontrados.');
  }

  const cpf = joined.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/);
  if (cpf) result.employeeCpf = cpf[1];

  // ── Verbas ────────────────────────────────────────────────────────────────
  const columns = resolveColumns(lines);
  if (columns.earnings === null || columns.deductions === null) {
    warnings.push('Colunas de vencimentos e descontos não identificadas — verbas podem sair invertidas.');
  }

  for (const line of lines) {
    const verba = line.text.match(VERBA);
    if (!verba) continue;

    const [, code, rest] = verba;

    // Os valores são os fragmentos monetários; a descrição é o que sobra à
    // esquerda do primeiro deles.
    const moneyParts = line.parts.filter(p => isMoney(p.text));
    if (moneyParts.length === 0) continue;

    const firstMoneyX = moneyParts[0].x;

    // A descrição termina onde começa a coluna "Referência" — sem esse corte,
    // "SALÁRIO BASE" viria como "SALÁRIO BASE 220:00".
    const descriptionLimit = columns.reference !== null
      ? Math.min(columns.reference, firstMoneyX)
      : firstMoneyX;

    const description = line.parts
      .filter(p => p.x < descriptionLimit && p.text.trim() !== code)
      .map(p => p.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() || rest.trim();

    // "Referência" é o token não monetário à direita da descrição: "220:00",
    // ou "8,97" que passa a ser monetário — daí a checagem pela coluna.
    let reference: string | null = null;
    if (columns.reference !== null) {
      const refPart = line.parts.find(
        p => Math.abs(p.x - columns.reference!) < 40 && /[\d:,]/.test(p.text) && p.x > firstMoneyX - 300,
      );
      if (refPart && !isMoney(refPart.text)) reference = refPart.text.trim();
    }
    if (!reference) {
      const refMatch = rest.match(/\b(\d{1,3}:\d{2})\b/);
      if (refMatch) reference = refMatch[1];
    }

    let earning: number | null = null;
    let deduction: number | null = null;

    for (const part of moneyParts) {
      // Um token de referência tipo "8,97" casa com MONEY: se estiver na coluna
      // de referência, não é valor.
      if (reference && part.text.trim() === reference) continue;

      const value = parseBrNumber(part.text);
      if (value === null) continue;

      const isDeduction = classifyColumn(part.x, columns);
      if (isDeduction) deduction = value;
      else earning = value;
    }

    if (earning === null && deduction === null) continue;

    result.lines.push({ code, description, reference, earning, deduction });
  }

  if (result.lines.length === 0) warnings.push('Nenhuma verba lida.');

  // ── Totais ────────────────────────────────────────────────────────────────
  result.netPay = findLabeledMoney(lines, ['valor liquido', 'liquido a receber']);
  if (result.netPay === null) warnings.push('Valor líquido não encontrado.');

  const totals = findTotalsLine(lines, columns, result.netPay);
  result.totalEarnings = totals.earnings;
  result.totalDeductions = totals.deductions;

  // ── Bases (rodapé) ────────────────────────────────────────────────────────
  const footer = readFooterBases(lines);
  result.baseSalary = footer.baseSalary;
  result.baseInss = footer.baseInss;
  result.baseFgts = footer.baseFgts;
  result.fgtsMonth = footer.fgtsMonth;
  result.baseIrrf = footer.baseIrrf;
  result.irrfBracket = footer.irrfBracket;

  // ── Onde assinar ──────────────────────────────────────────────────────────
  result.signatureAnchor = findSignatureAnchor(lines);
  if (!result.signatureAnchor) {
    warnings.push('Linha de assinatura não localizada — a rubrica irá num bloco ao pé da página.');
  }

  // ── Conferência aritmética ────────────────────────────────────────────────
  // Se as verbas somam o total impresso, a leitura das colunas está certa.
  // É a checagem que pega inversão de coluna, que é o erro silencioso perigoso.
  const sumEarnings = sum(result.lines.map(l => l.earning));
  const sumDeductions = sum(result.lines.map(l => l.deduction));

  if (result.totalEarnings !== null && !closeEnough(sumEarnings, result.totalEarnings)) {
    warnings.push(
      `Soma dos vencimentos (${sumEarnings.toFixed(2)}) diverge do total impresso (${result.totalEarnings.toFixed(2)}).`,
    );
  }
  if (result.totalDeductions !== null && !closeEnough(sumDeductions, result.totalDeductions)) {
    warnings.push(
      `Soma dos descontos (${sumDeductions.toFixed(2)}) diverge do total impresso (${result.totalDeductions.toFixed(2)}).`,
    );
  }
  if (
    result.netPay !== null &&
    result.totalEarnings !== null &&
    result.totalDeductions !== null &&
    !closeEnough(result.totalEarnings - result.totalDeductions, result.netPay)
  ) {
    warnings.push('Vencimentos menos descontos não fecha com o valor líquido.');
  }

  return result;
}

/** Vencimento ou desconto pela proximidade ao título da coluna. */
function classifyColumn(x: number, columns: Columns): boolean {
  if (columns.earnings === null || columns.deductions === null) {
    // Sem régua, o desconto é a coluna mais à direita do documento. Chute
    // declarado: a conferência aritmética acima acusa se estiver errado.
    return false;
  }
  return Math.abs(x - columns.deductions) < Math.abs(x - columns.earnings);
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/** Tolerância de 1 centavo — arredondamento de leitura, não erro de coluna. */
function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.015;
}

/** Valor monetário na mesma linha de um rótulo conhecido. */
function findLabeledMoney(lines: PdfTextLine[], labels: string[]): number | null {
  for (const line of lines) {
    const normalized = normalizeText(line.text);
    if (!labels.some(l => normalized.includes(l))) continue;
    const money = line.parts.filter(p => isMoney(p.text));
    if (money.length > 0) return parseBrNumber(money[money.length - 1].text);
  }
  return null;
}

/**
 * A linha de totais não tem rótulo: são dois valores soltos, alinhados às
 * colunas de vencimentos e descontos, logo acima do "Valor Líquido".
 *
 * Identificada por ser uma linha só de dinheiro (sem código de verba e sem
 * texto), e desempatada pelo líquido quando há mais de uma candidata.
 */
function findTotalsLine(
  lines: PdfTextLine[],
  columns: Columns,
  netPay: number | null,
): { earnings: number | null; deductions: number | null } {
  const candidates = lines.filter(line => {
    if (VERBA.test(line.text)) return false;
    if (normalizeText(line.text).replace(/[\d.,:\s]/g, '').length > 0) return false;
    return line.parts.filter(p => isMoney(p.text)).length === 2;
  });

  for (const line of candidates) {
    const money = line.parts.filter(p => isMoney(p.text));
    const a = parseBrNumber(money[0].text);
    const b = parseBrNumber(money[1].text);
    if (a === null || b === null) continue;

    const first = classifyColumn(money[0].x, columns) ? 'deduction' : 'earning';
    const earnings = first === 'earning' ? a : b;
    const deductions = first === 'earning' ? b : a;

    // Com o líquido conhecido, só aceita a candidata que fecha a conta.
    if (netPay !== null && !closeEnough(earnings - deductions, netPay)) continue;

    return { earnings, deductions };
  }

  return { earnings: null, deductions: null };
}

/**
 * Bases do rodapé: "Saldo Base | Sal. Contri. INSS | Base Cál. FGTS |
 * F.G.T.S do mês | Base Cálc. IRRF | Faixa IRRF", com os valores na linha
 * imediatamente abaixo dos títulos.
 *
 * Casa valor com título pela coluna, e não pela ordem, porque a "Faixa IRRF"
 * costuma vir vazia e um pareamento por índice deslocaria tudo à direita dela.
 */
function readFooterBases(lines: PdfTextLine[]): {
  baseSalary: number | null; baseInss: number | null; baseFgts: number | null;
  fgtsMonth: number | null; baseIrrf: number | null; irrfBracket: string | null;
} {
  const empty = {
    baseSalary: null, baseInss: null, baseFgts: null,
    fgtsMonth: null, baseIrrf: null, irrfBracket: null,
  };

  const headerIndex = lines.findIndex(l => {
    const t = normalizeText(l.text);
    return t.includes('fgts') && (t.includes('irrf') || t.includes('inss'));
  });
  if (headerIndex === -1 || headerIndex + 1 >= lines.length) return empty;

  const header = lines[headerIndex];
  const values = lines[headerIndex + 1].parts.filter(p => isMoney(p.text));
  if (values.length === 0) return empty;

  /** Valor cuja coluna é a mais próxima do título procurado. */
  const valueUnder = (...needles: string[]): number | null => {
    const titlePart = header.parts.find(p => {
      const t = normalizeText(p.text);
      return needles.every(n => t.includes(n));
    });
    if (!titlePart) return null;

    let best: { x: number; text: string } | null = null;
    let bestDistance = Infinity;
    for (const v of values) {
      const distance = Math.abs(v.x - titlePart.x);
      if (distance < bestDistance) { bestDistance = distance; best = v; }
    }
    // Além de meia página de distância não é a coluna daquele título.
    if (!best || bestDistance > 60) return null;
    return parseBrNumber(best.text);
  };

  return {
    baseSalary: valueUnder('saldo', 'base'),
    baseInss: valueUnder('inss'),
    baseFgts: valueUnder('fgts', 'base') ?? valueUnder('cal', 'fgts'),
    fgtsMonth: valueUnder('f.g.t.s') ?? valueUnder('fgts', 'mes'),
    baseIrrf: valueUnder('irrf', 'calc') ?? valueUnder('irrf', 'base'),
    irrfBracket: null,
  };
}

// ── Onde assinar ─────────────────────────────────────────────────────────────

/**
 * Localiza a linha de assinatura do documento.
 *
 * O contracheque ja tem um rodape proprio para isso: "DECLARO TER RECEBIDO A
 * IMPORTANCIA LIQUIDA DISCRIMINADA NESTE RECIBO", com um campo DATA e o rotulo
 * ASSINATURA DO FUNCIONARIO sob um traco. A rubrica tem de cair ali, no papel
 * que o colaborador reconhece, e nao numa folha extra.
 *
 * Auto-calibracao, mesma ideia de `resolveColumns`: em vez de fixar "assinatura
 * fica a 93% da altura", le onde o proprio documento imprimiu o rotulo. Layout
 * com margem diferente, ou contracheque de duas paginas, acompanha sozinho.
 *
 * Usa o CENTRO do rotulo (`xNorm + widthNorm / 2`), nao o inicio: o rotulo e
 * centrado sob o traco, entao ancorar no inicio jogaria a rubrica para a
 * direita da linha.
 */
export function findSignatureAnchor(lines: PdfTextLine[]): SignatureAnchor | null {
  if (lines.length === 0) return null;

  /** Primeiro fragmento cujo texto normalizado contem todos os termos. */
  const findPart = (...needles: string[]) => {
    for (const line of lines) {
      for (const part of line.parts) {
        const t = normalizeText(part.text);
        if (needles.every(n => t.includes(n))) return { line, part };
      }
    }
    return null;
  };

  // "ASSINATURA DO FUNCIONARIO" e o rotulo do layout atual. "assinatura"
  // sozinho e o fallback para variacoes ("Assinatura do Colaborador", "Ass. do
  // Empregado"), que erram menos que nao estampar nada.
  const signature = findPart('assinatura', 'funcionario')
    ?? findPart('assinatura', 'colaborador')
    ?? findPart('assinatura', 'empregado')
    ?? findPart('assinatura');

  if (!signature) return null;

  const center = (p: { xNorm: number; widthNorm: number }) =>
    p.xNorm + p.widthNorm / 2;

  const date = findPart('data');

  return {
    signatureCenterX: center(signature.part),
    signatureBaselineY: signature.line.yNorm,
    // O campo DATA fica ao lado da assinatura, na mesma faixa do rodape. Um
    // "data" achado muito acima (o periodo de competencia, por exemplo) nao e
    // o campo de assinar: exige estar a menos de 3% de altura do rotulo.
    dateCenterX: date && Math.abs(date.line.yNorm - signature.line.yNorm) < 0.03
      ? center(date.part)
      : null,
    dateBaselineY: date && Math.abs(date.line.yNorm - signature.line.yNorm) < 0.03
      ? date.line.yNorm
      : null,
  };
}

// ── Casamento com o colaborador ──────────────────────────────────────────────

/**
 * Encontra o colaborador de um contracheque, em cascata de confiabilidade.
 *
 * A ordem não é estética: matrícula é um identificador do próprio sistema de
 * folha e não muda; nome muda (casamento, abreviação, acento) e repete
 * (homônimo). Por isso um acerto de nome nunca chega a alta confiança sozinho,
 * e um empate de nome sai marcado como `ambiguous` para exigir escolha humana.
 *
 * `candidates` deve vir com TODOS os colaboradores do grupo, não só os da
 * unidade selecionada: o contracheque pode sair no CNPJ de uma unidade e a
 * pessoa estar cadastrada em outra.
 */
export function matchEmployee<T extends MatchableEmployee>(
  parsed: ParsedPayslip,
  candidates: T[],
): EmployeeMatch<T> {
  const miss: EmployeeMatch<T> = { employee: null, confidence: 0, reason: 'none', ambiguous: false };
  if (candidates.length === 0) return miss;

  // 1. Matrícula — comparada sem os zeros à esquerda, porque a folha imprime
  //    `000118` e o cadastro costuma guardar `118`.
  const parsedCode = stripLeadingZeros(parsed.payrollCode);
  if (parsedCode) {
    const hits = candidates.filter(c => stripLeadingZeros(c.payroll_code) === parsedCode);
    if (hits.length === 1) return { employee: hits[0], confidence: 1, reason: 'payroll_code', ambiguous: false };
    if (hits.length > 1) return { employee: hits[0], confidence: 0.6, reason: 'payroll_code', ambiguous: true };
  }

  // 2. CPF — só dígitos dos dois lados: DPEmployees grava como digitado, então
  //    o cadastro tem tanto `123.456.789-00` quanto `12345678900`.
  const parsedCpf = onlyDigits(parsed.employeeCpf);
  if (parsedCpf.length === 11) {
    const hits = candidates.filter(c => onlyDigits(c.cpf) === parsedCpf);
    if (hits.length === 1) return { employee: hits[0], confidence: 1, reason: 'cpf', ambiguous: false };
    if (hits.length > 1) return { employee: hits[0], confidence: 0.6, reason: 'cpf', ambiguous: true };
  }

  if (!parsed.employeeName) return miss;

  const parsedName = normalizeText(parsed.employeeName).trim();

  // 3. Nome idêntico. O nome lido carrega o cargo colado à direita
  //    ("... FERNANDEZ COMPRADOR"), então também vale o cadastro ser prefixo.
  const exact = candidates.filter(c => {
    const candidateName = normalizeText(c.name).trim();
    return candidateName === parsedName || parsedName.startsWith(`${candidateName} `);
  });
  if (exact.length === 1) return { employee: exact[0], confidence: 0.95, reason: 'exact_name', ambiguous: false };
  if (exact.length > 1) return { employee: exact[0], confidence: 0.5, reason: 'exact_name', ambiguous: true };

  // 4. Todos os termos do cadastro presentes no nome lido. Pega abreviação e
  //    ordem trocada, mas fica abaixo de HIGH_CONFIDENCE de propósito: exige
  //    conferência humana na tela.
  const byTerms = candidates.filter(c => c.name.trim().length > 0 && searchMatchAll(c.name, parsed.employeeName));
  if (byTerms.length === 1) return { employee: byTerms[0], confidence: 0.75, reason: 'name_terms', ambiguous: false };
  if (byTerms.length > 1) {
    // Empate desfeito pelo cadastro mais específico (mais termos casados).
    const ranked = [...byTerms].sort((a, b) => b.name.length - a.name.length);
    return { employee: ranked[0], confidence: 0.4, reason: 'name_terms', ambiguous: true };
  }

  return miss;
}

function stripLeadingZeros(value: string | null | undefined): string | null {
  const digits = onlyDigits(value);
  if (!digits) return null;
  const stripped = digits.replace(/^0+/, '');
  return stripped.length > 0 ? stripped : '0';
}
