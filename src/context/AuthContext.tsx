import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Interfaces — idênticas ao original para não quebrar nenhum consumer
// ---------------------------------------------------------------------------

interface AppUser {
  id: string;
  email?: string;
  role?: string;
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string; user?: AppUser | null }>;
  logout: () => Promise<{ success: boolean; message?: string }>;
  session: Session | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Helper: lê role de public.profiles (silencioso, não bloqueia nada)
// Chamado FORA do onAuthStateChange para não interferir na sessão
// ---------------------------------------------------------------------------
async function fetchRoleFromProfiles(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return data.role || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper: mapeia SupabaseUser → AppUser usando user_metadata de forma
// imediata (síncrona) — o role de profiles será aplicado depois em background
// ---------------------------------------------------------------------------
function mapSupabaseUserToAppUser(supabaseUser: SupabaseUser | null): AppUser | null {
  if (!supabaseUser) return null;
  return {
    id: supabaseUser.id,
    email: supabaseUser.email,
    role: supabaseUser.user_metadata?.role || 'inventory',
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<AppUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Sessão + listener ──────────────────────────────────────────────────
  // REGRA CRÍTICA: onAuthStateChange deve ser 100% síncrono.
  // Nunca colocar await dentro dele — quebra refresh de token e multi-device.
  useEffect(() => {
    setLoading(true);

    // Recupera sessão existente (persiste entre reloads e abas)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(mapSupabaseUserToAppUser(session?.user ?? null));
      setLoading(false);
    });

    // Listener síncrono — apenas mapeia, sem await
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(mapSupabaseUserToAppUser(session?.user ?? null));
      setLoading(false);
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // ── Sincronização de role em background ───────────────────────────────
  // Roda DEPOIS que o user é definido, sem bloquear a sessão.
  // Garante que o role de public.profiles (fonte da verdade) prevaleça
  // mesmo que o user_metadata esteja desatualizado.
  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    fetchRoleFromProfiles(user.id).then(role => {
      if (cancelled || !role) return;
      // Só atualiza se diferente para evitar re-render desnecessário
      setUser(prev => {
        if (!prev || prev.role === role) return prev;
        return { ...prev, role };
      });
    });

    return () => { cancelled = true; };
  }, [user?.id]); // Roda apenas quando o ID muda (novo login/logout)

  // ── Timer de inatividade ──────────────────────────────────────────────
  // Idêntico ao original + evento touchstart para mobile
  useEffect(() => {
    let inactivityTimer: number;

    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => {
        if (user) {
          console.log('AuthContext: inatividade — fazendo logout.');
          logout();
        }
      }, 60 * 60 * 1000); // 1 hora
    };

    if (user) {
      window.addEventListener('mousemove', resetTimer);
      window.addEventListener('keypress', resetTimer);
      window.addEventListener('touchstart', resetTimer); // suporte celular
      resetTimer();
    }

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keypress', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      clearTimeout(inactivityTimer);
    };
  }, [user]);

  // ── Login ─────────────────────────────────────────────────────────────
  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        return { success: false, message: error.message || 'Credenciais inválidas ou erro no login.' };
      }

      if (data.user) {
        return {
          success: true,
          message: 'Login bem-sucedido!',
          user: mapSupabaseUserToAppUser(data.user),
        };
      }

      return { success: false, message: 'Usuário ou sessão não retornados após login.' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Ocorreu uma exceção durante o login.' };
    } finally {
      setLoading(false);
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────
  const logout = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'Logout bem-sucedido!' };
    } catch (error: any) {
      return { success: false, message: error.message };
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, session }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
