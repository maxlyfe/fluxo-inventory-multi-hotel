import React, { useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  Package, ArrowLeft, Plus, Search, Grid, List, AlertTriangle, 
  ShoppingCart, X, Check, Clock, ChevronDown, ChevronUp, ImageIcon 
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { startOfWeek, endOfWeek, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { searchMatch } from '../utils/search';
import { notifyNewRequest } from '../lib/notificationTriggers';
import { useNotification } from '../context/NotificationContext';

interface Product {
  id: string;
  name: string;
  description: string;
  image_url: string;
  quantity: number;
  category: string;
  requestQuantity?: number;
  is_active: boolean;
  is_portionable?: boolean;
  is_portion?: boolean;
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
  const { id: sectorId } = useParams();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [sector, setSector] = useState<any>(null);
  
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [visibleForSectorIds, setVisibleForSectorIds] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<'sector' | 'all'>('sector');

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
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});

  const groupedHistory = useMemo(() => {
    const history = requisitions.filter(req => req.status !== 'pending');
    const groups: Record<string, Requisition[]> = {};

    history.forEach(req => {
      const reqDate = parseISO(req.created_at);
      const weekStart = startOfWeek(reqDate, { weekStartsOn: 1 });
      const weekKey = format(weekStart, 'yyyy-MM-dd');

      if (!groups[weekKey]) {
        groups[weekKey] = [];
      }
      groups[weekKey].push(req);
    });
    return Object.entries(groups).sort(([keyA], [keyB]) => keyB.localeCompare(keyA));
  }, [requisitions]);

  const toggleWeekExpansion = (weekKey: string) => {
    setExpandedWeeks(prev => ({ ...prev, [weekKey]: !prev[weekKey] }));
  };

  useEffect(() => {
    if (!selectedHotel?.id || !sectorId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');

        const { data: sectorData } = await supabase.from('sectors').select('*').eq('id', sectorId).single();
        setSector(sectorData);

        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*, is_portionable, is_portion')
          .eq('hotel_id', selectedHotel.id)
          .eq('is_active', true)
          .order('name');
        if (productsError) throw productsError;
        setAllProducts(productsData || []);

        const { data: visibilityData, error: visibilityError } = await supabase
          .from('product_sector_visibility')
          .select('product_id')
          .eq('sector_id', sectorId);
        if (visibilityError) throw visibilityError;
        setVisibleForSectorIds(new Set(visibilityData.map(v => v.product_id)));
        
        if (productsData) {
          const uniqueCategories = [...new Set(productsData.map(p => p.category))];
          setCategories(uniqueCategories.sort());
        }

        // CORREÇÃO DO ERRO 400: Removida a sintaxe complexa de JOIN que estava causando erro
        const { data: requisitionsData, error: requisitionsError } = await supabase
          .from('requisitions')
          .select(`
            id, 
            item_name, 
            quantity, 
            status, 
            created_at, 
            delivered_quantity, 
            rejection_reason, 
            product_id, 
            substituted_product_id,
            products:product_id(image_url),
            substituted_product:substituted_product_id(image_url)
          `)
          .eq('sector_id', sectorId)
          .eq('hotel_id', selectedHotel.id)
          .order('created_at', { ascending: false });
          
        if (requisitionsError) throw requisitionsError;
        if (requisitionsData) {
          setRequisitions(requisitionsData as any);
          setPendingCount(requisitionsData.filter(req => req.status === 'pending').length);
        }

      } catch (err: any) {
        console.error('Erro ao carregar dados:', err);
        setError('Erro ao carregar dados: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const channel = supabase.channel(`sector-requests-${sectorId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requisitions', filter: `sector_id=eq.${sectorId}` }, 
        (payload) => {
          fetchData();
        }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedHotel, sectorId]);

  const filteredProducts = useMemo(() => {
    let productsToShow = allProducts.filter(product => !product.is_portion);
    if (filterMode === 'sector') {
      productsToShow = productsToShow.filter(product => visibleForSectorIds.has(product.id));
    }
    if (selectedCategory) {
      productsToShow = productsToShow.filter(product => product.category === selectedCategory);
    }
    if (searchTerm.trim() !== '') {
      productsToShow = productsToShow.filter(product =>
        searchMatch(searchTerm, product.name) ||
        searchMatch(searchTerm, product.description || '')
      );
    }
    return productsToShow;
  }, [searchTerm, filterMode, selectedCategory, allProducts, visibleForSectorIds]);

  const handleQuantityChange = (productId: string, quantity: number) => {
    setAllProducts(prevProducts =>
      prevProducts.map(p =>
        p.id === productId ? { ...p, requestQuantity: Math.max(1, quantity) } : p
      )
    );
  };

  const handleAddToRequest = async (product: Product) => {
    try {
      if (!selectedHotel?.id || !sectorId) {
        throw new Error('Hotel ou setor não selecionado');
      }

      // CORREÇÃO DO ERRO 400: Simplificado o .select() para evitar erros de JOIN no INSERT
      const { data: newRequisition, error } = await supabase
        .from('requisitions')
        .insert([{
          sector_id: sectorId,
          product_id: product.id,
          item_name: product.name,
          quantity: product.requestQuantity || 1,
          status: 'pending',
          is_custom: false,
          hotel_id: selectedHotel.id
        }])
        .select()
        .single();

      if (error) throw error;
      if (!newRequisition) throw new Error("Falha ao criar requisição.");

      // Como simplificamos o select, adicionamos a imagem manualmente para o estado local
      const requisitionWithImage = {
        ...newRequisition,
        products: { image_url: product.image_url }
      };

      setRequisitions(currentRequisitions => [requisitionWithImage as any, ...currentRequisitions]);
      setPendingCount(currentCount => currentCount + 1);

      try {
        await notifyNewRequest({
          hotel_id: selectedHotel.id,
          sector_id: sectorId,
          product_name: product.name,
          quantity: product.requestQuantity || 1,
          sector_name: sector?.name || 'Setor',
          user_name: 'Usuário'
        });
      } catch (notificationError) {
        console.error('Erro ao enviar notificação:', notificationError);
      }

      setAllProducts(prev => prev.map(p => p.id === product.id ? { ...p, requestQuantity: 1 } : p));
      addNotification('Item adicionado à requisição!', 'success');

    } catch (err: any) {
      setError('Erro ao adicionar requisição: ' + err.message);
      addNotification('Erro ao adicionar requisição: ' + err.message, 'error');
    }
  };

  const handleAddCustomItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!selectedHotel?.id || !sectorId) {
        throw new Error('Hotel ou setor não selecionado');
      }

      const { data: newCustomRequisition, error } = await supabase
        .from('requisitions')
        .insert([{
          sector_id: sectorId,
          item_name: customItem.name,
          quantity: customItem.quantity,
          status: 'pending',
          is_custom: true,
          hotel_id: selectedHotel.id
        }])
        .select()
        .single();

      if (error) throw error;
      if (!newCustomRequisition) throw new Error("Falha ao criar requisição personalizada.");

      setRequisitions(currentRequisitions => [newCustomRequisition as any, ...currentRequisitions]);
      setPendingCount(currentCount => currentCount + 1);

      try {
        await notifyNewRequest({
          hotel_id: selectedHotel.id,
          sector_id: sectorId,
          product_name: customItem.name,
          quantity: customItem.quantity,
          sector_name: sector?.name || 'Setor',
          user_name: 'Usuário'
        });
      } catch (notificationError) {
        console.error('Erro ao enviar notificação:', notificationError);
      }

      setCustomItem({ name: '', quantity: 1 });
      setShowCustomForm(false);
      addNotification('Item personalizado adicionado!', 'success');

    } catch (err: any) {
      setError('Erro ao adicionar item personalizado: ' + err.message);
      addNotification('Erro ao adicionar item personalizado: ' + err.message, 'error');
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
        <div className="flex items-center mb-4 md:mb-0">
          <Link to="/" className="mr-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <ArrowLeft className="w-6 h-6 text-gray-600 dark:text-gray-400" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Requisições - {sector?.name || 'Carregando...'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {selectedHotel?.name}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowCart(!showCart)}
            className="relative p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-lg"
          >
            <ShoppingCart className="w-6 h-6" />
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowCustomForm(true)}
            className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shadow-md"
          >
            <Plus className="w-5 h-5 mr-2" />
            Item Personalizado
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded shadow-sm flex items-center">
          <AlertTriangle className="w-5 h-5 mr-2" />
          <p>{error}</p>
        </div>
      )}

      {showCart ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
              <Clock className="w-6 h-6 mr-2 text-blue-600" />
              Requisições Pendentes
            </h2>
            <button onClick={() => setShowCart(false)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              <X className="w-6 h-6" />
            </button>
          </div>
          {requisitions.filter(r => r.status === 'pending').length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">Nenhuma requisição pendente.</p>
          ) : (
            <div className="space-y-4">
              {requisitions.filter(r => r.status === 'pending').map((req) => (
                <div key={req.id} className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="flex items-center">
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center mr-4">
                      {req.products?.image_url ? (
                        <img src={req.products.image_url} alt={req.item_name} className="w-full h-full object-contain" />
                      ) : (
                        <Package className="w-6 h-6 text-gray-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">{req.item_name}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Quantidade: {req.quantity}</p>
                    </div>
                  </div>
                  <div className="flex items-center text-blue-600 font-medium">
                    <Clock className="w-4 h-4 mr-1" />
                    Pendente
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-10 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
              <List className="w-6 h-6 mr-2 text-purple-600" />
              Histórico de Requisições
            </h2>
            {groupedHistory.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">Nenhum histórico disponível.</p>
            ) : (
              <div className="space-y-6">
                {groupedHistory.map(([weekKey, weekRequests]) => (
                  <div key={weekKey} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleWeekExpansion(weekKey)}
                      className="w-full flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        Semana de {format(parseISO(weekKey), "dd/MM/yyyy", { locale: ptBR })}
                      </span>
                      {expandedWeeks[weekKey] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    {expandedWeeks[weekKey] && (
                      <div className="p-4 space-y-4 bg-white dark:bg-gray-800">
                        {weekRequests.map((req) => (
                          <div key={req.id} className="flex items-center justify-between p-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
                            <div className="flex items-center">
                              <div className="w-10 h-10 bg-gray-50 dark:bg-gray-700 rounded flex items-center justify-center mr-3">
                                {req.status === 'delivered' ? (
                                  <Check className="w-5 h-5 text-green-500" />
                                ) : (
                                  <X className="w-5 h-5 text-red-500" />
                                )}
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-gray-900 dark:text-white">{req.item_name}</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {format(parseISO(req.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-bold ${req.status === 'delivered' ? 'text-green-600' : 'text-red-600'}`}>
                                {req.status === 'delivered' ? `Entregue: ${req.delivered_quantity}` : 'Rejeitado'}
                              </p>
                              {req.rejection_reason && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 italic">Motivo: {req.rejection_reason}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Buscar produtos..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">Todas as Categorias</option>
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setFilterMode('sector')}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  filterMode === 'sector' ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Setor
              </button>
              <button
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  filterMode === 'all' ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Todos
              </button>
            </div>
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
              >
                <Grid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-20 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">Nenhum produto encontrado.</p>
            </div>
          ) : (
            <div className={
              viewMode === 'grid' 
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" 
              : "space-y-4"
            }>
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden ${
                    viewMode === 'list' ? 'flex items-center p-4' : 'p-4'
                  }`}
                >
                  <div className={`relative bg-gray-100 dark:bg-gray-700 flex items-center justify-center ${
                    viewMode === 'list' ? 'w-24 h-24 mr-6 rounded-lg' : 'w-full h-48 mb-4 rounded-lg'
                  }`}>
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          (e.target as any).src = ''; // Limpa o src quebrado
                          (e.target as any).style.display = 'none';
                          (e.target as any).nextSibling.style.display = 'block';
                        }}
                      />
                    ) : null}
                    <ImageIcon className={`w-12 h-12 text-gray-400 ${product.image_url ? 'hidden' : 'block'}`} />
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
