import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';

interface AppUser {
  id: string;
  email?: string;
  role?: string;
  full_name?: string;
  cpf?: string;
  photo_url?: string;
  cpf_prompt_dismissed?: boolean;
  group_id?: string;
  custom_role_id?: string;
  custom_role?: {
    id:          string;
    name:        string;
    permissions: string[];
    color:       string;
    hierarchy_level?: number | null;
  } | null;
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  needsName: boolean;
  isCompatibilityMode: boolean;
  refreshProfile: (forceFullCheck?: boolean) => Promise<void>;
  login: (
    identifier: string,
    password: string,
    opts?: { groupSlug?: string; captchaToken?: string }
  ) => Promise<{ success: boolean; message?: string; retryAfter?: number; user?: AppUser | null }>;
  loginWithGoogle: (redirectPath?: string) => Promise<{ success: boolean; message?: string }>;
  saveName: (fullName: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<{ success: boolean; message?: string }>;
  session:       Session | null;
  forceSignOut:  (userId: string) => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapCustomRole(cr: any) {
  if (!cr) return null;
  return {
    id:          cr.id as string,
    name:        cr.name as string,
    permissions: Array.isArray(cr.permissions) ? (cr.permissions as string[]) : [],
    color:       (cr.color as string) || '#94a3b8',
    hierarchy_level: (cr.hierarchy_level ?? null) as number | null,
  };
}

// Variável de runtime (reseta ao dar F5)
let GLOBAL_COMPATIBILITY_MODE = false;

async function fetchProfile(userId: string, forceCheck: boolean = false): Promise<{ profile: Partial<AppUser>, isCompat: boolean }> {
  try {
    if (GLOBAL_COMPATIBILITY_MODE && !forceCheck) {
      const { data } = await supabase.from('profiles').select('role, full_name, custom_role_id, custom_roles(id, name, permissions, color, hierarchy_level)').eq('id', userId).maybeSingle();
      if (!data) return { profile: {}, isCompat: true };
      const cr = (data as any).custom_roles;
      return {
        isCompat: true,
        profile: {
          role: data.role || 'guest',
          full_name: data.full_name || undefined,
          custom_role_id: data.custom_role_id || undefined,
          custom_role: mapCustomRole(cr),
        }
      };
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(`role, full_name, photo_url, cpf, cpf_prompt_dismissed, group_id, custom_role_id, custom_roles(id, name, permissions, color, hierarchy_level)`)
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      if (error.code === '42703' || (error as any).status === 400 || error.message.includes('column')) {
        GLOBAL_COMPATIBILITY_MODE = true;
        return fetchProfile(userId); 
      }
      return { profile: {}, isCompat: false };
    }

    // Se chegou aqui com sucesso, o banco tem as colunas
    GLOBAL_COMPATIBILITY_MODE = false;
    if (!data) return { profile: {}, isCompat: false };
    const cr = (data as any).custom_roles;

    return {
      isCompat: false,
      profile: {
        role:           data.role           || 'guest',
        full_name:      data.full_name      || undefined,
        photo_url:      data.photo_url      || undefined,
        cpf:            data.cpf            || undefined,
        cpf_prompt_dismissed: (data as any).cpf_prompt_dismissed || false,
        group_id:       (data as any).group_id || undefined,
        custom_role_id: data.custom_role_id || undefined,
        custom_role:    mapCustomRole(cr),
      }
    };
  } catch (err) {
    console.error('[Auth] Fetch falhou:', err);
    return { profile: {}, isCompat: false };
  }
}

function mapSupabaseUserToAppUser(supabaseUser: SupabaseUser | null): AppUser | null {
  if (!supabaseUser) return null;
  return { id: supabaseUser.id, email: supabaseUser.email, role: supabaseUser.user_metadata?.role || 'guest' };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]           = useState<AppUser | null>(null);
  const [session, setSession]     = useState<Session | null>(null);
  const [loading, setLoading]     = useState(true);
  const [needsName, setNeedsName] = useState(false);
  const [isCompat, setIsCompat]   = useState(GLOBAL_COMPATIBILITY_MODE);

  useEffect(() => {
    setLoading(true);
    async function loadSessionAndProfile(session: Session | null) {
      const baseUser = mapSupabaseUserToAppUser(session?.user ?? null);
      if (!baseUser?.id) {
        setSession(session); setUser(null); setLoading(false);
        return;
      }
      const { profile, isCompat: compatResult } = await fetchProfile(baseUser.id);
      setUser({ ...baseUser, ...profile });
      setIsCompat(compatResult);
      setSession(session);
      if (profile.role === 'guest' && !profile.full_name) setNeedsName(true);
      setLoading(false);
    }

    // Erro aqui quase nunca significa "não está logado": significa refresh de token
    // falhando (rate limit 429, rede caindo, servidor fora do ar). Zerar a sessão de
    // primeira jogava o usuário na tela de login mesmo com refresh_token válido —
    // agora tenta de novo antes de desistir e só então considera deslogado.
    let cancelled = false;
    const GET_SESSION_RETRY_DELAYS_MS = [0, 1200, 3000];

    (async () => {
      for (let attempt = 0; attempt < GET_SESSION_RETRY_DELAYS_MS.length; attempt++) {
        const delay = GET_SESSION_RETRY_DELAYS_MS[attempt];
        if (delay) await new Promise(r => setTimeout(r, delay));
        if (cancelled) return;

        const { data: { session }, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (!error) { loadSessionAndProfile(session); return; }
        console.warn(
          `[Auth] getSession falhou (tentativa ${attempt + 1}/${GET_SESSION_RETRY_DELAYS_MS.length}):`,
          error.message
        );
      }

      if (cancelled) return;
      setSession(null); setUser(null); setLoading(false);
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') { loadSessionAndProfile(session); return; }
      if (event === 'SIGNED_OUT' || !session) { setSession(null); setUser(null); setNeedsName(false); setLoading(false); return; }
      loadSessionAndProfile(session);
    });
    return () => { cancelled = true; authListener?.subscription.unsubscribe(); };
  }, []);

  // Realtime — recarrega perfil automaticamente quando o role/custom_role_id muda no banco
  // Elimina a necessidade de re-login após o admin atribuir ou alterar um perfil de acesso
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;

    const channel = supabase
      .channel(`profile-watch:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        async () => {
          console.info('[Auth] Perfil alterado no banco — recarregando permissões...');
          const { profile, isCompat: compatResult } = await fetchProfile(userId);
          setUser(prev => (prev ? { ...prev, ...profile } : null));
          setIsCompat(compatResult);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // Login por senha SEMPRE via edge function `auth-login`: é lá que o lockout
  // (3 tentativas + 30s, gravado no banco) é aplicado. Não chamamos
  // signInWithPassword direto no browser — isso pularia a contagem.
  // O identifier pode ser e-mail ou username; a tradução acontece no servidor.
  const login = async (
    identifier: string,
    password: string,
    opts?: { groupSlug?: string; captchaToken?: string }
  ) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('auth-login', {
        body: {
          identifier,
          password,
          group_slug: opts?.groupSlug ?? null,
          captchaToken: opts?.captchaToken ?? null,
        },
      });

      // functions.invoke trata status >= 400 como erro e não expõe o corpo
      // diretamente — é preciso ler o Response anexado para pegar retry_after.
      if (error) {
        const res = (error as { context?: Response }).context;
        if (res && typeof res.json === 'function') {
          try {
            const body = await res.json();
            return {
              success: false,
              message: body?.error || 'Não foi possível entrar.',
              retryAfter: Number(body?.retry_after) || undefined,
            };
          } catch {
            /* corpo não-JSON: cai na mensagem genérica abaixo */
          }
        }
        return { success: false, message: 'Não foi possível entrar. Tente novamente.' };
      }

      if (!data?.access_token || !data?.refresh_token) {
        return { success: false, message: 'Sessão não retornada.' };
      }

      // Aplica a sessão localmente — daqui para frente refresh, PKCE e
      // onAuthStateChange seguem exatamente como antes.
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionError) return { success: false, message: sessionError.message };
      if (sessionData.user) return { success: true, user: mapSupabaseUserToAppUser(sessionData.user) };
      return { success: false, message: 'Usuário não retornado.' };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : 'Erro desconhecido' };
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async (redirectPath?: string) => {
    try {
      // Detecta se está rodando em plataforma nativa (APK/iOS) — nunca true no browser
      const { Capacitor } = await import('@capacitor/core');
      const isApp = Capacitor.isNativePlatform();

      if (isApp) {
        // No APK: abre in-app browser e usa PKCE flow.
        // O redirect vai para uma PÁGINA BRIDGE em HTTPS (não direto para o
        // custom scheme), porque Chrome Custom Tab BLOQUEIA redirect 302 para
        // schemes custom. A bridge é uma página em lyfehoteles.com.br que
        // re-redireciona via JS para com.lyfe.fluxo://login-callback,
        // navegação que o Chrome aceita e converte em intent Android.
        const { Browser } = await import('@capacitor/browser');
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: 'https://lyfehoteles.com.br/auth/native-callback',
            skipBrowserRedirect: true,
            queryParams: { prompt: 'select_account' },
          },
        });
        if (error) return { success: false, message: error.message };
        if (data.url) await Browser.open({ url: data.url });
        return { success: true };
      } else {
        // Na web: fluxo normal, redireciona no mesmo tab.
        // redirectPath permite voltar à rota do grupo (ex.: /grupo/<slug>).
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}${redirectPath || '/'}`,
            queryParams: { prompt: 'select_account' },
          },
        });
        if (error) return { success: false, message: error.message };
        return { success: true };
      }
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : 'Erro ao entrar com Google.' };
    }
  };

  const saveName = async (fullName: string) => {
    if (!user?.id) return { success: false, message: 'Sessão inválida.' };
    const trimmed = fullName.trim();
    if (!trimmed || trimmed.length < 2) return { success: false, message: 'Nome muito curto.' };
    try {
      const { error } = await supabase.from('profiles').update({ full_name: trimmed, updated_at: new Date().toISOString() }).eq('id', user.id);
      if (error) return { success: false, message: error.message };
      setUser(prev => prev ? { ...prev, full_name: trimmed } : prev);
      setNeedsName(false);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : 'Erro desconhecido' };
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      // scope: 'local' limpa a sessão local SEM esperar resposta do servidor.
      // Garante logout instantâneo no APK mesmo com rede ruim/instável.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      // Limpa state imediatamente (não espera onAuthStateChange para evitar UI travada)
      setUser(null);
      setSession(null);
      setNeedsName(false);
      if (error) return { success: false, message: error.message };
      return { success: true };
    } catch (e: unknown) {
      // Mesmo em erro, limpa o state local — usuário sai do app
      setUser(null);
      setSession(null);
      return { success: false, message: e instanceof Error ? e.message : 'Erro desconhecido' };
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = useCallback(async (forceFull: boolean = false) => {
    if (!user?.id) return;
    const { profile, isCompat: compatResult } = await fetchProfile(user.id, forceFull);
    setUser(prev => prev ? { ...prev, ...profile } : null);
    setIsCompat(compatResult);
  }, [user?.id]);

  const forceSignOut = async (userId: string) => {
    try {
      const { error } = await supabase.functions.invoke('admin-user-actions', { body: { action: 'force_signout', target_user_id: userId } });
      if (error) return { success: false, message: error.message || 'Erro ao forçar logout.' };
      return { success: true };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : 'Erro desconhecido' };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, needsName, isCompatibilityMode: isCompat, refreshProfile, login, loginWithGoogle, saveName, logout, session, forceSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
