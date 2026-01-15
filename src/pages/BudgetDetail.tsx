import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Download, ChevronDown, ChevronUp, Box, Package, Truck, Trash2, Save } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNotification } from '../context/NotificationContext';
import { getBudgetDetails, updateBudgetItems } from '../lib/supabase';
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
  hotel: {
    name: string;
  } | null;
  budget_items: BudgetItemDetail[];
  approved_by_user_email?: string | null;
  approved_at?: string | null;
}

const BudgetDetail = () => {
  const { budgetId } = useParams<{ budgetId: string }>();
  const navigate = useNavigate();
  const { addNotification } = useNotification();
  const [budget, setBudget] = useState<BudgetDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
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
          // Inicializa todos os itens como recolhidos
          const initialExpandedState = result.data.budget_items.reduce((acc, item) => {
            acc[item.id] = false;
            return acc;
          }, {} as Record<string, boolean>);
          setExpandedItems(initialExpandedState);
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

    fetchDetails();
  }, [budgetId, addNotification]);

  const getUnitLabel = (unitValue: string | null | undefined): string => {
    if (!unitValue) return '-';
    const option = unitOptions.find(opt => opt.value === unitValue);
    return option ? option.label : unitValue;
  };

  const toggleItemExpand = (itemId: string) => {
    setExpandedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
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

  const handleSaveChanges = async () => {
    if (!budget || !budgetId) return;

    try {
      setLoading(true);
      const result = await updateBudgetItems(budgetId, budget.budget_items, budget.total_value);
      
      if (result.success) {
        addNotification("Alterações salvas com sucesso!", "success");
      } else {
        throw new Error(result.error || "Falha ao salvar alterações");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao salvar alterações.";
      addNotification(message, "error");
    } finally {
      setLoading(false);
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
    
    if (Object.keys(supplierCounts).length > 1 && maxCount > 0) {
      return `${mainSupplier} (e outros)`;
    }
    
    return mainSupplier;
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

  const DetailItem = ({ label, value }: { label: string; value: string | number }) => (
    <div className="mb-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800 dark:text-white break-words">{value}</p>
    </div>
  );

  const BudgetItemCard = ({ item }: { item: BudgetItemDetail }) => {
    const isExpanded = expandedItems[item.id];
    const itemName = item.custom_item_name || item.product?.name || 'Item Desconhecido';
    const totalValue = item.quantity * (item.unit_price || 0);
    const lastPurchaseInfo = item.last_purchase_date
      ? `${format(parseISO(item.last_purchase_date), 'dd/MM/yy')} (${item.last_purchase_quantity ?? '?'} @ R$${(item.last_purchase_price ?? 0).toFixed(2).replace('.', ',')})`
      : 'Nenhum histórico';

    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-3 overflow-hidden">
        <div className="p-4 flex justify-between items-center">
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleItemExpand(item.id)}>
            <h3 className="text-sm font-medium text-gray-800 dark:text-white truncate">
              {itemName}
            </h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              <div className="flex items-center">
                <input
                  type="number"
                  value={item.quantity}
                  onChange={(e) => handleUpdateItemQuantity(item.id, parseFloat(e.target.value) || 0)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-16 p-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 mr-1"
                  min="0"
                  step="any"
                />
                <span className="text-xs text-gray-600 dark:text-gray-300">
                  {getUnitLabel(item.unit)}
                </span>
              </div>
              <span className="text-xs font-semibold text-gray-800 dark:text-white flex items-center">
                R$ {totalValue.toFixed(2).replace('.', ',')}
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleRemoveItem(item.id)}
              className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors"
              title="Remover item"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <div className="cursor-pointer p-1" onClick={() => toggleItemExpand(item.id)}>
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              )}
            </div>
          </div>
        </div>
        
        {isExpanded && (
          <div className="p-4 pt-0 border-t border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-2 gap-4">
              <DetailItem label="Fornecedor" value={item.supplier || 'Não especificado'} />
              <DetailItem label="Valor Unitário" value={`R$ ${(item.unit_price || 0).toFixed(2).replace('.', ',')}`} />
              <DetailItem label="Estoque" value={item.stock_at_creation ?? '-'} />
              <DetailItem label="Última Compra" value={lastPurchaseInfo} />
              {item.weight && <DetailItem label="Peso" value={`${item.weight} kg`} />}
            </div>
            {item.custom_item_name && (
              <div className="mt-2">
                <span className="inline-block text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300 px-2 py-1 rounded">
                  Item Personalizado
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-16">
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
              Detalhes do Orçamento
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

      {/* Conteúdo Principal */}
      <div className="container mx-auto px-4 py-6">
        {/* Informações do cabeçalho */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white flex items-center">
              <Truck className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-2" />
              {getMainSupplier()}
            </h2>
            <span className="text-sm font-medium px-3 py-1 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 rounded-full">
              {budget.hotel?.name || 'Hotel não especificado'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Data</p>
              <p className="text-sm font-medium text-gray-800 dark:text-white">
                {format(parseISO(budget.created_at), 'dd/MM/yyyy', { locale: ptBR })}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Valor Total</p>
              <p className="text-sm font-semibold text-gray-800 dark:text-white">
                R$ {budget.total_value.toFixed(2).replace('.', ',')}
              </p>
            </div>
          </div>

          {budget.approved_by_user_email && budget.approved_at && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">Aprovado por</p>
              <p className="text-sm text-gray-800 dark:text-white">
                {budget.approved_by_user_email.split('@')[0]} em {format(parseISO(budget.approved_at), 'dd/MM/yyyy', { locale: ptBR })}
              </p>
            </div>
          )}
        </div>

        {/* Lista de Itens */}
        <div className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center">
            <Box className="h-5 w-5 text-gray-600 dark:text-gray-400 mr-2" />
            Itens do Orçamento ({budget.budget_items.length})
          </h2>

          <div className="space-y-3">
            {budget.budget_items.map(item => (
              <BudgetItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>

        {/* Botão de Ação */}
        <div className="fixed bottom-4 left-0 right-0 px-4 flex flex-col items-center space-y-2">
          <button
            onClick={handleSaveChanges}
            className="w-full max-w-md px-4 py-3 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition-colors flex items-center justify-center"
          >
            <Save className="h-5 w-5 mr-2" />
            Salvar Alterações
          </button>
          <button
            onClick={() => navigate(-1)}
            className="w-full max-w-md px-4 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors flex items-center justify-center"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Voltar para a lista
          </button>
        </div>
      </div>
    </div>
  );
};

export default BudgetDetail;
