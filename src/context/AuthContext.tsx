import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';

// Interface para o nosso objeto de usuário simplificado
interface AppUser {
  id: string; // Este será o ID de auth.users
  email?: string;
  role?: string; // Role virá de user_metadata
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string; user?: AppUser | null }>;
  logout: () => Promise<{ success: boolean; message?: string }>;
  session: Session | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Função para mapear o usuário do Supabase para o nosso AppUser
  const mapSupabaseUserToAppUser = (supabaseUser: SupabaseUser | null): AppUser | null => {
    if (!supabaseUser) return null;
    return {
      id: supabaseUser.id,
      email: supabaseUser.email,
      role: supabaseUser.user_metadata?.role || 'user', // Pega a 'role' do metadata
    };
  };

  useEffect(() => {
    setLoading(true);
    // Tenta pegar a sessão existente ao carregar o app
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      const appUser = mapSupabaseUserToAppUser(session?.user ?? null);
      setUser(appUser);
      setLoading(false);
    });

    // Escuta por mudanças no estado de autenticação
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("AuthContext: onAuthStateChange event:", _event);
      setSession(session);
      const appUser = mapSupabaseUserToAppUser(session?.user ?? null);
      setUser(appUser);
      if(loading) setLoading(false);
    });

    // Limpa o listener quando o componente desmontar
    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) {
        return { 
          success: false, 
          message: error.message || 'Credenciais inválidas ou erro no login.' 
        };
      }

      // *** CORREÇÃO APLICADA AQUI ***
      // Agora, retornamos o objeto de usuário junto com o sucesso.
      if (data.user) {
        return { 
          success: true, 
          message: 'Login bem-sucedido!',
          user: mapSupabaseUserToAppUser(data.user)
        };
      }
      
      return { success: false, message: 'Usuário ou sessão não retornados após login.' };

    } catch (error: any) {
      return { 
        success: false, 
        message: error.message || 'Ocorreu uma exceção durante o login.' 
      };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        return { success: false, message: error.message };
      }
      return { success: true, message: 'Logout bem-sucedido!' };
    } catch (error: any) {
      return { success: false, message: error.message };
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    let inactivityTimer: number;
    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => {
        if (user) {
          console.log("AuthContext: Inactivity timer expired, logging out.");
          logout();
        }
      }, 60 * 60 * 1000); // 1 hora
    };

    if (user) {
      window.addEventListener('mousemove', resetTimer);
      window.addEventListener('keypress', resetTimer);
      resetTimer();
    }

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keypress', resetTimer);
      clearTimeout(inactivityTimer);
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, session }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}