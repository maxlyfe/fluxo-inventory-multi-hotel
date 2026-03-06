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
  CreditCard,
  Truck,
  Image as ImageIcon,
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
  // Campos online
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

  // Cores refinadas em estilo pastel para modo claro e escuro
  const hotelColors = {
    "Costa do Sol Boutique Hotel": {
      light: { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-200" },
      dark: { bg: "dark:bg-emerald-900", text: "dark:text-emerald-100", border: "dark:border-emerald-800" }
    },
    "Brava Club": {
      light: { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200" },
      dark: { bg: "dark:bg-blue-900", text: "dark:text-blue-100", border: "dark:border-blue-800" }
    },
    "Maria Maria": {
      light: { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-200" },
      dark: { bg: "dark:bg-amber-900", text: "dark:text-amber-100", border: "dark:border-amber-800" }
    },
    "Villa Pitanga": {
      light: { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-200" },
      dark: { bg: "dark:bg-orange-900", text: "dark:text-orange-100", border: "dark:border-orange-800" }
    },
    default: {
      light: { bg: "bg-gray-100", text: "text-gray-800", border: "border-gray-200" },
      dark: { bg: "dark:bg-gray-800", text: "dark:text-gray-100", border: "dark:border-gray-700" }
    }
  };

  const getMainSupplier = (budget: Budget): string => {
    const specifiedSuppliers = budget.budget_items
      .map(item => item.supplier)
      .filter((supplier): supplier is string => !!supplier && supplier.trim() !== '');

      if (specifiedSuppliers.length === 0) {
        return 'Não especificado';
      }

      const supplierCounts: { [key: string]: number } = {};
      specifiedSuppliers.forEach(supplier => {
        supplierCounts[supplier] = (supplierCounts[supplier] || 0) + 1;
      });

      let mainSupplier = specifiedSuppliers[0];
      let maxCount = 0;

      Object.entries(supplierCounts).forEach(([supplier, count]) => {
        if (count > maxCount) {
          maxCount = count;
          mainSupplier = supplier;
        }
      });
      
      if (Object.keys(supplierCounts).length > 1 && maxCount > 0) {
         return `${mainSupplier} (e outros)`;
      }
      if (maxCount === 0 && specifiedSuppliers.length > 0) { 
          return specifiedSuppliers[0]; 
      }
      if (maxCount === 0 && specifiedSuppliers.length === 0) {
          return 'Não especificado';
      }

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
      
      // Encontrar o orçamento atualizado no estado local
      const budget = allBudgets.find(b => b.id === budgetId);
      if (!budget) throw new Error("Orçamento não encontrado.");

      // 1. Salvar as alterações nos itens (se houver)
      const updateItemsResult = await updateBudgetItems(budgetId, budget.budget_items, budget.total_value);
      if (!updateItemsResult.success) {
        throw new Error(updateItemsResult.error || "Falha ao atualizar itens do orçamento");
      }

      // 2. Atualizar o status para aprovado
      const result = await updateBudgetStatus(budgetId, "approved", approverUserEmail);
      if (result.success && result.data) {
        addNotification("Orçamento aprovado com sucesso!", "success");
        
        try {
          // Criar notificação para o evento BUDGET_APPROVED
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
    if (!window.confirm("Tem certeza que deseja cancelar este orçamento? Esta ação não pode ser desfeita.")) {
      return;
    }
    try {
      setLoading(true);
      
      // Encontrar o orçamento que será cancelado para incluir detalhes na notificação
      const budget = allBudgets.find(b => b.id === budgetId);
      
      const result = await updateBudgetStatus(budgetId, "cancelled");
      if (result.success && result.data) {
        addNotification("Orçamento cancelado com sucesso!", "success");
        
        // Disparar notificação de orçamento cancelado
        if (budget) {
          try {
            // Criar notificação para o evento BUDGET_CANCELLED
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
            
            console.log('Notificação de orçamento cancelado enviada com sucesso');
          } catch (notificationError) {
            console.error('Erro ao enviar notificação de orçamento cancelado:', notificationError);
            // Não interrompe o fluxo principal se a notificação falhar
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

  // ── Estado de carrossel por item online ──
  const [carouselIndex, setCarouselIndex] = useState<Record<string, number>>({});
  const setItemCarouselIndex = (itemId: string, idx: number) =>
    setCarouselIndex(prev => ({ ...prev, [itemId]: idx }));

  // ── Edições locais por item (pagamento + qtd) antes de salvar ──
  const [itemEdits, setItemEdits] = useState<Record<string, {
    quantity: number;
    payment_type: 'cash' | 'installment';
    installments: number;
    installment_value: number;
    unit_price: number;
  }>>({});

  const initItemEdit = (item: BudgetItem) => {
    if (itemEdits[item.id]) return; // já inicializado
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

  // Salva edição no banco e aprova
  const handleApproveItemWithEdit = async (budgetId: string, item: BudgetItem) => {
    const edit = getItemEdit(item);
    // 1. Salva pagamento/qtd
    await updateBudgetItemPayment(item.id, {
      quantity: edit.quantity,
      payment_type: edit.payment_type,
      installments: edit.payment_type === 'installment' ? edit.installments : null,
      installment_value: edit.payment_type === 'installment' ? edit.installment_value : null,
      unit_price: edit.payment_type === 'cash' ? edit.unit_price : null,
    });
    // 2. Aprova o item
    await handleItemStatus(budgetId, item.id, 'approved');
    // 3. Atualiza qtd/pagamento no estado local
    setAllBudgets(prev => prev.map(b => {
      if (b.id !== budgetId) return b;
      return {
        ...b,
        budget_items: b.budget_items.map(i =>
          i.id === item.id ? { ...i, ...edit } : i
        ),
      };
    }));
    setFilteredBudgets(prev => prev.map(b => {
      if (b.id !== budgetId) return b;
      return {
        ...b,
        budget_items: b.budget_items.map(i =>
          i.id === item.id ? { ...i, ...edit } : i
        ),
      };
    }));
  };

  // ── Aprovar / rejeitar item individual online ──
  const handleItemStatus = async (
    budgetId: string,
    itemId: string,
    status: 'approved' | 'rejected'
  ) => {
    const result = await updateBudgetItemStatus(itemId, status);
    if (result.success) {
      const label = status === 'approved' ? 'aprovado' : 'rejeitado';
      addNotification(`Item ${label} com sucesso!`, 'success');
      setAllBudgets(prev => prev.map(b => {
        if (b.id !== budgetId) return b;
        return {
          ...b,
          budget_items: b.budget_items.map(i =>
            i.id === itemId ? { ...i, item_status: status } : i
          ),
        };
      }));
      // Sincroniza filteredBudgets
      setFilteredBudgets(prev => prev.map(b => {
        if (b.id !== budgetId) return b;
        return {
          ...b,
          budget_items: b.budget_items.map(i =>
            i.id === itemId ? { ...i, item_status: status } : i
          ),
        };
      }));
    } else {
      addNotification('Erro ao atualizar item.', 'error');
    }
  };

  // ── Helper: formatar valor monetário ──
  const fmtBRL = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const getUnitLabel = (unitValue: string | null | undefined): string => {
    if (!unitValue) return "-";
    const option = unitOptions.find(opt => opt.value === unitValue);
    return option ? option.label : unitValue;
  };

  if (loading && !allBudgets.length) return <div className="p-4 text-center">Carregando autorizações...</div>;
  if (error) return <div className="p-4 text-center text-red-500">{error}</div>;

  // Função para obter as cores baseadas no nome do hotel
  const getHotelColors = (hotelName: string | undefined) => {
    if (!hotelName) return hotelColors.default;
    
    if (hotelName.includes("Costa do Sol")) return hotelColors["Costa do Sol Boutique Hotel"];
    if (hotelName.includes("Brava Club")) return hotelColors["Brava Club"];
    if (hotelName.includes("Maria Maria")) return hotelColors["Maria Maria"];
    if (hotelName.includes("Villa Pitanga")) return hotelColors["Villa Pitanga"];
    
    return hotelColors.default;
  };

  return (
    <div className="w-full">
      <div className="flex items-center mb-6">
        <button 
          onClick={() => navigate(-1)} 
          className="flex items-center text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors mr-4"
        >
          <ArrowLeft className="h-5 w-5 mr-1" /> Voltar
        </button>
        
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center">
          <ThumbsUp className="h-6 w-6 text-blue-500 dark:text-blue-400 mr-2" />
          Autorizações de Compra
        </h1>
        
        <button 
          onClick={() => fetchAllBudgetsAndHotels(activeHotelFilter)}
          className="ml-auto text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          title="Atualizar"
        >
          <RefreshCw className="h-5 w-5" />
        </button>
      </div>

      {/* Filtros de hotel */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => handleFilterByHotel(null)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            activeHotelFilter === null
              ? "bg-blue-100 text-blue-800 dark:bg-blue-700 dark:text-blue-100"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          }`}
        >
          Todos os Hotéis
        </button>
        {hotels.map((hotel) => {
          const hotelColorScheme = getHotelColors(hotel.name);
          return (
            <button
              key={hotel.id}
              onClick={() => handleFilterByHotel(hotel.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeHotelFilter === hotel.id
                  ? `${hotelColorScheme.light.bg} ${hotelColorScheme.light.text} ${hotelColorScheme.dark.bg} ${hotelColorScheme.dark.text}`
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              {hotel.name}
            </button>
          );
        })}
      </div>

      {filteredBudgets.length === 0 ? (
        <div className="text-center py-8">
          <ShoppingBag className="h-12 w-12 mx-auto text-gray-400 dark:text-gray-500 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            Nenhum orçamento pendente de aprovação encontrado.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBudgets.map((budget) => {
            const hotelName = budget.hotel?.name || "Hotel não especificado";
            const formattedDate = isValid(parseISO(budget.created_at))
              ? format(parseISO(budget.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
              : "Data inválida";
            const mainSupplierName = getMainSupplier(budget);
            const hotelColorScheme = getHotelColors(hotelName);
            const isOnline = !!budget.is_online;
            
            return (
              <div 
                key={budget.id} 
                className={`rounded-lg shadow-sm border ${hotelColorScheme.light.border} ${hotelColorScheme.dark.border} ${hotelColorScheme.light.bg} ${hotelColorScheme.dark.bg} overflow-hidden transition-shadow hover:shadow-md`}
              >
                <div className="p-4">
                  <div className={`flex items-center text-sm mb-2 ${hotelColorScheme.light.text} ${hotelColorScheme.dark.text}`}>
                    <Calendar className="h-4 w-4 mr-1.5" />
                    {formattedDate} (Hotel: {hotelName})
                  </div>
                  
                  <div className="flex justify-between items-center mb-2">
                    <div className={`font-medium ${hotelColorScheme.light.text} ${hotelColorScheme.dark.text}`}>
                      R$ {budget.total_value.toFixed(2).replace(".", ",")}
                    </div>
                    <div className="bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-100 text-xs px-2 py-0.5 rounded-full flex items-center">
                      <Clock className="h-3 w-3 mr-1" />
                      Pendente
                    </div>
                  </div>
                  
                  <h3 className={`text-lg font-medium mb-1 ${hotelColorScheme.light.text} ${hotelColorScheme.dark.text} flex items-center gap-2 flex-wrap`}>
                    {isOnline && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 text-xs font-bold border border-cyan-200 dark:border-cyan-700">
                        <Globe className="h-3 w-3" /> Online
                      </span>
                    )}
                    Orçamento: {mainSupplierName}
                  </h3>
                  {isOnline && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                      {budget.budget_items.length} produto{budget.budget_items.length !== 1 ? 's' : ''} · Aprovação individual por item
                    </p>
                  )}
                  
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={() => toggleBudgetExpand(budget.id)}
                      className="flex items-center px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 rounded-md transition-colors"
                    >
                      Ver Itens <ChevronDown className={`h-4 w-4 ml-1 transition-transform ${expandedBudget === budget.id ? 'rotate-180' : ''}`} />
                    </button>
                    
                    <button
                      onClick={() => handleApproveBudget(budget.id)}
                      className="flex items-center px-3 py-1.5 text-sm bg-green-100 hover:bg-green-200 text-green-700 dark:bg-green-700 dark:hover:bg-green-600 dark:text-green-100 rounded-md transition-colors"
                    >
                      <Check className="h-4 w-4 mr-1" /> Aprovar
                    </button>
                    
                    <button
                      onClick={() => handleCancelBudget(budget.id)}
                      className="flex items-center px-3 py-1.5 text-sm bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-700 dark:hover:bg-red-600 dark:text-red-100 rounded-md transition-colors"
                    >
                      <Ban className="h-4 w-4 mr-1" /> Cancelar
                    </button>
                    
                    <Link
                      to={`/budget/${budget.id}`}
                      className="flex items-center px-3 py-1.5 text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 dark:text-blue-100 rounded-md transition-colors"
                    >
                      <Eye className="h-4 w-4 mr-1" /> Detalhes
                    </Link>
                  </div>
                </div>
                
                {expandedBudget === budget.id && (
                  <div className="bg-white dark:bg-gray-800 p-4 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-gray-800 dark:text-gray-200 font-medium mb-3">
                      {isOnline ? 'Produtos do Orçamento Online' : 'Itens do Orçamento:'}
                    </h4>

                    {budget.budget_items && budget.budget_items.length > 0 ? (
                      isOnline ? (
                        /* ── Cards de produto ONLINE ── */
                        <div className="space-y-4">
                          {budget.budget_items.map((item) => {
                            const imgs = item.image_urls || [];
                            const imgIdx = carouselIndex[item.id] || 0;
                            const edit = getItemEdit(item);
                            const isApproved = item.item_status === 'approved';
                            const isRejected = item.item_status === 'rejected';

                            // Calcula totais com base na edição local
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
                                  isApproved ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/10'
                                  : isRejected ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10 opacity-60'
                                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800'
                                }`}
                              >
                                {/* ── Carrossel de imagens ── */}
                                {imgs.length > 0 ? (
                                  <div className="relative h-48 bg-gray-100 dark:bg-gray-900 group">
                                    <img
                                      src={imgs[imgIdx]}
                                      alt={item.custom_item_name || 'produto'}
                                      className="w-full h-full object-contain"
                                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                    {imgs.length > 1 && (
                                      <>
                                        <button onClick={e => { e.stopPropagation(); setItemCarouselIndex(item.id, (imgIdx - 1 + imgs.length) % imgs.length); }}
                                          className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                          <ChevronLeft className="h-4 w-4" />
                                        </button>
                                        <button onClick={e => { e.stopPropagation(); setItemCarouselIndex(item.id, (imgIdx + 1) % imgs.length); }}
                                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                          <ChevronRight className="h-4 w-4" />
                                        </button>
                                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                                          {imgs.map((_, i) => (
                                            <button key={i} onClick={e => { e.stopPropagation(); setItemCarouselIndex(item.id, i); }}
                                              className={`h-1.5 rounded-full transition-all ${i === imgIdx ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`} />
                                          ))}
                                        </div>
                                      </>
                                    )}
                                    {/* Badge status */}
                                    {(isApproved || isRejected) && (
                                      <span className={`absolute top-2 left-2 text-xs font-bold px-2 py-1 rounded-full shadow ${
                                        isApproved ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                                      }`}>
                                        {isApproved ? '✓ Aprovado' : '✗ Rejeitado'}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="h-16 bg-gray-100 dark:bg-gray-700/40 flex items-center justify-center">
                                    <ImageIcon className="h-6 w-6 text-gray-300" />
                                  </div>
                                )}

                                {/* ── Corpo do card ── */}
                                <div className="p-4 space-y-3">

                                  {/* Nome + botão link */}
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-base font-bold text-gray-900 dark:text-white leading-snug flex-1">
                                      {item.custom_item_name || 'Produto sem nome'}
                                    </p>
                                    {item.product_link && (
                                      <a href={item.product_link} target="_blank" rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-medium hover:bg-blue-100 transition-colors border border-blue-200 dark:border-blue-700"
                                        title="Abrir anúncio original">
                                        <ExternalLink className="h-3.5 w-3.5" /> Ver anúncio
                                      </a>
                                    )}
                                  </div>

                                  {/* ── Preços: à vista + parcelado lado a lado ── */}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className={`rounded-xl p-2.5 border-2 transition-all ${
                                      edit.payment_type === 'cash'
                                        ? 'border-green-400 bg-green-50 dark:bg-green-900/20'
                                        : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 opacity-60'
                                    }`}>
                                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">À vista</p>
                                      <p className="text-sm font-black text-green-700 dark:text-green-400">
                                        {fmtBRL(priceAVista)}
                                      </p>
                                    </div>
                                    <div className={`rounded-xl p-2.5 border-2 transition-all ${
                                      edit.payment_type === 'installment'
                                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                                        : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 opacity-60'
                                    }`}>
                                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">Parcelado</p>
                                      {item.installments && item.installment_value ? (
                                        <p className="text-sm font-black text-blue-700 dark:text-blue-400">
                                          {item.installments}x {fmtBRL(item.installment_value)}
                                        </p>
                                      ) : (
                                        <p className="text-sm text-gray-400">—</p>
                                      )}
                                    </div>
                                  </div>

                                  {/* ── Frete ── */}
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

                                  {/* ── Seletor de pagamento (editável) ── */}
                                  {!isApproved && !isRejected && (
                                    <div className="border border-gray-200 dark:border-gray-600 rounded-2xl p-3 space-y-3 bg-gray-50 dark:bg-gray-700/20">
                                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Confirmar pagamento</p>

                                      {/* Toggle à vista / parcelado */}
                                      <div className="flex gap-2">
                                        <button
                                          onClick={e => { e.stopPropagation(); initItemEdit(item); updateItemEdit(item.id, 'payment_type', 'cash'); }}
                                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                                            edit.payment_type === 'cash'
                                              ? 'bg-green-600 text-white border-green-600 shadow-sm'
                                              : 'bg-white dark:bg-gray-700 text-gray-500 border-gray-200 dark:border-gray-600 hover:border-green-400'
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
                                              : 'bg-white dark:bg-gray-700 text-gray-500 border-gray-200 dark:border-gray-600 hover:border-blue-400'
                                          }`}
                                        >
                                          💳 Parcelado
                                        </button>
                                      </div>

                                      {/* Parcelas (se parcelado) */}
                                      {edit.payment_type === 'installment' && (
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-gray-500 whitespace-nowrap">Parcelas:</span>
                                          <input
                                            type="number"
                                            value={edit.installments}
                                            onChange={e => { e.stopPropagation(); updateItemEdit(item.id, 'installments', parseInt(e.target.value) || 2); }}
                                            onClick={e => e.stopPropagation()}
                                            min="2" max="48"
                                            className="w-16 text-center px-2 py-1.5 rounded-xl border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-700 text-sm font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                          />
                                          <span className="text-xs text-gray-500">x</span>
                                          <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                            {fmtBRL(edit.installment_value || item.installment_value || 0)}
                                          </span>
                                        </div>
                                      )}

                                      {/* Quantidade */}
                                      <div className="flex items-center gap-3">
                                        <span className="text-xs text-gray-500 whitespace-nowrap">Quantidade:</span>
                                        <div className="flex items-center gap-2">
                                          <button onClick={e => { e.stopPropagation(); updateItemEdit(item.id, 'quantity', Math.max(1, edit.quantity - 1)); }}
                                            className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-gray-100 font-bold text-lg">−</button>
                                          <input
                                            type="number"
                                            value={edit.quantity}
                                            onChange={e => { e.stopPropagation(); updateItemEdit(item.id, 'quantity', Math.max(1, parseInt(e.target.value) || 1)); }}
                                            onClick={e => e.stopPropagation()}
                                            min="1"
                                            className="w-14 text-center px-1 py-1.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                          />
                                          <button onClick={e => { e.stopPropagation(); updateItemEdit(item.id, 'quantity', edit.quantity + 1); }}
                                            className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-gray-100 font-bold text-lg">+</button>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* ── Total do item ── */}
                                  <div className="flex items-center justify-between bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl px-4 py-3 border border-indigo-100 dark:border-indigo-800/30">
                                    <div>
                                      <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide">
                                        Total ({edit.quantity} un. · {edit.payment_type === 'cash' ? 'à vista' : `${edit.installments}x`})
                                      </p>
                                      <p className="text-xl font-black text-indigo-700 dark:text-indigo-300">{fmtBRL(totalItem)}</p>
                                    </div>
                                    {freteUnitario > 0 && (
                                      <p className="text-xs text-orange-500">+frete</p>
                                    )}
                                  </div>

                                  {/* ── Botões aprovar / rejeitar ── */}
                                  {!isApproved && !isRejected ? (
                                    <div className="flex gap-2">
                                      <button
                                        onClick={e => { e.stopPropagation(); handleApproveItemWithEdit(budget.id, item); }}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold transition-colors shadow-sm"
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
                                      className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                      ↩ Desfazer
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {/* ── Resumo geral ── */}
                          <div className="bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-700/50 dark:to-gray-800/50 rounded-2xl p-4 border border-gray-200 dark:border-gray-700">
                            <div className="grid grid-cols-3 gap-3 text-center mb-3">
                              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-2">
                                <p className="text-lg font-black text-green-600">{budget.budget_items.filter(i => i.item_status === 'approved').length}</p>
                                <p className="text-[10px] text-green-500 font-bold uppercase">Aprovados</p>
                              </div>
                              <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-2">
                                <p className="text-lg font-black text-red-500">{budget.budget_items.filter(i => i.item_status === 'rejected').length}</p>
                                <p className="text-[10px] text-red-400 font-bold uppercase">Rejeitados</p>
                              </div>
                              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-2">
                                <p className="text-lg font-black text-amber-600">{budget.budget_items.filter(i => !i.item_status || i.item_status === 'pending').length}</p>
                                <p className="text-[10px] text-amber-500 font-bold uppercase">Pendentes</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <p className="text-sm text-gray-500 dark:text-gray-400">Total orçamento</p>
                              <p className="text-xl font-black text-gray-900 dark:text-white">{fmtBRL(budget.total_value)}</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                                      <span className="text-gray-600 dark:text-gray-300">
                                        {fmtBRL(item.unit_price || 0)} à vista
                                      </span>
                                    )}
                                  </div>

                                  {/* Frete */}
                                  <div className="flex items-center gap-1 text-xs">
                                    <Truck className="h-3.5 w-3.5 text-gray-400" />
                                    {!item.shipping_cost || item.shipping_cost === 0 ? (
                                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">Frete grátis</span>
                                    ) : (
                                      <span className="text-orange-600 dark:text-orange-400">Frete: {fmtBRL(item.shipping_cost)}</span>
                                    )}
                                  </div>

                                  {/* Qtd + Total */}
                                  <div className="flex items-center justify-between pt-1 border-t border-gray-200 dark:border-gray-600">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-gray-400">Qtd:</span>
                                      <input
                                        type="number"
                                        value={item.quantity}
                                        onChange={(e) => handleUpdateItemQuantity(budget.id, item.id, parseFloat(e.target.value) || 1)}
                                        className="w-14 p-1 text-xs text-center border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-bold"
                                        min="1" step="1"
                                      />
                                    </div>
                                    <span className="text-sm font-black text-indigo-700 dark:text-indigo-300">
                                      {fmtBRL(itemTotal)}
                                    </span>
                                  </div>

                                  {/* Botões aprovar / rejeitar por item */}
                                  {!isApproved && !isRejected && (
                                    <div className="flex gap-2 pt-1">
                                      <button
                                        onClick={() => handleItemStatus(budget.id, item.id, 'approved')}
                                        className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300 rounded-lg text-xs font-bold transition-colors"
                                      >
                                        <Check className="h-3.5 w-3.5" /> Aprovar
                                      </button>
                                      <button
                                        onClick={() => handleItemStatus(budget.id, item.id, 'rejected')}
                                        className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-lg text-xs font-bold transition-colors"
                                      >
                                        <XCircle className="h-3.5 w-3.5" /> Rejeitar
                                      </button>
                                    </div>
                                  )}
                                  {(isApproved || isRejected) && (
                                    <button
                                      onClick={() => handleItemStatus(budget.id, item.id, 'pending')}
                                      className="w-full py-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                                    >
                                      ↩ Desfazer
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {/* Resumo dos itens online */}
                          <div className="bg-gray-100 dark:bg-gray-700/50 rounded-xl p-3 flex items-center justify-between">
                            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                              <p>✅ Aprovados: {budget.budget_items.filter(i => i.item_status === 'approved').length}</p>
                              <p>❌ Rejeitados: {budget.budget_items.filter(i => i.item_status === 'rejected').length}</p>
                              <p>⏳ Pendentes: {budget.budget_items.filter(i => !i.item_status || i.item_status === 'pending').length}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-400">Total orçamento</p>
                              <p className="text-lg font-black text-gray-800 dark:text-white">{fmtBRL(budget.total_value)}</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* ── Tabela padrão FÍSICO ── */
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm text-gray-700 dark:text-gray-300">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                              <tr>
                                <th className="px-3 py-2 text-left">Item</th>
                                <th className="px-3 py-2 text-left">Qtd</th>
                                <th className="px-3 py-2 text-left">Valor</th>
                                <th className="px-3 py-2 text-right">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {budget.budget_items.map((item) => (
                                <tr key={item.id} className="border-t border-gray-100 dark:border-gray-700">
                                  <td className="px-3 py-2">{item.product?.name || item.custom_item_name || "Item sem nome"}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center">
                                      <input
                                        type="number"
                                        value={item.quantity}
                                        onChange={(e) => handleUpdateItemQuantity(budget.id, item.id, parseFloat(e.target.value) || 0)}
                                        className="w-16 p-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 mr-1"
                                        min="0" step="any"
                                      />
                                      <span className="text-xs text-gray-500">{getUnitLabel(item.unit)}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    {item.unit_price ? `R$ ${(item.quantity * item.unit_price).toFixed(2).replace(".", ",")}` : "-"}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button onClick={() => handleRemoveItem(budget.id, item.id)}
                                      className="text-red-500 hover:text-red-700 transition-colors" title="Remover item">
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
                      <p className="text-gray-500 dark:text-gray-400">Nenhum item encontrado neste orçamento.</p>
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
