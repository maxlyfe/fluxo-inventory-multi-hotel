import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { 
  Calendar, ChevronLeft, ChevronRight, Users, DollarSign, Save, Loader2, BarChartHorizontal, Apple, Shirt, Sandwich, Info, AlertCircle
} from 'lucide-react';
import { format, addMonths, subMonths, getYear, getMonth, startOfMonth, endOfYear, eachMonthOfInterval, startOfYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
    getExpensesAndGuestsForYear, 
    saveMonthlyData
} from '../../lib/expensesReportService';
import type { MonthlyExpense, GuestCount } from '../../lib/expensesReportService';
import ExpensesChart from './ExpensesChart';

// --- Tipos e Constantes ---
type CategoryKey = 'HORTIFRUTI' | 'LAVANDERIA' | 'PADARIA';

interface MonthlyData {
  month: Date;
  guests: { first_fortnight: number; second_fortnight: number };
  expenses: { [key in CategoryKey]: { first_fortnight: number; second_fortnight: number } };
}

const CATEGORY_DETAILS: { [key in CategoryKey]: { name: string, color: string, icon: React.ElementType } } = {
  HORTIFRUTI: { name: "Hortifruti", color: "text-green-500", icon: Apple },
  LAVANDERIA: { name: "Lavanderia", color: "text-blue-500", icon: Shirt },
  PADARIA: { name: "Padaria", color: "text-yellow-500", icon: Sandwich },
};

const initialExpenses = {
    HORTIFRUTI: { first_fortnight: 0, second_fortnight: 0 },
    LAVANDERIA: { first_fortnight: 0, second_fortnight: 0 },
    PADARIA: { first_fortnight: 0, second_fortnight: 0 },
};

// --- Componente Principal ---
const ExpensesGuestReport = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [historicalData, setHistoricalData] = useState<MonthlyData[]>([]);
  const [selectedMonthData, setSelectedMonthData] = useState<MonthlyData | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    setError(null);
    const year = getYear(currentMonth);
    const { guestData, expenseData, error: fetchError } = await getExpensesAndGuestsForYear(selectedHotel.id, new Date(year, 0, 1));

    if (fetchError) {
      setError(fetchError.message);
      addNotification(`Erro ao carregar dados: ${fetchError.message}`, 'error');
      setLoading(false);
      return;
    }

    const yearMonths = eachMonthOfInterval({ start: startOfYear(currentMonth), end: endOfYear(currentMonth) });
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
  }, [selectedHotel, currentMonth, addNotification]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const dataForMonth = historicalData.find(d => getMonth(d.month) === getMonth(currentMonth) && getYear(d.month) === getYear(currentMonth));
    setSelectedMonthData(dataForMonth || null);
  }, [currentMonth, historicalData]);

  const chartData = useMemo(() => {
    return historicalData
      .map(data => {
        const totalGuests = Number(data.guests.first_fortnight) + Number(data.guests.second_fortnight);
        const results = {
          HORTIFRUTI: totalGuests > 0 ? (Number(data.expenses.HORTIFRUTI.first_fortnight) + Number(data.expenses.HORTIFRUTI.second_fortnight)) / totalGuests : 0,
          LAVANDERIA: totalGuests > 0 ? (Number(data.expenses.LAVANDERIA.first_fortnight) + Number(data.expenses.LAVANDERIA.second_fortnight)) / totalGuests : 0,
          PADARIA: totalGuests > 0 ? (Number(data.expenses.PADARIA.first_fortnight) + Number(data.expenses.PADARIA.second_fortnight)) / totalGuests : 0,
        };
        return { month: data.month, results, totalGuests };
      })
      // A linha .filter() foi removida daqui para sempre passar os 12 meses para o gráfico
  }, [historicalData]);

  const maxExpensePerGuest = useMemo(() => { if (chartData.length === 0) return 1; const allValues = chartData.flatMap(d => Object.values(d.results)); return Math.max(...allValues, 1); }, [chartData]);
  
  const handleMonthChange = (direction: 'prev' | 'next') => { setCurrentMonth(prev => direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1)); };
  
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
    else { addNotification("Dados do mês salvos com sucesso!", 'success'); await fetchData(); }
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

  return ( <div className="space-y-8"> <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700"> <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-6 flex items-center gap-2"> <BarChartHorizontal className="w-6 h-6 text-indigo-500" /> Linha do Tempo: Gasto por Hóspede (R$) </h3> <ExpensesChart chartData={chartData} maxExpensePerGuest={maxExpensePerGuest} /> </div> <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700"> <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6"> <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2"> <Calendar className="w-6 h-6 text-indigo-500" /> Controle do Mês </h3> <div className="flex items-center justify-center space-x-2 bg-gray-100 dark:bg-gray-900/50 p-2 rounded-full"> <button onClick={() => handleMonthChange('prev')} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"> <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" /> </button> <div className="text-center font-semibold text-lg text-gray-800 dark:text-white w-40"> {format(currentMonth, 'MMMM yyyy', { locale: ptBR })} </div> <button onClick={() => handleMonthChange('next')} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"> <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-300" /> </button> </div> </div> {!selectedMonthData ? ( <div className="text-center py-10 text-gray-500 dark:text-gray-400"> <p>Carregando dados do mês...</p> </div> ) : ( <div className="space-y-6"> <div className="grid grid-cols-1 lg:grid-cols-3 gap-6"> <div className="lg:col-span-1 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border dark:border-gray-700"> <h4 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-800 dark:text-gray-100"> <Users className="w-6 h-6 text-blue-500"/> Hóspedes </h4> <div className="space-y-4"> <div> <label className="text-sm font-medium text-gray-600 dark:text-gray-300">1ª Quinzena</label> <input type="number" value={selectedMonthData.guests.first_fortnight} onChange={e => handleDataChange('guests', 'first', e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600" /> </div> <div> <label className="text-sm font-medium text-gray-600 dark:text-gray-300">2ª Quinzena</label> <input type="number" value={selectedMonthData.guests.second_fortnight} onChange={e => handleDataChange('guests', 'second', e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600" /> </div> </div> </div> <div className="lg:col-span-2 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border dark:border-gray-700"> <h4 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-800 dark:text-gray-100"> <DollarSign className="w-6 h-6 text-green-500"/> Despesas (R$) </h4> <div className="grid grid-cols-1 md:grid-cols-3 gap-4"> {Object.keys(CATEGORY_DETAILS).map(key => { const catKey = key as CategoryKey; const details = CATEGORY_DETAILS[catKey]; const Icon = details.icon; return ( <div key={catKey} className="space-y-2"> <label className={`font-semibold flex items-center gap-2 text-gray-700 dark:text-gray-200`}> <Icon className={`w-5 h-5 ${details.color}`}/> {details.name} </label> <input type="number" value={selectedMonthData.expenses[catKey].first_fortnight} onChange={e => handleDataChange(catKey, 'first', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600" placeholder="1ª Quinzena" /> <input type="number" value={selectedMonthData.expenses[catKey].second_fortnight} onChange={e => handleDataChange(catKey, 'second', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600" placeholder="2ª Quinzena" /> </div> ) })} </div> </div> </div> <MonthlySummary data={selectedMonthData} /> <div className="flex justify-end pt-4"> <button onClick={handleSave} disabled={isSaving} className="flex items-center justify-center px-6 py-3 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700"> {isSaving ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : <Save className="w-5 h-5 mr-2" />} Salvar Alterações do Mês </button> </div> </div> )} </div> </div> );
};

export default ExpensesGuestReport;