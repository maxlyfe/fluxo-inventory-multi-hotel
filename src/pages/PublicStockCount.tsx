// src/pages/PublicStockCount.tsx
// Página pública de contagem delegada de estoque.
// Rota: /stock-count/:token  (sem autenticação)

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface TokenData {
  id: string;
  hotel_id: string;
  sector_id: string | null;
  token: string;
  expires_at: string;
  stock_count_id: string | null;
  hotel: { name: string } | null;
  sector: { name: string; id: string } | null;
}

interface Product {
  id: string;
  name: string;
  category: string;
  quantity: number;
  image_url?: string | null;
}

type Step = 'validating' | 'invalid' | 'expired' | 'name' | 'counting' | 'done';

// ── Estilos inline ─────────────────────────────────────────────────────────────

const bg: React.CSSProperties = {
  minHeight: '100dvh',
  background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
  fontFamily: "'Inter', sans-serif",
  color: '#f8fafc',
};

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 20,
  padding: '1.5rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '0.85rem 1rem', fontSize: '1rem',
  background: 'rgba(255,255,255,0.10)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 12, color: '#fff', outline: 'none',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.85rem 1rem', borderRadius: 14,
  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
  color: '#fff', fontWeight: 700, fontSize: '0.95rem',
  border: 'none', cursor: 'pointer', transition: 'opacity 0.15s',
};

const btnSecondary: React.CSSProperties = {
  padding: '0.85rem 1rem', borderRadius: 14,
  background: 'rgba(255,255,255,0.10)',
  color: '#fff', fontWeight: 600, fontSize: '0.9rem',
  border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
};

// ── QtyInput ──────────────────────────────────────────────────────────────────

const QtyInput: React.FC<{
  value: number | undefined;
  onChange: (v: string) => void;
  inputRef?: React.RefCallback<HTMLInputElement>;
  onNext?: () => void;
}> = ({ value, onChange, inputRef, onNext }) => {
  const [raw, setRaw] = useState(value !== undefined ? String(value) : '');
  useEffect(() => { setRaw(value !== undefined ? String(value) : ''); }, [value]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Next') { e.preventDefault(); onNext?.(); }
  };

  const btnS: React.CSSProperties = {
    width: 44, height: 44, borderRadius: 12, border: 'none',
    background: 'rgba(255,255,255,0.12)', color: '#fff',
    fontSize: 20, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" style={btnS}
        onClick={() => { const v = Math.max(0, (value ?? 0) - 1); onChange(String(v)); }}>−</button>
      <input
        ref={inputRef}
        type="text" inputMode="decimal" enterKeyHint="next"
        value={raw}
        onChange={e => { setRaw(e.target.value); onChange(e.target.value); }}
        onKeyDown={handleKey}
        placeholder="—"
        style={{
          width: 60, height: 44, textAlign: 'center', fontSize: '1rem', fontWeight: 700,
          borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.10)', color: '#fff', outline: 'none',
          flexShrink: 0,
        }}
      />
      <button type="button" style={btnS}
        onClick={() => { const v = (value ?? 0) + 1; onChange(String(v)); }}>+</button>
    </div>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────

export default function PublicStockCount() {
  const { token } = useParams<{ token: string }>();

  const [step, setStep]                         = useState<Step>('validating');
  const [tokenData, setTokenData]               = useState<TokenData | null>(null);
  const [products, setProducts]                 = useState<Product[]>([]);
  const [counts, setCounts]                     = useState<Record<string, number>>({});
  const [collaboratorName, setCollaboratorName] = useState('');
  const [activeCountId, setActiveCountId]       = useState<string | null>(null);
  const [saving, setSaving]                     = useState(false);
  const [searchTerm, setSearchTerm]             = useState('');
  const [currentCatIdx, setCurrentCatIdx]       = useState(0);

  // Long-press para nome completo
  const [tooltipName, setTooltipName]           = useState<string | null>(null);
  const pressTimerRef                           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef                         = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Confirmação de finalização
  const [showConfirm, setShowConfirm]           = useState(false);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // ── Long-press handlers ───────────────────────────────────────────────────

  const startPress = (name: string) => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      setTooltipName(name);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => setTooltipName(null), 3500);
    }, 600);
  };

  const cancelPress = () => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
  };

  // ── Validar token ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!token) { setStep('invalid'); return; }
    (async () => {
      const { data } = await supabase
        .from('stock_count_tokens')
        .select('*, hotel:hotels(name), sector:sectors(name, id)')
        .eq('token', token)
        .maybeSingle();

      if (!data) { setStep('invalid'); return; }
      if (new Date(data.expires_at) < new Date()) { setStep('expired'); return; }

      setTokenData(data as TokenData);

      // Carregar produtos
      let prods: Product[] = [];
      if (data.sector_id) {
        const { data: ss } = await supabase
          .from('sector_stock')
          .select('quantity, product:products(id, name, category, image_url)')
          .eq('sector_id', data.sector_id)
          .eq('hotel_id', data.hotel_id);
        prods = (ss || []).map((r: any) => ({
          id:        r.product.id,
          name:      r.product.name,
          category:  r.product.category || 'Sem Categoria',
          quantity:  r.quantity ?? 0,
          image_url: r.product.image_url,
        }));
      } else {
        const { data: ps } = await supabase
          .from('products')
          .select('id, name, category, quantity, image_url')
          .eq('hotel_id', data.hotel_id)
          .eq('is_active', true)
          .order('name');
        prods = (ps || []).map((p: any) => ({ ...p, category: p.category || 'Sem Categoria' }));
      }
      setProducts(prods.sort((a, b) => a.name.localeCompare(b.name)));

      // Verificar rascunho existente para este token (por stock_count_id ou fallback por hotel/setor)
      let restoredDraft = false;

      const draftQuery = data.stock_count_id
        ? supabase
            .from('stock_counts')
            .select('id, counted_by_name, status, items:stock_count_items(product_id, counted_quantity)')
            .eq('id', data.stock_count_id)
            .in('status', ['delegated_draft', 'delegated_pending'])
            .maybeSingle()
        : supabase
            .from('stock_counts')
            .select('id, counted_by_name, status, items:stock_count_items(product_id, counted_quantity)')
            .eq('hotel_id', data.hotel_id)
            .eq(data.sector_id ? 'sector_id' : 'status', data.sector_id ?? 'delegated_draft')
            .in('status', ['delegated_draft', 'delegated_pending'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

      const { data: sc } = await draftQuery;

      if (sc && sc.status === 'delegated_pending') {
        setStep('done');
        return;
      }
      if (sc) {
        const draft: Record<string, number> = {};
        (sc.items || []).forEach((it: any) => { draft[it.product_id] = it.counted_quantity; });
        setCounts(draft);
        setActiveCountId(sc.id);
        if (sc.counted_by_name) {
          setCollaboratorName(sc.counted_by_name);
          restoredDraft = true;
        }
      }

      // Se rascunho com nome conhecido → pula direto para contagem
      setStep(restoredDraft ? 'counting' : 'name');
    })();
  }, [token]);

  // ── Categorias ────────────────────────────────────────────────────────────

  const categories = [...new Set(products.map(p => p.category))].sort();
  const currentCategory = categories[currentCatIdx] ?? '';

  const filteredProducts = searchTerm.trim()
    ? products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : products.filter(p => p.category === currentCategory);

  const totalProducts   = products.length;
  const countedProducts = Object.keys(counts).length;
  const progressPct     = totalProducts > 0 ? Math.round((countedProducts / totalProducts) * 100) : 0;

  // ── Navegação Enter ───────────────────────────────────────────────────────

  const getNextFocus = useCallback((productId: string) => {
    return () => {
      const list = filteredProducts;
      const idx = list.findIndex(p => p.id === productId);
      if (idx >= 0 && idx < list.length - 1) {
        const nextId = list[idx + 1].id;
        const el = inputRefs.current.get(nextId);
        if (el) { el.focus(); el.select(); }
      }
    };
  }, [filteredProducts]);

  // ── Salvar ────────────────────────────────────────────────────────────────

  const handleSave = async (isFinal: boolean) => {
    if (Object.keys(counts).length === 0) return;
    setSaving(true);
    setShowConfirm(false);
    try {
      const now = new Date().toISOString();
      let countId = activeCountId;
      if (!countId) {
        const { data: sc, error: sce } = await supabase
          .from('stock_counts')
          .insert({
            hotel_id:        tokenData!.hotel_id,
            sector_id:       tokenData!.sector_id,
            status:          isFinal ? 'delegated_pending' : 'delegated_draft',
            started_at:      now,
            finished_at:     isFinal ? now : null,
            counted_by_name: collaboratorName,
            notes:           tokenData!.sector_id ? 'Contagem delegada — Setor' : 'Contagem delegada — Inventário',
          })
          .select('id')
          .single();
        if (sce) throw sce;
        countId = sc!.id;
        setActiveCountId(countId);
      } else {
        await supabase.from('stock_counts').update({
          status:          isFinal ? 'delegated_pending' : 'delegated_draft',
          finished_at:     isFinal ? now : null,
          counted_by_name: collaboratorName,
        }).eq('id', countId);
      }

      const items = Object.entries(counts).map(([productId, countedQty]) => ({
        stock_count_id:    countId,
        product_id:        productId,
        previous_quantity: products.find(p => p.id === productId)?.quantity ?? 0,
        counted_quantity:  countedQty,
      }));
      await supabase.from('stock_count_items').delete().eq('stock_count_id', countId!);
      await supabase.from('stock_count_items').insert(items);

      // Sempre vincula o token ao count (rascunho ou final) — garante restore ao recarregar
      await supabase.from('stock_count_tokens')
        .update({ stock_count_id: countId })
        .eq('token', token!);

      if (isFinal) {
        setStep('done');
      }
    } catch (err: any) {
      alert('Erro ao salvar: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setSaving(false);
    }
  };

  const handleCountChange = (productId: string, value: string) => {
    const n = parseFloat(value);
    if (!isNaN(n)) setCounts(prev => ({ ...prev, [productId]: n }));
    else if (value === '') setCounts(prev => { const next = { ...prev }; delete next[productId]; return next; });
  };

  // ── Telas de estado ───────────────────────────────────────────────────────

  if (step === 'validating') return (
    <div style={{ ...bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: '#64748b' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontWeight: 600 }}>Verificando link…</p>
      </div>
    </div>
  );

  if (step === 'invalid') return (
    <div style={{ ...bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
      <div style={{ fontSize: 48 }}>❌</div>
      <h2 style={{ fontWeight: 800, fontSize: 20, margin: 0 }}>Link inválido</h2>
      <p style={{ color: '#64748b', margin: 0, textAlign: 'center' }}>Este link não existe ou foi revogado. Solicite um novo link ao responsável.</p>
    </div>
  );

  if (step === 'expired') return (
    <div style={{ ...bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
      <div style={{ fontSize: 48 }}>⏰</div>
      <h2 style={{ fontWeight: 800, fontSize: 20, margin: 0 }}>Link expirado</h2>
      <p style={{ color: '#64748b', margin: 0, textAlign: 'center' }}>Este link expirou (válido por 24h). Solicite um novo link ao responsável.</p>
    </div>
  );

  if (step === 'done') return (
    <div style={{ ...bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(16,185,129,0.15)', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>✅</div>
      <h2 style={{ fontWeight: 800, fontSize: 22, margin: 0, textAlign: 'center' }}>Contagem finalizada!</h2>
      <p style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 320, lineHeight: 1.6 }}>
        Obrigado{collaboratorName ? `, ${collaboratorName}` : ''}! A contagem foi enviada ao responsável para validação.
      </p>
      <div style={{ ...card, maxWidth: 340, width: '100%', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
          O supervisor irá verificar e finalizar a contagem em breve.
        </p>
      </div>
    </div>
  );

  if (step === 'name') return (
    <div style={bg}>
      {/* Header */}
      <div style={{ padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(148,163,184,0.08)', background: 'rgba(15,23,42,0.7)', position: 'sticky', top: 0, zIndex: 10 }}>
        <span style={{ fontWeight: 800, fontSize: 16, color: '#f1f5f9' }}>📦 Conferência de Estoque</span>
        {tokenData && (
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
            {tokenData.hotel?.name}{tokenData.sector && ` · ${tokenData.sector.name}`}
          </span>
        )}
      </div>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.25rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <h1 style={{ fontWeight: 800, fontSize: 22, margin: '0 0 8px' }}>Conferência de Estoque</h1>
          <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
            {tokenData?.sector ? `Setor: ${tokenData.sector.name}` : 'Inventário Principal'}
            <br />
            <span style={{ fontSize: 13 }}>{products.length} produto{products.length !== 1 ? 's' : ''} para contar</span>
          </p>
        </div>

        <div style={{ ...card, marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Seu nome *
          </label>
          <input
            type="text"
            value={collaboratorName}
            onChange={e => setCollaboratorName(e.target.value)}
            placeholder="Digite seu nome completo"
            style={inputStyle}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && collaboratorName.trim()) setStep('counting'); }}
          />
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>
            Será registrado quem realizou esta contagem.
          </p>
        </div>

        <button
          style={{ ...btnPrimary, width: '100%', opacity: collaboratorName.trim() ? 1 : 0.4 }}
          disabled={!collaboratorName.trim()}
          onClick={() => setStep('counting')}
        >
          Iniciar Contagem →
        </button>

        {activeCountId && (
          <p style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: '#10b981' }}>
            ✓ Rascunho anterior encontrado — seus dados foram restaurados
          </p>
        )}
      </div>
    </div>
  );

  // ── step === 'counting' ───────────────────────────────────────────────────
  return (
    <div style={{ ...bg, display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>

      {/* Tooltip de nome completo (long-press) */}
      {tooltipName && (
        <div
          onClick={() => setTooltipName(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
            padding: '0 1rem 2rem',
          }}
        >
          <div style={{
            background: 'rgba(30,41,59,0.98)',
            border: '1px solid rgba(99,102,241,0.4)',
            borderRadius: 18, padding: '1.25rem 1.5rem',
            maxWidth: 380, width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            textAlign: 'center',
          }}>
            <p style={{ margin: '0 0 4px', fontSize: 11, color: '#6366f1', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Produto</p>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.4 }}>{tooltipName}</p>
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#475569' }}>Toque para fechar</p>
          </div>
        </div>
      )}

      {/* Modal de confirmação de finalização */}
      {showConfirm && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
            padding: '0 1rem 1.5rem',
          }}
        >
          <div style={{
            background: 'rgba(15,23,42,0.98)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 24, padding: '1.75rem 1.5rem',
            maxWidth: 380, width: '100%',
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: 42, marginBottom: 10 }}>📋</div>
              <h3 style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 18, color: '#f1f5f9' }}>Finalizar contagem?</h3>
              <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
                Você contou <strong style={{ color: '#f1f5f9' }}>{countedProducts}</strong> de <strong style={{ color: '#f1f5f9' }}>{totalProducts}</strong> produtos.
                Após finalizar não será possível editar.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                style={{ ...btnSecondary, flex: 1 }}
                onClick={() => setShowConfirm(false)}
              >
                Cancelar
              </button>
              <button
                style={{ ...btnPrimary, flex: 1, opacity: saving ? 0.5 : 1 }}
                disabled={saving}
                onClick={() => handleSave(true)}
              >
                {saving ? '⏳ Enviando…' : '✅ Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header com progresso */}
      <div style={{ background: 'rgba(99,102,241,0.9)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 20 }}>
        {activeCountId && countedProducts > 0 && (
          <div style={{ padding: '4px 1rem', background: 'rgba(16,185,129,0.25)', borderBottom: '1px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11 }}>✓</span>
            <p style={{ margin: 0, fontSize: 11, color: '#6ee7b7', fontWeight: 600 }}>
              Rascunho restaurado — {countedProducts} item{countedProducts !== 1 ? 's' : ''} já contado{countedProducts !== 1 ? 's' : ''}
            </p>
          </div>
        )}
        <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: '#fff' }}>
              {tokenData?.sector ? tokenData.sector.name : 'Inventário'}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{collaboratorName}</p>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,0.2)', padding: '3px 10px', borderRadius: 99 }}>
            {countedProducts}/{totalProducts}{progressPct === 100 && ' ✓'}
          </span>
        </div>
        <div style={{ height: 3, background: 'rgba(255,255,255,0.2)' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: progressPct === 100 ? '#4ade80' : 'rgba(255,255,255,0.9)', transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* Busca */}
      <div style={{ padding: '0.75rem 1rem', background: 'rgba(15,23,42,0.8)', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Buscar produto…"
          style={{ ...inputStyle, padding: '0.65rem 1rem' }}
        />
      </div>

      {/* Pills de categoria */}
      {!searchTerm && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0.75rem 1rem', background: 'rgba(15,23,42,0.6)', borderBottom: '1px solid rgba(148,163,184,0.06)', scrollbarWidth: 'none' }}>
          {categories.map((cat, i) => (
            <button
              key={cat}
              onClick={() => setCurrentCatIdx(i)}
              style={{
                flexShrink: 0, padding: '0.4rem 0.85rem', borderRadius: 99, fontSize: 12, fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: i === currentCatIdx ? '#6366f1' : 'rgba(255,255,255,0.08)',
                color: i === currentCatIdx ? '#fff' : '#94a3b8',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Lista de produtos */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem', paddingBottom: '6rem' }}>
        {filteredProducts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 0', color: '#475569' }}>
            <p style={{ fontSize: 36 }}>📦</p>
            <p style={{ fontWeight: 600, margin: 0 }}>Nenhum produto nesta categoria.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredProducts.map(product => {
              const counted  = counts[product.id];
              const isCounted = counted !== undefined;
              return (
                <div key={product.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '0.85rem 1rem', borderRadius: 16,
                  background: isCounted ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${isCounted ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  transition: 'all 0.15s',
                }}>
                  {/* Imagem */}
                  <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.08)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {product.image_url
                      ? <img src={product.image_url} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <span style={{ fontSize: 20 }}>📦</span>
                    }
                  </div>

                  {/* Nome — long-press para ver completo */}
                  <div
                    style={{ flex: 1, minWidth: 0, userSelect: 'none', WebkitUserSelect: 'none', cursor: 'default' }}
                    onTouchStart={() => startPress(product.name)}
                    onTouchEnd={cancelPress}
                    onTouchMove={cancelPress}
                    onMouseDown={() => startPress(product.name)}
                    onMouseUp={cancelPress}
                    onMouseLeave={cancelPress}
                  >
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {product.name}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
                      Atual: {product.quantity} · <span style={{ color: '#475569', fontSize: 10 }}>segure para ver</span>
                    </p>
                  </div>

                  {/* Input */}
                  <QtyInput
                    value={counted}
                    onChange={v => handleCountChange(product.id, v)}
                    inputRef={el => {
                      if (el) inputRefs.current.set(product.id, el);
                      else inputRefs.current.delete(product.id);
                    }}
                    onNext={getNextFocus(product.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Botões fixos no rodapé */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '0.85rem 1rem',
        background: 'rgba(15,23,42,0.97)',
        borderTop: '1px solid rgba(148,163,184,0.1)',
        backdropFilter: 'blur(16px)',
        display: 'flex', gap: 10, zIndex: 30,
      }}>
        <button
          style={{ ...btnSecondary, flex: 1, opacity: saving || Object.keys(counts).length === 0 ? 0.4 : 1, fontSize: '0.82rem' }}
          disabled={saving || Object.keys(counts).length === 0}
          onClick={() => handleSave(false)}
        >
          {saving ? '⏳' : '💾'} Salvar Rascunho
        </button>
        <button
          style={{ ...btnPrimary, flex: 1, opacity: saving || Object.keys(counts).length === 0 ? 0.4 : 1, fontSize: '0.82rem' }}
          disabled={saving || Object.keys(counts).length === 0}
          onClick={() => setShowConfirm(true)}
        >
          ✅ Finalizar
        </button>
      </div>
    </div>
  );
}
