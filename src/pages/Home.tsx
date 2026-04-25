// src/pages/Home.tsx
// Redesigned with frontend-design + ui-ux-pro-max skills
// Aesthetic: Luxury Hospitality Command Center

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { NAV_GROUPS } from '../lib/navigationConfig';
import type { NavItem } from '../lib/navigationConfig';
import {
  Package, BarChart3, Building2, ShieldCheck, ChevronDown, ChevronUp,
  Lock, Boxes, ShoppingCart, DollarSign, FileText, CreditCard, Wrench,
  HardHat, UsersRound, ChefHat, UtensilsCrossed, GlassWater, Hotel,
  Layers, Shirt, Coffee, Dumbbell, Leaf, Star, Truck, Printer,
  Monitor, Archive, Menu, X, UserCog, LayoutGrid, Link2,
  Sun, Cloud, Moon, CloudRain, CloudSnow, CloudLightning, CloudDrizzle,
  CloudFog, Wind, Thermometer, Droplets, Eye, MapPin, Clock,
  BedDouble, LogIn, LogOut, Users, Search, CalendarCheck, CalendarRange,
  ArrowLeftRight, Phone, MessageSquare, ChevronRight, Sparkles, Zap, TrendingUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useHotel } from '../context/HotelContext';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { checkContractExpirations } from '../lib/notificationTriggers';

// ---------------------------------------------------------------------------
// Sector visual map
// ---------------------------------------------------------------------------
const SECTOR_VISUAL: Record<string, { icon: React.ComponentType<any>; gradient: string; color: string }> = {
  'cozinha':      { icon: ChefHat,        gradient: 'from-orange-500 to-orange-600', color: '#f97316' },
  'restaurante':  { icon: UtensilsCrossed, gradient: 'from-red-500 to-red-600',      color: '#ef4444' },
  'exclusive':    { icon: UtensilsCrossed, gradient: 'from-rose-500 to-rose-600',    color: '#f43f5e' },
  'governanca':   { icon: ShieldCheck,     gradient: 'from-amber-500 to-amber-600',  color: '#f59e0b' },
  'bar piscina':  { icon: GlassWater,      gradient: 'from-blue-500 to-blue-600',    color: '#3b82f6' },
  'bar':          { icon: GlassWater,      gradient: 'from-blue-400 to-blue-500',    color: '#60a5fa' },
  'manutencao':   { icon: Wrench,          gradient: 'from-sky-500 to-sky-600',      color: '#0ea5e9' },
  'lavanderia':   { icon: Shirt,           gradient: 'from-violet-500 to-violet-600',color: '#8b5cf6' },
  'recepcao':     { icon: Hotel,           gradient: 'from-teal-500 to-teal-600',    color: '#14b8a6' },
  'reservas':     { icon: Hotel,           gradient: 'from-teal-400 to-teal-500',    color: '#2dd4bf' },
  'cafe':         { icon: Coffee,          gradient: 'from-yellow-600 to-yellow-700',color: '#ca8a04' },
  'academia':     { icon: Dumbbell,        gradient: 'from-lime-500 to-lime-600',    color: '#84cc16' },
  'jardim':       { icon: Leaf,            gradient: 'from-green-500 to-green-600',  color: '#22c55e' },
  'eventos':      { icon: Star,            gradient: 'from-pink-500 to-pink-600',    color: '#ec4899' },
  'logistica':    { icon: Truck,           gradient: 'from-gray-600 to-gray-700',    color: '#4b5563' },
  'papelaria':    { icon: Printer,         gradient: 'from-indigo-500 to-indigo-600',color: '#6366f1' },
  'ti':           { icon: Monitor,         gradient: 'from-cyan-600 to-cyan-700',    color: '#0891b2' },
  'almoxarifado': { icon: Archive,         gradient: 'from-stone-500 to-stone-600',  color: '#78716c' },
  'producao':     { icon: Layers,          gradient: 'from-fuchsia-500 to-fuchsia-600',color:'#d946ef' },
  'financeiro':   { icon: DollarSign,      gradient: 'from-emerald-500 to-emerald-600',color:'#10b981' },
  'gerencia':     { icon: BarChart3,       gradient: 'from-green-500 to-green-600',  color: '#22c55e' },
  'marketing':    { icon: Star,            gradient: 'from-purple-500 to-purple-600',color: '#a855f7' },
};
const FALLBACK_COLORS = ['#8b5cf6','#10b981','#3b82f6','#f43f5e','#f97316','#14b8a6'];
function normalize(str: string) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function getSectorVisual(name: string, idx: number) {
  const key = normalize(name);
  const match = SECTOR_VISUAL[key]
    || Object.entries(SECTOR_VISUAL).find(([k]) => key.startsWith(k))?.[1];
  return match || { icon: Boxes, gradient: 'from-gray-500 to-gray-600', color: FALLBACK_COLORS[idx % FALLBACK_COLORS.length] };
}

// ---------------------------------------------------------------------------
// Sidebar types
// ---------------------------------------------------------------------------
interface SidebarGroup {
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
  dynamicKey?: 'stockSectors' | 'allSectors';
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------
function getGreeting(): { text: string; sub: string; icon: React.ComponentType<any>; gradient: string } {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Bom dia',   sub: 'Que o dia seja produtivo!',      icon: Sun,   gradient: 'from-amber-400 via-orange-400 to-rose-400' };
  if (h < 18) return { text: 'Boa tarde', sub: 'Tudo sob controle por aqui?',    icon: Sparkles, gradient: 'from-blue-400 via-indigo-400 to-violet-400' };
  return          { text: 'Boa noite',  sub: 'Encerrando mais um dia de sucesso.', icon: Moon,  gradient: 'from-indigo-500 via-violet-500 to-purple-500' };
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------
const BUZIOS_LAT = -22.75;
const BUZIOS_LON = -41.88;
interface WeatherData {
  temperature: number; feelsLike: number; humidity: number;
  windSpeed: number; windDirection: number; windGusts: number;
  weatherCode: number; uvIndex: number; visibility: number;
  daily: { tempMax: number; tempMin: number; weatherCode: number; date: string }[];
}
function getWeatherInfo(code: number): { label: string; icon: React.ComponentType<any>; color: string } {
  if (code === 0)   return { label: 'Céu limpo',        icon: Sun,            color: '#f59e0b' };
  if (code <= 3)    return { label: 'Parcial nublado',  icon: Cloud,          color: '#64748b' };
  if (code <= 48)   return { label: 'Nevoeiro',         icon: CloudFog,       color: '#94a3b8' };
  if (code <= 55)   return { label: 'Chuvisco',         icon: CloudDrizzle,   color: '#0ea5e9' };
  if (code <= 57)   return { label: 'Chuvisco gelo',    icon: CloudDrizzle,   color: '#06b6d4' };
  if (code <= 65)   return { label: 'Chuva',            icon: CloudRain,      color: '#3b82f6' };
  if (code <= 67)   return { label: 'Chuva gelada',     icon: CloudRain,      color: '#0284c7' };
  if (code <= 77)   return { label: 'Neve',             icon: CloudSnow,      color: '#e2e8f0' };
  if (code <= 82)   return { label: 'Pancadas',         icon: CloudRain,      color: '#2563eb' };
  if (code <= 86)   return { label: 'Neve forte',       icon: CloudSnow,      color: '#cbd5e1' };
  if (code <= 99)   return { label: 'Trovoada',         icon: CloudLightning, color: '#7c3aed' };
  return { label: 'Indefinido', icon: Cloud, color: '#94a3b8' };
}
function windDirectionLabel(deg: number) {
  return ['N','NE','L','SE','S','SO','O','NO'][Math.round(deg / 45) % 8];
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-3 mb-4">
    <div className="w-1 h-5 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />
    <h2 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.15em]">
      {children}
    </h2>
  </div>
);

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

  useEffect(() => {
    if (!selectedHotel) navigate('/select-hotel', { replace: true });
  }, [selectedHotel, navigate]);

  useEffect(() => {
    if (!selectedHotel?.id) return;
    setLoadingSectors(true);
    supabase
      .from('sectors')
      .select('id, name, has_stock, color, display_order, role, can_manage_requests')
      .eq('hotel_id', selectedHotel.id)
      .order('display_order').order('name')
      .then(({ data }) => { setAllSectors(data || []); setLoadingSectors(false); });
  }, [selectedHotel]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${BUZIOS_LAT}&longitude=${BUZIOS_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,visibility&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=America/Sao_Paulo&forecast_days=4`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const c = data.current; const d = data.daily;
        setWeather({
          temperature: c.temperature_2m, feelsLike: c.apparent_temperature,
          humidity: c.relative_humidity_2m, windSpeed: c.wind_speed_10m,
          windDirection: c.wind_direction_10m, windGusts: c.wind_gusts_10m,
          weatherCode: c.weather_code, uvIndex: c.uv_index, visibility: c.visibility,
          daily: (d.time as string[]).slice(1).map((date: string, i: number) => ({
            date, tempMax: d.temperature_2m_max[i + 1],
            tempMin: d.temperature_2m_min[i + 1], weatherCode: d.weather_code[i + 1],
          })),
        });
      } catch { /* silent */ }
    };
    fetchWeather();
    const interval = setInterval(fetchWeather, 30 * 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => { checkContractExpirations(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sidebarOpen && sidebarRef.current && !sidebarRef.current.contains(e.target as Node))
        setSidebarOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sidebarOpen]);

  const stockSectors = useMemo(() => allSectors.filter(s => s.has_stock === true), [allSectors]);

  const sidebarGroups = useMemo(() => {
    if (!user) return [];
    const groups: SidebarGroup[] = [];
    for (const def of NAV_GROUPS) {
      if (def.adminOnly && !isAdmin) continue;
      const group: SidebarGroup = { label: def.label, items: [], adminOnly: def.adminOnly, dynamicKey: def.dynamicKey };
      for (const item of def.items) {
        if (item.module === '__contacts__') {
          if (isAdmin || can('purchases') || canAccessContacts) group.items.push(item);
        } else if (def.adminOnly || can(item.module)) {
          group.items.push(item);
        }
      }
      if (def.dynamicKey === 'stockSectors') {
        stockSectors.forEach((sector, idx) => {
          if (can(`sector_stock:${sector.id}`)) {
            const visual = getSectorVisual(sector.name, idx);
            group.items.push({ module: `sector_stock:${sector.id}`, label: sector.name, href: `/sector-stock/${sector.id}`, icon: visual.icon, color: visual.color });
          }
        });
      }
      if (def.dynamicKey === 'allSectors') {
        allSectors.forEach((sector, idx) => {
          const visual = getSectorVisual(sector.name, idx);
          group.items.push({ module: '', label: sector.name, href: `/sector/${sector.id}`, icon: visual.icon, color: sector.color || visual.color });
        });
      }
      if (group.items.length > 0) groups.push(group);
    }
    return groups;
  }, [user, isAdmin, can, canAccessContacts, stockSectors, allSectors]);

  const toggleGroup = (label: string) =>
    setExpandedGroups(prev => ({ ...prev, [label]: !prev[label] }));
  const isGroupExpanded = (label: string) => expandedGroups[label] === true;

  const greeting = getGreeting();
  const GreetingIcon = greeting.icon;

  if (!selectedHotel) return null;

  // ── Sidebar ──────────────────────────────────────────────────────────────
  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {/* User info */}
      <div className="px-4 py-5 border-b border-gray-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white font-black text-sm shadow-lg"
            style={{ background: `linear-gradient(135deg, ${roleColor}cc, ${roleColor})` }}
          >
            {(user?.full_name || user?.email || 'U')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
              {user?.full_name || user?.email?.split('@')[0] || 'Usuário'}
            </p>
            <span
              className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ backgroundColor: `${roleColor}20`, color: roleColor, border: `1px solid ${roleColor}40` }}
            >
              {roleName}
            </span>
          </div>
        </div>
      </div>

      {/* Hotel chip */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-800">
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
          <Hotel className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
          <span className="text-xs font-semibold text-gray-600 dark:text-slate-300 truncate">{selectedHotel.name}</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {sidebarGroups.map(group => (
          <div key={group.label}>
            {/* Group toggle */}
            <button
              onClick={() => toggleGroup(group.label)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg
                text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-150
                text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300
                hover:bg-gray-100 dark:hover:bg-slate-800/60"
            >
              <span>{group.label}</span>
              {isGroupExpanded(group.label)
                ? <ChevronUp className="w-3 h-3" />
                : <ChevronDown className="w-3 h-3" />
              }
            </button>

            {/* Items */}
            {isGroupExpanded(group.label) && (
              <div className="space-y-0.5 mb-1 pl-1">
                {group.items.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={`${item.href}-${idx}`}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl
                        text-sm text-gray-600 dark:text-slate-400
                        hover:text-gray-900 dark:hover:text-white
                        hover:bg-gray-100 dark:hover:bg-slate-800
                        transition-all duration-150 active:scale-[0.98]"
                    >
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-110"
                        style={{ backgroundColor: `${item.color}18` }}
                      >
                        <Icon className="w-3.5 h-3.5" style={{ color: item.color }} />
                      </div>
                      <span className="truncate font-medium text-xs">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  );

  // ── Quick access cards ────────────────────────────────────────────────────
  const quickAccessItems = useMemo(() => {
    const candidates = [
      { module: 'stock',                label: 'Requisições',     sub: 'Pedidos dos setores',          href: '/admin',                icon: Package,      color: '#3b82f6', gradient: 'from-blue-500 to-blue-600' },
      { module: 'purchases',            label: 'Compras',          sub: 'Pedidos de compra',             href: '/purchases',            icon: ShoppingCart, color: '#f59e0b', gradient: 'from-amber-500 to-amber-600' },
      { module: 'inventory',            label: 'Inventário',       sub: 'Contagem e controle',           href: '/inventory',            icon: Boxes,        color: '#8b5cf6', gradient: 'from-violet-500 to-violet-600' },
      { module: 'reports',              label: 'Relatórios',       sub: 'Dashboards e análises',        href: '/reports',              icon: FileText,     color: '#0ea5e9', gradient: 'from-cyan-500 to-cyan-600' },
      { module: 'authorizations',       label: 'Autorizações',    sub: 'Aprovações pendentes',          href: '/authorizations',       icon: CreditCard,   color: '#14b8a6', gradient: 'from-teal-500 to-teal-600' },
      { module: 'management',           label: 'Gerência',        sub: 'Análises de gestão',           href: '/management',           icon: BarChart3,    color: '#22c55e', gradient: 'from-emerald-500 to-emerald-600' },
      { module: 'finances',             label: 'Financeiro',       sub: 'Controle financeiro',           href: '/finances',             icon: DollarSign,   color: '#10b981', gradient: 'from-green-500 to-green-600' },
      { module: 'personnel_department', label: 'Depart. Pessoal', sub: 'Escalas e contratos',           href: '/personnel-department', icon: UsersRound,   color: '#f43f5e', gradient: 'from-rose-500 to-rose-600' },
      { module: 'maintenance',          label: 'Manutenções',     sub: 'Tickets e equipamentos',        href: '/maintenance',          icon: HardHat,      color: '#f97316', gradient: 'from-orange-500 to-orange-600' },
      { module: 'diretoria',            label: 'Diretoria',        sub: 'Pick-up e relatórios',          href: '/diretoria/pickup',     icon: TrendingUp,   color: '#0085ae', gradient: 'from-cyan-600 to-blue-700' },
    ];
    return candidates.filter(c => can(c.module));
  }, [user, can]);

  // ── Logged-in dashboard ───────────────────────────────────────────────────
  if (user) {
    const w = weather ? getWeatherInfo(weather.weatherCode) : null;
    const WeatherIcon = w?.icon;

    return (
      <div className="flex min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-950">

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          ref={sidebarRef}
          className={`
            fixed top-16 left-0 h-[calc(100vh-4rem)] w-72 z-50 lg:z-0
            bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800
            transition-transform duration-300 ease-out
            lg:sticky lg:top-16 lg:translate-x-0 lg:w-64 lg:shrink-0
            ${sidebarOpen ? 'translate-x-0 shadow-2xl shadow-black/20 dark:shadow-black/40' : '-translate-x-full'}
          `}
        >
          {/* Close btn mobile */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center
              rounded-lg text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-white
              hover:bg-gray-100 dark:hover:bg-slate-800 transition-all lg:hidden"
          >
            <X className="w-4 h-4" />
          </button>
          {renderSidebarContent()}
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">

            {/* ── Hero header ────────────────────────────────────────── */}
            <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${greeting.gradient} p-6 sm:p-8 shadow-xl`}>
              {/* Background texture */}
              <div className="absolute inset-0 bg-black/10" />
              <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/5 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-white/5 blur-2xl pointer-events-none" />

              <div className="relative z-10 flex flex-col sm:flex-row sm:items-start gap-5">
                {/* Greeting */}
                <div className="flex-1">
                  {/* Mobile menu trigger */}
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="lg:hidden mb-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-xs font-medium backdrop-blur-sm transition-all active:scale-95"
                  >
                    <Menu className="w-3.5 h-3.5" />
                    Menu
                  </button>

                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                      <GreetingIcon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-black text-white leading-none">
                        {greeting.text}{user.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
                      </h1>
                      <p className="text-white/70 text-sm mt-0.5">{greeting.sub}</p>
                    </div>
                  </div>

                  {/* Date + time */}
                  <div className="flex items-center gap-3 mt-4">
                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-white text-xs font-semibold backdrop-blur-sm capitalize">
                      {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
                    </span>
                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-white text-xs font-bold backdrop-blur-sm font-mono tabular-nums">
                      <Clock className="w-3 h-3" />
                      {format(currentTime, 'HH:mm')}
                    </span>
                  </div>
                </div>

                {/* Weather glass card */}
                {weather && w && WeatherIcon && (
                  <div className="shrink-0 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md p-4 min-w-[180px]">
                    <div className="flex items-center gap-3 mb-3">
                      <WeatherIcon className="w-8 h-8 text-white drop-shadow-lg" />
                      <div>
                        <p className="text-3xl font-black text-white leading-none tabular-nums">
                          {Math.round(weather.temperature)}°
                        </p>
                        <p className="text-white/70 text-xs mt-0.5">{w.label}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-white/60 mb-3">
                      <MapPin className="w-3 h-3" />
                      Armação dos Búzios
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-white/70">
                        <Droplets className="w-3 h-3 text-cyan-300" />
                        {weather.humidity}% · Sensação {Math.round(weather.feelsLike)}°
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-white/70">
                        <Wind className="w-3 h-3 text-blue-200" />
                        {Math.round(weather.windSpeed)} km/h {windDirectionLabel(weather.windDirection)}
                      </div>
                    </div>

                    {/* 3-day forecast */}
                    {weather.daily.length > 0 && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-white/15">
                        {weather.daily.slice(0, 3).map(day => {
                          const di = getWeatherInfo(day.weatherCode);
                          const DI = di.icon;
                          const d = new Date(day.date + 'T12:00:00');
                          return (
                            <div key={day.date} className="flex-1 text-center">
                              <p className="text-[10px] text-white/50 capitalize">
                                {format(d, 'EEE', { locale: ptBR })}
                              </p>
                              <DI className="w-4 h-4 mx-auto my-0.5 text-white/80" />
                              <p className="text-[10px] font-bold text-white">
                                {Math.round(day.tempMax)}°
                                <span className="text-white/50 font-normal"> {Math.round(day.tempMin)}°</span>
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Quick access — Bento grid ───────────────────────────── */}
            {quickAccessItems.length > 0 && (
              <section>
                <SectionLabel>Acesso Rápido</SectionLabel>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {quickAccessItems.map((item, idx) => {
                    const Icon = item.icon;
                    // First 2 items get wider cards (featured)
                    const isFeatured = idx < 2;
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        className={`group relative flex flex-col justify-between
                          bg-white dark:bg-slate-800 rounded-2xl
                          border border-slate-200 dark:border-slate-700
                          p-4 overflow-hidden
                          hover:shadow-xl hover:shadow-slate-200/60 dark:hover:shadow-black/30
                          hover:-translate-y-1 hover:border-transparent
                          transition-all duration-200 active:scale-[0.98]
                          ${isFeatured ? 'sm:col-span-1' : ''}`}
                        style={{
                          ['--hover-shadow-color' as any]: `${item.color}20`,
                        }}
                      >
                        {/* Gradient bg on hover */}
                        <div
                          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"
                          style={{ background: `linear-gradient(135deg, ${item.color}08, ${item.color}04)` }}
                        />

                        {/* Top accent */}
                        <div
                          className="absolute top-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                          style={{ background: `linear-gradient(90deg, ${item.color}, ${item.color}40)` }}
                        />

                        <div className="relative z-10">
                          {/* Icon */}
                          <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center mb-4
                              transition-transform duration-200 group-hover:scale-110"
                            style={{ backgroundColor: `${item.color}15` }}
                          >
                            <Icon className="w-5 h-5" style={{ color: item.color }} />
                          </div>

                          {/* Label */}
                          <h3 className="font-bold text-sm text-slate-800 dark:text-white">{item.label}</h3>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{item.sub}</p>
                        </div>

                        {/* Arrow */}
                        <div className="relative z-10 mt-4 flex items-center justify-end">
                          <ChevronRight
                            className="w-4 h-4 transition-all duration-200 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5"
                            style={{ color: item.color }}
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Stock sectors ───────────────────────────────────────── */}
            {stockSectors.filter(s => can(`sector_stock:${s.id}`)).length > 0 && (
              <section>
                <SectionLabel>Estoques Setoriais</SectionLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {stockSectors.filter(s => can(`sector_stock:${s.id}`)).map((sector, idx) => {
                    const { icon: Icon, gradient, color } = getSectorVisual(sector.name, idx);
                    return (
                      <Link
                        key={sector.id}
                        to={`/sector-stock/${sector.id}`}
                        className="group flex items-center gap-4 bg-white dark:bg-slate-800 rounded-2xl
                          border border-slate-200 dark:border-slate-700 p-4
                          hover:shadow-lg hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-600
                          transition-all duration-200 active:scale-[0.98]"
                      >
                        {/* Icon with gradient */}
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-lg transition-transform duration-200 group-hover:scale-105`}
                          style={{ boxShadow: `0 4px 14px ${color}30` }}>
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-bold text-sm text-slate-800 dark:text-white truncate">
                            {sector.name}
                          </h3>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Gerenciar estoque</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Sectors (requisições) ───────────────────────────────── */}
            {allSectors.length > 0 && (
              <section>
                <SectionLabel>Setores</SectionLabel>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {allSectors.map((sector, idx) => {
                    const { icon: Icon, color } = getSectorVisual(sector.name, idx);
                    const sColor = sector.color || color;
                    return (
                      <Link
                        key={sector.id}
                        to={`/sector/${sector.id}`}
                        className="group flex items-center gap-3 bg-white dark:bg-slate-800 rounded-xl
                          border border-slate-200 dark:border-slate-700 p-3.5
                          hover:shadow-md hover:-translate-y-0.5
                          transition-all duration-150 active:scale-[0.98]"
                      >
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-110"
                          style={{ backgroundColor: `${sColor}15` }}
                        >
                          <Icon className="w-4 h-4" style={{ color: sColor }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                            {sector.name}
                          </h3>
                          {sector.has_stock && (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                              Stock
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Guest: maintenance ticket */}
            {user.role === 'guest' && (
              <Link
                to="/maintenance/ticket/new"
                className="flex items-center gap-4 p-5 rounded-2xl overflow-hidden relative
                  bg-gradient-to-br from-orange-500 to-amber-500
                  hover:from-orange-400 hover:to-amber-400
                  shadow-xl shadow-orange-500/20
                  hover:-translate-y-0.5 transition-all duration-200 active:scale-[0.98]"
              >
                <div className="absolute inset-0 bg-black/5 pointer-events-none" />
                <div className="relative bg-white/20 p-3 rounded-xl shrink-0">
                  <Wrench className="h-6 w-6 text-white" />
                </div>
                <div className="relative flex-1">
                  <h2 className="text-lg font-bold text-white">Abrir Chamado de Manutenção</h2>
                  <p className="text-sm text-orange-100 mt-0.5">Reporte um problema ou defeito</p>
                </div>
                <ChevronRight className="relative w-5 h-5 text-white/60" />
              </Link>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Visitante não logado ──────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      {/* Maintenance CTA */}
      <Link
        to="/maintenance/ticket/new"
        className="flex items-center gap-4 p-5 rounded-2xl overflow-hidden relative
          bg-gradient-to-br from-orange-500 to-amber-500
          shadow-xl shadow-orange-500/20
          hover:-translate-y-0.5 transition-all duration-200 active:scale-[0.98]"
      >
        <div className="relative bg-white/20 p-3 rounded-xl shrink-0">
          <Wrench className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-white">Abrir Chamado de Manutenção</h2>
          <p className="text-sm text-orange-100 mt-0.5">Reporte um problema ou defeito</p>
        </div>
        <ChevronRight className="w-5 h-5 text-white/60" />
      </Link>

      {/* Public sectors */}
      {allSectors.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-5 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.15em]">Setores</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {allSectors.map((sector, idx) => {
              const { icon: Icon, color } = getSectorVisual(sector.name, idx);
              const sColor = sector.color || color;
              return (
                <Link
                  key={sector.id}
                  to={`/sector/${sector.id}`}
                  className="group flex items-center gap-3 bg-white dark:bg-slate-800 rounded-xl
                    border border-slate-200 dark:border-slate-700 p-3.5
                    hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 active:scale-[0.98]"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-110"
                    style={{ backgroundColor: `${sColor}15` }}>
                    <Icon className="w-4 h-4" style={{ color: sColor }} />
                  </div>
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{sector.name}</h3>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Login */}
      <Link
        to="/login"
        className="group flex items-center gap-4 p-5 rounded-2xl
          bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
          hover:shadow-xl hover:border-indigo-300 dark:hover:border-indigo-700
          hover:-translate-y-0.5 transition-all duration-200 active:scale-[0.98]"
      >
        <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0 group-hover:bg-indigo-500/20 transition-colors">
          <Lock className="h-6 w-6 text-indigo-500" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-slate-800 dark:text-white">Área Administrativa</h2>
          <p className="text-sm text-slate-400 mt-0.5">Acesso restrito — clique para fazer login</p>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all duration-150" />
      </Link>
    </div>
  );
};

export default Home;
