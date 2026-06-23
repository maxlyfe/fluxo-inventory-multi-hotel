// src/pages/NewPurchase.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft, Search, Plus, Trash2, DollarSign, Package,
  AlertTriangle, X, FileText, Building2, Calendar,
  StickyNote, ChevronDown, ChevronRight, Loader2, ShoppingCart,
  Info, Minus, BookOpen, Receipt, Settings, Edit2, Check, Layers,
} from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import { useHotel } from '../context/HotelContext';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  category: string;
}

interface PurchaseItem {
  product_id?: string;
  product?: Product;
  isNew: boolean;
  newProduct?: {
    name: string; category: string; description?: string;
    supplier?: string; image_url?: string;
  };
  quantity: number;
  unit_price: number;
  total_price: number;
  quantity_display?: string;
  unit_price_display?: string;
}

interface Budget {
  id: string;
  status: 'pending' | 'approved' | 'delivered' | 'canceled';
  budget_items?: Array<{
    product_id?: string; custom_item_name?: string; supplier?: string;
    unit_price?: number; quantity?: number;
    product?: { name?: string; category?: string; description?: string; image_url?: string; };
  }>;
  hotel_id?: string;
  purchase_id?: string | null;
}

interface ChartAccountSub {
  id: string;
  account_id: string;
  name: string;
  description?: string;
  hotel_id: string | null;
  sort_order: number;
}

interface ChartAccount {
  id: string;
  name: string;
  sort_order: number;
  hotel_id: string | null;
  subs: ChartAccountSub[];
}

interface CustomDocType {
  id: string;
  name: string;
  hotel_id: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_DOC_TYPES = [
  'Boleto',
  'Cartão de Crédito',
  'Nota de Crédito',
  'Recibo',
  'Nota Fiscal',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function formatDateBR(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function suggestDueDate(purchaseDate: string): string {
  if (!purchaseDate) return '';
  const d = new Date(purchaseDate + 'T12:00:00');
  const day = d.getDate();
  let dueYear = d.getFullYear();
  let dueMonth = d.getMonth(); // 0-indexed
  dueMonth += day < 20 ? 1 : 2;
  if (dueMonth > 11) { dueYear += Math.floor(dueMonth / 12); dueMonth = dueMonth % 12; }
  return `${dueYear}-${String(dueMonth + 1).padStart(2, '0')}-01`;
}

const fieldCls =
  'w-full rounded-xl border border-slate-200 dark:border-slate-600 ' +
  'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white ' +
  'placeholder-slate-400 text-sm px-3 py-2.5 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 ' +
  'transition-colors';

// ── Section ────────────────────────────────────────────────────────────────────

const Section: React.FC<{
  icon: React.ReactNode; title: string; children: React.ReactNode;
  accent?: string; action?: React.ReactNode;
}> = ({ icon, title, children, accent = 'blue', action }) => {
  const ic: Record<string, string> = {
    blue: 'text-blue-500', emerald: 'text-emerald-500', amber: 'text-amber-500',
    slate: 'text-slate-400', orange: 'text-orange-500', purple: 'text-purple-500',
  };
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <span className={ic[accent] ?? ic.blue}>{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
};

// ── ChartManagerModal ──────────────────────────────────────────────────────────

interface ChartManagerProps {
  onClose: () => void;
  accounts: ChartAccount[];
  hotelId: string;
  onRefresh: () => void;
}

const ChartManagerModal: React.FC<ChartManagerProps> = ({ onClose, accounts, hotelId, onRefresh }) => {
  const { addNotification } = useNotification();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [showNewAcc, setShowNewAcc] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [saving, setSaving] = useState(false);

  async function addAccount() {
    if (!newAccName.trim()) return;
    setSaving(true);
    const maxOrder = accounts.reduce((m, a) => Math.max(m, a.sort_order), 0);
    const { error } = await supabase.from('chart_of_accounts').insert({
      name: newAccName.trim(), hotel_id: hotelId, sort_order: maxOrder + 1,
    });
    setSaving(false);
    if (error) { addNotification('Erro: ' + error.message, 'error'); return; }
    addNotification('Plano adicionado!', 'success');
    setNewAccName(''); setShowNewAcc(false); onRefresh();
  }

  async function addSub(accountId: string) {
    if (!newSubName.trim()) return;
    setSaving(true);
    const acc = accounts.find(a => a.id === accountId);
    const maxOrder = (acc?.subs || []).reduce((m, s) => Math.max(m, s.sort_order), 0);
    const { error } = await supabase.from('chart_of_accounts_sub').insert({
      account_id: accountId, name: newSubName.trim(), hotel_id: hotelId, sort_order: maxOrder + 1,
    });
    setSaving(false);
    if (error) { addNotification('Erro: ' + error.message, 'error'); return; }
    addNotification('Subconta adicionada!', 'success');
    setNewSubName(''); setAddingSubFor(null); onRefresh();
  }

  async function saveEdit(table: 'chart_of_accounts' | 'chart_of_accounts_sub', id: string) {
    if (!editingName.trim()) return;
    setSaving(true);
    const { error } = await supabase.from(table).update({ name: editingName.trim() }).eq('id', id);
    setSaving(false);
    if (error) { addNotification('Erro: ' + error.message, 'error'); return; }
    addNotification('Atualizado!', 'success'); setEditingId(null); onRefresh();
  }

  async function deleteItem(table: 'chart_of_accounts' | 'chart_of_accounts_sub', id: string, name: string) {
    if (!confirm(`Excluir "${name}"? Esta ação é irreversível.`)) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) { addNotification('Erro: ' + error.message, 'error'); return; }
    addNotification('Excluído!', 'success'); onRefresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 py-8 overflow-y-auto">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-purple-500" />
            <h2 className="text-base font-bold text-slate-800 dark:text-white">Gerenciar Plano de Contas</h2>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 max-h-[65vh] overflow-y-auto space-y-2">
          {accounts.map(acc => (
            <div key={acc.id} className="bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              {/* Account row */}
              <div className="flex items-center gap-1 px-3 py-2.5">
                <button type="button" onClick={() => setExpandedId(expandedId === acc.id ? null : acc.id)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
                  <ChevronRight className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${expandedId === acc.id ? 'rotate-90' : ''}`} />
                  {editingId === acc.id ? (
                    <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit('chart_of_accounts', acc.id); if (e.key === 'Escape') setEditingId(null); }}
                      className="flex-1 text-sm font-semibold px-2 py-0.5 rounded-lg border border-blue-400 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none"
                      onClick={e => e.stopPropagation()} />
                  ) : (
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{acc.name}</span>
                  )}
                  {acc.hotel_id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 shrink-0">personalizado</span>
                  )}
                </button>
                <div className="flex items-center gap-0.5 shrink-0">
                  {editingId === acc.id ? (
                    <>
                      <button type="button" onClick={() => saveEdit('chart_of_accounts', acc.id)} disabled={saving}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => setEditingId(null)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" title="Adicionar subconta"
                        onClick={() => { setExpandedId(acc.id); setAddingSubFor(acc.id); setNewSubName(''); }}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" title="Editar"
                        onClick={() => { setEditingId(acc.id); setEditingName(acc.name); }}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {acc.hotel_id && (
                        <button type="button" title="Excluir"
                          onClick={() => deleteItem('chart_of_accounts', acc.id, acc.name)}
                          className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Subaccounts */}
              {expandedId === acc.id && (
                <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                  {(acc.subs || []).map(sub => (
                    <div key={sub.id}
                      className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-700/40 last:border-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0 ml-1" />
                      {editingId === sub.id ? (
                        <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit('chart_of_accounts_sub', sub.id); if (e.key === 'Escape') setEditingId(null); }}
                          className="flex-1 text-sm px-2 py-0.5 rounded-lg border border-blue-400 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none" />
                      ) : (
                        <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">{sub.name}</span>
                      )}
                      {sub.hotel_id && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 shrink-0">custom</span>
                      )}
                      <div className="flex items-center gap-0.5 shrink-0">
                        {editingId === sub.id ? (
                          <>
                            <button type="button" onClick={() => saveEdit('chart_of_accounts_sub', sub.id)} disabled={saving}
                              className="w-5 h-5 flex items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                              <Check className="w-3 h-3" />
                            </button>
                            <button type="button" onClick={() => setEditingId(null)}
                              className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                              <X className="w-3 h-3" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => { setEditingId(sub.id); setEditingName(sub.name); }}
                              className="w-5 h-5 flex items-center justify-center rounded text-slate-300 dark:text-slate-600 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button type="button" onClick={() => deleteItem('chart_of_accounts_sub', sub.id, sub.name)}
                              className="w-5 h-5 flex items-center justify-center rounded text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Add sub */}
                  {addingSubFor === acc.id ? (
                    <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-100 dark:border-slate-700/40">
                      <input autoFocus value={newSubName} onChange={e => setNewSubName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addSub(acc.id); if (e.key === 'Escape') setAddingSubFor(null); }}
                        placeholder="Nome da nova subconta..."
                        className="flex-1 text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:border-blue-400" />
                      <button type="button" onClick={() => addSub(acc.id)} disabled={!newSubName.trim() || saving}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors">
                        {saving ? '…' : 'Adicionar'}
                      </button>
                      <button type="button" onClick={() => setAddingSubFor(null)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setAddingSubFor(acc.id); setNewSubName(''); }}
                      className="w-full flex items-center gap-1.5 px-5 py-2 text-xs text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors">
                      <Plus className="w-3 h-3" /> Adicionar subconta
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Add new main account */}
          {showNewAcc ? (
            <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800 rounded-xl">
              <input autoFocus value={newAccName} onChange={e => setNewAccName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addAccount(); if (e.key === 'Escape') setShowNewAcc(false); }}
                placeholder="Nome do novo plano de contas..."
                className="flex-1 text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:border-purple-400" />
              <button type="button" onClick={addAccount} disabled={!newAccName.trim() || saving}
                className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors">
                {saving ? '…' : 'Criar'}
              </button>
              <button type="button" onClick={() => setShowNewAcc(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowNewAcc(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 text-sm font-semibold hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors">
              <Plus className="w-4 h-4" /> Novo Plano de Contas
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── NewPurchase ────────────────────────────────────────────────────────────────

const NewPurchase = () => {
  const location   = useLocation();
  const navigate   = useNavigate();
  const { selectedHotel }   = useHotel();
  const { addNotification } = useNotification();

  const budgetDataFromState: Budget | undefined = location.state?.budgetData;
  const budgetIdToUpdate = budgetDataFromState?.id;

  // ── Products
  const [products,         setProducts]         = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchTerm,       setSearchTerm]       = useState('');
  const [searchOpen,       setSearchOpen]       = useState(false);
  const [loading,          setLoading]          = useState(true);
  const [submitLoading,    setSubmitLoading]    = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [items,            setItems]            = useState<PurchaseItem[]>([]);
  const [showNewForm,      setShowNewForm]      = useState(false);
  const [imgErrors,        setImgErrors]        = useState<Record<string, boolean>>({});
  const [budgetProcessed,  setBudgetProcessed]  = useState(false);

  const [newProduct, setNewProduct] = useState({
    name: '', category: '', description: '', supplier: '', image_url: '',
  });

  // ── Chart of accounts
  const [chartAccounts,    setChartAccounts]    = useState<ChartAccount[]>([]);
  const [chartSearch,      setChartSearch]      = useState('');
  const [chartExpanded,    setChartExpanded]    = useState<string | null>(null);
  const [showChartManager, setShowChartManager] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  // ── Document types
  const [customDocTypes,  setCustomDocTypes]  = useState<CustomDocType[]>([]);
  const [addingDocType,   setAddingDocType]   = useState(false);
  const [newDocTypeName,  setNewDocTypeName]  = useState('');

  // ── Purchase form data
  const [purchaseData, setPurchaseData] = useState({
    invoice_number: '',
    supplier: '',
    purchase_date: new Date().toISOString().split('T')[0],
    notes: '',
    document_type: '',
    emission_date: '',
    due_date: '',
    chart_account_sub_id: '',
  });

  // ── Loaders ─────────────────────────────────────────────────────────────────

  const loadChartAccounts = useCallback(async () => {
    if (!selectedHotel?.id) return;
    const [{ data: accounts }, { data: subs }] = await Promise.all([
      supabase
        .from('chart_of_accounts')
        .select('id, name, sort_order, hotel_id')
        .or(`hotel_id.is.null,hotel_id.eq.${selectedHotel.id}`)
        .order('sort_order'),
      supabase
        .from('chart_of_accounts_sub')
        .select('id, account_id, name, description, hotel_id, sort_order')
        .or(`hotel_id.is.null,hotel_id.eq.${selectedHotel.id}`)
        .order('sort_order'),
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

  const loadDocTypes = useCallback(async () => {
    if (!selectedHotel?.id) return;
    const { data } = await supabase
      .from('purchase_document_types')
      .select('id, name, hotel_id')
      .eq('hotel_id', selectedHotel.id)
      .order('created_at');
    setCustomDocTypes(data || []);
  }, [selectedHotel?.id]);

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (location.state?.budgetData) {
      setBudgetProcessed(false);
      setItems([]);
      setPurchaseData(p => ({ ...p, supplier: '' }));
    }
  }, [location.state?.budgetData]);

  useEffect(() => {
    const fetchProducts = async () => {
      if (!selectedHotel?.id) { setProducts([]); setFilteredProducts([]); setLoading(false); return; }
      setLoading(true);
      const { data, error: fe } = await supabase
        .from('products').select('*').eq('hotel_id', selectedHotel.id).order('name');
      if (fe) addNotification('Erro ao carregar produtos: ' + fe.message, 'error');
      else { setProducts(data || []); setFilteredProducts(data || []); }
      setLoading(false);
    };
    fetchProducts();
  }, [selectedHotel, addNotification]);

  useEffect(() => {
    loadChartAccounts();
    loadDocTypes();
  }, [loadChartAccounts, loadDocTypes]);

  // Pre-fill from budget
  useEffect(() => {
    if (!budgetDataFromState || !products.length || budgetProcessed) return;
    const mainSupplier = budgetDataFromState.budget_items?.find(i => i.supplier)?.supplier || '';
    setPurchaseData(p => ({ ...p, supplier: mainSupplier || p.supplier }));
    const preItems = budgetDataFromState.budget_items?.map(bi => {
      const qty = bi.quantity ?? 1, price = bi.unit_price ?? 0;
      const prod = products.find(p => p.id === bi.product_id);
      if (bi.product_id && prod) return { product_id: bi.product_id, product: prod, isNew: false, quantity: qty, unit_price: price, total_price: qty * price };
      if (bi.custom_item_name) return { isNew: true, newProduct: { name: bi.custom_item_name, category: 'Diversos', description: '', supplier: bi.supplier || mainSupplier, image_url: '' }, quantity: qty, unit_price: price, total_price: qty * price };
      if (bi.product_id && !prod) return { isNew: true, newProduct: { name: bi.product?.name || `Produto ID ${bi.product_id}`, category: bi.product?.category || 'Diversos', description: bi.product?.description || '', supplier: bi.supplier || mainSupplier, image_url: bi.product?.image_url || '' }, quantity: qty, unit_price: price, total_price: qty * price };
      return null;
    }).filter((i): i is PurchaseItem => i !== null);
    if (preItems?.length) { setItems(preItems); addNotification('Formulário pré-preenchido com dados do orçamento.', 'info'); }
    setBudgetProcessed(true);
  }, [budgetDataFromState, products, addNotification, budgetProcessed]);

  // Product search filter
  useEffect(() => {
    const q = searchTerm.toLowerCase();
    setFilteredProducts(
      q ? products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      ).slice(0, 8) : []
    );
  }, [searchTerm, products]);

  // Auto-suggest due date for credit card
  useEffect(() => {
    if (purchaseData.document_type === 'Cartão de Crédito' && purchaseData.purchase_date && !purchaseData.due_date) {
      setPurchaseData(p => ({ ...p, due_date: suggestDueDate(p.purchase_date) }));
    }
  }, [purchaseData.document_type]);

  // Click-outside to close chart dropdown
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (chartRef.current && !chartRef.current.contains(e.target as Node)) {
        setChartSearch('');
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────────

  const allDocTypes = [...DEFAULT_DOC_TYPES, ...customDocTypes.map(d => d.name)];

  const allSubs = chartAccounts.flatMap(acc =>
    (acc.subs || []).map(sub => ({ sub, acc }))
  );

  const filteredSubs = chartSearch.trim()
    ? allSubs.filter(({ sub, acc }) =>
        sub.name.toLowerCase().includes(chartSearch.toLowerCase()) ||
        acc.name.toLowerCase().includes(chartSearch.toLowerCase())
      ).slice(0, 12)
    : [];

  const selectedSub  = allSubs.find(({ sub }) => sub.id === purchaseData.chart_account_sub_id);
  const selectedSubName = selectedSub?.sub.name;
  const selectedAccName = selectedSub?.acc.name;

  const total = items.reduce((s, i) => s + i.total_price, 0);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const addItem = (product: Product) => {
    if (items.find(i => !i.isNew && i.product_id === product.id)) {
      addNotification('Este item já foi adicionado.', 'warning'); return;
    }
    setItems(prev => [...prev, { product_id: product.id, product, isNew: false, quantity: 1, unit_price: 0, total_price: 0 }]);
    setSearchTerm(''); setSearchOpen(false);
  };

  const addNewProduct = () => {
    if (!newProduct.name || !newProduct.category) {
      addNotification('Nome e Categoria são obrigatórios.', 'error'); return;
    }
    if (items.find(i => i.isNew && i.newProduct?.name.toLowerCase() === newProduct.name.toLowerCase())) {
      addNotification('Produto com este nome já foi adicionado.', 'warning'); return;
    }
    setItems(prev => [...prev, {
      isNew: true,
      newProduct: { ...newProduct, supplier: newProduct.supplier || purchaseData.supplier },
      quantity: 1, unit_price: 0, total_price: 0,
    }]);
    setNewProduct({ name: '', category: '', description: '', supplier: purchaseData.supplier, image_url: '' });
    setShowNewForm(false);
  };

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: 'quantity' | 'unit_price', value: string) => {
    const num = parseFloat(value.replace(',', '.')) || 0;
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item };
      if (field === 'quantity') { next.quantity = num; next.quantity_display = value; }
      else { next.unit_price = num; next.unit_price_display = value; }
      next.total_price = next.quantity * next.unit_price;
      return next;
    }));
  };

  const adjustQty = (idx: number, delta: number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const qty = Math.max(0.01, item.quantity + delta);
      return { ...item, quantity: qty, quantity_display: String(qty), total_price: qty * item.unit_price };
    }));
  };

  async function handleAddDocType() {
    if (!newDocTypeName.trim() || !selectedHotel?.id) return;
    const { error } = await supabase.from('purchase_document_types').insert({
      name: newDocTypeName.trim(), hotel_id: selectedHotel.id,
    });
    if (error) { addNotification('Erro: ' + error.message, 'error'); return; }
    addNotification('Tipo de documento adicionado!', 'success');
    setNewDocTypeName(''); setAddingDocType(false); loadDocTypes();
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSubmitLoading(true);
    try {
      if (!selectedHotel?.id) throw new Error('Hotel não selecionado');
      if (!items.length)        throw new Error('Adicione pelo menos um item');
      if (!purchaseData.supplier) throw new Error('Fornecedor é obrigatório');

      const { data: purchase, error: pe } = await supabase.from('purchases').insert({
        invoice_number:      purchaseData.invoice_number || null,
        supplier:            purchaseData.supplier,
        purchase_date:       purchaseData.purchase_date,
        notes:               purchaseData.notes || null,
        total_amount:        total,
        hotel_id:            selectedHotel.id,
        document_type:       purchaseData.document_type || null,
        emission_date:       purchaseData.emission_date || null,
        due_date:            purchaseData.due_date || null,
        chart_account_sub_id: purchaseData.chart_account_sub_id || null,
      }).select().single();
      if (pe) throw pe;

      for (const item of items) {
        let productId = item.product_id;
        let wasNewDuplicate = false;

        if (item.isNew && item.newProduct) {
          const { data: np, error: ne } = await supabase.from('products').insert({
            name: item.newProduct.name, category: item.newProduct.category,
            description: item.newProduct.description || null,
            supplier: item.newProduct.supplier || purchaseData.supplier,
            image_url: item.newProduct.image_url || null,
            hotel_id: selectedHotel.id, quantity: item.quantity,
          }).select().single();

          if (ne) {
            if (ne.code === '23505') {
              wasNewDuplicate = true;
              const { data: ep } = await supabase.from('products').select('id').eq('name', item.newProduct.name).eq('hotel_id', selectedHotel.id).single();
              if (!ep) throw new Error(`Produto duplicado "${item.newProduct.name}" não encontrado.`);
              productId = ep.id;
            } else throw ne;
          } else { productId = np.id; }
        }

        if (productId) {
          const { error: ie } = await supabase.from('purchase_items').insert({
            purchase_id: purchase.id, product_id: productId,
            quantity: item.quantity, unit_price: item.unit_price, total_price: item.total_price,
          });
          if (ie) throw ie;

          if (!item.isNew || wasNewDuplicate) {
            addNotification(`Estoque de '${item.product?.name || item.newProduct?.name}' atualizado.`, 'info', 4000);
          }
        }
      }

      if (budgetIdToUpdate && selectedHotel?.id) {
        await supabase.from('budgets').update({ status: 'delivered' }).eq('id', budgetIdToUpdate).eq('hotel_id', selectedHotel.id);
        addNotification('Status do orçamento atualizado para Concluído.', 'info');
      }

      addNotification('Compra registrada com sucesso!', 'success');
      navigate('/inventory');
    } catch (err: any) {
      setError('Erro: ' + err.message);
      addNotification('Erro ao registrar: ' + err.message, 'error');
    } finally { setSubmitLoading(false); }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] gap-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <ShoppingCart className="w-6 h-6 text-blue-500 animate-pulse" />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando produtos…</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-36 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-500 transition-colors shadow-sm">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-500" />
            Registrar Nova Compra
          </h1>
          {selectedHotel && <p className="text-xs text-slate-400 mt-0.5 ml-7">{selectedHotel.name}</p>}
        </div>
      </div>

      {budgetIdToUpdate && (
        <div className="flex items-center gap-2.5 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-sm text-blue-700 dark:text-blue-300">
          <Info className="w-4 h-4 shrink-0" />
          Formulário pré-preenchido com dados do orçamento — confirme os valores antes de registrar.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Dados da Compra ─────────────────────────────────────────────────── */}
        <Section icon={<FileText className="w-4 h-4" />} title="Dados da Compra" accent="blue">

          {/* Row 1: Fornecedor + Tipo de Documento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Fornecedor */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Nome do Fornecedor <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input type="text" value={purchaseData.supplier}
                  onChange={e => setPurchaseData(p => ({ ...p, supplier: e.target.value }))}
                  placeholder="Nome do fornecedor" required
                  className={fieldCls + ' pl-9'} />
              </div>
            </div>

            {/* Tipo de Documento */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Tipo de Documento
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Receipt className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  <select
                    value={purchaseData.document_type}
                    onChange={e => setPurchaseData(p => ({ ...p, document_type: e.target.value }))}
                    className={fieldCls + ' pl-9 pr-8 appearance-none'}>
                    <option value="">Selecionar…</option>
                    {allDocTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                </div>
                <button type="button" title="Adicionar tipo de documento"
                  onClick={() => setAddingDocType(v => !v)}
                  className={`w-10 h-10 flex items-center justify-center rounded-xl border transition-colors ${addingDocType ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-600' : 'border-slate-200 dark:border-slate-600 text-slate-400 hover:text-blue-600 hover:border-blue-300 dark:hover:border-blue-700'}`}>
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {addingDocType && (
                <div className="flex gap-2 mt-2">
                  <input value={newDocTypeName} onChange={e => setNewDocTypeName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddDocType(); } if (e.key === 'Escape') setAddingDocType(false); }}
                    placeholder="Ex: Fatura, Contrato…"
                    className={fieldCls + ' text-xs'} autoFocus />
                  <button type="button" onClick={handleAddDocType} disabled={!newDocTypeName.trim()}
                    className="px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors whitespace-nowrap">
                    Salvar
                  </button>
                  <button type="button" onClick={() => { setAddingDocType(false); setNewDocTypeName(''); }}
                    className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-600 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Nº NF + Data da Compra + Data de Emissão */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Nº Nota Fiscal
              </label>
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input type="text" value={purchaseData.invoice_number}
                  onChange={e => setPurchaseData(p => ({ ...p, invoice_number: e.target.value }))}
                  placeholder="Opcional"
                  className={fieldCls + ' pl-9'} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Data da Compra <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input type="date" value={purchaseData.purchase_date}
                  onChange={e => setPurchaseData(p => ({ ...p, purchase_date: e.target.value }))}
                  required className={fieldCls + ' pl-9 dark:[color-scheme:dark]'} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Data de Emissão da NF
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input type="date" value={purchaseData.emission_date}
                  onChange={e => setPurchaseData(p => ({ ...p, emission_date: e.target.value }))}
                  className={fieldCls + ' pl-9 dark:[color-scheme:dark]'} />
              </div>
            </div>
          </div>

          {/* Row 3: Vencimento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Data de Vencimento do Pagamento
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input type="date" value={purchaseData.due_date}
                  onChange={e => setPurchaseData(p => ({ ...p, due_date: e.target.value }))}
                  className={fieldCls + ' pl-9 dark:[color-scheme:dark]'} />
              </div>
              {purchaseData.document_type === 'Cartão de Crédito' && purchaseData.purchase_date && (
                <p className="text-xs text-blue-500 dark:text-blue-400 mt-1.5 flex items-center gap-1">
                  <Info className="w-3 h-3 shrink-0" />
                  Sugestão para cartão: {formatDateBR(suggestDueDate(purchaseData.purchase_date))}
                  {!purchaseData.due_date && (
                    <button type="button"
                      onClick={() => setPurchaseData(p => ({ ...p, due_date: suggestDueDate(p.purchase_date) }))}
                      className="ml-1 underline hover:no-underline">
                      Usar
                    </button>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              <StickyNote className="w-3 h-3 inline mr-1" />Observações
            </label>
            <textarea rows={2} value={purchaseData.notes}
              onChange={e => setPurchaseData(p => ({ ...p, notes: e.target.value }))}
              placeholder="Informações adicionais sobre a compra…"
              className={fieldCls + ' resize-none'} />
          </div>
        </Section>

        {/* ── Plano de Contas ──────────────────────────────────────────────────── */}
        <Section
          icon={<BookOpen className="w-4 h-4" />}
          title="Plano de Contas"
          accent="purple"
          action={
            <button type="button" onClick={() => setShowChartManager(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors border border-slate-200 dark:border-slate-600">
              <Settings className="w-3 h-3" /> Gerenciar
            </button>
          }
        >
          {/* Selected badge */}
          {selectedSub && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-purple-50 dark:bg-purple-900/15 border border-purple-200 dark:border-purple-800 rounded-xl">
              <Layers className="w-4 h-4 text-purple-400 shrink-0" />
              <div className="flex-1 flex items-center gap-1.5 min-w-0 flex-wrap">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">{selectedAccName}</span>
                <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="text-sm font-semibold text-purple-700 dark:text-purple-300 truncate">{selectedSubName}</span>
              </div>
              <button type="button" onClick={() => setPurchaseData(p => ({ ...p, chart_account_sub_id: '' }))}
                className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Search */}
          <div ref={chartRef} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input type="text" value={chartSearch}
              onChange={e => setChartSearch(e.target.value)}
              placeholder="Buscar subconta do plano de contas…"
              className={fieldCls + ' pl-9 pr-9'} />
            {chartSearch && (
              <button type="button" onClick={() => setChartSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Search results dropdown */}
            {chartSearch && filteredSubs.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
                {filteredSubs.map(({ sub, acc }) => (
                  <button key={sub.id} type="button"
                    onClick={() => { setPurchaseData(p => ({ ...p, chart_account_sub_id: sub.id })); setChartSearch(''); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors text-left ${purchaseData.chart_account_sub_id === sub.id ? 'bg-purple-50 dark:bg-purple-900/20' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-slate-400 truncate">{acc.name}</p>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{sub.name}</p>
                    </div>
                    {purchaseData.chart_account_sub_id === sub.id && (
                      <Check className="w-4 h-4 text-purple-500 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {chartSearch && filteredSubs.length === 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl px-4 py-3">
                <p className="text-sm text-slate-400 text-center">Nenhuma subconta encontrada.</p>
              </div>
            )}
          </div>

          {/* Tree view */}
          {!chartSearch && !selectedSub && chartAccounts.length > 0 && (
            <div className="max-h-60 overflow-y-auto space-y-1 border border-slate-100 dark:border-slate-700 rounded-xl p-2">
              {chartAccounts.map(acc => (
                <div key={acc.id}>
                  <button type="button"
                    onClick={() => setChartExpanded(chartExpanded === acc.id ? null : acc.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left">
                    <ChevronRight className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${chartExpanded === acc.id ? 'rotate-90' : ''}`} />
                    <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{acc.name}</span>
                    <span className="text-xs text-slate-400 shrink-0">{acc.subs.length}</span>
                  </button>
                  {chartExpanded === acc.id && (
                    <div className="pl-5 space-y-0.5 pb-1">
                      {acc.subs.map(sub => (
                        <button key={sub.id} type="button"
                          onClick={() => setPurchaseData(p => ({ ...p, chart_account_sub_id: sub.id }))}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                            purchaseData.chart_account_sub_id === sub.id
                              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-semibold'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-700 dark:hover:text-purple-300'
                          }`}>
                          {sub.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!chartSearch && !selectedSub && chartAccounts.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">
              Carregando plano de contas…
            </p>
          )}
        </Section>

        {/* ── Adicionar Itens ──────────────────────────────────────────────────── */}
        <Section icon={<Search className="w-4 h-4" />} title="Adicionar Itens" accent="emerald">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Produto Existente
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input type="text" value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Digite para buscar produto…"
                className={fieldCls + ' pl-9 pr-9'} />
              {searchTerm && (
                <button type="button" onClick={() => { setSearchTerm(''); setSearchOpen(false); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {searchOpen && searchTerm && (
                <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
                  {filteredProducts.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-slate-400 text-center">Nenhum produto encontrado.</p>
                  ) : (
                    filteredProducts.map(p => (
                      <button key={p.id} type="button" onClick={() => addItem(p)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors text-left group">
                        <div className="w-9 h-9 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                          {p.image_url && !imgErrors[p.id]
                            ? <img src={p.image_url} alt={p.name} className="w-full h-full object-contain"
                                onError={() => setImgErrors(prev => ({ ...prev, [p.id]: true }))} />
                            : <Package className="w-4 h-4 text-slate-400" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400">{p.name}</p>
                          <p className="text-xs text-slate-400">{p.category}</p>
                        </div>
                        <Plus className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
            <span className="text-xs font-medium text-slate-400">ou</span>
            <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
          </div>

          {!showNewForm ? (
            <button type="button" onClick={() => setShowNewForm(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-sm font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Plus className="w-4 h-4" /> Adicionar Produto Não Cadastrado
            </button>
          ) : (
            <div className="bg-emerald-50/60 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">Novo Produto</p>
                <button type="button" onClick={() => setShowNewForm(false)}
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { key: 'name',        label: 'Nome *',       placeholder: 'Nome do produto' },
                  { key: 'category',    label: 'Categoria *',  placeholder: 'Ex: Bebidas' },
                  { key: 'description', label: 'Descrição',    placeholder: 'Opcional' },
                  { key: 'supplier',    label: 'Fornecedor',   placeholder: 'Opcional' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">{f.label}</label>
                    <input type="text" value={(newProduct as any)[f.key]}
                      onChange={e => setNewProduct(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className={fieldCls} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowNewForm(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  Cancelar
                </button>
                <button type="button" onClick={addNewProduct}
                  className="flex-[2] py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 shadow-sm shadow-emerald-500/20">
                  <Plus className="w-4 h-4" /> Adicionar à Lista
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* ── Itens da Compra ──────────────────────────────────────────────────── */}
        {items.length > 0 && (
          <Section icon={<ShoppingCart className="w-4 h-4" />} title={`Itens da Compra (${items.length})`} accent="orange">
            <div className="space-y-3">
              <div className="hidden sm:grid sm:grid-cols-[1fr_100px_120px_80px_36px] gap-2 px-1">
                {['Produto', 'Quantidade', 'Preço Unit.', 'Total', ''].map(h => (
                  <p key={h} className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{h}</p>
                ))}
              </div>

              {items.map((item, idx) => {
                const name     = item.isNew ? item.newProduct?.name : item.product?.name;
                const category = item.isNew ? item.newProduct?.category : item.product?.category;
                const img      = item.isNew ? item.newProduct?.image_url : item.product?.image_url;

                return (
                  <div key={idx}
                    className="bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 sm:space-y-0 sm:grid sm:grid-cols-[1fr_100px_120px_80px_36px] sm:gap-2 sm:items-center hover:border-orange-200 dark:hover:border-orange-800 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 shrink-0 rounded-xl bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                        {img && !imgErrors[`new-${idx}`]
                          ? <img src={img} alt={name} className="w-full h-full object-contain"
                              onError={() => setImgErrors(prev => ({ ...prev, [`new-${idx}`]: true }))} />
                          : <Package className="w-4 h-4 text-slate-400" />
                        }
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{name}</p>
                          {item.isNew && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">NOVO</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{category}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:block">
                      <span className="text-xs text-slate-400 sm:hidden w-20 shrink-0">Quantidade</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => adjustQty(idx, -1)}
                          className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-red-500 hover:border-red-300 dark:hover:border-red-700 transition-colors flex items-center justify-center">
                          <Minus className="w-3 h-3" />
                        </button>
                        <input type="text" inputMode="decimal"
                          value={item.quantity_display ?? String(item.quantity)}
                          onChange={e => updateItem(idx, 'quantity', e.target.value)}
                          className="w-14 h-7 text-center text-sm font-bold rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 transition-colors" />
                        <button type="button" onClick={() => adjustQty(idx, 1)}
                          className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-emerald-500 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors flex items-center justify-center">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:block">
                      <span className="text-xs text-slate-400 sm:hidden w-20 shrink-0">Preço Unit.</span>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">R$</span>
                        <input type="text" inputMode="decimal"
                          value={item.unit_price_display ?? String(item.unit_price)}
                          onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                          className="w-full pl-7 pr-2 py-1.5 text-sm font-bold rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 transition-colors" />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:block">
                      <span className="text-xs text-slate-400 sm:hidden w-20 shrink-0">Total</span>
                      <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{fmtBRL(item.total_price)}</p>
                    </div>

                    <div className="flex sm:justify-center">
                      <button type="button" onClick={() => removeItem(idx)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </form>

      {/* ── Sticky Footer ────────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-safe-bottom">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl shadow-black/10 dark:shadow-black/40 px-5 py-4 flex items-center gap-4">
            <div className="flex-1">
              <p className="text-xs text-slate-400 font-medium">Total da compra</p>
              <p className={`text-2xl font-bold tabular-nums leading-tight transition-colors ${
                items.length > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-300 dark:text-slate-600'
              }`}>
                {fmtBRL(total)}
              </p>
              {items.length > 0 && (
                <p className="text-xs text-slate-400">{items.length} item{items.length !== 1 ? 's' : ''}</p>
              )}
            </div>
            <button
              onClick={handleSubmit as any}
              type="submit"
              disabled={submitLoading || items.length === 0}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-xl shadow-sm shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 transition-all">
              {submitLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Registrando…</>
                : <><DollarSign className="w-4 h-4" /> Registrar Compra</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── Chart Manager Modal ──────────────────────────────────────────────── */}
      {showChartManager && selectedHotel && (
        <ChartManagerModal
          onClose={() => setShowChartManager(false)}
          accounts={chartAccounts}
          hotelId={selectedHotel.id}
          onRefresh={loadChartAccounts}
        />
      )}
    </div>
  );
};

export default NewPurchase;
