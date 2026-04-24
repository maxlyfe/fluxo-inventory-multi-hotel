import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { History, ArrowLeft, Download, Calendar, Search, Filter, X, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, Eye, DollarSign, Package, ShoppingBag, Truck, CheckCircle, XCircle, Clock, Ban, ThumbsUp, Send, Archive, ListFilter, Image as ImageIcon, Globe, ExternalLink, CreditCard, ShoppingCart } from 'lucide-react';
import { format, parseISO, isAfter, isBefore, isEqual, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { getBudgetHistory, cancelBudget, updateBudgetStatus, markBudgetPurchased, supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import * as XLSX from 'xlsx';

const unitOptions = [
  { value: '', label: 'Selecione' }, { value: 'kg', label: 'kg (Quilograma)' }, { value: 'g', label: 'g (Grama)' },
  { value: 'l', label: 'l (Litro)' }, { value: 'ml', label: 'ml (Mililitro)' }, { value: 'und', label: 'und (Unidade)' },
  { value: 'cx', label: 'cx (Caixa)' }, { value: 'pct', label: 'pct (Pacote)' }, { value: 'fardo', label: 'fardo (Fardo)' },
  { value: 'balde', label: 'balde (Balde)' }, { value: 'saco', label: 'saco (Saco)' }, { value: 'outro', label: 'Outro' }
];

interface BudgetItem {
  id: string; product_id: string | null; custom_item_name: string | null; quantity: number; unit_price: number | null;
  supplier: string | null; last_purchase_quantity: number | null; last_purchase_price: number | null;
  last_purchase_date: string | null; weight: number | null; unit: string | null; stock_at_creation: number | null;
  item_status: 'pending' | 'approved' | 'rejected' | null; is_online: boolean | null; product_link: string | null;
  image_urls: string[] | null; shipping_cost: number | null; payment_type: 'cash' | 'installment' | null;
  installments: number | null; installment_value: number | null;
  product: { id: string; name: string; category?: string } | null;
}

interface Budget {
  id: string; created_at: string; total_value: number; budget_items: BudgetItem[];
  status: 'pending' | 'approved' | 'on_the_way' | 'delivered' | 'cancelled' | null;
  approved_by_user_email?: string | null; approved_at?: string | null; is_online?: boolean | null;
  purchased_at?: string | null; actual_value?: number | null; purchased_by_email?: string | null;
}

type ViewMode = 'pending' | 'approved' | 'on_the_way' | 'archived';

const BudgetHistory = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const { user } = useAuth();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [filteredAndSortedBudgets, setFilteredAndSortedBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBudget, setExpandedBudget] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('pending');
  const [filters, setFilters] = useState({ supplier: '', startDate: '', endDate: '', productName: '', showFilters: false });
  const [purchaseModal, setPurchaseModal] = useState<{ budgetId: string; totalValue: number } | null>(null);
  const [actualValue, setActualValue] = useState('');
  const [carouselIndex, setCarouselIndex] = useState<Record<string, number>>({});
  const setItemCarousel = (itemId: string, idx: number) => setCarouselIndex(prev => ({ ...prev, [itemId]: idx }));
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const [suppliers, setSuppliers] = useState<string[]>([]);

  const fetchBudgets = useCallback(async () => {
    if (!selectedHotel?.id) { setError('Hotel não selecionado'); setLoading(false); return; }
    try {
      setLoading(true); setError(null);
      const result = await getBudgetHistory(selectedHotel.id);
      if (result.success && result.data) {
        const sortedData = result.data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setBudgets(sortedData || []);
        const uniqueSuppliers = new Set<string>();
        sortedData?.forEach(budget => budget.budget_items.forEach(item => { if (item.supplier?.trim()) uniqueSuppliers.add(item.supplier); }));
        setSuppliers(Array.from(uniqueSuppliers).sort());
      } else throw new Error(result.error || 'Falha ao buscar histórico');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(`Erro ao carregar orçamentos: ${message}`);
      addNotification(`Erro ao carregar orçamentos: ${message}`, 'error');
    } finally { setLoading(false); }
  }, [selectedHotel, addNotification]);

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  const applyFiltersAndSort = useCallback(() => {
    let result = [...budgets];
    if (filters.supplier) result = result.filter(b => b.budget_items.some(i => i.supplier?.toLowerCase().includes(filters.supplier.toLowerCase())));
    if (filters.startDate) {
      try { const d = parseISO(filters.startDate + 'T00:00:00'); if (isValid(d)) result = result.filter(b => { const bd = parseISO(b.created_at); return isValid(bd) && (isAfter(bd, d) || isEqual(bd, d)); }); } catch {}
    }
    if (filters.endDate) {
      try { const d = parseISO(filters.endDate + 'T23:59:59'); if (isValid(d)) result = result.filter(b => { const bd = parseISO(b.created_at); return isValid(bd) && (isBefore(bd, d) || isEqual(bd, d)); }); } catch {}
    }
    if (filters.productName) { const s = filters.productName.toLowerCase(); result = result.filter(b => b.budget_items.some(i => (i.custom_item_name || i.product?.name || '').toLowerCase().includes(s))); }
    if (viewMode === 'pending') result = result.filter(b => b.status === 'pending' || b.status === null);
    else if (viewMode === 'approved') result = result.filter(b => b.status === 'approved');
    else if (viewMode === 'on_the_way') result = result.filter(b => b.status === 'on_the_way');
    else result = result.filter(b => b.status === 'delivered' || b.status === 'cancelled');
    setFilteredAndSortedBudgets(result);
  }, [budgets, filters, viewMode]);

  useEffect(() => { applyFiltersAndSort(); }, [applyFiltersAndSort]);

  const clearFilters = () => setFilters({ supplier: '', startDate: '', endDate: '', productName: '', showFilters: true });

  const getMainSupplier = (budget: Budget): string => {
    const specs = budget.budget_items.map(i => i.supplier).filter((s): s is string => !!s && s.trim() !== '');
    if (!specs.length) return 'Não especificado';
    const counts: Record<string, number> = {};
    specs.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
    let main = specs[0], max = 0;
    Object.entries(counts).forEach(([s, c]) => { if (c > max) { max = c; main = s; } });
    return Object.keys(counts).length > 1 ? `${main} (e outros)` : main;
  };

  const getStatusInfo = (status: Budget['status']) => {
    switch (status) {
      case 'approved': return { icon: ThumbsUp, color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'bg-cyan-100 dark:bg-cyan-900/30', label: 'Aprovado' };
      case 'on_the_way': return { icon: Send, color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30', label: 'A Caminho' };
      case 'delivered': return { icon: CheckCircle, color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-100 dark:bg-emerald-900/30', label: 'Entregue' };
      case 'cancelled': return { icon: Ban, color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-100 dark:bg-red-900/30', label: 'Cancelado' };
      default: return { icon: Clock, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-100 dark:bg-amber-900/30', label: 'Pendente' };
    }
  };

  const toggleBudgetExpand = (budgetId: string) => setExpandedBudget(prev => prev === budgetId ? null : budgetId);

  const getUnitLabel = (unitValue: string | null | undefined): string => {
    if (!unitValue) return '-';
    return unitOptions.find(o => o.value === unitValue)?.label || unitValue;
  };

  const captureAndCopyToClipboard = async (budget: Budget) => {
    try {
      if (!budget.budget_items.length) { addNotification('Orçamento vazio.', 'warning'); return; }
      addNotification('Preparando imagem do orçamento...', 'info');
      const today = format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR });
      const mainSupplier = getMainSupplier(budget);
      const tableHTML = `<div style="font-family: Arial, sans-serif; padding: 20px; background: white; color: #333; width: 1000px;"><div style="display: flex; justify-content: space-between; margin-bottom: 20px;"><h2 style="font-size: 24px; margin: 0;">Orçamento - ${selectedHotel?.name || 'Hotel'}</h2><div>${today}</div></div><table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;"><thead><tr style="background-color: #f9fafb; text-align: left;"><th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Item</th><th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Quantidade</th><th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Unidade</th><th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Fornecedor</th><th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Unitário</th><th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Total</th></tr></thead><tbody>${budget.budget_items.map((item, index) => { const q = item.quantity ?? 0; const p = item.unit_price ?? 0; return `<tr style="background-color: ${index % 2 === 0 ? '#ffffff' : '#f9fafb'};"><td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.custom_item_name || item.product?.name || 'Item'}</td><td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${q}</td><td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${getUnitLabel(item.unit)}</td><td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.supplier || '-'}</td><td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${p != null ? `R$ ${p.toFixed(2).replace('.', ',')}` : '-'}</td><td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">R$ ${(q * p).toFixed(2).replace('.', ',')}</td></tr>`; }).join('')}</tbody><tfoot><tr style="background-color: #f9fafb;"><td colspan="5" style="padding: 12px; border-top: 2px solid #e5e7eb; text-align: right; font-weight: bold;">Total Geral:</td><td style="padding: 12px; border-top: 2px solid #e5e7eb; font-weight: bold;">R$ ${budget.total_value.toFixed(2).replace('.', ',')}</td></tr></tfoot></table><div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; color: #444;"><p style="margin: 0 0 5px 0; font-size: 16px;"><strong>${mainSupplier},</strong></p><p style="margin: 5px 0; font-size: 14px;">FANTASIA: <strong>${selectedHotel?.fantasy_name || selectedHotel?.name || 'Hotel'}</strong></p><p style="margin: 5px 0; font-size: 14px;">RAZÃO SOCIAL: ${selectedHotel?.corporate_name || ''}</p>${selectedHotel?.cnpj ? `<p style="margin: 5px 0; font-size: 14px;">CNPJ: ${selectedHotel.cnpj}</p>` : ''}</div></div>`;
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = tableHTML;
      tempDiv.style.position = 'absolute'; tempDiv.style.left = '-9999px';
      document.body.appendChild(tempDiv);
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(tempDiv.firstElementChild as HTMLElement, { scale: 2, backgroundColor: null, logging: false, useCORS: true });
      document.body.removeChild(tempDiv);
      canvas.toBlob(async (blob) => {
        if (blob) {
          try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); addNotification('Imagem copiada com sucesso!', 'success'); }
          catch { addNotification('Erro ao copiar imagem. Tente novamente.', 'error'); }
        }
      }, 'image/png');
    } catch { addNotification('Erro ao gerar imagem do orçamento.', 'error'); }
  };

  const exportBudgetToExcel = (budget: Budget) => {
    const listData = budget.budget_items.map(item => {
      const totalItemValue = item.quantity * (item.unit_price || 0);
      return { 'Data': format(parseISO(budget.created_at), 'dd/MM/yyyy', { locale: ptBR }), 'Item': item.custom_item_name || item.product?.name || 'Item', 'Categoria': item.product?.category || '-', 'Quantidade': item.quantity, 'Unidade': getUnitLabel(item.unit), 'Fornecedor': item.supplier || '-', 'Qtd. Última Compra': item.last_purchase_quantity ?? '-', 'Data Última Compra': item.last_purchase_date ? format(parseISO(item.last_purchase_date), 'dd/MM/yyyy', { locale: ptBR }) : '-', 'Valor Última Compra': item.last_purchase_price != null ? `R$ ${item.last_purchase_price.toFixed(2).replace('.', ',')}` : '-', 'Valor Unitário': item.unit_price != null ? `R$ ${item.unit_price.toFixed(2).replace('.', ',')}` : '-', 'Valor Total Item': `R$ ${totalItemValue.toFixed(2).replace('.', ',')}`, 'Peso (kg)': item.weight ?? '-', 'Estoque (Orçam.)': item.stock_at_creation ?? '-' };
    });
    listData.push({ 'Data': '', 'Item': 'TOTAL GERAL', 'Categoria': '', 'Quantidade': '', 'Unidade': '', 'Fornecedor': '', 'Qtd. Última Compra': '', 'Data Última Compra': '', 'Valor Última Compra': '', 'Valor Unitário': '', 'Valor Total Item': `R$ ${budget.total_value.toFixed(2).replace('.', ',')}`, 'Peso (kg)': '', 'Estoque (Orçam.)': '' });
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.json_to_sheet(listData);
    ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Orçamento');
    try { const mainSupplier = getMainSupplier(budget); XLSX.writeFile(wb, `orcamento-${format(parseISO(budget.created_at), 'dd-MM-yyyy')}-${mainSupplier.replace(/[^a-zA-Z0-9]/g, '_')}-${budget.id.slice(0, 8)}.xlsx`); addNotification('Exportado com sucesso!', 'success'); }
    catch { addNotification('Erro ao exportar.', 'error'); }
  };

  const handleRegisterEntry = (budget: Budget) => {
    if (!(budget.status === 'pending' || budget.status === null || budget.status === 'approved' || budget.status === 'on_the_way')) { addNotification('Status não permite registro de entrada.', 'warning'); return; }
    navigate('/inventory/new-purchase', { state: { budgetData: budget } });
  };

  const handleSetOnTheWay = async (budgetId: string) => {
    if (!window.confirm('Marcar como "A Caminho"?')) return;
    try { setLoading(true); const result = await updateBudgetStatus(budgetId, 'on_the_way'); if (result.success) { addNotification('Status atualizado!', 'success'); setBudgets(prev => prev.map(b => b.id === budgetId ? { ...b, status: 'on_the_way' } : b)); } else throw new Error(result.error); }
    catch (err) { addNotification(`Erro: ${err instanceof Error ? err.message : 'Desconhecido'}`, 'error'); }
    finally { setLoading(false); }
  };

  const handleCancelBudget = async (budgetId: string) => {
    if (!window.confirm('Cancelar este orçamento? Esta ação não pode ser desfeita.')) return;
    try { setLoading(true); const result = await cancelBudget(budgetId); if (result.success) { addNotification('Orçamento cancelado!', 'success'); setBudgets(prev => prev.map(b => b.id === budgetId ? { ...b, status: 'cancelled' } : b)); } else throw new Error(result.error); }
    catch (err) { addNotification(`Erro: ${err instanceof Error ? err.message : 'Desconhecido'}`, 'error'); }
    finally { setLoading(false); }
  };

  const handleMarkPurchased = async () => {
    if (!purchaseModal) return;
    const value = parseFloat(actualValue.replace(',', '.'));
    if (isNaN(value) || value <= 0) { addNotification('Informe o valor real pago.', 'warning'); return; }
    try {
      setLoading(true);
      const result = await markBudgetPurchased(purchaseModal.budgetId, value, user?.email ?? 'Usuário');
      if (result.success) {
        addNotification('Compra registrada com sucesso! 🛍️', 'success');
        setBudgets(prev => prev.map(b => b.id === purchaseModal.budgetId ? { ...b, status: 'delivered', actual_value: value, purchased_by_email: user?.email ?? null, purchased_at: new Date().toISOString() } : b));
        setPurchaseModal(null); setActualValue('');
      } else throw new Error(result.error);
    } catch (err) { addNotification(err instanceof Error ? err.message : 'Erro desconhecido.', 'error'); }
    finally { setLoading(false); }
  };

  const renderBudgetCard = (budget: Budget) => {
    const mainSupplier = getMainSupplier(budget);
    const formattedDate = format(parseISO(budget.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR });
    const budgetId = budget.id.slice(0, 8);
    const statusInfo = getStatusInfo(budget.status);
    const isExpanded = expandedBudget === budget.id;
    const isPending = budget.status === 'pending' || budget.status === null;
    const isApproved = budget.status === 'approved';
    const isOnTheWay = budget.status === 'on_the_way';
    const isDelivered = budget.status === 'delivered';
    const isOnline = !!budget.is_online;
    const firstImg = isOnline ? budget.budget_items.find(i => i.image_urls?.length)?.image_urls?.[0] : null;

    return (
      <div key={budget.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        {isOnline && <div className="h-1 bg-gradient-to-r from-cyan-400 to-blue-500" />}
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center text-xs text-slate-400"><Calendar className="h-3.5 w-3.5 mr-1.5 shrink-0" />{formattedDate}</div>
              {isOnline && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 text-xs font-bold border border-cyan-200 dark:border-cyan-700">
                  <Globe className="h-3 w-3" />Online
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                R$ {budget.total_value.toFixed(2).replace('.', ',')}
              </span>
              {isOnline && isDelivered && budget.actual_value && budget.actual_value !== budget.total_value && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">Pago: R$ {budget.actual_value.toFixed(2).replace('.', ',')}</span>
              )}
              <span className={`px-2.5 py-1 inline-flex items-center text-xs font-bold rounded-full ${statusInfo.bgColor} ${statusInfo.color}`}>
                <statusInfo.icon className="h-3 w-3 mr-1 shrink-0" />{statusInfo.label}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3 mb-3">
            {firstImg && (
              <img src={firstImg} alt="" className="w-14 h-14 object-cover rounded-xl border border-slate-200 dark:border-slate-600 shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-purple-700 dark:text-purple-300">{isOnline ? '🛒 Compra Online' : `Orçamento #${budgetId}`}</h3>
              <div className="flex items-center mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                <ShoppingBag className="h-4 w-4 mr-1.5 text-slate-400 shrink-0" />
                {isOnline ? `${budget.budget_items.length} produto${budget.budget_items.length !== 1 ? 's' : ''} · ${mainSupplier}` : `Fornecedor: ${mainSupplier}`}
              </div>
              {(isApproved || isOnTheWay || isDelivered) && budget.approved_by_user_email && budget.approved_at && (
                <div className="text-xs mt-1 text-slate-400">Aprovado por: {budget.approved_by_user_email.split('@')[0]} em {format(parseISO(budget.approved_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</div>
              )}
              {isOnline && isDelivered && budget.purchased_at && (
                <div className="text-xs mt-1 text-emerald-600 dark:text-emerald-400">
                  🛍️ Comprado em {format(parseISO(budget.purchased_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                  {budget.purchased_by_email ? ` por ${budget.purchased_by_email.split('@')[0]}` : ''}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700 gap-2">
            <button onClick={() => toggleBudgetExpand(budget.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-purple-600 dark:text-slate-300 dark:hover:text-purple-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <span>{isExpanded ? 'Ocultar' : 'Ver Itens'}</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
            <div className="flex flex-wrap gap-1.5">
              {!isOnline && isPending && <button onClick={() => handleRegisterEntry(budget)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-colors"><Truck className="h-3.5 w-3.5" />Entrada</button>}
              {!isOnline && isApproved && (<><button onClick={() => handleSetOnTheWay(budget.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-colors"><Send className="h-3.5 w-3.5" />A Caminho</button><button onClick={() => handleRegisterEntry(budget)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-colors"><Truck className="h-3.5 w-3.5" />Entrada</button></>)}
              {!isOnline && isOnTheWay && <button onClick={() => handleRegisterEntry(budget)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-colors"><Truck className="h-3.5 w-3.5" />Entrada</button>}
              {isOnline && isApproved && <button onClick={() => handleSetOnTheWay(budget.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-colors"><Send className="h-3.5 w-3.5" />A Caminho</button>}
              {isOnline && isOnTheWay && <button onClick={() => { setPurchaseModal({ budgetId: budget.id, totalValue: budget.total_value }); setActualValue(budget.total_value.toFixed(2)); }} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-colors"><ShoppingCart className="h-3.5 w-3.5" />Registrar Compra</button>}
              {(isPending || isApproved || isOnTheWay) && <button onClick={() => handleCancelBudget(budget.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors"><Ban className="h-3.5 w-3.5" />Cancelar</button>}
              {!isOnline && <button onClick={() => captureAndCopyToClipboard(budget)} className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-600 hover:text-purple-600 dark:text-slate-300 dark:hover:text-purple-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"><ImageIcon className="h-3.5 w-3.5" />Copiar Imagem</button>}
              <Link to={`/budget/${budget.id}`} state={{ originatingPage: '/budget-history' }} className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-600 hover:text-purple-600 dark:text-slate-300 dark:hover:text-purple-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"><Eye className="h-3.5 w-3.5" />Detalhes</Link>
            </div>
          </div>
        </div>

        {isExpanded && (
          <div className="bg-slate-50 dark:bg-slate-900/40 p-4 border-t border-slate-200 dark:border-slate-700">
            <h4 className="text-sm font-bold mb-3 text-slate-700 dark:text-slate-200">{isOnline ? 'Produtos da Compra Online' : 'Itens do Orçamento:'}</h4>
            {budget.budget_items && budget.budget_items.length > 0 ? (
              isOnline ? (
                <div className="space-y-4">
                  {budget.budget_items.map(item => {
                    const imgs = item.image_urls || [];
                    const imgIdx = carouselIndex[item.id] || 0;
                    const priceAVista = item.unit_price || 0;
                    const totalParcelado = item.payment_type === 'installment' && item.installments && item.installment_value ? item.installments * item.installment_value : 0;
                    const frete = item.shipping_cost || 0;
                    const usedPrice = item.payment_type === 'installment' ? totalParcelado : priceAVista;
                    const totalItem = (usedPrice + frete) * (item.quantity || 1);
                    return (
                      <div key={item.id} className={`rounded-2xl border-2 overflow-hidden bg-white dark:bg-slate-800 shadow-sm ${item.item_status === 'approved' ? 'border-emerald-400 dark:border-emerald-600' : item.item_status === 'rejected' ? 'border-red-300 dark:border-red-700 opacity-70' : 'border-slate-200 dark:border-slate-600'}`}>
                        {imgs.length > 0 && (
                          <div className="relative h-44 bg-slate-100 dark:bg-slate-900 group">
                            <img src={imgs[imgIdx]} alt={item.custom_item_name || ''} className="w-full h-full object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            {imgs.length > 1 && (<>
                              <button onClick={() => setItemCarousel(item.id, (imgIdx - 1 + imgs.length) % imgs.length)} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><ChevronLeft className="h-4 w-4" /></button>
                              <button onClick={() => setItemCarousel(item.id, (imgIdx + 1) % imgs.length)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><ChevronRight className="h-4 w-4" /></button>
                              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">{imgs.map((_, i) => (<button key={i} onClick={() => setItemCarousel(item.id, i)} className={`h-1.5 rounded-full transition-all ${i === imgIdx ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`} />))}</div>
                            </>)}
                            {(item.item_status === 'approved' || item.item_status === 'rejected') && (
                              <span className={`absolute top-2 left-2 text-xs font-bold px-2 py-1 rounded-full shadow ${item.item_status === 'approved' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>{item.item_status === 'approved' ? '✓ Aprovado' : '✗ Rejeitado'}</span>
                            )}
                          </div>
                        )}
                        <div className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-base font-bold text-slate-900 dark:text-white leading-snug flex-1">{item.custom_item_name || 'Produto'}</p>
                            {item.product_link && (<a href={item.product_link} target="_blank" rel="noopener noreferrer" className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-semibold hover:bg-blue-100 transition-colors border border-blue-200 dark:border-blue-700"><ExternalLink className="h-3.5 w-3.5" />Ver anúncio</a>)}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className={`rounded-xl p-2.5 border-2 ${item.payment_type !== 'installment' ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/30 opacity-50'}`}>
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">À vista</p>
                              <p className="text-sm font-black text-emerald-700 dark:text-emerald-400">{fmtBRL(priceAVista)}</p>
                            </div>
                            <div className={`rounded-xl p-2.5 border-2 ${item.payment_type === 'installment' ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/30 opacity-50'}`}>
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">Parcelado</p>
                              {item.installments && item.installment_value ? <p className="text-sm font-black text-blue-700 dark:text-blue-400">{item.installments}x {fmtBRL(item.installment_value)}</p> : <p className="text-sm text-slate-400">—</p>}
                            </div>
                          </div>
                          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${frete === 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400'}`}>
                            <Truck className="h-4 w-4 shrink-0" />
                            {frete === 0 ? <span className="font-semibold">Frete grátis</span> : <span>Frete: <span className="font-bold">{fmtBRL(frete)}</span> por unidade</span>}
                          </div>
                          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl px-4 py-3 border border-indigo-100 dark:border-indigo-800/30 flex items-center justify-between">
                            <div>
                              <p className="text-[11px] font-bold text-indigo-400 uppercase tracking-wide">{item.quantity}x · {item.payment_type === 'installment' ? `${item.installments}x parcelado` : 'à vista'}{frete > 0 ? ' + frete' : ''}</p>
                              <p className="text-xl font-black text-indigo-700 dark:text-indigo-300">{fmtBRL(totalItem)}</p>
                            </div>
                            {item.payment_type === 'installment' && totalParcelado > 0 && priceAVista > 0 && totalParcelado > priceAVista && (
                              <p className="text-xs text-orange-500 dark:text-orange-400 text-right">+{fmtBRL(totalParcelado - priceAVista)}<br /><span className="text-[11px]">juros</span></p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ul className="space-y-2">
                  {budget.budget_items.map(item => (
                    <li key={item.id} className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
                      <div className="font-semibold text-sm text-slate-800 dark:text-slate-100">{item.custom_item_name || item.product?.name || 'Item não especificado'}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Quantidade: {item.quantity} {getUnitLabel(item.unit)} {item.unit_price ? `| Preço Unit.: R$ ${item.unit_price.toFixed(2).replace('.', ',')}` : ''}</div>
                      {item.supplier && <div className="text-xs text-slate-400">Fornecedor: {item.supplier}</div>}
                      {item.last_purchase_price && <div className="text-xs text-slate-400">Última Compra: R$ {item.last_purchase_price.toFixed(2).replace('.', ',')} ({item.last_purchase_quantity} {getUnitLabel(item.unit)} em {item.last_purchase_date ? format(parseISO(item.last_purchase_date), 'dd/MM/yy') : 'N/A'})</div>}
                    </li>
                  ))}
                </ul>
              )
            ) : <p className="text-sm text-slate-400">Nenhum item neste orçamento.</p>}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="flex justify-center items-center h-screen"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-purple-500" /></div>;
  if (error) return (
    <div className="max-w-md mx-auto p-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4"><X className="w-7 h-7 text-red-500" /></div>
      <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Erro ao Carregar</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{error}</p>
      <button onClick={fetchBudgets} className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold text-sm mx-auto"><RefreshCw className="h-4 w-4" />Tentar Novamente</button>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 text-slate-500 hover:text-purple-600 dark:text-slate-400 dark:hover:text-purple-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
          <History className="w-5 h-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white leading-tight">Histórico de Orçamentos</h1>
          <p className="text-xs text-slate-400">{budgets.length} orçamento{budgets.length !== 1 ? 's' : ''} no total</p>
        </div>
      </div>

      {/* View Mode Tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: 'pending' as ViewMode, label: 'Pendentes', icon: Clock, color: 'amber' },
          { key: 'approved' as ViewMode, label: 'Aprovados', icon: ThumbsUp, color: 'cyan' },
          { key: 'on_the_way' as ViewMode, label: 'A Caminho', icon: Send, color: 'indigo' },
          { key: 'archived' as ViewMode, label: 'Histórico', icon: Archive, color: 'slate' },
        ]).map(tab => {
          const count = budgets.filter(b => { if (tab.key === 'pending') return b.status === 'pending' || b.status === null; if (tab.key === 'approved') return b.status === 'approved'; if (tab.key === 'on_the_way') return b.status === 'on_the_way'; return b.status === 'delivered' || b.status === 'cancelled'; }).length;
          const isActive = viewMode === tab.key;
          return (
            <button key={tab.key} onClick={() => setViewMode(tab.key)}
              className={`px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-all ${isActive ? 'bg-purple-600 text-white shadow-md scale-105' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
              <tab.icon className="h-4 w-4" />{tab.label}
              {count > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="flex justify-between items-center p-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2"><Filter className="w-4 h-4" />Filtros</h3>
          <button onClick={() => setFilters(prev => ({ ...prev, showFilters: !prev.showFilters }))} className="text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300 flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            {filters.showFilters ? 'Ocultar' : 'Mostrar'}
            <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${filters.showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {filters.showFilters && (
          <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-t border-slate-200 dark:border-slate-700 pt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Fornecedor</label>
              <select value={filters.supplier} onChange={e => setFilters(prev => ({ ...prev, supplier: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500">
                <option value="">Todos</option>
                {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Data Início</label>
              <input type="date" value={filters.startDate} onChange={e => setFilters(prev => ({ ...prev, startDate: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Data Fim</label>
              <input type="date" value={filters.endDate} onChange={e => setFilters(prev => ({ ...prev, endDate: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Produto</label>
              <input type="text" placeholder="Buscar por nome..." value={filters.productName} onChange={e => setFilters(prev => ({ ...prev, productName: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
              <button onClick={clearFilters} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors">
                <X className="h-4 w-4" />Limpar Filtros
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {filteredAndSortedBudgets.length === 0 && !loading && (
        <div className="text-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-3">
            <Package className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Nenhum orçamento em "{{ pending: 'Pendentes', approved: 'Aprovados', on_the_way: 'A Caminho', archived: 'Histórico' }[viewMode]}"
          </p>
          {(filters.supplier || filters.startDate || filters.endDate || filters.productName) && (
            <button onClick={clearFilters} className="mt-4 flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-xl mx-auto transition-colors">
              <X className="h-4 w-4" />Limpar Filtros
            </button>
          )}
        </div>
      )}

      {filteredAndSortedBudgets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSortedBudgets.map(budget => renderBudgetCard(budget))}
        </div>
      )}

      {/* Modal Registrar Compra Online */}
      {purchaseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm p-6 shadow-2xl border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">🛍️ Registrar Compra</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">Estimado: <span className="font-semibold text-slate-700 dark:text-slate-300">R$ {purchaseModal.totalValue.toFixed(2).replace('.', ',')}</span></p>
            <div className="mb-5">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Valor real pago (R$)*</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">R$</span>
                <input type="number" value={actualValue} onChange={e => setActualValue(e.target.value)} placeholder="0,00" step="0.01" min="0" autoFocus
                  className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 text-lg font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setPurchaseModal(null); setActualValue(''); }} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancelar</button>
              <button onClick={handleMarkPurchased} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-colors shadow-sm">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetHistory;
