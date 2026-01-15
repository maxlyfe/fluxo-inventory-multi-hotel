import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Calendar, 
  Download, 
  Box, 
  Truck, 
  Trash2, 
  Save, 
  CheckCircle, 
  XCircle,
  History,
  Database,
  DollarSign,
  Hash
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { getBudgetDetails, updateBudgetItems, updateBudgetStatus } from '../lib/supabase';
import { createNotification } from '../lib/notifications';
import * as XLSX from 'xlsx';

const unitOptions = [
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'l', label: 'L' },
  { value: 'ml', label: 'mL' },
  { value: 'und', label: 'un' },
  { value: 'cx', label: 'cx' },
  { value: 'pct', label: 'pct' },
  { value: 'fardo', label: 'fardo' },
  { value: 'balde', label: 'balde' },
  { value: 'saco', label: 'saco' },
];

interface BudgetItemDetail {
  id: string;
  product_id: string | null;
  custom_item_name: string | null;
  quantity: number;
  unit_price: number | null;
  supplier: string | null;
  last_purchase_quantity: number | null;
  last_purchase_price: number | null;
  last_purchase_date: string | null;
  weight: number | null;
  unit: string | null;
  stock_at_creation: number | null;
  product: {
    id: string;
    name: string;
    category: string;
  } | null;
}

interface BudgetDetailData {
  id: string;
  created_at: string;
  total_value: number;
  status: "pending" | "approved" | "on_the_way" | "delivered" | "cancelled" | null;
  hotel_id: string;
  hotel: {
    id: string;
    name: string;
  } | null;
  budget_items: BudgetItemDetail[];
  approved_by_user_email?: string | null;
  approved_at?: string | null;
}

const BudgetDetail = () => {
  const { budgetId } = useParams<{ budgetId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addNotification } = useNotification();
  const [budget, setBudget] = useState<BudgetDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetails = async () => {
    if (!budgetId) {
      setError('ID do orçamento não fornecido.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await getBudgetDetails(budgetId);

      if (result.success && result.data) {
        setBudget(result.data);
      } else {
        throw new Error(result.error || 'Falha ao buscar detalhes do orçamento.');
      }
    } catch (err) {
      console.error('Error fetching budget details:', err);
      const message = err instanceof Error ? err.message : 'Erro desconhecido.';
      setError(`Erro ao carregar detalhes: ${message}`);
      addNotification(`Erro ao carregar detalhes: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [budgetId]);

  const getUnitLabel = (unitValue: string | null | undefined): string => {
    if (!unitValue) return '-';
    const option = unitOptions.find(opt => opt.value === unitValue);
    return option ? option.label : unitValue;
  };

  const handleUpdateItemQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity < 0 || !budget) return;
    
    const updatedItems = budget.budget_items.map(item => 
      item.id === itemId ? { ...item, quantity: newQuantity } : item
    );
    
    const newTotalValue = updatedItems.reduce((sum, item) => 
      sum + (item.quantity * (item.unit_price || 0)), 0
    );
    
    setBudget({ ...budget, budget_items: updatedItems, total_value: newTotalValue });
  };

  const handleRemoveItem = (itemId: string) => {
    if (!budget || !window.confirm("Tem certeza que deseja remover este item do orçamento?")) return;
    
    const updatedItems = budget.budget_items.filter(item => item.id !== itemId);
    
    if (updatedItems.length === 0) {
      addNotification("O orçamento não pode ficar vazio.", "warning");
      return;
    }
    
    const newTotalValue = updatedItems.reduce((sum, item) => 
      sum + (item.quantity * (item.unit_price || 0)), 0
    );
    
    setBudget({ ...budget, budget_items: updatedItems, total_value: newTotalValue });
  };

  const handleSaveChanges = async (silent = false) => {
    if (!budget || !budgetId) return false;

    try {
      if (!silent) setLoading(true);
      const result = await updateBudgetItems(budgetId, budget.budget_items, budget.total_value);
      
      if (result.success) {
        if (!silent) addNotification("Alterações salvas com sucesso!", "success");
        return true;
      } else {
        throw new Error(result.error || "Falha ao salvar alterações");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao salvar alterações.";
      addNotification(message, "error");
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const getMainSupplier = (): string => {
    if (!budget) return 'Não especificado';
    
    const suppliers = budget.budget_items
      .map(item => item.supplier)
      .filter(supplier => supplier && supplier.trim() !== '');
    
    if (suppliers.length === 0) return 'Não especificado';
    
    const supplierCounts: Record<string, number> = {};
    suppliers.forEach(supplier => {
      if (supplier) {
        supplierCounts[supplier] = (supplierCounts[supplier] || 0) + 1;
      }
    });
    
    let mainSupplier = suppliers[0] || 'Não especificado';
    let maxCount = 0;

    Object.entries(supplierCounts).forEach(([supplier, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mainSupplier = supplier;
      }
    });
    
    return mainSupplier;
  };

  const handleApproveBudget = async () => {
    if (!budget || !budgetId || !user?.email) {
      addNotification("Usuário não autenticado ou dados incompletos.", "error");
      return;
    }

    if (!window.confirm("Deseja aprovar este orçamento?")) return;

    try {
      setLoading(true);
      
      // 1. Salvar alterações primeiro
      const saved = await handleSaveChanges(true);
      if (!saved) return;

      // 2. Atualizar status
      const result = await updateBudgetStatus(budgetId, "approved", user.email);
      if (result.success) {
        addNotification("Orçamento aprovado com sucesso!", "success");
        
        try {
          await createNotification({
            event_type: 'BUDGET_APPROVED',
            hotel_id: budget.hotel_id,
            title: 'Orçamento aprovado',
            content: `Orçamento de ${getMainSupplier()} no valor de R$ ${budget.total_value.toFixed(2).replace('.', ',')} foi aprovado por ${user.email.split('@')[0]}`,
            link: `/budget/${budgetId}`,
            metadata: {
              budget_id: budgetId,
              total_value: budget.total_value,
              supplier: getMainSupplier(),
              approved_by: user.email,
              items_count: budget.budget_items.length
            }
          });
        } catch (nErr) { console.error(nErr); }
        
        fetchDetails();
      } else {
        throw new Error(result.error || "Falha ao aprovar");
      }
    } catch (err) {
      addNotification(err instanceof Error ? err.message : "Erro ao aprovar", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelBudget = async () => {
    if (!budget || !budgetId) return;
    if (!window.confirm("Tem certeza que deseja cancelar este orçamento?")) return;

    try {
      setLoading(true);
      const result = await updateBudgetStatus(budgetId, "cancelled");
      if (result.success) {
        addNotification("Orçamento cancelado.", "success");
        
        try {
          await createNotification({
            event_type: 'BUDGET_CANCELLED',
            hotel_id: budget.hotel_id,
            title: 'Orçamento cancelado',
            content: `Orçamento de ${getMainSupplier()} no valor de R$ ${budget.total_value.toFixed(2).replace('.', ',')} foi cancelado`,
            link: `/budget/${budgetId}`,
            metadata: {
              budget_id: budgetId,
              total_value: budget.total_value,
              supplier: getMainSupplier(),
              cancelled_by: user?.email || 'Sistema'
            }
          });
        } catch (nErr) { console.error(nErr); }
        
        fetchDetails();
      } else {
        throw new Error(result.error || "Falha ao cancelar");
      }
    } catch (err) {
      addNotification(err instanceof Error ? err.message : "Erro ao cancelar", "error");
    } finally {
      setLoading(false);
    }
  };

  const exportBudgetToExcel = () => {
    if (!budget) return;

    const listData = budget.budget_items.map(item => {
      const totalItemValue = item.quantity * (item.unit_price || 0);
      const unitLabel = getUnitLabel(item.unit);
      const itemName = item.custom_item_name || item.product?.name || 'Item Desconhecido';
      
      return {
        'Item': itemName,
        'Quantidade': item.quantity,
        'Unidade': unitLabel,
        'Fornecedor': item.supplier || '-',
        'Valor Unitário': item.unit_price != null ? item.unit_price : '-',
        'Valor Total': totalItemValue,
        'Estoque': item.stock_at_creation ?? '-',
        'Últ. Compra': item.last_purchase_date 
          ? format(parseISO(item.last_purchase_date), 'dd/MM/yyyy') 
          : '-',
        'Últ. Qtd.': item.last_purchase_quantity ?? '-',
        'Últ. Preço': item.last_purchase_price ?? '-'
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(listData);
    XLSX.utils.book_append_sheet(wb, ws, 'Itens Orçamento');
    
    try {
      const fileName = `orcamento_${format(parseISO(budget.created_at), 'dd-MM-yyyy')}.xlsx`;
      XLSX.writeFile(wb, fileName);
      addNotification('Orçamento exportado para Excel!', 'success');
    } catch (exportError) {
      console.error('Error exporting budget:', exportError);
      addNotification('Erro ao exportar orçamento.', 'error');
    }
  };

  if (loading && !budget) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-500"></div>
      </div>
    );
  }

  if (error || !budget) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 flex items-center justify-center">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 max-w-md w-full text-center">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Erro ao Carregar</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-6">{error || 'Orçamento não encontrado.'}</p>
          <button
            onClick={() => navigate(-1)}
            className="w-full max-w-xs mx-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-32">
      {/* Cabeçalho */}
      <div className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-300" />
            </button>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-white text-center flex-1">
              Aprovação de Orçamento
            </h1>
            <button
              onClick={exportBudgetToExcel}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Exportar para Excel"
            >
              <Download className="h-5 w-5 text-gray-600 dark:text-gray-300" />
            </button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        {/* Resumo do Orçamento */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 mb-6 border border-gray-100 dark:border-gray-700">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Truck className="h-5 w-5 text-blue-600" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{getMainSupplier()}</h2>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {format(parseISO(budget.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                </span>
                <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                  {budget.hotel?.name}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Valor Total</p>
              <p className="text-3xl font-black text-blue-600 dark:text-blue-400">
                R$ {budget.total_value.toFixed(2).replace('.', ',')}
              </p>
            </div>
          </div>
          
          {budget.status !== 'pending' && (
            <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 ${
              budget.status === 'approved' ? 'bg-green-50 text-green-700 border border-green-100' : 
              budget.status === 'cancelled' ? 'bg-red-50 text-red-700 border border-red-100' : 
              'bg-blue-50 text-blue-700 border border-blue-100'
            }`}>
              {budget.status === 'approved' ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              <span className="font-medium">Status: {
                budget.status === 'approved' ? 'Aprovado' : 
                budget.status === 'cancelled' ? 'Cancelado' : budget.status
              }</span>
              {budget.approved_by_user_email && (
                <span className="text-sm ml-auto">por {budget.approved_by_user_email.split('@')[0]}</span>
              )}
            </div>
          )}
        </div>

        {/* Lista de Itens Didática */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Box className="h-5 w-5" />
            Itens Solicitados ({budget.budget_items.length})
          </h3>
          
          {budget.budget_items.map((item) => {
            const itemName = item.custom_item_name || item.product?.name || 'Item Desconhecido';
            const itemTotal = item.quantity * (item.unit_price || 0);
            
            return (
              <div key={item.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Cabeçalho do Item */}
                <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-bold text-gray-900 dark:text-white text-lg">{itemName}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-tighter">
                      {item.product?.category || 'Sem categoria'}
                    </p>
                  </div>
                  {budget.status === 'pending' && (
                    <button 
                      onClick={() => handleRemoveItem(item.id)}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  )}
                </div>

                {/* Grid de Informações Didáticas */}
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Coluna 1: Compra Atual */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold text-sm uppercase">
                      <ShoppingBag className="h-4 w-4" /> Compra Atual
                    </div>
                    <div className="bg-blue-50/50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-100 dark:border-blue-900/30">
                      <div className="mb-3">
                        <label className="text-xs text-gray-500 block mb-1">Quantidade Solicitada</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={item.quantity}
                            disabled={budget.status !== 'pending'}
                            onChange={(e) => handleUpdateItemQuantity(item.id, parseFloat(e.target.value) || 0)}
                            className="w-24 p-2 text-lg font-bold border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 focus:ring-2 focus:ring-blue-500 outline-none"
                            min="0"
                            step="any"
                          />
                          <span className="font-medium text-gray-600 dark:text-gray-300">{getUnitLabel(item.unit)}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase">Preço Unit.</p>
                          <p className="font-bold text-gray-800 dark:text-gray-200">R$ {(item.unit_price || 0).toFixed(2).replace('.', ',')}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase">Subtotal</p>
                          <p className="font-bold text-blue-600 dark:text-blue-400">R$ {itemTotal.toFixed(2).replace('.', ',')}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Coluna 2: Histórico */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-bold text-sm uppercase">
                      <History className="h-4 w-4" /> Última Compra
                    </div>
                    <div className="bg-purple-50/50 dark:bg-purple-900/10 p-3 rounded-lg border border-purple-100 dark:border-purple-900/30 h-full">
                      {item.last_purchase_date ? (
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-xs text-gray-500">Data:</span>
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                              {format(parseISO(item.last_purchase_date), 'dd/MM/yyyy')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-xs text-gray-500">Quantidade:</span>
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                              {item.last_purchase_quantity} {getUnitLabel(item.unit)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-xs text-gray-500">Preço Pago:</span>
                            <span className="text-xs font-bold text-purple-600 dark:text-purple-400">
                              R$ {(item.last_purchase_price || 0).toFixed(2).replace('.', ',')}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic flex items-center justify-center h-full">Sem histórico registrado</p>
                      )}
                    </div>
                  </div>

                  {/* Coluna 3: Estoque */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-sm uppercase">
                      <Database className="h-4 w-4" /> Situação do Estoque
                    </div>
                    <div className="bg-amber-50/50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-100 dark:border-amber-900/30 h-full flex flex-col justify-center">
                      <p className="text-xs text-gray-500 uppercase text-center mb-1">Quantidade em Stock</p>
                      <p className={`text-3xl font-black text-center ${
                        (item.stock_at_creation || 0) <= 0 ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'
                      }`}>
                        {item.stock_at_creation ?? 0}
                      </p>
                      <p className="text-[10px] text-gray-400 text-center mt-1 uppercase tracking-widest">
                        {getUnitLabel(item.unit)} disponíveis
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Barra de Ações Fixa no Rodapé */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-20">
        <div className="container mx-auto max-w-4xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="hidden md:block">
              <p className="text-xs text-gray-500 uppercase font-bold">Total do Orçamento</p>
              <p className="text-2xl font-black text-blue-600 dark:text-blue-400">
                R$ {budget.total_value.toFixed(2).replace('.', ',')}
              </p>
            </div>
            
            <div className="flex flex-1 md:flex-none items-center gap-2 w-full md:w-auto">
              {budget.status === 'pending' ? (
                <>
                  <button
                    onClick={handleCancelBudget}
                    className="flex-1 md:flex-none px-6 py-3 bg-white dark:bg-gray-700 text-red-600 border border-red-200 dark:border-red-900/50 rounded-xl font-bold hover:bg-red-50 transition-all flex items-center justify-center gap-2"
                  >
                    <XCircle className="h-5 w-5" /> Cancelar
                  </button>
                  <button
                    onClick={() => handleSaveChanges()}
                    className="flex-1 md:flex-none px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
                  >
                    <Save className="h-5 w-5" /> Salvar
                  </button>
                  <button
                    onClick={handleApproveBudget}
                    className="flex-[2] md:flex-none px-10 py-3 bg-green-600 text-white rounded-xl font-bold shadow-lg shadow-green-200 dark:shadow-none hover:bg-green-700 transform active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="h-5 w-5" /> Aprovar Compra
                  </button>
                </>
              ) : (
                <button
                  onClick={() => navigate(-1)}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="h-5 w-5" /> Voltar para a lista
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BudgetDetail;
