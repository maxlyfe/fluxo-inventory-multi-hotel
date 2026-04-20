import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Clock,
  Ban,
  Check,
  ThumbsUp,
  ShoppingBag,
  Trash2,
  Globe,
  ExternalLink,
  XCircle,
  Truck,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "../context/AuthContext";
import { useNotification } from "../context/NotificationContext";
import { getBudgetHistory, updateBudgetStatus, getHotels, updateBudgetItems, updateBudgetItemStatus, updateBudgetItemPayment } from "../lib/supabase";
import { createNotification } from "../lib/notifications";

const unitOptions = [
  { value: "", label: "Selecione" },
  { value: "kg", label: "kg (Quilograma)" },
  { value: "g", label: "g (Grama)" },
  { value: "l", label: "l (Litro)" },
  { value: "ml", label: "ml (Mililitro)" },
  { value: "und", label: "und (Unidade)" },
  { value: "cx", label: "cx (Caixa)" },
  { value: "pct", label: "pct (Pacote)" },
  { value: "fardo", label: "fardo (Fardo)" },
  { value: "balde", label: "balde (Balde)" },
  { value: "saco", label: "saco (Saco)" },
  { value: "outro", label: "Outro" },
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
  item_status: 'pending' | 'approved' | 'rejected' | null;
  is_online: boolean | null;
  product_link: string | null;
  image_urls: string[] | null;
  shipping_cost: number | null;
  payment_type: 'cash' | 'installment' | null;
  installments: number | null;
  installment_value: number | null;
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
  status: "pending" | "approved" | "on_the_way" | "delivered" | "cancelled" | null;
  hotel_id: string;
  approved_by_user_email?: string | null;
  approved_at?: string | null;
  is_online?: boolean | null;
  hotel?: { id: string; name: string; color_primary?: string; color_secondary?: string };
}

interface Hotel {
  id: string;
  name: string;
}

// Accent colors per hotel (border-l-4 approach)
const hotelAccents: Record<string, string> = {
  "Costa do Sol": "border-emerald-400",
  "Brava Club":   "border-blue-400",
  "Maria Maria":  "border-amber-400",
  "Villa Pitanga":"border-orange-400",
};

const getHotelAccent = (name: string | undefined) => {
  if (!name) return "border-slate-300 dark:border-slate-600";
  for (const key of Object.keys(hotelAccents)) {
    if (name.includes(key)) return hotelAccents[key];
  }
  return "border-slate-300 dark:border-slate-600";
};

const hotelPillActive: Record<string, string> = {
  "Costa do Sol": "bg-emerald-500 text-white",
  "Brava Club":   "bg-blue-600 text-white",
  "Maria Maria":  "bg-amber-500 text-white",
  "Villa Pitanga":"bg-orange-500 text-white",
};

const getHotelPillActive = (name: string | undefined) => {
  if (!name) return "bg-slate-600 text-white";
  for (const key of Object.keys(hotelPillActive)) {
    if (name.includes(key)) return hotelPillActive[key];
  }
  return "bg-slate-600 text-white";
};

const AuthorizationsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addNotification } = useNotification();
  const [allBudgets, setAllBudgets] = useState<Budget[]>([]);
  const [filteredBudgets, setFilteredBudgets] = useState<Budget[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBudget, setExpandedBudget] = useState<string | null>(null);
  const [activeHotelFilter, setActiveHotelFilter] = useState<string | null>(null);

  const getMainSupplier = (budget: Budget): string => {
    const specifiedSuppliers = budget.budget_items
      .map(item => item.supplier)
      .filter((supplier): supplier is string => !!supplier && supplier.trim() !== '');
    if (specifiedSuppliers.length === 0) return 'Não especificado';
    const supplierCounts: { [key: string]: number } = {};
    specifiedSuppliers.forEach(supplier => {
      supplierCounts[supplier] = (supplierCounts[supplier] || 0) + 1;
    });
    let mainSupplier = specifiedSuppliers[0];
    let maxCount = 0;
    Object.entries(supplierCounts).forEach(([supplier, count]) => {
      if (count > maxCount) { maxCount = count; mainSupplier = supplier; }
    });
    if (Object.keys(supplierCounts).length > 1 && maxCount > 0) return `${mainSupplier} (e outros)`;
    if (maxCount === 0 && specifiedSuppliers.length > 0) return specifiedSuppliers[0];
    if (maxCount === 0 && specifiedSuppliers.length === 0) return 'Não especificado';
    return mainSupplier;
  };

  const fetchAllBudgetsAndHotels = useCallback(async (currentHotelFilter?: string | null) => {
    try {
      setLoading(true);
      setError(null);
      const hotelsResult = await getHotels();
      if (hotelsResult.success && hotelsResult.data) {
        setHotels(hotelsResult.data);
      } else {
        throw new Error(hotelsResult.error || "Falha ao buscar hotéis");
      }
      let relevantBudgets: Budget[] = [];
      if (hotelsResult.success && hotelsResult.data) {
        const budgetPromises = hotelsResult.data.map(hotel => getBudgetHistory(hotel.id));
        const budgetResults = await Promise.all(budgetPromises);
        budgetResults.forEach((result, index) => {
          if (result.success && result.data) {
            const hotel = hotelsResult.data![index];
            const hotelBudgets = result.data.map(b => ({ ...b, hotel_id: hotel.id, hotel: hotel }));
            relevantBudgets.push(...hotelBudgets.filter(b => b.status === "pending"));
          }
        });
      }
      const sortedData = relevantBudgets.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setAllBudgets(sortedData);
      const filterToApply = currentHotelFilter === undefined ? activeHotelFilter : currentHotelFilter;
      if (filterToApply === null) {
        setFilteredBudgets(sortedData);
      } else {
        setFilteredBudgets(sortedData.filter(budget => budget.hotel_id === filterToApply));
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      const message = err instanceof Error ? err.message : "Erro desconhecido ao buscar dados.";
      setError(`Erro ao carregar dados: ${message}`);
      addNotification(`Erro ao carregar dados: ${message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [addNotification, activeHotelFilter]);

  useEffect(() => {
    fetchAllBudgetsAndHotels();
  }, [fetchAllBudgetsAndHotels]);

  const handleFilterByHotel = (hotelId: string | null) => {
    setActiveHotelFilter(hotelId);
    if (hotelId === null) {
      setFilteredBudgets(allBudgets);
    } else {
      setFilteredBudgets(allBudgets.filter(budget => budget.hotel_id === hotelId));
    }
  };

  const handleUpdateItemQuantity = (budgetId: string, itemId: string, newQuantity: number) => {
    if (newQuantity < 0) return;
    setAllBudgets(prevBudgets => prevBudgets.map(budget => {
      if (budget.id !== budgetId) return budget;
      const updatedItems = budget.budget_items.map(item =>
        item.id === itemId ? { ...item, quantity: newQuantity } : item
      );
      const newTotalValue = updatedItems.reduce((sum, item) =>
        sum + (item.quantity * (item.unit_price || 0)), 0
      );
      return { ...budget, budget_items: updatedItems, total_value: newTotalValue };
    }));
  };

  const handleRemoveItem = (budgetId: string, itemId: string) => {
    if (!window.confirm("Tem certeza que deseja remover este item do orçamento?")) return;
    setAllBudgets(prevBudgets => prevBudgets.map(budget => {
      if (budget.id !== budgetId) return budget;
      const updatedItems = budget.budget_items.filter(item => item.id !== itemId);
      if (updatedItems.length === 0) {
        addNotification("O orçamento não pode ficar vazio. Cancele o orçamento se desejar removê-lo completamente.", "warning");
        return budget;
      }
      const newTotalValue = updatedItems.reduce((sum, item) =>
        sum + (item.quantity * (item.unit_price || 0)), 0
      );
      return { ...budget, budget_items: updatedItems, total_value: newTotalValue };
    }));
  };

  const handleApproveBudget = async (budgetId: string) => {
    if (!user || !user.email) {
      addNotification("Usuário não autenticado ou e-mail não disponível.", "error");
      return;
    }
    const approverUserEmail = user.email;
    try {
      setLoading(true);
      const budget = allBudgets.find(b => b.id === budgetId);
      if (!budget) throw new Error("Orçamento não encontrado.");
      const updateItemsResult = await updateBudgetItems(budgetId, budget.budget_items, budget.total_value);
      if (!updateItemsResult.success) {
        throw new Error(updateItemsResult.error || "Falha ao atualizar itens do orçamento");
      }
      const result = await updateBudgetStatus(budgetId, "approved", approverUserEmail);
      if (result.success && result.data) {
        addNotification("Orçamento aprovado com sucesso!", "success");
        try {
          await createNotification({
            event_type: 'BUDGET_APPROVED',
            hotel_id: result.data.hotel_id,
            title: `Orçamento Aprovado - ${budget.hotel?.name || 'Hotel'}`,
            content: `Orçamento de ${getMainSupplier(budget)} no valor de R$ ${budget.total_value.toFixed(2).replace('.', ',')} foi aprovado por ${approverUserEmail.split('@')[0]} para o hotel ${budget.hotel?.name || ''}`,
            link: `/budget-history`,
            metadata: {
              budget_id: budgetId,
              total_value: budget.total_value,
              supplier: getMainSupplier(budget),
              approved_by: approverUserEmail,
              items_count: budget.budget_items.length,
              hotel_name: budget.hotel?.name
            }
          });
        } catch (notificationError) {
          console.error('Erro ao enviar notificação de orçamento aprovado:', notificationError);
        }
        fetchAllBudgetsAndHotels(activeHotelFilter);
      } else {
        throw new Error(result.error || "Falha ao aprovar orçamento");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao aprovar orçamento.";
      addNotification(message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelBudget = async (budgetId: string) => {
    if (!window.confirm("Tem certeza que deseja cancelar este orçamento? Esta ação não pode ser desfeita.")) return;
    try {
      setLoading(true);
      const budget = allBudgets.find(b => b.id === budgetId);
      const result = await updateBudgetStatus(budgetId, "cancelled");
      if (result.success && result.data) {
        addNotification("Orçamento cancelado com sucesso!", "success");
        if (budget) {
          try {
            await createNotification({
              event_type: 'BUDGET_CANCELLED',
              hotel_id: result.data.hotel_id,
              title: `Orçamento Cancelado - ${budget.hotel?.name || 'Hotel'}`,
              content: `Orçamento de ${getMainSupplier(budget)} no valor de R$ ${budget.total_value.toFixed(2).replace('.', ',')} foi cancelado para o hotel ${budget.hotel?.name || ''}`,
              link: `/budget-history`,
              metadata: {
                budget_id: budgetId,
                total_value: budget.total_value,
                supplier: getMainSupplier(budget),
                cancelled_by: user?.email || 'Usuário do sistema',
                items_count: budget.budget_items.length,
                hotel_name: budget.hotel?.name
              }
            });
          } catch (notificationError) {
            console.error('Erro ao enviar notificação de orçamento cancelado:', notificationError);
          }
        }
        fetchAllBudgetsAndHotels(activeHotelFilter);
      } else {
        throw new Error(result.error || "Falha ao cancelar orçamento");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao cancelar orçamento.";
      addNotification(message, "error");
    } finally {
      setLoading(false);
    }
  };

  const toggleBudgetExpand = (budgetId: string) => {
    setExpandedBudget(prev => (prev === budgetId ? null : budgetId));
  };

  const [carouselIndex, setCarouselIndex] = useState<Record<string, number>>({});
  const setItemCarouselIndex = (itemId: string, idx: number) =>
    setCarouselIndex(prev => ({ ...prev, [itemId]: idx }));

  const [itemEdits, setItemEdits] = useState<Record<string, {
    quantity: number;
    payment_type: 'cash' | 'installment';
    installments: number;
    installment_value: number;
    unit_price: number;
  }>>({});

  const initItemEdit = (item: BudgetItem) => {
    if (itemEdits[item.id]) return;
    setItemEdits(prev => ({
      ...prev,
      [item.id]: {
        quantity: item.quantity || 1,
        payment_type: (item.payment_type as 'cash' | 'installment') || 'cash',
        installments: item.installments || 2,
        installment_value: item.installment_value || 0,
        unit_price: item.unit_price || 0,
      }
    }));
  };

  const updateItemEdit = (itemId: string, field: string, value: number | string) =>
    setItemEdits(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));

  const getItemEdit = (item: BudgetItem) => itemEdits[item.id] || {
    quantity: item.quantity || 1,
    payment_type: (item.payment_type as 'cash' | 'installment') || 'cash',
    installments: item.installments || 2,
    installment_value: item.installment_value || 0,
    unit_price: item.unit_price || 0,
  };

  const handleApproveItemWithEdit = async (budgetId: string, item: BudgetItem) => {
    const edit = getItemEdit(item);
    await updateBudgetItemPayment(item.id, {
      quantity: edit.quantity,
      payment_type: edit.payment_type,
      installments: edit.payment_type === 'installment' ? edit.installments : null,
      installment_value: edit.payment_type === 'installment' ? edit.installment_value : null,
      unit_price: edit.payment_type === 'cash' ? edit.unit_price : null,
    });
    await handleItemStatus(budgetId, item.id, 'approved');
    setAllBudgets(prev => prev.map(b => {
      if (b.id !== budgetId) return b;
      return { ...b, budget_items: b.budget_items.map(i => i.id === item.id ? { ...i, ...edit } : i) };
    }));
    setFilteredBudgets(prev => prev.map(b => {
      if (b.id !== budgetId) return b;
      return { ...b, budget_items: b.budget_items.map(i => i.id === item.id ? { ...i, ...edit } : i) };
    }));
  };

  const handleItemStatus = async (budgetId: string, itemId: string, status: 'approved' | 'rejected') => {
    const result = await updateBudgetItemStatus(itemId, status);
    if (result.success) {
      const label = status === 'approved' ? 'aprovado' : 'rejeitado';
      addNotification(`Item ${label} com sucesso!`, 'success');
      const updater = (prev: Budget[]) => prev.map(b => {
        if (b.id !== budgetId) return b;
        return { ...b, budget_items: b.budget_items.map(i => i.id === itemId ? { ...i, item_status: status } : i) };
      });
      setAllBudgets(updater);
      setFilteredBudgets(updater);
    } else {
      addNotification('Erro ao atualizar item.', 'error');
    }
  };

  const fmtBRL = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const getUnitLabel = (unitValue: string | null | undefined): string => {
    if (!unitValue) return "-";
    const option = unitOptions.find(opt => opt.value === unitValue);
    return option ? option.label : unitValue;
  };

  if (loading && !allBudgets.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando autorizações…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <XCircle className="w-7 h-7 text-red-500" />
        </div>
        <p className="text-sm text-red-500 dark:text-red-400 text-center max-w-xs">{error}</p>
        <button
          onClick={() => fetchAllBudgetsAndHotels(activeHotelFilter)}
          className="mt-1 px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-semibold transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
            <ThumbsUp className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">
              Autorizações de Compra
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {filteredBudgets.length} orçamento{filteredBudgets.length !== 1 ? 's' : ''} pendente{filteredBudgets.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchAllBudgetsAndHotels(activeHotelFilter)}
          disabled={loading}
          className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50"
          title="Atualizar"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Hotel filter pills ── */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleFilterByHotel(null)}
          className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
            activeHotelFilter === null
              ? "bg-indigo-600 text-white shadow-sm scale-105"
              : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
          }`}
        >
          Todos os Hotéis
        </button>
        {hotels.map((hotel) => (
          <button
            key={hotel.id}
            onClick={() => handleFilterByHotel(hotel.id)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
              activeHotelFilter === hotel.id
                ? `${getHotelPillActive(hotel.name)} shadow-sm scale-105`
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
          >
            {hotel.name}
          </button>
        ))}
      </div>

      {/* ── Empty state ── */}
      {filteredBudgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <ShoppingBag className="h-7 w-7 text-slate-400 dark:text-slate-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Nenhum orçamento pendente</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {activeHotelFilter ? "Tente selecionar outro hotel" : "Todos os orçamentos foram processados"}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBudgets.map((budget) => {
            const hotelName = budget.hotel?.name || "Hotel não especificado";
            const formattedDate = isValid(parseISO(budget.created_at))
              ? format(parseISO(budget.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
              : "Data inválida";
            const mainSupplierName = getMainSupplier(budget);
            const isOnline = !!budget.is_online;
            const accentClass = getHotelAccent(hotelName);

            return (
              <div
                key={budget.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow overflow-hidden border-l-4 ${accentClass}`}
              >
                <div className="p-4 space-y-3">
                  {/* Hotel + date */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate max-w-[160px]">
                      {hotelName}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[11px] font-bold">
                      <Clock className="h-3 w-3" /> Pendente
                    </span>
                  </div>

                  {/* Supplier + badges */}
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                      {isOnline && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 text-xs font-bold border border-cyan-200 dark:border-cyan-700">
                          <Globe className="h-3 w-3" /> Online
                        </span>
                      )}
                      {mainSupplierName}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Calendar className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs text-slate-400 dark:text-slate-500">{formattedDate}</span>
                    </div>
                    {isOnline && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {budget.budget_items.length} produto{budget.budget_items.length !== 1 ? 's' : ''} · Aprovação individual por item
                      </p>
                    )}
                  </div>

                  {/* Total */}
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Total</span>
                    <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                      {fmtBRL(budget.total_value)}
                    </span>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => toggleBudgetExpand(budget.id)}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl transition-colors font-semibold"
                    >
                      Ver Itens
                      <ChevronDown className={`h-4 w-4 transition-transform ${expandedBudget === budget.id ? 'rotate-180' : ''}`} />
                    </button>

                    <button
                      onClick={() => handleApproveBudget(budget.id)}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors font-semibold shadow-sm"
                    >
                      <Check className="h-4 w-4" /> Aprovar
                    </button>

                    <button
                      onClick={() => handleCancelBudget(budget.id)}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-xl transition-colors font-semibold border border-red-200 dark:border-red-700"
                    >
                      <Ban className="h-4 w-4" /> Cancelar
                    </button>

                    <Link
                      to={`/budget/${budget.id}`}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-xl transition-colors font-semibold border border-blue-200 dark:border-blue-700"
                    >
                      <Eye className="h-4 w-4" /> Detalhes
                    </Link>
                  </div>
                </div>

                {/* ── Expanded items panel ── */}
                {expandedBudget === budget.id && (
                  <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4">
                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">
                      {isOnline ? 'Produtos do Orçamento Online' : 'Itens do Orçamento'}
                    </h4>

                    {budget.budget_items && budget.budget_items.length > 0 ? (
                      isOnline ? (
                        /* ── Online product cards ── */
                        <div className="space-y-4">
                          {budget.budget_items.map((item) => {
                            const imgs = item.image_urls || [];
                            const imgIdx = carouselIndex[item.id] || 0;
                            const edit = getItemEdit(item);
                            const isApproved = item.item_status === 'approved';
                            const isRejected = item.item_status === 'rejected';

                            const priceAVista = edit.unit_price || item.unit_price || 0;
                            const totalParcelado = edit.payment_type === 'installment'
                              ? (edit.installments || 1) * (edit.installment_value || 0)
                              : 0;
                            const freteUnitario = item.shipping_cost || 0;
                            const totalItem = edit.payment_type === 'installment'
                              ? (totalParcelado + freteUnitario) * edit.quantity
                              : (priceAVista + freteUnitario) * edit.quantity;

                            return (
                              <div
                                key={item.id}
                                onClick={() => initItemEdit(item)}
                                className={`rounded-2xl border-2 overflow-hidden transition-all shadow-sm ${
                                  isApproved
                                    ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-900/10'
                                    : isRejected
                                    ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10 opacity-60'
                                    : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800'
                                }`}
                              >
                                {/* Carousel */}
                                {imgs.length > 0 ? (
                                  <div className="relative h-48 bg-slate-100 dark:bg-slate-900 group">
                                    <img
                                      src={imgs[imgIdx]}
                                      alt={item.custom_item_name || 'produto'}
                                      className="w-full h-full object-contain"
                                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                    {imgs.length > 1 && (
                                      <>
                                        <button
                                          onClick={e => { e.stopPropagation(); setItemCarouselIndex(item.id, (imgIdx - 1 + imgs.length) % imgs.length); }}
                                          className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                          <ChevronLeft className="h-4 w-4" />
                                        </button>
                                        <button
                                          onClick={e => { e.stopPropagation(); setItemCarouselIndex(item.id, (imgIdx + 1) % imgs.length); }}
                                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                          <ChevronRight className="h-4 w-4" />
                                        </button>
                                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                                          {imgs.map((_, i) => (
                                            <button
                                              key={i}
                                              onClick={e => { e.stopPropagation(); setItemCarouselIndex(item.id, i); }}
                                              className={`h-1.5 rounded-full transition-all ${i === imgIdx ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`}
                                            />
                                          ))}
                                        </div>
                                      </>
                                    )}
                                    {(isApproved || isRejected) && (
                                      <span className={`absolute top-2 left-2 text-xs font-bold px-2 py-1 rounded-full shadow ${
                                        isApproved ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                                      }`}>
                                        {isApproved ? '✓ Aprovado' : '✗ Rejeitado'}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="h-16 bg-slate-100 dark:bg-slate-700/40 flex items-center justify-center">
                                    <ImageIcon className="h-6 w-6 text-slate-300" />
                                  </div>
                                )}

                                {/* Card body */}
                                <div className="p-4 space-y-3">
                                  {/* Name + link */}
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-base font-bold text-slate-900 dark:text-white leading-snug flex-1">
                                      {item.custom_item_name || 'Produto sem nome'}
                                    </p>
                                    {item.product_link && (
                                      <a
                                        href={item.product_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-semibold hover:bg-blue-100 transition-colors border border-blue-200 dark:border-blue-700"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" /> Ver anúncio
                                      </a>
                                    )}
                                  </div>

                                  {/* Price grid */}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className={`rounded-xl p-2.5 border-2 transition-all ${
                                      edit.payment_type === 'cash'
                                        ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                                        : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/30 opacity-60'
                                    }`}>
                                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">À vista</p>
                                      <p className="text-sm font-black text-emerald-700 dark:text-emerald-400">
                                        {fmtBRL(priceAVista)}
                                      </p>
                                    </div>
                                    <div className={`rounded-xl p-2.5 border-2 transition-all ${
                                      edit.payment_type === 'installment'
                                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                                        : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/30 opacity-60'
                                    }`}>
                                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">Parcelado</p>
                                      {item.installments && item.installment_value ? (
                                        <p className="text-sm font-black text-blue-700 dark:text-blue-400">
                                          {item.installments}x {fmtBRL(item.installment_value)}
                                        </p>
                                      ) : (
                                        <p className="text-sm text-slate-400">—</p>
                                      )}
                                    </div>
                                  </div>

                                  {/* Shipping */}
                                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${
                                    freteUnitario === 0
                                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                                      : 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400'
                                  }`}>
                                    <Truck className="h-4 w-4 flex-shrink-0" />
                                    {freteUnitario === 0
                                      ? <span className="font-semibold">Frete grátis</span>
                                      : <span>Frete: <span className="font-bold">{fmtBRL(freteUnitario)}</span> por unidade</span>
                                    }
                                  </div>

                                  {/* Payment editor */}
                                  {!isApproved && !isRejected && (
                                    <div className="border border-slate-200 dark:border-slate-600 rounded-2xl p-3 space-y-3 bg-slate-50 dark:bg-slate-700/20">
                                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Confirmar pagamento</p>

                                      <div className="flex gap-2">
                                        <button
                                          onClick={e => { e.stopPropagation(); initItemEdit(item); updateItemEdit(item.id, 'payment_type', 'cash'); }}
                                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                                            edit.payment_type === 'cash'
                                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                              : 'bg-white dark:bg-slate-700 text-slate-500 border-slate-200 dark:border-slate-600 hover:border-emerald-400'
                                          }`}
                                        >
                                          💵 À vista
                                        </button>
                                        <button
                                          onClick={e => { e.stopPropagation(); initItemEdit(item); updateItemEdit(item.id, 'payment_type', 'installment'); }}
                                          disabled={!item.installments}
                                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                                            edit.payment_type === 'installment'
                                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                              : 'bg-white dark:bg-slate-700 text-slate-500 border-slate-200 dark:border-slate-600 hover:border-blue-400'
                                          }`}
                                        >
                                          💳 Parcelado
                                        </button>
                                      </div>

                                      {edit.payment_type === 'installment' && (
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-slate-500 whitespace-nowrap">Parcelas:</span>
                                          <input
                                            type="number"
                                            value={edit.installments}
                                            onChange={e => { e.stopPropagation(); updateItemEdit(item.id, 'installments', parseInt(e.target.value) || 2); }}
                                            onClick={e => e.stopPropagation()}
                                            min="2" max="48"
                                            className="w-16 text-center px-2 py-1.5 rounded-xl border border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                          />
                                          <span className="text-xs text-slate-500">x</span>
                                          <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                            {fmtBRL(edit.installment_value || item.installment_value || 0)}
                                          </span>
                                        </div>
                                      )}

                                      <div className="flex items-center gap-3">
                                        <span className="text-xs text-slate-500 whitespace-nowrap">Quantidade:</span>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={e => { e.stopPropagation(); updateItemEdit(item.id, 'quantity', Math.max(1, edit.quantity - 1)); }}
                                            className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center hover:bg-slate-100 font-bold text-lg"
                                          >−</button>
                                          <input
                                            type="number"
                                            value={edit.quantity}
                                            onChange={e => { e.stopPropagation(); updateItemEdit(item.id, 'quantity', Math.max(0.01, parseFloat(e.target.value) || 0.01)); }}
                                            onClick={e => e.stopPropagation()}
                                            min="0.01" step="any"
                                            className="w-14 text-center px-1 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                          />
                                          <button
                                            onClick={e => { e.stopPropagation(); updateItemEdit(item.id, 'quantity', edit.quantity + 1); }}
                                            className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center hover:bg-slate-100 font-bold text-lg"
                                          >+</button>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Total */}
                                  <div className="flex items-center justify-between bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl px-4 py-3 border border-indigo-100 dark:border-indigo-800/30">
                                    <div>
                                      <p className="text-[11px] font-bold text-indigo-400 uppercase tracking-wide">
                                        Total ({edit.quantity} un. · {edit.payment_type === 'cash' ? 'à vista' : `${edit.installments}x`})
                                      </p>
                                      <p className="text-xl font-black text-indigo-700 dark:text-indigo-300">{fmtBRL(totalItem)}</p>
                                    </div>
                                    {freteUnitario > 0 && (
                                      <p className="text-xs text-orange-500">+frete</p>
                                    )}
                                  </div>

                                  {/* Approve / reject */}
                                  {!isApproved && !isRejected ? (
                                    <div className="flex gap-2">
                                      <button
                                        onClick={e => { e.stopPropagation(); handleApproveItemWithEdit(budget.id, item); }}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-colors shadow-sm"
                                      >
                                        <Check className="h-4 w-4" /> Aprovar
                                      </button>
                                      <button
                                        onClick={e => { e.stopPropagation(); handleItemStatus(budget.id, item.id, 'rejected'); }}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-xl text-sm font-bold transition-colors border border-red-200 dark:border-red-700"
                                      >
                                        <XCircle className="h-4 w-4" /> Rejeitar
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={e => { e.stopPropagation(); handleItemStatus(budget.id, item.id, 'pending'); }}
                                      className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700"
                                    >
                                      ↩ Desfazer
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {/* Summary */}
                          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                            <div className="grid grid-cols-3 gap-3 text-center mb-3">
                              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-2">
                                <p className="text-lg font-black text-emerald-600">
                                  {budget.budget_items.filter(i => i.item_status === 'approved').length}
                                </p>
                                <p className="text-[11px] text-emerald-500 font-bold uppercase">Aprovados</p>
                              </div>
                              <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-2">
                                <p className="text-lg font-black text-red-500">
                                  {budget.budget_items.filter(i => i.item_status === 'rejected').length}
                                </p>
                                <p className="text-[11px] text-red-400 font-bold uppercase">Rejeitados</p>
                              </div>
                              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-2">
                                <p className="text-lg font-black text-amber-600">
                                  {budget.budget_items.filter(i => !i.item_status || i.item_status === 'pending').length}
                                </p>
                                <p className="text-[11px] text-amber-500 font-bold uppercase">Pendentes</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <p className="text-sm text-slate-500 dark:text-slate-400">Total orçamento</p>
                              <p className="text-xl font-black text-slate-900 dark:text-white">{fmtBRL(budget.total_value)}</p>
                            </div>
                          </div>
                        </div>

                      ) : (
                        /* ── Physical items table ── */
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                          <table className="min-w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-700/60">
                              <tr>
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">Item</th>
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">Qtd</th>
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">Valor</th>
                                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                              {budget.budget_items.map((item) => (
                                <tr key={item.id} className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                  <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300 text-sm">
                                    {item.product?.name || item.custom_item_name || "Item sem nome"}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="number"
                                        value={item.quantity}
                                        onChange={(e) => handleUpdateItemQuantity(budget.id, item.id, parseFloat(e.target.value) || 0)}
                                        className="w-16 px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                        min="0" step="any"
                                      />
                                      <span className="text-xs text-slate-500">{getUnitLabel(item.unit)}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
                                    {item.unit_price
                                      ? fmtBRL(item.quantity * item.unit_price)
                                      : <span className="text-slate-400">—</span>
                                    }
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    <button
                                      onClick={() => handleRemoveItem(budget.id, item.id)}
                                      className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                      title="Remover item"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    ) : (
                      <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
                        Nenhum item encontrado neste orçamento.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AuthorizationsPage;
