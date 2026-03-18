import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { 
  Calendar, ChevronLeft, ChevronRight, Droplets, Zap, 
  PlusCircle, Edit, Trash2, Loader2, AlertCircle, Truck, BarChart2, TrendingUp, Info
} from 'lucide-react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, differenceInWeeks, getYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import WaterTruckLogModal from './WaterTruckLogModal';
import {
  UtilityReading,
  WaterTruckEntry,
  getUtilityReadingsForYear,
  getWaterTruckEntriesForYear,
  addUtilityReading,
  updateUtilityReading,
  deleteUtilityReading,
} from '../../lib/utilitiesReportService';

const formInitialState = {
  id: '',
  reading_date: format(new Date(), 'yyyy-MM-dd'),
  reading_value: '',
  observations: '',
};

type UtilityType = 'ENEL' | 'PROLAGOS';

// --- NOVO COMPONENTE PARA O RESUMO MENSAL ---
type SummaryView = 'total' | 'medidor' | 'pipas';

interface MonthlyAverageBlockProps {
  type: UtilityType;
  readingsForYear: UtilityReading[];
  pipaEntriesForYear: WaterTruckEntry[];
  currentMonth: Date;
}
const MonthlyAverageBlock: React.FC<MonthlyAverageBlockProps> = ({ type, readingsForYear, pipaEntriesForYear, currentMonth }) => {
  const [view, setView] = useState<SummaryView>('total');

  const summary = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);

    const readingsInMonth = readingsForYear
        .filter(r => r.utility_type === type)
        .filter(r => {
            const d = new Date(r.reading_date + 'T12:00:00');
            return d >= monthStart && d <= monthEnd;
        })
        .sort((a,b) => new Date(a.reading_date).getTime() - new Date(b.reading_date).getTime());

    if (readingsInMonth.length < 1) {
      return { meterConsumption: 0, pipaVolume: 0, totalConsumption: 0, weeks: 1, hasEnoughData: false };
    }

    const lastReadingBeforeMonth = readingsForYear
        .filter(r => r.utility_type === type && new Date(r.reading_date + 'T12:00:00') < monthStart)
        .sort((a,b) => new Date(b.reading_date).getTime() - new Date(a.reading_date).getTime())[0];

    if(!lastReadingBeforeMonth) {
        return { meterConsumption: 0, pipaVolume: 0, totalConsumption: 0, weeks: 1, hasEnoughData: false, message: "Falta leitura do mês anterior para calcular." };
    }

    const firstReading = lastReadingBeforeMonth;
    const lastReadingInMonth = readingsInMonth[readingsInMonth.length - 1];

    const meterConsumption = lastReadingInMonth.reading_value - firstReading.reading_value;

    // Calcular volume de pipas: filtrar por supply_date entre a leitura anterior e a última leitura do mês
    const pipaVolume = type === 'PROLAGOS'
        ? pipaEntriesForYear
            .filter(p => {
                const d = new Date(p.supply_date + 'T12:00:00');
                const refStart = new Date(firstReading.reading_date + 'T12:00:00');
                const refEnd = new Date(lastReadingInMonth.reading_date + 'T12:00:00');
                return d > refStart && d <= refEnd;
            })
            .reduce((sum, p) => sum + Number(p.volume_m3), 0)
        : 0;

    const totalConsumption = meterConsumption + pipaVolume;
    const weeks = differenceInWeeks(endOfMonth(currentMonth), startOfMonth(currentMonth)) + 1;

    return { meterConsumption, pipaVolume, totalConsumption, weeks, hasEnoughData: true };
  }, [readingsForYear, pipaEntriesForYear, currentMonth, type]);

  const unit = type === 'ENEL' ? 'kWh' : 'm³';
  const isProlagos = type === 'PROLAGOS';

  if (!summary.hasEnoughData) {
    return (
        <div className="mt-6 p-4 bg-blue-50 dark:bg-gray-700/50 rounded-lg text-center text-sm text-blue-700 dark:text-blue-300 flex items-center justify-center gap-2">
            <Info className="w-5 h-5"/>
            {summary.message || "São necessárias leituras neste mês e no anterior para calcular o resumo."}
        </div>
    )
  }

  const displayValue = view === 'total' ? summary.totalConsumption
    : view === 'medidor' ? summary.meterConsumption
    : summary.pipaVolume;
  const displayAvg = displayValue / summary.weeks;

  const viewLabel = view === 'total' ? 'Consumo Total (Medidor + Pipas)'
    : view === 'medidor' ? 'Consumo do Medidor'
    : 'Volume de Pipas';

  return (
    <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold text-lg text-gray-800 dark:text-white">Resumo do Mês</h4>
        {isProlagos && (
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 text-xs">
            <button
              onClick={() => setView('total')}
              className={`px-3 py-1.5 font-semibold transition-colors ${
                view === 'total'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Total
            </button>
            <button
              onClick={() => setView('medidor')}
              className={`px-3 py-1.5 font-semibold transition-colors border-x border-gray-200 dark:border-gray-600 ${
                view === 'medidor'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Medidor
            </button>
            <button
              onClick={() => setView('pipas')}
              className={`px-3 py-1.5 font-semibold transition-colors ${
                view === 'pipas'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Pipas
            </button>
          </div>
        )}
      </div>

      {isProlagos && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{viewLabel}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
        <div className="p-3 bg-white dark:bg-gray-800 rounded-md shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {view === 'pipas' ? 'Volume de Pipas no Mês' : view === 'medidor' ? 'Consumo do Medidor' : 'Consumo Total no Mês'}
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white flex items-center justify-center gap-1">
            {view === 'pipas' ? <Truck className="w-6 h-6" /> : <BarChart2 className="w-6 h-6" />}
            {displayValue.toFixed(2)} <span className="text-lg font-normal">{unit}</span>
          </p>
        </div>
        <div className="p-3 bg-white dark:bg-gray-800 rounded-md shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">Média Semanal</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white flex items-center justify-center gap-1">
            <TrendingUp className="w-6 h-6" />
            {displayAvg.toFixed(2)} <span className="text-lg font-normal">{unit}/semana</span>
          </p>
        </div>
      </div>

      {isProlagos && view === 'total' && summary.pipaVolume > 0 && (
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 justify-center">
          <span className="flex items-center gap-1"><BarChart2 className="w-3.5 h-3.5" /> Medidor: {summary.meterConsumption.toFixed(2)} {unit}</span>
          <span className="text-gray-300 dark:text-gray-600">+</span>
          <span className="flex items-center gap-1"><Truck className="w-3.5 h-3.5" /> Pipas: {summary.pipaVolume.toFixed(2)} {unit}</span>
        </div>
      )}
    </div>
  );
};

// --- COMPONENTE PRINCIPAL ---
const UtilitiesReport = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [allReadings, setAllReadings] = useState<UtilityReading[]>([]);
  const [allPipaEntries, setAllPipaEntries] = useState<WaterTruckEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(formInitialState);

  const [showPipaModal, setShowPipaModal] = useState(false);

  const fetchData = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    setError(null);
    
    const year = getYear(currentMonth);
    const [readingsRes, pipasRes] = await Promise.all([
      getUtilityReadingsForYear(selectedHotel.id, new Date(year, 0, 1)),
      getWaterTruckEntriesForYear(selectedHotel.id, new Date(year, 0, 1)),
    ]);

    if (readingsRes.error) setError(readingsRes.error.message);
    setAllReadings(readingsRes.data || []);

    if (pipasRes.error) setError(prev => prev ? `${prev}, ${pipasRes.error!.message}` : pipasRes.error!.message);
    setAllPipaEntries(pipasRes.data || []);
    
    setLoading(false);
  }, [selectedHotel, currentMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const processedReadings = useMemo(() => {
    const process = (type: UtilityType) => {
        const monthStart = startOfMonth(currentMonth);
        const monthEnd = endOfMonth(currentMonth);

        const sortedAllTime = allReadings.filter(r => r.utility_type === type).sort((a,b) => new Date(a.reading_date).getTime() - new Date(b.reading_date).getTime());
        const monthReadings = sortedAllTime.filter(r => { const d = new Date(r.reading_date + 'T12:00:00'); return d >= monthStart && d <= monthEnd; });

        return monthReadings.map((current) => {
            const currentIndex = sortedAllTime.findIndex(r => r.id === current.id);
            if (currentIndex === 0) return { ...current, consumption: undefined };

            const previous = sortedAllTime[currentIndex-1];
            const consumptionFromMeter = current.reading_value - previous.reading_value;
            
            let totalConsumption = consumptionFromMeter;
            if(type === 'PROLAGOS') {
                const pipaVolumeInPeriod = allPipaEntries
                    .filter(p => new Date(p.supply_date) > new Date(previous.reading_date) && new Date(p.supply_date) <= new Date(current.reading_date))
                    .reduce((sum, p) => sum + Number(p.volume_m3), 0);
                totalConsumption += pipaVolumeInPeriod;
            }
            return { ...current, consumption: totalConsumption };
        });
    };
    return { enel: process('ENEL'), prolagos: process('PROLAGOS') };
  }, [allReadings, allPipaEntries, currentMonth]);
  
  const handleMonthChange = (direction: 'prev' | 'next') => setCurrentMonth(prev => direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1));
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const handleEdit = (reading: UtilityReading) => { setEditingId(reading.id); setFormData({ id: reading.id, reading_date: reading.reading_date, reading_value: String(reading.reading_value), observations: reading.observations || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const clearForm = () => { setEditingId(null); setFormData(formInitialState); };

  const handleSubmit = async (e: React.FormEvent, type: UtilityType) => {
    e.preventDefault();
    if (!selectedHotel) return;
    setIsSubmitting(true);
    
    const readingData = { hotel_id: selectedHotel.id, utility_type: type, reading_date: formData.reading_date, reading_value: parseFloat(formData.reading_value), observations: formData.observations || undefined };

    const { error } = editingId
        ? await updateUtilityReading(editingId, readingData)
        : await addUtilityReading(readingData);
    
    if (error) {
        addNotification(`Erro ao salvar: ${error.message}`, 'error');
    } else {
        addNotification(`Leitura ${editingId ? 'atualizada' : 'adicionada'} com sucesso`, 'success');
        clearForm();
        await fetchData();
    }
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if(!window.confirm("Apagar este registro?")) return;
    setIsSubmitting(true);
    const { error } = await deleteUtilityReading(id);
    if(error){
        addNotification(`Erro ao apagar: ${error.message}`, 'error');
    } else {
        addNotification('Registro apagado com sucesso', 'success');
        await fetchData();
    }
    setIsSubmitting(false);
  }

  const renderUtilityCard = (type: UtilityType) => {
    const data = type === 'ENEL' ? processedReadings.enel : processedReadings.prolagos;
    const Icon = type === 'ENEL' ? Zap : Droplets;
    const color = type === 'ENEL' ? 'yellow' : 'blue';
    const unit = type === 'ENEL' ? 'kWh' : 'm³';

    return ( <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700"> <div className="flex justify-between items-center mb-4"> <h3 className={`text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2`}> <Icon className={`w-6 h-6 text-${color}-500`} /> Controle de {type === 'ENEL' ? 'Energia (Enel)' : 'Água (Prolagos)'} </h3> {type === 'PROLAGOS' && ( <button onClick={() => setShowPipaModal(true)} className={`flex items-center gap-2 px-3 py-2 text-sm text-white bg-${color}-600 rounded-lg shadow-sm hover:bg-${color}-700 transition-colors`}> <Truck className="w-4 h-4"/> Registrar Pipas </button> )} </div> <form onSubmit={(e) => handleSubmit(e, type)} className="space-y-4 mb-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg"> <h4 className="font-semibold text-lg text-gray-700 dark:text-gray-200">{editingId ? 'Editando Registro' : 'Adicionar Nova Leitura'}</h4> <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <input type="date" name="reading_date" value={formData.reading_date} onChange={handleInputChange} required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600 transition" /> <input type="number" name="reading_value" value={formData.reading_value} onChange={handleInputChange} placeholder={`Leitura (${unit})`} required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600 transition" step="any" /> </div> <textarea name="observations" value={formData.observations} onChange={handleInputChange} placeholder="Observações..." className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600 transition w-full" rows={2}></textarea> <div className="flex items-center gap-4"> <button type="submit" disabled={isSubmitting} className={`flex items-center justify-center px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-${color}-600 hover:bg-${color}-700`}> {isSubmitting ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : <PlusCircle className="w-5 h-5 mr-2" />} {editingId ? 'Salvar Alterações' : 'Adicionar Leitura'} </button> {editingId && ( <button type="button" onClick={clearForm} className="px-4 py-2 text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-600 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors duration-200">Cancelar Edição</button> )} </div> </form> <div className="overflow-x-auto"> <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400"> <thead className="text-xs text-gray-700 uppercase bg-gray-100 dark:bg-gray-700 dark:text-gray-300"> <tr> <th scope="col" className="px-4 py-3">Data</th> <th scope="col" className="px-4 py-3">Leitura ({unit})</th> <th scope="col" className="px-4 py-3">Consumo ({unit})</th> <th scope="col" className="px-4 py-3">Ações</th> </tr> </thead> <tbody> {data.map(item => ( <tr key={item.id} className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/20"> <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{format(new Date(item.reading_date + 'T12:00:00'), 'dd/MM/yy')}</td> <td className="px-4 py-3">{item.reading_value}</td> <td className="px-4 py-3 font-bold">{item.consumption?.toFixed(2) ?? '-'}</td> <td className="px-4 py-3 flex items-center gap-2"> <button onClick={() => handleEdit(item)} className="p-1 text-gray-500 hover:text-blue-600"><Edit className="w-4 h-4" /></button> <button onClick={() => handleDelete(item.id)} className="p-1 text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button> </td> </tr> ))} </tbody> </table> {data.length === 0 && !loading && ( <p className="text-center py-4 text-gray-500 dark:text-gray-400">Nenhum registro para este mês.</p> )} </div> <MonthlyAverageBlock type={type} readingsForYear={allReadings} pipaEntriesForYear={allPipaEntries} currentMonth={currentMonth} /> </div> ); };
  
  return ( <div> <div className="flex items-center justify-center space-x-4 mb-8 bg-white dark:bg-gray-800 p-4 rounded-full shadow-md max-w-md mx-auto"> <button onClick={() => handleMonthChange('prev')} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"> <ChevronLeft className="w-6 h-6" /> </button> <div className="text-center"> <div className="font-bold text-xl text-gray-800 dark:text-white flex items-center gap-2"> <Calendar className="w-5 h-5" /> {format(currentMonth, 'MMMM yyyy', { locale: ptBR })} </div> </div> <button onClick={() => handleMonthChange('next')} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"> <ChevronRight className="w-6 h-6" /> </button> </div> {loading && <div className="text-center p-8"><Loader2 className="w-8 h-8 mx-auto text-gray-400 animate-spin" /><p className="mt-2 text-gray-500 dark:text-gray-400">Carregando dados...</p></div>} {error && <div className="text-center p-8 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-300"><AlertCircle className="w-8 h-8 mx-auto mb-2" /><p>Erro ao carregar dados: {error}</p></div>} {!loading && !error && ( <div className="grid grid-cols-1 lg:grid-cols-2 gap-8"> {renderUtilityCard('ENEL')} {renderUtilityCard('PROLAGOS')} </div> )} <WaterTruckLogModal isOpen={showPipaModal} onClose={() => setShowPipaModal(false)} hotelId={selectedHotel?.id} currentMonth={currentMonth} onDataChange={fetchData} /> </div> );
};

export default UtilitiesReport;