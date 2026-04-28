// src/components/Navbar.tsx
// Navbar contextual — mostra sub-itens do módulo ativo baseado na rota atual.
// ⚠️  Menu items vêm de navigationConfig.ts — altere lá para manter sidebar e navbar sincronizados.

import classNames from 'classnames';
import React, { useState, useEffect, useMemo, Fragment } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Menu, Transition } from '@headlessui/react';
import { supabase } from "../lib/supabase";
import NotificationBell from "./NotificationBell";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../hooks/usePermissions";
import { NAV_GROUPS, CONTACT_ITEM_HREF } from "../lib/navigationConfig";
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
  Home,
  ChevronRight,
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
// Navbar
// ---------------------------------------------------------------------------
const Navbar = () => {
  const { user, logout: authLogout } = useAuth();
  const { can, isAdmin, isDev, canAccessContacts } = usePermissions();
  const { selectedHotel, setSelectedHotel } = useHotel();
  const { theme, toggleTheme } = useTheme();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hotelDisplayName, setHotelDisplayName] = useState("");
  const [allHotels, setAllHotels] = useState<{ id: string; name: string }[]>([]);

  // Expanded sections state — persisted in sessionStorage
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem('nav_expanded_sections');
      return new Set<string>(saved ? JSON.parse(saved) : []);
    } catch { return new Set<string>(); }
  });

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

  // Seções visíveis (filtrado por permissão) — fonte: navigationConfig.ts
  const visibleSections = useMemo(() =>
    NAV_GROUPS
      .filter(s => {
        // Ignora grupo "requisicoes" (só faz sentido no sidebar da Home)
        if (s.dynamicKey === 'allSectors') return false;
        
        // Regra de Administração (AdminLegado ou Dev ou Permissão específica)
        if (s.adminOnly) {
          if (isDev) return true;
          if (isAdmin && !user?.custom_role_id) return true;
          // Se tiver módulo específico (ex: roles_management), can() já resolve
          if (s.module && can(s.module)) return true;
          // Se não tiver módulo no grupo, mas tiver em algum item
          return s.items.some(i => can(i.module));
        }

        if (s.module) {
          if (can(s.module)) return true;
          if (s.key === 'compras' && canAccessContacts) return true;
          // Não retorna false — verifica se há pelo menos um item acessível
        }

        // Mostra o grupo se o user tem permissão em PELO MENOS um dos seus itens
        return s.items.some(i => {
          if (i.module === '__contacts__') return isAdmin || can('purchases') || canAccessContacts;
          if (!i.module) return true;
          return can(i.module);
        });
      })
      .map(s => {
        // Filtra os itens individualmente dentro de cada grupo
        const filteredItems = s.items.filter(i => {
           if (i.module === '__contacts__') return isAdmin || can('purchases') || canAccessContacts;
           return can(i.module);
        });
        return { ...s, items: filteredItems };
      })
      .filter(s => s.items.length > 0), // Remove grupos que ficaram vazios
    [isAdmin, isDev, can, canAccessContacts, user?.custom_role_id]
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

  // Auto-expand active section when route changes (after activeSection is declared)
  useEffect(() => {
    if (activeSection) {
      setExpandedSections(prev => {
        if (prev.has(activeSection.key)) return prev;
        const next = new Set(prev);
        next.add(activeSection.key);
        try { sessionStorage.setItem('nav_expanded_sections', JSON.stringify([...next])); } catch {}
        return next;
      });
    }
  }, [activeSection?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleNavSection = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try { sessionStorage.setItem('nav_expanded_sections', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Early return DEPOIS de todos os hooks
  if (!user) return null;

  return (
    <nav className="bg-white dark:bg-gray-900 shadow-md w-full z-50 sticky top-0">
      <div className="mx-auto px-2 sm:px-4 lg:px-6">
        <div className="relative flex items-center justify-between h-14">

          {/* ── Logo + hotel + switcher ────────────────────────────────────── */}
          {/* pl-10: espaço para o botão hamburger fixo no mobile */}
          <div className="flex items-center flex-shrink-0 gap-1 pl-10 lg:pl-0">
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

                      {/* Módulos com sub-itens — recolhíveis, com memória */}
                      {visibleSections.map(section => {
                        const isCurrent = activeSection?.key === section.key;
                        const isExpanded = expandedSections.has(section.key);
                        return (
                          <div key={section.key}>
                            {/* Section header — clicável para expandir/recolher */}
                            <button
                              onClick={(e) => toggleNavSection(section.key, e)}
                              className={classNames(
                                'w-full flex items-center justify-between px-4 pt-2.5 pb-2 text-[11px] font-bold uppercase tracking-widest transition-colors',
                                isCurrent
                                  ? 'text-blue-500 dark:text-blue-400'
                                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400'
                              )}
                            >
                              <span className="flex items-center gap-1.5">
                                <section.icon className="h-3.5 w-3.5" />
                                {section.label}
                              </span>
                              <ChevronRight className={classNames(
                                'h-3 w-3 transition-transform duration-200',
                                isExpanded ? 'rotate-90' : ''
                              )} />
                            </button>

                            {/* Sub-itens — só visíveis quando expandido */}
                            {isExpanded && section.items.map(item => (
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
                                    {item.label}
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
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : (
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
                  <div className="h-8 w-8 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    {user.photo_url ? (
                      <img className="h-full w-full object-cover" src={user.photo_url} alt="Avatar" />
                    ) : (
                      <img
                        className="h-full w-full"
                        src={`https://ui-avatars.com/api/?name=${user.email || "U"}&background=random&color=fff`}
                        alt="Avatar"
                      />
                    )}
                  </div>
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
                          {isDev ? 'Dev' : isAdmin ? 'Admin' : (user as any).custom_role?.name || user.role || 'Sem perfil'}
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
                      {item.label}
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
                  const hasSubItems = section.items.length > 1;
                  const mainHref = section.items[0]?.href || '/';
                  return (
                    <div key={section.key}>
                      {/* Section header — link direto se só tem 1 item */}
                      {!hasSubItems ? (
                        <Link
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
                      ) : (
                        <>
                          {/* Section label (não-clicável) */}
                          <p className={classNames(
                            "flex items-center gap-3 px-3 py-2 text-sm font-semibold mt-1",
                            isCurrentSection
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-gray-500 dark:text-gray-400"
                          )}>
                            <section.icon className="h-5 w-5 flex-shrink-0" />
                            {section.label}
                          </p>
                          {/* Sub-itens */}
                          <div className="ml-5 space-y-0.5">
                            {section.items.map(item => (
                              <Link
                                key={item.href}
                                to={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={classNames(
                                  isActive(item.href)
                                    ? "bg-blue-600 text-white"
                                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
                                  "flex items-center gap-3 px-3 py-2 rounded-xl text-sm"
                                )}
                              >
                                <item.icon className="h-4 w-4 flex-shrink-0" />
                                {item.label}
                              </Link>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* User info + actions */}
            <div className="border-t border-gray-100 dark:border-gray-700 mt-2 pt-3 px-3 space-y-1">
              <div className="flex items-center gap-3 px-3 py-2 mb-2">
                <div className="h-10 w-10 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                  {user.photo_url ? (
                    <img className="h-full w-full object-cover" src={user.photo_url} alt="Avatar" />
                  ) : (
                    <img
                      className="h-full w-full"
                      src={`https://ui-avatars.com/api/?name=${user.email || "U"}&background=random&color=fff`}
                      alt="Avatar"
                    />
                  )}
                </div>
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
