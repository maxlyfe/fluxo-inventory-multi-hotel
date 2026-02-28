import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ShoppingCart, Download, Package, Search, Filter, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';
import { useHotel } from '../context/HotelContext';

interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  category: string;
  supplier: string | null;
  updated_at: string;
}

const ShoppingList = () => {
  const { selectedHotel } = useHotel();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchLowStockProducts = async () => {
    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel não selecionado');
      }

      // Get all products
      const { data, error: queryError } = await supabase
        .from('products')
        .select('*')
        .eq('hotel_id', selectedHotel.id)
        .order('category')
        .order('name');

      if (queryError) throw queryError;

      // Filter products with low stock locally
      const lowStockProducts = (data || []).filter(product => 
        product.quantity <= product.min_quantity
      );

      setProducts(lowStockProducts);
      
      // Extract unique categories and suppliers
      const uniqueCategories = [...new Set(lowStockProducts.map(p => p.category))];
      const uniqueSuppliers = [...new Set(lowStockProducts.map(p => p.supplier).filter(Boolean))];
      
      setCategories(uniqueCategories.sort());
      setSuppliers(uniqueSuppliers.sort());

    } catch (err) {
      console.error('Error fetching low stock products:', err);
      setError('Erro ao carregar produtos com estoque baixo. Por favor, tente novamente.');
      setProducts([]);
      setCategories([]);
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedHotel?.id) {
      fetchLowStockProducts();

      // Subscribe to products table changes
      const productsChannel = supabase
        .channel('products-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'products',
            filter: `hotel_id=eq.${selectedHotel.id}`
          },
          () => {
            console.log('Products changed, refreshing...');
            fetchLowStockProducts();
          }
        )
        .subscribe();

      // Subscribe to inventory movements
      const movementsChannel = supabase
        .channel('inventory-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_movements',
            filter: `hotel_id=eq.${selectedHotel.id}`
          },
          () => {
            console.log('Inventory movement detected, refreshing...');
            fetchLowStockProducts();
          }
        )
        .subscribe();

      return () => {
        productsChannel.unsubscribe();
        movementsChannel.unsubscribe();
      };
    }
  }, [selectedHotel?.id]);

  const exportShoppingList = () => {
    const shoppingList = products
      .map(product => {
        const quantityToBuy = product.max_quantity - product.quantity;
        
        return {
          'Item': product.name,
          'Categoria': product.category,
          'Fornecedor': product.supplier || '-',
          'Estoque Atual': product.quantity,
          'Estoque Mínimo': product.min_quantity,
          'Estoque Máximo': product.max_quantity,
          'Quantidade a Comprar': quantityToBuy,
          'Última Atualização': new Date(product.updated_at).toLocaleString()
        };
      })
      .sort((a, b) => (a['Quantidade a Comprar'] > b['Quantidade a Comprar'] ? -1 : 1));

    if (shoppingList.length === 0) {
      alert('Não há itens que precisam ser repostos no momento.');
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(shoppingList);

    const colWidths = [
      { wch: 30 }, // Item
      { wch: 15 }, // Categoria
      { wch: 20 }, // Fornecedor
      { wch: 15 }, // Estoque Atual
      { wch: 15 }, // Estoque Mínimo
      { wch: 15 }, // Estoque Máximo
      { wch: 20 }, // Quantidade a Comprar
      { wch: 20 }  // Última Atualização
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Lista de Compras');
    XLSX.writeFile(wb, `lista-de-compras-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = !selectedCategory || product.category === selectedCategory;
    const matchesSupplier = !selectedSupplier || product.supplier === selectedSupplier;
    return matchesSearch && matchesCategory && matchesSupplier;
  });

  const groupedProducts = filteredProducts.reduce((acc, product) => {
    const key = selectedSupplier ? product.category : (product.supplier || 'Sem Fornecedor');
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(product);
    return acc;
  }, {} as Record<string, Product[]>);

  if (!selectedHotel) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
            Selecione um hotel
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Por favor, selecione um hotel para continuar.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center space-x-4 mb-8">
        <Link
          to="/inventory"
          className="flex items-center text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-5 w-5 mr-1" />
          Voltar para Inventário
        </Link>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 space-y-4 md:space-y-0">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white flex items-center">
          <ShoppingCart className="h-8 w-8 text-purple-600 dark:text-purple-400 mr-3" />
          Lista de Compras
        </h1>
        <div className="flex items-center space-x-4">
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
            onClick={exportShoppingList}
            className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
          >
            <Download className="w-5 h-5 mr-2" />
            Exportar Lista
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 p-4 rounded-lg mb-8">
          {error}
        </div>
      )}

      {showFilters && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Buscar
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por nome..."
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 pl-10"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Categoria
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="">Todas as Categorias</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Fornecedor
              </label>
              <select
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
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

      {products.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
          <Package className="h-16 w-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
            Nenhum item para comprar
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Todos os itens estão com estoque adequado no momento.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedProducts).map(([groupName, items]) => (
            <div key={groupName} className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
                  {groupName}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Item
                      </th>
                      {!selectedSupplier && (
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Fornecedor
                        </th>
                      )}
                      {!selectedCategory && (
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Categoria
                        </th>
                      )}
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Estoque Atual
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Estoque Mínimo
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Estoque Máximo
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Quantidade a Comprar
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Última Atualização
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {items.map((item) => {
                      const quantityToBuy = item.max_quantity - item.quantity;
                      
                      return (
                        <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">
                            {item.name}
                          </td>
                          {!selectedSupplier && (
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                              {item.supplier || '-'}
                            </td>
                          )}
                          {!selectedCategory && (
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                              {item.category}
                            </td>
                          )}
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 dark:text-red-400 font-medium">
                            {item.quantity}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                            {item.min_quantity}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                            {item.max_quantity}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 dark:text-green-400 font-medium">
                            {quantityToBuy}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                            {new Date(item.updated_at).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ShoppingList;