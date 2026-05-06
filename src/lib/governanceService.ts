// src/lib/governanceService.ts
// Serviço para o módulo de Governança e Integração com Manutenção

import { supabase } from './supabase';
import { erbonService } from './erbonService';
import * as triggers from './notificationTriggers';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type RoomWorkflowStatus = 'pending_maint' | 'maint_ok' | 'cleaning' | 'clean' | 'contested';

export interface RoomCategory {
  id: string;
  hotel_id: string;
  name: string;
}

export interface HotelRoom {
  id: string;
  hotel_id: string;
  category_id: string | null;
  name: string;
  floor: number | null;
  is_active: boolean;
}

export interface RoomWorkflow {
  id: string;
  hotel_id: string;
  room_id: string;
  room_name: string;
  status: RoomWorkflowStatus;
  last_user_id: string | null;
  last_user_name: string | null;
  updated_at: string;
}

export interface RoomStatusLog {
  id: string;
  hotel_id: string;
  room_id: string;
  from_status: RoomWorkflowStatus | null;
  to_status: RoomWorkflowStatus;
  user_id: string | null;
  user_name: string | null;
  notes: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface UnifiedRoom {
  id: string; // Erbon ID ou Local UUID
  name: string;
  floor: number | null;
  categoryName: string | null;
  workflowStatus: RoomWorkflowStatus;
  erbonStatus?: 'CLEAN' | 'DIRTY';
  occupied?: boolean;
  hasCheckinToday?: boolean;
  hasCheckoutToday?: boolean;
  bookingHolder?: string | null;
}

// ── Funções de Gestão (Manual) ───────────────────────────────────────────────

export const governanceService = {
  
  // ── Categorias e UHs (Manual) ─────────────────────────────────────────────

  async fetchCategories(hotelId: string): Promise<RoomCategory[]> {
    const { data, error } = await supabase
      .from('hotel_room_categories')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('name');
    if (error) throw error;
    return data || [];
  },

  async upsertCategory(hotelId: string, name: string, id?: string): Promise<void> {
    const { error } = await supabase
      .from('hotel_room_categories')
      .upsert({ id, hotel_id: hotelId, name });
    if (error) throw error;
  },

  async deleteCategory(id: string): Promise<void> {
    const { error } = await supabase
      .from('hotel_room_categories')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async fetchLocalRooms(hotelId: string): Promise<HotelRoom[]> {
    const { data, error } = await supabase
      .from('hotel_rooms')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('name', { numeric: true });
    if (error) throw error;
    return data || [];
  },

  async upsertRoom(room: Partial<HotelRoom> & { hotel_id: string; name: string }): Promise<void> {
    const { error } = await supabase
      .from('hotel_rooms')
      .upsert(room);
    if (error) throw error;
  },

  async deleteRoom(id: string): Promise<void> {
    const { error } = await supabase
      .from('hotel_rooms')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ── Fluxo de Trabalho (Workflow) ──────────────────────────────────────────

  async fetchRoomsWithWorkflow(hotelId: string): Promise<UnifiedRoom[]> {
    // 1. Tentar buscar Erbon Config
    const erbonCfg = await erbonService.getConfig(hotelId);
    const hasErbon = erbonCfg?.is_active;

    let rooms: UnifiedRoom[] = [];

    // 2. Buscar status locais de workflow
    const { data: workflowStates } = await supabase
      .from('hotel_room_workflow')
      .select('*')
      .eq('hotel_id', hotelId);
    
    const workflowMap = new Map<string, RoomWorkflow>();
    (workflowStates || []).forEach(ws => workflowMap.set(ws.room_id, ws));

    if (hasErbon) {
      // MODO ERBON
      const [erbonRooms, inHouse, checkouts] = await Promise.all([
        erbonService.fetchHousekeeping(hotelId),
        erbonService.fetchInHouseGuests(hotelId),
        erbonService.fetchTodayCheckouts(hotelId),
      ]);

      rooms = erbonRooms.map(er => {
        const wf = workflowMap.get(String(er.idRoom));
        return {
          id: String(er.idRoom),
          name: er.roomName,
          floor: er.numberFloor,
          categoryName: er.roomTypeDescription,
          workflowStatus: wf?.status || 'pending_maint',
          erbonStatus: er.idHousekeepingStatus,
          occupied: er.currentlyOccupiedOrAvailable === 'Ocupado',
          hasCheckinToday: er.hasCheckinToday,
          hasCheckoutToday: checkouts.some(c => c.roomDescription === er.roomName),
          bookingHolder: er.bookingHolderName,
        };
      });
    } else {
      // MODO MANUAL
      const [localRooms, categories] = await Promise.all([
        this.fetchLocalRooms(hotelId),
        this.fetchCategories(hotelId),
      ]);

      const catMap = new Map<string, string>();
      categories.forEach(c => catMap.set(c.id, c.name));

      rooms = localRooms.map(lr => {
        const wf = workflowMap.get(lr.id);
        return {
          id: lr.id,
          name: lr.name,
          floor: lr.floor,
          categoryName: lr.category_id ? catMap.get(lr.category_id) || null : null,
          workflowStatus: wf?.status || 'pending_maint',
        };
      });
    }

    return rooms.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  },

  async updateRoomStatus(params: {
    hotelId: string;
    roomId: string;
    roomName: string;
    toStatus: RoomWorkflowStatus;
    userId: string;
    userName: string;
    notes?: string;
  }): Promise<void> {
    // 1. Buscar status atual para calcular duração
    const { data: current } = await supabase
      .from('hotel_room_workflow')
      .select('status, updated_at')
      .eq('hotel_id', params.hotelId)
      .eq('room_id', params.roomId)
      .maybeSingle();

    const fromStatus = current?.status || null;
    let durationSeconds = null;
    if (current?.updated_at) {
      durationSeconds = Math.floor((Date.now() - new Date(current.updated_at).getTime()) / 1000);
    }

    // 2. Atualizar Workflow
    const { error: wfError } = await supabase
      .from('hotel_room_workflow')
      .upsert({
        hotel_id: params.hotelId,
        room_id: params.roomId,
        room_name: params.roomName,
        status: params.toStatus,
        last_user_id: params.userId,
        last_user_name: params.userName,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'hotel_id,room_id' });

    if (wfError) throw wfError;

    // 3. Registrar Log
    await supabase.from('hotel_room_status_logs').insert({
      hotel_id: params.hotelId,
      room_id: params.roomId,
      from_status: fromStatus,
      to_status: params.toStatus,
      user_id: params.userId,
      user_name: params.userName,
      notes: params.notes,
      duration_seconds: durationSeconds,
    });

    // 4. Se for 'clean' e tiver Erbon, sincronizar
    if (params.toStatus === 'clean') {
      try {
        const erbonId = parseInt(params.roomId, 10);
        if (!isNaN(erbonId)) {
          await erbonService.updateHousekeepingStatus(params.hotelId, erbonId, 'CLEAN');
        }
      } catch (err) {
        console.error('[Governance] Erro ao sincronizar com Erbon:', err);
      }
    }

    // 5. Disparar Notificações
    try {
      const eventData = { hotel_id: params.hotelId, room_name: params.roomName };
      if (params.toStatus === 'maint_ok') {
        await triggers.notifyRoomReadyForGovernance(eventData);
      } else if (params.toStatus === 'clean') {
        await triggers.notifyRoomReadyForCheckin(eventData);
      } else if (params.toStatus === 'contested') {
        await triggers.notifyRoomContested({ ...eventData, reason: params.notes });
      }
    } catch (err) {
      console.error('[Governance] Erro ao disparar notificações:', err);
    }
  },

  async fetchRoomHistory(hotelId: string, roomId: string): Promise<RoomStatusLog[]> {
    const { data, error } = await supabase
      .from('hotel_room_status_logs')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  }
};
