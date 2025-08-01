import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  ShoppingCart, Search, Filter, ChevronDown, ChevronUp,
  Package, ArrowRight, History, Globe, BarChart2,
  Link as LinkIcon, Archive, ArchiveRestore, Loader2
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';

interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  category: string;
  supplier?: string;
  image_url?: string;
  description?: string;
  last_purchase_date?: string;
  last_purchase_price?: number;
  average_price?: number;
}

interface DynamicBudget {
    id: string;
    name: string;
    created_at: string;
    status: 'open' | 'closed';
    supplier_quotes: { count: number }[];
}

const PurchaseOrders = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const navigate = useNavigate();

  const [dynamicBudgets, setDynamicBudgets] = useState<DynamicBudget[]>([]);
  const [loadingBudgets, setLoadingBudgets] = useState(true);
  // --- ALTERAÇÃO: Estado para controlar a visualização dos orçamentos ---
  const [budgetView, setBudgetView] = useState<'open' | 'closed'>('open');
  const [updatingBudgetId, setUpdatingBudgetId] = useState<string | null>(null);

  const fetchAllData = async () => {
    if (!selectedHotel?.id) {
        setLoading(false);
        setLoadingBudgets(false);
        return;
    };
    try {
        setLoading(true);
        setLoadingBudgets(true);
        setError(null);

        // Fetch low stock products
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*')
          .eq('hotel_id', selectedHotel.id)
          .order('supplier')
          .order('name');

        if (productsError) throw productsError;

        const lowStockProducts = (productsData || []).filter(product => 
          product.quantity <= product.min_quantity
        );
        setProducts(lowStockProducts);
        
        const uniqueSuppliers = [...new Set(lowStockProducts.map(p => p.supplier).filter(Boolean))].sort();
        setSuppliers(uniqueSuppliers);

        // Fetch all dynamic budgets
        const { data: budgetsData, error: budgetsError } = await supabase
            .from('dynamic_budgets')
            .select(`
                id,
                name,
                created_at,
                status,
                supplier_quotes(count)
            `)
            .eq('hotel_id', selectedHotel.id)
            .in('status', ['open', 'closed'])
            .order('created_at', { ascending: false });

        if (budgetsError) throw budgetsError;
        setDynamicBudgets(budgetsData as DynamicBudget[]);

    } catch (err: any) {
        console.error('Error fetching data:', err);
        setError('Erro ao carregar dados');
    } finally {
        setLoading(false);
        setLoadingBudgets(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, [selectedHotel]);

  const handleCreateOrder = () => {
    if (selectedProducts.size > 0) {
      const selectedProductDetails = products.filter(p => selectedProducts.has(p.id));
      navigate('/purchases/list', { 
        state: { selectedProductDetails }
      });
    } else {
      navigate('/purchases/list');
    }
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProducts(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(productId)) {
        newSelected.delete(productId);
      } else {
        newSelected.add(productId);
      }
      return newSelected;
    });
  };

  // --- ALTERAÇÃO: Novas funções para gerenciar orçamentos dinâmicos ---
  const handleCopyLink = (budgetId: string) => {
    const link = `${window.location.origin}/quote/${budgetId}`;
    navigator.clipboard.writeText(link).then(() => {
      addNotification('Link copiado para a área de transferência!', 'success');
    }).catch(() => {
      addNotification('Falha ao copiar o link.', 'error');
    });
  };

  const handleToggleBudgetStatus = async (budgetId: string, currentStatus: 'open' | 'closed') => {
    const newStatus = currentStatus === 'open' ? 'closed' : 'open';
    const actionText = newStatus === 'closed' ? 'arquivar' : 'reativar';

    setUpdatingBudgetId(budgetId);
    try {
        const { error } = await supabase
            .from('dynamic_budgets')
            .update({ status: newStatus })
            .eq('id', budgetId);
        
        if (error) throw error;

        addNotification(`Orçamento ${actionText === 'arquivar' ? 'arquivado' : 'reativado'} com sucesso!`, 'success');
        // Atualiza o estado local para refletir a mudança imediatamente
        setDynamicBudgets(prev => prev.map(b => b.id === budgetId ? {...b, status: newStatus} : b));

    } catch (err: any) {
        addNotification(`Erro ao ${actionText} o orçamento.`, 'error');
    } finally {
        setUpdatingBudgetId(null);
    }
  };

  const filteredProducts = products.filter(product => {
    const matchesSupplier = !selectedSupplier || product.supplier === selectedSupplier;
    const matchesSearch = searchTerm === '' || 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.supplier || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSupplier && matchesSearch;
  });

  const groupedProducts = filteredProducts.reduce((acc, product) => {
    const supplier = product.supplier || 'Sem Fornecedor';
    if (!acc[supplier]) {
      acc[supplier] = [];
    }
    acc[supplier].push(product);
    return acc;
  }, {} as Record<string, Product[]>);

  if (loading || loadingBudgets) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white flex items-center">
          <ShoppingCart className="h-8 w-8 text-blue-600 dark:text-blue-400 mr-3" />
          Compras
        </h1>
        <div className="flex items-center space-x-2 sm:space-x-4 mt-4 md:mt-0 flex-wrap">
          <button onClick={() => navigate("/purchases/dynamic-budget/new")} className="flex items-center px-3 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors text-sm sm:text-base">
            <Globe className="w-5 h-5 mr-2" />
            Orçamento Dinâmico
          </button>
          <button onClick={() => navigate("/budget-history")} className="flex items-center px-3 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors text-sm sm:text-base">
            <History className="w-5 h-5 mr-2" />
            Histórico
          </button>
          <button onClick={handleCreateOrder} className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm sm:text-base">
            <ArrowRight className="w-5 h-5 mr-2" />
            Criar Orçamento Físico
          </button>
        </div>
      </div>

      {/* --- ALTERAÇÃO: Seção de Orçamentos Dinâmicos com abas --- */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Orçamentos Dinâmicos</h2>
        <div className="border-b border-gray-200 dark:border-gray-700 mb-4">
            <nav className="-mb-px flex space-x-6" aria-label="Tabs">
                <button onClick={() => setBudgetView('open')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${budgetView === 'open' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'}`}>
                    Em Aberto
                </button>
                <button onClick={() => setBudgetView('closed')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${budgetView === 'closed' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'}`}>
                    Arquivados
                </button>
            </nav>
        </div>
        
        {loadingBudgets ? (
            <p>Carregando...</p>
        ) : dynamicBudgets.filter(b => b.status === budgetView).length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400 py-4">Nenhum orçamento {budgetView === 'open' ? 'em aberto' : 'arquivado'}.</p>
        ) : (
            <div className="space-y-3">
                {dynamicBudgets.filter(b => b.status === budgetView).map(budget => (
                    <div key={budget.id} className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                        <div className="flex flex-wrap justify-between items-center gap-4">
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-blue-600 dark:text-blue-400 truncate">{budget.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Criado em: {new Date(budget.created_at).toLocaleDateString('pt-BR')}</p>
                            </div>
                            <div className="text-center">
                                <p className="font-bold text-lg text-gray-800 dark:text-white">{budget.supplier_quotes[0].count}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Respostas</p>
                            </div>
                            <div className="flex items-center space-x-2 flex-wrap">
                                <button onClick={() => handleCopyLink(budget.id)} title="Copiar Link" className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"><LinkIcon className="h-5 w-5 text-gray-500 dark:text-gray-400"/></button>
                                <Link to={`/purchases/dynamic-budget/analysis/${budget.id}`} title="Analisar" className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"><BarChart2 className="h-5 w-5 text-gray-500 dark:text-gray-400"/></Link>
                                <button onClick={() => handleToggleBudgetStatus(budget.id, budget.status)} title={budget.status === 'open' ? 'Arquivar' : 'Reativar'} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600" disabled={updatingBudgetId === budget.id}>
                                    {updatingBudgetId === budget.id ? <Loader2 className="h-5 w-5 animate-spin"/> : (budget.status === 'open' ? <Archive className="h-5 w-5 text-red-500 dark:text-red-400"/> : <ArchiveRestore className="h-5 w-5 text-green-500 dark:text-green-400"/>)}
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        )}
      </div>
      
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-blue-800 dark:text-blue-200 mb-2">Itens com Estoque Baixo</h2>
        <p className="text-blue-700 dark:text-blue-300">Selecione os itens abaixo para criar um orçamento físico.</p>
      </div>

      <div className="space-y-8">
        {Object.entries(groupedProducts).map(([supplier, items]) => (
          <div key={supplier} className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700"><h2 className="text-xl font-semibold text-gray-800 dark:text-white">{supplier}</h2></div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((product) => {
                const isSelected = selectedProducts.has(product.id);
                const quantityToBuy = product.max_quantity - product.quantity;
                return (
                  <div key={product.id} className={`p-4 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`} onClick={() => toggleProductSelection(product.id)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="h-16 w-16 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center">
                          {product.image_url ? (<img src={product.image_url} alt={product.name} className="h-full w-full object-contain" />) : (<Package className="h-8 w-8 text-gray-400" />)}
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-200">{product.name}</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Estoque: {product.quantity} | Comprar: {quantityToBuy}</p>
                          {product.last_purchase_price && (<p className="text-sm text-gray-500 dark:text-gray-400">Último preço: R$ {product.last_purchase_price.toFixed(2)}</p>)}
                        </div>
                      </div>
                      <div className="flex items-center">
                        <div className={`w-6 h-6 rounded-full border-2 ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
                          {isSelected && (<svg className="w-5 h-5 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {filteredProducts.length === 0 && (<div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center"><Package className="h-16 w-16 text-gray-400 mx-auto mb-4" /><h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Nenhum item encontrado</h2><p className="text-gray-600 dark:text-gray-400">Não há itens com estoque baixo que correspondam aos filtros selecionados.</p></div>)}
      </div>
    </div>
  );
};

export default PurchaseOrders;
