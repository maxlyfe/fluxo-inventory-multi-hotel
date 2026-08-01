// src/components/DirectDeliveryModal.tsx
// Entrega direta em lote — mesmo formato do NewHotelTransferModal:
// overlay próprio, busca com dropdown, lista de itens com stepper e valor total.

import React, { useState, useEffect, useMemo } from 'react';
import { Product } from '../pages/AdminPanel';
import { useFormatters } from '../hooks/useFormatters';
import {
  Loader2, Search, X, Package, Trash2, ArrowRight,
  ChevronDown, Plus, Minus, Building2, CheckCircle, AlertTriangle,
} from 'lucide-react';

export interface DirectDeliveryItem {
  productId: string;
  quantity: number;
}

interface DirectDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  sectors: { id: string; name: string }[];
  onConfirm: (items: DirectDeliveryItem[], sectorId: string, reason: string) => void | Promise<void>;
}

interface ListItem {
  product: Product;
  qty: string; // string durante a digitação (formato brasileiro)
}

const fieldCls =
  'w-full rounded-xl border border-slate-200 dark:border-slate-600 ' +
  'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white ' +
  'placeholder-slate-400 text-sm px-3 py-2.5 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 ' +
  'transition-colors';

const DirectDeliveryModal: React.FC<DirectDeliveryModalProps> = ({
  isOpen, onClose, products, sectors, onConfirm,
}) => {
  const { parseNumber, formatCurrency } = useFormatters();

  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [items,            setItems]            = useState<ListItem[]>([]);
  const [reason,           setReason]           = useState('');
  const [searchTerm,       setSearchTerm]       = useState('');
  const [searchOpen,       setSearchOpen]       = useState(false);
  const [imgErrors,        setImgErrors]        = useState<Record<string, boolean>>({});
  const [isLoading,        setIsLoading]        = useState(false);
  const [error,            setError]            = useState('');

  useEffect(() => {
    if (!isOpen) {
      setSelectedSectorId(''); setItems([]); setReason('');
      setSearchTerm(''); setSearchOpen(false); setImgErrors({});
      setIsLoading(false); setError('');
    }
  }, [isOpen]);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    const added = new Set(items.map(i => i.product.id));
    return products
      .filter(p => p.is_active !== false && !added.has(p.id))
      .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .slice(0, 8);
  }, [searchTerm, products, items]);

  const totalValue = useMemo(
    () => items.reduce((t, i) => t + (i.product.average_price || i.product.last_purchase_price || 0) * parseNumber(i.qty), 0),
    [items, parseNumber],
  );

  const destSector = sectors.find(s => s.id === selectedSectorId);

  const hasInvalidQty = items.some(i => {
    const n = parseNumber(i.qty);
    return n <= 0 || n > i.product.quantity;
  });

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleAddProduct = (product: Product) => {
    setItems(prev => [...prev, { product, qty: '1' }]);
    setSearchTerm(''); setSearchOpen(false); setError('');
  };

  const handleRemove = (id: string) => {
    setItems(prev => prev.filter(i => i.product.id !== id));
    setError('');
  };

  const handleStep = (id: string, delta: number) => {
    setItems(prev => prev.map(i => {
      if (i.product.id !== id) return i;
      const next = Math.max(0, Math.min(parseNumber(i.qty) + delta, i.product.quantity));
      return { ...i, qty: String(next).replace('.', ',') };
    }));
    setError('');
  };

  const handleQtyInput = (id: string, value: string) => {
    setItems(prev => prev.map(i => i.product.id === id ? { ...i, qty: value } : i));
    setError('');
  };

  const handleConfirm = async () => {
    if (isLoading) return;
    if (!selectedSectorId) { setError('Selecione o setor de destino.'); return; }
    if (items.length === 0) { setError('Adicione pelo menos um item.'); return; }

    const payload: DirectDeliveryItem[] = [];
    for (const i of items) {
      const n = parseNumber(i.qty);
      if (n <= 0) { setError(`Informe uma quantidade válida para "${i.product.name}".`); return; }
      if (n > i.product.quantity) {
        setError(`Quantidade insuficiente de "${i.product.name}". Disponível: ${i.product.quantity}`);
        return;
      }
      payload.push({ productId: i.product.id, quantity: n });
    }

    setIsLoading(true);
    try {
      await onConfirm(payload, selectedSectorId, reason);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-xl max-h-[96vh] sm:max-h-[90vh] flex flex-col overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-sm shadow-indigo-600/30">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white leading-tight">Entrega Direta de Itens</h2>
              <p className="text-xs text-slate-400 leading-tight">Do estoque central para um setor</p>
            </div>
          </div>
          <button onClick={onClose} disabled={isLoading}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── Destino ──────────────────────────────────────────────────── */}
          <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Building2 className="w-4 h-4 text-indigo-500" />
              Destino da Entrega
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                Estoque Central
              </div>
              <ArrowRight className="w-4 h-4 text-indigo-500 shrink-0" />
              <div className="flex-1 relative">
                <select value={selectedSectorId}
                  onChange={e => { setSelectedSectorId(e.target.value); setError(''); }}
                  className={fieldCls + ' appearance-none pr-8 cursor-pointer'}>
                  <option value="">Selecionar setor…</option>
                  {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
            </div>
            {destSector && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle className="w-3.5 h-3.5" />
                Setor: <span className="font-bold">{destSector.name}</span>
              </div>
            )}
          </div>

          {/* ── Buscar item ──────────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Adicionar Itens
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input type="text" value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Buscar produto para entregar…"
                className={fieldCls + ' pl-9 pr-9'} />
              {searchTerm && (
                <button onClick={() => { setSearchTerm(''); setSearchOpen(false); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Dropdown */}
              {searchOpen && searchTerm && (
                <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-56 overflow-y-auto">
                  {filteredProducts.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhum produto encontrado.</p>
                  ) : (
                    filteredProducts.map(p => (
                      <button key={p.id} onClick={() => handleAddProduct(p)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors text-left group">
                        <div className="w-9 h-9 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                          {p.image_url && !imgErrors[p.id]
                            ? <img src={p.image_url} alt={p.name} className="w-full h-full object-contain"
                                onError={() => setImgErrors(prev => ({ ...prev, [p.id]: true }))} />
                            : <Package className="w-4 h-4 text-slate-400" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{p.name}</p>
                          <p className={`text-xs font-medium ${p.quantity > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            Estoque: {p.quantity}
                          </p>
                        </div>
                        <Plus className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Lista de itens ───────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Itens na lista
              </p>
              {items.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-bold">
                  {items.length} item{items.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                <Package className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm text-slate-400">Nenhum item adicionado ainda</p>
                <p className="text-xs text-slate-300 dark:text-slate-600 mt-0.5">Use a busca acima para adicionar produtos</p>
              </div>
            ) : (
              items.map(item => {
                const qtyNum   = parseNumber(item.qty);
                const unit     = item.product.average_price || item.product.last_purchase_price || 0;
                const subtotal = unit * qtyNum;
                const over     = qtyNum > item.product.quantity;
                return (
                  <div key={item.product.id}
                    className={`flex items-center gap-3 p-3 bg-white dark:bg-slate-800 rounded-2xl border transition-colors
                      ${over
                        ? 'border-red-300 dark:border-red-800'
                        : 'border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800'}`}>

                    {/* Imagem */}
                    <div className="w-11 h-11 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                      {item.product.image_url && !imgErrors[item.product.id]
                        ? <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-contain"
                            onError={() => setImgErrors(prev => ({ ...prev, [item.product.id]: true }))} />
                        : <Package className="w-5 h-5 text-slate-400" />
                      }
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-400">
                          Unit: <span className="font-medium text-slate-600 dark:text-slate-300">{formatCurrency(unit)}</span>
                        </span>
                        <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
                          = {formatCurrency(subtotal)}
                        </span>
                      </div>
                      <p className={`text-[10px] mt-0.5 ${over ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
                        {over
                          ? `Acima do disponível (${item.product.quantity})`
                          : `Disponível: ${item.product.quantity}`}
                      </p>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleStep(item.product.id, -1)} disabled={qtyNum <= 1}
                        className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 transition-colors flex items-center justify-center">
                        <Minus className="w-3 h-3" />
                      </button>
                      <input type="text" inputMode="decimal" value={item.qty}
                        onChange={e => handleQtyInput(item.product.id, e.target.value)}
                        className={`w-12 h-7 text-center text-sm font-bold rounded-lg border bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 transition-colors
                          ${over
                            ? 'border-red-400 dark:border-red-600 focus:ring-red-400/40 focus:border-red-400'
                            : 'border-slate-200 dark:border-slate-600 focus:ring-indigo-400/40 focus:border-indigo-400'}`} />
                      <button onClick={() => handleStep(item.product.id, 1)} disabled={qtyNum >= item.product.quantity}
                        className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-30 transition-colors flex items-center justify-center">
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Remover */}
                    <button onClick={() => handleRemove(item.product.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Motivo ───────────────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Motivo <span className="normal-case font-normal">(opcional)</span>
            </label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Ex: Reposição de emergência"
              className={fieldCls} />
          </div>

          {/* ── Erro inline ──────────────────────────────────────────────── */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80 px-5 py-4">
          {items.length > 0 && (
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Valor total da entrega</span>
              <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{formatCurrency(totalValue)}</span>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={onClose} disabled={isLoading}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors">
              Cancelar
            </button>
            <button onClick={handleConfirm}
              disabled={isLoading || items.length === 0 || !selectedSectorId || hasInvalidQty}
              className="flex-[2] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-sm shadow-indigo-600/20 disabled:opacity-50 transition-colors">
              {isLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Entregando…</>
                : <><CheckCircle className="w-4 h-4" /> Confirmar Entrega</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DirectDeliveryModal;
