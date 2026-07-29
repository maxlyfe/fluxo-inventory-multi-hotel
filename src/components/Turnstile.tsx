// src/components/Turnstile.tsx
// Widget do Cloudflare Turnstile — prova de que o login veio de um humano.
//
// É o que impede burlar o lockout: com o CAPTCHA ligado em
// Authentication → Attack Protection, o Supabase rejeita qualquer sign-in sem
// token válido, inclusive quem chama /auth/v1/token direto com a anon key.
//
// O token é de USO ÚNICO: depois de uma tentativa (bem ou malsucedida) é
// preciso chamar reset() para obter outro. Por isso o ref imperativo.
//
// Se VITE_TURNSTILE_SITE_KEY não estiver definida, o componente não renderiza
// nada e devolve token null — o login segue funcionando normalmente enquanto
// o Turnstile ainda não foi configurado no Cloudflare/Supabase.

import React, { useEffect, useImperativeHandle, useRef, forwardRef, useCallback } from 'react';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const TURNSTILE_ENABLED = Boolean(SITE_KEY);

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset:  (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar Turnstile')));
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar Turnstile'));
    document.head.appendChild(s);
  });

  return scriptPromise;
}

export interface TurnstileHandle {
  /** Descarta o token usado e pede um novo. Chamar após cada tentativa de login. */
  reset: () => void;
}

interface TurnstileProps {
  /** Recebe o token quando resolvido, ou null quando expira/falha. */
  onToken: (token: string | null) => void;
  theme?: 'auto' | 'light' | 'dark';
}

const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(({ onToken, theme = 'dark' }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef  = useRef<string | null>(null);
  // Guarda o callback num ref para não re-renderizar o widget a cada render do pai
  const onTokenRef   = useRef(onToken);
  onTokenRef.current = onToken;

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current);
        onTokenRef.current(null);
      }
    },
  }), []);

  const mount = useCallback(async () => {
    if (!SITE_KEY || !containerRef.current || widgetIdRef.current) return;
    try {
      await loadScript();
      if (!window.turnstile || !containerRef.current || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        theme,
        callback:            (token: string) => onTokenRef.current(token),
        'expired-callback':  () => onTokenRef.current(null),
        'error-callback':    () => onTokenRef.current(null),
        'timeout-callback':  () => onTokenRef.current(null),
      });
    } catch {
      // Sem rede ou script bloqueado: não trava a tela de login.
      onTokenRef.current(null);
    }
  }, [theme]);

  useEffect(() => {
    mount();
    return () => {
      if (window.turnstile && widgetIdRef.current) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* já removido */ }
      }
      widgetIdRef.current = null;
    };
  }, [mount]);

  if (!SITE_KEY) return null;

  return <div ref={containerRef} className="flex justify-center" />;
});

Turnstile.displayName = 'Turnstile';

export default Turnstile;
