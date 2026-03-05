/**
 * OnlinePurchaseList.tsx
 * Orçamento Online — suporta scraping automático de ML e outros sites.
 * Multi-produto, carrossel de imagens, formas de pagamento, frete editável.
 * Salva no banco igual ao orçamento físico + dispara notificações.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ShoppingCart, Plus, X, Trash2, ExternalLink,
  ChevronLeft, ChevronRight, Truck, Save, AlertTriangle,
  Loader2, Link2, Image as ImageIcon, Edit3, CreditCard,
  Banknote, Package, ChevronDown, ChevronUp,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { supabase, saveBudget } from '../lib/supabase';
import { createNotification } from '../lib/notifications';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PaymentType = 'cash' | 'installment';
type ShippingType = 'free' | 'paid' | 'conditional'; // conditional = grátis acima de N unid.

interface OnlineProduct {
  id: string;
  name: string;
  images: string[];          // array de URLs — usuário pode add/remove
  quantity: number;
  unitPrice: number;
  paymentType: PaymentType;
  installments: number;      // só se paymentType === 'installment'
  installmentValue: number;  // valor por parcela
  installmentsNoInterest: boolean;
  shippingType: ShippingType;
  shippingCost: number;      // custo do frete (se pago)
  shippingFreeAbove: number; // grátis acima de X unidades
  productLink: string;
  site: string;
  note: string;
}

interface ScrapeResult {
  title: string;
  images: string[];
  price: number | null;
  originalPrice: number | null;
  shippingFree: boolean;
  shippingCost: number | null;
  installments: number | null;
  installmentValue: number | null;
  currency: string;
  site: string;
  url: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeEmptyProduct = (): OnlineProduct => ({
  id: `online-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name: '',
  images: [],
  quantity: 1,
  unitPrice: 0,
  paymentType: 'cash',
  installments: 2,
  installmentValue: 0,
  installmentsNoInterest: true,
  shippingType: 'free',
  shippingCost: 0,
  shippingFreeAbove: 0,
  productLink: '',
  site: '',
  note: '',
});

const totalForProduct = (p: OnlineProduct): number => {
  const base = p.paymentType === 'installment'
    ? p.installments * p.installmentValue
    : p.unitPrice;
  const freight = p.shippingType === 'paid'
    ? p.shippingCost
    : p.shippingType === 'conditional' && p.quantity < p.shippingFreeAbove
      ? p.shippingCost
      : 0;
  return (base + freight) * p.quantity;
};

const unitTotalForProduct = (p: OnlineProduct): number => {
  const base = p.paymentType === 'installment'
    ? p.installments * p.installmentValue
    : p.unitPrice;
  const freight = p.shippingType === 'paid'
    ? p.shippingCost
    : p.shippingType === 'conditional' && p.quantity < p.shippingFreeAbove
      ? p.shippingCost
      : 0;
  return base + freight;
};

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ─── Componente: carrossel de imagens ─────────────────────────────────────────

const ImageCarousel: React.FC<{
  images: string[];
  onRemove: (idx: number) => void;
  onAdd: (url: string) => void;
}> = ({ images, onRemove, onAdd }) => {
  const [current, setCurrent] = useState(0);
  const [addUrl, setAddUrl] = useState('');

  const prev = () => setCurrent(i => (i - 1 + images.length) % images.length);
  const next = () => setCurrent(i => (i + 1) % images.length);

  const handleAdd = () => {
    const url = addUrl.trim();
    if (!url) return;
    onAdd(url);
    setAddUrl('');
  };

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 bg-gray-100 dark:bg-gray-700/50 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 gap-2">
        <ImageIcon className="h-8 w-8 text-gray-400" />
        <p className="text-xs text-gray-400">Sem imagens</p>
        <div className="flex gap-2 mt-1 px-4 w-full">
          <input
            type="url"
            value={addUrl}
            onChange={e => setAddUrl(e.target.value)}
            placeholder="Colar URL da imagem…"
            className="flex-1 text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleAdd}
            className="px-2 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      {/* Imagem principal */}
      <div className="relative h-44 sm:h-52 bg-gray-100 dark:bg-gray-800 rounded-2xl overflow-hidden">
        <img
          src={images[current]}
          alt={`Imagem ${current + 1}`}
          className="w-full h-full object-contain"
          onError={e => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50" font-size="40">🖼️</text></svg>'; }}
        />

        {/* Botão remover imagem atual */}
        <button
          onClick={() => { onRemove(current); setCurrent(i => Math.max(0, i - 1)); }}
          className="absolute top-2 right-2 p-1 bg-red-500/80 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remover esta imagem"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Navegação */}
        {images.length > 1 && (
          <>
            <button onClick={prev} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/40 hover:bg-black/60 text-white rounded-full transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={next} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/40 hover:bg-black/60 text-white rounded-full transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Indicador */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${i === current ? 'bg-white w-3' : 'bg-white/50'}`}
            />
          ))}
        </div>
      </div>

      {/* Miniaturas */}
      <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${i === current ? 'border-blue-500' : 'border-transparent opacity-60 hover:opacity-100'}`}
          >
            <img src={img} alt="" className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="60" font-size="50">📷</text></svg>'; }}
            />
          </button>
        ))}
        {/* Add imagem */}
        <div className="flex-shrink-0 flex items-center gap-1">
          <input
            type="url"
            value={addUrl}
            onChange={e => setAddUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="+ URL"
            className="w-20 text-[11px] px-1.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-blue-500"
          />
          <button onClick={handleAdd} className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Componente: card de produto ──────────────────────────────────────────────

const ProductCard: React.FC<{
  product: OnlineProduct;
  onChange: (id: string, updates: Partial<OnlineProduct>) => void;
  onRemove: (id: string) => void;
  index: number;
}> = ({ product, onChange, onRemove, index }) => {
  const [expanded, setExpanded] = useState(true);
  const up = (updates: Partial<OnlineProduct>) => onChange(product.id, updates);

  const total = totalForProduct(product);
  const unitTotal = unitTotalForProduct(product);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* ── Header do card ── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Produto</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
            {product.name || 'Sem nome'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {product.productLink && (
            <a href={product.productLink} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
              title="Abrir link"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <button onClick={() => setExpanded(e => !e)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button onClick={() => onRemove(product.id)}
            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-5">
          {/* Imagens */}
          <ImageCarousel
            images={product.images}
            onRemove={idx => up({ images: product.images.filter((_, i) => i !== idx) })}
            onAdd={url => up({ images: [...product.images, url] })}
          />

          {/* Nome */}
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">
              Nome do produto
            </label>
            <input
              type="text"
              value={product.name}
              onChange={e => up({ name: e.target.value })}
              placeholder="Nome completo do produto…"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Link */}
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">
              Link do anúncio
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={product.productLink}
                onChange={e => up({ productLink: e.target.value })}
                placeholder="https://…"
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-xs"
              />
              {product.productLink && (
                <a href={product.productLink} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl hover:bg-blue-200 transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>

          {/* Preço + tipo de pagamento */}
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
              Forma de pagamento
            </label>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => up({ paymentType: 'cash' })}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all border ${
                  product.paymentType === 'cash'
                    ? 'bg-green-600 text-white border-green-600 shadow-sm'
                    : 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-green-400'
                }`}
              >
                <Banknote className="h-4 w-4" /> À vista
              </button>
              <button
                onClick={() => up({ paymentType: 'installment' })}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all border ${
                  product.paymentType === 'installment'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-400'
                }`}
              >
                <CreditCard className="h-4 w-4" /> Parcelado
              </button>
            </div>

            {product.paymentType === 'cash' ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400 font-medium">R$</span>
                <input
                  type="number"
                  value={product.unitPrice || ''}
                  onChange={e => up({ unitPrice: parseFloat(e.target.value) || 0 })}
                  placeholder="0,00"
                  min="0"
                  step="0.01"
                  className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 font-semibold"
                />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[10px] text-gray-400 mb-1 font-medium">Parcelas</p>
                  <input
                    type="number"
                    value={product.installments}
                    onChange={e => up({ installments: parseInt(e.target.value) || 2 })}
                    min="2"
                    max="48"
                    className="w-full px-2 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-center font-semibold"
                  />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-1 font-medium">Vlr. parcela</p>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-400">R$</span>
                    <input
                      type="number"
                      value={product.installmentValue || ''}
                      onChange={e => up({ installmentValue: parseFloat(e.target.value) || 0 })}
                      placeholder="0,00"
                      step="0.01"
                      min="0"
                      className="w-full px-1 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                    />
                  </div>
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={product.installmentsNoInterest}
                      onChange={e => up({ installmentsNoInterest: e.target.checked })}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">Sem juros</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Frete */}
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
              Frete
            </label>
            <div className="flex gap-2 mb-3">
              {(['free', 'paid', 'conditional'] as ShippingType[]).map(type => (
                <button
                  key={type}
                  onClick={() => up({ shippingType: type })}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all border ${
                    product.shippingType === type
                      ? type === 'free'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : type === 'paid'
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                  }`}
                >
                  {type === 'free' ? '🟢 Grátis' : type === 'paid' ? '🟠 Pago' : '🔵 Cond.'}
                </button>
              ))}
            </div>

            {product.shippingType === 'paid' && (
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-orange-500 flex-shrink-0" />
                <span className="text-sm text-gray-400">R$</span>
                <input
                  type="number"
                  value={product.shippingCost || ''}
                  onChange={e => up({ shippingCost: parseFloat(e.target.value) || 0 })}
                  placeholder="0,00"
                  step="0.01"
                  min="0"
                  className="flex-1 px-3 py-2 rounded-xl border border-orange-200 dark:border-orange-800/50 bg-orange-50 dark:bg-orange-900/10 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            )}

            {product.shippingType === 'conditional' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Frete R$</span>
                  <input
                    type="number"
                    value={product.shippingCost || ''}
                    onChange={e => up({ shippingCost: parseFloat(e.target.value) || 0 })}
                    placeholder="valor"
                    step="0.01"
                    min="0"
                    className="flex-1 px-3 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-900/10 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <span className="text-xs text-gray-500 whitespace-nowrap">grátis acima de</span>
                  <input
                    type="number"
                    value={product.shippingFreeAbove || ''}
                    onChange={e => up({ shippingFreeAbove: parseInt(e.target.value) || 0 })}
                    placeholder="N"
                    min="1"
                    className="w-16 px-2 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-900/10 text-sm text-center text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <span className="text-xs text-gray-500">und.</span>
                </div>
                <p className="text-[11px] text-indigo-500 dark:text-indigo-400">
                  {product.quantity >= product.shippingFreeAbove && product.shippingFreeAbove > 0
                    ? '✓ Frete grátis para a quantidade atual'
                    : `Frete pago para a quantidade atual (${product.quantity} und.)`
                  }
                </p>
              </div>
            )}
          </div>

          {/* Quantidade */}
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
              Quantidade
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => up({ quantity: Math.max(1, product.quantity - 1) })}
                className="w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-bold text-lg"
              >−</button>
              <input
                type="number"
                value={product.quantity}
                onChange={e => up({ quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                min="1"
                className="w-20 text-center px-2 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-lg font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => up({ quantity: product.quantity + 1 })}
                className="w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-bold text-lg"
              >+</button>
            </div>
          </div>

          {/* Nota */}
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">
              Observação (opcional)
            </label>
            <textarea
              value={product.note}
              onChange={e => up({ note: e.target.value })}
              placeholder="Ex: Compra pilhas para Maria Maria…"
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Totalizador do produto */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl p-4 border border-blue-100 dark:border-blue-800/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-blue-500 font-bold uppercase tracking-wide">
                Vlr. unit. total
              </span>
              <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                {fmtBRL(unitTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-indigo-500 font-bold uppercase tracking-wide">
                Total ({product.quantity} und.)
              </span>
              <span className="text-xl font-black text-indigo-700 dark:text-indigo-300">
                {fmtBRL(total)}
              </span>
            </div>
            {product.shippingType === 'free' && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">✓ Frete grátis incluso</p>
            )}
            {product.paymentType === 'installment' && (
              <p className="text-[11px] text-blue-500 mt-1">
                {product.installments}x de {fmtBRL(product.installmentValue)}{product.installmentsNoInterest ? ' sem juros' : ' com juros'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Componente: modal de adicionar produto (link ou manual) ───────────────────

const AddProductModal: React.FC<{
  onAdd: (product: OnlineProduct) => void;
  onClose: () => void;
}> = ({ onAdd, onClose }) => {
  const { addNotification } = useNotification();
  const [tab, setTab] = useState<'link' | 'manual'>('link');
  const [linkInput, setLinkInput] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [draft, setDraft] = useState<OnlineProduct>(makeEmptyProduct());
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const upDraft = (updates: Partial<OnlineProduct>) =>
    setDraft(prev => ({ ...prev, ...updates }));

  const handleScrape = async () => {
    const url = linkInput.trim();
    if (!url) return;
    setScrapeError(null);
    setIsScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-product', {
        body: { url },
      });
      if (error) throw error;
      const r = data as ScrapeResult;
      if (r.error) throw new Error(r.error);

      setDraft(prev => ({
        ...prev,
        name: r.title || prev.name,
        images: r.images?.length ? r.images : prev.images,
        unitPrice: r.price ?? prev.unitPrice,
        productLink: url,
        site: r.site || prev.site,
        shippingType: r.shippingFree ? 'free' : r.shippingCost ? 'paid' : 'free',
        shippingCost: r.shippingCost ?? 0,
        installments: r.installments ?? 2,
        installmentValue: r.installmentValue ?? 0,
      }));
      setTab('manual'); // vai para edição com dados pré-preenchidos
      addNotification('Dados carregados! Revise e ajuste.', 'success');
    } catch (err: any) {
      setScrapeError(err.message || 'Não foi possível carregar dados do link.');
      // Mesmo com erro, preenche o link para edição manual
      setDraft(prev => ({ ...prev, productLink: url }));
      setTab('manual');
    } finally {
      setIsScraping(false);
    }
  };

  const handleAdd = () => {
    if (!draft.name.trim()) {
      addNotification('Nome do produto é obrigatório.', 'warning');
      return;
    }
    if (draft.paymentType === 'cash' && !draft.unitPrice) {
      addNotification('Informe o preço do produto.', 'warning');
      return;
    }
    if (draft.paymentType === 'installment' && (!draft.installments || !draft.installmentValue)) {
      addNotification('Informe parcelas e valor da parcela.', 'warning');
      return;
    }
    onAdd({ ...draft, id: `online-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between z-10">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Adicionar Produto</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-3 border-b border-gray-100 dark:border-gray-700">
          <button
            onClick={() => setTab('link')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'link' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <Link2 className="h-4 w-4 inline mr-1.5" />
            Colar Link
          </button>
          <button
            onClick={() => setTab('manual')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'manual' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <Edit3 className="h-4 w-4 inline mr-1.5" />
            Manual
          </button>
        </div>

        <div className="p-5 space-y-4 flex-1">
          {/* Tab: Link */}
          {tab === 'link' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                  URL do produto
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={linkInput}
                    onChange={e => setLinkInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleScrape()}
                    placeholder="https://www.mercadolivre.com.br/…"
                    className="flex-1 px-3 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    autoFocus
                  />
                  <button
                    onClick={handleScrape}
                    disabled={isScraping || !linkInput.trim()}
                    className="px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
                  >
                    {isScraping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                    <span className="hidden sm:inline">{isScraping ? 'Buscando…' : 'Buscar'}</span>
                  </button>
                </div>
                {scrapeError && (
                  <div className="mt-2 flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl">
                    <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Não foi possível extrair dados automaticamente</p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{scrapeError}</p>
                      <button onClick={() => setTab('manual')} className="text-xs text-blue-600 underline mt-1">Preencher manualmente →</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 dark:bg-gray-700/30 rounded-2xl p-4 text-center">
                <Package className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  Cole o link do Mercado Livre ou qualquer loja online.<br />
                  Os dados serão extraídos automaticamente.
                </p>
              </div>
            </div>
          )}

          {/* Tab: Manual + edição pós-scraping */}
          {tab === 'manual' && (
            <div className="space-y-4">
              {/* Preview imagens */}
              <ImageCarousel
                images={draft.images}
                onRemove={idx => upDraft({ images: draft.images.filter((_, i) => i !== idx) })}
                onAdd={url => upDraft({ images: [...draft.images, url] })}
              />

              {/* Nome */}
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Nome*</label>
                <input type="text" value={draft.name} onChange={e => upDraft({ name: e.target.value })}
                  placeholder="Nome do produto…"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Pagamento */}
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Pagamento*</label>
                <div className="flex gap-2 mb-3">
                  {(['cash', 'installment'] as PaymentType[]).map(t => (
                    <button key={t} onClick={() => upDraft({ paymentType: t })}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${draft.paymentType === t ? (t === 'cash' ? 'bg-green-600 text-white border-green-600' : 'bg-blue-600 text-white border-blue-600') : 'bg-gray-50 dark:bg-gray-700/50 text-gray-500 border-gray-200 dark:border-gray-600'}`}
                    >
                      {t === 'cash' ? '💵 À vista' : '💳 Parcelado'}
                    </button>
                  ))}
                </div>
                {draft.paymentType === 'cash' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">R$</span>
                    <input type="number" value={draft.unitPrice || ''} onChange={e => upDraft({ unitPrice: parseFloat(e.target.value) || 0 })}
                      placeholder="0,00" step="0.01" min="0"
                      className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 font-semibold"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1">Parcelas</p>
                      <input type="number" value={draft.installments} onChange={e => upDraft({ installments: parseInt(e.target.value) || 2 })}
                        min="2" max="48"
                        className="w-full px-2 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-center font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1">Vlr. parcela</p>
                      <input type="number" value={draft.installmentValue || ''} onChange={e => upDraft({ installmentValue: parseFloat(e.target.value) || 0 })}
                        placeholder="0,00" step="0.01" min="0"
                        className="w-full px-2 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex items-end pb-2.5">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={draft.installmentsNoInterest} onChange={e => upDraft({ installmentsNoInterest: e.target.checked })} className="rounded" />
                        <span className="text-[11px] text-gray-500">Sem juros</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Frete */}
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Frete</label>
                <div className="flex gap-2 mb-3">
                  {(['free', 'paid', 'conditional'] as ShippingType[]).map(t => (
                    <button key={t} onClick={() => upDraft({ shippingType: t })}
                      className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${draft.shippingType === t ? (t === 'free' ? 'bg-emerald-600 text-white border-emerald-600' : t === 'paid' ? 'bg-orange-500 text-white border-orange-500' : 'bg-indigo-600 text-white border-indigo-600') : 'bg-gray-50 dark:bg-gray-700/50 text-gray-500 border-gray-200 dark:border-gray-600'}`}
                    >
                      {t === 'free' ? '🟢 Grátis' : t === 'paid' ? '🟠 Pago' : '🔵 Cond.'}
                    </button>
                  ))}
                </div>
                {draft.shippingType === 'paid' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">R$</span>
                    <input type="number" value={draft.shippingCost || ''} onChange={e => upDraft({ shippingCost: parseFloat(e.target.value) || 0 })}
                      placeholder="0,00" step="0.01" min="0"
                      className="flex-1 px-3 py-2.5 rounded-xl border border-orange-200 dark:border-orange-800/50 bg-orange-50 dark:bg-orange-900/10 text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                  </div>
                )}
                {draft.shippingType === 'conditional' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">R$</span>
                    <input type="number" value={draft.shippingCost || ''} onChange={e => upDraft({ shippingCost: parseFloat(e.target.value) || 0 })}
                      placeholder="valor" step="0.01" min="0"
                      className="w-20 px-2 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-900/10 text-sm text-gray-900 dark:text-white focus:outline-none"
                    />
                    <span className="text-xs text-gray-500">grátis acima de</span>
                    <input type="number" value={draft.shippingFreeAbove || ''} onChange={e => upDraft({ shippingFreeAbove: parseInt(e.target.value) || 0 })}
                      placeholder="N" min="1"
                      className="w-16 px-2 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-900/10 text-sm text-center text-gray-900 dark:text-white focus:outline-none"
                    />
                    <span className="text-xs text-gray-500">und.</span>
                  </div>
                )}
              </div>

              {/* Qtd + link + nota */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Quantidade</label>
                  <input type="number" value={draft.quantity} onChange={e => upDraft({ quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                    min="1"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-center font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Total</label>
                  <div className="px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30">
                    <p className="text-sm font-black text-blue-700 dark:text-blue-300">{fmtBRL(totalForProduct(draft))}</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Link (opcional)</label>
                <input type="url" value={draft.productLink} onChange={e => upDraft({ productLink: e.target.value })}
                  placeholder="https://…"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-xs font-mono text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Observação</label>
                <textarea value={draft.note} onChange={e => upDraft({ note: e.target.value })}
                  placeholder="Compra para…" rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white dark:bg-gray-800 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancelar
          </button>
          {tab === 'manual' && (
            <button onClick={handleAdd}
              className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm"
            >
              Adicionar produto
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Página principal ──────────────────────────────────────────────────────────

const OnlinePurchaseList: React.FC = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [products, setProducts] = useState<OnlineProduct[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = format(new Date(), "dd/MM/yyyy", { locale: ptBR });
  const grandTotal = products.reduce((s, p) => s + totalForProduct(p), 0);

  const handleChange = useCallback((id: string, updates: Partial<OnlineProduct>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    addNotification('Produto removido.', 'info');
  }, [addNotification]);

  const handleAdd = useCallback((product: OnlineProduct) => {
    setProducts(prev => [...prev, product]);
    setShowAddModal(false);
    addNotification(`"${product.name}" adicionado ao orçamento.`, 'success');
  }, [addNotification]);

  const saveBudgetToDatabase = async () => {
    if (!selectedHotel?.id) {
      addNotification('Nenhum hotel selecionado.', 'error'); return;
    }
    if (products.length === 0) {
      addNotification('Adicione pelo menos um produto.', 'warning'); return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const budgetItems = products.map(p => {
        const unitTotal = unitTotalForProduct(p);
        let site = p.site;
        if (!site && p.productLink) {
          try { site = new URL(p.productLink).hostname.replace('www.', ''); } catch {}
        }
        return {
          product_id: null,
          custom_item_name: p.note ? `${p.name} — ${p.note}` : p.name,
          quantity: p.quantity,
          unit_price: unitTotal,
          supplier: site || 'Loja Online',
          last_purchase_quantity: null,
          last_purchase_price: null,
          last_purchase_date: null,
          weight: null,
          unit: 'und',
          stock_at_creation: null,
          // Campos online específicos
          is_online: true,
          product_link: p.productLink || null,
          image_urls: p.images.length ? p.images : null,
          shipping_cost: p.shippingType === 'free' ? 0 : p.shippingCost,
          payment_type: p.paymentType,
          installments: p.paymentType === 'installment' ? p.installments : null,
          installment_value: p.paymentType === 'installment' ? p.installmentValue : null,
        };
      });

      const result = await saveBudget(selectedHotel.id, grandTotal, budgetItems);
      if (!result.success || !result.data) throw new Error(result.error || 'Falha ao salvar.');

      addNotification('Orçamento online salvo com sucesso!', 'success');

      // Notificação
      try {
        const mainSite = budgetItems[0]?.supplier || 'Loja Online';
        await createNotification({
          event_type: 'NEW_BUDGET',
          hotel_id: selectedHotel.id,
          title: `Novo orçamento online — ${selectedHotel.name}`,
          content: `Orçamento online de ${mainSite} · R$ ${grandTotal.toFixed(2).replace('.', ',')} · ${products.length} produto(s)`,
          link: '/authorizations',
          metadata: {
            budget_id: result.data.id,
            total_value: grandTotal,
            supplier: mainSite,
            items_count: products.length,
            is_online: true,
            hotel_name: selectedHotel.name,
          },
        });
      } catch (notifErr) {
        console.warn('Notificação falhou (não crítico):', notifErr);
      }

      navigate('/budget-history');
    } catch (err: any) {
      const msg = err.message || 'Erro ao salvar orçamento.';
      setError(msg);
      addNotification(msg, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-32">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

        {/* ── Header ── */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <Link to="/purchases"
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Orçamento Online
              </h1>
            </div>
          </div>

          {/* Botão Salvar no header */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <span className="font-medium">{selectedHotel?.name || 'Hotel não selecionado'}</span>
              <span>·</span>
              <span>{today}</span>
            </div>
            <button
              onClick={saveBudgetToDatabase}
              disabled={isSaving || products.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium text-sm shadow-sm"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? 'Salvando…' : 'Salvar Orçamento'}
            </button>
          </div>
        </div>

        {/* ── Erro ── */}
        {error && (
          <div className="mb-4 flex items-start gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* ── Lista de produtos ── */}
        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
              <ShoppingCart className="h-8 w-8 text-blue-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-700 dark:text-gray-300 mb-2">
              Nenhum produto adicionado
            </h3>
            <p className="text-sm text-gray-400 dark:text-gray-500 max-w-xs mb-6">
              Cole um link do Mercado Livre ou adicione manualmente.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-colors font-bold shadow-sm"
            >
              <Plus className="h-5 w-5" />
              Adicionar Produto
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {products.map((p, i) => (
              <ProductCard
                key={p.id}
                product={p}
                index={i}
                onChange={handleChange}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── FAB + Total fixo no bottom ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md border-t border-gray-200 dark:border-gray-700 px-4 py-3 z-20">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {/* Total */}
          {products.length > 0 && (
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Total geral</p>
              <p className="text-lg font-black text-gray-900 dark:text-white leading-none">
                {fmtBRL(grandTotal)}
              </p>
              <p className="text-[11px] text-gray-400">{products.length} produto{products.length !== 1 ? 's' : ''}</p>
            </div>
          )}
          {/* Botão add */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-colors font-bold shadow-lg flex-shrink-0"
          >
            <Plus className="h-5 w-5" />
            <span>Adicionar</span>
          </button>
          {/* Salvar bottom */}
          {products.length > 0 && (
            <button
              onClick={saveBudgetToDatabase}
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-3 bg-green-600 text-white rounded-2xl hover:bg-green-700 disabled:bg-gray-300 transition-colors font-bold shadow-lg flex-shrink-0"
            >
              {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              <span className="hidden sm:inline">{isSaving ? 'Salvando…' : 'Salvar'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Modal de adicionar ── */}
      {showAddModal && (
        <AddProductModal
          onAdd={handleAdd}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
};

export default OnlinePurchaseList;
