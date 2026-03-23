import { describe, it, expect } from 'vitest';
import { normalizeText, searchMatch } from './search';

describe('normalizeText', () => {
  it('converte para minúsculas', () => {
    expect(normalizeText('HELLO')).toBe('hello');
  });

  it('remove acentos', () => {
    expect(normalizeText('café')).toBe('cafe');
    expect(normalizeText('ação')).toBe('acao');
    expect(normalizeText('FÉRIAS')).toBe('ferias');
  });

  it('trata string vazia', () => {
    expect(normalizeText('')).toBe('');
  });

  it('preserva números e caracteres especiais', () => {
    expect(normalizeText('R$ 1.234,56')).toBe('r$ 1.234,56');
  });

  it('remove cedilha', () => {
    expect(normalizeText('Recepção')).toBe('recepcao');
  });

  it('remove til', () => {
    expect(normalizeText('manutenção')).toBe('manutencao');
    expect(normalizeText('São Paulo')).toBe('sao paulo');
  });
});

describe('searchMatch', () => {
  it('match exato', () => {
    expect(searchMatch('hotel', 'hotel')).toBe(true);
  });

  it('match case insensitive', () => {
    expect(searchMatch('HOTEL', 'hotel')).toBe(true);
    expect(searchMatch('hotel', 'HOTEL')).toBe(true);
  });

  it('match com acentos', () => {
    expect(searchMatch('ferias', 'FÉRIAS')).toBe(true);
    expect(searchMatch('FÉRIAS', 'ferias')).toBe(true);
  });

  it('match parcial', () => {
    expect(searchMatch('hot', 'Hotel Central')).toBe(true);
  });

  it('não dá match quando não contém', () => {
    expect(searchMatch('xyz', 'Hotel Central')).toBe(false);
  });

  it('string vazia dá match em tudo', () => {
    expect(searchMatch('', 'qualquer coisa')).toBe(true);
  });

  it('busca em string vazia não dá match (exceto busca vazia)', () => {
    expect(searchMatch('algo', '')).toBe(false);
  });
});
