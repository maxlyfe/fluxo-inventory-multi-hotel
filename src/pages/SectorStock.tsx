import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  ArrowLeft, Search, Plus, AlertTriangle,
  Package, Scale, History, ChevronDown, ChevronUp,
  ImageIcon, Trash2,
  CalendarCheck, X, ListChecks, Filter,
  ChevronLeftSquare, ChevronRightSquare, GitCommit, Loader2, Edit2 // Adicionado ícone de Edição
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { format, parseISO, isValid } from 'date-fns'; 
import { ptBR } from 'date-fns/locale';
import { useNotification } from '../context/NotificationContext'; 
import AddInventoryItemModal from '../components/AddInventoryItemModal';
import Modal from '../components/Modal';
import NewProductModal from '../components/NewProductModal';

// Interfaces permanecem as mesmas
interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  category: string;
  updated_at: string;
  supplier?: string;
  image_url?: string;
  description?: string;
  is_active: boolean;
  is_portionable?: boolean;
  is_portion?: boolean;
}

interface StockBalance {
  id: string;
  product_id: string;
  previous_quantity: number;
  current_quantity: number;
  received_quantity: number;
  consumed_quantity: number;
  balance_date: string;
  notes?: string;
  created_by?: string;
  products: {
    name: string;
    category: string;
  };
}

interface BalanceItem {
  productId: string;
  productName: string;
  productImageUrl?: string;
  initialStock: number;
  receivedSinceLastBalance: number;
  currentCount?: number; 
  displayConsumption?: number; 
  discrepancy?: number; 
}

interface PendingEntry {
  id: string;
  quantity_delivered: number;
  purchase_cost: number;
  delivered_at: string;
  products: {
    id: string;
    name: string;
    image_url: string;
  }
}

interface PortioningItem {
    id: string;
    productId: string | null;
    productName: string;
    yieldQuantity: string;
}

const ITEMS_PER_HISTORY_PAGE = 20;

const SectorStock = () => {
  const { sectorId } = useParams();
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification(); 
  
  const [sector, setSector] = useState<any>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [balanceHistoryData, setBalanceHistoryData] = useState<StockBalance[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showBalanceHistory, setShowBalanceHistory] = useState(false);
  const [showAddInventoryItemModal, setShowAddInventoryItemModal] = useState(false);

  // --- NOVO: Estados para o modal de edição de quantidade ---
  const [showEditModal, setShowEditModal] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [newQuantity, setNewQuantity] = useState('');
  const [isUpdatingStock, setIsUpdatingStock] = useState(false);
  // --- FIM NOVO ---

  const [isBalancing, setIsBalancing] = useState(false);
  const [balanceData, setBalanceData] = useState<BalanceItem[]>([]);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  const [historyCurrentPage, setHistoryCurrentPage] = useState(1);
  const [historyTotalItems, setHistoryTotalItems] = useState(0);
  const [historyStartDate, setHistoryStartDate] = useState<string>('');
  const [historyEndDate, setHistoryEndDate] = useState<string>('');

  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);
  const [showPortioningModal, setShowPortioningModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PendingEntry | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [portioningItems, setPortioningItems] = useState<PortioningItem[]>([]);
  const [lossAmount, setLossAmount] = useState('0');

  const [allHotelPortionProducts, setAllHotelPortionProducts] = useState<Product[]>([]);

  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // As funções de busca de dados (fetchSectorAndStockData, etc.) permanecem as mesmas
  const fetchSectorAndStockData = useCallback(async () => {
    try {
      if (!selectedHotel?.id || !sectorId) return;
      setLoading(true);
      setError(null);
      
      const { data: sectorData, error: sectorError } = await supabase
        .from('sectors')
        .select('*')
        .eq('id', sectorId)
        .single();
      if (sectorError) throw sectorError;
      setSector(sectorData);

      const { data: stockData, error: stockError } = await supabase
        .from('sector_stock')
        .select(`*, products!inner(id, name, category, image_url, description, is_active, is_portionable, is_portion, min_quantity, max_quantity)`) // Adicionado min/max quantity
        .eq('sector_id', sectorId)
        .eq('hotel_id', selectedHotel.id);
      
      if (stockError) throw stockError;

      const processedStock = stockData?.map((item: any) => ({
        ...item.products,
        quantity: item.quantity,
        min_quantity: item.products.min_quantity, // Corrigido para pegar do produto
        max_quantity: item.products.max_quantity, // Corrigido para pegar do produto
      })) || [];
      setProducts(processedStock.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err: any) {
      setError('Erro ao carregar dados: ' + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, sectorId]);

  const fetchPendingEntries = useCallback(async () => {
    if (!selectedHotel?.id || !sectorId) return;
    try {
        const { data, error } = await supabase
            .from('pending_portioning_entries')
            .select(`*, products (id, name, image_url)`)
            .eq('hotel_id', selectedHotel.id)
            .eq('sector_id', sectorId)
            .eq('processed', false)
            .order('delivered_at', { ascending: true });
        if (error) throw error;
        setPendingEntries(data || []);
    } catch (err: any) {
        addNotification('Erro ao buscar itens pendentes para porcionar: ' + err.message, 'error');
    }
  }, [selectedHotel, sectorId, addNotification]);

  const fetchAllHotelPortionProducts = useCallback(async () => {
    if (!selectedHotel?.id) return;
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('hotel_id', selectedHotel.id)
        .eq('is_portion', true);

      if (error) throw error;
      setAllHotelPortionProducts(data || []);
    } catch (err: any) {
      addNotification('Erro ao carregar lista de porções: ' + err.message, 'error');
    }
  }, [selectedHotel, addNotification]);

  useEffect(() => {
    const fetchInitialData = async () => {
        if (selectedHotel) {
            await fetchSectorAndStockData();
            await fetchPendingEntries();
            await fetchAllHotelPortionProducts();
            const { data } = await supabase.from('products').select('category').eq('hotel_id', selectedHotel.id);
            if (data) {
                const uniqueCategories = [...new Set(data.map(p => p.category).filter(Boolean))];
                setCategories(uniqueCategories.sort());
            }
        }
    };
    fetchInitialData();
  }, [selectedHotel, fetchSectorAndStockData, fetchPendingEntries, fetchAllHotelPortionProducts]);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleNewProductCreatedAndLink = async (newProduct?: Product) => {
    if (!selectedHotel || !sectorId || !newProduct) {
        fetchSectorAndStockData();
        return;
    };

    try {
      const { error } = await supabase
        .from("sector_stock")
        .insert({
          hotel_id: selectedHotel.id,
          sector_id: sectorId,
          product_id: newProduct.id,
          quantity: 1, 
          min_quantity: 0,
          max_quantity: 100,
        });

      if (error) throw error;
      addNotification(`Produto "${newProduct.name}" criado e adicionado a este setor!`, "success");
      
    } catch (err: any) {
      addNotification("Erro ao vincular o novo produto: " + err.message, "error");
    } finally {
        fetchSectorAndStockData();
        fetchAllHotelPortionProducts();
    }
  };

  const fetchBalanceHistory = useCallback(async (page = 1, startDate?: string, endDate?: string) => {
    if (!selectedHotel?.id || !sectorId) return;
    setLoading(true);
    try {
      let query = supabase
        .from('sector_stock_balance')
        .select(`*, products (name, category)`, { count: 'exact' })
        .eq('sector_id', sectorId)
        .eq('hotel_id', selectedHotel.id);

      if (startDate && isValid(parseISO(startDate))) {
        query = query.gte('balance_date', parseISO(startDate).toISOString());
      }
      if (endDate && isValid(parseISO(endDate))) {
        const endOfDay = new Date(parseISO(endDate));
        endOfDay.setDate(endOfDay.getDate() + 1);
        query = query.lt('balance_date', endOfDay.toISOString());
      }

      const { data, error: balanceError, count } = await query
        .order('balance_date', { ascending: false })
        .range((page - 1) * ITEMS_PER_HISTORY_PAGE, page * ITEMS_PER_HISTORY_PAGE - 1);

      if (balanceError) throw balanceError;
      setBalanceHistoryData(data || []);
      setHistoryTotalItems(count || 0);
      setHistoryCurrentPage(page);
    } catch (err: any) {
      addNotification('Erro ao carregar histórico: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, sectorId, addNotification]);

  useEffect(() => {
    if (showBalanceHistory) {
      fetchBalanceHistory(historyCurrentPage, historyStartDate, historyEndDate);
    }
  }, [showBalanceHistory, historyCurrentPage, historyStartDate, historyEndDate, fetchBalanceHistory]);

  const startBalanceProcess = async () => {
    if (!selectedHotel?.id || !sectorId) return;
    setLoadingBalance(true);
    setError(null);
    setIsBalancing(true);
    setBalanceData([]);
    try {
      const balanceItems: BalanceItem[] = [];
      for (const product of products) {
        if (!product || typeof product.name !== 'string') continue;

        const { data: lastBalance, error: balanceError } = await supabase
          .from('sector_stock_balance')
          .select('current_quantity, balance_date')
          .eq('hotel_id', selectedHotel.id)
          .eq('sector_id', sectorId)
          .eq('product_id', product.id)
          .order('balance_date', { ascending: false })
          .limit(1)
          .single();

        if (balanceError && balanceError.code !== 'PGRST116') {
          console.warn(`Erro ao buscar último balanço para ${product.name}:`, balanceError.message);
        }

        const initialStock = lastBalance?.current_quantity ?? 0;
        const lastBalanceDate = lastBalance?.balance_date ?? new Date(0).toISOString();

        const { data: deliveries, error: reqError } = await supabase
          .from('requisitions')
          .select('delivered_quantity')
          .eq('hotel_id', selectedHotel.id)
          .eq('sector_id', sectorId)
          .eq('status', 'delivered')
          .or(`product_id.eq.${product.id},substituted_product_id.eq.${product.id}`)
          .gte('updated_at', lastBalanceDate);

        if (reqError) {
          throw new Error(`Erro ao buscar recebimentos para ${product.name}: ${reqError.message}`);
        }

        const receivedSinceLastBalance = deliveries.reduce((sum, req) => sum + (req.delivered_quantity || 0), 0);
        
        balanceItems.push({
          productId: product.id,
          productName: product.name,
          productImageUrl: product.image_url,
          initialStock: initialStock,
          receivedSinceLastBalance: receivedSinceLastBalance,
        });
      }
      setBalanceData(balanceItems.sort((a, b) => a.productName.localeCompare(b.productName)));
    } catch (err: any) {
      setError('Erro ao preparar balanço: ' + err.message);
      addNotification('Erro ao preparar balanço: ' + err.message, 'error');
      setIsBalancing(false);
    } finally {
      setLoadingBalance(false);
    }
  };

  const handleBalanceInputChange = (productId: string, value: string) => {
    const currentCount = value === '' ? undefined : parseFloat(value.replace(',', '.'));
    setBalanceData(prevData => 
      prevData.map(item => {
        if (item.productId === productId) {
          let displayConsumption: number | undefined;
          let discrepancy: number | undefined;
          if (currentCount !== undefined && !isNaN(currentCount)) {
            const totalAvailable = item.initialStock + item.receivedSinceLastBalance;
            const rawConsumption = totalAvailable - currentCount;
            displayConsumption = Math.max(0, rawConsumption);
            discrepancy = rawConsumption < 0 ? Math.abs(rawConsumption) : 0;
          }
          return { ...item, currentCount, displayConsumption, discrepancy };
        }
        return item;
      })
    );
  };

  const handleSaveBalance = async () => {
    if (!selectedHotel?.id || !sectorId || !user) return;
    setLoadingBalance(true);
    try {
      const balanceDate = new Date().toISOString();
      const balanceEntries = [];
      const stockUpdates = [];

      for (const item of balanceData) {
        if (item.currentCount === undefined || isNaN(item.currentCount)) continue;
        
        const totalAvailable = item.initialStock + item.receivedSinceLastBalance;
        const consumed = totalAvailable - item.currentCount;

        balanceEntries.push({
          sector_id: sectorId,
          product_id: item.productId,
          previous_quantity: item.initialStock, 
          current_quantity: item.currentCount, 
          received_quantity: item.receivedSinceLastBalance, 
          consumed_quantity: Math.max(0, consumed),
          balance_date: balanceDate,
          hotel_id: selectedHotel.id,
          notes: `Balanço Semanal - ${format(new Date(), 'dd/MM/yyyy')}`,
          created_by: user.email
        });
        stockUpdates.push({ product_id: item.productId, quantity: item.currentCount });
      }

      if (balanceEntries.length === 0) {
        addNotification('Nenhuma contagem válida para salvar.', 'warning');
        return;
      }

      const { error: insertError } = await supabase.from('sector_stock_balance').insert(balanceEntries);
      if (insertError) throw new Error(`Erro ao salvar histórico: ${insertError.message}`);

      for (const update of stockUpdates) {
        const { error: updateError } = await supabase
          .from('sector_stock')
          .update({ quantity: update.quantity })
          .eq('hotel_id', selectedHotel.id)
          .eq('sector_id', sectorId)
          .eq('product_id', update.product_id);
        if (updateError) console.warn(`Falha ao atualizar estoque de ${update.product_id}: ${updateError.message}`);
      }
      
      addNotification('Balanço salvo com sucesso!', 'success');
      setIsBalancing(false);
      fetchSectorAndStockData(); 
    } catch (err: any) {
      addNotification('Erro ao salvar balanço: ' + err.message, 'error');
    } finally {
      setLoadingBalance(false);
    }
  };

  const triggerDeleteModal = (product: Product) => {
    setProductToDelete(product);
    setShowConfirmDelete(true);
  };

  const handleRemoveProductFromSector = async () => {
    if (!productToDelete || !selectedHotel?.id || !sectorId) return;
    
    try {
      const { error: stockError } = await supabase
        .from('sector_stock')
        .delete()
        .eq('hotel_id', selectedHotel.id)
        .eq('sector_id', sectorId)
        .eq('product_id', productToDelete.id);
      if (stockError) throw stockError;

      const { error: balanceError } = await supabase
        .from('sector_stock_balance')
        .delete()
        .eq('hotel_id', selectedHotel.id)
        .eq('sector_id', sectorId)
        .eq('product_id', productToDelete.id);
      if (balanceError) console.warn("Não foi possível limpar o histórico do produto removido:", balanceError.message);

      addNotification(`"${productToDelete.name}" foi removido do estoque deste setor.`, 'success');
      fetchSectorAndStockData();
    } catch (err: any) {
      addNotification(`Erro ao remover produto: ${err.message}`, 'error');
    } finally {
      setShowConfirmDelete(false);
      setProductToDelete(null);
    }
  };
  
  const openPortioningModal = (entry: PendingEntry) => {
    setSelectedEntry(entry);
    setPortioningItems([
      { id: crypto.randomUUID(), productId: null, productName: ``, yieldQuantity: '' }
    ]);
    setLossAmount('0');
    setShowPortioningModal(true);
  };

  const handlePortioningItemChange = (itemId: string, field: keyof PortioningItem, value: any) => {
    setPortioningItems(prev => prev.map(item => {
      if (item.id === itemId) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  const handleSelectPortionProduct = (itemId: string, product: Product) => {
    setPortioningItems(prev => prev.map(item => {
        if (item.id === itemId) {
            return { ...item, productName: product.name, productId: product.id };
        }
        return item;
    }));
    setOpenDropdownId(null);
  };

  const addNewPortioningItem = () => {
    setPortioningItems(prev => [...prev, { id: crypto.randomUUID(), productId: null, productName: '', yieldQuantity: '' }]);
  };

  const removePortioningItem = (itemId: string) => {
    setPortioningItems(prev => prev.filter(item => item.id !== itemId));
  };

  const handleConfirmPortioning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntry || !user || !selectedHotel || !sectorId) return;

    const lossAmt = parseFloat(lossAmount.replace(',', '.')) || 0;
    if (isNaN(lossAmt) || lossAmt < 0) {
        addNotification('A perda deve ser um número válido (zero ou maior).', 'error');
        return;
    }
    
    const processedItems = portioningItems.map(item => {
        const yieldQty = parseFloat(item.yieldQuantity.replace(',', '.'));
        if (isNaN(yieldQty) || yieldQty <= 0) {
            throw new Error(`A quantidade para "${item.productName}" é inválida.`);
        }
        if (!item.productName.trim()) {
            throw new Error('O nome do produto resultante não pode estar vazio.');
        }
        return {
            product_id: item.productId,
            product_name: item.productName,
            yield_quantity: yieldQty
        };
    }).filter(item => item.product_name.trim() !== '');

    if (processedItems.length === 0) {
        addNotification('Adicione pelo menos um produto resultante.', 'error');
        return;
    }

    setIsProcessing(true);
    try {
        const params = {
            p_pending_entry_id: selectedEntry.id,
            p_portioned_items: processedItems,
            p_loss_amount: lossAmt,
            p_hotel_id: selectedHotel.id,
            p_sector_id: sectorId,
            p_user_id: user.id
        };
        console.log("Chamando RPC 'process_multi_portioning' com parâmetros:", params);

        const { data, error } = await supabase.rpc('process_multi_portioning', params);

        if (error) throw error;
        
        const response = data as { success: boolean, message: string };
        if (!response.success) throw new Error(response.message);

        addNotification('Produto porcionado com sucesso!', 'success');
        setShowPortioningModal(false);
        fetchPendingEntries();
        fetchSectorAndStockData();
    } catch (err: any) {
        console.error("Erro detalhado no RPC:", err);
        addNotification(`Erro ao processar: ${err.message}`, 'error');
    } finally {
        setIsProcessing(false);
    }
  };

  // --- INÍCIO: Novas funções para o modal de edição ---
  /**
   * Abre o modal de edição de quantidade para um produto específico.
   * @param product O produto a ser editado.
   */
  const openEditModal = (product: Product) => {
    setProductToEdit(product);
    setNewQuantity(String(product.quantity)); // Preenche o campo com a quantidade atual
    setShowEditModal(true);
  };

  /**
   * Lida com a confirmação da atualização de estoque.
   * Chama o Supabase para atualizar a quantidade na tabela sector_stock.
   */
  const handleUpdateStock = async () => {
    if (!productToEdit || !selectedHotel || !sectorId) return;

    const quantity = parseFloat(newQuantity.replace(',', '.'));
    if (isNaN(quantity) || quantity < 0) {
      addNotification('Por favor, insira uma quantidade válida.', 'error');
      return;
    }

    setIsUpdatingStock(true);
    try {
      const { error: updateError } = await supabase
        .from('sector_stock')
        .update({ quantity: quantity })
        .eq('hotel_id', selectedHotel.id)
        .eq('sector_id', sectorId)
        .eq('product_id', productToEdit.id);

      if (updateError) throw updateError;

      addNotification(`Estoque de "${productToEdit.name}" atualizado com sucesso!`, 'success');
      setShowEditModal(false);
      setProductToEdit(null);
      fetchSectorAndStockData(); // Recarrega os dados para refletir a mudança
    } catch (err: any) {
      addNotification(`Erro ao atualizar estoque: ${err.message}`, 'error');
    } finally {
      setIsUpdatingStock(false);
    }
  };
  // --- FIM: Novas funções ---

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredBalanceData = balanceData.filter(item => item.productName.toLowerCase().includes(searchTerm.toLowerCase()));
  
  if (loading && products.length === 0) return <div className="p-6 text-center">Carregando...</div>;
  if (error) return <div className="p-6 text-center text-red-500">Erro: {error}</div>;
  if (!sector) return <div className="p-6 text-center">Setor não encontrado.</div>;

  return (
    <div className="container mx-auto p-4 md:p-6 bg-gray-100 dark:bg-gray-900 min-h-screen">
      {/* O cabeçalho e a seção de porcionamento permanecem os mesmos */}
      <div className="flex flex-col sm:flex-row items-center justify-between mb-6 gap-4">
        <button onClick={() => navigate(-1)} className="flex items-center text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300 self-start sm:self-center">
          <ArrowLeft size={20} className="mr-1" /> Voltar
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 text-center flex-grow">Estoque: {sector.name}</h1>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2 w-full sm:w-auto">
          <button 
            onClick={() => setShowAddInventoryItemModal(true)}
            className="w-full sm:w-auto px-4 py-2 rounded-md text-sm font-medium flex items-center justify-center bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
          >
            <Plus size={18} className="mr-2"/> Adicionar do Inventário
          </button>
          <button
            onClick={() => setShowNewProductModal(true)}
            className="w-full sm:w-auto px-4 py-2 rounded-md text-sm font-medium flex items-center justify-center bg-orange-500 hover:bg-orange-600 text-white transition-colors"
          >
            <Plus size={18} className="mr-2"/> Criar Novo Item
          </button>
          <button 
            onClick={() => setIsBalancing(prev => !prev ? (startBalanceProcess(), true) : false)}
            className={`w-full sm:w-auto px-4 py-2 rounded-md text-sm font-medium flex items-center justify-center transition-colors ${
              isBalancing ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {isBalancing ? <X size={18} className="mr-2"/> : <CalendarCheck size={18} className="mr-2"/>}
            {isBalancing ? 'Cancelar Balanço' : 'Realizar Balanço'}
          </button>
        </div>
      </div>
      
      {pendingEntries.length > 0 && (
        <div className="mb-8 p-4 sm:p-6 bg-yellow-50 dark:bg-yellow-900/30 rounded-lg shadow-lg border border-yellow-300 dark:border-yellow-700">
            <h2 className="text-xl font-semibold text-yellow-800 dark:text-yellow-200 mb-4 flex items-center">
                <GitCommit size={22} className="mr-3"/> Itens Pendentes de Porcionamento
            </h2>
            <div className="space-y-3">
                {pendingEntries.map(entry => (
                    <div key={entry.id} className="flex flex-col sm:flex-row items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-md shadow">
                        <div className="flex items-center gap-3">
                            <img src={entry.products.image_url || undefined} alt={entry.products.name} className="w-10 h-10 rounded-md object-cover" onError={(e) => (e.currentTarget.src = 'https://placehold.co/40x40/e2e8f0/a0aec0?text=?')}/>
                            <div>
                                <p className="font-semibold text-gray-800 dark:text-gray-100">{entry.products.name}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    Quantidade Recebida: <strong>{entry.quantity_delivered}</strong>
                                </p>
                            </div>
                        </div>
                        <button 
                            onClick={() => openPortioningModal(entry)}
                            className="mt-3 sm:mt-0 px-4 py-2 bg-yellow-500 text-white font-semibold rounded-lg hover:bg-yellow-600 transition-colors text-sm"
                        >
                            Processar
                        </button>
                    </div>
                ))}
            </div>
        </div>
      )}

      <div className="mb-6">
        <div className="relative">
          <input 
            type="text" 
            placeholder="Buscar produto..." 
            className="w-full p-3 pl-10 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500"/>
        </div>
      </div>
      
      {isBalancing && (
        // A seção de balanço permanece a mesma
        <div className="mb-8 p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-purple-200 dark:border-purple-700">
          <h2 className="text-xl font-semibold text-purple-700 dark:text-purple-300 mb-4">Balanço Semanal de Estoque</h2>
          {loadingBalance && <p className="text-center text-purple-600 dark:text-purple-400">Carregando dados para o balanço...</p>}
          {!loadingBalance && balanceData.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-md border dark:border-gray-700">
                <table className="min-w-full w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-100 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Produto</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Est. Anterior</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Recebimentos</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Contagem Física</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Consumo</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Sobra</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredBalanceData.map(item => (
                      <tr key={item.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            {item.productImageUrl ? 
                              <img src={item.productImageUrl} alt={item.productName} className="w-8 h-8 rounded-full mr-3 object-cover"/> :
                              <div className="w-8 h-8 rounded-full mr-3 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-400">
                                <ImageIcon size={18}/>
                              </div>
                            }
                            <span className="font-medium text-gray-900 dark:text-gray-100">{item.productName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-sm text-gray-500 dark:text-gray-400">{item.initialStock}</td>
                        <td className="px-4 py-3 text-center text-sm text-green-600 dark:text-green-400 font-semibold">+{item.receivedSinceLastBalance}</td>
                        <td className="px-4 py-3">
                          <input 
                            type="number"
                            value={item.currentCount ?? ''}
                            onChange={(e) => handleBalanceInputChange(item.productId, e.target.value)}
                            className="w-24 p-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-gray-200"
                            placeholder="Qtd"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-center text-sm text-red-600 dark:text-red-400">
                          {item.displayConsumption !== undefined ? item.displayConsumption : '-'}
                        </td>
                        <td className="px-4 py-3 text-center text-sm">
                          {item.discrepancy ? <span className="text-yellow-600 dark:text-yellow-400 font-medium">{item.discrepancy}</span> : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 flex justify-end">
                <button 
                  onClick={handleSaveBalance}
                  disabled={loadingBalance || balanceData.every(it => it.currentCount === undefined)}
                  className="px-6 py-2 bg-purple-600 text-white font-semibold rounded-lg shadow-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loadingBalance ? 'Salvando...' : 'Salvar Balanço'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {filteredProducts.map(product => (
          <div key={product.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-2xl transition-shadow duration-300 border border-gray-200 dark:border-gray-700 flex flex-col">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="w-full h-40 object-cover rounded-t-xl"/>
            ) : (
              <div className="w-full h-40 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-400 dark:text-gray-500 rounded-t-xl">
                <ImageIcon size={48}/>
              </div>
            )}
            <div className="p-5 flex flex-col flex-grow">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-1 truncate" title={product.name}>{product.name}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full self-start mb-2">{product.category}</p>
              <div className="mt-auto">
                <p className={`text-2xl font-bold mb-2 ${product.quantity < product.min_quantity ? 'text-red-500 dark:text-red-400' : (product.quantity > product.max_quantity ? 'text-yellow-500 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-200')}`}>
                  {product.quantity}
                </p>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  <span>Min: {product.min_quantity} / Max: {product.max_quantity}</span>
                </div>
                {/* --- ALTERAÇÃO: Botões de ação atualizados --- */}
                <div className="flex items-center space-x-2">
                    <button 
                        onClick={() => openEditModal(product)} 
                        title="Editar Quantidade"
                        className="flex-1 px-3 py-2 bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-md hover:bg-blue-200 dark:hover:bg-blue-700/60 text-center transition-colors flex items-center justify-center"
                    >
                        <Edit2 size={14} className="mr-1.5"/> Editar
                    </button>
                    <button 
                        onClick={() => triggerDeleteModal(product)} 
                        title="Remover do Setor"
                        className="p-2 bg-red-100 dark:bg-red-800/40 text-red-600 dark:text-red-300 rounded-md hover:bg-red-200 dark:hover:bg-red-700/60 transition-colors"
                    >
                        <Trash2 size={16}/>
                    </button>
                </div>
                {/* --- FIM DA ALTERAÇÃO --- */}
              </div>
            </div>
          </div>
        ))}
        {filteredProducts.length === 0 && !isBalancing && !showBalanceHistory && (
            <div className="col-span-full text-center py-10">
                <Package size={48} className="mx-auto text-gray-400 dark:text-gray-500 mb-3"/>
                <p className="text-gray-500 dark:text-gray-400">Nenhum produto encontrado{searchTerm ? ` com o termo "${searchTerm}"` : " neste setor"}.</p>
            </div>
        )}
      </div>

      {/* Modais existentes (AddInventoryItemModal, NewProductModal, etc.) */}
      <AddInventoryItemModal 
          isOpen={showAddInventoryItemModal} 
          onClose={() => setShowAddInventoryItemModal(false)} 
          onItemAdded={fetchSectorAndStockData} 
          sectorId={sectorId}
      />
      <NewProductModal
          isOpen={showNewProductModal}
          onClose={() => setShowNewProductModal(false)}
          onSave={handleNewProductCreatedAndLink}
          editingProduct={null}
          categories={categories}
          createAsHidden={true}
      />
      {showConfirmDelete && productToDelete && (
        <Modal isOpen={showConfirmDelete} onClose={() => setShowConfirmDelete(false)} title="Confirmar Remoção">
          <div className="text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-500 dark:text-red-400" />
            <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-gray-100">Remover Produto do Setor</h3>
            <div className="mt-2 px-7 py-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Tem certeza que deseja remover <strong>{productToDelete.name}</strong> do estoque deste setor? Esta ação não pode ser desfeita.
              </p>
            </div>
            <div className="items-center px-4 py-3 space-x-2">
              <button
                onClick={handleRemoveProductFromSector}
                className="px-4 py-2 bg-red-600 text-white text-base font-medium rounded-md w-auto hover:bg-red-700"
              >
                Sim, remover
              </button>
              <button
                onClick={() => setShowConfirmDelete(false)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 text-base font-medium rounded-md w-auto hover:bg-gray-300 dark:hover:bg-gray-500"
              >
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* --- INÍCIO: Novo modal para editar quantidade --- */}
      {showEditModal && productToEdit && (
        <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title={`Editar Estoque de ${productToEdit.name}`}>
          <div className="space-y-4">
            <div>
              <label htmlFor="editQuantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Nova Quantidade em Estoque
              </label>
              <input
                id="editQuantity"
                type="number"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="Digite a nova quantidade"
                autoFocus
              />
            </div>
            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleUpdateStock}
                disabled={isUpdatingStock}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center"
              >
                {isUpdatingStock && <Loader2 className="animate-spin w-4 h-4 mr-2" />}
                Salvar
              </button>
            </div>
          </div>
        </Modal>
      )}
      {/* --- FIM: Novo modal --- */}

      {showPortioningModal && selectedEntry && (
        <Modal isOpen={showPortioningModal} onClose={() => setShowPortioningModal(false)} title="Processar Item Porcionável">
            <form onSubmit={handleConfirmPortioning}>
                <div className="p-4 space-y-4">
                    <div className="p-3 rounded-md bg-gray-100 dark:bg-gray-700 flex items-center gap-4">
                        <img src={selectedEntry.products.image_url || undefined} alt={selectedEntry.products.name} className="w-12 h-12 rounded-lg object-cover" onError={(e) => (e.currentTarget.src = 'https://placehold.co/48x48/e2e8f0/a0aec0?text=?')}/>
                        <div>
                            <p className="font-bold text-lg text-gray-800 dark:text-gray-100">{selectedEntry.products.name}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">Quantidade a processar: <strong>{selectedEntry.quantity_delivered}</strong></p>
                        </div>
                    </div>

                    <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 border-b pb-2">Produtos Resultantes</h3>
                    
                    {portioningItems.map((item) => (
                        <div key={item.id} className="grid grid-cols-12 gap-2 items-end p-2 border rounded-md dark:border-gray-600">
                            <div className="col-span-6 relative" ref={dropdownRef}>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Produto Resultante (Porção)</label>
                                <input 
                                    type="text"
                                    value={item.productName}
                                    onFocus={() => setOpenDropdownId(item.id)}
                                    onChange={(e) => handlePortioningItemChange(item.id, 'productName', e.target.value)}
                                    placeholder="Selecione ou digite um novo nome"
                                    className="w-full p-2 border rounded-md dark:bg-gray-600 dark:border-gray-500 text-sm"
                                />
                                {openDropdownId === item.id && (
                                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                        {allHotelPortionProducts
                                            .filter(p => p.name.toLowerCase().includes(item.productName.toLowerCase()))
                                            .map(p => (
                                                <button
                                                    type="button"
                                                    key={p.id}
                                                    onClick={() => handleSelectPortionProduct(item.id, p)}
                                                    className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center gap-3"
                                                >
                                                    <img 
                                                        src={p.image_url || 'https://placehold.co/40x40/e2e8f0/a0aec0?text=?'} 
                                                        alt={p.name} 
                                                        className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                                                        onError={(e) => (e.currentTarget.src = 'https://placehold.co/40x40/e2e8f0/a0aec0?text=?')}
                                                    />
                                                    <div>
                                                        <p className="font-semibold text-sm text-gray-800 dark:text-gray-100">{p.name}</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.description || 'Sem descrição'}</p>
                                                    </div>
                                                </button>
                                            ))
                                        }
                                    </div>
                                )}
                            </div>
                            <div className="col-span-4">
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Rendimento</label>
                                <input 
                                    type="number" 
                                    step="0.01" 
                                    value={item.yieldQuantity}
                                    onChange={(e) => handlePortioningItemChange(item.id, 'yieldQuantity', e.target.value)}
                                    placeholder="Qtd."
                                    required
                                    className="w-full p-2 border rounded-md dark:bg-gray-600 dark:border-gray-500 text-sm"
                                />
                            </div>
                            <div className="col-span-2 flex justify-end">
                                {portioningItems.length > 1 && (
                                    <button type="button" onClick={() => removePortioningItem(item.id)} className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full">
                                        <Trash2 size={16}/>
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}

                    <button type="button" onClick={addNewPortioningItem} className="w-full text-sm px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md flex items-center justify-center gap-2">
                        <Plus size={16}/> Adicionar outro produto
                    </button>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Perda Total (Opcional)</label>
                        <input name="loss_amount" value={lossAmount} onChange={(e) => setLossAmount(e.target.value)} type="number" step="0.01" className="w-full p-2 border rounded-md dark:bg-gray-600 dark:border-gray-500" placeholder="Ex: 0.4"/>
                        <p className="text-xs text-gray-500 mt-1">Informe a perda na unidade do item original (ex: 0.4 kg de peixe).</p>
                    </div>

                    <div className="flex justify-end space-x-3 pt-4">
                        <button type="button" onClick={() => setShowPortioningModal(false)} className="px-4 py-2 border rounded-md hover:bg-gray-100 dark:hover:bg-gray-600">Cancelar</button>
                        <button type="submit" disabled={isProcessing} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center disabled:opacity-50">
                            {isProcessing && <Loader2 className="animate-spin mr-2" size={18}/>}
                            Confirmar Porcionamento
                        </button>
                    </div>
                </div>
            </form>
        </Modal>
      )}
    </div>
  );
};

export default SectorStock;
