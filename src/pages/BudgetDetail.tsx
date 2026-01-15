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
  ShoppingBag
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
    if (!budget || !window.confirm("Remover este item?")) return;
    
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
        if (!silent) addNotification("Alterações salvas!", "success");
        return true;
      } else {
        throw new Error(result.error || "Falha ao salvar");
      }
    } catch (err) {
      addNotification(err instanceof Error ? err.message : "Erro ao salvar", "error");
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
    suppliers.forEach(supplier => { if (supplier) supplierCounts[supplier] = (supplierCounts[supplier] || 0) + 1; });
    let mainSupplier = suppliers[0] || 'Não especificado';
    let maxCount = 0;
    Object.entries(supplierCounts).forEach(([supplier, count]) => { if (count > maxCount) { maxCount = count; mainSupplier = supplier; } });
    return mainSupplier;
  };

  const handleApproveBudget = async () => {
    if (!budget || !budgetId || !user?.email) {
      addNotification("Dados incompletos.", "error");
      return;
    }
    if (!window.confirm("Aprovar este orçamento?")) return;
    try {
      setLoading(true);
      const saved = await handleSaveChanges(true);
      if (!saved) return;
      const result = await updateBudgetStatus(budgetId, "approved", user.email);
      if (result.success) {
        addNotification("Orçamento aprovado!", "success");
        try {
          await createNotification({
            event_type: 'BUDGET_APPROVED',
            hotel_id: budget.hotel_id,
            title: 'Orçamento aprovado',
            content: `Orçamento de ${getMainSupplier()} (R$ ${budget.total_value.toFixed(2).replace('.', ',')}) aprovado por ${user.email.split('@')[0]}`,
            link: `/budget/${budgetId}`,
            metadata: { budget_id: budgetId, total_value: budget.total_value, supplier: getMainSupplier(), approved_by: user.email, items_count: budget.budget_items.length }
          });
        } catch (nErr) { console.error(nErr); }
        fetchDetails();
      } else { throw new Error(result.error || "Falha ao aprovar"); }
    } catch (err) { addNotification(err instanceof Error ? err.message : "Erro ao aprovar", "error"); } finally { setLoading(false); }
  };

  const handleCancelBudget = async () => {
    if (!budget || !budgetId) return;
    if (!window.confirm("Cancelar este orçamento?")) return;
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
            content: `Orçamento de ${getMainSupplier()} (R$ ${budget.total_value.toFixed(2).replace('.', ',')}) cancelado`,
            link: `/budget/${budgetId}`,
            metadata: { budget_id: budgetId, total_value: budget.total_value, supplier: getMainSupplier(), cancelled_by: user?.email || 'Sistema' }
          });
        } catch (nErr) { console.error(nErr); }
        fetchDetails();
      } else { throw new Error(result.error || "Falha ao cancelar"); }
    } catch (err) { addNotification(err instanceof Error ? err.message : "Erro ao cancelar", "error"); } finally { setLoading(false); }
  };

  const exportBudgetToExcel = () => {
    if (!budget) return;
    const listData = budget.budget_items.map(item => ({
      'Item': item.custom_item_name || item.product?.name || 'Item Desconhecido',
      'Quantidade': item.quantity,
      'Unidade': getUnitLabel(item.unit),
      'Fornecedor': item.supplier || '-',
      'Valor Unitário': item.unit_price || 0,
      'Valor Total': item.quantity * (item.unit_price || 0),
      'Estoque': item.stock_at_creation ?? '-',
      'Últ. Compra': item.last_purchase_date ? format(parseISO(item.last_purchase_date), 'dd/MM/yyyy') : '-',
      'Últ. Qtd.': item.last_purchase_quantity ?? '-',
      'Últ. Preço': item.last_purchase_price ?? '-'
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(listData);
    XLSX.utils.book_append_sheet(wb, ws, 'Itens');
    try {
      XLSX.writeFile(wb, `orcamento_${format(parseISO(budget.created_at), 'dd-MM-yyyy')}.xlsx`);
      addNotification('Exportado!', 'success');
    } catch (e) { addNotification('Erro ao exportar.', 'error'); }
  };

  if (loading && !budget) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !budget) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 flex items-center justify-center">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 max-w-md w-full text-center">
          <h2 className="text-lg font-semibold mb-4">Erro ao Carregar</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{error || 'Orçamento não encontrado.'}</p>
          <button onClick={() => navigate(-1)} className="px-4 py-2 bg-blue-600 text-white rounded-md flex items-center mx-auto">
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-24">
      {/* Header Slim */}
      <div className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-3 py-2 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-300" />
          </button>
          <div className="text-center">
            <h1 className="text-sm font-bold text-gray-800 dark:text-white">Aprovação de Orçamento</h1>
            <p className="text-[10px] text-gray-500 uppercase">{budget.hotel?.name}</p>
          </div>
          <button onClick={exportBudgetToExcel} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <Download className="h-5 w-5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>
      </div>

      <div className="container mx-auto px-2 py-3">
        {/* Resumo Slim */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 mb-3 border border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <Truck className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight">{getMainSupplier()}</h2>
              <p className="text-[10px] text-gray-500">{format(parseISO(budget.created_at), 'dd/MM/yy HH:mm')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 uppercase font-bold">Total</p>
            <p className="text-lg font-black text-blue-600 dark:text-blue-400">R$ {budget.total_value.toFixed(2).replace('.', ',')}</p>
          </div>
        </div>

        {/* Lista Slim */}
        <div className="space-y-2">
          {budget.budget_items.map((item) => {
            const itemName = item.custom_item_name || item.product?.name || 'Item Desconhecido';
            const itemTotal = item.quantity * (item.unit_price || 0);
            
            return (
              <div key={item.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Linha Principal */}
                <div className="p-2 flex items-center justify-between gap-2 border-b border-gray-50 dark:border-gray-700/50">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-gray-900 dark:text-white truncate">{itemName}</h4>
                    <p className="text-[9px] text-gray-400 uppercase">{item.product?.category || 'Geral'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-100 dark:border-blue-900/30">
                      <input
                        type="number"
                        value={item.quantity}
                        disabled={budget.status !== 'pending'}
                        onChange={(e) => handleUpdateItemQuantity(item.id, parseFloat(e.target.value) || 0)}
                        className="w-12 bg-transparent text-xs font-bold text-blue-700 dark:text-blue-300 outline-none text-center"
                        min="0"
                        step="any"
                      />
                      <span className="text-[9px] font-medium text-blue-600/70 ml-1">{getUnitLabel(item.unit)}</span>
                    </div>
                    {budget.status === 'pending' && (
                      <button onClick={() => handleRemoveItem(item.id)} className="p-1.5 text-red-400 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Grid de Dados Slim */}
                <div className="p-2 grid grid-cols-3 gap-2 bg-gray-50/30 dark:bg-gray-900/10">
                  {/* Preços */}
                  <div className="border-r border-gray-100 dark:border-gray-700 pr-2">
                    <div className="flex items-center gap-1 text-[9px] text-blue-500 font-bold uppercase mb-1">
                      <ShoppingBag className="h-2.5 w-2.5" /> Atual
                    </div>
                    <p className="text-[10px] font-medium text-gray-600 dark:text-gray-400">Unit: R${(item.unit_price || 0).toFixed(2)}</p>
                    <p className="text-[10px] font-bold text-blue-600">Total: R${itemTotal.toFixed(2)}</p>
                  </div>

                  {/* Histórico */}
                  <div className="border-r border-gray-100 dark:border-gray-700 px-2">
                    <div className="flex items-center gap-1 text-[9px] text-purple-500 font-bold uppercase mb-1">
                      <History className="h-2.5 w-2.5" /> Última
                    </div>
                    {item.last_purchase_date ? (
                      <>
                        <p className="text-[10px] font-medium text-gray-600 dark:text-gray-400">{item.last_purchase_quantity}{getUnitLabel(item.unit)} @ R${(item.last_purchase_price || 0).toFixed(2)}</p>
                        <p className="text-[9px] text-gray-400">{format(parseISO(item.last_purchase_date), 'dd/MM/yy')}</p>
                      </>
                    ) : <p className="text-[9px] text-gray-400 italic">Sem dados</p>}
                  </div>

                  {/* Estoque */}
                  <div className="pl-2">
                    <div className="flex items-center gap-1 text-[9px] text-amber-500 font-bold uppercase mb-1">
                      <Database className="h-2.5 w-2.5" /> Stock
                    </div>
                    <p className={`text-xs font-black ${(item.stock_at_creation || 0) <= 0 ? 'text-red-500' : 'text-amber-600'}`}>
                      {item.stock_at_creation ?? 0} <span className="text-[9px] font-normal text-gray-400">{getUnitLabel(item.unit)}</span>
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Fixo Slim */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-2 shadow-lg z-20">
        <div className="container mx-auto max-w-4xl flex items-center justify-between gap-2">
          <div className="min-w-fit">
            <p className="text-[9px] text-gray-400 uppercase font-bold">Total Geral</p>
            <p className="text-base font-black text-blue-600 dark:text-blue-400 leading-none">R$ {budget.total_value.toFixed(2).replace('.', ',')}</p>
          </div>
          
          <div className="flex items-center gap-1.5 flex-1 justify-end">
            {budget.status === 'pending' ? (
              <>
                <button onClick={handleCancelBudget} className="p-2 text-red-600 border border-red-100 dark:border-red-900/30 rounded-lg hover:bg-red-50">
                  <XCircle className="h-5 w-5" />
                </button>
                <button onClick={() => handleSaveChanges()} className="p-2 text-gray-600 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200">
                  <Save className="h-5 w-5" />
                </button>
                <button onClick={handleApproveBudget} className="flex-1 max-w-[150px] py-2.5 bg-green-600 text-white rounded-lg font-bold text-xs shadow-md hover:bg-green-700 flex items-center justify-center gap-1">
                  <CheckCircle className="h-4 w-4" /> APROVAR
                </button>
              </>
            ) : (
              <button onClick={() => navigate(-1)} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2">
                <ArrowLeft className="h-4 w-4" /> VOLTAR
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BudgetDetail;
