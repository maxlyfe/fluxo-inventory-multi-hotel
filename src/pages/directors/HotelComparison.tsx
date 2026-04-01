// src/pages/directors/HotelComparison.tsx
import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Building2, Users, Wrench, ShoppingCart, Clock,
  UserPlus, UserMinus, AlertTriangle, RefreshCw, BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend,
} from 'recharts';
import { supabase } from '../../lib/supabase';

interface Hotel { id: string; name: string; code: string; }

interface HotelMetrics {
  hotel: Hotel;
  headcount: number;
  turnoverRate: number;
  openTickets: number;
  avgResolutionHours: number;
  pendingPurchases: number;
  absences30d: number;
}

export default function HotelComparison() {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [metrics, setMetrics] = useState<HotelMetrics[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('hotels').select('id, name, code').order('name');
      if (data) {
        setHotels(data);
        setSelected(new Set(data.map(h => h.id)));
      }
    })();
  }, []);

  useEffect(() => {
    if (!hotels.length) return;
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotels]);

  async function loadMetrics() {
    setLoading(true);
    const now = new Date();
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);
    const iso30 = d30.toISOString().slice(0, 10);

    const results: HotelMetrics[] = [];

    for (const hotel of hotels) {
      const [
        { count: headcount },
        { count: admissions },
        { count: dismissals },
        { count: openTickets },
        { data: resolvedData },
        { count: pendingPurchases },
        { count: absences },
      ] = await Promise.all([
        supabase.from('employees').select('*', { count: 'exact', head: true })
          .eq('hotel_id', hotel.id).eq('status', 'active'),
        supabase.from('employees').select('*', { count: 'exact', head: true })
          .eq('hotel_id', hotel.id).gte('admission_date', iso30),
        supabase.from('employees').select('*', { count: 'exact', head: true })
          .eq('hotel_id', hotel.id).eq('status', 'dismissed').gte('updated_at', d30.toISOString()),
        supabase.from('maintenance_tickets').select('*', { count: 'exact', head: true })
          .eq('hotel_id', hotel.id).in('status', ['open', 'in_progress']),
        supabase.from('maintenance_tickets').select('created_at, resolved_at')
          .eq('hotel_id', hotel.id).eq('status', 'resolved').gte('resolved_at', d30.toISOString()),
        supabase.from('purchase_orders').select('*', { count: 'exact', head: true })
          .eq('hotel_id', hotel.id).in('status', ['pending', 'approved']),
        supabase.from('schedule_entries').select('*', { count: 'exact', head: true })
          .gte('day_date', iso30).not('occurrence_type_id', 'is', null),
      ]);

      const total = (headcount ?? 0) + (dismissals ?? 0);
      const turnoverRate = total > 0
        ? (((admissions ?? 0) + (dismissals ?? 0)) / 2) / total * 100
        : 0;

      const avgRes = resolvedData?.length
        ? resolvedData.reduce((s, t) => {
            return s + (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 3600000;
          }, 0) / resolvedData.length
        : 0;

      results.push({
        hotel,
        headcount: headcount ?? 0,
        turnoverRate: Math.round(turnoverRate * 10) / 10,
        openTickets: openTickets ?? 0,
        avgResolutionHours: Math.round(avgRes * 10) / 10,
        pendingPurchases: pendingPurchases ?? 0,
        absences30d: absences ?? 0,
      });
    }

    setMetrics(results);
    setLoading(false);
  }

  const filtered = useMemo(() => metrics.filter(m => selected.has(m.hotel.id)), [metrics, selected]);

  const toggleHotel = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /* Bar chart data */
  const barData = useMemo(() =>
    filtered.map(m => ({
      name: m.hotel.code || m.hotel.name.substring(0, 12),
      Headcount: m.headcount,
      'Tickets Abertos': m.openTickets,
      'Compras Pendentes': m.pendingPurchases,
      'Ausências': m.absences30d,
    })), [filtered]);

  /* Radar chart data — normalized 0-100 */
  const radarData = useMemo(() => {
    if (!filtered.length) return [];
    const maxHead = Math.max(...filtered.map(m => m.headcount), 1);
    const maxTickets = Math.max(...filtered.map(m => m.openTickets), 1);
    const maxSLA = Math.max(...filtered.map(m => m.avgResolutionHours), 1);
    const maxPurch = Math.max(...filtered.map(m => m.pendingPurchases), 1);
    const maxAbs = Math.max(...filtered.map(m => m.absences30d), 1);

    const dims = ['Headcount', 'Tickets', 'SLA (h)', 'Compras', 'Ausências'];
    return dims.map((dim, i) => {
      const row: any = { dimension: dim };
      filtered.forEach(m => {
        const vals = [m.headcount / maxHead, m.openTickets / maxTickets, m.avgResolutionHours / maxSLA, m.pendingPurchases / maxPurch, m.absences30d / maxAbs];
        row[m.hotel.name] = Math.round(vals[i] * 100);
      });
      return row;
    });
  }, [filtered]);

  const COLORS = ['#6366f1', '#8b5cf6', '#3b82f6', '#14b8a6', '#f59e0b', '#ef4444', '#22c55e', '#ec4899'];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/directors" className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
            <BarChart3 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Comparativo entre Hotéis</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} de {hotels.length} selecionados</p>
          </div>
        </div>
      </div>

      {/* Hotel selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {hotels.map(h => (
          <button
            key={h.id}
            onClick={() => toggleHotel(h.id)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              selected.has(h.id)
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 inline mr-1" />
            {h.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : (
        <>
          {/* Comparison table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Hotel</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">
                      <Users className="w-4 h-4 inline mr-1" />Headcount
                    </th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Turnover %</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">
                      <Wrench className="w-4 h-4 inline mr-1" />Tickets
                    </th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">
                      <Clock className="w-4 h-4 inline mr-1" />SLA (h)
                    </th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">
                      <ShoppingCart className="w-4 h-4 inline mr-1" />Compras
                    </th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">
                      <AlertTriangle className="w-4 h-4 inline mr-1" />Ausências
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {filtered.map((m, i) => {
                    const best = (key: keyof HotelMetrics, lower = true) => {
                      const vals = filtered.map(f => f[key] as number);
                      const target = lower ? Math.min(...vals) : Math.max(...vals);
                      return m[key] === target;
                    };
                    return (
                      <tr key={m.hotel.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                          <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          {m.hotel.name}
                        </td>
                        <td className={`text-center px-3 py-3 ${best('headcount', false) ? 'font-bold text-indigo-600 dark:text-indigo-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          {m.headcount}
                        </td>
                        <td className={`text-center px-3 py-3 ${m.turnoverRate > 5 ? 'text-red-500 font-semibold' : 'text-green-500'}`}>
                          {m.turnoverRate}%
                        </td>
                        <td className={`text-center px-3 py-3 ${best('openTickets') ? 'font-bold text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          {m.openTickets}
                        </td>
                        <td className={`text-center px-3 py-3 ${best('avgResolutionHours') ? 'font-bold text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          {m.avgResolutionHours}
                        </td>
                        <td className={`text-center px-3 py-3 ${best('pendingPurchases') ? 'font-bold text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          {m.pendingPurchases}
                        </td>
                        <td className={`text-center px-3 py-3 ${best('absences30d') ? 'font-bold text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          {m.absences30d}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar comparison */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Comparativo por Indicador</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, color: '#fff' }} />
                  <Legend />
                  <Bar dataKey="Headcount" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Tickets Abertos" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Compras Pendentes" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Ausências" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Radar */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Perfil Comparativo (normalizado)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <PolarRadiusAxis tick={{ fontSize: 10, fill: '#9ca3af' }} domain={[0, 100]} />
                  {filtered.map((m, i) => (
                    <Radar
                      key={m.hotel.id}
                      name={m.hotel.name}
                      dataKey={m.hotel.name}
                      stroke={COLORS[i % COLORS.length]}
                      fill={COLORS[i % COLORS.length]}
                      fillOpacity={0.15}
                    />
                  ))}
                  <Legend />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, color: '#fff' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
