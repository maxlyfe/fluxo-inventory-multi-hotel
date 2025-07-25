import React, { useState, useEffect } from 'react';
import { X, Search, Package } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext'; // Adicionado para notificações

interface Product {
  id: string;
  name: string;
  category: string;
  quantity: number;
  image_url?: string;
}

interface AddInventoryItemModalProps {
  // 1. ADICIONADO "isOpen" para controlar a visibilidade
  isOpen: boolean; 
  onClose: () => void;
  onItemAdded: () => void; // Renomeado de onSuccess para onItemAdded para consistência
  sectorId: string;
}

const AddInventoryItemModal: React.FC<AddInventoryItemModalProps> = ({
  isOpen, // Usaremos esta prop
  onClose,
  onItemAdded,
  sectorId
}) => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification(); // Usando o hook de notificação
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [addingItem, setAddingItem] = useState(false);

  useEffect(() => {
    if (isOpen) { // Apenas busca os produtos se o modal estiver aberto
      const fetchProducts = async () => {
        try {
          if (!selectedHotel?.id) throw new Error('Hotel não selecionado');
          setLoading(true);
          setError(null);

          const { data: existingProducts } = await supabase
            .from('sector_stock')
            .select('product_id')
            .eq('sector_id', sectorId)
            .eq('hotel_id', selectedHotel.id);

          const existingProductIds = existingProducts?.map(item => item.product_id) || [];

          const { data, error } = await supabase
            .from('products')
            .select('id, name, category, quantity, image_url')
            .eq('hotel_id', selectedHotel.id)
            .eq('is_active', true)
            .order('name');

          if (error) throw error;

          const availableProducts = data?.filter(product => 
            !existingProductIds.includes(product.id)
          ) || [];

          setProducts(availableProducts);
          setFilteredProducts(availableProducts);
        } catch (err: any) {
          setError('Erro ao carregar produtos: ' + err.message);
        } finally {
          setLoading(false);
        }
      };

      fetchProducts();
    }
  }, [isOpen, selectedHotel, sectorId]); // Depende de isOpen para re-executar

  useEffect(() => {
    const filtered = products.filter(product =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredProducts(filtered);
  }, [searchTerm, products]);

  const handleAddToSector = async () => {
    try {
      if (!selectedHotel?.id || !selectedProduct) throw new Error('Selecione um produto');
      if (quantity <= 0) throw new Error('A quantidade deve ser maior que zero');
      setError(null);
      setAddingItem(true);

      const { error: rpcError } = await supabase.rpc('update_sector_stock_on_delivery', {
        p_hotel_id: selectedHotel.id,
        p_sector_id: sectorId,
        p_product_id: selectedProduct,
        p_quantity: quantity
      });

      if (rpcError) throw rpcError;
      
      addNotification('Item adicionado ao estoque do setor com sucesso!', 'success');
      onItemAdded(); // Chama a função para recarregar a página pai
      onClose(); // Fecha o modal
      
    } catch (err: any) {
      setError(err.message || 'Erro ao adicionar produto ao setor');
      addNotification(err.message || 'Erro ao adicionar produto ao setor', 'error');
    } finally {
      setAddingItem(false);
    }
  };
  
  // 2. ADICIONADO: Se o modal não estiver aberto, não renderiza nada.
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Adicionar Item do Inventário
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar produtos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              {searchTerm ? 'Nenhum produto encontrado.' : 'Todos os produtos já estão neste setor.'}
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  onClick={() => setSelectedProduct(product.id)}
                  className={`p-4 flex items-center space-x-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                    selectedProduct === product.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <div className="h-16 w-16 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} className="h-full w-full object-contain" />
                    ) : (
                      <Package className="h-8 w-8 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white">{product.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Categoria: {product.category}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Estoque Geral: {product.quantity}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedProduct && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Quantidade a adicionar ao setor
              </label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
          )}

          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleAddToSector}
              disabled={!selectedProduct || quantity <= 0 || addingItem}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {addingItem ? 'Adicionando...' : 'Adicionar ao Setor'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddInventoryItemModal;