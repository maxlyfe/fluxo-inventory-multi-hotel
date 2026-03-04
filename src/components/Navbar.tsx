// src/components/Navbar.tsx

import classNames from 'classnames';
import React, { useState, useEffect, Fragment } from "react";
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
  Users as UsersIcon,
  Building2 as BuildingIcon,
  LogOut as LogOutIcon,
  SunMedium as SunIcon,
  Moon as MoonIcon,
  Menu as MenuIconLucide,
  X as XIcon,
  Settings as SettingsIcon,
  UserCircle2 as ProfileIcon,
  LayoutDashboard as DashboardIcon,
  ClipboardList as RequisicoesIcon,
  FileText as OrcamentosIcon,
  Briefcase as AlmoxarifadoIcon,
  ShoppingCart as ComprasIcon,
  DollarSign as FinanceiroIcon,
  ConciergeBell as RecepcaoIcon,
  Utensils as RestauranteIcon,
  BedDouble as GovernancaIcon,
  Wrench as ManutencaoIcon,
  UsersRound as UserManagementIcon,
  // Novos ícones admin
  UserCog as RolesIcon,
  LayoutGrid as SectorsIcon,
  ChevronDown as ChevronDownIcon,
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
// Navigation items
// ---------------------------------------------------------------------------
// module: chave do módulo em usePermissions (undefined = visível para todos logados)
const navigationItems = [
  {
    name:   "Dashboard",
    href:   "/",
    icon:   DashboardIcon,
    module: undefined,          // dashboard sempre visível
  },
  {
    name:   "Requisições",
    href:   "/admin",
    icon:   RequisicoesIcon,
    module: "stock",            // stock geral / requisições de setor
  },
  {
    name:   "Compras",
    href:   "/purchases",
    icon:   ComprasIcon,
    module: "purchases",
  },
  {
    name:   "Orçamentos",
    href:   "/budget-history",
    icon:   OrcamentosIcon,
    module: "authorizations",   // mesmo módulo — fluxo de compra
  },
  {
    name:   "Aprovações",
    href:   "/authorizations",
    icon:   ComprasIcon,
    module: "authorizations",
  },
];

// Itens exclusivos admin — aparecem no dropdown de Administração
const adminItems = [
  { name: "Usuários",          href: "/users",         icon: UserManagementIcon },
  { name: "Gestão de Perfis",  href: "/admin/roles",   icon: RolesIcon          },
  { name: "Gestão de Setores", href: "/admin/sectors",  icon: SectorsIcon        },
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

  useEffect(() => {
    const name = selectedHotel?.name || "Hotel";
    setHotelDisplayName(hotelNameMapping[name] || name);
  }, [selectedHotel]);

  const handleSignOut = async () => {
    const { success } = await authLogout();
    if (success) navigate("/login");
  };

  const handleChangeHotel = () => {
    setSelectedHotel(null);
    navigate("/select-hotel");
  };

  const filteredNavigation = navigationItems.filter(
    (item) => item.module === undefined ? true : can(item.module)
  );

  if (!user) return null;

  // Helper: is current path
  const isActive = (href: string) =>
    href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);

  return (
    <nav className="bg-white dark:bg-gray-900 shadow-md w-full z-50">
      <div className="mx-auto px-2 sm:px-4 lg:px-6">
        <div className="relative flex items-center justify-between h-16">

          {/* ── Logo + hotel ─────────────────────────────────────────────── */}
          <div className="flex items-center flex-shrink-0">
            <Link to="/" className="flex items-center space-x-2">
              <HotelIcon className="h-7 w-7 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <span className="text-base sm:text-lg font-semibold text-gray-800 dark:text-white whitespace-nowrap truncate">
                {hotelDisplayName}
              </span>
            </Link>
            <button
              onClick={handleChangeHotel}
              className="ml-2 p-1.5 rounded-md text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center space-x-1 whitespace-nowrap flex-shrink-0"
              title="Trocar Hotel"
            >
              <BuildingIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Trocar Hotel</span>
            </button>
          </div>

          {/* ── Nav desktop ──────────────────────────────────────────────── */}
          <div className="hidden lg:flex flex-grow justify-center px-2">
            <div className="flex items-baseline space-x-1">
              {filteredNavigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={classNames(
                    isActive(item.href)
                      ? "bg-blue-600 text-white dark:bg-blue-700"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white",
                    "px-2 py-2 rounded-md text-xs xl:text-sm font-medium flex items-center space-x-1 xl:space-x-2 whitespace-nowrap"
                  )}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <item.icon className="h-4 w-4 xl:h-5 xl:w-5 flex-shrink-0" />
                  <span className="hidden xl:inline">{item.name}</span>
                  <span className="xl:hidden">{item.name.substring(0, 3)}</span>
                </Link>
              ))}

              {/* ── Dropdown Administração (só admin) ────────────────────── */}
              {isAdmin && (
                <Menu as="div" className="relative">
                  <Menu.Button
                    className={classNames(
                      adminItems.some(i => isActive(i.href))
                        ? "bg-blue-600 text-white dark:bg-blue-700"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white",
                      "px-2 py-2 rounded-md text-xs xl:text-sm font-medium flex items-center space-x-1 xl:space-x-2 whitespace-nowrap"
                    )}>
                    <SettingsIcon className="h-4 w-4 xl:h-5 xl:w-5 flex-shrink-0" />
                    <span className="hidden xl:inline">Admin</span>
                    <span className="xl:hidden">Adm</span>
                    <ChevronDownIcon className="h-3 w-3 opacity-60" />
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
                    <Menu.Items className="absolute left-0 mt-2 w-52 rounded-2xl shadow-xl bg-white dark:bg-gray-800 ring-1 ring-black/5 dark:ring-gray-700 focus:outline-none z-50 overflow-hidden">
                      <div className="py-1">
                        <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          Administração
                        </p>
                        {adminItems.map(item => (
                          <Menu.Item key={item.href}>
                            {({ active }) => (
                              <Link
                                to={item.href}
                                className={classNames(
                                  active ? "bg-gray-50 dark:bg-gray-700" : "",
                                  isActive(item.href) ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-gray-700 dark:text-gray-200",
                                  "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
                                )}
                              >
                                <item.icon className="h-4 w-4 flex-shrink-0" />
                                {item.name}
                              </Link>
                            )}
                          </Menu.Item>
                        ))}
                      </div>
                    </Menu.Items>
                  </Transition>
                </Menu>
              )}
            </div>
          </div>

          {/* ── Ações direita ────────────────────────────────────────────── */}
          <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">

            {/* Toggle tema */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              aria-label="Alternar tema"
            >
              {theme === "light" ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
            </button>

            <NotificationBell />

            {/* ── Menu mobile (hamburguer) ─────────────────────────────── */}
            <button
              className="p-2 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 lg:hidden"
              onClick={() => setMobileMenuOpen(prev => !prev)}
            >
              <span className="sr-only">Abrir menu</span>
              {mobileMenuOpen ? <XIcon className="h-6 w-6" /> : <MenuIconLucide className="h-6 w-6" />}
            </button>

            {/* ── Avatar dropdown (desktop) ────────────────────────────── */}
            <div className="hidden lg:block">
              <Menu as="div" className="relative">
                <Menu.Button className="flex text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800">
                  <span className="sr-only">Abrir menu do usuário</span>
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
                        <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 uppercase tracking-wide">
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

        {/* ── Menu mobile expandido ─────────────────────────────────────── */}
        {mobileMenuOpen && (
          <div className="lg:hidden absolute top-16 left-0 w-full bg-white dark:bg-gray-900 shadow-lg pb-4 z-40 border-t border-gray-100 dark:border-gray-800">

            {/* Nav items */}
            <div className="px-3 pt-3 pb-2 space-y-1">
              {filteredNavigation.map((item) => (
                <Link
                  key={item.name}
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

              {/* Admin section (mobile) */}
              {isAdmin && (
                <>
                  <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    Administração
                  </p>
                  {adminItems.map(item => (
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
                </>
              )}
            </div>

            {/* User info + actions (mobile) */}
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