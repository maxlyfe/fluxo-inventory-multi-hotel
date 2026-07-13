// src/pages/NewPurchase.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft, Search, Plus, Trash2, DollarSign, Package,
  AlertTriangle, X, FileText, Building2, Calendar,
  StickyNote, ChevronDown, ChevronRight, Loader2, ShoppingCart,
  Info, Minus, BookOpen, Receipt, Settings, Edit2, Check, Layers, Link2,
} from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import { useHotel } from '../context/HotelContext';
import { useGroup } from '../context/GroupContext';
import { supplierDisplayName, parseRate } from '../lib/accountingService';
import * as creditCardService from '../lib/creditCardService';
import type { CreditCard as CreditCardType } from '../lib/creditCardService';
import NFeXMLImportModal, { type NFeImportResult } from '../components/NFeXMLImportModal';
import { nfService } from '../lib/nfService';
import SupplierQuickCreateModal from '../components/SupplierQuickCreateModal';
import type { Supplier } from '../lib/supplierService';

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
  ncm?: string;   // interno – preenchido via XML, não exibido na UI
  cean?: string;  // cEAN exibido e editável
  ibs?: number;   // calculado: total_price × supplier_ibs_rate / 100
  cbs?: number;   // calculado: total_price × supplier_cbs_rate / 100
}

interface SupplierSummary {
  id: string;
  nome: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
  type: string;
  ibs: string | null;
  cbs: string | null;
  default_chart_account_sub_id: string | null;
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

interface Installment {
  installment_number: number;
  due_date: string;
  amount: number;
  amount_display?: string;
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

function addMonths(dateStr: string, n: number): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  const { currentGroup }    = useGroup();
  const { addNotification } = useNotification();

  const budgetDataFromState: Budget | undefined = location.state?.budgetData;
  const budgetIdToUpdate = budgetDataFromState?.id;

  // NF recebida (Financeiro → NF Recebidas): XML pré-carregado para importação
  const nfeXmlFromState: string | undefined = location.state?.nfeXml;
  const nfReceivedId: string | undefined = location.state?.nfReceivedId;

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
  const [showNFeModal,     setShowNFeModal]      = useState(false);
  const [showNewSupplier,  setShowNewSupplier]   = useState(false);
  const [linkingIdx,       setLinkingIdx]        = useState<number | null>(null);
  const [linkSearch,       setLinkSearch]        = useState('');

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

  // ── Installments
  const [isInstallment,    setIsInstallment]    = useState(false);
  const [installmentCount, setInstallmentCount] = useState(2);
  const [installments,     setInstallments]     = useState<Installment[]>([]);

  // ── Purchase form data
  const [purchaseData, setPurchaseData] = useState({
    invoice_number: '',
    supplier: '',
    supplier_id: '',
    purchase_date: new Date().toISOString().split('T')[0],
    notes: '',
    document_type: '',
    emission_date: '',
    due_date: '',
    chart_account_sub_id: '',
  });

  // ── Payment method + credit card
  const [paymentMethod,    setPaymentMethod]    = useState('');
  const [creditCardId,     setCreditCardId]     = useState('');
  const [sourceHotelId,    setSourceHotelId]    = useState('');
  const [cardList,         setCardList]         = useState<CreditCardType[]>([]);
  const [showGroupCards,   setShowGroupCards]   = useState(false);

  // ── Supplier autocomplete
  const [suppList,       setSuppList]       = useState<SupplierSummary[]>([]);
  const [suppLoading,    setSuppLoading]    = useState(false);
  const [suppDropOpen,   setSuppDropOpen]   = useState(false);
  const supplierRef = useRef<HTMLDivElement>(null);

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

  // Abre o modal de importação automaticamente quando chega XML de NF recebida
  useEffect(() => {
    if (nfeXmlFromState) setShowNFeModal(true);
  }, [nfeXmlFromState]);

  useEffect(() => {
    if (location.state?.budgetData) {
      setBudgetProcessed(false);
      setItems([]);
      setPurchaseData(p => ({ ...p, supplier: '' }));
    }
  }, [location.state?.budgetData]);

  useEffect(() => {
    const fetchAll = async () => {
      if (!selectedHotel?.id) { setProducts([]); setFilteredProducts([]); setLoading(false); return; }
      setLoading(true);
      setSuppLoading(true);
      const [{ data: prods, error: fe }, { data: supps, error: suppErr }] = await Promise.all([
        supabase.from('products').select('*').eq('hotel_id', selectedHotel.id).order('name'),
        supabase.from('suppliers').select('id, nome, nome_fantasia, razao_social, cnpj, type, ibs, cbs, default_chart_account_sub_id')
          .eq('hotel_id', selectedHotel.id).eq('status', 'ativo').order('created_at', { ascending: false }),
      ]);
      if (fe) addNotification('Erro ao carregar produtos: ' + fe.message, 'error');
      else { setProducts(prods || []); setFilteredProducts(prods || []); }
      if (suppErr) addNotification('Erro ao carregar fornecedores: ' + suppErr.message, 'error');
      setSuppList(supps || []);
      setSuppLoading(false);
      setLoading(false);
    };
    fetchAll();
  }, [selectedHotel, addNotification]);

  // Close supplier dropdown on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (supplierRef.current && !supplierRef.current.contains(e.target as Node)) {
        setSuppDropOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useEffect(() => {
    loadChartAccounts();
    loadDocTypes();
  }, [loadChartAccounts, loadDocTypes]);

  useEffect(() => {
    if (!selectedHotel?.id) return;
    if (paymentMethod !== 'cartao') return;
    if (showGroupCards && currentGroup?.id) {
      creditCardService.listByGroup(currentGroup.id).then(setCardList).catch(() => setCardList([]));
    } else {
      creditCardService.list(selectedHotel.id).then(setCardList).catch(() => setCardList([]));
    }
  }, [selectedHotel?.id, currentGroup?.id, paymentMethod, showGroupCards]);

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

  const filteredSuppliers = suppList.filter(s => {
    const q = purchaseData.supplier.toLowerCase();
    if (!q) return true;
    const display = supplierDisplayName(s).toLowerCase();
    const cnpj = (s.cnpj ?? '').replace(/\D/g, '');
    return display.includes(q) || cnpj.includes(q.replace(/\D/g, ''));
  }).slice(0, 8);

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

  // Plano de contas padrão do fornecedor: auto-seleciona quando o campo está vazio
  useEffect(() => {
    if (!purchaseData.supplier_id || purchaseData.chart_account_sub_id) return;
    const s = suppList.find(x => x.id === purchaseData.supplier_id);
    if (s?.default_chart_account_sub_id) {
      setPurchaseData(p => p.chart_account_sub_id
        ? p
        : { ...p, chart_account_sub_id: s.default_chart_account_sub_id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseData.supplier_id, suppList]);

  const total = items.reduce((s, i) => s + i.total_price, 0);

  // ── NF-e XML import ───────────────────────────────────────────────────────────

  const handleNFeConfirm = (result: NFeImportResult) => {
    // 1. Preenche dados da compra com dados da NF-e
    setPurchaseData(p => ({
      ...p,
      supplier:       result.supplier      || p.supplier,
      supplier_id:    result.supplierId    || p.supplier_id,
      invoice_number: result.invoiceNumber || p.invoice_number,
      emission_date:  result.emissionDate  || p.emission_date,
    }));
    // Recarrega lista de fornecedores se um novo foi criado
    if (result.supplierId && selectedHotel?.id) {
      supabase.from('suppliers')
        .select('id, nome, nome_fantasia, razao_social, cnpj, type, ibs, cbs, default_chart_account_sub_id')
        .eq('hotel_id', selectedHotel.id).eq('status', 'ativo')
        .order('created_at', { ascending: false })
        .then(({ data }) => { if (data) setSuppList(data); });
    }

    // 2. Aplica cada linha conforme a ação reconciliada
    setItems(prev => {
      let next = [...prev];
      result.lines.forEach(line => {
        if (line.action === 'update' && line.currentItemIndex !== undefined) {
          // Atualiza quantidade e preço do item já na lista
          next = next.map((item, i) => {
            if (i !== line.currentItemIndex) return item;
            return {
              ...item,
              quantity:      line.quantity,
              unit_price:    line.unitPrice,
              total_price:   line.quantity * line.unitPrice,
              quantity_display: String(line.quantity),
              unit_price_display: String(line.unitPrice),
              ncm:  line.ncm  || item.ncm,
              cean: line.cEAN || item.cean,
              ibs:  line.ibs,
              cbs:  line.cbs,
            };
          });
        } else if (line.action === 'add' && line.product) {
          const alreadyIn = next.find(i => !i.isNew && i.product_id === line.product!.id);
          if (!alreadyIn) {
            next.push({
              product_id: line.product.id,
              product:    line.product,
              isNew:      false,
              quantity:   line.quantity,
              unit_price: line.unitPrice,
              total_price: line.quantity * line.unitPrice,
              quantity_display: String(line.quantity),
              unit_price_display: String(line.unitPrice),
              ncm:  line.ncm  || undefined,
              cean: line.cEAN || undefined,
              ibs:  line.ibs,
              cbs:  line.cbs,
            });
          }
        } else if (line.action === 'create') {
          const alreadyIn = next.find(i => i.isNew && i.newProduct?.name.toLowerCase() === line.xProd.toLowerCase());
          if (!alreadyIn) {
            next.push({
              isNew: true,
              newProduct: {
                name:     line.xProd,
                category: 'Importado XML',
                description: `NCM: ${line.ncm || '—'}`,
                supplier: result.supplier,
              },
              quantity:   line.quantity,
              unit_price: line.unitPrice,
              total_price: line.quantity * line.unitPrice,
              quantity_display: String(line.quantity),
              unit_price_display: String(line.unitPrice),
              ncm:  line.ncm  || undefined,
              cean: line.cEAN || undefined,
              ibs:  line.ibs,
              cbs:  line.cbs,
            });
          }
        }
      });
      return next;
    });

    // 3. Vencimentos / duplicatas
    if (result.dups.length === 1) {
      // À vista — preenche data de vencimento simples
      setPurchaseData(p => ({ ...p, due_date: result.dups[0].dVenc }));
      setIsInstallment(false);
      setInstallments([]);
    } else if (result.dups.length > 1) {
      // Parcelado — ativa modo parcelado e preenche cada parcela
      setIsInstallment(true);
      setInstallmentCount(result.dups.length);
      setInstallments(result.dups.map((dup, i) => ({
        installment_number: i + 1,
        due_date: dup.dVenc,
        amount: dup.vDup,
      })));
    }

    addNotification(`NF-e importada: ${result.lines.length} item(s) processado(s).`, 'success');
  };

  const handleSupplierCreated = (supplier: Supplier) => {
    const display = supplier.nome_fantasia || supplier.razao_social || supplier.nome || '';
    setPurchaseData(p => ({ ...p, supplier: display, supplier_id: supplier.id ?? '' }));
    // Recarrega lista de fornecedores para incluir o recém-criado
    if (selectedHotel?.id) {
      supabase.from('suppliers')
        .select('id, nome, nome_fantasia, razao_social, cnpj, type, ibs, cbs, default_chart_account_sub_id')
        .eq('hotel_id', selectedHotel.id).eq('status', 'ativo')
        .order('created_at', { ascending: false })
        .then(({ data }) => { if (data) setSuppList(data); });
    }
  };

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

  // Vincula um item "novo" (sem correspondência no inventário) a um produto
  // existente — ao salvar a compra o cEAN do XML é registrado nesse produto
  const linkItemToProduct = (idx: number, product: Product) => {
    if (items.some((i, j) => j !== idx && !i.isNew && i.product_id === product.id)) {
      addNotification('Este produto já está na lista de compra.', 'warning');
      return;
    }
    setItems(prev => prev.map((item, i) =>
      i === idx
        ? { ...item, isNew: false, product_id: product.id, product, newProduct: undefined }
        : item
    ));
    setLinkingIdx(null);
    setLinkSearch('');
    addNotification(`Item vinculado a "${product.name}" — o cEAN será salvo na ficha do produto ao registrar a compra.`, 'success');
  };

  // Retorna as taxas IBS/CBS do fornecedor atualmente selecionado
  const supplierTaxRates = () => {
    const s = suppList.find(x => x.id === purchaseData.supplier_id);
    return { ibsRate: parseRate(s?.ibs), cbsRate: parseRate(s?.cbs) };
  };

  const calcTax = (total: number) => {
    const { ibsRate, cbsRate } = supplierTaxRates();
    return {
      ibs: ibsRate > 0 ? Math.round(total * ibsRate) / 100 : 0,
      cbs: cbsRate > 0 ? Math.round(total * cbsRate) / 100 : 0,
    };
  };

  const updateItem = (idx: number, field: 'quantity' | 'unit_price', value: string) => {
    const num = parseFloat(value.replace(',', '.')) || 0;
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item };
      if (field === 'quantity') { next.quantity = num; next.quantity_display = value; }
      else { next.unit_price = num; next.unit_price_display = value; }
      next.total_price = next.quantity * next.unit_price;
      const tax = calcTax(next.total_price);
      next.ibs = tax.ibs;
      next.cbs = tax.cbs;
      return next;
    }));
  };

  const updateCean = (idx: number, value: string) => {
    setItems(prev => prev.map((item, i) => i !== idx ? item : { ...item, cean: value }));
  };

  const adjustQty = (idx: number, delta: number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const qty = Math.max(0.01, item.quantity + delta);
      const total = qty * item.unit_price;
      const tax = calcTax(total);
      return { ...item, quantity: qty, quantity_display: String(qty), total_price: total, ibs: tax.ibs, cbs: tax.cbs };
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

  function generateInstallments() {
    if (total === 0 || installmentCount < 2) return;
    const base = Math.floor((total / installmentCount) * 100) / 100;
    const last = Math.round((total - base * (installmentCount - 1)) * 100) / 100;

    const selectedCard = cardList.find(c => c.id === creditCardId);
    const useCardDates = paymentMethod === 'cartao' && selectedCard && purchaseData.purchase_date;

    let firstDate: string;
    if (useCardDates) {
      firstDate = creditCardService.calculateCardDueDate(
        purchaseData.purchase_date, selectedCard.closing_day, selectedCard.due_day, 0,
      );
    } else if (purchaseData.document_type === 'Cartão de Crédito' && purchaseData.purchase_date) {
      firstDate = suggestDueDate(purchaseData.purchase_date);
    } else if (purchaseData.due_date) {
      firstDate = purchaseData.due_date;
    } else if (purchaseData.purchase_date) {
      firstDate = addMonths(purchaseData.purchase_date, 1);
    } else {
      firstDate = '';
    }

    setInstallments(
      Array.from({ length: installmentCount }, (_, i) => ({
        installment_number: i + 1,
        due_date: useCardDates
          ? creditCardService.calculateCardDueDate(
              purchaseData.purchase_date, selectedCard.closing_day, selectedCard.due_day, i,
            )
          : (firstDate ? addMonths(firstDate, i) : ''),
        amount: i === installmentCount - 1 ? last : base,
      }))
    );
  }

  function updateInstallment(i: number, field: 'due_date' | 'amount', value: string) {
    setInstallments(prev => prev.map((inst, idx) => {
      if (idx !== i) return inst;
      if (field === 'due_date') return { ...inst, due_date: value };
      const num = parseFloat(value.replace(',', '.')) || 0;
      return { ...inst, amount: num, amount_display: value };
    }));
  }

  function removeInstallment(i: number) {
    setInstallments(prev =>
      prev.filter((_, idx) => idx !== i).map((inst, idx) => ({ ...inst, installment_number: idx + 1 }))
    );
  }

  function addInstallmentRow() {
    const last = installments[installments.length - 1];
    setInstallments(prev => [...prev, {
      installment_number: prev.length + 1,
      due_date: last?.due_date ? addMonths(last.due_date, 1) : '',
      amount: 0,
    }]);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSubmitLoading(true);
    try {
      if (!selectedHotel?.id) throw new Error('Hotel não selecionado');
      if (!items.length)        throw new Error('Adicione pelo menos um item');
      if (!purchaseData.supplier) throw new Error('Fornecedor é obrigatório');

      const selectedCard = paymentMethod === 'cartao' && creditCardId
        ? cardList.find(c => c.id === creditCardId) : null;

      let computedDueDate: string | null;
      if (isInstallment) {
        computedDueDate = installments[0]?.due_date || null;
      } else if (selectedCard && purchaseData.purchase_date) {
        computedDueDate = creditCardService.calculateCardDueDate(
          purchaseData.purchase_date, selectedCard.closing_day, selectedCard.due_day, 0,
        );
      } else {
        computedDueDate = purchaseData.due_date || null;
      }

      const { data: purchase, error: pe } = await supabase.from('purchases').insert({
        invoice_number:      purchaseData.invoice_number || null,
        supplier:            purchaseData.supplier,
        supplier_id:         purchaseData.supplier_id || null,
        purchase_date:       purchaseData.purchase_date,
        notes:               purchaseData.notes || null,
        total_amount:        total,
        hotel_id:            selectedHotel.id,
        document_type:       purchaseData.document_type || null,
        emission_date:       purchaseData.emission_date || null,
        due_date:            computedDueDate,
        chart_account_sub_id: purchaseData.chart_account_sub_id || null,
        is_installment:      isInstallment,
        installment_count:   isInstallment ? installments.length : null,
        payment_method:      paymentMethod || null,
        credit_card_id:      (paymentMethod === 'cartao' && creditCardId) || null,
        source_hotel_id:     (paymentMethod === 'cartao' && sourceHotelId) || null,
      }).select().single();
      if (pe) throw pe;

      for (const item of items) {
        let productId = item.product_id;
        let wasNewDuplicate = false;

        if (item.isNew && item.newProduct) {
          // Produto novo nasce ZERADO: o trigger do banco
          // (update_product_prices_after_purchase) soma a quantidade comprada
          // ao inserir o purchase_item — criar já com quantity duplicava o estoque
          const { data: np, error: ne } = await supabase.from('products').insert({
            name: item.newProduct.name, category: item.newProduct.category,
            description: item.newProduct.description || null,
            supplier: item.newProduct.supplier || purchaseData.supplier,
            image_url: item.newProduct.image_url || null,
            hotel_id: selectedHotel.id, quantity: 0,
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
            ncm:  item.ncm  || null,
            cean: item.cean || null,
            ibs:  item.ibs  ?? 0,
            cbs:  item.cbs  ?? 0,
          });
          if (ie) throw ie;

          // Atualiza NCM no cadastro do produto (quando veio do XML)
          if (item.ncm && productId && !item.isNew) {
            await supabase.from('products')
              .update({ ncm: item.ncm })
              .eq('id', productId)
              .eq('hotel_id', selectedHotel.id);
          }

          // Registra o cEAN na ficha do produto (novo ou vinculado) para que
          // futuras importações de XML reconheçam o item automaticamente
          const cleanEan = (item.cean || '').replace(/\D/g, '');
          if (cleanEan) {
            const { data: existingBc } = await supabase
              .from('product_barcodes')
              .select('product_id, products!inner(hotel_id)')
              .eq('barcode', cleanEan)
              .eq('products.hotel_id', selectedHotel.id)
              .maybeSingle();
            if (!existingBc) {
              const { error: bcErr } = await supabase
                .from('product_barcodes')
                .insert({ product_id: productId, barcode: cleanEan });
              if (!bcErr) {
                addNotification(`cEAN ${cleanEan} cadastrado em '${item.product?.name || item.newProduct?.name}'.`, 'info', 4000);
              }
            }
          }

          if (!item.isNew || wasNewDuplicate) {
            addNotification(`Estoque de '${item.product?.name || item.newProduct?.name}' atualizado.`, 'info', 4000);
          }
        }
      }

      if (isInstallment && installments.length > 0) {
        const { error: ie2 } = await supabase.from('purchase_installments').insert(
          installments.map(inst => ({
            purchase_id:        purchase.id,
            installment_number: inst.installment_number,
            due_date:           inst.due_date || null,
            amount:             inst.amount,
          }))
        );
        if (ie2) throw ie2;
      }

      if (budgetIdToUpdate && selectedHotel?.id) {
        await supabase.from('budgets').update({ status: 'delivered' }).eq('id', budgetIdToUpdate).eq('hotel_id', selectedHotel.id);
        addNotification('Status do orçamento atualizado para Concluído.', 'info');
      }

      // Marca a NF recebida como lançada (fluxo Financeiro → NF Recebidas)
      if (nfReceivedId) {
        try {
          await nfService.updateReceivedSituacao(nfReceivedId, 'lancada', purchase.id);
        } catch (nfErr) {
          console.error('[NewPurchase] marcar NF recebida como lançada:', nfErr);
        }
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
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-500" />
            Registrar Nova Compra
          </h1>
          {selectedHotel && <p className="text-xs text-slate-400 mt-0.5 ml-7">{selectedHotel.name}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowNFeModal(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 text-xs font-semibold transition-colors shadow-sm shrink-0"
          title="Importar NF-e XML"
        >
          <FileText className="w-3.5 h-3.5" />
          Importar NF-e
        </button>
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
            {/* Fornecedor — autocomplete */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Nome do Fornecedor <span className="text-red-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewSupplier(true)}
                  className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Novo Fornecedor
                </button>
              </div>
              <div className="relative" ref={supplierRef}>
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input type="text" value={purchaseData.supplier}
                  onChange={e => {
                    setPurchaseData(p => ({ ...p, supplier: e.target.value, supplier_id: '' }));
                    setSuppDropOpen(true);
                  }}
                  onFocus={() => setSuppDropOpen(true)}
                  placeholder="Nome do fornecedor ou busque cadastrado"
                  required
                  className={fieldCls + ' pl-9 pr-8'} />
                {/* Linked indicator */}
                {purchaseData.supplier_id && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Link2 className="w-3.5 h-3.5 text-emerald-500" />
                  </span>
                )}
                {/* Dropdown */}
                {suppDropOpen && !suppLoading && (
                  <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                    {filteredSuppliers.length > 0 ? filteredSuppliers.map(s => {
                      const display = supplierDisplayName(s);
                      return (
                        <button key={s.id} type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setPurchaseData(p => ({ ...p, supplier: display, supplier_id: s.id }));
                            setSuppDropOpen(false);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors text-left border-b last:border-0 dark:border-slate-700">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{display}</p>
                            {s.cnpj && <p className="text-xs text-slate-400 font-mono">{s.cnpj}</p>}
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${s.type === 'juridica' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>
                            {s.type === 'juridica' ? 'PJ' : 'PF'}
                          </span>
                        </button>
                      );
                    }) : (
                      <div className="px-3 py-3 text-xs text-slate-400 text-center">
                        {suppList.length === 0
                          ? 'Nenhum fornecedor cadastrado — digite livremente'
                          : 'Nenhum fornecedor encontrado para a busca'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {purchaseData.supplier_id && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> Fornecedor cadastrado vinculado — créditos IBS/CBS serão calculados
                </p>
              )}
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

          {/* Row 1b: Forma de Pagamento + Cartão */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Forma de Pagamento
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <select
                  value={paymentMethod}
                  onChange={e => {
                    const v = e.target.value;
                    setPaymentMethod(v);
                    if (v !== 'cartao') { setCreditCardId(''); setSourceHotelId(''); }
                  }}
                  className={fieldCls + ' pl-9 pr-8 appearance-none'}>
                  <option value="">Selecionar…</option>
                  <option value="cartao">Cartão de Crédito</option>
                  <option value="boleto">Boleto</option>
                  <option value="pix">PIX</option>
                  <option value="transferencia">Transferência</option>
                  <option value="dinheiro">Dinheiro</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {paymentMethod === 'cartao' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  Cartão
                </label>
                <div className="relative">
                  <select
                    value={creditCardId}
                    onChange={e => {
                      const cardId = e.target.value;
                      setCreditCardId(cardId);
                      const card = cardList.find(c => c.id === cardId);
                      if (card && card.hotel_id !== selectedHotel?.id) {
                        setSourceHotelId(card.hotel_id);
                      } else {
                        setSourceHotelId('');
                      }
                    }}
                    className={fieldCls + ' pr-8 appearance-none'}>
                    <option value="">Selecionar cartão…</option>
                    {cardList.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} •••• {c.last_4_digits}
                        {c.hotel_id !== selectedHotel?.id && c.hotels ? ` (${c.hotels.name})` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                </div>
                <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showGroupCards}
                    onChange={e => setShowGroupCards(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Mostrar cartões de outras unidades
                  </span>
                </label>
                {sourceHotelId && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                    <Info className="w-3 h-3 shrink-0" />
                    Cartão de outra unidade — gasto vinculado à origem
                  </p>
                )}
                {creditCardId && purchaseData.purchase_date && !isInstallment && (() => {
                  const card = cardList.find(c => c.id === creditCardId);
                  if (!card) return null;
                  const due = creditCardService.calculateCardDueDate(
                    purchaseData.purchase_date, card.closing_day, card.due_day, 0,
                  );
                  return (
                    <p className="text-xs text-blue-500 dark:text-blue-400 mt-1 flex items-center gap-1">
                      <Info className="w-3 h-3 shrink-0" />
                      Vencimento da fatura: {formatDateBR(due)}
                    </p>
                  );
                })()}
              </div>
            )}
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

          {/* Row 3: Vencimento — hidden when installment mode is on */}
          {!isInstallment && (
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
          )}

          {/* ── Compra Parcelada ── */}
          <div className="pt-1">
            <button type="button"
              onClick={() => { setIsInstallment(v => !v); if (isInstallment) setInstallments([]); }}
              className="flex items-center gap-2.5 group">
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                isInstallment
                  ? 'bg-blue-600 border-blue-600 shadow-sm shadow-blue-500/20'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 group-hover:border-blue-400 dark:group-hover:border-blue-500'
              }`}>
                {isInstallment && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </div>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 select-none">
                Compra Parcelada
              </span>
            </button>
          </div>

          {isInstallment && (
            <div className="space-y-3 p-4 bg-blue-50/60 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-700/50 rounded-xl">
              {/* Count + Generate */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider whitespace-nowrap">
                    Nº de Parcelas
                  </span>
                  <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-xl overflow-hidden bg-white dark:bg-slate-800">
                    <button type="button" onClick={() => setInstallmentCount(v => Math.max(2, v - 1))}
                      className="px-2.5 py-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                      <Minus className="w-3 h-3" />
                    </button>
                    <input type="number" min={2} max={99} value={installmentCount}
                      onChange={e => setInstallmentCount(Math.max(2, Math.min(99, parseInt(e.target.value) || 2)))}
                      className="w-12 text-center text-sm font-bold text-slate-800 dark:text-white bg-transparent border-0 focus:outline-none py-2" />
                    <button type="button" onClick={() => setInstallmentCount(v => Math.min(99, v + 1))}
                      className="px-2.5 py-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <button type="button" onClick={generateInstallments} disabled={total === 0}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-50 shadow-sm shadow-blue-500/20">
                  <Layers className="w-3.5 h-3.5" />
                  Gerar Parcelas
                </button>
                {total === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Adicione itens para calcular
                  </p>
                )}
              </div>

              {/* Installment rows */}
              {installments.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-[28px_1fr_130px_28px] gap-2 px-1">
                    {['#', 'Data de Vencimento', 'Valor', ''].map(h => (
                      <p key={h} className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{h}</p>
                    ))}
                  </div>
                  {installments.map((inst, i) => (
                    <div key={i} className="grid grid-cols-[28px_1fr_130px_28px] gap-2 items-center">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400 text-center">{i + 1}×</span>
                      <div className="relative">
                        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                        <input type="date" value={inst.due_date}
                          onChange={e => updateInstallment(i, 'due_date', e.target.value)}
                          className="w-full pl-7 pr-2 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors dark:[color-scheme:dark]" />
                      </div>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none select-none">R$</span>
                        <input type="text" inputMode="decimal"
                          value={inst.amount_display ?? inst.amount.toFixed(2)}
                          onChange={e => updateInstallment(i, 'amount', e.target.value)}
                          className="w-full pl-7 pr-2 py-2 text-sm font-bold rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors" />
                      </div>
                      <button type="button" onClick={() => removeInstallment(i)} title="Remover parcela"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  <div className="flex items-center justify-between pt-1 px-1">
                    <button type="button" onClick={addInstallmentRow}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Adicionar parcela
                    </button>
                    {(() => {
                      const instTotal = installments.reduce((s, v) => s + v.amount, 0);
                      const diff = Math.abs(instTotal - total);
                      const ok = diff < 0.01;
                      return (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 dark:text-slate-400">Total parcelado:</span>
                          <span className={`text-sm font-bold ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            {fmtBRL(instTotal)}
                            {!ok && <span className="text-xs ml-1 font-normal">(dif. {fmtBRL(diff)})</span>}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

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
                          {item.isNew && (
                            <button
                              type="button"
                              onClick={() => { setLinkingIdx(linkingIdx === idx ? null : idx); setLinkSearch(''); }}
                              title="Vincular a um produto já cadastrado em vez de criar um novo"
                              className="px-1.5 py-0.5 rounded text-[10px] font-bold border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors shrink-0"
                            >
                              {linkingIdx === idx ? 'Cancelar' : 'Vincular a existente'}
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{category}</p>
                        {item.isNew && linkingIdx === idx && (
                          <div className="relative mt-1.5" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              autoFocus
                              value={linkSearch}
                              onChange={e => setLinkSearch(e.target.value)}
                              placeholder="Buscar produto existente…"
                              className="w-full max-w-xs px-2 py-1 text-xs rounded-lg border border-violet-300 dark:border-violet-700 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-400"
                            />
                            {linkSearch.trim() && (
                              <div className="absolute z-30 mt-1 w-full max-w-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
                                {products
                                  .filter(p => p.name.toLowerCase().includes(linkSearch.toLowerCase()))
                                  .slice(0, 6)
                                  .map(p => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => linkItemToProduct(idx, p)}
                                      className="w-full text-left px-3 py-2 text-xs hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                                    >
                                      <span className="font-semibold text-slate-800 dark:text-slate-100">{p.name}</span>
                                      <span className="text-slate-400 ml-1.5">{p.category}</span>
                                    </button>
                                  ))}
                                {products.filter(p => p.name.toLowerCase().includes(linkSearch.toLowerCase())).length === 0 && (
                                  <p className="px-3 py-2 text-xs text-slate-400 text-center">Nenhum produto encontrado.</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {/* cEAN + IBS/CBS */}
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400 font-medium shrink-0">cEAN</span>
                            <input
                              type="text"
                              placeholder="0000000000000"
                              value={item.cean ?? ''}
                              onChange={e => updateCean(idx, e.target.value)}
                              maxLength={14}
                              onClick={e => e.stopPropagation()}
                              className="w-32 px-1.5 py-0.5 text-xs rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono focus:outline-none focus:ring-1 focus:ring-orange-400/50 focus:border-orange-400 transition-colors"
                            />
                          </div>
                          {((item.ibs ?? 0) > 0 || (item.cbs ?? 0) > 0) && (
                            <div className="flex items-center gap-1.5">
                              {(item.ibs ?? 0) > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 font-mono border border-teal-200 dark:border-teal-800">
                                  IBS R${item.ibs!.toFixed(2)}
                                </span>
                              )}
                              {(item.cbs ?? 0) > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 font-mono border border-purple-200 dark:border-purple-800">
                                  CBS R${item.cbs!.toFixed(2)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
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

      {selectedHotel && (
        <NFeXMLImportModal
          isOpen={showNFeModal}
          onClose={() => setShowNFeModal(false)}
          currentItems={items}
          hotelId={selectedHotel.id}
          onConfirm={handleNFeConfirm}
          initialXml={nfeXmlFromState}
        />
      )}

      {selectedHotel && (
        <SupplierQuickCreateModal
          isOpen={showNewSupplier}
          hotelId={selectedHotel.id}
          onClose={() => setShowNewSupplier(false)}
          onSaved={handleSupplierCreated}
        />
      )}
    </div>
  );
};

export default NewPurchase;
