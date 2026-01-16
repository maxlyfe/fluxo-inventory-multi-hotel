import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Plus, AlertTriangle, Edit2, Trash2, X, Download, Filter,
  ShoppingCart, ChevronDown, ChevronUp, Package, ArrowUp,
  ArrowUpRight, Search, Image as ImageIcon, DollarSign,
  RefreshCw, ArrowLeftRight, Eye, EyeOff, FilePlus, Camera, BarChart2,
  Star, ListChecks // Ícone de Estrela importado
} from 'lucide-react';
import * as XLSX from 'xlsx';
import ImportInventory from '../components/ImportInventory';
import { useHotel } from '../context/HotelContext';
import SyncProductsModal from '../components/SyncProductsModal';
import NewHotelTransferModal from '../components/NewHotelTransferModal';
import { searchMatch } from '../utils/search';
import { useNotification } from '../context/NotificationContext';
import NewProductModal from '../components/NewProductModal';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
// --- NOVO: Importa o modal de itens favoritados ---
import StarredItemsModal from '../components/StarredItemsModal';
import StockConferenceModal from '../components/StockConferenceModal';

// --- ALTERAÇÃO: Adiciona a propriedade opcional 'is_starred' à interface do Produto ---
// Isso permite que o TypeScript entenda o novo campo que vem do banco de dados.
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
  last_purchase_date?: string;
  last_purchase_price?: number;
  last_purchase_quantity?: number;
  average_price?: number;
  is_active: boolean;
  is_starred?: boolean; // Campo para favoritar
}

const Inventory = () => {
  // --- Seção de declaração de estados (Hooks) ---
  // Mantém todos os seus estados originais e adiciona um novo para o modal de favoritos.
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const { user } = useAuth();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [weeklyReportData, setWeeklyReportData] = useState<any>(null);
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  // --- NOVO: Estado para controlar a visibilidade do modal de itens favoritados ---
  const [showStarredModal, setShowStarredModal] = useState(false);
  const [showConferenceModal, setShowConferenceModal] = useState(false);

  // Lógica para obter itens com estoque baixo (permanece igual)
  const lowStockItems = products.filter(product => product.is_active && product.quantity <= product.min_quantity);

  /**
   * Função para buscar os produtos do inventário.
   * Foi atualizada para também buscar o novo campo 'is_starred'.
   */
  const fetchProducts = useCallback(async () => {
    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel não selecionado');
      }
      setLoading(true);
      setError('');
      setImageErrors({});

      // --- ALTERAÇÃO: Adiciona 'is_starred' à consulta SELECT ---
      // Garante que a informação de favorito seja trazida do banco de dados.
      const { data, error: fetchError } = await supabase
        .from('products')
        .select('*, is_starred')
        .eq('hotel_id', selectedHotel.id)
        .order('name');

      if (fetchError) throw fetchError;
      setProducts(data || []);
      
      const uniqueCategories = [...new Set(data?.map(p => p.category) || [])];
      setCategories(uniqueCategories.sort());
    } catch (err) {
      console.error('Error fetching products:', err);
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao carregar produtos.';
      setError(`Erro ao carregar produtos: ${message}`);
      addNotification(`Erro ao carregar produtos: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);

  useEffect(() => {
    if (selectedHotel) {
      fetchProducts();
    }
  }, [selectedHotel, fetchProducts]);

  /**
   * --- NOVO: Função para favoritar ou desfavoritar um produto. ---
   * Atualiza o campo 'is_starred' no banco de dados para um produto específico.
   * @param event O evento de clique, para evitar propagação.
   * @param productId O ID do produto a ser atualizado.
   * @param isCurrentlyStarred O estado atual de favorito do produto.
   */
  const handleToggleStar = async (event: React.MouseEvent, productId: string, isCurrentlyStarred: boolean) => {
    // Impede que o clique na estrela também abra o modal de edição do produto.
    event.stopPropagation(); 

    try {
      // Atualiza o produto no Supabase, invertendo o valor de 'is_starred'.
      const { error } = await supabase
        .from('products')
        .update({ is_starred: !isCurrentlyStarred })
        .eq('id', productId);

      if (error) throw error;

      // Atualiza o estado localmente para uma resposta visual imediata na UI.
      setProducts(prevProducts =>
        prevProducts.map(p =>
          p.id === productId ? { ...p, is_starred: !isCurrentlyStarred } : p
        )
      );
      addNotification('success', `Produto ${!isCurrentlyStarred ? 'adicionado aos' : 'removido dos'} principais.`);
    } catch (err: any) {
      addNotification('error', 'Erro ao atualizar favorito: ' + err.message);
    }
  };

  // Funções de manipulação existentes (handleImageError, handleEdit, etc.)
  // são mantidas aqui sem alterações.
  const handleImageError = (productId: string) => {
    setImageErrors(prev => ({ ...prev, [productId]: true }));
  };
  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setShowForm(true);
  };
  const handleCreateNew = () => {
    setEditingProduct(null);
    setShowForm(true);
  };
  const triggerDelete = (product: Product) => {
    setProductToDelete(product);
    setForceDelete(false);
    setShowDeleteModal(true);
  };
  const handleConfirmDelete = async () => {
    if (!productToDelete) return;
    try {
      const { data, error: rpcError } = await supabase
        .rpc('safe_delete_product', {
          p_product_id: productToDelete.id,
          p_force_delete: forceDelete
        });
      if (rpcError) throw rpcError;
      if (data && data.success) {
        addNotification(data.message || 'Ação concluída com sucesso!', 'success');
        fetchProducts();
      } else {
        const message = data?.message || 'Não foi possível concluir a ação.';
        setError(message);
        addNotification(message, 'error');
      }
    } catch (err: any) {
      setError(`Erro ao excluir produto: ${err.message}`);
      addNotification(`Erro ao excluir produto: ${err.message}`, 'error');
    } finally {
      setShowDeleteModal(false);
      setProductToDelete(null);
    }
  };
  const handleStockAdjustment = async (productId: string, productName: string, adjustment: number) => {
    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel não selecionado');
      }
      const { error: movementError } = await supabase
        .from('inventory_movements')
        .insert([{
          product_id: productId,
          quantity_change: adjustment,
          movement_type: adjustment > 0 ? 'entrada' : 'ajuste',
          reason: 'Ajuste manual',
          hotel_id: selectedHotel.id
        }]);
      if (movementError) throw movementError;
      addNotification(`Estoque de "${productName}" ajustado com sucesso.`, 'success');
      fetchProducts();
    } catch (err) {
      console.error('Error adjusting stock:', err);
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao ajustar estoque.';
      setError(`Erro ao ajustar estoque: ${message}`);
      addNotification(`Erro ao ajustar estoque para "${productName}": ${message}`, 'error');
    }
  };
  const toggleActiveStatus = async (productId: string, productName: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    const actionText = newStatus ? 'ativar' : 'inativar';
    try {
      const { error: updateError } = await supabase
        .from('products')
        .update({ is_active: newStatus })
        .eq('id', productId);
      if (updateError) throw updateError;
      addNotification(`Produto "${productName}" ${newStatus ? 'ativado' : 'inativado'} com sucesso.`, 'success');
      setProducts(prevProducts =>
        prevProducts.map(p =>
          p.id === productId ? { ...p, is_active: newStatus } : p
        )
      );
    } catch (err) {
      console.error(`Error toggling product status for ${productName}:`, err);
      const message = err instanceof Error ? err.message : `Erro desconhecido ao ${actionText} produto.`;
      setError(`Erro ao ${actionText} produto: ${message}`);
      addNotification(`Erro ao ${actionText} o produto "${productName}": ${message}`, 'error');
    }
  };
  const exportInventory = () => {
    const dataToExport = filteredProducts.map(product => ({
      'Nome': product.name, 'Categoria': product.category, 'Quantidade Atual': product.quantity,
      'Quantidade Mínima': product.min_quantity, 'Quantidade Máxima': product.max_quantity,
      'Fornecedor': product.supplier || '', 'Descrição': product.description || '',
      'URL da Imagem': product.image_url || '',
      'Última Atualização': product.updated_at ? new Date(product.updated_at).toLocaleString('pt-BR') : '-',
      'Última Compra': product.last_purchase_date ? new Date(product.last_purchase_date).toLocaleDateString('pt-BR') : '-',
      'Último Preço': product.last_purchase_price != null ? `R$ ${product.last_purchase_price.toFixed(2).replace('.', ',')}` : '-',
      'Preço Médio': product.average_price != null ? `R$ ${product.average_price.toFixed(2).replace('.', ',')}` : '-',
      'Status': product.is_active ? 'Ativo' : 'Inativo'
    }));
    if (dataToExport.length === 0) {
      addNotification('Nenhum produto para exportar com os filtros atuais.', 'warning');
      return;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    ws['!cols'] = [ { wch: 35 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 40 }, { wch: 50 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Inventário');
    try {
      XLSX.writeFile(wb, `inventario_${selectedHotel?.code || 'geral'}_${new Date().toISOString().split('T')[0]}.xlsx`);
      addNotification('Inventário exportado com sucesso!', 'success');
    } catch (exportError) {
      console.error('Error exporting inventory:', exportError);
      addNotification('Erro ao exportar inventário.', 'error');
    }
  };
  const handleSaveSnapshot = async () => {
    if (!selectedHotel?.id) { addNotification("Hotel não selecionado.", "error"); return; }
    if (!confirm("Tem certeza que deseja salvar o estado atual do inventário? Isso registrará as quantidades atuais de todos os produtos.")) { return; }
    setIsSavingSnapshot(true);
    setError('');
    try {
      const { data: snapshotData, error: snapshotError } = await supabase.from('inventory_snapshots').insert({ hotel_id: selectedHotel.id }).select('id').single();
      if (snapshotError) throw snapshotError;
      if (!snapshotData?.id) throw new Error("Falha ao obter ID do snapshot criado.");
      const snapshotId = snapshotData.id;
      const snapshotItems = products.map(product => ({ snapshot_id: snapshotId, product_id: product.id, quantity: product.quantity }));
      if (snapshotItems.length === 0) { addNotification("Nenhum produto no inventário para salvar no snapshot.", "warning"); setIsSavingSnapshot(false); return; }
      const { error: itemsError } = await supabase.from('inventory_snapshot_items').insert(snapshotItems);
      if (itemsError) throw itemsError;
      addNotification("Snapshot do inventário salvo com sucesso!", "success");
    } catch (err) {
      console.error('Error saving inventory snapshot:', err);
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao salvar snapshot.';
      setError(`Erro ao salvar snapshot: ${message}`);
      addNotification(`Erro ao salvar snapshot: ${message}`, 'error');
    } finally {
      setIsSavingSnapshot(false);
    }
  };
  const handleGenerateWeeklyReport = async () => {
    if (!selectedHotel?.id) { addNotification("Hotel não selecionado.", "error"); return; }
    setIsGeneratingReport(true);
    setError("");
    setWeeklyReportData(null);
    setShowWeeklyReport(false);
    try {
      const { data: snapshots, error: snapshotsError } = await supabase.from("inventory_snapshots").select("id, snapshot_date").eq("hotel_id", selectedHotel.id).order("snapshot_date", { ascending: false }).limit(2);
      if (snapshotsError) throw snapshotsError;
      if (!snapshots || snapshots.length < 2) { addNotification("São necessários pelo menos dois snapshots salvos para gerar o relatório.", "warning"); setIsGeneratingReport(false); return; }
      const currentSnapshot = snapshots[0];
      const previousSnapshot = snapshots[1];
      const startDate = previousSnapshot.snapshot_date;
      const endDate = currentSnapshot.snapshot_date;
      const { data: allProductsData, error: productsError } = await supabase.from("products").select("id, name").eq("hotel_id", selectedHotel.id);
      if (productsError) throw productsError;
      const productMap = new Map(allProductsData?.map(p => [p.id, p.name]) || []);
      const { data: prevItems, error: prevItemsError } = await supabase.from("inventory_snapshot_items").select("product_id, quantity").eq("snapshot_id", previousSnapshot.id);
      if (prevItemsError) throw prevItemsError;
      const initialStock = new Map(prevItems?.map(item => [item.product_id, item.quantity]) || []);
      const { data: currentItems, error: currentItemsError } = await supabase.from("inventory_snapshot_items").select("product_id, quantity").eq("snapshot_id", currentSnapshot.id);
      if (currentItemsError) throw currentItemsError;
      const finalStock = new Map(currentItems?.map(item => [item.product_id, item.quantity]) || []);
      const { data: entriesData, error: entriesError } = await supabase.from("inventory_movements").select("product_id, quantity_change").eq("hotel_id", selectedHotel.id).eq("movement_type", "ajuste").gt("quantity_change", 0).gte("movement_date", startDate).lt("movement_date", endDate);
      if (entriesError) throw entriesError;
      const entriesMap = new Map<string, number>();
      entriesData?.forEach(entry => { entriesMap.set(entry.product_id, (entriesMap.get(entry.product_id) || 0) + entry.quantity_change); });
      const { data: deliveriesData, error: deliveriesError } = await supabase.from("requisitions").select("product_id, delivered_quantity, sector_id, substituted_product_id, sectors(name)").eq("hotel_id", selectedHotel.id).eq("status", "delivered").gte("updated_at", startDate).lt("updated_at", endDate);
      if (deliveriesError) throw deliveriesError;
      const deliveriesBySector: Record<string, Record<string, number>> = {};
      const totalDeliveredMap = new Map<string, number>();
      deliveriesData?.forEach(delivery => {
        const deliveredProductId = delivery.substituted_product_id || delivery.product_id;
        const sectorName = delivery.sectors?.name || "Setor Desconhecido";
        const productName = productMap.get(deliveredProductId) || "Produto Desconhecido";
        const quantity = delivery.delivered_quantity || 0;
        if (!deliveriesBySector[sectorName]) { deliveriesBySector[sectorName] = {}; }
        deliveriesBySector[sectorName][productName] = (deliveriesBySector[sectorName][productName] || 0) + quantity;
        totalDeliveredMap.set(deliveredProductId, (totalDeliveredMap.get(deliveredProductId) || 0) + quantity);
      });
      const allProductIds = new Set([...initialStock.keys(), ...finalStock.keys(), ...entriesMap.keys(), ...totalDeliveredMap.keys()]);
      const consolidatedReport = Array.from(allProductIds).map(productId => {
        const productName = productMap.get(productId) || "Produto Desconhecido";
        const initial = initialStock.get(productId) || 0;
        const entries = entriesMap.get(productId) || 0;
        const delivered = totalDeliveredMap.get(productId) || 0;
        const final = finalStock.get(productId) || 0;
        return { productId, productName, initial, entries, delivered, final };
      }).sort((a, b) => a.productName.localeCompare(b.productName));
      const reportData = { startDate, endDate, consolidated: consolidatedReport, deliveriesBySector };
      setWeeklyReportData(reportData);
      setShowWeeklyReport(true);
    } catch (err) {
      console.error("Error generating weekly report:", err);
      const message = err instanceof Error ? err.message : "Erro desconhecido ao gerar relatório.";
      setError(`Erro ao gerar relatório: ${message}`);
      addNotification(`Erro ao gerar relatório: ${message}`, "error");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Lógica de filtragem (permanece igual)
  const filteredProducts = products.filter(product => {
    const matchesSearch = searchMatch(searchTerm, product.name) || 
                         searchMatch(searchTerm, product.description || '') ||
                         searchMatch(searchTerm, product.category || '') ||
                         searchMatch(searchTerm, product.supplier || '');
    const matchesCategory = !selectedCategory || product.category === selectedCategory;
    const matchesActiveStatus = showInactive || product.is_active;
    return matchesSearch && matchesCategory && matchesActiveStatus;
  });

  /**
   * --- NOVO: Memoiza a lista de produtos favoritados para otimizar a performance. ---
   * Esta lista é recalculada apenas quando a lista principal de produtos muda.
   */
  const starredProducts = useMemo(() => {
    return products.filter(p => p.is_starred);
  }, [products]);

  // Renderização de estados de carregamento e erro (permanece igual)
  if (loading && products.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-10rem)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  if (!selectedHotel) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-10rem)]">
        <div className="text-center p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <Package className="h-12 w-12 text-blue-500 mx-auto mb-4" /> 
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
            Nenhum hotel selecionado
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Por favor, selecione um hotel para visualizar o inventário.
          </p>
          <button
            onClick={() => navigate('/select-hotel')}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Selecionar Hotel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-4">
      {/* Cabeçalho da Página */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 space-y-4 md:space-y-0">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white flex items-center">
          <Package className="h-8 w-8 text-blue-600 dark:text-blue-400 mr-3 flex-shrink-0" />
          Inventário - {selectedHotel.name}
        </h1>
        <div className="flex items-center flex-wrap gap-2 justify-start md:justify-end">
          {/* --- NOVO: Botão "Principais Itens" --- */}
          {/* Este botão abre o novo modal que exibe os itens favoritados. */}
          <button
            onClick={() => setShowStarredModal(true)}
            className="flex items-center px-3 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm"
          >
            <Star className="w-4 h-4 mr-1.5" />
            Principais Itens
          </button>
          
          {/* Botões existentes (Lista de Compras, Novo Produto, etc.) permanecem aqui */}
          {lowStockItems.length > 0 && (
            <Link to="/shopping-list" className="flex items-center px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm">
              <ShoppingCart className="w-4 h-4 mr-1.5" />
              Lista de Compras
              <span className="ml-2 bg-purple-800 px-1.5 py-0.5 rounded-full text-xs">{lowStockItems.length}</span>
            </Link>
          )}
          <button onClick={() => setShowFilters(!showFilters)} className="flex items-center px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm">
            <Filter className="w-4 h-4 mr-1.5" />Filtros
            {showFilters ? <ChevronUp className="w-4 h-4 ml-1.5" /> : <ChevronDown className="w-4 h-4 ml-1.5" />}
          </button>
          <button onClick={() => setShowConferenceModal(true)} className="flex items-center px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors text-sm">
            <ListChecks className="w-4 h-4 mr-1.5" />Conferência
          </button>
          <button onClick={exportInventory} className="flex items-center px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm">
            <Download className="w-4 h-4 mr-1.5" />Exportar
          </button>
          <Link to="/inventory/new-purchase" className="flex items-center px-3 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 transition-colors text-sm">
            <DollarSign className="w-4 h-4 mr-1.5" />Nova Entrada
          </Link>
          <button onClick={() => setShowSyncModal(true)} className="flex items-center px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors text-sm">
            <RefreshCw className="w-4 h-4 mr-1.5" />Sincronizar
          </button>
          <button onClick={() => setShowTransferModal(true)} className="flex items-center px-3 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 transition-colors text-sm">
            <ArrowLeftRight className="w-4 h-4 mr-1.5" />Transferir
          </button>
          <button onClick={handleCreateNew} className="flex items-center px-4 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 dark:focus:ring-offset-gray-800 transition-all duration-150 ease-in-out text-sm">
            <Plus className="w-4 h-4 mr-2" />Novo Item
          </button>
          <button onClick={handleSaveSnapshot} disabled={isSavingSnapshot} className={`flex items-center px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm ${isSavingSnapshot ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {isSavingSnapshot ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1.5"></div>Salvando...</> : <><Camera className="w-4 h-4 mr-1.5" />Salvar Snapshot</>}
          </button>
          <button onClick={handleGenerateWeeklyReport} disabled={isGeneratingReport} className={`flex items-center px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm ml-2 ${isGeneratingReport ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {isGeneratingReport ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1.5"></div>Gerando...</> : <><BarChart2 className="w-4 h-4 mr-1.5" />Gerar Relatório</>}
          </button>
        </div>
      </div>

      {/* Barra de Filtros e Controles (permanece igual) */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="search-term" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Buscar</label>
              <div className="relative"><input id="search-term" type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Nome, descrição, categoria..." className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 pl-10 pr-4 py-2 text-sm" /><Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" /></div>
            </div>
            <div>
              <label htmlFor="category-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria</label>
              <select id="category-filter" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 py-2 text-sm"><option value="">Todas as Categorias</option>{categories.map((category) => (<option key={category} value={category}>{category}</option>))}</select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <button onClick={() => setShowInactive(!showInactive)} className={`w-full flex items-center justify-center px-4 py-2 rounded-md transition-colors text-sm ${showInactive ? 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200' : 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200'}`}>{showInactive ? <><EyeOff className="h-4 w-4 mr-1.5" />Mostrar Inativos</> : <><Eye className="h-4 w-4 mr-1.5" />Apenas Ativos</>}</button>
            </div>
          </div>
        </div>
      )}

      {/* Tabela de Produtos */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          {loading && products.length > 0 && (
            <div className="absolute inset-0 bg-white/50 dark:bg-gray-800/50 flex items-center justify-center z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                {/* --- NOVO: Adicionado um cabeçalho vazio para a coluna da estrela --- */}
                <th scope="col" className="w-12"></th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/3">Item</th>
                <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Qtd.</th>
                <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Mín.</th>
                <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Máx.</th>
                <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Categoria</th>
                <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    Nenhum produto encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${!product.is_active ? 'opacity-60' : ''}`}>
                    {/* --- NOVO: Célula com o botão de estrela --- */}
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={(e) => handleToggleStar(e, product.id, !!product.is_starred)}
                        className="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        title={product.is_starred ? "Remover dos principais" : "Adicionar aos principais"}
                      >
                        <Star className={`w-5 h-5 ${product.is_starred ? 'text-yellow-400 fill-current' : 'text-gray-400 hover:text-yellow-400'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap" onClick={() => handleEdit(product)} style={{ cursor: 'pointer' }}>
                      <div className="flex items-center">
                        <div className="h-10 w-10 flex-shrink-0 bg-gray-100 dark:bg-gray-700 rounded-md flex items-center justify-center overflow-hidden">
                          {product.image_url && !imageErrors[product.id] ? <img src={product.image_url} alt={product.name} className="h-full w-full object-contain" onError={() => handleImageError(product.id)} loading="lazy" /> : <Package className="h-5 w-5 text-gray-400" />}
                        </div>
                        <div className="ml-3"><div className="text-sm font-medium text-gray-900 dark:text-gray-200 truncate" title={product.name}>{product.name}</div>{product.description && (<div className="text-xs text-gray-500 dark:text-gray-400 truncate" title={product.description}>{product.description}</div>)}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-center"><span className={`font-medium ${product.quantity <= product.min_quantity && product.is_active ? 'text-red-600 dark:text-red-400 font-bold' : 'text-gray-900 dark:text-gray-200'}`}>{product.quantity}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">{product.min_quantity}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">{product.max_quantity}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{product.category}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-center">
                      <button onClick={() => toggleActiveStatus(product.id, product.name, product.is_active)} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${product.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-900/70' : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-900/70'}`} title={product.is_active ? 'Clique para inativar' : 'Clique para ativar'}>{product.is_active ? <><Eye className="h-3 w-3 mr-1" />Ativo</> : <><EyeOff className="h-3 w-3 mr-1" />Inativo</>}</button>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-center text-sm font-medium">
                      <div className="flex items-center justify-center space-x-1">
                        <button onClick={() => handleStockAdjustment(product.id, product.name, 1)} className="p-1 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors" title="Aumentar estoque (+1)"><ArrowUp className="h-4 w-4" /></button>
                        <button onClick={() => handleStockAdjustment(product.id, product.name, -1)} className="p-1 text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-300 rounded-md hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors" title="Diminuir estoque (-1)"><ArrowUpRight className="h-4 w-4 rotate-90" /></button>
                        <button onClick={() => handleEdit(product)} className="p-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors" title="Editar Produto"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => triggerDelete(product)} className="p-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors" title="Excluir Produto"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- NOVO: Renderização do Modal de Itens Favoritados --- */}
      {/* O modal é renderizado aqui e sua visibilidade é controlada pelo estado 'showStarredModal'. */}
      <StarredItemsModal
        isOpen={showStarredModal}
        onClose={() => setShowStarredModal(false)}
        starredProducts={starredProducts}
      />

      <StockConferenceModal
        isOpen={showConferenceModal}
        onClose={() => setShowConferenceModal(false)}
        products={products}
        hotelId={selectedHotel?.id || ''}
        onFinished={fetchProducts}
      />

      {/* Todos os seus modais existentes são mantidos aqui */}
      {showForm && ( <NewProductModal isOpen={showForm} onClose={() => setShowForm(false)} onSave={() => { fetchProducts(); }} editingProduct={editingProduct} categories={categories} /> )}
      {showDeleteModal && productToDelete && ( <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Confirmar Exclusão">
          <div className="text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
            <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-gray-100">Excluir "{productToDelete.name}"?</h3>
            <div className="mt-4 px-7 py-3"><p className="text-sm text-gray-600 dark:text-gray-300">Esta ação não pode ser desfeita.</p>
              {user?.role === 'admin' && (
                <div className="mt-4 text-left p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-md">
                  <label htmlFor="forceDelete" className="flex items-center">
                    <input id="forceDelete" name="forceDelete" type="checkbox" checked={forceDelete} onChange={(e) => setForceDelete(e.target.checked)} className="h-4 w-4 rounded text-red-600 border-gray-300 dark:bg-gray-600 dark:border-gray-500 focus:ring-red-500" />
                    <span className="ml-2 text-sm font-medium text-yellow-800 dark:text-yellow-200">Forçar exclusão (remove o item e todo o seu histórico).</span>
                  </label>
                </div>
              )}
            </div>
            <div className="items-center px-4 py-3 space-x-2">
              <button onClick={() => setShowDeleteModal(false)} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 text-base font-medium rounded-md w-auto hover:bg-gray-300 dark:hover:bg-gray-500">Cancelar</button>
              <button onClick={handleConfirmDelete} className="px-4 py-2 bg-red-600 text-white text-base font-medium rounded-md w-auto hover:bg-red-700">Confirmar Exclusão</button>
            </div>
          </div>
        </Modal>
      )}
      {showSyncModal && ( <SyncProductsModal onClose={() => setShowSyncModal(false)} onSuccess={() => { setShowSyncModal(false); fetchProducts(); addNotification('Sincronização iniciada. Os produtos serão atualizados em breve.', 'info'); }} /> )}
      {showTransferModal && ( <NewHotelTransferModal isOpen={showTransferModal} onClose={() => setShowTransferModal(false)} onSuccess={() => { setShowTransferModal(false); fetchProducts(); }} products={products.filter(p => p.is_active)} /> )}
      {showWeeklyReport && weeklyReportData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-semibold text-gray-800">Relatório Consolidado Semanal</h2><button onClick={() => setShowWeeklyReport(false)} className="text-gray-500 hover:text-gray-700"><X size={24} /></button></div>
            <p className="mb-4 text-sm text-gray-600">Período: {new Date(weeklyReportData.startDate).toLocaleDateString("pt-BR")} a {new Date(weeklyReportData.endDate).toLocaleDateString("pt-BR")}</p>
            <h3 className="text-lg font-medium text-gray-700 mb-2">Resumo por Produto</h3>
            <div className="overflow-x-auto mb-6">
              <table className="min-w-full divide-y divide-gray-200"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produto</th><th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Inicial</th><th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Entradas</th><th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Entregas</th><th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Final</th></tr></thead>
                <tbody className="bg-white divide-y divide-gray-200">{weeklyReportData.consolidated.map((item: any) => (<tr key={item.productId}><td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">{item.productName}</td><td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 text-right">{item.initial}</td><td className="px-4 py-2 whitespace-nowrap text-sm text-green-600 text-right">{item.entries > 0 ? `+${item.entries}` : 0}</td><td className="px-4 py-2 whitespace-nowrap text-sm text-red-600 text-right">{item.delivered > 0 ? `-${item.delivered}` : 0}</td><td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 text-right">{item.final}</td></tr>))}{weeklyReportData.consolidated.length === 0 && (<tr><td colSpan={5} className="px-4 py-4 text-center text-sm text-gray-500">Nenhum dado encontrado para o período.</td></tr>)}</tbody>
              </table>
            </div>
            <h3 className="text-lg font-medium text-gray-700 mb-2">Entregas por Setor</h3>
            {Object.keys(weeklyReportData.deliveriesBySector).length > 0 ? (Object.entries(weeklyReportData.deliveriesBySector).map(([sector, products]: [string, any]) => (<div key={sector} className="mb-4"><h4 className="text-md font-medium text-gray-600 mb-1">{sector}</h4><ul className="list-disc list-inside pl-4 text-sm text-gray-600">{Object.entries(products).map(([productName, quantity]: [string, any]) => (<li key={productName}>{productName}: {quantity}</li>))}</ul></div>))) : (<p className="text-sm text-gray-500">Nenhuma entrega registrada no período.</p>)}
            <div className="mt-6 flex justify-end"><button onClick={() => setShowWeeklyReport(false)} className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors text-sm">Fechar</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
