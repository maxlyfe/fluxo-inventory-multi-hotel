import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface AppUser {
  id: string;       // ID de auth.users (fonte da verdade)
  email?: string;
  role?: string;    // Lido de public.profiles via RPC get_my_role()
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{
    success: boolean;
    message?: string;
    user?: AppUser | null;
  }>;
  logout: () => Promise<{ success: boolean; message?: string }>;
  session: Session | null;
  /** Força re-fetch do role (útil após alterar role de outro usuário) */
  refreshRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Helper: busca o role do usuário logado via RPC segura
// ---------------------------------------------------------------------------

async function fetchRoleForUser(): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('get_my_role');
    if (error) throw error;
    return (data as string) || 'inventory';
  } catch {
    return 'inventory';
  }
}

// ---------------------------------------------------------------------------
// Helper: mapeia SupabaseUser → AppUser (role resolvido separadamente)
// ---------------------------------------------------------------------------

function buildAppUser(supabaseUser: SupabaseUser, role: string): AppUser {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email,
    role,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<AppUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // -----------------------------------------------------------------------
  // Inicialização: recupera sessão existente + role do banco
  // -----------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setLoading(true);
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (currentSession?.user && mounted) {
          const role = await fetchRoleForUser();
          setSession(currentSession);
          setUser(buildAppUser(currentSession.user, role));
        } else if (mounted) {
          setSession(null);
          setUser(null);
        }
      } catch (err) {
        console.error('AuthContext init error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();

    // Listener de mudanças de sessão (login/logout/refresh de token)
    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;

      if (newSession?.user) {
        // Busca role atualizado do banco toda vez que a sessão muda
        const role = await fetchRoleForUser();
        setSession(newSession);
        setUser(buildAppUser(newSession.user, role));
      } else {
        setSession(null);
        setUser(null);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // -----------------------------------------------------------------------
  // Login
  // -----------------------------------------------------------------------
  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setLoading(false);
        return {
          success: false,
          message: error.message || 'Credenciais inválidas ou erro no login.',
        };
      }

      if (!data.user) {
        setLoading(false);
        return { success: false, message: 'Usuário não retornado após login.' };
      }

      // Busca o role real de public.profiles
      const role = await fetchRoleForUser();
      const appUser = buildAppUser(data.user, role);

      setSession(data.session);
      setUser(appUser);
      setLoading(false);

      return { success: true, message: 'Login bem-sucedido!', user: appUser };
    } catch (err: any) {
      setLoading(false);
      return { success: false, message: err.message || 'Erro inesperado no login.' };
    }
  }, []);

  // -----------------------------------------------------------------------
  // Logout
  // -----------------------------------------------------------------------
  const logout = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      setSession(null);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }, []);

  // -----------------------------------------------------------------------
  // Refresh role (usado após admin alterar role de usuário)
  // -----------------------------------------------------------------------
  const refreshRole = useCallback(async () => {
    if (!session?.user) return;
    const role = await fetchRoleForUser();
    setUser(prev => prev ? { ...prev, role } : null);
  }, [session]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, session, refreshRole }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
