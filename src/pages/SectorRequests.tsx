import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Package, ArrowLeft, Plus, Search, Grid, List, AlertTriangle,
  ShoppingCart, X, Check, Clock, ChevronDown, ChevronUp, ImageIcon, Edit2
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { startOfWeek, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { searchMatch } from '../utils/search';
import { notifyNewRequest } from '../lib/notificationTriggers';
import { useNotification } from '../context/NotificationContext';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface Product {
  id: string;
  name: string;
  description: string;
  image_url: string;
  quantity: number;
  category: string;
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
  products?: { image_url: string };
  substituted_product?: { image_url: string };
}

// Estado do modal de quantidade
interface QuantityModalState {
  open: boolean;
  product: Product | null;
  /** 'add' = nova requisição | 'edit' = atualizar quantidade da pendente */
  mode: 'add' | 'edit';
  existingRequisitionId?: string;
  currentQuantity?: number;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

const SectorRequests = () => {
  const { id: sectorId } = useParams();
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
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

  // Modal de quantidade
  const [quantityModal, setQuantityModal] = useState<QuantityModalState>({
    open: false,
    product: null,
    mode: 'add',
  });
  const [modalQuantity, setModalQuantity] = useState('');
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // ---------------------------------------------------------------------------
  // IDs de produtos já pendentes (para bloquear duplicatas)
  // ---------------------------------------------------------------------------

  const pendingProductIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    requisitions.forEach(req => {
      if (req.status === 'pending' && req.product_id) {
        ids.add(req.product_id);
      }
    });
    return ids;
  }, [requisitions]);

  // ---------------------------------------------------------------------------
  // Histórico agrupado por semana
  // ---------------------------------------------------------------------------

  const groupedHistory = useMemo(() => {
    const history = requisitions.filter(req => req.status !== 'pending');
    const groups: Record<string, Requisition[]> = {};
    history.forEach(req => {
      const reqDate = parseISO(req.created_at);
      const weekStart = startOfWeek(reqDate, { weekStartsOn: 1 });
      const weekKey = format(weekStart, 'yyyy-MM-dd');
      if (!groups[weekKey]) groups[weekKey] = [];
      groups[weekKey].push(req);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [requisitions]);

  const toggleWeekExpansion = (weekKey: string) => {
    setExpandedWeeks(prev => ({ ...prev, [weekKey]: !prev[weekKey] }));
  };

  // ---------------------------------------------------------------------------
  // Fetch de dados
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedHotel?.id || !sectorId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');

        const { data: sectorData } = await supabase
          .from('sectors').select('*').eq('id', sectorId).single();
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
        const visibleIds = new Set((visibilityData || []).map((v: any) => v.product_id));
        setVisibleForSectorIds(visibleIds);
        // Se nenhum produto foi configurado para este setor, mostrar todos automaticamente
        if (visibleIds.size === 0) setFilterMode('all');

        if (productsData) {
          const uniqueCategories = [...new Set(productsData.map(p => p.category))];
          setCategories(uniqueCategories.sort());
        }

        const { data: requisitionsData, error: requisitionsError } = await supabase
          .from('requisitions')
          .select(`
            id, item_name, quantity, status, created_at,
            delivered_quantity, rejection_reason, product_id,
            substituted_product_id,
            products:product_id(image_url),
            substituted_product:substituted_product_id(image_url)
          `)
          .eq('sector_id', sectorId)
          .order('created_at', { ascending: false });

        if (requisitionsError) throw requisitionsError;
        if (requisitionsData) {
          setRequisitions(requisitionsData as any);
          setPendingCount(requisitionsData.filter(r => r.status === 'pending').length);
        }
      } catch (err: any) {
        console.error('Erro ao carregar dados:', err);
        setError('Erro ao carregar dados: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const channel = supabase
      .channel(`sector-requests-${sectorId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'requisitions', filter: `sector_id=eq.${sectorId}`
      }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedHotel, sectorId]);

  // ---------------------------------------------------------------------------
  // Produtos filtrados
  // ---------------------------------------------------------------------------

  const filteredProducts = useMemo(() => {
    let list = allProducts.filter(p => !p.is_portion);
    if (filterMode === 'sector') list = list.filter(p => visibleForSectorIds.has(p.id));
    if (selectedCategory) list = list.filter(p => p.category === selectedCategory);
    if (searchTerm.trim()) {
      list = list.filter(p =>
        searchMatch(searchTerm, p.name) ||
        searchMatch(searchTerm, p.description || '')
      );
    }
    return list;
  }, [searchTerm, filterMode, selectedCategory, allProducts, visibleForSectorIds]);

  // ---------------------------------------------------------------------------
  // Handlers do modal de quantidade
  // ---------------------------------------------------------------------------

  /** Abre o modal para ADICIONAR um produto não pendente */
  const openAddModal = useCallback((product: Product) => {
    setModalQuantity('');
    setQuantityModal({ open: true, product, mode: 'add' });
  }, []);

  /** Abre o modal para EDITAR quantidade de um produto já pendente */
  const openEditModal = useCallback((product: Product) => {
    const existing = requisitions.find(
      r => r.product_id === product.id && r.status === 'pending'
    );
    if (!existing) return;
    setModalQuantity(String(existing.quantity));
    setQuantityModal({
      open: true,
      product,
      mode: 'edit',
      existingRequisitionId: existing.id,
      currentQuantity: existing.quantity,
    });
  }, [requisitions]);

  const closeModal = useCallback(() => {
    setQuantityModal({ open: false, product: null, mode: 'add' });
    setModalQuantity('');
  }, []);

  // ---------------------------------------------------------------------------
  // Confirmar modal: adiciona ou edita
  // ---------------------------------------------------------------------------

  const handleModalConfirm = async () => {
    const qty = parseInt(modalQuantity, 10);
    if (!qty || qty < 1) {
      addNotification('Informe uma quantidade válida (mínimo 1).', 'error');
      return;
    }

    if (quantityModal.mode === 'add') {
      await handleAddToRequest(quantityModal.product!, qty);
    } else {
      await handleUpdateRequisitionQuantity(quantityModal.existingRequisitionId!, qty);
    }
  };

  // ---------------------------------------------------------------------------
  // Adicionar nova requisição
  // ---------------------------------------------------------------------------

  const handleAddToRequest = async (product: Product, qty: number) => {
    try {
      if (!selectedHotel?.id || !sectorId) throw new Error('Hotel ou setor não selecionado');

      setModalSubmitting(true);

      const { data: newRequisition, error } = await supabase
        .from('requisitions')
        .insert([{
          sector_id: sectorId,
          product_id: product.id,
          item_name: product.name,
          quantity: qty,
          status: 'pending',
          is_custom: false,
          hotel_id: selectedHotel.id,
          created_by: user?.id || null,
        }])
        .select()
        .single();

      if (error) throw error;
      if (!newRequisition) throw new Error('Falha ao criar requisição.');

      const withImage = { ...newRequisition, products: { image_url: product.image_url } };
      setRequisitions(prev => [withImage as any, ...prev]);
      setPendingCount(prev => prev + 1);

      try {
        await notifyNewRequest({
          hotel_id: selectedHotel.id,
          sector_id: sectorId,
          product_name: product.name,
          quantity: qty,
          sector_name: sector?.name || 'Setor',
          user_name: user?.full_name || user?.email?.split('@')[0] || 'Colaborador',
        });
      } catch (notifErr) {
        console.error('Erro ao enviar notificação:', notifErr);
      }

      addNotification('Item adicionado à requisição!', 'success');
      closeModal();
    } catch (err: any) {
      addNotification('Erro ao adicionar requisição: ' + err.message, 'error');
    } finally {
      setModalSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Atualizar quantidade de requisição pendente existente
  // ---------------------------------------------------------------------------

  const handleUpdateRequisitionQuantity = async (requisitionId: string, newQty: number) => {
    try {
      if (!requisitionId) throw new Error('ID da requisição não encontrado.');

      setModalSubmitting(true);

      const { error } = await supabase
        .from('requisitions')
        .update({ quantity: newQty })
        .eq('id', requisitionId)
        .eq('status', 'pending'); // Garante que só atualiza se ainda pendente

      if (error) throw error;

      setRequisitions(prev =>
        prev.map(r => r.id === requisitionId ? { ...r, quantity: newQty } : r)
      );

      addNotification('Quantidade atualizada com sucesso!', 'success');
      closeModal();
    } catch (err: any) {
      addNotification('Erro ao atualizar quantidade: ' + err.message, 'error');
    } finally {
      setModalSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Adicionar item personalizado
  // ---------------------------------------------------------------------------

  const handleAddCustomItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!selectedHotel?.id || !sectorId) throw new Error('Hotel ou setor não selecionado');

      const { data: newCustomRequisition, error } = await supabase
        .from('requisitions')
        .insert([{
          sector_id: sectorId,
          item_name: customItem.name,
          quantity: customItem.quantity,
          status: 'pending',
          is_custom: true,
          hotel_id: selectedHotel.id,
          created_by: user?.id || null,
        }])
        .select()
        .single();

      if (error) throw error;
      if (!newCustomRequisition) throw new Error('Falha ao criar requisição personalizada.');

      setRequisitions(prev => [newCustomRequisition as any, ...prev]);
      setPendingCount(prev => prev + 1);

      try {
        await notifyNewRequest({
          hotel_id: selectedHotel.id,
          sector_id: sectorId,
          product_name: customItem.name,
          quantity: customItem.quantity,
          sector_name: sector?.name || 'Setor',
          user_name: user?.full_name || user?.email?.split('@')[0] || 'Colaborador',
        });
      } catch (notifErr) {
        console.error('Erro ao enviar notificação:', notifErr);
      }

      setCustomItem({ name: '', quantity: 1 });
      setShowCustomForm(false);
      addNotification('Item personalizado adicionado!', 'success');
    } catch (err: any) {
      addNotification('Erro ao adicionar item personalizado: ' + err.message, 'error');
    }
  };

  // ---------------------------------------------------------------------------
  // Quantidade digitada no modal (número em tempo real para o preview)
  // ---------------------------------------------------------------------------

  const parsedModalQty = parseInt(modalQuantity, 10);
  const validModalQty = !isNaN(parsedModalQty) && parsedModalQty > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="container mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
        <div className="flex items-center mb-4 md:mb-0">
          <Link
            to="/"
            className="mr-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-600 dark:text-gray-400" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Requisições — {sector?.name || 'Carregando...'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">{selectedHotel?.name}</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowCart(!showCart)}
            className="relative p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-lg"
            title="Ver requisições pendentes"
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

      {/* Erro global */}
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded shadow-sm flex items-center">
          <AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Carrinho / Histórico */}
      {showCart ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
              <Clock className="w-6 h-6 mr-2 text-blue-600" />
              Requisições Pendentes
            </h2>
            <button
              onClick={() => setShowCart(false)}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {requisitions.filter(r => r.status === 'pending').length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
              Nenhuma requisição pendente.
            </p>
          ) : (
            <div className="space-y-3">
              {requisitions.filter(r => r.status === 'pending').map(req => (
                <div
                  key={req.id}
                  className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
                >
                  <div className="flex items-center min-w-0">
                    <div className="w-12 h-12 flex-shrink-0 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center mr-4">
                      {req.products?.image_url ? (
                        <img
                          src={req.products.image_url}
                          alt={req.item_name}
                          className="w-full h-full object-contain rounded"
                        />
                      ) : (
                        <Package className="w-6 h-6 text-gray-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-white truncate">
                        {req.item_name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Quantidade: <span className="font-semibold">{req.quantity}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center text-blue-600 font-medium ml-4 flex-shrink-0">
                    <Clock className="w-4 h-4 mr-1" />
                    Pendente
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Histórico */}
          <div className="mt-10 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
              <List className="w-6 h-6 mr-2 text-purple-600" />
              Histórico de Requisições
            </h2>
            {groupedHistory.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                Nenhum histórico disponível.
              </p>
            ) : (
              <div className="space-y-6">
                {groupedHistory.map(([weekKey, weekRequests]) => (
                  <div
                    key={weekKey}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => toggleWeekExpansion(weekKey)}
                      className="w-full flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        Semana de {format(parseISO(weekKey), 'dd/MM/yyyy', { locale: ptBR })}
                      </span>
                      {expandedWeeks[weekKey]
                        ? <ChevronUp className="w-5 h-5" />
                        : <ChevronDown className="w-5 h-5" />
                      }
                    </button>
                    {expandedWeeks[weekKey] && (
                      <div className="p-4 space-y-4 bg-white dark:bg-gray-800">
                        {weekRequests.map(req => (
                          <div
                            key={req.id}
                            className="flex items-center justify-between p-3 border-b border-gray-100 dark:border-gray-700 last:border-0"
                          >
                            <div className="flex items-center min-w-0">
                              <div className="w-10 h-10 flex-shrink-0 bg-gray-50 dark:bg-gray-700 rounded flex items-center justify-center mr-3">
                                {req.status === 'delivered'
                                  ? <Check className="w-5 h-5 text-green-500" />
                                  : <X className="w-5 h-5 text-red-500" />
                                }
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {req.item_name}
                                </h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {format(parseISO(req.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                                </p>
                              </div>
                            </div>
                            <div className="text-right ml-4 flex-shrink-0">
                              <p className={`text-sm font-bold ${
                                req.status === 'delivered' ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {req.status === 'delivered'
                                  ? `Entregue: ${req.delivered_quantity}`
                                  : 'Rejeitado'
                                }
                              </p>
                              {req.rejection_reason && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                                  Motivo: {req.rejection_reason}
                                </p>
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
        /* ------------------------------------------------------------------ */
        /* Grade de produtos                                                    */
        /* ------------------------------------------------------------------ */
        <div className="space-y-6">

          {/* Filtros */}
          <div className="flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Buscar produtos..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">Todas as Categorias</option>
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              {(['sector', 'all'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setFilterMode(mode)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    filterMode === mode
                      ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {mode === 'sector' ? 'Setor' : 'Todos'}
                </button>
              ))}
            </div>
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                <Grid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Banner: setor sem produtos configurados */}
          {!loading && visibleForSectorIds.size === 0 && filterMode === 'all' && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Nenhum produto foi configurado para este setor — exibindo todos os produtos do hotel. Um administrador pode definir a visibilidade em <strong>Estoque → Setor</strong>.</span>
            </div>
          )}

          {/* Produtos */}
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-20 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">
                {filterMode === 'sector' && visibleForSectorIds.size === 0
                  ? 'Nenhum produto configurado para este setor.'
                  : 'Nenhum produto encontrado.'}
              </p>
              {filterMode === 'sector' && visibleForSectorIds.size === 0 && (
                <button
                  onClick={() => setFilterMode('all')}
                  className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Ver todos os produtos →
                </button>
              )}
            </div>
          ) : (
            <div className={
              viewMode === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6'
                : 'space-y-4'
            }>
              {filteredProducts.map(product => {
                const isPending = pendingProductIds.has(product.id);

                return (
                  <div
                    key={product.id}
                    className={`bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden ${
                      viewMode === 'list' ? 'flex items-center p-4' : 'p-4'
                    } ${isPending ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''}`}
                  >
                    {/* Imagem */}
                    <div className={`relative bg-gray-100 dark:bg-gray-700 flex items-center justify-center ${
                      viewMode === 'list' ? 'w-24 h-24 mr-6 rounded-lg flex-shrink-0' : 'w-full h-48 mb-4 rounded-lg'
                    }`}>
                      {isPending && (
                        <span className="absolute top-1 left-1 z-10 bg-amber-400 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                          pendente
                        </span>
                      )}
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="w-full h-full object-contain"
                          onError={e => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            (e.target as HTMLImageElement).nextElementSibling
                              ?.removeAttribute('style');
                          }}
                        />
                      ) : null}
                      <ImageIcon
                        className={`w-12 h-12 text-gray-400 ${product.image_url ? 'hidden' : 'block'}`}
                      />
                    </div>

                    {/* Informações */}
                    <div className={viewMode === 'list' ? 'flex-grow min-w-0' : ''}>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 truncate">
                        {product.name}
                      </h3>
                      {product.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1 line-clamp-2">
                          {product.description}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Categoria: {product.category}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                        Estoque: <span className="font-medium">{product.quantity}</span>
                      </p>

                      {/* Botão — sem input de quantidade inline */}
                      {isPending ? (
                        <button
                          onClick={() => openEditModal(product)}
                          className="w-full flex items-center justify-center px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors font-medium"
                        >
                          <Edit2 className="w-4 h-4 mr-2" />
                          Pendente — Alterar quantidade
                        </button>
                      ) : (
                        <button
                          onClick={() => openAddModal(product)}
                          className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Adicionar à Requisição
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Modal de quantidade                                                   */}
      {/* -------------------------------------------------------------------- */}
      {quantityModal.open && quantityModal.product && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white dark:bg-gray-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

            {/* Barra de arraste (mobile) */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full" />
            </div>

            {/* Header do modal */}
            <div className="flex items-center justify-between px-6 pt-4 pb-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {quantityModal.mode === 'add' ? 'Adicionar à Requisição' : 'Alterar Quantidade'}
              </h2>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Corpo */}
            <div className="px-6 py-5 space-y-5">

              {/* Produto selecionado */}
              <div className="flex items-center space-x-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                <div className="w-14 h-14 flex-shrink-0 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center overflow-hidden">
                  {quantityModal.product.image_url ? (
                    <img
                      src={quantityModal.product.image_url}
                      alt={quantityModal.product.name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Package className="w-7 h-7 text-gray-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-white truncate">
                    {quantityModal.product.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Estoque disponível:{' '}
                    <span className="font-medium">{quantityModal.product.quantity}</span>
                  </p>
                  {quantityModal.mode === 'edit' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      Pedido atual: <span className="font-bold">{quantityModal.currentQuantity}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Input de quantidade */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Quantos deseja?
                </label>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  placeholder="Ex: 3"
                  value={modalQuantity}
                  onChange={e => setModalQuantity(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleModalConfirm()}
                  autoFocus
                  className="w-full px-4 py-3 text-lg border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center font-bold"
                />
              </div>

              {/* Preview do pedido */}
              <div className={`rounded-xl px-4 py-3 text-sm text-center transition-all duration-200 ${
                validModalQty
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-50 dark:bg-gray-700/30 text-gray-400 dark:text-gray-500'
              }`}>
                {validModalQty ? (
                  quantityModal.mode === 'add' ? (
                    <>
                      Pedindo{' '}
                      <span className="font-bold text-blue-800 dark:text-blue-200">
                        {parsedModalQty}
                      </span>{' '}
                      unidade{parsedModalQty !== 1 ? 's' : ''} de{' '}
                      <span className="font-bold">{quantityModal.product.name}</span>
                    </>
                  ) : (
                    <>
                      Alterando de{' '}
                      <span className="font-bold text-amber-700 dark:text-amber-300 line-through">
                        {quantityModal.currentQuantity}
                      </span>{' '}
                      para{' '}
                      <span className="font-bold text-blue-800 dark:text-blue-200">
                        {parsedModalQty}
                      </span>{' '}
                      unidade{parsedModalQty !== 1 ? 's' : ''}
                    </>
                  )
                ) : (
                  'Digite a quantidade desejada acima'
                )}
              </div>
            </div>

            {/* Ações */}
            <div className="px-6 pb-6 pt-2 flex gap-3">
              <button
                onClick={closeModal}
                disabled={modalSubmitting}
                className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleModalConfirm}
                disabled={!validModalQty || modalSubmitting}
                className={`flex-1 px-4 py-3 rounded-xl font-semibold text-white transition-colors ${
                  quantityModal.mode === 'add'
                    ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300'
                    : 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300'
                } disabled:cursor-not-allowed`}
              >
                {modalSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Salvando...
                  </span>
                ) : (
                  quantityModal.mode === 'add' ? 'Confirmar pedido' : 'Salvar alteração'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Modal de item personalizado                                           */}
      {/* -------------------------------------------------------------------- */}
      {showCustomForm && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
          onClick={e => { if (e.target === e.currentTarget) setShowCustomForm(false); }}
        >
          <div className="bg-white dark:bg-gray-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

            {/* Barra de arraste (mobile) */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full" />
            </div>

            <div className="flex justify-between items-center px-6 pt-4 pb-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Adicionar Item Personalizado
              </h2>
              <button
                onClick={() => setShowCustomForm(false)}
                className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleAddCustomItem} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Nome do Item
                </label>
                <input
                  type="text"
                  value={customItem.name}
                  onChange={e => setCustomItem({ ...customItem, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Nome do item que precisa"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Quantidade
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  inputMode="decimal"
                  value={customItem.quantity}
                  onChange={e => setCustomItem({ ...customItem, quantity: parseFloat(e.target.value) || 0.01 })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div className="flex gap-3 pt-2 pb-2">
                <button
                  type="button"
                  onClick={() => setShowCustomForm(false)}
                  className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-semibold"
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
