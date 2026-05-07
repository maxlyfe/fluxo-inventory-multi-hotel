// ===========================
// SISTEMA DE NOTIFICAÇÕES - TRIGGERS
// Adaptado para event_keys corretos da tabela notification_types
// ===========================

import { supabase } from './supabase';
import { createNotification as createNotificationBase } from './notifications';

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
  hotel_name?: string;        // opcional — buscado automaticamente se não fornecido
  sector_id?: string;
  product_name?: string;
  quantity?: number;
  sector_name?: string;
  delivered_by?: string;
  reason?: string;
  original_product?: string;
  substitute_product?: string;
  budget_title?: string;      // título/descrição do orçamento
  contract_name?: string;     // nome do contrato
  days_remaining?: number;    // dias restantes para vencimento
  related_entity_id?: string;
  related_entity_table?: string;
  related_entity_type?: string;
}

// Função para buscar usuários que devem receber notificação
const getUsersToNotify = async (eventType: string, hotelId: string, sectorId?: string) => {
  try {
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

    return usersToNotify;
  } catch (error) {
    console.error('Erro ao buscar usuários para notificar:', error);
    return [];
  }
};

// Função para criar notificação individual
const createNotificationInternal = async (notificationData: NotificationData) => {
  try {
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

    return data;
  } catch (error) {
    console.error('Erro ao criar notificação:', error);
    throw error;
  }
};

// Função genérica para disparar notificações
// Busca o nome do hotel pelo ID (com cache simples em memória por sessão)
const hotelNameCache = new Map<string, string>();
const resolveHotelName = async (hotelId: string): Promise<string> => {
  if (hotelNameCache.has(hotelId)) return hotelNameCache.get(hotelId)!;
  try {
    const { data } = await supabase.from('hotels').select('name').eq('id', hotelId).single();
    const name = data?.name || 'Hotel';
    hotelNameCache.set(hotelId, name);
    return name;
  } catch {
    return 'Hotel';
  }
};

const triggerNotification = async (
  eventType: string,
  eventData: NotificationEventData,
  titleTemplate: string,
  messageTemplate: string
) => {
  try {
    // Garantir que hotel_name está sempre disponível nas mensagens
    if (!eventData.hotel_name && eventData.hotel_id) {
      eventData = { ...eventData, hotel_name: await resolveHotelName(eventData.hotel_id) };
    }

    // Buscar usuários que devem receber a notificação
    const usersToNotify = await getUsersToNotify(
      eventType,
      eventData.hotel_id,
      eventData.sector_id
    );

    if (usersToNotify.length === 0) {
      return;
    }

    // Criar notificações para cada usuário
    const notifications = usersToNotify.map(user => ({
      user_id: user.user_id,
      notification_type_id: user.notification_type_id,
      title: titleTemplate,
      message: messageTemplate,
      target_path: '/admin',
      related_entity_id: eventData.related_entity_id || null,
      related_entity_table: eventData.related_entity_table || 'requisitions',
      related_entity_type: eventData.related_entity_type || 'requisition',
      hotel_id: eventData.hotel_id,
      sector_id: eventData.sector_id,
      is_read: false
    }));

    // Inserir todas as notificações
    for (const notification of notifications) {
      await createNotificationInternal(notification);
    }

  } catch (error) {
    console.error('Erro ao disparar notificação:', error);
    throw error;
  }
};

// Funções específicas para cada tipo de evento - USANDO EVENT_KEYS CORRETOS
export const notifyNewRequest = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `🛎️ Nova Requisição — ${hotel}`;
  const message = `${eventData.product_name} (${eventData.quantity || 1}x) solicitado pelo setor ${eventData.sector_name}`;

  await triggerNotification('NEW_REQUEST', eventData, title, message);
};

export const notifyItemDelivered = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `✅ Item Entregue — ${hotel}`;
  const message = `${eventData.product_name} (${eventData.quantity || 1}x) entregue para o setor ${eventData.sector_name}`;

  await triggerNotification('ITEM_DELIVERED_TO_SECTOR', eventData, title, message);
};

export const notifyItemRejected = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `❌ Requisição Recusada — ${hotel}`;
  const message = `${eventData.product_name} não foi aprovado para ${eventData.sector_name}. Motivo: ${eventData.reason}`;

  await triggerNotification('REQUEST_REJECTED', eventData, title, message);
};

export const notifyItemSubstituted = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `🔄 Produto Substituído — ${hotel}`;
  const message = `${eventData.original_product} → ${eventData.substitute_product} (setor ${eventData.sector_name})`;

  await triggerNotification('REQUEST_SUBSTITUTED', eventData, title, message);
};

export const notifyBudgetCreated = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `💰 Novo Orçamento — ${hotel}`;
  const message = eventData.budget_title
    ? `"${eventData.budget_title}" aguarda aprovação`
    : `Novo orçamento do setor ${eventData.sector_name || hotel} aguarda aprovação`;

  await triggerNotification('NEW_BUDGET', eventData, title, message);
};

export const notifyBudgetApproved = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `✅ Orçamento Aprovado — ${hotel}`;
  const message = eventData.budget_title
    ? `"${eventData.budget_title}" foi aprovado`
    : `Orçamento do setor ${eventData.sector_name || hotel} foi aprovado`;

  await triggerNotification('BUDGET_APPROVED', eventData, title, message);
};

export const notifyBudgetRejected = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `🚫 Orçamento Cancelado — ${hotel}`;
  const message = eventData.budget_title
    ? `"${eventData.budget_title}" foi cancelado. ${eventData.reason ? `Motivo: ${eventData.reason}` : ''}`
    : `Orçamento do setor ${eventData.sector_name || hotel} cancelado. ${eventData.reason ? `Motivo: ${eventData.reason}` : ''}`;

  await triggerNotification('BUDGET_CANCELLED', eventData, title, message);
};

export const notifyLowStock = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `⚠️ Estoque Baixo — ${hotel}`;
  const message = `${eventData.product_name} está com estoque baixo (${eventData.quantity} restantes)`;

  await triggerNotification('LOW_STOCK_ALERT', eventData, title, message);
};

export const notifyOutOfStock = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `🚨 Produto em Falta — ${hotel}`;
  const message = `${eventData.product_name} esgotou no estoque`;

  await triggerNotification('OUT_OF_STOCK_ALERT', eventData, title, message);
};

export const notifyTransferCreated = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `📦 Nova Transferência — ${hotel}`;
  const message = `Transferência de ${eventData.product_name || 'itens'} para o setor ${eventData.sector_name}`;

  await triggerNotification('TRANSFER_CREATED', eventData, title, message);
};

export const notifyTransferCompleted = async (eventData: NotificationEventData) => {
  const hotel  = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title   = `📬 Transferência Concluída — ${hotel}`;
  const message = `${eventData.product_name || 'Itens'} entregues ao setor ${eventData.sector_name}`;

  await triggerNotification('TRANSFER_COMPLETED', eventData, title, message);
};

// ── Governança & Manutenção ──

/** Dispara quando workflow → pending_maint (UH solicita vistoria de manutenção) */
export const notifyRoomNeedsMaintenance = async (eventData: { hotel_id: string; room_name: string }) => {
  const hotel = await resolveHotelName(eventData.hotel_id);
  await triggerNotification('room_needs_maintenance', {
    ...eventData,
    related_entity_table: 'hotel_room_workflow',
    related_entity_type: 'governance',
  }, `🔧 Vistoria Solicitada — ${hotel}`, `UH ${eventData.room_name} precisa de vistoria antes da limpeza.`);
};

/** Dispara quando Erbon marca UH como DIRTY (recepção / check-out) */
export const notifyRoomDirty = async (eventData: { hotel_id: string; room_name: string }) => {
  const hotel = await resolveHotelName(eventData.hotel_id);
  await triggerNotification('room_dirty', {
    ...eventData,
    related_entity_table: 'hotel_room_workflow',
    related_entity_type: 'governance',
  }, `🛏️ UH Suja — ${hotel}`, `UH ${eventData.room_name} foi marcada como suja e aguarda checklist.`);
};

/** Dispara quando workflow → clean (UH limpa e disponível) */
export const notifyRoomClean = async (eventData: { hotel_id: string; room_name: string }) => {
  const hotel = await resolveHotelName(eventData.hotel_id);
  await triggerNotification('room_clean', {
    ...eventData,
    related_entity_table: 'hotel_room_workflow',
    related_entity_type: 'governance',
  }, `✅ UH Limpa — ${hotel}`, `UH ${eventData.room_name} está limpa e disponível.`);
};

/** Dispara quando workflow → maint_ok (checklist de manutenção aprovado) */
export const notifyRoomMaintOk = async (eventData: { hotel_id: string; room_name: string }) => {
  const hotel = await resolveHotelName(eventData.hotel_id);
  await triggerNotification('room_maint_ok', {
    ...eventData,
    related_entity_table: 'hotel_room_workflow',
    related_entity_type: 'governance',
  }, `✔️ Checklist Manutenção OK — ${hotel}`, `UH ${eventData.room_name} liberada pelo checklist — pronta para limpeza.`);
};

/** @deprecated use notifyRoomMaintOk — mantido para compatibilidade */
export const notifyRoomReadyForGovernance = async (eventData: { hotel_id: string; room_name: string }) => {
  await notifyRoomMaintOk(eventData);
};

/** @deprecated use notifyRoomClean — mantido para compatibilidade */
export const notifyRoomReadyForCheckin = async (eventData: { hotel_id: string; room_name: string }) => {
  await notifyRoomClean(eventData);
};

export const notifyRoomContested = async (eventData: { hotel_id: string; room_name: string; reason?: string }) => {
  const hotel = await resolveHotelName(eventData.hotel_id);
  await triggerNotification('room_maint_contested', {
    ...eventData,
    related_entity_table: 'hotel_room_workflow',
    related_entity_type: 'maintenance',
  }, `⚠️ UH Contestada — ${hotel}`, `Vistoria da UH ${eventData.room_name} rejeitada pela governança.${eventData.reason ? ` Motivo: ${eventData.reason}` : ''}`);
};

// ── Contratos de experiência ──

export const notifyContractEndingSoon = async (eventData: NotificationEventData) => {
  const hotel = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title = `⏳ Contrato vence em ${eventData.days_remaining} dias — ${hotel}`;
  const message = `O contrato de experiência de ${eventData.contract_name} vence em ${eventData.days_remaining} dias`;

  await triggerNotification('EXP_CONTRACT_ENDING_SOON', {
    ...eventData,
    related_entity_table: 'employee_contracts',
    related_entity_type: 'contract',
  }, title, message);
};

export const notifyContractEndsToday = async (eventData: NotificationEventData) => {
  const hotel = eventData.hotel_name || await resolveHotelName(eventData.hotel_id);
  const title = `🚨 Contrato vence HOJE — ${hotel}`;
  const message = `O contrato de experiência de ${eventData.contract_name} vence hoje!`;

  await triggerNotification('EXP_CONTRACT_ENDS_TODAY', {
    ...eventData,
    related_entity_table: 'employee_contracts',
    related_entity_type: 'contract',
  }, title, message);
};

/**
 * Verifica todos os contratos ativos e dispara notificações para os que vencem hoje ou em 5 dias.
 * Usa sessionStorage para rodar apenas 1x por sessão do navegador.
 * Verifica no banco se já existe notificação para o mesmo contrato hoje (evita duplicatas).
 */
export const checkContractExpirations = async () => {
  const SESSION_KEY = 'contract_check_done';
  if (sessionStorage.getItem(SESSION_KEY)) return;
  sessionStorage.setItem(SESSION_KEY, '1');

  try {
    const { data: contracts, error } = await supabase
      .from('employee_contracts')
      .select('id, employee_name, start_date, hotel_id')
      .eq('is_active', true);

    if (error || !contracts) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().slice(0, 10); // YYYY-MM-DD

    // Buscar notificações de contrato já enviadas hoje para evitar duplicatas
    const { data: existingToday } = await supabase
      .from('notifications')
      .select('related_entity_id')
      .in('related_entity_type', ['contract'])
      .gte('created_at', todayISO + 'T00:00:00')
      .lte('created_at', todayISO + 'T23:59:59');

    const alreadyNotified = new Set(existingToday?.map(n => n.related_entity_id) || []);

    for (const contract of contracts) {
      if (alreadyNotified.has(contract.id)) continue; // já notificado hoje

      const startDate = new Date(contract.start_date + 'T12:00:00');

      // Fim do 1º período (30 dias) e 2º período (90 dias)
      const endDates = [
        new Date(startDate.getTime() + 29 * 86400000),
        new Date(startDate.getTime() + 89 * 86400000),
      ];

      for (const endDate of endDates) {
        const diffMs = endDate.getTime() - today.getTime();
        const diffDays = Math.round(diffMs / 86400000);

        if (diffDays !== 0 && diffDays !== 5) continue;

        const eventData: NotificationEventData = {
          hotel_id: contract.hotel_id,
          contract_name: contract.employee_name,
          days_remaining: diffDays,
          related_entity_id: contract.id,
        };

        if (diffDays === 0) {
          await notifyContractEndsToday(eventData);
        } else {
          await notifyContractEndingSoon(eventData);
        }
      }
    }
  } catch (err) {
    console.error('Erro ao verificar contratos:', err);
  }
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
