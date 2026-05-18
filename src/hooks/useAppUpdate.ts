import { useState, useEffect, useCallback } from 'react';

interface UpdateManifest {
  latestVersion: string;
  url: string;
  notes: string;
  minVersion: string;
  forceUpdate: boolean;
}

// URL absoluta do manifest — sempre busca do servidor de produção
const MANIFEST_URL = 'https://lyfehoteles.com.br/update-manifest.json';

// URL base para montar download links relativos do manifest
const SITE_BASE = 'https://lyfehoteles.com.br';

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('0.0.0');
  const [loading, setLoading] = useState(true);

  const checkUpdate = useCallback(async () => {
    try {
      setLoading(true);

      // Só executa em plataforma nativa (APK/iOS)
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) {
        setLoading(false);
        return;
      }

      // Versão instalada no dispositivo
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      setCurrentVersion(info.version);

      // Busca manifest com cache-busting
      const response = await fetch(`${MANIFEST_URL}?t=${Date.now()}`);
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

  useEffect(() => {
    checkUpdate();
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
