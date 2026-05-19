// src/pages/auth/NativeCallback.tsx
//
// Página de "bridge" HTTPS para o OAuth do APK.
//
// Motivo:
// Chrome Custom Tab BLOQUEIA redirects HTTP 302 para schemes custom
// (com.lyfe.fluxo://) por segurança. Mas ACEITA navegações iniciadas
// por JavaScript para o mesmo scheme. Esta página é carregada via HTTPS
// pelo Custom Tab (sem bloqueio), lê os params do OAuth e redireciona
// para o deep link via window.location.replace — que o Chrome trata como
// intent Android e abre o aplicativo.
//
// Fluxo:
//   App → signInWithOAuth(redirectTo: lyfehoteles.com.br/auth/native-callback)
//     → Custom Tab abre URL do Google
//     → Google → Supabase → lyfehoteles.com.br/auth/native-callback?code=…
//     → Esta página carrega no Custom Tab, lê o code
//     → window.location.replace('com.lyfe.fluxo://login-callback?code=…')
//     → Android dispara intent → MainActivity → appUrlOpen
//     → OAuthCallbackHandler troca code por sessão

import { useEffect, useState } from 'react';

export default function NativeCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);

      // Coleta todos os params relevantes (PKCE: ?code, Implicit: #access_token, Erro: ?error)
      const code        = url.searchParams.get('code');
      const oauthError  = url.searchParams.get('error');
      const errorDesc   = url.searchParams.get('error_description');
      const hashFrag    = url.hash; // ex.: #access_token=...&refresh_token=...

      // Monta o deep link
      const params = new URLSearchParams();
      if (code)       params.set('code', code);
      if (oauthError) {
        params.set('error', oauthError);
        if (errorDesc) params.set('error_description', errorDesc);
      }

      let deepLink = 'com.lyfe.fluxo://login-callback';
      const search = params.toString();
      if (search)   deepLink += `?${search}`;
      if (hashFrag) deepLink += hashFrag;

      // Redireciona via JS (Chrome Custom Tab dispara o intent Android)
      // setTimeout 50ms para garantir que o React montou antes de navegar
      setTimeout(() => {
        window.location.replace(deepLink);
      }, 50);

      // Fallback: se após 3s ainda estiver nesta página, mostra mensagem
      setTimeout(() => {
        setError('Não foi possível abrir o aplicativo automaticamente. Feche esta aba e abra o LyFe Hoteles manualmente.');
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao processar callback de autenticação.');
    }
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.25rem',
        padding: '2rem',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        color: '#fff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: 'center',
      }}
    >
      {!error ? (
        <>
          <div
            style={{
              width: 48,
              height: 48,
              border: '3px solid rgba(255,255,255,0.15)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'lyfeSpin 0.8s linear infinite',
            }}
          />
          <p style={{ fontSize: 15, opacity: 0.85, fontWeight: 500 }}>
            Retornando ao aplicativo...
          </p>
          <p style={{ fontSize: 12, opacity: 0.45 }}>
            Se nada acontecer em alguns segundos, abra o LyFe Hoteles manualmente.
          </p>
        </>
      ) : (
        <>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <p style={{ fontSize: 14, opacity: 0.85, maxWidth: 320, lineHeight: 1.5 }}>
            {error}
          </p>
        </>
      )}
      <style>{`@keyframes lyfeSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
