import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DollarSign, Loader2, ExternalLink, TrendingDown } from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useTheme } from '../../context/ThemeContext';
import {
  getCategoriesForHotel,
  getSuppliersForHotel,
  getGuestsForRange,
  getEntriesForRange,
  type ExpenseCategory,
  type ExpenseSupplier,
  type SupplierEntry,
  type GuestCount,
} from '../../lib/expensesReportService';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, subMonths, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const MONTHS_BACK = 8;

export default function CostPerGuestWidget() {
  const { selectedHotel } = useHotel();
  const { theme } = useTheme();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [suppliers, setSuppliers] = useState<ExpenseSupplier[]>([]);
  const [allEntries, setAllEntries] = useState<SupplierEntry[]>([]);
  const [allGuests, setAllGuests] = useState<GuestCount[]>([]);

  useEffect(() => {
    if (!selectedHotel?.id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const now = new Date();
      const from = startOfMonth(subMonths(now, MONTHS_BACK));
      const start = format(from, 'yyyy-MM-dd');
      const end = format(now, 'yyyy-MM-dd');

      const [catRes, suppRes, gRes, eRes] = await Promise.all([
        getCategoriesForHotel(selectedHotel.id),
        getSuppliersForHotel(selectedHotel.id),
        getGuestsForRange(selectedHotel.id, start, end),
        getEntriesForRange(selectedHotel.id, start, end),
      ]);

      if (cancelled) return;
      setCategories(catRes.data || []);
      setSuppliers(suppRes.data || []);
      setAllGuests(gRes.data || []);
      setAllEntries(eRes.data || []);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [selectedHotel?.id]);

  const guestTotals = useMemo(() => {
    const m = new Map<string, number>();
    allGuests.forEach(g => {
      m.set(g.month_date.slice(0, 7),
        (g.first_fortnight_guests ?? 0) + (g.second_fortnight_guests ?? 0));
    });
    return m;
  }, [allGuests]);

  const { chartData, chartLines } = useMemo(() => {
    const now = new Date();
    const months: Date[] = [];
    for (let i = MONTHS_BACK; i >= 0; i--) months.push(startOfMonth(subMonths(now, i)));

    const data = months.map(m => {
      const key = format(m, 'yyyy-MM');
      const guests = guestTotals.get(key) ?? 0;
      const point: Record<string, any> = { month: m.toISOString() };

      categories.forEach(cat => {
        const catSups = suppliers.filter(s => s.category_id === cat.id);
        const catTotal = catSups.reduce((acc, s) => {
          const e = allEntries.find(e => e.supplier_id === s.id && e.month_date.slice(0, 7) === key);
          return acc + ((e?.first_fortnight_value ?? 0) + (e?.second_fortnight_value ?? 0));
        }, 0);
        point[`cat_${cat.id}`] = guests > 0 && catTotal > 0
          ? parseFloat((catTotal / guests).toFixed(2)) : null;
      });

      return point;
    });

    const lines = categories.map(c => ({
      key: `cat_${c.id}`,
      name: c.name,
      color: c.color_hex,
    }));

    return { chartData: data, chartLines: lines };
  }, [categories, suppliers, allEntries, guestTotals]);

  const gridColor = theme === 'dark' ? '#374151' : '#e5e7eb';
  const tickColor = theme === 'dark' ? '#9ca3af' : '#6b7280';

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 flex items-center justify-center h-full min-h-[220px]">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  const hasData = chartLines.length > 0 && chartData.some(d =>
    chartLines.some(l => d[l.key] != null)
  );

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
            <TrendingDown className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white text-sm leading-tight">Gasto / Hóspede</h3>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Por Categoria</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/reports')}
          title="Ver relatório completo"
          className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5 text-slate-400 hover:text-indigo-500" />
        </button>
      </div>

      {!hasData ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2 py-6">
          <DollarSign className="w-8 h-8 opacity-20" />
          <p className="text-xs text-center">Configure categorias em Relatórios para ver o gráfico.</p>
          <button onClick={() => navigate('/reports')} className="text-xs text-indigo-500 hover:underline">
            Abrir Relatórios →
          </button>
        </div>
      ) : (
        <div className="flex-1 min-h-0" style={{ minHeight: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.5} />
              <XAxis
                dataKey="month"
                tickFormatter={t => format(new Date(t), 'MMM', { locale: ptBR })}
                tick={{ fill: tickColor, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis
                tickFormatter={v => `R$${v < 1000 ? v.toFixed(0) : (v / 1000).toFixed(1) + 'k'}`}
                tick={{ fill: tickColor, fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme === 'dark' ? '#1f2937' : '#fff',
                  borderColor: theme === 'dark' ? '#4b5563' : '#e5e7eb',
                  borderRadius: 12, fontSize: 11,
                }}
                formatter={(v: number, name: string) =>
                  v == null ? ['—', name] : [`R$ ${v.toFixed(2).replace('.', ',')}`, name]
                }
                labelFormatter={label => format(new Date(label), 'MMMM yyyy', { locale: ptBR })}
              />
              {chartLines.map(l => (
                <Line
                  key={l.key}
                  type="monotone"
                  dataKey={l.key}
                  name={l.name}
                  stroke={l.color}
                  strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 1.5 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
