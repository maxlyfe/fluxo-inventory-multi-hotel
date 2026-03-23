// src/components/Navbar.tsx
// Navbar contextual — mostra sub-itens do módulo ativo baseado na rota atual.

import classNames from 'classnames';
import React, { useState, useEffect, useMemo, Fragment } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Menu, Transition } from '@headlessui/react';
import { supabase } from "../lib/supabase";
import NotificationBell from "./NotificationBell";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../hooks/usePermissions";
import { useHotel } from "../context/HotelContext";
import { useTheme } from "../context/ThemeContext";

import {
  Hotel as HotelIcon,
  Building2 as BuildingIcon,
  LogOut as LogOutIcon,
  SunMedium as SunIcon,
  Moon as MoonIcon,
  Menu as MenuIconLucide,
  X as XIcon,
  Settings as SettingsIcon,
  UserCircle2 as ProfileIcon,
  ChevronDown as ChevronDownIcon,
  Check as CheckIcon,
  // Módulos
  LayoutDashboard,
  ClipboardList,
  ShoppingCart,
  FileText,
  ShieldCheck,
  BarChart2,
  DollarSign,
  UsersRound,
  UserCheck,
  HardHat,
  Wrench,
  BedDouble,
  LogIn,
  LogOut,
  Users,
  Search,
  CalendarCheck,
  CalendarRange,
  Boxes,
  UserCog,
  LayoutGrid,
  Link2,
  Home,
  ChevronRight,
  ArrowLeftRight,
  Phone,
  MessageSquare,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Hotel name abbreviations
// ---------------------------------------------------------------------------
const hotelNameMapping: Record<string, string> = {
  "Costa do Sol Boutique Hotel": "CS",
  "Brava Club":                  "BC",
  "Villa Pitanga":               "VP",
  "Maria Maria":                 "MM",
};

// ---------------------------------------------------------------------------
// Contextual navigation — agrupado por "seção"
// Cada seção tem: rotas que ativam o contexto + sub-itens a mostrar
// ---------------------------------------------------------------------------
interface NavSubItem {
  name: string;
  href: string;
  icon: React.ComponentType<any>;
}

interface NavSection {
  key: string;
  label: string;
  icon: React.ComponentType<any>;
  module?: string;          // permissão requerida (undefined = qualquer logado)
  adminOnly?: boolean;
  /** Prefixos de rota que ativam esta seção */
  activePrefixes: string[];
  /** Sub-itens mostrados na navbar quando esta seção está ativa */
  items: NavSubItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    key: 'compras',
    label: 'Compras',
    icon: ShoppingCart,
    module: 'purchases',
    activePrefixes: ['/purchases', '/budget-history', '/budget/', '/authorizations', '/shopping-list', '/admin/supplier-contacts', '/admin'],
    items: [
      { name: 'Compras',      href: '/purchases',                icon: ShoppingCart },
      { name: 'Orçamentos',   href: '/budget-history',           icon: FileText },
      { name: 'Aprovações',   href: '/authorizations',           icon: ShieldCheck },
      { name: 'Contatos',     href: '/admin/supplier-contacts',  icon: Phone },
      { name: 'Requisições',  href: '/admin',                    icon: ClipboardList },
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    icon: Boxes,
    module: 'stock',
    activePrefixes: ['/governance', '/sector-stock/', '/inventory'],
    items: [
      { name: 'Inventário',     href: '/inventory',            icon: Boxes },
      { name: 'Transferências', href: '/inventory/transfers',  icon: ArrowLeftRight },
    ],
  },
  {
    key: 'gerencia',
    label: 'Gerência',
    icon: BarChart2,
    module: 'management',
    activePrefixes: ['/management', '/reports'],
    items: [
      { name: 'Gerência',    href: '/management', icon: BarChart2 },
      { name: 'Relatórios',  href: '/reports',    icon: FileText },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    icon: DollarSign,
    module: 'finances',
    activePrefixes: ['/finances'],
    items: [
      { name: 'Financeiro',  href: '/finances', icon: DollarSign },
    ],
  },
  {
    key: 'dp',
    label: 'Depart. Pessoal',
    icon: UserCheck,
    module: 'personnel_department',
    activePrefixes: ['/personnel-department', '/dp/'],
    items: [
      { name: 'Depart. Pessoal', href: '/personnel-department', icon: UserCheck },
    ],
  },
  {
    key: 'manutencao',
    label: 'Manutenção',
    icon: HardHat,
    module: 'maintenance',
    activePrefixes: ['/maintenance'],
    items: [
      { name: 'Dashboard',     href: '/maintenance',            icon: HardHat },
      { name: 'Equipamentos',  href: '/maintenance/equipment',  icon: Wrench },
    ],
  },
  {
    key: 'recepcao',
    label: 'Recepção',
    icon: BedDouble,
    module: 'reception',
    activePrefixes: ['/reception'],
    items: [
      { name: 'Rack de UH\'s', href: '/reception/rack',     icon: BedDouble },
      { name: 'Check-in',      href: '/reception/checkin',   icon: LogIn },
      { name: 'Check-out',     href: '/reception/checkout',  icon: LogOut },
      { name: 'In House',      href: '/reception/inhouse',   icon: Users },
    ],
  },
  {
    key: 'reservas',
    label: 'Reservas',
    icon: Search,
    module: 'reservations',
    activePrefixes: ['/reservations'],
    items: [
      { name: 'Reservas',        href: '/reservations/search',       icon: Search },
      { name: 'Disponibilidade', href: '/reservations/availability', icon: CalendarCheck },
      { name: 'Planning',        href: '/reservations/planning',     icon: CalendarRange },
    ],
  },
  {
    key: 'admin',
    label: 'Configurações',
    icon: SettingsIcon,
    adminOnly: true,
    activePrefixes: ['/users', '/admin/roles', '/admin/sectors', '/admin/erbon', '/admin/whatsapp'],
    items: [
      { name: 'Usuários',         href: '/users',            icon: UsersRound },
      { name: 'Gestão de Perfis', href: '/admin/roles',      icon: UserCog },
      { name: 'Gestão de Setores',href: '/admin/sectors',    icon: LayoutGrid },
      { name: 'Erbon PMS',        href: '/admin/erbon',      icon: Link2 },
      { name: 'WhatsApp',         href: '/admin/whatsapp',   icon: MessageSquare },
    ],
  },
];

// ---------------------------------------------------------------------------
// Navbar
// ---------------------------------------------------------------------------
const Navbar = () => {
  const { user, logout: authLogout } = useAuth();
  const { can, isAdmin }              = usePermissions();
  const { selectedHotel, setSelectedHotel } = useHotel();
  const { theme, toggleTheme } = useTheme();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hotelDisplayName, setHotelDisplayName] = useState("");
  const [allHotels, setAllHotels] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const name = selectedHotel?.name || "Hotel";
    setHotelDisplayName(hotelNameMapping[name] || name);
  }, [selectedHotel]);

  useEffect(() => {
    supabase.from('hotels').select('id, name').order('name').then(({ data }) => {
      if (data) setAllHotels(data);
    });
  }, []);

  const handleSignOut = async () => {
    const { success } = await authLogout();
    if (success) navigate("/login");
  };

  // Helper: is current path
  const isActive = (href: string) =>
    href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);

  // Seções visíveis (filtrado por permissão)
  const visibleSections = useMemo(() =>
    NAV_SECTIONS.filter(s => {
      if (s.adminOnly) return isAdmin;
      if (s.module) return can(s.module);
      return true;
    }),
    [isAdmin, can]
  );

  // Seção ativa baseada na rota atual — prioriza o prefix mais longo (mais específico)
  const activeSection = useMemo(() => {
    if (location.pathname === '/') return null;
    let best: { section: typeof visibleSections[0]; len: number } | null = null;
    for (const s of visibleSections) {
      for (const prefix of s.activePrefixes) {
        if (location.pathname.startsWith(prefix) && prefix.length > (best?.len ?? 0)) {
          best = { section: s, len: prefix.length };
        }
      }
    }
    return best?.section || null;
  }, [location.pathname, visibleSections]);

  // Itens contextuais a mostrar na navbar
  const contextItems = activeSection?.items || [];

  // Early return DEPOIS de todos os hooks
  if (!user) return null;

  return (
    <nav className="bg-white dark:bg-gray-900 shadow-md w-full z-50 sticky top-0">
      <div className="mx-auto px-2 sm:px-4 lg:px-6">
        <div className="relative flex items-center justify-between h-14">

          {/* ── Logo + hotel + switcher ────────────────────────────────────── */}
          <div className="flex items-center flex-shrink-0 gap-1">
            <Link to="/" className="flex items-center gap-2 group">
              <HotelIcon className="h-6 w-6 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <span className="text-sm sm:text-base font-bold text-gray-800 dark:text-white whitespace-nowrap truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {hotelDisplayName}
              </span>
            </Link>

            {/* Hotel switcher dropdown */}
            <Menu as="div" className="relative">
              <Menu.Button
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Trocar Hotel"
              >
                <ChevronDownIcon className="h-4 w-4" />
              </Menu.Button>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="absolute left-0 mt-2 w-56 rounded-2xl shadow-xl bg-white dark:bg-gray-800 ring-1 ring-black/5 dark:ring-gray-700 focus:outline-none z-50 overflow-hidden">
                  <div className="py-1">
                    <p className="px-4 pt-2 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                      Selecionar Hotel
                    </p>
                    {allHotels.map(hotel => (
                      <Menu.Item key={hotel.id}>
                        {({ active }) => (
                          <button
                            onClick={() => {
                              setSelectedHotel(hotel as any);
                              navigate('/');
                            }}
                            className={classNames(
                              active ? "bg-gray-50 dark:bg-gray-700" : "",
                              selectedHotel?.id === hotel.id
                                ? "text-blue-600 dark:text-blue-400 font-semibold"
                                : "text-gray-700 dark:text-gray-200",
                              "flex items-center justify-between w-full px-4 py-2.5 text-sm transition-colors"
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <BuildingIcon className="h-4 w-4 flex-shrink-0" />
                              {hotel.name}
                            </span>
                            {selectedHotel?.id === hotel.id && (
                              <CheckIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            )}
                          </button>
                        )}
                      </Menu.Item>
                    ))}
                  </div>
                </Menu.Items>
              </Transition>
            </Menu>

            {/* Separador + breadcrumb clicável — abre mega-menu de módulos */}
            <div className="hidden sm:flex items-center gap-1 ml-2 text-gray-400 dark:text-gray-500">
              <ChevronRight className="h-3.5 w-3.5" />
              <Menu as="div" className="relative">
                <Menu.Button className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  {activeSection ? (
                    <>
                      <activeSection.icon className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                        {activeSection.label}
                      </span>
                    </>
                  ) : (
                    <>
                      <Home className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Dashboard
                      </span>
                    </>
                  )}
                  <ChevronDownIcon className="h-3.5 w-3.5 text-gray-400" />
                </Menu.Button>

                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-150"
                  enterFrom="transform opacity-0 scale-95 -translate-y-1"
                  enterTo="transform opacity-100 scale-100 translate-y-0"
                  leave="transition ease-in duration-100"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items className="absolute left-0 mt-2 w-72 max-h-[70vh] overflow-y-auto rounded-2xl shadow-2xl bg-white dark:bg-gray-800 ring-1 ring-black/5 dark:ring-gray-700 focus:outline-none z-50">
                    <div className="py-2">
                      {/* Dashboard */}
                      <Menu.Item>
                        {({ active }) => (
                          <Link
                            to="/"
                            className={classNames(
                              active ? 'bg-gray-50 dark:bg-gray-700' : '',
                              location.pathname === '/' ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-700 dark:text-gray-200',
                              'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors'
                            )}
                          >
                            <Home className="h-4 w-4 flex-shrink-0" />
                            Dashboard
                          </Link>
                        )}
                      </Menu.Item>

                      <div className="border-t border-gray-100 dark:border-gray-700 my-1" />

                      {/* Módulos com sub-itens */}
                      {visibleSections.map(section => {
                        const isCurrent = activeSection?.key === section.key;
                        return (
                          <div key={section.key}>
                            <p className={classNames(
                              'px-4 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5',
                              isCurrent ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
                            )}>
                              <section.icon className="h-3.5 w-3.5" />
                              {section.label}
                            </p>
                            {section.items.map(item => (
                              <Menu.Item key={item.href}>
                                {({ active }) => (
                                  <Link
                                    to={item.href}
                                    className={classNames(
                                      active ? 'bg-gray-50 dark:bg-gray-700' : '',
                                      isActive(item.href)
                                        ? 'text-blue-600 dark:text-blue-400 font-semibold bg-blue-50/50 dark:bg-blue-900/20'
                                        : 'text-gray-600 dark:text-gray-300',
                                      'flex items-center gap-3 pl-8 pr-4 py-2 text-sm transition-colors'
                                    )}
                                  >
                                    <item.icon className="h-4 w-4 flex-shrink-0" />
                                    {item.name}
                                    {isActive(item.href) && (
                                      <CheckIcon className="h-3.5 w-3.5 ml-auto text-blue-500" />
                                    )}
                                  </Link>
                                )}
                              </Menu.Item>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </Menu.Items>
                </Transition>
              </Menu>
            </div>
          </div>

          {/* ── Nav contextual desktop ─────────────────────────────────────── */}
          <div className="hidden lg:flex flex-grow justify-center px-4">
            {contextItems.length > 0 ? (
              <div className="flex items-center gap-1">
                {contextItems.map((item) => (
                  <Link
                    key={item.href}
                    to={item.href}
                    className={classNames(
                      isActive(item.href)
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white",
                      "px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 whitespace-nowrap transition-all duration-150"
                    )}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    {item.name}
                  </Link>
                ))}
              </div>
            ) : (
              /* No Dashboard — sem itens contextuais, mostra nada */
              null
            )}
          </div>

          {/* ── Ações direita ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">

            {/* Toggle tema */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Alternar tema"
            >
              {theme === "light" ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
            </button>

            <NotificationBell />

            {/* ── Menu mobile (hamburguer) ─────────────────────────────── */}
            <button
              className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden transition-colors"
              onClick={() => setMobileMenuOpen(prev => !prev)}
            >
              <span className="sr-only">Abrir menu</span>
              {mobileMenuOpen ? <XIcon className="h-5 w-5" /> : <MenuIconLucide className="h-5 w-5" />}
            </button>

            {/* ── Avatar dropdown (desktop) ────────────────────────────── */}
            <div className="hidden lg:block">
              <Menu as="div" className="relative">
                <Menu.Button className="flex text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900">
                  <img
                    className="h-8 w-8 rounded-full"
                    src={`https://ui-avatars.com/api/?name=${user.email || "U"}&background=random&color=fff`}
                    alt="Avatar"
                  />
                </Menu.Button>

                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items className="origin-top-right absolute right-0 mt-2 w-56 rounded-2xl shadow-xl bg-white dark:bg-gray-800 ring-1 ring-black/5 dark:ring-gray-700 focus:outline-none z-50 overflow-hidden">
                    <div className="py-1">
                      {/* User info */}
                      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                        <p className="text-xs text-gray-400">Logado como</p>
                        <p className="text-sm font-semibold text-gray-800 dark:text-white truncate mt-0.5">
                          {user.email}
                        </p>
                        <span className="inline-block mt-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                          {isAdmin ? 'Admin' : (user as any).custom_role?.name || user.role || 'Sem perfil'}
                        </span>
                      </div>

                      <Menu.Item>
                        {({ active }) => (
                          <Link to="/profile"
                            className={classNames(active ? "bg-gray-50 dark:bg-gray-700" : "", "flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200")}>
                            <ProfileIcon className="h-4 w-4" />Seu Perfil
                          </Link>
                        )}
                      </Menu.Item>

                      <Menu.Item>
                        {({ active }) => (
                          <Link to="/settings"
                            className={classNames(active ? "bg-gray-50 dark:bg-gray-700" : "", "flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200")}>
                            <SettingsIcon className="h-4 w-4" />Configurações
                          </Link>
                        )}
                      </Menu.Item>

                      <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                        <Menu.Item>
                          {({ active }) => (
                            <button
                              onClick={handleSignOut}
                              className={classNames(active ? "bg-gray-50 dark:bg-gray-700" : "", "flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-600 dark:text-red-400")}>
                              <LogOutIcon className="h-4 w-4" />Sair
                            </button>
                          )}
                        </Menu.Item>
                      </div>
                    </div>
                  </Menu.Items>
                </Transition>
              </Menu>
            </div>

          </div>
        </div>

        {/* ── Menu mobile expandido ───────────────────────────────────────── */}
        {mobileMenuOpen && (
          <div className="lg:hidden absolute top-14 left-0 w-full bg-white dark:bg-gray-900 shadow-lg pb-4 z-40 border-t border-gray-100 dark:border-gray-800 max-h-[80vh] overflow-y-auto">

            {/* Sub-itens contextuais (seção ativa) */}
            {activeSection && contextItems.length > 0 && (
              <div className="px-3 pt-3 pb-2">
                <p className="px-3 pb-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                  <activeSection.icon className="h-3.5 w-3.5" />
                  {activeSection.label}
                </p>
                <div className="space-y-0.5">
                  {contextItems.map(item => (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={classNames(
                        isActive(item.href)
                          ? "bg-blue-600 text-white"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium"
                      )}
                    >
                      <item.icon className="h-5 w-5 flex-shrink-0" />
                      {item.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Todos os módulos */}
            <div className="px-3 pt-2 pb-2">
              {activeSection && <div className="border-t border-gray-100 dark:border-gray-700 my-2" />}
              <p className="px-3 pb-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                Módulos
              </p>
              <div className="space-y-0.5">
                <Link
                  to="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className={classNames(
                    location.pathname === '/'
                      ? "bg-blue-600 text-white"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium"
                  )}
                >
                  <Home className="h-5 w-5 flex-shrink-0" />
                  Dashboard
                </Link>
                {visibleSections.map(section => {
                  const isCurrentSection = activeSection?.key === section.key;
                  const mainHref = section.items[0]?.href || '/';
                  return (
                    <Link
                      key={section.key}
                      to={mainHref}
                      onClick={() => setMobileMenuOpen(false)}
                      className={classNames(
                        isCurrentSection
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-semibold"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium"
                      )}
                    >
                      <section.icon className="h-5 w-5 flex-shrink-0" />
                      {section.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* User info + actions */}
            <div className="border-t border-gray-100 dark:border-gray-700 mt-2 pt-3 px-3 space-y-1">
              <div className="flex items-center gap-3 px-3 py-2 mb-2">
                <img
                  className="h-10 w-10 rounded-full flex-shrink-0"
                  src={`https://ui-avatars.com/api/?name=${user.email || "U"}&background=random&color=fff`}
                  alt="Avatar"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
                    {user.email?.split("@")[0]}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{user.email}</p>
                </div>
              </div>

              <Link to="/profile"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
                <ProfileIcon className="h-5 w-5" />Seu Perfil
              </Link>

              <Link to="/settings"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
                <SettingsIcon className="h-5 w-5" />Configurações
              </Link>

              <button
                onClick={() => { handleSignOut(); setMobileMenuOpen(false); }}
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10">
                <LogOutIcon className="h-5 w-5" />Sair
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
