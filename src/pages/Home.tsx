// src/pages/Home.tsx
// Dashboard principal — sidebar + área de conteúdo

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Package, BarChart3, Building2, ShieldCheck, ChevronDown, ChevronUp,
  Lock, Boxes, ShoppingCart, DollarSign, FileText, CreditCard, Wrench,
  HardHat, UsersRound, ChefHat, UtensilsCrossed, GlassWater, Hotel,
  Layers, Shirt, Coffee, Dumbbell, Leaf, Star, Truck, Printer,
  Monitor, Archive, Menu, X, UserCog, LayoutGrid, Link2,
  Sun, Cloud, Moon, CloudRain, CloudSnow, CloudLightning, CloudDrizzle,
  CloudFog, Wind, Thermometer, Droplets, Eye, MapPin, Clock,
  BedDouble, LogIn, LogOut, Users, Search, CalendarCheck, CalendarRange,
  ArrowLeftRight, Phone, MessageSquare,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useHotel } from '../context/HotelContext';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { checkContractExpirations } from '../lib/notificationTriggers';

// ---------------------------------------------------------------------------
// Mapeamento de ícone + gradiente por nome de setor (normalizado)
// ---------------------------------------------------------------------------
const SECTOR_VISUAL: Record<string, { icon: React.ComponentType<any>; gradient: string; color: string }> = {
  'cozinha':      { icon: ChefHat,        gradient: 'from-orange-500 to-orange-600', color: '#f97316' },
  'restaurante':  { icon: UtensilsCrossed, gradient: 'from-red-500 to-red-600', color: '#ef4444' },
  'exclusive':    { icon: UtensilsCrossed, gradient: 'from-rose-500 to-rose-600', color: '#f43f5e' },
  'governanca':   { icon: ShieldCheck,     gradient: 'from-amber-500 to-amber-600', color: '#f59e0b' },
  'bar piscina':  { icon: GlassWater,      gradient: 'from-blue-500 to-blue-600', color: '#3b82f6' },
  'bar':          { icon: GlassWater,      gradient: 'from-blue-400 to-blue-500', color: '#60a5fa' },
  'manutencao':   { icon: Wrench,          gradient: 'from-sky-500 to-sky-600', color: '#0ea5e9' },
  'lavanderia':   { icon: Shirt,           gradient: 'from-violet-500 to-violet-600', color: '#8b5cf6' },
  'recepcao':     { icon: Hotel,           gradient: 'from-teal-500 to-teal-600', color: '#14b8a6' },
  'reservas':     { icon: Hotel,           gradient: 'from-teal-400 to-teal-500', color: '#2dd4bf' },
  'cafe':         { icon: Coffee,          gradient: 'from-yellow-600 to-yellow-700', color: '#ca8a04' },
  'academia':     { icon: Dumbbell,        gradient: 'from-lime-500 to-lime-600', color: '#84cc16' },
  'jardim':       { icon: Leaf,            gradient: 'from-green-500 to-green-600', color: '#22c55e' },
  'eventos':      { icon: Star,            gradient: 'from-pink-500 to-pink-600', color: '#ec4899' },
  'logistica':    { icon: Truck,           gradient: 'from-gray-600 to-gray-700', color: '#4b5563' },
  'papelaria':    { icon: Printer,         gradient: 'from-indigo-500 to-indigo-600', color: '#6366f1' },
  'ti':           { icon: Monitor,         gradient: 'from-cyan-600 to-cyan-700', color: '#0891b2' },
  'almoxarifado': { icon: Archive,         gradient: 'from-stone-500 to-stone-600', color: '#78716c' },
  'producao':     { icon: Layers,          gradient: 'from-fuchsia-500 to-fuchsia-600', color: '#d946ef' },
  'financeiro':   { icon: DollarSign,      gradient: 'from-emerald-500 to-emerald-600', color: '#10b981' },
  'gerencia':     { icon: BarChart3,       gradient: 'from-green-500 to-green-600', color: '#22c55e' },
  'marketing':    { icon: Star,            gradient: 'from-purple-500 to-purple-600', color: '#a855f7' },
};

const FALLBACK_COLORS = ['#8b5cf6','#10b981','#3b82f6','#f43f5e','#f97316','#14b8a6'];

function normalize(str: string) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getSectorVisual(name: string, idx: number) {
  const key = normalize(name);
  const match = SECTOR_VISUAL[key]
    || Object.entries(SECTOR_VISUAL).find(([k]) => key.startsWith(k))?.[1];
  return match || {
    icon: Boxes,
    gradient: 'from-gray-500 to-gray-600',
    color: FALLBACK_COLORS[idx % FALLBACK_COLORS.length],
  };
}

// ---------------------------------------------------------------------------
// Sidebar items — módulos do sistema agrupados
// ---------------------------------------------------------------------------
interface SidebarItem {
  module: string;
  label: string;
  href: string;
  icon: React.ComponentType<any>;
  color: string;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
  adminOnly?: boolean;
  dynamicKey?: 'stockSectors' | 'allSectors';
}

const SIDEBAR_GROUPS_DEF: {
  label: string;
  adminOnly?: boolean;
  dynamicKey?: 'stockSectors' | 'allSectors';
  items?: SidebarItem[];
}[] = [
  {
    label: 'Compras',
    items: [
      { module: 'authorizations', label: 'Orçamentos',    href: '/budget-history',  icon: FileText,    color: '#6366f1' },
      { module: 'authorizations', label: 'Autorizações',  href: '/authorizations',  icon: CreditCard,  color: '#14b8a6' },
      { module: 'purchases',     label: 'Compras',        href: '/purchases',               icon: ShoppingCart, color: '#f59e0b' },
      { module: '__contacts__',  label: 'Contatos',      href: '/admin/supplier-contacts', icon: Phone,        color: '#10b981' },
      { module: 'stock',          label: 'Requisições',   href: '/admin',                   icon: Package,     color: '#3b82f6' },
    ],
  },
  {
    label: 'Stock',
    dynamicKey: 'stockSectors',
    items: [
      { module: 'inventory', label: 'Inventário',     href: '/inventory',            icon: Boxes,           color: '#8b5cf6' },
      { module: 'inventory', label: 'Transferências', href: '/inventory/transfers',  icon: ArrowLeftRight,  color: '#f97316' },
    ],
  },
  {
    label: 'Gerência',
    items: [
      { module: 'management', label: 'Gerência',    href: '/management', icon: BarChart3, color: '#22c55e' },
      { module: 'reports',    label: 'Relatórios',  href: '/reports',    icon: FileText,  color: '#0ea5e9' },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { module: 'finances', label: 'Financeiro', href: '/finances', icon: DollarSign, color: '#10b981' },
    ],
  },
  {
    label: 'DP',
    items: [
      { module: 'personnel_department', label: 'Depart. Pessoal', href: '/personnel-department', icon: UsersRound, color: '#f43f5e' },
    ],
  },
  {
    label: 'Recepção',
    items: [
      { module: 'reception', label: 'Rack de UH\'s',  href: '/reception/rack',     icon: BedDouble, color: '#14b8a6' },
      { module: 'reception', label: 'Check-in',       href: '/reception/checkin',   icon: LogIn,     color: '#22c55e' },
      { module: 'reception', label: 'Check-out',      href: '/reception/checkout',  icon: LogOut,    color: '#ef4444' },
      { module: 'reception', label: 'In House',       href: '/reception/inhouse',   icon: Users,     color: '#3b82f6' },
    ],
  },
  {
    label: 'Reservas',
    items: [
      { module: 'reservations', label: 'Reservas',          href: '/reservations/search',       icon: Search,        color: '#6366f1' },
      { module: 'reservations', label: 'Disponibilidade',   href: '/reservations/availability', icon: CalendarCheck, color: '#8b5cf6' },
      { module: 'reservations', label: 'Planning',          href: '/reservations/planning',     icon: CalendarRange, color: '#a855f7' },
    ],
  },
  {
    label: 'Manutenção',
    items: [
      { module: 'maintenance', label: 'Manutenções', href: '/maintenance', icon: HardHat, color: '#f97316' },
    ],
  },
  {
    label: 'Requisições',
    dynamicKey: 'allSectors',
  },
  {
    label: 'Configurações',
    adminOnly: true,
    items: [
      { module: 'users_management',   label: 'Usuários',         href: '/users',         icon: UsersRound,  color: '#6366f1' },
      { module: 'roles_management',   label: 'Gestão de Perfis', href: '/admin/roles',   icon: UserCog,     color: '#f59e0b' },
      { module: 'sectors_management', label: 'Gestão de Setores',href: '/admin/sectors', icon: LayoutGrid,  color: '#14b8a6' },
      { module: 'erbon_pms',          label: 'Erbon PMS',        href: '/admin/erbon',    icon: Link2,          color: '#0ea5e9' },
      { module: 'users_management',   label: 'WhatsApp',         href: '/admin/whatsapp', icon: MessageSquare,  color: '#22c55e' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------
function getGreeting(): { text: string; icon: React.ComponentType<any> } {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Bom dia', icon: Sun };
  if (h < 18) return { text: 'Boa tarde', icon: Cloud };
  return { text: 'Boa noite', icon: Moon };
}

// ---------------------------------------------------------------------------
// Weather (Open-Meteo — free, no API key)
// Armação dos Búzios: -22.75, -41.88
// ---------------------------------------------------------------------------
const BUZIOS_LAT = -22.75;
const BUZIOS_LON = -41.88;

interface WeatherData {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  weatherCode: number;
  uvIndex: number;
  visibility: number;
  daily: { tempMax: number; tempMin: number; weatherCode: number; date: string }[];
}

function getWeatherInfo(code: number): { label: string; icon: React.ComponentType<any>; color: string } {
  if (code === 0)                       return { label: 'Céu limpo',      icon: Sun,              color: '#f59e0b' };
  if (code <= 3)                        return { label: 'Parcial nublado', icon: Cloud,            color: '#64748b' };
  if (code <= 48)                       return { label: 'Nevoeiro',        icon: CloudFog,         color: '#94a3b8' };
  if (code <= 55)                       return { label: 'Chuvisco',        icon: CloudDrizzle,     color: '#0ea5e9' };
  if (code <= 57)                       return { label: 'Chuvisco gelo',   icon: CloudDrizzle,     color: '#06b6d4' };
  if (code <= 65)                       return { label: 'Chuva',           icon: CloudRain,        color: '#3b82f6' };
  if (code <= 67)                       return { label: 'Chuva gelada',    icon: CloudRain,        color: '#0284c7' };
  if (code <= 77)                       return { label: 'Neve',            icon: CloudSnow,        color: '#e2e8f0' };
  if (code <= 82)                       return { label: 'Pancadas',        icon: CloudRain,        color: '#2563eb' };
  if (code <= 86)                       return { label: 'Neve forte',      icon: CloudSnow,        color: '#cbd5e1' };
  if (code <= 99)                       return { label: 'Trovoada',        icon: CloudLightning,   color: '#7c3aed' };
  return { label: 'Indefinido', icon: Cloud, color: '#94a3b8' };
}

function windDirectionLabel(deg: number): string {
  const dirs = ['N','NE','L','SE','S','SO','O','NO'];
  return dirs[Math.round(deg / 45) % 8];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const Home = () => {
  const { user }          = useAuth();
  const { can, isAdmin, roleName, roleColor, canAccessContacts } = usePermissions();
  const { selectedHotel } = useHotel();
  const navigate          = useNavigate();

  const [allSectors, setAllSectors]         = useState<any[]>([]);
  const [loadingSectors, setLoadingSectors] = useState(false);
  const [sidebarOpen, setSidebarOpen]       = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [weather, setWeather]               = useState<WeatherData | null>(null);
  const [currentTime, setCurrentTime]       = useState(new Date());
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Redireciona se não há hotel selecionado
  useEffect(() => {
    if (!selectedHotel) navigate('/select-hotel', { replace: true });
  }, [selectedHotel, navigate]);

  // Busca setores do hotel
  useEffect(() => {
    if (!selectedHotel?.id) return;
    setLoadingSectors(true);
    supabase
      .from('sectors')
      .select('id, name, has_stock, color, display_order, role, can_manage_requests')
      .eq('hotel_id', selectedHotel.id)
      .order('display_order')
      .order('name')
      .then(({ data }) => {
        setAllSectors(data || []);
        setLoadingSectors(false);
      });
  }, [selectedHotel]);

  // Relógio — atualiza a cada minuto
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Buscar clima (Open-Meteo, cache 30min)
  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${BUZIOS_LAT}&longitude=${BUZIOS_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,visibility&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=America/Sao_Paulo&forecast_days=4`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        const c = data.current;
        const d = data.daily;
        setWeather({
          temperature: c.temperature_2m,
          feelsLike: c.apparent_temperature,
          humidity: c.relative_humidity_2m,
          windSpeed: c.wind_speed_10m,
          windDirection: c.wind_direction_10m,
          windGusts: c.wind_gusts_10m,
          weatherCode: c.weather_code,
          uvIndex: c.uv_index,
          visibility: c.visibility,
          daily: (d.time as string[]).slice(1).map((date: string, i: number) => ({
            date,
            tempMax: d.temperature_2m_max[i + 1],
            tempMin: d.temperature_2m_min[i + 1],
            weatherCode: d.weather_code[i + 1],
          })),
        });
      } catch { /* silently fail */ }
    };
    fetchWeather();
    const interval = setInterval(fetchWeather, 30 * 60_000); // 30min
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Verificação de contratos de experiência (1x por sessão)
  useEffect(() => { checkContractExpirations(); }, []);

  // Fecha sidebar mobile ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sidebarOpen && sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setSidebarOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sidebarOpen]);

  const stockSectors = useMemo(
    () => allSectors.filter(s => s.has_stock === true),
    [allSectors]
  );

  // Montar sidebar groups com items dinâmicos e permissões
  const sidebarGroups = useMemo(() => {
    if (!user) return [];

    const groups: SidebarGroup[] = [];

    for (const def of SIDEBAR_GROUPS_DEF) {
      // Admin-only groups
      if (def.adminOnly && !isAdmin) continue;

      const group: SidebarGroup = {
        label: def.label,
        items: [],
        adminOnly: def.adminOnly,
        dynamicKey: def.dynamicKey,
      };

      // Static items (filtered by permission)
      if (def.items) {
        for (const item of def.items) {
          // Contatos: acesso via purchases OU canAccessContacts
          if (item.module === '__contacts__') {
            if (isAdmin || can('purchases') || canAccessContacts) group.items.push(item);
          } else if (def.adminOnly || can(item.module)) {
            group.items.push(item);
          }
        }
      }

      // Dynamic: stock sectors
      if (def.dynamicKey === 'stockSectors') {
        stockSectors.forEach((sector, idx) => {
          if (can(`sector_stock:${sector.id}`)) {
            const visual = getSectorVisual(sector.name, idx);
            group.items.push({
              module: `sector_stock:${sector.id}`,
              label: sector.name,
              href: `/sector-stock/${sector.id}`,
              icon: visual.icon,
              color: visual.color,
            });
          }
        });
      }

      // Dynamic: all sectors (requisições)
      if (def.dynamicKey === 'allSectors') {
        allSectors.forEach((sector, idx) => {
          const visual = getSectorVisual(sector.name, idx);
          group.items.push({
            module: '',
            label: sector.name,
            href: `/sector/${sector.id}`,
            icon: visual.icon,
            color: sector.color || visual.color,
          });
        });
      }

      // Só mostra grupo se tem pelo menos 1 item
      if (group.items.length > 0) {
        groups.push(group);
      }
    }

    return groups;
  }, [user, isAdmin, can, canAccessContacts, stockSectors, allSectors]);

  const toggleGroup = (label: string) => {
    setExpandedGroups(prev => ({ ...prev, [label]: !prev[label] }));
  };

  // Default: todos recolhidos — o utilizador abre manualmente
  const isGroupExpanded = (label: string) => expandedGroups[label] === true;

  const greeting = getGreeting();
  const GreetingIcon = greeting.icon;

  if (!selectedHotel) return null;

  // ── Sidebar content (reutilizado em desktop e mobile) ─────────────────
  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* User info */}
      <div className="p-5 border-b border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
        <span
          className="inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold text-white"
          style={{ backgroundColor: roleColor }}
        >
          {roleName}
        </span>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
        {sidebarGroups.map(group => (
          <div key={group.label}>
            {/* Group header */}
            <button
              onClick={() => toggleGroup(group.label)}
              className="w-full flex items-center justify-between px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <span>{group.label}</span>
              {isGroupExpanded(group.label)
                ? <ChevronUp className="w-3.5 h-3.5" />
                : <ChevronDown className="w-3.5 h-3.5" />
              }
            </button>

            {/* Group items */}
            {isGroupExpanded(group.label) && (
              <div className="space-y-0.5 mb-2">
                {group.items.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={`${item.href}-${idx}`}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className="group flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-all duration-200 hover:translate-x-1 border-l-2 border-transparent hover:border-current"
                      style={{ '--tw-border-opacity': 1, borderColor: 'transparent' } as any}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = item.color)}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                    >
                      <div
                        className="p-1.5 rounded-md transition-colors duration-200"
                        style={{ backgroundColor: `${item.color}15` }}
                      >
                        <Icon className="w-4 h-4" style={{ color: item.color }} />
                      </div>
                      <span className="truncate font-medium">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Hotel info footer */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 mt-auto">
        <div className="flex items-center gap-2">
          <Hotel className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate font-medium">
            {selectedHotel.name}
          </span>
        </div>
      </div>
    </div>
  );

  // ── Quick-access cards para main area ────────────────────────────────
  const quickAccessItems = useMemo(() => {
    const all: { label: string; sub: string; href: string; icon: React.ComponentType<any>; color: string; gradient: string }[] = [];

    const candidates = [
      { module: 'stock',                label: 'Requisições',     sub: 'Pedidos dos setores',         href: '/admin',               icon: Package,      color: '#3b82f6', gradient: 'from-blue-500 to-blue-600' },
      { module: 'purchases',            label: 'Compras',          sub: 'Pedidos de compra',            href: '/purchases',           icon: ShoppingCart, color: '#f59e0b', gradient: 'from-amber-500 to-amber-600' },
      { module: 'inventory',            label: 'Inventário',       sub: 'Contagem e controle',          href: '/inventory',           icon: Boxes,        color: '#8b5cf6', gradient: 'from-purple-500 to-purple-600' },
      { module: 'reports',              label: 'Relatórios',       sub: 'Dashboards e análises',       href: '/reports',             icon: FileText,     color: '#0ea5e9', gradient: 'from-cyan-500 to-cyan-600' },
      { module: 'authorizations',       label: 'Autorizações',    sub: 'Aprovações pendentes',         href: '/authorizations',      icon: CreditCard,   color: '#14b8a6', gradient: 'from-teal-500 to-teal-600' },
      { module: 'management',           label: 'Gerência',        sub: 'Análises de gestão',          href: '/management',          icon: BarChart3,    color: '#22c55e', gradient: 'from-green-500 to-green-600' },
      { module: 'finances',             label: 'Financeiro',       sub: 'Controle financeiro',          href: '/finances',            icon: DollarSign,   color: '#10b981', gradient: 'from-emerald-500 to-emerald-600' },
      { module: 'personnel_department', label: 'Depart. Pessoal', sub: 'Escalas e contratos',          href: '/personnel-department',icon: UsersRound,   color: '#f43f5e', gradient: 'from-rose-500 to-rose-600' },
      { module: 'maintenance',          label: 'Manutenções',     sub: 'Tickets e equipamentos',       href: '/maintenance',         icon: HardHat,      color: '#f97316', gradient: 'from-orange-500 to-orange-600' },
    ];

    for (const c of candidates) {
      if (can(c.module)) all.push(c);
    }

    return all;
  }, [user, can]);

  // ── Logged-in dashboard ─────────────────────────────────────────────
  if (user) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)]">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-40 lg:hidden animate-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar — desktop: static, mobile: slide-in */}
        <aside
          ref={sidebarRef}
          className={`
            fixed top-16 left-0 h-[calc(100vh-4rem)] w-72 z-50 lg:z-0
            bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700
            transition-transform duration-300 ease-in-out
            lg:sticky lg:top-16 lg:translate-x-0 lg:w-64 lg:shrink-0
            ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
          `}
        >
          {/* Close button mobile */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 lg:hidden"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>

          {renderSidebarContent()}
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

            {/* Welcome header */}
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-blue-500/10 dark:from-indigo-500/20 dark:to-blue-500/20">
                    <GreetingIcon className="w-7 h-7 text-indigo-500 animate-float" />
                  </div>
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                      {greeting.text}{user.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
                    </h1>
                    <div className="flex items-center gap-3 mt-0.5">
                      <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
                        {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
                      </p>
                      <span className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                        <Clock className="w-3.5 h-3.5" />
                        {format(currentTime, 'HH:mm')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mobile menu FAB */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all"
                >
                  <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                </button>
              </div>

              {/* Weather widget */}
              {weather && (() => {
                const w = getWeatherInfo(weather.weatherCode);
                const WeatherIcon = w.icon;
                return (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      {/* Atual */}
                      <div className="flex items-center gap-4 flex-1">
                        <div className="p-3 rounded-xl" style={{ backgroundColor: `${w.color}15` }}>
                          <WeatherIcon className="w-8 h-8" style={{ color: w.color }} />
                        </div>
                        <div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-gray-900 dark:text-white">
                              {Math.round(weather.temperature)}°
                            </span>
                            <span className="text-sm text-gray-500 dark:text-gray-400">{w.label}</span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            <MapPin className="w-3 h-3" />
                            <span>Armação dos Búzios</span>
                          </div>
                        </div>
                      </div>

                      {/* Detalhes */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                          <Thermometer className="w-3.5 h-3.5 text-orange-400" />
                          <span>Sensação {Math.round(weather.feelsLike)}°</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                          <Wind className="w-3.5 h-3.5 text-blue-400" />
                          <span>{Math.round(weather.windSpeed)} km/h {windDirectionLabel(weather.windDirection)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                          <Droplets className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Umidade {weather.humidity}%</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                          <Wind className="w-3.5 h-3.5 text-purple-400" />
                          <span>Rajadas {Math.round(weather.windGusts)} km/h</span>
                        </div>
                      </div>
                    </div>

                    {/* Previsão 3 dias */}
                    {weather.daily.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex gap-3 overflow-x-auto">
                        {weather.daily.map(day => {
                          const dayInfo = getWeatherInfo(day.weatherCode);
                          const DayIcon = dayInfo.icon;
                          const d = new Date(day.date + 'T12:00:00');
                          return (
                            <div key={day.date} className="flex-1 min-w-[80px] text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                              <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 capitalize">
                                {format(d, 'EEE', { locale: ptBR })}
                              </p>
                              <DayIcon className="w-5 h-5 mx-auto my-1" style={{ color: dayInfo.color }} />
                              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                {Math.round(day.tempMax)}° <span className="text-gray-400 font-normal">{Math.round(day.tempMin)}°</span>
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Quick access cards */}
            {quickAccessItems.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                  Acesso Rápido
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {quickAccessItems.map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        className="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 overflow-hidden"
                        style={{ animationDelay: `${idx * 50}ms` }}
                      >
                        {/* Shimmer on hover */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-0 group-hover:opacity-100 group-hover:animate-shimmer bg-[length:200%_100%] pointer-events-none" />

                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110"
                          style={{ backgroundColor: `${item.color}15` }}
                        >
                          <Icon className="w-5 h-5" style={{ color: item.color }} />
                        </div>
                        <h3 className="font-semibold text-sm text-gray-800 dark:text-white">{item.label}</h3>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.sub}</p>

                        {/* Bottom accent line */}
                        <div
                          className="absolute bottom-0 left-0 right-0 h-0.5 transition-all duration-300 opacity-0 group-hover:opacity-100"
                          style={{ backgroundColor: item.color }}
                        />
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Estoques Setoriais */}
            {stockSectors.filter(s => can(`sector_stock:${s.id}`)).length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                  Estoques Setoriais
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {stockSectors.filter(s => can(`sector_stock:${s.id}`)).map((sector, idx) => {
                    const { icon: Icon, color } = getSectorVisual(sector.name, idx);
                    return (
                      <Link
                        key={sector.id}
                        to={`/sector-stock/${sector.id}`}
                        className="group flex items-center gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
                        style={{ borderLeftColor: color, borderLeftWidth: '3px' }}
                      >
                        <div
                          className="p-2 rounded-lg transition-transform duration-200 group-hover:scale-110"
                          style={{ backgroundColor: `${color}15` }}
                        >
                          <Icon className="w-5 h-5" style={{ color }} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm text-gray-800 dark:text-white truncate">
                            Estoque {sector.name}
                          </h3>
                          <p className="text-xs text-gray-400 dark:text-gray-500">Gerenciar estoque</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Setores — requisições */}
            {allSectors.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                  Setores
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {allSectors.map((sector, idx) => {
                    const { icon: Icon, color } = getSectorVisual(sector.name, idx);
                    return (
                      <Link
                        key={sector.id}
                        to={`/sector/${sector.id}`}
                        className="group flex items-center gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3.5 hover:shadow-md transition-all duration-200"
                      >
                        <div
                          className="p-1.5 rounded-md"
                          style={{ backgroundColor: `${sector.color || color}15` }}
                        >
                          <Icon className="w-4 h-4" style={{ color: sector.color || color }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                            {sector.name}
                          </h3>
                        </div>
                        {sector.has_stock && (
                          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                            Stock
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Guest: maintenance ticket */}
            {user.role === 'guest' && (
              <Link
                to="/maintenance/ticket/new"
                className="flex items-center gap-4 bg-gradient-to-br from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 p-5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="bg-white/20 p-3 rounded-xl shrink-0">
                  <Wrench className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-white">Abrir Chamado de Manutenção</h2>
                  <p className="text-sm text-orange-100 mt-0.5">Reporte um problema ou defeito</p>
                </div>
              </Link>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Visitante não logado ──────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Chamado de manutenção público */}
      <Link
        to="/maintenance/ticket/new"
        className="flex items-center gap-4 bg-gradient-to-br from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 p-5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 hover:-translate-y-0.5"
      >
        <div className="bg-white/20 p-3 rounded-xl shrink-0">
          <Wrench className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-white">Abrir Chamado de Manutenção</h2>
          <p className="text-sm text-orange-100 mt-0.5">Reporte um problema ou defeito</p>
        </div>
      </Link>

      {/* Setores públicos */}
      {allSectors.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
            Setores
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allSectors.map((sector, idx) => {
              const { icon: Icon, color } = getSectorVisual(sector.name, idx);
              return (
                <Link
                  key={sector.id}
                  to={`/sector/${sector.id}`}
                  className="group flex items-center gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3.5 hover:shadow-md transition-all duration-200"
                >
                  <div
                    className="p-1.5 rounded-md"
                    style={{ backgroundColor: `${sector.color || color}15` }}
                  >
                    <Icon className="w-4 h-4" style={{ color: sector.color || color }} />
                  </div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                    {sector.name}
                  </h3>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Login */}
      <Link
        to="/login"
        className="block bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 hover:-translate-y-0.5"
      >
        <div className="px-6 py-6 flex items-center gap-4">
          <div className="bg-white/10 p-3 rounded-lg shrink-0">
            <Lock className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Área Administrativa</h2>
            <p className="text-sm text-blue-100 mt-0.5">Acesso restrito — clique para fazer login</p>
          </div>
        </div>
      </Link>
    </div>
  );
};

export default Home;
