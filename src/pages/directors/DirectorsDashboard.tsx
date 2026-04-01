// src/pages/directors/DirectorsDashboard.tsx
import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Crown, Building2, Users, Wrench, ShoppingCart, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, Clock, BarChart3, ArrowRight, RefreshCw,
  UserPlus, UserMinus, Percent, Target,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface Hotel { id: string; name: string; code: string; }

interface HotelKPI {
  hotel: Hotel;
  headcount: number;
  admissions30d: number;
  dismissals30d: number;
  turnoverRate: number;
  openTickets: number;
  resolvedTickets30d: number;
  avgResolutionHours: number;
  pendingPurchases: number;
  absences30d: number;
}

interface MonthlyTurnover {
  month: string;
  admissions: number;
  dismissals: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function DirectorsDashboard() {
  const { selectedHotel } = useHotel();

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [kpis, setKpis] = useState<HotelKPI[]>([]);
  const [monthlyTurnover, setMonthlyTurnover] = useState<MonthlyTurnover[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'cards' | 'consolidated'>('cards');

  /* ---- Load all hotels ---- */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('hotels').select('id, name, code').order('name');
      if (data) setHotels(data);
    })();
  }, []);

  /* ---- Load KPIs ---- */
  useEffect(() => {
    if (!hotels.length) return;
    loadKPIs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotels]);

  async function loadKPIs() {
    setLoading(true);
    const now = new Date();
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);
    const iso30 = d30.toISOString().slice(0, 10);

    const results: HotelKPI[] = [];

    for (const hotel of hotels) {
      // Headcount
      const { count: headcount } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('hotel_id', hotel.id)
        .eq('status', 'active');

      // Admissions last 30d
      const { count: admissions30d } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('hotel_id', hotel.id)
        .gte('admission_date', iso30);

      // Dismissals last 30d (status = dismissed + updated_at in range)
      const { count: dismissals30d } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('hotel_id', hotel.id)
        .eq('status', 'dismissed')
        .gte('updated_at', d30.toISOString());

      // Turnover rate
      const total = (headcount ?? 0) + (dismissals30d ?? 0);
      const turnoverRate = total > 0
        ? (((admissions30d ?? 0) + (dismissals30d ?? 0)) / 2) / total * 100
        : 0;

      // Maintenance open tickets
      const { count: openTickets } = await supabase
        .from('maintenance_tickets')
        .select('*', { count: 'exact', head: true })
        .eq('hotel_id', hotel.id)
        .in('status', ['open', 'in_progress']);

      // Maintenance resolved last 30d
      const { data: resolvedData } = await supabase
        .from('maintenance_tickets')
        .select('created_at, resolved_at')
        .eq('hotel_id', hotel.id)
        .eq('status', 'resolved')
        .gte('resolved_at', d30.toISOString());

      const resolvedTickets30d = resolvedData?.length ?? 0;
      const avgResolutionHours = resolvedData?.length
        ? resolvedData.reduce((sum, t) => {
            const created = new Date(t.created_at).getTime();
            const resolved = new Date(t.resolved_at).getTime();
            return sum + (resolved - created) / (1000 * 60 * 60);
          }, 0) / resolvedData.length
        : 0;

      // Pending purchases
      const { count: pendingPurchases } = await supabase
        .from('purchase_orders')
        .select('*', { count: 'exact', head: true })
        .eq('hotel_id', hotel.id)
        .in('status', ['pending', 'approved']);

      // Absences last 30d (schedule entries with occurrence that causes loss)
      const { count: absences30d } = await supabase
        .from('schedule_entries')
        .select('*, occurrence_types!inner(causes_basket_loss)', { count: 'exact', head: true })
        .eq('schedule_id', hotel.id) // schedule uses hotel reference
        .gte('day_date', iso30)
        .not('occurrence_type_id', 'is', null);

      results.push({
        hotel,
        headcount: headcount ?? 0,
        admissions30d: admissions30d ?? 0,
        dismissals30d: dismissals30d ?? 0,
        turnoverRate: Math.round(turnoverRate * 10) / 10,
        openTickets: openTickets ?? 0,
        resolvedTickets30d,
        avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
        pendingPurchases: pendingPurchases ?? 0,
        absences30d: absences30d ?? 0,
      });
    }

    setKpis(results);

    // Monthly turnover (last 6 months)
    await loadMonthlyTurnover();

    setLoading(false);
  }

  async function loadMonthlyTurnover() {
    const months: MonthlyTurnover[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = d.toISOString().slice(0, 10);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

      const hotelFilter = selectedHotel ? `.eq('hotel_id','${selectedHotel.id}')` : '';
      void hotelFilter; // just for reference

      let admQ = supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .gte('admission_date', start)
        .lte('admission_date', end);
      if (selectedHotel) admQ = admQ.eq('hotel_id', selectedHotel.id);

      let disQ = supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'dismissed')
        .gte('updated_at', start + 'T00:00:00')
        .lte('updated_at', end + 'T23:59:59');
      if (selectedHotel) disQ = disQ.eq('hotel_id', selectedHotel.id);

      const [{ count: adm }, { count: dis }] = await Promise.all([admQ, disQ]);
      months.push({ month: label, admissions: adm ?? 0, dismissals: dis ?? 0 });
    }
    setMonthlyTurnover(months);
  }

  /* ---- Consolidated totals ---- */
  const totals = useMemo(() => {
    const filtered = selectedHotel
      ? kpis.filter(k => k.hotel.id === selectedHotel.id)
      : kpis;
    return {
      headcount: filtered.reduce((s, k) => s + k.headcount, 0),
      admissions: filtered.reduce((s, k) => s + k.admissions30d, 0),
      dismissals: filtered.reduce((s, k) => s + k.dismissals30d, 0),
      openTickets: filtered.reduce((s, k) => s + k.openTickets, 0),
      resolvedTickets: filtered.reduce((s, k) => s + k.resolvedTickets30d, 0),
      pendingPurchases: filtered.reduce((s, k) => s + k.pendingPurchases, 0),
      absences: filtered.reduce((s, k) => s + k.absences30d, 0),
      avgResolution: filtered.length
        ? Math.round(filtered.reduce((s, k) => s + k.avgResolutionHours, 0) / filtered.length * 10) / 10
        : 0,
    };
  }, [kpis, selectedHotel]);

  /* ---- Pie data for headcount by hotel ---- */
  const headcountPie = useMemo(() =>
    kpis.map(k => ({ name: k.hotel.name, value: k.headcount })),
    [kpis],
  );

  const COLORS = ['#6366f1', '#8b5cf6', '#3b82f6', '#14b8a6', '#f59e0b', '#ef4444', '#22c55e', '#ec4899'];

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
            <Crown className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard Diretoria</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {selectedHotel ? selectedHotel.name : 'Visão consolidada da rede'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'cards' ? 'consolidated' : 'cards')}
            className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            {viewMode === 'cards' ? 'Visão Consolidada' : 'Visão por Hotel'}
          </button>
          <button
            onClick={loadKPIs}
            disabled={loading}
            className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            to="/directors/comparison"
            className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1"
          >
            <BarChart3 className="w-4 h-4" /> Comparar
          </Link>
          <Link
            to="/directors/kpi-targets"
            className="px-3 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-1"
          >
            <Target className="w-4 h-4" /> Metas
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard icon={Users} label="Headcount" value={totals.headcount} color="indigo" />
            <SummaryCard icon={UserPlus} label="Admissões (30d)" value={totals.admissions} color="green" />
            <SummaryCard icon={UserMinus} label="Desligamentos (30d)" value={totals.dismissals} color="red" />
            <SummaryCard icon={Wrench} label="Tickets Abertos" value={totals.openTickets} color="amber" />
            <SummaryCard icon={CheckCircle2} label="Resolvidos (30d)" value={totals.resolvedTickets} color="green" />
            <SummaryCard icon={Clock} label="SLA Médio (h)" value={totals.avgResolution} color="blue" suffix="h" />
            <SummaryCard icon={ShoppingCart} label="Compras Pendentes" value={totals.pendingPurchases} color="purple" />
            <SummaryCard icon={AlertTriangle} label="Ausências (30d)" value={totals.absences} color="red" />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Turnover Chart */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                Turnover — Últimos 6 Meses
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlyTurnover}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, color: '#fff' }}
                  />
                  <Bar dataKey="admissions" name="Admissões" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="dismissals" name="Desligamentos" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Headcount Pie */}
            {!selectedHotel && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                  Headcount por Unidade
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={headcountPie}
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {headcountPie.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Maintenance SLA trend (when filtering one hotel or consolidated) */}
            {selectedHotel && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                  Resumo — {selectedHotel.name}
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  {(() => {
                    const k = kpis.find(k => k.hotel.id === selectedHotel.id);
                    if (!k) return null;
                    return (
                      <>
                        <MiniStat label="Headcount" value={k.headcount} />
                        <MiniStat label="Turnover (%)" value={`${k.turnoverRate}%`} />
                        <MiniStat label="Tickets Abertos" value={k.openTickets} />
                        <MiniStat label="SLA Resolução" value={`${k.avgResolutionHours}h`} />
                        <MiniStat label="Compras Pendentes" value={k.pendingPurchases} />
                        <MiniStat label="Ausências (30d)" value={k.absences30d} />
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Hotel Cards */}
          {viewMode === 'cards' && !selectedHotel && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">KPIs por Unidade</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {kpis.map(k => (
                  <div
                    key={k.hotel.id}
                    className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-indigo-500" />
                        <h3 className="font-semibold text-gray-900 dark:text-white">{k.hotel.name}</h3>
                      </div>
                      <span className="text-xs text-gray-400">{k.hotel.code}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-400" />
                        <span className="text-gray-600 dark:text-gray-400">Headcount:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{k.headcount}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Percent className="w-4 h-4 text-orange-400" />
                        <span className="text-gray-600 dark:text-gray-400">Turnover:</span>
                        <span className={`font-semibold ${k.turnoverRate > 5 ? 'text-red-500' : 'text-green-500'}`}>
                          {k.turnoverRate}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-green-400" />
                        <span className="text-gray-600 dark:text-gray-400">Admissões:</span>
                        <span className="font-semibold text-green-600 dark:text-green-400">{k.admissions30d}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UserMinus className="w-4 h-4 text-red-400" />
                        <span className="text-gray-600 dark:text-gray-400">Desligam.:</span>
                        <span className="font-semibold text-red-600 dark:text-red-400">{k.dismissals30d}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-amber-400" />
                        <span className="text-gray-600 dark:text-gray-400">Tickets:</span>
                        <span className={`font-semibold ${k.openTickets > 10 ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                          {k.openTickets}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-blue-400" />
                        <span className="text-gray-600 dark:text-gray-400">SLA:</span>
                        <span className={`font-semibold ${k.avgResolutionHours > 48 ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                          {k.avgResolutionHours}h
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="w-4 h-4 text-purple-400" />
                        <span className="text-gray-600 dark:text-gray-400">Compras:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{k.pendingPurchases}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <span className="text-gray-600 dark:text-gray-400">Ausências:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{k.absences30d}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Consolidated table */}
          {viewMode === 'consolidated' && !selectedHotel && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-white">Visão Consolidada</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Hotel</th>
                      <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Headcount</th>
                      <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Turnover</th>
                      <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Admissões</th>
                      <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Desligam.</th>
                      <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Tickets</th>
                      <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">SLA (h)</th>
                      <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Compras</th>
                      <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Ausências</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                    {kpis.map(k => (
                      <tr key={k.hotel.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{k.hotel.name}</td>
                        <td className="text-center px-3 py-3 text-gray-700 dark:text-gray-300">{k.headcount}</td>
                        <td className="text-center px-3 py-3">
                          <span className={k.turnoverRate > 5 ? 'text-red-500 font-semibold' : 'text-green-500'}>{k.turnoverRate}%</span>
                        </td>
                        <td className="text-center px-3 py-3 text-green-600 dark:text-green-400">{k.admissions30d}</td>
                        <td className="text-center px-3 py-3 text-red-600 dark:text-red-400">{k.dismissals30d}</td>
                        <td className="text-center px-3 py-3">
                          <span className={k.openTickets > 10 ? 'text-red-500 font-semibold' : 'text-gray-700 dark:text-gray-300'}>{k.openTickets}</span>
                        </td>
                        <td className="text-center px-3 py-3">
                          <span className={k.avgResolutionHours > 48 ? 'text-red-500 font-semibold' : 'text-gray-700 dark:text-gray-300'}>{k.avgResolutionHours}</span>
                        </td>
                        <td className="text-center px-3 py-3 text-gray-700 dark:text-gray-300">{k.pendingPurchases}</td>
                        <td className="text-center px-3 py-3 text-gray-700 dark:text-gray-300">{k.absences30d}</td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr className="bg-gray-50 dark:bg-gray-700/50 font-semibold">
                      <td className="px-4 py-3 text-gray-900 dark:text-white">TOTAL</td>
                      <td className="text-center px-3 py-3 text-gray-900 dark:text-white">{totals.headcount}</td>
                      <td className="text-center px-3 py-3 text-gray-900 dark:text-white">—</td>
                      <td className="text-center px-3 py-3 text-green-600 dark:text-green-400">{totals.admissions}</td>
                      <td className="text-center px-3 py-3 text-red-600 dark:text-red-400">{totals.dismissals}</td>
                      <td className="text-center px-3 py-3 text-gray-900 dark:text-white">{totals.openTickets}</td>
                      <td className="text-center px-3 py-3 text-gray-900 dark:text-white">{totals.avgResolution}</td>
                      <td className="text-center px-3 py-3 text-gray-900 dark:text-white">{totals.pendingPurchases}</td>
                      <td className="text-center px-3 py-3 text-gray-900 dark:text-white">{totals.absences}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */
function SummaryCard({ icon: Icon, label, value, color, suffix }: {
  icon: any; label: string; value: number | string; color: string; suffix?: string;
}) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400',
    green:  'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    red:    'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    amber:  'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
  };
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {value}{suffix && <span className="text-sm font-normal text-gray-400 ml-1">{suffix}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}
