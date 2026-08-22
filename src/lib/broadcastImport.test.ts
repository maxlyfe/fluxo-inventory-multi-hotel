import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseContactsWorkbook, buildTemplateWorkbook } from './broadcastImport';

/** Monta um .xlsx em memória a partir de linhas, como o arquivo que o usuário sobe */
function planilha(rows: unknown[][], sheetName = 'Contatos'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

describe('parseContactsWorkbook', () => {
  it('lê telefone e nome do modelo', () => {
    const r = parseContactsWorkbook(planilha([
      ['telefone', 'nome'],
      ['5522999476601', 'Maria'],
      ['21988887777', 'Joao'],
    ]));

    expect(r.contacts).toEqual([
      { phone: '5522999476601', name: 'Maria' },
      { phone: '5521988887777', name: 'Joao' },
    ]);
    expect(r.rejected).toHaveLength(0);
  });

  it('normaliza máscara e acrescenta o 55 quando falta', () => {
    const r = parseContactsWorkbook(planilha([
      ['telefone', 'nome'],
      ['(22) 99947-6601', 'Com mascara'],
    ]));
    expect(r.contacts[0].phone).toBe('5522999476601');
  });

  it('aceita telefone que o Excel entregou como número', () => {
    const r = parseContactsWorkbook(planilha([
      ['telefone', 'nome'],
      [5522999476601, 'Numerico'],
    ]));
    expect(r.contacts[0].phone).toBe('5522999476601');
  });

  it('aceita cabeçalhos alternativos e com acento', () => {
    const r = parseContactsWorkbook(planilha([
      ['Número', 'Contato'],
      ['5522999476601', 'Maria'],
    ]));
    expect(r.contacts).toEqual([{ phone: '5522999476601', name: 'Maria' }]);
  });

  it('descarta repetido dentro do arquivo, contando quantos', () => {
    const r = parseContactsWorkbook(planilha([
      ['telefone', 'nome'],
      ['5522999476601', 'Maria'],
      ['22999476601', 'Maria de novo'],
    ]));
    expect(r.contacts).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });

  it('não repete quem já está selecionado na tela', () => {
    const r = parseContactsWorkbook(
      planilha([['telefone', 'nome'], ['5522999476601', 'Maria']]),
      ['22999476601'],
    );
    expect(r.contacts).toHaveLength(0);
    expect(r.duplicates).toBe(1);
  });

  it('rejeita número curto apontando a linha', () => {
    const r = parseContactsWorkbook(planilha([
      ['telefone', 'nome'],
      ['999476601', 'Curto'],
      ['5522999476601', 'Ok'],
    ]));
    expect(r.contacts).toHaveLength(1);
    expect(r.rejected).toEqual([{ line: 2, value: '999476601', reason: 'Dígitos de menos' }]);
  });

  it('ignora linha em branco sem virar erro', () => {
    const r = parseContactsWorkbook(planilha([
      ['telefone', 'nome'],
      ['5522999476601', 'Maria'],
      ['', ''],
    ]));
    expect(r.contacts).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it('sem cabeçalho reconhecível, usa a 1a coluna e não perde a 1a linha', () => {
    const r = parseContactsWorkbook(planilha([
      ['5522999476601', 'Maria'],
      ['5521988887777', 'Joao'],
    ]));
    expect(r.contacts).toHaveLength(2);
  });

  it('usa o telefone como nome quando o nome está vazio', () => {
    const r = parseContactsWorkbook(planilha([['telefone', 'nome'], ['5522999476601', '']]));
    expect(r.contacts[0].name).toBe('5522999476601');
  });

  it('prefere a aba "Contatos" quando o arquivo tem várias', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['telefone'], ['5511111111111']]), 'Outra');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['telefone'], ['5522999476601']]), 'Contatos');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;

    const r = parseContactsWorkbook(buf);
    expect(r.contacts).toEqual([{ phone: '5522999476601', name: '5522999476601' }]);
  });
});

describe('buildTemplateWorkbook', () => {
  it('sai com a aba Contatos só com cabeçalho, para não disparar exemplo por engano', () => {
    const wb = buildTemplateWorkbook();
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Contatos'], { header: 1, blankrows: false });
    expect(rows).toEqual([['telefone', 'nome']]);
  });

  it('o modelo é lido de volta pelo parser sem erro', () => {
    const buf = XLSX.write(buildTemplateWorkbook(), { type: 'array', bookType: 'xlsx' }) as Uint8Array;
    const r = parseContactsWorkbook(buf);
    expect(r.contacts).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });
});
