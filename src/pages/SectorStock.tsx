import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  ArrowLeft, Search, Plus, AlertTriangle, Download,
  Package, Scale, History, ChevronDown, ChevronUp,
  Image as ImageIcon, Clock, Trash2, AlertCircle,
  CalendarCheck, X, ListChecks, Filter, Calendar as CalendarIcon,
  ChevronLeftSquare, ChevronRightSquare
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { format, subDays, startOfWeek, endOfWeek, parseISO, isValid, startOfMonth, endOfMonth } from 'date-fns'; 
import { ptBR } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import AddInventoryItemModal from '../components/AddInventoryItemModal';
import { useNotification } from '../context/NotificationContext'; 

interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  category: string;
  image_url?: string;
  description?: string;
  is_custom?: boolean;
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

interface Requisition {
  id: string;
  item_name: string;
  quantity: number;
  status: string;
  created_at: string;
  delivered_quantity?: number;
  product_id?: string;
  substituted_product_id?: string;
  is_custom?: boolean;
  product?: {
    image_url?: string;
  };
  substituted_product?: {
    image_url?: string;
  };
}

interface WeeklyCountItem {
  productId: string;
  productName: string;
  productImageUrl?: string;
  initialStock: number;
  weeklyEntries: number;
  currentCount?: number; 
  displayConsumption?: number; 
  discrepancy?: number; 
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
  const [showBalanceForm, setShowBalanceForm] = useState(false);
  const [showBalanceHistory, setShowBalanceHistory] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<{[key: string]: number}>({});
  const [showAddCustomForm, setShowAddCustomForm] = useState(false);
  const [showConfirmZero, setShowConfirmZero] = useState(false);
  const [productToZero, setProductToZero] = useState<{id: string, name: string} | null>(null);
  const [showAddInventoryItemModal, setShowAddInventoryItemModal] = useState(false);
  const [newCustomProduct, setNewCustomProduct] = useState({
    name: '',
    category: 'Bar',
    quantity: 1,
    min_quantity: 0,
    max_quantity: 100
  });

  const [isWeeklyCounting, setIsWeeklyCounting] = useState(false);
  const [weeklyCountData, setWeeklyCountData] = useState<WeeklyCountItem[]>([]);
  const [loadingWeeklyCount, setLoadingWeeklyCount] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // State for history pagination and filtering
  const [historyCurrentPage, setHistoryCurrentPage] = useState(1);
  const [historyTotalItems, setHistoryTotalItems] = useState(0);
  const [historyStartDate, setHistoryStartDate] = useState<string>('');
  const [historyEndDate, setHistoryEndDate] = useState<string>('');

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
        .select(`*,
          products (
            id, name, category, image_url, description
          )
        `)
        .eq('sector_id', sectorId)
        .eq('hotel_id', selectedHotel.id);
      if (stockError) throw stockError;
      const processedStock = stockData?.map(item => {
        if (item.is_custom) {
          return {
            id: item.product_id,
            name: item.products?.name || 'Item Personalizado',
            category: item.products?.category || 'Personalizado',
            quantity: item.quantity,
            min_quantity: item.min_quantity,
            max_quantity: item.max_quantity,
            is_custom: true,
            image_url: item.products?.image_url
          };
        } else {
          return {
            ...item.products,
            quantity: item.quantity,
            min_quantity: item.min_quantity,
            max_quantity: item.max_quantity,
            image_url: item.products?.image_url
          };
        }
      }) || [];
      setProducts(processedStock);
    } catch (err: any) {
      console.error('Error fetching sector/stock data:', err);
      setError('Erro ao carregar dados do setor/estoque: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, sectorId]);

  const fetchBalanceHistory = useCallback(async (page = 1, startDate?: string, endDate?: string) => {
    if (!selectedHotel?.id || !sectorId) return;
    setLoadingHistory(true);
    try {
      let query = supabase
        .from('sector_stock_balance')
        .select(`
          *,
          products (
            name,
            category
          )
        `, { count: 'exact' })
        .eq('sector_id', sectorId)
        .eq('hotel_id', selectedHotel.id);

      if (startDate && isValid(parseISO(startDate))) {
        query = query.gte('balance_date', parseISO(startDate).toISOString());
      }
      if (endDate && isValid(parseISO(endDate))) {
        // Add 1 day to endDate to include the whole day
        const endOfDay = new Date(parseISO(endDate));
        endOfDay.setDate(endOfDay.getDate() + 1);
        query = query.lt('balance_date', endOfDay.toISOString());
      }

      query = query.order('balance_date', { ascending: false })
        .range((page - 1) * ITEMS_PER_HISTORY_PAGE, page * ITEMS_PER_HISTORY_PAGE - 1);

      const { data: balanceData, error: balanceError, count } = await query;

      if (balanceError) throw balanceError;
      setBalanceHistoryData(balanceData || []);
      setHistoryTotalItems(count || 0);
      setHistoryCurrentPage(page);
    } catch (err: any) {
      console.error('Error fetching balance history:', err);
      addNotification('Erro ao carregar histórico de balanços: ' + err.message, 'error');
    } finally {
      setLoadingHistory(false);
    }
  }, [selectedHotel, sectorId, addNotification]);

  useEffect(() => {
    fetchSectorAndStockData();
  }, [fetchSectorAndStockData]);

  useEffect(() => {
    if (showBalanceHistory) {
      fetchBalanceHistory(historyCurrentPage, historyStartDate, historyEndDate);
    }
  }, [showBalanceHistory, historyCurrentPage, historyStartDate, historyEndDate, fetchBalanceHistory]);

  const handleHistoryFilterApply = () => {
    setHistoryCurrentPage(1); // Reset to first page when applying new filters
    fetchBalanceHistory(1, historyStartDate, historyEndDate);
  };

  const handleHistoryPageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= Math.ceil(historyTotalItems / ITEMS_PER_HISTORY_PAGE)) {
      setHistoryCurrentPage(newPage);
      // fetchBalanceHistory will be called by useEffect due to historyCurrentPage change
    }
  };

  const startWeeklyCount = async () => {
    if (!selectedHotel?.id || !sectorId) return;
    setLoadingWeeklyCount(true);
    setError(null);
    setIsWeeklyCounting(true);
    setWeeklyCountData([]);
    try {
      const today = new Date();
      const startOfCurrentWeek = startOfWeek(today, { locale: ptBR, weekStartsOn: 1 });
      const endOfLastWeek = subDays(startOfCurrentWeek, 1);
      const { data: currentWeekRequisitions, error: reqError } = await supabase
        .from('requisitions')
        .select('product_id, substituted_product_id, delivered_quantity, created_at')
        .eq('hotel_id', selectedHotel.id)
        .eq('sector_id', sectorId)
        .eq('status', 'delivered')
        .gte('created_at', startOfCurrentWeek.toISOString())
        .lte('created_at', today.toISOString());
      if (reqError) throw new Error(`Error fetching current week requisitions: ${reqError.message}`);
      const countItems: WeeklyCountItem[] = [];
      for (const product of products) {
        if (!product || typeof product.name !== 'string') continue;
        let initialStock = 0;
        const { data: lastWeekBalance, error: balanceError } = await supabase
          .from('sector_stock_balance')
          .select('current_quantity, balance_date')
          .eq('hotel_id', selectedHotel.id)
          .eq('sector_id', sectorId)
          .eq('product_id', product.id)
          .lte('balance_date', endOfLastWeek.toISOString())
          .order('balance_date', { ascending: false })
          .limit(1);
        if (balanceError) {
          console.warn(`Error fetching last week balance for ${product.name}:`, balanceError.message);
          const currentProductState = products.find(p => p.id === product.id);
          initialStock = currentProductState?.quantity || 0;
        } else if (lastWeekBalance && lastWeekBalance.length > 0) {
          initialStock = lastWeekBalance[0].current_quantity;
        } else {
           const currentProductState = products.find(p => p.id === product.id);
           initialStock = currentProductState?.quantity || 0; 
        }
        let weeklyEntries = 0;
        if (currentWeekRequisitions) {
          weeklyEntries = currentWeekRequisitions
            .filter(req => (req.substituted_product_id === product.id) || (!req.substituted_product_id && req.product_id === product.id))
            .reduce((sum, req) => sum + (req.delivered_quantity || 0), 0);
        }
        countItems.push({
          productId: product.id,
          productName: product.name,
          productImageUrl: product.image_url,
          initialStock: initialStock,
          weeklyEntries: weeklyEntries,
        });
      }
      setWeeklyCountData(countItems.sort((a, b) => a.productName.localeCompare(b.productName)));
    } catch (err: any) {
      console.error('Error starting weekly count:', err);
      setError('Erro ao preparar contagem semanal: ' + err.message);
      addNotification('Erro ao preparar contagem semanal: ' + err.message, 'error');
      setIsWeeklyCounting(false);
    } finally {
      setLoadingWeeklyCount(false);
    }
  };

  const handleWeeklyCountInputChange = (productId: string, value: string) => {
    const currentCount = value === '' ? undefined : parseFloat(value.replace(',', '.'));
    setWeeklyCountData(prevData => 
      prevData.map(item => {
        if (item.productId === productId) {
          let displayConsumption: number | undefined = undefined;
          let discrepancy: number | undefined = undefined;
          if (currentCount !== undefined && !isNaN(currentCount)) {
            const totalAvailable = item.initialStock + item.weeklyEntries;
            const rawConsumption = totalAvailable - currentCount;
            if (rawConsumption < 0) {
              displayConsumption = 0; 
              discrepancy = Math.abs(rawConsumption); 
            } else {
              displayConsumption = rawConsumption;
              discrepancy = 0; 
            }
          } else {
             displayConsumption = undefined;
             discrepancy = undefined;
          }
          return { ...item, currentCount: currentCount, displayConsumption: displayConsumption, discrepancy: discrepancy };
        }
        return item;
      })
    );
  };

  const handleSaveWeeklyCount = async () => {
    if (!selectedHotel?.id || !sectorId || !user) {
      addNotification('Hotel, setor ou usuário não identificado.', 'error');
      return;
    }
    setError(null);
    setLoadingWeeklyCount(true);
    try {
      const balanceDate = new Date().toISOString();
      const balanceEntries = [];
      const stockUpdates = [];
      for (const item of weeklyCountData) {
        if (item.currentCount === undefined || isNaN(item.currentCount)) continue;
        balanceEntries.push({
          sector_id: sectorId,
          product_id: item.productId,
          previous_quantity: item.initialStock, 
          current_quantity: item.currentCount, 
          received_quantity: item.weeklyEntries, 
          balance_date: balanceDate,
          hotel_id: selectedHotel.id,
          notes: `Contagem Semanal - ${format(new Date(), 'dd/MM/yyyy')}`,
          created_by: user.email
        });
        stockUpdates.push({ product_id: item.productId, quantity: item.currentCount });
      }
      if (balanceEntries.length === 0) {
        addNotification('Nenhuma contagem válida para salvar.', 'warning');
        setLoadingWeeklyCount(false);
        return;
      }
      const { error: insertError } = await supabase.from('sector_stock_balance').insert(balanceEntries);
      if (insertError) throw new Error(`Erro ao salvar histórico da contagem: ${insertError.message}`);
      for (const update of stockUpdates) {
        const { error: updateError } = await supabase
          .from('sector_stock')
          .update({ quantity: update.quantity })
          .eq('hotel_id', selectedHotel.id)
          .eq('sector_id', sectorId)
          .eq('product_id', update.product_id);
        if (updateError) {
          console.warn(`Erro ao atualizar estoque de ${update.product_id}: ${updateError.message}`);
          addNotification(`Erro ao atualizar estoque de um item (${products.find(p=>p.id === update.product_id)?.name || 'ID: '+update.product_id}). Verifique o histórico.`, 'warning');
        }
      }
      addNotification('Contagem semanal salva com sucesso!', 'success');
      setIsWeeklyCounting(false);
      setWeeklyCountData([]);
      fetchSectorAndStockData(); 
      if(showBalanceHistory) fetchBalanceHistory(1, historyStartDate, historyEndDate); 
    } catch (err: any) {
      console.error('Error saving weekly count:', err);
      setError('Erro ao salvar contagem semanal: ' + err.message);
      addNotification('Erro ao salvar contagem semanal: ' + err.message, 'error');
    } finally {
      setLoadingWeeklyCount(false);
    }
  };
  
  const handleSubmitBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!user || !selectedHotel?.id) {
      addNotification('Usuário ou hotel não identificado.', 'error');
      return;
    }
    try {
      const balanceDate = new Date().toISOString();
      const balanceEntries = [];
      const productUpdates = [];
      for (const [productId, currentQuantity] of Object.entries(selectedProducts)) {
        const product = products.find(p => p.id === productId);
        if (!product) continue;
        const previousQuantity = product.quantity;
        balanceEntries.push({
          sector_id: sectorId,
          product_id: productId,
          previous_quantity: previousQuantity,
          current_quantity: currentQuantity,
          received_quantity: (currentQuantity - previousQuantity > 0 ? currentQuantity - previousQuantity : 0),
          balance_date: balanceDate,
          hotel_id: selectedHotel.id,
          notes: 'Ajuste manual de balanço',
          created_by: user.email
        });
        productUpdates.push({productId, quantity: currentQuantity});
      }
      if (balanceEntries.length === 0) {
        addNotification('Nenhum produto selecionado para balanço.', 'warning');
        return;
      }
      const { error: insertError } = await supabase.from('sector_stock_balance').insert(balanceEntries);
      if (insertError) throw insertError;
      for (const pUpdate of productUpdates) {
        const { error: updateError } = await supabase
          .from('sector_stock')
          .update({ quantity: pUpdate.quantity })
          .eq('hotel_id', selectedHotel.id)
          .eq('sector_id', sectorId)
          .eq('product_id', pUpdate.productId);
        if (updateError) console.warn("Failed to update stock for", pUpdate.productId, updateError);
      }
      addNotification('Balanço de estoque salvo com sucesso!', 'success');
      setShowBalanceForm(false);
      setSelectedProducts({});
      fetchSectorAndStockData(); 
      if(showBalanceHistory) fetchBalanceHistory(1, historyStartDate, historyEndDate);
    } catch (err: any) {
      console.error('Error submitting balance:', err);
      setError('Erro ao salvar balanço: ' + err.message);
      addNotification('Erro ao salvar balanço: ' + err.message, 'error');
    }
  };

  const handleAddCustomProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHotel || !sectorId || !user) {
      addNotification("Hotel, setor ou usuário não identificado.", "error");
      return;
    }
    if (!newCustomProduct.name.trim()) {
      addNotification("Nome do produto personalizado é obrigatório.", "warning");
      return;
    }
    try {
      setLoading(true);
      const { data: productData, error: productError } = await supabase
        .from("products")
        .insert({
          name: newCustomProduct.name,
          category: newCustomProduct.category,
          hotel_id: selectedHotel.id,
          is_custom: true,
          created_by: user.email
        })
        .select("id")
        .single();
      if (productError) throw productError;
      if (!productData) throw new Error("Falha ao criar produto personalizado.");
      const newProductId = productData.id;
      const { error: sectorStockError } = await supabase
        .from("sector_stock")
        .insert({
          hotel_id: selectedHotel.id,
          sector_id: sectorId,
          product_id: newProductId,
          quantity: newCustomProduct.quantity,
          min_quantity: newCustomProduct.min_quantity,
          max_quantity: newCustomProduct.max_quantity,
          is_custom: true,
        });
      if (sectorStockError) {
        await supabase.from("products").delete().eq("id", newProductId);
        throw sectorStockError;
      }
      addNotification("Produto personalizado adicionado com sucesso!", "success");
      setNewCustomProduct({ name: '', category: 'Bar', quantity: 1, min_quantity: 0, max_quantity: 100 }); 
    } catch (err: any) {
      console.error("Error adding custom product:", err);
      addNotification("Erro ao adicionar produto: " + err.message, "error");
    } finally {
      setLoading(false);
      setShowAddCustomForm(false);
      fetchSectorAndStockData(); 
    }
  };

  const handleZeroQuantity = (product: {id: string, name: string}) => {
    setProductToZero(product);
    setShowConfirmZero(true);
  };

  const confirmZeroQuantity = async () => {
    if (!productToZero || !selectedHotel?.id || !sectorId || !user) {
      addNotification('Produto, hotel, setor ou usuário não identificado.', 'error');
      return;
    }
    try {
      setLoading(true);
      const currentProduct = products.find(p => p.id === productToZero.id);
      const previousQuantity = currentProduct?.quantity || 0;
      const { error } = await supabase
        .from("sector_stock")
        .update({ quantity: 0 })
        .eq("hotel_id", selectedHotel.id)
        .eq("sector_id", sectorId)
        .eq("product_id", productToZero.id);
      if (error) throw error;
      await supabase.from("sector_stock_balance").insert({
        sector_id: sectorId,
        product_id: productToZero.id,
        previous_quantity: previousQuantity,
        current_quantity: 0,
        received_quantity: 0,
        balance_date: new Date().toISOString(),
        hotel_id: selectedHotel.id,
        notes: `Estoque zerado manualmente para ${productToZero.name}`,
        created_by: user.email
      });
      addNotification(`Estoque de ${productToZero.name} zerado com sucesso.`, "success");
      fetchSectorAndStockData(); 
      if(showBalanceHistory) fetchBalanceHistory(1, historyStartDate, historyEndDate);
    } catch (err: any) {
      console.error("Error zeroing quantity:", err);
      addNotification("Erro ao zerar estoque: " + err.message, "error");
    } finally {
      setLoading(false);
      setShowConfirmZero(false);
      setProductToZero(null);
    }
  };

  const filteredProducts = products.filter(product =>
    product && typeof product.name === 'string' && typeof searchTerm === 'string' ? 
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) : true
  );
  
  const filteredWeeklyCountData = weeklyCountData.filter(item => 
    item && typeof item.productName === 'string' && typeof searchTerm === 'string' ? 
    item.productName.toLowerCase().includes(searchTerm.toLowerCase()) : true
  );

  const totalHistoryPages = Math.ceil(historyTotalItems / ITEMS_PER_HISTORY_PAGE);

  if (loading && products.length === 0) return <div className="p-6 text-center"><div className="loader text-purple-600 dark:text-purple-400"></div>Carregando estoque do setor...</div>;
  if (error && !isWeeklyCounting && !showBalanceHistory) return <div className="p-6 text-center text-red-500 bg-red-100 dark:bg-red-900 dark:text-red-300 rounded-md shadow">Erro: {error} <button onClick={fetchSectorAndStockData} className="ml-2 px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded">Tentar Novamente</button></div>;
  if (!sector) return <div className="p-6 text-center text-gray-500 dark:text-gray-400">Setor não encontrado.</div>;

  return (
    <div className="container mx-auto p-4 md:p-6 bg-gray-100 dark:bg-gray-900 min-h-screen">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-6 gap-4">
        <button onClick={() => navigate(-1)} className="flex items-center text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300 self-start sm:self-center">
          <ArrowLeft size={20} className="mr-1" /> Voltar
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 text-center sm:text-left flex-grow">Estoque do Setor: {sector.name}</h1>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2 w-full sm:w-auto">
          <button 
            onClick={() => setShowBalanceHistory(!showBalanceHistory)}
            className={`w-full sm:w-auto px-4 py-2 rounded-md text-sm font-medium flex items-center justify-center transition-all duration-150 ease-in-out 
              ${showBalanceHistory 
                ? 'bg-gray-500 hover:bg-gray-600 text-white'
                : 'bg-teal-500 hover:bg-teal-600 text-white'}`}
          >
            <ListChecks size={18} className="mr-2"/>
            {showBalanceHistory ? 'Ocultar Histórico' : 'Ver Histórico de Balanços'}
          </button>
          <button 
            onClick={() => setIsWeeklyCounting(prev => !prev ? (startWeeklyCount(), true) : false)}
            className={`w-full sm:w-auto px-4 py-2 rounded-md text-sm font-medium flex items-center justify-center transition-all duration-150 ease-in-out 
              ${isWeeklyCounting 
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'}`}
          >
            {isWeeklyCounting ? <X size={18} className="mr-2"/> : <CalendarCheck size={18} className="mr-2"/>}
            {isWeeklyCounting ? 'Cancelar Contagem' : 'Contagem Semanal'}
          </button>
          <button onClick={() => setShowBalanceForm(!showBalanceForm)} className="w-full sm:w-auto px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 text-sm flex items-center justify-center">
            <Scale size={18} className="mr-2"/> Ajustar Balanço
          </button>
        </div>
      </div>

      <div className="mb-6">
        <div className="relative">
          <input 
            type="text" 
            placeholder="Buscar produto no estoque ou no histórico (se visível)..." 
            className="w-full p-3 pl-10 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500 transition-shadow"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500"/>
        </div>
      </div>
      
      {showBalanceHistory && (
        <div className="mb-8 p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-teal-200 dark:border-teal-700">
          <h2 className="text-xl font-semibold text-teal-700 dark:text-teal-300 mb-4">Histórico de Balanços do Setor</h2>
          
          <div className="flex flex-col sm:flex-row gap-4 mb-4 items-end">
            <div className="flex-1">
              <label htmlFor="historyStartDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Data Início</label>
              <input 
                type="date"
                id="historyStartDate"
                value={historyStartDate}
                onChange={(e) => setHistoryStartDate(e.target.value)}
                className="mt-1 block w-full p-2 border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-gray-200"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="historyEndDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Data Fim</label>
              <input 
                type="date"
                id="historyEndDate"
                value={historyEndDate}
                onChange={(e) => setHistoryEndDate(e.target.value)}
                className="mt-1 block w-full p-2 border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-gray-200"
              />
            </div>
            <button 
              onClick={handleHistoryFilterApply}
              className="px-4 py-2 bg-teal-500 text-white rounded-md hover:bg-teal-600 flex items-center justify-center text-sm h-10"
            >
              <Filter size={16} className="mr-2"/> Filtrar
            </button>
          </div>

          {loadingHistory && <p className="text-teal-600 dark:text-teal-400">Carregando histórico...</p>}
          {!loadingHistory && balanceHistoryData.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-md border dark:border-gray-700">
                <table className="min-w-full w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-100 dark:bg-gray-700">
                    <tr>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Data</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Produto</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Qtd. Anterior</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Recebido</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Consumido</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Qtd. Atual</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Notas</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Usuário</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {balanceHistoryData.filter(b => typeof searchTerm === 'string' ? (b.products?.name?.toLowerCase().includes(searchTerm.toLowerCase()) || b.notes?.toLowerCase().includes(searchTerm.toLowerCase())) : true).map(balance => (
                      <tr key={balance.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{format(parseISO(balance.balance_date), 'dd/MM/yy HH:mm', { locale: ptBR })}</td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">{balance.products?.name || 'N/A'}</td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">{balance.previous_quantity}</td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-sm text-green-600 dark:text-green-400 text-center">{balance.received_quantity > 0 ? `+${balance.received_quantity}` : '-'}</td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-sm text-red-600 dark:text-red-400 text-center">{balance.consumed_quantity > 0 ? `-${balance.consumed_quantity}` : '-'}</td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 font-semibold text-center">{balance.current_quantity}</td>
                        <td className="px-3 sm:px-4 py-3 text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs" title={balance.notes}>{balance.notes || '-'}</td>
                        <td className="px-3 sm:px-4 py-3 text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs" title={balance.created_by}>{balance.created_by || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalHistoryPages > 1 && (
                <div className="mt-4 flex justify-between items-center">
                  <button 
                    onClick={() => handleHistoryPageChange(historyCurrentPage - 1)} 
                    disabled={historyCurrentPage === 1}
                    className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 flex items-center"
                  >
                    <ChevronLeftSquare size={16} className="mr-1"/> Anterior
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Página {historyCurrentPage} de {totalHistoryPages}
                  </span>
                  <button 
                    onClick={() => handleHistoryPageChange(historyCurrentPage + 1)} 
                    disabled={historyCurrentPage === totalHistoryPages}
                    className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 flex items-center"
                  >
                    Próxima <ChevronRightSquare size={16} className="ml-1"/>
                  </button>
                </div>
              )}
            </>
          )}
          {!loadingHistory && balanceHistoryData.length === 0 && (
            <p className="text-gray-500 dark:text-gray-400">Nenhum histórico de balanço encontrado para os filtros aplicados.</p>
          )}
        </div>
      )}

      {isWeeklyCounting && (
        <div className="mb-8 p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-purple-200 dark:border-purple-700">
          <h2 className="text-xl font-semibold text-purple-700 dark:text-purple-300 mb-4">Contagem Semanal de Estoque</h2>
          {error && isWeeklyCounting && <p className="text-red-500 dark:text-red-400 mb-4">Erro ao carregar dados da contagem: {error}</p>}
          {loadingWeeklyCount && <p className="text-purple-600 dark:text-purple-400">Carregando dados para contagem...</p>}
          {!loadingWeeklyCount && weeklyCountData.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-md border dark:border-gray-700">
                <table className="min-w-full w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-100 dark:bg-gray-700">
                    <tr>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Produto</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Est. Inicial</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Entradas</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Contagem</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Consumo</th>
                      <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Sobra/Discrep.</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredWeeklyCountData.map(item => (
                      <tr key={item.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            {item.productImageUrl && <img src={item.productImageUrl} alt={item.productName} className="w-8 h-8 rounded-full mr-3 object-cover hidden sm:block"/>}
                            <span className="font-medium text-gray-900 dark:text-gray-100">{item.productName}</span>
                          </div>
                        </td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">{item.initialStock}</td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">{item.weeklyEntries}</td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                          <input 
                            type="number"
                            value={item.currentCount ?? ''}
                            onChange={(e) => handleWeeklyCountInputChange(item.productId, e.target.value)}
                            className="w-20 sm:w-24 p-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-gray-200"
                            placeholder="Qtd"
                          />
                        </td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 font-medium text-center">
                          {item.displayConsumption !== undefined ? item.displayConsumption : '-'}
                        </td>
                        <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-sm text-center">
                          {item.discrepancy !== undefined && item.discrepancy > 0 
                            ? <span className="text-green-600 dark:text-green-400 font-medium">{item.discrepancy}</span> 
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <div className="mt-6 flex justify-end">
                  <button 
                    onClick={handleSaveWeeklyCount}
                    disabled={loadingWeeklyCount || weeklyCountData.every(it => it.currentCount === undefined)}
                    className="px-6 py-2 bg-purple-600 text-white font-semibold rounded-lg shadow-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {loadingWeeklyCount ? 'Salvando...' : 'Salvar Contagem'}
                  </button>
                </div>
            </>
          )}
          {!loadingWeeklyCount && weeklyCountData.length === 0 && products.length > 0 && !error && (
            <p className="text-gray-500 dark:text-gray-400">Nenhum produto encontrado para contagem ou dados ainda carregando.</p>
          )}
           {!loadingWeeklyCount && products.length === 0 && !error && (
            <p className="text-gray-500 dark:text-gray-400">Não há produtos cadastrados neste setor para realizar a contagem.</p>
          )}
        </div>
      )}

      {showBalanceForm && (
        <div className="mb-8 p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-blue-200 dark:border-blue-700">
          <h2 className="text-xl font-semibold text-blue-700 dark:text-blue-300 mb-4">Ajustar Balanço Manualmente</h2>
          <form onSubmit={handleSubmitBalance}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              {filteredProducts.map(product => (
                <div key={product.id} className="p-3 border dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700/30">
                  <label htmlFor={`product-${product.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{product.name}</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Estoque Atual: {product.quantity}</p>
                  <input 
                    type="number" 
                    id={`product-${product.id}`}
                    value={selectedProducts[product.id] ?? product.quantity} 
                    onChange={(e) => setSelectedProducts({...selectedProducts, [product.id]: parseFloat(e.target.value)})} 
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm dark:bg-gray-700 dark:text-gray-200"
                  />
                </div>
              ))}
            </div>
            {filteredProducts.length === 0 && <p className="text-center text-gray-500 dark:text-gray-400 py-4">Nenhum produto encontrado com o termo "{searchTerm}".</p>}
            <div className="flex justify-end">
              <button type="submit" className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors">
                Salvar Balanço
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
        {filteredProducts.map(product => (
          <div key={product.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-2xl transition-shadow duration-300 border border-gray-200 dark:border-gray-700 flex flex-col">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="w-full h-32 sm:h-40 object-cover rounded-t-xl"/>
            ) : (
              <div className="w-full h-32 sm:h-40 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-400 dark:text-gray-500 rounded-t-xl">
                <ImageIcon size={48}/>
              </div>
            )}
            <div className="p-3 sm:p-5 flex flex-col flex-grow">
              <h3 className="text-md sm:text-lg font-semibold text-gray-800 dark:text-gray-100 mb-1 truncate" title={product.name}>{product.name}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full self-start mb-2">{product.category}</p>
              <div className="mt-auto">
                <p className={`text-xl sm:text-2xl font-bold mb-2 ${product.quantity < product.min_quantity ? 'text-red-500 dark:text-red-400' : (product.quantity > product.max_quantity ? 'text-yellow-500 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-200')}`}>
                  {product.quantity}
                </p>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  <span>Min: {product.min_quantity} / Max: {product.max_quantity}</span>
                </div>
                <div className="flex items-center space-x-2">
                    <Link 
                        to={`/product-history/${product.id}?sectorId=${sectorId}&sectorName=${encodeURIComponent(sector.name)}&productName=${encodeURIComponent(product.name)}`}
                        className="flex-1 px-3 py-2 bg-purple-100 dark:bg-purple-700/30 text-purple-700 dark:text-purple-300 text-xs font-medium rounded-md hover:bg-purple-200 dark:hover:bg-purple-600/40 text-center transition-colors flex items-center justify-center"
                    >
                        <History size={14} className="mr-1.5"/> Histórico
                    </Link>
                    <button 
                        onClick={() => handleZeroQuantity(product)} 
                        title="Zerar Estoque"
                        className="p-2 bg-red-100 dark:bg-red-700/30 text-red-600 dark:text-red-300 rounded-md hover:bg-red-200 dark:hover:bg-red-600/40 transition-colors"
                    >
                        <Trash2 size={16}/>
                    </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {filteredProducts.length === 0 && !isWeeklyCounting && !showBalanceHistory && (
            <div className="col-span-full text-center py-10">
                <Package size={48} className="mx-auto text-gray-400 dark:text-gray-500 mb-3"/>
                <p className="text-gray-500 dark:text-gray-400">Nenhum produto encontrado{searchTerm ? ` com o termo "${searchTerm}"` : " neste setor"}.</p>
            </div>
        )}
      </div>

      <div className="mt-8">
        <button 
          onClick={() => setShowAddCustomForm(!showAddCustomForm)}
          className="mb-4 px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 text-sm flex items-center">
          <Plus size={18} className="mr-2"/> Adicionar Produto Personalizado
        </button>
        {showAddCustomForm && (
          <form onSubmit={handleAddCustomProduct} className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md border dark:border-gray-700">
            <h3 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-100">Novo Produto Personalizado</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="customName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nome</label>
                <input type="text" id="customName" value={newCustomProduct.name} onChange={e => setNewCustomProduct({...newCustomProduct, name: e.target.value})} className="mt-1 block w-full p-2 border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-gray-200" required/>
              </div>
              <div>
                <label htmlFor="customCategory" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Categoria</label>
                <input type="text" id="customCategory" value={newCustomProduct.category} onChange={e => setNewCustomProduct({...newCustomProduct, category: e.target.value})} className="mt-1 block w-full p-2 border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-gray-200"/>
              </div>
              <div>
                <label htmlFor="customQuantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Qtd. Inicial</label>
                <input type="number" id="customQuantity" value={newCustomProduct.quantity} onChange={e => setNewCustomProduct({...newCustomProduct, quantity: parseInt(e.target.value)})} className="mt-1 block w-full p-2 border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-gray-200"/>
              </div>
              <div>
                <label htmlFor="customMinQuantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Qtd. Mínima</label>
                <input type="number" id="customMinQuantity" value={newCustomProduct.min_quantity} onChange={e => setNewCustomProduct({...newCustomProduct, min_quantity: parseInt(e.target.value)})} className="mt-1 block w-full p-2 border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-gray-200"/>
              </div>
              <div>
                <label htmlFor="customMaxQuantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Qtd. Máxima</label>
                <input type="number" id="customMaxQuantity" value={newCustomProduct.max_quantity} onChange={e => setNewCustomProduct({...newCustomProduct, max_quantity: parseInt(e.target.value)})} className="mt-1 block w-full p-2 border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-gray-200"/>
              </div>
            </div>
            <button type="submit" className="mt-4 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600">Adicionar Produto</button>
          </form>
        )}
      </div>

      {showConfirmZero && productToZero && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center mb-4">
              <AlertTriangle size={24} className="text-red-500 dark:text-red-400 mr-3" />
              <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">Confirmar Zerar Estoque</h2>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-6">Tem certeza que deseja zerar o estoque de <strong>{productToZero.name}</strong>? Esta ação registrará o consumo total do estoque atual.</p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowConfirmZero(false)} className="px-4 py-2 text-gray-700 bg-gray-200 dark:text-gray-300 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">Cancelar</button>
              <button onClick={confirmZeroQuantity} className="px-4 py-2 text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors">Zerar Estoque</button>
            </div>
          </div>
        </div>
      )}

      {showAddInventoryItemModal && (
          <AddInventoryItemModal 
              isOpen={showAddInventoryItemModal} 
              onClose={() => setShowAddInventoryItemModal(false)} 
              onItemAdded={fetchSectorAndStockData} 
              sectorId={sectorId}
          />
      )}
    </div>
  );
};

export default SectorStock;

