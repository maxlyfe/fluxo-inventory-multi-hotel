import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ShoppingCart, Search, Filter, ChevronDown, ChevronUp,
  Package, ArrowRight, History, Globe, BarChart2,
  Link as LinkIcon, Archive, ArchiveRestore, Loader2, Building2, AlertTriangle,
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
  unit?: string;
}

interface DynamicBudget {
    id: string;
    name: string;
    created_at: string;
    status: 'open' | 'closed';
    is_unified: boolean | null;
    group_id: string | null;
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
  const [showFilters, setShowFilters] = useState(true);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const navigate = useNavigate();

  const [dynamicBudgets, setDynamicBudgets] = useState<DynamicBudget[]>([]);
  const [loadingBudgets, setLoadingBudgets] = useState(true);
  const [budgetView, setBudgetView] = useState<'open' | 'closed'>('open');
  const [updatingBudgetId, setUpdatingBudgetId] = useState<string | null>(null);

  const fetchAllData = async () => {
    if (!selectedHotel?.id) { setLoading(false); setLoadingBudgets(false); return; }
    try {
      setLoading(true); setLoadingBudgets(true); setError(null);
      const { data: productsData, error: productsError } = await supabase.from('products').select('*').eq('hotel_id', selectedHotel.id).order('name');
      if (productsError) throw productsError;
      const lowStockProducts = (productsData || []).filter(p => p.quantity <= p.min_quantity);
      setProducts(lowStockProducts);
      setSuppliers([...new Set(lowStockProducts.map(p => p.supplier).filter(Boolean))].sort());
      const { data: budgetsData, error: budgetsError } = await supabase
        .from('dynamic_budgets').select(`id,name,created_at,status,is_unified,group_id,supplier_quotes(count)`)
        .eq('hotel_id', selectedHotel.id).in('status', ['open', 'closed']).or('is_unified.is.null,is_unified.eq.false').order('created_at', { ascending: false });
      if (budgetsError) throw budgetsError;
      setDynamicBudgets(budgetsData as DynamicBudget[]);
    } catch (err: any) { setError('Erro ao carregar dados'); }
    finally { setLoading(false); setLoadingBudgets(false); }
  };

  useEffect(() => { fetchAllData(); }, [selectedHotel]);

  const handleCreateOrder = () => {
    if (selectedProducts.size > 0) navigate('/purchases/list', { state: { selectedProductDetails: products.filter(p => selectedProducts.has(p.id)) } });
    else navigate('/purchases/list');
  };

  const handleCreateDynamicBudget = () => {
    if (selectedProducts.size > 0) navigate('/purchases/dynamic-budget/new', { state: { selectedProductDetails: products.filter(p => selectedProducts.has(p.id)) } });
    else navigate('/purchases/dynamic-budget/new');
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProducts(prev => { const n = new Set(prev); n.has(productId) ? n.delete(productId) : n.add(productId); return n; });
  };

  const handleCopyLink = (budgetId: string) => {
    const link = `${window.location.origin}/quote/${budgetId}`;
    navigator.clipboard.writeText(link).then(() => addNotification('Link copiado!', 'success')).catch(() => addNotification('Falha ao copiar o link.', 'error'));
  };

  const handleToggleBudgetStatus = async (budgetId: string, currentStatus: 'open' | 'closed') => {
    const newStatus = currentStatus === 'open' ? 'closed' : 'open';
    setUpdatingBudgetId(budgetId);
    try {
      const { error } = await supabase.from('dynamic_budgets').update({ status: newStatus }).eq('id', budgetId);
      if (error) throw error;
      addNotification(`Orçamento ${newStatus === 'closed' ? 'arquivado' : 'reativado'}!`, 'success');
      setDynamicBudgets(prev => prev.map(b => b.id === budgetId ? { ...b, status: newStatus } : b));
    } catch { addNotification('Erro ao atualizar orçamento.', 'error'); }
    finally { setUpdatingBudgetId(null); }
  };

  const filteredProducts = products.filter(p => {
    const ms = !selectedSupplier || p.supplier === selectedSupplier;
    const mt = searchTerm === '' || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || (p.supplier || '').toLowerCase().includes(searchTerm.toLowerCase());
    return ms && mt;
  });

  if (loading || loadingBudgets) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-2" /><p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p></div>
    </div>
  );

  const visibleBudgets = dynamicBudgets.filter(b => b.status === budgetView);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
            <ShoppingCart className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white leading-tight">Compras</h1>
            <p className="text-xs text-slate-400">{products.length} ite{products.length !== 1 ? 'ns' : 'm'} com estoque baixo</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => navigate('/purchases/multi-hotel')} className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold transition-all shadow-sm">
            <Building2 className="w-4 h-4" />Multi-Hotel
          </button>
          <button onClick={handleCreateDynamicBudget} className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-semibold transition-all shadow-sm">
            <Globe className="w-4 h-4" />Orçamento Dinâmico
          </button>
          <button onClick={() => navigate('/purchases/online')} className="flex items-center gap-1.5 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-sm font-semibold transition-all shadow-sm">
            <ShoppingCart className="w-4 h-4" />Orçamento Online
          </button>
          <button onClick={() => navigate('/budget-history')} className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-all shadow-sm">
            <History className="w-4 h-4" />Histórico
          </button>
          <button onClick={handleCreateOrder} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-all shadow-sm">
            <ArrowRight className="w-4 h-4" />Criar Orçamento Físico
          </button>
        </div>
      </div>

      {/* ── Orçamentos Dinâmicos ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-0">
          <h2 className="text-base font-bold text-slate-800 dark:text-white mb-4">Orçamentos Dinâmicos</h2>
          <div className="flex gap-6 border-b border-slate-200 dark:border-slate-700">
            {(['open', 'closed'] as const).map(v => (
              <button key={v} onClick={() => setBudgetView(v)}
                className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${budgetView === v ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
                {v === 'open' ? 'Em Aberto' : 'Arquivados'}
                {dynamicBudgets.filter(b => b.status === v).length > 0 && (
                  <span className="ml-1.5 text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full px-1.5 py-0.5">{dynamicBudgets.filter(b => b.status === v).length}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          {visibleBudgets.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-3">
                <Globe className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum orçamento {budgetView === 'open' ? 'em aberto' : 'arquivado'}.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleBudgets.map(budget => (
                <div key={budget.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 truncate">{budget.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Criado em: {new Date(budget.created_at).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <div className="flex items-center gap-1 bg-white dark:bg-slate-700 rounded-xl px-3 py-1.5 border border-slate-200 dark:border-slate-600">
                    <span className="text-base font-bold text-slate-800 dark:text-white">{budget.supplier_quotes[0].count}</span>
                    <span className="text-xs text-slate-400 ml-1">respostas</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleCopyLink(budget.id)} title="Copiar Link" className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"><LinkIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" /></button>
                    <Link to={`/purchases/dynamic-budget/analysis/${budget.id}`} title="Analisar" className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"><BarChart2 className="w-4 h-4 text-slate-500 dark:text-slate-400" /></Link>
                    <button onClick={() => handleToggleBudgetStatus(budget.id, budget.status)} title={budget.status === 'open' ? 'Arquivar' : 'Reativar'} className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors" disabled={updatingBudgetId === budget.id}>
                      {updatingBudgetId === budget.id ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : budget.status === 'open' ? <Archive className="w-4 h-4 text-red-500" /> : <ArchiveRestore className="w-4 h-4 text-emerald-500" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Itens com Estoque Baixo ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white leading-tight">Itens com Estoque Baixo</h2>
              {selectedProducts.size > 0 && <p className="text-xs text-blue-500">{selectedProducts.size} selecionado{selectedProducts.size !== 1 ? 's' : ''}</p>}
            </div>
          </div>
          <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <Filter className="w-4 h-4" />{showFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {showFilters && (
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Buscar por nome ou fornecedor..."
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors" />
            </div>
            <select value={selectedSupplier} onChange={e => setSelectedSupplier(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors">
              <option value="">Todos os Fornecedores</option>
              {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-3">
                <Package className="w-7 h-7 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Nenhum item encontrado</p>
              <p className="text-xs text-slate-400 mt-1">{searchTerm || selectedSupplier ? 'Tente ajustar os filtros.' : 'Todos os itens estão com estoque adequado.'}</p>
            </div>
          ) : (
            filteredProducts.map(product => {
              const isSelected = selectedProducts.has(product.id);
              const quantityToBuy = product.max_quantity - product.quantity;
              const pct = product.max_quantity > 0 ? Math.min(100, (product.quantity / product.max_quantity) * 100) : 0;
              return (
                <div key={product.id}
                  className={`p-4 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}
                  onClick={() => toggleProductSelection(product.id)}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0 overflow-hidden border border-slate-200 dark:border-slate-600">
                      {product.image_url
                        ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        : <Package className="w-5 h-5 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{product.name}</p>
                      <p className="text-xs text-slate-400">{product.supplier || 'Sem fornecedor'}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden max-w-[100px]">
                          <div className="h-full bg-red-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-red-500 font-semibold">{product.quantity}</span>
                        <span className="text-xs text-slate-400">min {product.min_quantity}</span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">+{quantityToBuy}</span>
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300 dark:border-slate-600'}`}>
                      {isSelected && <svg className="w-3 h-3 text-white" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default PurchaseOrders;
