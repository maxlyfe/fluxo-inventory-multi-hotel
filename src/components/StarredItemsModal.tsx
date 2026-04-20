// src/components/StarredItemsModal.tsx
// Redesenhado — slate design system, barra de estoque visual, badge de alerta.

import React from 'react';
import { Star, Package, AlertTriangle } from 'lucide-react';
import Modal from './Modal';

interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  category: string;
  image_url?: string;
  is_starred?: boolean;
}

interface StarredItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  starredProducts: Product[];
}

const StarredItemsModal: React.FC<StarredItemsModalProps> = ({ isOpen, onClose, starredProducts }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="">
      {/* Custom header inside modal body */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Star className="w-4 h-4 text-amber-500 fill-current" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-white leading-tight">Principais Itens</h2>
          <p className="text-xs text-slate-400">{starredProducts.length} item{starredProducts.length !== 1 ? 's' : ''} favorito{starredProducts.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-2">
        {starredProducts.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mx-auto mb-3">
              <Star className="w-7 h-7 text-amber-300 dark:text-amber-600" />
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Nenhum item favoritado</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-[240px] mx-auto">
              Clique na estrela ao lado de um produto no inventário para adicioná-lo aqui.
            </p>
          </div>
        ) : (
          starredProducts.map(product => {
            const isLow = product.quantity <= product.min_quantity;
            const pct   = product.max_quantity > 0
              ? Math.min(100, (product.quantity / product.max_quantity) * 100)
              : 0;
            const barColor = product.quantity === 0
              ? 'bg-red-500'
              : isLow ? 'bg-amber-500' : pct >= 60 ? 'bg-emerald-500' : 'bg-blue-500';

            return (
              <div key={product.id}
                className={`flex items-center gap-3 p-3 rounded-2xl border transition-colors ${
                  isLow
                    ? 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10'
                    : 'border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/60'
                }`}>

                {/* Imagem */}
                <div className="w-12 h-12 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                  {product.image_url
                    ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" />
                    : <Package className="w-5 h-5 text-slate-300 dark:text-slate-600" />
                  }
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{product.name}</p>
                    {isLow && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  </div>
                  <p className="text-xs text-slate-400 mb-1.5">{product.category}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                      min {product.min_quantity}
                    </span>
                  </div>
                </div>

                {/* Quantidade */}
                <div className="text-right shrink-0">
                  <p className={`text-xl font-bold tabular-nums leading-tight ${
                    product.quantity === 0
                      ? 'text-red-500 dark:text-red-400'
                      : isLow
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-800 dark:text-white'
                  }`}>{product.quantity}</p>
                  <p className="text-[10px] text-slate-400">em estoque</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
};

export default StarredItemsModal;
