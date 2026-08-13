// Regras da contingência do Web Check-in (Erbon fora do ar ou pulo com `**`).
// Ver webCheckinService.ts — a marca `**` no número da reserva é o que
// identifica a sessão manual daqui até /reception/wci-fichas.

import { describe, it, expect } from 'vitest';
import {
  isManualRef,
  toManualRef,
  stripManualRef,
  isManualSession,
} from './webCheckinService';

describe('marca de reserva manual', () => {
  it('reconhece o prefixo, com ou sem espaço em volta', () => {
    expect(isManualRef('**12345')).toBe(true);
    expect(isManualRef('  **12345 ')).toBe(true);
    expect(isManualRef('12345')).toBe(false);
    expect(isManualRef('')).toBe(false);
    expect(isManualRef(null)).toBe(false);
  });

  it('não duplica o prefixo quando a recepção já digitou **', () => {
    expect(toManualRef('12345')).toBe('**12345');
    expect(toManualRef('**12345')).toBe('**12345');
    expect(toManualRef('****12345')).toBe('**12345');
    expect(toManualRef('  ** 12345 ')).toBe('**12345');
  });

  it('devolve o número limpo para exibir ou casar com a reserva real', () => {
    expect(stripManualRef('**12345')).toBe('12345');
    expect(stripManualRef('12345')).toBe('12345');
    expect(stripManualRef(null)).toBe('');
  });
});

describe('sessão manual', () => {
  it('é manual quando o número carrega a marca', () => {
    expect(isManualSession(987654, '**12345')).toBe(true);
  });

  it('é manual quando o booking_id é sintético (timestamp)', () => {
    expect(isManualSession(1786000000000, null)).toBe(true);
  });

  it('não é manual numa reserva Erbon de verdade', () => {
    expect(isManualSession(987654, '12345')).toBe(false);
    expect(isManualSession(987654, null)).toBe(false);
  });
});
