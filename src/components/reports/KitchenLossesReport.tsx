// Importações de bibliotecas e componentes essenciais.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase'; // Cliente Supabase para interagir com o banco.
import { useHotel } from '../../context/HotelContext'; // Hook para obter o hotel selecionado.
import { useAuth } from '../../context/AuthContext'; // Hook para obter o usuário logado.
import { useNotification } from '../../context/NotificationContext'; // Hook para exibir notificações (toasts).
import { PlusCircle, RefreshCw, GitCommit, Loader2, Edit, Trash2, PackagePlus, Utensils, History, ArrowLeft } from 'lucide-react'; // Ícones.
import { format } from 'date-fns'; // Biblioteca para formatação de datas.
import { ptBR } from 'date-fns/locale'; // Localização para português do Brasil.
import Modal from '../Modal'; // Componente de modal genérico já existente no projeto.

// --- DEFINIÇÃO DE TIPOS (INTERFACES) ---

// Interface para os dados de um utensílio, conforme retornado pela função do Supabase.
interface Utensil {
  id: string;
  name: string;
  unit_value: number;
  image_url?: string;
  last_count_quantity?: number;
  last_count_date?: string;
  restocks_since_last_count?: number;
}

// Interface para os dados que o usuário insere na tabela (contagem atual e perdas por hóspede).
interface NewCountData {
  current_quantity: number | string;
  guest_loss_quantity: number | string;
}

// --- NOVO: Interface para o histórico de ciclos de desconto. ---
interface CycleHistory {
    cycle_id: string;
    closing_date: string;
    total_discount_value: number;
    closed_by_email: string;
}

// --- COMPONENTE PRINCIPAL DO RELATÓRIO ---
const KitchenLossesReport: React.FC = () => {
  // --- ESTADOS (HOOKS) ---
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [utensils, setUtensils] = useState<Utensil[]>([]);
  const [newCounts, setNewCounts] = useState<Record<string, NewCountData>>({});
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- NOVO: Estados para a funcionalidade de histórico ---
  const [viewMode, setViewMode] = useState<'current' | 'history'>('current');
  const [cycleHistory, setCycleHistory] = useState<CycleHistory[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [isHistoryDetailOpen, setIsHistoryDetailOpen] = useState(false);

  // Estados para controlar a visibilidade dos modais e qual item está sendo editado.
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [isRestockModalOpen, setRestockModalOpen] = useState(false);
  const [editingUtensil, setEditingUtensil] = useState<Utensil | null>(null);

  // --- FUNÇÕES DE BUSCA E MANIPULAÇÃO DE DADOS ---
  const fetchUtensils = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    setError(null);
    try {
        const { data, error: rpcError } = await supabase.rpc('get_kitchen_inventory_status', { p_hotel_id: selectedHotel.id });
        if (rpcError) throw rpcError;
        
        setUtensils(data || []);
        
        const initialCounts: Record<string, NewCountData> = {};
        (data || []).forEach((item: Utensil) => {
            initialCounts[item.id] = { current_quantity: '', guest_loss_quantity: '' };
        });
        setNewCounts(initialCounts);

    } catch (err: any) {
      const errorMessage = `Erro ao carregar utensílios: ${err.message}`;
      setError(errorMessage);
      addNotification("Falha ao buscar dados do inventário.", "error");
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);
  
  // --- NOVO: Função para buscar o histórico de ciclos ---
  const fetchCycleHistory = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_kitchen_discount_cycle_history', { p_hotel_id: selectedHotel.id });
      if (rpcError) throw rpcError;
      setCycleHistory(data || []);
    } catch (err: any) {
      addNotification(`Erro ao buscar histórico: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);

  // Efeito que decide qual função de busca chamar com base no modo de visualização.
  useEffect(() => {
    if (viewMode === 'current') {
      fetchUtensils();
    } else {
      fetchCycleHistory();
    }
  }, [viewMode, fetchUtensils, fetchCycleHistory]);
  
  // Lógica de cálculo para o relatório atual.
  const calculatedData = useMemo(() => {
    let totalDiscountValue = 0;
    const items = utensils.map(utensil => {
      const lastCount = utensil.last_count_quantity ?? 0;
      const restocks = utensil.restocks_since_last_count ?? 0;
      const guestLosses = Number(newCounts[utensil.id]?.guest_loss_quantity) || 0;
      const currentCount = Number(newCounts[utensil.id]?.current_quantity);

      if (newCounts[utensil.id]?.current_quantity === '' || isNaN(currentCount)) {
        return { ...utensil, calculatedLoss: 0, discountValue: 0, isInvalid: true };
      }

      const expectedQuantity = lastCount + restocks;
      const unaccountedLoss = expectedQuantity - guestLosses - currentCount;
      const discountValue = unaccountedLoss > 0 ? unaccountedLoss * utensil.unit_value : 0;
      
      totalDiscountValue += discountValue;

      return { ...utensil, calculatedLoss: unaccountedLoss, discountValue, isInvalid: false };
    });
    return { items, totalDiscountValue };
  }, [utensils, newCounts]);

  // --- FUNÇÕES DE EVENTOS (HANDLERS) ---
  const handleCountChange = (id: string, field: keyof NewCountData, value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '');
    setNewCounts(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: numericValue }
    }));
  };

  const handleCreateNew = () => {
      setEditingUtensil(null);
      setCreateModalOpen(true);
  }
  
  const handleEdit = (utensil: Utensil) => {
      setEditingUtensil(utensil);
      setCreateModalOpen(true);
  }

  const handleDelete = async (utensil: Utensil) => {
    if(!window.confirm(`Tem certeza que deseja apagar "${utensil.name}"? Todos os seus registros de contagem e perda serão apagados.`)) return;
    try {
      const { error } = await supabase.from('kitchen_utensils').delete().eq('id', utensil.id);
      if (error) throw error;
      addNotification("Utensílio apagado com sucesso!", "success");
      fetchUtensils();
    } catch(err: any) {
      addNotification(`Erro ao apagar: ${err.message}`, "error");
    }
  }
  
  const handleCloseCycle = async () => {
      if (!window.confirm("Você tem certeza que deseja fechar o ciclo de perdas? Esta ação irá registrar o desconto total e iniciar uma nova contagem.")) return;
      
      if (calculatedData.items.some(i => i.isInvalid)) {
          addNotification("Preencha a 'Qtd. Atual' de todos os itens antes de fechar o ciclo.", "warning");
          return;
      }
      
      setIsSaving(true);
      const countsToSave = Object.entries(newCounts).map(([utensil_id, values]) => ({
          utensil_id,
          current_quantity: Number(values.current_quantity),
          guest_loss_quantity: Number(values.guest_loss_quantity) || 0,
      }));

      try {
          const { error: rpcError } = await supabase.rpc('close_kitchen_discount_cycle', {
              p_hotel_id: selectedHotel!.id,
              p_user_id: user!.id,
              p_counts: countsToSave
          });
          if(rpcError) throw rpcError;
          addNotification("Ciclo fechado e perdas descontadas com sucesso!", "success");
          fetchUtensils();
      } catch(err: any) {
          addNotification(`Erro ao fechar ciclo: ${err.message}`, 'error');
      } finally {
          setIsSaving(false);
      }
  }

  // --- NOVO: Handler para abrir o modal de detalhes do histórico ---
  const handleViewCycleDetails = (cycleId: string) => {
    setSelectedCycleId(cycleId);
    setIsHistoryDetailOpen(true);
  };

  // --- RENDERIZAÇÃO ---
  const renderCurrentReport = () => {
    if (loading) return <div className="flex justify-center items-center p-8"><Loader2 className="animate-spin h-8 w-8 text-blue-500" /></div>;
    if (error) return <div className="p-8 text-center text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg">{error}</div>;
    if (utensils.length === 0) return (
      <div className="text-center py-10 px-4">
          <Utensils className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">Nenhum utensílio cadastrado</h3>
          <p className="mt-1 text-sm text-gray-500">Comece cadastrando o primeiro item para o controle de perdas.</p>
      </div>
    );

    return (
      <>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Item</th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Última Contagem</th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Reposições</th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Perda (Hóspede)</th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Qtd. Atual</th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Perda (Setor)</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Valor a Descontar</th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {calculatedData.items.map((item) => (
                <tr key={item.id} className="table-row-hover">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10">
                          {item.image_url ? 
                             <img className="h-10 w-10 rounded-full object-cover" src={item.image_url} alt={item.name} />
                             : <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center"><PackagePlus className="w-5 h-5 text-gray-400"/></div>
                          }
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</div>
                        <div className="text-sm text-gray-500">Valor Unit.: {item.unit_value.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="text-sm text-gray-900 dark:text-white">{item.last_count_quantity ?? 'N/A'}</div>
                      {item.last_count_date && <div className="text-xs text-gray-500">{format(new Date(item.last_count_date), 'dd/MM/yy')}</div>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-green-600 font-semibold">+{item.restocks_since_last_count ?? 0}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <input type="text" value={newCounts[item.id]?.guest_loss_quantity ?? ''} onChange={(e) => handleCountChange(item.id, 'guest_loss_quantity', e.target.value)} className="w-20 form-input text-center" placeholder="0" />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <input type="text" value={newCounts[item.id]?.current_quantity ?? ''} onChange={(e) => handleCountChange(item.id, 'current_quantity', e.target.value)} className={`w-20 form-input text-center ${item.isInvalid ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600'}`} placeholder="Qtd" />
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-center text-sm font-bold ${item.calculatedLoss > 0 ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                      {item.isInvalid ? '-' : item.calculatedLoss}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${item.discountValue > 0 ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                      {item.isInvalid ? '-' : item.discountValue.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                  </td>
                   <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                    <div className="flex items-center justify-center space-x-2">
                      <button onClick={() => handleEdit(item)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300" title="Editar Item"><Edit size={18}/></button>
                      <button onClick={() => handleDelete(item)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300" title="Apagar Item"><Trash2 size={18}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
             <tfoot className="bg-gray-100 dark:bg-gray-900">
                  <tr>
                      <td colSpan={6} className="px-6 py-4 text-right font-semibold text-gray-700 dark:text-gray-200">Total a ser Descontado do Setor:</td>
                      <td colSpan={2} className="px-6 py-4 text-left text-lg font-bold text-red-600">{calculatedData.totalDiscountValue.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</td>
                  </tr>
              </tfoot>
          </table>
        </div>
        {utensils.length > 0 && (
          <div className="flex justify-end mt-4">
              <button onClick={handleCloseCycle} disabled={isSaving} className="flex items-center justify-center px-6 py-3 text-white font-semibold rounded-lg shadow-md bg-green-600 hover:bg-green-700 disabled:opacity-50">
                  {isSaving ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : <GitCommit className="w-5 h-5 mr-2" />} 
                  Fechar Ciclo e Iniciar Nova Contagem
              </button>
          </div>
        )}
      </>
    );
  };

  // --- NOVO: Função para renderizar a visualização de histórico ---
  const renderHistoryView = () => {
    if (loading) return <div className="flex justify-center items-center p-8"><Loader2 className="animate-spin h-8 w-8 text-blue-500" /></div>;
    if (cycleHistory.length === 0) return (
        <div className="text-center py-10 px-4">
            <History className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">Nenhum histórico encontrado</h3>
            <p className="mt-1 text-sm text-gray-500">Nenhum ciclo de perdas foi fechado ainda.</p>
        </div>
    );

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Data de Fechamento</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Fechado Por</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Valor Total Descontado</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Ações</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {cycleHistory.map(cycle => (
              <tr key={cycle.cycle_id} className="table-row-hover">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                  {format(new Date(cycle.closing_date), 'dd/MM/yyyy \'às\' HH:mm', { locale: ptBR })}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {cycle.closed_by_email || 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-red-600 dark:text-red-400">
                  {cycle.total_discount_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <button onClick={() => handleViewCycleDetails(cycle.cycle_id)} className="button-secondary text-xs">
                    Ver Detalhes
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // JSX principal do componente.
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h3 className="text-xl font-bold text-gray-800 dark:text-white">Relatório de Perdas da Cozinha</h3>
        <div className="flex items-center gap-2">
            <button onClick={() => setViewMode(viewMode === 'current' ? 'history' : 'current')} className="button-secondary">
              {viewMode === 'current' ? <><History className="h-4 w-4 mr-2"/>Ver Histórico</> : <><ArrowLeft className="h-4 w-4 mr-2"/>Voltar ao Relatório Atual</>}
            </button>
            {viewMode === 'current' && (
              <>
                <button onClick={() => setRestockModalOpen(true)} className="button-secondary"><RefreshCw className="h-4 w-4 mr-2"/>Registrar Reposição</button>
                <button onClick={handleCreateNew} className="button-primary"><PlusCircle className="h-4 w-4 mr-2"/>Cadastrar Utensílio</button>
              </>
            )}
        </div>
      </div>
      
      <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-lg shadow-md">
        {viewMode === 'current' ? renderCurrentReport() : renderHistoryView()}
      </div>

      {/* Renderiza os modais */}
      {isCreateModalOpen && <CreateUtensilModal isOpen={isCreateModalOpen} onClose={() => setCreateModalOpen(false)} onSuccess={fetchUtensils} editingUtensil={editingUtensil} />}
      {isRestockModalOpen && <RestockModal isOpen={isRestockModalOpen} onClose={() => setRestockModalOpen(false)} onSuccess={fetchUtensils} utensils={utensils} />}
      {isHistoryDetailOpen && selectedCycleId && <HistoryDetailModal isOpen={isHistoryDetailOpen} onClose={() => setIsHistoryDetailOpen(false)} cycleId={selectedCycleId} />}
    </div>
  );
};

// --- COMPONENTES MODAIS ---
// CreateUtensilModal e RestockModal permanecem os mesmos.
const CreateUtensilModal: React.FC<any> = ({ isOpen, onClose, onSuccess, editingUtensil }) => {
    const { selectedHotel } = useHotel();
    const { addNotification } = useNotification();
    const [formData, setFormData] = useState({ name: '', unit_value: '', image_url: '' });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if(editingUtensil) {
            setFormData({
                name: editingUtensil.name,
                unit_value: String(editingUtensil.unit_value).replace('.', ','),
                image_url: editingUtensil.image_url || ''
            });
        } else {
            setFormData({ name: '', unit_value: '', image_url: '' });
        }
    }, [editingUtensil]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedHotel) return;
        setIsSaving(true);
        try {
            const payload = {
                hotel_id: selectedHotel.id,
                name: formData.name,
                unit_value: parseFloat(formData.unit_value.replace(',', '.')) || 0,
                image_url: formData.image_url || null,
            };
            
            let error;
            if (editingUtensil) {
                ({ error } = await supabase.from('kitchen_utensils').update(payload).eq('id', editingUtensil.id));
            } else {
                ({ error } = await supabase.from('kitchen_utensils').insert(payload));
            }

            if (error) throw error;
            addNotification(`Utensílio ${editingUtensil ? 'atualizado' : 'criado'} com sucesso!`, 'success');
            onSuccess();
            onClose();
        } catch (err: any) {
            addNotification(`Erro ao salvar: ${err.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={editingUtensil ? 'Editar Utensílio' : 'Novo Utensílio'}>
            <form onSubmit={handleSubmit}>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nome do Item</label>
                        <input type="text" name="name" value={formData.name} onChange={handleChange} required className="w-full mt-1 form-input"/>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Valor da Unidade (R$)</label>
                        <input type="text" name="unit_value" value={formData.unit_value} onChange={handleChange} required className="w-full mt-1 form-input" placeholder="19,90" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">URL da Imagem (Opcional)</label>
                        <input type="text" name="image_url" value={formData.image_url} onChange={handleChange} className="w-full mt-1 form-input"/>
                    </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 flex flex-row-reverse rounded-b-lg">
                    <button type="submit" disabled={isSaving} className="button-primary w-full sm:w-auto sm:ml-3">
                        {isSaving ? <Loader2 className="animate-spin h-5 w-5"/> : 'Salvar'}
                    </button>
                    <button type="button" onClick={onClose} className="button-secondary w-full sm:w-auto mt-3 sm:mt-0">Cancelar</button>
                </div>
            </form>
        </Modal>
    );
};

const RestockModal: React.FC<any> = ({ isOpen, onClose, onSuccess, utensils }) => {
    const { addNotification } = useNotification();
    const [formData, setFormData] = useState({ utensil_id: '', quantity_added: '', new_unit_value: '' });
    const [isSaving, setIsSaving] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            const selectedUtensil = utensils.find(u => u.id === formData.utensil_id);
            if (!selectedUtensil) throw new Error("Utensílio não encontrado.");

            const payload = {
                utensil_id: formData.utensil_id,
                quantity_added: parseInt(formData.quantity_added, 10),
                unit_value_at_time: parseFloat(formData.new_unit_value.replace(',', '.')) || selectedUtensil.unit_value
            };

            const { error } = await supabase.from('kitchen_restocks').insert(payload);
            if(error) throw error;
            
            if(formData.new_unit_value) {
                const { error: updateError } = await supabase.from('kitchen_utensils')
                    .update({ unit_value: payload.unit_value_at_time, updated_at: new Date() })
                    .eq('id', formData.utensil_id);
                if (updateError) throw updateError;
            }

            addNotification("Reposição registrada com sucesso!", "success");
            onSuccess();
            onClose();
        } catch (err: any) {
             addNotification(`Erro ao registrar reposição: ${err.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Registrar Reposição">
            <form onSubmit={handleSubmit}>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Utensílio</label>
                        <select name="utensil_id" value={formData.utensil_id} onChange={handleChange} required className="w-full mt-1 form-select">
                            <option value="">Selecione um item</option>
                            {utensils.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Quantidade Entregue</label>
                        <input type="number" name="quantity_added" value={formData.quantity_added} onChange={handleChange} required min="1" className="w-full mt-1 form-input"/>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Novo Valor Unitário (Opcional)</label>
                        <input type="text" name="new_unit_value" value={formData.new_unit_value} onChange={handleChange} className="w-full mt-1 form-input" placeholder="Deixe em branco para manter o valor atual"/>
                    </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 flex flex-row-reverse rounded-b-lg">
                    <button type="submit" disabled={isSaving} className="button-primary w-full sm:w-auto sm:ml-3">
                        {isSaving ? <Loader2 className="animate-spin h-5 w-5"/> : 'Salvar Reposição'}
                    </button>
                    <button type="button" onClick={onClose} className="button-secondary w-full sm:w-auto mt-3 sm:mt-0">Cancelar</button>
                </div>
            </form>
        </Modal>
    );
};


// --- NOVO: Componente Modal para Detalhes do Histórico ---
interface HistoryDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    cycleId: string;
}
interface CycleDetail {
    utensil_name: string;
    unit_value: number;
    previous_count: number;
    restocks_in_period: number;
    guest_losses_in_period: number;
    final_count: number;
    unaccounted_loss: number;
    discount_value: number;
}

const HistoryDetailModal: React.FC<HistoryDetailModalProps> = ({ isOpen, onClose, cycleId }) => {
    const [details, setDetails] = useState<CycleDetail[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isOpen && cycleId) {
            const fetchDetails = async () => {
                setLoading(true);
                try {
                    const { data, error } = await supabase.rpc('get_kitchen_discount_cycle_details', { p_cycle_id: cycleId });
                    if (error) throw error;
                    setDetails(data || []);
                } catch (err) {
                    console.error("Erro ao buscar detalhes do ciclo:", err);
                } finally {
                    setLoading(false);
                }
            };
            fetchDetails();
        }
    }, [isOpen, cycleId]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Detalhes do Ciclo de Perdas" size="4xl">
            <div className="p-2">
                {loading ? (
                    <div className="text-center py-8"><Loader2 className="mx-auto h-8 w-8 animate-spin" /></div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Item</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Est. Anterior</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Reposições</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Perda (Hóspede)</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Contagem Final</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Perda (Setor)</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Valor Descontado</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {details.map(item => (
                                    <tr key={item.utensil_name}>
                                        <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{item.utensil_name}</td>
                                        <td className="px-4 py-2 text-center text-sm">{item.previous_count}</td>
                                        <td className="px-4 py-2 text-center text-sm text-green-600">+{item.restocks_in_period}</td>
                                        <td className="px-4 py-2 text-center text-sm">-{item.guest_losses_in_period}</td>
                                        <td className="px-4 py-2 text-center text-sm font-semibold">{item.final_count}</td>
                                        <td className={`px-4 py-2 text-center text-sm font-bold ${item.unaccounted_loss > 0 ? 'text-red-500' : ''}`}>{item.unaccounted_loss}</td>
                                        <td className="px-4 py-2 text-right text-sm font-bold text-red-500">{item.discount_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default KitchenLossesReport;
