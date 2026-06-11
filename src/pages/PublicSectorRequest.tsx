// src/pages/PublicSectorRequest.tsx
// Página pública de requisição por setor via link temporário (sem login).
// Rota: /request/:token — colaborador informa o nome e faz pedidos de material.

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Package, Search, Loader2, ShieldAlert, ArrowRight, Plus,
  CheckCircle2, X, ShoppingCart, Clock,
} from 'lucide-react';

interface LinkInfo { hotel_id: string; hotel_name: string; sector_id: string; sector_name: string; expires_at: string; }
interface Product { id: string; name: string; category: string | null; image_url: string | null; }
interface SentItem { name: string; qty: number; at: string; }

type Step = 'validating' | 'invalid' | 'name' | 'cart';

export default function PublicSectorRequest() {
  const { token = '' } = useParams<{ token: string }>();

  const [step, setStep]         = useState<Step>('validating');
  const [info, setInfo]         = useState<LinkInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName]         = useState('');
  const [search, setSearch]     = useState('');
  const [category, setCategory] = useState<string>('');
  const [sent, setSent]         = useState<SentItem[]>([]);
  const [imgErr, setImgErr]     = useState<Record<string, boolean>>({});

  // Modal de quantidade
  const [qtyProduct, setQtyProduct] = useState<Product | null>(null);
  const [qty, setQty]               = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  // Item avulso (não catalogado)
  const [customName, setCustomName] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  // ── Validar token + carregar produtos ────────────────────────────────────
  useEffect(() => {
    if (!token) { setStep('invalid'); return; }
    (async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_request_link_info', { p_token: token });
        const row = Array.isArray(data) ? data[0] : data;
        if (err || !row) { setStep('invalid'); return; }
        setInfo(row as LinkInfo);

        const { data: prods } = await supabase.rpc('get_products_for_request_link', { p_token: token });
        setProducts((prods as Product[]) || []);

        // Nome salvo anteriormente neste aparelho → pula direto pro carrinho
        const savedName = localStorage.getItem(`req_link_name:${token}`);
        if (savedName) { setName(savedName); setStep('cart'); }
        else setStep('name');
      } catch { setStep('invalid'); }
    })();
  }, [token]);

  const categories = useMemo(
    () => [...new Set(products.map(p => p.category || 'Sem Categoria'))].sort(),
    [products],
  );

  const filtered = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
    } else if (category) {
      list = list.filter(p => (p.category || 'Sem Categoria') === category);
    }
    return list;
  }, [products, search, category]);

  const startName = () => {
    if (name.trim().length < 2) return;
    localStorage.setItem(`req_link_name:${token}`, name.trim());
    setStep('cart');
  };

  // ── Enviar pedido (produto ou item avulso) ────────────────────────────────
  const submit = async (productId: string | null, itemName: string) => {
    const q = parseFloat(qty.replace(',', '.'));
    if (isNaN(q) || q <= 0) { setError('Quantidade inválida.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const { error: err } = await supabase.rpc('submit_request_via_link', {
        p_token: token,
        p_requester_name: name.trim(),
        p_product_id: productId,
        p_item_name: itemName,
        p_quantity: q,
      });
      if (err) throw err;
      setSent(prev => [{ name: itemName, qty: q, at: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }, ...prev]);
      setQtyProduct(null); setQty('1'); setShowCustom(false); setCustomName('');
    } catch (e: any) {
      setError(e.message?.includes('expirado') ? 'Este link expirou. Peça um novo ao responsável.' : (e.message || 'Erro ao enviar pedido.'));
    } finally {
      setSubmitting(false);
    }
  };

  const expiresBR = info ? new Date(info.expires_at).toLocaleDateString('pt-BR') : '';

  // ── Telas de estado ───────────────────────────────────────────────────────
  if (step === 'validating') return (
    <div className="min-h-[100dvh] bg-slate-950 flex flex-col items-center justify-center gap-3 text-slate-400">
      <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
      <p className="text-sm">Verificando link…</p>
    </div>
  );

  if (step === 'invalid') return (
    <div className="min-h-[100dvh] bg-slate-950 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
        <ShieldAlert className="w-7 h-7 text-red-400" />
      </div>
      <h1 className="text-lg font-bold text-white">Link indisponível</h1>
      <p className="text-sm text-slate-400 max-w-xs">Este link de requisição não existe ou expirou. Peça um novo ao responsável do hotel.</p>
    </div>
  );

  if (step === 'name') return (
    <div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-900 rounded-3xl border border-slate-700/60 overflow-hidden shadow-2xl">
        <div className="px-6 pt-7 pb-5 bg-gradient-to-br from-teal-600 to-cyan-700 text-white">
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center mb-3">
            <ShoppingCart className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold leading-tight">Requisição de Material</h1>
          <p className="text-sm text-white/80 mt-1">{info?.hotel_name} · {info?.sector_name}</p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-teal-400/90 uppercase tracking-widest mb-1.5">Seu nome *</label>
            <input
              type="text" value={name} autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && startName()}
              placeholder="Digite seu nome completo"
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">Será registrado quem fez cada pedido.</p>
          </div>
          <button onClick={startName} disabled={name.trim().length < 2}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold disabled:opacity-40 transition-colors">
            Começar <ArrowRight className="w-4 h-4" />
          </button>
          <p className="text-[11px] text-slate-500 text-center flex items-center justify-center gap-1">
            <Clock className="w-3 h-3" /> Link válido até {expiresBR}
          </p>
        </div>
      </div>
    </div>
  );

  // ── step === 'cart' ───────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-teal-700/95 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight truncate">{info?.sector_name}</p>
            <p className="text-[11px] text-white/70 truncate">{info?.hotel_name} · {name}</p>
          </div>
          {sent.length > 0 && (
            <span className="shrink-0 text-xs font-bold text-white bg-white/20 px-2.5 py-1 rounded-full">
              {sent.length} enviado{sent.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Busca + categorias */}
      <div className="sticky top-[52px] z-10 bg-slate-950/95 backdrop-blur px-4 pt-3 pb-2 space-y-2 border-b border-slate-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto…"
            className="w-full h-10 pl-9 pr-9 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-slate-500"><X className="w-3.5 h-3.5" /></button>
          )}
        </div>
        {!search && categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            <button onClick={() => setCategory('')}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold ${!category ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-400'}`}>Todos</button>
            {categories.map(c => (
              <button key={c} onClick={() => setCategory(c)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold ${category === c ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-400'}`}>{c}</button>
            ))}
          </div>
        )}
      </div>

      {/* Lista de produtos */}
      <div className="flex-1 px-4 py-3 space-y-2 pb-28">
        {/* Enviados (resumo) */}
        {sent.length > 0 && (
          <div className="rounded-2xl border border-emerald-800/50 bg-emerald-900/15 p-3 space-y-1.5 mb-2">
            <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Pedidos enviados
            </p>
            {sent.slice(0, 5).map((s, i) => (
              <p key={i} className="text-xs text-emerald-200/80">{s.qty}× {s.name} <span className="text-emerald-500/60">· {s.at}</span></p>
            ))}
            {sent.length > 5 && <p className="text-[11px] text-emerald-500/60">+{sent.length - 5} anteriores</p>}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
            <Package className="w-10 h-10 opacity-30" />
            <p className="text-sm">{search ? 'Nenhum produto encontrado.' : 'Nenhum produto disponível.'}</p>
          </div>
        ) : (
          filtered.map(p => (
            <button key={p.id} onClick={() => { setQtyProduct(p); setQty('1'); setError(''); }}
              className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-900 border border-slate-800 hover:border-teal-700 active:scale-[.99] transition-all text-left">
              <div className="w-11 h-11 shrink-0 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden">
                {p.image_url && !imgErr[p.id]
                  ? <img src={p.image_url} alt="" className="w-full h-full object-contain" loading="lazy"
                      onError={() => setImgErr(prev => ({ ...prev, [p.id]: true }))} />
                  : <Package className="w-5 h-5 text-slate-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{p.name}</p>
                <p className="text-[11px] text-slate-500">{p.category || 'Sem categoria'}</p>
              </div>
              <span className="shrink-0 w-9 h-9 rounded-xl bg-teal-600/20 border border-teal-700/50 flex items-center justify-center">
                <Plus className="w-4 h-4 text-teal-400" />
              </span>
            </button>
          ))
        )}
      </div>

      {/* Botão item avulso */}
      <div className="fixed bottom-0 left-0 right-0 p-3 bg-slate-950/95 backdrop-blur border-t border-slate-800"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <button onClick={() => { setShowCustom(true); setCustomName(''); setQty('1'); setError(''); }}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-700 text-slate-400 text-sm font-semibold hover:border-teal-700 hover:text-teal-400 transition-colors">
          + Pedir item que não está na lista
        </button>
      </div>

      {/* Modal de quantidade (produto ou avulso) */}
      {(qtyProduct || showCustom) && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full sm:max-w-sm bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-700 overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-slate-800">
              <p className="text-[11px] font-bold text-teal-400 uppercase tracking-wider mb-1">
                {showCustom ? 'Item avulso' : 'Pedir material'}
              </p>
              {showCustom ? (
                <input
                  type="text" value={customName} autoFocus
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="Nome do item (ex: Pilha AA)"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                />
              ) : (
                <h3 className="text-base font-bold text-white leading-tight">{qtyProduct?.name}</h3>
              )}
            </div>
            <div className="p-5 space-y-4" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Quantidade</label>
                <input
                  type="text" inputMode="decimal" value={qty}
                  onChange={e => setQty(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (showCustom ? submit(null, customName.trim()) : submit(qtyProduct!.id, qtyProduct!.name))}
                  autoFocus={!showCustom}
                  className="w-full text-center text-3xl font-bold py-4 rounded-2xl bg-slate-800 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                />
              </div>
              {error && <p className="text-xs text-red-400 text-center font-semibold">{error}</p>}
              <div className="flex gap-3">
                <button onClick={() => { setQtyProduct(null); setShowCustom(false); setError(''); }}
                  className="flex-1 min-h-[50px] rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm">
                  Cancelar
                </button>
                <button
                  onClick={() => showCustom ? submit(null, customName.trim()) : submit(qtyProduct!.id, qtyProduct!.name)}
                  disabled={submitting || (showCustom && customName.trim().length < 2)}
                  className="flex-[2] min-h-[50px] rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Enviar pedido
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
