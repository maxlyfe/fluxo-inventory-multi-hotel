// src/lib/navigationConfig.ts
// Configuração centralizada de navegação — usada pelo Sidebar (Home) e pelo Navbar.
//
// ⚠️  REGRA: ao adicionar ou alterar um item de menu, altere APENAS este arquivo.
//     O Sidebar e o Navbar importam daqui automaticamente.

import {
  ShoppingCart, FileText, ShieldCheck, ClipboardList, Phone,
  Boxes, ArrowLeftRight,
  BarChart2, BarChart3,
  DollarSign, CreditCard,
  UsersRound, UserCheck, UserCog, UserPlus,
  HardHat, Wrench,
  BedDouble, LogIn, LogOut, Users,
  Search, CalendarCheck, CalendarRange,
  LayoutGrid, Link2, MessageSquare,
  Settings as SettingsIcon, Package, Shield,
  Home, Calendar, Shirt, Sparkles, Clock,
} from 'lucide-react';
import type { ComponentType } from 'react';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export interface NavItem {
  /** Chave de permissão verificada via can(module). Valores especiais:
   *  - '__contacts__': acessível via purchases OU canAccessContacts
   *  - string vazia '': sem restrição (qualquer autenticado)
   */
  module: string;
  label: string;
  href: string;
  icon: ComponentType<any>;
  /** Cor hex para o sidebar. O navbar não usa isso. */
  color: string;
}

export interface NavGroup {
  /** Chave única do grupo (usada como key no React e para lookup) */
  key: string;
  /** Rótulo visível */
  label: string;
  /** Ícone do grupo (usado no navbar como ícone da seção) */
  icon: ComponentType<any>;
  /** Permissão de módulo requerida para o grupo inteiro (navbar filtra por isso) */
  module?: string;
  /** Apenas admins podem ver este grupo */
  adminOnly?: boolean;
  /** Prefixos de rota que ativam esta seção no navbar */
  activePrefixes: string[];
  /** Itens estáticos do grupo */
  items: NavItem[];
  /** Se definido, o sidebar adiciona setores dinâmicos a este grupo */
  dynamicKey?: 'stockSectors' | 'allSectors';
}

// ---------------------------------------------------------------------------
// Configuração central
// ---------------------------------------------------------------------------
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'portal',
    label: 'Portal',
    icon: Home,
    module: 'employee_portal',
    activePrefixes: ['/portal'],
    items: [
      { module: 'employee_portal', label: 'Meu Portal',    href: '/portal',              icon: Home,     color: '#6366f1' },
      { module: 'employee_portal', label: 'Minha Escala',   href: '/portal/my-schedule',  icon: Clock,    color: '#8b5cf6' },
      { module: 'employee_portal', label: 'Calendário',     href: '/portal/events',       icon: Calendar, color: '#3b82f6' },
      { module: 'employee_portal', label: 'Meus Docs',      href: '/portal/my-documents', icon: Shirt,    color: '#10b981' },
      { module: 'employee_portal', label: 'Mensagens',      href: '/portal/messages',     icon: Sparkles, color: '#f59e0b' },
    ],
  },
  {
    key: 'rh',
    label: 'RH',
    icon: UserPlus,
    module: 'recruitment',
    activePrefixes: ['/rh'],
    items: [
      { module: 'recruitment',  label: 'Vagas',       href: '/rh/jobs',       icon: UserPlus,   color: '#8b5cf6' },
      { module: 'recruitment',  label: 'Candidatos',  href: '/rh/candidates', icon: UsersRound, color: '#6366f1' },
      { module: 'cpf_registry', label: 'Registro CPF', href: '/rh/cpf-registry', icon: Shield, color: '#ef4444' },
    ],
  },
  {
    key: 'compras',
    label: 'Compras',
    icon: ShoppingCart,
    module: 'purchases',
    activePrefixes: ['/purchases', '/budget-history', '/budget/', '/authorizations', '/shopping-list', '/admin/supplier-contacts', '/admin', '/purchases/tech-sheets'],
    items: [
      { module: 'authorizations', label: 'Orçamentos',   href: '/budget-history',            icon: FileText,     color: '#6366f1' },
      { module: 'authorizations', label: 'Autorizações',  href: '/authorizations',            icon: CreditCard,   color: '#14b8a6' },
      { module: 'purchases',      label: 'Compras',       href: '/purchases',                 icon: ShoppingCart,  color: '#f59e0b' },
      { module: '__contacts__',   label: 'Contatos',      href: '/admin/supplier-contacts',   icon: Phone,         color: '#10b981' },
      { module: 'stock',          label: 'Requisições',   href: '/admin',                     icon: ClipboardList, color: '#3b82f6' },
      { module: 'purchases',      label: 'Fichas Técnicas', href: '/purchases/tech-sheets',   icon: FileText,      color: '#ec4899' },
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    icon: Boxes,
    module: 'stock',
    activePrefixes: ['/governance', '/sector-stock/', '/inventory'],
    dynamicKey: 'stockSectors',
    items: [
      { module: 'inventory', label: 'Inventário',     href: '/inventory',           icon: Boxes,          color: '#8b5cf6' },
      { module: 'inventory', label: 'Transferências', href: '/inventory/transfers', icon: ArrowLeftRight, color: '#f97316' },
    ],
  },
  {
    key: 'gerencia',
    label: 'Gerência',
    icon: BarChart2,
    module: 'management',
    activePrefixes: ['/management', '/reports'],
    items: [
      { module: 'management', label: 'Gerência',   href: '/management', icon: BarChart3, color: '#22c55e' },
      { module: 'reports',    label: 'Relatórios', href: '/reports',    icon: FileText,  color: '#0ea5e9' },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    icon: DollarSign,
    module: 'finances',
    activePrefixes: ['/finances'],
    items: [
      { module: 'finances', label: 'Financeiro', href: '/finances', icon: DollarSign, color: '#10b981' },
    ],
  },
  {
    key: 'dp',
    label: 'DP',
    icon: UserCheck,
    module: 'personnel_department',
    activePrefixes: ['/personnel-department', '/dp/'],
    items: [
      { module: 'personnel_department', label: 'Depart. Pessoal', href: '/personnel-department', icon: UsersRound, color: '#f43f5e' },
    ],
  },
  {
    key: 'recepcao',
    label: 'Recepção',
    icon: BedDouble,
    module: 'reception',
    activePrefixes: ['/reception'],
    items: [
      { module: 'reception', label: "Rack de UH's", href: '/reception/rack',    icon: BedDouble, color: '#14b8a6' },
      { module: 'reception', label: 'Check-in',      href: '/reception/checkin',  icon: LogIn,     color: '#22c55e' },
      { module: 'reception', label: 'Check-out',     href: '/reception/checkout', icon: LogOut,    color: '#ef4444' },
      { module: 'reception', label: 'In House',      href: '/reception/inhouse',  icon: Users,     color: '#3b82f6' },
    ],
  },
  {
    key: 'reservas',
    label: 'Reservas',
    icon: Search,
    module: 'reservations',
    activePrefixes: ['/reservations'],
    items: [
      { module: 'reservations', label: 'Reservas',        href: '/reservations/search',       icon: Search,        color: '#6366f1' },
      { module: 'reservations', label: 'Disponibilidade', href: '/reservations/availability', icon: CalendarCheck, color: '#8b5cf6' },
      { module: 'reservations', label: 'Planning',        href: '/reservations/planning',     icon: CalendarRange, color: '#a855f7' },
    ],
  },
  {
    key: 'manutencao',
    label: 'Manutenção',
    icon: HardHat,
    module: 'maintenance',
    activePrefixes: ['/maintenance'],
    items: [
      { module: 'maintenance', label: 'Manutenções',  href: '/maintenance',           icon: HardHat, color: '#f97316' },
      { module: 'maintenance', label: 'Equipamentos', href: '/maintenance/equipment', icon: Wrench,  color: '#0ea5e9' },
    ],
  },
  {
    key: 'requisicoes',
    label: 'Requisições',
    icon: Package,
    module: undefined,
    activePrefixes: ['/sector/'],
    dynamicKey: 'allSectors',
    items: [],
  },
  {
    key: 'admin',
    label: 'Configurações',
    icon: SettingsIcon,
    adminOnly: true,
    activePrefixes: ['/users', '/admin/roles', '/admin/sectors', '/admin/erbon', '/admin/whatsapp'],
    items: [
      { module: 'users_management',   label: 'Usuários',          href: '/users',          icon: UsersRound,    color: '#6366f1' },
      { module: 'roles_management',   label: 'Gestão de Perfis',  href: '/admin/roles',    icon: UserCog,       color: '#f59e0b' },
      { module: 'sectors_management', label: 'Gestão de Setores', href: '/admin/sectors',  icon: LayoutGrid,    color: '#14b8a6' },
      { module: 'erbon_pms',          label: 'Erbon PMS',         href: '/admin/erbon',    icon: Link2,         color: '#0ea5e9' },
      { module: 'users_management',   label: 'WhatsApp',          href: '/admin/whatsapp', icon: MessageSquare, color: '#22c55e' },
    ],
  },
];

/** Item href que requer tratamento especial de permissão (contatos) */
export const CONTACT_ITEM_HREF = '/admin/supplier-contacts';
