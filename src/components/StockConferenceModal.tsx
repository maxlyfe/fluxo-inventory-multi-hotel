import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, ChevronRight, ChevronLeft, CheckCircle2, Save, ListChecks, AlertCircle, Play } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNotification } from '../context/NotificationContext';

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

const StockConferenceModal: React.FC<StockConferenceModalProps> = ({
  isOpen,
  onClose,
  products,
  hotelId,
  sectorId,
  onFinished
}) => {
  const { addNotification } = useNotification();
  const [searchTerm, setSearchTerm] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);

  // Organiza produtos por categoria
  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category || 'Sem Categoria')));
    return cats.sort();
  }, [products]);

  const currentCategory = categories[currentCategoryIndex];
  
  const filteredProducts = useMemo(() => {
    if (searchTerm) {
      return products.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.category || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return products.filter(p => (p.category || 'Sem Categoria') === currentCategory);
  }, [products, currentCategory, searchTerm]);

  // Busca rascunho ao abrir
  useEffect(() => {
    if (isOpen) {
      checkExistingDraft();
    } else {
      setCounts({});
      setSearchTerm('');
      setCurrentCategoryIndex(0);
      setActiveCountId(null);
    }
  }, [isOpen, hotelId, sectorId]);

  const checkExistingDraft = async () => {
    setIsLoadingDraft(true);
    try {
      let query = supabase
        .from('stock_counts')
        .select(`
          id,
          items:stock_count_items(product_id, counted_quantity)
        `)
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

  const handleCountChange = (productId: string, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      setCounts(prev => ({ ...prev, [productId]: numValue }));
    } else if (value === '') {
      const newCounts = { ...counts };
      delete newCounts[productId];
      setCounts(newCounts);
    }
  };

  const saveProgress = async (isFinal: boolean) => {
    if (Object.keys(counts).length === 0) {
      addNotification('Informe pelo menos uma quantidade.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      let countId = activeCountId;

      // 1. Cria ou atualiza o cabeçalho da conferência
      if (!countId) {
        const { data: newCount, error: countError } = await supabase
          .from('stock_counts')
          .insert({
            hotel_id: hotelId,
            sector_id: sectorId || null,
            status: isFinal ? 'finished' : 'draft',
            started_at: new Date().toISOString(),
            finished_at: isFinal ? new Date().toISOString() : null,
            notes: sectorId ? 'Conferência de Setor' : 'Conferência de Inventário Principal'
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
            finished_at: isFinal ? new Date().toISOString() : null
          })
          .eq('id', countId);

        if (updateError) throw updateError;
      }

      // 2. Salva os itens
      // IMPORTANTE: Removemos 'difference' pois o erro 428C9 indica que é uma coluna gerada.
      // Mantemos 'previous_quantity' pois o erro anterior indicou que é obrigatória.
      const countItems = Object.entries(counts).map(([productId, countedQty]) => {
        const product = products.find(p => p.id === productId);
        const previousQty = product?.quantity || 0;
        return {
          stock_count_id: countId,
          product_id: productId,
          previous_quantity: previousQty,
          counted_quantity: countedQty
        };
      });

      // Remove itens antigos do rascunho para reinserir os atuais
      const { error: deleteItemsError } = await supabase
        .from('stock_count_items')
        .delete()
        .eq('stock_count_id', countId);
      
      if (deleteItemsError) throw deleteItemsError;

      // Inserção dos itens sem a coluna gerada 'difference'
      const { error: itemsError } = await supabase
        .from('stock_count_items')
        .insert(countItems);

      if (itemsError) throw itemsError;

      // 3. Se for final, atualiza o estoque real
      if (isFinal) {
        for (const [productId, newQty] of Object.entries(counts)) {
          if (sectorId) {
            const { error: updateStockError } = await supabase
              .from('sector_stock')
              .update({ quantity: newQty })
              .eq('sector_id', sectorId)
              .eq('product_id', productId);
            if (updateStockError) throw updateStockError;
          } else {
            const { error: updateStockError } = await supabase
              .from('products')
              .update({ quantity: newQty })
              .eq('id', productId);
            if (updateStockError) throw updateStockError;
          }
        }
        addNotification('Conferência finalizada e estoque atualizado!', 'success');
        onFinished();
        onClose();
      } else {
        addNotification('Progresso salvo como rascunho.', 'success');
      }
    } catch (err: any) {
      console.error('Erro detalhado ao salvar conferência:', err);
      addNotification('Erro ao salvar: ' + (err.message || 'Erro desconhecido'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-indigo-50 dark:bg-indigo-900/20">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2 text-indigo-900 dark:text-indigo-100">
              <ListChecks className="w-6 h-6" />
              Conferência de Estoque
            </h2>
            <p className="text-sm text-indigo-600 dark:text-indigo-400">
              {sectorId ? 'Setor Selecionado' : 'Inventário Principal'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/50 dark:hover:bg-gray-700 rounded-full transition-colors">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        {/* Search & Category Nav */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Procurar em todos os itens..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {!searchTerm && (
            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 p-2 rounded-xl">
              <button 
                onClick={() => setCurrentCategoryIndex(prev => Math.max(0, prev - 1))}
                disabled={currentCategoryIndex === 0}
                className="p-2 disabled:opacity-30"
              >
                <ChevronLeft />
              </button>
              <span className="font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider text-sm">
                {currentCategory} ({currentCategoryIndex + 1}/{categories.length})
              </span>
              <button 
                onClick={() => setCurrentCategoryIndex(prev => Math.min(categories.length - 1, prev + 1))}
                disabled={currentCategoryIndex === categories.length - 1}
                className="p-2 disabled:opacity-30"
              >
                <ChevronRight />
              </button>
            </div>
          )}
        </div>

        {/* Product List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoadingDraft ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
              Buscando rascunho...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {searchTerm ? 'Nenhum item encontrado para sua busca.' : 'Nenhum item encontrado nesta categoria.'}
            </div>
          ) : (
            filteredProducts.map(product => (
              <div 
                key={product.id} 
                className={`p-4 rounded-xl border transition-all ${
                  counts[product.id] !== undefined 
                    ? 'border-green-200 bg-green-50 dark:bg-green-900/10 dark:border-green-900/30' 
                    : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-gray-800 dark:text-gray-200 truncate">{product.name}</h4>
                    <p className="text-xs text-gray-500">
                      {searchTerm && <span className="text-indigo-500 font-medium">{product.category} • </span>}
                      Estoque atual: {product.quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Qtd"
                      className="w-24 px-3 py-2 text-center font-bold bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      value={counts[product.id] ?? ''}
                      onChange={(e) => handleCountChange(product.id, e.target.value)}
                    />
                    {counts[product.id] !== undefined && (
                      <CheckCircle2 className="w-6 h-6 text-green-500" />
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex gap-3">
          <button
            onClick={() => saveProgress(false)}
            disabled={isSaving || Object.keys(counts).length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-bold rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 transition-all disabled:opacity-50"
          >
            <Save className="w-5 h-5" />
            Salvar Rascunho
          </button>
          <button
            onClick={() => saveProgress(true)}
            disabled={isSaving || Object.keys(counts).length === 0}
            className="flex-[1.5] flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none transition-all disabled:opacity-50"
          >
            {isSaving ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Finalizar Conferência
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockConferenceModal;
