// src/pages/pdv/PDV.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Search, Trash2, Plus, Minus, Package,
  RefreshCw, AlertTriangle, CheckCircle, XCircle, ChevronRight,
  Users, AlertCircle, RotateCcw, History, X,
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
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

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
    return bookingGroups.filter(
      b =>
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

  const cartHasUnmappedItems = cart.some(i => i.erbon_service_id === null);

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedHotel) return;

    // Load sectors
    getSectorsForPDV(selectedHotel.id)
      .then(s => {
        setSectors(s);
        if (s.length > 0 && !selectedSectorId) {
          setSelectedSectorId(s[0].sector_id);
        }
      })
      .catch(err => addNotification('error', `Erro ao carregar setores: ${err.message}`));

    // Load in-house guests
    setGuestsLoading(true);
    erbonService
      .fetchInHouseGuests(selectedHotel.id)
      .then(guests => setInHouseGuests(guests))
      .catch((err: any) => {
        const msg: string = err?.message || '';
        if (
          msg.toLowerCase().includes('not configured') ||
          msg.toLowerCase().includes('não configurado') ||
          msg.toLowerCase().includes('sem configuração')
        ) {
          setErbonConfigured(false);
        } else {
          addNotification('error', `Erro ao buscar hóspedes: ${msg}`);
        }
      })
      .finally(() => setGuestsLoading(false));
  }, [selectedHotel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedHotel || !selectedSectorId) {
      setProducts([]);
      setSectorDetails(null);
      return;
    }
    setProductsLoading(true);
    setSelectedCategory('Todos');

    Promise.all([
      getProductsForSector(selectedHotel.id, selectedSectorId),
      getSectorDetails(selectedHotel.id, selectedSectorId),
    ])
      .then(([prods, details]) => {
        setProducts(prods);
        setSectorDetails(details);
      })
      .catch(err => addNotification('error', `Erro ao carregar produtos: ${err.message}`))
      .finally(() => setProductsLoading(false));
  }, [selectedSectorId, selectedHotel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowBookingDropdown(false);
      }
    }
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
      return [
        ...prev,
        {
          product_id: product.product_id,
          product_name: product.product_name,
          quantity: 1,
          unit_price: product.sale_price,
          stock_quantity: product.stock_quantity,
          erbon_service_id: product.erbon_service_id,
          erbon_service_description: product.erbon_service_description,
        },
      ];
    });
  }

  function updateCartQty(productId: string, qty: number) {
    if (qty <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart(prev =>
      prev.map(i =>
        i.product_id === productId ? { ...i, quantity: Math.min(qty, i.stock_quantity) } : i
      )
    );
  }

  function updateCartPrice(productId: string, price: number) {
    setCart(prev =>
      prev.map(i =>
        i.product_id === productId ? { ...i, unit_price: Math.max(0, price) } : i
      )
    );
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(i => i.product_id !== productId));
  }

  // ── Sale flow ──────────────────────────────────────────────────────────

  function handleConfirm() {
    if (!selectedBooking) {
      addNotification('error', 'Selecione uma reserva (UH)');
      return;
    }
    if (!selectedSectorId) {
      addNotification('error', 'Selecione um setor');
      return;
    }
    if (cart.length === 0) {
      addNotification('error', 'Adicione itens ao carrinho');
      return;
    }
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
        addNotification(
          'success',
          `Venda lançada na UH ${selectedBooking.roomDescription}`
        );
      } else if (result.erbonErrors.length > 0) {
        addNotification(
          'warning',
          `Venda salva, mas ${result.erbonErrors.length} item(s) não lançado(s) no PMS`
        );
      }
    } catch (err: any) {
      addNotification('error', `Erro: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetryErbon() {
    if (!receiptSale || !selectedHotel) return;
    setRetrying(true);
    try {
      await retryErbonPosting(receiptSale.saleId, selectedHotel.id);
      addNotification('success', 'Reenvio ao PMS realizado com sucesso');
      setReceiptSale(prev =>
        prev ? { ...prev, erbonPosted: true, erbonErrors: [] } : prev
      );
    } catch (err: any) {
      addNotification('error', `Erro no reenvio: ${err.message}`);
    } finally {
      setRetrying(false);
    }
  }

  function resetSale() {
    setCart([]);
    setSelectedBooking(null);
    setBookingSearch('');
    setReceiptSale(null);
  }

  // ── Render helpers ─────────────────────────────────────────────────────

  function getStockBadgeClass(qty: number) {
    if (qty < 3) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    if (qty < 6) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  }

  if (!erbonConfigured) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-gray-900">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <ShoppingCart className="w-6 h-6 text-amber-500" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            PDV — Ponto de Venda
          </h1>
          {selectedHotel && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              — {selectedHotel.name}
            </span>
          )}
        </div>
        <ErbonNotConfigured hotelName={selectedHotel?.name} />
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-gray-900">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-6 h-6 text-amber-500" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            PDV — Ponto de Venda
          </h1>
          {selectedHotel && (
            <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">
              — {selectedHotel.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
            <Users className="w-4 h-4" />
            {guestsLoading ? (
              <span className="text-gray-400">...</span>
            ) : (
              <span className="font-semibold">{bookingGroups.length}</span>
            )}
            <span className="hidden sm:inline text-gray-400">hóspedes in-house</span>
          </div>
          <button
            onClick={() => {
              if (!selectedHotel) return;
              setGuestsLoading(true);
              erbonService
                .fetchInHouseGuests(selectedHotel.id)
                .then(g => setInHouseGuests(g))
                .catch(() => {})
                .finally(() => setGuestsLoading(false));
            }}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Atualizar hóspedes"
          >
            <RefreshCw className={`w-4 h-4 ${guestsLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => navigate('/pdv/history')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <History className="w-4 h-4" />
            <span className="hidden sm:inline">Histórico</span>
          </button>
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden gap-0">

        {/* ════════════════════════════════════════
            LEFT PANEL — 38%
        ════════════════════════════════════════ */}
        <div className="w-[38%] flex flex-col border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">

          {/* Booking selector */}
          <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">
              UH / Reserva
            </p>

            {selectedBooking ? (
              /* Selected booking chip */
              <div className="flex items-start gap-3 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-green-500 dark:bg-green-600 flex items-center justify-center text-white font-bold text-sm leading-tight text-center">
                  {selectedBooking.roomDescription}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                    {selectedBooking.guestName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Reserva #{selectedBooking.bookingNumber}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Out: {fmtDate(selectedBooking.checkOutDate)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedBooking(null);
                    setBookingSearch('');
                  }}
                  className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* Search input + dropdown */
              <div ref={searchRef} className="relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={bookingSearch}
                    onChange={e => {
                      setBookingSearch(e.target.value);
                      setShowBookingDropdown(true);
                    }}
                    onFocus={() => setShowBookingDropdown(true)}
                    placeholder="Buscar UH, hóspede ou nº reserva..."
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:focus:ring-amber-500"
                  />
                </div>

                {showBookingDropdown && filteredBookings.length > 0 && (
                  <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                    {filteredBookings.map(b => (
                      <button
                        key={b.bookingInternalId}
                        onClick={() => {
                          setSelectedBooking(b);
                          setBookingSearch('');
                          setShowBookingDropdown(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors text-left"
                      >
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-500 flex items-center justify-center text-white font-bold text-xs text-center leading-tight">
                          {b.roomDescription}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            UH {b.roomDescription}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {b.guestName}
                          </p>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">
                          Out: {fmtDate(b.checkOutDate)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {showBookingDropdown && bookingSearch.trim() && filteredBookings.length === 0 && (
                  <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl px-4 py-3 text-sm text-gray-400 text-center">
                    Nenhuma reserva encontrada
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">
              Carrinho
            </p>

            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500">
                <ShoppingCart className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm">Adicione itens ao carrinho</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map(item => (
                  <div
                    key={item.product_id}
                    className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight flex-1 min-w-0 truncate">
                        {item.product_name}
                      </p>
                      <button
                        onClick={() => removeFromCart(item.product_id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Qty stepper */}
                      <div className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
                        <button
                          onClick={() => updateCartQty(item.product_id, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-semibold text-gray-900 dark:text-white w-6 text-center">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateCartQty(item.product_id, item.quantity + 1)}
                          disabled={item.quantity >= item.stock_quantity}
                          className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Price input */}
                      <div className="flex items-center gap-1 flex-1">
                        <span className="text-xs text-gray-400">R$</span>
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
                          className="w-full text-xs border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      </div>

                      {/* Line total */}
                      <span className="text-xs font-bold text-gray-900 dark:text-white shrink-0">
                        {fmtBRL(item.unit_price * item.quantity)}
                      </span>
                    </div>

                    {item.erbon_service_id === null && (
                      <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Sem mapeamento PMS
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
            {sectorDetails?.erbon_department_id === null && cart.length > 0 && (
              <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Setor sem ID Erbon — não será lançado no PMS
                </p>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {fmtBRL(cartTotal)}
                </p>
              </div>
              {cart.length > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold">
                  {cart.reduce((s, i) => s + i.quantity, 0)} itens
                </span>
              )}
            </div>

            <button
              onClick={handleConfirm}
              disabled={cart.length === 0 || !selectedBooking}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              Lançar na UH
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ════════════════════════════════════════
            RIGHT PANEL — 62%
        ════════════════════════════════════════ */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-800">

          {/* Sector tabs */}
          <div className="flex items-center border-b border-gray-200 dark:border-gray-700 shrink-0 overflow-x-auto">
            {sectors.map(sector => (
              <button
                key={sector.sector_id}
                onClick={() => setSelectedSectorId(sector.sector_id)}
                className={`relative flex items-center gap-1.5 px-5 py-3.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors
                  ${
                    selectedSectorId === sector.sector_id
                      ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  }`}
              >
                {sector.sector_name}
                {sector.erbon_department_id === null && (
                  <span
                    className="w-2 h-2 rounded-full bg-amber-400 shrink-0"
                    title="Setor sem ID Erbon"
                  />
                )}
              </button>
            ))}
            {sectors.length === 0 && (
              <span className="px-5 py-3.5 text-sm text-gray-400">
                Nenhum setor configurado
              </span>
            )}
          </div>

          {/* Category pills */}
          {categories.length > 1 && (
            <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto shrink-0 border-b border-gray-100 dark:border-gray-700">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors
                    ${
                      selectedCategory === cat
                        ? 'bg-amber-500 text-white'
                        : 'bg-transparent border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-amber-400 hover:text-amber-600'
                    }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {productsLoading ? (
              <div className="flex items-center justify-center h-40">
                <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !selectedSectorId ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500">
                <Package className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm">Selecione um setor para ver os produtos</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500">
                <Package className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm">Nenhum produto em estoque neste setor</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(product => {
                  const cartItem = cart.find(i => i.product_id === product.product_id);
                  const inCart = cartItem?.quantity ?? 0;
                  const outOfStock = product.stock_quantity === 0;

                  return (
                    <div
                      key={product.product_id}
                      className={`flex flex-col rounded-xl border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 overflow-hidden transition-all
                        ${outOfStock ? 'opacity-50' : 'hover:shadow-md hover:border-amber-300 dark:hover:border-amber-600'}`}
                    >
                      {/* Image / icon area */}
                      <div className="h-24 bg-gray-100 dark:bg-gray-800 flex items-center justify-center overflow-hidden">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.product_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Package className="w-10 h-10 text-gray-300 dark:text-gray-600" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex flex-col flex-1 p-2.5 gap-1.5">
                        <p className="text-xs font-semibold text-gray-900 dark:text-white leading-tight line-clamp-2">
                          {product.product_name}
                        </p>

                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 self-start">
                          {product.category}
                        </span>

                        <div className="flex items-center justify-between gap-1">
                          {product.sale_price === 0 ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                              Sem preço
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-green-600 dark:text-green-400">
                              {fmtBRL(product.sale_price)}
                            </span>
                          )}

                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getStockBadgeClass(product.stock_quantity)}`}>
                            {product.stock_quantity}
                          </span>
                        </div>

                        {product.erbon_service_id === null && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                            <AlertCircle className="w-3 h-3" />
                            Sem PMS
                          </span>
                        )}

                        {/* Add button */}
                        <button
                          onClick={() => !outOfStock && addToCart(product)}
                          disabled={outOfStock}
                          className="mt-auto w-full flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-colors
                            bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Plus className="w-3 h-3" />
                          Adicionar
                          {inCart > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-500 text-white text-[10px] font-bold">
                              {inCart}
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════
          CONFIRM MODAL
      ════════════════════════════════════════ */}
      <Modal
        isOpen={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title={`Confirmar Venda — UH ${selectedBooking?.roomDescription ?? ''}`}
        size="xl"
      >
        {selectedBooking && sectorDetails && (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-xs text-gray-400 mb-0.5">Hóspede</p>
                <p className="font-semibold text-gray-900 dark:text-white">{selectedBooking.guestName}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-xs text-gray-400 mb-0.5">Reserva</p>
                <p className="font-semibold text-gray-900 dark:text-white">#{selectedBooking.bookingNumber}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-xs text-gray-400 mb-0.5">Setor</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {sectorDetails.sector_name}
                  {sectorDetails.erbon_department && (
                    <span className="text-gray-400 font-normal"> — {sectorDetails.erbon_department}</span>
                  )}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-xs text-gray-400 mb-0.5">Operador</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {user?.full_name || user?.email || 'Operador'}
                </p>
              </div>
            </div>

            {/* Items table */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Produto</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Qtd</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Preço Unit.</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {cart.map(item => (
                    <tr
                      key={item.product_id}
                      className={item.erbon_service_id === null
                        ? 'bg-amber-50 dark:bg-amber-900/10'
                        : 'bg-white dark:bg-gray-800'
                      }
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-gray-900 dark:text-white">{item.product_name}</p>
                        {item.erbon_service_id === null && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                            <AlertTriangle className="w-3 h-3" />
                            Não lançado no PMS
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-700 dark:text-gray-300">{item.quantity}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700 dark:text-gray-300">{fmtBRL(item.unit_price)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-900 dark:text-white">
                        {fmtBRL(item.unit_price * item.quantity)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 dark:bg-gray-700/50 font-bold">
                    <td className="px-3 py-2.5 text-gray-900 dark:text-white" colSpan={3}>Total</td>
                    <td className="px-3 py-2.5 text-right text-gray-900 dark:text-white text-base">
                      {fmtBRL(cartTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Warning if any items unmapped */}
            {cartHasUnmappedItems && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Alguns itens não possuem mapeamento Erbon e não serão lançados no PMS.
                  A venda será registrada normalmente no sistema.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmitSale}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 transition-all"
              >
                {submitting && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Confirmar e Lançar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ════════════════════════════════════════
          RECEIPT MODAL
      ════════════════════════════════════════ */}
      <Modal
        isOpen={receiptSale !== null}
        onClose={resetSale}
        title="Resultado da Venda"
        size="lg"
      >
        {receiptSale && (
          <div className="space-y-4">
            {/* Status banner */}
            <div
              className={`flex items-center gap-3 p-4 rounded-xl
                ${receiptSale.erbonPosted
                  ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                  : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                }`}
            >
              {receiptSale.erbonPosted ? (
                <CheckCircle className="w-8 h-8 text-green-500 shrink-0" />
              ) : (
                <AlertTriangle className="w-8 h-8 text-amber-500 shrink-0" />
              )}
              <div>
                <p className={`font-bold text-base ${receiptSale.erbonPosted ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {receiptSale.erbonPosted ? 'Venda Concluída' : 'Venda Salva com Avisos'}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  ID da venda: {receiptSale.saleId.slice(0, 8).toUpperCase()}
                </p>
              </div>
            </div>

            {/* Sale info */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-gray-400">Data/Hora</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {new Date().toLocaleString('pt-BR')}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">UH</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {selectedBooking?.roomDescription} — {selectedBooking?.guestName}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Setor</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {sectorDetails?.sector_name}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Total</p>
                <p className="font-bold text-gray-900 dark:text-white">
                  {fmtBRL(receiptSale.totalAmount)}
                </p>
              </div>
            </div>

            {/* Items with PMS status */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Produto</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Qtd</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Total</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">PMS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {cart.map(item => {
                    const hasError = receiptSale.erbonErrors.some(e => e.productName === item.product_name);
                    const posted = item.erbon_service_id !== null && !hasError && receiptSale.erbonPosted;
                    return (
                      <tr key={item.product_id} className="bg-white dark:bg-gray-800">
                        <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{item.product_name}</td>
                        <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{item.quantity}</td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{fmtBRL(item.unit_price * item.quantity)}</td>
                        <td className="px-3 py-2 text-center">
                          {item.erbon_service_id === null ? (
                            <span className="text-gray-400" title="Sem mapeamento PMS">—</span>
                          ) : posted ? (
                            <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-500 mx-auto" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Erbon errors */}
            {receiptSale.erbonErrors.length > 0 && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 space-y-1.5">
                <p className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" />
                  Erros no PMS ({receiptSale.erbonErrors.length})
                </p>
                {receiptSale.erbonErrors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400">
                    <span className="font-medium">{e.productName}:</span> {e.error}
                  </p>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                {receiptSale.erbonErrors.length > 0 && (
                  <button
                    onClick={handleRetryErbon}
                    disabled={retrying}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50"
                  >
                    {retrying ? (
                      <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4" />
                    )}
                    Retentar PMS
                  </button>
                )}
                <button
                  onClick={() => navigate('/pdv/history')}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <History className="w-4 h-4" />
                  Ver Histórico
                </button>
              </div>
              <button
                onClick={resetSale}
                className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 transition-all"
              >
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
