import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  RefreshCw,
  ChevronDown,
  Eye,
  Clock,
  Ban,
  Check,
  ThumbsUp,
  ShoppingBag,
} from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "../context/AuthContext";
import { useNotification } from "../context/NotificationContext";
import { getBudgetHistory, updateBudgetStatus, getHotels } from "../lib/supabase"; 
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

  const handleApproveBudget = async (budgetId: string) => {
    if (!user || !user.email) {
      addNotification("Usuário não autenticado ou e-mail não disponível.", "error");
      return;
    }
    const approverUserEmail = user.email; 

    try {
      setLoading(true);
      const result = await updateBudgetStatus(budgetId, "approved", approverUserEmail);
      if (result.success) {
        addNotification("Orçamento aprovado com sucesso!", "success");
        
        // Encontrar o orçamento que foi aprovado para incluir detalhes na notificação
        const budget = allBudgets.find(b => b.id === budgetId);
        if (budget) {
          try {
            // Criar notificação para o evento BUDGET_APPROVED
            await createNotification({
              event_type: 'BUDGET_APPROVED',
              hotel_id: budget.hotel_id,
              title: 'Orçamento aprovado',
              content: `Orçamento de ${getMainSupplier(budget)} no valor de R$ ${budget.total_value.toFixed(2).replace('.', ',')} foi aprovado por ${approverUserEmail.split('@')[0]}`,
              link: `/budget/${budgetId}`,
              metadata: {
                budget_id: budgetId,
                total_value: budget.total_value,
                supplier: getMainSupplier(budget),
                approved_by: approverUserEmail,
                items_count: budget.budget_items.length
              }
            });
            
            console.log('Notificação de orçamento aprovado enviada com sucesso');
          } catch (notificationError) {
            console.error('Erro ao enviar notificação de orçamento aprovado:', notificationError);
            // Não interrompe o fluxo principal se a notificação falhar
          }
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
      if (result.success) {
        addNotification("Orçamento cancelado com sucesso!", "success");
        
        // Disparar notificação de orçamento cancelado
        if (budget) {
          try {
            // Criar notificação para o evento BUDGET_CANCELLED
            await createNotification({
              event_type: 'BUDGET_CANCELLED',
              hotel_id: budget.hotel_id,
              title: 'Orçamento cancelado',
              content: `Orçamento de ${getMainSupplier(budget)} no valor de R$ ${budget.total_value.toFixed(2).replace('.', ',')} foi cancelado`,
              link: `/budget/${budgetId}`,
              metadata: {
                budget_id: budgetId,
                total_value: budget.total_value,
                supplier: getMainSupplier(budget),
                cancelled_by: user?.email || 'Usuário do sistema',
                items_count: budget.budget_items.length
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
                  
                  <h3 className={`text-lg font-medium mb-3 ${hotelColorScheme.light.text} ${hotelColorScheme.dark.text}`}>
                    Orçamento: {mainSupplierName}
                  </h3>
                  
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
                    <h4 className="text-gray-800 dark:text-gray-200 font-medium mb-2">Itens do Orçamento:</h4>
                    {budget.budget_items && budget.budget_items.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm text-gray-700 dark:text-gray-300">
                          <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                              <th className="px-3 py-2 text-left">Item</th>
                              <th className="px-3 py-2 text-left">Qtd</th>
                              <th className="px-3 py-2 text-left">Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {budget.budget_items.map((item) => (
                              <tr key={item.id} className="border-t border-gray-100 dark:border-gray-700">
                                <td className="px-3 py-2">
                                  {item.product?.name || item.custom_item_name || "Item sem nome"}
                                </td>
                                <td className="px-3 py-2">
                                  {item.quantity} {getUnitLabel(item.unit)}
                                </td>
                                <td className="px-3 py-2">
                                  {item.unit_price
                                    ? `R$ ${(item.quantity * item.unit_price).toFixed(2).replace(".", ",")}`
                                    : "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
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
