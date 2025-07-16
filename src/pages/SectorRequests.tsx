import React, { useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  Package, ArrowLeft, Plus, Search, Grid, List, AlertTriangle, 
  ShoppingCart, X, Check, Clock, ChevronDown, ChevronUp, ImageIcon 
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { startOfWeek, endOfWeek, format, parseISO, isWithinInterval } from 'date-fns'; // Add isWithinInterval
import { ptBR } from 'date-fns/locale';
import { searchMatch } from '../utils/search'; // Importar a função de busca
// ✅ ADICIONE ESTA IMPORTAÇÃO PARA NOTIFICAÇÕES
import { notifyNewRequest } from '../lib/notificationTriggers';

interface Product {
  id: string;
  name: string;
  description: string;
  image_url: string;
  quantity: number;
  category: string;
  requestQuantity?: number;
  is_active: boolean;
}

interface CustomItem {
  name: string;
  quantity: number;
}

interface Requisition {
  id: string;
  item_name: string;
  quantity: number;
  status: 'pending' | 'delivered' | 'rejected';
  created_at: string;
  delivered_quantity?: number;
  rejection_reason?: string;
  product_id?: string;
  substituted_product_id?: string;
  products?: {
    image_url: string;
  };
  substituted_product?: {
    image_url: string;
  };
}

const SectorRequests = () => {
  const { id } = useParams();
  const { selectedHotel } = useHotel();
  const [sector, setSector] = useState(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customItem, setCustomItem] = useState<CustomItem>({ name: '', quantity: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCart, setShowCart] = useState(false);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({}); // Use Record<string, boolean>

  // Group requisitions by week
  const groupedHistory = useMemo(() => {
    const history = requisitions.filter(req => req.status !== 'pending');
    const groups: Record<string, Requisition[]> = {};

    history.forEach(req => {
      const reqDate = parseISO(req.created_at);
      const weekStart = startOfWeek(reqDate, { weekStartsOn: 1 }); // Monday
      const weekEnd = endOfWeek(reqDate, { weekStartsOn: 1 }); // Sunday
      const weekKey = format(weekStart, 'yyyy-MM-dd');

      if (!groups[weekKey]) {
        groups[weekKey] = [];
      }
      groups[weekKey].push(req);
    });

    // Sort weeks chronologically (most recent first)
    return Object.entries(groups).sort(([keyA], [keyB]) => keyB.localeCompare(keyA));
  }, [requisitions]);

  // Function to toggle week expansion
  const toggleWeekExpansion = (weekKey: string) => {
    setExpandedWeeks(prev => ({ ...prev, [weekKey]: !prev[weekKey] }));
  };

  useEffect(() => {
    if (!selectedHotel?.id || !id) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch sector details
        const { data: sectorData } = await supabase
          .from('sectors')
          .select('*')
          .eq('id', id)
          .single();

        setSector(sectorData);

        // Fetch only active products
        const { data: productsData } = await supabase
          .from('products')
          .select('*')
          .eq('hotel_id', selectedHotel.id)
          .eq('is_active', true)
          .order('category')
          .order('name');

        if (productsData) {
          setProducts(productsData);
          setFilteredProducts(productsData);
          
          // Extract unique categories
          const uniqueCategories = [...new Set(productsData.map(p => p.category))];
          setCategories(uniqueCategories.sort());
        }

        // Fetch requisitions with both main and substituted product images
        const { data: requisitionsData, error: requisitionsError } = await supabase
          .from('requisitions')
          .select(`
            *,
            products!requisitions_product_id_fkey (image_url),
            substituted_product:products!requisitions_substituted_product_id_fkey (image_url)
          `)
          .eq('sector_id', id)
          .eq('hotel_id', selectedHotel.id)
          .order('created_at', { ascending: false });

        if (requisitionsError) throw requisitionsError;

        if (requisitionsData) {
          setRequisitions(requisitionsData);
          const pendingReqs = requisitionsData.filter(req => req.status === 'pending');
          setPendingCount(pendingReqs.length);
        }

      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Subscribe to changes
    const channel = supabase
      .channel('custom-all-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requisitions', filter: `sector_id=eq.${id}` },
        (payload) => {
          console.log("Change received!", payload);
          // Handle real-time updates more efficiently
          const { eventType, new: newRecord, old: oldRecord } = payload;

          setRequisitions(currentRequisitions => {
            let updatedRequisitions = [...currentRequisitions];

            if (eventType === "INSERT") {
              // Add the new requisition to the beginning of the list
              updatedRequisitions = [newRecord as Requisition, ...updatedRequisitions];
            } else if (eventType === "UPDATE") {
              // Find and update the existing requisition
              updatedRequisitions = updatedRequisitions.map(req => 
                req.id === newRecord.id ? (newRecord as Requisition) : req
              );
            } else if (eventType === "DELETE") {
              // Remove the deleted requisition
              updatedRequisitions = updatedRequisitions.filter(req => req.id !== oldRecord.id);
            }
            
            // Recalculate pending count after updating requisitions
            const pendingReqs = updatedRequisitions.filter(req => req.status === "pending");
            setPendingCount(pendingReqs.length);

            return updatedRequisitions;
          });
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [selectedHotel, id]);

  useEffect(() => {
    const filtered = products.filter(product => {
      // Usar searchMatch para busca insensível a acentos no nome e descrição
      const matchesSearch = searchMatch(searchTerm, product.name) || 
                          searchMatch(searchTerm, product.description || '');
      const matchesCategory = !selectedCategory || product.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
    setFilteredProducts(filtered);
  }, [searchTerm, selectedCategory, products]);

  const handleQuantityChange = (productId: string, quantity: number) => {
    setProducts(prevProducts =>
      prevProducts.map(p =>
        p.id === productId ? { ...p, requestQuantity: Math.max(1, quantity) } : p
      )
    );
  };

  // ✅ FUNÇÃO MODIFICADA COM NOTIFICAÇÃO
  const handleAddToRequest = async (product: Product) => {
    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel não selecionado');
      }

      const { data, error } = await supabase
        .from('requisitions')
        .insert([{
          sector_id: id,
          product_id: product.id,
          item_name: product.name,
          quantity: product.requestQuantity || 1,
          status: 'pending',
          is_custom: false,
          hotel_id: selectedHotel.id
        }])
        .select();

      if (error) throw error;

      // ✅ DISPARAR NOTIFICAÇÃO APÓS CRIAR REQUISIÇÃO
      try {
        await notifyNewRequest({
          hotel_id: selectedHotel.id,
          sector_id: id,
          product_name: product.name,
          quantity: product.requestQuantity || 1,
          sector_name: sector?.name || 'Setor',
          user_name: 'Usuário' // Você pode buscar o nome real do usuário se necessário
        });
        console.log('Notificação enviada com sucesso!');
      } catch (notificationError) {
        console.error('Erro ao enviar notificação:', notificationError);
        // Não interrompe o fluxo se a notificação falhar
      }

      // Reset request quantity
      setProducts(prevProducts =>
        prevProducts.map(p =>
          p.id === product.id ? { ...p, requestQuantity: 1 } : p
        )
      );

      alert('Item adicionado à requisição com sucesso!');
    } catch (err) {
      console.error('Error adding request:', err);
      setError('Erro ao adicionar requisição');
    }
  };

  // ✅ FUNÇÃO MODIFICADA COM NOTIFICAÇÃO
  const handleAddCustomItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel não selecionado');
      }

      const { data, error } = await supabase
        .from('requisitions')
        .insert([{
          sector_id: id,
          item_name: customItem.name,
          quantity: customItem.quantity,
          status: 'pending',
          is_custom: true,
          hotel_id: selectedHotel.id
        }])
        .select();

      if (error) throw error;

      // ✅ DISPARAR NOTIFICAÇÃO APÓS CRIAR ITEM PERSONALIZADO
      try {
        await notifyNewRequest({
          hotel_id: selectedHotel.id,
          sector_id: id,
          product_name: customItem.name,
          quantity: customItem.quantity,
          sector_name: sector?.name || 'Setor',
          user_name: 'Usuário' // Você pode buscar o nome real do usuário se necessário
        });
        console.log('Notificação enviada com sucesso!');
      } catch (notificationError) {
        console.error('Erro ao enviar notificação:', notificationError);
        // Não interrompe o fluxo se a notificação falhar
      }

      setCustomItem({ name: '', quantity: 1 });
      setShowCustomForm(false);
      alert('Item personalizado adicionado com sucesso!');
    } catch (err) {
      console.error('Error adding custom item:', err);
      setError('Erro ao adicionar item personalizado');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <Link to="/" className="flex items-center text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white">
          <ArrowLeft className="w-5 h-5 mr-2" />
          Voltar
        </Link>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
          {sector?.name || 'Carregando...'}
        </h1>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-800 text-red-700 dark:text-red-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 inline mr-2" />
          {error}
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowCart(!showCart)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ShoppingCart className="w-5 h-5 mr-2" />
            {showCart ? 'Voltar aos Produtos' : 'Ver Requisições'}
            {!showCart && pendingCount > 0 && (
              <span className="ml-2 bg-blue-500 px-2 py-0.5 rounded-full text-sm">
                {pendingCount}
              </span>
            )}
          </button>
          {!showCart && (
            <button
              onClick={() => setShowCustomForm(true)}
              className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <Plus className="w-5 h-5 mr-2" />
              Item Personalizado
            </button>
          )}
        </div>
      </div>

      {showCart ? (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
            Requisições Pendentes
          </h2>
          {requisitions.filter(req => req.status === 'pending').length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              Nenhuma requisição pendente.
            </div>
          ) : (
            <div className="space-y-4">
              {requisitions
                .filter(req => req.status === 'pending')
                .map((req) => (
                  <div
                    key={req.id}
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="h-16 w-16 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center">
                        {req.products?.image_url ? (
                          <img
                            src={req.products.image_url}
                            alt={req.item_name}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <Package className="h-8 w-8 text-gray-400" />
                        )}
                      </div>
                      <div className="flex-grow">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {req.item_name}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Quantidade: {req.quantity}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Solicitado em: {new Date(req.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                          <Clock className="h-4 w-4 mr-1" />
                          Pendente
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}

          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mt-8 mb-4">
            Histórico de Requisições
          </h2>
          {groupedHistory.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              Nenhuma requisição no histórico.
            </div>
          ) : (
            <div className="space-y-4">
              {groupedHistory.map(([weekKey, weekRequisitions]) => {
                const weekStartDate = parseISO(weekKey);
                const weekEndDate = endOfWeek(weekStartDate, { weekStartsOn: 1 });
                const weekLabel = `Semana de ${format(weekStartDate, "dd/MM")} a ${format(weekEndDate, "dd/MM/yyyy")}`;
                const isExpanded = expandedWeeks[weekKey];

                return (
                  <div key={weekKey} className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
                    <button
                      onClick={() => toggleWeekExpansion(weekKey)}
                      className="w-full flex justify-between items-center px-6 py-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">{weekLabel}</h3>
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {weekRequisitions.map((req) => (
                          <div key={req.id} className="p-6">
                            <div className="flex items-center space-x-4">
                              <div className="h-16 w-16 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center">
                                {(req.substituted_product?.image_url || req.products?.image_url) ? (
                                  <img
                                    src={req.substituted_product?.image_url || req.products?.image_url}
                                    alt={req.item_name}
                                    className="h-full w-full object-contain"
                                  />
                                ) : (
                                  <Package className="h-8 w-8 text-gray-400" />
                                )}
                              </div>
                              <div className="flex-grow">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                  {req.item_name}
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                  Quantidade: {req.delivered_quantity || req.quantity}
                                </p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                  Solicitado em: {new Date(req.created_at).toLocaleString()}
                                </p>
                                {req.status === 'rejected' && req.rejection_reason && (
                                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                                    Motivo: {req.rejection_reason}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                                  req.status === 'delivered' 
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                }`}>
                                  {req.status === 'delivered' ? (
                                    <Check className="h-4 w-4 mr-1" />
                                  ) : (
                                    <X className="h-4 w-4 mr-1" />
                                  )}
                                  {req.status === 'delivered' ? 'Entregue' : 'Rejeitado'}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Search and filter controls */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Buscar produtos..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">Todas as categorias</option>
                {categories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
              >
                <Grid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Products grid/list */}
          {filteredProducts.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              {searchTerm || selectedCategory ? 'Nenhum produto encontrado com os filtros aplicados.' : 'Nenhum produto disponível.'}
            </div>
          ) : (
            <div className={viewMode === 'grid' 
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
              : "space-y-4"
            }>
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden ${
                    viewMode === 'list' ? 'flex items-center p-4' : 'p-4'
                  }`}
                >
                  <div className={`${viewMode === 'list' ? 'w-24 h-24 mr-4' : 'w-full h-48 mb-4'} bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center`}>
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="w-12 h-12 text-gray-400" />
                    )}
                  </div>
                  <div className={viewMode === 'list' ? 'flex-grow' : ''}>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      {product.name}
                    </h3>
                    {product.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        {product.description}
                      </p>
                    )}
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                      Categoria: {product.category}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                      Estoque: {product.quantity}
                    </p>
                    <div className="flex items-center space-x-2 mb-4">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Quantidade:
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={product.requestQuantity || 1}
                        onChange={(e) => handleQuantityChange(product.id, parseInt(e.target.value))}
                        className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <button
                      onClick={() => handleAddToRequest(product)}
                      className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Adicionar à Requisição
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Custom item modal */}
      {showCustomForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Adicionar Item Personalizado
              </h2>
              <button
                onClick={() => setShowCustomForm(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleAddCustomItem} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Nome do Item
                </label>
                <input
                  type="text"
                  value={customItem.name}
                  onChange={(e) => setCustomItem({ ...customItem, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Quantidade
                </label>
                <input
                  type="number"
                  min="1"
                  value={customItem.quantity}
                  onChange={(e) => setCustomItem({ ...customItem, quantity: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCustomForm(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SectorRequests;

