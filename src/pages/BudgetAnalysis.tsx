import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import {
  Loader2, AlertTriangle, ArrowLeft, BarChart2,
  ShoppingCart, RotateCcw, X, RefreshCw
} from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface BudgetItem {
  id: string;
  requested_quantity: number;
  requested_unit: string;
  product: {
    id: string;
    name: string;
    image_url?: string;
  };
}

interface SupplierQuoteItem {
  price: number;
  budget_item_id: string;
  substitute_name?: string | null;
  substitute_unit_size?: number | null;
  substitute_unit_type?: string | null;
}

interface SupplierQuote {
  id: string;
  supplier_name: string;
  submitted_at: string;
  quote_items: SupplierQuoteItem[];
}

interface BudgetAnalysisData {
  id: string;
  name: string;
  budget_items: BudgetItem[];
  supplier_quotes: SupplierQuote[];
}

/** Info de preço de um fornecedor para um produto — pode ser direto ou substituto */
interface PriceEntry {
  price: number;
  isSubstitute: boolean;
  substituteName?: string;
  substituteUnitSize?: number | null;
  substituteUnitType?: string | null;
}

interface ComparisonItem {
  productId: string;
  productName: string;
  imageUrl?: string;
  requestedQuantity: number;
  requestedUnit: string;
  /** supplier_name → PriceEntry | null */
  priceEntries: Record<string, PriceEntry | null>;
  /** Menor preço — apenas entre preços DIRETOS (não substitutos) */
  bestDirectPrice: number | null;
  /** Menor preço geral (incluindo substitutos) */
  bestAnyPrice: number | null;
}

// ---------------------------------------------------------------------------
// Persistência localStorage
// ---------------------------------------------------------------------------

const storageKey        = (id: string) => `budget-selections-${id}`;
const substituteKey     = (id: string) => `budget-substitutes-${id}`;

const loadJSON = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
};

const saveJSON = (key: string, value: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
};

const clearKey = (key: string): void => {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
};

// ---------------------------------------------------------------------------
// Modal de detalhe de substituto
// ---------------------------------------------------------------------------

interface SubstituteModalState {
  open: boolean;
  productId: string;
  productName: string;
  supplierName: string;
  entry: PriceEntry | null;
}

const SubstituteDetailModal: React.FC<{
  state: SubstituteModalState;
  onAccept: () => void;
  onClose: () => void;
}> = ({ state, onAccept, onClose }) => {
  if (!state.open || !state.entry) return null;

  const { entry, productName, supplierName } = state;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* Barra arraste mobile */}
        <div className="flex justify-center pt-2 sm:hidden">
          <div className="w-10 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/10">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <h2 className="font-bold text-amber-900 dark:text-amber-200 text-base">
              Produto Substituto
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-amber-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Corpo */}
        <div className="px-5 py-5 space-y-4">
          {/* Pedido original */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Você pediu
            </p>
            <p className="text-gray-900 dark:text-gray-100 font-medium">{productName}</p>
          </div>

          {/* O que o fornecedor oferece */}
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
              {supplierName} oferece
            </p>
            <p className="text-gray-900 dark:text-white font-bold text-lg leading-tight">
              {entry.substituteName}
            </p>
            {(entry.substituteUnitSize || entry.substituteUnitType) && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Apresentação:{' '}
                <span className="font-medium">
                  {entry.substituteUnitSize}{entry.substituteUnitType}
                </span>
              </p>
            )}
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1">
              R$ {entry.price.toFixed(2).replace('.', ',')}
            </p>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Ao aceitar, este substituto será usado na lista de compras com o nome informado
            pelo fornecedor. O produto original permanece no seu inventário sem alteração.
          </p>
        </div>

        {/* Ações */}
        <div className="px-5 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={onAccept}
            className="flex-[1.5] flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-colors text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Usar substituto
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

const BudgetAnalysis = () => {
  const { budgetId } = useParams<{ budgetId: string }>();
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [budgetData, setBudgetData] = useState<BudgetAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** productId → supplierName selecionado */
  const [selectedSuppliers, setSelectedSuppliers] = useState<Record<string, string | null>>({});

  /**
   * productId → supplierName cujo substituto foi aceito
   * Persiste no localStorage com chave separada
   */
  const [acceptedSubstitutes, setAcceptedSubstitutes] = useState<Record<string, string>>({});

  /** Estado do modal de detalhe de substituto */
  const [substituteModal, setSubstituteModal] = useState<SubstituteModalState>({
    open: false, productId: '', productName: '', supplierName: '', entry: null,
  });

  // -------------------------------------------------------------------------
  // Fetch
  // -------------------------------------------------------------------------

  useEffect(() => {
    const fetchAnalysisData = async () => {
      if (!budgetId) {
        setError('ID do orçamento não fornecido.');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const { data, error: fetchError } = await supabase
          .from('dynamic_budgets')
          .select(`
            id,
            name,
            budget_items:dynamic_budget_items(
              id,
              requested_quantity,
              requested_unit,
              product:products(id, name, image_url)
            ),
            supplier_quotes(
              id,
              supplier_name,
              submitted_at,
              quote_items:supplier_quote_items(
                price,
                budget_item_id,
                substitute_name,
                substitute_unit_size,
                substitute_unit_type
              )
            )
          `)
          .eq('id', budgetId)
          .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error('Orçamento não encontrado.');
        setBudgetData(data as unknown as BudgetAnalysisData);
      } catch (err: any) {
        setError('Erro ao carregar dados para análise: ' + err.message);
        addNotification('Erro ao carregar dados para análise.', 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchAnalysisData();
  }, [budgetId, addNotification]);

  // -------------------------------------------------------------------------
  // Dados derivados: tabela comparativa
  // -------------------------------------------------------------------------

  const comparisonData = useMemo<ComparisonItem[]>(() => {
    if (!budgetData) return [];

    return budgetData.budget_items.map(item => {
      const priceEntries: Record<string, PriceEntry | null> = {};
      let bestDirectPrice: number | null = null;
      let bestAnyPrice: number | null = null;

      budgetData.supplier_quotes.forEach(quote => {
        const qi = quote.quote_items.find(q => q.budget_item_id === item.id);
        if (!qi) {
          priceEntries[quote.supplier_name] = null;
          return;
        }

        const isSubstitute = Boolean(qi.substitute_name);
        const entry: PriceEntry = {
          price: qi.price,
          isSubstitute,
          substituteName: qi.substitute_name ?? undefined,
          substituteUnitSize: qi.substitute_unit_size,
          substituteUnitType: qi.substitute_unit_type ?? undefined,
        };
        priceEntries[quote.supplier_name] = entry;

        if (!isSubstitute && (bestDirectPrice === null || qi.price < bestDirectPrice)) {
          bestDirectPrice = qi.price;
        }
        if (bestAnyPrice === null || qi.price < bestAnyPrice) {
          bestAnyPrice = qi.price;
        }
      });

      return {
        productId: item.product.id,
        productName: item.product.name,
        imageUrl: item.product.image_url,
        requestedQuantity: item.requested_quantity,
        requestedUnit: item.requested_unit,
        priceEntries,
        bestDirectPrice,
        bestAnyPrice,
      };
    });
  }, [budgetData]);

  // -------------------------------------------------------------------------
  // Inicialização das seleções
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!budgetId || comparisonData.length === 0) return;

    // Carrega seleções salvas
    const savedSelections = loadJSON<Record<string, string | null>>(storageKey(budgetId));
    const savedSubstitutes = loadJSON<Record<string, string>>(substituteKey(budgetId)) ?? {};
    setAcceptedSubstitutes(savedSubstitutes);

    if (savedSelections) {
      setSelectedSuppliers(savedSelections);
      return;
    }

    // Auto-seleciona melhor preço direto
    const initial: Record<string, string | null> = {};
    comparisonData.forEach(item => {
      if (item.bestDirectPrice !== null) {
        const best = Object.entries(item.priceEntries).find(
          ([, e]) => e && !e.isSubstitute && e.price === item.bestDirectPrice
        );
        initial[item.productId] = best?.[0] ?? null;
      } else {
        initial[item.productId] = null;
      }
    });

    setSelectedSuppliers(initial);
    saveJSON(storageKey(budgetId), initial);
  }, [comparisonData, budgetId]);

  // -------------------------------------------------------------------------
  // Listas de compra (derivadas)
  // -------------------------------------------------------------------------

  const recommendedPurchaseLists = useMemo(() => {
    const lists: Record<string, any[]> = {};
    if (!comparisonData.length || !Object.keys(selectedSuppliers).length) return lists;

    comparisonData.forEach(item => {
      const supplier = selectedSuppliers[item.productId];
      if (!supplier) return;

      const entry = item.priceEntries[supplier];
      if (!entry) return;

      if (!lists[supplier]) lists[supplier] = [];

      // Se é substituto aceito, usa o nome do substituto; senão usa nome do produto
      const isAcceptedSub = acceptedSubstitutes[item.productId] === supplier;
      const displayName = isAcceptedSub && entry.substituteName
        ? entry.substituteName
        : item.productName;

      lists[supplier].push({
        product_id: item.productId,
        name: displayName,
        quantity: item.requestedQuantity,
        unit_price: entry.price,
        supplier,
        unit: item.requestedUnit,
        is_substitute: isAcceptedSub,
      });
    });

    return lists;
  }, [comparisonData, selectedSuppliers, acceptedSubstitutes]);

  // -------------------------------------------------------------------------
  // Totais
  // -------------------------------------------------------------------------

  const supplierTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    budgetData?.supplier_quotes.forEach(q => { totals[q.supplier_name] = 0; });

    comparisonData.forEach(item => {
      const supplier = selectedSuppliers[item.productId];
      if (!supplier) return;
      const entry = item.priceEntries[supplier];
      if (entry) totals[supplier] = (totals[supplier] ?? 0) + entry.price * item.requestedQuantity;
    });

    return totals;
  }, [budgetData, comparisonData, selectedSuppliers]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleSupplierSelection = useCallback(
    (productId: string, supplierName: string, entry: PriceEntry) => {
      if (entry.isSubstitute) {
        // Abre modal para confirmar substituto
        const item = comparisonData.find(i => i.productId === productId);
        setSubstituteModal({
          open: true,
          productId,
          productName: item?.productName ?? '',
          supplierName,
          entry,
        });
        return;
      }

      // Seleção direta
      setSelectedSuppliers(prev => {
        const updated = { ...prev, [productId]: supplierName };
        if (budgetId) saveJSON(storageKey(budgetId), updated);
        return updated;
      });
      // Remove substituto aceito se havia
      setAcceptedSubstitutes(prev => {
        const updated = { ...prev };
        delete updated[productId];
        if (budgetId) saveJSON(substituteKey(budgetId), updated);
        return updated;
      });
    },
    [budgetId, comparisonData]
  );

  const handleAcceptSubstitute = useCallback(() => {
    const { productId, supplierName } = substituteModal;

    setSelectedSuppliers(prev => {
      const updated = { ...prev, [productId]: supplierName };
      if (budgetId) saveJSON(storageKey(budgetId), updated);
      return updated;
    });
    setAcceptedSubstitutes(prev => {
      const updated = { ...prev, [productId]: supplierName };
      if (budgetId) saveJSON(substituteKey(budgetId), updated);
      return updated;
    });

    setSubstituteModal(s => ({ ...s, open: false }));
    addNotification('Substituto aceito e selecionado.', 'success');
  }, [substituteModal, budgetId, addNotification]);

  const handleResetToAutomatic = useCallback(() => {
    if (!budgetId || !comparisonData.length) return;

    const reset: Record<string, string | null> = {};
    comparisonData.forEach(item => {
      if (item.bestDirectPrice !== null) {
        const best = Object.entries(item.priceEntries).find(
          ([, e]) => e && !e.isSubstitute && e.price === item.bestDirectPrice
        );
        reset[item.productId] = best?.[0] ?? null;
      } else {
        reset[item.productId] = null;
      }
    });

    clearKey(storageKey(budgetId));
    clearKey(substituteKey(budgetId));
    saveJSON(storageKey(budgetId), reset);
    setSelectedSuppliers(reset);
    setAcceptedSubstitutes({});
    addNotification('Seleções resetadas para o melhor preço.', 'info');
  }, [budgetId, comparisonData, addNotification]);

  const handleCreatePurchaseList = async (supplierName: string, items: any[]) => {
    addNotification(`Preparando orçamento para ${supplierName}...`, 'info');
    try {
      // Busca TODOS os product_ids — incluindo substitutos.
      // product_id é SEMPRE o produto original requisitado (ex: Antartica),
      // mesmo quando o fornecedor oferece um substituto (ex: Schwepps).
      // Assim o histórico (última compra, data, quantidade) vem do original.
      const allProductIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];

      let fullProductsData: any[] = [];
      if (allProductIds.length > 0) {
        const { data, error: productsError } = await supabase
          .from('products').select('*').in('id', allProductIds);
        if (productsError) throw productsError;
        fullProductsData = data ?? [];
      }

      const selectedProductDetails = items.map(item => {
        // fullProduct = dados do produto ORIGINAL (Antartica)
        const fullProduct = fullProductsData.find(p => p.id === item.product_id) ?? {};

        let formattedDate: string | undefined;
        if (fullProduct?.last_purchase_date) {
          try {
            const parsed = parseISO(fullProduct.last_purchase_date);
            if (isValid(parsed)) formattedDate = format(parsed, 'yyyy-MM-dd');
          } catch { /* ignore */ }
        }

        return {
          ...fullProduct,
          // id sempre aponta pro produto original — garante que ao receber
          // a compra, o histórico (last_purchase_price, date, quantity) seja
          // gravado no produto correto do inventário (ex: Agua Tonica Antartica)
          id:                    item.product_id,
          // nome visível no orçamento = nome do substituto aceito (ex: Schwepps)
          name:                  item.name,
          editedName:            item.name,
          // preço e fornecedor vêm do substituto oferecido
          editedPrice:           item.unit_price,
          editedQuantity:        item.quantity,
          editedSupplier:        item.supplier,
          editedUnit:            item.unit,
          // histórico e stock vêm do produto ORIGINAL
          editedStock:           fullProduct?.quantity ?? 0,
          editedLastPrice:       fullProduct?.last_purchase_price,
          editedLastPurchaseDate: formattedDate,
          editedLastQuantity:    fullProduct?.last_purchase_quantity,
          // flag para o NewPurchaseList exibir badge "substituto"
          isSubstitute:          item.is_substitute,
          // nome original para referência visual
          originalProductName:   item.is_substitute ? fullProduct?.name : undefined,
        };
      });

      navigate('/purchases/list', { state: { selectedProductDetails } });
    } catch (err: any) {
      addNotification('Erro ao preparar orçamento: ' + err.message, 'error');
    }
  };

  // -------------------------------------------------------------------------
  // Derived flags
  // -------------------------------------------------------------------------

  const hasCustomSelections = useMemo(() => {
    return comparisonData.some(item => {
      const autoSupplier = item.bestDirectPrice !== null
        ? Object.entries(item.priceEntries).find(
            ([, e]) => e && !e.isSubstitute && e.price === item.bestDirectPrice
          )?.[0] ?? null
        : null;
      return selectedSuppliers[item.productId] !== autoSupplier;
    });
  }, [comparisonData, selectedSuppliers]);

  // -------------------------------------------------------------------------
  // Loading / Error
  // -------------------------------------------------------------------------

  if (loading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md">
        <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-gray-800">Ocorreu um Erro</h1>
        <p className="text-gray-600 mt-2">{error}</p>
      </div>
    </div>
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">

        {/* Navegação */}
        <div className="flex items-center mb-6">
          <Link to="/purchases" className="flex items-center text-gray-600 dark:text-gray-300 hover:text-blue-600 transition-colors">
            <ArrowLeft className="h-5 w-5 mr-2" />
            Voltar para Compras
          </Link>
        </div>

        {/* Cabeçalho */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center space-x-3">
              <BarChart2 className="h-8 w-8 text-blue-500 flex-shrink-0" />
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">
                  Análise de Cotação
                </h1>
                <p className="text-gray-600 dark:text-gray-400">{budgetData?.name}</p>
              </div>
            </div>
            {hasCustomSelections && (
              <button
                onClick={handleResetToAutomatic}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-700 transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
                Resetar para melhor preço
              </button>
            )}
          </div>
        </div>

        {/* Listas de compra */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-1">
            Listas de Compra por Fornecedor
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Baseado na sua seleção.{' '}
            <span className="font-medium text-blue-600 dark:text-blue-400">
              Suas escolhas são salvas automaticamente.
            </span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(recommendedPurchaseLists).map(([supplier, items]) => {
              const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
              const subCount = items.filter(i => i.is_substitute).length;
              return (
                <div key={supplier} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-700/50">
                  <h3 className="font-bold text-lg text-blue-600 dark:text-blue-400">{supplier}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{items.length} item(ns)</p>
                  {subCount > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      ⚠️ {subCount} substituto(s) aceito(s)
                    </p>
                  )}
                  <p className="text-2xl font-bold text-gray-800 dark:text-white my-2">
                    R$ {total.toFixed(2).replace('.', ',')}
                  </p>
                  <button
                    onClick={() => handleCreatePurchaseList(supplier, items)}
                    className="w-full mt-2 flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    Gerar Orçamento
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tabela comparativa */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
          <div className="p-6 pb-0">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
              Tabela Comparativa de Preços
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Clique em um preço para selecionar. Células com ⚠️ indicam produto substituto — clique para ver detalhes.
            </p>
          </div>

          <div className="overflow-x-auto mt-4">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">
                    Produto
                  </th>
                  {budgetData?.supplier_quotes.map(quote => (
                    <th key={quote.id} className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      {quote.supplier_name}
                      <br />
                      <span className="font-normal normal-case">
                        Total: R$ {(supplierTotals[quote.supplier_name] ?? 0).toFixed(2).replace('.', ',')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {comparisonData.map(item => (
                  <tr key={item.productId}>
                    {/* Produto */}
                    <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-white dark:bg-gray-800 z-10">
                      <div className="flex items-center">
                        <img
                          src={item.imageUrl || 'https://placehold.co/40x40/e2e8f0/a0aec0?text=?'}
                          alt={item.productName}
                          className="w-10 h-10 rounded-md object-cover mr-3 flex-shrink-0"
                        />
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{item.productName}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {item.requestedQuantity} {item.requestedUnit}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Colunas por fornecedor */}
                    {budgetData?.supplier_quotes.map(quote => {
                      const entry = item.priceEntries[quote.supplier_name];
                      const isSelected = selectedSuppliers[item.productId] === quote.supplier_name;
                      const isBestDirect = entry && !entry.isSubstitute && entry.price === item.bestDirectPrice;
                      const isAcceptedSub = acceptedSubstitutes[item.productId] === quote.supplier_name;

                      return (
                        <td
                          key={quote.id}
                          onClick={() => entry && handleSupplierSelection(item.productId, quote.supplier_name, entry)}
                          title={
                            !entry ? 'Sem cotação' :
                            entry.isSubstitute ? `Substituto: ${entry.substituteName}` :
                            isSelected ? 'Selecionado' : 'Clique para selecionar'
                          }
                          className={[
                            'px-6 py-4 whitespace-nowrap text-right transition-all duration-150',
                            entry ? 'cursor-pointer' : 'cursor-default',
                            isSelected && !entry?.isSubstitute
                              ? 'ring-2 ring-blue-500 ring-inset bg-blue-50 dark:bg-blue-900/20'
                              : isAcceptedSub
                              ? 'ring-2 ring-amber-400 ring-inset bg-amber-50 dark:bg-amber-900/20'
                              : isBestDirect
                              ? 'bg-green-50 dark:bg-green-900/30'
                              : '',
                            entry && !isSelected ? 'hover:bg-gray-50 dark:hover:bg-gray-700/50' : '',
                          ].filter(Boolean).join(' ')}
                        >
                          {entry ? (
                            <div className="flex flex-col items-end gap-0.5">
                              {/* Preço */}
                              <span className={`font-semibold ${
                                isAcceptedSub
                                  ? 'text-amber-700 dark:text-amber-300'
                                  : isBestDirect
                                  ? 'text-green-600 dark:text-green-300'
                                  : 'text-gray-800 dark:text-gray-200'
                              }`}>
                                R$ {entry.price.toFixed(2).replace('.', ',')}
                              </span>

                              {/* Badges */}
                              {entry.isSubstitute && (
                                <span className="text-xs text-amber-500 flex items-center gap-1">
                                  ⚠️ substituto
                                </span>
                              )}
                              {isAcceptedSub && (
                                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                                  ✓ aceito
                                </span>
                              )}
                              {isSelected && !entry.isSubstitute && (
                                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                  ✓ selecionado
                                </span>
                              )}
                              {isBestDirect && !isSelected && !entry.isSubstitute && (
                                <span className="text-xs font-medium text-green-600 dark:text-green-400">
                                  menor preço
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Modal de detalhe do substituto */}
      <SubstituteDetailModal
        state={substituteModal}
        onAccept={handleAcceptSubstitute}
        onClose={() => setSubstituteModal(s => ({ ...s, open: false }))}
      />
    </div>
  );
};

export default BudgetAnalysis;