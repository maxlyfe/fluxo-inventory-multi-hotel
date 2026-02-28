import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Search, ChevronRight, ChevronLeft, CheckCircle2, Save,
  ListChecks, AlertTriangle, Hash, Package
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNotification } from '../context/NotificationContext';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface Product {
  id: string;
  name: string;
  category: string;
  quantity: number;
  image_url?: string | null;
}

interface StockConferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  hotelId: string;
  sectorId?: string;
  onFinished: () => void;
}

// ---------------------------------------------------------------------------
// Sub-componente: imagem com fallback
// ---------------------------------------------------------------------------

const ProductImage: React.FC<{ src?: string | null; name: string }> = ({ src, name }) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
        <Package className="w-7 h-7 text-gray-400" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-contain bg-gray-50 dark:bg-gray-700 flex-shrink-0"
    />
  );
};

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

const StockConferenceModal: React.FC<StockConferenceModalProps> = ({
  isOpen,
  onClose,
  products,
  hotelId,
  sectorId,
  onFinished,
}) => {
  const { addNotification } = useNotification();

  const [searchTerm, setSearchTerm] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);

  // ---------------------------------------------------------------------------
  // Dados derivados
  // ---------------------------------------------------------------------------

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category || 'Sem Categoria')));
    return cats.sort();
  }, [products]);

  const currentCategory = categories[currentCategoryIndex];

  const filteredProducts = useMemo(() => {
    if (searchTerm) {
      return products.filter(
        p =>
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (p.category || '').toLowerCase().includes(searchTerm.toLowerCase()),
      );
    }
    return products.filter(p => (p.category || 'Sem Categoria') === currentCategory);
  }, [products, currentCategory, searchTerm]);

  const filledCount = useMemo(() => Object.keys(counts).length, [counts]);
  const totalCount = products.length;

  const emptyProductIds = useMemo(
    () => products.filter(p => counts[p.id] === undefined).map(p => p.id),
    [products, counts],
  );

  // ---------------------------------------------------------------------------
  // Ciclo de vida
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (isOpen) {
      checkExistingDraft();
    } else {
      setCounts({});
      setSearchTerm('');
      setCurrentCategoryIndex(0);
      setActiveCountId(null);
      setShowFinalConfirm(false);
    }
  }, [isOpen, hotelId, sectorId]);

  // ---------------------------------------------------------------------------
  // Rascunho
  // ---------------------------------------------------------------------------

  const checkExistingDraft = async () => {
    setIsLoadingDraft(true);
    try {
      let query = supabase
        .from('stock_counts')
        .select('id, items:stock_count_items(product_id, counted_quantity)')
        .eq('hotel_id', hotelId)
        .eq('status', 'draft');

      if (sectorId) {
        query = query.eq('sector_id', sectorId);
      } else {
        query = query.is('sector_id', null);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;

      if (data) {
        const draftCounts: Record<string, number> = {};
        data.items.forEach((item: any) => {
          draftCounts[item.product_id] = item.counted_quantity;
        });
        setCounts(draftCounts);
        setActiveCountId(data.id);
        addNotification('Rascunho de conferência retomado.', 'info');
      }
    } catch (err) {
      console.error('Erro ao buscar rascunho:', err);
    } finally {
      setIsLoadingDraft(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleCountChange = (productId: string, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      setCounts(prev => ({ ...prev, [productId]: numValue }));
    } else if (value === '') {
      setCounts(prev => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    }
  };

  const handleZeroEmptyFields = () => {
    if (emptyProductIds.length === 0) {
      addNotification('Todos os campos já estão preenchidos.', 'info');
      return;
    }
    setCounts(prev => {
      const next = { ...prev };
      emptyProductIds.forEach(id => { next[id] = 0; });
      return next;
    });
    addNotification(`${emptyProductIds.length} campo(s) vazio(s) definido(s) como 0.`, 'success');
  };

  // ---------------------------------------------------------------------------
  // Salvar / Finalizar
  // ---------------------------------------------------------------------------

  const saveProgress = async (isFinal: boolean) => {
    if (Object.keys(counts).length === 0) {
      addNotification('Informe pelo menos uma quantidade.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      let countId = activeCountId;

      if (!countId) {
        const { data: newCount, error: countError } = await supabase
          .from('stock_counts')
          .insert({
            hotel_id: hotelId,
            sector_id: sectorId || null,
            status: isFinal ? 'finished' : 'draft',
            started_at: new Date().toISOString(),
            finished_at: isFinal ? new Date().toISOString() : null,
            notes: sectorId ? 'Conferência de Setor' : 'Conferência de Inventário Principal',
          })
          .select()
          .single();

        if (countError) throw countError;
        countId = newCount.id;
        setActiveCountId(countId);
      } else {
        const { error: updateError } = await supabase
          .from('stock_counts')
          .update({
            status: isFinal ? 'finished' : 'draft',
            finished_at: isFinal ? new Date().toISOString() : null,
          })
          .eq('id', countId);

        if (updateError) throw updateError;
      }

      const countItems = Object.entries(counts).map(([productId, countedQty]) => {
        const product = products.find(p => p.id === productId);
        return {
          stock_count_id: countId,
          product_id: productId,
          previous_quantity: product?.quantity || 0,
          counted_quantity: countedQty,
        };
      });

      const { error: deleteErr } = await supabase
        .from('stock_count_items')
        .delete()
        .eq('stock_count_id', countId);
      if (deleteErr) throw deleteErr;

      const { error: itemsErr } = await supabase
        .from('stock_count_items')
        .insert(countItems);
      if (itemsErr) throw itemsErr;

      if (isFinal) {
        for (const [productId, newQty] of Object.entries(counts)) {
          if (sectorId) {
            const { error: e } = await supabase
              .from('sector_stock')
              .update({ quantity: newQty })
              .eq('sector_id', sectorId)
              .eq('product_id', productId);
            if (e) throw e;
          } else {
            const { error: e } = await supabase
              .from('products')
              .update({ quantity: newQty })
              .eq('id', productId);
            if (e) throw e;
          }
        }
        addNotification('Conferência finalizada e estoque atualizado!', 'success');
        onFinished();
        onClose();
      } else {
        addNotification('Progresso salvo como rascunho.', 'success');
      }
    } catch (err: any) {
      console.error('Erro ao salvar conferência:', err);
      addNotification('Erro ao salvar: ' + (err.message || 'Erro desconhecido'), 'error');
    } finally {
      setIsSaving(false);
      setShowFinalConfirm(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!isOpen) return null;

  return (
    /* No mobile sobe como sheet; no desktop é modal centralizado */
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="
        bg-white dark:bg-gray-800
        w-full sm:max-w-2xl
        rounded-t-2xl sm:rounded-2xl
        shadow-2xl
        flex flex-col
        max-h-[95svh] sm:max-h-[90vh]
        overflow-hidden
      ">

        {/* Barra de arraste — só mobile */}
        <div className="flex justify-center pt-2 sm:hidden flex-shrink-0">
          <div className="w-10 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Header                                                              */}
        {/* ------------------------------------------------------------------ */}
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/20 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2 text-indigo-900 dark:text-indigo-100">
              <ListChecks className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0" />
              Conferência de Estoque
            </h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className="text-xs sm:text-sm text-indigo-600 dark:text-indigo-400">
                {sectorId ? 'Setor Selecionado' : 'Inventário Principal'}
              </p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                filledCount === totalCount
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
              }`}>
                {filledCount}/{totalCount} preenchidos
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/60 dark:hover:bg-gray-700 rounded-full transition-colors ml-3 flex-shrink-0"
            title="Fechar"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Busca e navegação de categorias                                     */}
        {/* ------------------------------------------------------------------ */}
        <div className="px-4 sm:px-6 py-3 border-b border-gray-100 dark:border-gray-700 space-y-2 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar produto..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          {!searchTerm && (
            <div className="flex items-center gap-2">
              {/* Navegação de categoria */}
              <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl flex-1 overflow-hidden">
                <button
                  onClick={() => setCurrentCategoryIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentCategoryIndex === 0}
                  className="p-2 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-bold text-indigo-600 dark:text-indigo-400 text-xs uppercase tracking-wide text-center px-1 truncate">
                  {currentCategory} ({currentCategoryIndex + 1}/{categories.length})
                </span>
                <button
                  onClick={() => setCurrentCategoryIndex(prev => Math.min(categories.length - 1, prev + 1))}
                  disabled={currentCategoryIndex === categories.length - 1}
                  className="p-2 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Botão zerar vazios */}
              {emptyProductIds.length > 0 && (
                <button
                  onClick={handleZeroEmptyFields}
                  title={`Zerar os ${emptyProductIds.length} produto(s) ainda não preenchido(s)`}
                  className="flex items-center gap-1 px-2.5 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 text-xs font-semibold rounded-xl transition-colors flex-shrink-0 border border-gray-200 dark:border-gray-600"
                >
                  <Hash className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Zerar vazios</span>
                  <span className="bg-gray-300 dark:bg-gray-500 text-gray-700 dark:text-gray-200 text-xs rounded-full px-1.5 py-0.5 leading-none">
                    {emptyProductIds.length}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Lista de produtos                                                   */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-2">
          {isLoadingDraft ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-3" />
              <p className="text-sm">Buscando rascunho...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">
                {searchTerm ? 'Nenhum item encontrado.' : 'Nenhum item nesta categoria.'}
              </p>
            </div>
          ) : (
            filteredProducts.map(product => {
              const isFilled = counts[product.id] !== undefined;
              return (
                <div
                  key={product.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                    isFilled
                      ? 'border-green-200 bg-green-50 dark:bg-green-900/10 dark:border-green-800/40'
                      : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/60'
                  }`}
                >
                  {/* Imagem */}
                  <ProductImage src={product.image_url} name={product.name} />

                  {/* Nome e info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm sm:text-base text-gray-800 dark:text-gray-100 leading-snug line-clamp-2">
                      {product.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {searchTerm && (
                        <span className="text-indigo-500 font-medium">{product.category} · </span>
                      )}
                      Atual: <span className="font-medium">{product.quantity}</span>
                    </p>
                  </div>

                  {/* Input + check */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <input
                      type="number"
                      placeholder="Qtd"
                      inputMode="numeric"
                      className={`
                        w-20 sm:w-24 px-2 py-2.5 text-center font-bold text-sm
                        rounded-xl border focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                        transition-colors
                        ${isFilled
                          ? 'bg-white dark:bg-gray-900 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200'
                        }
                      `}
                      value={counts[product.id] ?? ''}
                      onChange={e => handleCountChange(product.id, e.target.value)}
                    />
                    {/* Espaço fixo para não pular o layout */}
                    <div className="w-5 flex-shrink-0">
                      {isFilled && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Footer — normal ou confirmação de finalização                       */}
        {/* ------------------------------------------------------------------ */}
        {showFinalConfirm ? (
          <div className="px-4 sm:px-6 py-4 border-t border-gray-100 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/10 flex-shrink-0">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-amber-900 dark:text-amber-200 text-sm">
                  Confirmar finalização da conferência?
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                  O estoque real será atualizado com os valores informados.{' '}
                  <strong>{filledCount} de {totalCount}</strong> produto(s) preenchido(s).
                  {filledCount < totalCount && (
                    <span className="block mt-1 text-amber-600 dark:text-amber-300">
                      ⚠ {totalCount - filledCount} produto(s) sem valor não terão o estoque alterado.
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowFinalConfirm(false)}
                disabled={isSaving}
                className="flex-1 py-3 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-all disabled:opacity-50 text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => saveProgress(true)}
                disabled={isSaving}
                className="flex-[1.5] flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none transition-all disabled:opacity-50 text-sm"
              >
                {isSaving ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Sim, finalizar
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 sm:px-6 py-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex gap-3 flex-shrink-0">
            <button
              onClick={() => saveProgress(false)}
              disabled={isSaving || filledCount === 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-bold rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all disabled:opacity-50 text-sm"
            >
              <Save className="w-4 h-4" />
              Salvar Rascunho
            </button>
            <button
              onClick={() => setShowFinalConfirm(true)}
              disabled={isSaving || filledCount === 0}
              className="flex-[1.5] flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none transition-all disabled:opacity-50 text-sm"
            >
              <CheckCircle2 className="w-4 h-4" />
              Finalizar Conferência
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default StockConferenceModal;
