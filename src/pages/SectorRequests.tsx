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
import { useNotification } from '../context/NotificationContext'; // Importar o hook de notificação

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
  const { id: sectorId } = useParams();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification(); // Usar o hook de notificação
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
          .select('*')
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

        const { data: requisitionsData, error: requisitionsError } = await supabase
          .from('requisitions')
          .select(`*, products!requisitions_product_id_fkey(image_url), substituted_product:products!requisitions_substituted_product_id_fkey(image_url)`)
          .eq('sector_id', sectorId)
          .eq('hotel_id', selectedHotel.id)
          .order('created_at', { ascending: false });
        if (requisitionsError) throw requisitionsError;
        if (requisitionsData) {
          setRequisitions(requisitionsData);
          setPendingCount(requisitionsData.filter(req => req.status === 'pending').length);
        }

      } catch (err: any) {
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
    let productsToShow = allProducts;
    if (searchTerm.trim() !== '') {
      return allProducts.filter(product =>
        searchMatch(searchTerm, product.name) ||
        searchMatch(searchTerm, product.description || '')
      );
    }
    if (filterMode === 'sector') {
      productsToShow = allProducts.filter(product => visibleForSectorIds.has(product.id));
    }
    if (selectedCategory) {
      productsToShow = productsToShow.filter(product => product.category === selectedCategory);
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

  // --- FUNÇÃO ATUALIZADA PARA ATUALIZAÇÃO INSTANTÂNEA ---
  const handleAddToRequest = async (product: Product) => {
    try {
      if (!selectedHotel?.id || !sectorId) {
        throw new Error('Hotel ou setor não selecionado');
      }

      // Usamos .select().single() para obter o registo recém-criado de volta
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
        .select(`*, products!requisitions_product_id_fkey(image_url)`) // Pedimos para incluir a imagem
        .single();

      if (error) throw error;
      if (!newRequisition) throw new Error("Falha ao criar requisição.");

      // --- ATUALIZAÇÃO INSTANTÂNEA DO ESTADO ---
      // Adicionamos a nova requisição ao início da lista no estado local
      setRequisitions(currentRequisitions => [newRequisition, ...currentRequisitions]);
      setPendingCount(currentCount => currentCount + 1); // Incrementamos o contador de pendentes

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
      addNotification('Item adicionado à requisição!', 'success'); // Usando o sistema de notificação

    } catch (err: any) {
      setError('Erro ao adicionar requisição: ' + err.message);
      addNotification('Erro ao adicionar requisição: ' + err.message, 'error');
    }
  };

  // --- FUNÇÃO ATUALIZADA PARA ATUALIZAÇÃO INSTANTÂNEA ---
  const handleAddCustomItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!selectedHotel?.id || !sectorId) {
        throw new Error('Hotel ou setor não selecionado');
      }

      // Usamos .select().single() para obter o registo recém-criado de volta
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

      // --- ATUALIZAÇÃO INSTANTÂNEA DO ESTADO ---
      setRequisitions(currentRequisitions => [newCustomRequisition, ...currentRequisitions]);
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
      addNotification('Item personalizado adicionado com sucesso!', 'success');

    } catch (err: any) {
      setError('Erro ao adicionar item personalizado: ' + err.message);
      addNotification('Erro ao adicionar item personalizado: ' + err.message, 'error');
    }
  };

  // O resto do seu componente permanece exatamente o mesmo...
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
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div className="flex items-center space-x-2 p-1 bg-gray-200 dark:bg-gray-700 rounded-lg">
              <button onClick={() => setFilterMode('sector')} className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${filterMode === 'sector' ? 'bg-white dark:bg-gray-800 shadow text-blue-600' : 'text-gray-600 dark:text-gray-300'}`}>Produtos do Setor</button>
              <button onClick={() => setFilterMode('all')} className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${filterMode === 'all' ? 'bg-white dark:bg-gray-800 shadow text-blue-600' : 'text-gray-600 dark:text-gray-300'}`}>Todos os Produtos</button>
            </div>
            <div className="flex items-center space-x-4 flex-grow md:flex-grow-0">
              <div className="relative flex-grow">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input type="text" placeholder="Buscar produtos..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
              </div>
              <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                <option value="">Todas as categorias</option>
                {categories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}><Grid className="w-5 h-5" /></button>
              <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}><List className="w-5 h-5" /></button>
            </div>
          </div>

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
