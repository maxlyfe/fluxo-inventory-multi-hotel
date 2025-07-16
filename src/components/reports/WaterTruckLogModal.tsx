import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Modal from '../Modal';
import { Droplets, Plus, Edit, Trash2, Loader2, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  WaterTruckEntry,
  getWaterTruckEntriesForYear,
  addWaterTruckEntry,
  updateWaterTruckEntry,
  deleteWaterTruckEntry,
} from '../../lib/utilitiesReportService';
import { useNotification } from '../../context/NotificationContext';

const formInitialState = {
  id: '',
  supply_date: format(new Date(), 'yyyy-MM-dd'),
  seal_number: '',
  service_order: '',
  volume_m3: '',
};

interface WaterTruckLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  hotelId: string | undefined;
  currentMonth: Date;
  onDataChange: () => void; // Função para notificar o pai sobre mudanças
}

const WaterTruckLogModal: React.FC<WaterTruckLogModalProps> = ({ isOpen, onClose, hotelId, currentMonth, onDataChange }) => {
  const { addNotification } = useNotification();
  const [modalMonth, setModalMonth] = useState(currentMonth);
  const [allEntries, setAllEntries] = useState<WaterTruckEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState(formInitialState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchEntries = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true);
    const { data, error } = await getWaterTruckEntriesForYear(hotelId, modalMonth);
    if (error) {
      addNotification(`Erro ao buscar registros de pipa: ${error.message}`, 'error');
    } else {
      setAllEntries(data || []);
    }
    setLoading(false);
  }, [hotelId, modalMonth, addNotification]);

  useEffect(() => {
    if (isOpen) {
      setModalMonth(currentMonth); // Sincroniza com a página principal ao abrir
    }
  }, [isOpen, currentMonth]);

  useEffect(() => {
    if (isOpen) {
      fetchEntries();
    }
  }, [isOpen, fetchEntries]);
  
  const entriesForMonth = useMemo(() => {
    const monthStart = startOfMonth(modalMonth);
    const monthEnd = endOfMonth(modalMonth);
    return allEntries.filter(p => {
        const d = new Date(p.supply_date + 'T12:00:00');
        return d >= monthStart && d <= monthEnd;
    });
  }, [allEntries, modalMonth]);
  
  const sortedEntries = useMemo(() => {
    return [...entriesForMonth].sort((a, b) => new Date(b.supply_date).getTime() - new Date(a.supply_date).getTime());
  }, [entriesForMonth]);

  const totalVolume = useMemo(() => sortedEntries.reduce((sum, entry) => sum + Number(entry.volume_m3), 0), [sortedEntries]);
  const handleModalMonthChange = (direction: 'prev' | 'next') => setModalMonth(prev => direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1));
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({...prev, [e.target.name]: e.target.value}));
  const handleEdit = (entry: WaterTruckEntry) => { setEditingId(entry.id); setFormData({ id: entry.id, supply_date: entry.supply_date, seal_number: entry.seal_number || '', service_order: entry.service_order || '', volume_m3: String(entry.volume_m3) }); };
  const clearForm = () => { setEditingId(null); setFormData(formInitialState); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!hotelId) return;
    setIsSubmitting(true);
    
    const entryData = {
      hotel_id: hotelId,
      supply_date: formData.supply_date,
      seal_number: formData.seal_number || undefined,
      service_order: formData.service_order || undefined,
      volume_m3: parseFloat(formData.volume_m3)
    };

    const { error } = editingId
      ? await updateWaterTruckEntry(editingId, entryData)
      : await addWaterTruckEntry(entryData);

    if (error) {
      addNotification(`Erro ao salvar: ${error.message}`, 'error');
    } else {
      addNotification(`Registro ${editingId ? 'atualizado' : 'adicionado'} com sucesso!`, 'success');
      clearForm();
      await fetchEntries(); // Re-busca os dados
      onDataChange(); // Notifica o componente pai
    }
    setIsSubmitting(false);
  };
  
  const handleDelete = async (id: string) => {
    if(!window.confirm("Apagar este registro de pipa?")) return;
    setIsSubmitting(true);
    const { error } = await deleteWaterTruckEntry(id);
    if(error){
      addNotification(`Erro ao apagar: ${error.message}`, 'error');
    } else {
      addNotification('Registro apagado com sucesso', 'success');
      await fetchEntries();
      onDataChange();
    }
    setIsSubmitting(false);
  }

  // O resto do JSX do modal permanece o mesmo
  return ( <Modal isOpen={isOpen} onClose={onClose} title={`Registro de Pipas d'Água`}> <div className="space-y-4"> <div className="flex items-center justify-center space-x-4 mb-4 bg-gray-100 dark:bg-gray-800 p-3 rounded-lg"> <button onClick={() => handleModalMonthChange('prev')} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"> <ChevronLeft className="w-5 h-5" /> </button> <div className="text-center font-semibold text-lg text-gray-800 dark:text-white flex items-center gap-2"> <Calendar className="w-5 h-5" /> {format(modalMonth, 'MMMM yyyy', { locale: ptBR })} </div> <button onClick={() => handleModalMonthChange('next')} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"> <ChevronRight className="w-5 h-5" /> </button> </div> <form onSubmit={handleSubmit} className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg space-y-4"> <h4 className="font-semibold text-lg text-gray-700 dark:text-gray-200">{editingId ? 'Editando Entrega' : 'Nova Entrega de Pipa'}</h4> <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"> <input type="date" name="supply_date" value={formData.supply_date} onChange={handleInputChange} required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600 transition"/> <input type="text" name="seal_number" value={formData.seal_number} onChange={handleInputChange} placeholder="Nº Lacre" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600 transition"/> <input type="text" name="service_order" value={formData.service_order} onChange={handleInputChange} placeholder="Nº Ordem de Serviço" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600 transition"/> <input type="number" name="volume_m3" value={formData.volume_m3} onChange={handleInputChange} placeholder="Volume (m³)" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600 transition" step="any"/> </div> <div className='flex items-center gap-4'> <button type="submit" disabled={isSubmitting} className="flex items-center justify-center px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700"> {isSubmitting ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : <Plus className="w-5 h-5 mr-2" />} {editingId ? 'Salvar' : 'Adicionar'} </button> {editingId && <button type='button' onClick={clearForm} className='px-4 py-2 text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-600 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors duration-200'>Cancelar</button>} </div> </form> <div className="overflow-x-auto max-h-80"> <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400"> <thead className="text-xs text-gray-700 uppercase bg-gray-100 dark:bg-gray-700 dark:text-gray-300 sticky top-0"> <tr> <th scope="col" className="px-4 py-3">Data</th> <th scope="col" className="px-4 py-3">Lacre</th> <th scope="col" className="px-4 py-3">Ordem Serviço</th> <th scope="col" className="px-4 py-3">Volume (m³)</th> <th scope="col" className="px-4 py-3">Ações</th> </tr> </thead> <tbody> {loading ? (<tr><td colSpan={5} className="text-center p-4"><Loader2 className="w-6 h-6 mx-auto animate-spin"/></td></tr>) : sortedEntries.map(entry => ( <tr key={entry.id} className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/20"> <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{format(new Date(entry.supply_date + 'T12:00:00'), 'dd/MM/yy')}</td> <td className="px-4 py-2">{entry.seal_number || '-'}</td> <td className="px-4 py-2">{entry.service_order || '-'}</td> <td className="px-4 py-2 font-semibold">{Number(entry.volume_m3).toFixed(2)}</td> <td className="px-4 py-2 flex items-center gap-2"> <button onClick={() => handleEdit(entry)} className="p-1 text-gray-500 hover:text-blue-600"><Edit className="w-4 h-4" /></button> <button onClick={() => handleDelete(entry.id)} className="p-1 text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button> </td> </tr> ))} </tbody> <tfoot className="sticky bottom-0"> <tr className='bg-gray-200 dark:bg-gray-900 font-bold text-gray-800 dark:text-white'> <td colSpan={3} className='text-right px-4 py-2'>Total do Mês:</td> <td className='px-4 py-2'>{totalVolume.toFixed(2)} m³</td> <td></td> </tr> </tfoot> </table> {sortedEntries.length === 0 && !loading && <p className="text-center py-4 text-gray-500">Nenhuma entrega de pipa registrada para este mês.</p>} </div> </div> </Modal> );
};

export default WaterTruckLogModal;