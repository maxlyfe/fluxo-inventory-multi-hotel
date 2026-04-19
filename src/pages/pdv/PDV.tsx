// src/pages/pdv/PDV.tsx
// Redesigned with frontend-design + ui-ux-pro-max skills
// Aesthetic: Refined Dark POS — operational luxury, speed-first

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Search, Trash2, Plus, Minus, Package,
  RefreshCw, AlertTriangle, CheckCircle, XCircle, ChevronRight,
  Users, AlertCircle, RotateCcw, History, X, Zap,
  UtensilsCrossed, Wine, Coffee, Star,
} from 'lucide-react';

import {
  getProductsForSector,
  getSectorDetails,
  getSectorsForPDV,
  createSale,
  retryErbonPosting,
  PDVProduct,
  PDVSectorDetails,
  CartItem,
  SelectedBooking,
  SaleResult,
} from '../../lib/pdvService';
import { erbonService, ErbonGuest } from '../../lib/erbonService';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import Modal from '../../components/Modal';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); }
  catch { return d; }
}

// ── Skeleton loader ────────────────────────────────────────────────────────

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

// ── Stepper button ─────────────────────────────────────────────────────────

const StepBtn: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    // min 44×44px touch target (ui-ux-pro-max rule: touch-target-size)
    className="w-11 h-11 flex items-center justify-center rounded-xl
      text-slate-400 hover:text-white hover:bg-slate-600
      disabled:opacity-20 disabled:cursor-not-allowed
      transition-all duration-150 active:scale-95"
  >
    {children}
  </button>
);

// ── Component ──────────────────────────────────────────────────────────────

const PDV: React.FC = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  // ── State ──────────────────────────────────────────────────────────────

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
  // Mobile: which panel is visible ('products' | 'cart')
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products');

  const searchRef = useRef<HTMLDivElement>(null);

  // ── Derived / Memoized ─────────────────────────────────────────────────

  const bookingGroups = useMemo(() => {
    const map = new Map<number, SelectedBooking>();
    for (const g of inHouseGuests) {
      if (!map.has(g.idBooking)) {
        map.set(g.idBooking, {
          bookingInternalId: g.idBooking,
          bookingNumber: g.bookingNumber,
          roomDescription: g.roomDescription,
          guestName: g.guestName,
          checkOutDate: g.checkOutDate,
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

  const cartTotal = useMemo(
    () => cart.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
    [cart]
  );

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartHasUnmappedItems = cart.some(i => i.erbon_service_id === null);

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedHotel) return;

    getSectorsForPDV(selectedHotel.id)
      .then(s => {
        setSectors(s);
        if (s.length > 0 && !selectedSectorId) setSelectedSectorId(s[0].sector_id);
      })
      .catch(err => addNotification('error', `Erro ao carregar setores: ${err.message}`));

    setGuestsLoading(true);
    erbonService.fetchInHouseGuests(selectedHotel.id)
      .then(guests => setInHouseGuests(guests))
      .catch((err: any) => {
        const msg: string = err?.message || '';
        if (msg.toLowerCase().includes('not configured') ||
            msg.toLowerCase().includes('não configurado') ||
            msg.toLowerCase().includes('sem configuração')) {
          setErbonConfigured(false);
        } else {
          addNotification('error', `Erro ao buscar hóspedes: ${msg}`);
        }
      })
      .finally(() => setGuestsLoading(false));
  }, [selectedHotel]); // eslint-disable-line

  useEffect(() => {
    if (!selectedHotel || !selectedSectorId) {
      setProducts([]); setSectorDetails(null); return;
    }
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setShowBookingDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Cart operations ────────────────────────────────────────────────────

  function addToCart(product: PDVProduct) {
    setCart(prev => {
      const existing = prev.find(i => i.product_id === product.product_id);
      if (existing) {
        if (existing.quantity >= product.stock_quantity) return prev;
        return prev.map(i =>
          i.product_id === product.product_id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      // First item added — nudge mobile user to cart tab so they see the UH selector
      if (prev.length === 0) {
        // Only switch on mobile (lg breakpoint = 1024px)
        if (window.innerWidth < 1024) setMobileTab('cart');
      }
      return [...prev, {
        product_id: product.product_id,
        product_name: product.product_name,
        quantity: 1,
        unit_price: product.sale_price,
        stock_quantity: product.stock_quantity,
        erbon_service_id: product.erbon_service_id,
        erbon_service_description: product.erbon_service_description,
      }];
    });
  }

  function updateCartQty(productId: string, qty: number) {
    if (qty <= 0) { removeFromCart(productId); return; }
    setCart(prev =>
      prev.map(i =>
        i.product_id === productId ? { ...i, quantity: Math.min(qty, i.stock_quantity) } : i
      )
    );
  }

  function updateCartPrice(productId: string, price: number) {
    setCart(prev =>
      prev.map(i => i.product_id === productId ? { ...i, unit_price: Math.max(0, price) } : i)
    );
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(i => i.product_id !== productId));
  }

  // ── Sale flow ──────────────────────────────────────────────────────────

  function handleConfirm() {
    if (!selectedBooking) { addNotification('error', 'Selecione uma reserva (UH)'); return; }
    if (!selectedSectorId) { addNotification('error', 'Selecione um setor'); return; }
    if (cart.length === 0) { addNotification('error', 'Adicione itens ao carrinho'); return; }
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
      });
      setConfirmOpen(false);
      setReceiptSale(result);
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
    setCart([]); setSelectedBooking(null); setBookingSearch(''); setReceiptSale(null);
  }

  function refreshGuests() {
    if (!selectedHotel) return;
    setGuestsLoading(true);
    erbonService.fetchInHouseGuests(selectedHotel.id)
      .then(g => setInHouseGuests(g))
      .catch(() => {})
      .finally(() => setGuestsLoading(false));
  }

  // ── Stock badge ────────────────────────────────────────────────────────

  function stockBadge(qty: number) {
    if (qty === 0) return 'bg-red-500/10 text-red-500 border border-red-500/20';
    if (qty < 3) return 'bg-red-500/10 text-red-400 border border-red-500/20';
    if (qty < 6) return 'bg-amber-500/10 text-amber-500 border border-amber-500/20';
    return 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20';
  }

  // ── Category icon ──────────────────────────────────────────────────────

  function categoryIcon(cat: string) {
    const lc = cat.toLowerCase();
    if (lc.includes('beb') || lc.includes('drin')) return Wine;
    if (lc.includes('café') || lc.includes('cafe') || lc.includes('hot')) return Coffee;
    if (lc.includes('com') || lc.includes('prat') || lc.includes('snack')) return UtensilsCrossed;
    return Star;
  }

  // ── Erbon not configured fallback ─────────────────────────────────────

  if (!erbonConfigured) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-slate-900">
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

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-950 dark:bg-slate-950">

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          {/* Brand mark */}
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">PDV</h1>
            {selectedHotel && (
              <p className="text-[11px] text-slate-400 leading-none mt-0.5">{selectedHotel.name}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* In-house count pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700">
            <div className={`w-1.5 h-1.5 rounded-full ${guestsLoading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-200">
              {guestsLoading ? '…' : bookingGroups.length}
            </span>
            <span className="text-xs text-slate-500 hidden sm:inline">in-house</span>
          </div>

          {/* Refresh */}
          <button
            onClick={refreshGuests}
            disabled={guestsLoading}
            aria-label="Atualizar hóspedes"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-800 border border-slate-700
              text-slate-400 hover:text-white hover:border-slate-600 transition-all duration-150 active:scale-95"
          >
            <RefreshCw className={`w-4 h-4 ${guestsLoading ? 'animate-spin' : ''}`} />
          </button>

          {/* History */}
          <button
            onClick={() => navigate('/pdv/history')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
              text-slate-300 hover:text-white hover:border-slate-600 text-xs font-medium transition-all duration-150 active:scale-95"
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Histórico</span>
          </button>
        </div>
      </header>

      {/* ══ MOBILE TAB BAR ══════════════════════════════════════════════════ */}
      <div className="lg:hidden flex shrink-0 bg-slate-900 border-b border-slate-800">
        <button
          onClick={() => setMobileTab('products')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold transition-all duration-150
            ${mobileTab === 'products'
              ? 'text-amber-400 border-b-2 border-amber-400'
              : 'text-slate-500 hover:text-slate-300'}`}
        >
          <Package className="w-4 h-4" />
          Produtos
          {filteredProducts.length > 0 && (
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">
              {filteredProducts.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setMobileTab('cart')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold transition-all duration-150 relative
            ${mobileTab === 'cart'
              ? 'text-amber-400 border-b-2 border-amber-400'
              : 'text-slate-500 hover:text-slate-300'}`}
        >
          <ShoppingCart className="w-4 h-4" />
          Carrinho
          {cartCount > 0 && (
            <span className="ml-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-black shadow-md shadow-amber-500/40">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {/* ══ MAIN ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ═══════════════════════════════════════
            LEFT PANEL — Cart + Booking (dark terminal)
            Mobile: shown only on 'cart' tab
            Desktop: always visible at fixed width
        ═══════════════════════════════════════ */}
        <aside className={`flex-col bg-slate-900 border-r border-slate-800
          ${mobileTab === 'products' ? 'hidden' : 'flex w-full'}
          lg:flex lg:w-[360px] lg:min-w-[320px] lg:max-w-[400px]`}>

          {/* ── Booking selector ── */}
          <div className="px-4 pt-4 pb-3 border-b border-slate-800 shrink-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2.5">
              Unidade Habitacional
            </p>

            {selectedBooking ? (
              /* ─ Selected booking card ─ */
              <div className="relative flex items-center gap-3 p-3.5 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/30 group">
                {/* Room badge */}
                <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <span className="text-white font-black text-xs text-center leading-tight px-1">
                    {selectedBooking.roomDescription}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm truncate">
                    {selectedBooking.guestName}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Res. #{selectedBooking.bookingNumber}
                  </p>
                  <p className="text-xs text-slate-500">
                    Out: {fmtDate(selectedBooking.checkOutDate)}
                  </p>
                </div>
                <button
                  onClick={() => { setSelectedBooking(null); setBookingSearch(''); }}
                  aria-label="Remover seleção"
                  className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full
                    text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              /* ─ Search ─ */
              <div ref={searchRef} className="relative">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  <input
                    type="text"
                    value={bookingSearch}
                    onChange={e => { setBookingSearch(e.target.value); setShowBookingDropdown(true); }}
                    onFocus={() => setShowBookingDropdown(true)}
                    placeholder="UH, hóspede ou nº reserva…"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800 border border-slate-700
                      text-sm text-white placeholder-slate-500
                      focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50
                      transition-all duration-150"
                  />
                </div>

                {/* Dropdown */}
                {showBookingDropdown && (filteredBookings.length > 0 || (bookingSearch.trim() && filteredBookings.length === 0)) && (
                  <div className="absolute z-30 top-full mt-1.5 left-0 right-0
                    bg-slate-800 border border-slate-700 rounded-xl shadow-2xl shadow-black/40
                    max-h-60 overflow-y-auto">
                    {filteredBookings.length === 0 ? (
                      <div className="px-4 py-4 text-sm text-slate-500 text-center">
                        Nenhuma reserva encontrada
                      </div>
                    ) : (
                      filteredBookings.map(b => (
                        <button
                          key={b.bookingInternalId}
                          onClick={() => { setSelectedBooking(b); setBookingSearch(''); setShowBookingDropdown(false); }}
                          className="w-full flex items-center gap-3 px-3 py-3 hover:bg-slate-700/60
                            transition-colors text-left border-b border-slate-700/50 last:border-0"
                        >
                          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500
                            flex items-center justify-center shadow-sm shadow-amber-500/20">
                            <span className="text-white font-black text-[10px] text-center leading-tight px-0.5">
                              {b.roomDescription}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">UH {b.roomDescription}</p>
                            <p className="text-xs text-slate-400 truncate">{b.guestName}</p>
                          </div>
                          <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                            {fmtDate(b.checkOutDate)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Cart items ── */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">
                Carrinho
              </p>
              {cart.length > 0 && (
                <span className="text-[10px] font-bold text-amber-400">
                  {cartCount} {cartCount === 1 ? 'item' : 'itens'}
                </span>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-36 gap-2">
                <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center">
                  <ShoppingCart className="w-6 h-6 text-slate-600" />
                </div>
                <p className="text-xs text-slate-500">Adicione produtos ao carrinho</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map(item => (
                  <div
                    key={item.product_id}
                    className="rounded-xl bg-slate-800 border border-slate-700/60 p-3"
                  >
                    {/* Name + remove */}
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <p className="text-sm font-semibold text-white leading-tight flex-1 min-w-0">
                        {item.product_name}
                      </p>
                      <button
                        onClick={() => removeFromCart(item.product_id)}
                        aria-label="Remover item"
                        className="w-6 h-6 flex items-center justify-center rounded-lg
                          text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Qty + Price + Total */}
                    <div className="flex items-center gap-2">
                      {/* Stepper — min 44px targets */}
                      <div className="flex items-center gap-0.5 rounded-lg bg-slate-700/50 border border-slate-600/50">
                        <StepBtn
                          onClick={() => updateCartQty(item.product_id, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </StepBtn>
                        <span className="text-sm font-bold text-white w-7 text-center tabular-nums">
                          {item.quantity}
                        </span>
                        <StepBtn
                          onClick={() => updateCartQty(item.product_id, item.quantity + 1)}
                          disabled={item.quantity >= item.stock_quantity}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </StepBtn>
                      </div>

                      {/* Price input */}
                      <div className="flex items-center gap-1 flex-1 rounded-lg bg-slate-700/50 border border-slate-600/50 px-2">
                        <span className="text-xs text-slate-500 font-medium">R$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.unit_price === 0 ? '' : item.unit_price.toFixed(2).replace('.', ',')}
                          onChange={e => {
                            const raw = e.target.value.replace(',', '.');
                            const parsed = parseFloat(raw);
                            if (!isNaN(parsed)) updateCartPrice(item.product_id, parsed);
                            else if (e.target.value === '' || e.target.value === '0') updateCartPrice(item.product_id, 0);
                          }}
                          placeholder="0,00"
                          className="w-full h-11 text-xs font-mono text-white bg-transparent
                            border-none outline-none focus:ring-0 tabular-nums"
                        />
                      </div>

                      {/* Line total */}
                      <span className="text-sm font-bold text-amber-400 shrink-0 tabular-nums font-mono">
                        {fmtBRL(item.unit_price * item.quantity)}
                      </span>
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

          {/* ── Footer / CTA ── */}
          <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-4 py-4">
            {/* Erbon warning */}
            {sectorDetails?.erbon_department_id === null && cart.length > 0 && (
              <div className="flex items-start gap-2 mb-3 p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-400/80">
                  Setor sem ID Erbon — consumos não serão lançados no PMS
                </p>
              </div>
            )}

            {/* Total */}
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Total</p>
                <p className="text-3xl font-black text-white tabular-nums font-mono leading-none mt-1">
                  {fmtBRL(cartTotal)}
                </p>
              </div>
              {cart.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-slate-500">{cart.length} produto{cart.length !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-slate-400">{cartCount} unidade{cartCount !== 1 ? 's' : ''}</p>
                </div>
              )}
            </div>

            {/* CTA — single primary action per screen (ui-ux-pro-max) */}
            <button
              onClick={handleConfirm}
              disabled={cart.length === 0 || !selectedBooking}
              onMouseDown={() => { /* noop — mobile auto-scroll handled by tab */ }}
              className="w-full flex items-center justify-center gap-2.5 px-5 py-4 rounded-2xl
                font-bold text-sm text-white
                bg-gradient-to-r from-amber-500 to-orange-500
                hover:from-amber-400 hover:to-orange-400
                shadow-lg shadow-amber-500/20
                disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none
                transition-all duration-200 active:scale-[0.98]"
            >
              {!selectedBooking ? (
                <>
                  <Search className="w-4 h-4" />
                  Selecione uma UH
                </>
              ) : cart.length === 0 ? (
                <>
                  <ShoppingCart className="w-4 h-4" />
                  Adicione itens
                </>
              ) : (
                <>
                  Lançar na UH {selectedBooking.roomDescription}
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </aside>

        {/* ═══════════════════════════════════════
            RIGHT PANEL — Product browser
            Mobile: shown only on 'products' tab
            Desktop: always visible, flex-1
        ═══════════════════════════════════════ */}
        <main className={`flex-col overflow-hidden bg-slate-50 dark:bg-slate-900
          ${mobileTab === 'cart' ? 'hidden' : 'flex flex-1'}
          lg:flex lg:flex-1`}>

          {/* ── Sector tabs ── */}
          <div className="flex items-center gap-2 px-4 pt-4 pb-3 shrink-0 overflow-x-auto border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            {sectors.length === 0 ? (
              <span className="text-sm text-slate-400 px-1">Nenhum setor configurado</span>
            ) : (
              sectors.map(sector => {
                const isActive = selectedSectorId === sector.sector_id;
                return (
                  <button
                    key={sector.sector_id}
                    onClick={() => setSelectedSectorId(sector.sector_id)}
                    className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold
                      whitespace-nowrap transition-all duration-200 active:scale-95
                      ${isActive
                        ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-900 shadow-md'
                        : 'bg-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                  >
                    {sector.sector_name}
                    {sector.erbon_department_id === null && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-amber-400"
                        title="Sem ID Erbon — não lançará no PMS"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* ── Category pills ── */}
          {categories.length > 1 && (
            <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto shrink-0">
              {categories.map(cat => {
                const isActive = selectedCategory === cat;
                const Icon = cat === 'Todos' ? null : categoryIcon(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold
                      whitespace-nowrap transition-all duration-150 active:scale-95
                      ${isActive
                        ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/30'
                        : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-600'
                      }`}
                  >
                    {Icon && <Icon className="w-3 h-3" />}
                    {cat}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Product grid ── */}
          <div className="flex-1 overflow-y-auto p-4">
            {productsLoading ? (
              /* Skeleton screens (ui-ux-pro-max: progressive-loading) */
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
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
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredProducts.map(product => {
                  const cartItem = cart.find(i => i.product_id === product.product_id);
                  const inCart = cartItem?.quantity ?? 0;
                  const outOfStock = product.stock_quantity === 0;

                  return (
                    <div
                      key={product.product_id}
                      className={`group flex flex-col rounded-2xl bg-white dark:bg-slate-800
                        border border-slate-200 dark:border-slate-700 overflow-hidden
                        transition-all duration-200
                        ${outOfStock
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:shadow-lg hover:shadow-slate-200/60 dark:hover:shadow-black/30 hover:-translate-y-0.5 hover:border-amber-300/60 dark:hover:border-amber-500/30 cursor-pointer'
                        }
                        ${inCart > 0 ? 'ring-2 ring-amber-400/60 border-amber-300' : ''}`}
                    >
                      {/* Image / icon */}
                      <div className="relative h-28 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center overflow-hidden">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.product_name}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <Package className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                        )}

                        {/* In-cart badge */}
                        {inCart > 0 && (
                          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-amber-500 shadow-lg shadow-amber-500/40
                            flex items-center justify-center">
                            <span className="text-[10px] font-black text-white">{inCart}</span>
                          </div>
                        )}

                        {/* Stock badge */}
                        <div className={`absolute bottom-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${stockBadge(product.stock_quantity)}`}>
                          {product.stock_quantity}
                        </div>

                        {/* No PMS badge */}
                        {product.erbon_service_id === null && (
                          <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-amber-500/90 flex items-center justify-center"
                            title="Sem mapeamento PMS — não lançará no Erbon">
                            <AlertCircle className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex flex-col flex-1 p-3 gap-2">
                        <p className="text-xs font-semibold text-slate-800 dark:text-white leading-snug line-clamp-2">
                          {product.product_name}
                        </p>

                        {/* Price */}
                        {product.sale_price === 0 ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700
                            text-slate-500 dark:text-slate-400 font-medium self-start">
                            Sem preço
                          </span>
                        ) : (
                          <span className="text-base font-black text-slate-900 dark:text-white tabular-nums font-mono leading-none">
                            {fmtBRL(product.sale_price)}
                          </span>
                        )}

                        {/* Add button — min 44px height */}
                        <button
                          onClick={() => !outOfStock && addToCart(product)}
                          disabled={outOfStock}
                          className={`mt-auto w-full h-11 flex items-center justify-center gap-1.5 rounded-xl
                            text-xs font-bold transition-all duration-150 active:scale-95
                            ${inCart > 0
                              ? 'bg-amber-500 hover:bg-amber-400 text-white shadow-md shadow-amber-500/30'
                              : 'bg-slate-900 dark:bg-slate-700 hover:bg-amber-500 text-white dark:hover:bg-amber-500'
                            }
                            disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
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
        </main>
      </div>

      {/* ══ CONFIRM MODAL ════════════════════════════════════════════════════ */}
      <Modal
        isOpen={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title={`Confirmar — UH ${selectedBooking?.roomDescription ?? ''}`}
        size="xl"
      >
        {selectedBooking && sectorDetails && (
          <div className="space-y-4">
            {/* Info grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Hóspede', value: selectedBooking.guestName },
                { label: 'Reserva', value: `#${selectedBooking.bookingNumber}` },
                { label: 'Setor', value: sectorDetails.sector_name + (sectorDetails.erbon_department ? ` — ${sectorDetails.erbon_department}` : '') },
                { label: 'Operador', value: user?.full_name || user?.email || 'Operador' },
              ].map(({ label, value }) => (
                <div key={label} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-0.5">{label}</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{value}</p>
                </div>
              ))}
            </div>

            {/* Items */}
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
                    <tr
                      key={item.product_id}
                      className={item.erbon_service_id === null
                        ? 'bg-amber-50/60 dark:bg-amber-900/10'
                        : 'bg-white dark:bg-slate-800/40'
                      }
                    >
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
                    <td className="px-4 py-3 text-right font-black text-amber-400 text-lg font-mono tabular-nums">
                      {fmtBRL(cartTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Warning */}
            {cartHasUnmappedItems && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Itens em amarelo não possuem mapeamento Erbon — serão registrados localmente mas <strong>não lançados no PMS</strong>.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
                className="px-5 py-2.5 text-sm rounded-xl border border-slate-300 dark:border-slate-600
                  text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700
                  transition-all duration-150 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmitSale}
                disabled={submitting}
                className="flex items-center gap-2 px-6 py-2.5 text-sm rounded-xl font-bold text-white
                  bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400
                  shadow-lg shadow-amber-500/20 disabled:opacity-50
                  transition-all duration-150 active:scale-[0.98]"
              >
                {submitting && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {submitting ? 'Processando…' : 'Confirmar e Lançar'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ══ RECEIPT MODAL ═════════════════════════════════════════════════════ */}
      <Modal
        isOpen={receiptSale !== null}
        onClose={resetSale}
        title="Comprovante de Venda"
        size="lg"
      >
        {receiptSale && (
          <div className="space-y-4">
            {/* Status banner */}
            <div className={`flex items-center gap-4 p-4 rounded-2xl border
              ${receiptSale.erbonPosted
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50'
                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50'
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0
                ${receiptSale.erbonPosted
                  ? 'bg-emerald-100 dark:bg-emerald-900/40'
                  : 'bg-amber-100 dark:bg-amber-900/40'
                }`}
              >
                {receiptSale.erbonPosted
                  ? <CheckCircle className="w-7 h-7 text-emerald-500" />
                  : <AlertTriangle className="w-7 h-7 text-amber-500" />
                }
              </div>
              <div>
                <p className={`font-bold text-base ${receiptSale.erbonPosted ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {receiptSale.erbonPosted ? 'Venda Concluída com Sucesso' : 'Venda Salva — Avisos PMS'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                  ID #{receiptSale.saleId.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-slate-400">Total</p>
                <p className="font-black text-xl text-slate-900 dark:text-white font-mono tabular-nums">
                  {fmtBRL(receiptSale.totalAmount)}
                </p>
              </div>
            </div>

            {/* Sale details */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: 'Data / Hora', value: new Date().toLocaleString('pt-BR') },
                { label: 'UH', value: `${selectedBooking?.roomDescription} — ${selectedBooking?.guestName}` },
                { label: 'Setor', value: sectorDetails?.sector_name || '—' },
                { label: 'Operador', value: user?.full_name || user?.email || 'Operador' },
              ].map(({ label, value }) => (
                <div key={label} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-0.5">{label}</p>
                  <p className="text-xs font-semibold text-slate-800 dark:text-white truncate">{value}</p>
                </div>
              ))}
            </div>

            {/* Items with PMS status */}
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
                        <td className="px-3 py-2.5 text-right font-bold text-slate-800 dark:text-white font-mono tabular-nums">
                          {fmtBRL(item.unit_price * item.quantity)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {item.erbon_service_id === null
                            ? <span className="text-slate-400 text-xs">—</span>
                            : posted
                            ? <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />
                            : <AlertTriangle className="w-4 h-4 text-amber-500 mx-auto" />
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Erbon errors detail */}
            {receiptSale.erbonErrors.length > 0 && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 p-3 space-y-1.5">
                <p className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" />
                  {receiptSale.erbonErrors.length} erro(s) no PMS
                </p>
                {receiptSale.erbonErrors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400 pl-5">
                    <span className="font-semibold">{e.productName}:</span> {e.error}
                  </p>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                {receiptSale.erbonErrors.length > 0 && (
                  <button
                    onClick={handleRetryErbon}
                    disabled={retrying}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-semibold
                      border border-amber-300 dark:border-amber-700
                      text-amber-700 dark:text-amber-400
                      hover:bg-amber-50 dark:hover:bg-amber-900/20
                      disabled:opacity-50 transition-all duration-150 active:scale-95"
                  >
                    {retrying
                      ? <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      : <RotateCcw className="w-4 h-4" />
                    }
                    Retentar PMS
                  </button>
                )}
                <button
                  onClick={() => navigate('/pdv/history')}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium
                    border border-slate-300 dark:border-slate-600
                    text-slate-600 dark:text-slate-400
                    hover:bg-slate-50 dark:hover:bg-slate-700
                    transition-all duration-150 active:scale-95"
                >
                  <History className="w-4 h-4" />
                  Histórico
                </button>
              </div>

              <button
                onClick={resetSale}
                className="flex items-center gap-2 px-6 py-2.5 text-sm rounded-xl font-bold text-white
                  bg-gradient-to-r from-amber-500 to-orange-500
                  hover:from-amber-400 hover:to-orange-400
                  shadow-lg shadow-amber-500/20
                  transition-all duration-150 active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                Nova Venda
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PDV;
