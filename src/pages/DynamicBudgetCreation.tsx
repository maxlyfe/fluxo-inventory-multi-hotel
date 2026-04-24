import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import {
  ArrowLeft, Search, Plus, Trash2, Link as LinkIcon, Copy, Check,
  Loader2, Globe, ListChecks, Edit2, MessageSquare, Package, ShoppingCart,
  X, ChevronDown, AlertTriangle,
} from 'lucide-react';
import WhatsAppContactPicker from '../components/WhatsAppContactPicker';

interface Product {
  id: string;
  name: string;
  category: string;
  image_url?: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  unit?: string;
}

interface BudgetItem {
  product_id: string;
  name: string;
  image_url?: string;
  requested_quantity: number;
  requested_unit: string;
}

const unitOptions = [
  { value: 'und',   label: 'Unidade (und)' },
  { value: 'kg',    label: 'Quilograma (kg)' },
  { value: 'g',     label: 'Grama (g)' },
  { value: 'l',     label: 'Litro (l)' },
  { value: 'ml',    label: 'Mililitro (ml)' },
  { value: 'cx',    label: 'Caixa (cx)' },
  { value: 'pct',   label: 'Pacote (pct)' },
  { value: 'fardo', label: 'Fardo' },
  { value: 'balde', label: 'Balde' },
  { value: 'saco',  label: 'Saco' },
  { value: 'galão', label: 'Galão' },
];

// ── Mini stock bar ─────────────────────────────────────────────────────────
const StockBar: React.FC<{ qty: number; min: number; max: number }> = ({ qty, min, max }) => {
  const pct   = max > 0 ? Math.min(100, (qty / max) * 100) : 0;
  const isLow = qty <= min;
  const color = qty === 0 ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <div className="flex-1 h-1 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-bold tabular-nums shrink-0 ${
        qty === 0 ? 'text-red-500' : isLow ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
      }`}>{qty}</span>
    </div>
  );
};

// ── Step indicator ─────────────────────────────────────────────────────────
const StepIndicator: React.FC<{ step: 1 | 2; current: 'selection' | 'review'; onChangeStep: (v: 'selection' | 'review') => void; hasItems: boolean }> =
  ({ step, current, onChangeStep, hasItems }) => {
    const active  = (step === 1 && current === 'selection') || (step === 2 && current === 'review');
    const done    = step === 1 && current === 'review';
    const blocked = step === 2 && !hasItems;
    return (
      <button
        type="button"
        onClick={() => !blocked && onChangeStep(step === 1 ? 'selection' : 'review')}
        disabled={blocked}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed
          ${active  ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20' : ''}
          ${done    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : ''}
          ${!active && !done ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600' : ''}`}
      >
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-black shrink-0
          ${active ? 'bg-white/20' : done ? 'bg-emerald-500 text-white' : 'bg-slate-300 dark:bg-slate-500 text-slate-600 dark:text-slate-300'}`}>
          {done ? <Check className="w-3 h-3" /> : step}
        </span>
        <span className="hidden sm:inline">{step === 1 ? 'Selecionar Itens' : 'Quantidades'}</span>
        <span className="sm:hidden">{step === 1 ? 'Seleção' : 'Quantidades'}</span>
      </button>
    );
  };

// ── Main ───────────────────────────────────────────────────────────────────
const DynamicBudgetCreation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>(() => {
    const init = location.state?.selectedProductDetails || [];
    if (init.length) addNotification(`${init.length} itens pré-selecionados adicionados.`, 'info');
    return init.map((p: Product) => ({
      product_id: p.id, name: p.name, image_url: p.image_url,
      requested_quantity: Math.max(0, (p.max_quantity ?? 0) - (p.quantity ?? 0)),
      requested_unit: p.unit || 'und',
    }));
  });

  const [budgetName, setBudgetName]       = useState('');
  const [loading, setLoading]             = useState(true);
  const [isSaving, setIsSaving]           = useState(false);
  const [searchTerm, setSearchTerm]       = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories]       = useState<string[]>([]);
  const [generatedLink, setGeneratedLink] = useState('');
  const [generatedBudgetId, setGeneratedBudgetId] = useState('');
  const [isCopied, setIsCopied]           = useState(false);
  const [view, setView]                   = useState<'selection' | 'review'>('selection');
  const [showWhatsApp, setShowWhatsApp]   = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      if (!selectedHotel?.id) { setLoading(false); return; }
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('products')
          .select('id, name, category, image_url, quantity, min_quantity, max_quantity, unit')
          .eq('hotel_id', selectedHotel.id).eq('is_active', true).order('name');
        if (error) throw error;
        setAllProducts(data || []);
        setCategories([...new Set(data.map(p => p.category).filter(Boolean))].sort());
      } catch (err: any) {
        addNotification('Erro ao carregar produtos: ' + err.message, 'error');
      } finally { setLoading(false); }
    };
    fetch();
  }, [selectedHotel, addNotification]);

  const filteredProducts = useMemo(() =>
    allProducts.filter(p => {
      const matchSearch   = p.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCategory = !selectedCategory || p.category === selectedCategory;
      const notInBudget   = !budgetItems.some(i => i.product_id === p.id);
      return matchSearch && matchCategory && notInBudget;
    }),
  [allProducts, searchTerm, selectedCategory, budgetItems]);

  const handleAdd = (product: Product) => {
    setBudgetItems(prev => [...prev, {
      product_id: product.id, name: product.name, image_url: product.image_url,
      requested_quantity: Math.max(0, (product.max_quantity ?? 0) - (product.quantity ?? 0)),
      requested_unit: product.unit || 'und',
    }]);
  };

  const handleRemove = (id: string) =>
    setBudgetItems(prev => prev.filter(i => i.product_id !== id));

  const handleQty = (id: string, qty: number) =>
    setBudgetItems(prev => prev.map(i => i.product_id === id ? { ...i, requested_quantity: Math.max(0, qty) } : i));

  const handleUnit = (id: string, unit: string) =>
    setBudgetItems(prev => prev.map(i => i.product_id === id ? { ...i, requested_unit: unit } : i));

  const handleSave = async () => {
    if (!budgetName.trim())   { addNotification('Dê um nome ao orçamento.', 'warning'); return; }
    if (!budgetItems.length)  { addNotification('Adicione pelo menos um item.', 'warning'); return; }
    if (!selectedHotel?.id || !user?.id) { addNotification('Sessão inválida.', 'error'); return; }
    setIsSaving(true);
    try {
      const { data: bd, error: be } = await supabase
        .from('dynamic_budgets').insert({ name: budgetName, hotel_id: selectedHotel.id, created_by: user.id })
        .select('id').single();
      if (be) throw be;
      const { error: ie } = await supabase.from('dynamic_budget_items').insert(
        budgetItems.map(item => ({
          budget_id: bd.id, product_id: item.product_id,
          requested_quantity: item.requested_quantity, requested_unit: item.requested_unit,
        }))
      );
      if (ie) throw ie;
      setGeneratedLink(`${window.location.origin}/quote/${bd.id}`);
      setGeneratedBudgetId(bd.id);
      addNotification('Orçamento criado e link gerado!', 'success');
    } catch (err: any) {
      addNotification('Erro ao salvar: ' + err.message, 'error');
    } finally { setIsSaving(false); }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedLink).then(() => {
      setIsCopied(true); setTimeout(() => setIsCopied(false), 2000);
    });
  };

  // ── Success state ──────────────────────────────────────────────────────
  if (generatedLink) {
    return (
      <div className="max-w-lg mx-auto px-4 py-10 space-y-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Link Gerado!</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6">
            Envie para seus fornecedores preencherem a cotação.
          </p>

          {/* Link copy */}
          <div className="flex items-stretch gap-0 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600 mb-6">
            <input
              readOnly value={generatedLink}
              className="flex-1 px-3 py-3 text-sm bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300 min-w-0"
            />
            <button
              onClick={handleCopy}
              className={`px-4 flex items-center gap-2 text-sm font-semibold transition-colors shrink-0
                ${isCopied ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
            >
              {isCopied ? <><Check className="w-4 h-4" />Copiado</> : <><Copy className="w-4 h-4" />Copiar</>}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setShowWhatsApp(true)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors"
            >
              <MessageSquare className="w-4 h-4" /> Enviar via WhatsApp
            </button>
            <button
              onClick={() => navigate('/purchases')}
              className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Concluir
            </button>
          </div>
        </div>

        <WhatsAppContactPicker
          isOpen={showWhatsApp} onClose={() => setShowWhatsApp(false)}
          budgetIds={[generatedBudgetId]}
          links={[{ budgetId: generatedBudgetId, link: generatedLink, hotelName: selectedHotel?.name }]}
        />
      </div>
    );
  }

  // ── Page wrapper ───────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/purchases')}
            className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-600/20 shrink-0">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white leading-tight">Novo Orçamento</h1>
            <p className="text-xs text-slate-400">{selectedHotel?.name}</p>
          </div>
        </div>

        {/* Steps */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl self-start sm:self-auto">
          <StepIndicator step={1} current={view} onChangeStep={setView} hasItems={budgetItems.length > 0} />
          <div className="w-4 h-px bg-slate-300 dark:bg-slate-600" />
          <StepIndicator step={2} current={view} onChangeStep={setView} hasItems={budgetItems.length > 0} />
        </div>
      </div>

      {/* ── VIEW: SELECTION ─────────────────────────────────────────────── */}
      {view === 'selection' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Left: Product catalogue */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
              <div className="p-4 border-b border-slate-100 dark:border-slate-700">
                <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4 text-blue-500" /> Inventário
                </h2>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      type="text" placeholder="Buscar produto…"
                      value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                    />
                    {searchTerm && (
                      <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <select
                    value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
                    className="sm:w-44 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                  >
                    <option value="">Todas categorias</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[55vh] p-4">
                {loading ? (
                  <div className="space-y-2">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 animate-pulse" />
                    ))}
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Package className="w-10 h-10 mb-3 opacity-40" />
                    <p className="text-sm font-medium">Nenhum produto encontrado</p>
                    <p className="text-xs mt-0.5">Ajuste a busca ou categoria</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {filteredProducts.map(product => (
                      <li key={product.id}
                        className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors group">
                        <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600 shrink-0">
                          {product.image_url
                            ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" loading="lazy" />
                            : <Package className="w-4 h-4 text-slate-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{product.name}</p>
                          <p className="text-[10px] text-slate-400 mb-0.5">{product.category}</p>
                          <StockBar qty={product.quantity} min={product.min_quantity} max={product.max_quantity} />
                        </div>
                        <button
                          onClick={() => handleAdd(product)}
                          className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 active:scale-95 transition-all shrink-0"
                          title="Adicionar ao orçamento"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {filteredProducts.length > 0 && (
                <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/80">
                  <p className="text-xs text-slate-400">{filteredProducts.length} produto{filteredProducts.length !== 1 ? 's' : ''} disponível{filteredProducts.length !== 1 ? 'is' : ''}</p>
                </div>
              )}
            </div>

            {/* Right: Cart — desktop only */}
            <div className="hidden lg:flex bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex-col">
              <div className="p-4 border-b border-slate-100 dark:border-slate-700">
                <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-blue-500" />
                  Selecionados
                  {budgetItems.length > 0 && (
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-blue-600 text-white text-xs font-bold">{budgetItems.length}</span>
                  )}
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[45vh] p-4">
                {budgetItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 py-8">
                    <ShoppingCart className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm text-center">Adicione produtos do inventário</p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {budgetItems.map(item => (
                      <li key={item.product_id}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-700/50 group">
                        <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600 shrink-0">
                          {item.image_url
                            ? <img src={item.image_url} alt={item.name} className="w-full h-full object-contain" />
                            : <Package className="w-3 h-3 text-slate-400" />}
                        </div>
                        <p className="flex-1 text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{item.name}</p>
                        <button
                          onClick={() => handleRemove(item.product_id)}
                          className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="p-4 border-t border-slate-100 dark:border-slate-700">
                <button
                  onClick={() => setView('review')}
                  disabled={budgetItems.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100 transition-all shadow-sm shadow-blue-600/20"
                >
                  Definir Quantidades
                </button>
              </div>
            </div>
          </div>

          {/* Mobile: Floating cart bar */}
          {budgetItems.length > 0 && (
            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 p-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-t border-slate-200 dark:border-slate-700 safe-area-bottom">
              <div className="flex gap-3 max-w-md mx-auto">
                <button
                  onClick={() => setShowMobileCart(true)}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold"
                >
                  <ShoppingCart className="w-4 h-4" />
                  <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-xs font-bold">{budgetItems.length}</span>
                </button>
                <button
                  onClick={() => setView('review')}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 active:scale-95 transition-all shadow-sm"
                >
                  Definir Quantidades
                </button>
              </div>
            </div>
          )}

          {/* Mobile cart sheet */}
          {showMobileCart && (
            <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end">
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileCart(false)} />
              <div className="relative bg-white dark:bg-slate-800 rounded-t-3xl max-h-[70vh] flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                    Itens selecionados ({budgetItems.length})
                  </h3>
                  <button onClick={() => setShowMobileCart(false)}
                    className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                  {budgetItems.map(item => (
                    <div key={item.product_id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                      <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600 shrink-0">
                        {item.image_url
                          ? <img src={item.image_url} alt={item.name} className="w-full h-full object-contain" />
                          : <Package className="w-4 h-4 text-slate-400" />}
                      </div>
                      <p className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{item.name}</p>
                      <button onClick={() => handleRemove(item.product_id)}
                        className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-slate-100 dark:border-slate-700">
                  <button onClick={() => { setShowMobileCart(false); setView('review'); }}
                    className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-bold">
                    Definir Quantidades
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── VIEW: REVIEW ────────────────────────────────────────────────── */}
      {view === 'review' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          {/* Budget name */}
          <div className="p-5 border-b border-slate-100 dark:border-slate-700">
            <label htmlFor="budgetName" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Nome do Orçamento *
            </label>
            <input
              id="budgetName" type="text" value={budgetName}
              onChange={e => setBudgetName(e.target.value)}
              placeholder="Ex: Cotação Semanal de Bebidas"
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Items */}
          <div className="p-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              {budgetItems.length} item{budgetItems.length !== 1 ? 's' : ''}
            </p>
            <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-1">
              {budgetItems.map(item => (
                <div key={item.product_id}
                  className="p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                  {/* Item header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600 shrink-0">
                      {item.image_url
                        ? <img src={item.image_url} alt={item.name} className="w-full h-full object-contain" />
                        : <Package className="w-4 h-4 text-slate-400" />}
                    </div>
                    <p className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.name}</p>
                    <button
                      onClick={() => handleRemove(item.product_id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {/* Qty + Unit */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Quantidade</label>
                      <input
                        type="text" inputMode="decimal"
                        value={item.requested_quantity}
                        onChange={e => handleQty(item.product_id, parseFloat(e.target.value) || 0)}
                        min="0" step="any"
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Unidade</label>
                      <select
                        value={item.requested_unit}
                        onChange={e => handleUnit(item.product_id, e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                      >
                        {unitOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 flex gap-3">
            <button
              onClick={() => setView('selection')}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !budgetItems.length || !budgetName.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100 transition-all shadow-sm shadow-blue-600/20"
            >
              {isSaving
                ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando…</>
                : <><LinkIcon className="w-4 h-4" />Salvar e Gerar Link</>}
            </button>
          </div>
        </div>
      )}

      {/* Bottom padding for mobile sticky bar */}
      {view === 'selection' && budgetItems.length > 0 && <div className="h-20 lg:hidden" />}
    </div>
  );
};

export default DynamicBudgetCreation;
