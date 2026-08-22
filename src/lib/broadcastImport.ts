// src/lib/broadcastImport.ts
// Importação de listas de telefone (Excel/CSV) para o disparo em massa, e
// geração do modelo em branco que o operador baixa antes de preencher.
//
// O modelo existe para que o formato esperado não seja adivinhado: a planilha
// sai daqui com os cabeçalhos exatos que o parser reconhece. Ainda assim o
// parser aceita variações comuns (numero, celular, whatsapp...), porque na
// prática a lista costuma vir de outro sistema e ser colada por cima.

import * as XLSX from 'xlsx';
import { formatWhatsAppNumber, isValidWhatsAppNumber } from './whatsappService';

export interface ImportedContact {
  phone: string;
  name: string;
}

export interface ImportRejection {
  /** Linha na planilha, contando o cabeçalho como linha 1 */
  line: number;
  value: string;
  reason: string;
}

export interface ImportSummary {
  contacts: ImportedContact[];
  rejected: ImportRejection[];
  /** Números repetidos dentro do próprio arquivo */
  duplicates: number;
}

const SHEET_CONTATOS = 'Contatos';

/** Cabeçalhos aceitos, já normalizados (sem acento, minúsculo) */
const PHONE_HEADERS = ['telefone', 'numero', 'number', 'phone', 'whatsapp', 'celular', 'fone'];
const NAME_HEADERS  = ['nome', 'name', 'contato', 'cliente', 'hospede'];

function normalizeHeader(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Excel entrega número de telefone como número quando a célula não é texto, e
 * aí `1.55229e+12` chega no lugar dos dígitos. Formatar o valor inteiro resolve
 * os casos reais.
 *
 * Devolve o texto **preservando o `+`**, e não só os dígitos: o `+` é o que
 * distingue "+54 9 351..." (argentino, completo) de "22999476601" (brasileiro
 * sem o código do país). Quem decide o que fazer com isso é
 * formatWhatsAppNumber.
 */
function cellToPhoneText(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.round(value)) : '';
  }
  return String(value ?? '').trim();
}

/**
 * Gera o modelo em branco. Só cabeçalho na aba de dados — sem linha de exemplo,
 * para não existir a chance de alguém disparar para um número fictício que
 * esqueceu de apagar. O exemplo fica na aba de instruções.
 */
export function buildTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const contatos = XLSX.utils.aoa_to_sheet([['telefone', 'nome']]);
  contatos['!cols'] = [{ wch: 20 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, contatos, SHEET_CONTATOS);

  const instrucoes = XLSX.utils.aoa_to_sheet([
    ['Como preencher esta planilha'],
    [],
    ['1.', 'Preencha uma linha por contato na aba "Contatos".'],
    ['2.', 'Coluna "telefone" é obrigatória. Coluna "nome" é opcional.'],
    ['3.', 'O telefone pode ter máscara: (22) 99947-6601 e 5522999476601 valem igual.'],
    ['4.', 'Número brasileiro sem o 55 na frente recebe o 55 automaticamente.'],
    ['5.', 'Número do exterior: escreva com + e o código do país. Ex: +54 9 351 123 4567.'],
    ['6.', 'Com o + na frente, nada e acrescentado ao numero — ele vai como esta.'],
    ['7.', 'Número repetido entra uma vez só.'],
    ['8.', 'Não renomeie a aba "Contatos" nem os cabeçalhos.'],
    [],
    ['Exemplo de preenchimento:'],
    ['telefone', 'nome'],
    ['5522999476601', 'Maria Silva'],
    ['(22) 99947-6601', 'Joao Souza'],
    ['22999476601', ''],
    ['+54 9 351 123 4567', 'Contato na Argentina'],
    ['+1 212 555 1234', 'Contato nos EUA'],
  ]);
  instrucoes['!cols'] = [{ wch: 22 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, instrucoes, 'Como preencher');

  return wb;
}

/** Baixa o modelo em branco no navegador */
export function downloadTemplate(fileName = 'modelo-disparo-whatsapp.xlsx'): void {
  XLSX.writeFile(buildTemplateWorkbook(), fileName);
}

/**
 * Lê a planilha e devolve contatos válidos, rejeitados e quantos repetidos
 * foram descartados. Nada é enviado aqui — a tela mostra o resumo antes.
 *
 * `knownPhones` são os números já selecionados na tela: repetir um deles não é
 * erro, só não entra de novo.
 */
export function parseContactsWorkbook(
  data: ArrayBuffer | Uint8Array,
  knownPhones: string[] = [],
): ImportSummary {
  const wb = XLSX.read(data, { type: 'array' });

  // A aba do modelo tem prioridade; se o arquivo veio de outro lugar, usa a primeira.
  const sheetName = wb.SheetNames.includes(SHEET_CONTATOS) ? SHEET_CONTATOS : wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) {
    return { contacts: [], rejected: [{ line: 0, value: '', reason: 'Planilha vazia' }], duplicates: 0 };
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  if (rows.length === 0) {
    return { contacts: [], rejected: [{ line: 0, value: '', reason: 'Planilha vazia' }], duplicates: 0 };
  }

  const header = (rows[0] || []).map(normalizeHeader);
  let phoneCol = header.findIndex(h => PHONE_HEADERS.includes(h));
  let nameCol  = header.findIndex(h => NAME_HEADERS.includes(h));

  // Arquivo sem cabeçalho reconhecível: assume 1ª coluna telefone, 2ª nome, e
  // processa a primeira linha como dado em vez de descartá-la.
  const hasHeader = phoneCol >= 0;
  if (!hasHeader) {
    phoneCol = 0;
    nameCol = 1;
  }

  const contacts: ImportedContact[] = [];
  const rejected: ImportRejection[] = [];
  const seen = new Set(knownPhones.map(p => formatWhatsAppNumber(p)));
  let duplicates = 0;

  const firstDataRow = hasHeader ? 1 : 0;

  for (let i = firstDataRow; i < rows.length; i++) {
    const row = rows[i] || [];
    const rawPhone = row[phoneCol];
    const rawName  = nameCol >= 0 ? row[nameCol] : '';
    const line = i + 1;

    const original = cellToPhoneText(rawPhone);
    const digits = original.replace(/\D/g, '');

    // Linha em branco não é erro do operador, é só espaço na planilha.
    if (!digits && !String(rawName ?? '').trim()) continue;

    if (!digits) {
      rejected.push({ line, value: original, reason: 'Telefone vazio' });
      continue;
    }
    if (!isValidWhatsAppNumber(digits)) {
      rejected.push({
        line,
        value: original,
        reason: digits.length < 10 ? 'Dígitos de menos' : 'Dígitos demais',
      });
      continue;
    }

    // `original` e não `digits`: o `+` precisa sobreviver até aqui para o
    // número estrangeiro não receber um 55 na frente.
    const phone = formatWhatsAppNumber(original);
    if (seen.has(phone)) {
      duplicates++;
      continue;
    }
    seen.add(phone);

    contacts.push({ phone, name: String(rawName ?? '').trim() || phone });
  }

  return { contacts, rejected, duplicates };
}
