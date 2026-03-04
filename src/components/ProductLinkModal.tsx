// src/components/ProductLinkModal.tsx
// Modal de Vínculo entre Produtos de Hotéis Diferentes
//
// Fluxo em 3 etapas:
//   1. Buscar  — escolhe hotel de origem e produto para vincular
//   2. Comparar — lado a lado com todos os campos, usuário escolhe qual versão manter
//   3. Confirmar — aplica a sincronização escolhida (manual, nunca automática)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import {
  X, Search, Link2, ArrowRight, ChevronLeft,
  Check, Loader2, AlertCircle, GitMerge, Hotel,
  Package, Barcode, RefreshCw, Info,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Hotel { id: string; name: string; }

interface Product {
  id: string;
  [key: string]: any;   // todos os campos — lido dinamicamente do banco
}

interface Barcode { id: string; barcode: string; product_id: string; }

interface ExistingLink {
  id: string;
  product_a_id: string;
  product_b_id: string;
}

// Campos que NÃO aparecem na comparação (técnicos/gerenciais)
const SKIP_FIELDS = new Set([
  'id', 'hotel_id', 'created_at', 'updated_at',
  'is_starred', 'is_active',
  'last_purchase_date', 'last_purchase_price',
  'last_purchase_quantity', 'average_price',
  'quantity', 'min_quantity', 'max_quantity',
  'parent_product_id',
  'is_portionable', 'is_a_portion', 'is_portion',
]);

// Labels amigáveis para os campos conhecidos
const FIELD_LABELS: Record<string, string> = {
  name:        'Nome',
  category:    'Categoria',
  description: 'Descrição',
  supplier:    'Fornecedor',
  image_url:   'URL da Imagem',
  unit:        'Unidade de Medida',
};

type Step = 'search' | 'compare' | 'confirm';

interface Props {
  /** Produto do hotel atual que será vinculado */
  currentProduct: Product;
  onClose: () => void;
  onLinked: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fieldLabel = (key: string) =>
  FIELD_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const isEmpty = (v: any) => v === null || v === undefined || v === '';

const formatValue = (v: any) => {
  if (isEmpty(v)) return <span className="text-gray-300 dark:text-gray-600 italic text-xs">—</span>;
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
};

// ── Componente Principal ──────────────────────────────────────────────────────

const ProductLinkModal: React.FC<Props> = ({ currentProduct, onClose, onLinked }) => {
  const { selectedHotel } = useHotel();
  const { user }          = useAuth();
  const { addNotification } = useNotification();

  const [step,    setStep]    = useState<Step>('search');
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ── Etapa 1: Busca ────────────────────────────────────────────────────────
  const [hotels,         setHotels]         = useState<Hotel[]>([]);
  const [selectedHotelB, setSelectedHotelB] = useState('');
  const [searchTerm,     setSearchTerm]     = useState(currentProduct.name ?? '');
  const [searchResults,  setSearchResults]  = useState<Product[]>([]);
  const [targetProduct,  setTargetProduct]  = useState<Product | null>(null);
  const [existingLink,   setExistingLink]   = useState<ExistingLink | null>(null);

  // ── Etapa 2: Comparação ───────────────────────────────────────────────────
  const [barcodeA, setBarcodeA] = useState<Barcode[]>([]);
  const [barcodeB, setBarcodeB] = useState<Barcode[]>([]);
  // choices: campo → 'a' | 'b' | 'both' (só para barcodes)
  const [choices,  setChoices]  = useState<Record<string, 'a' | 'b' | 'both'>>({});

  // ── Campos dinâmicos do produto ───────────────────────────────────────────
  const comparableFields = useMemo(() => {
    if (!targetProduct) return [];
    const allKeys = new Set([
      ...Object.keys(currentProduct),
      ...Object.keys(targetProduct),
    ]);
    return [...allKeys].filter(k => !SKIP_FIELDS.has(k)).sort();
  }, [currentProduct, targetProduct]);

  // ── Carregar hotéis disponíveis ────────────────────────────────────────────
  useEffect(() => {
    supabase.from('hotels').select('id, name').order('name')
      .then(({ data }) => {
        setHotels((data || []).filter(h => h.id !== selectedHotel?.id));
      });
  }, [selectedHotel]);

  // ── Checar vínculo existente ao selecionar produto alvo ───────────────────
  const checkExistingLink = useCallback(async (targetId: string) => {
    const { data } = await supabase
      .from('product_links')
      .select('id, product_a_id, product_b_id')
      .or(
        `and(product_a_id.eq.${currentProduct.id},product_b_id.eq.${targetId}),` +
        `and(product_a_id.eq.${targetId},product_b_id.eq.${currentProduct.id})`
      )
      .maybeSingle();
    setExistingLink(data ?? null);
  }, [currentProduct.id]);

  // ── Buscar produtos no hotel B ─────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!selectedHotelB || !searchTerm.trim()) return;
    setLoading(true);
    setError(null);
    setSearchResults([]);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('hotel_id', selectedHotelB)
      .ilike('name', `%${searchTerm.trim()}%`)
      .eq('is_active', true)
      .order('name')
      .limit(30);
    if (error) setError(error.message);
    else setSearchResults(data || []);
    setLoading(false);
  }, [selectedHotelB, searchTerm]);

  // ── Selecionar produto alvo e ir para comparação ──────────────────────────
  const handleSelectTarget = useCallback(async (product: Product) => {
    setLoading(true);
    setTargetProduct(product);
    await checkExistingLink(product.id);

    // Carregar barcodes de ambos
    const [resA, resB] = await Promise.all([
      supabase.from('product_barcodes').select('*').eq('product_id', currentProduct.id),
      supabase.from('product_barcodes').select('*').eq('product_id', product.id),
    ]);
    setBarcodeA(resA.data || []);
    setBarcodeB(resB.data || []);

    // Inicializar escolhas: se valores iguais → 'a'; se B tem e A não → 'b'; senão → 'a'
    const initial: Record<string, 'a' | 'b' | 'both'> = {};
    const allKeys = new Set([
      ...Object.keys(currentProduct),
      ...Object.keys(product),
    ]);
    allKeys.forEach(k => {
      if (SKIP_FIELDS.has(k)) return;
      const vA = currentProduct[k];
      const vB = product[k];
      if (isEmpty(vA) && !isEmpty(vB)) initial[k] = 'b';
      else initial[k] = 'a';
    });
    initial['barcodes'] = 'both';  // barcodes: padrão = manter todos
    setChoices(initial);

    setLoading(false);
    setStep('compare');
  }, [currentProduct, checkExistingLink]);

  // ── Aplicar sincronização ──────────────────────────────────────────────────
  const handleSync = useCallback(async () => {
    if (!targetProduct || !selectedHotel?.id) return;
    setSaving(true);
    setError(null);

    try {
      const hotelBId = selectedHotelB;

      // ── A. Campos escalares: atualizar cada produto conforme a escolha ────
      const updateA: Record<string, any> = {};
      const updateB: Record<string, any> = {};

      comparableFields.forEach(k => {
        if (k === 'barcodes') return;
        const choice = choices[k] ?? 'a';
        const vA = currentProduct[k];
        const vB = targetProduct[k];
        if (choice === 'b' && vB !== vA) updateA[k] = vB;
        if (choice === 'a' && vA !== vB) updateB[k] = vA;
      });

      const ops: Promise<any>[] = [];

      if (Object.keys(updateA).length > 0) {
        ops.push(
          supabase.from('products').update(updateA).eq('id', currentProduct.id)
        );
      }
      if (Object.keys(updateB).length > 0) {
        ops.push(
          supabase.from('products').update(updateB).eq('id', targetProduct.id)
        );
      }

      // ── B. Barcodes: union de todos os únicos ────────────────────────────
      const allBarcodeValues = [
        ...barcodeA.map(b => b.barcode),
        ...barcodeB.map(b => b.barcode),
      ];
      const uniqueBarcodes = [...new Set(allBarcodeValues)];

      const existingA = new Set(barcodeA.map(b => b.barcode));
      const existingB = new Set(barcodeB.map(b => b.barcode));

      const newForA = uniqueBarcodes.filter(bc => !existingA.has(bc));
      const newForB = uniqueBarcodes.filter(bc => !existingB.has(bc));

      if (newForA.length > 0) {
        ops.push(
          supabase.from('product_barcodes').insert(
            newForA.map(bc => ({ product_id: currentProduct.id, barcode: bc }))
          )
        );
      }
      if (newForB.length > 0) {
        ops.push(
          supabase.from('product_barcodes').insert(
            newForB.map(bc => ({ product_id: targetProduct.id, barcode: bc }))
          )
        );
      }

      await Promise.all(ops);

      // ── C. Gravar ou confirmar o vínculo ──────────────────────────────────
      if (!existingLink) {
        const { error: linkErr } = await supabase.from('product_links').insert({
          product_a_id: currentProduct.id,
          product_b_id: targetProduct.id,
          linked_by:    user?.id ?? null,
        });
        if (linkErr) throw linkErr;
      }

      addNotification('Produtos vinculados e sincronizados com sucesso!', 'success');
      onLinked();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao sincronizar produtos.');
    } finally {
      setSaving(false);
    }
  }, [
    targetProduct, currentProduct, selectedHotel, selectedHotelB,
    comparableFields, choices, barcodeA, barcodeB, existingLink, user, addNotification, onLinked, onClose,
  ]);

  // ── Remover vínculo existente ──────────────────────────────────────────────
  const handleUnlink = async () => {
    if (!existingLink) return;
    if (!window.confirm('Remover o vínculo entre esses dois produtos?')) return;
    setSaving(true);
    const { error } = await supabase.from('product_links').delete().eq('id', existingLink.id);
    if (error) { addNotification(error.message, 'error'); }
    else { addNotification('Vínculo removido.', 'success'); onLinked(); onClose(); }
    setSaving(false);
  };

  const hotelBName = hotels.find(h => h.id === selectedHotelB)?.name ?? 'Hotel B';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <GitMerge className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="font-bold text-gray-800 dark:text-white">Vincular Produto</h2>
              <p className="text-xs text-gray-400 truncate max-w-xs">{currentProduct.name}</p>
            </div>
          </div>

          {/* Indicador de etapas */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-medium">
            {(['search', 'compare', 'confirm'] as Step[]).map((s, i) => (
              <React.Fragment key={s}>
                <span className={`px-2 py-1 rounded-lg ${step === s ? 'bg-indigo-600 text-white' : 'text-gray-400'}`}>
                  {i + 1}. {s === 'search' ? 'Buscar' : s === 'compare' ? 'Comparar' : 'Confirmar'}
                </span>
                {i < 2 && <ArrowRight className="w-3 h-3 text-gray-300" />}
              </React.Fragment>
            ))}
          </div>

          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* ── Corpo ────────────────────────────────────────────────────────── */}
        <div className="p-5">

          {/* Erros */}
          {error && (
            <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm border border-red-200 dark:border-red-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              ETAPA 1 — BUSCAR
          ════════════════════════════════════════════════════════════════ */}
          {step === 'search' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Selecione o hotel de destino e busque o produto equivalente para vincular com <strong className="text-gray-700 dark:text-gray-200">{currentProduct.name}</strong>.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Seletor de hotel */}
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">Hotel de destino</label>
                  <div className="relative">
                    <Hotel className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <select
                      value={selectedHotelB}
                      onChange={e => { setSelectedHotelB(e.target.value); setSearchResults([]); setTargetProduct(null); }}
                      className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-400 outline-none"
                    >
                      <option value="">Selecionar hotel...</option>
                      {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Campo de busca */}
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">Nome do produto</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-400 outline-none"
                        placeholder="Buscar..."
                      />
                    </div>
                    <button
                      onClick={handleSearch}
                      disabled={!selectedHotelB || loading}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Resultados */}
              {searchResults.length > 0 && (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  <p className="text-xs text-gray-400">{searchResults.length} resultado(s)</p>
                  {searchResults.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectTarget(p)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-left transition-all group"
                    >
                      {p.image_url
                        ? <img src={p.image_url} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" alt="" onError={e => { (e.target as any).style.display='none'; }} />
                        : <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0"><Package className="w-5 h-5 text-gray-400" /></div>
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{p.name}</p>
                        <p className="text-xs text-gray-400 truncate">{p.category} {p.supplier ? `· ${p.supplier}` : ''}</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {searchResults.length === 0 && searchTerm && !loading && selectedHotelB && (
                <p className="text-sm text-gray-400 text-center py-4">Nenhum produto encontrado.</p>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              ETAPA 2 — COMPARAR
          ════════════════════════════════════════════════════════════════ */}
          {step === 'compare' && targetProduct && (
            <div className="space-y-4">

              {/* Banner de vínculo existente */}
              {existingLink && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
                  <Info className="w-4 h-4 flex-shrink-0" />
                  Estes produtos já estão vinculados. Você pode ressincronizar ou remover o vínculo.
                  <button onClick={handleUnlink} disabled={saving} className="ml-auto text-xs font-semibold text-red-500 hover:underline whitespace-nowrap">
                    Remover vínculo
                  </button>
                </div>
              )}

              {/* Cabeçalhos das colunas */}
              <div className="grid grid-cols-[1fr_32px_1fr] gap-2 items-center">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-center">
                  <p className="text-xs text-blue-500 font-semibold uppercase tracking-wider mb-0.5">Hotel A (este)</p>
                  <p className="text-sm font-bold text-blue-700 dark:text-blue-300 truncate">{selectedHotel?.name}</p>
                </div>
                <div />
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-3 text-center">
                  <p className="text-xs text-purple-500 font-semibold uppercase tracking-wider mb-0.5">Hotel B</p>
                  <p className="text-sm font-bold text-purple-700 dark:text-purple-300 truncate">{hotelBName}</p>
                </div>
              </div>

              {/* Tabela de comparação */}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">

                {comparableFields.map(field => {
                  const vA  = currentProduct[field];
                  const vB  = targetProduct[field];
                  const equal = String(vA ?? '') === String(vB ?? '');
                  const choice = choices[field] ?? 'a';

                  return (
                    <div
                      key={field}
                      className={`rounded-xl border p-3 ${
                        equal
                          ? 'border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20'
                          : 'border-orange-200 dark:border-orange-800/50 bg-orange-50/40 dark:bg-orange-900/10'
                      }`}
                    >
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                        {fieldLabel(field)}
                        {equal && <span className="ml-2 text-green-500 font-normal normal-case">· iguais</span>}
                      </p>

                      {field === 'image_url' && (!isEmpty(vA) || !isEmpty(vB)) ? (
                        // Preview de imagem lado a lado
                        <div className="grid grid-cols-[1fr_32px_1fr] gap-2 items-center">
                          <button
                            onClick={() => !equal && setChoices(c => ({ ...c, [field]: 'a' }))}
                            className={`rounded-lg border-2 overflow-hidden transition-all ${
                              choice === 'a' ? 'border-blue-500 shadow-md' : 'border-gray-200 dark:border-gray-600 opacity-60'
                            }`}
                          >
                            {!isEmpty(vA)
                              ? <img src={vA} className="w-full h-24 object-cover" alt="A" onError={e => { (e.target as any).src=''; }} />
                              : <div className="h-24 bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs text-gray-400">Sem imagem</div>
                            }
                          </button>
                          <div className="flex justify-center">
                            {equal ? <Check className="w-4 h-4 text-green-500" /> : <RefreshCw className="w-4 h-4 text-gray-300" />}
                          </div>
                          <button
                            onClick={() => !equal && setChoices(c => ({ ...c, [field]: 'b' }))}
                            className={`rounded-lg border-2 overflow-hidden transition-all ${
                              choice === 'b' ? 'border-purple-500 shadow-md' : 'border-gray-200 dark:border-gray-600 opacity-60'
                            }`}
                          >
                            {!isEmpty(vB)
                              ? <img src={vB} className="w-full h-24 object-cover" alt="B" onError={e => { (e.target as any).src=''; }} />
                              : <div className="h-24 bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs text-gray-400">Sem imagem</div>
                            }
                          </button>
                        </div>
                      ) : (
                        // Campo texto
                        <div className="grid grid-cols-[1fr_32px_1fr] gap-2 items-center">
                          <button
                            onClick={() => !equal && setChoices(c => ({ ...c, [field]: 'a' }))}
                            disabled={equal}
                            className={`text-left px-3 py-2 rounded-lg text-sm border-2 transition-all ${
                              equal
                                ? 'border-transparent bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-default'
                                : choice === 'a'
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 font-semibold'
                                  : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-300'
                            }`}
                          >
                            {formatValue(vA)}
                          </button>
                          <div className="flex justify-center">
                            {equal
                              ? <Check className="w-4 h-4 text-green-500" />
                              : <RefreshCw className="w-3 h-3 text-gray-300" />
                            }
                          </div>
                          <button
                            onClick={() => !equal && setChoices(c => ({ ...c, [field]: 'b' }))}
                            disabled={equal}
                            className={`text-left px-3 py-2 rounded-lg text-sm border-2 transition-all ${
                              equal
                                ? 'border-transparent bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-default'
                                : choice === 'b'
                                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200 font-semibold'
                                  : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-purple-300'
                            }`}
                          >
                            {formatValue(vB)}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Barcodes — sempre manter todos (union) */}
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/40 dark:bg-indigo-900/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Barcode className="w-4 h-4 text-indigo-500" />
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Códigos de Barras
                    </p>
                    <span className="ml-auto text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
                      Todos serão mantidos (união)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-blue-500 mb-1 font-medium">{selectedHotel?.name}</p>
                      {barcodeA.length > 0
                        ? barcodeA.map(b => (
                            <span key={b.id} className="inline-block bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-2 py-0.5 rounded-full mr-1 mb-1 font-mono">{b.barcode}</span>
                          ))
                        : <span className="text-xs text-gray-400 italic">Nenhum</span>
                      }
                    </div>
                    <div>
                      <p className="text-xs text-purple-500 mb-1 font-medium">{hotelBName}</p>
                      {barcodeB.length > 0
                        ? barcodeB.map(b => (
                            <span key={b.id} className="inline-block bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs px-2 py-0.5 rounded-full mr-1 mb-1 font-mono">{b.barcode}</span>
                          ))
                        : <span className="text-xs text-gray-400 italic">Nenhum</span>
                      }
                    </div>
                  </div>
                  {/* Preview da união */}
                  {(barcodeA.length > 0 || barcodeB.length > 0) && (
                    <div className="mt-2 pt-2 border-t border-indigo-200 dark:border-indigo-800">
                      <p className="text-xs text-gray-400 mb-1">Resultado (ambos receberão):</p>
                      {[...new Set([...barcodeA.map(b=>b.barcode), ...barcodeB.map(b=>b.barcode)])].map(bc => (
                        <span key={bc} className="inline-block bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs px-2 py-0.5 rounded-full mr-1 mb-1 font-mono">{bc}</span>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {/* Resumo de diferenças */}
              {(() => {
                const diffs = comparableFields.filter(f => {
                  const vA = currentProduct[f];
                  const vB = targetProduct[f];
                  return String(vA ?? '') !== String(vB ?? '');
                });
                return diffs.length > 0 ? (
                  <p className="text-xs text-orange-500 font-medium">
                    {diffs.length} campo(s) diferente(s) — clique no valor que deseja manter para cada campo.
                  </p>
                ) : (
                  <p className="text-xs text-green-500 font-medium">
                    ✓ Todos os campos são idênticos — só barcodes serão sincronizados.
                  </p>
                );
              })()}
            </div>
          )}

        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-5 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={() => step === 'compare' ? setStep('search') : onClose()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 'compare' ? 'Voltar' : 'Cancelar'}
          </button>

          {step === 'compare' && targetProduct && (
            <button
              onClick={handleSync}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm active:scale-95"
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Sincronizando...</>
                : <><Link2 className="w-4 h-4" /> Vincular e Sincronizar</>
              }
            </button>
          )}
        </div>

      </div>
    </div>
  );
};

export default ProductLinkModal;