import { createClient } from "@supabase/supabase-js";
import { startOfWeek, endOfWeek, formatISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL and Anon Key must be defined in environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper function to create a query builder with hotel filter
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const withHotelScope = (query: any, hotelId: string) => {
  return query.eq("hotel_id", hotelId);
};

// --- Funções para Transferência entre Hotéis ---
export const transferProducts = async (
  sourceHotelId: string,
  destinationHotelId: string,
  productId: string,
  quantity: number,
  notes?: string
) => {
  try {
    const { data, error } = await supabase
      .from("hotel_transfers")
      .insert({
        source_hotel_id: sourceHotelId,
        destination_hotel_id: destinationHotelId,
        product_id: productId,
        quantity,
        notes,
        status: "pending",
      });

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error transferring products:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao transferir produtos.";
    return { success: false, error: errorMessage };
  }
};

export const completeTransfer = async (transferId: string) => {
  try {
    const { data, error } = await supabase
      .from("hotel_transfers")
      .update({ status: "completed" })
      .eq("id", transferId)
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error completing transfer:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao completar a transferência.";
    return { success: false, error: errorMessage };
  }
};

export const cancelTransfer = async (transferId: string) => {
  try {
    const { data, error } = await supabase
      .from("hotel_transfers")
      .update({ status: "cancelled" })
      .eq("id", transferId)
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error cancelling transfer:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao cancelar a transferência.";
    return { success: false, error: errorMessage };
  }
};

export const getHotelInventory = async (hotelId: string) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("hotel_id", hotelId)
      .order("name");

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching hotel inventory:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar o inventário do hotel.";
    return { success: false, error: errorMessage };
  }
};

export const getHotelTransfers = async (hotelId: string) => {
  try {
    const { data, error } = await supabase
      .from("hotel_transfers")
      .select(
        "*, source_hotel:hotels!source_hotel_id(name), destination_hotel:hotels!destination_hotel_id(name), product:products(name)"
      )
      .or(`source_hotel_id.eq.${hotelId},destination_hotel_id.eq.${hotelId}`)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching hotel transfers:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar as transferências do hotel.";
    return { success: false, error: errorMessage };
  }
};

// --- Funções para Orçamentos ---

interface BudgetItemData {
  product_id: string | null;
  custom_item_name?: string | null;
  quantity: number;
  unit_price?: number | null;
  supplier?: string | null;
  last_purchase_quantity?: number | null;
  last_purchase_price?: number | null;
  last_purchase_date?: string | null;
  weight?: number | null;
  unit?: string | null;
  stock_at_creation?: number | null;
}

export const saveBudget = async (
  hotelId: string,
  totalValue: number,
  items: BudgetItemData[]
) => {
  try {
    const { data: budgetData, error: budgetError } = await supabase
      .from("budgets")
      .insert({
        hotel_id: hotelId,
        total_value: totalValue,
        status: "pending", // Status inicial como 'pending'
      })
      .select()
      .single();

    if (budgetError) throw budgetError;
    if (!budgetData) throw new Error("Falha ao criar o registro do orçamento.");

    const budgetId = budgetData.id;

    const budgetItemsData = items.map((item) => ({
      budget_id: budgetId,
      product_id: item.product_id,
      custom_item_name: item.custom_item_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      supplier: item.supplier,
      last_purchase_quantity: item.last_purchase_quantity,
      last_purchase_price: item.last_purchase_price,
      last_purchase_date: item.last_purchase_date,
      weight: item.weight,
      unit: item.unit,
      stock_at_creation: item.stock_at_creation,
    }));

    const { error: itemsError } = await supabase
      .from("budget_items")
      .insert(budgetItemsData);

    if (itemsError) {
      console.error("Error inserting budget items:", itemsError);
      try {
        await supabase.from("budgets").delete().eq("id", budgetId);
        console.log(
          `Rolled back budget ${budgetId} due to item insertion error.`
        );
      } catch (rollbackError) {
        console.error(
          `Failed to rollback budget ${budgetId}:`,
          rollbackError
        );
      }
      throw itemsError;
    }

    return { success: true, budgetId };
  } catch (err) {
    console.error("Error in saveBudget function:", err);
    let errorMessage = "Ocorreu um erro desconhecido ao salvar o orçamento.";
    
    if (err instanceof Error) {
      if (err.message && err.message.trim() !== "") {
        errorMessage = err.message;
      }
    } else if (typeof err === 'string' && err.trim() !== "") {
      errorMessage = err;
    }
    
    return { success: false, error: errorMessage };
  }
};

// CORRIGIDO: Removido approved_by e approval_date do select principal
export const getBudgetHistory = async (hotelId: string) => {
  try {
    const { data, error } = await supabase
      .from("budgets")
      .select(
        "id, created_at, total_value, status, hotel_id, user_id, approved_by_user_email, approved_at, hotel:hotels(id, name), budget_items(id, product_id, custom_item_name, quantity, unit_price, supplier, last_purchase_quantity, last_purchase_price, last_purchase_date, weight, unit, stock_at_creation, product:products(id, name))"
      )
      .eq("hotel_id", hotelId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching budget history:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar o histórico de orçamentos.";
    return { success: false, error: errorMessage };
  }
};

// CORRIGIDO: Removido approved_by e approval_date do select principal
export const getBudgetDetails = async (budgetId: string) => {
  try {
    const { data, error } = await supabase
      .from("budgets")
      .select(
        "id, created_at, total_value, status, hotel_id, user_id, approved_by_user_email, approved_at, hotel:hotels(id, name), budget_items(id, product_id, custom_item_name, quantity, unit_price, supplier, last_purchase_quantity, last_purchase_price, last_purchase_date, weight, unit, stock_at_creation, product:products(id, name, category))"
      )
      .eq("id", budgetId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return { success: false, error: "Orçamento não encontrado.", data: null };
      }
      throw error;
    }
    return { success: true, data };
  } catch (err) {
    console.error(`Error fetching budget details for ID ${budgetId}:`, err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar os detalhes do orçamento.";
    return { success: false, error: errorMessage };
  }
};

export const cancelBudget = async (budgetId: string) => {
  try {
    const { error } = await supabase
      .from("budgets")
      .update({ status: "cancelled" })
      .eq("id", budgetId);

    if (error) {
      console.error("Error cancelling budget:", error);
      return { success: false, error: error.message };
    }
    return { success: true, error: null };
  } catch (error: any) {
    console.error("Unexpected error in cancelBudget:", error);
    return { success: false, error: error.message };
  }
};

export const getSectorConsumptionData = async (
  hotelId: string,
  startDate: string,
  endDate: string
) => {
  try {
    const { data: hotelSectors, error: sectorsError } = await supabase
      .from("sectors")
      .select("id, name")
      .eq("hotel_id", hotelId);

    if (sectorsError) throw sectorsError;
    if (!hotelSectors || hotelSectors.length === 0) {
      console.log(`No sectors found for hotel ${hotelId}`);
      return { success: true, data: [] };
    }

    const hotelSectorIds = hotelSectors.map((s) => s.id);
    const sectorIdToNameMap = hotelSectors.reduce((acc, sector) => {
      acc[sector.id] = sector.name;
      return acc;
    }, {} as { [id: string]: string });

    const { data: consumptionItems, error: consumptionError } = await supabase
      .from("item_consumption")
      .select("item_name, quantity, consumed_at, sector_id")
      .in("sector_id", hotelSectorIds)
      .gte("consumed_at", startDate)
      .lte("consumed_at", endDate);

    if (consumptionError) throw consumptionError;
    if (!consumptionItems || consumptionItems.length === 0) {
      console.log(
        `No consumption items found for hotel ${hotelId} sectors between ${startDate} and ${endDate}`
      );
      return { success: true, data: [] };
    }

    const uniqueItemNames = [
      ...new Set(consumptionItems.map((item) => item.item_name)),
    ];
    if (uniqueItemNames.length === 0) {
      console.log("No unique item names found in consumption data.");
      return { success: true, data: [] };
    }

    const { data: hotelProducts, error: productsError } = await supabase
      .from("products")
      .select("name, average_price, last_purchase_price")
      .eq("hotel_id", hotelId)
      .in("name", uniqueItemNames);

    if (productsError) throw productsError;

    const productPriceMap =
      hotelProducts?.reduce((acc, product) => {
        acc[product.name] =
          product.average_price ?? product.last_purchase_price ?? 0;
        return acc;
      }, {} as { [name: string]: number }) || {};

    const consumptionBySector: { [sectorName: string]: number } = {};

    for (const item of consumptionItems) {
      const sectorName = sectorIdToNameMap[item.sector_id];
      const costPerUnit = productPriceMap[item.item_name] ?? 0;
      const quantityConsumed = item.quantity || 0;
      const itemTotalCost = quantityConsumed * costPerUnit;

      if (sectorName) {
        if (consumptionBySector[sectorName]) {
          consumptionBySector[sectorName] += itemTotalCost;
        } else {
          consumptionBySector[sectorName] = itemTotalCost;
        }
      } else {
        console.warn(`Sector name not found for sector_id: ${item.sector_id}`);
      }
    }

    const chartData = Object.entries(consumptionBySector).map(
      ([sectorName, totalCost]) => ({
        sectorName,
        totalCost: parseFloat(totalCost.toFixed(2)),
      })
    );

    chartData.sort((a, b) => b.totalCost - a.totalCost);

    return { success: true, data: chartData };
  } catch (err) {
    console.error("Error fetching sector consumption data:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar dados de consumo por setor.";
    return { success: false, error: errorMessage };
  }
};

export const getItemPriceHistory = async (
  hotelId: string,
  productId: string,
  startDate: string,
  endDate: string
) => {
  try {
    const { data: purchaseItems, error } = await supabase
      .from("purchase_items")
      .select("unit_price, purchase:purchases!inner(purchase_date)")
      .eq("product_id", productId)
      // .eq("purchase.hotel_id", hotelId) // Assuming purchase_items is not directly linked to hotel_id, but purchases is.
      .gte("purchase.purchase_date", startDate)
      .lte("purchase.purchase_date", endDate)
      .order("purchase_date", { foreignTable: "purchases", ascending: true });

    if (error) throw error;
    if (!purchaseItems) return { success: true, data: [] };

    const chartData = purchaseItems.map((item: any) => ({
      date: item.purchase.purchase_date,
      price: item.unit_price,
    }));

    return { success: true, data: chartData };
  } catch (err) {
    console.error(
      `Error fetching price history for product ${productId}:`,
      err
    );
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar histórico de preços do item.";
    return { success: false, error: errorMessage };
  }
};

export const getProductsForWeeklyControl = async (hotelId: string) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, category, quantity") // quantity aqui é o estoque atual
      .eq("hotel_id", hotelId)
      .order("category")
      .order("name");

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching products for weekly control:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Erro ao buscar produtos para controle semanal.";
    return { success: false, error: errorMessage };
  }
};

export const getWeeklyProductData = async (
  hotelId: string,
  productIds: string[],
  weekStartDate: Date
) => {
  try {
    const weekEndDate = endOfWeek(weekStartDate, {
      locale: ptBR,
      weekStartsOn: 1, // Considera que a semana começa na Segunda-feira
    });
    const startDateString = formatISO(weekStartDate, { representation: "date" });
    const endDateString = formatISO(weekEndDate, { representation: "date" });

    // 1. Fetch purchase items for the week
    const { data: purchaseItems, error: purchaseError } = await supabase
      .from("purchase_items")
      .select("product_id, quantity, purchase:purchases!inner(hotel_id, purchase_date)")
      .in("product_id", productIds)
      .eq("purchase.hotel_id", hotelId)
      .gte("purchase.purchase_date", startDateString)
      .lte("purchase.purchase_date", endDateString);

    if (purchaseError) {
      console.error("Error fetching purchase items:", purchaseError);
      return {
        success: false,
        error: "Erro ao buscar compras da semana: " + purchaseError.message,
      };
    }
    const purchasesByProduct = (purchaseItems || []).reduce((acc, item: any) => {
      acc[item.product_id] = (acc[item.product_id] || 0) + item.quantity;
      return acc;
    }, {} as { [productId: string]: number });

    // 2. Fetch consumption items for the week
    const { data: consumptionItems, error: consumptionError } = await supabase
      .from("item_consumption") // Assuming this table exists and has hotel_id
      .select("product_id, quantity")
      .in("product_id", productIds)
      .eq("hotel_id", hotelId) // Assuming item_consumption has hotel_id
      .gte("consumed_at", startDateString)
      .lte("consumed_at", endDateString);

    if (consumptionError) {
      console.error("Error fetching consumption items:", consumptionError);
      return {
        success: false,
        error: "Erro ao buscar consumo da semana: " + consumptionError.message,
      };
    }
    const consumptionByProduct = (consumptionItems || []).reduce((acc, item: any) => {
      acc[item.product_id] = (acc[item.product_id] || 0) + item.quantity;
      return acc;
    }, {} as { [productId: string]: number });

    // 3. Fetch saved weekly control entries for the week
    const { data: weeklyEntries, error: weeklyEntriesError } = await supabase
      .from("weekly_control_entries")
      .select("product_id, initial_stock_input, loss_quantity_input")
      .eq("hotel_id", hotelId)
      .eq("week_start_date", startDateString) // Filter by the exact start date of the week
      .in("product_id", productIds);

    if (weeklyEntriesError) {
      console.error("Error fetching weekly control entries:", weeklyEntriesError);
      return {
        success: false,
        error: "Erro ao buscar entradas de controle semanal: " + weeklyEntriesError.message,
      };
    }
    const savedInputsByProduct = (weeklyEntries || []).reduce((acc, entry: any) => {
      acc[entry.product_id] = {
        initial_stock_input: entry.initial_stock_input,
        loss_quantity_input: entry.loss_quantity_input,
      };
      return acc;
    }, {} as { [productId: string]: { initial_stock_input?: number; loss_quantity_input?: number } });

    return {
      success: true,
      data: {
        purchasesByProduct,
        consumptionByProduct,
        savedInputsByProduct,
      },
    };
  } catch (err) {
    console.error("Error in getWeeklyProductData:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Erro desconhecido ao buscar dados semanais do produto.";
    return { success: false, error: errorMessage };
  }
};

// --- Função para salvar entradas do Controle Semanal ---
interface WeeklyControlEntry {
  hotel_id: string;
  product_id: string;
  week_start_date: string; // Formato YYYY-MM-DD
  initial_stock_input?: number | null;
  loss_quantity_input?: number | null;
}

export const saveWeeklyControlEntries = async (entries: WeeklyControlEntry[]) => {
  try {
    // Usar upsert para inserir ou atualizar com base na chave única (hotel_id, product_id, week_start_date)
    const { data, error } = await supabase
      .from("weekly_control_entries")
      .upsert(entries, {
        onConflict: "hotel_id,product_id,week_start_date",
      })
      .select();

    if (error) {
      console.error("Error saving weekly control entries:", error);
      throw error;
    }
    return { success: true, data };
  } catch (err) {
    console.error("Unexpected error in saveWeeklyControlEntries:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao salvar as entradas do controle semanal.";
    return { success: false, error: errorMessage };
  }
};

// --- Função para buscar todos os hotéis ---
export const getHotels = async () => {
  try {
    const { data, error } = await supabase.from("hotels").select("id, name"); // Schema: id (uuid), name (text)
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching hotels:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar os hotéis.";
    return { success: false, error: errorMessage };
  }
};

// --- Função para atualizar status do orçamento ---
// CORRIGIDO: Removido approved_by e approval_date da lógica de update, pois não existem no schema do usuário
export const updateBudgetStatus = async (budgetId: string, newStatus: string, approverUserEmail?: string) => {
  try {
    const updateData: { status: string; approved_by_user_email?: string; approved_at?: string } = { status: newStatus };

    if (newStatus === "approved" && approverUserEmail) {
      updateData.approved_by_user_email = approverUserEmail;
      updateData.approved_at = new Date().toISOString(); // Salva o timestamp atual
    }

    const { error } = await supabase
      .from("budgets")
      .update(updateData)
      .eq("id", budgetId);

    if (error) {
      console.error("Error updating budget status:", error);
      return { success: false, error: error.message };
    }
    return { success: true, error: null };
  } catch (error: any) {
    console.error("Unexpected error in updateBudgetStatus:", error);
    return { success: false, error: error.message };
  }
};

export const updateBudgetItems = async (budgetId: string, items: any[], totalValue: number) => {
  try {
    // 1. Deletar itens atuais
    const { error: deleteError } = await supabase
      .from("budget_items")
      .delete()
      .eq("budget_id", budgetId);

    if (deleteError) throw deleteError;

    // 2. Inserir novos itens
    const budgetItemsData = items.map((item) => ({
      budget_id: budgetId,
      product_id: item.product_id,
      custom_item_name: item.custom_item_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      supplier: item.supplier,
      last_purchase_quantity: item.last_purchase_quantity,
      last_purchase_price: item.last_purchase_price,
      last_purchase_date: item.last_purchase_date,
      weight: item.weight,
      unit: item.unit,
      stock_at_creation: item.stock_at_creation,
    }));

    const { error: insertError } = await supabase
      .from("budget_items")
      .insert(budgetItemsData);

    if (insertError) throw insertError;

    // 3. Atualizar valor total do orçamento
    const { error: updateError } = await supabase
      .from("budgets")
      .update({ total_value: totalValue })
      .eq("id", budgetId);

    if (updateError) throw updateError;

    return { success: true };
  } catch (err) {
    console.error("Error updating budget items:", err);
    return { success: false, error: err instanceof Error ? err.message : "Erro ao atualizar itens do orçamento" };
  }
};

// --- Funções para Requisições de Setor ---
export const getSectorRequests = async (hotelId: string) => {
  try {
    const { data, error } = await supabase
      .from("sector_requests")
      .select(
        `
        id, 
        created_at, 
        status, 
        notes, 
        hotel_id, 
        sector_id, 
        sectors (name),
        requested_by_user_id,
        users (email),
        sector_request_items (*, products (name, unit, category))
      `
      )
      .eq("hotel_id", hotelId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching sector requests:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar as requisições do setor.";
    return { success: false, error: errorMessage };
  }
};

export const updateSectorRequestItemStatus = async (
  itemId: string,
  newStatus: "delivered" | "rejected" | "pending" | "substituted",
  deliveredQuantity?: number,
  rejectionReason?: string,
  substitutionProductId?: string,
  substitutionNotes?: string
) => {
  try {
    const updateData: any = { status: newStatus };
    if (newStatus === "delivered") {
      updateData.delivered_quantity = deliveredQuantity;
      updateData.delivered_at = new Date().toISOString();
    } else if (newStatus === "rejected") {
      updateData.rejection_reason = rejectionReason;
      updateData.rejected_at = new Date().toISOString();
    } else if (newStatus === "substituted") {
      updateData.substituted_product_id = substitutionProductId;
      updateData.substitution_notes = substitutionNotes;
      updateData.substituted_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("sector_request_items")
      .update(updateData)
      .eq("id", itemId)
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error updating sector request item status:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao atualizar o status do item da requisição.";
    return { success: false, error: errorMessage };
  }
};

// --- Funções para Produtos ---
export const getProducts = async (hotelId: string) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("hotel_id", hotelId)
      .order("name");

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching products:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar produtos.";
    return { success: false, error: errorMessage };
  }
};

// --- Funções para Usuários ---
export const getUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Error signing out:", error);
    return { success: false, error: error.message };
  }
  return { success: true };
};

// --- Funções para obter todos os usuários (apenas para admin) ---
export const getAllUsers = async () => {
  try {
    // Esta chamada requer permissões de administrador no Supabase
    // ou uma função de banco de dados com `security definer`.
    const { data, error } = await supabase
      .from("users") // Supondo que você tenha uma tabela 'users' ou use 'auth.users'
      .select("id, email, role, hotel_id, hotels (name)"); 

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching all users:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar todos os usuários.";
    return { success: false, error: errorMessage };
  }
};

// --- Função para atualizar dados do usuário (apenas para admin) ---
export const updateUser = async (userId: string, updates: any) => {
  try {
    const { data, error } = await supabase
      .from("users") // Supondo que você tenha uma tabela 'users' ou use 'auth.users'
      .update(updates)
      .eq("id", userId)
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error updating user:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao atualizar o usuário.";
    return { success: false, error: errorMessage };
  }
};

// --- Função para buscar setores de um hotel ---
export const getSectorsByHotel = async (hotelId: string) => {
  try {
    const { data, error } = await supabase
      .from("sectors")
      .select("id, name")
      .eq("hotel_id", hotelId)
      .order("name");

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching sectors by hotel:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar os setores do hotel.";
    return { success: false, error: errorMessage };
  }
};


// --- Função para criar uma nova requisição de setor ---
interface SectorRequestItemData {
  product_id: string;
  quantity: number;
  notes?: string;
}

export const createSectorRequest = async (
  hotelId: string,
  sectorId: string,
  requestedByUserId: string,
  items: SectorRequestItemData[],
  notes?: string
) => {
  try {
    // 1. Criar a requisição principal
    const { data: requestData, error: requestError } = await supabase
      .from("sector_requests")
      .insert({
        hotel_id: hotelId,
        sector_id: sectorId,
        requested_by_user_id: requestedByUserId,
        status: "pending",
        notes: notes,
      })
      .select()
      .single();

    if (requestError) throw requestError;
    if (!requestData) throw new Error("Falha ao criar a requisição de setor.");

    const requestId = requestData.id;

    // 2. Criar os itens da requisição
    const requestItemsData = items.map((item) => ({
      request_id: requestId,
      product_id: item.product_id,
      requested_quantity: item.quantity,
      status: "pending",
      notes: item.notes,
    }));

    const { error: itemsError } = await supabase
      .from("sector_request_items")
      .insert(requestItemsData);

    if (itemsError) {
      // Rollback da requisição principal se a inserção dos itens falhar
      await supabase.from("sector_requests").delete().eq("id", requestId);
      throw itemsError;
    }

    return { success: true, requestId };
  } catch (err) {
    console.error("Error creating sector request:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao criar a requisição de setor.";
    return { success: false, error: errorMessage };
  }
};


// --- Função para buscar o histórico de compras de um produto ---
export const getProductPurchaseHistory = async (productId: string, limit = 5) => {
  try {
    const { data, error } = await supabase
      .from("purchase_items")
      .select(
        `
        id,
        quantity,
        unit_price,
        purchases (id, purchase_date, supplier, invoices (invoice_number))
      `
      )
      .eq("product_id", productId)
      .order("created_at", { foreignTable: "purchases", ascending: false })
      .limit(limit);

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching product purchase history:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar o histórico de compras do produto.";
    return { success: false, error: errorMessage };
  }
};


// --- Função para buscar o estoque atual de um produto ---
export const getProductStock = async (productId: string) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("quantity, unit") // 'quantity' é o estoque atual
      .eq("id", productId)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error fetching product stock:", err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : "Ocorreu um erro desconhecido ao buscar o estoque do produto.";
    return { success: false, error: errorMessage };
  }
};

// ========================================
// NOVAS FUNÇÕES PARA RELATÓRIO SEMANAL
// ========================================

/**
 * Busca todos os setores de um hotel
 */
export const getHotelSectors = async (hotelId: string) => {
  try {
    const { data, error } = await supabase
      .from('sectors')
      .select('id, name')
      .eq('hotel_id', hotelId)
      .order('name');

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('Error fetching hotel sectors:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao buscar setores do hotel.';
    return { success: false, error: errorMessage };
  }
};

/**
 * Busca movimentos de inventário por período
 */
export const getInventoryMovements = async (
  hotelId: string,
  startDate: string,
  endDate: string,
  movementType?: string
) => {
  try {
    let query = supabase
      .from('inventory_movements')
      .select(`
        id,
        product_id,
        quantity_change,
        movement_type,
        reason,
        created_at,
        products(id, name)
      `)
      .eq('hotel_id', hotelId)
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59.999Z')
      .order('created_at', { ascending: false });

    if (movementType) {
      query = query.eq('movement_type', movementType);
    }

    const { data, error } = await query;

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('Error fetching inventory movements:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao buscar movimentos de inventário.';
    return { success: false, error: errorMessage };
  }
};

/**
 * Busca transferências entre hotéis por período
 */
export const getHotelTransfersByPeriod = async (
  hotelId: string,
  startDate: string,
  endDate: string,
  status?: string
) => {
  try {
    let query = supabase
      .from('hotel_transfers')
      .select(`
        id,
        product_id,
        quantity,
        status,
        completed_at,
        destination_hotel_id,
        products(id, name),
        destination_hotel:hotels!destination_hotel_id(id, name)
      `)
      .eq('source_hotel_id', hotelId)
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59.999Z')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('Error fetching hotel transfers by period:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao buscar transferências por período.';
    return { success: false, error: errorMessage };
  }
};

/**
 * Busca snapshots de inventário por hotel
 */
export const getInventorySnapshots = async (hotelId: string, limit?: number) => {
  try {
    let query = supabase
      .from('inventory_snapshots')
      .select('id, snapshot_date, notes, created_at')
      .eq('hotel_id', hotelId)
      .order('snapshot_date', { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('Error fetching inventory snapshots:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao buscar snapshots de inventário.';
    return { success: false, error: errorMessage };
  }
};

/**
 * Busca itens de um snapshot específico
 */
export const getSnapshotItems = async (snapshotId: string) => {
  try {
    const { data, error } = await supabase
      .from('inventory_snapshot_items')
      .select(`
        id,
        product_id,
        quantity,
        products(id, name)
      `)
      .eq('snapshot_id', snapshotId)
      .order('products(name)');

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('Error fetching snapshot items:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao buscar itens do snapshot.';
    return { success: false, error: errorMessage };
  }
};

/**
 * Cria um novo snapshot de inventário
 */
export const createInventorySnapshot = async (
  hotelId: string,
  snapshotDate: string,
  notes?: string
) => {
  try {
    // Criar snapshot
    const { data: snapshot, error: snapshotError } = await supabase
      .from('inventory_snapshots')
      .insert({
        hotel_id: hotelId,
        snapshot_date: snapshotDate,
        notes: notes
      })
      .select()
      .single();

    if (snapshotError) throw snapshotError;

    // Buscar produtos atuais do hotel
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, quantity')
      .eq('hotel_id', hotelId);

    if (productsError) throw productsError;

    if (products && products.length > 0) {
      // Criar itens do snapshot
      const snapshotItems = products.map(product => ({
        snapshot_id: snapshot.id,
        product_id: product.id,
        quantity: product.quantity
      }));

      const { error: itemsError } = await supabase
        .from('inventory_snapshot_items')
        .insert(snapshotItems);

      if (itemsError) throw itemsError;
    }

    return { success: true, data: snapshot };
  } catch (err) {
    console.error('Error creating inventory snapshot:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao criar snapshot de inventário.';
    return { success: false, error: errorMessage };
  }
};

/**
 * Busca relatórios semanais por hotel
 */
export const getWeeklyReports = async (hotelId: string, limit?: number) => {
  try {
    let query = supabase
      .from('weekly_inventory_reports')
      .select('id, start_date, end_date, created_at, updated_at')
      .eq('hotel_id', hotelId)
      .order('start_date', { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('Error fetching weekly reports:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao buscar relatórios semanais.';
    return { success: false, error: errorMessage };
  }
};

/**
 * Busca dados de consumo por setor em um período específico
 */
export const getSectorConsumptionByPeriod = async (
  hotelId: string,
  startDate: string,
  endDate: string
) => {
  try {
    // Buscar setores do hotel
    const { data: sectors, error: sectorsError } = await supabase
      .from('sectors')
      .select('id, name')
      .eq('hotel_id', hotelId);

    if (sectorsError) throw sectorsError;

    if (!sectors || sectors.length === 0) {
      return { success: true, data: [] };
    }

    const sectorIds = sectors.map(s => s.id);

    // Buscar consumo por setor
    const { data: consumption, error: consumptionError } = await supabase
      .from('item_consumption')
      .select('sector_id, item_name, quantity, consumed_at')
      .in('sector_id', sectorIds)
      .gte('consumed_at', startDate)
      .lte('consumed_at', endDate + 'T23:59:59.999Z');

    if (consumptionError) throw consumptionError;

    // Agrupar por setor
    const consumptionBySector = sectors.map(sector => {
      const sectorConsumption = consumption?.filter(c => c.sector_id === sector.id) || [];
      const totalQuantity = sectorConsumption.reduce((sum, c) => sum + (c.quantity || 0), 0);
      
      return {
        sector_id: sector.id,
        sector_name: sector.name,
        total_quantity: totalQuantity,
        items: sectorConsumption
      };
    });

    return { success: true, data: consumptionBySector };
  } catch (err) {
    console.error('Error fetching sector consumption by period:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao buscar consumo por setor.';
    return { success: false, error: errorMessage };
  }
};

/**
 * Registra movimento de inventário
 */
export const recordInventoryMovement = async (
  hotelId: string,
  productId: string,
  quantityChange: number,
  movementType: 'entrada' | 'saida' | 'transferencia' | 'ajuste',
  reason?: string,
  performedBy?: string,
  unitCost?: number,
  targetHotelId?: string
) => {
  try {
    const totalCost = unitCost ? Math.abs(quantityChange) * unitCost : null;

    const movementData: any = {
      hotel_id: hotelId,
      product_id: productId,
      quantity_change: quantityChange,
      movement_type: movementType,
      reason: reason,
      performed_by: performedBy,
      unit_cost: unitCost,
      total_cost: totalCost
    };

    // Adicionar target_hotel_id se for transferência
    if (movementType === 'transferencia' && targetHotelId) {
      movementData.target_hotel_id = targetHotelId;
    }

    const { data, error } = await supabase
      .from('inventory_movements')
      .insert(movementData)
      .select();

    if (error) throw error;

    // Atualizar quantidade do produto se não for transferência
    if (movementType !== 'transferencia') {
      const { error: updateError } = await supabase
        .from('products')
        .update({
          quantity: supabase.raw(`quantity + ${quantityChange}`)
        })
        .eq('id', productId);

      if (updateError) throw updateError;
    }

    return { success: true, data };
  } catch (err) {
    console.error('Error recording inventory movement:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao registrar movimento de inventário.';
    return { success: false, error: errorMessage };
  }
};

/**
 * Busca histórico de preços de um produto
 */
export const getProductPriceHistory = async (
  productId: string,
  startDate?: string,
  endDate?: string,
  limit?: number
) => {
  try {
    let query = supabase
      .from('inventory_movements')
      .select('unit_cost, created_at, movement_type, reason')
      .eq('product_id', productId)
      .not('unit_cost', 'is', null)
      .order('created_at', { ascending: false });

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate + 'T23:59:59.999Z');
    }

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('Error fetching product price history:', err);
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Erro ao buscar histórico de preços.';
    return { success: false, error: errorMessage };
  }
};
