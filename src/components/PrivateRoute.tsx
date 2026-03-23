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
  // Verificação customizada adicional (ex: canAccessContacts)
  customCheck?: boolean;
  // Compatibilidade retroativa — ignorado (permissões agora vêm do perfil)
  roles?:     string[];
}

const PrivateRoute = ({ children, module, modules, adminOnly, customCheck }: PrivateRouteProps) => {
  const { user, loading } = useAuth();
  const { can, canAny, isAdmin } = usePermissions();
  const location          = useLocation();

  // ── Aguarda carregamento do perfil ────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white" />
      </div>
    );
  }

  // ── Não autenticado ───────────────────────────────────────────────────────
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // ── Rota exclusiva admin ──────────────────────────────────────────────────
  if (adminOnly && !isAdmin) {
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