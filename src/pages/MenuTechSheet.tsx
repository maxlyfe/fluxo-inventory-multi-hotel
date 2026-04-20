import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, Search, ChevronDown, ChevronUp, Printer, Link2, Unlink, UtensilsCrossed, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import type { Ingredient, UnitType, Side, SideIngredient, Dish, DishIngredient, DishSide } from '../types/menu';
import type { Product } from '../types/product';

// ─── Cost calculation helpers ─────────────────────────────────────────────────

async function calculateSideCost(sideId: string): Promise<number> {
  const { data } = await supabase
    .from('side_ingredients')
    .select('quantity, ingredient:ingredients(price_per_unit)')
    .eq('side_id', sideId);
  if (!data) return 0;
  return data.reduce((total: number, si: any) => {
    return total + (si.quantity ?? 0) * (si.ingredient?.price_per_unit ?? 0);
  }, 0);
}

async function calculateDishCost(dishId: string): Promise<number> {
  const [ingredientsRes, sidesRes] = await Promise.all([
    supabase.from('dish_ingredients').select('quantity, ingredient:ingredients(price_per_unit)').eq('dish_id', dishId),
    supabase.from('dish_sides').select('quantity, side_id').eq('dish_id', dishId),
  ]);
  let totalCost = 0;
  if (ingredientsRes.data) {
    totalCost += ingredientsRes.data.reduce((t: number, di: any) => {
      return t + (di.quantity ?? 0) * (di.ingredient?.price_per_unit ?? 0);
    }, 0);
  }
  if (sidesRes.data) {
    for (const ds of sidesRes.data) {
      const sideCost = await calculateSideCost(ds.side_id);
      totalCost += sideCost * (ds.quantity ?? 0);
    }
  }
  return totalCost;
}

// ─── Tab types ────────────────────────────────────────────────────────────────

type TabKey = 'ingredients' | 'sides' | 'dishes';

const TABS: { key: TabKey; label: string; color: string; activeColor: string }[] = [
  { key: 'ingredients', label: 'Ingredientes',     color: 'text-emerald-600 dark:text-emerald-400', activeColor: 'bg-emerald-600' },
  { key: 'sides',       label: 'Acompanhamentos',  color: 'text-blue-600 dark:text-blue-400',       activeColor: 'bg-blue-600' },
  { key: 'dishes',      label: 'Pratos',           color: 'text-orange-600 dark:text-orange-400',   activeColor: 'bg-orange-600' },
];

// ─── Shared input style ───────────────────────────────────────────────────────
const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors';
const selectCls = inputCls;
const labelCls = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function MenuTechSheet() {
  const { selectedHotel } = useHotel();
  const hotelId = selectedHotel?.id || '';
  const [activeTab, setActiveTab] = useState<TabKey>('ingredients');

  if (!selectedHotel) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
          <UtensilsCrossed className="w-7 h-7 text-slate-400" />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">Selecione um hotel para gerenciar fichas técnicas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
          <UtensilsCrossed className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">Fichas Técnicas</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{selectedHotel.name}</p>
        </div>
      </div>

      {/* Pill tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
              activeTab === tab.key
                ? `${tab.activeColor} text-white shadow-sm scale-105`
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'ingredients' && <IngredientsTab hotelId={hotelId} />}
      {activeTab === 'sides' && <SidesTab hotelId={hotelId} />}
      {activeTab === 'dishes' && <DishesTab hotelId={hotelId} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INGREDIENTS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function IngredientsTab({ hotelId }: { hotelId: string }) {
  const { addNotification } = useNotification();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [filtered, setFiltered] = useState<Ingredient[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', unit: 'g' as UnitType, price_per_unit: '' });
  const [products, setProducts] = useState<Product[]>([]);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [linkingIngredientId, setLinkingIngredientId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');

  const loadIngredients = useCallback(async () => {
    const { data } = await supabase.from('ingredients').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    setIngredients(data || []);
  }, [hotelId]);

  const loadProducts = useCallback(async () => {
    const { data } = await supabase.from('products').select('id, name, average_price').eq('hotel_id', hotelId).eq('is_active', true).order('name');
    setProducts(data || []);
  }, [hotelId]);

  useEffect(() => { loadIngredients(); loadProducts(); }, [loadIngredients, loadProducts]);

  useEffect(() => {
    if (!search.trim()) { setFiltered(ingredients); return; }
    const q = search.toLowerCase();
    setFiltered(ingredients.filter((i) => i.name.toLowerCase().includes(q)));
  }, [search, ingredients]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { name: formData.name, unit: formData.unit, price_per_unit: parseFloat(formData.price_per_unit) };
    if (editingId) {
      await supabase.from('ingredients').update(payload).eq('id', editingId);
    } else {
      await supabase.from('ingredients').insert([{ ...payload, hotel_id: hotelId }]);
    }
    resetForm();
    loadIngredients();
  }

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este ingrediente?')) return;
    await supabase.from('ingredients').delete().eq('id', id);
    loadIngredients();
  }

  function handleEdit(ing: Ingredient) {
    setEditingId(ing.id);
    setFormData({ name: ing.name, unit: ing.unit, price_per_unit: ing.price_per_unit.toString() });
    setShowForm(true);
  }

  async function handleLinkProduct(ingredientId: string, product: Product) {
    await supabase.from('ingredients').update({
      product_id: product.id,
      price_per_unit: product.average_price || 0
    }).eq('id', ingredientId);
    setShowProductSearch(false);
    setLinkingIngredientId(null);
    setProductSearch('');
    loadIngredients();
    addNotification('Ingrediente vinculado ao produto!', 'success');
  }

  async function handleUnlinkProduct(ingredientId: string) {
    await supabase.from('ingredients').update({ product_id: null }).eq('id', ingredientId);
    loadIngredients();
    addNotification('Vínculo removido', 'info');
  }

  function resetForm() {
    setFormData({ name: '', unit: 'g', price_per_unit: '' });
    setShowForm(false);
    setEditingId(null);
  }

  const filteredProducts = productSearch.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase()))
    : products;

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar ingrediente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors"
          />
        </div>
        <button
          onClick={() => { showForm ? resetForm() : setShowForm(true); }}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl transition-colors text-sm font-semibold shadow-sm"
        >
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? 'Cancelar' : 'Novo Ingrediente'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
            {editingId ? 'Editar Ingrediente' : 'Novo Ingrediente'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Nome</label>
              <input
                type="text" required value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={inputCls}
                placeholder="Ex: Mel"
              />
            </div>
            <div>
              <label className={labelCls}>Unidade</label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value as UnitType })}
                className={selectCls}
              >
                <option value="g">Gramas (g)</option>
                <option value="ml">Mililitros (ml)</option>
                <option value="und">Unidade (und)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Preço por Unidade (R$)</label>
              <input
                type="number" step="0.00000001" required value={formData.price_per_unit}
                onChange={(e) => setFormData({ ...formData, price_per_unit: e.target.value })}
                className={inputCls}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors">
              <Check size={16} /> {editingId ? 'Atualizar' : 'Salvar'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold transition-colors">
                <X size={16} /> Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nome</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Unidade</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Preço/Unidade</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Vínculo</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {search ? 'Nenhum ingrediente encontrado' : 'Nenhum ingrediente cadastrado'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((ing) => (
                  <tr key={ing.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{ing.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                      <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded-lg text-xs font-mono">{ing.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-700 dark:text-slate-300">
                      R$ {Number(ing.price_per_unit).toFixed(8)}
                      {(ing as any).product_id && (
                        <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">auto</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm relative">
                      {(ing as any).product_id ? (
                        <div className="flex items-center gap-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                            <Link2 size={11} />
                            {products.find((p) => p.id === (ing as any).product_id)?.name || 'Produto'}
                          </span>
                          <button
                            onClick={() => handleUnlinkProduct(ing.id)}
                            className="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title="Remover vínculo"
                          >
                            <Unlink size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <button
                            onClick={() => {
                              if (linkingIngredientId === ing.id) {
                                setShowProductSearch(false);
                                setLinkingIngredientId(null);
                                setProductSearch('');
                              } else {
                                setLinkingIngredientId(ing.id);
                                setShowProductSearch(true);
                                setProductSearch('');
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                          >
                            <Link2 size={11} /> Vincular
                          </button>
                          {showProductSearch && linkingIngredientId === ing.id && (
                            <div className="absolute z-20 top-full left-0 mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg overflow-hidden">
                              <div className="p-2 border-b border-slate-100 dark:border-slate-700">
                                <input
                                  type="text"
                                  placeholder="Buscar produto..."
                                  value={productSearch}
                                  onChange={(e) => setProductSearch(e.target.value)}
                                  className="w-full px-2.5 py-1.5 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                  autoFocus
                                />
                              </div>
                              <div className="max-h-40 overflow-y-auto">
                                {filteredProducts.length === 0 ? (
                                  <p className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400 text-center">Nenhum produto encontrado</p>
                                ) : (
                                  filteredProducts.map((p) => (
                                    <button
                                      key={p.id}
                                      onClick={() => handleLinkProduct(ing.id, p)}
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 flex justify-between items-center transition-colors"
                                    >
                                      <span>{p.name}</span>
                                      {p.average_price != null && (
                                        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">R$ {Number(p.average_price).toFixed(4)}</span>
                                      )}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleEdit(ing)}
                        className="p-1.5 rounded-lg text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors mr-1"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(ing.id)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-700/50 text-xs text-slate-400 dark:text-slate-500">
            {filtered.length} ingrediente{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIDES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function SidesTab({ hotelId }: { hotelId: string }) {
  const [sides, setSides] = useState<Side[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState<{
    name: string;
    ingredients: { ingredient_id: string; quantity: string }[];
  }>({ name: '', ingredients: [] });

  const loadSides = useCallback(async () => {
    const { data } = await supabase.from('sides').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    setSides(data || []);
  }, [hotelId]);

  const loadIngredients = useCallback(async () => {
    const { data } = await supabase.from('ingredients').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    setIngredients(data || []);
  }, [hotelId]);

  useEffect(() => { loadSides(); loadIngredients(); }, [loadSides, loadIngredients]);

  const filteredSides = search.trim()
    ? sides.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : sides;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId) {
      await supabase.from('sides').update({ name: formData.name }).eq('id', editingId);
      await supabase.from('side_ingredients').delete().eq('side_id', editingId);
      const items = formData.ingredients
        .filter((i) => i.ingredient_id && i.quantity)
        .map((i) => ({ side_id: editingId, ingredient_id: i.ingredient_id, quantity: parseFloat(i.quantity) }));
      if (items.length > 0) await supabase.from('side_ingredients').insert(items);
    } else {
      const { data } = await supabase.from('sides').insert([{ name: formData.name, hotel_id: hotelId }]).select().single();
      if (data) {
        const items = formData.ingredients
          .filter((i) => i.ingredient_id && i.quantity)
          .map((i) => ({ side_id: data.id, ingredient_id: i.ingredient_id, quantity: parseFloat(i.quantity) }));
        if (items.length > 0) await supabase.from('side_ingredients').insert(items);
      }
    }
    resetForm();
    loadSides();
  }

  async function handleEdit(side: Side) {
    const { data } = await supabase.from('side_ingredients').select('*').eq('side_id', side.id);
    setEditingId(side.id);
    setFormData({
      name: side.name,
      ingredients: (data || []).map((si: any) => ({ ingredient_id: si.ingredient_id, quantity: si.quantity.toString() })),
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este acompanhamento?')) return;
    await supabase.from('sides').delete().eq('id', id);
    if (expandedId === id) setExpandedId(null);
    loadSides();
  }

  function resetForm() {
    setFormData({ name: '', ingredients: [] });
    setShowForm(false);
    setEditingId(null);
  }

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text" placeholder="Buscar acompanhamento..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
          />
        </div>
        <button
          onClick={() => { showForm ? resetForm() : setShowForm(true); }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl transition-colors text-sm font-semibold shadow-sm"
        >
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? 'Cancelar' : 'Novo Acompanhamento'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
            {editingId ? 'Editar Acompanhamento' : 'Novo Acompanhamento'}
          </h3>
          <div>
            <label className={labelCls}>Nome do Acompanhamento</label>
            <input
              type="text" required value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={inputCls}
              placeholder="Ex: Molho Caesar"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className={labelCls}>Ingredientes</label>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, ingredients: [...formData.ingredients, { ingredient_id: '', quantity: '' }] })}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                + Adicionar Ingrediente
              </button>
            </div>
            <div className="space-y-2">
              {formData.ingredients.map((ing, idx) => (
                <div key={idx} className="flex gap-2">
                  <select
                    value={ing.ingredient_id}
                    onChange={(e) => { const n = [...formData.ingredients]; n[idx].ingredient_id = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                    className={`flex-1 ${selectCls}`}
                    required
                  >
                    <option value="">Selecione...</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                  <input
                    type="number" step="0.001" value={ing.quantity} placeholder="Qtd" required
                    onChange={(e) => { const n = [...formData.ingredients]; n[idx].quantity = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                    className="w-24 sm:w-28 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, ingredients: formData.ingredients.filter((_, i) => i !== idx) })}
                    className="p-2 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors">
              <Check size={16} /> {editingId ? 'Atualizar' : 'Salvar'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold transition-colors">
                <X size={16} /> Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {filteredSides.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 p-10 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {search ? 'Nenhum acompanhamento encontrado' : 'Nenhum acompanhamento cadastrado'}
            </p>
          </div>
        ) : (
          filteredSides.map((side) => (
            <SideCard
              key={side.id}
              side={side}
              isExpanded={expandedId === side.id}
              onToggle={() => setExpandedId(expandedId === side.id ? null : side.id)}
              onEdit={() => handleEdit(side)}
              onDelete={() => handleDelete(side.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SideCard({ side, isExpanded, onToggle, onEdit, onDelete }: {
  side: Side; isExpanded: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [items, setItems] = useState<SideIngredient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isExpanded && items.length === 0) {
      setLoading(true);
      supabase.from('side_ingredients').select('*, ingredient:ingredients(*)').eq('side_id', side.id)
        .then(({ data }) => { setItems(data || []); setLoading(false); });
    }
  }, [isExpanded, side.id, items.length]);

  const totalCost = items.reduce((t, si) => t + (si.quantity ?? 0) * (si.ingredient?.price_per_unit ?? 0), 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div
        className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {isExpanded
            ? <ChevronUp size={17} className="text-slate-400 flex-shrink-0" />
            : <ChevronDown size={17} className="text-slate-400 flex-shrink-0" />
          }
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white">{side.name}</h3>
            {isExpanded && !loading && items.length > 0 && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">
                Total: R$ {totalCost.toFixed(2)}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} className="p-1.5 rounded-lg text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
            <Edit2 size={15} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-800/60">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              <p className="text-xs text-slate-500">Carregando...</p>
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-3">Nenhum ingrediente adicionado</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 dark:bg-slate-700/60">
                  <tr className="text-left">
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Ingrediente</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Quantidade</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Preço Unit.</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {items.map((si) => (
                    <tr key={si.id} className="bg-white dark:bg-slate-800">
                      <td className="px-3 py-2 text-slate-900 dark:text-slate-100">{si.ingredient?.name}</td>
                      <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">{si.quantity} {si.ingredient?.unit}</td>
                      <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400 font-mono text-xs">R$ {Number(si.ingredient?.price_per_unit ?? 0).toFixed(6)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-300">R$ {((si.quantity ?? 0) * (si.ingredient?.price_per_unit ?? 0)).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 dark:bg-slate-700/30">
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-bold text-slate-600 dark:text-slate-300">Total:</td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-600 dark:text-emerald-400">R$ {totalCost.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISHES TAB
// ═══════════════════════════════════════════════════════════════════════════════

interface DishWithCost extends Dish { cost: number; }

function DishesTab({ hotelId }: { hotelId: string }) {
  const [dishes, setDishes] = useState<DishWithCost[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [sides, setSides] = useState<Side[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState<{
    name: string;
    ingredients: { ingredient_id: string; quantity: string }[];
    sides: { side_id: string; quantity: string }[];
  }>({ name: '', ingredients: [], sides: [] });

  const loadDishes = useCallback(async () => {
    const { data } = await supabase.from('dishes').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    const withCost = await Promise.all(
      (data || []).map(async (d) => ({ ...d, cost: await calculateDishCost(d.id) }))
    );
    setDishes(withCost);
  }, [hotelId]);

  const loadIngredients = useCallback(async () => {
    const { data } = await supabase.from('ingredients').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    setIngredients(data || []);
  }, [hotelId]);

  const loadSides = useCallback(async () => {
    const { data } = await supabase.from('sides').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    setSides(data || []);
  }, [hotelId]);

  useEffect(() => { loadDishes(); loadIngredients(); loadSides(); }, [loadDishes, loadIngredients, loadSides]);

  const filteredDishes = search.trim()
    ? dishes.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
    : dishes;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId) {
      await supabase.from('dishes').update({ name: formData.name }).eq('id', editingId);
      await supabase.from('dish_ingredients').delete().eq('dish_id', editingId);
      await supabase.from('dish_sides').delete().eq('dish_id', editingId);
      const ingItems = formData.ingredients.filter((i) => i.ingredient_id && i.quantity)
        .map((i) => ({ dish_id: editingId, ingredient_id: i.ingredient_id, quantity: parseFloat(i.quantity) }));
      const sideItems = formData.sides.filter((s) => s.side_id && s.quantity)
        .map((s) => ({ dish_id: editingId, side_id: s.side_id, quantity: parseInt(s.quantity) }));
      if (ingItems.length > 0) await supabase.from('dish_ingredients').insert(ingItems);
      if (sideItems.length > 0) await supabase.from('dish_sides').insert(sideItems);
    } else {
      const { data } = await supabase.from('dishes').insert([{ name: formData.name, hotel_id: hotelId }]).select().single();
      if (data) {
        const ingItems = formData.ingredients.filter((i) => i.ingredient_id && i.quantity)
          .map((i) => ({ dish_id: data.id, ingredient_id: i.ingredient_id, quantity: parseFloat(i.quantity) }));
        const sideItems = formData.sides.filter((s) => s.side_id && s.quantity)
          .map((s) => ({ dish_id: data.id, side_id: s.side_id, quantity: parseInt(s.quantity) }));
        if (ingItems.length > 0) await supabase.from('dish_ingredients').insert(ingItems);
        if (sideItems.length > 0) await supabase.from('dish_sides').insert(sideItems);
      }
    }
    resetForm();
    loadDishes();
  }

  async function handleEdit(dish: Dish) {
    const [ingRes, sidesRes] = await Promise.all([
      supabase.from('dish_ingredients').select('*').eq('dish_id', dish.id),
      supabase.from('dish_sides').select('*').eq('dish_id', dish.id),
    ]);
    setEditingId(dish.id);
    setFormData({
      name: dish.name,
      ingredients: (ingRes.data || []).map((di: any) => ({ ingredient_id: di.ingredient_id, quantity: di.quantity.toString() })),
      sides: (sidesRes.data || []).map((ds: any) => ({ side_id: ds.side_id, quantity: ds.quantity.toString() })),
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este prato?')) return;
    await supabase.from('dishes').delete().eq('id', id);
    if (expandedId === id) setExpandedId(null);
    loadDishes();
  }

  function resetForm() {
    setFormData({ name: '', ingredients: [], sides: [] });
    setShowForm(false);
    setEditingId(null);
  }

  async function handlePrint() {
    let html = `<h1>Relatório de Fichas Técnicas</h1><p>Data: ${new Date().toLocaleDateString('pt-BR')}</p><hr/>`;
    for (const dish of dishes) {
      const [ingRes, sidesRes] = await Promise.all([
        supabase.from('dish_ingredients').select('*, ingredient:ingredients(*)').eq('dish_id', dish.id),
        supabase.from('dish_sides').select('*, side:sides(*)').eq('dish_id', dish.id),
      ]);
      let cost = 0;
      html += `<h2>${dish.name}</h2><table><thead><tr><th>Item</th><th>Quantidade</th><th>Valor (R$)</th></tr></thead><tbody>`;
      for (const di of (ingRes.data || [])) {
        const sub = (di.quantity ?? 0) * (di.ingredient?.price_per_unit ?? 0);
        cost += sub;
        html += `<tr><td>${di.ingredient?.name}</td><td>${di.quantity} ${di.ingredient?.unit}</td><td>R$ ${sub.toFixed(6)}</td></tr>`;
      }
      for (const ds of (sidesRes.data || [])) {
        const sc = await calculateSideCost(ds.side_id);
        const sub = sc * (ds.quantity ?? 0);
        cost += sub;
        html += `<tr><td>Acompanhamento: ${ds.side?.name}</td><td>${ds.quantity}x</td><td>R$ ${sub.toFixed(6)}</td></tr>`;
      }
      html += `<tr><td colspan="2" style="text-align:right;font-weight:bold">Total:</td><td style="font-weight:bold">R$ ${cost.toFixed(2)}</td></tr></tbody></table><hr/>`;
    }
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`<html><head><title>Relatório de Custos</title><style>body{font-family:sans-serif;margin:20px}table{width:100%;border-collapse:collapse;margin-bottom:1em}th,td{border:1px solid #000;padding:8px;text-align:left}th{background:#f2f2f2}h2{margin-top:30px}</style></head><body>${html}<script>window.onload=function(){window.print();window.close()}</script></body></html>`);
      w.document.close();
    }
  }

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text" placeholder="Buscar prato..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2.5 rounded-xl transition-colors text-sm font-semibold"
          >
            <Printer size={16} /> Imprimir
          </button>
          <button
            onClick={() => { showForm ? resetForm() : setShowForm(true); }}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-xl transition-colors text-sm font-semibold shadow-sm"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? 'Cancelar' : 'Novo Prato'}
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
            {editingId ? 'Editar Prato' : 'Novo Prato'}
          </h3>
          <div>
            <label className={labelCls}>Nome do Prato</label>
            <input
              type="text" required value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={inputCls}
              placeholder="Ex: Salada Caesar de Frango"
            />
          </div>

          {/* Ingredients */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className={labelCls}>Ingredientes Diretos</label>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, ingredients: [...formData.ingredients, { ingredient_id: '', quantity: '' }] })}
                className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300"
              >
                + Adicionar Ingrediente
              </button>
            </div>
            <div className="space-y-2">
              {formData.ingredients.map((ing, idx) => (
                <div key={idx} className="flex gap-2">
                  <select
                    value={ing.ingredient_id}
                    onChange={(e) => { const n = [...formData.ingredients]; n[idx].ingredient_id = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                    className={`flex-1 ${selectCls}`}
                  >
                    <option value="">Selecione...</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                  <input
                    type="number" step="0.001" value={ing.quantity} placeholder="Qtd"
                    onChange={(e) => { const n = [...formData.ingredients]; n[idx].quantity = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                    className="w-24 sm:w-28 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, ingredients: formData.ingredients.filter((_, i) => i !== idx) })}
                    className="p-2 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Sides */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className={labelCls}>Acompanhamentos</label>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, sides: [...formData.sides, { side_id: '', quantity: '1' }] })}
                className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300"
              >
                + Adicionar Acompanhamento
              </button>
            </div>
            <div className="space-y-2">
              {formData.sides.map((side, idx) => (
                <div key={idx} className="flex gap-2">
                  <select
                    value={side.side_id}
                    onChange={(e) => { const n = [...formData.sides]; n[idx].side_id = e.target.value; setFormData({ ...formData, sides: n }); }}
                    className={`flex-1 ${selectCls}`}
                  >
                    <option value="">Selecione...</option>
                    {sides.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input
                    type="number" step="1" value={side.quantity} placeholder="Qtd"
                    onChange={(e) => { const n = [...formData.sides]; n[idx].quantity = e.target.value; setFormData({ ...formData, sides: n }); }}
                    className="w-20 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, sides: formData.sides.filter((_, i) => i !== idx) })}
                    className="p-2 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="w-full flex justify-center items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
          >
            {editingId ? <><Check size={16} /> Salvar Alterações</> : <><Plus size={16} /> Criar Prato</>}
          </button>
        </form>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {filteredDishes.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 p-10 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {search ? 'Nenhum prato encontrado' : 'Nenhum prato cadastrado'}
            </p>
          </div>
        ) : (
          filteredDishes.map((dish) => (
            <DishCard
              key={dish.id}
              dish={dish}
              isExpanded={expandedId === dish.id}
              onToggle={() => setExpandedId(expandedId === dish.id ? null : dish.id)}
              onEdit={() => handleEdit(dish)}
              onDelete={() => handleDelete(dish.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DishCard({ dish, isExpanded, onToggle, onEdit, onDelete }: {
  dish: DishWithCost; isExpanded: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [details, setDetails] = useState<{ ingredients: DishIngredient[]; sides: DishSide[] } | null>(null);
  const [sideCosts, setSideCosts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isExpanded && !details) {
      setLoading(true);
      Promise.all([
        supabase.from('dish_ingredients').select('*, ingredient:ingredients(*)').eq('dish_id', dish.id),
        supabase.from('dish_sides').select('*, side:sides(*)').eq('dish_id', dish.id),
      ]).then(async ([ingRes, sidesRes]) => {
        const d = { ingredients: ingRes.data || [], sides: sidesRes.data || [] };
        setDetails(d);
        const costs = new Map<string, number>();
        for (const ds of d.sides) {
          costs.set(ds.side_id, await calculateSideCost(ds.side_id));
        }
        setSideCosts(costs);
        setLoading(false);
      });
    }
  }, [isExpanded, dish.id, details]);

  const ingCost = details?.ingredients.reduce((t, di) => t + (di.quantity ?? 0) * (di.ingredient?.price_per_unit ?? 0), 0) || 0;
  const sCost = details?.sides.reduce((t, ds) => t + (sideCosts.get(ds.side_id) || 0) * (ds.quantity ?? 0), 0) || 0;
  const totalCost = ingCost + sCost;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div
        className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {isExpanded
            ? <ChevronUp size={17} className="text-slate-400 flex-shrink-0" />
            : <ChevronDown size={17} className="text-slate-400 flex-shrink-0" />
          }
          <div>
            <span className="text-sm font-semibold text-slate-800 dark:text-white">{dish.name}</span>
            <span className="ml-2.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
              R$ {dish.cost.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} className="p-1.5 rounded-lg text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
            <Edit2 size={15} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-800/60 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              <p className="text-xs text-slate-500">Carregando...</p>
            </div>
          ) : (
            <>
              {details?.ingredients && details.ingredients.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Ingredientes Diretos</h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-100 dark:bg-slate-700/60">
                        <tr className="text-left">
                          <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Ingrediente</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Quantidade</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Preço Unit.</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                        {details.ingredients.map((di) => (
                          <tr key={di.id} className="bg-white dark:bg-slate-800">
                            <td className="px-3 py-2 text-slate-900 dark:text-slate-100">{di.ingredient?.name}</td>
                            <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">{di.quantity} {di.ingredient?.unit}</td>
                            <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400 font-mono text-xs">R$ {Number(di.ingredient?.price_per_unit ?? 0).toFixed(6)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-300">R$ {((di.quantity ?? 0) * (di.ingredient?.price_per_unit ?? 0)).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {details?.sides && details.sides.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Acompanhamentos</h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-100 dark:bg-slate-700/60">
                        <tr className="text-left">
                          <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Acompanhamento</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Porções</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Preço/Porção</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                        {details.sides.map((ds) => {
                          const sc = sideCosts.get(ds.side_id) || 0;
                          return (
                            <tr key={ds.id} className="bg-white dark:bg-slate-800">
                              <td className="px-3 py-2 text-slate-900 dark:text-slate-100">{ds.side?.name}</td>
                              <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">{ds.quantity}x</td>
                              <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">R$ {sc.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-300">R$ {(sc * (ds.quantity ?? 0)).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t-2 border-slate-200 dark:border-slate-600">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Custo Total:</span>
                  <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">R$ {totalCost.toFixed(2)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
