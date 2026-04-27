import React, { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  ChevronRight, Layout, Home, Check,
  LogOut, Settings, UserCircle2, Building2
} from 'lucide-react';
import classNames from 'classnames';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useHotel } from '../context/HotelContext';
import { NAV_GROUPS, CONTACT_ITEM_HREF } from '../lib/navigationConfig';

const Sidebar = () => {
  const { user, logout: authLogout } = useAuth();
  const { can, isAdmin, isDev, canAccessContacts } = usePermissions();
  const { selectedHotel } = useHotel();
  const location = useLocation();
  const [isHovered, setIsHovered] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Fecha todos os grupos quando o mouse sai da sidebar (opcional, para limpeza visual)
  const handleMouseLeave = () => {
    setIsHovered(false);
    // setExpandedGroups({}); // Descomente se preferir que tudo feche ao sair
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Helper: is current path
  const isActive = (href: string) =>
    href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);

  const visibleSections = useMemo(() =>
    NAV_GROUPS
      .filter(s => {
        if (s.dynamicKey === 'allSectors') return false;
        if (s.adminOnly) {
          if (isDev) return true;
          if (isAdmin && !user?.custom_role_id) return true;
          if (s.module && can(s.module)) return true;
          return s.items.some(i => can(i.module));
        }
        if (s.module) {
          if (can(s.module)) return true;
          if (s.key === 'compras' && canAccessContacts) return true;
          return false;
        }
        return s.items.some(i => can(i.module));
      })
      .map(s => {
        const filteredItems = s.items.filter(i => {
           if (i.module === '__contacts__') return isAdmin || can('purchases') || canAccessContacts;
           return can(i.module);
        });
        return { ...s, items: filteredItems };
      })
      .filter(s => s.items.length > 0),
    [isAdmin, isDev, can, canAccessContacts, user?.custom_role_id]
  );

  if (!user) return null;

  return (
    <aside 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={classNames(
        "fixed left-0 top-0 h-full z-[60] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 ease-in-out group",
        isHovered ? "w-64" : "w-16"
      )}
    >
      <div className="flex flex-col h-full py-4 overflow-hidden">
        
        {/* Logo / Home */}
        <Link to="/" className="flex items-center gap-3 px-4 mb-8">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/30">
            <Layout className="w-5 h-5 text-white" />
          </div>
          <span className={classNames(
            "font-black text-slate-800 dark:text-white tracking-tight transition-opacity duration-200",
            isHovered ? "opacity-100" : "opacity-0"
          )}>
            LyFe Hoteles
          </span>
        </Link>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto px-2 space-y-6 scrollbar-hide">
          
          {/* Main Dashboard */}
          <div className="space-y-1">
            <Link 
              to="/" 
              className={classNames(
                "flex items-center gap-3 px-2 py-2.5 rounded-xl transition-all",
                isActive('/') 
                  ? "bg-blue-500 text-white shadow-md shadow-blue-500/20" 
                  : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
            >
              <Home className="w-6 h-6 shrink-0" />
              <span className={classNames("text-sm font-bold truncate transition-opacity duration-200", isHovered ? "opacity-100" : "opacity-0")}>Dashboard</span>
            </Link>
          </div>

          {/* Dynamic Sections */}
          {visibleSections.map(section => {
            const isExpanded = expandedGroups[section.key];
            const hasActiveItem = section.items.some(i => isActive(i.href));

            return (
              <div key={section.key} className="space-y-1">
                {/* Header da Seção - Clicável */}
                <button
                  onClick={() => toggleGroup(section.key)}
                  className={classNames(
                    "w-full flex items-center gap-3 px-2 py-2.5 rounded-xl transition-all group/header",
                    isExpanded || hasActiveItem 
                      ? "text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10" 
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  )}
                >
                  <section.icon className="w-6 h-6 shrink-0" />
                  <span className={classNames(
                    "text-xs font-black uppercase tracking-widest truncate transition-opacity duration-200", 
                    isHovered ? "opacity-100" : "opacity-0"
                  )}>
                    {section.label}
                  </span>
                  {isHovered && (
                    <ChevronRight className={classNames(
                      "w-3 h-3 ml-auto transition-transform duration-200",
                      isExpanded ? "rotate-90" : ""
                    )} />
                  )}
                </button>

                {/* Itens da Seção - Condicionais */}
                {(isExpanded || (hasActiveItem && !isHovered)) && (
                  <div className={classNames("space-y-1", isHovered ? "ml-4" : "ml-0")}>
                    {section.items.map(item => (
                      <Link 
                        key={item.href}
                        to={item.href} 
                        title={item.label}
                        className={classNames(
                          "flex items-center gap-3 px-2 py-2.5 rounded-xl transition-all group/item",
                          isActive(item.href)
                            ? "text-blue-600 dark:text-blue-400 font-bold" 
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                        )}
                      >
                        <item.icon 
                          className="w-5 h-5 shrink-0 transition-colors" 
                          style={{ color: isActive(item.href) ? item.color : undefined }}
                        />
                        <span className={classNames(
                          "text-sm font-semibold truncate transition-opacity duration-200", 
                          isHovered ? "opacity-100" : "opacity-0"
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

        {/* Footer Actions */}
        <div className="px-2 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-1">
          <Link 
            to="/profile" 
            className="flex items-center gap-3 px-2 py-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
          >
            <UserCircle2 className="w-6 h-6 shrink-0" />
            <span className={classNames("text-sm font-bold truncate transition-opacity duration-200", isHovered ? "opacity-100" : "opacity-0")}>Perfil</span>
          </Link>
          <button 
            onClick={() => authLogout()}
            className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all"
          >
            <LogOut className="w-6 h-6 shrink-0" />
            <span className={classNames("text-sm font-bold truncate transition-opacity duration-200", isHovered ? "opacity-100" : "opacity-0")}>Sair</span>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
