// src/pages/Home.tsx
// Dashboard principal — setores e estoques 100% dinâmicos via banco

import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Package, BarChart3, Building2, ShieldCheck, ChevronDown, ChevronUp,
  Lock, Boxes, ShoppingCart, DollarSign, FileText, CreditCard, Wrench,
  HardHat, UsersRound, ChefHat, UtensilsCrossed, GlassWater, Hotel,
  Layers, Shirt, Coffee, Dumbbell, Leaf, Star, Truck, Printer,
  Monitor, Archive,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';

// ---------------------------------------------------------------------------
// Mapeamento de ícone + gradiente por nome de setor (normalizado)
// ---------------------------------------------------------------------------
const SECTOR_VISUAL: Record<string, { icon: React.ComponentType<any>; gradient: string }> = {
  'cozinha':      { icon: ChefHat,        gradient: 'from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700' },
  'restaurante':  { icon: UtensilsCrossed, gradient: 'from-red-500 to-red-600 hover:from-red-600 hover:to-red-700' },
  'exclusive':    { icon: UtensilsCrossed, gradient: 'from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700' },
  'governanca':   { icon: ShieldCheck,     gradient: 'from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700' },
  'bar piscina':  { icon: GlassWater,      gradient: 'from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700' },
  'bar':          { icon: GlassWater,      gradient: 'from-blue-400 to-blue-500 hover:from-blue-500 hover:to-blue-600' },
  'manutencao':   { icon: Wrench,          gradient: 'from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700' },
  'lavanderia':   { icon: Shirt,           gradient: 'from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700' },
  'recepcao':     { icon: Hotel,           gradient: 'from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700' },
  'reservas':     { icon: Hotel,           gradient: 'from-teal-400 to-teal-500 hover:from-teal-500 hover:to-teal-600' },
  'cafe':         { icon: Coffee,          gradient: 'from-yellow-600 to-yellow-700 hover:from-yellow-700 hover:to-yellow-800' },
  'academia':     { icon: Dumbbell,        gradient: 'from-lime-500 to-lime-600 hover:from-lime-600 hover:to-lime-700' },
  'jardim':       { icon: Leaf,            gradient: 'from-green-500 to-green-600 hover:from-green-600 hover:to-green-700' },
  'eventos':      { icon: Star,            gradient: 'from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700' },
  'logistica':    { icon: Truck,           gradient: 'from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800' },
  'papelaria':    { icon: Printer,         gradient: 'from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700' },
  'ti':           { icon: Monitor,         gradient: 'from-cyan-600 to-cyan-700 hover:from-cyan-700 hover:to-cyan-800' },
  'almoxarifado': { icon: Archive,         gradient: 'from-stone-500 to-stone-600 hover:from-stone-600 hover:to-stone-700' },
  'producao':     { icon: Layers,          gradient: 'from-fuchsia-500 to-fuchsia-600 hover:from-fuchsia-600 hover:to-fuchsia-700' },
  'financeiro':   { icon: DollarSign,      gradient: 'from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700' },
  'gerencia':     { icon: BarChart3,       gradient: 'from-green-500 to-green-600 hover:from-green-600 hover:to-green-700' },
  'marketing':    { icon: Star,            gradient: 'from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700' },
};

// Gradientes de fallback (rotativo por índice)
const FALLBACK_GRADIENTS = [
  'from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700',
  'from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700',
  'from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700',
  'from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700',
  'from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700',
  'from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700',
];

/** Normaliza nome para lookup: remove acentos, lowercase */
function normalize(str: string) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getSectorVisual(name: string, idx: number) {
  const key = normalize(name);
  // Tenta match exato, depois tenta por palavra inicial
  const match = SECTOR_VISUAL[key]
    || Object.entries(SECTOR_VISUAL).find(([k]) => key.startsWith(k))?.[1];
  return match || {
    icon: Boxes,
    gradient: FALLBACK_GRADIENTS[idx % FALLBACK_GRADIENTS.length],
  };
}

// ---------------------------------------------------------------------------
// Cards administrativos
// ---------------------------------------------------------------------------
const ADMIN_CARDS = [
  { key: 'inventory',  label: 'Inventário',        sub: 'Gerenciar estoque',         href: '/inventory',            gradient: 'from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700', icon: Boxes,        roles: ['admin','inventory'] },
  { key: 'purchases',  label: 'Compras',            sub: 'Gerenciar pedidos',          href: '/purchases',            gradient: 'from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700',   icon: ShoppingCart, roles: ['admin','inventory'] },
  { key: 'reports',    label: 'Relatórios',         sub: 'Controle semanal',           href: '/reports',              gradient: 'from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700',       icon: FileText,     roles: ['admin','inventory'] },
  { key: 'auth',       label: 'Autorizações',       sub: 'Gerenciar autorizações',     href: '/authorizations',       gradient: 'from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700',       icon: CreditCard,   roles: ['admin','inventory'] },
  { key: 'requests',   label: 'Requisições',        sub: 'Pedidos dos setores',        href: '/admin',                gradient: 'from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700',        icon: Package,      roles: ['admin'] },
  { key: 'finances',   label: 'Financeiro',         sub: 'Controle financeiro',        href: '/finances',             gradient: 'from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700', icon: DollarSign, roles: ['admin'] },
  { key: 'management', label: 'Gerência',           sub: 'Relatórios e análises',      href: '/management',           gradient: 'from-green-500 to-green-600 hover:from-green-600 hover:to-green-700',   icon: BarChart3,    roles: ['admin','management'] },
  { key: 'dp',         label: 'Depart. Pessoal',   sub: 'Contratos e colaboradores',  href: '/personnel-department', gradient: 'from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700',       icon: UsersRound,   roles: ['admin','management','rh'] },
  { key: 'maint',      label: 'Manutenções',        sub: 'Tickets e equipamentos',     href: '/maintenance',          gradient: 'from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700', icon: HardHat,    roles: ['admin','management'] },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const Home = () => {
  const { user }          = useAuth();
  const { selectedHotel } = useHotel();
  const navigate          = useNavigate();

  const [allSectors, setAllSectors]     = useState<any[]>([]);
  const [showSectors, setShowSectors]   = useState(true);
  const [loadingSectors, setLoadingSectors] = useState(false);

  // Redireciona se não há hotel selecionado
  useEffect(() => {
    if (!selectedHotel) navigate('/select-hotel', { replace: true });
  }, [selectedHotel, navigate]);

  // Busca todos os setores do hotel — incluindo has_stock e color
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

  // Setores com stock ativo — aparecem nos cards coloridos
  const stockSectors = useMemo(
    () => allSectors.filter(s => s.has_stock === true),
    [allSectors]
  );

  // Cards admin filtrados pelo role do usuário
  const adminCards = useMemo(() => {
    if (!user) return [];
    return ADMIN_CARDS.filter(c => c.roles.includes(user.role || ''));
  }, [user]);

  if (!selectedHotel) return null;

  // ── Estoques Setoriais ────────────────────────────────────────────────────
  const renderStockSectors = () => {
    // Guest não tem acesso a estoques setoriais
    if (!user || user.role === 'guest' || stockSectors.length === 0) return null;
    return (
      <div className="space-y-4">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white">
          Estoques Setoriais
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stockSectors.map((sector, idx) => {
            const { icon: Icon, gradient } = getSectorVisual(sector.name, idx);
            return (
              <Link
                key={sector.id}
                to={`/sector-stock/${sector.id}`}
                className={`bg-gradient-to-br ${gradient} p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1`}
              >
                <div className="flex items-center space-x-3 sm:space-x-4">
                  <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg sm:text-xl font-semibold text-white">
                      Estoque {sector.name}
                    </h2>
                    <p className="text-sm text-white/80">Gerenciar estoque</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Área Administrativa ───────────────────────────────────────────────────
  const renderAdminSection = () => {
    if (!user) {
      return (
        <Link
          to="/login"
          className="block bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-200"
        >
          <div className="px-4 sm:px-8 py-6">
            <div className="flex items-center">
              <div className="bg-white/10 p-3 rounded-lg mr-3 sm:mr-5 shrink-0">
                <Lock className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-white mb-1">Área Administrativa</h2>
                <p className="text-sm sm:text-base text-blue-100">Acesso restrito para funcionários autorizados</p>
              </div>
            </div>
          </div>
          <div className="px-4 sm:px-8 py-3 bg-black/10 rounded-b-xl">
            <p className="text-sm text-blue-100 flex items-center">
              <span>Clique para fazer login</span>
              <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </p>
          </div>
        </Link>
      );
    }

    if (adminCards.length === 0) return null;

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {adminCards.map(card => {
          const Icon = card.icon;
          return (
            <Link
              key={card.key}
              to={card.href}
              className={`bg-gradient-to-br ${card.gradient} p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1`}
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                  <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">{card.label}</h2>
                  <p className="text-sm text-white/80">{card.sub}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    );
  };

  // ── Lista de Setores (requisições) ────────────────────────────────────────
  const renderSectorsList = () => (
    <div>
      <button
        onClick={() => setShowSectors(!showSectors)}
        className="w-full flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm hover:shadow-md transition-all duration-200"
      >
        <div className="flex items-center space-x-3">
          <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-white">Setores</h2>
          {allSectors.length > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">
              {allSectors.length}
            </span>
          )}
        </div>
        {showSectors
          ? <ChevronUp className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          : <ChevronDown className="h-5 w-5 text-gray-500 dark:text-gray-400" />
        }
      </button>

      {showSectors && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {allSectors.map((sector: any) => (
            <Link
              key={sector.id}
              to={`/sector/${sector.id}`}
              className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-xl shadow-md hover:shadow-lg transition-all duration-200 group"
            >
              <div className="flex items-center space-x-3">
                <div
                  className="p-2 rounded-lg shrink-0 transition-opacity"
                  style={{ background: sector.color ? `${sector.color}22` : '#3b82f615' }}
                >
                  <Building2
                    className="h-5 w-5 sm:h-6 sm:w-6"
                    style={{ color: sector.color || '#3b82f6' }}
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-white truncate">
                    {sector.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Ver requisições</p>
                    {sector.has_stock && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                        Stock
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}

          {allSectors.length === 0 && !loadingSectors && (
            <div className="col-span-3 text-center py-10 text-gray-400">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhum setor cadastrado para este hotel.</p>
              {user?.role === 'admin' && (
                <Link to="/admin/sectors" className="text-sm text-blue-500 hover:underline mt-1 inline-block">
                  Criar setores →
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Render principal ──────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {user ? (
        <div className="space-y-8">
          {/* Chamado de manutenção — visível apenas para convidados */}
          {user.role === 'guest' && (
            <Link
              to="/maintenance/ticket/new"
              className="flex items-center gap-4 bg-gradient-to-br from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 p-5 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <div className="bg-white/20 p-3 rounded-xl shrink-0">
                <Wrench className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg sm:text-xl font-bold text-white">Abrir Chamado de Manutenção</h2>
                <p className="text-sm text-orange-100 mt-0.5">Reporte um problema ou defeito</p>
              </div>
              <svg className="w-5 h-5 text-white/70 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}

          {adminCards.length > 0 && (
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-4">
                Área Administrativa
              </h2>
              {renderAdminSection()}
            </div>
          )}

          {/* Estoques — só aparece se existir algum setor com has_stock=true */}
          {renderStockSectors()}

          {/* Setores — todos aparecem aqui para requisições */}
          {renderSectorsList()}
        </div>
      ) : (
        /* ── Visitante não logado ── */
        <div className="space-y-6 sm:space-y-8">

          {/* Chamado de manutenção público */}
          <Link
            to="/maintenance/ticket/new"
            className="flex items-center gap-4 bg-gradient-to-br from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 p-5 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
          >
            <div className="bg-white/20 p-3 rounded-xl shrink-0">
              <Wrench className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg sm:text-xl font-bold text-white">Abrir Chamado de Manutenção</h2>
              <p className="text-sm text-orange-100 mt-0.5">Reporte um problema ou defeito</p>
            </div>
            <svg className="w-5 h-5 text-white/70 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          {/* Setores públicos */}
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-4">Setores</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allSectors.map((sector: any) => (
                <Link
                  key={sector.id}
                  to={`/sector/${sector.id}`}
                  className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-xl shadow-md hover:shadow-lg transition-all duration-200 group"
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className="p-2 rounded-lg shrink-0"
                      style={{ background: sector.color ? `${sector.color}22` : '#3b82f615' }}
                    >
                      <Building2
                        className="h-5 w-5 sm:h-6 sm:w-6"
                        style={{ color: sector.color || '#3b82f6' }}
                      />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-white">
                        {sector.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Ver requisições</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Login */}
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-4">
              Área Administrativa
            </h2>
            {renderAdminSection()}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;