// formatErros: a API Nacional devolve `descricao` genérica e joga o diagnóstico
// real em `complemento`. Ignorar esse campo transformava um erro de schema
// perfeitamente localizável ("linha 1, coluna 943, elemento cIntContrib, valor
// 9.01 não bate com o pattern") em "E1235: Falha no esquema XML do DF-e",
// repetido duas vezes e sem nenhuma pista de onde mexer.
import { describe, it, expect } from 'vitest';
import { formatErros } from './el-nacional-nfse';

describe('formatErros', () => {
  it('inclui o complemento, que é onde vem o diagnóstico', () => {
    const msg = formatErros({
      erros: [{
        codigo: 'E1235',
        descricao: 'Falha no esquema XML do DF-e.',
        complemento: "ERRO - Linha: 1, Coluna: 943 - cvc-type.3.1.3: The value '9.01' of element 'cIntContrib' is not valid.",
      }],
    });
    expect(msg).toContain('E1235');
    expect(msg).toContain('cIntContrib');
    expect(msg).toContain("'9.01'");
  });

  it('deduplica variações do mesmo erro em vez de dobrar a mensagem', () => {
    const msg = formatErros({
      erros: [
        { codigo: 'E1235', descricao: 'Falha no esquema XML do DF-e.' },
        { codigo: 'E1235', descricao: 'Falha no esquema XML do DF-e.' },
      ],
    });
    expect(msg).toBe('E1235: Falha no esquema XML do DF-e.');
  });

  it('mantém erros distintos separados', () => {
    const msg = formatErros({
      erros: [
        { codigo: 'E1235', descricao: 'Falha no esquema.', complemento: 'campo A' },
        { codigo: 'E1235', descricao: 'Falha no esquema.', complemento: 'campo B' },
      ],
    });
    expect(msg).toContain('campo A');
    expect(msg).toContain('campo B');
    expect(msg.split(' | ')).toHaveLength(2);
  });

  it('aceita as chaves capitalizadas que a API às vezes usa', () => {
    const msg = formatErros({ erros: [{ Codigo: 'E0322', Descricao: 'NBS obrigatória.' }] });
    expect(msg).toBe('E0322: NBS obrigatória.');
  });

  it('devolve string vazia quando não há erros', () => {
    expect(formatErros({})).toBe('');
    expect(formatErros({ erros: [] })).toBe('');
  });
});
