import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { useTheme } from '../../context/ThemeContext';
import { 
  Calendar, ChevronDown, Users, DollarSign, Save, Loader2, BarChartHorizontal, Apple, Shirt, Sandwich, Info, AlertCircle, ChevronLeft, ChevronRight
} from 'lucide-react';
import { format, getYear, getMonth, startOfMonth, endOfYear, eachMonthOfInterval, startOfYear, setMonth, addYears, subYears } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
    getExpensesAndGuestsForYear, 
    saveMonthlyData
} from '../../lib/expensesReportService';
import type { MonthlyExpense, GuestCount } from '../../lib/expensesReportService';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, LabelProps } from 'recharts';

// --- Tipos e Constantes ---
type CategoryKey = 'HORTIFRUTI' | 'LAVANDERIA' | 'PADARIA';

interface MonthlyData {
  month: Date;
  guests: { first_fortnight: number; second_fortnight: number };
  expenses: { [key in CategoryKey]: { first_fortnight: number; second_fortnight: number } };
}

const CATEGORY_DETAILS: { [key in CategoryKey]: { name: string, color: string, icon: React.ElementType, lightStroke: string, darkStroke: string } } = {
  HORTIFRUTI: { name: "Hortifruti", color: "text-green-500", icon: Apple, lightStroke: "#22c55e", darkStroke: "#4ade80" },
  LAVANDERIA: { name: "Lavanderia", color: "text-blue-500", icon: Shirt, lightStroke: "#3b82f6", darkStroke: "#60a5fa" },
  PADARIA: { name: "Padaria", color: "text-yellow-500", icon: Sandwich, lightStroke: "#eab308", darkStroke: "#facc15" },
};

const initialExpenses = {
    HORTIFRUTI: { first_fortnight: 0, second_fortnight: 0 },
    LAVANDERIA: { first_fortnight: 0, second_fortnight: 0 },
    PADARIA: { first_fortnight: 0, second_fortnight: 0 },
};

// --- Componente do Gráfico (ExpensesChart) ---
const ExpensesChart = ({ chartData }: { chartData: any[] }) => {
    const { theme } = useTheme();

    return (
        <ResponsiveContainer width="100%" height={300}>
            <LineChart
                data={chartData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
                <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#4b5563' : '#e5e7eb'} strokeOpacity={0.5} />
                <XAxis 
                    dataKey="month" 
                    tickFormatter={(tick) => format(new Date(tick), 'MMM/yy', { locale: ptBR })} 
                    tick={{ fill: theme === 'dark' ? '#9ca3af' : '#6b7281' }} 
                    interval={0}
                />
                <YAxis 
                    tickFormatter={(tick) => `R$ ${tick.toFixed(2).replace('.', ',')}`}
                    domain={[0, (dataMax: number) => (dataMax * 1.25)]}
                    tick={{ fill: theme === 'dark' ? '#9ca3af' : '#6b7281' }}
                />
                <Tooltip
                    contentStyle={{
                        backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff',
                        borderColor: theme === 'dark' ? '#4b5563' : '#e5e7eb'
                    }}
                    formatter={(value: number) => value === null ? ['Sem dados', ''] : [`R$ ${value.toFixed(2).replace('.', ',')}`, 'Gasto por Hóspede']}
                    labelFormatter={(label) => format(new Date(label), 'MMMM yyyy', { locale: ptBR })}
                />
                <Legend />
                {Object.keys(CATEGORY_DETAILS).map(key => {
                    const catKey = key as CategoryKey;
                    const details = CATEGORY_DETAILS[catKey];
                    return (
                        <Line 
                            key={catKey}
                            type="monotone" 
                            dataKey={`results.${catKey}`} 
                            name={details.name} 
                            stroke={theme === 'dark' ? details.darkStroke : details.lightStroke} 
                            strokeWidth={2} 
                            dot={{ r: 5 }}
                            activeDot={{ r: 8 }}
                            connectNulls
                        />
                    )
                })}
            </LineChart>
        </ResponsiveContainer>
    );
};


// --- Componente Principal ---
const ExpensesGuestReport = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [currentYear, setCurrentYear] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [historicalData, setHistoricalData] = useState<MonthlyData[]>([]);
  const [selectedMonthData, setSelectedMonthData] = useState<MonthlyData | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);

  const fetchDataForYear = useCallback(async (yearDate: Date) => {
    if (!selectedHotel) return;
    setLoading(true);
    setError(null);
    const { guestData, expenseData, error: fetchError } = await getExpensesAndGuestsForYear(selectedHotel.id, yearDate);

    if (fetchError) {
      setError(fetchError.message);
      addNotification(`Erro ao carregar dados: ${fetchError.message}`, 'error');
      setLoading(false);
      return;
    }

    const yearMonths = eachMonthOfInterval({ start: startOfYear(yearDate), end: endOfYear(yearDate) });
    const guestMap = new Map(guestData?.map(g => [format(new Date(g.month_date + 'T12:00:00'), 'yyyy-MM'), g]));
    const expenseMap = new Map<string, MonthlyExpense[]>();
    expenseData?.forEach(e => {
        const key = format(new Date(e.month_date + 'T12:00:00'), 'yyyy-MM');
        if (!expenseMap.has(key)) expenseMap.set(key, []);
        expenseMap.get(key)!.push(e);
    });

    const formattedData: MonthlyData[] = yearMonths.map(monthDate => {
        const key = format(monthDate, 'yyyy-MM');
        const guestRecord = guestMap.get(key);
        const expenseRecords = expenseMap.get(key);
        const expenses: MonthlyData['expenses'] = JSON.parse(JSON.stringify(initialExpenses));
        expenseRecords?.forEach(rec => {
            const category = rec.expense_category as CategoryKey;
            if(category in expenses) {
                expenses[category] = {
                    first_fortnight: Number(rec.first_fortnight_expense),
                    second_fortnight: Number(rec.second_fortnight_expense),
                }
            }
        });
        return {
            month: monthDate,
            guests: {
                first_fortnight: Number(guestRecord?.first_fortnight_guests || 0),
                second_fortnight: Number(guestRecord?.second_fortnight_guests || 0),
            },
            expenses,
        }
    });
    setHistoricalData(formattedData);
    setLoading(false);
  }, [selectedHotel, addNotification]);

  useEffect(() => {
    fetchDataForYear(currentYear);
  }, [fetchDataForYear, currentYear]);

  useEffect(() => {
    const dataForMonth = historicalData.find(d => getMonth(d.month) === getMonth(currentMonth) && getYear(d.month) === getYear(currentMonth));
    setSelectedMonthData(dataForMonth || null);
  }, [currentMonth, historicalData]);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(event.target as Node)) {
        setIsMonthPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const chartData = useMemo(() => {
    const dataWithTotals = historicalData.map(data => {
        const totalGuests = Number(data.guests.first_fortnight) + Number(data.guests.second_fortnight);
        const totalHortifruti = Number(data.expenses.HORTIFRUTI.first_fortnight) + Number(data.expenses.HORTIFRUTI.second_fortnight);
        const totalLavanderia = Number(data.expenses.LAVANDERIA.first_fortnight) + Number(data.expenses.LAVANDERIA.second_fortnight);
        const totalPadaria = Number(data.expenses.PADARIA.first_fortnight) + Number(data.expenses.PADARIA.second_fortnight);
        
        const hasData = totalGuests > 0 || totalHortifruti > 0 || totalLavanderia > 0 || totalPadaria > 0;

        return { 
            month: data.month, 
            results: {
              HORTIFRUTI: hasData ? (totalGuests > 0 ? totalHortifruti / totalGuests : 0) : null,
              LAVANDERIA: hasData ? (totalGuests > 0 ? totalLavanderia / totalGuests : 0) : null,
              PADARIA: hasData ? (totalGuests > 0 ? totalPadaria / totalGuests : 0) : null,
            }
        };
    });
    return dataWithTotals;
  }, [historicalData]);
  
  const handleDataChange = (category: 'guests' | CategoryKey, fortnight: 'first' | 'second', value: string) => {
    if (!selectedMonthData) return;
    const numericValue = value === '' ? 0 : parseFloat(value);
    setSelectedMonthData(prev => {
        if(!prev) return null;
        const newData = JSON.parse(JSON.stringify(prev));
        if (category === 'guests') newData.guests[`${fortnight}_fortnight`] = numericValue;
        else newData.expenses[category][`${fortnight}_fortnight`] = numericValue;
        return newData;
    });
  };
  
  const handleSave = async () => {
    if (!selectedHotel || !selectedMonthData) return;
    setIsSaving(true);
    const { error: saveError } = await saveMonthlyData( selectedHotel.id, format(selectedMonthData.month, 'yyyy-MM-01'), { first_fortnight_guests: selectedMonthData.guests.first_fortnight, second_fortnight_guests: selectedMonthData.guests.second_fortnight }, Object.entries(selectedMonthData.expenses).map(([category, values]) => ({ expense_category: category, first_fortnight_expense: values.first_fortnight, second_fortnight_expense: values.second_fortnight })) );
    if (saveError) { addNotification(`Erro ao salvar dados: ${saveError.message}`, 'error'); } 
    else { 
        addNotification("Dados do mês salvos com sucesso!", 'success'); 
        setHistoricalData(prev => prev.map(d => 
            getMonth(d.month) === getMonth(selectedMonthData.month) && getYear(d.month) === getYear(selectedMonthData.month)
            ? selectedMonthData
            : d
        ));
    }
    setIsSaving(false);
  };
  
  const MonthlySummary = ({ data }: { data: MonthlyData }) => {
    const totalGuests = Number(data.guests.first_fortnight) + Number(data.guests.second_fortnight);
    const expenseTotals = useMemo(() => {
        let totals = {} as {[key in CategoryKey]: number};
        const categoryKeys: CategoryKey[] = ['HORTIFRUTI', 'LAVANDERIA', 'PADARIA'];
        categoryKeys.forEach(catKey => {
            totals[catKey] = Number(data.expenses[catKey].first_fortnight) + Number(data.expenses[catKey].second_fortnight);
        });
        return totals;
    }, [data.expenses]);

    return ( <div className="mt-6"> <h4 className="font-bold text-lg mb-3 text-gray-800 dark:text-gray-100">Resumo do Mês</h4> <div className="grid grid-cols-2 md:grid-cols-4 gap-4"> <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow text-center"> <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Hóspedes</p> <p className="text-2xl font-bold text-blue-500">{totalGuests}</p> </div> {Object.keys(expenseTotals).map(key => { const catKey = key as CategoryKey; const details = CATEGORY_DETAILS[catKey]; return ( <div key={catKey} className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow text-center"> <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total {details.name}</p> <p className={`text-2xl font-bold ${details.color}`}>{expenseTotals[catKey].toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</p> </div> ) })} </div> </div> )
  }

  if (loading) return <div className="text-center p-8"><Loader2 className="w-8 h-8 mx-auto text-gray-400 animate-spin" /></div>;
  if (error) return <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-300"><AlertCircle className="w-8 h-8 mx-auto mb-2" /><p>Erro ao carregar dados: {error}</p></div>;

  return ( <div className="space-y-8"> <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700"> <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-6 flex items-center gap-2"> <BarChartHorizontal className="w-6 h-6 text-indigo-500" /> Linha do Tempo: Gasto por Hóspede (R$) </h3> <ExpensesChart chartData={chartData} /> </div> <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700"> <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6"> <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2"> <Calendar className="w-6 h-6 text-indigo-500" /> Controle do Mês </h3> 
  
  <div className="relative" ref={monthPickerRef}>
    <button onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)} className="flex items-center justify-center space-x-2 bg-gray-100 dark:bg-gray-900/50 p-2 rounded-full w-48">
        <span className="font-semibold text-lg text-gray-800 dark:text-white">
            {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <ChevronDown className={`w-5 h-5 text-gray-600 dark:text-gray-300 transition-transform ${isMonthPickerOpen ? 'rotate-180' : ''}`} />
    </button>
    {isMonthPickerOpen && (
        <div className="absolute top-full mt-2 w-56 bg-white dark:bg-gray-700 rounded-lg shadow-xl border dark:border-gray-600 z-10 p-2">
            <div className="flex justify-between items-center mb-2">
                <button onClick={() => setCurrentYear(subYears(currentYear, 1))} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"><ChevronLeft className="w-4 h-4"/></button>
                <span className="font-semibold text-gray-800 dark:text-white">{getYear(currentYear)}</span>
                <button onClick={() => setCurrentYear(addYears(currentYear, 1))} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"><ChevronRight className="w-4 h-4"/></button>
            </div>
            <div className="grid grid-cols-3 gap-1">
                {eachMonthOfInterval({ start: startOfYear(currentYear), end: endOfYear(currentYear) }).map(month => (
                    <button 
                        key={month.toString()}
                        onClick={() => { setCurrentMonth(month); setIsMonthPickerOpen(false); }}
                        className={`p-2 text-sm rounded-md text-center ${getMonth(month) === getMonth(currentMonth) && getYear(month) === getYear(currentYear) ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200'}`}
                    >
                        {format(month, 'MMM', { locale: ptBR })}
                    </button>
                ))}
            </div>
        </div>
    )}
  </div>

  </div> {!selectedMonthData ? ( <div className="text-center py-10 text-gray-500 dark:text-gray-400"> <p>Selecione um mês para ver ou editar os dados.</p> </div> ) : ( <div className="space-y-6"> <div className="grid grid-cols-1 lg:grid-cols-3 gap-6"> <div className="lg:col-span-1 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border dark:border-gray-700"> <h4 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-800 dark:text-gray-100"> <Users className="w-6 h-6 text-blue-500"/> Hóspedes </h4> <div className="space-y-4"> <div> <label className="text-sm font-medium text-gray-600 dark:text-gray-300">1ª Quinzena</label> <input type="number" value={selectedMonthData.guests.first_fortnight} onChange={e => handleDataChange('guests', 'first', e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600" /> </div> <div> <label className="text-sm font-medium text-gray-600 dark:text-gray-300">2ª Quinzena</label> <input type="number" value={selectedMonthData.guests.second_fortnight} onChange={e => handleDataChange('guests', 'second', e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600" /> </div> </div> </div> <div className="lg:col-span-2 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border dark:border-gray-700"> <h4 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-800 dark:text-gray-100"> <DollarSign className="w-6 h-6 text-green-500"/> Despesas (R$) </h4> <div className="grid grid-cols-1 md:grid-cols-3 gap-4"> {Object.keys(CATEGORY_DETAILS).map(key => { const catKey = key as CategoryKey; const details = CATEGORY_DETAILS[catKey]; const Icon = details.icon; return ( <div key={catKey} className="space-y-2"> <label className={`font-semibold flex items-center gap-2 text-gray-700 dark:text-gray-200`}> <Icon className={`w-5 h-5 ${details.color}`}/> {details.name} </label> <input type="number" value={selectedMonthData.expenses[catKey].first_fortnight} onChange={e => handleDataChange(catKey, 'first', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600" placeholder="1ª Quinzena" /> <input type="number" value={selectedMonthData.expenses[catKey].second_fortnight} onChange={e => handleDataChange(catKey, 'second', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600" placeholder="2ª Quinzena" /> </div> ) })} </div> </div> </div> <MonthlySummary data={selectedMonthData} /> <div className="flex justify-end pt-4"> <button onClick={handleSave} disabled={isSaving} className="flex items-center justify-center px-6 py-3 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700"> {isSaving ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : <Save className="w-5 h-5 mr-2" />} Salvar Alterações do Mês </button> </div> </div> )} </div> </div> );
};

export default ExpensesGuestReport;
