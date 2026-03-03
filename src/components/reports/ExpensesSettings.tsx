// src/components/reports/ExpensesSettings.tsx
// Painel de configuração de categorias e fornecedores para o relatório
// de Despesas por Hóspede. Acessível via ícone de engrenagem dentro do relatório.

import React, { useState, useEffect, useCallback } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import {
  Settings, X, Plus, Pencil, Check, EyeOff, Eye, Trash2,
  Loader2, ChevronDown, ChevronRight, Tag, GripVertical,
  AlertCircle,
} from 'lucide-react';
import { format, startOfMonth } from 'date-fns';
import {
  getCategoriesForHotel,
  getSuppliersForHotel,
  createCategory,
  updateCategory,
  setHotelCategoryVisibility,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  type ExpenseCategory,
  type ExpenseSupplier,
} from '../../lib/expensesReportService';

// ── Paleta de cores para categorias ──────────────────────────────────────────
const COLOR_PALETTE = [
  '#22c55e','#3b82f6','#eab308','#ef4444','#8b5cf6',
  '#f97316','#06b6d4','#ec4899','#14b8a6','#6366f1',
];

// ── Tipos locais ──────────────────────────────────────────────────────────────
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;   // notifica o pai para recarregar dados
}

// ─────────────────────────────────────────────────────────────────────────────
const ExpensesSettings: React.FC<Props> = ({ isOpen, onClose, onChanged }) => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [categories,  setCategories]  = useState<ExpenseCategory[]>([]);
  const [suppliers,   setSuppliers]   = useState<ExpenseSupplier[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  // Estados de edição de categoria
  const [editingCatId,   setEditingCatId]   = useState<string | null>(null);
  const [newCatName,     setNewCatName]     = useState('');
  const [newCatColor,    setNewCatColor]    = useState(COLOR_PALETTE[0]);
  const [showNewCatForm, setShowNewCatForm] = useState(false);
  const [savingCat,      setSavingCat]      = useState(false);

  // Estados de edição de fornecedor
  const [editingSuppId,   setEditingSuppId]   = useState<string | null>(null);
  const [newSuppName,     setNewSuppName]     = useState('');
  const [addingSuppCatId, setAddingSuppCatId] = useState<string | null>(null);
  const [savingSupp,      setSavingSupp]      = useState(false);

  // ── Carregar dados ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true);
    const [catRes, suppRes] = await Promise.all([
      getCategoriesForHotel(selectedHotel.id),
      getSuppliersForHotel(selectedHotel.id),
    ]);
    if (catRes.error)  addNotification('Erro ao carregar categorias', 'error');
    if (suppRes.error) addNotification('Erro ao carregar fornecedores', 'error');
    setCategories(catRes.data  || []);
    setSuppliers(suppRes.data  || []);
    setLoading(false);
  }, [selectedHotel, addNotification]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  if (!isOpen) return null;

  // ── Helpers de fornecedor ─────────────────────────────────────────────────
  const suppliersFor = (catId: string) =>
    suppliers.filter(s => s.category_id === catId);

  const isSupplierVisible = (s: ExpenseSupplier) => {
    if (!s.hidden_from) return true;
    return new Date(s.hidden_from) > startOfMonth(new Date());
  };

  // ── Ações: Categorias ─────────────────────────────────────────────────────
  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setSavingCat(true);
    const { error } = await createCategory(newCatName, newCatColor, 'tag');
    if (error) { addNotification(error.message, 'error'); }
    else       { addNotification('Categoria criada!', 'success'); setShowNewCatForm(false); setNewCatName(''); await load(); onChanged(); }
    setSavingCat(false);
  };

  const handleUpdateCategory = async (id: string) => {
    if (!newCatName.trim()) return;
    setSavingCat(true);
    const { error } = await updateCategory(id, { name: newCatName, color_hex: newCatColor });
    if (error) { addNotification(error.message, 'error'); }
    else       { addNotification('Categoria atualizada!', 'success'); setEditingCatId(null); await load(); onChanged(); }
    setSavingCat(false);
  };

  const handleToggleCategoryVisibility = async (cat: ExpenseCategory) => {
    if (!selectedHotel?.id) return;
    const today = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    // Se já oculta, reativar (hidden_from = null)
    const newHiddenFrom = cat.hidden_from ? null : today;
    const { error } = await setHotelCategoryVisibility(selectedHotel.id, cat.id, newHiddenFrom);
    if (error) addNotification(error.message, 'error');
    else { addNotification(cat.hidden_from ? 'Categoria reativada!' : 'Categoria ocultada a partir de hoje', 'success'); await load(); onChanged(); }
  };

  const startEditCat = (cat: ExpenseCategory) => {
    setEditingCatId(cat.id);
    setNewCatName(cat.name);
    setNewCatColor(cat.color_hex);
    setExpandedCat(cat.id);
  };

  // ── Ações: Fornecedores ───────────────────────────────────────────────────
  const handleCreateSupplier = async (catId: string) => {
    if (!newSuppName.trim() || !selectedHotel?.id) return;
    setSavingSupp(true);
    const { error } = await createSupplier(selectedHotel.id, catId, newSuppName);
    if (error) { addNotification(error.message, 'error'); }
    else       { addNotification('Fornecedor adicionado!', 'success'); setAddingSuppCatId(null); setNewSuppName(''); await load(); onChanged(); }
    setSavingSupp(false);
  };

  const handleUpdateSupplier = async () => {
    if (!editingSuppId || !newSuppName.trim()) return;
    setSavingSupp(true);
    const { error } = await updateSupplier(editingSuppId, { name: newSuppName });
    if (error) { addNotification(error.message, 'error'); }
    else       { addNotification('Fornecedor atualizado!', 'success'); setEditingSuppId(null); await load(); onChanged(); }
    setSavingSupp(false);
  };

  const handleToggleSupplierVisibility = async (s: ExpenseSupplier) => {
    const today = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const newHiddenFrom = s.hidden_from ? null : today;
    const { error } = await updateSupplier(s.id, { hidden_from: newHiddenFrom });
    if (error) addNotification(error.message, 'error');
    else { addNotification(s.hidden_from ? 'Fornecedor reativado!' : 'Fornecedor ocultado a partir deste mês', 'success'); await load(); onChanged(); }
  };

  const handleDeleteSupplier = async (s: ExpenseSupplier) => {
    if (!window.confirm(`Excluir "${s.name}"? Os lançamentos históricos serão removidos permanentemente.`)) return;
    const { error } = await deleteSupplier(s.id);
    if (error) addNotification(error.message, 'error');
    else { addNotification('Fornecedor excluído.', 'success'); await load(); onChanged(); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 pt-16 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="font-bold text-gray-800 dark:text-white">Configurar Categorias e Fornecedores</h2>
              <p className="text-xs text-gray-400">{selectedHotel?.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* Lista de categorias */}
              {categories.map(cat => {
                const isHidden   = !!cat.hidden_from;
                const isExpanded = expandedCat === cat.id;
                const isEditing  = editingCatId === cat.id;
                const catSuppliers = suppliersFor(cat.id);
                const isAddingSupp = addingSuppCatId === cat.id;

                return (
                  <div key={cat.id}
                    className={`rounded-2xl border transition-all ${
                      isHidden
                        ? 'border-dashed border-gray-200 dark:border-gray-700 opacity-60'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    {/* Cabeçalho da categoria */}
                    <div className="flex items-center gap-3 p-4">
                      {/* Cor */}
                      <div className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color_hex }} />

                      {isEditing ? (
                        <div className="flex-1 flex items-center gap-2 flex-wrap">
                          <input
                            value={newCatName}
                            onChange={e => setNewCatName(e.target.value)}
                            className="flex-1 min-w-[140px] px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            placeholder="Nome da categoria"
                            autoFocus
                          />
                          {/* Paleta de cores */}
                          <div className="flex gap-1">
                            {COLOR_PALETTE.map(c => (
                              <button key={c} onClick={() => setNewCatColor(c)}
                                className={`w-5 h-5 rounded-full transition-transform ${newCatColor === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : ''}`}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                          <button onClick={() => handleUpdateCategory(cat.id)} disabled={savingCat}
                            className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors">
                            {savingCat ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => setEditingCatId(null)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                            <X className="w-3.5 h-3.5 text-gray-500" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button onClick={() => setExpandedCat(isExpanded ? null : cat.id)}
                            className="flex-1 flex items-center gap-2 text-left">
                            <span className={`font-semibold text-sm ${isHidden ? 'line-through text-gray-400' : 'text-gray-800 dark:text-white'}`}>
                              {cat.name}
                            </span>
                            <span className="text-xs text-gray-400">({catSuppliers.length} fornecedor{catSuppliers.length !== 1 ? 'es' : ''})</span>
                            {isHidden && (
                              <span className="text-xs text-orange-500 font-medium">
                                oculta desde {format(new Date(cat.hidden_from! + 'T12:00:00'), 'MM/yyyy')}
                              </span>
                            )}
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />
                              : <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />
                            }
                          </button>

                          {/* Ações da categoria */}
                          <div className="flex items-center gap-1">
                            <button onClick={() => startEditCat(cat)} title="Editar nome/cor"
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                              <Pencil className="w-3.5 h-3.5 text-gray-500" />
                            </button>
                            <button onClick={() => handleToggleCategoryVisibility(cat)}
                              title={isHidden ? 'Reativar categoria' : 'Ocultar categoria a partir deste mês'}
                              className={`p-1.5 rounded-lg transition-colors ${isHidden ? 'hover:bg-green-50 text-green-600' : 'hover:bg-orange-50 text-orange-500'}`}>
                              {isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Fornecedores da categoria (expandido) */}
                    {isExpanded && !isEditing && (
                      <div className="px-4 pb-4 space-y-2">
                        {catSuppliers.length === 0 && !isAddingSupp && (
                          <p className="text-xs text-gray-400 italic pl-5">Nenhum fornecedor cadastrado.</p>
                        )}

                        {catSuppliers.map(s => {
                          const visible    = isSupplierVisible(s);
                          const isEditSupp = editingSuppId === s.id;

                          return (
                            <div key={s.id}
                              className={`flex items-center gap-3 pl-5 pr-2 py-2 rounded-xl ${
                                visible
                                  ? 'bg-gray-50 dark:bg-gray-700/50'
                                  : 'bg-gray-50/50 dark:bg-gray-700/20 opacity-60'
                              }`}
                            >
                              <GripVertical className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />

                              {isEditSupp ? (
                                <div className="flex-1 flex items-center gap-2">
                                  <input
                                    value={newSuppName}
                                    onChange={e => setNewSuppName(e.target.value)}
                                    className="flex-1 px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    autoFocus
                                  />
                                  <button onClick={handleUpdateSupplier} disabled={savingSupp}
                                    className="p-1 rounded bg-green-100 text-green-700 hover:bg-green-200">
                                    {savingSupp ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                  </button>
                                  <button onClick={() => setEditingSuppId(null)}
                                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
                                    <X className="w-3 h-3 text-gray-400" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span className={`flex-1 text-sm ${!visible ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-200'}`}>
                                    {s.name}
                                  </span>
                                  {!visible && s.hidden_from && (
                                    <span className="text-xs text-orange-400">
                                      oculto desde {format(new Date(s.hidden_from + 'T12:00:00'), 'MM/yyyy')}
                                    </span>
                                  )}
                                  <div className="flex items-center gap-1">
                                    <button onClick={() => { setEditingSuppId(s.id); setNewSuppName(s.name); }}
                                      className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                                      <Pencil className="w-3 h-3 text-gray-400" />
                                    </button>
                                    <button onClick={() => handleToggleSupplierVisibility(s)}
                                      title={visible ? 'Ocultar a partir deste mês' : 'Reativar'}
                                      className={`p-1 rounded transition-colors ${visible ? 'hover:bg-orange-50 text-orange-400' : 'hover:bg-green-50 text-green-500'}`}>
                                      {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                    </button>
                                    <button onClick={() => handleDeleteSupplier(s)}
                                      className="p-1 rounded hover:bg-red-50 text-red-400 transition-colors">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}

                        {/* Adicionar fornecedor */}
                        {isAddingSupp ? (
                          <div className="flex items-center gap-2 pl-5">
                            <input
                              value={newSuppName}
                              onChange={e => setNewSuppName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleCreateSupplier(cat.id)}
                              className="flex-1 px-3 py-1.5 text-sm rounded-xl border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                              placeholder="Nome do fornecedor"
                              autoFocus
                            />
                            <button onClick={() => handleCreateSupplier(cat.id)} disabled={savingSupp}
                              className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                              {savingSupp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Adicionar'}
                            </button>
                            <button onClick={() => { setAddingSuppCatId(null); setNewSuppName(''); }}
                              className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700">
                              <X className="w-3.5 h-3.5 text-gray-400" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAddingSuppCatId(cat.id); setNewSuppName(''); setExpandedCat(cat.id); }}
                            className="flex items-center gap-2 pl-5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
                          >
                            <Plus className="w-3.5 h-3.5" /> Adicionar fornecedor
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Nova categoria */}
              {showNewCatForm ? (
                <div className="p-4 rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 space-y-3">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Nova categoria</p>
                  <input
                    value={newCatName}
                    onChange={e => setNewCatName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateCategory()}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    placeholder="Ex: Mercearia, Bebidas, Limpeza..."
                    autoFocus
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">Cor:</span>
                    {COLOR_PALETTE.map(c => (
                      <button key={c} onClick={() => setNewCatColor(c)}
                        className={`w-6 h-6 rounded-full transition-transform ${newCatColor === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : ''}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowNewCatForm(false); setNewCatName(''); }}
                      className="px-3 py-1.5 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                      Cancelar
                    </button>
                    <button onClick={handleCreateCategory} disabled={savingCat || !newCatName.trim()}
                      className="px-4 py-1.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                      {savingCat ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar categoria'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowNewCatForm(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-600 dark:hover:border-indigo-600 dark:hover:text-indigo-400 transition-colors">
                  <Plus className="w-4 h-4" />
                  Nova categoria
                </button>
              )}

              {/* Aviso sobre dados retroativos */}
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>Ocultar uma categoria ou fornecedor só afeta meses <strong>a partir da data de ocultação</strong>. O histórico anterior permanece no gráfico.</p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button onClick={onClose}
            className="px-5 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExpensesSettings;