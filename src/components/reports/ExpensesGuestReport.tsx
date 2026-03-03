// src/components/reports/ExpensesGuestReport.tsx
// Relatório flexível de Despesas por Hóspede.
// Suporta categorias e fornecedores dinâmicos por hotel.
// Gráfico scrollável com vista por Categoria ou por Fornecedor.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { useTheme } from '../../context/ThemeContext';
import {
  Calendar, ChevronDown, Users, Save, Loader2,
  BarChartHorizontal, AlertCircle, ChevronLeft, ChevronRight,
  Settings, LayoutList, Tag,
} from 'lucide-react';
import {
  format, getYear, getMonth, startOfMonth, endOfYear,
  eachMonthOfInterval, startOfYear, addYears, subYears,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  getCategoriesForHotel,
  getSuppliersForHotel,
  getGuestsForRange,
  getEntriesForRange,
  saveGuestCount,
  upsertEntriesBatch,
  type ExpenseCategory,
  type ExpenseSupplier,
  type SupplierEntry,
  type GuestCount,
} from '../../lib/expensesReportService';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import ExpensesSettings from './ExpensesSettings';

// ── Constantes ────────────────────────────────────────────────────────────────
const MONTH_WIDTH     = 96;
const CHART_HEIGHT    = 320;
const Y_AXIS_WIDTH    = 82;
const DATA_START_YEAR = 2024;

const SUPPLIER_COLORS = [
  '#6366f1','#f97316','#06b6d4','#ec4899','#14b8a6',
  '#8b5cf6','#f43f5e','#84cc16','#0ea5e9','#d97706',
];

type ChartView = 'category' | 'supplier';

// ── Gráfico Scrollável ────────────────────────────────────────────────────────
interface ChartLine { key: string; name: string; color: string; dashed?: boolean }
interface ChartProps { data: any[]; lines: ChartLine[]; theme: string }

const ScrollableChart: React.FC<ChartProps> = ({ data, lines, theme }) => {
  const scrollRef   = useRef<HTMLDivElement>(null);
  const isDragging  = useRef(false);
  const dragStartX  = useRef(0);
  const scrollStart = useRef(0);

  // Auto-scroll para o mês mais recente
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [data]);

  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current  = true;
    dragStartX.current  = e.clientX;
    scrollStart.current = scrollRef.current?.scrollLeft ?? 0;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grabbing';
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !scrollRef.current) return;
    e.preventDefault();
    scrollRef.current.scrollLeft = scrollStart.current + (dragStartX.current - e.clientX);
  };
  const onMouseUp = () => {
    isDragging.current = false;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
  };

  const chartWidth = Math.max(data.length * MONTH_WIDTH, 600);
  const gridColor  = theme === 'dark' ? '#4b5563' : '#e5e7eb';
  const tickColor  = theme === 'dark' ? '#9ca3af' : '#6b7281';

  return (
    <div className="relative">
      <div className="flex">

        {/* Eixo Y fixo à esquerda */}
        <div style={{ width: Y_AXIS_WIDTH, flexShrink: 0 }}>
          <ResponsiveContainer width={Y_AXIS_WIDTH} height={CHART_HEIGHT}>
            <LineChart data={data} margin={{ top: 20, right: 0, left: 8, bottom: 5 }}>
              <YAxis
                tickFormatter={v => `R$${v < 1000 ? v.toFixed(0) : (v / 1000).toFixed(1) + 'k'}`}
                domain={[0, (max: number) => Math.ceil(max * 1.3 || 10)]}
                tick={{ fill: tickColor, fontSize: 11 }}
                width={Y_AXIS_WIDTH - 4}
              />
              {lines.map(l => (
                <Line key={l.key} dataKey={l.key} stroke="transparent" dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Área scrollável — drag para navegar */}
        <div
          ref={scrollRef}
          className="overflow-x-auto flex-1 select-none"
          style={{ scrollBehavior: 'auto', cursor: 'grab' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <div style={{ width: chartWidth }}>
            <LineChart
              width={chartWidth}
              height={CHART_HEIGHT}
              data={data}
              margin={{ top: 20, right: 32, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.5} />
              <XAxis
                dataKey="month"
                tickFormatter={tick => format(new Date(tick), 'MMM/yy', { locale: ptBR })}
                tick={{ fill: tickColor, fontSize: 12 }}
                interval={0}
                tickLine={false}
              />
              <YAxis domain={[0, (max: number) => Math.ceil(max * 1.3 || 10)]} hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme === 'dark' ? '#1f2937' : '#fff',
                  borderColor:     theme === 'dark' ? '#4b5563' : '#e5e7eb',
                  borderRadius: 12, fontSize: 13,
                }}
                formatter={(v: number, name: string) =>
                  v == null ? ['Sem dados', name] : [`R$ ${v.toFixed(2).replace('.', ',')}`, name]
                }
                labelFormatter={label => format(new Date(label), 'MMMM yyyy', { locale: ptBR })}
              />
              <Legend wrapperStyle={{ paddingTop: 8 }} />
              {lines.map(l => (
                <Line
                  key={l.key}
                  type="monotone"
                  dataKey={l.key}
                  name={l.name}
                  stroke={l.color}
                  strokeWidth={2.5}
                  strokeDasharray={l.dashed ? '5 4' : undefined}
                  dot={{ r: 4, strokeWidth: 2 }}
                  activeDot={{ r: 7 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </div>
        </div>
      </div>

      {data.length > 8 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-right mt-1 pr-2 select-none pointer-events-none">
          clique e arraste para navegar ✦
        </p>
      )}
    </div>
  );
};

// ── Componente Principal ──────────────────────────────────────────────────────
const ExpensesGuestReport: React.FC = () => {
  const { selectedHotel }  = useHotel();
  const { addNotification } = useNotification();
  const { theme }           = useTheme();

  // Seleção de mês para lançamento
  const [currentMonth,      setCurrentMonth]      = useState(startOfMonth(new Date()));
  const [currentYear,       setCurrentYear]       = useState(new Date());
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);

  // Dados
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [suppliers,  setSuppliers]  = useState<ExpenseSupplier[]>([]);
  const [allEntries, setAllEntries] = useState<SupplierEntry[]>([]);
  const [allGuests,  setAllGuests]  = useState<GuestCount[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // UI
  const [chartView,    setChartView]    = useState<ChartView>('category');
  const [showSettings, setShowSettings] = useState(false);

  // Formulário do mês
  const [formGuests,  setFormGuests]  = useState({ first: 0, second: 0 });
  const [formEntries, setFormEntries] = useState<Record<string, { first: number; second: number }>>({});

  // ── Fechar picker ao clicar fora ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node))
        setIsMonthPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Carregar meta (categorias + fornecedores) ─────────────────────────────
  const loadMeta = useCallback(async () => {
    if (!selectedHotel?.id) return;
    const [catRes, suppRes] = await Promise.all([
      getCategoriesForHotel(selectedHotel.id),
      getSuppliersForHotel(selectedHotel.id),
    ]);
    if (catRes.error)  { addNotification('Erro ao carregar categorias.', 'error'); return; }
    if (suppRes.error) { addNotification('Erro ao carregar fornecedores.', 'error'); return; }
    setCategories(catRes.data  || []);
    setSuppliers(suppRes.data  || []);
  }, [selectedHotel, addNotification]);

  // ── Carregar séries históricas (todos os anos desde DATA_START_YEAR) ──────
  const loadSeries = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true);
    setError(null);
    const nowYear = getYear(new Date());
    const gAcc: GuestCount[]    = [];
    const eAcc: SupplierEntry[] = [];

    for (let y = DATA_START_YEAR; y <= nowYear; y++) {
      const start = `${y}-01-01`;
      const end   = `${y}-12-01`;
      const [gRes, eRes] = await Promise.all([
        getGuestsForRange(selectedHotel.id, start, end),
        getEntriesForRange(selectedHotel.id, start, end),
      ]);
      if (gRes.error || eRes.error) { setError('Erro ao carregar histórico.'); setLoading(false); return; }
      gAcc.push(...(gRes.data || []));
      eAcc.push(...(eRes.data || []));
    }
    setAllGuests(gAcc);
    setAllEntries(eAcc);
    setLoading(false);
  }, [selectedHotel]);

  useEffect(() => { loadMeta(); loadSeries(); }, [loadMeta, loadSeries]);

  // ── Sincronizar formulário ao mudar de mês ────────────────────────────────
  useEffect(() => {
    const key = format(currentMonth, 'yyyy-MM');
    const gc  = allGuests.find(g => g.month_date.slice(0, 7) === key);
    setFormGuests({
      first:  gc?.first_fortnight_guests  ?? 0,
      second: gc?.second_fortnight_guests ?? 0,
    });
    const init: Record<string, { first: number; second: number }> = {};
    suppliers.forEach(s => {
      const entry = allEntries.find(e => e.supplier_id === s.id && e.month_date.slice(0, 7) === key);
      init[s.id] = { first: entry?.first_fortnight_value ?? 0, second: entry?.second_fortnight_value ?? 0 };
    });
    setFormEntries(init);
  }, [currentMonth, allGuests, allEntries, suppliers]);

  // ── Salvar mês ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selectedHotel?.id) return;
    setSaving(true);
    const monthStr = format(currentMonth, 'yyyy-MM-01');

    const { error: gErr } = await saveGuestCount(
      selectedHotel.id, monthStr, formGuests.first, formGuests.second,
    );

    const entries: SupplierEntry[] = suppliers.map(s => ({
      supplier_id:             s.id,
      hotel_id:                selectedHotel.id,
      month_date:              monthStr,
      first_fortnight_value:   formEntries[s.id]?.first  ?? 0,
      second_fortnight_value:  formEntries[s.id]?.second ?? 0,
    }));
    const { error: eErr } = await upsertEntriesBatch(entries);

    if (gErr || eErr) {
      addNotification('Erro ao salvar dados.', 'error');
    } else {
      addNotification('Dados salvos com sucesso!', 'success');
      await loadSeries();
    }
    setSaving(false);
  };

  // ── Dados do gráfico ──────────────────────────────────────────────────────
  const allMonths = useMemo(() => eachMonthOfInterval({
    start: new Date(DATA_START_YEAR, 0, 1),
    end:   endOfYear(new Date()),
  }), []);

  const guestTotals = useMemo(() => {
    const m = new Map<string, number>();
    allGuests.forEach(g => {
      m.set(g.month_date.slice(0, 7),
        (g.first_fortnight_guests ?? 0) + (g.second_fortnight_guests ?? 0));
    });
    return m;
  }, [allGuests]);

  const isVisibleOn = (hiddenFrom: string | null, monthDate: Date) =>
    !hiddenFrom || monthDate < new Date(hiddenFrom + 'T12:00:00');

  const chartData = useMemo(() => allMonths.map(m => {
    const key    = format(m, 'yyyy-MM');
    const guests = guestTotals.get(key) ?? 0;
    const point: Record<string, any> = { month: m.toISOString() };

    if (chartView === 'category') {
      categories.forEach(cat => {
        const catSups  = suppliers.filter(s => s.category_id === cat.id && isVisibleOn(s.hidden_from, m));
        const catTotal = catSups.reduce((acc, s) => {
          const e = allEntries.find(e => e.supplier_id === s.id && e.month_date.slice(0, 7) === key);
          return acc + ((e?.first_fortnight_value ?? 0) + (e?.second_fortnight_value ?? 0));
        }, 0);
        point[`cat_${cat.id}`] = guests > 0 && catTotal > 0
          ? parseFloat((catTotal / guests).toFixed(4)) : null;
      });
    } else {
      suppliers.forEach(s => {
        const e     = allEntries.find(e => e.supplier_id === s.id && e.month_date.slice(0, 7) === key);
        const total = (e?.first_fortnight_value ?? 0) + (e?.second_fortnight_value ?? 0);
        point[`sup_${s.id}`] = guests > 0 && total > 0
          ? parseFloat((total / guests).toFixed(4)) : null;
      });
    }
    return point;
  }), [allMonths, guestTotals, categories, suppliers, allEntries, chartView]);

  const chartLines: ChartLine[] = useMemo(() => {
    if (chartView === 'category') {
      return categories.map(c => ({ key: `cat_${c.id}`, name: c.name, color: c.color_hex }));
    }
    return suppliers.map((s, i) => {
      const cat = categories.find(c => c.id === s.category_id);
      return {
        key:    `sup_${s.id}`,
        name:   `${cat?.name ?? ''} · ${s.name}`,
        color:  cat?.color_hex ?? SUPPLIER_COLORS[i % SUPPLIER_COLORS.length],
        dashed: !!s.hidden_from,
      };
    });
  }, [chartView, categories, suppliers]);

  // ── Categorias e fornecedores visíveis no mês selecionado ────────────────
  const visibleCategories = useMemo(() =>
    categories.filter(c => isVisibleOn(c.hidden_from ?? null, currentMonth)),
  [categories, currentMonth]);

  const visibleSuppliersFor = (catId: string) =>
    suppliers.filter(s => s.category_id === catId && isVisibleOn(s.hidden_from, currentMonth));

  // ── Estados de loading / error ────────────────────────────────────────────
  if (loading) return (
    <div className="flex justify-center py-16">
      <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
    </div>
  );
  if (error) return (
    <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-xl text-red-600 dark:text-red-300">
      <AlertCircle className="w-8 h-8 mx-auto mb-2" /><p>{error}</p>
    </div>
  );

  // ── Render principal ──────────────────────────────────────────────────────
  return (
    <div className="space-y-8">

      {/* ════════════════════════════════════════════════════════════════════
          BLOCO 1 — Gráfico de Linha do Tempo
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <BarChartHorizontal className="w-6 h-6 text-indigo-500" />
            Linha do Tempo: Gasto por Hóspede (R$)
          </h3>

          {/* Toggle Por Categoria / Por Fornecedor */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl">
            <button
              onClick={() => setChartView('category')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                chartView === 'category'
                  ? 'bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-300 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <Tag className="w-3.5 h-3.5" /> Por Categoria
            </button>
            <button
              onClick={() => setChartView('supplier')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                chartView === 'supplier'
                  ? 'bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-300 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" /> Por Fornecedor
            </button>
          </div>
        </div>

        {chartLines.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
            <BarChartHorizontal className="w-10 h-10 opacity-30" />
            <p className="text-sm">Configure categorias e fornecedores para ver o gráfico.</p>
            <button onClick={() => setShowSettings(true)} className="text-xs text-indigo-500 hover:underline mt-1">
              Abrir configurações →
            </button>
          </div>
        ) : (
          <ScrollableChart data={chartData} lines={chartLines} theme={theme} />
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          BLOCO 2 — Controle do Mês (lançamento)
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">

        {/* Header com seletor de mês e botão de configurações */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Calendar className="w-6 h-6 text-indigo-500" />
            Controle do Mês
          </h3>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Configurar</span>
            </button>

            {/* Month picker */}
            <div className="relative" ref={monthPickerRef}>
              <button
                onClick={() => setIsMonthPickerOpen(v => !v)}
                className="flex items-center gap-2 bg-gray-100 dark:bg-gray-900/50 px-4 py-2 rounded-xl"
              >
                <span className="font-semibold text-sm text-gray-800 dark:text-white capitalize">
                  {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isMonthPickerOpen ? 'rotate-180' : ''}`} />
              </button>

              {isMonthPickerOpen && (
                <div className="absolute top-full mt-2 right-0 w-56 bg-white dark:bg-gray-700 rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 z-20 p-2">
                  <div className="flex justify-between items-center mb-2">
                    <button onClick={() => setCurrentYear(subYears(currentYear, 1))}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-semibold text-sm text-gray-800 dark:text-white">
                      {getYear(currentYear)}
                    </span>
                    <button onClick={() => setCurrentYear(addYears(currentYear, 1))}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {eachMonthOfInterval({ start: startOfYear(currentYear), end: endOfYear(currentYear) }).map(m => (
                      <button key={m.toString()}
                        onClick={() => { setCurrentMonth(m); setIsMonthPickerOpen(false); }}
                        className={`p-2 text-xs rounded-lg text-center capitalize transition-colors ${
                          getMonth(m) === getMonth(currentMonth) && getYear(m) === getYear(currentYear)
                            ? 'bg-indigo-600 text-white font-bold'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200'
                        }`}
                      >
                        {format(m, 'MMM', { locale: ptBR })}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Grid de lançamento ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">

          {/* Hóspedes */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4">
            <h4 className="font-bold text-blue-700 dark:text-blue-300 flex items-center gap-2 mb-3 text-sm">
              <Users className="w-4 h-4" /> Hóspedes
            </h4>
            <div className="space-y-2">
              {([['first', '1ª Quinzena'], ['second', '2ª Quinzena']] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-blue-600 dark:text-blue-300 font-medium">{label}</label>
                  <input
                    type="number" min={0}
                    value={formGuests[key] || ''}
                    onChange={e => setFormGuests(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))}
                    className="mt-0.5 w-full px-3 py-2 text-sm rounded-xl border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-400 outline-none"
                    placeholder="0"
                  />
                </div>
              ))}
              <div className="pt-1 text-xs text-blue-500 font-bold text-right">
                Total: {formGuests.first + formGuests.second}
              </div>
            </div>
          </div>

          {/* Categorias + Fornecedores */}
          <div className="lg:col-span-3">
            {visibleCategories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl text-gray-400">
                <Settings className="w-8 h-8 opacity-30" />
                <p className="text-sm">Nenhuma categoria ativa.</p>
                <button onClick={() => setShowSettings(true)} className="text-xs text-indigo-500 hover:underline">
                  Configurar categorias e fornecedores →
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {visibleCategories.map(cat => {
                  const catSuppliers = visibleSuppliersFor(cat.id);
                  const catTotal = catSuppliers.reduce(
                    (acc, s) => acc + (formEntries[s.id]?.first ?? 0) + (formEntries[s.id]?.second ?? 0), 0
                  );

                  return (
                    <div key={cat.id}
                      className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-700 p-4"
                    >
                      {/* Cabeçalho da categoria */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color_hex }} />
                          <h4 className="font-bold text-sm text-gray-700 dark:text-gray-200">{cat.name}</h4>
                        </div>
                        {catSuppliers.length > 0 && (
                          <span className="text-xs px-2.5 py-1 rounded-full font-bold text-white"
                            style={{ backgroundColor: cat.color_hex }}>
                            {catTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        )}
                      </div>

                      {/* Fornecedores */}
                      {catSuppliers.length === 0 ? (
                        <p className="text-xs text-gray-400 italic pl-5">
                          Sem fornecedores ativos.{' '}
                          <button onClick={() => setShowSettings(true)} className="text-indigo-500 hover:underline">
                            Configurar →
                          </button>
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                          {catSuppliers.map(s => {
                            const suppTotal = (formEntries[s.id]?.first ?? 0) + (formEntries[s.id]?.second ?? 0);
                            return (
                              <div key={s.id}
                                className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-600"
                              >
                                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 truncate" title={s.name}>
                                  {s.name}
                                </p>
                                <div className="space-y-1.5">
                                  {([['first', '1ª Quinzena'], ['second', '2ª Quinzena']] as const).map(([key, label]) => (
                                    <div key={key} className="flex items-center gap-2">
                                      <span className="text-xs text-gray-400 w-20 flex-shrink-0">{label}</span>
                                      <input
                                        type="number" min={0} step="0.01"
                                        value={formEntries[s.id]?.[key] || ''}
                                        onChange={e => setFormEntries(prev => ({
                                          ...prev,
                                          [s.id]: {
                                            ...(prev[s.id] ?? { first: 0, second: 0 }),
                                            [key]: parseFloat(e.target.value) || 0,
                                          },
                                        }))}
                                        className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-400 outline-none"
                                        placeholder="0,00"
                                      />
                                    </div>
                                  ))}
                                  <div className="text-right text-xs font-bold pt-1" style={{ color: cat.color_hex }}>
                                    {suppTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Botão Salvar */}
        <div className="flex justify-end pt-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 transition-all shadow-sm active:scale-95">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Salvar {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
          </button>
        </div>
      </div>

      {/* Modal de configurações */}
      <ExpensesSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onChanged={() => { loadMeta(); loadSeries(); }}
      />
    </div>
  );
};

export default ExpensesGuestReport;