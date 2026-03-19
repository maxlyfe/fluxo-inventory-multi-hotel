import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import {
  ArrowLeft, Search, Filter, Building2, ShoppingCart,
  Check, Loader2, Link as LinkIcon, Copy, Package,
  ChevronDown, ChevronUp, Globe, AlertTriangle,
  CheckSquare, Square, BarChart2, History, Clock,
  ExternalLink, Edit3, Trash2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Hotel {
  id: string;
  name: string;
  code: string;
  image_url: string | null;
  fantasy_name?: string;
}

interface RawProduct {
  id: string;
  name: string;
  category: string;
  supplier: string;
  image_url: string | null;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  unit: string;
  hotel_id: string;
}

interface HotelStock {
  product_id: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  purchase_qty: number;
}

interface MultiHotelItem {
  key: string; // lowercase trimmed name
  name: string;
  category: string;
  supplier: string;
  image_url?: string;
  unit: string;
  hotels: Record<string, HotelStock>;
  selected: boolean;
}

interface GeneratedBudget {
  hotelId: string;
  hotelName: string;
  budgetId: string;
  link: string;
  itemCount: number;
}

interface BudgetHistoryGroup {
  groupId: string;
  customName: string;
  createdAt: string;
  isUnified: boolean;
  budgets: {
    id: string;
    name: string;
    hotelName: string;
    isUnified: boolean;
    itemCount: number;
    quoteCount: number;
    status: string;
  }[];
}

const unitOptions = [
  { value: 'und', label: 'Unidade' },
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'l', label: 'Litro' },
  { value: 'ml', label: 'ml' },
  { value: 'cx', label: 'Caixa' },
  { value: 'pct', label: 'Pacote' },
  { value: 'fardo', label: 'Fardo' },
  { value: 'balde', label: 'Balde' },
  { value: 'saco', label: 'Saco' },
  { value: 'galão', label: 'Galão' },
];

// ── Component ──────────────────────────────────────────────────────────────────

const MultiHotelPurchase = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  // ── State: Hotels ──
  const [allHotels, setAllHotels] = useState<Hotel[]>([]);
  const [selectedHotelIds, setSelectedHotelIds] = useState<Set<string>>(new Set());
  const [loadingHotels, setLoadingHotels] = useState(true);

  // ── State: Items ──
  const [items, setItems] = useState<MultiHotelItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // ── State: Filters ──
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showOnlyLowStock, setShowOnlyLowStock] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // ── State: Budget generation ──
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedBudgets, setGeneratedBudgets] = useState<GeneratedBudget[]>([]);
  const [unifiedLink, setUnifiedLink] = useState<string | null>(null);
  const [copiedBudgetId, setCopiedBudgetId] = useState<string | null>(null);
  const [budgetCustomName, setBudgetCustomName] = useState('');

  // ── State: History ──
  const [historyGroups, setHistoryGroups] = useState<BudgetHistoryGroup[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingName, setEditingName] = useState<{ groupId: string; name: string } | null>(null);

  // ── Load hotels ──
  useEffect(() => {
    const fetchHotels = async () => {
      try {
        const { data, error } = await supabase
          .from('hotels')
          .select('id, name, code, image_url, fantasy_name')
          .order('name');

        if (error) throw error;
        setAllHotels(data || []);
      } catch (err: any) {
        addNotification('Erro ao carregar hotéis: ' + err.message, 'error');
      } finally {
        setLoadingHotels(false);
      }
    };
    fetchHotels();
  }, []);

  // ── Fetch budget history ──
  const fetchHistory = useCallback(async () => {
    if (!user?.id) return;
    setLoadingHistory(true);
    try {
      // Fetch all multi-hotel budgets (those with group_id) created by this user
      const { data, error } = await supabase
        .from('dynamic_budgets')
        .select(`
          id, name, hotel_id, group_id, is_unified, status, created_at,
          hotels!inner(name),
          dynamic_budget_items(id),
          supplier_quotes(id)
        `)
        .eq('created_by', user.id)
        .not('group_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Group by group_id
      const groupMap = new Map<string, BudgetHistoryGroup>();
      for (const b of (data || [])) {
        const gid = b.group_id as string;
        if (!groupMap.has(gid)) {
          groupMap.set(gid, {
            groupId: gid,
            customName: '',
            createdAt: b.created_at,
            isUnified: false,
            budgets: [],
          });
        }
        const group = groupMap.get(gid)!;
        if (b.is_unified) {
          group.isUnified = true;
          // Use unified budget name as group name
          group.customName = b.name;
        }
        group.budgets.push({
          id: b.id,
          name: b.name,
          hotelName: (b.hotels as any)?.name || '—',
          isUnified: b.is_unified || false,
          itemCount: (b.dynamic_budget_items as any[])?.length || 0,
          quoteCount: (b.supplier_quotes as any[])?.length || 0,
          status: b.status || 'open',
        });
      }

      // If group has no unified budget, use first per-hotel name
      for (const group of groupMap.values()) {
        if (!group.customName && group.budgets.length > 0) {
          group.customName = group.budgets[0].name;
        }
      }

      setHistoryGroups(Array.from(groupMap.values()));
    } catch (err: any) {
      console.error('Erro ao carregar histórico:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, fetchHistory]);

  const handleRenameBudgetGroup = async (groupId: string, newName: string) => {
    try {
      const { error } = await supabase
        .from('dynamic_budgets')
        .update({ name: newName })
        .eq('group_id', groupId);
      if (error) throw error;
      addNotification('Nome atualizado!', 'success');
      setEditingName(null);
      fetchHistory();
    } catch (err: any) {
      addNotification('Erro ao renomear: ' + err.message, 'error');
    }
  };

  // ── Fetch products when selected hotels change ──
  useEffect(() => {
    if (selectedHotelIds.size === 0) {
      setItems([]);
      return;
    }
    fetchProductsForHotels();
  }, [selectedHotelIds]);

  const fetchProductsForHotels = async () => {
    setLoadingItems(true);
    try {
      const hotelIds = Array.from(selectedHotelIds);
      const { data, error } = await supabase
        .from('products')
        .select('id, name, category, supplier, image_url, quantity, min_quantity, max_quantity, unit, hotel_id')
        .in('hotel_id', hotelIds)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      // Build current selection map (preserve selected state & purchase_qty edits)
      const prevMap = new Map<string, MultiHotelItem>();
      for (const item of items) {
        prevMap.set(item.key, item);
      }

      // Merge products by name
      const itemMap = new Map<string, MultiHotelItem>();

      for (const p of (data || []) as RawProduct[]) {
        const key = p.name.trim().toLowerCase();

        if (!itemMap.has(key)) {
          const prev = prevMap.get(key);
          itemMap.set(key, {
            key,
            name: p.name,
            category: p.category || '',
            supplier: p.supplier || '',
            image_url: p.image_url || undefined,
            unit: p.unit || 'und',
            hotels: {},
            selected: prev?.selected ?? false,
          });
        }

        const item = itemMap.get(key)!;
        if (!item.image_url && p.image_url) item.image_url = p.image_url;
        if (!item.supplier && p.supplier) item.supplier = p.supplier;
        if (!item.category && p.category) item.category = p.category;

        // Preserve previous purchase_qty if user already edited it
        const prevHotelData = prevMap.get(key)?.hotels[p.hotel_id];
        const defaultPurchaseQty = Math.max(0, (p.max_quantity || 0) - (p.quantity || 0));

        item.hotels[p.hotel_id] = {
          product_id: p.id,
          quantity: p.quantity || 0,
          min_quantity: p.min_quantity || 0,
          max_quantity: p.max_quantity || 0,
          purchase_qty: prevHotelData?.purchase_qty ?? defaultPurchaseQty,
        };
      }

      setItems(Array.from(itemMap.values()));
    } catch (err: any) {
      addNotification('Erro ao carregar produtos: ' + err.message, 'error');
    } finally {
      setLoadingItems(false);
    }
  };

  // ── Hotel toggle ──
  const toggleHotel = useCallback((hotelId: string) => {
    setSelectedHotelIds(prev => {
      const next = new Set(prev);
      if (next.has(hotelId)) {
        next.delete(hotelId);
      } else {
        next.add(hotelId);
      }
      return next;
    });
    // Reset generated budgets when hotels change
    setGeneratedBudgets([]);
  }, []);

  // ── Item selection ──
  const toggleItemSelection = useCallback((key: string) => {
    setItems(prev => prev.map(item =>
      item.key === key ? { ...item, selected: !item.selected } : item
    ));
  }, []);

  const selectAllFiltered = useCallback(() => {
    const filteredKeys = new Set(filteredItems.map(i => i.key));
    setItems(prev => prev.map(item =>
      filteredKeys.has(item.key) ? { ...item, selected: true } : item
    ));
  }, []);

  const deselectAll = useCallback(() => {
    setItems(prev => prev.map(item => ({ ...item, selected: false })));
  }, []);

  // ── Purchase qty update ──
  const updatePurchaseQty = useCallback((key: string, hotelId: string, qty: number) => {
    setItems(prev => prev.map(item => {
      if (item.key !== key || !item.hotels[hotelId]) return item;
      return {
        ...item,
        hotels: {
          ...item.hotels,
          [hotelId]: {
            ...item.hotels[hotelId],
            purchase_qty: Math.max(0, qty),
          },
        },
      };
    }));
  }, []);

  // ── Derived data ──
  const suppliers = useMemo(() =>
    [...new Set(items.map(i => i.supplier).filter(Boolean))].sort(),
    [items]
  );

  const categories = useMemo(() =>
    [...new Set(items.map(i => i.category).filter(Boolean))].sort(),
    [items]
  );

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (searchTerm && !item.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (selectedSupplier && item.supplier !== selectedSupplier) return false;
      if (selectedCategory && item.category !== selectedCategory) return false;
      if (showOnlyLowStock) {
        const hasLowStock = Object.values(item.hotels).some(h => h.quantity <= h.min_quantity);
        if (!hasLowStock) return false;
      }
      return true;
    });
  }, [items, searchTerm, selectedSupplier, selectedCategory, showOnlyLowStock]);

  const selectedItems = useMemo(() => items.filter(i => i.selected), [items]);
  const selectedHotels = useMemo(() => allHotels.filter(h => selectedHotelIds.has(h.id)), [allHotels, selectedHotelIds]);

  // Total items that will generate budget per hotel
  const budgetSummary = useMemo(() => {
    const summary: Record<string, { included: number; excluded: number }> = {};
    for (const hotel of selectedHotels) {
      const included = selectedItems.filter(
        item => item.hotels[hotel.id] && item.hotels[hotel.id].purchase_qty > 0
      ).length;
      const excluded = selectedItems.filter(
        item => item.hotels[hotel.id] && item.hotels[hotel.id].purchase_qty === 0
      ).length;
      summary[hotel.id] = { included, excluded };
    }
    return summary;
  }, [selectedItems, selectedHotels]);

  // ── Generate budgets ──
  const handleGenerateBudgets = async (unified: boolean) => {
    if (!user?.id) {
      addNotification('Sessão inválida. Recarregue a página.', 'error');
      return;
    }
    if (selectedItems.length === 0) {
      addNotification('Selecione pelo menos um item.', 'warning');
      return;
    }

    setIsGenerating(true);
    try {
      const budgets: GeneratedBudget[] = [];
      const timestamp = new Date().toLocaleDateString('pt-BR');
      const groupId = crypto.randomUUID();
      const baseName = budgetCustomName.trim() || `Multi-Hotel ${timestamp}`;

      // 1. Create per-hotel budgets
      for (const hotel of selectedHotels) {
        const hotelItems = selectedItems
          .filter(item => item.hotels[hotel.id] && item.hotels[hotel.id].purchase_qty > 0)
          .map(item => ({
            product_id: item.hotels[hotel.id].product_id,
            requested_quantity: item.hotels[hotel.id].purchase_qty,
            requested_unit: item.unit,
          }));

        if (hotelItems.length === 0) continue;

        const { data: budgetData, error: budgetError } = await supabase
          .from('dynamic_budgets')
          .insert({
            name: `${baseName} — ${hotel.name}`,
            hotel_id: hotel.id,
            created_by: user.id,
            group_id: groupId,
            is_unified: false,
          })
          .select('id')
          .single();

        if (budgetError) throw budgetError;

        const { error: itemsError } = await supabase
          .from('dynamic_budget_items')
          .insert(hotelItems.map(item => ({
            budget_id: budgetData.id,
            product_id: item.product_id,
            requested_quantity: item.requested_quantity,
            requested_unit: item.requested_unit,
          })));

        if (itemsError) throw itemsError;

        budgets.push({
          hotelId: hotel.id,
          hotelName: hotel.name,
          budgetId: budgetData.id,
          link: `${window.location.origin}/quote/${budgetData.id}`,
          itemCount: hotelItems.length,
        });
      }

      // 2. If unified, create the single unified budget with deduplicated items
      if (unified && budgets.length > 0) {
        const unifiedItems: { product_id: string; total_qty: number; unit: string }[] = [];

        for (const item of selectedItems) {
          const firstEntry = Object.values(item.hotels).find(h => h.purchase_qty > 0);
          if (!firstEntry) continue;

          let totalQty = 0;
          for (const hotel of selectedHotels) {
            if (item.hotels[hotel.id]?.purchase_qty > 0) {
              totalQty += item.hotels[hotel.id].purchase_qty;
            }
          }

          if (totalQty > 0) {
            unifiedItems.push({
              product_id: firstEntry.product_id,
              total_qty: totalQty,
              unit: item.unit,
            });
          }
        }

        if (unifiedItems.length > 0) {
          const { data: unifiedBudget, error: unifiedError } = await supabase
            .from('dynamic_budgets')
            .insert({
              name: `${baseName} — Unificado`,
              hotel_id: selectedHotels[0].id,
              created_by: user.id,
              group_id: groupId,
              is_unified: true,
            })
            .select('id')
            .single();

          if (unifiedError) throw unifiedError;

          const { error: uItemsError } = await supabase
            .from('dynamic_budget_items')
            .insert(unifiedItems.map(item => ({
              budget_id: unifiedBudget.id,
              product_id: item.product_id,
              requested_quantity: item.total_qty,
              requested_unit: item.unit,
            })));

          if (uItemsError) throw uItemsError;

          setUnifiedLink(`${window.location.origin}/quote/${unifiedBudget.id}`);
        }
      }

      if (budgets.length === 0) {
        addNotification('Nenhum hotel tem itens com quantidade > 0 para compra.', 'warning');
      } else {
        setGeneratedBudgets(budgets);
        const msg = unified
          ? `Link unificado + ${budgets.length} orçamento(s) por hotel criados!`
          : `${budgets.length} orçamento(s) criado(s) com sucesso!`;
        addNotification(msg, 'success');
      }
    } catch (err: any) {
      addNotification('Erro ao gerar orçamentos: ' + err.message, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyLink = (link: string, budgetId: string) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedBudgetId(budgetId);
      addNotification('Link copiado!', 'success');
      setTimeout(() => setCopiedBudgetId(null), 2000);
    }).catch(() => {
      addNotification('Falha ao copiar link.', 'error');
    });
  };

  // ── Render: Success (budgets generated) ──
  if (generatedBudgets.length > 0) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-6 lg:p-8 bg-gray-50 dark:bg-gray-900 min-h-screen">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center mb-6">
          <Check className="mx-auto h-16 w-16 text-green-500 bg-green-100 dark:bg-green-900/30 rounded-full p-3" />
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mt-4">
            Orçamentos Multi-Hotel Criados!
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            {generatedBudgets.length} orçamento(s) por hotel gerado(s).
            {unifiedLink && ' O link unificado propaga as cotações automaticamente para cada hotel.'}
          </p>
        </div>

        {/* Unified link (prominent) */}
        {unifiedLink && (
          <div className="bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-400 dark:border-purple-500 rounded-lg p-5 mb-6">
            <h3 className="font-semibold text-purple-800 dark:text-purple-200 flex items-center gap-2 mb-2">
              <Globe className="h-5 w-5" />
              Link Unificado — Enviar aos Fornecedores
            </h3>
            <p className="text-sm text-purple-600 dark:text-purple-300 mb-3">
              O fornecedor responde uma vez e os preços são distribuídos automaticamente para cada hotel.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={unifiedLink}
                className="flex-1 p-2.5 border border-purple-300 dark:border-purple-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm"
              />
              <button
                onClick={() => handleCopyLink(unifiedLink, 'unified')}
                className="px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-1.5 font-medium text-sm whitespace-nowrap"
              >
                {copiedBudgetId === 'unified' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Copiar
              </button>
            </div>
          </div>
        )}

        {/* Per-hotel budgets */}
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wide">
          Orçamentos por Hotel — Análise de Cotações
        </h3>
        <div className="space-y-3">
          {generatedBudgets.map(budget => (
            <div key={budget.budgetId} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-blue-500" />
                    {budget.hotelName}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {budget.itemCount} itens no orçamento
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {!unifiedLink && (
                    <button
                      onClick={() => handleCopyLink(budget.link, budget.budgetId)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-sm"
                    >
                      {copiedBudgetId === budget.budgetId ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      Copiar Link
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/purchases/dynamic-budget/analysis/${budget.budgetId}`)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                  >
                    <BarChart2 className="h-4 w-4" />
                    Analisar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => { setGeneratedBudgets([]); setUnifiedLink(null); }}
            className="flex-1 py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Novo Orçamento Multi-Hotel
          </button>
          <button
            onClick={() => navigate('/purchases')}
            className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
          >
            Voltar para Compras
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Main ──
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/purchases')}
          className="flex items-center text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <ArrowLeft className="h-5 w-5 mr-2" />
          Voltar para Compras
        </button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <Building2 className="h-7 w-7 text-purple-600 dark:text-purple-400" />
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">
          Compra Multi-Hotel
        </h1>
      </div>

      {/* Hotel Selection */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-3">
          Selecione os Hotéis
        </h2>
        {loadingHotels ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {allHotels.map(hotel => {
              const isSelected = selectedHotelIds.has(hotel.id);
              return (
                <button
                  key={hotel.id}
                  onClick={() => toggleHotel(hotel.id)}
                  className={`
                    flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all text-sm font-medium
                    ${isSelected
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 shadow-sm'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'
                    }
                  `}
                >
                  {isSelected ? (
                    <Check className="h-4 w-4 text-purple-500" />
                  ) : (
                    <Building2 className="h-4 w-4 text-gray-400" />
                  )}
                  {hotel.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Budget History */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg mb-6">
        <button
          onClick={() => setShowHistory(v => !v)}
          className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors rounded-lg"
        >
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-purple-500" />
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Histórico de Orçamentos</h2>
            {historyGroups.length > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                {historyGroups.length}
              </span>
            )}
          </div>
          {showHistory
            ? <ChevronUp className="h-5 w-5 text-gray-400" />
            : <ChevronDown className="h-5 w-5 text-gray-400" />
          }
        </button>

        {showHistory && (
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-3">
            {loadingHistory ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              </div>
            ) : historyGroups.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">Nenhum orçamento multi-hotel criado ainda.</p>
            ) : (
              historyGroups.map(group => {
                const unifiedBudget = group.budgets.find(b => b.isUnified);
                const perHotelBudgets = group.budgets.filter(b => !b.isUnified);
                const totalQuotes = group.budgets.reduce((sum, b) => sum + b.quoteCount, 0);
                const createdDate = new Date(group.createdAt);

                return (
                  <div key={group.groupId} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    {/* Group header */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        {editingName?.groupId === group.groupId ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editingName.name}
                              onChange={e => setEditingName({ ...editingName, name: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Enter') handleRenameBudgetGroup(group.groupId, editingName.name); if (e.key === 'Escape') setEditingName(null); }}
                              className="flex-1 px-2 py-1 text-sm rounded border border-purple-300 dark:border-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-purple-400 outline-none"
                              autoFocus
                            />
                            <button
                              onClick={() => handleRenameBudgetGroup(group.groupId, editingName.name)}
                              className="p-1 text-green-500 hover:text-green-600"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-800 dark:text-white text-sm truncate">
                              {group.customName}
                            </h3>
                            <button
                              onClick={() => setEditingName({ groupId: group.groupId, name: group.customName })}
                              className="p-1 text-gray-400 hover:text-purple-500 transition-colors shrink-0"
                              title="Renomear"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {createdDate.toLocaleDateString('pt-BR')} {createdDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span>{perHotelBudgets.length} hotel(is)</span>
                          {totalQuotes > 0 && (
                            <span className="text-green-500">{totalQuotes} cotação(ões)</span>
                          )}
                        </div>
                      </div>

                      {group.isUnified && unifiedBudget && (
                        <button
                          onClick={() => handleCopyLink(`${window.location.origin}/quote/${unifiedBudget.id}`, unifiedBudget.id)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors shrink-0"
                        >
                          {copiedBudgetId === unifiedBudget.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          Link Unificado
                        </button>
                      )}
                    </div>

                    {/* Per-hotel budgets */}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {perHotelBudgets.map(b => (
                        <div key={b.id} className="flex items-center gap-1.5 text-xs bg-gray-50 dark:bg-gray-700/50 rounded-lg px-2.5 py-1.5">
                          <Building2 className="w-3 h-3 text-blue-500" />
                          <span className="text-gray-700 dark:text-gray-300 font-medium">{b.hotelName}</span>
                          <span className="text-gray-400">({b.itemCount} itens)</span>
                          <button
                            onClick={() => navigate(`/purchases/dynamic-budget/analysis/${b.id}`)}
                            className="ml-1 p-0.5 text-blue-500 hover:text-blue-600"
                            title="Analisar"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          {!group.isUnified && (
                            <button
                              onClick={() => handleCopyLink(`${window.location.origin}/quote/${b.id}`, b.id)}
                              className="p-0.5 text-gray-400 hover:text-purple-500"
                              title="Copiar link"
                            >
                              {copiedBudgetId === b.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {selectedHotelIds.size === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-12 text-center">
          <Building2 className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 dark:text-gray-400">
            Selecione pelo menos um hotel para começar
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
            Os produtos de inventário dos hotéis selecionados serão carregados automaticamente.
          </p>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6 mb-6">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
                Itens de Inventário
                {!loadingItems && (
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                    ({filteredItems.length} itens)
                  </span>
                )}
              </h2>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center text-sm text-gray-600 dark:text-gray-300 hover:text-blue-500"
              >
                <Filter className="w-4 h-4 mr-1" />
                Filtros
                {showFilters ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
              </button>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4 pb-4 border-b dark:border-gray-700">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Buscar</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Nome do produto..."
                      className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fornecedor</label>
                  <select
                    value={selectedSupplier}
                    onChange={e => setSelectedSupplier(e.target.value)}
                    className="w-full py-2 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">Todos</option>
                    {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Categoria</label>
                  <select
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                    className="w-full py-2 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">Todas</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showOnlyLowStock}
                      onChange={e => setShowOnlyLowStock(e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      <AlertTriangle className="h-3.5 w-3.5 inline mr-1 text-amber-500" />
                      Apenas estoque baixo
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Bulk selection */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={selectAllFiltered}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-md hover:bg-purple-200 dark:hover:bg-purple-900/50"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                Selecionar Todos
              </button>
              <button
                onClick={deselectAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                <Square className="h-3.5 w-3.5" />
                Limpar Seleção
              </button>
              {selectedItems.length > 0 && (
                <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                  {selectedItems.length} selecionado(s)
                </span>
              )}
            </div>

            {/* Items list */}
            {loadingItems ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <span className="ml-3 text-gray-600 dark:text-gray-400">Carregando produtos...</span>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-600 dark:text-gray-400">Nenhum item encontrado com os filtros atuais.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
                {filteredItems.map(item => {
                  const hasLowStock = Object.values(item.hotels).some(h => h.quantity <= h.min_quantity);
                  return (
                    <div
                      key={item.key}
                      className={`rounded-lg border-2 transition-all ${
                        item.selected
                          ? 'border-purple-400 dark:border-purple-500 bg-purple-50/50 dark:bg-purple-900/10'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                      }`}
                    >
                      {/* Item header */}
                      <div
                        className="flex items-center gap-3 p-3 cursor-pointer"
                        onClick={() => toggleItemSelection(item.key)}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                          item.selected
                            ? 'border-purple-500 bg-purple-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {item.selected && (
                            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>

                        <div className="h-9 w-9 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {item.image_url ? (
                            <img src={item.image_url} alt={item.name} className="h-full w-full object-contain" />
                          ) : (
                            <Package className="h-4 w-4 text-gray-400" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-200 truncate">
                              {item.name}
                            </h3>
                            {hasLowStock && (
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {item.supplier && `${item.supplier} · `}{item.category}
                          </p>
                        </div>
                      </div>

                      {/* Per-hotel details */}
                      <div className="border-t border-gray-100 dark:border-gray-700">
                        {/* Header row */}
                        <div className="grid items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-750 text-xs font-medium text-gray-500 dark:text-gray-400"
                          style={{ gridTemplateColumns: '1fr repeat(4, minmax(0, 1fr))' }}
                        >
                          <span>Hotel</span>
                          <span className="text-center">Estoque</span>
                          <span className="text-center">Mín</span>
                          <span className="text-center">Máx</span>
                          <span className="text-center">Comprar</span>
                        </div>

                        {/* Hotel rows */}
                        {selectedHotels.map(hotel => {
                          const hotelData = item.hotels[hotel.id];
                          if (!hotelData) {
                            return (
                              <div
                                key={hotel.id}
                                className="grid items-center gap-2 px-3 py-2 border-t border-gray-50 dark:border-gray-700/50 opacity-40"
                                style={{ gridTemplateColumns: '1fr repeat(4, minmax(0, 1fr))' }}
                              >
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-300 truncate">{hotel.name}</span>
                                <span className="text-center text-xs text-gray-400 dark:text-gray-500">—</span>
                                <span className="text-center text-xs text-gray-400 dark:text-gray-500">—</span>
                                <span className="text-center text-xs text-gray-400 dark:text-gray-500">—</span>
                                <span className="text-center text-xs text-gray-400 dark:text-gray-500">—</span>
                              </div>
                            );
                          }

                          const isLow = hotelData.quantity <= hotelData.min_quantity;
                          const isExcluded = hotelData.purchase_qty === 0;
                          return (
                            <div
                              key={hotel.id}
                              className={`grid items-center gap-2 px-3 py-2 border-t border-gray-50 dark:border-gray-700/50 ${isExcluded ? 'opacity-50 bg-gray-50 dark:bg-gray-800/50' : ''}`}
                              style={{ gridTemplateColumns: '1fr repeat(4, minmax(0, 1fr))' }}
                            >
                              <span className={`text-xs font-medium truncate ${isExcluded ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-600 dark:text-gray-300'}`}>
                                {hotel.name}
                              </span>
                              <span className={`text-center text-xs font-semibold ${
                                isLow ? 'text-red-500' : 'text-gray-700 dark:text-gray-300'
                              }`}>
                                {hotelData.quantity}
                              </span>
                              <span className="text-center text-xs text-gray-500 dark:text-gray-400">
                                {hotelData.min_quantity}
                              </span>
                              <span className="text-center text-xs text-gray-500 dark:text-gray-400">
                                {hotelData.max_quantity}
                              </span>
                              <div className="flex flex-col items-center" onClick={e => e.stopPropagation()}>
                                <input
                                  type="number"
                                  min="0"
                                  value={hotelData.purchase_qty}
                                  onChange={e => {
                                    const val = e.target.value;
                                    const parsed = val === '' ? 0 : parseInt(val, 10);
                                    updatePurchaseQty(item.key, hotel.id, isNaN(parsed) ? 0 : parsed);
                                  }}
                                  className={`w-16 text-center text-xs py-1 border rounded ${
                                    isExcluded
                                      ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-400 dark:text-red-500'
                                      : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                                  }`}
                                />
                                {isExcluded && (
                                  <span className="text-[9px] text-red-400 dark:text-red-500 mt-0.5 leading-none">não incluso</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom action bar */}
          {selectedItems.length > 0 && (
            <div className="sticky bottom-0 bg-white dark:bg-gray-800 rounded-lg shadow-lg border-t-2 border-purple-400 dark:border-purple-500 p-4 mt-6">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white">
                      {selectedItems.length} item(ns) selecionado(s)
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {selectedHotels.map(hotel => {
                        const info = budgetSummary[hotel.id] || { included: 0, excluded: 0 };
                        return (
                          <span key={hotel.id} className="text-xs text-gray-500 dark:text-gray-400">
                            {hotel.name}: <span className="font-semibold text-purple-600 dark:text-purple-400">{info.included}</span> itens
                            {info.excluded > 0 && (
                              <span className="text-red-400 dark:text-red-500 ml-1">({info.excluded} excluído{info.excluded > 1 ? 's' : ''})</span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {/* Nome do orçamento */}
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                    Nome do Orçamento (opcional)
                  </label>
                  <input
                    type="text"
                    value={budgetCustomName}
                    onChange={e => setBudgetCustomName(e.target.value)}
                    placeholder={`Multi-Hotel ${new Date().toLocaleDateString('pt-BR')}`}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-purple-400 outline-none"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => handleGenerateBudgets(true)}
                    disabled={isGenerating}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Globe className="h-5 w-5" />}
                    Link Unificado
                  </button>
                  <button
                    onClick={() => handleGenerateBudgets(false)}
                    disabled={isGenerating}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Building2 className="h-5 w-5" />}
                    Links Individuais
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MultiHotelPurchase;
