import { describe, it, expect } from 'vitest';

// Extraímos as funções puras do hook para testar diretamente
// (mesma lógica do useFormatters, mas sem wrapper React)

function formatCurrency(value: number): string {
  if (typeof value !== 'number' || isNaN(value)) return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value: number, decimals = 2): string {
  if (typeof value !== 'number' || isNaN(value)) return '';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value);
}

function formatPercent(value: number, decimals = 2): string {
  if (typeof value !== 'number' || isNaN(value)) return '';
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent', minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value);
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR').format(d);
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------
describe('formatCurrency', () => {
  it('formata valor positivo', () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain('1.234,56');
  });

  it('formata zero', () => {
    const result = formatCurrency(0);
    expect(result).toContain('0,00');
  });

  it('formata valor negativo', () => {
    const result = formatCurrency(-50.5);
    expect(result).toContain('50,50');
  });

  it('NaN retorna vazio', () => {
    expect(formatCurrency(NaN)).toBe('');
  });

  it('não-número retorna vazio', () => {
    expect(formatCurrency('abc' as any)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------
describe('formatNumber', () => {
  it('formata com 2 casas decimais por padrão', () => {
    expect(formatNumber(1234.5)).toBe('1.234,50');
  });

  it('formata com 0 casas decimais', () => {
    expect(formatNumber(1234.5, 0)).toBe('1.235');
  });

  it('NaN retorna vazio', () => {
    expect(formatNumber(NaN)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// formatPercent
// ---------------------------------------------------------------------------
describe('formatPercent', () => {
  it('0.1 formata como 10%', () => {
    const result = formatPercent(0.1);
    expect(result).toContain('10');
    expect(result).toContain('%');
  });

  it('1 formata como 100%', () => {
    const result = formatPercent(1);
    expect(result).toContain('100');
  });

  it('NaN retorna vazio', () => {
    expect(formatPercent(NaN)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------
describe('formatDate', () => {
  it('formata data ISO string', () => {
    const result = formatDate('2026-03-15T00:00:00');
    expect(result).toContain('15');
    expect(result).toContain('03');
    expect(result).toContain('2026');
  });

  it('formata objeto Date', () => {
    const result = formatDate(new Date(2026, 2, 15)); // mês 2 = março
    expect(result).toContain('15');
  });

  it('null retorna vazio', () => {
    expect(formatDate(null)).toBe('');
  });

  it('undefined retorna vazio', () => {
    expect(formatDate(undefined)).toBe('');
  });

  it('string inválida retorna vazio', () => {
    expect(formatDate('not-a-date')).toBe('');
  });
});
