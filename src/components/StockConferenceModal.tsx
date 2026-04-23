// src/components/StockConferenceModal.tsx
// Mobile-first redesign — touch targets ≥44px, 2-row product cards,
// stepper largo, chevrons grandes, sub-modais polidos para mobile.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  X, Search, CheckCircle2, Save, ListChecks, AlertCircle,
  Camera, Barcode, Plus, ZapOff, Package, ChevronLeft, ChevronRight,
  Loader2, Check,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNotification } from '../context/NotificationContext';
import BarcodeScanner from './BarcodeScanner';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

interface Product {
  id: string;
  name: string;
  category: string;
  quantity: number;
  image_url?: string | null;
}

interface StockConferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  hotelId: string;
  sectorId?: string;
  onFinished: () => void;
}

// ── Stepper de quantidade — mobile-first (touch targets ≥44px) ───────────────
// onNext: chamado ao pressionar Enter — foca o próximo campo da lista
const QtyInput: React.FC<{
  value: number | undefined;
  onChange: (v: string) => void;
  current: number;
  inputRef?: React.RefCallback<HTMLInputElement>;
  onNext?: () => void;
}> = ({ value, onChange, inputRef, onNext }) => {
  const [raw, setRaw] = useState(value !== undefined ? String(value) : '');

  useEffect(() => {
    setRaw(value !== undefined ? String(value) : '');
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Next') {
      e.preventDefault();
      onNext?.();
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Botão − : 44×44px mínimo */}
      <button
        type="button"
        onClick={() => { const v = Math.max(0, (value ?? 0) - 1); onChange(String(v)); }}
        style={{ touchAction: 'manipulation' }}
        className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300
          hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400
          active:scale-95 font-bold transition-all flex items-center justify-center text-xl leading-none select-none"
      >
        −
      </button>

      {/* Input central: altura 44px, texto maior, Enter navega para o próximo */}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        enterKeyHint="next"
        value={raw}
        onChange={e => { setRaw(e.target.value); onChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        placeholder="—"
        className="w-16 h-11 text-center text-base font-bold rounded-xl border border-slate-200 dark:border-slate-600
          bg-white dark:bg-slate-800 text-slate-800 dark:text-white
          focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
      />

      {/* Botão + : 44×44px mínimo */}
      <button
        type="button"
        onClick={() => { const v = (value ?? 0) + 1; onChange(String(v)); }}
        style={{ touchAction: 'manipulation' }}
        className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300
          hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600 dark:hover:text-emerald-400
          active:scale-95 font-bold transition-all flex items-center justify-center text-xl leading-none select-none"
      >
        +
      </button>
    </div>
  );
};

// ── Componente principal ───────────────────────────────────────────────────────

const StockConferenceModal: React.FC<StockConferenceModalProps> = ({
  isOpen, onClose, products, hotelId, sectorId, onFinished,
}) => {
  const { addNotification } = useNotification();
  // Mapa de refs dos inputs de quantidade para navegação por Enter
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Long-press tooltip (1s) — exibe nome completo do produto truncado
  const [pressTooltip, setPressTooltip] = useState<string | null>(null);
  const pressTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNameTooltip = (name: string) => {
    setPressTooltip(name);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setPressTooltip(null), 3000);
  };

  const startPressTimer = (name: string) => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => showNameTooltip(name), 900);
  };

  const cancelPressTimer = () => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
  };

  const [searchTerm, setSearchTerm]       = useState('');
  const [counts, setCounts]               = useState<Record<string, number>>({});
  const [currentCatIdx, setCurrentCatIdx] = useState(0);
  const [isSaving, setIsSaving]           = useState(false);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);

  const [showScanner,            setShowScanner]            = useState(false);
  const [scanProduct,            setScanProduct]            = useState<Product | null>(null);
  const [scanQty,                setScanQty]                = useState('1');
  const [scanNotFound,           setScanNotFound]           = useState<string | null>(null);
  const [registerBarcodeProduct, setRegisterBarcodeProduct] = useState<Product | null>(null);
  const [productBarcodes,        setProductBarcodes]        = useState<Record<string, string[]>>({});
  const [imgErrors,              setImgErrors]              = useState<Record<string, boolean>>({});

  // ── Categorias ──────────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category || 'Sem Categoria'))).sort();
    return cats;
  }, [products]);

  const currentCategory = categories[currentCatIdx];
  const totalProducts   = products.length;
  const countedProducts = Object.keys(counts).length;
  const progressPct     = totalProducts > 0 ? Math.round((countedProducts / totalProducts) * 100) : 0;

  const fillRemainingWithZero = () => {
    const next = { ...counts };
    products.forEach(p => { if (next[p.id] === undefined) next[p.id] = 0; });
    setCounts(next);
  };

  const filteredProducts = useMemo(() => {
    if (searchTerm) {
      return products.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.category || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return products.filter(p => (p.category || 'Sem Categoria') === currentCategory);
  }, [products, currentCategory, searchTerm]);

  // Auto-barcode no searchTerm
  useEffect(() => {
    if (!searchTerm || searchTerm.trim().length < 4) return;
    const nameMatches = products.some(p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.category || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (nameMatches) return;
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('product_barcodes').select('product_id').eq('barcode', searchTerm.trim()).maybeSingle();
      if (data) {
        const found = products.find(p => p.id === data.product_id);
        if (found) { setSearchTerm(''); setScanProduct(found); setScanQty('1'); }
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [searchTerm, products]);

  useEffect(() => {
    if (isOpen) {
      checkExistingDraft();
      loadProductBarcodes();
    } else {
      setCounts({}); setSearchTerm(''); setCurrentCatIdx(0);
      setActiveCountId(null); setProductBarcodes({}); setImgErrors({});
    }
  }, [isOpen, hotelId, sectorId]);

  const checkExistingDraft = async () => {
    setIsLoadingDraft(true);
    try {
      let query = supabase.from('stock_counts')
        .select('id, items:stock_count_items(product_id, counted_quantity)')
        .eq('hotel_id', hotelId).eq('status', 'draft');
      if (sectorId) query = query.eq('sector_id', sectorId);
      else query = query.is('sector_id', null);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (data) {
        const draftCounts: Record<string, number> = {};
        data.items.forEach((item: any) => { draftCounts[item.product_id] = item.counted_quantity; });
        setCounts(draftCounts);
        setActiveCountId(data.id);
        addNotification('Rascunho de conferência retomado.', 'info');
      }
    } catch (err) { console.error('Erro ao buscar rascunho:', err); }
    finally { setIsLoadingDraft(false); }
  };

  const loadProductBarcodes = async () => {
    const ids = products.map(p => p.id);
    if (!ids.length) return;
    const { data } = await supabase.from('product_barcodes').select('product_id, barcode').in('product_id', ids);
    if (data) {
      const map: Record<string, string[]> = {};
      data.forEach((r: any) => { if (!map[r.product_id]) map[r.product_id] = []; map[r.product_id].push(r.barcode); });
      setProductBarcodes(map);
    }
  };

  const handleRegisterBarcode = useCallback(async (barcode: string) => {
    if (!registerBarcodeProduct) return;
    const { data: existing } = await supabase.from('product_barcodes').select('id, product_id').eq('barcode', barcode).maybeSingle();
    if (existing) {
      const ep = products.find(p => p.id === existing.product_id);
      addNotification(`Código já vinculado a "${ep?.name || 'outro produto'}".`, 'error');
      setRegisterBarcodeProduct(null); return;
    }
    const { error } = await supabase.from('product_barcodes').insert({ product_id: registerBarcodeProduct.id, barcode });
    if (error) addNotification('Erro ao cadastrar código.', 'error');
    else {
      addNotification(`Código cadastrado em "${registerBarcodeProduct.name}"!`, 'success');
      setProductBarcodes(prev => ({ ...prev, [registerBarcodeProduct.id]: [...(prev[registerBarcodeProduct.id] || []), barcode] }));
    }
    setRegisterBarcodeProduct(null);
  }, [registerBarcodeProduct, products, addNotification]);

  const handleLinkBarcodeToProduct = async (product: Product) => {
    if (!scanNotFound) return;
    const { error } = await supabase.from('product_barcodes').insert({ product_id: product.id, barcode: scanNotFound });
    if (error) addNotification('Erro ao vincular código.', 'error');
    else {
      addNotification(`Código vinculado a "${product.name}"!`, 'success');
      setProductBarcodes(prev => ({ ...prev, [product.id]: [...(prev[product.id] || []), scanNotFound!] }));
    }
    setScanNotFound(null);
  };

  const handleCountChange = (productId: string, value: string) => {
    const n = parseFloat(value);
    if (!isNaN(n)) setCounts(prev => ({ ...prev, [productId]: n }));
    else if (value === '') setCounts(prev => { const next = { ...prev }; delete next[productId]; return next; });
  };

  const handleBarcodeScan = useCallback(async (barcode: string) => {
    setScanNotFound(null);
    const { data, error } = await supabase.from('product_barcodes').select('product_id').eq('barcode', barcode).maybeSingle();
    if (error || !data) { setScanNotFound(barcode); setShowScanner(false); return; }
    const found = products.find(p => p.id === data.product_id);
    if (!found) { setScanNotFound(barcode); setShowScanner(false); return; }
    setShowScanner(false); setScanProduct(found); setScanQty('1');
  }, [products]);

  const handleConfirmScanQty = () => {
    if (!scanProduct) return;
    const qty = parseFloat(scanQty);
    if (isNaN(qty) || qty <= 0) return;
    const newTotal = (counts[scanProduct.id] || 0) + qty;
    setCounts(prev => ({ ...prev, [scanProduct.id]: newTotal }));
    addNotification(`${scanProduct.name}: total → ${newTotal}`, 'success');
    setScanProduct(null); setScanQty('1');
  };

  const saveProgress = async (isFinal: boolean) => {
    if (Object.keys(counts).length === 0) { addNotification('Informe pelo menos uma quantidade.', 'warning'); return; }
    setIsSaving(true);
    try {
      let countId = activeCountId;
      if (!countId) {
        const { data: nc, error: ce } = await supabase.from('stock_counts').insert({
          hotel_id: hotelId, sector_id: sectorId || null,
          status: isFinal ? 'finished' : 'draft',
          started_at: new Date().toISOString(),
          finished_at: isFinal ? new Date().toISOString() : null,
          notes: sectorId ? 'Conferência de Setor' : 'Conferência de Inventário Principal',
        }).select().single();
        if (ce) throw ce;
        countId = nc.id; setActiveCountId(countId);
      } else {
        const { error: ue } = await supabase.from('stock_counts').update({
          status: isFinal ? 'finished' : 'draft', finished_at: isFinal ? new Date().toISOString() : null,
        }).eq('id', countId);
        if (ue) throw ue;
      }

      const countItems = Object.entries(counts).map(([productId, countedQty]) => ({
        stock_count_id: countId,
        product_id: productId,
        previous_quantity: products.find(p => p.id === productId)?.quantity || 0,
        counted_quantity: countedQty,
      }));

      const { error: de } = await supabase.from('stock_count_items').delete().eq('stock_count_id', countId!);
      if (de) throw de;
      const { error: ie } = await supabase.from('stock_count_items').insert(countItems);
      if (ie) throw ie;

      if (isFinal) {
        for (const [productId, newQty] of Object.entries(counts)) {
          if (sectorId) {
            const { error: se } = await supabase.from('sector_stock').update({ quantity: newQty }).eq('sector_id', sectorId).eq('product_id', productId);
            if (se) throw se;
          } else {
            const { error: pe } = await supabase.from('products').update({ quantity: newQty }).eq('id', productId);
            if (pe) throw pe;
          }
        }
        addNotification('Conferência finalizada e estoque atualizado!', 'success');
        onFinished(); onClose();
      } else {
        addNotification('Progresso salvo como rascunho.', 'success');
      }
    } catch (err: any) {
      addNotification('Erro ao salvar: ' + (err.message || 'Erro desconhecido'), 'error');
    } finally { setIsSaving(false); }
  };

  useBarcodeScanner({
    onScan: (barcode: string) => {
      if (registerBarcodeProduct) handleRegisterBarcode(barcode);
      else handleBarcodeScan(barcode);
    },
    enabled: isOpen && !showScanner,
  });

  if (!isOpen) return null;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── overlay — bottom-sheet em mobile, centrado em desktop ─────────── */}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: '96dvh' }}>

          {/* ── Header compacto — título + ações + progresso inline ──────── */}
          <div className="flex-shrink-0 bg-indigo-600 dark:bg-indigo-700">
            {/* Linha 1: título + botões de ação */}
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <ListChecks className="w-4 h-4 text-white/80 shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white leading-tight truncate">Conferência de Estoque</h2>
                  <p className="text-[10px] text-indigo-200 leading-tight">{sectorId ? 'Setor Selecionado' : 'Inventário Principal'}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Progresso compacto inline */}
                <span className="text-xs font-bold text-white/90 tabular-nums mr-1">
                  {countedProducts}/{totalProducts}
                  {progressPct === 100 && <span className="ml-1 text-emerald-300">✓</span>}
                </span>

                {/* Preencher com 0 */}
                <button
                  onClick={fillRemainingWithZero}
                  disabled={countedProducts === totalProducts}
                  style={{ touchAction: 'manipulation' }}
                  title="Preencher não contados com 0"
                  className="h-8 flex items-center gap-1 px-2 rounded-lg bg-amber-500 text-white text-xs font-semibold
                    hover:bg-amber-600 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ZapOff className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Preencher 0</span>
                </button>

                {/* Escanear */}
                <button
                  onClick={() => { setScanNotFound(null); setShowScanner(true); }}
                  style={{ touchAction: 'manipulation' }}
                  className="h-8 flex items-center gap-1 px-2 rounded-lg bg-white/20 text-white text-xs font-semibold
                    hover:bg-white/30 active:scale-95 transition-all"
                >
                  <Camera className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Escanear</span>
                </button>

                {/* Fechar */}
                <button
                  onClick={onClose}
                  style={{ touchAction: 'manipulation' }}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-white/70
                    hover:text-white hover:bg-white/20 active:scale-95 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Linha 2: barra de progresso slim */}
            <div className="px-3 pb-2">
              <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progressPct}%`,
                    background: progressPct === 100 ? '#4ade80' : 'rgba(255,255,255,0.9)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* ── Search + Category pills compactos ───────────────────────── */}
          <div className="flex-shrink-0 px-3 pt-2 pb-2 space-y-2 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900">
            {/* Busca — altura 40px no mobile, mais compacto */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar produto…"
                className="w-full h-10 pl-9 pr-9 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200
                  dark:border-slate-600 text-slate-800 dark:text-white placeholder-slate-400 text-sm
                  focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  style={{ touchAction: 'manipulation' }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center
                    text-slate-400 hover:text-slate-600 transition-colors rounded-lg"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Category pills — scroll horizontal, pills menores no mobile */}
            {!searchTerm && categories.length > 0 && (
              <div className="flex items-center gap-1">
                {/* Chevron esquerda */}
                <button
                  onClick={() => setCurrentCatIdx(i => Math.max(0, i - 1))}
                  disabled={currentCatIdx === 0}
                  style={{ touchAction: 'manipulation' }}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400
                    hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30
                    disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all shrink-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {/* Pills com scroll horizontal */}
                <div className="flex-1 overflow-x-auto scrollbar-hide flex gap-1.5">
                  {categories.map((cat, idx) => {
                    const catCounted = products
                      .filter(p => (p.category || 'Sem Categoria') === cat)
                      .filter(p => counts[p.id] !== undefined).length;
                    const catTotal = products.filter(p => (p.category || 'Sem Categoria') === cat).length;
                    const done = catCounted === catTotal && catTotal > 0;
                    return (
                      <button
                        key={cat}
                        onClick={() => setCurrentCatIdx(idx)}
                        style={{ touchAction: 'manipulation' }}
                        className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                          transition-all active:scale-95 ${
                          idx === currentCatIdx
                            ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                            : done
                              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {done && <Check className="w-2.5 h-2.5 shrink-0" />}
                        <span className="truncate max-w-[90px]">{cat}</span>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${
                          idx === currentCatIdx ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                        }`}>{catCounted}/{catTotal}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Chevron direita */}
                <button
                  onClick={() => setCurrentCatIdx(i => Math.min(categories.length - 1, i + 1))}
                  disabled={currentCatIdx === categories.length - 1}
                  style={{ touchAction: 'manipulation' }}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400
                    hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30
                    disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all shrink-0"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* ── Lista de produtos ─────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {isLoadingDraft ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p className="text-sm">Buscando rascunho…</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Package className="w-7 h-7 text-slate-300 dark:text-slate-600" />
                </div>
                <p className="text-sm">{searchTerm ? 'Nenhum produto encontrado.' : 'Nenhum produto nesta categoria.'}</p>
              </div>
            ) : (
              filteredProducts.map((product, idx) => {
                const counted  = counts[product.id] !== undefined;
                const diff     = counted ? counts[product.id] - product.quantity : null;
                const hasCodes = (productBarcodes[product.id]?.length || 0) > 0;

                // Navega para o próximo input ao pressionar Enter
                const handleNext = () => {
                  const nextProduct = filteredProducts[idx + 1];
                  if (nextProduct) {
                    const nextInput = inputRefs.current.get(nextProduct.id);
                    nextInput?.focus();
                    nextInput?.select();
                  }
                };

                return (
                  <div
                    key={product.id}
                    className={`p-3 rounded-2xl border transition-all ${
                      counted
                        ? 'border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/60 dark:bg-indigo-900/10'
                        : 'border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/60'
                    }`}
                  >
                    {/* Linha 1: imagem + nome + barcode + check */}
                    <div className="flex items-center gap-3">
                      {/* Miniatura */}
                      <div className="w-11 h-11 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                        {product.image_url && !imgErrors[product.id]
                          ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain"
                              onError={() => setImgErrors(prev => ({ ...prev, [product.id]: true }))} loading="lazy" />
                          : <Package className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                        }
                      </div>

                      {/* Nome + info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p
                            className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight select-none cursor-default"
                            onTouchStart={() => startPressTimer(product.name)}
                            onTouchEnd={cancelPressTimer}
                            onTouchMove={cancelPressTimer}
                            onMouseDown={() => startPressTimer(product.name)}
                            onMouseUp={cancelPressTimer}
                            onMouseLeave={cancelPressTimer}
                          >
                            {product.name}
                          </p>
                          {/* Botão barcode — 36×36px area com padding */}
                          <button
                            onClick={e => { e.stopPropagation(); setRegisterBarcodeProduct(product); }}
                            style={{ touchAction: 'manipulation' }}
                            title={hasCodes ? `${productBarcodes[product.id].length} código(s)` : 'Cadastrar barcode'}
                            className={`w-9 h-9 flex items-center justify-center rounded-lg shrink-0 transition-colors ${
                              hasCodes
                                ? 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                                : 'text-slate-300 dark:text-slate-600 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                            }`}
                          >
                            <Barcode className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {searchTerm && (
                            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wide">{product.category}</span>
                          )}
                          <span className="text-xs text-slate-400">
                            Atual: <span className="font-semibold text-slate-600 dark:text-slate-300">{product.quantity}</span>
                          </span>
                          {diff !== null && (
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${
                              diff > 0
                                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                                : diff < 0
                                  ? 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'
                                  : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
                            }`}>
                              {diff > 0 ? `+${diff}` : diff < 0 ? String(diff) : '='}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Check indicator */}
                      <div className="shrink-0">
                        {counted
                          ? <CheckCircle2 className="w-6 h-6 text-indigo-500" />
                          : <div className="w-6 h-6 rounded-full border-2 border-slate-200 dark:border-slate-600" />
                        }
                      </div>
                    </div>

                    {/* Linha 2: Stepper — largura total para conforto mobile */}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                        {counted ? 'Contado' : 'Informe a quantidade'}
                      </span>
                      <QtyInput
                        value={counts[product.id]}
                        onChange={v => handleCountChange(product.id, v)}
                        current={product.quantity}
                        inputRef={el => {
                          if (el) inputRefs.current.set(product.id, el);
                          else inputRefs.current.delete(product.id);
                        }}
                        onNext={handleNext}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Footer — botões com altura mínima 52px para mobile ──────── */}
          <div className="flex-shrink-0 flex items-center gap-3 px-4 py-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            {/* Rascunho */}
            <button
              onClick={() => saveProgress(false)}
              disabled={isSaving || Object.keys(counts).length === 0}
              style={{ touchAction: 'manipulation' }}
              className="flex-1 h-13 min-h-[52px] flex items-center justify-center gap-2 rounded-xl bg-white dark:bg-slate-800
                border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold
                hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-[.98] disabled:opacity-50 transition-all"
            >
              <Save className="w-4 h-4 shrink-0" />
              Rascunho
            </button>

            {/* Finalizar — botão principal */}
            <button
              onClick={() => saveProgress(true)}
              disabled={isSaving || Object.keys(counts).length === 0}
              style={{ touchAction: 'manipulation' }}
              className="flex-[2] min-h-[52px] flex items-center justify-center gap-2 rounded-xl bg-indigo-600
                hover:bg-indigo-700 text-white text-sm font-bold shadow-lg shadow-indigo-500/25
                active:scale-[.98] disabled:opacity-50 transition-all"
            >
              {isSaving
                ? <><Loader2 className="w-4 h-4 animate-spin shrink-0" /> Salvando…</>
                : <><CheckCircle2 className="w-4 h-4 shrink-0" /> Finalizar Conferência</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* Scanner — conferência */}
      {showScanner && (
        <BarcodeScanner
          onDetected={handleBarcodeScan}
          onClose={() => setShowScanner(false)}
          title="Escanear para Conferência"
          hint="Aponte para o código de barras do produto"
        />
      )}

      {/* Scanner — cadastrar barcode */}
      {registerBarcodeProduct && (
        <BarcodeScanner
          onDetected={handleRegisterBarcode}
          onClose={() => setRegisterBarcodeProduct(null)}
          title={`Cadastrar código — ${registerBarcodeProduct.name}`}
          hint="Leia o código para vincular a este produto"
        />
      )}

      {/* ── Sub-modal: quantidade pós-scan ────────────────────────────── */}
      {scanProduct && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">

            {/* Drag handle — mobile */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>

            {/* Header do sub-modal */}
            <div className="px-5 pt-3 pb-4 border-b border-slate-100 dark:border-slate-700 bg-indigo-50/60 dark:bg-indigo-900/20">
              <div className="flex items-center gap-2 mb-1">
                <Barcode className="w-4 h-4 text-indigo-500 shrink-0" />
                <p className="text-xs font-bold text-indigo-500 uppercase tracking-wider">Produto identificado</p>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">{scanProduct.name}</h3>
              <p className="text-xs text-slate-500 mt-1">
                Estoque atual: <span className="font-semibold">{scanProduct.quantity}</span>
                {counts[scanProduct.id] !== undefined && (
                  <span className="ml-2 text-indigo-600 dark:text-indigo-400">
                    · Já contado: {counts[scanProduct.id]}
                  </span>
                )}
              </p>
            </div>

            {/* Body */}
            <div className="px-5 py-5 space-y-4" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                  Quantidade a adicionar
                </label>
                {/* Input grande para digitação confortável no mobile */}
                <input
                  type="number"
                  value={scanQty}
                  onChange={e => setScanQty(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConfirmScanQty()}
                  autoFocus
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  className="w-full text-center text-3xl font-bold py-4 rounded-2xl border border-slate-200 dark:border-slate-600
                    bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white
                    focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
                />
                {counts[scanProduct.id] !== undefined && (
                  <p className="text-xs text-center text-slate-400 mt-2">
                    Total após confirmar:{' '}
                    <span className="font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                      {(counts[scanProduct.id] || 0) + (parseFloat(scanQty) || 0)}
                    </span>
                  </p>
                )}
              </div>

              {/* Botões — mínimo 52px */}
              <div className="flex gap-3">
                <button
                  onClick={() => { setScanProduct(null); setScanQty('1'); }}
                  style={{ touchAction: 'manipulation' }}
                  className="flex-1 min-h-[52px] rounded-xl border border-slate-200 dark:border-slate-600
                    text-slate-600 dark:text-slate-300 font-semibold text-sm
                    hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-[.98] transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmScanQty}
                  disabled={!scanQty || parseFloat(scanQty) <= 0}
                  style={{ touchAction: 'manipulation' }}
                  className="flex-[2] min-h-[52px] rounded-xl bg-indigo-600 text-white font-bold text-sm
                    hover:bg-indigo-700 disabled:opacity-40 active:scale-[.98] transition-all
                    flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                >
                  <Plus className="w-4 h-4 shrink-0" /> Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tooltip de nome completo (long-press) ────────────────────── */}
      {pressTooltip && (
        <div
          className="fixed inset-x-4 bottom-28 z-[80] flex justify-center pointer-events-none"
          aria-live="polite"
        >
          <div
            className="max-w-sm w-full mx-auto px-5 py-3.5 rounded-2xl shadow-2xl
              bg-slate-900/95 dark:bg-slate-700/95 backdrop-blur-sm
              border border-white/10 pointer-events-auto"
            onClick={() => setPressTooltip(null)}
            style={{ touchAction: 'manipulation' }}
          >
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Produto</p>
            <p className="text-sm font-semibold text-white leading-snug">{pressTooltip}</p>
          </div>
        </div>
      )}

      {/* ── Sub-modal: código não encontrado ──────────────────────────── */}
      {scanNotFound && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col"
            style={{ maxHeight: '85dvh' }}>

            {/* Drag handle — mobile */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>

            {/* Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-amber-50/60 dark:bg-amber-900/20 shrink-0">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                  <Barcode className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white">Código não cadastrado</h3>
                  <p className="text-xs text-slate-500 font-mono mt-1 break-all">{scanNotFound}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                Selecione o produto para vincular este código ou tente novamente.
              </p>
            </div>

            {/* Lista de produtos para vincular */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {products.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleLinkBarcodeToProduct(p)}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full text-left px-4 py-3.5 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20
                    active:scale-[.98] transition-all flex items-center justify-between gap-3 group min-h-[56px]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate
                      group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{p.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{p.category}</p>
                  </div>
                  <Plus className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 shrink-0 transition-colors" />
                </button>
              ))}
            </div>

            {/* Botões do rodapé */}
            <div className="flex gap-3 p-4 border-t border-slate-100 dark:border-slate-700 shrink-0"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <button
                onClick={() => setScanNotFound(null)}
                style={{ touchAction: 'manipulation' }}
                className="flex-1 min-h-[52px] rounded-xl border border-slate-200 dark:border-slate-600
                  text-sm font-semibold text-slate-600 dark:text-slate-300
                  hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-[.98] transition-all"
              >
                Fechar
              </button>
              <button
                onClick={() => { setScanNotFound(null); setShowScanner(true); }}
                style={{ touchAction: 'manipulation' }}
                className="flex-1 min-h-[52px] rounded-xl bg-indigo-600 text-white text-sm font-bold
                  hover:bg-indigo-700 active:scale-[.98] transition-all
                  flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
              >
                <Camera className="w-4 h-4 shrink-0" /> Tentar novamente
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StockConferenceModal;
