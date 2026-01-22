// =====================================================
// BIBLIOTECA DE NOTIFICAÇÕES - ADAPTADA PARA TABELAS EXISTENTES
// =====================================================
// Esta versão funciona com as tabelas que você já tem no banco

import { supabase } from "./supabase";

interface Notification {
    id: string;
    created_at: string; 
    is_read: boolean;
    message: string;
    title?: string; 
    target_path?: string | null; 
    related_entity_id?: string | null;
    related_entity_type?: string | null;
    notification_types?: {
        description?: string;
        event_key?: string;
        icon?: string;
    } | null;
    hotels?: { name?: string } | null;
    sectors?: { name?: string } | null;
}

// =====================================================
// FUNÇÕES PARA NOTIFICAÇÕES DO SISTEMA (ADAPTADAS)
// =====================================================

// Interface para os parâmetros da função createNotification
interface CreateNotificationParams {
  user_id?: string;
  userId?: string;
  message?: string;
  content?: string;
  event_key?: string;
  event_type?: string;
  related_entity_id?: string | null;
  related_entity_type?: string | null;
  hotel_id?: string | null;
  sector_id?: string | null;
  created_by?: string | null;
  sendPush?: boolean;
  title?: string | null;
  target_path?: string | null;
  link?: string | null;
  metadata?: any;
}

// Função para criar uma notificação usando suas tabelas existentes
export const createNotification = async (params: CreateNotificationParams | string, ...args: any[]) => {
  try {
    let userId: string;
    let message: string;
    let eventKey: string;
    let relatedEntityId: string | null = null;
    let relatedEntityType: string | null = null;
    let hotelId: string | null = null;
    let sectorId: string | null = null;
    let createdBy: string | null = null;
    let sendPush: boolean = true;
    let title: string | null = null;
    let targetPath: string | null = null;

    // Lógica de sobrecarga para suportar ambos os formatos
    if (typeof params === 'object') {
      userId = params.user_id || params.userId || '';
      message = params.content || params.message || '';
      eventKey = params.event_type || params.event_key || '';
      relatedEntityId = params.related_entity_id || (params.metadata?.budget_id || params.metadata?.request_id) || null;
      relatedEntityType = params.related_entity_type || (params.metadata?.budget_id ? 'budget' : params.metadata?.request_id ? 'requisition' : null);
      hotelId = params.hotel_id || null;
      sectorId = params.sector_id || null;
      createdBy = params.created_by || null;
      sendPush = params.sendPush !== undefined ? params.sendPush : true;
      title = params.title || null;
      targetPath = params.link || params.target_path || null;
    } else {
      userId = params;
      message = args[0];
      eventKey = args[1];
      relatedEntityId = args[2] || null;
      relatedEntityType = args[3] || null;
      hotelId = args[4] || null;
      sectorId = args[5] || null;
      createdBy = args[6] || null;
      sendPush = args[7] !== undefined ? args[7] : true;
      title = args[8] || null;
      targetPath = args[9] || null;
    }

    // Se não houver userId, precisamos buscar usuários interessados neste evento
    if (!userId) {
      console.log("UserId não fornecido, disparando notificações para todos os usuários interessados no evento:", eventKey);
      
      // Preparar dados para o template
      const templateData: Record<string, any> = { 
        message, 
        title,
        content: message,
        ...params.metadata 
      };

      return await createNotificationsForEvent(
        eventKey,
        templateData,
        hotelId,
        sectorId,
        relatedEntityId,
        relatedEntityType,
        createdBy
      );
    }

    // Buscar o tipo de notificação pelo event_key
    const { data: notificationType, error: typeError } = await supabase
      .from("notification_types")
      .select("id, default_message_template, target_path_template")
      .eq("event_key", eventKey)
      .single();

    if (typeError || !notificationType) {
      console.error("Erro ao buscar tipo de notificação:", typeError);
      // Se não encontrar o tipo, ainda tentamos criar a notificação sem o tipo específico
    }

    // Usar template padrão se não fornecido
    const finalMessage = message || notificationType?.default_message_template || '';
    const finalTargetPath = targetPath || notificationType?.target_path_template || null;

    const { data: newNotification, error: insertError } = await supabase
      .from("notifications")
      .insert([
        {
          user_id: userId,
          message: finalMessage,
          title: title || null,
          target_path: finalTargetPath || null,
          notification_type_id: notificationType?.id || null,
          related_entity_id: relatedEntityId,
          related_entity_type: relatedEntityType,
          hotel_id: hotelId,
          sector_id: sectorId,
          created_by: createdBy,
          is_read: false,
        },
      ])
      .select()
      .single();

    if (insertError) {
      console.error("Erro ao criar notificação no banco:", insertError);
      throw insertError;
    }

    console.log("Notificação criada com sucesso:", newNotification);

    if (sendPush && newNotification) {
      try {
        // Garantir que o título do push seja o mesmo da notificação
        const pushTitle = title || (notificationType?.description ? `Nova ${notificationType.description}` : "Nova Notificação");
        
        await sendPushNotificationToUser(
          userId, 
          pushTitle, 
          finalMessage,
          {
            notificationId: newNotification.id,
            relatedEntityId: newNotification.related_entity_id,
            relatedEntityType: newNotification.related_entity_type,
            targetPath: finalTargetPath || null,
          }
        );
      } catch (pushError) {
        console.error("Erro ao enviar push:", pushError);
      }
    }

    return newNotification;
  } catch (error) {
    console.error("Falha geral ao criar notificação:", error);
    return null;
  }
};

// Função para criar notificações em massa baseada nas preferências
export const createNotificationsForEvent = async (
  eventKey: string,
  templateData: Record<string, any> = {},
  hotelId?: string | null,
  sectorId?: string | null,
  relatedEntityId?: string | null,
  relatedEntityType?: string | null,
  createdBy?: string | null
) => {
  try {
    // Buscar o tipo de notificação primeiro para obter o ID
    const { data: notificationType, error: typeError } = await supabase
      .from("notification_types")
      .select("id, default_message_template, target_path_template, description")
      .eq("event_key", eventKey)
      .single();

    if (typeError || !notificationType) {
      console.error("Tipo de notificação não encontrado:", eventKey);
      return [];
    }

    // Buscar usuários que devem receber esta notificação filtrando pelo ID do tipo
    const { data: preferences, error: preferencesError } = await supabase
      .from("user_notification_preferences")
      .select(`
        user_id,
        hotel_id,
        sector_id,
        user_specific_message_template,
        user_specific_target_path
      `)
      .eq("is_active", true)
      .eq("notification_type_id", notificationType.id);

    if (preferencesError) {
      console.error("Erro ao buscar preferências:", preferencesError);
      return [];
    }

    if (!preferences || preferences.length === 0) {
      console.log("Nenhum usuário configurado para receber notificações do tipo:", eventKey);
      return [];
    }

    // Template já buscado acima

    // Filtrar usuários baseado nas preferências de hotel e setor
    const filteredPreferences = preferences.filter(pref => {
      // Se a preferência tem hotel_id específico, verificar se coincide
      if (pref.hotel_id && hotelId && pref.hotel_id !== hotelId) {
        return false;
      }
      
      // Se a preferência tem sector_id específico, verificar se coincide
      if (pref.sector_id && sectorId && pref.sector_id !== sectorId) {
        return false;
      }
      
      return true;
    });

    // Criar notificações para cada usuário
    const notifications = [];
    for (const pref of filteredPreferences) {
      try {
        // Usar template específico do usuário ou template padrão
        const messageTemplate = pref.user_specific_message_template || 
                               notificationType.default_message_template;
        const targetPathTemplate = pref.user_specific_target_path || 
                                  notificationType.target_path_template;

        // Substituir variáveis no template
        let finalMessage = messageTemplate;
        let finalTargetPath = targetPathTemplate;

        Object.keys(templateData).forEach(key => {
          const placeholder = `{${key}}`;
          finalMessage = finalMessage?.replace(new RegExp(placeholder, 'g'), templateData[key]);
          finalTargetPath = finalTargetPath?.replace(new RegExp(placeholder, 'g'), templateData[key]);
        });

        const notification = await createNotification(
          pref.user_id,
          finalMessage,
          eventKey,
          relatedEntityId,
          relatedEntityType,
          hotelId,
          sectorId,
          createdBy,
          true, // Enviar push
          templateData.title || `Nova ${notificationType.description}`,
          finalTargetPath
        );
        
        if (notification) {
          notifications.push(notification);
        }
      } catch (error) {
        console.error(`Erro ao criar notificação para usuário ${pref.user_id}:`, error);
      }
    }

    console.log(`Criadas ${notifications.length} notificações para o evento ${eventKey}`);
    return notifications;
  } catch (error) {
    console.error("Erro ao criar notificações para evento:", error);
    return [];
  }
};

// Função para buscar notificações do usuário
export const getNotificationsForUser = async (
  userId: string, 
  page: number = 1, 
  limit: number = 10
): Promise<{ data: Notification[], count: number }> => {
  if (!userId) return { data: [], count: 0 };

  const offset = (page - 1) * limit;

  const { data, error: dataError } = await supabase
    .from("notifications")
    .select(`
      *,
      notification_types(description, event_key, icon),
      hotels(name),
      sectors(name)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (dataError) {
    console.error("Erro ao buscar notificações paginadas:", dataError);
    return { data: [], count: 0 };
  }

  // Buscar contagem total
  const { count, error: countError } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    console.error("Erro ao buscar contagem total de notificações:", countError);
    return { data: data || [], count: 0 }; 
  }

  return { data: data || [], count: count || 0 };
};

// Função para buscar contagem de não lidas
export const getUnreadNotificationsCount = async (userId: string): Promise<number> => {
  if (!userId) return 0;
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) {
    console.error("Erro ao buscar contagem de notificações não lidas:", error);
    return 0;
  }
  return count || 0;
};

// Função para marcar notificação como lida
export const markNotificationAsRead = async (notificationId: string) => {
  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq("id", notificationId)
    .select();

  if (error) {
    console.error("Erro ao marcar notificação como lida:", error);
    throw error;
  }
  return data;
};

// Função para marcar todas como lidas
export const markAllNotificationsAsRead = async (userId: string) => {
  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("is_read", false)
    .select();

  if (error) {
    console.error("Erro ao marcar todas as notificações como lidas:", error);
    throw error;
  }
  return data;
};

// =====================================================
// FUNÇÕES PARA PREFERÊNCIAS (ADAPTADAS)
// =====================================================

// Função para salvar preferências do usuário
export const saveUserNotificationPreferences = async (
  userId: string,
  preferences: Array<{
    notificationTypeId: string;
    isActive: boolean;
    hotelId?: string | null;
    sectorId?: string | null;
    userSpecificMessageTemplate?: string | null;
    userSpecificTargetPath?: string | null;
  }>
) => {
  try {
    // Primeiro, desativar todas as preferências existentes
    const { error: deactivateError } = await supabase
      .from("user_notification_preferences")
      .update({ is_active: false })
      .eq("user_id", userId);

    if (deactivateError) {
      console.error("Erro ao desativar preferências existentes:", deactivateError);
      throw deactivateError;
    }

    // Inserir/atualizar novas preferências
    const preferencesToUpsert = preferences
      .filter(pref => pref.isActive)
      .map(pref => ({
        user_id: userId,
        notification_type_id: pref.notificationTypeId,
        is_active: true,
        hotel_id: pref.hotelId,
        sector_id: pref.sectorId,
        user_specific_message_template: pref.userSpecificMessageTemplate,
        user_specific_target_path: pref.userSpecificTargetPath,
        created_by: userId,
        updated_at: new Date().toISOString()
      }));

    if (preferencesToUpsert.length > 0) {
      const { data, error: insertError } = await supabase
        .from("user_notification_preferences")
        .upsert(preferencesToUpsert, {
          onConflict: "user_id, notification_type_id, hotel_id, sector_id"
        })
        .select();

      if (insertError) {
        console.error("Erro ao inserir novas preferências:", insertError);
        throw insertError;
      }

      console.log("Preferências salvas com sucesso:", data);
      return data;
    }

    return [];
  } catch (error) {
    console.error("Erro ao salvar preferências:", error);
    throw error;
  }
};

// Função para buscar preferências do usuário
export const getUserNotificationPreferences = async (userId: string) => {
  const { data, error } = await supabase
    .from("user_notification_preferences")
    .select(`
      *,
      notification_types(id, event_key, description, icon),
      hotels(id, name),
      sectors(id, name)
    `)
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    console.error("Erro ao buscar preferências:", error);
    return [];
  }

  return data || [];
};

// =====================================================
// FUNÇÕES AUXILIARES PARA EVENTOS ESPECÍFICOS
// =====================================================

// Notificação para nova requisição
export const notifyNewRequest = async (
  requestId: string,
  requestNumber: string,
  sectorName: string,
  hotelName: string,
  hotelId: string,
  sectorId: string,
  createdBy: string
) => {
  return await createNotificationsForEvent(
    'NEW_REQUEST',
    {
      requestId,
      requestNumber,
      sectorName,
      hotelName
    },
    hotelId,
    sectorId,
    requestId,
    'requisition',
    createdBy
  );
};

// Notificação para item entregue
export const notifyItemDelivered = async (
  requestId: string,
  requestNumber: string,
  itemName: string,
  sectorName: string,
  hotelName: string,
  hotelId: string,
  sectorId: string,
  deliveredBy: string
) => {
  return await createNotificationsForEvent(
    'ITEM_DELIVERED_TO_SECTOR',
    {
      requestId,
      requestNumber,
      itemName,
      sectorName,
      hotelName
    },
    hotelId,
    sectorId,
    requestId,
    'requisition',
    deliveredBy
  );
};

// Notificação para orçamento pendente
export const notifyBudgetPendingApproval = async (
  budgetId: string,
  supplierName: string,
  hotelName: string,
  hotelId: string,
  createdBy: string
) => {
  return await createNotificationsForEvent(
    'BUDGET_PENDING_APPROVAL',
    {
      budgetId,
      supplierName,
      hotelName
    },
    hotelId,
    null,
    budgetId,
    'budget',
    createdBy
  );
};

// Notificação para orçamento aprovado
export const notifyBudgetApproved = async (
  budgetId: string,
  supplierName: string,
  hotelName: string,
  approverName: string,
  hotelId: string,
  approvedBy: string
) => {
  return await createNotificationsForEvent(
    'BUDGET_APPROVED',
    {
      budgetId,
      supplierName,
      hotelName,
      approverName
    },
    hotelId,
    null,
    budgetId,
    'budget',
    approvedBy
  );
};

// Notificação para orçamento cancelado
export const notifyBudgetCancelled = async (
  budgetId: string,
  supplierName: string,
  hotelName: string,
  hotelId: string,
  cancelledBy: string
) => {
  return await createNotificationsForEvent(
    'BUDGET_CANCELLED',
    {
      budgetId,
      supplierName,
      hotelName
    },
    hotelId,
    null,
    budgetId,
    'budget',
    cancelledBy
  );
};

// Notificação para novo orçamento criado
export const notifyBudgetCreated = async (
  budgetId: string,
  supplierName: string,
  hotelName: string,
  totalValue: number,
  hotelId: string,
  createdBy: string,
  isOnline: boolean = false
) => {
  return await createNotificationsForEvent(
    'NEW_BUDGET',
    {
      budgetId,
      supplierName,
      hotelName,
      totalValue: totalValue.toFixed(2).replace('.', ','),
      type: isOnline ? 'online' : 'presencial'
    },
    hotelId,
    null,
    budgetId,
    'budget',
    createdBy
  );
};

// =====================================================
// FUNÇÕES PARA TOKENS FCM (NOVAS)
// =====================================================

// Função para salvar token FCM (precisa criar tabela)
export const saveFCMToken = async (userId: string, token: string, deviceInfo?: any) => {
  if (!userId || !token) {
    console.error("User ID e Token são obrigatórios para salvar o token FCM");
    return null;
  }
  
  // Verificar se a tabela user_fcm_tokens existe, se não, usar user_devices
  const { data, error } = await supabase
    .from("user_devices")
    .upsert(
      {
        user_id: userId,
        fcm_token: token,
        device_info: deviceInfo || null,
        is_active: true,
        last_used_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id, fcm_token",
      }
    )
    .select();

  if (error) {
    console.error("Erro ao salvar token FCM:", error);
    throw error;
  }
  
  console.log("Token FCM salvo com sucesso:", data);
  return data;
};

// Função para buscar tokens FCM do usuário
export const getUserFCMTokens = async (userId: string) => {
  const { data, error } = await supabase
    .from("user_devices")
    .select("fcm_token, device_info")
    .eq("user_id", userId)
    .eq("is_active", true)
    .not("fcm_token", "is", null);

  if (error) {
    console.error("Erro ao buscar tokens FCM do usuário:", error);
    return [];
  }
  
  return data || [];
};

// Função para enviar notificação push
export const sendPushNotificationToUser = async (
  userId: string,
  title: string,
  body: string,
  data?: Record<string, any>
) => {
  try {
    // Buscar tokens FCM do usuário
    const tokens = await getUserFCMTokens(userId);
    
    if (tokens.length === 0) {
      console.log("Usuário não tem tokens FCM registrados");
      return;
    }

    // Enviar para cada token
    const promises = tokens.map(tokenData => 
      supabase.functions.invoke('send-push-notification', {
        body: {
          token: tokenData.fcm_token,
          title,
          body,
          data
        }
      })
    );

    const results = await Promise.allSettled(promises);
    console.log("Resultados do envio de push:", results);
    
    return results;
  } catch (error) {
    console.error("Erro ao enviar notificação push:", error);
    throw error;
  }
};

// =====================================================
// FUNÇÕES DE CONVENIÊNCIA
// =====================================================

// Função para buscar todos os tipos de notificação
export const getNotificationTypes = async () => {
  const { data, error } = await supabase
    .from("notification_types")
    .select("*")
    .order("description");

  if (error) {
    console.error("Erro ao buscar tipos de notificação:", error);
    return [];
  }

  return data || [];
};

// Função para buscar hotéis
export const getHotels = async () => {
  const { data, error } = await supabase
    .from("hotels")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("Erro ao buscar hotéis:", error);
    return [];
  }

  return data || [];
};

// Função para buscar setores
export const getSectors = async () => {
  const { data, error } = await supabase
    .from("sectors")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("Erro ao buscar setores:", error);
    return [];
  }

  return data || [];
};

/*
COMO USAR ESTA BIBLIOTECA:

1. Importar as funções necessárias:
   import { 
     createNotification, 
     notifyNewRequest, 
     getNotificationsForUser 
   } from '../lib/notifications';

2. Criar notificação simples:
   await createNotification(
     userId, 
     "Mensagem personalizada", 
     "NEW_REQUEST"
   );

3. Criar notificações para evento:
   await notifyNewRequest(
     requestId, 
     requestNumber, 
     sectorName, 
     hotelName, 
     hotelId, 
     sectorId, 
     createdBy
   );

4. Buscar notificações do usuário:
   const { data, count } = await getNotificationsForUser(userId);

VANTAGENS:

✅ Funciona com suas tabelas existentes
✅ Usa os templates que você já configurou
✅ Respeita as preferências por usuário
✅ Suporte a notificações push
✅ Filtros por hotel e setor
✅ Mensagens personalizáveis por usuário
*/
