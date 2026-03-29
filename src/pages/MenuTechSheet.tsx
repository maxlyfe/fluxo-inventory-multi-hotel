import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, Search, ChevronDown, ChevronUp, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Ingredient, UnitType, Side, SideIngredient, Dish, DishIngredient, DishSide } from '../types/menu';

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
    supabase
      .from('dish_ingredients')
      .select('quantity, ingredient:ingredients(price_per_unit)')
      .eq('dish_id', dishId),
    supabase
      .from('dish_sides')
      .select('quantity, side_id')
      .eq('dish_id', dishId),
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

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ingredients', label: 'Ingredientes' },
  { key: 'sides', label: 'Acompanhamentos' },
  { key: 'dishes', label: 'Pratos' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function MenuTechSheet() {
  const [activeTab, setActiveTab] = useState<TabKey>('ingredients');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
          Fichas Técnicas
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 min-w-[120px] px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'ingredients' && <IngredientsTab />}
      {activeTab === 'sides' && <SidesTab />}
      {activeTab === 'dishes' && <DishesTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INGREDIENTS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function IngredientsTab() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [filtered, setFiltered] = useState<Ingredient[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', unit: 'g' as UnitType, price_per_unit: '' });

  const loadIngredients = useCallback(async () => {
    const { data } = await supabase.from('ingredients').select('*').order('name');
    setIngredients(data || []);
  }, []);

  useEffect(() => { loadIngredients(); }, [loadIngredients]);

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
      await supabase.from('ingredients').insert([payload]);
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

  function resetForm() {
    setFormData({ name: '', unit: 'g', price_per_unit: '' });
    setShowForm(false);
    setEditingId(null);
  }

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar ingrediente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
          />
        </div>
        <button
          onClick={() => { showForm ? resetForm() : setShowForm(true); }}
          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
        >
          {showForm ? <X size={18} /> : <Plus size={18} />}
          {showForm ? 'Cancelar' : 'Novo Ingrediente'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
              <input
                type="text" required value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
                placeholder="Ex: Mel"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unidade</label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value as UnitType })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
              >
                <option value="g">Gramas (g)</option>
                <option value="ml">Mililitros (ml)</option>
                <option value="und">Unidade (und)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Preço por Unidade (R$)</label>
              <input
                type="number" step="0.00000001" required value={formData.price_per_unit}
                onChange={(e) => setFormData({ ...formData, price_per_unit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm">
              <Check size={16} /> {editingId ? 'Atualizar' : 'Salvar'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors text-sm">
                <X size={16} /> Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nome</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Unidade</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Preço por Unidade</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    {search ? 'Nenhum ingrediente encontrado' : 'Nenhum ingrediente cadastrado'}
                  </td>
                </tr>
              ) : (
                filtered.map((ing) => (
                  <tr key={ing.id} className="hover:bg-gray-100 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{ing.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{ing.unit}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 font-mono">
                      R$ {Number(ing.price_per_unit).toFixed(8)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleEdit(ing)} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mr-2 p-1">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => handleDelete(ing.id)} className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-1">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
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

function SidesTab() {
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
    const { data } = await supabase.from('sides').select('*').order('name');
    setSides(data || []);
  }, []);

  const loadIngredients = useCallback(async () => {
    const { data } = await supabase.from('ingredients').select('*').order('name');
    setIngredients(data || []);
  }, []);

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
      const { data } = await supabase.from('sides').insert([{ name: formData.name }]).select().single();
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" placeholder="Buscar acompanhamento..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        </div>
        <button
          onClick={() => { showForm ? resetForm() : setShowForm(true); }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          {showForm ? <X size={18} /> : <Plus size={18} />}
          {showForm ? 'Cancelar' : 'Novo Acompanhamento'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Acompanhamento</label>
            <input
              type="text" required value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              placeholder="Ex: Molho Caesar"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Ingredientes</label>
              <button type="button"
                onClick={() => setFormData({ ...formData, ingredients: [...formData.ingredients, { ingredient_id: '', quantity: '' }] })}
                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                + Adicionar Ingrediente
              </button>
            </div>
            <div className="space-y-2">
              {formData.ingredients.map((ing, idx) => (
                <div key={idx} className="flex gap-2">
                  <select value={ing.ingredient_id}
                    onChange={(e) => { const n = [...formData.ingredients]; n[idx].ingredient_id = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" required
                  >
                    <option value="">Selecione...</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                  <input type="number" step="0.001" value={ing.quantity} placeholder="Qtd" required
                    onChange={(e) => { const n = [...formData.ingredients]; n[idx].quantity = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                    className="w-24 sm:w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                  <button type="button" onClick={() => setFormData({ ...formData, ingredients: formData.ingredients.filter((_, i) => i !== idx) })}
                    className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-2">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm">
              <Check size={16} /> {editingId ? 'Atualizar' : 'Salvar'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors text-sm">
                <X size={16} /> Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {filteredSides.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 text-center text-gray-500 dark:text-gray-400">
            {search ? 'Nenhum acompanhamento encontrado' : 'Nenhum acompanhamento cadastrado'}
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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 flex justify-between items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50" onClick={onToggle}>
        <div className="flex items-center gap-3">
          {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white">{side.name}</h3>
            {isExpanded && !loading && items.length > 0 && (
              <p className="text-xs text-green-600 dark:text-green-400 font-medium mt-0.5">Total: R$ {totalCost.toFixed(2)}</p>
            )}
          </div>
        </div>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 p-2"><Edit2 size={16} /></button>
          <button onClick={onDelete} className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-2"><Trash2 size={16} /></button>
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900">
          {loading ? (
            <p className="text-gray-500 dark:text-gray-400 text-center text-sm">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center text-sm">Nenhum ingrediente adicionado</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 dark:text-gray-400">
                    <th className="pb-2 font-medium">Ingrediente</th>
                    <th className="pb-2 text-right font-medium">Quantidade</th>
                    <th className="pb-2 text-right font-medium">Preço Unit.</th>
                    <th className="pb-2 text-right font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((si) => (
                    <tr key={si.id} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="py-2 text-gray-900 dark:text-gray-100">{si.ingredient?.name}</td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">{si.quantity} {si.ingredient?.unit}</td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400 font-mono">R$ {Number(si.ingredient?.price_per_unit ?? 0).toFixed(6)}</td>
                      <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-100">R$ {((si.quantity ?? 0) * (si.ingredient?.price_per_unit ?? 0)).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-bold">
                    <td colSpan={3} className="py-2 text-right text-gray-700 dark:text-gray-300">Total:</td>
                    <td className="py-2 text-right text-green-600 dark:text-green-400">R$ {totalCost.toFixed(2)}</td>
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

function DishesTab() {
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
    const { data } = await supabase.from('dishes').select('*').order('name');
    const withCost = await Promise.all(
      (data || []).map(async (d) => ({ ...d, cost: await calculateDishCost(d.id) }))
    );
    setDishes(withCost);
  }, []);

  const loadIngredients = useCallback(async () => {
    const { data } = await supabase.from('ingredients').select('*').order('name');
    setIngredients(data || []);
  }, []);

  const loadSides = useCallback(async () => {
    const { data } = await supabase.from('sides').select('*').order('name');
    setSides(data || []);
  }, []);

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
      const { data } = await supabase.from('dishes').insert([{ name: formData.name }]).select().single();
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar prato..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
            <Printer size={18} /> Imprimir
          </button>
          <button onClick={() => { showForm ? resetForm() : setShowForm(true); }}
            className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors text-sm font-medium">
            {showForm ? <X size={18} /> : <Plus size={18} />}
            {showForm ? 'Cancelar' : 'Novo Prato'}
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Prato</label>
            <input type="text" required value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
              placeholder="Ex: Salada Caesar de Frango"
            />
          </div>

          {/* Ingredients */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Ingredientes Diretos</label>
              <button type="button"
                onClick={() => setFormData({ ...formData, ingredients: [...formData.ingredients, { ingredient_id: '', quantity: '' }] })}
                className="text-sm text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300">
                + Adicionar Ingrediente
              </button>
            </div>
            <div className="space-y-2">
              {formData.ingredients.map((ing, idx) => (
                <div key={idx} className="flex gap-2">
                  <select value={ing.ingredient_id}
                    onChange={(e) => { const n = [...formData.ingredients]; n[idx].ingredient_id = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                  >
                    <option value="">Selecione...</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                  <input type="number" step="0.001" value={ing.quantity} placeholder="Qtd"
                    onChange={(e) => { const n = [...formData.ingredients]; n[idx].quantity = e.target.value; setFormData({ ...formData, ingredients: n }); }}
                    className="w-24 sm:w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                  />
                  <button type="button" onClick={() => setFormData({ ...formData, ingredients: formData.ingredients.filter((_, i) => i !== idx) })}
                    className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-2"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Sides */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Acompanhamentos</label>
              <button type="button"
                onClick={() => setFormData({ ...formData, sides: [...formData.sides, { side_id: '', quantity: '1' }] })}
                className="text-sm text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300">
                + Adicionar Acompanhamento
              </button>
            </div>
            <div className="space-y-2">
              {formData.sides.map((side, idx) => (
                <div key={idx} className="flex gap-2">
                  <select value={side.side_id}
                    onChange={(e) => { const n = [...formData.sides]; n[idx].side_id = e.target.value; setFormData({ ...formData, sides: n }); }}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                  >
                    <option value="">Selecione...</option>
                    {sides.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input type="number" step="1" value={side.quantity} placeholder="Qtd"
                    onChange={(e) => { const n = [...formData.sides]; n[idx].quantity = e.target.value; setFormData({ ...formData, sides: n }); }}
                    className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                  />
                  <button type="button" onClick={() => setFormData({ ...formData, sides: formData.sides.filter((_, i) => i !== idx) })}
                    className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-2"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>

          <button type="submit"
            className="w-full flex justify-center items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium">
            {editingId ? <><Check size={16} /> Salvar Alterações</> : <><Plus size={16} /> Criar Prato</>}
          </button>
        </form>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {filteredDishes.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 text-center text-gray-500 dark:text-gray-400">
            {search ? 'Nenhum prato encontrado' : 'Nenhum prato cadastrado'}
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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 flex justify-between items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50" onClick={onToggle}>
        <div className="flex items-center gap-3">
          {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
          <div>
            <span className="text-sm font-semibold text-gray-800 dark:text-white">{dish.name}</span>
            <span className="ml-3 text-xs font-medium text-green-600 dark:text-green-400">
              Custo: R$ {dish.cost.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 p-2"><Edit2 size={16} /></button>
          <button onClick={onDelete} className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-2"><Trash2 size={16} /></button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900 space-y-4">
          {loading ? (
            <p className="text-gray-500 dark:text-gray-400 text-center text-sm">Carregando...</p>
          ) : (
            <>
              {details?.ingredients && details.ingredients.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Ingredientes Diretos</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-600 dark:text-gray-400">
                          <th className="pb-2 font-medium">Ingrediente</th>
                          <th className="pb-2 text-right font-medium">Quantidade</th>
                          <th className="pb-2 text-right font-medium">Preço Unit.</th>
                          <th className="pb-2 text-right font-medium">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.ingredients.map((di) => (
                          <tr key={di.id} className="border-t border-gray-200 dark:border-gray-700">
                            <td className="py-2 text-gray-900 dark:text-gray-100">{di.ingredient?.name}</td>
                            <td className="py-2 text-right text-gray-600 dark:text-gray-400">{di.quantity} {di.ingredient?.unit}</td>
                            <td className="py-2 text-right text-gray-600 dark:text-gray-400 font-mono">R$ {Number(di.ingredient?.price_per_unit ?? 0).toFixed(6)}</td>
                            <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-100">R$ {((di.quantity ?? 0) * (di.ingredient?.price_per_unit ?? 0)).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {details?.sides && details.sides.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Acompanhamentos</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-600 dark:text-gray-400">
                          <th className="pb-2 font-medium">Acompanhamento</th>
                          <th className="pb-2 text-right font-medium">Porções</th>
                          <th className="pb-2 text-right font-medium">Preço/Porção</th>
                          <th className="pb-2 text-right font-medium">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.sides.map((ds) => {
                          const sc = sideCosts.get(ds.side_id) || 0;
                          return (
                            <tr key={ds.id} className="border-t border-gray-200 dark:border-gray-700">
                              <td className="py-2 text-gray-900 dark:text-gray-100">{ds.side?.name}</td>
                              <td className="py-2 text-right text-gray-600 dark:text-gray-400">{ds.quantity}x</td>
                              <td className="py-2 text-right text-gray-600 dark:text-gray-400">R$ {sc.toFixed(2)}</td>
                              <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-100">R$ {(sc * (ds.quantity ?? 0)).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t-2 border-gray-300 dark:border-gray-600">
                <div className="flex justify-between items-center text-sm font-bold">
                  <span className="text-gray-700 dark:text-gray-300">Custo Total:</span>
                  <span className="text-green-600 dark:text-green-400 text-base">R$ {totalCost.toFixed(2)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
