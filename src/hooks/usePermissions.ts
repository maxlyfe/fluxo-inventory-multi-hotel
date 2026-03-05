// src/hooks/usePermissions.ts
// Hook central de permissões — substitui todas as verificações de role hardcoded
// Uso: const { can, isAdmin } = usePermissions()
//      if (can('maintenance')) ...
//      if (can('personnel_department')) ...

import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';

// -----------------------------------------------------------------------
// Módulos disponíveis no sistema
// -----------------------------------------------------------------------
export interface Module {
  key:         string;
  label:       string;
  description: string;
  group:       string;
  icon:        string; // nome do ícone lucide (string) — usado no RolesManagement
}

// Módulos fixos do sistema
export const MODULES: Module[] = [
  // Área Administrativa — Título 1 da Home
  { key: 'inventory',            label: 'Inventário',           description: 'Contagem e controlo de inventário',         group: 'Área Administrativa', icon: 'ClipboardList' },
  { key: 'purchases',            label: 'Compras',              description: 'Pedidos de compra e fornecedores',          group: 'Área Administrativa', icon: 'ShoppingCart'  },
  { key: 'reports',              label: 'Relatórios',           description: 'Dashboards e relatórios gerenciais',       group: 'Área Administrativa', icon: 'BarChart2'     },
  { key: 'authorizations',       label: 'Autorizações',         description: 'Aprovações e fluxo de autorização',        group: 'Área Administrativa', icon: 'ShieldCheck'   },
  { key: 'stock',                label: 'Requisições',          description: 'Pedidos dos setores',                      group: 'Área Administrativa', icon: 'Boxes'         },
  { key: 'finances',             label: 'Financeiro',           description: 'Controle financeiro',                      group: 'Área Administrativa', icon: 'DollarSign'    },
  { key: 'management',           label: 'Gerência',             description: 'Relatórios e análises de gestão',          group: 'Área Administrativa', icon: 'BarChart2'     },
  { key: 'personnel_department', label: 'Depart. Pessoal',      description: 'Colaboradores, escalas, contratos, DP',    group: 'Área Administrativa', icon: 'Users'         },
  { key: 'maintenance',          label: 'Manutenções',          description: 'Tickets, equipamentos, QR codes',           group: 'Área Administrativa', icon: 'Wrench'        },
  // Administração (normalmente só Admin)
  { key: 'roles_management',     label: 'Gestão de Perfis',     description: 'Criar, editar e excluir perfis de acesso', group: 'Administração',       icon: 'UserCog'       },
  { key: 'sectors_management',   label: 'Gestão de Setores',    description: 'Setores por hotel, configuração de stock', group: 'Administração',       icon: 'LayoutGrid'    },
  { key: 'hotels_management',    label: 'Gestão de Hotéis',     description: 'Cadastro e configuração de unidades',      group: 'Administração',       icon: 'Building2'     },
  { key: 'users_management',     label: 'Gestão de Usuários',   description: 'Criar e gerir utilizadores do sistema',    group: 'Administração',       icon: 'UserCheck'     },
];

// Gera módulos dinâmicos de setor — chamado pelo RolesManagement com dados do banco
// Chave: 'sector_stock:UUID'  →  aparece no grupo 'Stock por Setor'
export function buildSectorModules(sectors: { id: string; name: string }[]): Module[] {
  return sectors.map(s => ({
    key:         `sector_stock:${s.id}`,
    label:       s.name,
    description: `Stock do setor ${s.name}`,
    group:       'Stock por Setor',
    icon:        'Package',
  }));
}

export const MODULE_GROUPS = [...new Set(MODULES.map(m => m.group))];

// -----------------------------------------------------------------------
// Tipo do user esperado no AuthContext
// -----------------------------------------------------------------------
interface UserWithRole {
  id:              string;
  role?:           string;  // campo legado — 'admin' = superuser
  custom_role_id?: string | null;
  custom_role?: {
    id:          string;
    name:        string;
    permissions: string[];
    color:       string;
  } | null;
}

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------
export function usePermissions() {
  const { user } = useAuth() as { user: UserWithRole | null };

  const isAdmin = useMemo(
    () => user?.role === 'admin',
    [user?.role]
  );

  /**
   * Verifica se o utilizador tem permissão para um módulo.
   * Admin tem acesso a tudo automaticamente.
   */
  const can = useMemo(
    () => (moduleKey: string): boolean => {
      if (!user) return false;
      if (isAdmin) return true;
      const perms = user.custom_role?.permissions ?? [];
      // Suporte direto a chaves simples e compostas (ex: 'sector_stock:UUID')
      return perms.includes(moduleKey);
    },
    [user, isAdmin]
  );

  /**
   * Verifica múltiplas permissões de uma vez.
   * canAny(['purchases','inventory']) — basta ter uma
   * canAll(['purchases','inventory']) — precisa ter todas
   */
  const canAny = (keys: string[]) => keys.some(k => can(k));
  const canAll = (keys: string[]) => keys.every(k => can(k));

  const roleName  = isAdmin ? 'Admin' : (user?.custom_role?.name ?? 'Sem perfil');
  const roleColor = isAdmin ? '#ef4444' : (user?.custom_role?.color ?? '#94a3b8');

  return { can, canAny, canAll, isAdmin, roleName, roleColor };
}
