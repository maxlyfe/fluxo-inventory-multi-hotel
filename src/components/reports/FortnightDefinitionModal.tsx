import React, { useState, useEffect } from 'react';
import Modal from '../Modal';
import { Loader2 } from 'lucide-react';
import { FortnightDefinition, saveFortnightDefinition } from '../../lib/laundryReportService';
import { useNotification } from '../../context/NotificationContext';
import { format, startOfMonth, endOfMonth, addDays, parseISO, isBefore } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface FortnightDefinitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  hotelId: string;
  currentMonth: Date;
  currentDefinition: FortnightDefinition | null;
  onSave: () => void;
}

const FortnightDefinitionModal: React.FC<FortnightDefinitionModalProps> = ({ isOpen, onClose, hotelId, currentMonth, currentDefinition, onSave }) => {
  const { addNotification } = useNotification();
  const [dates, setDates] = useState({ fortnight_1_start: '', fortnight_1_end: '', fortnight_2_start: '', fortnight_2_end: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
        if (currentDefinition) {
            setDates({
                fortnight_1_start: format(parseISO(currentDefinition.fortnight_1_start), 'yyyy-MM-dd'),
                fortnight_1_end: format(parseISO(currentDefinition.fortnight_1_end), 'yyyy-MM-dd'),
                fortnight_2_start: format(parseISO(currentDefinition.fortnight_2_start), 'yyyy-MM-dd'),
                fortnight_2_end: format(parseISO(currentDefinition.fortnight_2_end), 'yyyy-MM-dd'),
            });
        } else {
            const monthStart = startOfMonth(currentMonth);
            const midMonth = addDays(monthStart, 14);
            const nextDay = addDays(midMonth, 1);
            const monthEnd = endOfMonth(currentMonth);
            setDates({
                fortnight_1_start: format(monthStart, 'yyyy-MM-dd'),
                fortnight_1_end: format(midMonth, 'yyyy-MM-dd'),
                fortnight_2_start: format(nextDay, 'yyyy-MM-dd'),
                fortnight_2_end: format(monthEnd, 'yyyy-MM-dd'),
            });
        }
    }
  }, [isOpen, currentDefinition, currentMonth]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => setDates(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSaveClick = async () => {
    try {
        const d1_start = parseISO(dates.fortnight_1_start);
        const d1_end = parseISO(dates.fortnight_1_end);
        const d2_start = parseISO(dates.fortnight_2_start);
        const d2_end = parseISO(dates.fortnight_2_end);
        if (isBefore(d1_end, d1_start) || isBefore(d2_end, d2_start)) {
            addNotification("A data final não pode ser anterior à data inicial.", "error"); return;
        }
    } catch(e) {
        addNotification("Uma ou mais datas são inválidas.", "error"); return;
    }
    
    setIsSaving(true);
    const definitionToSave = { hotel_id: hotelId, month_date: format(currentMonth, 'yyyy-MM-01'), ...dates };
    const { error } = await saveFortnightDefinition(definitionToSave);
    if(error){ addNotification(`Erro ao salvar: ${error.message}`, 'error'); } 
    else { addNotification('Períodos salvos com sucesso!', 'success'); onSave(); onClose(); }
    setIsSaving(false);
  };
  
  const inputStyle = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Definir Períodos de ${format(currentMonth, 'MMMM yyyy', { locale: ptBR })}`}>
      <div className="space-y-6">
        <div>
          <h4 className="font-semibold text-lg text-gray-800 dark:text-gray-100 mb-2">1ª Quinzena</h4>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-600 dark:text-gray-300">Data de Início</label><input type="date" name="fortnight_1_start" value={dates.fortnight_1_start} onChange={handleDateChange} className={`${inputStyle} mt-1`} /></div>
            <div><label className="text-sm font-medium text-gray-600 dark:text-gray-300">Data de Fim</label><input type="date" name="fortnight_1_end" value={dates.fortnight_1_end} onChange={handleDateChange} className={`${inputStyle} mt-1`} /></div>
          </div>
        </div>
        <div>
          <h4 className="font-semibold text-lg text-gray-800 dark:text-gray-100 mb-2">2ª Quinzena</h4>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-600 dark:text-gray-300">Data de Início</label><input type="date" name="fortnight_2_start" value={dates.fortnight_2_start} onChange={handleDateChange} className={`${inputStyle} mt-1`} /></div>
            <div><label className="text-sm font-medium text-gray-600 dark:text-gray-300">Data de Fim</label><input type="date" name="fortnight_2_end" value={dates.fortnight_2_end} onChange={handleDateChange} className={`${inputStyle} mt-1`} /></div>
          </div>
        </div>
        <div className="flex justify-end gap-4 pt-4">
          <button onClick={onClose} className="px-4 py-2 text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-600 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500">Cancelar</button>
          <button onClick={handleSaveClick} disabled={isSaving} className="flex items-center justify-center px-4 py-2 text-white font-semibold rounded-lg shadow-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
            {isSaving && <Loader2 className="animate-spin w-5 h-5 mr-2" />} Salvar Períodos
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default FortnightDefinitionModal;