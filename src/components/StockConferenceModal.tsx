import React, { useState, useMemo, useEffect } from 'react';
import { X, Search, ChevronLeft, ChevronRight, CheckCircle, Save, AlertCircle, Package } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNotification } from '../context/NotificationContext';

interface Product {
  id: string;
  name: string;
  quantity: number;
  category: string;
  unit?: string;
}

interface StockConferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  hotelId: string;
  sectorId?: string; // Opcional, se for do estoque principal
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [countedQuantities, setCountedQuantities] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Organizar produtos por categoria
  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category))].sort();
    return cats;
  }, [products]);

  // Filtrar produtos com base na busca
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return products;
    return products.filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  const currentProduct = filteredProducts[currentIndex];

  const handleQuantityChange = (val: string) => {
    if (!currentProduct) return;
    const num = parseFloat(val);
    setCountedQuantities(prev => ({
      ...prev,
      [currentProduct.id]: isNaN(num) ? 0 : num
    }));
  };

  const nextProduct = () => {
    if (currentIndex < filteredProducts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const prevProduct = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleFinish = async () => {
    if (Object.keys(countedQuantities).length === 0) {
      addNotification('Nenhum item foi conferido.', 'warning');
      return;
    }

    if (!window.confirm(`Deseja finalizar a conferência de ${Object.keys(countedQuantities).length} itens? O estoque será atualizado.`)) {
      return;
    }

    setIsSaving(true);
    try {
      // 1. Criar a sessão de conferência
      const { data: session, error: sessionError } = await supabase
        .from('stock_counts')
        .insert({
          hotel_id: hotelId,
          sector_id: sectorId || null,
          status: 'completed',
          finished_at: new Date().toISOString()
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      // 2. Preparar itens para o histórico e atualizações de estoque
      const countItems = [];
      for (const productId in countedQuantities) {
        const product = products.find(p => p.id === productId);
        if (!product) continue;

        const newQty = countedQuantities[productId];
        const oldQty = product.quantity;

        countItems.push({
          stock_count_id: session.id,
          product_id: productId,
          previous_quantity: oldQty,
          counted_quantity: newQty
        });

        // 3. Atualizar o estoque real
        if (sectorId) {
          // Atualizar no setor
          await supabase
            .from('sector_stock')
            .update({ quantity: newQty })
            .eq('sector_id', sectorId)
            .eq('product_id', productId);
            
          // Registrar movimento no setor se necessário (opcional, dependendo da lógica do projeto)
        } else {
          // Atualizar no estoque principal
          await supabase
            .from('products')
            .update({ quantity: newQty })
            .eq('id', productId);

          // Registrar movimento de inventário
          await supabase
            .from('inventory_movements')
            .insert({
              product_id: productId,
              hotel_id: hotelId,
              quantity_change: newQty - oldQty,
              movement_type: 'ajuste',
              reason: 'Conferência de estoque'
            });
        }
      }

      // 4. Salvar itens do histórico
      const { error: itemsError } = await supabase
        .from('stock_count_items')
        .insert(countItems);

      if (itemsError) throw itemsError;

      addNotification('Conferência finalizada e estoque atualizado!', 'success');
      onFinished();
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar conferência:', err);
      addNotification('Erro ao salvar conferência: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const progress = filteredProducts.length > 0 
    ? Math.round((Object.keys(countedQuantities).length / filteredProducts.length) * 100) 
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Package className="w-6 h-6" />
              Conferência de Estoque
            </h2>
            <p className="text-blue-100 text-sm">
              {sectorId ? 'Setor' : 'Estoque Principal'} • {products.length} itens totais
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search & Progress */}
        <div className="p-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Procurar item específico..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border-gray-200 dark:border-gray-700 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentIndex(0);
              }}
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 transition-all duration-500" 
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {Object.keys(countedQuantities).length}/{filteredProducts.length} conferidos
            </span>
          </div>
        </div>

        {/* Content - Wizard */}
        <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center text-center">
          {currentProduct ? (
            <div className="w-full max-w-md space-y-6">
              <div className="space-y-2">
                <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-xs font-bold uppercase tracking-wider">
                  {currentProduct.category}
                </span>
                <h3 className="text-2xl font-bold text-gray-800 dark:text-white">
                  {currentProduct.name}
                </h3>
                <p className="text-gray-500 dark:text-gray-400">
                  Estoque atual no sistema: <span className="font-bold text-gray-700 dark:text-gray-200">{currentProduct.quantity} {currentProduct.unit || 'und'}</span>
                </p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900/30 p-8 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
                  QUANTIDADE ENCONTRADA NA PRATELEIRA
                </label>
                <div className="flex items-center justify-center gap-4">
                  <input
                    type="number"
                    autoFocus
                    key={currentProduct.id}
                    className="w-32 text-center text-4xl font-bold bg-transparent border-b-4 border-blue-500 focus:outline-none focus:border-blue-600 text-gray-800 dark:text-white"
                    value={countedQuantities[currentProduct.id] ?? ''}
                    onChange={(e) => handleQuantityChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') nextProduct();
                    }}
                  />
                  <span className="text-xl text-gray-400 font-medium">{currentProduct.unit || 'und'}</span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-4">
                <button
                  onClick={prevProduct}
                  disabled={currentIndex === 0}
                  className="flex items-center gap-2 px-4 py-2 text-gray-500 hover:text-blue-600 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" /> Anterior
                </button>
                <div className="text-sm text-gray-400">
                  Item {currentIndex + 1} de {filteredProducts.length}
                </div>
                <button
                  onClick={nextProduct}
                  disabled={currentIndex === filteredProducts.length - 1}
                  className="flex items-center gap-2 px-4 py-2 text-gray-500 hover:text-blue-600 disabled:opacity-30 transition-colors"
                >
                  Próximo <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <AlertCircle className="w-16 h-16 text-gray-300 mx-auto" />
              <p className="text-gray-500">Nenhum produto encontrado para conferência.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex justify-between items-center">
          <button
            onClick={onClose}
            className="px-6 py-2 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleFinish}
            disabled={isSaving || Object.keys(countedQuantities).length === 0}
            className="flex items-center gap-2 px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all transform hover:scale-105 active:scale-95"
          >
            {isSaving ? (
              <>Salvando...</>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
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
