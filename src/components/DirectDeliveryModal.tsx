import React, { useState, useMemo, useRef, useEffect } from 'react';
import Modal from './Modal';
import { Product } from '../pages/AdminPanel';
import { Package, Search, X, ArrowRight, AlertTriangle, CheckCircle } from 'lucide-react';

interface DirectDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  sectors: { id: string; name: string }[];
  onConfirm: (productId: string, sectorId: string, quantity: number, reason: string) => void;
}

const DirectDeliveryModal: React.FC<DirectDeliveryModalProps> = ({
  isOpen, onClose, products, sectors, onConfirm,
}) => {
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedSectorId, setSelectedSectorId]   = useState('');
  const [quantity, setQuantity]                   = useState<number | string>(1);
  const [reason, setReason]                       = useState('');
  const [searchTerm, setSearchTerm]               = useState('');
  const [showResults, setShowResults]             = useState(false);
  const [error, setError]                         = useState('');
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  const selectedProduct = useMemo(
    () => products.find(p => p.id === selectedProductId),
    [selectedProductId, products],
  );

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    return products
      .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .slice(0, 8);
  }, [products, searchTerm]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node))
        setShowResults(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const resetState = () => {
    setSelectedProductId(''); setSelectedSectorId('');
    setQuantity(1); setReason(''); setSearchTerm('');
    setShowResults(false); setError('');
  };

  const handleClose = () => { resetState(); onClose(); };

  const handleSelectProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setSearchTerm(product.name);
    setShowResults(false);
    setError('');
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setSelectedProductId('');
    setShowResults(true);
    setError('');
  };

  const handleConfirm = () => {
    const numQty = Number(quantity);
    if (!selectedProductId) { setError('Selecione um produto.'); return; }
    if (!selectedSectorId)  { setError('Selecione um setor de destino.'); return; }
    if (!numQty || numQty <= 0) { setError('Informe uma quantidade válida.'); return; }
    if (selectedProduct && numQty > selectedProduct.quantity) {
      setError(`Quantidade insuficiente. Disponível: ${selectedProduct.quantity}`);
      return;
    }
    onConfirm(selectedProductId, selectedSectorId, numQty, reason);
    resetState();
  };

  const numQty      = Number(quantity);
  const stockPct    = selectedProduct && selectedProduct.quantity > 0
    ? Math.min(100, (numQty / selectedProduct.quantity) * 100)
    : 0;
  const isOverStock = selectedProduct ? numQty > selectedProduct.quantity : false;
  const isButtonDisabled = !selectedProductId || !selectedSectorId || numQty <= 0 || isOverStock;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Entrega Direta de Item">
      <div className="space-y-5">

        {/* ── Produto ──────────────────────────────────────────────────── */}
        <div ref={searchWrapperRef} className="relative">
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
            Produto *
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Digite para pesquisar…"
              value={searchTerm}
              onChange={handleSearchChange}
              onFocus={() => searchTerm && setShowResults(true)}
              className="w-full pl-10 pr-9 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
            />
            {searchTerm && (
              <button
                onClick={() => { setSearchTerm(''); setSelectedProductId(''); setShowResults(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Dropdown */}
          {showResults && searchTerm && (
            <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-56 overflow-y-auto">
              {filteredProducts.length > 0 ? filteredProducts.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProduct(p)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left first:rounded-t-xl last:rounded-b-xl"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden shrink-0 border border-slate-200 dark:border-slate-600">
                    {p.image_url
                      ? <img src={p.image_url} alt={p.name} className="w-full h-full object-contain" />
                      : <Package className="w-4 h-4 text-slate-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{p.name}</p>
                    <p className={`text-xs font-medium ${p.quantity > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                      Estoque: {p.quantity}
                    </p>
                  </div>
                </button>
              )) : (
                <div className="px-4 py-6 text-center text-sm text-slate-400">
                  Nenhum produto encontrado
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Card do produto selecionado ───────────────────────────────── */}
        {selectedProduct && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3 flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-indigo-200 dark:border-indigo-700 shrink-0">
              {selectedProduct.image_url
                ? <img src={selectedProduct.image_url} alt={selectedProduct.name} className="w-full h-full object-contain" />
                : <Package className="w-5 h-5 text-slate-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{selectedProduct.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isOverStock ? 'bg-red-500' : stockPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, stockPct)}%` }}
                  />
                </div>
                <span className={`text-xs font-bold tabular-nums shrink-0 ${isOverStock ? 'text-red-500' : 'text-slate-600 dark:text-slate-300'}`}>
                  {numQty || 0} / {selectedProduct.quantity}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Setor de destino ──────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
            Setor de Destino *
          </label>
          <select
            value={selectedSectorId}
            onChange={e => { setSelectedSectorId(e.target.value); setError(''); }}
            className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
          >
            <option value="">Selecione um setor…</option>
            {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* ── Quantidade ───────────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
            Quantidade *
            {selectedProduct && (
              <span className="ml-2 text-[11px] normal-case font-medium text-slate-400">
                máx. {selectedProduct.quantity}
              </span>
            )}
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={e => { setQuantity(e.target.value); setError(''); }}
            min="0.01"
            step="any"
            disabled={!selectedProduct}
            className={`w-full px-3 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-colors
              ${isOverStock
                ? 'border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-900/20 focus:ring-red-500/40 focus:border-red-500'
                : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 focus:ring-indigo-500/40 focus:border-indigo-500'}
              text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed`}
          />
          {isOverStock && (
            <p className="mt-1 flex items-center gap-1 text-xs text-red-500">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Quantidade maior que o estoque disponível ({selectedProduct?.quantity})
            </p>
          )}
        </div>

        {/* ── Motivo ───────────────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
            Motivo <span className="normal-case font-normal">(opcional)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Ex: Reposição de emergência"
            className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* ── Erro inline ──────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* ── Ações ────────────────────────────────────────────────────── */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isButtonDisabled}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 shadow-sm shadow-indigo-600/20"
          >
            <CheckCircle className="w-4 h-4" />
            Confirmar Entrega
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default DirectDeliveryModal;
