import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Calendar, Download, Truck, Trash2, Save,
  CheckCircle, XCircle, History, Database, ShoppingBag,
  Package, ChevronDown, ChevronUp, Layers,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { supabase, getBudgetDetails, updateBudgetItems, updateBudgetStatus } from '../lib/supabase';
import { createNotification } from '../lib/notifications';
import * as XLSX from 'xlsx';

// ── Opções de unidade ──────────────────────────────────────────────────────────
const unitOptions = [
  { value: 'kg',    label: 'kg'    },
  { value: 'g',     label: 'g'     },
  { value: 'l',     label: 'L'     },
  { value: 'ml',    label: 'mL'    },
  { value: 'und',   label: 'un'    },
  { value: 'cx',    label: 'cx'    },
  { value: 'pct',   label: 'pct'   },
  { value: 'fardo', label: 'fardo' },
  { value: 'balde', label: 'balde' },
  { value: 'saco',  label: 'saco'  },
];

// ── Interfaces ────────────────────────────────────────────────────────────────
interface SectorStock {
  sector_name: string;
  quantity: number;
  color?: string;
}

interface BudgetItemDetail {
  id: string;
  product_id: string | null;
  custom_item_name: string | null;
  quantity: number;
  unit_price: number | null;
  supplier: string | null;
  last_purchase_quantity: number | null;
  last_purchase_price: number | null;
  last_purchase_date: string | null;
  weight: number | null;
  unit: string | null;
  stock_at_creation: number | null;
  product: { id: string; name: string; category: string } | null;
  // carregado dinamicamente
  sectorStocks?: SectorStock[];
  loadingStock?: boolean;
}

interface BudgetDetailData {
  id: string;
  created_at: string;
  total_value: number;
  status: 'pending' | 'approved' | 'on_the_way' | 'delivered' | 'cancelled' | null;
  hotel_id: string;
  hotel: { id: string; name: string } | null;
  budget_items: BudgetItemDetail[];
  approved_by_user_email?: string | null;
  approved_at?: string | null;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_MAP: Record<string, { label: string; classes: string }> = {
  pending:    { label: 'Pendente',   classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  approved:   { label: 'Aprovado',   classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  on_the_way: { label: 'A Caminho',  classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  delivered:  { label: 'Entregue',   classes: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  cancelled:  { label: 'Cancelado',  classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

// ─────────────────────────────────────────────────────────────────────────────
const BudgetDetail = () => {
  const { budgetId } = useParams<{ budgetId: string }>();
  const navigate      = useNavigate();
  const { user }      = useAuth();
  const { addNotification } = useNotification();

  const [budget,  setBudget]  = useState<BudgetDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Controla qual item tem o painel de stock expandido
  const [expandedStock, setExpandedStock] = useState<string | null>(null);

  // ── Fetch principal ───────────────────────────────────────────────────────
  const fetchDetails = async () => {
    if (!budgetId) { setError('ID do orçamento não fornecido.'); setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const result = await getBudgetDetails(budgetId);
      if (result.success && result.data) {
        setBudget(result.data);
      } else {
        throw new Error(result.error || 'Falha ao buscar detalhes.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
      setError(`Erro ao carregar: ${msg}`);
      addNotification(`Erro ao carregar: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDetails(); }, [budgetId]);

  // ── Buscar stock por setor de um produto ──────────────────────────────────
  const loadSectorStock = async (itemId: string, productId: string | null) => {
    if (!productId || !budget?.hotel_id) return;
    if (expandedStock === itemId) { setExpandedStock(null); return; }

    // Marca como carregando
    setBudget(prev => prev ? {
      ...prev,
      budget_items: prev.budget_items.map(i =>
        i.id === itemId ? { ...i, loadingStock: true } : i
      ),
    } : prev);

    const { data, error } = await supabase
      .from('sector_stock')
      .select('quantity, sectors(name, color)')
      .eq('product_id', productId)
      .eq('hotel_id', budget.hotel_id)
      .gt('quantity', 0);

    const HIDDEN_SECTORS = ['perdas/vencimentos', 'perdas', 'vencimentos'];

    const stocks: SectorStock[] = (data || [])
      .filter((row: any) => !HIDDEN_SECTORS.includes((row.sectors?.name ?? '').toLowerCase().trim()))
      .map((row: any) => ({
        sector_name: row.sectors?.name ?? 'Setor',
        quantity:    row.quantity,
        color:       row.sectors?.color ?? '#6b7280',
      }));

    setBudget(prev => prev ? {
      ...prev,
      budget_items: prev.budget_items.map(i =>
        i.id === itemId ? { ...i, sectorStocks: stocks, loadingStock: false } : i
      ),
    } : prev);

    setExpandedStock(itemId);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getUnitLabel = (v: string | null | undefined) => {
    if (!v) return 'un';
    return unitOptions.find(o => o.value === v)?.label ?? v;
  };

  const getMainSupplier = (): string => {
    if (!budget) return 'Não especificado';
    const suppliers = budget.budget_items.map(i => i.supplier).filter(Boolean) as string[];
    if (!suppliers.length) return 'Não especificado';
    const counts: Record<string, number> = {};
    suppliers.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  };

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // ── Edição de quantidade ──────────────────────────────────────────────────
  const handleUpdateQty = (itemId: string, qty: number) => {
    if (qty < 0 || !budget) return;
    const items    = budget.budget_items.map(i => i.id === itemId ? { ...i, quantity: qty } : i);
    const newTotal = items.reduce((s, i) => s + i.quantity * (i.unit_price || 0), 0);
    setBudget({ ...budget, budget_items: items, total_value: newTotal });
  };

  // ── Remover item ──────────────────────────────────────────────────────────
  const handleRemoveItem = (itemId: string) => {
    if (!budget || !window.confirm('Remover este item?')) return;
    const items = budget.budget_items.filter(i => i.id !== itemId);
    if (!items.length) { addNotification('O orçamento não pode ficar vazio.', 'warning'); return; }
    const newTotal = items.reduce((s, i) => s + i.quantity * (i.unit_price || 0), 0);
    setBudget({ ...budget, budget_items: items, total_value: newTotal });
  };

  // ── Salvar ────────────────────────────────────────────────────────────────
  const handleSaveChanges = async (silent = false): Promise<boolean> => {
    if (!budget || !budgetId) return false;
    try {
      if (!silent) setSaving(true);
      const result = await updateBudgetItems(budgetId, budget.budget_items, budget.total_value);
      if (result.success) {
        if (!silent) addNotification('Alterações salvas!', 'success');
        return true;
      }
      throw new Error(result.error || 'Falha ao salvar');
    } catch (err) {
      addNotification(err instanceof Error ? err.message : 'Erro ao salvar', 'error');
      return false;
    } finally {
      if (!silent) setSaving(false);
    }
  };

  // ── Aprovar ───────────────────────────────────────────────────────────────
  const handleApproveBudget = async () => {
    if (!budget || !budgetId || !user?.email) { addNotification('Dados incompletos.', 'error'); return; }
    if (!window.confirm('Aprovar este orçamento?')) return;
    try {
      setSaving(true);
      const saved = await handleSaveChanges(true);
      if (!saved) return;
      const result = await updateBudgetStatus(budgetId, 'approved', user.email);
      if (result.success && result.data) {
        addNotification('Orçamento aprovado!', 'success');
        try {
          await createNotification({
            event_type: 'BUDGET_APPROVED',
            hotel_id:   result.data.hotel_id,
            title:      `Orçamento Aprovado — ${budget.hotel?.name || 'Hotel'}`,
            content:    `Orçamento de ${getMainSupplier()} (${fmt(budget.total_value)}) aprovado por ${user.email.split('@')[0]}`,
            link:       '/budget-history',
            metadata:   { budget_id: budgetId, total_value: budget.total_value, supplier: getMainSupplier(), approved_by: user.email },
          });
        } catch (e) { console.error(e); }
        navigate('/authorizations');
      } else throw new Error(result.error || 'Falha ao aprovar');
    } catch (err) {
      addNotification(err instanceof Error ? err.message : 'Erro ao aprovar', 'error');
    } finally { setSaving(false); }
  };

  // ── Cancelar ──────────────────────────────────────────────────────────────
  const handleCancelBudget = async () => {
    if (!budget || !budgetId) return;
    if (!window.confirm('Cancelar este orçamento?')) return;
    try {
      setSaving(true);
      const result = await updateBudgetStatus(budgetId, 'cancelled');
      if (result.success && result.data) {
        addNotification('Orçamento cancelado.', 'success');
        try {
          await createNotification({
            event_type: 'BUDGET_CANCELLED',
            hotel_id:   result.data.hotel_id,
            title:      `Orçamento Cancelado — ${budget.hotel?.name || 'Hotel'}`,
            content:    `Orçamento de ${getMainSupplier()} (${fmt(budget.total_value)}) cancelado`,
            link:       '/budget-history',
            metadata:   { budget_id: budgetId, total_value: budget.total_value, supplier: getMainSupplier() },
          });
        } catch (e) { console.error(e); }
        navigate('/authorizations');
      } else throw new Error(result.error || 'Falha ao cancelar');
    } catch (err) {
      addNotification(err instanceof Error ? err.message : 'Erro ao cancelar', 'error');
    } finally { setSaving(false); }
  };

  // ── Exportar ──────────────────────────────────────────────────────────────
  const exportBudgetToExcel = () => {
    if (!budget) return;
    const data = budget.budget_items.map(item => ({
      'Item':           item.custom_item_name || item.product?.name || 'Desconhecido',
      'Qtd':            item.quantity,
      'Unidade':        getUnitLabel(item.unit),
      'Fornecedor':     item.supplier || '-',
      'Valor Unitário': item.unit_price || 0,
      'Valor Total':    item.quantity * (item.unit_price || 0),
      'Estoque':        item.stock_at_creation ?? '-',
      'Últ. Compra':    item.last_purchase_date ? format(parseISO(item.last_purchase_date), 'dd/MM/yyyy') : '-',
      'Últ. Qtd':       item.last_purchase_quantity ?? '-',
      'Últ. Preço':     item.last_purchase_price ?? '-',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Itens');
    try {
      XLSX.writeFile(wb, `orcamento_${format(parseISO(budget.created_at), 'dd-MM-yyyy')}.xlsx`);
      addNotification('Exportado!', 'success');
    } catch { addNotification('Erro ao exportar.', 'error'); }
  };

  // ── Loading / Error ───────────────────────────────────────────────────────
  if (loading && !budget) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    </div>
  );

  if (error || !budget) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-8 max-w-md w-full text-center">
        <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400 mb-6">{error || 'Orçamento não encontrado.'}</p>
        <button onClick={() => navigate(-1)} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl flex items-center gap-2 mx-auto font-semibold">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>
      </div>
    </div>
  );

  const statusInfo = STATUS_MAP[budget.status || ''] ?? { label: budget.status || '—', classes: 'bg-gray-100 text-gray-600' };
  const isPending  = budget.status === 'pending';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-28">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-300" />
          </button>
          <div className="text-center">
            <h1 className="text-base font-bold text-gray-800 dark:text-white">Aprovação de Orçamento</h1>
            <p className="text-xs text-gray-400 uppercase tracking-wide">{budget.hotel?.name}</p>
          </div>
          <button onClick={exportBudgetToExcel} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Exportar para Excel">
            <Download className="h-5 w-5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>
      </div>

      <div className="container mx-auto max-w-3xl px-4 py-5 space-y-4">

        {/* ── Resumo do Orçamento ─────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <Truck className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-black text-gray-900 dark:text-white leading-tight">{getMainSupplier()}</h2>
                <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-500">
                  <Calendar className="h-3.5 w-3.5" />
                  {format(parseISO(budget.created_at), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 uppercase font-bold mb-0.5">Total</p>
              <p className="text-3xl font-black text-blue-600 dark:text-blue-400">{fmt(budget.total_value)}</p>
              <span className={`inline-block mt-1 text-xs font-semibold px-2.5 py-1 rounded-full ${statusInfo.classes}`}>
                {statusInfo.label}
              </span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Itens</p>
              <p className="font-bold text-gray-700 dark:text-gray-200">{budget.budget_items.length} produto(s)</p>
            </div>
            {budget.approved_by_user_email && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Aprovado por</p>
                <p className="font-bold text-gray-700 dark:text-gray-200 truncate">{budget.approved_by_user_email.split('@')[0]}</p>
              </div>
            )}
            {budget.approved_at && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Aprovado em</p>
                <p className="font-bold text-gray-700 dark:text-gray-200">
                  {format(parseISO(budget.approved_at), 'dd/MM/yyyy HH:mm')}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Lista de Itens ──────────────────────────────────────────────── */}
        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest px-1">
          Itens do Orçamento
        </h3>

        <div className="space-y-3">
          {budget.budget_items.map((item) => {
            const itemName  = item.custom_item_name || item.product?.name || 'Item Desconhecido';
            const itemTotal = item.quantity * (item.unit_price || 0);
            const stockQty  = item.stock_at_creation ?? 0;
            const isLowStock = stockQty <= 0;
            const isStockExpanded = expandedStock === item.id;

            return (
              <div key={item.id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">

                {/* ── Cabeçalho do Item ──────────────────────────────────── */}
                <div className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-base font-bold text-gray-900 dark:text-white leading-snug">{itemName}</h4>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mt-0.5">{item.product?.category || 'Geral'}</p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Input de quantidade */}
                    <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 rounded-xl">
                      <input
                        type="number"
                        value={item.quantity}
                        disabled={!isPending}
                        onChange={e => handleUpdateQty(item.id, parseFloat(e.target.value) || 0)}
                        className="w-14 bg-transparent text-sm font-black text-blue-700 dark:text-blue-300 outline-none text-center"
                        min="0"
                        step="any"
                      />
                      <span className="text-xs font-semibold text-blue-500">{getUnitLabel(item.unit)}</span>
                    </div>

                    {/* Remover item */}
                    {isPending && (
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-2 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="Remover item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Grid de Dados ─────────────────────────────────────── */}
                <div className="grid grid-cols-3 gap-0 border-t border-gray-100 dark:border-gray-700">

                  {/* Preço atual */}
                  <div className="p-4 border-r border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-1.5 mb-2">
                      <ShoppingBag className="h-3.5 w-3.5 text-blue-500" />
                      <span className="text-xs font-bold text-blue-500 uppercase tracking-wide">Atual</span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Unit: <span className="font-semibold text-gray-700 dark:text-gray-200">R${(item.unit_price || 0).toFixed(2)}</span>
                    </p>
                    <p className="text-base font-black text-blue-600 dark:text-blue-400 mt-0.5">{fmt(itemTotal)}</p>
                  </div>

                  {/* Última compra */}
                  <div className="p-4 border-r border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-1.5 mb-2">
                      <History className="h-3.5 w-3.5 text-purple-500" />
                      <span className="text-xs font-bold text-purple-500 uppercase tracking-wide">Última</span>
                    </div>
                    {item.last_purchase_date ? (
                      <>
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                          {item.last_purchase_quantity}{getUnitLabel(item.unit)} @ R${(item.last_purchase_price || 0).toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {format(parseISO(item.last_purchase_date), 'dd/MM/yy')}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-400 italic">Sem histórico</p>
                    )}
                  </div>

                  {/* Stock inventário + botão setores */}
                  <div className="p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Database className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-xs font-bold text-amber-500 uppercase tracking-wide">Stock</span>
                    </div>
                    <p className={`text-xl font-black ${isLowStock ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>
                      {stockQty}
                      <span className="text-xs font-normal text-gray-400 ml-1">{getUnitLabel(item.unit)}</span>
                    </p>

                    {/* Botão expandir stock por setor */}
                    {item.product_id && (
                      <button
                        onClick={() => loadSectorStock(item.id, item.product_id)}
                        className="flex items-center gap-1 mt-1.5 text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 font-semibold transition-colors"
                      >
                        <Layers className="h-3 w-3" />
                        Setores
                        {item.loadingStock
                          ? <span className="ml-1 w-3 h-3 rounded-full border border-indigo-400 border-t-transparent animate-spin inline-block" />
                          : isStockExpanded
                            ? <ChevronUp className="h-3 w-3" />
                            : <ChevronDown className="h-3 w-3" />
                        }
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Stock por Setor (expansível) ──────────────────────── */}
                {isStockExpanded && item.sectorStocks !== undefined && (
                  <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 px-4 py-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                      Stock atual por setor
                    </p>
                    {item.sectorStocks.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Nenhum setor com este produto em stock.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {item.sectorStocks.map(ss => (
                          <div
                            key={ss.sector_name}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                          >
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: ss.color || '#6b7280' }}
                            />
                            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{ss.sector_name}</span>
                            <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 ml-1">{ss.quantity}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>
            );
          })}
        </div>
      </div>

      {/* ── Footer Fixo ────────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-2xl z-20">
        <div className="container mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-gray-400 font-bold uppercase">Total Geral</p>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400 leading-none">{fmt(budget.total_value)}</p>
          </div>

          <div className="flex items-center gap-2">
            {isPending ? (
              <>
                {/* Cancelar */}
                <button
                  onClick={handleCancelBudget}
                  disabled={saving}
                  className="p-2.5 rounded-xl text-red-500 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  title="Cancelar orçamento"
                >
                  <XCircle className="h-5 w-5" />
                </button>
                {/* Salvar */}
                <button
                  onClick={() => handleSaveChanges()}
                  disabled={saving}
                  className="p-2.5 rounded-xl text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                  title="Salvar alterações"
                >
                  {saving ? <span className="w-5 h-5 rounded-full border-2 border-gray-400 border-t-transparent animate-spin inline-block" /> : <Save className="h-5 w-5" />}
                </button>
                {/* Aprovar */}
                <button
                  onClick={handleApproveBudget}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm shadow-md hover:bg-green-700 disabled:opacity-50 transition-all active:scale-95"
                >
                  <CheckCircle className="h-5 w-5" />
                  APROVAR
                </button>
              </>
            ) : (
              <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Voltar
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default BudgetDetail;