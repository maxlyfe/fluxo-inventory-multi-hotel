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
  custom_role_id?: string;
  custom_role?: {
    id:          string;
    name:        string;
    permissions: string[];
    color:       string;
  } | null;
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  needsName: boolean;
  refreshProfile: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string; user?: AppUser | null }>;
  loginWithGoogle: () => Promise<{ success: boolean; message?: string }>;
  saveName: (fullName: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<{ success: boolean; message?: string }>;
  session:       Session | null;
  forceSignOut:  (userId: string) => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Mapeia um registo raw do banco para o formato CustomRole esperado pelo hook. */
function mapCustomRole(cr: any) {
  if (!cr) return null;
  return {
    id:          cr.id          as string,
    name:        cr.name        as string,
    permissions: Array.isArray(cr.permissions) ? (cr.permissions as string[]) : [],
    color:       (cr.color as string) || '#94a3b8',
  };
}

/**
 * Carrega o perfil completo do utilizador, incluindo o custom_role e as suas permissões.
 * Estratégia de resiliência: tenta os campos novos e faz fallback para o básico se falhar (ex: colunas inexistentes).
 */
async function fetchProfile(userId: string): Promise<Partial<AppUser>> {
  // ── Tentativa 1: JOIN completo (caminho ideal) ────────────────────────────
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        role,
        full_name,
        photo_url,
        cpf,
        custom_role_id,
        custom_roles (id, name, permissions, color)
      `)
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) {
      return {
        role:           data.role           || 'guest',
        full_name:      data.full_name      || undefined,
        photo_url:      data.photo_url      || undefined,
        cpf:            data.cpf            || undefined,
        custom_role_id: data.custom_role_id || undefined,
        custom_role:    mapCustomRole((data as any).custom_roles),
      };
    }

    // Se o erro for 400 ou mencionar colunas, tentamos sem os campos novos
    if (error && ((error as any).status === 400 || error.message.includes('column'))) {
      const { data: basic, error: basicErr } = await supabase
        .from('profiles')
        .select(`
          role,
          full_name,
          custom_role_id,
          custom_roles (id, name, permissions, color)
        `)
        .eq('id', userId)
        .maybeSingle();

      if (!basicErr && basic) {
        return {
          role:           basic.role           || 'guest',
          full_name:      basic.full_name      || undefined,
          custom_role_id: basic.custom_role_id || undefined,
          custom_role:    mapCustomRole((basic as any).custom_roles),
        };
      }
    }
  } catch (e: any) {
    console.error('[Auth] Erro ao carregar perfil:', e.message);
  }

  return {};
}

function mapSupabaseUserToAppUser(supabaseUser: SupabaseUser | null): AppUser | null {
  if (!supabaseUser) return null;
  return {
    id:    supabaseUser.id,
    email: supabaseUser.email,
    role:  supabaseUser.user_metadata?.role || 'guest',
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]           = useState<AppUser | null>(null);
  const [session, setSession]     = useState<Session | null>(null);
  const [loading, setLoading]     = useState(true);
  const [needsName, setNeedsName] = useState(false);

  useEffect(() => {
    setLoading(true);

    async function loadSessionAndProfile(session: Session | null) {
      const baseUser = mapSupabaseUserToAppUser(session?.user ?? null);
      if (!baseUser?.id) {
        setSession(session);
        setUser(null);
        setLoading(false);
        return;
      }
      const profile = await fetchProfile(baseUser.id);
      const fullUser = { ...baseUser, ...profile };
      setSession(session);
      setUser(fullUser);
      if (profile.role === 'guest' && !profile.full_name) {
        setNeedsName(true);
      }
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        setSession(null); setUser(null); setLoading(false);
        return;
      }
      loadSessionAndProfile(session);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') {
        loadSessionAndProfile(session);
        return;
      }
      if (event === 'SIGNED_OUT' || !session) {
        setSession(null); setUser(null); setNeedsName(false); setLoading(false);
        return;
      }
      loadSessionAndProfile(session);
    });

    return () => { authListener?.subscription.unsubscribe(); };
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, message: error.message };
      if (data.user) return { success: true, user: mapSupabaseUserToAppUser(data.user) };
      return { success: false, message: 'Usuário não retornado.' };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : 'Erro desconhecido' };
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) return { success: false, message: error.message };
      return { success: true };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : 'Erro ao entrar com Google.' };
    }
  };

  const saveName = async (fullName: string) => {
    if (!user?.id) return { success: false, message: 'Sessão inválida.' };
    const trimmed = fullName.trim();
    if (!trimmed || trimmed.length < 2) return { success: false, message: 'Nome muito curto.' };
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: trimmed, updated_at: new Date().toISOString() })
        .eq('id', user.id);
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
      const { error } = await supabase.auth.signOut();
      if (error) return { success: false, message: error.message };
      return { success: true };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : 'Erro desconhecido' };
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    const profile = await fetchProfile(user.id);
    setUser(prev => prev ? { ...prev, ...profile } : null);
  }, [user?.id]);

  const forceSignOut = async (userId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'force_signout', target_user_id: userId },
      });
      if (error) return { success: false, message: error.message || 'Erro ao forçar logout.' };
      return { success: true };
    } catch (e: unknown) {
      return { success: false, message: e instanceof Error ? e.message : 'Erro desconhecido' };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, needsName, refreshProfile, login, loginWithGoogle, saveName, logout, session, forceSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
