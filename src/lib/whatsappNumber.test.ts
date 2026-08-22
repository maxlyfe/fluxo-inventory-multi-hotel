import { describe, it, expect } from 'vitest';
import { formatWhatsAppNumber, isValidWhatsAppNumber } from './whatsappService';

describe('formatWhatsAppNumber', () => {
  it('acrescenta 55 em numero brasileiro sem codigo de pais', () => {
    expect(formatWhatsAppNumber('22999476601')).toBe('5522999476601');
    expect(formatWhatsAppNumber('(22) 99947-6601')).toBe('5522999476601');
  });

  it('mantem brasileiro que ja tem o 55', () => {
    expect(formatWhatsAppNumber('5522999476601')).toBe('5522999476601');
  });

  it('nao mexe em numero com + na frente', () => {
    expect(formatWhatsAppNumber('+54 9 351 123 4567')).toBe('5493511234567');
    expect(formatWhatsAppNumber('+55 22 99947-6601')).toBe('5522999476601');
  });

  it('nao transforma estrangeiro de 10-11 digitos em brasileiro', () => {
    // O caso que quebrava: com 11 digitos, a regra do Brasil se aplicava
    expect(formatWhatsAppNumber('+1 212 555 1234')).toBe('12125551234');
    expect(formatWhatsAppNumber('+56 9 1234 5678')).toBe('56912345678');
  });

  it('entende o prefixo internacional 00', () => {
    expect(formatWhatsAppNumber('005493511234567')).toBe('5493511234567');
  });

  it('devolve vazio para entrada sem digito', () => {
    expect(formatWhatsAppNumber('')).toBe('');
    expect(formatWhatsAppNumber('sem numero')).toBe('');
  });
});

describe('isValidWhatsAppNumber', () => {
  it('aceita brasileiro com e sem codigo de pais', () => {
    expect(isValidWhatsAppNumber('22999476601')).toBe(true);
    expect(isValidWhatsAppNumber('+55 22 99947-6601')).toBe(true);
  });

  it('aceita estrangeiro com codigo de pais', () => {
    expect(isValidWhatsAppNumber('+54 9 351 123 4567')).toBe(true);
  });

  it('recusa curto demais e longo demais', () => {
    expect(isValidWhatsAppNumber('99947660')).toBe(false);
    expect(isValidWhatsAppNumber('1234567890123456')).toBe(false);
  });
});
