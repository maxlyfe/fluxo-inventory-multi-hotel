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
  { key: 'reservations',         label: 'Reservas',             description: 'Busca de reservas e disponibilidade',      group: 'Área Administrativa', icon: 'CalendarCheck' },
  { key: 'reception',            label: 'Recepção',             description: 'Rack de UHs, check-in/out, in-house',     group: 'Área Administrativa', icon: 'Hotel'         },
  { key: 'employee_portal',      label: 'Portal Colaborador',    description: 'Portal, escala pessoal, eventos, docs',   group: 'Área Administrativa', icon: 'Home'          },
  { key: 'recruitment',          label: 'Recrutamento',          description: 'Vagas, candidatos, pipeline de seleção',  group: 'Área Administrativa', icon: 'UserPlus'      },
  { key: 'cpf_registry',         label: 'Registro de CPF',       description: 'Consulta e gestão de CPFs bloqueados',    group: 'Área Administrativa', icon: 'Shield'        },
  { key: 'nr1_compliance',       label: 'NR-1 Compliance',       description: 'Riscos, treinamentos e exames médicos',   group: 'Área Administrativa', icon: 'ShieldAlert'   },
  { key: 'hr_analytics',         label: 'HR Analytics',          description: 'Dashboards de RH: turnover, headcount',   group: 'Área Administrativa', icon: 'BarChart3'     },
  { key: 'hotel_documents',      label: 'Documentos e Licenças', description: 'Gestão de alvarás, licenças e documentos', group: 'Área Administrativa', icon: 'FileText'      },
  { key: 'commercial',           label: 'Comercial',            description: 'Clientes corporativos, grupos e metas',   group: 'Área Administrativa', icon: 'Briefcase'     },
  { key: 'pdv',                  label: 'PDV — Ponto de Venda', description: 'Lançar consumos na UH, histórico de vendas PDV', group: 'Área Administrativa', icon: 'ShoppingCart' },
  // Administração (normalmente só Admin)
  { key: 'roles_management',     label: 'Gestão de Perfis',     description: 'Criar, editar e excluir perfis de acesso', group: 'Administração',       icon: 'UserCog'       },
  { key: 'sectors_management',   label: 'Gestão de Setores',    description: 'Setores por hotel, configuração de stock', group: 'Administração',       icon: 'LayoutGrid'    },
  { key: 'hotels_management',    label: 'Gestão de Hotéis',     description: 'Cadastro e configuração de unidades',      group: 'Administração',       icon: 'Building2'     },
  { key: 'users_management',     label: 'Gestão de Usuários',   description: 'Criar e gerir utilizadores do sistema',    group: 'Administração',       icon: 'UserCheck'     },
];

// Gera módulos dinâmicos de setor — chamado pelo RolesManagement com dados do banco
// Chave: 'sector_stock:UUID'  →  aparece no grupo 'Stock por Setor'
export function buildSectorModules(
  sectors: { id: string; name: string; hotelName?: string | null }[]
): Module[] {
  return sectors.map(s => ({
    key:         `sector_stock:${s.id}`,
    label:       s.hotelName ? `${s.name} — ${s.hotelName}` : s.name,
    description: s.hotelName ? s.hotelName : `Stock do setor ${s.name}`,
    group:       'Stock por Setor',
    icon:        'Package',
  }));
}

// Gera módulos dinâmicos de categoria de contato — chamado pelo RolesManagement
// Chave: 'contacts:UUID'  →  aparece no grupo 'Agenda de Contatos'
export function buildContactCategoryModules(
  categories: { id: string; name: string; color?: string }[]
): Module[] {
  return categories.map(c => ({
    key:         `contacts:${c.id}`,
    label:       c.name,
    description: `Acesso a contatos da categoria "${c.name}"`,
    group:       'Agenda de Contatos',
    icon:        'Phone',
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

  const isDev = useMemo(
    () => user?.role === 'dev',
    [user?.role]
  );

  const isAdmin = useMemo(
    () => user?.role === 'admin' || isDev,
    [user?.role, isDev]
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

  /** Retorna IDs das categorias de contato liberadas para o usuário */
  const allowedContactCategories = useMemo(() => {
    if (!user) return [];
    if (isAdmin) return []; // admin vê tudo — array vazio = sem filtro
    const perms = user.custom_role?.permissions ?? [];
    return perms
      .filter(p => p.startsWith('contacts:'))
      .map(p => p.replace('contacts:', ''));
  }, [user, isAdmin]);

  /** Verifica se o usuário tem acesso a pelo menos uma categoria de contatos */
  const canAccessContacts = useMemo(() => {
    if (!user) return false;
    if (isAdmin) return true;
    const perms = user.custom_role?.permissions ?? [];
    return perms.some(p => p.startsWith('contacts:'));
  }, [user, isAdmin]);

  const roleName  = isDev ? 'Dev' : isAdmin ? 'Admin' : (user?.custom_role?.name ?? 'Sem perfil');
  const roleColor = isDev ? '#8b5cf6' : isAdmin ? '#ef4444' : (user?.custom_role?.color ?? '#94a3b8');

  return { can, canAny, canAll, isAdmin, isDev, roleName, roleColor, allowedContactCategories, canAccessContacts };
}