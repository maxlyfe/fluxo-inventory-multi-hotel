// src/pages/NewPurchase.tsx
// Redesenhado — slate design system, layout com seções cards,
// itens como cards responsivos, sticky footer com total + submit.

import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft, Search, Plus, Trash2, DollarSign, Package,
  AlertTriangle, X, FileText, Building2, Calendar,
  StickyNote, ChevronDown, Loader2, ShoppingCart,
  CheckCircle, Info, Minus,
} from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import { useHotel } from '../context/HotelContext';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  category: string;
}

interface PurchaseItem {
  product_id?: string;
  product?: Product;
  isNew: boolean;
  newProduct?: {
    name: string; category: string; description?: string;
    supplier?: string; image_url?: string;
  };
  quantity: number;
  unit_price: number;
  total_price: number;
  quantity_display?: string;
  unit_price_display?: string;
}

interface Budget {
  id: string;
  status: 'pending' | 'approved' | 'delivered' | 'canceled';
  budget_items?: Array<{
    product_id?: string; custom_item_name?: string; supplier?: string;
    unit_price?: number; quantity?: number;
    product?: { name?: string; category?: string; description?: string; image_url?: string; };
  }>;
  hotel_id?: string;
  purchase_id?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fieldCls =
  'w-full rounded-xl border border-slate-200 dark:border-slate-600 ' +
  'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white ' +
  'placeholder-slate-400 text-sm px-3 py-2.5 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 ' +
  'transition-colors';

// ── Componente de campo de seção ─────────────────────────────────────────────

const Section: React.FC<{
  icon: React.ReactNode; title: string; children: React.ReactNode;
  accent?: string;
}> = ({ icon, title, children, accent = 'blue' }) => {
  const ic: Record<string, string> = {
    blue: 'text-blue-500', emerald: 'text-emerald-500', amber: 'text-amber-500',
    slate: 'text-slate-400', orange: 'text-orange-500',
  };
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
        <span className={ic[accent] ?? ic.blue}>{icon}</span>
        {title}
      </h2>
      {children}
    </div>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────

const NewPurchase = () => {
  const location   = useLocation();
  const navigate   = useNavigate();
  const { selectedHotel }   = useHotel();
  const { addNotification } = useNotification();

  const budgetDataFromState: Budget | undefined = location.state?.budgetData;
  const budgetIdToUpdate = budgetDataFromState?.id;

  const [products,          setProducts]          = useState<Product[]>([]);
  const [filteredProducts,  setFilteredProducts]  = useState<Product[]>([]);
  const [searchTerm,        setSearchTerm]        = useState('');
  const [searchOpen,        setSearchOpen]        = useState(false);
  const [loading,           setLoading]           = useState(true);
  const [submitLoading,     setSubmitLoading]     = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [items,             setItems]             = useState<PurchaseItem[]>([]);
  const [showNewForm,       setShowNewForm]       = useState(false);
  const [imgErrors,         setImgErrors]         = useState<Record<string, boolean>>({});
  const [budgetProcessed,   setBudgetProcessed]   = useState(false);

  const [newProduct, setNewProduct] = useState({
    name: '', category: '', description: '', supplier: '', image_url: '',
  });

  const [purchaseData, setPurchaseData] = useState({
    invoice_number: '',
    supplier: '',
    purchase_date: new Date().toISOString().split('T')[0],
    notes: '',
  });

  // ── Reset ao mudar orçamento ────────────────────────────────────────────────
  useEffect(() => {
    if (location.state?.budgetData) { setBudgetProcessed(false); setItems([]); setPurchaseData(p => ({ ...p, supplier: '' })); }
  }, [location.state?.budgetData]);

  // ── Carregar produtos ───────────────────────────────────────────────────────
  useEffect(() => {
    const fetchProducts = async () => {
      if (!selectedHotel?.id) { setProducts([]); setFilteredProducts([]); setLoading(false); return; }
      setLoading(true);
      const { data, error: fe } = await supabase.from('products').select('*').eq('hotel_id', selectedHotel.id).order('name');
      if (fe) { addNotification('Erro ao carregar produtos: ' + fe.message, 'error'); }
      else { setProducts(data || []); setFilteredProducts(data || []); }
      setLoading(false);
    };
    fetchProducts();
  }, [selectedHotel, addNotification]);

  // ── Pré-preencher com orçamento ─────────────────────────────────────────────
  useEffect(() => {
    if (!budgetDataFromState || !products.length || budgetProcessed) return;
    const mainSupplier = budgetDataFromState.budget_items?.find(i => i.supplier)?.supplier || '';
    setPurchaseData(p => ({ ...p, supplier: mainSupplier || p.supplier }));
    const preItems = budgetDataFromState.budget_items?.map(bi => {
      const qty = bi.quantity ?? 1, price = bi.unit_price ?? 0;
      const prod = products.find(p => p.id === bi.product_id);
      if (bi.product_id && prod) return { product_id: bi.product_id, product: prod, isNew: false, quantity: qty, unit_price: price, total_price: qty * price };
      if (bi.custom_item_name) return { isNew: true, newProduct: { name: bi.custom_item_name, category: 'Diversos', description: '', supplier: bi.supplier || mainSupplier, image_url: '' }, quantity: qty, unit_price: price, total_price: qty * price };
      if (bi.product_id && !prod) return { isNew: true, newProduct: { name: bi.product?.name || `Produto ID ${bi.product_id}`, category: bi.product?.category || 'Diversos', description: bi.product?.description || '', supplier: bi.supplier || mainSupplier, image_url: bi.product?.image_url || '' }, quantity: qty, unit_price: price, total_price: qty * price };
      return null;
    }).filter((i): i is PurchaseItem => i !== null);

    if (preItems?.length) { setItems(preItems); addNotification('Formulário pré-preenchido com dados do orçamento.', 'info'); }
    setBudgetProcessed(true);
  }, [budgetDataFromState, products, addNotification, budgetProcessed]);

  // ── Filtro de busca ─────────────────────────────────────────────────────────
  useEffect(() => {
    const q = searchTerm.toLowerCase();
    setFilteredProducts(
      q ? products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      ).slice(0, 8) : []
    );
  }, [searchTerm, products]);

  // ── Handlers de item ────────────────────────────────────────────────────────
  const addItem = (product: Product) => {
    if (items.find(i => !i.isNew && i.product_id === product.id)) {
      addNotification('Este item já foi adicionado.', 'warning'); return;
    }
    setItems(prev => [...prev, { product_id: product.id, product, isNew: false, quantity: 1, unit_price: 0, total_price: 0 }]);
    setSearchTerm(''); setSearchOpen(false);
  };

  const addNewProduct = () => {
    if (!newProduct.name || !newProduct.category) {
      addNotification('Nome e Categoria são obrigatórios.', 'error'); return;
    }
    if (items.find(i => i.isNew && i.newProduct?.name.toLowerCase() === newProduct.name.toLowerCase())) {
      addNotification('Produto com este nome já foi adicionado.', 'warning'); return;
    }
    setItems(prev => [...prev, {
      isNew: true,
      newProduct: { ...newProduct, supplier: newProduct.supplier || purchaseData.supplier },
      quantity: 1, unit_price: 0, total_price: 0,
    }]);
    setNewProduct({ name: '', category: '', description: '', supplier: purchaseData.supplier, image_url: '' });
    setShowNewForm(false);
  };

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: 'quantity' | 'unit_price', value: string) => {
    const num = parseFloat(value.replace(',', '.')) || 0;
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item };
      if (field === 'quantity') { next.quantity = num; next.quantity_display = value; }
      else { next.unit_price = num; next.unit_price_display = value; }
      next.total_price = next.quantity * next.unit_price;
      return next;
    }));
  };

  const adjustQty = (idx: number, delta: number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const qty = Math.max(0.01, item.quantity + delta);
      return { ...item, quantity: qty, quantity_display: String(qty), total_price: qty * item.unit_price };
    }));
  };

  const total = items.reduce((s, i) => s + i.total_price, 0);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSubmitLoading(true);
    try {
      if (!selectedHotel?.id) throw new Error('Hotel não selecionado');
      if (!items.length)        throw new Error('Adicione pelo menos um item');
      if (!purchaseData.supplier) throw new Error('Fornecedor é obrigatório');

      const { data: purchase, error: pe } = await supabase.from('purchases').insert({
        invoice_number: purchaseData.invoice_number || null,
        supplier: purchaseData.supplier,
        purchase_date: purchaseData.purchase_date,
        notes: purchaseData.notes || null,
        total_amount: total,
        hotel_id: selectedHotel.id,
      }).select().single();
      if (pe) throw pe;

      for (const item of items) {
        let productId = item.product_id;
        let wasNewDuplicate = false;

        if (item.isNew && item.newProduct) {
          const { data: np, error: ne } = await supabase.from('products').insert({
            name: item.newProduct.name, category: item.newProduct.category,
            description: item.newProduct.description || null,
            supplier: item.newProduct.supplier || purchaseData.supplier,
            image_url: item.newProduct.image_url || null,
            hotel_id: selectedHotel.id, quantity: item.quantity,
          }).select().single();

          if (ne) {
            if (ne.code === '23505') {
              wasNewDuplicate = true;
              const { data: ep } = await supabase.from('products').select('id').eq('name', item.newProduct.name).eq('hotel_id', selectedHotel.id).single();
              if (!ep) throw new Error(`Produto duplicado "${item.newProduct.name}" não encontrado.`);
              productId = ep.id;
            } else throw ne;
          } else { productId = np.id; }
        }

        if (productId) {
          const { error: ie } = await supabase.from('purchase_items').insert({
            purchase_id: purchase.id, product_id: productId,
            quantity: item.quantity, unit_price: item.unit_price, total_price: item.total_price,
          });
          if (ie) throw ie;

          if (!item.isNew || wasNewDuplicate) {
            addNotification(`Estoque de '${item.product?.name || item.newProduct?.name}' será ajustado manualmente (RPC ausente).`, 'warning', 8000);
          }
        }
      }

      if (budgetIdToUpdate && selectedHotel?.id) {
        await supabase.from('budgets').update({ status: 'delivered' }).eq('id', budgetIdToUpdate).eq('hotel_id', selectedHotel.id);
        addNotification('Status do orçamento atualizado para Concluído.', 'info');
      }

      addNotification('Compra registrada com sucesso!', 'success');
      navigate('/inventory');
    } catch (err: any) {
      setError('Erro: ' + err.message);
      addNotification('Erro ao registrar: ' + err.message, 'error');
    } finally { setSubmitLoading(false); }
  };

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] gap-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <ShoppingCart className="w-6 h-6 text-blue-500 animate-pulse" />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando produtos…</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-36 space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-500 transition-colors shadow-sm">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-500" />
            Registrar Nova Compra
          </h1>
          {selectedHotel && <p className="text-xs text-slate-400 mt-0.5 ml-7">{selectedHotel.name}</p>}
        </div>
      </div>

      {/* Banner de orçamento pré-preenchido */}
      {budgetIdToUpdate && (
        <div className="flex items-center gap-2.5 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-sm text-blue-700 dark:text-blue-300">
          <Info className="w-4 h-4 shrink-0" />
          Formulário pré-preenchido com dados do orçamento — confirme os valores antes de registrar.
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Dados da compra ─────────────────────────────────────────────── */}
        <Section icon={<FileText className="w-4 h-4" />} title="Dados da Compra" accent="blue">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Nº Nota Fiscal
              </label>
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input type="text" name="invoice_number"
                  value={purchaseData.invoice_number}
                  onChange={e => setPurchaseData(p => ({ ...p, invoice_number: e.target.value }))}
                  placeholder="Opcional"
                  className={fieldCls + ' pl-9'} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Fornecedor <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input type="text" name="supplier"
                  value={purchaseData.supplier}
                  onChange={e => setPurchaseData(p => ({ ...p, supplier: e.target.value }))}
                  placeholder="Nome do fornecedor" required
                  className={fieldCls + ' pl-9'} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Data da Compra <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input type="date" name="purchase_date"
                  value={purchaseData.purchase_date}
                  onChange={e => setPurchaseData(p => ({ ...p, purchase_date: e.target.value }))}
                  required className={fieldCls + ' pl-9 dark:[color-scheme:dark]'} />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              <StickyNote className="w-3 h-3 inline mr-1" />Observações
            </label>
            <textarea name="notes" rows={2} value={purchaseData.notes}
              onChange={e => setPurchaseData(p => ({ ...p, notes: e.target.value }))}
              placeholder="Informações adicionais sobre a compra…"
              className={fieldCls + ' resize-none'} />
          </div>
        </Section>

        {/* ── Adicionar itens ──────────────────────────────────────────────── */}
        <Section icon={<Search className="w-4 h-4" />} title="Adicionar Itens" accent="emerald">

          {/* Busca de produto existente */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Produto Existente
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input type="text" value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Digite para buscar produto…"
                className={fieldCls + ' pl-9 pr-9'} />
              {searchTerm && (
                <button type="button" onClick={() => { setSearchTerm(''); setSearchOpen(false); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Dropdown de resultados */}
              {searchOpen && searchTerm && (
                <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
                  {filteredProducts.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhum produto encontrado.</p>
                  ) : (
                    filteredProducts.map(p => (
                      <button key={p.id} type="button" onClick={() => addItem(p)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors text-left group">
                        <div className="w-9 h-9 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                          {p.image_url && !imgErrors[p.id]
                            ? <img src={p.image_url} alt={p.name} className="w-full h-full object-contain"
                                onError={() => setImgErrors(prev => ({ ...prev, [p.id]: true }))} />
                            : <Package className="w-4 h-4 text-slate-400" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400">{p.name}</p>
                          <p className="text-xs text-slate-400">{p.category}</p>
                        </div>
                        <Plus className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Separador */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
            <span className="text-xs font-medium text-slate-400">ou</span>
            <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
          </div>

          {/* Botão / form de novo produto */}
          {!showNewForm ? (
            <button type="button" onClick={() => setShowNewForm(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-sm font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Plus className="w-4 h-4" /> Adicionar Produto Não Cadastrado
            </button>
          ) : (
            <div className="bg-emerald-50/60 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">Novo Produto</p>
                <button type="button" onClick={() => setShowNewForm(false)}
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { key: 'name',        label: 'Nome *',       placeholder: 'Nome do produto' },
                  { key: 'category',    label: 'Categoria *',  placeholder: 'Ex: Bebidas' },
                  { key: 'description', label: 'Descrição',    placeholder: 'Opcional' },
                  { key: 'supplier',    label: 'Fornecedor',   placeholder: 'Opcional' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">{f.label}</label>
                    <input type="text" value={(newProduct as any)[f.key]}
                      onChange={e => setNewProduct(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className={fieldCls} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowNewForm(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  Cancelar
                </button>
                <button type="button" onClick={addNewProduct}
                  className="flex-[2] py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 shadow-sm shadow-emerald-500/20">
                  <Plus className="w-4 h-4" /> Adicionar à Lista
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* ── Lista de itens ───────────────────────────────────────────────── */}
        {items.length > 0 && (
          <Section icon={<ShoppingCart className="w-4 h-4" />} title={`Itens da Compra (${items.length})`} accent="orange">
            <div className="space-y-3">
              {/* Header da tabela (desktop) */}
              <div className="hidden sm:grid sm:grid-cols-[1fr_100px_120px_80px_36px] gap-2 px-1">
                {['Produto', 'Quantidade', 'Preço Unit.', 'Total', ''].map(h => (
                  <p key={h} className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{h}</p>
                ))}
              </div>

              {items.map((item, idx) => {
                const name     = item.isNew ? item.newProduct?.name : item.product?.name;
                const category = item.isNew ? item.newProduct?.category : item.product?.category;
                const img      = item.isNew ? item.newProduct?.image_url : item.product?.image_url;

                return (
                  <div key={idx}
                    className="bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 sm:space-y-0 sm:grid sm:grid-cols-[1fr_100px_120px_80px_36px] sm:gap-2 sm:items-center hover:border-orange-200 dark:hover:border-orange-800 transition-colors">

                    {/* Produto */}
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 shrink-0 rounded-xl bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                        {img && !imgErrors[`new-${idx}`]
                          ? <img src={img} alt={name} className="w-full h-full object-contain"
                              onError={() => setImgErrors(prev => ({ ...prev, [`new-${idx}`]: true }))} />
                          : <Package className="w-4 h-4 text-slate-400" />
                        }
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{name}</p>
                          {item.isNew && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">NOVO</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{category}</p>
                      </div>
                    </div>

                    {/* Quantidade (mobile: label inline) */}
                    <div className="flex items-center gap-2 sm:block">
                      <span className="text-xs text-slate-400 sm:hidden w-20 shrink-0">Quantidade</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => adjustQty(idx, -1)}
                          className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-red-500 hover:border-red-300 dark:hover:border-red-700 transition-colors flex items-center justify-center">
                          <Minus className="w-3 h-3" />
                        </button>
                        <input type="text" inputMode="decimal"
                          value={item.quantity_display ?? String(item.quantity)}
                          onChange={e => updateItem(idx, 'quantity', e.target.value)}
                          className="w-14 h-7 text-center text-sm font-bold rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 transition-colors" />
                        <button type="button" onClick={() => adjustQty(idx, 1)}
                          className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-emerald-500 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors flex items-center justify-center">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Preço Unit */}
                    <div className="flex items-center gap-2 sm:block">
                      <span className="text-xs text-slate-400 sm:hidden w-20 shrink-0">Preço Unit.</span>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">R$</span>
                        <input type="text" inputMode="decimal"
                          value={item.unit_price_display ?? String(item.unit_price)}
                          onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                          className="w-full pl-7 pr-2 py-1.5 text-sm font-bold rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 transition-colors" />
                      </div>
                    </div>

                    {/* Total */}
                    <div className="flex items-center gap-2 sm:block">
                      <span className="text-xs text-slate-400 sm:hidden w-20 shrink-0">Total</span>
                      <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{fmtBRL(item.total_price)}</p>
                    </div>

                    {/* Remover */}
                    <div className="flex sm:justify-center">
                      <button type="button" onClick={() => removeItem(idx)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </form>

      {/* ── Sticky Footer ──────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-safe-bottom">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl shadow-black/10 dark:shadow-black/40 px-5 py-4 flex items-center gap-4">
            {/* Total */}
            <div className="flex-1">
              <p className="text-xs text-slate-400 font-medium">Total da compra</p>
              <p className={`text-2xl font-bold tabular-nums leading-tight transition-colors ${
                items.length > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-300 dark:text-slate-600'
              }`}>
                {fmtBRL(total)}
              </p>
              {items.length > 0 && (
                <p className="text-xs text-slate-400">{items.length} item{items.length !== 1 ? 's' : ''}</p>
              )}
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit as any}
              type="submit"
              form="purchase-form"
              disabled={submitLoading || items.length === 0}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-xl shadow-sm shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 transition-all">
              {submitLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Registrando…</>
                : <><DollarSign className="w-4 h-4" /> Registrar Compra</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewPurchase;
