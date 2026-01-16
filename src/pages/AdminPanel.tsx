import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  Package, ArrowLeft, Plus, Search, Grid, List, AlertTriangle, 
  ShoppingCart, X, Check, Clock, ChevronDown, ChevronUp, ImageIcon,
  ArrowLeftRight,
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { startOfWeek, endOfWeek, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import SubstituteProductModal from '../components/SubstituteProductModal';
import { useNotification } from '../context/NotificationContext';
import RequestItem from '../components/RequestItem'; 
import Modal from '../components/Modal';
import { notifyItemDelivered, notifyItemRejected, notifyItemSubstituted } from '../lib/notificationTriggers';
import DirectDeliveryModal from '../components/DirectDeliveryModal';
import { searchMatch } from '../utils/search';

export interface Product {
  id: string;
  name: string;
  description: string;
  image_url: string;
  quantity: number;
  category: string;
  requestQuantity?: number;
  is_active: boolean;
  is_portionable?: boolean;
  average_price?: number;
  last_purchase_price?: number;
  last_purchase_quantity?: number;
}

export interface Request {
  id: string;
  item_name: string;
  quantity: number;
  status: 'pending' | 'delivered' | 'rejected';
  created_at: string;
  updated_at?: string;
  delivered_quantity?: number;
  rejection_reason?: string;
  product_id?: string;
  substituted_product_id?: string;
  is_custom?: boolean;
  products?: {
    id: string;
    name: string;
    image_url: string;
    quantity: number;
    is_portionable?: boolean;
    average_price?: number;
    last_purchase_price?: number;
    last_purchase_quantity?: number;
  };
  substituted_product?: any;
  sector: {
    id: string;
    name: string;
  };
}

const AdminPanel = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  
  const [pendingRequestsData, setPendingRequestsData] = useState<Request[]>([]);
  const [historyRequestsData, setHistoryRequestsData] = useState<Request[]>([]);
  
  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
  const [expandedSectors, setExpandedSectors] = useState<Record<string, boolean>>({});
  
  const [selectedHistorySector, setSelectedHistorySector] = useState<string | null>(null);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  
  const [showSubstituteModal, setShowSubstituteModal] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [deliveryQuantityInput, setDeliveryQuantityInput] = useState<number | string>('');
  const [rejectReasonInput, setRejectReasonInput] = useState('');

  const [showDirectDeliveryModal, setShowDirectDeliveryModal] = useState(false);
  const [allSectors, setAllSectors] = useState<{id: string, name: string}[]>([]);
  const [productStocks, setProductStocks] = useState<Record<string, number>>({});

  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');


  const fetchPendingRequestsInternal = useCallback(async (isInitialLoad = false) => {
    if (isInitialLoad) setLoadingPending(true);
    try {
      if (!selectedHotel?.id) {
        setPendingRequestsData([]);
        if (isInitialLoad) setLoadingPending(false);
        return;
      }
      const { data, error: reqError } = await supabase
        .from('requisitions')
        .select(`
          *,
          sector:sectors(id, name),
          products!requisitions_product_id_fkey(id, name, image_url, quantity, is_portionable, average_price, last_purchase_price, last_purchase_quantity),
          substituted_product:products!requisitions_substituted_product_id_fkey(id, name, image_url, quantity, is_portionable, average_price, last_purchase_price, last_purchase_quantity)
        `)
        .eq('hotel_id', selectedHotel.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(5000);

      if (reqError) throw reqError;
      setPendingRequestsData(data || []);
      setError('');
    } catch (err: any) {
      console.error('Error fetching pending requests:', err);
      setError('Erro ao carregar requisições pendentes');
    } finally {
      if (isInitialLoad) setLoadingPending(false);
    }
  }, [selectedHotel]);

  const fetchHistoryRequestsInternal = useCallback(async (isInitialLoad = false) => {
    if (isInitialLoad) setLoadingHistory(true);
    try {
      if (!selectedHotel?.id) {
        setHistoryRequestsData([]);
        if (isInitialLoad) setLoadingHistory(false);
        return;
      }
      const { data, error: reqError } = await supabase
        .from('requisitions')
        .select(`
          *,
          sector:sectors(id, name),
          products!requisitions_product_id_fkey(id, name, image_url, quantity, average_price, last_purchase_price, last_purchase_quantity, is_portionable),
          substituted_product:products!requisitions_substituted_product_id_fkey(id, name, image_url, quantity, average_price, last_purchase_price, last_purchase_quantity, is_portionable)
        `)
        .eq('hotel_id', selectedHotel.id)
        .in('status', ['delivered', 'rejected'])
        .order('updated_at', { ascending: false })
        .limit(500);

      if (reqError) throw reqError;
      setHistoryRequestsData(data || []);
    } catch (err: any) {
      console.error('Error fetching history requests:', err);
      setError(prev => prev || 'Erro ao carregar histórico de requisições');
    } finally {
      if (isInitialLoad) setLoadingHistory(false);
    }
  }, [selectedHotel]);

  const fetchAvailableProducts = useCallback(async () => {
    try {
      if (!selectedHotel?.id) {
        setAvailableProducts([]);
        return;
      }
      const { data, error } = await supabase
        .from('products')
        .select('id, name, quantity, average_price, last_purchase_price, last_purchase_quantity, image_url, is_portionable')
        .eq('hotel_id', selectedHotel.id)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      setAvailableProducts(data || []);
      
      // Atualiza o mapa global de estoques
      const stocks: Record<string, number> = {};
      data?.forEach(p => { stocks[p.id] = p.quantity; });
      setProductStocks(stocks);
    } catch (err: any) {
      console.error('Error fetching available products:', err);
    }
  }, [selectedHotel]);

  const fetchSectors = useCallback(async () => {
    try {
      if (!selectedHotel?.id) {
        setAllSectors([]);
        return;
      }
      const { data, error } = await supabase
        .from('sectors')
        .select('id, name')
        .eq('hotel_id', selectedHotel.id)
        .order('name');
      if (error) throw error;
      setAllSectors(data || []);
    } catch (err: any) {
      console.error('Error fetching sectors:', err);
      addNotification('Erro ao carregar a lista de setores.', 'error');
    }
  }, [selectedHotel, addNotification]);
  
  useEffect(() => {
    if (!selectedHotel?.id) {
      setLoadingPending(false);
      setLoadingHistory(false);
      setPendingRequestsData([]);
      setHistoryRequestsData([]);
      setAvailableProducts([]);
      setAllSectors([]);
      setError('');
      return; 
    }

    fetchPendingRequestsInternal(true);
    fetchHistoryRequestsInternal(true);
    fetchAvailableProducts();
    fetchSectors();

    const requisitionsChannel = supabase.channel(`requisitions-hotel-${selectedHotel.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requisitions', filter: `hotel_id=eq.${selectedHotel.id}` },
        (payload) => {
          fetchPendingRequestsInternal();
          fetchHistoryRequestsInternal();
          fetchAvailableProducts();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'products', filter: `hotel_id=eq.${selectedHotel.id}` },
        (payload) => {
          // Atualiza o estoque global quando qualquer produto mudar no banco
          setProductStocks(prev => ({
            ...prev,
            [payload.new.id]: payload.new.quantity
          }));
        }
      )
      .subscribe();
      
    return () => {
      supabase.removeChannel(requisitionsChannel);
    };
  }, [selectedHotel, fetchPendingRequestsInternal, fetchHistoryRequestsInternal, fetchAvailableProducts, fetchSectors]);


  const updateFinancialBalance = async (requestForBalance: Partial<Request>, quantityUsed: number, isSubstitution: boolean = false) => {
    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel não selecionado');
      }

      const productDetails = isSubstitution ? requestForBalance.substituted_product : requestForBalance.products;
      const productIdForBalance = isSubstitution ? requestForBalance.substituted_product_id : requestForBalance.product_id;

      let unitValue = 0;
      let productNameForReason = requestForBalance.item_name || 'Produto desconhecido';
      
      if (productDetails) {
          unitValue = productDetails.average_price || productDetails.last_purchase_price || 0;
      } else if (productIdForBalance) {
          const foundProduct = availableProducts.find(p => p.id === productIdForBalance);
          if (foundProduct) {
              unitValue = foundProduct.average_price || foundProduct.last_purchase_price || 0;
              productNameForReason = foundProduct.name;
          } else {
              console.warn(`Product info not found for item ID: ${productIdForBalance}. Cannot update financial balance.`);
              addNotification(`Detalhes do produto não encontrados para ${productNameForReason}. Saldo financeiro não atualizado.`, 'warning');
              return false;
          }
      } else {
          console.warn(`No product details or ID for item: ${productNameForReason}. Cannot update financial balance.`);
          return false;
      }

      const totalValue = unitValue * quantityUsed;
      if (totalValue <= 0) {
        console.log('Valor zero ou negativo, não será registrado no financeiro');
        return true; 
      }

      const { error: rpcError } = await supabase.rpc('update_hotel_balance', {
        p_hotel_id: selectedHotel.id,
        p_transaction_type: 'debit',
        p_amount: totalValue,
        p_reason: `Consumo de ${quantityUsed} un. de ${productNameForReason} por setor`,
        p_reference_type: 'consumption',
        p_reference_id: productIdForBalance
      });
      if (rpcError) throw rpcError;

      console.log(`Saldo financeiro atualizado: -R$ ${totalValue.toFixed(2)}`);
      return true;
    } catch (err: any) {
      console.error('Erro ao atualizar saldo financeiro:', err);
      addNotification(`Erro ao atualizar saldo financeiro: ${err.message}`, 'error');
      return false; 
    }
  };

  const triggerDeliveryModal = (request: Request) => {
    setSelectedRequest(request);
    setDeliveryQuantityInput(request.quantity);
    setShowDeliveryModal(true);
  };

  const triggerRejectModal = (request: Request) => {
    setSelectedRequest(request);
    setRejectReasonInput('');
    setShowRejectModal(true);
  };

  const triggerSubstituteModal = (request: Request) => {
    if (request.status !== 'pending') {
        addNotification('Só é possível substituir requisições pendentes.', 'warning');
        return;
    }
    setSelectedRequest(request);
    setShowSubstituteModal(true);
  };
  
  const handleConfirmDelivery = async () => {
    if (!selectedRequest) return;
    const deliveredQuantity = typeof deliveryQuantityInput === 'string' 
                              ? parseFloat(deliveryQuantityInput.replace(',', '.')) 
                              : deliveryQuantityInput;
    if (isNaN(deliveredQuantity) || deliveredQuantity <= 0) {
      addNotification('Quantidade entregue inválida.', 'error');
      return;
    }
    
    const requestToProcess = { ...selectedRequest };
    const originalPendingList = [...pendingRequestsData];

    const updatedRequest = {
        ...requestToProcess,
        status: 'delivered' as const,
        delivered_quantity: deliveredQuantity,
        updated_at: new Date().toISOString()
    } as Request;
    
    setPendingRequestsData(prev => prev.filter(r => r.id !== requestToProcess.id));
    setHistoryRequestsData(prev => [updatedRequest, ...prev].sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime()));
    setShowDeliveryModal(false);
    setSelectedRequest(null);
    setDeliveryQuantityInput('');

    try {
      const isSubstitution = !!requestToProcess.substituted_product_id;
      const productBeingDelivered = isSubstitution ? requestToProcess.substituted_product : requestToProcess.products;
      const productId = isSubstitution ? requestToProcess.substituted_product_id : requestToProcess.product_id;
      const isPortionable = productBeingDelivered?.is_portionable || false;
      let currentStock: number | undefined;

      if (!requestToProcess.is_custom && productId) {
          currentStock = productBeingDelivered?.quantity;
          if (currentStock === undefined) {
              const { data: fetchedProduct } = await supabase.from('products').select('quantity').eq('id', productId).single();
              if (!fetchedProduct) throw new Error('Produto não encontrado para validação de stock.');
              currentStock = fetchedProduct.quantity;
          }
          if (deliveredQuantity > currentStock) {
              throw new Error(`Quantidade insuficiente em stock. Disponível: ${currentStock}`);
          }
      }

      const { error: updateError } = await supabase.from('requisitions').update({ status: 'delivered', delivered_quantity: deliveredQuantity, updated_at: new Date().toISOString() }).eq('id', requestToProcess.id);
      if (updateError) throw updateError;
      
      // NOTA: O desconto do estoque principal agora é feito via TRIGGER no banco de dados 
      // para evitar descontos duplicados e garantir integridade.
      // Apenas notificamos a UI para atualizar o valor visualmente.
      if (!requestToProcess.is_custom && productId) {
          // Pequeno delay para garantir que o trigger do banco já processou
          setTimeout(() => {
              fetchAvailableProducts();
          }, 500);
      }

      if (isPortionable && !requestToProcess.is_custom && productId) {
        const purchaseCost = (productBeingDelivered?.last_purchase_price || productBeingDelivered?.average_price || 0) * deliveredQuantity;
        const { error: pendingError } = await supabase.from('pending_portioning_entries').insert({
            hotel_id: selectedHotel!.id,
            sector_id: requestToProcess.sector.id,
            product_id: productId,
            quantity_delivered: deliveredQuantity,
            purchase_cost: purchaseCost,
            requisition_id: requestToProcess.id,
        });
        if (pendingError) throw new Error(`Falha ao criar entrada pendente: ${pendingError.message}`);
        addNotification("Item porcionável enviado ao setor. Aguardando processamento.", "info");
      } else if (!requestToProcess.is_custom && productId) {
        const { error: sectorStockError } = await supabase.rpc('update_sector_stock_on_delivery', {
            p_hotel_id: selectedHotel!.id,
            p_sector_id: requestToProcess.sector.id,
            p_product_id: productId,
            p_quantity: deliveredQuantity
        });
        if (sectorStockError) {
            console.error("CRÍTICO: A atualização do stock do setor falhou!", sectorStockError);
            addNotification("Entrega registada, mas FALHA ao somar no stock do setor. Ajuste manualmente.", "error");
        }
      }
      
      await notifyItemDelivered({ hotel_id: selectedHotel!.id, sector_id: requestToProcess.sector.id, product_name: requestToProcess.item_name, quantity: deliveredQuantity, sector_name: requestToProcess.sector.name, delivered_by: 'Administrador' });
      if (!requestToProcess.is_custom && productId) {
          await updateFinancialBalance(requestToProcess, deliveredQuantity, isSubstitution);
      }
      addNotification("Requisição atendida com sucesso!", "success");
    } catch (err: any) {
      addNotification(`Erro ao confirmar entrega: ${err.message}`, 'error');
      setPendingRequestsData(originalPendingList);
      setHistoryRequestsData(prev => prev.filter(r => r.id !== requestToProcess.id));
    }
  };

  const handleConfirmRejection = async () => {
    if (!selectedRequest || !rejectReasonInput.trim()) {
      addNotification('Motivo da rejeição é obrigatório.', 'error');
      return;
    }
    
    const requestToProcess = { ...selectedRequest };
    const originalPendingList = [...pendingRequestsData];

    const updatedRequest = {
        ...requestToProcess,
        status: 'rejected' as const,
        rejection_reason: rejectReasonInput,
        updated_at: new Date().toISOString()
    } as Request;

    setPendingRequestsData(prev => prev.filter(r => r.id !== requestToProcess.id));
    setHistoryRequestsData(prev => [updatedRequest, ...prev].sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime()));
    setShowRejectModal(false);
    setSelectedRequest(null);
    setRejectReasonInput('');
    
    try {
      const { error } = await supabase
        .from('requisitions')
        .update({
          status: 'rejected',
          rejection_reason: rejectReasonInput,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestToProcess.id)
        .eq('hotel_id', selectedHotel?.id);
      if (error) throw error;

      await notifyItemRejected({
          hotel_id: selectedHotel?.id || '',
          sector_id: requestToProcess.sector.id,
          product_name: requestToProcess.item_name,
          reason: rejectReasonInput,
          sector_name: requestToProcess.sector.name
      });

      addNotification("Requisição rejeitada com sucesso!", "success");
    } catch (err: any) {
      addNotification(`Erro ao rejeitar requisição: ${err.message}`, 'error');
      setPendingRequestsData(originalPendingList);
      setHistoryRequestsData(prev => prev.filter(r => r.id !== requestToProcess.id));
    }
  };
  
  const handleConfirmSubstitution = async (substitutedProductId: string, deliveredQuantity: number, substitutionReason: string) => {
    if (!selectedRequest || !substitutedProductId) {
      addNotification('Produto substituto é obrigatório.', 'error');
      return;
    }
    
    const requestToProcess = { ...selectedRequest };
    const originalPendingList = [...pendingRequestsData];
    
    const substituteProductInfo = availableProducts.find(p => p.id === substitutedProductId);
    const updatedRequest = {
        ...requestToProcess,
        status: 'delivered' as const,
        delivered_quantity: deliveredQuantity,
        substituted_product_id: substitutedProductId,
        substitution_reason: substitutionReason,
        substituted_product: substituteProductInfo,
        updated_at: new Date().toISOString()
    } as Request;

    setPendingRequestsData(prev => prev.filter(r => r.id !== requestToProcess.id));
    setHistoryRequestsData(prev => [updatedRequest, ...prev].sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime()));
    setShowSubstituteModal(false);
    setSelectedRequest(null);
    
    try {
      const { data: substituteProduct, error: fetchError } = await supabase
        .from('products')
        .select('quantity, name, average_price, last_purchase_price, is_portionable')
        .eq('id', substitutedProductId)
        .eq('hotel_id', selectedHotel?.id)
        .single();

      if (fetchError || !substituteProduct) throw new Error('Produto substituto não encontrado.');
      if (deliveredQuantity > substituteProduct.quantity) throw new Error(`Quantidade insuficiente em estoque do produto substituto. Disponível: ${substituteProduct.quantity}`);
      
      const { error: updateRequisitionError } = await supabase.from('requisitions').update({
          substituted_product_id: substitutedProductId,
          substitution_reason: substitutionReason,
          status: 'delivered',
          delivered_quantity: deliveredQuantity,
          updated_at: new Date().toISOString()
      }).eq('id', requestToProcess.id);
      if (updateRequisitionError) throw updateRequisitionError;

      const newStock = substituteProduct.quantity - deliveredQuantity;
      await supabase.from('products').update({
          quantity: newStock,
          updated_at: new Date().toISOString()
      }).eq('id', substitutedProductId);

      // BROADCAST GLOBAL: Notifica todos os componentes na tela sobre a mudança
      const syncChannel = supabase.channel(`global-stock-sync-${selectedHotel?.id}`);
      syncChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          syncChannel.send({
            type: 'broadcast',
            event: 'stock_updated',
            payload: { productId: substitutedProductId, newQuantity: newStock }
          });
          setTimeout(() => supabase.removeChannel(syncChannel), 1000);
        }
      });

      // Lógica para porcionáveis ou não
      if (substituteProduct.is_portionable) {
        const purchaseCost = (substituteProduct.last_purchase_price || substituteProduct.average_price || 0) * deliveredQuantity;
        await supabase.from('pending_portioning_entries').insert({
            hotel_id: selectedHotel!.id,
            sector_id: requestToProcess.sector.id,
            product_id: substitutedProductId,
            quantity_delivered: deliveredQuantity,
            purchase_cost: purchaseCost,
            requisition_id: requestToProcess.id,
        });
        addNotification("Item porcionável (substituto) enviado para processamento.", "info");
      } else {
        await supabase.rpc('update_sector_stock_on_delivery', {
            p_hotel_id: selectedHotel!.id,
            p_sector_id: requestToProcess.sector.id,
            p_product_id: substitutedProductId,
            p_quantity: deliveredQuantity
        });
      }

      await notifyItemSubstituted({
          hotel_id: selectedHotel?.id || '',
          sector_id: requestToProcess.sector.id,
          original_product: requestToProcess.item_name,
          substitute_product: substituteProduct.name,
          sector_name: requestToProcess.sector.name
      });

      const unitCost = substituteProduct.average_price || substituteProduct.last_purchase_price || 0;
      await supabase.from('inventory_movements').insert({
          product_id: substitutedProductId,
          hotel_id: selectedHotel!.id,
          quantity_change: -deliveredQuantity,
          movement_type: 'consumption',
          reason: `Substituição de produto - Req: ${requestToProcess.item_name}`,
          performed_by: 'Sistema - Substituição',
          unit_cost: unitCost,
          total_cost: unitCost * deliveredQuantity
      });
      
      const requestWithSubstitute = { ...updatedRequest, products: substituteProduct };
      await updateFinancialBalance(requestWithSubstitute, deliveredQuantity, true);
      
      addNotification(`Produto substituído e entregue com sucesso!`, "success");
      
    } catch (err: any) {
      addNotification(`Erro ao substituir produto: ${err.message}`, 'error');
      setPendingRequestsData(originalPendingList);
      setHistoryRequestsData(prev => prev.filter(r => r.id !== requestToProcess.id));
    }
  };

  // --- FUNÇÃO MODIFICADA ---
  const handleConfirmDirectDelivery = async (productId: string, sectorId: string, quantity: number, reason: string) => {
    if (!selectedHotel?.id) return;

    setShowDirectDeliveryModal(false);

    try {
      const product = availableProducts.find(p => p.id === productId);
      const sector = allSectors.find(s => s.id === sectorId);

      if (!product || !sector) throw new Error('Produto ou setor não encontrado.');
      if (quantity > product.quantity) throw new Error(`Quantidade insuficiente no inventário. Disponível: ${product.quantity}`);
      
      // 1. Cria uma requisição com status 'delivered' para manter o histórico
      const { data: newRequisition, error: requisitionError } = await supabase
        .from('requisitions')
        .insert({
            hotel_id: selectedHotel.id,
            sector_id: sectorId,
            product_id: productId,
            item_name: product.name,
            quantity: quantity,
            status: 'delivered' as const,
            delivered_quantity: quantity,
            is_custom: false,
            rejection_reason: `Entrega direta: ${reason || 'N/A'}`, // Usando campo para motivo
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
        
      if (requisitionError) throw requisitionError;

      // 2. Atualiza a UI com a nova requisição no histórico
      const fullNewRequestObject: Request = {
        id: newRequisition.id,
        item_name: product.name,
        quantity: quantity,
        status: 'delivered',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        product_id: product.id,
        products: product,
        sector: sector,
      };

      setHistoryRequestsData(prev => 
        [fullNewRequestObject, ...prev].sort((a, b) => 
          new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime()
        )
      );

      // 3. Deduz a quantidade do estoque principal
      const newStock = product.quantity - quantity;
      await supabase
        .from('products')
        .update({ quantity: newStock, updated_at: new Date().toISOString() })
        .eq('id', productId);

      // BROADCAST GLOBAL: Notifica todos os componentes na tela sobre a mudança
      const syncChannel = supabase.channel(`global-stock-sync-${selectedHotel?.id}`);
      syncChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          syncChannel.send({
            type: 'broadcast',
            event: 'stock_updated',
            payload: { productId, newQuantity: newStock }
          });
          setTimeout(() => supabase.removeChannel(syncChannel), 1000);
        }
      });

      // --- INÍCIO DA LÓGICA CORRIGIDA ---
      // 4. Verifica se o produto é porcionável
      if (product.is_portionable) {
        // Se for porcionável, cria uma entrada pendente para o setor processar
        const purchaseCost = (product.last_purchase_price || product.average_price || 0) * quantity;
        const { error: pendingError } = await supabase.from('pending_portioning_entries').insert({
            hotel_id: selectedHotel.id,
            sector_id: sectorId,
            product_id: productId,
            quantity_delivered: quantity,
            purchase_cost: purchaseCost,
            requisition_id: newRequisition.id,
        });
        if (pendingError) throw new Error(`Falha ao criar entrada de porcionamento pendente: ${pendingError.message}`);
        addNotification("Item porcionável enviado ao setor para processamento.", "info");
      } else {
        // Se NÃO for porcionável, adiciona diretamente ao estoque do setor
        const { error: sectorStockError } = await supabase.rpc('update_sector_stock_on_delivery', {
            p_hotel_id: selectedHotel.id,
            p_sector_id: sectorId,
            p_product_id: productId,
            p_quantity: quantity
        });

        if (sectorStockError) {
           console.error("CRÍTICO: A atualização do estoque do setor falhou na entrega direta!", sectorStockError);
           addNotification("Entrega registrada, mas FALHA CRÍTICA ao somar no estoque do setor. Por favor, ajuste manualmente.", "error");
        }
      }
      // --- FIM DA LÓGICA CORRIGIDA ---

      // 5. Registra o movimento no inventário e atualiza o balanço financeiro
      const unitCost = product.average_price || product.last_purchase_price || 0;
      await supabase.from('inventory_movements').insert({
        product_id: productId,
        hotel_id: selectedHotel.id,
        quantity_change: -quantity,
        movement_type: 'consumption',
        reason: `Entrega direta p/ ${sector.name}: ${reason || 'N/A'}`,
        performed_by: 'Admin - Entrega Direta',
        unit_cost: unitCost,
        total_cost: unitCost * quantity,
        reference_id: newRequisition.id
      });
      
      await updateFinancialBalance(fullNewRequestObject, quantity, false);

      // 6. Notifica o setor
      await notifyItemDelivered({
          hotel_id: selectedHotel.id,
          sector_id: sectorId,
          product_name: product.name,
          quantity: quantity,
          sector_name: sector.name,
          delivered_by: 'Administrador (Entrega Direta)'
      });
      
      addNotification('Item entregue diretamente com sucesso!', 'success');
      fetchAvailableProducts();

    } catch (err: any) {
      console.error('Error during direct delivery:', err);
      addNotification(`Erro na entrega direta: ${err.message}`, 'error');
      // Recarrega os dados em caso de erro para garantir consistência
      fetchHistoryRequestsInternal();
      fetchAvailableProducts();
    }
  };

  const groupRequestsBySector = (requests: Request[]) => {
    return requests.reduce((acc, req) => {
      const sectorName = req.sector?.name || 'Setor Desconhecido';
      if (!acc[sectorName]) acc[sectorName] = [];
      acc[sectorName].push(req);
      return acc;
    }, {} as Record<string, Request[]>);
  };

  const groupSelectedSectorByWeek = (requests: Request[], sectorName: string) => {
    const sectorRequests = requests.filter(req => 
      (req.sector?.name || 'Setor Desconhecido') === sectorName
    );
    
    return sectorRequests.reduce((weekAcc, req) => {
      const reqDate = parseISO(req.updated_at || req.created_at);
      const weekStart = startOfWeek(reqDate, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(reqDate, { weekStartsOn: 1 });
      const weekKey = format(weekStart, 'yyyy-MM-dd');
      const weekLabel = `${format(weekStart, "dd/MM")} a ${format(weekEnd, "dd/MM/yyyy", { locale: ptBR })}`;
      
      if (!weekAcc[weekKey]) weekAcc[weekKey] = [];
      weekAcc[weekKey].push(req);
      (weekAcc[weekKey] as any).weekLabel = weekLabel;
      return weekAcc;
    }, {} as Record<string, Request[]>);
  };

  const toggleSectorExpansion = (sectorName: string) => {
    setExpandedSectors(prev => ({ ...prev, [sectorName]: !prev[sectorName] }));
  };

  const toggleWeekExpansion = (weekKey: string) => {
    setExpandedWeeks(prev => ({ ...prev, [weekKey]: !prev[weekKey] }));
  };

  const handleSectorSelection = (sectorName: string) => {
    setHistorySearchTerm('');
    if (selectedHistorySector === sectorName) {
      setSelectedHistorySector(null);
    } else {
      setSelectedHistorySector(sectorName);
      setExpandedWeeks({});
    }
  };

  const filteredHistoryItems = useMemo(() => {
    if (!selectedHistorySector || !historySearchTerm) {
        return null;
    }
    
    return historyRequestsData
        .filter(req => (req.sector?.name || 'Setor Desconhecido') === selectedHistorySector)
        .filter(req => searchMatch(historySearchTerm, req.item_name));
  }, [historyRequestsData, selectedHistorySector, historySearchTerm]);

  if (!selectedHotel) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] p-4 text-center">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mb-4" />
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-2">Nenhum Hotel Selecionado</h2>
        <p className="text-gray-500 dark:text-gray-400">Por favor, selecione um hotel para ver as requisições.</p>
        <button 
          onClick={() => navigate('/')} 
          className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Voltar para Seleção de Hotel
        </button>
      </div>
    );
  }

  const groupedPendingRequests = groupRequestsBySector(pendingRequestsData);
  const groupedHistoryRequests = groupRequestsBySector(historyRequestsData);
  const selectedSectorWeeks = selectedHistorySector 
    ? groupSelectedSectorByWeek(historyRequestsData, selectedHistorySector)
    : {};

  return (
    <div className="container mx-auto p-4 md:p-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="flex items-center justify-between mb-6 gap-4">
        <button onClick={() => navigate(-1)} className="flex items-center text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white">
          <ArrowLeft className="w-5 h-5 mr-2" />
          Voltar
        </button>
        <h1 className="text-xl md:text-3xl font-bold text-gray-800 dark:text-white text-center flex-1">
          Painel de Requisições - {selectedHotel.name}
        </h1>
        <button
          onClick={() => setShowDirectDeliveryModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg shadow-md hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <Package className="w-5 h-5" />
          <span className="hidden sm:inline">Entrega Direta</span>
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-800 text-red-700 dark:text-red-200 rounded-lg flex items-center">
          <AlertTriangle className="w-5 h-5 inline mr-3 flex-shrink-0" />
          {error}
        </div>
      )}

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-4 pb-2 border-b border-gray-300 dark:border-gray-700">
          Requisições Pendentes ({pendingRequestsData.length})
        </h2>
        {loadingPending ? (
          <div className="flex justify-center items-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="ml-3 text-gray-600 dark:text-gray-400">Carregando pendentes...</p>
          </div>
        ) : Object.keys(groupedPendingRequests).length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-6">Nenhuma requisição pendente no momento.</p>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedPendingRequests).sort(([sectorA], [sectorB]) => sectorA.localeCompare(sectorB)).map(([sectorName, requests]) => (
              <div key={sectorName} className="bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden">
                <button 
                  onClick={() => toggleSectorExpansion(sectorName)} 
                  className="w-full flex justify-between items-center p-4 bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors focus:outline-none"
                >
                  <h3 className="text-lg font-semibold text-purple-700 dark:text-purple-300">{sectorName} ({requests.length})</h3>
                  {expandedSectors[sectorName] ? 
                    <ChevronUp className="h-6 w-6 text-gray-600 dark:text-gray-400" /> : 
                    <ChevronDown className="h-6 w-6 text-gray-600 dark:text-gray-400" />
                  }
                </button>
                {expandedSectors[sectorName] && (
                  <div className="p-4 space-y-3 divide-y divide-gray-200 dark:divide-gray-700/50">
	                    {requests.sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map(request => (
	                      <RequestItem 
	                        key={request.id} 
	                        request={request}
	                        currentStock={request.product_id ? productStocks[request.product_id] : (request.products?.id ? productStocks[request.products.id] : null)}
	                        onTriggerDeliver={() => triggerDeliveryModal(request)}
	                        onTriggerReject={() => triggerRejectModal(request)}
	                        onTriggerSubstitute={() => triggerSubstituteModal(request)}
	                        isHistoryView={false}
	                      />
	                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-4 pb-2 border-b border-gray-300 dark:border-gray-700 flex justify-between items-center">
          <span>Histórico de Requisições ({historyRequestsData.length})</span>
          <button
            onClick={() => setShowHistorySearch(prev => !prev)}
            className="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Buscar no histórico do setor"
          >
            <Search className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </button>
        </h2>
        
        {loadingHistory ? (
          <div className="flex justify-center items-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600"></div>
            <p className="ml-3 text-gray-600 dark:text-gray-400">Carregando histórico...</p>
          </div>
        ) : Object.keys(groupedHistoryRequests).length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-6">Nenhum histórico de requisições encontrado.</p>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3 mb-6">
              {Object.entries(groupedHistoryRequests).sort(([sectorA], [sectorB]) => sectorA.localeCompare(sectorB)).map(([sectorName, requests]) => (
                <button
                  key={`sector-btn-${sectorName}`}
                  onClick={() => handleSectorSelection(sectorName)}
                  className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                    selectedHistorySector === sectorName
                      ? 'bg-blue-600 text-white shadow-lg transform scale-105'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-gray-700 hover:border-blue-300 dark:hover:border-blue-500'
                  }`}
                >
                  📋 {sectorName} ({requests.length})
                </button>
              ))}
            </div>

            {selectedHistorySector && (
              <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden">
                <div className="p-4 bg-blue-100 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800 flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-blue-700 dark:text-blue-300">
                    📋 {selectedHistorySector} - Histórico
                  </h3>
                  {showHistorySearch && (
                    <div className="relative">
                      <input
                        type="text"
                        placeholder={`Buscar em ${selectedHistorySector}...`}
                        value={historySearchTerm}
                        onChange={(e) => setHistorySearchTerm(e.target.value)}
                        className="w-full sm:w-64 p-2 pl-8 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:text-gray-200"
                      />
                      <Search size={18} className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400"/>
                    </div>
                  )}
                </div>
                
                {filteredHistoryItems ? (
                  <div className="p-4 space-y-3 divide-y divide-gray-200 dark:divide-gray-600/50">
                    {filteredHistoryItems.length > 0 ? (
                      filteredHistoryItems.map(request => (
                        <RequestItem key={request.id} request={request} isHistoryView={true} />
                      ))
                    ) : (
                      <p className="text-gray-500 dark:text-gray-400 text-center py-6">Nenhum item encontrado para "{historySearchTerm}".</p>
                    )}
                  </div>
                ) : (
                  <div className="p-4 space-y-4">
                    {Object.keys(selectedSectorWeeks).length === 0 ? (
                      <p className="text-gray-500 dark:text-gray-400 text-center py-6">
                        Nenhuma requisição encontrada para este setor.
                      </p>
                    ) : (
                      Object.entries(selectedSectorWeeks)
                        .sort(([keyA], [keyB]) => keyB.localeCompare(keyA))
                        .map(([weekKey, weekRequests]) => {
                          const isExpanded = expandedWeeks[weekKey];
                          const weekLabel = (weekRequests as any).weekLabel || `Semana de ${weekKey}`;

                          return (
                            <div key={weekKey} className="bg-gray-50 dark:bg-gray-700/30 rounded-lg overflow-hidden">
                              <button
                                onClick={() => toggleWeekExpansion(weekKey)}
                                className="w-full flex justify-between items-center px-4 py-3 bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors focus:outline-none"
                              >
                                <h4 className="text-md font-medium text-gray-700 dark:text-gray-200">
                                  📅 {weekLabel} ({weekRequests.length})
                                </h4>
                                {isExpanded ? (
                                  <ChevronUp className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                                ) : (
                                  <ChevronDown className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                                )}
                              </button>
                              {isExpanded && (
                                <div className="p-4 space-y-3 divide-y divide-gray-200 dark:divide-gray-600/50">
                                  {weekRequests.sort((a,b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime()).map((request) => (
                                    <RequestItem
                                      key={request.id}
                                      request={request}
                                      isHistoryView={true}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Modais */}
      {showSubstituteModal && selectedRequest && ( <SubstituteProductModal isOpen={showSubstituteModal} onClose={() => { setShowSubstituteModal(false); setSelectedRequest(null); }} request={selectedRequest} products={availableProducts} onConfirm={handleConfirmSubstitution} /> )}
      {showDeliveryModal && selectedRequest && ( <Modal isOpen={showDeliveryModal} onClose={() => { setShowDeliveryModal(false); setSelectedRequest(null); setDeliveryQuantityInput(''); }} title="Entregar Item" > <div className="space-y-4"> <p className="text-gray-700 dark:text-gray-300">Entregar: <strong>{selectedRequest.item_name}</strong></p> <div> <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quantidade a entregar (original: {selectedRequest.quantity})</label> <input type="number" min="0.1" step="0.01" value={deliveryQuantityInput} onChange={(e) => setDeliveryQuantityInput(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white" /> </div> <div className="flex space-x-3"> <button onClick={() => { setShowDeliveryModal(false); setSelectedRequest(null); setDeliveryQuantityInput(''); }} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" > Cancelar </button> <button onClick={handleConfirmDelivery} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"> Entregar </button> </div> </div> </Modal> )}
      {showRejectModal && selectedRequest && ( <Modal isOpen={showRejectModal} onClose={() => { setShowRejectModal(false); setSelectedRequest(null); setRejectReasonInput(''); }} title="Rejeitar Item" > <div className="space-y-4"> <p className="text-gray-700 dark:text-gray-300">Rejeitar: <strong>{selectedRequest.item_name}</strong></p> <div> <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Motivo da rejeição</label> <textarea value={rejectReasonInput} onChange={(e) => setRejectReasonInput(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="Digite o motivo da rejeição..." /> </div> <div className="flex space-x-3"> <button onClick={() => { setShowRejectModal(false); setSelectedRequest(null); setRejectReasonInput(''); }} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" > Cancelar </button> <button onClick={handleConfirmRejection} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"> Rejeitar </button> </div> </div> </Modal> )}
      {showDirectDeliveryModal && ( <DirectDeliveryModal isOpen={showDirectDeliveryModal} onClose={() => setShowDirectDeliveryModal(false)} products={availableProducts} sectors={allSectors} onConfirm={handleConfirmDirectDelivery} /> )}
    </div>
  );
};

export default AdminPanel;
