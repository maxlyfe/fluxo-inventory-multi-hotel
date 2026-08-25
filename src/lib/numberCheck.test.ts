import { describe, it, expect } from 'vitest';
import { matchNumberChecks } from './evolutionService';

describe('matchNumberChecks', () => {
  it('lê o formato de array puro do Evolution v2', () => {
    const r = matchNumberChecks(['5522999476601', '5522888887777'], [
      { exists: true,  jid: '5522999476601@s.whatsapp.net', number: '5522999476601' },
      { exists: false, number: '5522888887777' },
    ]);

    expect(r).toEqual([
      { number: '5522999476601', exists: true, jid: '5522999476601@s.whatsapp.net' },
      { number: '5522888887777', exists: false, jid: undefined },
    ]);
  });

  it('aceita a resposta embrulhada em { numbers: [...] }', () => {
    const r = matchNumberChecks(['5522999476601'], {
      numbers: [{ exists: true, number: '5522999476601' }],
    });
    expect(r[0].exists).toBe(true);
  });

  it('trata jid sem campo exists como existente', () => {
    const r = matchNumberChecks(['5522999476601'], [
      { jid: '5522999476601@s.whatsapp.net' },
    ]);
    expect(r[0].exists).toBe(true);
  });

  it('casa pelo sufixo quando o WhatsApp responde sem o nono dígito', () => {
    // Consultado com 9, devolvido sem 9 — string com string perderia a resposta
    const r = matchNumberChecks(['5522999476601'], [
      { exists: true, jid: '552299476601@s.whatsapp.net' },
    ]);
    expect(r[0].exists).toBe(true);
  });

  it('casa pelo sufixo no caso inverso: consultado sem 9, devolvido com 9', () => {
    const r = matchNumberChecks(['552299476601'], [
      { exists: true, number: '5522999476601' },
    ]);
    expect(r[0].exists).toBe(true);
  });

  it('número sem resposta vira exists null, não false', () => {
    // "não sei" é diferente de "não tem": a tela não pode descartar por isso
    const r = matchNumberChecks(['5522999476601', '5511777776666'], [
      { exists: true, number: '5522999476601' },
    ]);
    expect(r[1]).toEqual({ number: '5511777776666', exists: null });
  });

  it('resposta vazia ou inesperada não inventa resultado', () => {
    expect(matchNumberChecks(['5522999476601'], null)).toEqual([
      { number: '5522999476601', exists: null },
    ]);
    expect(matchNumberChecks(['5522999476601'], { erro: 'x' })).toEqual([
      { number: '5522999476601', exists: null },
    ]);
    expect(matchNumberChecks(['5522999476601'], [{ lixo: 1 }])).toEqual([
      { number: '5522999476601', exists: null },
    ]);
  });

  it('preserva a ordem e o formato original do que foi consultado', () => {
    const entrada = ['5493511234567', '5522999476601'];
    const r = matchNumberChecks(entrada, [
      { exists: true, number: '5522999476601' },
      { exists: false, number: '5493511234567' },
    ]);
    expect(r.map(x => x.number)).toEqual(entrada);
    expect(r[0].exists).toBe(false);
    expect(r[1].exists).toBe(true);
  });

  it('lista vazia devolve vazio', () => {
    expect(matchNumberChecks([], [{ exists: true, number: '5522999476601' }])).toEqual([]);
  });
});
