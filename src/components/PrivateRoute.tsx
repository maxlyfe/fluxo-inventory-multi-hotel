// src/components/PrivateRoute.tsx
// Guarda de rota unificado — usa usePermissions como única fonte de verdade.
//
// Uso no App.tsx:
//   <PrivateRoute>               → só exige login
//   <PrivateRoute module="purchases"> → exige login + permissão do módulo
//   <PrivateRoute adminOnly>     → só admin

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

interface PrivateRouteProps {
  children:   React.ReactNode;
  // Nome do módulo conforme MODULES em usePermissions (ex: 'purchases', 'reports')
  module?:    string;
  // Múltiplos módulos — acesso se tiver QUALQUER um (OR)
  modules?:   string[];
  // Atalho para rotas exclusivas de admin
  adminOnly?: boolean;
  // Atalho para rotas exclusivas de DEV (dono do SaaS) — admin NÃO tem acesso
  devOnly?: boolean;
  // Verificação customizada adicional (ex: canAccessContacts)
  customCheck?: boolean;
  // Compatibilidade retroativa — ignorado (permissões agora vêm do perfil)
  roles?:     string[];
}

const PrivateRoute = ({ children, module, modules, adminOnly, devOnly, customCheck }: PrivateRouteProps) => {
  const { user, loading, sessionExpired, logout } = useAuth();
  const { can, canAny, isAdmin, isDev } = usePermissions();
  const location          = useLocation();

  // ── Aguarda carregamento do perfil ────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white" />
      </div>
    );
  }

  // ── Sessão vencida sem renovação possível ─────────────────────────────────
  // Estado explícito e estável. Sem isto a aplicação alternava entre liberar e
  // bloquear a cada evento de auth, porque o refresh não conseguia renovar.
  if (sessionExpired) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Sessão expirada</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Não foi possível renovar seu acesso automaticamente. Entre novamente para continuar.
          </p>
          <button
            onClick={() => logout()}
            className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            Entrar novamente
          </button>
        </div>
      </div>
    );
  }

  // ── Não autenticado ───────────────────────────────────────────────────────
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // ── Rota exclusiva DEV (dono do SaaS) — admin NÃO acessa ──────────────────
  if (devOnly && !isDev) {
    return <Navigate to="/" replace />;
  }

  // ── Rota exclusiva admin — DEV tem bypass total ───────────────────────────
  if (adminOnly && !isAdmin && !isDev) {
    return <Navigate to="/" replace />;
  }

  // ── Rota com módulo específico ────────────────────────────────────────────
  // Se customCheck é fornecido, aceita o módulo OU a condição customizada
  if (module && !can(module)) {
    if (customCheck !== true) {
      return <Navigate to="/" replace />;
    }
  }

  // ── Rota com múltiplos módulos (OR) ─────────────────────────────────────
  if (modules && modules.length > 0 && !canAny(modules)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default PrivateRoute;