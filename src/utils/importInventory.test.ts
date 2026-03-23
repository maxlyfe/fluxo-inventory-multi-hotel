import { describe, it, expect } from 'vitest';
import { validateImportData } from './importInventory';

describe('validateImportData', () => {
  it('dados válidos retorna isValid true', () => {
    const data = [{
      nome: 'Arroz', categoria: 'Cozinha',
      quantidade: 10, minimo: 5, maximo: 20,
    }];
    const result = validateImportData(data);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('array vazio retorna erro', () => {
    const result = validateImportData([]);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('vazia');
  });

  it('não-array retorna erro', () => {
    const result = validateImportData(null as any);
    expect(result.isValid).toBe(false);
  });

  it('nome faltando retorna erro na linha correta', () => {
    const data = [{ categoria: 'Cozinha', quantidade: 10, minimo: 5, maximo: 20 }];
    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Linha 2') && e.includes('Nome'))).toBe(true);
  });

  it('categoria faltando retorna erro', () => {
    const data = [{ nome: 'Arroz', quantidade: 10, minimo: 5, maximo: 20 }];
    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Categoria'))).toBe(true);
  });

  it('quantidade negativa retorna erro', () => {
    const data = [{ nome: 'Arroz', categoria: 'Cozinha', quantidade: -1, minimo: 5, maximo: 20 }];
    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Quantidade'))).toBe(true);
  });

  it('quantidade não numérica retorna erro', () => {
    const data = [{ nome: 'Arroz', categoria: 'Cozinha', quantidade: 'abc', minimo: 5, maximo: 20 }];
    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
  });

  it('maximo menor ou igual ao minimo retorna erro', () => {
    const data = [{ nome: 'Arroz', categoria: 'Cozinha', quantidade: 10, minimo: 20, maximo: 10 }];
    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('máxima deve ser maior'))).toBe(true);
  });

  it('maximo igual ao minimo retorna erro', () => {
    const data = [{ nome: 'Arroz', categoria: 'Cozinha', quantidade: 10, minimo: 10, maximo: 10 }];
    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
  });

  it('URL de imagem inválida retorna erro', () => {
    const data = [{
      nome: 'Arroz', categoria: 'Cozinha',
      quantidade: 10, minimo: 5, maximo: 20,
      imagem_url: 'not-a-url',
    }];
    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('URL'))).toBe(true);
  });

  it('URL de imagem válida passa', () => {
    const data = [{
      nome: 'Arroz', categoria: 'Cozinha',
      quantidade: 10, minimo: 5, maximo: 20,
      imagem_url: 'https://example.com/arroz.jpg',
    }];
    const result = validateImportData(data);
    expect(result.isValid).toBe(true);
  });

  it('múltiplas linhas com erros acumula todos os erros', () => {
    const data = [
      { nome: '', categoria: '', quantidade: -1, minimo: -1, maximo: 0 },
      { nome: '', categoria: '', quantidade: -1, minimo: -1, maximo: 0 },
    ];
    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
    expect(result.errors.some(e => e.includes('Linha 2'))).toBe(true);
    expect(result.errors.some(e => e.includes('Linha 3'))).toBe(true);
  });
});
