// src/lib/appGroup.ts
// Persistência do grupo configurado no APK do sistema (com.lyfe.fluxo).
// O APK carrega lyfehoteles.com.br (raiz, sem grupo). Para não cair na landing
// de marketing, o app lembra o slug do grupo e abre direto no login dele.
// No navegador isso NÃO se aplica — o acesso é sempre pelo link /grupo/<slug>.

import { useEffect, useState } from 'react';

const APP_GROUP_KEY = 'app_group_slug';

export function getAppGroupSlug(): string | null {
  try { return localStorage.getItem(APP_GROUP_KEY); } catch { return null; }
}

export function setAppGroupSlug(slug: string | null): void {
  try {
    if (slug) localStorage.setItem(APP_GROUP_KEY, slug);
    else localStorage.removeItem(APP_GROUP_KEY);
  } catch { /* ignore */ }
}

/**
 * Detecta plataforma nativa (APK) via Capacitor.isNativePlatform().
 * Retorna: null = ainda verificando · true = APK · false = navegador.
 */
export function useIsNative(): boolean | null {
  const [native, setNative] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (active) setNative(Capacitor.isNativePlatform());
      } catch {
        if (active) setNative(false);
      }
    })();
    return () => { active = false; };
  }, []);
  return native;
}
