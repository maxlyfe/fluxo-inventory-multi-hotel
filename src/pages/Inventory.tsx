import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Plus, AlertTriangle, Edit2, Trash2, X, Download, Filter,
  ShoppingCart, Package, ArrowUp, ArrowUpRight,
  Search, DollarSign, RefreshCw, ArrowLeftRight,
  Eye, EyeOff, Star, ListChecks, History, Barcode,
  TrendingDown, CheckCircle, Link2, ChevronUp, ChevronDown,
  MoreHorizontal, ArrowUpDown,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import ImportInventory from '../components/ImportInventory';
import { useHotel } from '../context/HotelContext';
import SyncProductsModal from '../components/SyncProductsModal';
import ProductLinkModal from '../components/ProductLinkModal';
import NewHotelTransferModal from '../components/NewHotelTransferModal';
import { searchMatch } from '../utils/search';
import { useNotification } from '../context/NotificationContext';
import NewProductModal from '../components/NewProductModal';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import StarredItemsModal from '../components/StarredItemsModal';
import StockConferenceModal from '../components/StockConferenceModal';
import StockCountHistoryModal from '../components/StockCountHistoryModal';
import BarcodeScanner from '../components/BarcodeScanner';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { UNIT_MEASURE_LABELS } from '../types/product';
import DirectDeliveryModal from '../components/DirectDeliveryModal';
import { notifyItemDelivered } from '../lib/notificationTriggers';

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
  is_starred?: boolean;
  unit_measure?: string;
  product_type?: string;
  is_portionable?: boolean;
  auto_portion_product_id?: string | null;
  auto_portion_multiplier?: number | null;
}

type SortKey = 'name' | 'quantity' | 'category' | 'average_price';
type SortDir = 'asc' | 'desc';

// ── Barra de estoque ──────────────────────────────────────────────────────────
const StockBar: React.FC<{ qty: number; min: number; max: number }> = ({ qty, min, max }) => {
  const pct    = max > 0 ? Math.min(100, (qty / max) * 100) : 0;
  const isLow  = qty <= min;
  const isGood = pct >= 60;
  const color  = qty === 0 ? 'bg-red-500' : isLow ? 'bg-amber-500' : isGood ? 'bg-emerald-500' : 'bg-blue-500';
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums w-8 text-right ${
        qty === 0   ? 'text-red-500 dark:text-red-400'
        : isLow     ? 'text-amber-600 dark:text-amber-400'
        :             'text-slate-700 dark:text-slate-200'
      }`}>{qty}</span>
    </div>
  );
};

// ── Stat card ─────────────────────────────────────────────────────────────────
const StatCard: React.FC<{
  label: string; value: string | number; sub?: string; icon: React.ReactNode;
  accent?: 'blue' | 'amber' | 'emerald' | 'slate';
  onClick?: () => void;
}> = ({ label, value, sub, icon, accent = 'blue', onClick }) => {
  const accents = {
    blue:    'bg-blue-50   dark:bg-blue-900/20   text-blue-600   dark:text-blue-400',
    amber:   'bg-amber-50  dark:bg-amber-900/20  text-amber-600  dark:text-amber-400',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
    slate:   'bg-slate-100 dark:bg-slate-800     text-slate-600  dark:text-slate-400',
  };
  return (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3 ${onClick ? 'cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all' : ''}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accents[accent]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">{label}</p>
        <p className="text-lg font-bold text-slate-800 dark:text-white tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">{sub}</p>}
      </div>
    </div>
  );
};

// ── Sort button para header de coluna ────────────────────────────────────────
const SortBtn: React.FC<{
  col: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void; children: React.ReactNode;
}> = ({ col, current, dir, onClick, children }) => (
  <button type="button" onClick={() => onClick(col)}
    className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-600 dark:hover:text-slate-300 transition-colors group">
    {children}
    {current === col
      ? dir === 'asc'
        ? <ChevronUp className="w-3 h-3 text-blue-500" />
        : <ChevronDown className="w-3 h-3 text-blue-500" />
      : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    }
  </button>
);

// ── Componente principal ──────────────────────────────────────────────────────
const Inventory = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const { user } = useAuth();

  // ─ States ──────────────────────────────────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal]           = useState(false);
  const [productToDelete, setProductToDelete]           = useState<Product | null>(null);
  const [forceDelete, setForceDelete]                   = useState(false);
  const [products, setProducts]                         = useState<Product[]>([]);
  const [loading, setLoading]                           = useState(true);
  const [error, setError]                               = useState('');
  const [showForm, setShowForm]                         = useState(false);
  const [showImportForm, setShowImportForm]             = useState(false);
  const [editingProduct, setEditingProduct]             = useState<Product | null>(null);
  const [searchTerm, setSearchTerm]                     = useState('');
  const [selectedCategory, setSelectedCategory]         = useState('');
  const [selectedProductType, setSelectedProductType]   = useState('');
  const [showFilters, setShowFilters]                   = useState(false);
  const [categories, setCategories]                     = useState<string[]>([]);
  const [showSyncModal, setShowSyncModal]               = useState(false);
  const [showLinkModal, setShowLinkModal]               = useState(false);
  const [linkProduct, setLinkProduct]                   = useState<Product | null>(null);
  const [showTransferModal, setShowTransferModal]       = useState(false);
  const [showInactive, setShowInactive]                 = useState(false);
  const [imageErrors, setImageErrors]                   = useState<Record<string, boolean>>({});
  const [isSavingSnapshot, setIsSavingSnapshot]         = useState(false);
  const [isGeneratingReport, setIsGeneratingReport]     = useState(false);
  const [weeklyReportData, setWeeklyReportData]         = useState<any>(null);
  const [showWeeklyReport, setShowWeeklyReport]         = useState(false);
  const [showStarredModal, setShowStarredModal]         = useState(false);
  const [showConferenceModal, setShowConferenceModal]   = useState(false);
  const [showCountHistoryModal, setShowCountHistoryModal] = useState(false);
  const [barcodeFilterProductId, setBarcodeFilterProductId] = useState<string | null>(null);
  const [barcodeFilterCode, setBarcodeFilterCode]       = useState('');
  const [showBarcodeScanner, setShowBarcodeScanner]     = useState(false);
  const [openActionsId, setOpenActionsId]               = useState<string | null>(null);
  const [showDirectDeliveryModal, setShowDirectDeliveryModal] = useState(false);
  const [allSectors, setAllSectors]                     = useState<{id: string, name: string}[]>([]);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  // ─ Barcode ─────────────────────────────────────────────────────────────────
  const searchByBarcode = useCallback(async (barcode: string) => {
    const { data } = await supabase
      .from('product_barcodes').select('product_id')
      .eq('barcode', barcode.trim()).maybeSingle();
    if (data) {
      setBarcodeFilterProductId(data.product_id);
      setBarcodeFilterCode(barcode.trim());
      setSearchTerm('');
      addNotification('success', `Produto encontrado para código ${barcode}`);
    } else {
      addNotification('error', `Nenhum produto encontrado para código ${barcode}`);
    }
  }, [addNotification]);

  useBarcodeScanner({ onScan: searchByBarcode, enabled: !showConferenceModal && !showForm && !showBarcodeScanner });

  // ─ Data ────────────────────────────────────────────────────────────────────
  const fetchProducts = useCallback(async () => {
    try {
      if (!selectedHotel?.id) throw new Error('Hotel não selecionado');
      setLoading(true); setError(''); setImageErrors({});
      const { data, error: fetchError } = await supabase
        .from('products').select('*, is_starred').eq('hotel_id', selectedHotel.id).order('name');
      if (fetchError) throw fetchError;
      setProducts(data || []);
      setCategories([...new Set(data?.map(p => p.category) || [])].sort());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(`Erro ao carregar produtos: ${msg}`);
      addNotification('error', `Erro ao carregar produtos: ${msg}`);
    } finally { setLoading(false); }
  }, [selectedHotel, addNotification]);

  const fetchSectors = useCallback(async () => {
    try {
      if (!selectedHotel?.id) { setAllSectors([]); return; }
      const { data, error } = await supabase.from('sectors').select('id, name').eq('hotel_id', selectedHotel.id).order('name');
      if (error) throw error;
      setAllSectors(data || []);
    } catch (err: any) {
      console.error('Error fetching sectors:', err);
    }
  }, [selectedHotel]);

  useEffect(() => {
    if (selectedHotel) { fetchProducts(); fetchSectors(); }
  }, [selectedHotel, fetchProducts, fetchSectors]);

  // ─ Handlers ────────────────────────────────────────────────────────────────
  const handleToggleStar = async (e: React.MouseEvent, productId: string, isCurrentlyStarred: boolean) => {
    e.stopPropagation();
    try {
      const { error } = await supabase.from('products').update({ is_starred: !isCurrentlyStarred }).eq('id', productId);
      if (error) throw error;
      setProducts(prev => prev.map(p => p.id === productId ? { ...p, is_starred: !isCurrentlyStarred } : p));
    } catch (err: any) {
      addNotification('error', 'Erro ao atualizar favorito: ' + err.message);
    }
  };

  const handleImageError = (id: string) => setImageErrors(prev => ({ ...prev, [id]: true }));
  const handleEdit       = (p: Product) => { setEditingProduct(p); setShowForm(true); };
  const handleCreateNew  = ()            => { setEditingProduct(null); setShowForm(true); };
  const triggerDelete    = (p: Product)  => { setProductToDelete(p); setForceDelete(false); setShowDeleteModal(true); };

  const handleConfirmDelete = async () => {
    if (!productToDelete) return;
    try {
      const { data, error: rpcError } = await supabase.rpc('safe_delete_product', {
        p_product_id: productToDelete.id, p_force_delete: forceDelete,
      });
      if (rpcError) throw rpcError;
      if (data?.success) { addNotification('success', data.message || 'Ação concluída com sucesso!'); fetchProducts(); }
      else addNotification('error', data?.message || 'Não foi possível concluir a ação.');
    } catch (err: any) {
      addNotification('error', `Erro ao excluir produto: ${err.message}`);
    } finally { setShowDeleteModal(false); setProductToDelete(null); }
  };

  const handleStockAdjustment = async (productId: string, productName: string, adjustment: number) => {
    try {
      if (!selectedHotel?.id) throw new Error('Hotel não selecionado');
      const { error: movErr } = await supabase.from('inventory_movements').insert([{
        product_id: productId, quantity_change: adjustment,
        movement_type: adjustment > 0 ? 'entrada' : 'ajuste',
        reason: 'Ajuste manual', hotel_id: selectedHotel.id,
      }]);
      if (movErr) throw movErr;
      addNotification('success', `Estoque de "${productName}" ajustado.`);
      fetchProducts();
    } catch (err) {
      addNotification('error', `Erro ao ajustar estoque para "${productName}": ${err instanceof Error ? err.message : ''}`);
    }
  };

  const handleConfirmDirectDelivery = async (productId: string, sectorId: string, quantity: number, reason: string) => {
    if (!selectedHotel?.id) return;
    setShowDirectDeliveryModal(false);
    try {
      const product = products.find(p => p.id === productId);
      const sector  = allSectors.find(s => s.id === sectorId);
      if (!product || !sector) throw new Error('Produto ou setor não encontrado.');
      if (quantity > product.quantity) throw new Error(`Quantidade insuficiente. Disponível: ${product.quantity}`);

      // 1. Cria requisição com status 'delivered' para histórico
      const { data: newRequisition, error: reqErr } = await supabase
        .from('requisitions')
        .insert({
          hotel_id: selectedHotel.id,
          sector_id: sectorId,
          product_id: productId,
          item_name: product.name,
          quantity,
          status: 'delivered' as const,
          delivered_quantity: quantity,
          is_custom: false,
          rejection_reason: `Entrega direta: ${reason || 'N/A'}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (reqErr) throw reqErr;

      // 2. Deduz do estoque principal
      const newStock = product.quantity - quantity;
      await supabase.from('products').update({ quantity: newStock, updated_at: new Date().toISOString() }).eq('id', productId);

      // 3. Porcionável → auto ou manual; senão → sector_stock direto
      if (product.is_portionable) {
        const purchaseCost = (product.last_purchase_price || product.average_price || 0) * quantity;
        if (product.auto_portion_product_id && product.auto_portion_multiplier) {
          const { data: autoResult, error: autoErr } = await supabase.rpc('process_auto_portioning', {
            p_hotel_id: selectedHotel.id,
            p_sector_id: sectorId,
            p_parent_product_id: productId,
            p_quantity_delivered: quantity,
            p_purchase_cost: purchaseCost,
          });
          if (autoErr) throw new Error(`Falha no auto-porcionamento: ${autoErr.message}`);
          const res = autoResult as { success: boolean; message: string };
          if (!res.success) throw new Error(res.message);
          addNotification('success', `Auto-porcionamento: ${res.message}`);
        } else {
          const { error: pendingErr } = await supabase.from('pending_portioning_entries').insert({
            hotel_id: selectedHotel.id, sector_id: sectorId, product_id: productId,
            quantity_delivered: quantity, purchase_cost: purchaseCost, requisition_id: newRequisition.id,
          });
          if (pendingErr) throw new Error(`Falha ao criar entrada pendente: ${pendingErr.message}`);
          addNotification('info', 'Item porcionável enviado ao setor para processamento.');
        }
      } else {
        const { error: sectorErr } = await supabase.rpc('record_sector_stock_entry', {
          p_hotel_id: selectedHotel.id, p_sector_id: sectorId, p_product_id: productId, p_quantity: quantity,
        });
        if (sectorErr) {
          console.error('CRÍTICO: falha ao atualizar estoque do setor na entrega direta:', sectorErr);
          addNotification('error', 'Entrega registrada, mas FALHA ao somar no estoque do setor. Ajuste manualmente.');
        }
      }

      // 4. Movimento de inventário
      const unitCost = product.average_price || product.last_purchase_price || 0;
      await supabase.from('inventory_movements').insert({
        product_id: productId, hotel_id: selectedHotel.id,
        quantity_change: -quantity, movement_type: 'consumption',
        reason: `Entrega direta p/ ${sector.name}: ${reason || 'N/A'}`,
        performed_by: 'Inventário - Entrega Direta',
        unit_cost: unitCost, total_cost: unitCost * quantity, reference_id: newRequisition.id,
      });

      // 5. Balanço financeiro
      const totalValue = unitCost * quantity;
      if (totalValue > 0) {
        await supabase.rpc('update_hotel_balance', {
          p_hotel_id: selectedHotel.id, p_transaction_type: 'debit', p_amount: totalValue,
          p_reason: `Consumo de ${quantity} un. de ${product.name} por setor`,
          p_reference_type: 'consumption', p_reference_id: productId,
        });
      }

      // 6. Notifica o setor
      await notifyItemDelivered({
        hotel_id: selectedHotel.id, sector_id: sectorId, product_name: product.name,
        quantity, sector_name: sector.name, delivered_by: 'Inventário (Entrega Direta)',
      });

      addNotification('success', `"${product.name}" entregue diretamente para ${sector.name}!`);
      fetchProducts();
    } catch (err: any) {
      console.error('Erro na entrega direta:', err);
      addNotification('error', `Erro na entrega direta: ${err.message}`);
      fetchProducts();
    }
  };

  const toggleActiveStatus = async (productId: string, productName: string, currentStatus: boolean) => {
    try {
      const { error: upErr } = await supabase.from('products').update({ is_active: !currentStatus }).eq('id', productId);
      if (upErr) throw upErr;
      addNotification('success', `Produto "${productName}" ${!currentStatus ? 'ativado' : 'inativado'}.`);
      setProducts(prev => prev.map(p => p.id === productId ? { ...p, is_active: !currentStatus } : p));
    } catch (err) {
      addNotification('error', `Erro ao alterar status: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const exportInventory = () => {
    const data = filteredProducts.map(p => ({
      'Nome': p.name, 'Categoria': p.category,
      'Quantidade Atual': p.quantity, 'Quantidade Mínima': p.min_quantity, 'Quantidade Máxima': p.max_quantity,
      'Fornecedor': p.supplier || '', 'Descrição': p.description || '',
      'Última Compra': p.last_purchase_date ? new Date(p.last_purchase_date).toLocaleDateString('pt-BR') : '-',
      'Último Preço': p.last_purchase_price != null ? `R$ ${p.last_purchase_price.toFixed(2)}` : '-',
      'Preço Médio': p.average_price != null ? `R$ ${p.average_price.toFixed(2)}` : '-',
      'Status': p.is_active ? 'Ativo' : 'Inativo',
    }));
    if (data.length === 0) { addNotification('warning', 'Nenhum produto para exportar.'); return; }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Inventário');
    try { XLSX.writeFile(wb, `inventario_${selectedHotel?.code || 'geral'}_${new Date().toISOString().split('T')[0]}.xlsx`); addNotification('success', 'Inventário exportado!'); }
    catch { addNotification('error', 'Erro ao exportar inventário.'); }
  };

  const handleSaveSnapshot = async () => {
    if (!selectedHotel?.id) { addNotification('error', 'Hotel não selecionado.'); return; }
    if (!confirm('Tem certeza que deseja salvar o estado atual do inventário?')) return;
    setIsSavingSnapshot(true);
    try {
      const { data: snap, error: snapErr } = await supabase.from('inventory_snapshots').insert({ hotel_id: selectedHotel.id }).select('id').single();
      if (snapErr) throw snapErr;
      const items = products.map(p => ({ snapshot_id: snap.id, product_id: p.id, quantity: p.quantity }));
      if (!items.length) { addNotification('warning', 'Nenhum produto.'); return; }
      const { error: itemsErr } = await supabase.from('inventory_snapshot_items').insert(items);
      if (itemsErr) throw itemsErr;
      addNotification('success', 'Snapshot salvo!');
    } catch (err) {
      addNotification('error', `Erro ao salvar snapshot: ${err instanceof Error ? err.message : ''}`);
    } finally { setIsSavingSnapshot(false); }
  };

  const handleGenerateWeeklyReport = async () => {
    if (!selectedHotel?.id) { addNotification('error', 'Hotel não selecionado.'); return; }
    setIsGeneratingReport(true); setWeeklyReportData(null); setShowWeeklyReport(false);
    try {
      const { data: snapshots } = await supabase.from('inventory_snapshots').select('id, snapshot_date').eq('hotel_id', selectedHotel.id).order('snapshot_date', { ascending: false }).limit(2);
      if (!snapshots || snapshots.length < 2) { addNotification('warning', 'São necessários pelo menos dois snapshots.'); return; }
      const current  = snapshots[0];
      const previous = snapshots[1];
      const { data: allProds } = await supabase.from('products').select('id, name').eq('hotel_id', selectedHotel.id);
      const productMap = new Map(allProds?.map(p => [p.id, p.name]) || []);
      const { data: prevItems }    = await supabase.from('inventory_snapshot_items').select('product_id, quantity').eq('snapshot_id', previous.id);
      const { data: currentItems } = await supabase.from('inventory_snapshot_items').select('product_id, quantity').eq('snapshot_id', current.id);
      const initialStock = new Map(prevItems?.map(i => [i.product_id, i.quantity]) || []);
      const finalStock   = new Map(currentItems?.map(i => [i.product_id, i.quantity]) || []);
      const { data: entriesData } = await supabase.from('inventory_movements').select('product_id, quantity_change').eq('hotel_id', selectedHotel.id).eq('movement_type', 'ajuste').gt('quantity_change', 0).gte('movement_date', previous.snapshot_date).lt('movement_date', current.snapshot_date);
      const entriesMap = new Map<string, number>();
      entriesData?.forEach(e => entriesMap.set(e.product_id, (entriesMap.get(e.product_id) || 0) + e.quantity_change));
      const { data: delData } = await supabase.from('requisitions').select('product_id, delivered_quantity, sector_id, substituted_product_id, sectors(name)').eq('hotel_id', selectedHotel.id).eq('status', 'delivered').gte('updated_at', previous.snapshot_date).lt('updated_at', current.snapshot_date);
      const deliveriesBySector: Record<string, Record<string, number>> = {};
      const totalDeliveredMap = new Map<string, number>();
      delData?.forEach(d => {
        const pid    = d.substituted_product_id || d.product_id;
        const sector = d.sectors?.name || 'Setor Desconhecido';
        const pname  = productMap.get(pid) || 'Produto Desconhecido';
        if (!deliveriesBySector[sector]) deliveriesBySector[sector] = {};
        deliveriesBySector[sector][pname] = (deliveriesBySector[sector][pname] || 0) + (d.delivered_quantity || 0);
        totalDeliveredMap.set(pid, (totalDeliveredMap.get(pid) || 0) + (d.delivered_quantity || 0));
      });
      const allIds = new Set([...initialStock.keys(), ...finalStock.keys(), ...entriesMap.keys(), ...totalDeliveredMap.keys()]);
      const consolidated = Array.from(allIds).map(pid => ({
        productId: pid, productName: productMap.get(pid) || 'Desconhecido',
        initial: initialStock.get(pid) || 0, entries: entriesMap.get(pid) || 0,
        delivered: totalDeliveredMap.get(pid) || 0, final: finalStock.get(pid) || 0,
      })).sort((a, b) => a.productName.localeCompare(b.productName));
      setWeeklyReportData({ startDate: previous.snapshot_date, endDate: current.snapshot_date, consolidated, deliveriesBySector });
      setShowWeeklyReport(true);
    } catch (err) {
      addNotification('error', `Erro ao gerar relatório: ${err instanceof Error ? err.message : ''}`);
    } finally { setIsGeneratingReport(false); }
  };

  // ─ Barcode auto-search ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchTerm || searchTerm.trim().length < 4 || barcodeFilterProductId) return;
    const nameMatches = products.some(p =>
      searchMatch(searchTerm, p.name) || searchMatch(searchTerm, p.description || '') ||
      searchMatch(searchTerm, p.category || '') || searchMatch(searchTerm, p.supplier || '')
    );
    if (nameMatches) return;
    const timer = setTimeout(() => searchByBarcode(searchTerm), 600);
    return () => clearTimeout(timer);
  }, [searchTerm, products, barcodeFilterProductId, searchByBarcode]);

  // ─ Derived ────────────────────────────────────────────────────────────────
  const lowStockItems   = products.filter(p => p.is_active && p.quantity <= p.min_quantity);
  const activeProducts  = products.filter(p => p.is_active);
  const starredProducts = useMemo(() => products.filter(p => p.is_starred), [products]);

  const filteredProducts = useMemo(() => {
    let list = products.filter(product => {
      if (barcodeFilterProductId) return product.id === barcodeFilterProductId;
      const matchSearch = searchMatch(searchTerm, product.name) ||
        searchMatch(searchTerm, product.description || '') ||
        searchMatch(searchTerm, product.category || '') ||
        searchMatch(searchTerm, product.supplier || '');
      return matchSearch &&
        (!selectedCategory    || product.category     === selectedCategory) &&
        (!selectedProductType || product.product_type === selectedProductType) &&
        (showInactive || product.is_active);
    });

    list = [...list].sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === 'name')         { av = a.name.toLowerCase();      bv = b.name.toLowerCase(); }
      else if (sortKey === 'quantity'){ av = a.quantity;                 bv = b.quantity; }
      else if (sortKey === 'category'){ av = a.category.toLowerCase();   bv = b.category.toLowerCase(); }
      else                            { av = a.average_price ?? -1;      bv = b.average_price ?? -1; }
      return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
    });

    return list;
  }, [products, barcodeFilterProductId, searchTerm, selectedCategory, selectedProductType, showInactive, sortKey, sortDir]);

  // Valor total do inventário
  const totalInventoryValue = useMemo(() =>
    activeProducts.reduce((sum, p) => sum + ((p.average_price || 0) * p.quantity), 0),
  [activeProducts]);

  // ─ Loading / empty states ──────────────────────────────────────────────────
  if (loading && products.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[calc(100vh-10rem)] gap-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <Package className="w-6 h-6 text-blue-500 animate-pulse" />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando inventário…</p>
      </div>
    );
  }
  if (!selectedHotel) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-10rem)] p-6">
        <div className="text-center p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 max-w-sm w-full">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8 text-blue-500" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Nenhum hotel selecionado</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">Selecione um hotel para visualizar o inventário.</p>
          <button onClick={() => navigate('/select-hotel')}
            className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors text-sm">
            Selecionar Hotel
          </button>
        </div>
      </div>
    );
  }

  // ─ Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-full mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-5">

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col xs:flex-row xs:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2.5">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
                <Package className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              Inventário
            </h1>
            <p className="text-[10px] sm:text-sm text-slate-500 dark:text-slate-400 mt-1 ml-[42px] sm:ml-[46px] uppercase font-bold tracking-wider">{selectedHotel.name}</p>
          </div>

          <div className="flex items-center gap-2 self-end xs:self-center">
            <button onClick={() => setShowDirectDeliveryModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all text-xs sm:text-sm font-semibold shadow-sm shadow-indigo-600/20">
              <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Entrega Direta</span>
            </button>

            <button onClick={handleCreateNew}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:scale-95 transition-all text-xs sm:text-sm shadow-sm shadow-blue-600/20">
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> <span>Novo</span><span className="hidden sm:inline">Item</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1">
          <button onClick={() => setShowStarredModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shrink-0 text-[11px] sm:text-xs font-bold uppercase tracking-tight">
            <Star className="w-3 h-3 fill-current" /> Favoritos
            {starredProducts.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-400 dark:bg-amber-600 text-white text-[9px] font-black">{starredProducts.length}</span>
            )}
          </button>
          <button onClick={() => setShowConferenceModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shrink-0 text-[11px] sm:text-xs font-bold uppercase tracking-tight">
            <ListChecks className="w-3 h-3" /> Conferência
          </button>
          <button onClick={() => setShowCountHistoryModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 shrink-0 text-[11px] sm:text-xs font-bold uppercase tracking-tight">
            <History className="w-3 h-3" /> Histórico
          </button>

          <div className="h-6 w-px bg-slate-200 dark:border-slate-700 mx-1 shrink-0" />

          <button onClick={exportInventory} title="Exportar Excel"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0 transition-colors">
            <Download className="w-4 h-4" />
          </button>
          <Link to="/inventory/new-purchase" title="Nova Entrada"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0 transition-colors">
            <DollarSign className="w-4 h-4" />
          </Link>
          <button onClick={() => setShowSyncModal(true)} title="Sincronizar"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowTransferModal(true)} title="Transferência entre hotéis"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0 transition-colors">
            <ArrowLeftRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── STATS ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <StatCard label="Total de itens"  value={products.length}       icon={<Package className="w-4 h-4 sm:w-5 sm:h-5" />}      accent="blue" />
        <StatCard label="Estoque baixo"   value={lowStockItems.length}  icon={<TrendingDown className="w-4 h-4 sm:w-5 sm:h-5" />} accent={lowStockItems.length > 0 ? 'amber' : 'emerald'} />
        <StatCard label="Itens ativos"    value={activeProducts.length} icon={<CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />}  accent="emerald" />
        <div className="hidden sm:block">
          <StatCard
            label="Valor inventário"
            value={totalInventoryValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            sub="pelo preço médio"
            icon={<DollarSign className="w-5 h-5" />}
            accent="slate"
          />
        </div>
        <div className="sm:hidden flex items-center justify-center px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
           <p className="text-[10px] font-black text-slate-500 uppercase">R$ { (totalInventoryValue / 1000).toFixed(1) }k Total</p>
        </div>
      </div>

      {/* ── SEARCH + FILTERS ───────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 space-y-3">
        <div className="flex flex-col xs:flex-row items-stretch gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text" value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setBarcodeFilterProductId(null); }}
              onKeyDown={e => { if (e.key === 'Enter' && searchTerm.trim().length >= 4) { e.preventDefault(); searchByBarcode(searchTerm); } }}
              placeholder="Buscar..."
              className="w-full pl-9 pr-9 py-2 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
            />
            {searchTerm && (
              <button onClick={() => { setSearchTerm(''); setBarcodeFilterProductId(null); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowBarcodeScanner(true)} title="Câmera barcode"
              className="flex-1 xs:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors shrink-0">
              <Barcode className="w-4 h-4" />
              <span>Escanear</span>
            </button>
            <button onClick={() => setShowFilters(!showFilters)}
              className={`flex-1 xs:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-colors shrink-0
                ${showFilters
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                  : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
              <Filter className="w-4 h-4" />
              {showFilters ? 'Fechar' : 'Filtros'}
              {(selectedCategory || selectedProductType || showInactive) && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ml-0.5" />
              )}
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Categoria</label>
              <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-xs py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors">
                <option value="">Todas as categorias</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Tipo</label>
              <select value={selectedProductType} onChange={e => setSelectedProductType(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-xs py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors">
                <option value="">Todos os tipos</option>
                <option value="controle">Controle</option>
                <option value="consumo">Consumo</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Status</label>
              <button onClick={() => setShowInactive(!showInactive)}
                className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-bold transition-all active:scale-95
                  ${showInactive
                    ? 'border-slate-300 dark:border-slate-500 bg-slate-100 dark:bg-slate-600 text-slate-700 dark:text-slate-200'
                    : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'}`}>
                {showInactive ? <><EyeOff className="w-3.5 h-3.5" /> Ocultar Inativos</> : <><Eye className="w-3.5 h-3.5" /> Mostrar Inativos</>}
              </button>
            </div>
          </div>
        )}

        {/* Chips de filtros ativos */}
        {(barcodeFilterProductId || selectedCategory || selectedProductType) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {barcodeFilterProductId && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                <Barcode className="w-3 h-3" /> {barcodeFilterCode}
                <button onClick={() => { setBarcodeFilterProductId(null); setBarcodeFilterCode(''); }} className="hover:text-red-500 transition-colors"><X className="w-2.5 h-2.5 ml-0.5" /></button>
              </span>
            )}
            {selectedCategory && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 uppercase">
                {selectedCategory}
                <button onClick={() => setSelectedCategory('')} className="hover:text-red-500 transition-colors"><X className="w-2.5 h-2.5 ml-0.5" /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── LIST ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Mostrando <span className="font-bold text-slate-700 dark:text-slate-200">{filteredProducts.length}</span> produtos
        </p>
        <div className="flex items-center gap-3">
           <button onClick={() => toggleSort('name')} className="text-[10px] font-black text-blue-500 uppercase tracking-tighter sm:hidden">
             Ordenar {sortDir === 'asc' ? 'A-Z' : 'Z-A'}
           </button>
           {loading && (
             <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold uppercase">
               <RefreshCw className="w-3 h-3 animate-spin" /> Atualizando
             </div>
           )}
        </div>
      </div>

      {/* ── DESKTOP TABLE ──────────────────────────────────────────────────── */}
      <div className="hidden md:block bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80">
                <th className="w-10 py-3" />
                <th className="px-4 py-3 text-left">
                  <SortBtn col="name" current={sortKey} dir={sortDir} onClick={toggleSort}>Item</SortBtn>
                </th>
                <th className="px-3 py-3 text-left min-w-[130px]">
                  <SortBtn col="quantity" current={sortKey} dir={sortDir} onClick={toggleSort}>Estoque</SortBtn>
                </th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Mín.</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Máx.</th>
                <th className="px-3 py-3 text-left">
                  <SortBtn col="category" current={sortKey} dir={sortDir} onClick={toggleSort}>Categoria</SortBtn>
                </th>
                <th className="px-3 py-3 text-left hidden lg:table-cell">
                  <SortBtn col="average_price" current={sortKey} dir={sortDir} onClick={toggleSort}>Preço Médio</SortBtn>
                </th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {filteredProducts.length === 0 ? (
                <EmptyState onAction={handleCreateNew} />
              ) : (
                filteredProducts.map(product => renderRow(product))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MOBILE CARD LIST ───────────────────────────────────────────────── */}
      <div className="md:hidden flex flex-col gap-3">
        {filteredProducts.length === 0 ? (
          <EmptyState onAction={handleCreateNew} />
        ) : (
          filteredProducts.map(product => (
            <div key={product.id} className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm relative overflow-hidden ${!product.is_active ? 'opacity-60' : ''}`}>
              {product.product_type === 'controle' && (
                <span className="absolute top-0 right-0 px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[8px] font-black uppercase rounded-bl-lg">CTRL</span>
              )}
              
              <div className="flex gap-3 mb-4">
                <div className="w-16 h-16 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
                  {product.image_url && !imageErrors[product.id]
                    ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" onError={() => handleImageError(product.id)} />
                    : <Package className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white line-clamp-2 leading-tight">{product.name}</h3>
                    <button onClick={e => handleToggleStar(e, product.id, !!product.is_starred)} className="shrink-0 p-1">
                      <Star className={`w-4 h-4 ${product.is_starred ? 'text-amber-400 fill-current' : 'text-slate-300'}`} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[9px] font-bold rounded uppercase tracking-wider">{product.category}</span>
                    <button onClick={() => toggleActiveStatus(product.id, product.name, product.is_active)} className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase transition-colors ${product.is_active ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                      {product.is_active ? 'Ativo' : 'Inativo'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estoque Atual</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-400 font-bold uppercase">{product.unit_measure || 'unid'}</span>
                    <span className={`text-lg font-black tabular-nums ${product.quantity <= product.min_quantity ? 'text-amber-500' : 'text-blue-500'}`}>
                      {product.quantity}
                    </span>
                  </div>
                </div>
                <StockBar qty={product.quantity} min={product.min_quantity} max={product.max_quantity} />
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                  <span>Mín: {product.min_quantity}</span>
                  <span>Máx: {product.max_quantity}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <button onClick={() => handleStockAdjustment(product.id, product.name, 1)} className="flex items-center justify-center gap-1.5 py-2.5 bg-emerald-500 text-white rounded-xl active:scale-95 transition-all text-xs font-black shadow-sm shadow-emerald-500/20">
                    <ArrowUp className="w-3.5 h-3.5" /> +1
                  </button>
                  <button onClick={() => handleStockAdjustment(product.id, product.name, -1)} className="flex items-center justify-center gap-1.5 py-2.5 bg-amber-500 text-white rounded-xl active:scale-95 transition-all text-xs font-black shadow-sm shadow-amber-500/20">
                    <ArrowUpRight className="w-3.5 h-3.5 rotate-90" /> -1
                  </button>
                </div>
                <button onClick={() => setOpenActionsId(openActionsId === product.id ? null : product.id)} className="p-2.5 bg-slate-100 dark:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-300 active:scale-90 transition-all border border-slate-200 dark:border-slate-600">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>

              {/* Menu de ações mobile expandido */}
              {openActionsId === product.id && (
                <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm z-10 flex flex-col p-4 animate-in fade-in zoom-in duration-200">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Ações Rápidas</h4>
                    <button onClick={() => setOpenActionsId(null)} className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-full"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 flex-1 overflow-y-auto">
                    <button onClick={() => { handleEdit(product); setOpenActionsId(null); }} className="flex flex-col items-center justify-center gap-2 p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-2xl border border-blue-100 dark:border-blue-800/50">
                      <Edit2 className="w-5 h-5" /> <span className="text-[10px] font-black uppercase">Editar</span>
                    </button>
                    <button onClick={() => { setLinkProduct(product); setShowLinkModal(true); setOpenActionsId(null); }} className="flex flex-col items-center justify-center gap-2 p-4 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-2xl border border-indigo-100 dark:border-indigo-800/50">
                      <Link2 className="w-5 h-5" /> <span className="text-[10px] font-black uppercase">Vincular</span>
                    </button>
                    <button onClick={() => { triggerDelete(product); setOpenActionsId(null); }} className="flex flex-col items-center justify-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-2xl border border-red-100 dark:border-red-800/50">
                      <Trash2 className="w-5 h-5" /> <span className="text-[10px] font-black uppercase">Excluir</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer com resumo de valor (Mobile) */}
      <div className="md:hidden sticky bottom-4 left-0 w-full px-1 z-20">
        <div className="bg-slate-900/90 dark:bg-slate-800/95 backdrop-blur shadow-xl rounded-2xl p-4 flex items-center justify-between border border-white/10">
          <div className="min-w-0">
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Total Filtrado</p>
             <p className="text-sm font-black text-white truncate">
                {filteredProducts.reduce((s, p) => s + ((p.average_price || 0) * p.quantity), 0)
                  .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
             </p>
          </div>
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="w-9 h-9 rounded-xl bg-white/10 text-white flex items-center justify-center border border-white/10">
             <ArrowUp className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── MODAIS ─────────────────────────────────────────────────────────── */}

      <StarredItemsModal isOpen={showStarredModal} onClose={() => setShowStarredModal(false)} starredProducts={starredProducts} />
      <StockConferenceModal isOpen={showConferenceModal} onClose={() => setShowConferenceModal(false)} products={products} hotelId={selectedHotel?.id || ''} onFinished={fetchProducts} />
      <StockCountHistoryModal isOpen={showCountHistoryModal} onClose={() => setShowCountHistoryModal(false)} hotelId={selectedHotel?.id || ''} onReopened={fetchProducts} />

      {showForm && (
        <NewProductModal isOpen={showForm} onClose={() => setShowForm(false)} onSave={() => fetchProducts()} editingProduct={editingProduct} categories={categories} />
      )}

      {/* Delete modal */}
      {showDeleteModal && productToDelete && (
        <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="">
          <div className="text-center px-2 py-2">
            <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Excluir produto?</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
              <span className="font-semibold text-slate-700 dark:text-slate-200">"{productToDelete.name}"</span>
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-5">Esta ação não pode ser desfeita.</p>

            {user?.role === 'admin' && (
              <div className="mb-5 text-left p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <label htmlFor="forceDelete" className="flex items-start gap-2.5 cursor-pointer">
                  <input id="forceDelete" type="checkbox" checked={forceDelete} onChange={e => setForceDelete(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded text-red-600 border-slate-300 dark:bg-slate-700 dark:border-slate-500 focus:ring-red-500" />
                  <span className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
                    Forçar exclusão — remove o item e <strong>todo</strong> o histórico associado (compras, movimentos, requisições).
                  </span>
                </label>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                Cancelar
              </button>
              <button onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors shadow-sm shadow-red-600/20">
                Confirmar exclusão
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showSyncModal && (
        <SyncProductsModal onClose={() => setShowSyncModal(false)} onSuccess={() => { setShowSyncModal(false); fetchProducts(); addNotification('success', 'Sincronização iniciada.'); }} />
      )}
      {showLinkModal && linkProduct && (
        <ProductLinkModal currentProduct={linkProduct} onClose={() => { setShowLinkModal(false); setLinkProduct(null); }} onLinked={() => fetchProducts()} />
      )}
      {showTransferModal && (
        <NewHotelTransferModal isOpen={showTransferModal} onClose={() => setShowTransferModal(false)} onSuccess={() => { setShowTransferModal(false); fetchProducts(); }} products={products.filter(p => p.is_active)} />
      )}

      {/* Relatório semanal */}
      {showWeeklyReport && weeklyReportData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <div>
                <h2 className="text-base font-bold text-slate-800 dark:text-white">Relatório Consolidado</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {new Date(weeklyReportData.startDate).toLocaleDateString('pt-BR')} → {new Date(weeklyReportData.endDate).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <button onClick={() => setShowWeeklyReport(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Resumo por produto</h3>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-700/60 border-b border-slate-200 dark:border-slate-700">
                        {['Produto','Inicial','Entradas','Saídas','Final'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {weeklyReportData.consolidated.length === 0
                        ? <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">Nenhum dado.</td></tr>
                        : weeklyReportData.consolidated.map((item: any) => (
                          <tr key={item.productId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                            <td className="px-4 py-2.5 text-sm text-slate-800 dark:text-slate-200 font-medium">{item.productName}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400 text-right tabular-nums">{item.initial}</td>
                            <td className="px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-400 text-right tabular-nums font-medium">{item.entries > 0 ? `+${item.entries}` : '—'}</td>
                            <td className="px-4 py-2.5 text-sm text-red-500 dark:text-red-400 text-right tabular-nums font-medium">{item.delivered > 0 ? `-${item.delivered}` : '—'}</td>
                            <td className="px-4 py-2.5 text-sm text-blue-600 dark:text-blue-400 text-right tabular-nums font-bold">{item.final}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {Object.keys(weeklyReportData.deliveriesBySector).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Entregas por setor</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {Object.entries(weeklyReportData.deliveriesBySector).map(([sector, prods]: [string, any]) => (
                      <div key={sector} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
                        <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">{sector}</p>
                        <ul className="space-y-1">
                          {Object.entries(prods).map(([pname, qty]: [string, any]) => (
                            <li key={pname} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-slate-600 dark:text-slate-400 truncate">{pname}</span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums shrink-0">{qty}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 shrink-0 flex justify-end">
              <button onClick={() => setShowWeeklyReport(false)}
                className="px-5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {showBarcodeScanner && (
        <BarcodeScanner
          onDetected={barcode => { setShowBarcodeScanner(false); searchByBarcode(barcode); }}
          onClose={() => setShowBarcodeScanner(false)}
          title="Escanear Código de Barras"
          hint="Aponte para o código de barras do produto"
        />
      )}

      <DirectDeliveryModal
        isOpen={showDirectDeliveryModal}
        onClose={() => setShowDirectDeliveryModal(false)}
        products={products.filter(p => p.is_active) as any}
        sectors={allSectors}
        onConfirm={handleConfirmDirectDelivery}
      />
    </div>
  );
};

export default Inventory;
