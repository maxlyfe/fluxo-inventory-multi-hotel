import React, { useState } from 'react';
import Modal from '../Modal';
import { Loader2 } from 'lucide-react';
import { createLaundryReport, LaundryReport } from '../../lib/laundryReportService';
import { useNotification } from '../../context/NotificationContext';
import { isBefore, parseISO } from 'date-fns';

interface CreateLaundryReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  hotelId: string;
  onReportCreated: (newReport: LaundryReport) => void; // MODIFICADO: Agora espera o novo relatório
}

const CreateLaundryReportModal: React.FC<CreateLaundryReportModalProps> = ({ isOpen, onClose, hotelId, onReportCreated }) => {
  const { addNotification } = useNotification();
  const [reportName, setReportName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!reportName.trim() || !startDate || !endDate) { addNotification("Por favor, preencha todos os campos.", "error"); return; }
    if (isBefore(parseISO(endDate), parseISO(startDate))) { addNotification("A data final não pode ser anterior à data inicial.", "error"); return; }

    setIsSaving(true);
    const { data: newReport, error } = await createLaundryReport(hotelId, reportName, startDate, endDate);
    if (error) {
      addNotification(`Erro ao criar relatório: ${error.message}`, 'error');
    } else if (newReport) {
      addNotification("Relatório criado com sucesso!", "success");
      onReportCreated(newReport); // MODIFICADO: Passa o novo relatório de volta
      onClose();
      setReportName(''); setStartDate(''); setEndDate('');
    }
    setIsSaving(false);
  };
  
  const inputStyle = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Criar Novo Relatório de Lavanderia">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nome do Relatório</label>
          <input type="text" value={reportName} onChange={e => setReportName(e.target.value)} placeholder="Ex: 1ª Quinzena de Agosto/25" className={`${inputStyle} mt-1`} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Data de Início</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`${inputStyle} mt-1`} /></div>
          <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Data de Fim</label><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={`${inputStyle} mt-1`} /></div>
        </div>
        <div className="flex justify-end gap-4 pt-4">
          <button onClick={onClose} className="px-4 py-2 text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-600 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500">Cancelar</button>
          <button onClick={handleSave} disabled={isSaving} className="flex items-center justify-center px-4 py-2 text-white font-semibold rounded-lg shadow-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
            {isSaving && <Loader2 className="animate-spin w-5 h-5 mr-2" />} Criar Relatório
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default CreateLaundryReportModal;