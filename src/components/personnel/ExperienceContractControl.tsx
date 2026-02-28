// Importações de bibliotecas e componentes.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { PlusCircle, Loader2, Edit, Trash2, Calendar, UserPlus, Clock } from 'lucide-react';
import { format, addDays, isBefore, parseISO, intervalToDuration } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Modal from '../Modal';

// --- DEFINIÇÃO DE TIPOS (INTERFACES) ---

// Interface para os dados de um contrato de experiência.
interface Contract {
  id: string;
  employee_name: string;
  start_date: string; // Formato YYYY-MM-DD
  is_active: boolean;
  created_at: string;
}

// --- COMPONENTE PRINCIPAL DO RELATÓRIO ---
const ExperienceContractControl: React.FC = () => {
  // --- ESTADOS (HOOKS) ---
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Estado para o formulário de novo/edição de contrato.
  const [formData, setFormData] = useState({
    id: null as string | null,
    employee_name: '',
    start_date: format(new Date(), 'yyyy-MM-dd'),
  });

  // --- FUNÇÕES DE BUSCA DE DADOS ---
  const fetchContracts = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_contracts')
        .select('*')
        .eq('hotel_id', selectedHotel.id)
        .eq('is_active', true) // Busca apenas contratos ativos.
        .order('start_date', { ascending: false });

      if (error) throw error;
      setContracts(data || []);
    } catch (err: any) {
      addNotification(`Erro ao buscar contratos: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  // --- FUNÇÕES DE EVENTOS (HANDLERS) ---

  // Abre o modal para criar um novo contrato, resetando o formulário.
  const handleAddNew = () => {
    setFormData({
      id: null,
      employee_name: '',
      start_date: format(new Date(), 'yyyy-MM-dd'),
    });
    setIsModalOpen(true);
  };

  // Abre o modal para editar um contrato existente, preenchendo o formulário.
  const handleEdit = (contract: Contract) => {
    setFormData({
      id: contract.id,
      employee_name: contract.employee_name,
      start_date: contract.start_date,
    });
    setIsModalOpen(true);
  };

  // Lida com a submissão do formulário (criação ou edição).
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHotel) return;
    setIsSaving(true);

    try {
      const payload = {
        hotel_id: selectedHotel.id,
        employee_name: formData.employee_name,
        start_date: formData.start_date,
      };

      if (formData.id) {
        // Modo de Edição
        const { error } = await supabase.from('employee_contracts').update(payload).eq('id', formData.id);
        if (error) throw error;
        addNotification('Contrato atualizado com sucesso!', 'success');
      } else {
        // Modo de Criação
        const { error } = await supabase.from('employee_contracts').insert(payload);
        if (error) throw error;
        addNotification('Colaborador cadastrado com sucesso!', 'success');
      }
      
      setIsModalOpen(false);
      fetchContracts(); // Recarrega a lista.
    } catch (err: any) {
      addNotification(`Erro ao salvar: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Lida com a exclusão (desativação) de um contrato.
  const handleDelete = async (contractId: string) => {
    if (window.confirm('Tem certeza que deseja arquivar este contrato?')) {
      try {
        const { error } = await supabase
          .from('employee_contracts')
          .update({ is_active: false })
          .eq('id', contractId);
        if (error) throw error;
        addNotification('Contrato arquivado com sucesso.', 'info');
        fetchContracts();
      } catch (err: any) {
        addNotification(`Erro ao arquivar: ${err.message}`, 'error');
      }
    }
  };
  
  // Função para calcular e formatar o tempo de casa.
  /**
   * Calcula a duração entre a data de início e hoje e a formata de forma legível.
   * @param startDate A data de início do contrato.
   * @returns Uma string formatada como "X anos, Y meses e Z dias".
   */
  const formatTenure = (startDate: string) => {
    try {
      const start = parseISO(startDate);
      const end = new Date(); // Data de hoje
      
      // Usa a função 'intervalToDuration' para obter a diferença.
      const duration = intervalToDuration({ start, end });
      
      const parts = [];
      if (duration.years && duration.years > 0) parts.push(`${duration.years} ano${duration.years > 1 ? 's' : ''}`);
      if (duration.months && duration.months > 0) parts.push(`${duration.months} ${duration.months > 1 ? 'meses' : 'mês'}`);
      if (duration.days && duration.days > 0) parts.push(`${duration.days} dia${duration.days > 1 ? 's' : ''}`);
      
      // Se não houver partes (menos de um dia), retorna "Recém-contratado".
      return parts.length > 0 ? parts.join(', ') : 'Recém-contratado';
    } catch (error) {
      console.error("Erro ao formatar tempo de casa:", error);
      return 'N/A'; // Retorna 'N/A' em caso de erro.
    }
  };

  // --- RENDERIZAÇÃO ---
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white flex items-center">
          <Calendar className="h-6 w-6 mr-2" />
          Controle de Contratos de Experiência
        </h2>
        <button onClick={handleAddNew} className="button-primary">
          <PlusCircle className="h-5 w-5 mr-2" />
          Cadastrar Colaborador
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8"><Loader2 className="mx-auto h-8 w-8 animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              {/* --- ALTERAÇÃO: Ordem das colunas do cabeçalho foi ajustada --- */}
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Colaborador</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Início do Contrato</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Fim 1º Período (30 dias)</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Fim 2º Período (90 dias)</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Tempo de Casa</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {contracts.map(contract => {
                // Calcula as datas de vencimento.
                const startDate = parseISO(contract.start_date);
                const firstEndDate = addDays(startDate, 29);
                const secondEndDate = addDays(startDate, 89);
                const today = new Date();
                
                // Determina a cor com base na data atual.
                const firstPeriodColor = isBefore(firstEndDate, today) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
                const secondPeriodColor = isBefore(secondEndDate, today) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';

                return (
                  <tr key={contract.id} className="table-row-hover">
                    {/* --- ALTERAÇÃO: Ordem das células de dados foi ajustada --- */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{contract.employee_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500 dark:text-gray-400">{format(startDate, 'dd/MM/yyyy', { locale: ptBR })}</td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-center font-semibold ${firstPeriodColor}`}>{format(firstEndDate, 'dd/MM/yyyy', { locale: ptBR })}</td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-center font-semibold ${secondPeriodColor}`}>{format(secondEndDate, 'dd/MM/yyyy', { locale: ptBR })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500 dark:text-gray-400">
                      <div className="flex items-center justify-center">
                        <Clock size={14} className="mr-1.5" />
                        {formatTenure(contract.start_date)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                      <div className="flex items-center justify-center space-x-3">
                        <button onClick={() => handleEdit(contract)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300" title="Editar Contrato"><Edit size={18}/></button>
                        <button onClick={() => handleDelete(contract.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300" title="Arquivar Contrato"><Trash2 size={18}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Cadastro/Edição */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={formData.id ? 'Editar Contrato' : 'Cadastrar Novo Colaborador'}>
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <div>
              <label htmlFor="employee_name" className="form-label">Nome do Colaborador</label>
              <input type="text" id="employee_name" value={formData.employee_name} onChange={e => setFormData({...formData, employee_name: e.target.value})} className="form-input mt-1" required />
            </div>
            <div>
              <label htmlFor="start_date" className="form-label">Data de Início do Contrato</label>
              <input type="date" id="start_date" value={formData.start_date} onChange={e => setFormData({...formData, start_date: e.target.value})} className="form-input mt-1" required />
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 flex flex-row-reverse rounded-b-lg">
            <button type="submit" disabled={isSaving} className="button-primary w-full sm:w-auto sm:ml-3">
              {isSaving ? <Loader2 className="animate-spin h-5 w-5"/> : 'Salvar'}
            </button>
            <button type="button" onClick={() => setIsModalOpen(false)} className="button-secondary w-full sm:w-auto mt-3 sm:mt-0">Cancelar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default ExperienceContractControl;
