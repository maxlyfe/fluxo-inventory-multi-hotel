import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { History, ArrowLeft, Download, Calendar, Search, Filter, X, RefreshCw, ChevronDown, Eye, DollarSign, Package, ShoppingBag, Truck, CheckCircle, XCircle, Clock, Ban, ThumbsUp, Send, Archive, ListFilter, Image as ImageIcon } from 'lucide-react';
import { format, parseISO, isAfter, isBefore, isEqual, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { getBudgetHistory, cancelBudget, updateBudgetStatus } from '../lib/supabase';
import * as XLSX from 'xlsx';

const unitOptions = [
  { value: '', label: 'Selecione' },
  { value: 'kg', label: 'kg (Quilograma)' },
  { value: 'g', label: 'g (Grama)' },
  { value: 'l', label: 'l (Litro)' },
  { value: 'ml', label: 'ml (Mililitro)' },
  { value: 'und', label: 'und (Unidade)' },
  { value: 'cx', label: 'cx (Caixa)' },
  { value: 'pct', label: 'pct (Pacote)' },
  { value: 'fardo', label: 'fardo (Fardo)' },
  { value: 'balde', label: 'balde (Balde)' },
  { value: 'saco', label: 'saco (Saco)' },
  { value: 'outro', label: 'Outro' }
];

interface BudgetItem {
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
  product: {
    id: string;
    name: string;
    category?: string;
  } | null;
}

interface Budget {
  id: string;
  created_at: string;
  total_value: number;
  budget_items: BudgetItem[];
  status: 'pending' | 'approved' | 'on_the_way' | 'delivered' | 'cancelled' | null;
  approved_by_user_email?: string | null;
  approved_at?: string | null;
}

type ViewMode = 'active' | 'archived';

const BudgetHistory = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [filteredAndSortedBudgets, setFilteredAndSortedBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBudget, setExpandedBudget] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('active');
  
  const [filters, setFilters] = useState({
    supplier: '',
    startDate: '',
    endDate: '',
    productName: '',
    showFilters: false
  });
  
  const [suppliers, setSuppliers] = useState<string[]>([]);

  const fetchBudgets = useCallback(async () => {
    if (!selectedHotel?.id) {
      setError('Hotel não selecionado');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await getBudgetHistory(selectedHotel.id);

      if (result.success && result.data) {
        const sortedData = result.data.sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setBudgets(sortedData || []);
        
        const uniqueSuppliers = new Set<string>();
        sortedData?.forEach(budget => {
          budget.budget_items.forEach(item => {
            if (item.supplier && item.supplier.trim() !== '') {
              uniqueSuppliers.add(item.supplier);
            }
          });
        });
        setSuppliers(Array.from(uniqueSuppliers).sort());
      } else {
        throw new Error(result.error || 'Falha ao buscar histórico');
      }
    } catch (err) {
      console.error('Error fetching budgets:', err);
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao buscar orçamentos.';
      setError(`Erro ao carregar orçamentos: ${message}`);
      addNotification(`Erro ao carregar orçamentos: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);

  useEffect(() => {
    fetchBudgets();
  }, [fetchBudgets]);

  const applyFiltersAndSort = useCallback(() => {
    let result = [...budgets];
    
    // Apply general filters first
    if (filters.supplier) {
      result = result.filter(budget => 
        budget.budget_items.some(item => 
          item.supplier && item.supplier.toLowerCase().includes(filters.supplier.toLowerCase())
        )
      );
    }
    if (filters.startDate) {
      try {
        const startDate = parseISO(filters.startDate + 'T00:00:00');
        if (isValid(startDate)) {
          result = result.filter(budget => {
            const budgetDate = parseISO(budget.created_at);
            return isValid(budgetDate) && (isAfter(budgetDate, startDate) || isEqual(budgetDate, startDate));
          });
        }
      } catch { /* Ignore invalid date */ }
    }
    if (filters.endDate) {
      try {
        const endDate = parseISO(filters.endDate + 'T23:59:59');
        if (isValid(endDate)) {
          result = result.filter(budget => {
            const budgetDate = parseISO(budget.created_at);
            return isValid(budgetDate) && (isBefore(budgetDate, endDate) || isEqual(budgetDate, endDate));
          });
        }
      } catch { /* Ignore invalid date */ }
    }
    if (filters.productName) {
      const searchTerm = filters.productName.toLowerCase();
      result = result.filter(budget => 
        budget.budget_items.some(item => {
          const itemName = item.custom_item_name || item.product?.name || '';
          return itemName.toLowerCase().includes(searchTerm);
        })
      );
    }

    // Then filter by view mode (active/archived)
    if (viewMode === 'active') {
      result = result.filter(budget => 
        budget.status === 'pending' || budget.status === 'approved' || budget.status === 'on_the_way' || budget.status === null
      );
    } else { // archived
      result = result.filter(budget => 
        budget.status === 'delivered' || budget.status === 'cancelled'
      );
    }
    
    setFilteredAndSortedBudgets(result);
  }, [budgets, filters, viewMode]);

  useEffect(() => {
    applyFiltersAndSort();
  }, [applyFiltersAndSort]);

  const clearFilters = () => {
    setFilters({
      supplier: '',
      startDate: '',
      endDate: '',
      productName: '',
      showFilters: true // Keep filters section open or decide based on preference
    });
    // applyFiltersAndSort will be called due to state change in filters
  };

  const getMainSupplier = (budget: Budget): string => {
    const specifiedSuppliers = budget.budget_items
      .map(item => item.supplier)
      .filter((supplier): supplier is string => !!supplier && supplier.trim() !== '');
    if (specifiedSuppliers.length === 0) return 'Não especificado';
    const supplierCounts: { [key: string]: number } = {};
    specifiedSuppliers.forEach(supplier => { supplierCounts[supplier] = (supplierCounts[supplier] || 0) + 1; });
    let mainSupplier = specifiedSuppliers[0];
    let maxCount = 0;
    Object.entries(supplierCounts).forEach(([supplier, count]) => { if (count > maxCount) { maxCount = count; mainSupplier = supplier; } });
    return Object.keys(supplierCounts).length > 1 ? `${mainSupplier} (e outros)` : mainSupplier;
  };

  const getStatusInfo = (status: Budget["status"]) => {
    switch (status) {
      case "approved": return { icon: ThumbsUp, color: "text-cyan-600 dark:text-cyan-400", bgColor: "bg-cyan-100 dark:bg-cyan-900/30", label: "Aprovado" };
      case "on_the_way": return { icon: Send, color: "text-indigo-600 dark:text-indigo-400", bgColor: "bg-indigo-100 dark:bg-indigo-900/30", label: "A Caminho" };
      case "delivered": return { icon: CheckCircle, color: "text-green-600 dark:text-green-400", bgColor: "bg-green-100 dark:bg-green-900/30", label: "Entregue" };
      case "cancelled": return { icon: Ban, color: "text-red-600 dark:text-red-400", bgColor: "bg-red-100 dark:bg-red-900/30", label: "Cancelado" };
      case "pending": case null: default: return { icon: Clock, color: "text-yellow-600 dark:text-yellow-400", bgColor: "bg-yellow-100 dark:bg-yellow-900/30", label: "Pendente" };
    }
  };

  const toggleBudgetExpand = (budgetId: string) => {
    setExpandedBudget(prev => prev === budgetId ? null : budgetId);
  };

  const getUnitLabel = (unitValue: string | null | undefined): string => {
    if (!unitValue) return '-';
    const option = unitOptions.find(opt => opt.value === unitValue);
    return option ? option.label : unitValue;
  };

  const captureAndCopyToClipboard = async (budget: Budget) => {
    try {
      if (budget.budget_items.length === 0) {
        addNotification("Orçamento vazio. Adicione itens para gerar a imagem.", "warning");
        return;
      }

      addNotification("Preparando imagem do orçamento...", "info");

      const today = format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR });
      const mainSupplier = getMainSupplier(budget);

      const tableHTML = `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: white; color: #333; width: 1000px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
            <h2 style="font-size: 24px; margin: 0;">Orçamento - ${selectedHotel?.name || 'Hotel'}</h2>
            <div>${today}</div>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #f9fafb; text-align: left;">
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Item</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Quantidade</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Unidade</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Fornecedor</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Unitário</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Total</th>
              </tr>
            </thead>
            <tbody>
              ${budget.budget_items.map((item, index) => {
                const unitDisplay = getUnitLabel(item.unit);
                const quantity = item.quantity ?? 0;
                const price = item.unit_price ?? 0;
                const totalItemValue = quantity * price;
                const bgColor = index % 2 === 0 ? '#ffffff' : '#f9fafb';
                
                let displayDate = '-';
                if (item.last_purchase_date) {
                  try {
                    const parsedDate = parseISO(item.last_purchase_date);
                    if (isValid(parsedDate)) {
                      displayDate = format(parsedDate, 'dd/MM/yyyy', { locale: ptBR });
                    }
                  } catch { /* Ignore */ }
                }
                
                return `
                  <tr style="background-color: ${bgColor};">
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
                      ${item.product?.name || item.custom_item_name || 'Item Desconhecido'}
                    </td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${quantity}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${unitDisplay}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.supplier || '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${price != null ? `R$ ${price.toFixed(2).replace('.', ',')}` : '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${`R$ ${totalItemValue.toFixed(2).replace('.', ',')}`}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background-color: #f9fafb;">
                <td colspan="5" style="padding: 12px; border-top: 2px solid #e5e7eb; text-align: right; font-weight: bold;">Total Geral:</td>
                <td style="padding: 12px; border-top: 2px solid #e5e7eb; font-weight: bold;">R$ ${budget.total_value.toFixed(2).replace('.', ',')}</td>
              </tr>
            </tfoot>
          </table>
          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; color: #444;">
            <p style="margin: 0 0 5px 0; font-size: 16px;"><strong>${mainSupplier},</strong></p>
            <p style="margin: 5px 0; font-size: 14px;">FANTASIA: <strong>${selectedHotel?.fantasy_name || selectedHotel?.name || 'Hotel'}</strong></p>
            <p style="margin: 5px 0; font-size: 14px;">RAZÃO SOCIAL: ${selectedHotel?.corporate_name || 'Meridiana Turismo LTDA'}</p>
            <p style="margin: 5px 0; font-size: 14px;">CNPJ: ${selectedHotel?.cnpj || '39.232.073/0001-44'}</p>
          </div>
        </div>
      `;

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = tableHTML;
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px'; 
      document.body.appendChild(tempDiv);

      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(tempDiv.firstElementChild as HTMLElement, { 
        scale: 2, 
        backgroundColor: null, 
        logging: false, 
        useCORS: true 
      });
      
      document.body.removeChild(tempDiv);

      canvas.toBlob(async (blob) => {
        if (blob) {
          try {
            const hotelText = `
${mainSupplier},

FANTASIA: *${selectedHotel?.fantasy_name || selectedHotel?.name || 'Hotel'}*
RAZÃO SOCIAL: ${selectedHotel?.corporate_name || 'Meridiana Turismo LTDA'}
CNPJ: ${selectedHotel?.cnpj || '39.232.073/0001-44'}
`.trim();

            const data = [
              new ClipboardItem({
                'image/png': blob
              })
            ];

            await navigator.clipboard.write(data);
            addNotification("Imagem do orçamento copiada com sucesso!", "success");
          } catch (clipboardError) {
            console.error('Erro ao copiar para área de transferência:', clipboardError);
            addNotification("Erro ao copiar imagem. Tente novamente.", "error");
          }
        }
      }, 'image/png');
    } catch (err) {
      console.error('Error in captureAndCopyToClipboard:', err);
      addNotification("Erro ao gerar imagem do orçamento.", "error");
    }
  };

  const exportBudgetToExcel = (budget: Budget) => {
    const listData = budget.budget_items.map(item => {
      const totalItemValue = item.quantity * (item.unit_price || 0);
      const unitLabel = getUnitLabel(item.unit);
      const itemName = item.custom_item_name || item.product?.name || 'Item Desconhecido';
      return {
        'Data': format(parseISO(budget.created_at), 'dd/MM/yyyy', { locale: ptBR }), 'Item': itemName, 'Categoria': item.product?.category || '-', 'Quantidade': item.quantity, 'Unidade': unitLabel, 'Fornecedor': item.supplier || '-', 'Qtd. Última Compra': item.last_purchase_quantity ?? '-', 'Data Última Compra': item.last_purchase_date ? format(parseISO(item.last_purchase_date), 'dd/MM/yyyy', { locale: ptBR }) : '-', 'Valor Última Compra': item.last_purchase_price != null ? `R$ ${item.last_purchase_price.toFixed(2).replace('.', ',')}` : '-', 'Valor Unitário': item.unit_price != null ? `R$ ${item.unit_price.toFixed(2).replace('.', ',')}` : '-', 'Valor Total Item': totalItemValue != null ? `R$ ${totalItemValue.toFixed(2).replace('.', ',')}` : '-', 'Peso (kg)': item.weight ?? '-', 'Estoque (Orçam.)': item.stock_at_creation ?? '-',
      };
    });
    listData.push({ 'Data': '', 'Item': 'TOTAL GERAL', 'Categoria': '', 'Quantidade': '', 'Unidade': '', 'Fornecedor': '', 'Qtd. Última Compra': '', 'Data Última Compra': '', 'Valor Última Compra': '', 'Valor Unitário': '', 'Valor Total Item': `R$ ${budget.total_value.toFixed(2).replace('.', ',')}`, 'Peso (kg)': '', 'Estoque (Orçam.)': '', });
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.json_to_sheet(listData);
    const colWidths = [ { wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 15 } ]; ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, 'Orçamento');
    try { const mainSupplier = getMainSupplier(budget); const fileName = `orcamento-${format(parseISO(budget.created_at), 'dd-MM-yyyy')}-${mainSupplier.replace(/[^a-zA-Z0-9]/g, '_')}-${budget.id.slice(0, 8)}.xlsx`; XLSX.writeFile(wb, fileName); addNotification('Orçamento exportado para Excel com sucesso!', 'success');
    } catch (exportError) { console.error('Error exporting budget:', exportError); addNotification('Erro ao exportar o orçamento para Excel.', 'error'); }
  };

  const handleRegisterEntry = (budget: Budget) => {
    if (!(budget.status === 'pending' || budget.status === null || budget.status === 'approved' || budget.status === 'on_the_way')) {
      addNotification('O status atual deste orçamento não permite o registro de entrada.', 'warning'); return;
    }
    navigate('/inventory/new-purchase', { state: { budgetData: budget } });
  };

  const handleSetOnTheWay = async (budgetId: string) => {
    if (!window.confirm("Tem certeza que deseja marcar este orçamento como \"A Caminho\"?")) return;
    try { setLoading(true); const result = await updateBudgetStatus(budgetId, 'on_the_way');
      if (result.success) { addNotification('Status do orçamento atualizado para "A Caminho"!', 'success'); setBudgets(prevBudgets => prevBudgets.map(b => b.id === budgetId ? { ...b, status: 'on_the_way' } : b));
      } else { throw new Error(result.error || 'Falha ao atualizar status do orçamento'); }
    } catch (err) { console.error('Error updating budget status:', err); const message = err instanceof Error ? err.message : 'Erro desconhecido ao atualizar status.'; addNotification(`Erro ao atualizar status: ${message}`, 'error');
    } finally { setLoading(false); }
  };

  const handleCancelBudget = async (budgetId: string) => {
    if (!window.confirm("Tem certeza que deseja cancelar este orçamento? Esta ação não pode ser desfeita.")) return;
    try { setLoading(true); const result = await cancelBudget(budgetId);
      if (result.success) { addNotification('Orçamento cancelado com sucesso!', 'success'); setBudgets(prevBudgets => prevBudgets.map(b => b.id === budgetId ? { ...b, status: 'cancelled' } : b));
      } else { throw new Error(result.error || 'Falha ao cancelar orçamento'); }
    } catch (err) { console.error('Error cancelling budget:', err); const message = err instanceof Error ? err.message : 'Erro desconhecido ao cancelar orçamento.'; addNotification(`Erro ao cancelar orçamento: ${message}`, 'error');
    } finally { setLoading(false); }
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

    return (
      <div key={budget.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow duration-200">
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between mb-2 gap-2">
            <div className="flex items-center text-sm text-gray-500 dark:text-gray-400"><Calendar className="h-4 w-4 mr-1.5 flex-shrink-0" />{formattedDate}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">R$ {budget.total_value.toFixed(2).replace(".", ",")}</span>
              <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusInfo.bgColor} ${statusInfo.color}`}><statusInfo.icon className="h-4 w-4 mr-1 flex-shrink-0" />{statusInfo.label}</span>
            </div>
          </div>
          <div className="mb-3">
            <h3 className="text-lg font-semibold text-purple-700 dark:text-purple-300">Orçamento #{budgetId}</h3>
            <div className="flex items-center mt-1 text-sm text-gray-600 dark:text-gray-300"><ShoppingBag className="h-4 w-4 mr-1.5 text-gray-500 dark:text-gray-400" />Fornecedor Principal: {mainSupplier}</div>
            {(isApproved || isOnTheWay || isDelivered) && budget.approved_by_user_email && budget.approved_at && (
              <div className="text-xs mt-1 text-gray-500 dark:text-gray-400">Aprovado por: {budget.approved_by_user_email.split("@")[0]} em {format(parseISO(budget.approved_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>)}
          </div>
          <div className="flex flex-wrap items-center justify-between mt-4 pt-3 border-t border-gray-200 dark:border-gray-600 gap-2">
            <button onClick={() => toggleBudgetExpand(budget.id)} className="flex items-center px-3 py-1.5 text-sm text-gray-600 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150">
              <span className="mr-1">{isExpanded ? "Ocultar Itens" : "Ver Itens"}</span><ChevronDown className={`h-4 w-4 transform transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
            </button>
            <div className="flex space-x-2 flex-wrap gap-2">
              {isPending && (<button onClick={() => handleRegisterEntry(budget)} className="flex items-center px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors duration-150"><Truck className="h-4 w-4 mr-1" /> Entrada</button>)}
              {isApproved && (<>
                  <button onClick={() => handleSetOnTheWay(budget.id)} className="flex items-center px-3 py-1.5 text-sm bg-indigo-500 hover:bg-indigo-600 text-white rounded-md transition-colors duration-150"><Send className="h-4 w-4 mr-1" /> A Caminho</button>
                  <button onClick={() => handleRegisterEntry(budget)} className="flex items-center px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors duration-150"><Truck className="h-4 w-4 mr-1" /> Entrada</button>
              </>)}
              {isOnTheWay && (<button onClick={() => handleRegisterEntry(budget)} className="flex items-center px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors duration-150"><Truck className="h-4 w-4 mr-1" /> Entrada</button>)}
              {(isPending || isApproved) && (<button onClick={() => handleCancelBudget(budget.id)} className="flex items-center px-3 py-1.5 text-sm bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors duration-150"><Ban className="h-4 w-4 mr-1" /> Cancelar</button>)}
              <button 
                onClick={() => captureAndCopyToClipboard(budget)} 
                className="flex items-center px-3 py-1.5 text-sm text-gray-600 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150" 
                title="Copiar Imagem do Orçamento"
              >
                <ImageIcon className="h-4 w-4 mr-1" /><span>Copiar Imagem</span>
              </button>
              <Link to={`/budget/${budget.id}`} state={{ originatingPage: '/budget-history' }} className="flex items-center px-3 py-1.5 text-sm text-gray-600 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150" title="Ver Detalhes Completos"><Eye className="h-4 w-4 mr-1" /><span>Detalhes</span></Link>
            </div>
          </div>
        </div>
        {isExpanded && (
          <div className="bg-gray-50 dark:bg-gray-700/30 p-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-md font-semibold mb-2 text-gray-700 dark:text-gray-200">Itens do Orçamento:</h4>
            {budget.budget_items && budget.budget_items.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {budget.budget_items.map(item => (
                  <li key={item.id} className="p-2 rounded-md bg-white dark:bg-gray-700/60 shadow-sm">
                    <div className="font-medium text-gray-800 dark:text-gray-100">{item.product?.name || item.custom_item_name || "Item não especificado"}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Quantidade: {item.quantity} {getUnitLabel(item.unit)} {item.unit_price ? `| Preço Unit.: R$ ${item.unit_price.toFixed(2).replace(".", ",")}` : ''}</div>
                    {item.supplier && <div className="text-xs text-gray-500 dark:text-gray-400">Fornecedor: {item.supplier}</div>}
                    {item.last_purchase_price && <div className="text-xs text-gray-500 dark:text-gray-400">Última Compra: R$ {item.last_purchase_price.toFixed(2).replace(".", ",")} ({item.last_purchase_quantity} {getUnitLabel(item.unit)} em {item.last_purchase_date ? format(parseISO(item.last_purchase_date), 'dd/MM/yy') : 'N/A'})</div>}
                  </li>
                ))}
              </ul>
            ) : (<p className="text-sm text-gray-500 dark:text-gray-400">Nenhum item neste orçamento.</p>)}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="flex justify-center items-center h-screen"><div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-purple-500"></div></div>;
  if (error) return <div className="container mx-auto p-4 text-center"><h1 className="text-2xl font-bold text-red-500 mb-4">Erro ao Carregar Histórico</h1><p className="text-gray-700 dark:text-gray-300 mb-4">{error}</p><button onClick={fetchBudgets} className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded flex items-center justify-center mx-auto"><RefreshCw className="mr-2 h-4 w-4" /> Tentar Novamente</button></div>;

  return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="flex items-center text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300 transition-colors duration-150"><ArrowLeft className="h-5 w-5 mr-1" />Voltar</button>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white text-center flex-grow">Histórico de Orçamentos</h2>
        <div className="w-10"> {/* Placeholder */} </div>
      </div>

      {/* View Mode Toggle Buttons */}
      <div className="mb-6 flex justify-center space-x-2">
        <button 
          onClick={() => setViewMode('active')}
          className={`px-4 py-2 rounded-md text-sm font-medium flex items-center transition-colors duration-150 
            ${viewMode === 'active' 
              ? 'bg-purple-600 text-white shadow-md'
              : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200'}`}
        >
          <ListFilter className="h-4 w-4 mr-2" /> Ativos
        </button>
        <button 
          onClick={() => setViewMode('archived')}
          className={`px-4 py-2 rounded-md text-sm font-medium flex items-center transition-colors duration-150 
            ${viewMode === 'archived' 
              ? 'bg-purple-600 text-white shadow-md'
              : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200'}`}
        >
          <Archive className="h-4 w-4 mr-2" /> Arquivados
        </button>
      </div>

      {/* Filter Section */}
      <div className="mb-6 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg shadow">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Filtros</h3>
          <button onClick={() => setFilters(prev => ({...prev, showFilters: !prev.showFilters}))} className="text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300 flex items-center">
            {filters.showFilters ? 'Ocultar Filtros' : 'Mostrar Filtros'}<ChevronDown className={`ml-1 h-4 w-4 transform transition-transform duration-200 ${filters.showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {filters.showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="supplierFilter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fornecedor</label>
              <select id="supplierFilter" value={filters.supplier} onChange={e => setFilters(prev => ({...prev, supplier: e.target.value}))} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="">Todos</option>
                {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="startDateFilter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data Início</label>
              <input type="date" id="startDateFilter" value={filters.startDate} onChange={e => setFilters(prev => ({...prev, startDate: e.target.value}))} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label htmlFor="endDateFilter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data Fim</label>
              <input type="date" id="endDateFilter" value={filters.endDate} onChange={e => setFilters(prev => ({...prev, endDate: e.target.value}))} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label htmlFor="productNameFilter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Produto</label>
              <input type="text" id="productNameFilter" placeholder="Buscar por nome..." value={filters.productName} onChange={e => setFilters(prev => ({...prev, productName: e.target.value}))} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4 flex justify-end space-x-2 mt-2">
              <button onClick={clearFilters} className="px-4 py-2 text-sm bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-100 rounded-md transition-colors duration-150 flex items-center"><X className="h-4 w-4 mr-1" /> Limpar Filtros</button>
            </div>
          </div>
        )}
      </div>

      {filteredAndSortedBudgets.length === 0 && !loading && (
        <div className="text-center py-10">
          <Package className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
          <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-gray-100">
            Nenhum orçamento encontrado para "{viewMode === 'active' ? 'Ativos' : 'Arquivados'}"
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {(filters.supplier || filters.startDate || filters.endDate || filters.productName) 
              ? "Tente ajustar seus filtros ou limpar a busca."
              : (viewMode === 'active' 
                  ? "Não há orçamentos pendentes, aprovados ou a caminho no momento."
                  : "Não há orçamentos entregues ou cancelados.")
            }
          </p>
          {(filters.supplier || filters.startDate || filters.endDate || filters.productName) && (
            <button onClick={clearFilters} className="mt-4 px-4 py-2 text-sm bg-purple-500 hover:bg-purple-600 text-white rounded-md transition-colors duration-150 flex items-center mx-auto"><X className="h-4 w-4 mr-1" /> Limpar Filtros</button>
          )}
        </div>
      )}

      {filteredAndSortedBudgets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAndSortedBudgets.map(budget => renderBudgetCard(budget))}
        </div>
      )}
    </div>
  );
};

export default BudgetHistory;
