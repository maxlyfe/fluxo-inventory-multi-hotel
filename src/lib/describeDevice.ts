// src/lib/describeDevice.ts
//
// Traduz user agent para algo que uma pessoa do DP entenda.
//
// O banco guarda o user agent CRU (`employee_document_views.user_agent`,
// `employee_documents.signed_user_agent`) e a leitura é derivada aqui. A ordem
// importa: se a heurística abaixo errar ou envelhecer, o dado original continua
// lá para reinterpretar. Guardar já traduzido perderia a auditoria.
//
// Não é detecção de navegador para decidir comportamento — isso seria feature
// detection. É rótulo de auditoria: "de onde a pessoa abriu o contracheque".
// Portanto errar para o genérico é aceitável, e inventar não é.

/** Ordem importa: o UA de Edge contém "Chrome", e o de Chrome contém "Safari". */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//i, 'Edge'],
  [/\bOPR\/|\bOpera\//i, 'Opera'],
  [/\bSamsungBrowser\//i, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//i, 'Firefox'],
  [/\bCriOS\//i, 'Chrome'],
  [/\bChrome\//i, 'Chrome'],
  [/\bSafari\//i, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  // Capacitor: o app Android do projeto. Reconhecido antes de "Android" para o
  // DP saber que a pessoa abriu pelo APK, não pelo navegador.
  [/\bLyFe\b|\bcapacitor\b/i, 'App LyFe'],
  [/\biPhone\b/i, 'iPhone'],
  [/\biPad\b/i, 'iPad'],
  [/\bAndroid\b/i, 'Android'],
  [/\bWindows NT\b/i, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/i, 'Mac'],
  [/\bCrOS\b/i, 'ChromeOS'],
  [/\bLinux\b/i, 'Linux'],
];

/**
 * Rótulo curto do dispositivo, ex. "Android · Chrome" ou "Windows · Edge".
 *
 * Devolve null quando não há user agent — a UI mostra "dispositivo não
 * registrado" em vez de um rótulo inventado.
 */
export function describeDevice(userAgent: string | null | undefined): string | null {
  const ua = (userAgent || '').trim();
  if (!ua) return null;

  const platform = PLATFORMS.find(([re]) => re.test(ua))?.[1] ?? null;
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;

  // "App LyFe" já diz navegador e plataforma: acrescentar "Chrome" (a WebView)
  // só confundiria quem lê.
  if (platform === 'App LyFe') return platform;

  if (platform && browser) return `${platform} · ${browser}`;
  if (platform) return platform;
  if (browser) return browser;

  // UA irreconhecível ainda é informação: mostra o começo, marcado como cru.
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}

/** `true` quando o acesso veio de celular ou tablet. */
export function isMobileDevice(userAgent: string | null | undefined): boolean {
  const ua = (userAgent || '').trim();
  if (!ua) return false;
  return /\bAndroid\b|\biPhone\b|\biPad\b|\bMobile\b|\bcapacitor\b/i.test(ua);
}
