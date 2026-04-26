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
  Settings as SettingsIcon, Package, Shield, ShieldAlert,
  GraduationCap, Stethoscope, Briefcase, Target,
  Home, Calendar, Shirt, Sparkles, Clock, History,
  MonitorSmartphone, Store, TrendingUp, PieChart, LayoutDashboard, Users2
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
  iconName?: string;
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
      { module: 'employee_portal', label: 'Meu Portal',    href: '/portal',              icon: Home,     iconName: 'Home',     color: '#6366f1' },
      { module: 'employee_portal', label: 'Minha Escala',   href: '/portal/my-schedule',  icon: Clock,    iconName: 'Clock',    color: '#8b5cf6' },
      { module: 'employee_portal', label: 'Calendário',     href: '/portal/events',       icon: Calendar, iconName: 'Calendar', color: '#3b82f6' },
      { module: 'employee_portal', label: 'Meus Docs',      href: '/portal/my-documents', icon: Shirt,    iconName: 'Shirt',    color: '#10b981' },
      { module: 'employee_portal', label: 'Mensagens',      href: '/portal/messages',     icon: Sparkles, iconName: 'Sparkles', color: '#f59e0b' },
    ],
  },
  {
    key: 'rh',
    label: 'RH',
    icon: UserPlus,
    module: 'recruitment',
    activePrefixes: ['/rh'],
    items: [
      { module: 'recruitment',  label: 'Vagas',       href: '/rh/jobs',       icon: UserPlus,   iconName: 'UserPlus',   color: '#8b5cf6' },
      { module: 'recruitment',  label: 'Candidatos',  href: '/rh/candidates', icon: UsersRound, iconName: 'UsersRound', color: '#6366f1' },
      { module: 'cpf_registry', label: 'Registro CPF', href: '/rh/cpf-registry', icon: Shield,    iconName: 'Shield',     color: '#ef4444' },
      { module: 'hr_analytics', label: 'Analytics',   href: '/rh/analytics',    icon: BarChart3,  iconName: 'BarChart3',  color: '#3b82f6' },
    ],
  },
  {
    key: 'compras',
    label: 'Compras',
    icon: ShoppingCart,
    module: 'purchases',
    activePrefixes: ['/purchases', '/budget-history', '/budget/', '/authorizations', '/shopping-list', '/admin/supplier-contacts', '/admin', '/purchases/tech-sheets', '/purchases/history'],
    items: [
      { module: 'authorizations', label: 'Orçamentos',   href: '/budget-history',            icon: FileText,      iconName: 'FileText',      color: '#6366f1' },
      { module: 'authorizations', label: 'Autorizações',  href: '/authorizations',            icon: CreditCard,    iconName: 'CreditCard',    color: '#14b8a6' },
      { module: 'purchases',      label: 'Compras',       href: '/purchases',                 icon: ShoppingCart,   iconName: 'ShoppingCart',   color: '#f59e0b' },
      { module: 'purchases',      label: 'Histórico',     href: '/purchases/history',         icon: History,        iconName: 'History',        color: '#a855f7' },
      { module: '__contacts__',   label: 'Contatos',      href: '/admin/supplier-contacts',   icon: Phone,          iconName: 'Phone',          color: '#10b981' },
      { module: 'stock',          label: 'Requisições',   href: '/admin',                     icon: ClipboardList,  iconName: 'ClipboardList',  color: '#3b82f6' },
      { module: 'purchases',      label: 'Fichas Técnicas', href: '/purchases/tech-sheets',   icon: FileText,       iconName: 'FileText',       color: '#ec4899' },
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
      { module: 'inventory', label: 'Inventário',     href: '/inventory',           icon: Boxes,          iconName: 'Boxes',          color: '#8b5cf6' },
      { module: 'inventory', label: 'Transferências', href: '/inventory/transfers', icon: ArrowLeftRight, iconName: 'ArrowLeftRight', color: '#f97316' },
    ],
  },
  {
    key: 'diretoria',
    label: 'Diretoria',
    icon: TrendingUp,
    module: 'diretoria',
    activePrefixes: ['/diretoria', '/diretoria/pickup'],
    items: [
        { module: 'diretoria', label: 'Dashboard',     href: '/diretoria',                 icon: PieChart,    iconName: 'PieChart',    color: '#3b82f6' },
        { module: 'diretoria', label: 'Pick-up',       href: '/diretoria/pickup',          icon: TrendingUp,  iconName: 'TrendingUp',  color: '#0ea5e9' },
        { module: 'directors_dashboard', label: 'KPIs Hotéis', href: '/diretoria/comparison', icon: BarChart3, iconName: 'BarChart3', color: '#10b981' },
    ],
  },
  {
    key: 'gerencia',
    label: 'Gerência',
    icon: BarChart2,
    module: 'management',
    activePrefixes: ['/management', '/reports'],
    items: [
      { module: 'management',      label: 'Gerência',      href: '/management',                icon: BarChart3,         iconName: 'BarChart3',         color: '#22c55e' },
      { module: 'reports',         label: 'Relatórios',    href: '/reports',                   icon: FileText,          iconName: 'FileText',          color: '#0ea5e9' },
      { module: 'hotel_documents', label: 'Documentos',    href: '/management/documents',      icon: Shield,            iconName: 'Shield',            color: '#6366f1' },
      { module: 'webcheckin_mgmt', label: 'Web Check-in',  href: '/management/webcheckin',     icon: MonitorSmartphone, iconName: 'MonitorSmartphone', color: '#0085ae' },
      { module: 'weekly_control',   label: 'Controle Semanal', href: '/weekly-control',        icon: Calendar,          iconName: 'Calendar',          color: '#8b5cf6' },
    ],
  },
  {
    key: 'comercial',
    label: 'Comercial',
    icon: Briefcase,
    module: 'commercial',
    activePrefixes: ['/commercial'],
    items: [
      { module: 'commercial', label: 'Clientes Corp.',  href: '/commercial/clients', icon: Briefcase, iconName: 'Briefcase', color: '#8b5cf6' },
      { module: 'commercial', label: 'Grupos',          href: '/commercial/groups',  icon: Users,     iconName: 'Users',     color: '#3b82f6' },
      { module: 'commercial', label: 'Metas',           href: '/commercial/revenue', icon: Target,    iconName: 'Target',    color: '#10b981' },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    icon: DollarSign,
    module: 'finances',
    activePrefixes: ['/finances'],
    items: [
      { module: 'finances', label: 'Financeiro', href: '/finances', icon: DollarSign, iconName: 'DollarSign', color: '#10b981' },
    ],
  },
  {
    key: 'dp',
    label: 'DP',
    icon: UserCheck,
    module: 'personnel_department',
    activePrefixes: ['/personnel-department', '/dp/'],
    items: [
      { module: 'personnel_department', label: 'Depart. Pessoal', href: '/personnel-department', icon: UsersRound,    iconName: 'UsersRound',    color: '#f43f5e' },
      { module: 'nr1_compliance',       label: 'NR-1',            href: '/dp/nr1',              icon: ShieldAlert,   iconName: 'ShieldAlert',   color: '#f97316' },
      { module: 'nr1_compliance',       label: 'Treinamentos',    href: '/dp/trainings',        icon: GraduationCap, iconName: 'GraduationCap', color: '#3b82f6' },
      { module: 'nr1_compliance',       label: 'Exames Médicos',  href: '/dp/medical-exams',    icon: Stethoscope,   iconName: 'Stethoscope',   color: '#10b981' },
    ],
  },
  {
    key: 'recepcao',
    label: 'Recepção',
    icon: BedDouble,
    module: 'reception',
    activePrefixes: ['/reception'],
    items: [
      { module: 'reception', label: "Rack de UH's",   href: '/reception/rack',       icon: BedDouble,     iconName: 'BedDouble',     color: '#14b8a6' },
      { module: 'reception', label: 'Check-in',        href: '/reception/checkin',    icon: LogIn,         iconName: 'LogIn',         color: '#22c55e' },
      { module: 'reception', label: 'Check-out',       href: '/reception/checkout',   icon: LogOut,        iconName: 'LogOut',        color: '#ef4444' },
      { module: 'reception', label: 'In House',        href: '/reception/inhouse',    icon: Users,         iconName: 'Users',         color: '#3b82f6' },
      { module: 'reception', label: 'Fichas Web CI',   href: '/reception/wci-fichas', icon: ClipboardList, iconName: 'ClipboardList', color: '#0085ae' },
    ],
  },
  {
    key: 'pdv', label: 'PDV', icon: ShoppingCart, module: 'pdv',
    activePrefixes: ['/pdv'],
    items: [
      { module: 'pdv', label: 'Ponto de Venda', href: '/pdv',         icon: ShoppingCart, iconName: 'ShoppingCart', color: '#f59e0b' },
      { module: 'pdv', label: 'Histórico PDV',  href: '/pdv/history', icon: History,      iconName: 'History',      color: '#8b5cf6' },
    ],
  },
  {
    key: 'reservas',
    label: 'Reservas',
    icon: Search,
    module: 'reservations',
    activePrefixes: ['/reservations'],
    items: [
      { module: 'reservations', label: 'Reservas',        href: '/reservations/search',       icon: Search,        iconName: 'Search',        color: '#6366f1' },
      { module: 'reservations', label: 'Disponibilidade', href: '/reservations/availability', icon: CalendarCheck, iconName: 'CalendarCheck', color: '#8b5cf6' },
      { module: 'reservations', label: 'Planning',        href: '/reservations/planning',     icon: CalendarRange, iconName: 'CalendarRange', color: '#a855f7' },
    ],
  },
  {
    key: 'manutencao',
    label: 'Manutenção',
    icon: HardHat,
    module: 'maintenance',
    activePrefixes: ['/maintenance'],
    items: [
      { module: 'maintenance', label: 'Manutenções',  href: '/maintenance',           icon: HardHat, iconName: 'HardHat', color: '#f97316' },
      { module: 'maintenance', label: 'Equipamentos', href: '/maintenance/equipment', icon: Wrench,  iconName: 'Wrench',  color: '#0ea5e9' },
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
      { module: 'users_management',   label: 'Usuários',          href: '/users',          icon: UsersRound,    iconName: 'UsersRound',    color: '#6366f1' },
      { module: 'roles_management',   label: 'Gestão de Perfis',  href: '/admin/roles',    icon: UserCog,       iconName: 'UserCog',       color: '#f59e0b' },
      { module: 'sectors_management', label: 'Gestão de Setores', href: '/admin/sectors',  icon: LayoutGrid,    iconName: 'LayoutGrid',    color: '#14b8a6' },
      { module: 'erbon_pms',          label: 'Erbon PMS',         href: '/admin/erbon',    icon: Link2,         iconName: 'Link2',         color: '#0ea5e9' },
      { module: 'whatsapp_integration', label: 'WhatsApp',        href: '/admin/whatsapp', icon: MessageSquare, iconName: 'MessageSquare', color: '#22c55e' },
    ],
  },
];

/** Item href que requer tratamento especial de permissão (contatos) */
export const CONTACT_ITEM_HREF = '/admin/supplier-contacts';
