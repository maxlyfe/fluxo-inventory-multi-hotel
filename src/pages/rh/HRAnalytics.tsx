// src/pages/rh/HRAnalytics.tsx
// Dashboards de RH: turnover, headcount, absenteísmo, salarial, geográfico

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { format, parseISO, differenceInMonths, startOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  TrendingUp, TrendingDown, Users, UserPlus, UserMinus, DollarSign,
  MapPin, Calendar, Loader2, BarChart3, PieChart as PieChartIcon, Activity,
} from 'lucide-react';

interface Employee {
  id: string;
  name: string;
  sector: string;
  role: string;
  admission_date: string;
  status: string;
  city: string | null;
  neighborhood: string | null;
  salary?: number | null;
  dismissal_date?: string | null;
  contract_type: string;
}

interface ScheduleEntry {
  id: string;
  employee_id: string;
  entry_date: string;
  entry_type: string;
}

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#a855f7'];

export default function HRAnalytics() {
  const { selectedHotel } = useHotel();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [absences, setAbsences] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'turnover' | 'headcount' | 'salary' | 'geo' | 'absenteeism'>('turnover');

  useEffect(() => {
    if (selectedHotel?.id) loadData();
  }, [selectedHotel?.id]);

  async function loadData() {
    setLoading(true);
    const [activeRes, allRes, absRes] = await Promise.all([
      supabase
        .from('employees')
        .select('id, name, sector, role, admission_date, status, city, neighborhood, contract_type')
        .eq('hotel_id', selectedHotel!.id)
        .eq('status', 'active'),
      supabase
        .from('employees')
        .select('id, name, sector, role, admission_date, status, city, neighborhood, contract_type, dismissal_date')
        .eq('hotel_id', selectedHotel!.id),
      supabase
        .from('schedule_entries')
        .select('id, employee_id, entry_date, entry_type')
        .eq('hotel_id', selectedHotel!.id)
        .in('entry_type', ['falta', 'atestado', 'inss']),
    ]);
    setEmployees(activeRes.data || []);
    setAllEmployees(allRes.data || []);
    setAbsences(absRes.data || []);
    setLoading(false);
  }

  // ─── Turnover Data ────────────────────────────────────────────
  const turnoverData = useMemo(() => {
    const now = new Date();
    const months: { month: string; admissions: number; dismissals: number; rate: number }[] = [];

    for (let i = 11; i >= 0; i--) {
      const m = subMonths(now, i);
      const key = format(m, 'yyyy-MM');
      const label = format(m, 'MMM/yy', { locale: ptBR });

      const admissions = allEmployees.filter(e => e.admission_date?.startsWith(key)).length;
      const dismissals = allEmployees.filter(e => (e as any).dismissal_date?.startsWith(key)).length;
      const activeCount = allEmployees.filter(e => {
        const adm = e.admission_date;
        const dis = (e as any).dismissal_date;
        return adm <= key + '-31' && (!dis || dis > key + '-01');
      }).length;

      const rate = activeCount > 0 ? Math.round(((admissions + dismissals) / 2 / activeCount) * 100) : 0;
      months.push({ month: label, admissions, dismissals, rate });
    }
    return months;
  }, [allEmployees]);

  // ─── Headcount by Sector ─────────────────────────────────────
  const headcountBySector = useMemo(() => {
    const map: Record<string, number> = {};
    employees.forEach(e => { map[e.sector] = (map[e.sector] || 0) + 1; });
    return Object.entries(map)
      .map(([sector, count]) => ({ sector, count }))
      .sort((a, b) => b.count - a.count);
  }, [employees]);

  const headcountByContract = useMemo(() => {
    const labels: Record<string, string> = {
      clt: 'CLT', experiencia: 'Experiência', pj: 'PJ', estagio: 'Estágio', temporario: 'Temporário', determinado: 'Determinado',
    };
    const map: Record<string, number> = {};
    employees.forEach(e => { map[e.contract_type] = (map[e.contract_type] || 0) + 1; });
    return Object.entries(map).map(([k, v]) => ({ name: labels[k] || k, value: v }));
  }, [employees]);

  // ─── Tenure Distribution ──────────────────────────────────────
  const tenureData = useMemo(() => {
    const buckets = { '<3m': 0, '3-6m': 0, '6-12m': 0, '1-2a': 0, '2-5a': 0, '5+a': 0 };
    const now = new Date();
    employees.forEach(e => {
      const months = differenceInMonths(now, parseISO(e.admission_date));
      if (months < 3) buckets['<3m']++;
      else if (months < 6) buckets['3-6m']++;
      else if (months < 12) buckets['6-12m']++;
      else if (months < 24) buckets['1-2a']++;
      else if (months < 60) buckets['2-5a']++;
      else buckets['5+a']++;
    });
    return Object.entries(buckets).map(([range, count]) => ({ range, count }));
  }, [employees]);

  // ─── Geographic Distribution ──────────────────────────────────
  const geoData = useMemo(() => {
    const cityMap: Record<string, number> = {};
    const neighborhoodMap: Record<string, number> = {};
    employees.forEach(e => {
      if (e.city) cityMap[e.city] = (cityMap[e.city] || 0) + 1;
      if (e.neighborhood) neighborhoodMap[e.neighborhood] = (neighborhoodMap[e.neighborhood] || 0) + 1;
    });
    return {
      cities: Object.entries(cityMap).map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count),
      neighborhoods: Object.entries(neighborhoodMap).map(([n, count]) => ({ neighborhood: n, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    };
  }, [employees]);

  // ─── Absenteeism ──────────────────────────────────────────────
  const absenteeismData = useMemo(() => {
    const now = new Date();
    const months: { month: string; faltas: number; atestados: number; inss: number; total: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const m = subMonths(now, i);
      const key = format(m, 'yyyy-MM');
      const label = format(m, 'MMM/yy', { locale: ptBR });

      const monthAbs = absences.filter(a => a.entry_date?.startsWith(key));
      const faltas = monthAbs.filter(a => a.entry_type === 'falta').length;
      const atestados = monthAbs.filter(a => a.entry_type === 'atestado').length;
      const inss = monthAbs.filter(a => a.entry_type === 'inss').length;

      months.push({ month: label, faltas, atestados, inss, total: faltas + atestados + inss });
    }
    return months;
  }, [absences]);

  const absBySector = useMemo(() => {
    const empMap = new Map(allEmployees.map(e => [e.id, e.sector]));
    const sectorMap: Record<string, number> = {};
    absences.forEach(a => {
      const sector = empMap.get(a.employee_id) || 'Outro';
      sectorMap[sector] = (sectorMap[sector] || 0) + 1;
    });
    return Object.entries(sectorMap).map(([sector, count]) => ({ sector, count })).sort((a, b) => b.count - a.count);
  }, [absences, allEmployees]);

  // ─── Summary KPIs ─────────────────────────────────────────────
  const activeCount = employees.length;
  const dismissed = allEmployees.filter(e => e.status === 'dismissed').length;
  const avgTenure = employees.length > 0
    ? Math.round(employees.reduce((sum, e) => sum + differenceInMonths(new Date(), parseISO(e.admission_date)), 0) / employees.length)
    : 0;
  const totalAbsences = absences.length;

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  const VIEWS = [
    { id: 'turnover' as const,     label: 'Turnover',      icon: TrendingUp },
    { id: 'headcount' as const,    label: 'Headcount',     icon: Users },
    { id: 'salary' as const,       label: 'Tempo de Casa',  icon: Calendar },
    { id: 'geo' as const,          label: 'Geográfico',    icon: MapPin },
    { id: 'absenteeism' as const,  label: 'Absenteísmo',   icon: Activity },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">HR Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Indicadores e análises do quadro de pessoal</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard icon={Users} label="Ativos" value={activeCount} color="indigo" />
        <KPICard icon={UserMinus} label="Desligados (total)" value={dismissed} color="red" />
        <KPICard icon={Calendar} label="Tempo Médio" value={`${avgTenure}m`} color="blue" />
        <KPICard icon={Activity} label="Ausências (total)" value={totalAbsences} color="amber" />
      </div>

      {/* View Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl mb-5 overflow-x-auto">
        {VIEWS.map(v => {
          const Icon = v.icon;
          return (
            <button key={v.id} onClick={() => setActiveView(v.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                activeView === v.id
                  ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
              }`}>
              <Icon className="w-4 h-4" /> {v.label}
            </button>
          );
        })}
      </div>

      {/* ─── Turnover View ───────────────────────────────────── */}
      {activeView === 'turnover' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Admissões vs. Desligamentos (12 meses)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={turnoverData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="admissions" name="Admissões" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="dismissals" name="Desligamentos" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Taxa de Turnover (%)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={turnoverData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip />
                <Line type="monotone" dataKey="rate" name="Taxa %" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ─── Headcount View ──────────────────────────────────── */}
      {activeView === 'headcount' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Colaboradores por Setor</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={headcountBySector} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="sector" type="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="count" name="Colaboradores" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Por Tipo de Contrato</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={headcountByContract} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {headcountByContract.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ─── Tenure View ─────────────────────────────────────── */}
      {activeView === 'salary' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Distribuição por Tempo de Casa</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={tenureData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="range" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Colaboradores" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Geographic View ─────────────────────────────────── */}
      {activeView === 'geo' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Por Cidade</h3>
            {geoData.cities.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Dados de cidade não preenchidos</p>
            ) : (
              <div className="space-y-2">
                {geoData.cities.map(c => (
                  <div key={c.city} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                    <span className="text-sm text-gray-700 dark:text-gray-200">{c.city}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(c.count / activeCount) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{c.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Top 15 Bairros</h3>
            {geoData.neighborhoods.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Dados de bairro não preenchidos</p>
            ) : (
              <div className="space-y-2">
                {geoData.neighborhoods.map(n => (
                  <div key={n.neighborhood} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                    <span className="text-sm text-gray-700 dark:text-gray-200">{n.neighborhood}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(n.count / activeCount) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{n.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Absenteeism View ────────────────────────────────── */}
      {activeView === 'absenteeism' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Ausências por Mês (6 meses)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={absenteeismData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="faltas" name="Faltas" fill="#ef4444" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="atestados" name="Atestados" fill="#f97316" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="inss" name="INSS" fill="#6366f1" stackId="a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Ausências por Setor</h3>
            {absBySector.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nenhuma ausência registrada</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={absBySector} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="sector" type="category" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="count" name="Ausências" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KPICard({ icon: Icon, label, value, color }: {
  icon: React.ComponentType<any>; label: string; value: number | string; color: string;
}) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  };
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]} mb-2`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}
