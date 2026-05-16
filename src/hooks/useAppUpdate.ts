import { useState, useEffect, useCallback } from 'react';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

interface UpdateManifest {
  latestVersion: string;
  url: string;
  notes: string;
  minVersion: string;
  forceUpdate: boolean;
}

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('0.0.0');
  const [loading, setLoading] = useState(true);

  const checkUpdate = useCallback(async () => {
    try {
      setLoading(true);
      
      // Obter versão atual do App nativo
      const info = await App.getInfo();
      setCurrentVersion(info.version);

      // Buscar manifesto de atualização
      // O timestamp serve para evitar cache do navegador/proxy
      const response = await fetch(`/update-manifest.json?t=${Date.now()}`);
      if (!response.ok) return;

      const data: UpdateManifest = await response.json();
      setManifest(data);

      // Comparar versões (lógica simples de string para 1.0.1 vs 1.1.0)
      if (data.latestVersion !== info.version) {
        // Verifica se a versão atual é menor que a mais recente
        const isNewer = compareVersions(data.latestVersion, info.version) > 0;
        if (isNewer) {
          setUpdateAvailable(true);
        }
      }
    } catch (err) {
      console.error('[Update] Erro ao verificar atualizações:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const startUpdate = useCallback(async () => {
    if (!manifest?.url) return;
    
    // Abre o link do APK no navegador do sistema.
    // O navegador iniciará o download e, ao terminar, o usuário poderá instalar.
    await Browser.open({ url: manifest.url });
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
    dismissUpdate: () => setUpdateAvailable(false)
  };
}

/**
 * Retorna > 0 se v1 > v2
 * Retorna < 0 se v1 < v2
 * Retorna 0 se v1 == v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}
