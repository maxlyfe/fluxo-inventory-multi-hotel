import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  ArrowLeft, Search, Plus, AlertTriangle,
  Package, Scale, History, ChevronDown, ChevronUp,
  ImageIcon, Trash2,
  CalendarCheck, X, ListChecks, Filter,
  ChevronLeftSquare, ChevronRightSquare
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { format, parseISO, isValid } from 'date-fns'; 
import { ptBR } from 'date-fns/locale';
import { useNotification } from '../context/NotificationContext'; 
import AddInventoryItemModal from '../components/AddInventoryItemModal';
import Modal from '../components/Modal';
import NewProductModal from '../components/NewProductModal';

// Interfaces
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
  
  const [showBalanceHistory, setShowBalanceHistory] = useState(false); // Linha que estava faltando
  const [showAddInventoryItemModal, setShowAddInventoryItemModal] = useState(false);

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
        .select(`*, products!inner(id, name, category, image_url, description, is_active)`)
        .eq('sector_id', sectorId)
        .eq('hotel_id', selectedHotel.id);
      
      if (stockError) throw stockError;

      const processedStock = stockData?.map((item: any) => ({
        ...item.products,
        quantity: item.quantity,
        min_quantity: item.min_quantity,
        max_quantity: item.max_quantity,
      })) || [];
      setProducts(processedStock.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err: any) {
      setError('Erro ao carregar dados: ' + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, sectorId]);

  useEffect(() => {
    const fetchInitialData = async () => {
        if (selectedHotel) {
            await fetchSectorAndStockData();
            const { data } = await supabase.from('products').select('category').eq('hotel_id', selectedHotel.id);
            if (data) {
                const uniqueCategories = [...new Set(data.map(p => p.category).filter(Boolean))];
                setCategories(uniqueCategories.sort());
            }
        }
    };
    fetchInitialData();
  }, [selectedHotel, fetchSectorAndStockData]);
  
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
  
  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredBalanceData = balanceData.filter(item => item.productName.toLowerCase().includes(searchTerm.toLowerCase()));

  if (loading && products.length === 0) return <div className="p-6 text-center">Carregando...</div>;
  if (error) return <div className="p-6 text-center text-red-500">Erro: {error}</div>;
  if (!sector) return <div className="p-6 text-center">Setor não encontrado.</div>;

  return (
    <div className="container mx-auto p-4 md:p-6 bg-gray-100 dark:bg-gray-900 min-h-screen">
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
                <div className="flex items-center space-x-2">
                    <Link 
                        to={`/product-history/${product.id}?sectorId=${sectorId}&sectorName=${encodeURIComponent(sector.name)}&productName=${encodeURIComponent(product.name)}`}
                        className="flex-1 px-3 py-2 bg-purple-100 dark:bg-purple-800/40 text-purple-700 dark:text-purple-300 text-xs font-medium rounded-md hover:bg-purple-200 dark:hover:bg-purple-700/60 text-center transition-colors flex items-center justify-center"
                    >
                        <History size={14} className="mr-1.5"/> Histórico
                    </Link>
                    <button 
                        onClick={() => triggerDeleteModal(product)} 
                        title="Remover do Setor"
                        className="p-2 bg-red-100 dark:bg-red-800/40 text-red-600 dark:text-red-300 rounded-md hover:bg-red-200 dark:hover:bg-red-700/60 transition-colors"
                    >
                        <Trash2 size={16}/>
                    </button>
                </div>
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
    </div>
  );
};

export default SectorStock;