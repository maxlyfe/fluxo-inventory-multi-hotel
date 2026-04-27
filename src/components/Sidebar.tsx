import React, { useState, useMemo, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronRight, Layout, Home,
  LogOut, UserCircle2, Menu, X, Boxes, ClipboardList,
} from 'lucide-react';
import classNames from 'classnames';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useHotel } from '../context/HotelContext';
import { supabase } from '../lib/supabase';
import { NAV_GROUPS } from '../lib/navigationConfig';
import type { NavItem } from '../lib/navigationConfig';

// ── Tipos internos ────────────────────────────────────────────────────────────

interface SectorRow { id: string; name: string; color: string | null; }

// ── Sidebar ───────────────────────────────────────────────────────────────────

const Sidebar = () => {
  const { user, logout: authLogout }         = useAuth();
  const { can, isAdmin, isDev, canAccessContacts } = usePermissions();
  const { selectedHotel }                    = useHotel();
  const location                             = useLocation();

  // Desktop: hover-to-expand
  const [isHovered,       setIsHovered]       = useState(false);
  // Mobile: toggle overlay
  const [isMobileOpen,    setIsMobileOpen]    = useState(false);
  // Accordion
  const [expandedGroups,  setExpandedGroups]  = useState<Record<string, boolean>>({});
  // Dynamic sectors
  const [allSectors, setAllSectors] = useState<SectorRow[]>([]);

  // Fecha overlay ao navegar
  useEffect(() => { setIsMobileOpen(false); }, [location.pathname]);

  // Carrega setores do hotel selecionado
  useEffect(() => {
    if (!selectedHotel?.id) return;
    supabase
      .from('sectors')
      .select('id, name, color')
      .eq('hotel_id', selectedHotel.id)
      .order('name')
      .then(({ data }) => setAllSectors(data ?? []));
  }, [selectedHotel?.id]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isActive = (href: string) =>
    href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);

  // ── Seções visíveis com itens dinâmicos injetados ──────────────────────────
  const visibleSections = useMemo(() => {
    return NAV_GROUPS
      .filter(s => {
        // Requisições — visível para qualquer autenticado se há setores
        if (s.dynamicKey === 'allSectors') return !!user;

        if (s.adminOnly) {
          if (isDev) return true;
          if (isAdmin && !user?.custom_role_id) return true;
          if (s.module && can(s.module)) return true;
          return s.items.some(i => can(i.module));
        }
        if (s.module) {
          if (can(s.module)) return true;
          if (s.key === 'compras' && canAccessContacts) return true;
          // Não retorna false — verifica se há pelo menos um item acessível
        }
        return s.items.some(i => {
          if (i.module === '__contacts__') return isAdmin || can('purchases') || canAccessContacts;
          if (!i.module) return true;
          return can(i.module);
        });
      })
      .map(s => {
        // Filtrar itens estáticos por permissão
        const staticItems: NavItem[] = s.items.filter(i => {
          if (i.module === '__contacts__') return isAdmin || can('purchases') || canAccessContacts;
          if (!i.module) return true;
          return can(i.module);
        });

        // Injetar stock setorial no grupo "stock"
        if (s.dynamicKey === 'stockSectors') {
          const stockItems: NavItem[] = allSectors
            .filter(sec => isAdmin || isDev || can(`sector_stock:${sec.id}`))
            .map(sec => ({
              module:   `sector_stock:${sec.id}`,
              label:    sec.name,
              href:     `/sector-stock/${sec.id}`,
              icon:     Boxes,
              iconName: 'Boxes',
              color:    sec.color ?? '#8b5cf6',
            }));
          return { ...s, items: [...staticItems, ...stockItems] };
        }

        // Injetar todos os setores no grupo "requisicoes"
        if (s.dynamicKey === 'allSectors') {
          const sectorItems: NavItem[] = allSectors.map(sec => ({
            module:   '',
            label:    sec.name,
            href:     `/sector/${sec.id}`,
            icon:     ClipboardList,
            iconName: 'ClipboardList',
            color:    sec.color ?? '#6366f1',
          }));
          return { ...s, items: sectorItems };
        }

        return { ...s, items: staticItems };
      })
      .filter(s => s.items.length > 0);
  }, [isAdmin, isDev, can, canAccessContacts, user, allSectors]);

  if (!user) return null;

  // ── Conteúdo interior (reutilizado em desktop e mobile) ───────────────────

  const expanded = isHovered || isMobileOpen; // texto visível quando expandido

  const sidebarContent = (
    <div className="flex flex-col h-full py-4 overflow-hidden">

      {/* Logo */}
      <Link to="/" className="flex items-center gap-3 px-4 mb-6">
        <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/30">
          <Layout className="w-5 h-5 text-white" />
        </div>
        <span className={classNames(
          "font-bold text-slate-700 dark:text-slate-200 tracking-tight transition-opacity duration-200 whitespace-nowrap",
          expanded ? "opacity-100" : "opacity-0"
        )}>
          LyFe Hoteles
        </span>
      </Link>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1 scrollbar-hide">

        {/* Dashboard */}
        <Link
          to="/"
          className={classNames(
            "flex items-center gap-3 px-2 py-2 rounded-xl transition-all group",
            isActive('/')
              ? "bg-blue-500 text-white shadow-md shadow-blue-500/20"
              : "text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
          )}
        >
          <Home className="w-5 h-5 shrink-0" />
          <span className={classNames(
            "text-sm font-medium truncate transition-opacity duration-200 whitespace-nowrap",
            expanded ? "opacity-100" : "opacity-0"
          )}>
            Dashboard
          </span>
        </Link>

        {/* Separador */}
        <div className={classNames("my-2 border-t border-slate-100 dark:border-slate-800 transition-opacity duration-200", expanded ? "opacity-100" : "opacity-30")} />

        {/* Grupos dinâmicos */}
        {visibleSections.map(section => {
          const isExpanded   = expandedGroups[section.key];
          const hasActiveItem = section.items.some(i => isActive(i.href));

          return (
            <div key={section.key}>

              {/* Header da seção */}
              <button
                onClick={() => toggleGroup(section.key)}
                title={expanded ? undefined : section.label}
                className={classNames(
                  "w-full flex items-center gap-3 px-2 py-2 rounded-xl transition-all",
                  isExpanded || hasActiveItem
                    ? "text-blue-500 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-900/10"
                    : "text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-600 dark:hover:text-slate-300"
                )}
              >
                <section.icon className="w-5 h-5 shrink-0" />
                <span className={classNames(
                  "text-[11px] font-medium uppercase tracking-wider truncate transition-opacity duration-200 whitespace-nowrap flex-1 text-left",
                  expanded ? "opacity-100" : "opacity-0"
                )}>
                  {section.label}
                </span>
                {expanded && (
                  <ChevronRight className={classNames(
                    "w-3 h-3 shrink-0 transition-transform duration-200",
                    isExpanded ? "rotate-90" : ""
                  )} />
                )}
              </button>

              {/* Itens */}
              {(isExpanded || (hasActiveItem && !expanded)) && (
                <div className={classNames("mt-0.5 space-y-0.5", expanded ? "ml-3" : "ml-0")}>
                  {section.items.map(item => (
                    <Link
                      key={item.href}
                      to={item.href}
                      title={expanded ? undefined : item.label}
                      className={classNames(
                        "flex items-center gap-3 px-2 py-1.5 rounded-lg transition-all",
                        isActive(item.href)
                          ? "text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10"
                          : "text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      )}
                    >
                      <item.icon
                        className="w-4 h-4 shrink-0"
                        style={{ color: isActive(item.href) ? item.color : undefined }}
                      />
                      <span className={classNames(
                        "text-sm font-normal truncate transition-opacity duration-200 whitespace-nowrap",
                        expanded ? "opacity-100" : "opacity-0"
                      )}>
                        {item.label}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-2 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-0.5">
        <Link
          to="/profile"
          className="flex items-center gap-3 px-2 py-2 rounded-xl text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition-all"
        >
          <UserCircle2 className="w-5 h-5 shrink-0" />
          <span className={classNames("text-sm font-normal truncate transition-opacity duration-200 whitespace-nowrap", expanded ? "opacity-100" : "opacity-0")}>
            Perfil
          </span>
        </Link>
        <button
          onClick={() => authLogout()}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 hover:text-red-500 transition-all"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          <span className={classNames("text-sm font-normal truncate transition-opacity duration-200 whitespace-nowrap", expanded ? "opacity-100" : "opacity-0")}>
            Sair
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Desktop sidebar (hover-to-expand) — oculto em mobile ───────────── */}
      <aside
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={classNames(
          "hidden lg:flex fixed left-0 top-0 h-full z-[60] flex-col",
          "bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800",
          "transition-all duration-300 ease-in-out",
          isHovered ? "w-60" : "w-14"
        )}
      >
        {sidebarContent}
      </aside>

      {/* ── Botão hamburger — visível apenas em mobile ──────────────────────── */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-[70] p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        aria-label="Abrir menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* ── Overlay backdrop mobile ─────────────────────────────────────────── */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[65] bg-black/40 backdrop-blur-sm"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* ── Sidebar mobile (slide-in) ────────────────────────────────────────── */}
      <aside
        className={classNames(
          "lg:hidden fixed left-0 top-0 h-full z-[70] w-64",
          "bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800",
          "transition-transform duration-300 ease-in-out",
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Botão fechar */}
        <button
          onClick={() => setIsMobileOpen(false)}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Fechar menu"
        >
          <X className="w-4 h-4" />
        </button>
        {sidebarContent}
      </aside>
    </>
  );
};

export default Sidebar;
