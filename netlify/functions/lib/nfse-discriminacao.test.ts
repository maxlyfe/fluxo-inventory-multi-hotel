// Limite de 2000 caracteres da discriminação dos serviços (rejeição E1235
// "cvc-maxLength-valid ... maxLength '2000' for type 'TSDesc2000'").
//
// O caso que motivou isto: um check-out real de 5 diárias com pensão no Costa
// do Sol gerou 2263 caracteres, porque cada refeição de MAP/FAP entra como uma
// linha de R$ 0,00 repetida todo dia.
import { describe, it, expect } from 'vitest';
import { buildDiscriminacao, NFSE_DISCRIMINACAO_MAX } from './nfse-discriminacao';

const item = (description: string, valor_unitario: number, quantidade = 1) => ({
  description, quantidade, valor_unitario, valor_total: valor_unitario * quantidade,
});

// Reproduz a forma da conta que estourou: diárias + pensão zerada repetida.
const contaLonga = [
  item('Taxa de Turismo', 33), item('Taxa de Turismo', 5.5),
  ...Array.from({ length: 5 }, () => [
    item('Diária', 364.51),
    item('DADINHO DE TAPIOCA ENTRADA', 0),
    item('BRUSQUETA GRATINADA ENTRADA', 0),
    item('SALADA DE FRUTAS - SOBREMESA', 0),
    item('DUO DE SORVETES - SOBREMESA', 0),
    item('CREPE COM DOCE DE LEITE - SOBREMESA', 0),
    item('ROMEO E JULIETA - SOBREMESA', 0),
    item('BROWNIE COM SORVETE - SOBREMESA', 0),
  ]).flat(),
  item('OSSOBUCO BRASEADO - PP', 50), item('NHOQUES DE BATATA E ESPINAFRE - PP', 100),
  item('FRANGO DESOSSADO - PP', 100), item('PIZZA MARGUERITA', 50),
  item('MAP/FAP NÃO CONSUMIDO', 150), item('Acerto de Diárias - diverso', 0.02),
];

describe('discriminação da NFS-e — teto de 2000 caracteres', () => {
  it('não mexe na conta que já cabe', () => {
    const itens = [item('Diária', 364.51), item('Taxa de Turismo', 33)];
    expect(buildDiscriminacao(itens, ' | ')).toBe(
      'Diária - Qtd: 1 x R$ 364.51 = R$ 364.51 | Taxa de Turismo - Qtd: 1 x R$ 33.00 = R$ 33.00',
    );
  });

  it('mantém a conta real de 5 diárias com pensão dentro do limite', () => {
    const texto = buildDiscriminacao(contaLonga, ' | ');
    expect(texto.length).toBeLessThanOrEqual(NFSE_DISCRIMINACAO_MAX);
  });

  it('agrupa item repetido de mesmo valor unitário somando quantidade e total', () => {
    const texto = buildDiscriminacao(contaLonga, ' | ');
    expect(texto).toContain('Diária - Qtd: 5 x R$ 364.51 = R$ 1822.55');
    expect(texto).toContain('DADINHO DE TAPIOCA ENTRADA - Qtd: 5 x R$ 0.00 = R$ 0.00');
    // Preços diferentes do mesmo prato continuam em linhas separadas.
    expect(texto).toContain('Taxa de Turismo - Qtd: 1 x R$ 33.00 = R$ 33.00');
    expect(texto).toContain('Taxa de Turismo - Qtd: 1 x R$ 5.50 = R$ 5.50');
  });

  it('resume o excedente quando nem agrupado cabe, sem esconder o valor', () => {
    const itens = Array.from({ length: 200 }, (_, i) => item(`SERVICO AVULSO NUMERO ${i}`, 10));
    const texto = buildDiscriminacao(itens, ' | ');
    expect(texto.length).toBeLessThanOrEqual(NFSE_DISCRIMINACAO_MAX);
    expect(texto).toMatch(/\(\+ \d+ itens - R\$ \d+\.\d{2}\)$/);
  });

  it('corta na marra quando um único item já não cabe', () => {
    const texto = buildDiscriminacao([item('X'.repeat(3000), 10)], ' | ');
    expect(texto.length).toBe(NFSE_DISCRIMINACAO_MAX);
  });
});
