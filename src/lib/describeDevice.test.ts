// src/lib/describeDevice.test.ts
//
// Trava a leitura de user agent usada no registro de visualização do
// contracheque. É heurística por natureza, então o valor do teste está nos
// casos em que a ordem das regras decide: o UA do Edge contém "Chrome", o do
// Chrome contém "Safari", e o do app Capacitor contém "Android".

import { describe, it, expect } from 'vitest';
import { describeDevice, isMobileDevice } from './describeDevice';

// User agents reais, encurtados só no que não afeta a detecção.
const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  appLyFe: 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 LyFe/1.1.0',
};

describe('describeDevice', () => {
  it('lê os casos comuns', () => {
    expect(describeDevice(UA.androidChrome)).toBe('Android · Chrome');
    expect(describeDevice(UA.iphoneSafari)).toBe('iPhone · Safari');
    expect(describeDevice(UA.macFirefox)).toBe('Mac · Firefox');
    expect(describeDevice(UA.windowsChrome)).toBe('Windows · Chrome');
  });

  it('não confunde Edge com Chrome', () => {
    // O UA do Edge traz "Chrome/120" antes de "Edg/120": testar Chrome primeiro
    // rotularia todo Edge como Chrome.
    expect(describeDevice(UA.windowsEdge)).toBe('Windows · Edge');
  });

  it('não confunde Chrome no iOS com Safari', () => {
    // No iOS o Chrome se identifica como "CriOS" e ainda carrega "Safari/604.1".
    expect(describeDevice(UA.iphoneChrome)).toBe('iPhone · Chrome');
  });

  it('reconhece o Samsung Internet, que também diz Chrome', () => {
    expect(describeDevice(UA.samsung)).toBe('Android · Samsung Internet');
  });

  it('reconhece o app do projeto e não anexa o navegador da WebView', () => {
    // O APK é a origem mais comum no dia a dia do colaborador; dizer
    // "Android · Chrome" ali esconderia que o acesso veio pelo app.
    expect(describeDevice(UA.appLyFe)).toBe('App LyFe');
  });

  it('devolve null sem user agent, em vez de inventar rótulo', () => {
    expect(describeDevice(null)).toBeNull();
    expect(describeDevice(undefined)).toBeNull();
    expect(describeDevice('   ')).toBeNull();
  });

  it('mostra o começo do UA irreconhecível em vez de descartar', () => {
    const out = describeDevice('AlgumClienteExotico/9.9 rodando em coisa nova');
    expect(out).toContain('AlgumClienteExotico');
  });
});

describe('isMobileDevice', () => {
  it('distingue celular de desktop', () => {
    expect(isMobileDevice(UA.androidChrome)).toBe(true);
    expect(isMobileDevice(UA.iphoneSafari)).toBe(true);
    expect(isMobileDevice(UA.appLyFe)).toBe(true);
    expect(isMobileDevice(UA.windowsChrome)).toBe(false);
    expect(isMobileDevice(UA.macFirefox)).toBe(false);
    expect(isMobileDevice(null)).toBe(false);
  });
});
