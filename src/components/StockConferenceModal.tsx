import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Search, ChevronRight, ChevronLeft, CheckCircle2, Save, ListChecks, AlertCircle, Play, Camera, Barcode, Plus, ZapOff } from 'lucide-react';
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

const StockConferenceModal: React.FC<StockConferenceModalProps> = ({
  isOpen,
  onClose,
  products,
  hotelId,
  sectorId,
  onFinished
}) => {
  const { addNotification } = useNotification();
  const [searchTerm, setSearchTerm] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);

  // Scanner
  const [showScanner,    setShowScanner]    = useState(false);
  // Modal de quantidade pós-scan
  const [scanProduct,    setScanProduct]    = useState<Product | null>(null);
  const [scanQty,        setScanQty]        = useState('1');
  const [scanNotFound,   setScanNotFound]   = useState<string | null>(null);
  // Cadastro de barcode: quando != null, scanner está em modo "vincular barcode ao produto"
  const [registerBarcodeProduct, setRegisterBarcodeProduct] = useState<Product | null>(null);
  const [productBarcodes, setProductBarcodes] = useState<Record<string, string[]>>({});  // product_id → barcodes[]

  // Organiza produtos por categoria
  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category || 'Sem Categoria')));
    return cats.sort();
  }, [products]);

  const currentCategory = categories[currentCategoryIndex];
  
  // Progresso: quantos produtos já têm contagem vs total
  const totalProducts   = products.length;
  const countedProducts = Object.keys(counts).length;
  const progressPct     = totalProducts > 0 ? Math.round((countedProducts / totalProducts) * 100) : 0;

  // Preencher todos os produtos sem contagem com 0
  const fillRemainingWithZero = () => {
    const newCounts = { ...counts };
    products.forEach(p => {
      if (newCounts[p.id] === undefined) newCounts[p.id] = 0;
    });
    setCounts(newCounts);
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

  // Auto-busca por barcode quando texto não encontra nenhum produto (debounce 600ms)
  useEffect(() => {
    if (!searchTerm || searchTerm.trim().length < 4) return;
    const nameMatches = products.some(p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.category || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (nameMatches) return;
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('product_barcodes')
        .select('product_id')
        .eq('barcode', searchTerm.trim())
        .maybeSingle();
      if (data) {
        const found = products.find(p => p.id === data.product_id);
        if (found) {
          setSearchTerm('');
          setScanProduct(found);
          setScanQty('1');
        }
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [searchTerm, products]);

  // Busca rascunho e barcodes existentes ao abrir
  useEffect(() => {
    if (isOpen) {
      checkExistingDraft();
      loadProductBarcodes();
    } else {
      setCounts({});
      setSearchTerm('');
      setCurrentCategoryIndex(0);
      setActiveCountId(null);
      setProductBarcodes({});
    }
  }, [isOpen, hotelId, sectorId]);

  const checkExistingDraft = async () => {
    setIsLoadingDraft(true);
    try {
      let query = supabase
        .from('stock_counts')
        .select(`
          id,
          items:stock_count_items(product_id, counted_quantity)
        `)
        .eq('hotel_id', hotelId)
        .eq('status', 'draft');

      if (sectorId) {
        query = query.eq('sector_id', sectorId);
      } else {
        query = query.is('sector_id', null);
      }

      const { data, error } = await query.maybeSingle();
      
      if (error) throw error;

      if (data) {
        const draftCounts: Record<string, number> = {};
        data.items.forEach((item: any) => {
          draftCounts[item.product_id] = item.counted_quantity;
        });
        setCounts(draftCounts);
        setActiveCountId(data.id);
        addNotification('Rascunho de conferência retomado.', 'info');
      }
    } catch (err) {
      console.error('Erro ao buscar rascunho:', err);
    } finally {
      setIsLoadingDraft(false);
    }
  };

  const loadProductBarcodes = async () => {
    const productIds = products.map(p => p.id);
    if (productIds.length === 0) return;
    const { data } = await supabase
      .from('product_barcodes')
      .select('product_id, barcode')
      .in('product_id', productIds);
    if (data) {
      const map: Record<string, string[]> = {};
      data.forEach((row: any) => {
        if (!map[row.product_id]) map[row.product_id] = [];
        map[row.product_id].push(row.barcode);
      });
      setProductBarcodes(map);
    }
  };

  // Handler: scanner em modo "cadastrar barcode" para um produto específico
  const handleRegisterBarcode = useCallback(async (barcode: string) => {
    if (!registerBarcodeProduct) return;

    // Verifica se já existe
    const { data: existing } = await supabase
      .from('product_barcodes')
      .select('id, product_id')
      .eq('barcode', barcode)
      .maybeSingle();

    if (existing) {
      const existingProduct = products.find(p => p.id === existing.product_id);
      addNotification(`Este código já está vinculado a "${existingProduct?.name || 'outro produto'}".`, 'error');
      setRegisterBarcodeProduct(null);
      return;
    }

    const { error } = await supabase
      .from('product_barcodes')
      .insert({ product_id: registerBarcodeProduct.id, barcode });

    if (error) {
      addNotification('Erro ao cadastrar código de barras.', 'error');
    } else {
      addNotification(`Código cadastrado em "${registerBarcodeProduct.name}"!`, 'success');
      // Atualiza o mapa local
      setProductBarcodes(prev => ({
        ...prev,
        [registerBarcodeProduct.id]: [...(prev[registerBarcodeProduct.id] || []), barcode],
      }));
    }
    setRegisterBarcodeProduct(null);
  }, [registerBarcodeProduct, products, addNotification]);

  // Handler: vincular código não-encontrado a um produto selecionado
  const handleLinkBarcodeToProduct = async (product: Product) => {
    if (!scanNotFound) return;
    const barcode = scanNotFound;

    const { error } = await supabase
      .from('product_barcodes')
      .insert({ product_id: product.id, barcode });

    if (error) {
      addNotification('Erro ao vincular código de barras.', 'error');
    } else {
      addNotification(`Código vinculado a "${product.name}"!`, 'success');
      setProductBarcodes(prev => ({
        ...prev,
        [product.id]: [...(prev[product.id] || []), barcode],
      }));
    }
    setScanNotFound(null);
  };

  const handleCountChange = (productId: string, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      setCounts(prev => ({ ...prev, [productId]: numValue }));
    } else if (value === '') {
      const newCounts = { ...counts };
      delete newCounts[productId];
      setCounts(newCounts);
    }
  };

  // ---------------------------------------------------------------------------
  // Barcode scan handler
  // ---------------------------------------------------------------------------
  const handleBarcodeScan = useCallback(async (barcode: string) => {
    setScanNotFound(null);
    // Busca o produto pelo barcode na tabela product_barcodes
    const { data, error } = await supabase
      .from('product_barcodes')
      .select('product_id')
      .eq('barcode', barcode)
      .maybeSingle();

    if (error || !data) {
      setScanNotFound(barcode);
      setShowScanner(false);
      return;
    }

    // Encontra o produto na lista local
    const found = products.find(p => p.id === data.product_id);
    if (!found) {
      setScanNotFound(barcode);
      setShowScanner(false);
      return;
    }

    setShowScanner(false);
    setScanProduct(found);
    setScanQty('1');
  }, [products]);

  const handleConfirmScanQty = () => {
    if (!scanProduct) return;
    const qty = parseFloat(scanQty);
    if (isNaN(qty) || qty <= 0) return;
    // Soma à quantidade já contada (se houver)
    setCounts(prev => ({
      ...prev,
      [scanProduct.id]: (prev[scanProduct.id] || 0) + qty,
    }));
    addNotification(
      `${scanProduct.name}: +${qty} → total ${(counts[scanProduct.id] || 0) + qty}`,
      'success'
    );
    setScanProduct(null);
    setScanQty('1');
  };

  const saveProgress = async (isFinal: boolean) => {
    if (Object.keys(counts).length === 0) {
      addNotification('Informe pelo menos uma quantidade.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      let countId = activeCountId;

      // 1. Cria ou atualiza o cabeçalho da conferência
      if (!countId) {
        const { data: newCount, error: countError } = await supabase
          .from('stock_counts')
          .insert({
            hotel_id: hotelId,
            sector_id: sectorId || null,
            status: isFinal ? 'finished' : 'draft',
            started_at: new Date().toISOString(),
            finished_at: isFinal ? new Date().toISOString() : null,
            notes: sectorId ? 'Conferência de Setor' : 'Conferência de Inventário Principal'
          })
          .select()
          .single();

        if (countError) throw countError;
        countId = newCount.id;
        setActiveCountId(countId);
      } else {
        const { error: updateError } = await supabase
          .from('stock_counts')
          .update({
            status: isFinal ? 'finished' : 'draft',
            finished_at: isFinal ? new Date().toISOString() : null
          })
          .eq('id', countId);

        if (updateError) throw updateError;
      }

      // 2. Salva os itens
      // IMPORTANTE: Removemos 'difference' pois o erro 428C9 indica que é uma coluna gerada.
      // Mantemos 'previous_quantity' pois o erro anterior indicou que é obrigatória.
      const countItems = Object.entries(counts).map(([productId, countedQty]) => {
        const product = products.find(p => p.id === productId);
        const previousQty = product?.quantity || 0;
        return {
          stock_count_id: countId,
          product_id: productId,
          previous_quantity: previousQty,
          counted_quantity: countedQty
        };
      });

      // Remove itens antigos do rascunho para reinserir os atuais
      const { error: deleteItemsError } = await supabase
        .from('stock_count_items')
        .delete()
        .eq('stock_count_id', countId);
      
      if (deleteItemsError) throw deleteItemsError;

      // Inserção dos itens sem a coluna gerada 'difference'
      const { error: itemsError } = await supabase
        .from('stock_count_items')
        .insert(countItems);

      if (itemsError) throw itemsError;

      // 3. Se for final, atualiza o estoque real
      if (isFinal) {
        for (const [productId, newQty] of Object.entries(counts)) {
          if (sectorId) {
            const { error: updateStockError } = await supabase
              .from('sector_stock')
              .update({ quantity: newQty })
              .eq('sector_id', sectorId)
              .eq('product_id', productId);
            if (updateStockError) throw updateStockError;
          } else {
            const { error: updateStockError } = await supabase
              .from('products')
              .update({ quantity: newQty })
              .eq('id', productId);
            if (updateStockError) throw updateStockError;
          }
        }
        addNotification('Conferência finalizada e estoque atualizado!', 'success');
        onFinished();
        onClose();
      } else {
        addNotification('Progresso salvo como rascunho.', 'success');
      }
    } catch (err: any) {
      console.error('Erro detalhado ao salvar conferência:', err);
      addNotification('Erro ao salvar: ' + (err.message || 'Erro desconhecido'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Leitor USB de código de barras
  useBarcodeScanner({
    onScan: (barcode: string) => {
      if (registerBarcodeProduct) {
        handleRegisterBarcode(barcode);
      } else {
        handleBarcodeScan(barcode);
      }
    },
    enabled: isOpen && !showScanner,
  });

  if (!isOpen) return null;

  return (
  <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-indigo-50 dark:bg-indigo-900/20">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2 text-indigo-900 dark:text-indigo-100">
              <ListChecks className="w-6 h-6" />
              Conferência de Estoque
            </h2>
            <p className="text-sm text-indigo-600 dark:text-indigo-400">
              {sectorId ? 'Setor Selecionado' : 'Inventário Principal'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fillRemainingWithZero}
              disabled={countedProducts === totalProducts}
              title="Preencher itens não contados com 0"
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ZapOff className="w-4 h-4" />
              <span className="hidden sm:inline">Preencher com 0</span>
            </button>
            <button
              onClick={() => { setScanNotFound(null); setShowScanner(true); }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
              title="Escanear código de barras"
            >
              <Camera className="w-4 h-4" />
              <span className="hidden sm:inline">Escanear</span>
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/50 dark:hover:bg-gray-700 rounded-full transition-colors">
              <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>
        </div>

        {/* ── Barra de progresso ───────────────────────────────────────────── */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              Progresso da conferência
            </span>
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
              {countedProducts}/{totalProducts} itens · {progressPct}%
            </span>
          </div>
          <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progressPct}%`,
                background: progressPct === 100
                  ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                  : 'linear-gradient(90deg, #6366f1, #8b5cf6)',
              }}
            />
          </div>
          {progressPct === 100 && (
            <p className="text-xs text-green-600 dark:text-green-400 font-semibold mt-1 text-center">
              ✓ Todos os itens contados — pode finalizar!
            </p>
          )}
        </div>

        {/* Search & Category Nav */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Procurar em todos os itens..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {!searchTerm && (
            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 p-2 rounded-xl">
              <button 
                onClick={() => setCurrentCategoryIndex(prev => Math.max(0, prev - 1))}
                disabled={currentCategoryIndex === 0}
                className="p-2 disabled:opacity-30"
              >
                <ChevronLeft />
              </button>
              <span className="font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider text-sm">
                {currentCategory} ({currentCategoryIndex + 1}/{categories.length})
              </span>
              <button 
                onClick={() => setCurrentCategoryIndex(prev => Math.min(categories.length - 1, prev + 1))}
                disabled={currentCategoryIndex === categories.length - 1}
                className="p-2 disabled:opacity-30"
              >
                <ChevronRight />
              </button>
            </div>
          )}
        </div>

        {/* Product List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoadingDraft ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
              Buscando rascunho...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {searchTerm ? 'Nenhum item encontrado para sua busca.' : 'Nenhum item encontrado nesta categoria.'}
            </div>
          ) : (
            filteredProducts.map(product => (
              <div 
                key={product.id} 
                className={`p-4 rounded-xl border transition-all ${
                  counts[product.id] !== undefined 
                    ? 'border-green-200 bg-green-50 dark:bg-green-900/10 dark:border-green-900/30' 
                    : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-bold text-gray-800 dark:text-gray-200 truncate">{product.name}</h4>
                      <button
                        onClick={(e) => { e.stopPropagation(); setRegisterBarcodeProduct(product); }}
                        title={productBarcodes[product.id]?.length
                          ? `${productBarcodes[product.id].length} código(s) cadastrado(s) · Clique para adicionar`
                          : 'Cadastrar código de barras'}
                        className={`flex-shrink-0 p-1 rounded-lg transition-colors ${
                          productBarcodes[product.id]?.length
                            ? 'text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20'
                            : 'text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                        }`}
                      >
                        <Barcode className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      {searchTerm && <span className="text-indigo-500 font-medium">{product.category} • </span>}
                      Estoque atual: {product.quantity}
                      {productBarcodes[product.id]?.length ? (
                        <span className="ml-1 text-green-500">· {productBarcodes[product.id].length} código(s)</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Qtd"
                      className="w-24 px-3 py-2 text-center font-bold bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      value={counts[product.id] ?? ''}
                      onChange={(e) => handleCountChange(product.id, e.target.value)}
                    />
                    {counts[product.id] !== undefined && (
                      <CheckCircle2 className="w-6 h-6 text-green-500" />
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex gap-3">
          <button
            onClick={() => saveProgress(false)}
            disabled={isSaving || Object.keys(counts).length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-bold rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 transition-all disabled:opacity-50"
          >
            <Save className="w-5 h-5" />
            Salvar Rascunho
          </button>
          <button
            onClick={() => saveProgress(true)}
            disabled={isSaving || Object.keys(counts).length === 0}
            className="flex-[1.5] flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none transition-all disabled:opacity-50"
          >
            {isSaving ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Finalizar Conferência
              </>
            )}
          </button>
        </div>
      </div>
    </div>

    {/* ── Scanner de câmera (conferência) ────────────────────────── */}
    {showScanner && (
      <BarcodeScanner
        onDetected={handleBarcodeScan}
        onClose={() => setShowScanner(false)}
        title="Escanear para Conferência"
        hint="Aponte para o código de barras do produto"
      />
    )}

    {/* ── Scanner de câmera (cadastrar barcode) ──────────────────── */}
    {registerBarcodeProduct && (
      <BarcodeScanner
        onDetected={handleRegisterBarcode}
        onClose={() => setRegisterBarcodeProduct(null)}
        title={`Cadastrar código — ${registerBarcodeProduct.name}`}
        hint="Leia o código de barras para vincular a este produto"
      />
    )}

    {/* ── Modal de quantidade pós-scan ────────────────────────────── */}
    {scanProduct && (
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="w-full sm:max-w-sm bg-white dark:bg-gray-800 rounded-3xl shadow-2xl overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-1">
              <Barcode className="w-4 h-4 text-indigo-500" />
              <p className="text-xs font-bold text-indigo-500 uppercase tracking-wider">Produto identificado</p>
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">{scanProduct.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Estoque atual: <span className="font-semibold">{scanProduct.quantity}</span>
              {counts[scanProduct.id] !== undefined && (
                <span className="ml-2 text-green-600 dark:text-green-400">
                  · Contado até agora: {counts[scanProduct.id]}
                </span>
              )}
            </p>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Quantidade a adicionar
              </label>
              <input
                type="number"
                value={scanQty}
                onChange={e => setScanQty(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConfirmScanQty()}
                autoFocus
                min="0.01"
                step="0.01"
                className="w-full text-center text-2xl font-bold py-3 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-500"
              />
              {counts[scanProduct.id] !== undefined && (
                <p className="text-xs text-center text-gray-400 mt-1.5">
                  Total após confirmar: <span className="font-bold text-indigo-600 dark:text-indigo-400">
                    {(counts[scanProduct.id] || 0) + (parseFloat(scanQty) || 0)}
                  </span>
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setScanProduct(null); setScanQty('1'); }}
                className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmScanQty}
                disabled={!scanQty || parseFloat(scanQty) <= 0}
                className="flex-[2] py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Confirmar
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ── Produto não encontrado — com opção de vincular ────────── */}
    {scanNotFound && (
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
          <div className="p-5 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <Barcode className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Código não cadastrado</h3>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{scanNotFound}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Selecione o produto para vincular este código ou tente novamente.
            </p>
          </div>

          {/* Lista de produtos para vincular */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {products.map(p => (
              <button
                key={p.id}
                onClick={() => handleLinkBarcodeToProduct(p)}
                className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors flex items-center justify-between gap-2 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                    {p.name}
                  </p>
                  <p className="text-[11px] text-gray-400">{p.category}</p>
                </div>
                <Plus className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 flex-shrink-0" />
              </button>
            ))}
          </div>

          <div className="flex gap-2 p-4 border-t border-gray-100 dark:border-gray-700">
            <button
              onClick={() => setScanNotFound(null)}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Fechar
            </button>
            <button
              onClick={() => { setScanNotFound(null); setShowScanner(true); }}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1.5"
            >
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