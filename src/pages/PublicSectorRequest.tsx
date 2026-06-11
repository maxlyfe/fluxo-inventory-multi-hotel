// src/pages/PublicSectorRequest.tsx
// Página pública de requisição por setor via link temporário (sem login).
// Layout "Mercado Livre Style" com persistência e Real-time total.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Package, Search, Loader2, ShieldAlert, ArrowRight, Plus,
  CheckCircle2, X, ShoppingCart, Clock, ImageIcon,
  Check, History, Trash2, LayoutGrid, AlertCircle
} from 'lucide-react';
import { searchMatch } from '../utils/search';

interface LinkInfo { hotel_id: string; hotel_name: string; sector_id: string; sector_name: string; expires_at: string; }
interface Product { id: string; name: string; category: string | null; image_url: string | null; }

interface Requisition {
  id: string;
  item_name: string;
  quantity: number;
  status: 'pending' | 'delivered' | 'rejected';
  created_at: string;
  product_id?: string;
  image_url?: string;
}

type Step = 'validating' | 'invalid' | 'name' | 'shop';

export default function PublicSectorRequest() {
  const { token = '' } = useParams<{ token: string }>();

  const [step, setStep]         = useState<Step>('validating');
  const [info, setInfo]         = useState<LinkInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName]         = useState('');
  const [requesterId, setReqId] = useState('');
  
  const [search, setSearch]     = useState('');
  const [category, setCategory] = useState<string>('');
  const [loading, setLoading]   = useState(true);

  // Requisições Persistentes (Banco de Dados)
  const [requisitions, setReqs] = useState<Requisition[]>([]);
  const [showCart, setShowCart] = useState(false);

  // Modal de quantidade
  const [qtyProduct, setQtyProduct] = useState<Product | null>(null);
  const [modalMode, setModalMode]   = useState<'add' | 'custom'>('add');
  const [modalQty, setModalQty]     = useState('1');
  const [modalError, setModalError] = useState('');
  const [customName, setCustomName] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [imgErr, setImgErr]         = useState<Record<string, boolean>>({});

  // ── Inicialização: Validar Token e Recuperar Identidade ──────────────────
  useEffect(() => {
    if (!token) { setStep('invalid'); return; }
    
    // Gerar ou recuperar ID único do navegador
    let rid = localStorage.getItem('req_link_requester_id');
    if (!rid) { rid = crypto.randomUUID(); localStorage.setItem('req_link_requester_id', rid); }
    setReqId(rid);

    (async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_request_link_info', { p_token: token });
        const row = Array.isArray(data) ? data[0] : data;
        if (err || !row) { setStep('invalid'); return; }
        setInfo(row as LinkInfo);

        const { data: prods } = await supabase.rpc('get_products_for_request_link', { p_token: token });
        setProducts((prods as Product[]) || []);

        const savedName = localStorage.getItem(`req_link_name:${token}`);
        if (savedName) { 
          setName(savedName); 
          setStep('shop');
          loadMyRequests(token, rid);
        } else {
          setStep('name');
        }
      } catch { setStep('invalid'); } finally { setLoading(false); }
    })();
  }, [token]);

  // ── Carregar Pedidos do Banco ───────────────────────────────────────────
  const loadMyRequests = async (tkn: string, rid: string) => {
    try {
      const { data, error } = await supabase.rpc('get_my_pending_requests', { 
        p_token: tkn, 
        p_requester_id: rid 
      });
      if (!error && data) setReqs(data as Requisition[]);
    } catch (e) { console.error('Erro ao carregar pedidos:', e); }
  };

  // ── Real-time: Ouvir mudanças no setor ───────────────────────────────────
  useEffect(() => {
    if (step !== 'shop' || !info?.sector_id || !requesterId) return;

    const channel = supabase
      .channel(`public_reqs_${token}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'requisitions',
        filter: `notes=like.PUB:${requesterId}:%`
      }, (payload) => {
        // Quando algo muda (entrega, rejeição, novo pedido em outro aba), recarrega
        loadMyRequests(token, requesterId);
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [step, info?.sector_id, requesterId, token]);

  const categories = useMemo(
    () => [...new Set(products.map(p => p.category || 'Sem Categoria'))].sort(),
    [products],
  );

  const filtered = useMemo(() => {
    let list = products;
    if (search.trim()) {
      list = list.filter(p => searchMatch(search, p.name) || searchMatch(search, p.category || ''));
    } else if (category) {
      list = list.filter(p => (p.category || 'Sem Categoria') === category);
    }
    return list;
  }, [products, search, category]);

  const startName = () => {
    if (name.trim().length < 2) return;
    localStorage.setItem(`req_link_name:${token}`, name.trim());
    setStep('shop');
    loadMyRequests(token, requesterId);
  };

  // ── Enviar Pedido (Direto para o Banco) ──────────────────────────────────
  const submitToDatabase = async () => {
    const q = parseFloat(modalQty.replace(',', '.'));
    if (isNaN(q) || q <= 0) { setModalError('Quantidade inválida.'); return; }

    const itemName = modalMode === 'add' ? qtyProduct!.name : customName.trim();
    if (modalMode === 'custom' && itemName.length < 2) {
      setModalError('Informe o nome do item.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: err } = await supabase.rpc('submit_request_via_link', {
        p_token: token,
        p_requester_name: name.trim(),
        p_requester_id: requesterId,
        p_product_id: modalMode === 'add' ? qtyProduct!.id : null,
        p_item_name: itemName,
        p_quantity: q,
      });
      if (err) throw err;

      // Reset Modal
      setQtyProduct(null);
      setModalMode('add');
      setModalQty('1');
      setCustomName('');
      
      // Carregar imediatamente (Real-time também pegará, mas aqui é mais rápido)
      loadMyRequests(token, requesterId);
      
      // Opcional: abrir o carrinho para mostrar que "entrou"
      setShowCart(true);
    } catch (e: any) {
      setModalError(e.message || 'Erro ao enviar pedido.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Telas de estado ───────────────────────────────────────────────────────
  if (step === 'validating') return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      <p className="text-gray-500 dark:text-gray-400 font-medium">Conectando ao Almoxarifado...</p>
    </div>
  );

  if (step === 'invalid') return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-6 text-red-500">
        <ShieldAlert className="w-10 h-10" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Link expirado</h1>
      <p className="text-gray-600 dark:text-gray-400 max-w-xs">Este link de requisição não é mais válido. Por favor, solicite um novo link ao responsável.</p>
    </div>
  );

  if (step === 'name') return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-[2.5rem] shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-700">
        <div className="p-10 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6 backdrop-blur-sm">
            <ShoppingCart className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black tracking-tight mb-1">Requisição de Material</h1>
          <p className="text-blue-100 font-medium opacity-80">{info?.hotel_name} · {info?.sector_name}</p>
        </div>
        <div className="p-8 space-y-6">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Seu Nome *</label>
            <input
              type="text" value={name} autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && startName()}
              placeholder="Ex: João Silva"
              className="w-full px-5 py-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white text-lg font-bold focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
            />
          </div>
          <button onClick={startName} disabled={name.trim().length < 2}
            className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-lg shadow-lg shadow-blue-500/30 disabled:opacity-40 transition-all">
            Entrar no Setor
          </button>
        </div>
      </div>
    </div>
  );

  // ── step === 'shop' ───────────────────────────────────────────────────────
  const pendingReqs = requisitions.filter(r => r.status === 'pending');
  const historyReqs = requisitions.filter(r => r.status !== 'pending');

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="container mx-auto flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-black text-gray-900 dark:text-white truncate text-lg tracking-tight">{info?.sector_name}</h1>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">{info?.hotel_name} · {name}</p>
          </div>
          <button
            onClick={() => setShowCart(!showCart)}
            className={`relative p-3 rounded-2xl transition-all shadow-lg ${showCart ? 'bg-gray-900 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'} active:scale-90`}
          >
            {showCart ? <LayoutGrid className="w-6 h-6" /> : <ShoppingCart className="w-6 h-6" />}
            {pendingReqs.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black rounded-full w-6 h-6 flex items-center justify-center ring-4 ring-white dark:ring-gray-800 animate-pulse">
                {pendingReqs.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Busca */}
      {!showCart && (
        <div className="sticky top-[73px] z-20 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm px-4 py-4 border-b border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="container mx-auto space-y-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar produto..."
                className="w-full pl-12 pr-4 py-3.5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-bold shadow-inner focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              <button onClick={() => setCategory('')} className={`shrink-0 px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${!category ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>Todos</button>
              {categories.map(c => (
                <button key={c} onClick={() => setCategory(c)} className={`shrink-0 px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${category === c ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>{c}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="container mx-auto px-4 py-8">
        {showCart ? (
          /* ── VIEW PEDIDOS EM TEMPO REAL ───────────────────────────────── */
          <div className="max-w-2xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-500">
            <section>
              <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-6 flex items-center gap-3 tracking-tight">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl"><ShoppingCart className="w-6 h-6 text-blue-600" /></div>
                Pedidos Ativos
              </h2>
              {pendingReqs.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-3xl p-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-700">
                  <Package className="w-16 h-16 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                  <p className="text-gray-500 font-bold text-lg">Nenhum pedido pendente.</p>
                  <button onClick={() => setShowCart(false)} className="mt-4 text-blue-600 font-black uppercase text-sm">Adicionar Itens</button>
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingReqs.map(req => (
                    <div key={req.id} className="bg-white dark:bg-gray-800 rounded-3xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between gap-4 animate-in zoom-in-95">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-14 h-14 bg-gray-50 dark:bg-gray-900 rounded-2xl flex items-center justify-center overflow-hidden border border-gray-100 dark:border-gray-800 shrink-0">
                          {req.image_url ? <img src={req.image_url} alt="" className="w-full h-full object-contain p-1" /> : <Package className="w-6 h-6 text-gray-300" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 dark:text-white text-lg tracking-tight truncate">{req.item_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-sm font-black text-blue-600">Qtd: {req.quantity}</span>
                            <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                            <span className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-1">
                              <Clock size={10} /> Aguardando Almoxarifado
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="p-6 bg-blue-50 dark:bg-blue-900/10 rounded-[2rem] border border-blue-100 dark:border-blue-800/50">
                     <p className="text-xs text-blue-700 dark:text-blue-300 font-bold text-center leading-relaxed">
                       Os pedidos acima já aparecem no painel do Almoxarifado em tempo real. Você será avisado aqui quando forem entregues.
                     </p>
                  </div>
                </div>
              )}
            </section>

            {historyReqs.length > 0 && (
              <section className="pt-8 border-t border-gray-200 dark:border-gray-800">
                <h2 className="text-xl font-black text-gray-900 dark:text-white mb-6 flex items-center gap-3 tracking-tight opacity-70">
                  <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-xl"><History className="w-5 h-5 text-gray-500" /></div>
                  Pedidos Finalizados
                </h2>
                <div className="space-y-3 opacity-60">
                  {historyReqs.map(s => (
                    <div key={s.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4 flex justify-between items-center text-sm border border-gray-100 dark:border-gray-700 shadow-sm">
                      <div className="min-w-0">
                        <p className="text-gray-900 dark:text-white font-bold truncate">{s.quantity}× {s.item_name}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">{new Date(s.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div className={`flex items-center gap-1.5 font-black text-[10px] uppercase px-3 py-1.5 rounded-full ${s.status === 'delivered' ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20' : 'text-red-600 bg-red-50 dark:bg-red-900/20'}`}>
                        {s.status === 'delivered' ? <CheckCircle2 size={12} /> : <X size={12} />}
                        {s.status === 'delivered' ? 'Entregue' : 'Rejeitado'}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          /* ── GRADE DE PRODUTOS ── */
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
            {filtered.length === 0 ? (
              <div className="col-span-full py-32 text-center text-gray-400">
                <Package className="w-20 h-20 mx-auto mb-4 opacity-10" />
                <p className="text-lg font-bold">Nenhum produto disponível.</p>
              </div>
            ) : (
              filtered.map(p => (
                <div key={p.id} className="bg-white dark:bg-gray-800 rounded-[2rem] shadow-sm hover:shadow-xl hover:-translate-y-1 border border-gray-100 dark:border-gray-700 p-4 flex flex-col transition-all group relative">
                  <div className="absolute top-4 left-4 z-10 px-2.5 py-1 rounded-full bg-white/90 dark:bg-gray-900/90 backdrop-blur shadow-sm border border-gray-100 dark:border-gray-700">
                    <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest">{p.category || 'Geral'}</p>
                  </div>
                  <div className="aspect-square rounded-2xl bg-gray-50 dark:bg-gray-900 flex items-center justify-center mb-4 overflow-hidden border border-gray-100 dark:border-gray-800">
                    {p.image_url && !imgErr[p.id] ? (
                      <img src={p.image_url} alt={p.name} className="w-full h-full object-contain p-2 group-hover:scale-110 transition-transform duration-500" onError={() => setImgErr(prev => ({ ...prev, [p.id]: true }))} />
                    ) : (
                      <Package className="w-12 h-12 text-gray-200 dark:text-gray-700" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 mb-4 px-1">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white leading-tight line-clamp-2 min-h-[40px] tracking-tight">{p.name}</h3>
                  </div>
                  <button onClick={() => { setQtyProduct(p); setModalMode('add'); setModalQty('1'); setModalError(''); }}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20">
                    <Plus className="w-4 h-4" strokeWidth={3} /> Pedir
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* FAB Mobile - Item Personalizado */}
      {!showCart && (
        <button onClick={() => { setModalMode('custom'); setCustomName(''); setModalQty('1'); setModalError(''); }}
          className="fixed bottom-8 right-8 w-16 h-16 bg-gradient-to-tr from-purple-600 to-indigo-600 text-white rounded-[1.75rem] shadow-2xl shadow-indigo-500/40 flex items-center justify-center z-40 active:scale-90 hover:rotate-6 transition-all border-4 border-white dark:border-gray-900">
          <Plus className="w-8 h-8" strokeWidth={2.5} />
        </button>
      )}

      {/* Modal de Quantidade e Envio Direto */}
      {(qtyProduct || modalMode === 'custom') && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/80 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-20 duration-500 border border-gray-100 dark:border-gray-700">
            <div className="px-8 pt-8 pb-6 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mb-2">Confirmar Pedido</p>
                <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight leading-tight">
                  {modalMode === 'add' ? qtyProduct?.name : 'Item Especial'}
                </h3>
              </div>
              <button onClick={() => { setQtyProduct(null); setModalMode('add'); }} className="p-2.5 bg-gray-100 dark:bg-gray-700 rounded-2xl text-gray-500 hover:text-gray-900 dark:hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-8 space-y-6" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom) + 1rem)' }}>
              {modalMode === 'custom' && (
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 ml-1">O que você precisa? *</label>
                  <input type="text" value={customName} autoFocus onChange={e => setCustomName(e.target.value)} placeholder="Ex: Rolo de Fita Adesiva"
                    className="w-full px-5 py-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/10 outline-none transition-all" />
                </div>
              )}
              
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 ml-1 text-center">Quantidade</label>
                <div className="relative">
                   <input type="text" inputMode="decimal" value={modalQty} onChange={e => setModalQty(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitToDatabase()} autoFocus={modalMode === 'add'}
                    className="w-full text-center text-5xl font-black py-8 rounded-[2rem] bg-gray-50 dark:bg-gray-900 border-2 border-transparent focus:border-blue-500 text-gray-900 dark:text-white outline-none shadow-inner transition-all" />
                  <div className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-700 font-black text-lg pointer-events-none">un</div>
                </div>
              </div>

              {modalError && <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-red-600 text-xs font-bold border border-red-100 dark:border-red-800"><AlertCircle size={14} />{modalError}</div>}

              <div className="flex gap-4 pt-2">
                <button onClick={() => { setQtyProduct(null); setModalMode('add'); }} className="flex-1 py-5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-black rounded-2xl uppercase tracking-widest text-xs">Cancelar</button>
                <button onClick={submitToDatabase} disabled={submitting} className="flex-[2] py-5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black rounded-2xl shadow-xl shadow-blue-500/30 uppercase tracking-[0.1em] text-xs transition-all flex items-center justify-center gap-2">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Enviar Agora
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
