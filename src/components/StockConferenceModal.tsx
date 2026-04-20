// src/components/StockConferenceModal.tsx
// Redesenhado — slate design system, category pills, product cards com imagem,
// steppers de quantidade, sub-modais polidos.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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

// ── Stepper de quantidade ──────────────────────────────────────────────────────
const QtyInput: React.FC<{
  value: number | undefined;
  onChange: (v: string) => void;
  current: number;
}> = ({ value, onChange, current }) => {
  const [raw, setRaw] = useState(value !== undefined ? String(value) : '');

  useEffect(() => {
    setRaw(value !== undefined ? String(value) : '');
  }, [value]);

  return (
    <div className="flex items-center gap-1">
      <button type="button"
        onClick={() => {
          const v = Math.max(0, (value ?? 0) - 1);
          onChange(String(v));
        }}
        className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 font-bold transition-colors flex items-center justify-center text-lg leading-none select-none">
        −
      </button>
      <input
        type="text" inputMode="decimal"
        value={raw}
        onChange={e => { setRaw(e.target.value); onChange(e.target.value); }}
        placeholder="—"
        className="w-14 h-8 text-center text-sm font-bold rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
      />
      <button type="button"
        onClick={() => {
          const v = (value ?? 0) + 1;
          onChange(String(v));
        }}
        className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600 dark:hover:text-emerald-400 font-bold transition-colors flex items-center justify-center text-lg leading-none select-none">
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
  const [searchTerm, setSearchTerm]   = useState('');
  const [counts, setCounts]           = useState<Record<string, number>>({});
  const [currentCatIdx, setCurrentCatIdx] = useState(0);
  const [isSaving, setIsSaving]       = useState(false);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);

  const [showScanner,              setShowScanner]              = useState(false);
  const [scanProduct,              setScanProduct]              = useState<Product | null>(null);
  const [scanQty,                  setScanQty]                  = useState('1');
  const [scanNotFound,             setScanNotFound]             = useState<string | null>(null);
  const [registerBarcodeProduct,   setRegisterBarcodeProduct]   = useState<Product | null>(null);
  const [productBarcodes,          setProductBarcodes]          = useState<Record<string, string[]>>({});
  const [imgErrors,                setImgErrors]                = useState<Record<string, boolean>>({});

  // Categorias
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
      {/* overlay */}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl overflow-hidden flex flex-col max-h-[96vh] sm:max-h-[90vh]">

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 bg-indigo-600 dark:bg-indigo-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                <ListChecks className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Conferência de Estoque</h2>
                <p className="text-xs text-indigo-200">
                  {sectorId ? 'Setor Selecionado' : 'Inventário Principal'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={fillRemainingWithZero} disabled={countedProducts === totalProducts}
                title="Preencher não contados com 0"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                <ZapOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Preencher 0</span>
              </button>
              <button onClick={() => { setScanNotFound(null); setShowScanner(true); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/20 text-white text-xs font-semibold hover:bg-white/30 transition-colors">
                <Camera className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Escanear</span>
              </button>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-white/70 hover:text-white hover:bg-white/20 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Barra de progresso ─────────────────────────────────────────── */}
          <div className="flex-shrink-0 px-5 py-3 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Progresso</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                  {countedProducts}/{totalProducts} · {progressPct}%
                </span>
                {progressPct === 100 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
                    <Check className="w-2.5 h-2.5" /> Completo
                  </span>
                )}
              </div>
            </div>
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPct}%`,
                  background: progressPct === 100
                    ? 'linear-gradient(90deg,#22c55e,#16a34a)'
                    : 'linear-gradient(90deg,#6366f1,#8b5cf6)',
                }} />
            </div>
          </div>

          {/* ── Search + Category pills ──────────────────────────────────── */}
          <div className="flex-shrink-0 px-4 pt-3 pb-3 space-y-3 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900">
            {/* Busca */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input type="text" value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar produto em todas as categorias…"
                className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Category pills (horizontal scroll) */}
            {!searchTerm && categories.length > 0 && (
              <div className="flex items-center gap-2">
                <button onClick={() => setCurrentCatIdx(i => Math.max(0, i - 1))} disabled={currentCatIdx === 0}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 disabled:opacity-30 transition-colors shrink-0">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex-1 overflow-x-auto scrollbar-hide flex gap-2 pb-0.5">
                  {categories.map((cat, idx) => {
                    const catCounted = products
                      .filter(p => (p.category || 'Sem Categoria') === cat)
                      .filter(p => counts[p.id] !== undefined).length;
                    const catTotal = products.filter(p => (p.category || 'Sem Categoria') === cat).length;
                    const done = catCounted === catTotal && catTotal > 0;
                    return (
                      <button key={cat} onClick={() => setCurrentCatIdx(idx)}
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                          idx === currentCatIdx
                            ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                            : done
                              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700'
                        }`}>
                        {done && <Check className="w-3 h-3" />}
                        {cat}
                        <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${
                          idx === currentCatIdx ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                        }`}>{catCounted}/{catTotal}</span>
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setCurrentCatIdx(i => Math.min(categories.length - 1, i + 1))}
                  disabled={currentCatIdx === categories.length - 1}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 disabled:opacity-30 transition-colors shrink-0">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* ── Lista de produtos ─────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {isLoadingDraft ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p className="text-sm">Buscando rascunho…</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Package className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                </div>
                <p className="text-sm">{searchTerm ? 'Nenhum produto encontrado.' : 'Nenhum produto nesta categoria.'}</p>
              </div>
            ) : (
              filteredProducts.map(product => {
                const counted  = counts[product.id] !== undefined;
                const diff     = counted ? counts[product.id] - product.quantity : null;
                const hasCodes = (productBarcodes[product.id]?.length || 0) > 0;

                return (
                  <div key={product.id}
                    className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                      counted
                        ? 'border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/60 dark:bg-indigo-900/10'
                        : 'border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/60'
                    }`}>

                    {/* Imagem */}
                    <div className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                      {product.image_url && !imgErrors[product.id]
                        ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain"
                            onError={() => setImgErrors(prev => ({ ...prev, [product.id]: true }))} loading="lazy" />
                        : <Package className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                      }
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{product.name}</p>
                        {/* botão barcode */}
                        <button onClick={e => { e.stopPropagation(); setRegisterBarcodeProduct(product); }}
                          title={hasCodes ? `${productBarcodes[product.id].length} código(s)` : 'Cadastrar barcode'}
                          className={`p-1 rounded-md transition-colors ${
                            hasCodes ? 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'text-slate-300 dark:text-slate-600 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                          }`}>
                          <Barcode className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {searchTerm && <span className="text-[10px] font-bold text-indigo-500 uppercase">{product.category}</span>}
                        <span className="text-xs text-slate-400">Atual: <span className="font-semibold text-slate-600 dark:text-slate-300">{product.quantity}</span></span>
                        {diff !== null && (
                          <span className={`text-xs font-bold ${diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : diff < 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-400'}`}>
                            {diff > 0 ? `+${diff}` : diff < 0 ? String(diff) : '='}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Stepper + check */}
                    <div className="flex items-center gap-2 shrink-0">
                      <QtyInput value={counts[product.id]} onChange={v => handleCountChange(product.id, v)} current={product.quantity} />
                      {counted
                        ? <CheckCircle2 className="w-5 h-5 text-indigo-500 shrink-0" />
                        : <div className="w-5 h-5 rounded-full border-2 border-slate-200 dark:border-slate-600 shrink-0" />
                      }
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <div className="flex-shrink-0 flex items-center gap-3 px-5 py-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80">
            <button onClick={() => saveProgress(false)}
              disabled={isSaving || Object.keys(counts).length === 0}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors">
              <Save className="w-4 h-4" /> Rascunho
            </button>
            <button onClick={() => saveProgress(true)}
              disabled={isSaving || Object.keys(counts).length === 0}
              className="flex-[2] flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-sm shadow-indigo-500/20 disabled:opacity-50 transition-colors">
              {isSaving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</>
                : <><CheckCircle2 className="w-4 h-4" /> Finalizar Conferência</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* Scanner — conferência */}
      {showScanner && (
        <BarcodeScanner onDetected={handleBarcodeScan} onClose={() => setShowScanner(false)}
          title="Escanear para Conferência" hint="Aponte para o código de barras do produto" />
      )}

      {/* Scanner — cadastrar barcode */}
      {registerBarcodeProduct && (
        <BarcodeScanner onDetected={handleRegisterBarcode} onClose={() => setRegisterBarcodeProduct(null)}
          title={`Cadastrar código — ${registerBarcodeProduct.name}`}
          hint="Leia o código para vincular a este produto" />
      )}

      {/* ── Sub-modal: quantidade pós-scan ────────────────────────────── */}
      {scanProduct && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-slate-100 dark:border-slate-700 bg-indigo-50/60 dark:bg-indigo-900/20">
              <div className="flex items-center gap-2 mb-1">
                <Barcode className="w-4 h-4 text-indigo-500" />
                <p className="text-xs font-bold text-indigo-500 uppercase tracking-wider">Produto identificado</p>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{scanProduct.name}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Estoque atual: <span className="font-semibold">{scanProduct.quantity}</span>
                {counts[scanProduct.id] !== undefined && (
                  <span className="ml-2 text-indigo-600 dark:text-indigo-400">
                    · Contado: {counts[scanProduct.id]}
                  </span>
                )}
              </p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Quantidade a adicionar</label>
                <input type="number" value={scanQty} onChange={e => setScanQty(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConfirmScanQty()}
                  autoFocus min="0.01" step="0.01"
                  className="w-full text-center text-2xl font-bold py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400" />
                {counts[scanProduct.id] !== undefined && (
                  <p className="text-xs text-center text-slate-400 mt-1.5">
                    Total após confirmar: <span className="font-bold text-indigo-600 dark:text-indigo-400">
                      {(counts[scanProduct.id] || 0) + (parseFloat(scanQty) || 0)}
                    </span>
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setScanProduct(null); setScanQty('1'); }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-medium text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  Cancelar
                </button>
                <button onClick={handleConfirmScanQty} disabled={!scanQty || parseFloat(scanQty) <= 0}
                  className="flex-[2] py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-modal: código não encontrado ──────────────────────────── */}
      {scanNotFound && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-amber-50/60 dark:bg-amber-900/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                  <Barcode className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white">Código não cadastrado</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5 truncate max-w-[260px]">{scanNotFound}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-3">Selecione o produto para vincular este código ou tente novamente.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {products.map(p => (
                <button key={p.id} onClick={() => handleLinkBarcodeToProduct(p)}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors flex items-center justify-between gap-2 group">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{p.name}</p>
                    <p className="text-[11px] text-slate-400">{p.category}</p>
                  </div>
                  <Plus className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 shrink-0" />
                </button>
              ))}
            </div>
            <div className="flex gap-2 p-4 border-t border-slate-100 dark:border-slate-700">
              <button onClick={() => setScanNotFound(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                Fechar
              </button>
              <button onClick={() => { setScanNotFound(null); setShowScanner(true); }}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1.5">
                <Camera className="w-4 h-4" /> Tentar novamente
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StockConferenceModal;
