// src/components/NewHotelTransferModal.tsx
// Redesenhado — slate design system, own overlay, stepper de quantidade,
// card de resumo com valor total animado, busca com dropdown polido.

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';
import {
  Loader2, Search, X, Package, Trash2, ArrowRight,
  ArrowLeftRight, ChevronDown, DollarSign, Plus, Minus,
  Building2, CheckCircle,
} from 'lucide-react';
import { transferMultipleProducts } from '../lib/transferService';

interface Product {
  id: string;
  name: string;
  quantity: number;
  image_url?: string;
  average_price?: number;
  is_active: boolean;
}

interface Hotel {
  id: string;
  name: string;
}

interface NewHotelTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  products: Product[];
}

// ── Input de campo estilizado ─────────────────────────────────────────────────
const fieldCls =
  'w-full rounded-xl border border-slate-200 dark:border-slate-600 ' +
  'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white ' +
  'placeholder-slate-400 text-sm px-3 py-2.5 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 ' +
  'transition-colors';

// ── Formatador BRL ─────────────────────────────────────────────────────────────
const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Componente principal ──────────────────────────────────────────────────────

const NewHotelTransferModal: React.FC<NewHotelTransferModalProps> = ({
  isOpen, onClose, onSuccess, products,
}) => {
  const { addNotification } = useNotification();
  const { user }            = useAuth();
  const { selectedHotel }   = useHotel();

  const [hotels,             setHotels]             = useState<Hotel[]>([]);
  const [destinationHotelId, setDestinationHotelId] = useState('');
  const [itemsToTransfer,    setItemsToTransfer]    = useState<{ product: Product; quantity: number }[]>([]);
  const [searchTerm,         setSearchTerm]         = useState('');
  const [isLoading,          setIsLoading]          = useState(false);
  const [imgErrors,          setImgErrors]          = useState<Record<string, boolean>>({});
  const [searchOpen,         setSearchOpen]         = useState(false);

  // ── Load hotels ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && selectedHotel) {
      supabase.from('hotels').select('id, name').neq('id', selectedHotel.id)
        .then(({ data, error }) => {
          if (error) addNotification('Erro ao buscar hotéis.', 'error');
          else setHotels(data || []);
        });
    }
    if (!isOpen) {
      setDestinationHotelId(''); setItemsToTransfer([]);
      setSearchTerm(''); setImgErrors({}); setSearchOpen(false);
    }
  }, [isOpen, selectedHotel, addNotification]);

  // ── Filtered products para o dropdown ──────────────────────────────────────
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    const transferIds = new Set(itemsToTransfer.map(i => i.product.id));
    return products
      .filter(p => p.is_active && !transferIds.has(p.id))
      .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .slice(0, 8);
  }, [searchTerm, products, itemsToTransfer]);

  const totalValue = useMemo(() =>
    itemsToTransfer.reduce((t, i) => t + (i.product.average_price || 0) * i.quantity, 0),
  [itemsToTransfer]);

  const destHotel = hotels.find(h => h.id === destinationHotelId);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleAddProduct = (product: Product) => {
    setItemsToTransfer(prev => [...prev, { product, quantity: 1 }]);
    setSearchTerm(''); setSearchOpen(false);
  };

  const handleRemove = (id: string) =>
    setItemsToTransfer(prev => prev.filter(i => i.product.id !== id));

  const handleQty = (id: string, delta: number) => {
    setItemsToTransfer(prev => prev.map(i => {
      if (i.product.id !== id) return i;
      const max = i.product.quantity;
      const next = Math.max(1, Math.min(i.quantity + delta, max));
      return { ...i, quantity: next };
    }));
  };

  const handleQtyInput = (id: string, value: string) => {
    const n = parseFloat(value);
    setItemsToTransfer(prev => prev.map(i => {
      if (i.product.id !== id) return i;
      const max = i.product.quantity;
      const next = isNaN(n) ? i.quantity : Math.max(1, Math.min(n, max));
      return { ...i, quantity: next };
    }));
  };

  const handleTransfer = async () => {
    if (!destinationHotelId)              { addNotification('Selecione um hotel de destino.', 'error'); return; }
    if (itemsToTransfer.length === 0)     { addNotification('Adicione pelo menos um item.', 'error'); return; }
    if (itemsToTransfer.some(i => i.quantity <= 0)) { addNotification('Todos os itens devem ter quantidade maior que zero.', 'error'); return; }

    setIsLoading(true);
    const payload = itemsToTransfer.map(i => ({ product_id: i.product.id, quantity: i.quantity }));
    const result  = await transferMultipleProducts(selectedHotel!.id, destinationHotelId, payload, user?.email || 'Sistema');
    if (result?.success) { addNotification('Transferência realizada com sucesso!', 'success'); onSuccess(); }
    else addNotification(`Falha na transferência: ${result?.message || 'Erro desconhecido.'}`, 'error');
    setIsLoading(false);
  };

  if (!isOpen) return null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-xl max-h-[96vh] sm:max-h-[90vh] flex flex-col overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shadow-sm shadow-orange-500/30">
              <ArrowLeftRight className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white leading-tight">Transferir Itens</h2>
              <p className="text-xs text-slate-400 leading-tight">Entre hotéis</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── Destino ──────────────────────────────────────────────────── */}
          <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Building2 className="w-4 h-4 text-orange-500" />
              Rota da Transferência
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                {selectedHotel?.name || 'Hotel atual'}
              </div>
              <ArrowRight className="w-4 h-4 text-orange-500 shrink-0" />
              <div className="flex-1 relative">
                <select value={destinationHotelId} onChange={e => setDestinationHotelId(e.target.value)}
                  className={fieldCls + ' appearance-none pr-8 cursor-pointer'}>
                  <option value="">Selecionar destino…</option>
                  {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
            </div>
            {destHotel && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle className="w-3.5 h-3.5" />
                Destino: <span className="font-bold">{destHotel.name}</span>
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
                placeholder="Buscar produto para transferir…"
                className={fieldCls + ' pl-9 pr-9'} />
              {searchTerm && (
                <button onClick={() => { setSearchTerm(''); setSearchOpen(false); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Dropdown */}
              {searchOpen && searchTerm && (
                <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
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
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate group-hover:text-orange-600 dark:group-hover:text-orange-400">{p.name}</p>
                          <p className="text-xs text-slate-400">Estoque: <span className="font-medium text-slate-600 dark:text-slate-300">{p.quantity}</span></p>
                        </div>
                        <Plus className="w-4 h-4 text-slate-300 group-hover:text-orange-500 shrink-0" />
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
              {itemsToTransfer.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-xs font-bold">
                  {itemsToTransfer.length} item{itemsToTransfer.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {itemsToTransfer.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                <Package className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm text-slate-400">Nenhum item adicionado ainda</p>
                <p className="text-xs text-slate-300 dark:text-slate-600 mt-0.5">Use a busca acima para adicionar produtos</p>
              </div>
            ) : (
              itemsToTransfer.map(item => {
                const subtotal = (item.product.average_price || 0) * item.quantity;
                return (
                  <div key={item.product.id}
                    className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-orange-200 dark:hover:border-orange-800 transition-colors">

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
                          Unit: <span className="font-medium text-slate-600 dark:text-slate-300">{fmtBRL(item.product.average_price || 0)}</span>
                        </span>
                        <span className="text-xs text-orange-600 dark:text-orange-400 font-semibold">
                          = {fmtBRL(subtotal)}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">Disponível: {item.product.quantity}</p>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleQty(item.product.id, -1)} disabled={item.quantity <= 1}
                        className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 transition-colors flex items-center justify-center">
                        <Minus className="w-3 h-3" />
                      </button>
                      <input type="text" inputMode="decimal" value={item.quantity}
                        onChange={e => handleQtyInput(item.product.id, e.target.value)}
                        className="w-10 h-7 text-center text-sm font-bold rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 transition-colors" />
                      <button onClick={() => handleQty(item.product.id, 1)} disabled={item.quantity >= item.product.quantity}
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
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80 px-5 py-4">
          {itemsToTransfer.length > 0 && (
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Valor total da transferência</span>
              <span className="text-lg font-bold text-orange-600 dark:text-orange-400 tabular-nums">{fmtBRL(totalValue)}</span>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Cancelar
            </button>
            <button onClick={handleTransfer} disabled={isLoading || itemsToTransfer.length === 0 || !destinationHotelId}
              className="flex-[2] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold shadow-sm shadow-orange-500/20 disabled:opacity-50 transition-colors">
              {isLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Transferindo…</>
                : <><ArrowRight className="w-4 h-4" /> Confirmar Transferência</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewHotelTransferModal;
