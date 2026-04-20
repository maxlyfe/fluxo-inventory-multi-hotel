// src/pages/pdv/PDV.tsx
// Mobile-first PDV: Setor → Mapa de Mesas → Produtos + carrinho bottom sheet
// Desktop: split-screen preservado com overlay de mesas

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Search, Trash2, Plus, Minus, Package,
  RefreshCw, AlertTriangle, CheckCircle, XCircle, ChevronRight,
  Users, AlertCircle, RotateCcw, History, X, Zap,
  UtensilsCrossed, Wine, Coffee, Star, ChevronDown,
  LayoutGrid, ArrowLeft, MapPin, Clock, Settings, GripVertical,
  PenLine, BookOpen, Save, Edit2, Check,
} from 'lucide-react';

import {
  getProductsForSector, getSectorDetails, getSectorsForPDV,
  getSectorTables, createSectorTable, deleteSectorTable, updateTablePosition, updateSectorTable,
  createSale, retryErbonPosting,
  saveOpenTab, getOpenTabsForSector, deleteOpenTab,
  PDVProduct, PDVSectorDetails, PdvTable, CartItem,
  SelectedBooking, SaleResult, OpenTab,
} from '../../lib/pdvService';
import { erbonService, ErbonGuest } from '../../lib/erbonService';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import Modal from '../../components/Modal';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

// ── Sector color palette ───────────────────────────────────────────────────

const PALETTE = ['#f59e0b','#3b82f6','#ef4444','#8b5cf6','#10b981','#f43f5e','#0ea5e9','#ec4899','#14b8a6','#f97316'];
const KW_COLORS: Record<string, string> = {
  bar:'#3b82f6', restaurante:'#ef4444', cozinha:'#f97316', exclusive:'#f43f5e',
  frigobar:'#8b5cf6', piscina:'#0ea5e9', eventos:'#ec4899', governanca:'#f59e0b',
  manutencao:'#64748b', recepcao:'#14b8a6', financeiro:'#10b981', café:'#ca8a04',
  cafe:'#ca8a04', lavanderia:'#7c3aed', jardim:'#22c55e', academia:'#84cc16',
};
function sectorColor(name: string, idx: number): string {
  const k = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  for (const [kw, c] of Object.entries(KW_COLORS)) if (k.includes(kw)) return c;
  return PALETTE[idx % PALETTE.length];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return d; }
}

// ── Skeleton ───────────────────────────────────────────────────────────────

const ProductSkeleton: React.FC = () => (
  <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden animate-pulse">
    <div className="h-28 bg-slate-200 dark:bg-slate-700" />
    <div className="p-3 space-y-2">
      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full w-3/4" />
      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full w-1/2" />
      <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-xl mt-3" />
    </div>
  </div>
);

// ── Stepper button (44×44px touch target) ─────────────────────────────────

const StepBtn: React.FC<{ onClick:()=>void; disabled?:boolean; children:React.ReactNode }> = ({ onClick, disabled, children }) => (
  <button onClick={onClick} disabled={disabled}
    className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-600 disabled:opacity-20 disabled:cursor-not-allowed transition-all duration-150 active:scale-95">
    {children}
  </button>
);

// ── Category icon ──────────────────────────────────────────────────────────

function categoryIcon(cat: string) {
  const lc = cat.toLowerCase();
  if (lc.includes('beb') || lc.includes('drin')) return Wine;
  if (lc.includes('café') || lc.includes('cafe') || lc.includes('hot')) return Coffee;
  if (lc.includes('com') || lc.includes('prat') || lc.includes('snack')) return UtensilsCrossed;
  return Star;
}

// ── Component ──────────────────────────────────────────────────────────────

const PDV: React.FC = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  // ── Core state ────────────────────────────────────────────────────────

  const [sectors, setSectors] = useState<PDVSectorDetails[]>([]);
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [sectorDetails, setSectorDetails] = useState<PDVSectorDetails | null>(null);
  const [products, setProducts] = useState<PDVProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [inHouseGuests, setInHouseGuests] = useState<ErbonGuest[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [bookingSearch, setBookingSearch] = useState('');
  const [showBookingDropdown, setShowBookingDropdown] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<SelectedBooking | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receiptSale, setReceiptSale] = useState<SaleResult | null>(null);
  const [erbonConfigured, setErbonConfigured] = useState(true);
  const [retrying, setRetrying] = useState(false);

  // ── Mobile / table state ──────────────────────────────────────────────

  // 'sector' = tela de seleção de setor | 'products' = grid de produtos
  const [mobileView, setMobileView] = useState<'sector' | 'products'>('sector');
  const [showTableMap, setShowTableMap] = useState(false);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);

  // Mesas do setor selecionado
  const [tables, setTables] = useState<PdvTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  // Carts por mesa (chave '__direct__' = sem mesa / direto para UH)
  const [tableCarts, setTableCarts] = useState<Record<string, CartItem[]>>({});
  const [activeTableId, setActiveTableId] = useState<string>('__direct__');
  const [activeTableLabel, setActiveTableLabel] = useState<string | null>(null);
  // Flag: setor acabou de ser trocado → abrir mapa de mesas se houver
  const [justChangedSector, setJustChangedSector] = useState(false);

  // ── Table layout editor state ─────────────────────────────────────────
  const [tableEditMode, setTableEditMode] = useState(false);
  const [holdProgress, setHoldProgress] = useState<{ tableId: string; pct: number } | null>(null);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showAddTable, setShowAddTable] = useState(false);
  const [newTableLabel, setNewTableLabel] = useState('');
  const [newTableCapacity, setNewTableCapacity] = useState(4);
  const [savingTable, setSavingTable] = useState(false);
  // Table inline edit
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editTableLabel, setEditTableLabel] = useState('');
  const [editTableCapacity, setEditTableCapacity] = useState(4);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // ── Comandas abertas ──────────────────────────────────────────────────
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [currentTabId, setCurrentTabId] = useState<string | null>(null);
  const [savingTab, setSavingTab] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);

  // ── Derived ───────────────────────────────────────────────────────────

  const bookingGroups = useMemo(() => {
    const map = new Map<number, SelectedBooking>();
    for (const g of inHouseGuests) {
      if (!map.has(g.idBooking)) {
        map.set(g.idBooking, {
          bookingInternalId: g.idBooking, bookingNumber: g.bookingNumber,
          roomDescription: g.roomDescription, guestName: g.guestName, checkOutDate: g.checkOutDate,
        });
      }
    }
    return Array.from(map.values());
  }, [inHouseGuests]);

  const filteredBookings = useMemo(() => {
    if (!bookingSearch.trim()) return bookingGroups;
    const q = bookingSearch.toLowerCase();
    return bookingGroups.filter(b =>
      b.roomDescription?.toLowerCase().includes(q) ||
      b.guestName?.toLowerCase().includes(q) ||
      String(b.bookingNumber).includes(q)
    );
  }, [bookingGroups, bookingSearch]);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category))].sort();
    return ['Todos', ...cats];
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (selectedCategory === 'Todos') return products;
    return products.filter(p => p.category === selectedCategory);
  }, [products, selectedCategory]);

  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.unit_price * i.quantity, 0), [cart]);
  const cartCount  = cart.reduce((s, i) => s + i.quantity, 0);
  const cartHasUnmappedItems = cart.some(i => i.erbon_service_id === null);
  const currentSector = sectors.find(s => s.sector_id === selectedSectorId) ?? null;

  // ── Effects ───────────────────────────────────────────────────────────

  // 1. Carregar setores + hóspedes
  useEffect(() => {
    if (!selectedHotel) return;
    getSectorsForPDV(selectedHotel.id)
      .then(s => setSectors(s))
      .catch(err => addNotification('error', `Erro ao carregar setores: ${err.message}`));

    setGuestsLoading(true);
    erbonService.fetchInHouseGuests(selectedHotel.id)
      .then(guests => setInHouseGuests(guests))
      .catch((err: any) => {
        const msg: string = err?.message || '';
        if (msg.toLowerCase().includes('not configured') || msg.toLowerCase().includes('não configurado') || msg.toLowerCase().includes('sem configuração')) {
          setErbonConfigured(false);
        } else {
          addNotification('error', `Erro ao buscar hóspedes: ${msg}`);
        }
      })
      .finally(() => setGuestsLoading(false));
  }, [selectedHotel]); // eslint-disable-line

  // 2. Restaurar setor salvo na sessão
  useEffect(() => {
    if (!selectedHotel || sectors.length === 0) return;
    const saved = sessionStorage.getItem(`pdv_sector_${selectedHotel.id}`);
    if (saved && sectors.find(s => s.sector_id === saved)) {
      setSelectedSectorId(saved);
      setMobileView('products');
    }
  }, [sectors]); // eslint-disable-line

  // 3. Salvar setor na sessão ao mudar
  useEffect(() => {
    if (selectedHotel && selectedSectorId) {
      sessionStorage.setItem(`pdv_sector_${selectedHotel.id}`, selectedSectorId);
    }
  }, [selectedSectorId, selectedHotel]);

  // 4. Carregar produtos + detalhes do setor
  useEffect(() => {
    if (!selectedHotel || !selectedSectorId) { setProducts([]); setSectorDetails(null); return; }
    setProductsLoading(true);
    setSelectedCategory('Todos');
    Promise.all([
      getProductsForSector(selectedHotel.id, selectedSectorId),
      getSectorDetails(selectedHotel.id, selectedSectorId),
    ])
      .then(([prods, details]) => { setProducts(prods); setSectorDetails(details); })
      .catch(err => addNotification('error', `Erro ao carregar produtos: ${err.message}`))
      .finally(() => setProductsLoading(false));
  }, [selectedSectorId, selectedHotel]); // eslint-disable-line

  // 5. Carregar mesas + comandas abertas do setor
  useEffect(() => {
    if (!selectedHotel || !selectedSectorId) { setTables([]); setOpenTabs([]); return; }
    setTablesLoading(true);
    Promise.all([
      getSectorTables(selectedHotel.id, selectedSectorId),
      getOpenTabsForSector(selectedHotel.id, selectedSectorId),
    ])
      .then(([t, tabs]) => { setTables(t); setOpenTabs(tabs); })
      .catch(() => { setTables([]); setOpenTabs([]); })
      .finally(() => setTablesLoading(false));
  }, [selectedSectorId, selectedHotel]);

  // 6. Após troca de setor: abrir mapa de mesas se houver, senão direto para produtos
  useEffect(() => {
    if (!justChangedSector || tablesLoading) return;
    setJustChangedSector(false);
    if (tables.length > 0) {
      setShowTableMap(true);
    }
    // Se não tem mesas, activeTableId já foi setado para '__direct__'
  }, [tables, tablesLoading, justChangedSector]);

  // 7. Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setShowBookingDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Cart operations ───────────────────────────────────────────────────

  function addToCart(product: PDVProduct) {
    setCart(prev => {
      const existing = prev.find(i => i.product_id === product.product_id);
      if (existing) {
        if (existing.quantity >= product.stock_quantity) return prev;
        return prev.map(i => i.product_id === product.product_id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        product_id: product.product_id, product_name: product.product_name,
        quantity: 1, unit_price: product.sale_price,
        stock_quantity: product.stock_quantity,
        erbon_service_id: product.erbon_service_id,
        erbon_service_description: product.erbon_service_description,
      }];
    });
  }

  function updateCartQty(productId: string, qty: number) {
    if (qty <= 0) { removeFromCart(productId); return; }
    setCart(prev => prev.map(i => i.product_id === productId ? { ...i, quantity: Math.min(qty, i.stock_quantity) } : i));
  }

  function updateCartPrice(productId: string, price: number) {
    setCart(prev => prev.map(i => i.product_id === productId ? { ...i, unit_price: Math.max(0, price) } : i));
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(i => i.product_id !== productId));
  }

  // ── Table operations ──────────────────────────────────────────────────

  function handleSectorSelect(sectorId: string) {
    // Salvar cart atual e resetar estado de mesa
    setTableCarts({});
    setCart([]);
    setSelectedBooking(null);
    setActiveTableId('__direct__');
    setActiveTableLabel(null);
    setSelectedSectorId(sectorId);
    setJustChangedSector(true);
    setMobileView('products');
  }

  function selectTable(tableId: string, label: string | null) {
    // Salvar cart da mesa atual (in-memory)
    setTableCarts(prev => ({ ...prev, [activeTableId]: cart }));

    // Verificar se há comanda aberta persistida para esta mesa
    const existingTab = tableId !== '__direct__'
      ? openTabs.find(t => t.table_id === tableId)
      : null;

    if (existingTab) {
      // Carregar itens da comanda persistida
      setCart(existingTab.items);
      setCurrentTabId(existingTab.id);
    } else {
      // Restaurar cart in-memory (se houver)
      setCart(tableCarts[tableId] || []);
      setCurrentTabId(null);
    }

    setActiveTableId(tableId);
    setActiveTableLabel(label);
    setShowTableMap(false);
    setCartSheetOpen(false);
  }

  function getTableCartTotal(tableId: string): number {
    return (tableCarts[tableId] || []).reduce((s, i) => s + i.unit_price * i.quantity, 0);
  }
  function getTableCartCount(tableId: string): number {
    return (tableCarts[tableId] || []).reduce((s, i) => s + i.quantity, 0);
  }

  // ── Sale flow ─────────────────────────────────────────────────────────

  function handleConfirm() {
    if (!selectedBooking) { addNotification('error', 'Selecione uma UH (reserva)'); return; }
    if (!selectedSectorId) { addNotification('error', 'Selecione um setor'); return; }
    if (cart.length === 0) { addNotification('error', 'Adicione itens ao carrinho'); return; }
    setCartSheetOpen(false);
    setConfirmOpen(true);
  }

  async function handleSubmitSale() {
    if (!selectedBooking || !selectedSectorId || !sectorDetails) return;
    setSubmitting(true);
    try {
      const result = await createSale({
        hotelId: selectedHotel!.id,
        sectorId: selectedSectorId,
        bookingInternalId: selectedBooking.bookingInternalId,
        bookingNumber: String(selectedBooking.bookingNumber),
        roomDescription: selectedBooking.roomDescription,
        guestName: selectedBooking.guestName,
        operatorName: user?.full_name || user?.email || 'Operador',
        items: cart,
        erbonDepartmentId: sectorDetails.erbon_department_id,
        erbonDepartmentLabel: sectorDetails.erbon_department,
        tableId: activeTableId !== '__direct__' ? activeTableId : null,
        tableLabel: activeTableLabel,
      });
      setConfirmOpen(false);
      setReceiptSale(result);
      // Limpar mesa do tableCarts após fechar
      if (activeTableId !== '__direct__') {
        setTableCarts(prev => { const n = { ...prev }; delete n[activeTableId]; return n; });
      }
      if (result.erbonPosted) {
        addNotification('success', `Venda lançada na UH ${selectedBooking.roomDescription}`);
      } else if (result.erbonErrors.length > 0) {
        addNotification('warning', `Venda salva, mas ${result.erbonErrors.length} item(s) não lançado(s) no PMS`);
      }
    } catch (err: any) {
      addNotification('error', `Erro: ${err.message}`);
    } finally { setSubmitting(false); }
  }

  async function handleRetryErbon() {
    if (!receiptSale || !selectedHotel) return;
    setRetrying(true);
    try {
      await retryErbonPosting(receiptSale.saleId, selectedHotel.id);
      addNotification('success', 'Reenvio ao PMS realizado com sucesso');
      setReceiptSale(prev => prev ? { ...prev, erbonPosted: true, erbonErrors: [] } : prev);
    } catch (err: any) {
      addNotification('error', `Erro no reenvio: ${err.message}`);
    } finally { setRetrying(false); }
  }

  function resetSale() {
    // Se havia comanda aberta, remover após fechar conta
    if (currentTabId) {
      deleteOpenTab(currentTabId).catch(() => {});
      setOpenTabs(prev => prev.filter(t => t.id !== currentTabId));
    }
    setCart([]);
    setSelectedBooking(null);
    setBookingSearch('');
    setReceiptSale(null);
    setActiveTableId('__direct__');
    setActiveTableLabel(null);
    setCurrentTabId(null);
  }

  function refreshGuests() {
    if (!selectedHotel) return;
    setGuestsLoading(true);
    erbonService.fetchInHouseGuests(selectedHotel.id)
      .then(g => setInHouseGuests(g))
      .catch(() => {})
      .finally(() => setGuestsLoading(false));
  }

  // ── Comanda aberta ────────────────────────────────────────────────────

  async function handleSaveComanda() {
    if (!selectedHotel || !selectedSectorId) return;
    if (cart.length === 0) { addNotification('error', 'Adicione itens ao carrinho'); return; }
    setSavingTab(true);
    try {
      const tab = await saveOpenTab({
        id: currentTabId ?? undefined,
        hotel_id: selectedHotel.id,
        sector_id: selectedSectorId,
        table_id: activeTableId !== '__direct__' ? activeTableId : null,
        table_label: activeTableLabel,
        items: cart,
        operator_name: user?.full_name || user?.email || 'Operador',
      });
      setCurrentTabId(tab.id);
      setOpenTabs(prev => {
        const exists = prev.find(t => t.id === tab.id);
        if (exists) return prev.map(t => t.id === tab.id ? tab : t);
        return [tab, ...prev];
      });
      addNotification('success', 'Comanda salva!');
      setCartSheetOpen(false);
    } catch (err: any) {
      addNotification('error', `Erro ao salvar comanda: ${err.message}`);
    } finally {
      setSavingTab(false);
    }
  }

  async function handleLoadStandaloneTab(tab: OpenTab) {
    // Salvar cart atual e carregar comanda avulsa
    setTableCarts(prev => ({ ...prev, [activeTableId]: cart }));
    setCart(tab.items);
    setCurrentTabId(tab.id);
    setActiveTableId('__direct__');
    setActiveTableLabel(null);
    setShowTableMap(false);
  }

  async function handleDeleteTab(tabId: string) {
    try {
      await deleteOpenTab(tabId);
      setOpenTabs(prev => prev.filter(t => t.id !== tabId));
      if (currentTabId === tabId) {
        setCurrentTabId(null);
        setCart([]);
      }
      addNotification('success', 'Comanda removida');
    } catch (err: any) {
      addNotification('error', `Erro: ${err.message}`);
    }
  }

  // ── Edição de mesa ────────────────────────────────────────────────────

  function startEditTable(table: PdvTable) {
    setEditingTableId(table.id);
    setEditTableLabel(table.label);
    setEditTableCapacity(table.capacity);
  }

  async function handleSaveTableEdit() {
    if (!editingTableId || !editTableLabel.trim()) return;
    setSavingTable(true);
    try {
      await updateSectorTable(editingTableId, editTableLabel.trim(), editTableCapacity);
      setTables(prev => prev.map(t =>
        t.id === editingTableId ? { ...t, label: editTableLabel.trim(), capacity: editTableCapacity } : t
      ));
      setEditingTableId(null);
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSavingTable(false); }
  }

  function stockStrip(qty: number): { bg: string; text: string; label: string; urgent: boolean } {
    if (qty <= 0) return { bg: 'bg-red-600',   text: 'text-white', label: 'ESGOTADO',          urgent: true  };
    if (qty === 1) return { bg: 'bg-red-500',   text: 'text-white', label: '⚠ última unidade!', urgent: true  };
    if (qty < 4)  return  { bg: 'bg-red-500/80',text: 'text-white', label: `⚠ ${qty} restantes`,urgent: true  };
    if (qty < 8)  return  { bg: 'bg-amber-500', text: 'text-white', label: `${qty} disponíveis`, urgent: false };
    return                 { bg: 'bg-emerald-600/80', text: 'text-white', label: `${qty} disponíveis`, urgent: false };
  }

  // ── Erbon not configured ──────────────────────────────────────────────

  if (!erbonConfigured) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden bg-slate-900">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-700">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <ShoppingCart className="w-4 h-4 text-amber-400" />
          </div>
          <h1 className="text-lg font-bold text-white">PDV — Ponto de Venda</h1>
        </div>
        <ErbonNotConfigured hotelName={selectedHotel?.name} />
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER HELPERS
  // ══════════════════════════════════════════════════════════════════════

  // ── Booking Selector (shared between desktop left panel & cart sheet) ─

  const renderBookingSelector = () => (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2.5">
        Unidade Habitacional
      </p>
      {selectedBooking ? (
        <div className="relative flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/30">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <span className="text-white font-black text-[10px] text-center leading-tight px-1">{selectedBooking.roomDescription}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm truncate">{selectedBooking.guestName}</p>
            <p className="text-xs text-slate-400 mt-0.5">Res. #{selectedBooking.bookingNumber}</p>
            <p className="text-xs text-slate-500">Out: {fmtDate(selectedBooking.checkOutDate)}</p>
          </div>
          <button onClick={() => { setSelectedBooking(null); setBookingSearch(''); }}
            aria-label="Remover seleção"
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div ref={searchRef} className="relative">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input type="text" value={bookingSearch}
              onChange={e => { setBookingSearch(e.target.value); setShowBookingDropdown(true); }}
              onFocus={() => setShowBookingDropdown(true)}
              placeholder="UH, hóspede ou nº reserva…"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all duration-150" />
          </div>
          {showBookingDropdown && (filteredBookings.length > 0 || (bookingSearch.trim() && filteredBookings.length === 0)) && (
            <div className="absolute z-30 top-full mt-1.5 left-0 right-0 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl shadow-black/40 max-h-56 overflow-y-auto">
              {filteredBookings.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500 text-center">Nenhuma reserva encontrada</div>
              ) : (
                filteredBookings.map(b => (
                  <button key={b.bookingInternalId}
                    onClick={() => { setSelectedBooking(b); setBookingSearch(''); setShowBookingDropdown(false); }}
                    className="w-full flex items-center gap-3 px-3 py-3 hover:bg-slate-700/60 transition-colors text-left border-b border-slate-700/50 last:border-0">
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                      <span className="text-white font-black text-[10px] text-center leading-tight px-0.5">{b.roomDescription}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">UH {b.roomDescription}</p>
                      <p className="text-xs text-slate-400 truncate">{b.guestName}</p>
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0 font-mono">{fmtDate(b.checkOutDate)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Cart items (shared) ───────────────────────────────────────────────

  const renderCartItems = () => (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">Carrinho</p>
        {cart.length > 0 && <span className="text-[10px] font-bold text-amber-400">{cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>}
      </div>
      {cart.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-28 gap-2">
          <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center">
            <ShoppingCart className="w-5 h-5 text-slate-600" />
          </div>
          <p className="text-xs text-slate-500">Adicione produtos ao carrinho</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cart.map(item => (
            <div key={item.product_id} className="rounded-xl bg-slate-800 border border-slate-700/60 p-3">
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <p className="text-sm font-semibold text-white leading-tight flex-1 min-w-0">{item.product_name}</p>
                <button onClick={() => removeFromCart(item.product_id)} aria-label="Remover"
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 rounded-lg bg-slate-700/50 border border-slate-600/50">
                  <StepBtn onClick={() => updateCartQty(item.product_id, item.quantity - 1)} disabled={item.quantity <= 1}>
                    <Minus className="w-3.5 h-3.5" />
                  </StepBtn>
                  <span className="text-sm font-bold text-white w-7 text-center tabular-nums">{item.quantity}</span>
                  <StepBtn onClick={() => updateCartQty(item.product_id, item.quantity + 1)} disabled={item.quantity >= item.stock_quantity}>
                    <Plus className="w-3.5 h-3.5" />
                  </StepBtn>
                </div>
                <div className="flex items-center gap-1 flex-1 rounded-lg bg-slate-700/50 border border-slate-600/50 px-2">
                  <span className="text-xs text-slate-500 font-medium">R$</span>
                  <input type="text" inputMode="decimal"
                    value={item.unit_price === 0 ? '' : item.unit_price.toFixed(2).replace('.', ',')}
                    onChange={e => {
                      const raw = e.target.value.replace(',', '.');
                      const parsed = parseFloat(raw);
                      if (!isNaN(parsed)) updateCartPrice(item.product_id, parsed);
                      else if (e.target.value === '' || e.target.value === '0') updateCartPrice(item.product_id, 0);
                    }}
                    placeholder="0,00"
                    className="w-full h-11 text-xs font-mono text-white bg-transparent border-none outline-none focus:ring-0 tabular-nums" />
                </div>
                <span className="text-sm font-bold text-amber-400 shrink-0 tabular-nums font-mono">{fmtBRL(item.unit_price * item.quantity)}</span>
              </div>
              {item.erbon_service_id === null && (
                <div className="flex items-center gap-1.5 mt-2 px-2 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                  <span className="text-[10px] text-amber-500">Sem mapeamento PMS</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── CTA footer ────────────────────────────────────────────────────────

  const renderCTAFooter = () => (
    <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-4 py-4">
      {sectorDetails?.erbon_department_id === null && cart.length > 0 && (
        <div className="flex items-start gap-2 mb-3 p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-400/80">Setor sem ID Erbon — consumos não serão lançados no PMS</p>
        </div>
      )}
      <div className="flex items-end justify-between mb-4">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Total</p>
          <p className="text-3xl font-black text-white tabular-nums font-mono leading-none mt-1">{fmtBRL(cartTotal)}</p>
        </div>
        {cart.length > 0 && (
          <div className="text-right">
            {currentTabId && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold mb-1">
                <BookOpen className="w-2.5 h-2.5" /> Comanda aberta
              </span>
            )}
            <p className="text-xs text-slate-500">{cart.length} produto{cart.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-slate-400">{cartCount} unidade{cartCount !== 1 ? 's' : ''}</p>
          </div>
        )}
      </div>
      {/* Dois botões: salvar comanda + lançar na UH */}
      <div className="flex gap-2">
        <button
          onClick={handleSaveComanda}
          disabled={cart.length === 0 || savingTab}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-3.5 rounded-2xl font-bold text-sm border-2 border-slate-600 text-slate-300 hover:border-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 active:scale-[0.98]">
          {savingTab
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <BookOpen className="w-4 h-4" />}
          {currentTabId ? 'Atualizar' : 'Salvar'}<br className="hidden" /> Comanda
        </button>
        <button
          onClick={handleConfirm}
          disabled={cart.length === 0 || !selectedBooking}
          className="flex-[2] flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl font-bold text-sm text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 shadow-lg shadow-amber-500/20 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none transition-all duration-200 active:scale-[0.98]">
          {!selectedBooking
            ? <><Search className="w-4 h-4 shrink-0" /><span className="truncate">Selecione uma UH</span></>
            : cart.length === 0
              ? <><ShoppingCart className="w-4 h-4 shrink-0" /><span>Adicione itens</span></>
              : <><span className="truncate">Lançar UH {selectedBooking.roomDescription}</span><ChevronRight className="w-4 h-4 shrink-0" /></>}
        </button>
      </div>
    </div>
  );

  // ── Table Layout Editor helpers ────────────────────────────────────────

  function startHold(tableId: string) {
    if (tableEditMode) return;
    let pct = 0;
    setHoldProgress({ tableId, pct: 0 });
    holdIntervalRef.current = setInterval(() => {
      pct += 100 / 30; // 30 ticks × 100ms = 3s
      if (pct >= 100) {
        clearInterval(holdIntervalRef.current!);
        holdIntervalRef.current = null;
        setHoldProgress(null);
        setTableEditMode(true);
      } else {
        setHoldProgress({ tableId, pct });
      }
    }, 100);
  }

  function cancelHold() {
    if (holdIntervalRef.current) { clearInterval(holdIntervalRef.current); holdIntervalRef.current = null; }
    setHoldProgress(null);
  }

  function handleTablePointerDown(tableId: string, e: React.PointerEvent) {
    e.stopPropagation();
    if (tableEditMode) {
      // Em modo edição: começar drag imediatamente
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      setDragOffset({ x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 });
      setDraggingTableId(tableId);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else {
      startHold(tableId);
    }
  }

  function handleTablePointerUp(tableId: string) {
    if (draggingTableId) {
      // Salvar posição ao soltar
      const t = tables.find(x => x.id === draggingTableId);
      if (t && t.position_x != null && t.position_y != null) {
        updateTablePosition(t.id, t.position_x, t.position_y).catch(() => {});
      }
      setDraggingTableId(null);
    } else if (!tableEditMode) {
      cancelHold();
      // Clique normal = selecionar
      const t = tables.find(x => x.id === tableId);
      if (t) selectTable(t.id, t.label);
    }
  }

  function handleCanvasPointerMove(e: React.PointerEvent) {
    if (!draggingTableId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left - dragOffset.x) / rect.width * 100;
    const rawY = (e.clientY - rect.top - dragOffset.y) / rect.height * 100;
    const x = Math.max(5, Math.min(93, rawX));
    const y = Math.max(5, Math.min(90, rawY));
    setTables(prev => prev.map(t => t.id === draggingTableId ? { ...t, position_x: x, position_y: y } : t));
  }

  async function handleAddTable() {
    if (!selectedSectorId || !selectedHotel || !newTableLabel.trim()) return;
    setSavingTable(true);
    try {
      // Posiciona no centro-ish com leve offset para não empilhar
      const offsetX = 20 + Math.random() * 60;
      const offsetY = 20 + Math.random() * 60;
      const t = await createSectorTable(selectedHotel.id, selectedSectorId, newTableLabel.trim(), newTableCapacity);
      await updateTablePosition(t.id, offsetX, offsetY);
      setTables(prev => [...prev, { ...t, position_x: offsetX, position_y: offsetY }]);
      setNewTableLabel('');
      setNewTableCapacity(4);
      setShowAddTable(false);
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSavingTable(false); }
  }

  async function handleDeleteTable(tableId: string) {
    setSavingTable(true);
    try {
      await deleteSectorTable(tableId);
      setTables(prev => prev.filter(t => t.id !== tableId));
      if (activeTableId === tableId) setActiveTableId('__direct__');
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSavingTable(false); }
  }

  // ── Table Map (overlay — mobile + desktop) ────────────────────────────

  // Assign positions to tables that don't have them (grid fallback)
  function getTableWithPos(table: PdvTable, idx: number) {
    if (table.position_x != null && table.position_y != null) return table;
    const cols = 4;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    return { ...table, position_x: 8 + col * 24, position_y: 12 + row * 30 };
  }

  const renderTableMap = () => {
    const tablesWithPos = tables.map((t, i) => getTableWithPos(t, i));
    const hasAnyPos = tables.some(t => t.position_x != null);

    return (
      <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={() => { if (!tableEditMode) setShowTableMap(false); }} />

        <div className="relative w-full lg:max-w-3xl lg:mx-4 bg-slate-900 rounded-t-3xl lg:rounded-3xl shadow-2xl shadow-black/50 flex flex-col max-h-[90vh]">
          <div className="w-10 h-1 rounded-full bg-slate-700 mx-auto mt-3 lg:hidden" />

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
            <div>
              <h2 className="font-bold text-white text-base flex items-center gap-2">
                {tableEditMode && <GripVertical className="w-4 h-4 text-amber-400 animate-pulse" />}
                {tableEditMode ? 'Editar Layout' : 'Mapa de Mesas'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {tableEditMode
                  ? 'Arraste as mesas para posicioná-las. Segure 3s em qualquer lugar para sair.'
                  : `${currentSector?.sector_name ?? 'Setor'} — segure 3s em uma mesa para editar layout`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {tableEditMode && (
                <button
                  onClick={() => setShowAddTable(s => !s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-amber-500 text-white rounded-xl hover:bg-amber-400 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Nova Mesa
                </button>
              )}
              {tableEditMode ? (
                <button
                  onClick={() => { setTableEditMode(false); setShowAddTable(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-green-600 text-white rounded-xl hover:bg-green-500 transition-colors">
                  <CheckCircle className="w-3.5 h-3.5" /> Concluído
                </button>
              ) : (
                <button onClick={() => setShowTableMap(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Add table form */}
          {showAddTable && tableEditMode && (
            <div className="px-5 py-3 bg-slate-800/60 border-b border-slate-700 shrink-0">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newTableLabel}
                  onChange={e => setNewTableLabel(e.target.value)}
                  placeholder="Nome da mesa (ex: Mesa 1, Varanda 3)"
                  className="flex-1 px-3 py-2 text-sm rounded-xl bg-slate-700 text-white border border-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                  onKeyDown={e => e.key === 'Enter' && handleAddTable()}
                  autoFocus
                />
                <input
                  type="number"
                  value={newTableCapacity}
                  onChange={e => setNewTableCapacity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 px-2 py-2 text-sm rounded-xl bg-slate-700 text-white border border-slate-600 focus:border-amber-500 outline-none text-center"
                  title="Capacidade"
                  min={1} max={30}
                />
                <button onClick={handleAddTable} disabled={savingTable || !newTableLabel.trim()}
                  className="px-3 py-2 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-400 disabled:opacity-40 transition-colors">
                  {savingTable ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Add'}
                </button>
                <button onClick={() => setShowAddTable(false)} className="p-2 text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Canvas */}
          <div className="flex-1 overflow-hidden p-3 sm:p-4">
            {tablesLoading ? (
              <div className="flex items-center justify-center h-48">
                <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
              </div>
            ) : (
              <div
                ref={canvasRef}
                className="relative w-full bg-slate-800/60 rounded-2xl border border-slate-700"
                style={{ height: Math.max(300, Math.min(500, window.innerHeight * 0.45)) }}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={() => { if (draggingTableId) { const t = tables.find(x => x.id === draggingTableId); if (t && t.position_x != null && t.position_y != null) updateTablePosition(t.id, t.position_x, t.position_y).catch(() => {}); setDraggingTableId(null); } }}
                onPointerLeave={() => { cancelHold(); }}
              >
                {/* Grid lines de fundo (modo edição) */}
                {tableEditMode && (
                  <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none opacity-10">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="absolute inset-y-0 border-l border-white" style={{ left: `${i * 10}%` }} />
                    ))}
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="absolute inset-x-0 border-t border-white" style={{ top: `${i * 10}%` }} />
                    ))}
                  </div>
                )}

                {/* "Sem Mesa" chip (sempre visível no canto) */}
                <button
                  onClick={() => { selectTable('__direct__', null); if (!tableEditMode) setShowTableMap(false); }}
                  className={`absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all z-10
                    ${activeTableId === '__direct__' ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-slate-600 bg-slate-700/80 text-slate-400 hover:border-slate-500'}`}
                >
                  <ArrowLeft className="w-3 h-3" /> Sem Mesa
                  {tableCarts['__direct__']?.length > 0 && (
                    <span className="text-amber-400 font-mono tabular-nums">{fmtBRL(getTableCartTotal('__direct__'))}</span>
                  )}
                </button>

                {/* Tables */}
                {tablesWithPos.map(table => {
                  const isActive = activeTableId === table.id;
                  const inMemCount = getTableCartCount(table.id);
                  const openTab = openTabs.find(t => t.table_id === table.id);
                  const hasOpenTab = !!openTab;
                  const isOccupied = inMemCount > 0 || hasOpenTab;
                  const total = inMemCount > 0 ? getTableCartTotal(table.id) : (openTab?.total_amount ?? 0);
                  const isDragging = draggingTableId === table.id;
                  const isHolding = holdProgress?.tableId === table.id;
                  const isEditingThis = editingTableId === table.id;

                  return (
                    <div key={table.id}>
                      {/* Inline edit form (flutuante acima do chip) */}
                      {isEditingThis && tableEditMode && (
                        <div
                          style={{
                            position: 'absolute',
                            left: `${table.position_x}%`,
                            top: `${table.position_y! - 16}%`,
                            transform: 'translate(-50%, -100%)',
                            zIndex: 30,
                          }}
                          className="bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl p-3 w-52"
                          onPointerDown={e => e.stopPropagation()}
                        >
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Editar Mesa</p>
                          <input
                            type="text"
                            value={editTableLabel}
                            onChange={e => setEditTableLabel(e.target.value)}
                            placeholder="Nome da mesa"
                            className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-slate-700 text-white border border-slate-600 focus:border-amber-500 outline-none mb-2"
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveTableEdit(); if (e.key === 'Escape') setEditingTableId(null); }}
                          />
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-slate-400">Lugares:</span>
                            <input
                              type="number"
                              value={editTableCapacity}
                              onChange={e => setEditTableCapacity(Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-16 px-2 py-1 text-sm rounded-lg bg-slate-700 text-white border border-slate-600 focus:border-amber-500 outline-none text-center"
                              min={1} max={30}
                            />
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={handleSaveTableEdit} disabled={savingTable}
                              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-400 disabled:opacity-40">
                              {savingTable ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Salvar
                            </button>
                            <button onClick={() => setEditingTableId(null)}
                              className="px-2 py-1.5 text-slate-400 hover:text-white rounded-lg text-xs">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      <div
                        style={{
                          position: 'absolute',
                          left: `${table.position_x}%`,
                          top: `${table.position_y}%`,
                          transform: `translate(-50%, -50%) ${isDragging ? 'scale(1.1)' : 'scale(1)'}`,
                          touchAction: 'none',
                          cursor: tableEditMode ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                          userSelect: 'none',
                          zIndex: isDragging ? 20 : 1,
                          transition: isDragging ? 'none' : 'transform 0.15s',
                        }}
                        onPointerDown={e => handleTablePointerDown(table.id, e)}
                        onPointerUp={() => handleTablePointerUp(table.id)}
                        onPointerLeave={() => { if (!tableEditMode) cancelHold(); }}
                        className={`flex flex-col items-center justify-center gap-0.5 w-16 h-16 rounded-2xl border-2 select-none
                          ${isActive ? 'border-amber-400 bg-amber-500/20 shadow-lg shadow-amber-500/30'
                            : hasOpenTab ? 'border-emerald-500/70 bg-emerald-900/25'
                            : isOccupied ? 'border-amber-700/70 bg-amber-900/25'
                            : 'border-slate-600 bg-slate-700/90'}
                          ${isDragging ? 'shadow-2xl shadow-black/60' : ''}
                          ${tableEditMode && !isDragging ? 'hover:border-amber-500/60' : ''}`}
                      >
                        {/* Hold progress ring */}
                        {isHolding && (
                          <svg className="absolute inset-0 w-full h-full -rotate-90 rounded-2xl" viewBox="0 0 64 64">
                            <circle cx="32" cy="32" r="28" fill="none" stroke="#f59e0b" strokeWidth="3"
                              strokeDasharray={`${(holdProgress!.pct / 100) * 175.9} 175.9`}
                              strokeLinecap="round" />
                          </svg>
                        )}

                        {hasOpenTab
                          ? <BookOpen className="w-4 h-4 text-emerald-400" />
                          : <LayoutGrid className={`w-4 h-4 ${isOccupied ? 'text-amber-400' : isActive ? 'text-amber-300' : 'text-slate-400'}`} />}
                        <span className={`text-[10px] font-bold text-center leading-tight w-14 truncate px-1
                          ${hasOpenTab ? 'text-emerald-200' : isOccupied ? 'text-amber-200' : isActive ? 'text-amber-200' : 'text-slate-300'}`}>
                          {table.label}
                        </span>
                        {isOccupied ? (
                          <span className={`text-[9px] font-bold tabular-nums ${hasOpenTab ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {fmtBRL(total)}
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-500">{table.capacity}p · Livre</span>
                        )}

                        {/* Edit button (modo edição) */}
                        {tableEditMode && !isDragging && (
                          <>
                            <button
                              onPointerDown={e => e.stopPropagation()}
                              onClick={e => { e.stopPropagation(); startEditTable(table); }}
                              className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-md hover:bg-blue-400 transition-colors"
                            >
                              <Edit2 className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onPointerDown={e => e.stopPropagation()}
                              onClick={e => { e.stopPropagation(); if (window.confirm(`Remover "${table.label}"?`)) handleDeleteTable(table.id); }}
                              className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md hover:bg-red-400 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Empty state */}
                {tables.length === 0 && !tablesLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
                    <LayoutGrid className="w-10 h-10 opacity-30" />
                    <p className="text-sm text-center">
                      Nenhuma mesa cadastrada.<br />
                      {tableEditMode
                        ? <span className="text-amber-400">Clique em "Nova Mesa" para adicionar.</span>
                        : <span>Segure 3s para entrar no modo de edição.</span>}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Comandas sem mesa (standalone) */}
          {(() => {
            const standalone = openTabs.filter(t => t.table_id === null);
            if (standalone.length === 0 && tableEditMode) return null;
            if (standalone.length === 0) return null;
            return (
              <div className="px-5 pb-3 shrink-0">
                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">
                  Comandas sem mesa ({standalone.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {standalone.map(tab => (
                    <div key={tab.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all
                        ${currentTabId === tab.id
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                          : 'border-slate-600 bg-slate-800/60 text-slate-300 hover:border-emerald-500/50'}`}
                    >
                      <button onClick={() => handleLoadStandaloneTab(tab)} className="flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-xs font-semibold">
                          {tab.custom_label || tab.operator_name || 'Comanda'}
                        </span>
                        <span className="text-xs text-emerald-400 font-mono tabular-nums">
                          {fmtBRL(tab.total_amount)}
                        </span>
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteTab(tab.id); }}
                        className="ml-1 w-4 h-4 flex items-center justify-center rounded-full text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                  {/* Nova comanda sem mesa */}
                  <button
                    onClick={() => { selectTable('__direct__', null); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-600 text-slate-500 hover:border-emerald-500/50 hover:text-emerald-400 text-xs transition-all">
                    <Plus className="w-3 h-3" /> Nova
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-800 shrink-0">
            <p className="text-[11px] text-slate-500 text-center">
              {tableEditMode
                ? 'Arraste as mesas · ✎ editar · ✕ remover'
                : 'Toque em uma mesa para selecionar. Segure 3s para editar o layout.'}
            </p>
          </div>
        </div>
      </div>
    );
  };

  // ── Mobile: Cart Bottom Sheet ─────────────────────────────────────────

  const renderCartSheet = () => (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCartSheetOpen(false)} />
      <div className="relative w-full bg-slate-900 rounded-t-3xl shadow-2xl shadow-black/50 flex flex-col max-h-[90vh]">
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-slate-700 mx-auto mt-3 mb-1" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div>
            <h2 className="font-bold text-white text-base">Carrinho</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeTableLabel ? `Mesa: ${activeTableLabel}` : 'Direto para UH'}
              {currentSector ? ` · ${currentSector.sector_name}` : ''}
            </p>
          </div>
          <button onClick={() => setCartSheetOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* UH Selector */}
        <div className="px-4 pt-3 pb-2 border-b border-slate-800/60">
          {renderBookingSelector()}
        </div>

        {/* Cart items */}
        {renderCartItems()}

        {/* Footer */}
        {renderCTAFooter()}
      </div>
    </div>
  );

  // ── Product grid ──────────────────────────────────────────────────────

  const renderProductGrid = () => (
    <div className={`flex-1 overflow-y-auto p-3 sm:p-4 ${cart.length > 0 ? 'pb-20 lg:pb-4' : ''}`}>
      {productsLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <ProductSkeleton key={i} />)}
        </div>
      ) : !selectedSectorId ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
            <Package className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-sm text-slate-400">Selecione um setor</p>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
            <Package className="w-8 h-8 text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Sem produtos em estoque</p>
            <p className="text-xs text-slate-400 mt-1">Nenhum produto disponível neste setor/categoria</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredProducts.map(product => {
            const cartItem = cart.find(i => i.product_id === product.product_id);
            const inCart = cartItem?.quantity ?? 0;
            const outOfStock = product.stock_quantity === 0;
            return (
              <div key={product.product_id}
                className={`group flex flex-col rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden transition-all duration-200
                  ${outOfStock ? 'opacity-40 cursor-not-allowed' : 'hover:shadow-lg hover:shadow-slate-200/60 dark:hover:shadow-black/30 hover:-translate-y-0.5 hover:border-amber-300/60 dark:hover:border-amber-500/30 cursor-pointer'}
                  ${inCart > 0 ? 'ring-2 ring-amber-400/60 border-amber-300' : ''}`}>
                {/* Image */}
                <div className="relative h-28 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center overflow-hidden">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.product_name}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                  ) : (
                    <Package className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                  )}
                  {inCart > 0 && (
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-amber-500 shadow-lg shadow-amber-500/40 flex items-center justify-center">
                      <span className="text-[10px] font-black text-white">{inCart}</span>
                    </div>
                  )}
                  {/* Stock strip — always visible, full width, prominent */}
                  {(() => {
                    const s = stockStrip(product.stock_quantity);
                    return (
                      <div className={`absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1.5 py-1.5 ${s.bg} ${s.text} backdrop-blur-sm`}>
                        <span className={`text-[11px] font-black tracking-wide uppercase ${s.urgent ? 'animate-pulse' : ''}`}>
                          {s.label}
                        </span>
                      </div>
                    );
                  })()}
                  {product.erbon_service_id === null && (
                    <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-amber-500/90 flex items-center justify-center"
                      title="Sem mapeamento PMS">
                      <AlertCircle className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                {/* Info */}
                <div className="flex flex-col flex-1 p-3 gap-2">
                  <p className="text-xs font-semibold text-slate-800 dark:text-white leading-snug line-clamp-2">{product.product_name}</p>
                  {product.sale_price === 0 ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-medium self-start">Sem preço</span>
                  ) : (
                    <span className="text-base font-black text-slate-900 dark:text-white tabular-nums font-mono leading-none">{fmtBRL(product.sale_price)}</span>
                  )}
                  <button onClick={() => !outOfStock && addToCart(product)} disabled={outOfStock}
                    className={`mt-auto w-full h-11 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all duration-150 active:scale-95
                      ${inCart > 0 ? 'bg-amber-500 hover:bg-amber-400 text-white shadow-md shadow-amber-500/30' : 'bg-slate-900 dark:bg-slate-700 hover:bg-amber-500 text-white dark:hover:bg-amber-500'}
                      disabled:opacity-30 disabled:cursor-not-allowed`}>
                    <Plus className="w-3.5 h-3.5" />
                    {inCart > 0 ? `No carrinho (${inCart})` : 'Adicionar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ══════════════════════════════════════════════════════════════════════

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden bg-slate-950">

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-white leading-none">PDV</h1>
            {selectedHotel && <p className="text-[11px] text-slate-400 leading-none mt-0.5 truncate max-w-[140px] sm:max-w-none">{selectedHotel.name}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* In-house pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-800 border border-slate-700">
            <div className={`w-1.5 h-1.5 rounded-full ${guestsLoading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-200">{guestsLoading ? '…' : bookingGroups.length}</span>
            <span className="text-xs text-slate-500 hidden sm:inline">in-house</span>
          </div>
          <button onClick={refreshGuests} disabled={guestsLoading} aria-label="Atualizar hóspedes"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-all duration-150 active:scale-95">
            <RefreshCw className={`w-4 h-4 ${guestsLoading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => navigate('/pdv/history')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 text-xs font-medium transition-all duration-150 active:scale-95">
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Histórico</span>
          </button>
        </div>
      </header>

      {/* ══ MOBILE: Sector Picker ════════════════════════════════════════════ */}
      {mobileView === 'sector' && (
        <div className="lg:hidden flex-1 flex flex-col overflow-hidden bg-slate-900">
          <div className="px-4 pt-5 pb-3 text-center">
            <p className="text-sm font-semibold text-white mb-0.5">Selecione o Setor</p>
            <p className="text-xs text-slate-500">Escolha onde você está trabalhando</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {sectors.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {sectors.map((sector, idx) => {
                  const color = sectorColor(sector.sector_name, idx);
                  return (
                    <button key={sector.sector_id} onClick={() => handleSectorSelect(sector.sector_id)}
                      className="flex flex-col items-center justify-center gap-3 p-5 rounded-2xl bg-slate-800 border-2 border-transparent hover:border-current transition-all duration-200 active:scale-95 text-center"
                      style={{ borderColor: selectedSectorId === sector.sector_id ? color : undefined }}>
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                        style={{ backgroundColor: `${color}20`, boxShadow: `0 0 0 2px ${color}30` }}>
                        <LayoutGrid className="w-6 h-6" style={{ color }} />
                      </div>
                      <p className="font-bold text-sm text-white leading-tight">{sector.sector_name}</p>
                      {sector.erbon_department_id === null && (
                        <span className="text-[10px] text-amber-500/80">Sem ID Erbon</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TABLE MAP OVERLAY ════════════════════════════════════════════════ */}
      {showTableMap && renderTableMap()}

      {/* ══ MAIN CONTENT ════════════════════════════════════════════════════ */}
      <div className={`flex flex-1 overflow-hidden ${mobileView === 'sector' ? 'hidden lg:flex' : 'flex'}`}>

        {/* ── Desktop: Left Panel ─────────────────────────────────────────── */}
        <aside className="hidden lg:flex flex-col w-[360px] min-w-[320px] max-w-[400px] bg-slate-900 border-r border-slate-800">
          {/* Mesa / UH indicator */}
          <div className="px-4 pt-3 pb-2 border-b border-slate-800/60">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {activeTableId !== '__direct__' ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
                    <LayoutGrid className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-amber-300">{activeTableLabel}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700">
                    <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-medium text-slate-400">Direto para UH</span>
                  </div>
                )}
              </div>
              {selectedSectorId && (
                <button onClick={() => setShowTableMap(true)}
                  className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1">
                  <LayoutGrid className="w-3 h-3" />
                  Mesas
                </button>
              )}
            </div>
          </div>

          {/* Booking selector */}
          <div className="px-4 pt-3 pb-3 border-b border-slate-800 shrink-0">
            {renderBookingSelector()}
          </div>

          {/* Cart */}
          {renderCartItems()}

          {/* Footer */}
          {renderCTAFooter()}
        </aside>

        {/* ── Products area ──────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900 relative">

          {/* Mobile: current sector + table context bar */}
          <div className="lg:hidden flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
            <button onClick={() => setMobileView('sector')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors active:scale-95 shrink-0">
              <ChevronDown className="w-3 h-3 rotate-90" />
              Setor
            </button>
            <span className="text-sm font-bold text-slate-800 dark:text-white truncate">{currentSector?.sector_name ?? '—'}</span>
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {activeTableId !== '__direct__' && (
                <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                  {activeTableLabel}
                </span>
              )}
              {selectedSectorId && (
                <button onClick={() => setShowTableMap(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-95">
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Mesas
                </button>
              )}
            </div>
          </div>

          {/* Desktop: Sector tabs (scrollable, with shrink-0 per tab) */}
          <div className="hidden lg:block border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
            <div className="overflow-x-auto">
              <div className="flex items-center gap-2 px-4 pt-3 pb-3 w-max">
                {sectors.length === 0 ? (
                  <span className="text-sm text-slate-400 px-1">Nenhum setor configurado</span>
                ) : (
                  sectors.map(sector => {
                    const isActive = selectedSectorId === sector.sector_id;
                    return (
                      <button key={sector.sector_id} onClick={() => handleSectorSelect(sector.sector_id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap shrink-0 transition-all duration-200 active:scale-95
                          ${isActive ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-900 shadow-md' : 'bg-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                        {sector.sector_name}
                        {sector.erbon_department_id === null && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Sem ID Erbon" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Category pills */}
          {categories.length > 1 && (
            <div className="border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900 shrink-0">
              <div className="overflow-x-auto">
                <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 w-max">
                  {categories.map(cat => {
                    const isActive = selectedCategory === cat;
                    const Icon = cat === 'Todos' ? null : categoryIcon(cat);
                    return (
                      <button key={cat} onClick={() => setSelectedCategory(cat)}
                        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-all duration-150 active:scale-95
                          ${isActive ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/30' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-600'}`}>
                        {Icon && <Icon className="w-3 h-3" />}
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Product grid */}
          {renderProductGrid()}

        </main>
      </div>

      {/* ══ MOBILE: Cart bar — FIXED ao viewport, sempre visível ════════════ */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 px-3 py-2.5 bg-slate-950/97 backdrop-blur-md border-t border-slate-800/80 safe-area-inset-bottom">
          <button onClick={() => setCartSheetOpen(true)}
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 shadow-xl shadow-amber-500/40 active:scale-[0.98] transition-transform duration-150">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center shadow-inner">
                <span className="text-xs font-black text-white">{cartCount}</span>
              </div>
              <span className="text-sm font-bold text-white">{cartCount === 1 ? '1 item' : `${cartCount} itens`}</span>
            </div>
            <span className="text-base font-black text-white tabular-nums">{fmtBRL(cartTotal)}</span>
            <div className="flex items-center gap-1.5 text-white/90 bg-white/10 px-3 py-1.5 rounded-xl">
              <span className="text-xs font-bold">Ver carrinho</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </button>
        </div>
      )}

      {/* ══ MOBILE: Cart Bottom Sheet ════════════════════════════════════════ */}
      {cartSheetOpen && renderCartSheet()}

      {/* ══ CONFIRM MODAL ════════════════════════════════════════════════════ */}
      <Modal isOpen={confirmOpen} onClose={() => !submitting && setConfirmOpen(false)}
        title={`Confirmar — UH ${selectedBooking?.roomDescription ?? ''}`} size="xl">
        {selectedBooking && sectorDetails && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Hóspede', value: selectedBooking.guestName },
                { label: 'Reserva', value: `#${selectedBooking.bookingNumber}` },
                { label: 'Setor', value: sectorDetails.sector_name + (sectorDetails.erbon_department ? ` — ${sectorDetails.erbon_department}` : '') },
                { label: activeTableLabel ? 'Mesa' : 'Modo', value: activeTableLabel ?? 'Direto para UH' },
              ].map(({ label, value }) => (
                <div key={label} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-0.5">{label}</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{value}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/80">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Produto</th>
                    <th className="text-center px-3 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Qtd</th>
                    <th className="text-right px-3 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Unit.</th>
                    <th className="text-right px-4 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {cart.map(item => (
                    <tr key={item.product_id} className={item.erbon_service_id === null ? 'bg-amber-50/60 dark:bg-amber-900/10' : 'bg-white dark:bg-slate-800/40'}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 dark:text-white">{item.product_name}</p>
                        {item.erbon_service_id === null && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                            <AlertTriangle className="w-3 h-3" /> Não lançado no PMS
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center text-slate-600 dark:text-slate-300 font-mono tabular-nums">{item.quantity}</td>
                      <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-300 font-mono tabular-nums text-xs">{fmtBRL(item.unit_price)}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white font-mono tabular-nums">{fmtBRL(item.unit_price * item.quantity)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-900 dark:bg-slate-950">
                    <td className="px-4 py-3 text-sm font-bold text-white" colSpan={3}>Total a lançar</td>
                    <td className="px-4 py-3 text-right font-black text-amber-400 text-lg font-mono tabular-nums">{fmtBRL(cartTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {cartHasUnmappedItems && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Itens em amarelo não possuem mapeamento Erbon — serão registrados localmente mas <strong>não lançados no PMS</strong>.
                </p>
              </div>
            )}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button onClick={() => setConfirmOpen(false)} disabled={submitting}
                className="px-5 py-2.5 text-sm rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all duration-150 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={handleSubmitSale} disabled={submitting}
                className="flex items-center gap-2 px-6 py-2.5 text-sm rounded-xl font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all duration-150 active:scale-[0.98]">
                {submitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {submitting ? 'Processando…' : 'Confirmar e Lançar'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ══ RECEIPT MODAL ════════════════════════════════════════════════════ */}
      <Modal isOpen={receiptSale !== null} onClose={resetSale} title="Comprovante de Venda" size="lg">
        {receiptSale && (
          <div className="space-y-4">
            <div className={`flex items-center gap-4 p-4 rounded-2xl border ${receiptSale.erbonPosted ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50'}`}>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${receiptSale.erbonPosted ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-amber-100 dark:bg-amber-900/40'}`}>
                {receiptSale.erbonPosted ? <CheckCircle className="w-7 h-7 text-emerald-500" /> : <AlertTriangle className="w-7 h-7 text-amber-500" />}
              </div>
              <div>
                <p className={`font-bold text-base ${receiptSale.erbonPosted ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {receiptSale.erbonPosted ? 'Venda Concluída com Sucesso' : 'Venda Salva — Avisos PMS'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">ID #{receiptSale.saleId.slice(0, 8).toUpperCase()}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-slate-400">Total</p>
                <p className="font-black text-xl text-slate-900 dark:text-white font-mono tabular-nums">{fmtBRL(receiptSale.totalAmount)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: 'Data / Hora', value: new Date().toLocaleString('pt-BR') },
                { label: 'UH', value: `${selectedBooking?.roomDescription} — ${selectedBooking?.guestName}` },
                { label: 'Setor', value: sectorDetails?.sector_name || '—' },
                { label: activeTableLabel ? 'Mesa' : 'Modo', value: activeTableLabel ?? 'Direto para UH' },
              ].map(({ label, value }) => (
                <div key={label} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-0.5">{label}</p>
                  <p className="text-xs font-semibold text-slate-800 dark:text-white truncate">{value}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/80">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider">Produto</th>
                    <th className="text-center px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider">Qtd</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider">Total</th>
                    <th className="text-center px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider">PMS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {cart.map(item => {
                    const hasError = receiptSale.erbonErrors.some(e => e.productName === item.product_name);
                    const posted = item.erbon_service_id !== null && !hasError && receiptSale.erbonPosted;
                    return (
                      <tr key={item.product_id} className="bg-white dark:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white">{item.product_name}</td>
                        <td className="px-3 py-2.5 text-center text-slate-500 dark:text-slate-400 font-mono tabular-nums">{item.quantity}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-slate-800 dark:text-white font-mono tabular-nums">{fmtBRL(item.unit_price * item.quantity)}</td>
                        <td className="px-3 py-2.5 text-center">
                          {item.erbon_service_id === null ? <span className="text-slate-400 text-xs">—</span>
                            : posted ? <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />
                            : <AlertTriangle className="w-4 h-4 text-amber-500 mx-auto" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {receiptSale.erbonErrors.length > 0 && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 p-3 space-y-1.5">
                <p className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" />{receiptSale.erbonErrors.length} erro(s) no PMS
                </p>
                {receiptSale.erbonErrors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400 pl-5">
                    <span className="font-semibold">{e.productName}:</span> {e.error}
                  </p>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                {receiptSale.erbonErrors.length > 0 && (
                  <button onClick={handleRetryErbon} disabled={retrying}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-semibold border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 transition-all duration-150 active:scale-95">
                    {retrying ? <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    Retentar PMS
                  </button>
                )}
                <button onClick={() => navigate('/pdv/history')}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all duration-150 active:scale-95">
                  <History className="w-4 h-4" />Histórico
                </button>
              </div>
              <button onClick={resetSale}
                className="flex items-center gap-2 px-6 py-2.5 text-sm rounded-xl font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 shadow-lg shadow-amber-500/20 transition-all duration-150 active:scale-[0.98]">
                <Plus className="w-4 h-4" />Nova Venda
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PDV;
