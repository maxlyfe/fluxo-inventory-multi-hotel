import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, Search, Printer, Link2, Unlink, UtensilsCrossed, Loader2, Beer, Package, Settings, GripVertical, Palette } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import SearchableSelect from '../components/ui/SearchableSelect';
import type { Ingredient, UnitType, Side, SideIngredient, Dish, DishIngredient, DishSide, DishCategory } from '../types/menu';
import type { Product } from '../types/product';

// Suppress unused import warnings for icons used only in JSX
void Printer; void GripVertical; void Palette; void Beer;

// ─── Unit Conversion helpers ──────────────────────────────────────────────────

const UNIT_CONVERSIONS: Record<string, number> = {
  'kg_g': 0.001,
  'g_kg': 1000,
  'l_ml': 0.001,
  'ml_l': 1000,
  // Same units
  'g_g': 1, 'kg_kg': 1, 'ml_ml': 1, 'l_l': 1, 'und_und': 1, 'cx_cx': 1, 'pct_pct': 1
};

function getUnitFactor(from: string, to: string): number {
  if (from === to) return 1;
  return UNIT_CONVERSIONS[`${to}_${from}`] || 1;
  // Se eu uso 'g' (from) e o preço está em 'kg' (to), o fator é 0.001.
  // Ex: 100g * 0.001 = 0.1kg.
}

async function calculateSideCost(sideId: string): Promise<number> {
  const { data } = await supabase
    .from('side_ingredients')
    .select('quantity, unit, ingredient:ingredients(unit, price_per_unit)')
    .eq('side_id', sideId);
  if (!data) return 0;
  return data.reduce((total: number, si: any) => {
    const factor = getUnitFactor(si.unit || si.ingredient?.unit, si.ingredient?.unit);
    return total + (si.quantity ?? 0) * factor * (si.ingredient?.price_per_unit ?? 0);
  }, 0);
}

async function calculateDishCost(dishId: string): Promise<number> {
  const [ingredientsRes, sidesRes] = await Promise.all([
    supabase.from('dish_ingredients').select('quantity, unit, ingredient:ingredients(unit, price_per_unit)').eq('dish_id', dishId),
    supabase.from('dish_sides').select('quantity, side_id').eq('dish_id', dishId),
  ]);
  let totalCost = 0;
  if (ingredientsRes.data) {
    totalCost += ingredientsRes.data.reduce((t: number, di: any) => {
      const factor = getUnitFactor(di.unit || di.ingredient?.unit, di.ingredient?.unit);
      return t + (di.quantity ?? 0) * factor * (di.ingredient?.price_per_unit ?? 0);
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

// ─── Shared input style ───────────────────────────────────────────────────────
const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors';
const selectCls = inputCls;
const labelCls = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5';

// ─── TabButton helper ─────────────────────────────────────────────────────────

function TabButton({ isActive, onClick, label, color }: { isActive: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap flex-shrink-0
        ${isActive ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
    >
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      {label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function MenuTechSheet() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const hotelId = selectedHotel?.id || '';
  const [activeTab, setActiveTab] = useState<string>('ingredients');
  const [categories, setCategories] = useState<DishCategory[]>([]);
  const [showCategoryMgr, setShowCategoryMgr] = useState(false);
  const [outrosCount, setOutrosCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const loadCategories = useCallback(async () => {
    if (!hotelId) return;
    const { data } = await supabase
      .from('dish_categories')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('sort_order');
    setCategories(data || []);
  }, [hotelId]);

  const loadOutrosCount = useCallback(async () => {
    if (!hotelId) return;
    const { count } = await supabase
      .from('dishes')
      .select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId)
      .is('category_id', null);
    setOutrosCount(count || 0);
  }, [hotelId]);

  /** Sincroniza todos os produtos ativos como ingredientes (cria os que ainda não existem) */
  const syncFromInventory = useCallback(async (silent = false) => {
    if (!hotelId) return;
    if (!silent) setSyncing(true);
    try {
      const { data: prods } = await supabase
        .from('products')
        .select('id, name, average_price, unit_measure')
        .eq('hotel_id', hotelId)
        .eq('is_active', true);

      if (!prods || prods.length === 0) {
        if (!silent) addNotification('Nenhum produto ativo no inventário.', 'info');
        return;
      }

      // Busca product_ids já existentes nos ingredientes
      const { data: existingIngs } = await supabase
        .from('ingredients')
        .select('product_id')
        .eq('hotel_id', hotelId)
        .not('product_id', 'is', null);

      const existingIds = new Set((existingIngs || []).map((i: { product_id: string }) => i.product_id));

      const newRows = prods
        .filter(p => !existingIds.has(p.id))
        .map(p => ({
          name: p.name,
          unit: ((p.unit_measure as UnitType) || 'und'),
          price_per_unit: p.average_price || 0,
          purchase_qty_per_unit: 1,
          product_id: p.id,
          hotel_id: hotelId,
        }));

      if (newRows.length > 0) {
        await supabase.from('ingredients').insert(newRows);
      }

      if (!silent) {
        addNotification(
          newRows.length > 0
            ? `${newRows.length} produto${newRows.length > 1 ? 's' : ''} adicionado${newRows.length > 1 ? 's' : ''} aos ingredientes.`
            : 'Ingredientes já sincronizados com o inventário.',
          'success'
        );
      }
    } catch {
      if (!silent) addNotification('Erro ao sincronizar com inventário.', 'error');
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [hotelId, addNotification]);

  useEffect(() => {
    if (hotelId) {
      loadCategories();
      loadOutrosCount();
      syncFromInventory(true);
    }
  }, [hotelId, loadCategories, loadOutrosCount, syncFromInventory]);

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

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 overflow-x-auto flex-shrink-0 rounded-xl">
        {/* Fixed tabs */}
        <TabButton key="ingredients" isActive={activeTab === 'ingredients'} onClick={() => setActiveTab('ingredients')} label="Ingredientes" color="#10b981" />
        <TabButton key="sides" isActive={activeTab === 'sides'} onClick={() => setActiveTab('sides')} label="Acompanhamentos" color="#3b82f6" />

        {/* Dynamic category tabs */}
        {categories.map(cat => (
          <TabButton key={cat.id} isActive={activeTab === `cat_${cat.id}`} onClick={() => setActiveTab(`cat_${cat.id}`)} label={cat.name} color={cat.color} />
        ))}

        {/* Outros */}
        {outrosCount > 0 && (
          <TabButton isActive={activeTab === 'outros'} onClick={() => setActiveTab('outros')} label={`Outros (${outrosCount})`} color="#94a3b8" />
        )}

        {/* Add category button */}
        <button
          onClick={() => setShowCategoryMgr(true)}
          className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
        >
          <Plus size={13} /> Categoria
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'ingredients' && <IngredientsTab hotelId={hotelId} onSync={() => syncFromInventory(false)} syncing={syncing} />}
      {activeTab === 'sides' && <SidesTab hotelId={hotelId} />}
      {categories.map(cat => activeTab === `cat_${cat.id}` && (
        <DishesTab
          key={cat.id}
          hotelId={hotelId}
          categoryId={cat.id}
          categoryName={cat.name}
          categories={categories}
          onCategoriesChange={loadCategories}
          onDishMoved={loadOutrosCount}
        />
      ))}
      {activeTab === 'outros' && (
        <DishesTab
          hotelId={hotelId}
          categoryId={null}
          categoryName="Outros"
          categories={categories}
          onCategoriesChange={loadCategories}
          onDishMoved={loadOutrosCount}
        />
      )}

      {showCategoryMgr && (
        <CategoryManagerModal
          hotelId={hotelId}
          categories={categories}
          onClose={() => setShowCategoryMgr(false)}
          onChange={() => { loadCategories(); loadOutrosCount(); }}
        />
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY MANAGER MODAL
// ═══════════════════════════════════════════════════════════════════════════════

interface CategoryManagerModalProps {
  hotelId: string;
  categories: DishCategory[];
  onClose: () => void;
  onChange: () => void;
}

const PRESET_COLORS = ['#f97316', '#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6', '#64748b'];

function CategoryManagerModal({ hotelId, categories, onClose, onChange }: CategoryManagerModalProps) {
  const { addNotification } = useNotification();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    await supabase.from('dish_categories').insert({
      hotel_id: hotelId,
      name: newName.trim(),
      color: newColor,
      sort_order: categories.length,
    });
    setNewName('');
    onChange();
    addNotification('Categoria criada!', 'success');
    setSaving(false);
  };

  const handleDelete = async (cat: DishCategory) => {
    if (!confirm(`Excluir "${cat.name}"? As fichas técnicas desta categoria ficarão em "Outros".`)) return;
    setDeletingId(cat.id);
    await supabase.from('dish_categories').delete().eq('id', cat.id);
    // dishes com category_id = cat.id ficam com NULL (ON DELETE SET NULL)
    onChange();
    addNotification(`Categoria "${cat.name}" excluída. Fichas movidas para Outros.`, 'info');
    setDeletingId(null);
  };

  const handleRename = async (cat: DishCategory, newNameVal: string) => {
    if (!newNameVal.trim() || newNameVal === cat.name) return;
    await supabase.from('dish_categories').update({ name: newNameVal.trim() }).eq('id', cat.id);
    onChange();
    addNotification('Categoria renomeada.', 'success');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Gerenciar Categorias</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Existing categories */}
          <div className="space-y-2">
            {categories.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-3">Nenhuma categoria criada ainda.</p>
            )}
            {categories.map(cat => (
              <CategoryRow
                key={cat.id}
                cat={cat}
                onDelete={() => handleDelete(cat)}
                onRename={(name) => handleRename(cat, name)}
                isDeleting={deletingId === cat.id}
              />
            ))}
          </div>

          {/* Create new */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Nova Categoria</p>
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="Ex: Sobremesas, Entradas..."
                className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            {/* Color picker */}
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${newColor === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !newName.trim()}
              className="flex items-center gap-2 w-full justify-center py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Criar categoria
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({ cat, onDelete, onRename, isDeleting }: {
  cat: DishCategory;
  onDelete: () => void;
  onRename: (name: string) => void;
  isDeleting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(cat.name);

  const save = () => { onRename(val); setEditing(false); };

  return (
    <div className="flex items-center gap-2 p-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
      {editing ? (
        <input
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          className="flex-1 px-2 py-1 text-sm border border-blue-400 rounded-lg bg-white dark:bg-slate-600 text-slate-900 dark:text-white focus:outline-none"
        />
      ) : (
        <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">{cat.name}</span>
      )}
      <button
        onClick={() => setEditing(!editing)}
        className="p-1 text-slate-400 hover:text-blue-500 rounded-lg transition-colors"
      >
        <Edit2 size={13} />
      </button>
      <button
        onClick={onDelete}
        disabled={isDeleting}
        className="p-1 text-slate-400 hover:text-red-500 rounded-lg transition-colors disabled:opacity-40"
      >
        {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INGREDIENTS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function IngredientsTab({ hotelId, onSync, syncing }: { hotelId: string; onSync: () => void; syncing: boolean }) {
  const { addNotification } = useNotification();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [filtered, setFiltered] = useState<Ingredient[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    unit: 'g' as UnitType,
    price_per_unit: '',
    purchase_qty_per_unit: '1',
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [linkingIngredientId, setLinkingIngredientId] = useState<string | null>(null);
  const [showProductSearch, setShowProductSearch] = useState(false);

  const loadIngredients = useCallback(async () => {
    const { data } = await supabase.from('ingredients').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    setIngredients(data || []);
  }, [hotelId]);

  const loadProducts = useCallback(async () => {
    const { data } = await supabase.from('products').select('id, name, average_price, category, unit_measure').eq('hotel_id', hotelId).eq('is_active', true).order('name');
    setProducts(data || []);
  }, [hotelId]);

  // Na primeira carga: sincroniza silenciosamente
  useEffect(() => {
    loadProducts();
    loadIngredients();
  }, [loadProducts, loadIngredients, syncing]);

  useEffect(() => {
    let list = ingredients;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    if (categoryFilter) {
      const catProductIds = new Set(
        products.filter(p => p.category === categoryFilter).map(p => p.id)
      );
      list = list.filter(i => (i as any).product_id == null || catProductIds.has((i as any).product_id));
    }
    setFiltered(list);
  }, [search, categoryFilter, ingredients, products]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const purchase_qty = parseFloat((formData.purchase_qty_per_unit || '1').replace(',', '.')) || 1;
    const raw_price = parseFloat((formData.price_per_unit || '0').replace(',', '.')) || 0;
    const computed_price = raw_price / purchase_qty;
    const payload = {
      name: formData.name,
      unit: formData.unit,
      price_per_unit: computed_price,
      purchase_qty_per_unit: purchase_qty,
    };
    if (editingId) {
      await supabase.from('ingredients').update(payload).eq('id', editingId);
    } else {
      await supabase.from('ingredients').insert([{ ...payload, hotel_id: hotelId }]);
    }
    resetForm();
    loadIngredients();
    addNotification('Ingrediente salvo com sucesso!', 'success');
  }

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este ingrediente?')) return;
    await supabase.from('ingredients').delete().eq('id', id);
    loadIngredients();
    addNotification('Ingrediente excluído', 'info');
  }

  function handleEdit(ing: Ingredient) {
    setEditingId(ing.id);
    // Reconstruct raw purchase price from stored price_per_unit * purchase_qty_per_unit
    const qty = ing.purchase_qty_per_unit ?? 1;
    const rawPrice = ing.price_per_unit * qty;
    setFormData({
      name: ing.name,
      unit: ing.unit,
      price_per_unit: rawPrice.toFixed(4),
      purchase_qty_per_unit: qty.toString(),
    });
    setShowForm(true);
  }

  async function handleLinkProduct(ingredientId: string, productId: string) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    await supabase.from('ingredients').update({
      product_id: product.id,
      price_per_unit: product.average_price || 0,
      purchase_qty_per_unit: 1,
      unit: (product.unit_measure as UnitType) || 'und'
    }).eq('id', ingredientId);

    setShowProductSearch(false);
    setLinkingIngredientId(null);
    loadIngredients();
    addNotification('Ingrediente vinculado ao produto!', 'success');
  }

  async function handleUnlinkProduct(ingredientId: string) {
    await supabase.from('ingredients').update({ product_id: null }).eq('id', ingredientId);
    loadIngredients();
    addNotification('Vínculo removido', 'info');
  }

  function resetForm() {
    setFormData({ name: '', unit: 'g', price_per_unit: '', purchase_qty_per_unit: '1' });
    setShowForm(false);
    setEditingId(null);
  }

  const productOptions = products.map(p => ({
    value: p.id,
    label: `${p.name} (${p.category || 'Sem cat.'}) - R$ ${Number(p.average_price || 0).toFixed(4)}`
  }));

  // Computed preview price per unit
  const previewPricePerUnit = (() => {
    const qty = parseFloat((formData.purchase_qty_per_unit || '1').replace(',', '.')) || 1;
    const raw = parseFloat((formData.price_per_unit || '0').replace(',', '.')) || 0;
    return (raw / qty).toFixed(4);
  })();

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="flex flex-1 gap-2 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar ingrediente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors"
            />
          </div>
          {/* Filtro por categoria */}
          {[...new Set(products.map(p => p.category).filter(Boolean))].length > 0 && (
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              <option value="">Todas categorias</option>
              {[...new Set(products.map(p => p.category).filter(Boolean))].sort().map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSync}
            disabled={syncing}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl transition-colors text-sm font-semibold shadow-sm"
            title="Sincronizar produtos do inventário como ingredientes"
          >
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
            Sincronizar
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl transition-colors text-sm font-semibold shadow-sm"
          >
            <Plus size={16} />
            Novo Ingrediente
          </button>
        </div>
      </div>

      {/* Modal Form */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) resetForm(); }}
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editingId ? 'Editar Ingrediente' : 'Novo Ingrediente'}
              </h3>
              <button
                type="button"
                onClick={resetForm}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            {/* Scrollable body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
                      <option value="und">Unidade (und)</option>
                      <option value="kg">Quilograma (kg)</option>
                      <option value="g">Grama (g)</option>
                      <option value="l">Litro (l)</option>
                      <option value="ml">Mililitro (ml)</option>
                      <option value="cx">Caixa (cx)</option>
                      <option value="pct">Pacote (pct)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Preço de compra (R$)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={formData.price_per_unit}
                      onChange={(e) => setFormData({ ...formData, price_per_unit: e.target.value })}
                      className={inputCls}
                      placeholder="0,00"
                    />
                  </div>
                </div>

                {/* Conteúdo da embalagem */}
                <div>
                  <label className={labelCls}>Conteúdo da embalagem</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formData.purchase_qty_per_unit}
                      onChange={e => setFormData({ ...formData, purchase_qty_per_unit: e.target.value })}
                      placeholder="1"
                      className={inputCls + ' w-24'}
                    />
                    <span className="text-xs text-slate-400">{formData.unit}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      = R$ {previewPricePerUnit}/{formData.unit}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Quantidade de {formData.unit} por embalagem comprada. Ex: 1 pacote = 2,5 kg → insira 2,5
                  </p>
                </div>
              </div>
              {/* Footer with action buttons */}
              <div className="flex gap-2 px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors"
                >
                  <Check size={15} /> {editingId ? 'Atualizar' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Vínculo Produto</th>
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
                filtered.map((ing) => {
                  const qty = ing.purchase_qty_per_unit ?? 1;
                  return (
                    <tr key={ing.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{ing.name}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded-lg text-xs font-mono">{ing.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-slate-700 dark:text-slate-300">
                        <div>
                          R$ {Number(ing.price_per_unit).toFixed(4)}/{ing.unit}
                          {(ing as any).product_id && (
                            <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">auto</span>
                          )}
                        </div>
                        {qty !== 1 && (
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">
                            ← R${(Number(ing.price_per_unit) * qty).toFixed(2)} / {qty}{ing.unit}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {(ing as any).product_id ? (
                          <div className="flex items-center gap-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 max-w-[150px] truncate">
                              <Link2 size={11} className="flex-shrink-0" />
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
                          <div className="w-48">
                            {linkingIngredientId === ing.id ? (
                              <div className="flex items-center gap-1">
                                <SearchableSelect
                                  options={productOptions}
                                  placeholder="Buscar produto..."
                                  onSelect={(val) => handleLinkProduct(ing.id, val)}
                                  className="scale-90 origin-left"
                                />
                                <button
                                  onClick={() => { setLinkingIngredientId(null); setShowProductSearch(false); }}
                                  className="p-1 text-slate-400 hover:text-slate-600"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setLinkingIngredientId(ing.id); setShowProductSearch(true); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                              >
                                <Link2 size={11} /> Vincular Produto
                              </button>
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hidden usage to prevent unused var warning */}
      {showProductSearch && <></>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIDES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function SidesTab({ hotelId }: { hotelId: string }) {
  const { addNotification } = useNotification();
  const [sides, setSides] = useState<Side[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState<{
    name: string;
    ingredients: { ingredient_id: string; quantity: string; unit: UnitType }[];
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
        .map((i) => ({
          side_id: editingId,
          ingredient_id: i.ingredient_id,
          quantity: parseFloat(i.quantity),
          unit: i.unit
        }));
      if (items.length > 0) await supabase.from('side_ingredients').insert(items);
    } else {
      const { data } = await supabase.from('sides').insert([{ name: formData.name, hotel_id: hotelId }]).select().single();
      if (data) {
        const items = formData.ingredients
          .filter((i) => i.ingredient_id && i.quantity)
          .map((i) => ({
            side_id: data.id,
            ingredient_id: i.ingredient_id,
            quantity: parseFloat(i.quantity),
            unit: i.unit
          }));
        if (items.length > 0) await supabase.from('side_ingredients').insert(items);
      }
    }
    resetForm();
    loadSides();
    addNotification('Acompanhamento salvo com sucesso!', 'success');
  }

  async function handleEdit(side: Side) {
    const { data } = await supabase.from('side_ingredients').select('*').eq('side_id', side.id);
    setEditingId(side.id);
    setFormData({
      name: side.name,
      ingredients: (data || []).map((si: any) => ({
        ingredient_id: si.ingredient_id,
        quantity: si.quantity.toString(),
        unit: si.unit || (ingredients.find(i => i.id === si.ingredient_id)?.unit || 'und')
      })),
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este acompanhamento?')) return;
    await supabase.from('sides').delete().eq('id', id);
    if (expandedId === id) setExpandedId(null);
    loadSides();
    addNotification('Acompanhamento excluído', 'info');
  }

  function resetForm() {
    setFormData({ name: '', ingredients: [] });
    setShowForm(false);
    setEditingId(null);
  }

  const ingredientOptions = ingredients.map(i => ({
    value: i.id,
    label: `${i.name} (${i.unit})`
  }));

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
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl transition-colors text-sm font-semibold shadow-sm"
        >
          <Plus size={16} />
          Novo Acompanhamento
        </button>
      </div>

      {/* Modal Form */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) resetForm(); }}
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editingId ? 'Editar Acompanhamento' : 'Novo Acompanhamento'}
              </h3>
              <button
                type="button"
                onClick={resetForm}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            {/* Scrollable body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
                      onClick={() => setFormData({ ...formData, ingredients: [...formData.ingredients, { ingredient_id: '', quantity: '', unit: 'und' }] })}
                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                    >
                      + Adicionar Ingrediente
                    </button>
                  </div>
                  <div className="space-y-3">
                    {formData.ingredients.map((ing, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row gap-2 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                        <div className="flex-1">
                          <SearchableSelect
                            options={ingredientOptions}
                            placeholder="Selecionar ingrediente..."
                            onSelect={(val) => {
                              const n = [...formData.ingredients];
                              n[idx].ingredient_id = val;
                              n[idx].unit = ingredients.find(i => i.id === val)?.unit || 'und';
                              setFormData({ ...formData, ingredients: n });
                            }}
                          />
                          {ing.ingredient_id && (
                            <p className="mt-1 text-[10px] text-slate-500 font-medium">
                              Selecionado: {ingredients.find(i => i.id === ing.ingredient_id)?.name}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="number" step="0.001" value={ing.quantity} placeholder="Qtd" required
                            onChange={(e) => { const n = [...formData.ingredients]; n[idx].quantity = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                            className="w-full sm:w-24 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                          />
                          <select
                            value={ing.unit}
                            onChange={(e) => { const n = [...formData.ingredients]; n[idx].unit = e.target.value as UnitType; setFormData({ ...formData, ingredients: n }); }}
                            className="w-full sm:w-28 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-2 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                          >
                            <option value="und">und</option>
                            <option value="kg">kg</option>
                            <option value="g">g</option>
                            <option value="l">l</option>
                            <option value="ml">ml</option>
                            <option value="cx">cx</option>
                            <option value="pct">pct</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, ingredients: formData.ingredients.filter((_, i) => i !== idx) })}
                            className="p-2 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Footer with action buttons */}
              <div className="flex gap-2 px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors"
                >
                  <Check size={15} /> {editingId ? 'Atualizar' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSides.length === 0 ? (
          <div className="col-span-full bg-white dark:bg-slate-800 p-10 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm text-center">
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
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
      <div
        className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-white truncate">{side.name}</h3>
          {!isExpanded && (
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase mt-0.5">
              Custo Estimado: R$ {totalCost.toFixed(2)}
            </p>
          )}
        </div>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} className="p-1.5 rounded-lg text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
            <Edit2 size={14} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-800/60 flex-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              <p className="text-xs text-slate-500">Carregando...</p>
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-3">Nenhum ingrediente adicionado</p>
          ) : (
            <div className="space-y-2">
              {items.map((si) => (
                <div key={si.id} className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-300 truncate mr-2">{si.ingredient?.name}</span>
                  <div className="text-right flex-shrink-0">
                    <span className="text-slate-400">{si.quantity}{si.unit || si.ingredient?.unit}</span>
                    <span className="ml-2 font-mono text-slate-900 dark:text-white font-semibold">
                      R$ {((si.quantity ?? 0) * getUnitFactor(si.unit || si.ingredient?.unit || 'und', si.ingredient?.unit || 'und') * (si.ingredient?.price_per_unit ?? 0)).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
              <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between font-bold">
                <span className="text-slate-500">Total:</span>
                <span className="text-emerald-600 dark:text-emerald-400">R$ {totalCost.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISHES TAB (dynamic categories)
// ═══════════════════════════════════════════════════════════════════════════════

interface DishWithCost extends Dish { cost: number; }

function DishesTab({
  hotelId,
  categoryId,
  categoryName,
  categories,
  onCategoriesChange,
  onDishMoved,
}: {
  hotelId: string;
  categoryId: string | null;
  categoryName: string;
  categories: DishCategory[];
  onCategoriesChange: () => void;
  onDishMoved: () => void;
}) {
  const { addNotification } = useNotification();
  const [dishes, setDishes] = useState<DishWithCost[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [sides, setSides] = useState<Side[]>([]);
  const [sectors, setSectors] = useState<{ id: string; name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [movingDishId, setMovingDishId] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    production_sector_id: string;
    ingredients: { ingredient_id: string; quantity: string; unit: UnitType }[];
    sides: { side_id: string; quantity: string }[];
  }>({ name: '', production_sector_id: '', ingredients: [], sides: [] });

  // Suppress unused import warnings
  void onCategoriesChange;

  const loadDishes = useCallback(async () => {
    let query = supabase.from('dishes').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    if (categoryId !== null) {
      query = query.eq('category_id', categoryId);
    } else {
      query = query.is('category_id', null);
    }
    const { data } = await query;
    const withCost = await Promise.all(
      (data || []).map(async (d) => ({ ...d, cost: await calculateDishCost(d.id) }))
    );
    setDishes(withCost);
  }, [hotelId, categoryId]);

  const loadIngredients = useCallback(async () => {
    const { data } = await supabase.from('ingredients').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    setIngredients(data || []);
  }, [hotelId]);

  const loadSides = useCallback(async () => {
    const { data } = await supabase.from('sides').select('*').or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order('name');
    setSides(data || []);
  }, [hotelId]);

  const loadSectors = useCallback(async () => {
    const { data } = await supabase.from('sectors').select('id, name').eq('hotel_id', hotelId).eq('is_active', true).order('name');
    setSectors(data || []);
  }, [hotelId]);

  useEffect(() => { loadDishes(); loadIngredients(); loadSides(); loadSectors(); }, [loadDishes, loadIngredients, loadSides, loadSectors]);

  const filteredDishes = search.trim()
    ? dishes.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
    : dishes;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const dishData = {
      name: formData.name,
      production_sector_id: formData.production_sector_id || null,
      type: 'dish' as const,
      category_id: categoryId,
      hotel_id: hotelId
    };

    if (editingId) {
      await supabase.from('dishes').update(dishData).eq('id', editingId);
      await supabase.from('dish_ingredients').delete().eq('dish_id', editingId);
      await supabase.from('dish_sides').delete().eq('dish_id', editingId);

      const ingItems = formData.ingredients.filter((i) => i.ingredient_id && i.quantity)
        .map((i) => ({
          dish_id: editingId,
          ingredient_id: i.ingredient_id,
          quantity: parseFloat(i.quantity),
          unit: i.unit
        }));
      const sideItems = formData.sides.filter((s) => s.side_id && s.quantity)
        .map((s) => ({ dish_id: editingId, side_id: s.side_id, quantity: parseInt(s.quantity) }));

      if (ingItems.length > 0) await supabase.from('dish_ingredients').insert(ingItems);
      if (sideItems.length > 0) await supabase.from('dish_sides').insert(sideItems);
    } else {
      const { data } = await supabase.from('dishes').insert([dishData]).select().single();
      if (data) {
        const ingItems = formData.ingredients.filter((i) => i.ingredient_id && i.quantity)
          .map((i) => ({
            dish_id: data.id,
            ingredient_id: i.ingredient_id,
            quantity: parseFloat(i.quantity),
            unit: i.unit
          }));
        const sideItems = formData.sides.filter((s) => s.side_id && s.quantity)
          .map((s) => ({ dish_id: data.id, side_id: s.side_id, quantity: parseInt(s.quantity) }));
        if (ingItems.length > 0) await supabase.from('dish_ingredients').insert(ingItems);
        if (sideItems.length > 0) await supabase.from('dish_sides').insert(sideItems);
      }
    }
    resetForm();
    loadDishes();
    addNotification('Ficha técnica salva com sucesso!', 'success');
  }

  async function handleEdit(dish: Dish) {
    const [ingRes, sidesRes] = await Promise.all([
      supabase.from('dish_ingredients').select('*').eq('dish_id', dish.id),
      supabase.from('dish_sides').select('*').eq('dish_id', dish.id),
    ]);
    setEditingId(dish.id);
    setFormData({
      name: dish.name,
      production_sector_id: dish.production_sector_id || '',
      ingredients: (ingRes.data || []).map((di: any) => ({
        ingredient_id: di.ingredient_id,
        quantity: di.quantity.toString(),
        unit: di.unit || (ingredients.find(i => i.id === di.ingredient_id)?.unit || 'und')
      })),
      sides: (sidesRes.data || []).map((ds: any) => ({ side_id: ds.side_id, quantity: ds.quantity.toString() })),
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir esta ficha técnica?')) return;
    await supabase.from('dishes').delete().eq('id', id);
    if (expandedId === id) setExpandedId(null);
    loadDishes();
    addNotification('Ficha técnica excluída', 'info');
  }

  async function handleMoveDish(dishId: string, targetCategoryId: string | null) {
    await supabase.from('dishes').update({ category_id: targetCategoryId }).eq('id', dishId);
    setMovingDishId(null);
    loadDishes();
    onDishMoved();
    addNotification('Ficha movida para outra categoria.', 'success');
  }

  function resetForm() {
    setFormData({ name: '', production_sector_id: '', ingredients: [], sides: [] });
    setShowForm(false);
    setEditingId(null);
  }

  const ingredientOptions = ingredients.map(i => ({
    value: i.id,
    label: `${i.name} (${i.unit})`
  }));

  const sideOptions = sides.map(s => ({
    value: s.id,
    label: s.name
  }));

  // Category color for theming
  const catData = categories.find(c => c.id === categoryId);
  const tabColor = catData?.color || (categoryId === null ? '#94a3b8' : '#f97316');

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tabColor }} />
          <h2 className="text-base font-bold text-slate-800 dark:text-white">{categoryName}</h2>
          <span className="text-xs text-slate-400">({filteredDishes.length} fichas)</span>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text" placeholder="Buscar ficha..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500 transition-colors"
            />
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-xl transition-colors text-sm font-semibold shadow-sm"
          >
            <Plus size={16} />
            Nova Ficha
          </button>
        </div>
      </div>

      {/* Modal Form */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) resetForm(); }}
        >
          <div className="w-full max-w-2xl bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editingId ? 'Editar Ficha' : `Nova Ficha — ${categoryName}`}
              </h3>
              <button
                type="button"
                onClick={resetForm}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            {/* Scrollable body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Nome da Ficha Técnica</label>
                    <input
                      type="text" required value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className={inputCls}
                      placeholder="Ex: Picanha na Chapa"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Setor de Produção (Opcional)</label>
                    <select
                      value={formData.production_sector_id}
                      onChange={(e) => setFormData({ ...formData, production_sector_id: e.target.value })}
                      className={selectCls}
                    >
                      <option value="">Setor dinâmico (conforme venda)</option>
                      {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <p className="mt-1 text-[10px] text-slate-400">
                      Se vazio, o sistema usará o setor que realizou a venda na Erbon.
                    </p>
                  </div>
                </div>

                {/* Ingredients */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className={labelCls}>Produtos / Ingredientes</label>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, ingredients: [...formData.ingredients, { ingredient_id: '', quantity: '', unit: 'und' }] })}
                      className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline"
                    >
                      + Adicionar Item
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {formData.ingredients.map((ing, idx) => (
                      <div key={idx} className="flex gap-2 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                        <div className="flex-1 min-w-0">
                          <SearchableSelect
                            options={ingredientOptions}
                            placeholder="Buscar produto..."
                            onSelect={(val) => {
                              const n = [...formData.ingredients];
                              n[idx].ingredient_id = val;
                              const found = ingredients.find(i => i.id === val);
                              n[idx].unit = found?.unit || 'und';
                              setFormData({ ...formData, ingredients: n });
                            }}
                          />
                          {ing.ingredient_id && (
                            <p className="mt-1 text-[10px] font-bold text-orange-600 dark:text-orange-400 truncate">
                              {ingredients.find(i => i.id === ing.ingredient_id)?.name}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1 items-start">
                          <input
                            type="text" inputMode="decimal" value={ing.quantity} placeholder="Qtd" required
                            onChange={(e) => { const n = [...formData.ingredients]; n[idx].quantity = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                            className="w-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-2 py-2.5 text-sm text-slate-900 dark:text-white"
                          />
                          <select
                            value={ing.unit}
                            onChange={(e) => { const n = [...formData.ingredients]; n[idx].unit = e.target.value as UnitType; setFormData({ ...formData, ingredients: n }); }}
                            className="w-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-1 py-2 text-sm text-slate-900 dark:text-white"
                          >
                            <option value="und">und</option>
                            <option value="kg">kg</option>
                            <option value="g">g</option>
                            <option value="l">l</option>
                            <option value="ml">ml</option>
                            <option value="cx">cx</option>
                            <option value="pct">pct</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, ingredients: formData.ingredients.filter((_, i) => i !== idx) })}
                            className="p-2 text-red-400 hover:text-red-600"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sides */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className={labelCls}>Acompanhamentos / Sub-Fichas</label>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, sides: [...formData.sides, { side_id: '', quantity: '1' }] })}
                      className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline"
                    >
                      + Adicionar Acompanhamento
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {formData.sides.map((side, idx) => (
                      <div key={idx} className="flex gap-2 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                        <div className="flex-1">
                          <SearchableSelect
                            options={sideOptions}
                            placeholder="Selecionar..."
                            onSelect={(val) => { const n = [...formData.sides]; n[idx].side_id = val; setFormData({ ...formData, sides: n }); }}
                          />
                          {side.side_id && <p className="mt-1 text-[10px] font-medium text-slate-400 truncate">{sides.find(s => s.id === side.side_id)?.name}</p>}
                        </div>
                        <div className="flex gap-1 items-start">
                          <input
                            type="number" step="1" value={side.quantity} placeholder="Qtd" required
                            onChange={(e) => { const n = [...formData.sides]; n[idx].quantity = e.target.value; setFormData({ ...formData, sides: n }); }}
                            className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-2 py-2.5 text-sm text-slate-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, sides: formData.sides.filter((_, i) => i !== idx) })}
                            className="p-2 text-red-400 hover:text-red-600"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Footer with action buttons */}
              <div className="flex gap-2 px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors"
                >
                  <Check size={15} /> {editingId ? 'Atualizar' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDishes.length === 0 ? (
          <div className="col-span-full bg-white dark:bg-slate-800 p-10 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {search ? 'Nenhum item encontrado' : 'Nenhum item cadastrado nesta categoria'}
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
              isOutros={categoryId === null}
              categories={categories}
              movingDishId={movingDishId}
              onStartMove={() => setMovingDishId(dish.id)}
              onCancelMove={() => setMovingDishId(null)}
              onMoveTo={(targetCatId) => handleMoveDish(dish.id, targetCatId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DishCard({
  dish,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  isOutros,
  categories,
  movingDishId,
  onStartMove,
  onCancelMove,
  onMoveTo,
}: {
  dish: DishWithCost;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isOutros: boolean;
  categories: DishCategory[];
  movingDishId: string | null;
  onStartMove: () => void;
  onCancelMove: () => void;
  onMoveTo: (categoryId: string | null) => void;
}) {
  const [details, setDetails] = useState<{ ingredients: DishIngredient[]; sides: DishSide[] } | null>(null);
  const [sideCosts, setSideCosts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);

  const isMoving = movingDishId === dish.id;

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
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col h-full group hover:border-slate-300 dark:hover:border-slate-500 transition-all">
      <div
        className="p-4 flex flex-col cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-sm font-bold text-slate-800 dark:text-white line-clamp-2 leading-tight">{dish.name}</h3>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {isOutros && (
              <button
                onClick={isMoving ? onCancelMove : onStartMove}
                className="p-1.5 rounded-lg text-slate-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                title="Mover para categoria"
              >
                <GripVertical size={14} />
              </button>
            )}
            <button onClick={onEdit} className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20">
              <Edit2 size={14} />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {isMoving && (
          <div className="mb-2" onClick={e => e.stopPropagation()}>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 font-semibold uppercase tracking-wide">Mover para:</p>
            <div className="flex flex-wrap gap-1">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => onMoveTo(cat.id)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-600 hover:border-orange-400 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors text-slate-700 dark:text-slate-300"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-auto">
          <span className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 flex items-center gap-1">
            <UtensilsCrossed size={10} />
            Prato
          </span>
          <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
            R$ {dish.cost.toFixed(2)}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 p-4 bg-slate-50/50 dark:bg-slate-900/40 space-y-4 flex-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {details?.ingredients && details.ingredients.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Ingredientes</h4>
                  <div className="space-y-1.5">
                    {details.ingredients.map((di) => (
                      <div key={di.id} className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-300 truncate mr-2">{di.ingredient?.name}</span>
                        <span className="text-slate-400 font-medium flex-shrink-0">{di.quantity}{di.unit || di.ingredient?.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {details?.sides && details.sides.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Acompanhamentos</h4>
                  <div className="space-y-1.5">
                    {details.sides.map((ds) => (
                      <div key={ds.id} className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-300 truncate mr-2">{ds.side?.name}</span>
                        <span className="text-slate-400 font-medium flex-shrink-0">{ds.quantity}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {details && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700 flex justify-between font-bold text-xs">
                  <span className="text-slate-500">Custo total:</span>
                  <span className="text-emerald-600 dark:text-emerald-400">R$ {totalCost.toFixed(2)}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
