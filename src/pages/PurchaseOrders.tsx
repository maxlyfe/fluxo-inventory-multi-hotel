import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  ShoppingCart, Search, Filter, ChevronDown, ChevronUp,
  Package, ArrowRight, Image as ImageIcon, History 
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';

interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  category: string;
  supplier?: string;
  image_url?: string;
  description?: string;
  last_purchase_date?: string;
  last_purchase_price?: number;
  average_price?: number;
}

const PurchaseOrders = () => {
  const { selectedHotel } = useHotel();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!selectedHotel?.id) return;

    const fetchProducts = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('hotel_id', selectedHotel.id)
          .order('supplier')
          .order('name');

        if (error) throw error;

        // Filter products with low stock
        const lowStockProducts = (data || []).filter(product => 
          product.quantity <= product.min_quantity
        );

        setProducts(lowStockProducts);
        
        // Extract unique suppliers
        const uniqueSuppliers = [...new Set(lowStockProducts
          .map(p => p.supplier)
          .filter(Boolean)
        )].sort();
        
        setSuppliers(uniqueSuppliers);
      } catch (err) {
        console.error('Error fetching products:', err);
        setError('Erro ao carregar produtos');
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [selectedHotel]);

  const handleCreateOrder = () => {
    // If items are selected, navigate with state
    if (selectedProducts.size > 0) {
      const selectedProductDetails = products.filter(p => selectedProducts.has(p.id));
      navigate('/purchases/list', { 
        state: { selectedProductDetails }
      });
    } else {
      // If no items are selected, navigate without state (to create a blank budget)
      navigate('/purchases/list');
    }
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProducts(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(productId)) {
        newSelected.delete(productId);
      } else {
        newSelected.add(productId);
      }
      return newSelected;
    });
  };

  const filteredProducts = products.filter(product => {
    const matchesSupplier = !selectedSupplier || product.supplier === selectedSupplier;
    const matchesSearch = searchTerm === '' || 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.supplier || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSupplier && matchesSearch;
  });

  // Group products by supplier
  const groupedProducts = filteredProducts.reduce((acc, product) => {
    const supplier = product.supplier || 'Sem Fornecedor';
    if (!acc[supplier]) {
      acc[supplier] = [];
    }
    acc[supplier].push(product);
    return acc;
  }, {} as Record<string, Product[]>);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white flex items-center">
          <ShoppingCart className="h-8 w-8 text-blue-600 dark:text-blue-400 mr-3" />
          Itens com Estoque Baixo
        </h1>
        <div className="flex items-center space-x-4 mt-4 md:mt-0">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Filter className="w-5 h-5 mr-2" />
            Filtros
            {showFilters ? (
              <ChevronUp className="w-5 h-5 ml-2" />
            ) : (
              <ChevronDown className="w-5 h-5 ml-2" />
            )}
          </button>
          <button
            onClick={() => navigate("/budget-history")}
            className="flex items-center px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
          >
            <History className="w-5 h-5 mr-2" />
            Histórico
          </button>
          <button
            onClick={handleCreateOrder}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            // Button is now always enabled
          >
            <ArrowRight className="w-5 h-5 mr-2" />
            Criar Orçamento
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Buscar
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por nome ou fornecedor..."
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Fornecedor
              </label>
              <select
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Todos os Fornecedores</option>
                {suppliers.map((supplier) => (
                  <option key={supplier} value={supplier}>
                    {supplier}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-8">
        {Object.entries(groupedProducts).map(([supplier, items]) => (
          <div key={supplier} className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
                {supplier}
              </h2>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((product) => {
                const isSelected = selectedProducts.has(product.id);
                const quantityToBuy = product.max_quantity - product.quantity;
                
                return (
                  <div 
                    key={product.id}
                    className={`p-4 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${
                      isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                    onClick={() => toggleProductSelection(product.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="h-16 w-16 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <Package className="h-8 w-8 text-gray-400" />
                          )}
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-200">
                            {product.name}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Estoque: {product.quantity} | Comprar: {quantityToBuy}
                          </p>
                          {product.last_purchase_price && (
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              Último preço: R$ {product.last_purchase_price.toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center">
                        <div className={`w-6 h-6 rounded-full border-2 ${
                          isSelected 
                            ? 'border-blue-500 bg-blue-500' 
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {isSelected && (
                            <svg className="w-5 h-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {filteredProducts.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
            <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
              Nenhum item encontrado
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Não há itens com estoque baixo que correspondam aos filtros selecionados.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PurchaseOrders;

