// ===========================
// SISTEMA DE NOTIFICAÇÕES - TRIGGERS
// Adaptado para event_keys corretos da tabela notification_types
// ===========================

import { supabase } from './supabase';

// Interfaces adaptadas para estrutura real
interface NotificationData {
  user_id: string;
  notification_type_id: string;
  title: string;
  message: string;
  target_path?: string;
  related_entity_id?: string;
  related_entity_table?: string;
  related_entity_type?: string;
  hotel_id?: string;
  sector_id?: string;
  created_by?: string;
  is_read?: boolean;
}

interface NotificationEventData {
  hotel_id: string;
  sector_id?: string;
  product_name: string;
  quantity?: number;
  sector_name?: string;
  delivered_by?: string;
  reason?: string;
  original_product?: string;
  substitute_product?: string;
}

// Função para buscar usuários que devem receber notificação
const getUsersToNotify = async (eventType: string, hotelId: string, sectorId?: string) => {
  try {
    console.log(`Buscando usuários para notificar - Evento: ${eventType}, Hotel: ${hotelId}, Setor: ${sectorId}`);
    
    let query = supabase
      .from('user_notification_preferences')
      .select(`
        user_id,
        notification_type_id,
        hotel_id,
        sector_id,
        is_active
      `)
      .eq('is_active', true);

    // Buscar por tipo de notificação baseado no evento
    const { data: notificationTypes, error: typeError } = await supabase
      .from('notification_types')
      .select('id, event_key')
      .eq('event_key', eventType);

    if (typeError) {
      console.error('Erro ao buscar tipos de notificação:', typeError);
      return [];
    }

    if (!notificationTypes || notificationTypes.length === 0) {
      console.log(`Nenhum tipo de notificação encontrado para evento: ${eventType}`);
      return [];
    }

    const typeId = notificationTypes[0].id;
    query = query.eq('notification_type_id', typeId);

    const { data: preferences, error } = await query;

    if (error) {
      console.error('Erro ao buscar preferências:', error);
      return [];
    }

    if (!preferences || preferences.length === 0) {
      console.log('Nenhuma preferência encontrada');
      return [];
    }

    // Filtrar usuários baseado nas preferências
    const usersToNotify = preferences.filter(pref => {
      // Se não tem filtro de hotel, recebe de todos os hotéis
      if (!pref.hotel_id) return true;
      
      // Se tem filtro de hotel, deve ser o mesmo
      if (pref.hotel_id !== hotelId) return false;
      
      // Se não tem filtro de setor, recebe de todos os setores deste hotel
      if (!pref.sector_id) return true;
      
      // Se tem filtro de setor, deve ser o mesmo
      return pref.sector_id === sectorId;
    });

    console.log(`Usuários encontrados para notificar: ${usersToNotify.length}`);
    return usersToNotify;
  } catch (error) {
    console.error('Erro ao buscar usuários para notificar:', error);
    return [];
  }
};

// Função para criar notificação individual
const createNotification = async (notificationData: NotificationData) => {
  try {
    console.log('Criando notificação:', notificationData);
    
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: notificationData.user_id,
        notification_type_id: notificationData.notification_type_id,
        title: notificationData.title,
        message: notificationData.message,
        target_path: notificationData.target_path || '/admin',
        related_entity_id: notificationData.related_entity_id,
        related_entity_table: notificationData.related_entity_table || 'requisitions',
        related_entity_type: notificationData.related_entity_type || 'requisition',
        hotel_id: notificationData.hotel_id,
        sector_id: notificationData.sector_id,
        created_by: notificationData.created_by,
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select();

    if (error) {
      console.error('Erro ao criar notificação:', error);
      throw error;
    }

    console.log('Notificação criada com sucesso:', data);
    return data;
  } catch (error) {
    console.error('Erro ao criar notificação:', error);
    throw error;
  }
};

// Função genérica para disparar notificações
const triggerNotification = async (
  eventType: string,
  eventData: NotificationEventData,
  titleTemplate: string,
  messageTemplate: string
) => {
  try {
    console.log('Disparando notificação:', { eventType, eventData });

    // Buscar usuários que devem receber a notificação
    const usersToNotify = await getUsersToNotify(
      eventType,
      eventData.hotel_id,
      eventData.sector_id
    );

    if (usersToNotify.length === 0) {
      console.log('Nenhum usuário configurado para receber esta notificação');
      return;
    }

    console.log(`Enviando notificação para ${usersToNotify.length} usuário(s):`, usersToNotify);

    // Criar notificações para cada usuário
    const notifications = usersToNotify.map(user => ({
      user_id: user.user_id,
      notification_type_id: user.notification_type_id,
      title: titleTemplate,
      message: messageTemplate,
      target_path: '/admin',
      related_entity_table: 'requisitions',
      related_entity_type: 'requisition',
      hotel_id: eventData.hotel_id,
      sector_id: eventData.sector_id,
      is_read: false
    }));

    // Inserir todas as notificações
    for (const notification of notifications) {
      await createNotification(notification);
    }

    console.log('Notificações criadas com sucesso');
  } catch (error) {
    console.error('Erro ao disparar notificação:', error);
    throw error;
  }
};

// Funções específicas para cada tipo de evento - USANDO EVENT_KEYS CORRETOS
export const notifyNewRequest = async (eventData: NotificationEventData) => {
  const title = '🆕 Nova Requisição';
  const message = `Nova requisição de ${eventData.product_name} (${eventData.quantity || 1}x) do setor ${eventData.sector_name}`;
  
  await triggerNotification('NEW_REQUEST', eventData, title, message);
};

export const notifyItemDelivered = async (eventData: NotificationEventData) => {
  const title = '✅ Item Entregue';
  const message = `${eventData.product_name} (${eventData.quantity || 1}x) foi entregue para ${eventData.sector_name}`;
  
  await triggerNotification('ITEM_DELIVERED_TO_SECTOR', eventData, title, message);
};

export const notifyItemRejected = async (eventData: NotificationEventData) => {
  const title = '❌ Item Rejeitado';
  const message = `Requisição de ${eventData.product_name} foi rejeitada. Motivo: ${eventData.reason}`;
  
  await triggerNotification('REQUEST_REJECTED', eventData, title, message);
};

export const notifyItemSubstituted = async (eventData: NotificationEventData) => {
  const title = '🔄 Produto Substituído';
  const message = `${eventData.original_product} foi substituído por ${eventData.substitute_product} para ${eventData.sector_name}`;
  
  await triggerNotification('REQUEST_SUBSTITUTED', eventData, title, message);
};

export const notifyBudgetCreated = async (eventData: NotificationEventData) => {
  const title = '💰 Novo Orçamento';
  const message = `Novo orçamento criado para ${eventData.sector_name}`;
  
  await triggerNotification('BUDGET_PENDING_APPROVAL', eventData, title, message);
};

export const notifyBudgetApproved = async (eventData: NotificationEventData) => {
  const title = '✅ Orçamento Aprovado';
  const message = `Orçamento aprovado para ${eventData.sector_name}`;
  
  await triggerNotification('BUDGET_APPROVED', eventData, title, message);
};

export const notifyBudgetRejected = async (eventData: NotificationEventData) => {
  const title = '❌ Orçamento Cancelado';
  const message = `Orçamento cancelado para ${eventData.sector_name}. Motivo: ${eventData.reason}`;
  
  await triggerNotification('BUDGET_CANCELLED', eventData, title, message);
};

export const notifyLowStock = async (eventData: NotificationEventData) => {
  const title = '⚠️ Estoque Baixo';
  const message = `Estoque baixo de ${eventData.product_name}. Quantidade atual: ${eventData.quantity}`;
  
  await triggerNotification('LOW_STOCK_ALERT', eventData, title, message);
};

export const notifyOutOfStock = async (eventData: NotificationEventData) => {
  const title = '🚨 Produto em Falta';
  const message = `${eventData.product_name} está em falta no estoque`;
  
  await triggerNotification('OUT_OF_STOCK_ALERT', eventData, title, message);
};

export const notifyTransferCreated = async (eventData: NotificationEventData) => {
  const title = '📦 Nova Transferência';
  const message = `Nova transferência criada para ${eventData.sector_name}`;
  
  await triggerNotification('TRANSFER_CREATED', eventData, title, message);
};

export const notifyTransferCompleted = async (eventData: NotificationEventData) => {
  const title = '✅ Transferência Concluída';
  const message = `Transferência concluída para ${eventData.sector_name}`;
  
  await triggerNotification('TRANSFER_COMPLETED', eventData, title, message);
};

// Função para marcar notificação como lida
export const markNotificationAsRead = async (notificationId: string) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', notificationId);

    if (error) throw error;
    console.log('Notificação marcada como lida:', notificationId);
  } catch (error) {
    console.error('Erro ao marcar notificação como lida:', error);
    throw error;
  }
};

// Função para buscar notificações do usuário
export const getUserNotifications = async (userId: string, limit: number = 50) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select(`
        *,
        notification_types(event_key, description, icon)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Erro ao buscar notificações do usuário:', error);
    return [];
  }
};

// Função para contar notificações não lidas
export const getUnreadNotificationsCount = async (userId: string) => {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('Erro ao contar notificações não lidas:', error);
    return 0;
  }
};

