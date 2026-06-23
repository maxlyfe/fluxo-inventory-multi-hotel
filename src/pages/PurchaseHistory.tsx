// src/pages/PurchaseHistory.tsx
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import {
  Search, ChevronDown, ChevronUp, Edit2, Check, X,
  History, Trash2, AlertTriangle, Loader2, Calendar,
  Receipt, FileText, BookOpen, ChevronRight,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PurchaseItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  products: { id: string; name: string } | null;
}

interface ChartAccountSubSummary {
  id: string;
  name: string;
  chart_of_accounts: { id: string; name: string } | null;
}

interface Purchase {
  id: string;
  purchase_date: string;
  invoice_number: string | null;
  supplier: string | null;
  total_amount: number;
  notes: string | null;
  document_type: string | null;
  emission_date: string | null;
  due_date: string | null;
  chart_account_sub_id: string | null;
  chart_of_accounts_sub: ChartAccountSubSummary | null;
  created_at: string;
  purchase_items: PurchaseItem[];
}

interface ChartAccountSub {
  id: string;
  account_id: string;
  name: string;
}

interface ChartAccount {
  id: string;
  name: string;
  sort_order: number;
  subs: ChartAccountSub[];
}

interface EditingState {
  purchaseId: string;
  purchase_date: string;
  notes: string;
  supplier: string;
  invoice_number: string;
  document_type: string;
  emission_date: string;
  due_date: string;
  chart_account_sub_id: string;
  items: Record<string, { quantity: string; unit_price: string }>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_DOC_TYPES = [
  'Boleto', 'Cartão de Crédito', 'Nota de Crédito', 'Recibo', 'Nota Fiscal',
];

const fieldCls =
  'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 ' +
  'bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors';

// ── Component ──────────────────────────────────────────────────────────────────

export default function PurchaseHistory() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const { user } = useAuth();

  const [purchases,      setPurchases]      = useState<Purchase[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [search,         setSearch]         = useState('');
  const [expandedId,     setExpandedId]     = useState<string | null>(null);
  const [editing,        setEditing]        = useState<EditingState | null>(null);
  const [saving,         setSaving]         = useState(false);
  const [deleteConfirm,  setDeleteConfirm]  = useState<Purchase | null>(null);
  const [deleting,       setDeleting]       = useState(false);
  const [chartAccounts,  setChartAccounts]  = useState<ChartAccount[]>([]);
  const [customDocTypes, setCustomDocTypes] = useState<string[]>([]);

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadPurchases = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('purchases')
        .select(`
          id, purchase_date, invoice_number, supplier, total_amount, notes, created_at,
          document_type, emission_date, due_date, chart_account_sub_id,
          chart_of_accounts_sub:chart_account_sub_id (
            id, name,
            chart_of_accounts:account_id ( id, name )
          ),
          purchase_items ( id, product_id, quantity, unit_price, total_price, products:products(id, name) )
        `)
        .eq('hotel_id', selectedHotel.id)
        .order('purchase_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      setPurchases((data as any) || []);
    } catch (err: any) {
      addNotification('Erro ao carregar compras: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel?.id, addNotification]);

  const loadChartAccounts = useCallback(async () => {
    if (!selectedHotel?.id) return;
    const [{ data: accounts }, { data: subs }] = await Promise.all([
      supabase.from('chart_of_accounts').select('id, name, sort_order, hotel_id')
        .or(`hotel_id.is.null,hotel_id.eq.${selectedHotel.id}`).order('sort_order'),
      supabase.from('chart_of_accounts_sub').select('id, account_id, name, hotel_id')
        .or(`hotel_id.is.null,hotel_id.eq.${selectedHotel.id}`).order('sort_order'),
    ]);
    if (accounts) {
      setChartAccounts(
        accounts.map(acc => ({
          ...acc,
          subs: (subs || []).filter(s => s.account_id === acc.id),
        }))
      );
    }
  }, [selectedHotel?.id]);

  const loadCustomDocTypes = useCallback(async () => {
    if (!selectedHotel?.id) return;
    const { data } = await supabase
      .from('purchase_document_types')
      .select('name').eq('hotel_id', selectedHotel.id).order('created_at');
    setCustomDocTypes((data || []).map((d: any) => d.name));
  }, [selectedHotel?.id]);

  useEffect(() => {
    loadPurchases();
    loadChartAccounts();
    loadCustomDocTypes();
  }, [loadPurchases, loadChartAccounts, loadCustomDocTypes]);

  // ── Computed ──────────────────────────────────────────────────────────────────

  const allDocTypes = [...DEFAULT_DOC_TYPES, ...customDocTypes];

  const filtered = search.trim()
    ? purchases.filter(p =>
        p.supplier?.toLowerCase().includes(search.toLowerCase()) ||
        p.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
        p.document_type?.toLowerCase().includes(search.toLowerCase()) ||
        p.purchase_items.some(i => i.products?.name.toLowerCase().includes(search.toLowerCase()))
      )
    : purchases;

  // ── Edit handlers ─────────────────────────────────────────────────────────────

  function startEdit(p: Purchase) {
    const items: Record<string, { quantity: string; unit_price: string }> = {};
    p.purchase_items.forEach(i => {
      items[i.id] = { quantity: i.quantity.toString(), unit_price: i.unit_price.toString() };
    });
    setEditing({
      purchaseId:          p.id,
      purchase_date:       p.purchase_date,
      notes:               p.notes || '',
      supplier:            p.supplier || '',
      invoice_number:      p.invoice_number || '',
      document_type:       p.document_type || '',
      emission_date:       p.emission_date || '',
      due_date:            p.due_date || '',
      chart_account_sub_id: p.chart_account_sub_id || '',
      items,
    });
    setExpandedId(p.id);
  }

  async function handleSave() {
    if (!editing || !user) return;
    setSaving(true);
    try {
      const purchase = purchases.find(p => p.id === editing.purchaseId);
      if (!purchase) return;

      // Build update payload with changed header fields
      const headerUpdate: Record<string, any> = {};
      const logEntries: Array<{ field_changed: string; old_value: string; new_value: string }> = [];

      const headerFields: Array<{ key: keyof EditingState; col: string }> = [
        { key: 'purchase_date',       col: 'purchase_date' },
        { key: 'notes',               col: 'notes' },
        { key: 'supplier',            col: 'supplier' },
        { key: 'invoice_number',      col: 'invoice_number' },
        { key: 'document_type',       col: 'document_type' },
        { key: 'emission_date',       col: 'emission_date' },
        { key: 'due_date',            col: 'due_date' },
        { key: 'chart_account_sub_id', col: 'chart_account_sub_id' },
      ];

      for (const { key, col } of headerFields) {
        const oldVal = String((purchase as any)[col] ?? '');
        const newVal = String((editing as any)[key] ?? '');
        if (oldVal !== newVal) {
          headerUpdate[col] = (editing as any)[key] || null;
          logEntries.push({ field_changed: col, old_value: oldVal, new_value: newVal });
        }
      }

      if (Object.keys(headerUpdate).length > 0) {
        await supabase.from('purchases').update(headerUpdate).eq('id', editing.purchaseId);
        for (const log of logEntries) {
          await supabase.from('purchase_edit_logs').insert({
            purchase_id: editing.purchaseId, ...log, changed_by: user.id,
          });
        }
      }

      // Update items
      for (const item of purchase.purchase_items) {
        const editedItem = editing.items[item.id];
        if (!editedItem) continue;
        const newQty   = parseFloat(editedItem.quantity.replace(',', '.'))   || item.quantity;
        const newPrice = parseFloat(editedItem.unit_price.replace(',', '.')) || item.unit_price;
        const newTotal = newQty * newPrice;
        if (newQty !== item.quantity || newPrice !== item.unit_price) {
          if (newQty !== item.quantity) {
            await supabase.from('purchase_edit_logs').insert({ purchase_id: editing.purchaseId, purchase_item_id: item.id, field_changed: 'quantity', old_value: item.quantity.toString(), new_value: newQty.toString(), changed_by: user.id });
          }
          if (newPrice !== item.unit_price) {
            await supabase.from('purchase_edit_logs').insert({ purchase_id: editing.purchaseId, purchase_item_id: item.id, field_changed: 'unit_price', old_value: item.unit_price.toString(), new_value: newPrice.toString(), changed_by: user.id });
          }
          await supabase.from('purchase_items').update({ quantity: newQty, unit_price: newPrice, total_price: newTotal }).eq('id', item.id);
        }
      }

      await supabase.rpc('recalculate_purchase_impact', { p_purchase_id: editing.purchaseId });
      addNotification('Compra atualizada com sucesso!', 'success');
      setEditing(null);
      loadPurchases();
    } catch (err: any) {
      addNotification('Erro ao salvar: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(purchase: Purchase) {
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_purchase_with_reversal', { p_purchase_id: purchase.id });
      if (error) throw error;
      addNotification(`Compra de "${purchase.supplier || 'S/N'}" excluída e estoque estornado.`, 'success');
      setDeleteConfirm(null);
      loadPurchases();
    } catch (err: any) {
      addNotification('Erro ao excluir compra: ' + err.message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function docTypeBadgeColor(type: string | null): string {
    if (!type) return 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
    if (type === 'Cartão de Crédito') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    if (type === 'Nota Fiscal')       return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
    if (type === 'Boleto')            return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300';
    if (type === 'Recibo')            return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
    return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400';
  }

  function formatDate(d: string | null): string {
    if (!d) return '—';
    try { return format(parseISO(d), 'dd/MM/yyyy'); } catch { return d; }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!selectedHotel) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-slate-500 dark:text-slate-400">Selecione um hotel.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
            <History className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white leading-tight">Histórico de Compras</h1>
            {!loading && <p className="text-xs text-slate-400">{filtered.length} compra{filtered.length !== 1 ? 's' : ''}</p>}
          </div>
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="Buscar por fornecedor, NF, tipo ou produto…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 transition-colors" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-3">
            <History className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {search ? 'Nenhuma compra encontrada' : 'Nenhuma compra registrada'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {search ? 'Tente ajustar a busca.' : 'Registre a primeira compra em Nova Compra.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => {
            const isExpanded = expandedId === p.id;
            const isEditing  = editing?.purchaseId === p.id;
            const chartAcc   = p.chart_of_accounts_sub?.chart_of_accounts?.name;
            const chartSub   = p.chart_of_accounts_sub?.name;

            return (
              <div key={p.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden transition-all ${isEditing ? 'border-blue-400 dark:border-blue-500 shadow-md' : 'border-slate-200 dark:border-slate-700 shadow-sm'}`}>

                {/* Row header */}
                <div className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    {isExpanded
                      ? <ChevronUp size={16} className="text-slate-400 shrink-0" />
                      : <ChevronDown size={16} className="text-slate-400 shrink-0" />
                    }
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">{p.supplier || 'Sem fornecedor'}</p>
                        {p.invoice_number && (
                          <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                            NF: {p.invoice_number}
                          </span>
                        )}
                        {p.document_type && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${docTypeBadgeColor(p.document_type)}`}>
                            {p.document_type}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(p.purchase_date)} · {p.purchase_items.length} ite{p.purchase_items.length !== 1 ? 'ns' : 'm'}
                        {p.due_date && (
                          <span className={`ml-2 ${new Date(p.due_date) < new Date() ? 'text-red-400' : 'text-slate-400'}`}>
                            · Vence {formatDate(p.due_date)}
                          </span>
                        )}
                        {chartSub && (
                          <span className="ml-2 text-purple-400">· {chartSub}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-xl">
                      R$ {Number(p.total_amount).toFixed(2)}
                    </span>
                    {!isEditing && (
                      <>
                        <button onClick={() => startEdit(p)}
                          className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-colors" title="Editar compra">
                          <Edit2 size={15} />
                        </button>
                        <button onClick={() => setDeleteConfirm(p)}
                          className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors" title="Excluir compra">
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Expanded */}
                {isExpanded && (
                  <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 space-y-4">

                    {/* Edit form */}
                    {isEditing ? (
                      <div className="space-y-3">
                        {/* Row 1: Fornecedor + Tipo de Documento */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Fornecedor</label>
                            <input type="text" value={editing!.supplier}
                              onChange={e => setEditing({ ...editing!, supplier: e.target.value })}
                              className={fieldCls} />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Tipo de Documento</label>
                            <div className="relative">
                              <select value={editing!.document_type}
                                onChange={e => setEditing({ ...editing!, document_type: e.target.value })}
                                className={fieldCls + ' appearance-none pr-8'}>
                                <option value="">Selecionar…</option>
                                {allDocTypes.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                            </div>
                          </div>
                        </div>
                        {/* Row 2: NF + Data Compra + Emissão */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Nº Nota Fiscal</label>
                            <input type="text" value={editing!.invoice_number}
                              onChange={e => setEditing({ ...editing!, invoice_number: e.target.value })}
                              className={fieldCls} />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Data da Compra</label>
                            <input type="date" value={editing!.purchase_date}
                              onChange={e => setEditing({ ...editing!, purchase_date: e.target.value })}
                              className={fieldCls + ' dark:[color-scheme:dark]'} />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Data Emissão NF</label>
                            <input type="date" value={editing!.emission_date}
                              onChange={e => setEditing({ ...editing!, emission_date: e.target.value })}
                              className={fieldCls + ' dark:[color-scheme:dark]'} />
                          </div>
                        </div>
                        {/* Row 3: Vencimento + Chart + Notas */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Data de Vencimento</label>
                            <input type="date" value={editing!.due_date}
                              onChange={e => setEditing({ ...editing!, due_date: e.target.value })}
                              className={fieldCls + ' dark:[color-scheme:dark]'} />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Plano de Contas</label>
                            <div className="relative">
                              <select value={editing!.chart_account_sub_id}
                                onChange={e => setEditing({ ...editing!, chart_account_sub_id: e.target.value })}
                                className={fieldCls + ' appearance-none pr-8'}>
                                <option value="">Não classificado</option>
                                {chartAccounts.map(acc => (
                                  <optgroup key={acc.id} label={acc.name}>
                                    {acc.subs.map(sub => (
                                      <option key={sub.id} value={sub.id}>{sub.name}</option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Observações</label>
                          <input type="text" value={editing!.notes}
                            onChange={e => setEditing({ ...editing!, notes: e.target.value })}
                            className={fieldCls} />
                        </div>
                      </div>
                    ) : (
                      /* Read-only details row */
                      <div className="flex flex-wrap gap-x-6 gap-y-2">
                        {p.document_type && (
                          <div className="flex items-center gap-1.5">
                            <Receipt className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-xs text-slate-600 dark:text-slate-300">{p.document_type}</span>
                          </div>
                        )}
                        {p.emission_date && (
                          <div className="flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-xs text-slate-600 dark:text-slate-300">
                              Emissão: {formatDate(p.emission_date)}
                            </span>
                          </div>
                        )}
                        {p.due_date && (
                          <div className={`flex items-center gap-1.5 ${new Date(p.due_date) < new Date() ? 'text-red-500' : ''}`}>
                            <Calendar className="w-3.5 h-3.5 text-current opacity-70" />
                            <span className="text-xs font-medium">
                              Vencimento: {formatDate(p.due_date)}
                            </span>
                          </div>
                        )}
                        {chartAcc && chartSub && (
                          <div className="flex items-center gap-1">
                            <BookOpen className="w-3.5 h-3.5 text-purple-400" />
                            <span className="text-xs text-slate-400">{chartAcc}</span>
                            <ChevronRight className="w-3 h-3 text-slate-300" />
                            <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">{chartSub}</span>
                          </div>
                        )}
                        {p.notes && (
                          <p className="w-full text-xs text-slate-500 dark:text-slate-400 italic">{p.notes}</p>
                        )}
                      </div>
                    )}

                    {/* Items table */}
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-800/60 text-left">
                            <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Produto</th>
                            <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide text-right">Qtd</th>
                            <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide text-right">Preço Unit.</th>
                            <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                          {p.purchase_items.map(item => (
                            <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                              <td className="px-4 py-2.5 text-slate-900 dark:text-slate-100">{item.products?.name || 'Produto removido'}</td>
                              <td className="px-4 py-2.5 text-right">
                                {isEditing ? (
                                  <input type="text" inputMode="decimal"
                                    value={editing!.items[item.id]?.quantity || ''}
                                    onChange={e => setEditing({ ...editing!, items: { ...editing!.items, [item.id]: { ...editing!.items[item.id], quantity: e.target.value } } })}
                                    className="w-20 px-2 py-1.5 text-right rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                                ) : (
                                  <span className="text-slate-600 dark:text-slate-400 font-mono">{item.quantity}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                {isEditing ? (
                                  <input type="text" inputMode="decimal"
                                    value={editing!.items[item.id]?.unit_price || ''}
                                    onChange={e => setEditing({ ...editing!, items: { ...editing!.items, [item.id]: { ...editing!.items[item.id], unit_price: e.target.value } } })}
                                    className="w-24 px-2 py-1.5 text-right rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                                ) : (
                                  <span className="text-slate-600 dark:text-slate-400 font-mono">R$ {Number(item.unit_price).toFixed(2)}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-semibold text-slate-900 dark:text-slate-100 font-mono">
                                R$ {isEditing
                                  ? ((parseFloat((editing!.items[item.id]?.quantity || '0').replace(',', '.')) || 0) *
                                     (parseFloat((editing!.items[item.id]?.unit_price || '0').replace(',', '.')) || 0)).toFixed(2)
                                  : Number(item.total_price).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {isEditing && (
                      <div className="flex gap-2">
                        <button onClick={handleSave} disabled={saving}
                          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
                          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                          {saving ? 'Salvando...' : 'Salvar'}
                        </button>
                        <button onClick={() => setEditing(null)}
                          className="flex items-center gap-2 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                          <X size={15} /> Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md p-6">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Excluir compra?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Esta ação é irreversível. A compra de{' '}
                  <strong className="text-slate-700 dark:text-slate-300">{deleteConfirm.supplier || 'fornecedor'}</strong>
                  {deleteConfirm.invoice_number && <> (NF: {deleteConfirm.invoice_number})</>}{' '}
                  será excluída e o estoque dos {deleteConfirm.purchase_items.length} produto(s) será estornado.
                </p>
              </div>
            </div>
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40 rounded-xl p-3 mb-5 max-h-40 overflow-y-auto">
              <p className="text-[10px] uppercase font-semibold text-red-500 mb-2 tracking-wide">Produtos com estoque estornado</p>
              <ul className="space-y-1">
                {deleteConfirm.purchase_items.map(item => (
                  <li key={item.id} className="flex justify-between text-xs text-slate-700 dark:text-slate-300">
                    <span>{item.products?.name || 'Produto removido'}</span>
                    <span className="font-mono text-red-600 dark:text-red-400">−{item.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} disabled={deleting}
                className="px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={() => handleDelete(deleteConfirm)} disabled={deleting}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition disabled:opacity-50">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Excluindo...' : 'Excluir e estornar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
