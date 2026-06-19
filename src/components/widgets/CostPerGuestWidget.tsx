import React, { useEffect, useState, useMemo, useRef } from 'react';
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
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  format, startOfMonth, endOfYear, eachMonthOfInterval, getYear,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

const DATA_START_YEAR = 2024;
const MONTH_WIDTH = 88;
const CHART_HEIGHT = 280;
const Y_AXIS_WIDTH = 72;

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
      const nowYear = getYear(new Date());
      const [catRes, suppRes] = await Promise.all([
        getCategoriesForHotel(selectedHotel.id),
        getSuppliersForHotel(selectedHotel.id),
      ]);
      if (cancelled) return;
      setCategories(catRes.data || []);
      setSuppliers(suppRes.data || []);

      const gAcc: GuestCount[] = [];
      const eAcc: SupplierEntry[] = [];
      for (let y = DATA_START_YEAR; y <= nowYear; y++) {
        const start = `${y}-01-01`;
        const end = `${y}-12-01`;
        const [gRes, eRes] = await Promise.all([
          getGuestsForRange(selectedHotel.id, start, end),
          getEntriesForRange(selectedHotel.id, start, end),
        ]);
        if (cancelled) return;
        gAcc.push(...(gRes.data || []));
        eAcc.push(...(eRes.data || []));
      }
      setAllGuests(gAcc);
      setAllEntries(eAcc);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [selectedHotel?.id]);

  const allMonths = useMemo(() => eachMonthOfInterval({
    start: new Date(DATA_START_YEAR, 0, 1),
    end: endOfYear(new Date()),
  }), []);

  const guestTotals = useMemo(() => {
    const m = new Map<string, number>();
    allGuests.forEach(g => {
      m.set(g.month_date.slice(0, 7),
        (g.first_fortnight_guests ?? 0) + (g.second_fortnight_guests ?? 0));
    });
    return m;
  }, [allGuests]);

  const { chartData, chartLines } = useMemo(() => {
    const data = allMonths.map(m => {
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
          ? parseFloat((catTotal / guests).toFixed(4)) : null;
      });
      return point;
    });

    const lines = categories.map(c => ({
      key: `cat_${c.id}`,
      name: c.name,
      color: c.color_hex,
    }));

    return { chartData: data, chartLines: lines };
  }, [allMonths, categories, suppliers, allEntries, guestTotals]);

  const gridColor = theme === 'dark' ? '#374151' : '#e5e7eb';
  const tickColor = theme === 'dark' ? '#9ca3af' : '#6b7280';

  // Scrollable chart drag logic
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const scrollStart = useRef(0);

  useEffect(() => {
    if (scrollRef.current && !loading) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [chartData, loading]);

  const onPointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    scrollStart.current = scrollRef.current?.scrollLeft ?? 0;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grabbing';
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || !scrollRef.current) return;
    e.preventDefault();
    scrollRef.current.scrollLeft = scrollStart.current + (dragStartX.current - e.clientX);
  };
  const onPointerUp = () => {
    isDragging.current = false;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
  };

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

  const chartWidth = Math.max(chartData.length * MONTH_WIDTH, 600);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
            <TrendingDown className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white text-sm leading-tight">Gasto / Hóspede</h3>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Linha do Tempo por Categoria</p>
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
        <div className="flex-1 min-h-0">
          <div className="flex" style={{ height: CHART_HEIGHT }}>
            {/* Fixed Y axis */}
            <div style={{ width: Y_AXIS_WIDTH, flexShrink: 0 }}>
              <ResponsiveContainer width={Y_AXIS_WIDTH} height={CHART_HEIGHT}>
                <LineChart data={chartData} margin={{ top: 10, right: 0, left: 4, bottom: 24 }}>
                  <YAxis
                    tickFormatter={v => `R$${v < 1000 ? v.toFixed(0) : (v / 1000).toFixed(1) + 'k'}`}
                    domain={[0, (max: number) => Math.ceil(max * 1.3 || 10)]}
                    tick={{ fill: tickColor, fontSize: 10 }}
                    width={Y_AXIS_WIDTH - 4}
                    axisLine={false}
                    tickLine={false}
                  />
                  {chartLines.map(l => (
                    <Line key={l.key} dataKey={l.key} stroke="transparent" dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Scrollable chart area */}
            <div
              ref={scrollRef}
              className="overflow-x-auto flex-1 select-none touch-pan-x"
              style={{ scrollBehavior: 'auto', cursor: 'grab' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div style={{ width: chartWidth }}>
                <LineChart
                  width={chartWidth}
                  height={CHART_HEIGHT}
                  data={chartData}
                  margin={{ top: 10, right: 24, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.5} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={t => format(new Date(t), 'MMM/yy', { locale: ptBR })}
                    tick={{ fill: tickColor, fontSize: 10 }}
                    interval={0}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis domain={[0, (max: number) => Math.ceil(max * 1.3 || 10)]} hide />
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
                  <Legend wrapperStyle={{ paddingTop: 4, fontSize: 11 }} />
                  {chartLines.map(l => (
                    <Line
                      key={l.key}
                      type="monotone"
                      dataKey={l.key}
                      name={l.name}
                      stroke={l.color}
                      strokeWidth={2.5}
                      dot={{ r: 3, strokeWidth: 2 }}
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </div>
            </div>
          </div>

          {chartData.length > 8 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-right mt-1 pr-1 select-none pointer-events-none">
              arraste para navegar ✦
            </p>
          )}
        </div>
      )}
    </div>
  );
}
