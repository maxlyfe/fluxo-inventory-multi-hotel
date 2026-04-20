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

  useEffect(() => { if (selectedHotel) fetchProducts(); }, [selectedHotel, fetchProducts]);

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
    <div className="max-w-full mx-auto px-4 py-6 space-y-5">

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Package className="w-5 h-5 text-white" />
            </div>
            Inventário
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 ml-[46px]">{selectedHotel.name}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowStarredModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors text-sm font-medium">
            <Star className="w-3.5 h-3.5 fill-current" /> Principais
            {starredProducts.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-400 dark:bg-amber-600 text-white text-[10px] font-bold">{starredProducts.length}</span>
            )}
          </button>
          <button onClick={() => setShowConferenceModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors text-sm font-medium">
            <ListChecks className="w-3.5 h-3.5" /> Conferência
          </button>
          <button onClick={() => setShowCountHistoryModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm font-medium">
            <History className="w-3.5 h-3.5" /> Histórico
          </button>

          <div className="flex items-center gap-1 pl-1 border-l border-slate-200 dark:border-slate-700">
            <button onClick={exportInventory} title="Exportar Excel"
              className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              <Download className="w-4 h-4" />
            </button>
            <Link to="/inventory/new-purchase" title="Nova Entrada"
              className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              <DollarSign className="w-4 h-4" />
            </Link>
            <button onClick={() => setShowSyncModal(true)} title="Sincronizar"
              className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setShowTransferModal(true)} title="Transferência entre hotéis"
              className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              <ArrowLeftRight className="w-4 h-4" />
            </button>
          </div>

          <button onClick={handleCreateNew}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:scale-95 transition-all text-sm shadow-sm shadow-blue-600/20">
            <Plus className="w-4 h-4" /> Novo Item
          </button>
        </div>
      </div>

      {/* ── STATS ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total de itens"  value={products.length}       icon={<Package className="w-5 h-5" />}      accent="blue" />
        <StatCard label="Estoque baixo"   value={lowStockItems.length}  icon={<TrendingDown className="w-5 h-5" />} accent={lowStockItems.length > 0 ? 'amber' : 'emerald'} />
        <StatCard label="Itens ativos"    value={activeProducts.length} icon={<CheckCircle className="w-5 h-5" />}  accent="emerald" />
        <StatCard
          label="Valor inventário"
          value={totalInventoryValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          sub="pelo preço médio"
          icon={<DollarSign className="w-5 h-5" />}
          accent="slate"
        />
      </div>

      {/* ── SEARCH + FILTERS ───────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text" value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setBarcodeFilterProductId(null); }}
              onKeyDown={e => { if (e.key === 'Enter' && searchTerm.trim().length >= 4) { e.preventDefault(); searchByBarcode(searchTerm); } }}
              placeholder="Buscar por nome, categoria, fornecedor ou código de barras…"
              className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
            />
            {searchTerm && (
              <button onClick={() => { setSearchTerm(''); setBarcodeFilterProductId(null); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button onClick={() => setShowBarcodeScanner(true)} title="Câmera barcode"
            className="flex items-center gap-1.5 px-3 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shrink-0">
            <Barcode className="w-4 h-4" />
            <span className="hidden sm:inline">Escanear</span>
          </button>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors shrink-0
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

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Categoria</label>
              <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors">
                <option value="">Todas as categorias</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tipo</label>
              <select value={selectedProductType} onChange={e => setSelectedProductType(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors">
                <option value="">Todos os tipos</option>
                <option value="controle">Controle</option>
                <option value="consumo">Consumo</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Status</label>
              <button onClick={() => setShowInactive(!showInactive)}
                className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-sm font-medium transition-colors
                  ${showInactive
                    ? 'border-slate-300 dark:border-slate-500 bg-slate-100 dark:bg-slate-600 text-slate-700 dark:text-slate-200'
                    : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'}`}>
                {showInactive ? <><EyeOff className="w-3.5 h-3.5" /> Mostrar inativos</> : <><Eye className="w-3.5 h-3.5" /> Apenas ativos</>}
              </button>
            </div>
          </div>
        )}

        {/* Chips de filtros ativos */}
        {(barcodeFilterProductId || selectedCategory || selectedProductType) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {barcodeFilterProductId && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                <Barcode className="w-3 h-3" /> Código: {barcodeFilterCode}
                <button onClick={() => { setBarcodeFilterProductId(null); setBarcodeFilterCode(''); }}><X className="w-2.5 h-2.5 ml-0.5" /></button>
              </span>
            )}
            {selectedCategory && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                {selectedCategory}
                <button onClick={() => setSelectedCategory('')}><X className="w-2.5 h-2.5" /></button>
              </span>
            )}
            {selectedProductType && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                {selectedProductType === 'controle' ? 'Controle' : 'Consumo'}
                <button onClick={() => setSelectedProductType('')}><X className="w-2.5 h-2.5" /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── RESULTS SUMMARY ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredProducts.length}</span> produto{filteredProducts.length !== 1 ? 's' : ''}
          {(searchTerm || selectedCategory || selectedProductType || barcodeFilterProductId) && ' encontrado(s)'}
        </p>
        {loading && products.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <RefreshCw className="w-3 h-3 animate-spin" /> Atualizando…
          </div>
        )}
      </div>

      {/* ── TABLE ──────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
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
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
                      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                        <Package className="w-7 h-7" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Nenhum produto encontrado</p>
                        <p className="text-xs mt-0.5">Tente ajustar os filtros ou a busca</p>
                      </div>
                      <button onClick={handleCreateNew}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 transition-colors mt-1">
                        <Plus className="w-4 h-4" /> Adicionar primeiro item
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map(product => {
                  const isLowStock = product.is_active && product.quantity <= product.min_quantity;
                  return (
                    <tr key={product.id}
                      className={`group transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40
                        ${!product.is_active ? 'opacity-50' : ''}
                        ${isLowStock ? 'bg-amber-50/40 dark:bg-amber-900/5 hover:bg-amber-50 dark:hover:bg-amber-900/10' : ''}`}>

                      {/* Star */}
                      <td className="pl-3 py-3 text-center">
                        <button onClick={e => handleToggleStar(e, product.id, !!product.is_starred)}
                          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                          title={product.is_starred ? 'Remover dos principais' : 'Adicionar aos principais'}>
                          <Star className={`w-4 h-4 transition-colors ${product.is_starred ? 'text-amber-400 fill-current' : 'text-slate-300 dark:text-slate-600 group-hover:text-amber-300'}`} />
                        </button>
                      </td>

                      {/* Item */}
                      <td className="px-4 py-3 cursor-pointer" onClick={() => handleEdit(product)}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600 group-hover:border-blue-200 dark:group-hover:border-blue-800 transition-colors">
                            {product.image_url && !imageErrors[product.id]
                              ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" onError={() => handleImageError(product.id)} loading="lazy" />
                              : <Package className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[180px]" title={product.name}>{product.name}</p>
                            {product.description
                              ? <p className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[180px]">{product.description}</p>
                              : product.supplier && <p className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[180px]">{product.supplier}</p>
                            }
                          </div>
                        </div>
                      </td>

                      {/* Estoque */}
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <StockBar qty={product.quantity} min={product.min_quantity} max={product.max_quantity} />
                          {isLowStock && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="w-2.5 h-2.5" /> Estoque baixo
                            </span>
                          )}
                          {product.unit_measure && product.unit_measure !== 'und' && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">{UNIT_MEASURE_LABELS[product.unit_measure] || product.unit_measure}</span>
                          )}
                        </div>
                      </td>

                      {/* Min / Max */}
                      <td className="px-3 py-3 text-center">
                        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{product.min_quantity}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{product.max_quantity}</span>
                      </td>

                      {/* Categoria */}
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300 font-medium truncate max-w-[110px]">{product.category}</span>
                          {product.product_type === 'controle' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 self-start">CTRL</span>
                          )}
                        </div>
                      </td>

                      {/* Preço médio (hidden em telas pequenas) */}
                      <td className="px-3 py-3 hidden lg:table-cell">
                        {product.average_price != null ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                              {product.average_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </span>
                            {product.last_purchase_date && (
                              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                {new Date(product.last_purchase_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-3 text-center">
                        <button onClick={() => toggleActiveStatus(product.id, product.name, product.is_active)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors
                            ${product.is_active
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/60'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                          title={product.is_active ? 'Clique para inativar' : 'Clique para ativar'}>
                          {product.is_active ? <><Eye className="w-3 h-3" /> Ativo</> : <><EyeOff className="w-3 h-3" /> Inativo</>}
                        </button>
                      </td>

                      {/* Ações */}
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-0.5">
                          <button onClick={() => handleStockAdjustment(product.id, product.name, 1)}
                            className="p-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors" title="+1 estoque">
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleStockAdjustment(product.id, product.name, -1)}
                            className="p-1.5 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors" title="-1 estoque">
                            <ArrowUpRight className="w-3.5 h-3.5 rotate-90" />
                          </button>
                          <button onClick={() => { setLinkProduct(product); setShowLinkModal(true); }}
                            className="p-1.5 rounded-lg text-indigo-500 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors" title="Vincular produto">
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleEdit(product)}
                            className="p-1.5 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors" title="Editar">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => triggerDelete(product)}
                            className="p-1.5 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors" title="Excluir">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer da tabela com totais */}
        {filteredProducts.length > 0 && (
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/80 flex items-center justify-between">
            <span className="text-xs text-slate-400">{filteredProducts.length} item{filteredProducts.length !== 1 ? 's' : ''}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Valor filtrado: <span className="font-semibold text-slate-700 dark:text-slate-200">
                {filteredProducts.reduce((s, p) => s + ((p.average_price || 0) * p.quantity), 0)
                  .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </span>
          </div>
        )}
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
    </div>
  );
};

export default Inventory;
