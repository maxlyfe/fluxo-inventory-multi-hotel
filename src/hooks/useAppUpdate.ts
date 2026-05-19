import { useState, useEffect, useCallback, useRef } from 'react';

interface UpdateManifest {
  latestVersion: string;
  url: string;
  notes: string;
  minVersion: string;
  forceUpdate: boolean;
}

// URL base para montar download links relativos do manifest
const SITE_BASE = 'https://lyfehoteles.com.br';

// Cada APK consulta o SEU PROPRIO manifest, baseado no appId nativo.
// Assim "LyFe Hoteles" não pede para atualizar para "LyFe Check-in" e vice-versa.
const MANIFEST_BY_APP_ID: Record<string, string> = {
  'com.lyfe.fluxo':      `${SITE_BASE}/update-manifest.json`,
  'com.lyfe.webcheckin': `${SITE_BASE}/web-checkin-update-manifest.json`,
};
const DEFAULT_MANIFEST_URL = `${SITE_BASE}/update-manifest.json`;

// Intervalo de re-check enquanto o app está aberto: 30 minutos
const RECHECK_INTERVAL_MS = 30 * 60 * 1000;

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('0.0.0');
  const [loading, setLoading] = useState(true);

  // Guarda a versão atual num ref para evitar recriar o callback
  const currentVersionRef = useRef('0.0.0');

  const checkUpdate = useCallback(async () => {
    try {
      // Só executa em plataforma nativa (APK/iOS)
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) {
        setLoading(false);
        return;
      }

      // Versão instalada + identidade do app
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      setCurrentVersion(info.version);
      currentVersionRef.current = info.version;

      // Escolhe o manifest correto baseado no appId (cada APK tem o seu)
      const manifestUrl = MANIFEST_BY_APP_ID[info.id] || DEFAULT_MANIFEST_URL;

      // Busca manifest com cache-busting agressivo (timestamp + cache:no-store)
      const response = await fetch(`${manifestUrl}?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        console.warn('[Update] Manifest não disponível:', response.status);
        return;
      }

      const data: UpdateManifest = await response.json();
      setManifest(data);

      // Compara versões
      const isNewer = compareVersions(data.latestVersion, info.version) > 0;
      if (isNewer) {
        setUpdateAvailable(true);
        console.log(`[Update] Nova versão disponível: ${data.latestVersion} (instalada: ${info.version})`);
      } else {
        console.log(`[Update] Já está na versão mais recente: ${info.version}`);
      }
    } catch (err) {
      console.error('[Update] Erro ao verificar atualizações:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const startUpdate = useCallback(async () => {
    if (!manifest?.url) return;
    try {
      const { Browser } = await import('@capacitor/browser');
      // Converte URL relativa ("/downloads/...") em absoluta
      const url = manifest.url.startsWith('http')
        ? manifest.url
        : `${SITE_BASE}${manifest.url}`;
      await Browser.open({ url });
    } catch (err) {
      console.error('[Update] Erro ao abrir download:', err);
    }
  }, [manifest]);

  // Re-check em três momentos:
  //   1. Na montagem do componente (App abriu)
  //   2. Quando app volta ao foreground (appStateChange)
  //   3. Periodicamente a cada 30 min enquanto app aberto
  useEffect(() => {
    checkUpdate(); // momento 1

    let stateHandle: { remove: () => void } | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;

        const { App: CapApp } = await import('@capacitor/app');

        // momento 2: app voltou ao foreground
        stateHandle = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            console.log('[Update] App voltou ao foreground — re-checando manifesto');
            checkUpdate();
          }
        });

        // momento 3: intervalo periódico
        intervalId = setInterval(() => {
          console.log('[Update] Re-check periódico (30 min)');
          checkUpdate();
        }, RECHECK_INTERVAL_MS);
      } catch {
        // ambiente sem Capacitor
      }
    })();

    return () => {
      stateHandle?.remove();
      if (intervalId) clearInterval(intervalId);
    };
  }, [checkUpdate]);

  return {
    updateAvailable,
    manifest,
    currentVersion,
    loading,
    startUpdate,
    dismissUpdate: () => setUpdateAvailable(false),
  };
}

/**
 * Retorna > 0 se v1 > v2, < 0 se v1 < v2, 0 se iguais
 * Suporta semver: "1.2.0" vs "1.10.0" → correto (não string comparison)
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}
