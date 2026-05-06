// src/pages/governance/GovernanceRack.tsx
// Rack central da Governança com fluxo integrado à Manutenção e Erbon

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles, RefreshCw, Loader2, Filter, Clock, CheckCircle,
  AlertTriangle, Wrench, ChevronRight, History, Info,
  LogIn, LogOut, Search, User, MapPin, MessageSquare, ArrowLeftRight
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { governanceService, UnifiedRoom, RoomWorkflowStatus, RoomStatusLog } from '../../lib/governanceService';
import Modal from '../../components/Modal';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ── Tipos e Constantes ────────────────────────────────────────────────────────

type RackFilter = 'all' | 'checkin' | 'checkout' | 'maint_ok' | 'cleaning' | 'contested' | 'dirty';

const STATUS_CONFIG: Record<RoomWorkflowStatus, { label: string; color: string; bg: string; border: string; icon: any }> = {
  pending_maint: { label: 'Aguard. Mant.', color: 'text-slate-500', bg: 'bg-slate-50 dark:bg-slate-900/20', border: 'border-slate-200 dark:border-slate-800', icon: Wrench },
  maint_ok:      { label: 'Lib. Mant.',   color: 'text-blue-500',  bg: 'bg-blue-50 dark:bg-blue-900/20',  border: 'border-blue-200 dark:border-blue-800',  icon: CheckCircle },
  cleaning:      { label: 'Em Limpeza',   color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', icon: Clock },
  clean:         { label: 'Limpo',        color: 'text-emerald-500',bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', icon: Sparkles },
  contested:     { label: 'Contestado',    color: 'text-rose-500',  bg: 'bg-rose-50 dark:bg-rose-900/20',  border: 'border-rose-200 dark:border-rose-800',  icon: AlertTriangle },
};

// ── Sub-componentes ───────────────────────────────────────────────────────────

function StatPill({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all whitespace-nowrap
      ${active ? `${color} border-current/30 shadow-sm font-bold` : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-500 hover:border-gray-300'}`}>
      <span className="text-[10px] uppercase tracking-wider">{label}</span>
      <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${active ? 'bg-white/30' : 'bg-gray-100 dark:bg-gray-700'}`}>{count}</span>
    </button>
  );
}

// ── Componente Principal ──────────────────────────────────────────────────────

export default function GovernanceRack() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [rooms, setRooms] = useState<UnifiedRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RackFilter>('all');
  const [search, setSearch] = useState('');
  
  // Modals
  const [selectedRoom, setSelectedRoom] = useState<UnifiedRoom | null>(null);
  const [history, setHistory] = useState<RoomStatusLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [contestNotes, setContestNotes] = useState('');

  const loadRack = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    try {
      const data = await governanceService.fetchRoomsWithWorkflow(selectedHotel.id);
      setRooms(data);
    } catch (err: any) {
      addNotification('Erro ao carregar Rack de Governança.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);

  useEffect(() => { loadRack(); }, [loadRack]);

  // ── Ações ────────────────────────────────────────────────────────────────

  const handleUpdateStatus = async (room: UnifiedRoom, toStatus: RoomWorkflowStatus, notes?: string) => {
    if (!selectedHotel || !user) return;
    try {
      await governanceService.updateRoomStatus({
        hotelId: selectedHotel.id,
        roomId: room.id,
        roomName: room.name,
        toStatus,
        userId: user.id,
        userName: user.email?.split('@')[0] || 'Usuário',
        notes
      });
      addNotification(`UH ${room.name} atualizada para ${STATUS_CONFIG[toStatus].label}`, 'success');
      loadRack();
      if (selectedRoom?.id === room.id) setSelectedRoom(null);
    } catch (err: any) {
      addNotification('Erro ao atualizar status.', 'error');
    }
  };

  const openHistory = async (room: UnifiedRoom) => {
    if (!selectedHotel) return;
    setSelectedRoom(room);
    setLoadingHistory(true);
    try {
      const logs = await governanceService.fetchRoomHistory(selectedHotel.id, room.id);
      setHistory(logs);
    } catch {
      addNotification('Erro ao buscar histórico.', 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  // ── Filtros ──────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    all:       rooms.length,
    checkin:   rooms.filter(r => r.hasCheckinToday).length,
    checkout:  rooms.filter(r => r.hasCheckoutToday).length,
    maint_ok:  rooms.filter(r => r.workflowStatus === 'maint_ok').length,
    cleaning:  rooms.filter(r => r.workflowStatus === 'cleaning').length,
    contested: rooms.filter(r => r.workflowStatus === 'contested').length,
    dirty:     rooms.filter(r => r.erbonStatus === 'DIRTY').length,
  }), [rooms]);

  const filteredRooms = useMemo(() => {
    return rooms.filter(r => {
      const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase()) || 
                           r.bookingHolder?.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      switch (filter) {
        case 'checkin':   return r.hasCheckinToday;
        case 'checkout':  return r.hasCheckoutToday;
        case 'maint_ok':  return r.workflowStatus === 'maint_ok';
        case 'cleaning':  return r.workflowStatus === 'cleaning';
        case 'contested': return r.workflowStatus === 'contested';
        case 'dirty':     return r.erbonStatus === 'DIRTY';
        default: return true;
      }
    });
  }, [rooms, filter, search]);

  if (!selectedHotel) return null;

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-6 space-y-6">
      
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-200 dark:shadow-emerald-900/40">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            Governança & Vistoria
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[52px]">
            Controle de limpeza, liberação de UHs e integração com Manutenção.
          </p>
        </div>
        <button onClick={loadRack} disabled={loading} className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-emerald-600 transition-all">
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
        <div className="flex flex-wrap gap-2">
          <StatPill label="Todos" count={stats.all} active={filter === 'all'} onClick={() => setFilter('all')} color="text-slate-600" />
          <StatPill label="Check-in" count={stats.checkin} active={filter === 'checkin'} onClick={() => setFilter('checkin')} color="text-violet-600" />
          <StatPill label="Check-out" count={stats.checkout} active={filter === 'checkout'} onClick={() => setFilter('checkout')} color="text-rose-600" />
          <StatPill label="Lib. Mant." count={stats.maint_ok} active={filter === 'maint_ok'} onClick={() => setFilter('maint_ok')} color="text-blue-600" />
          <StatPill label="Em Limpeza" count={stats.cleaning} active={filter === 'cleaning'} onClick={() => setFilter('cleaning')} color="text-amber-600" />
          <StatPill label="Sujos (PMS)" count={stats.dirty} active={filter === 'dirty'} onClick={() => setFilter('dirty')} color="text-orange-600" />
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar UH ou hóspede..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900 border-none rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 transition-all"
          />
        </div>
      </div>

      {/* Grid de UHs */}
      {loading && rooms.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 text-gray-400">
          <Loader2 className="h-10 w-10 animate-spin" />
          <p className="font-medium">Sincronizando Rack...</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3">
          {filteredRooms.map(room => {
            const cfg = STATUS_CONFIG[room.workflowStatus];
            return (
              <div key={room.id} className={`group relative bg-white dark:bg-gray-800 rounded-2xl border p-3 shadow-sm transition-all hover:scale-[1.03] hover:shadow-md
                ${cfg.border} border-opacity-40`}>
                
                {/* Status Badge */}
                <div className={`absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-tighter ${cfg.bg} ${cfg.color} ${cfg.border} shadow-sm z-10`}>
                  {cfg.label}
                </div>

                {/* UH Info */}
                <div className="text-center mt-2 mb-3">
                  <span className={`text-2xl font-black ${cfg.color}`}>{room.name}</span>
                  <p className="text-[9px] text-gray-400 font-bold uppercase truncate px-1">{room.categoryName || 'UH'}</p>
                </div>

                {/* Badges */}
                <div className="flex justify-center gap-1 mb-3">
                   {room.hasCheckinToday && <div title="Check-in hoje" className="p-1 rounded bg-violet-100 text-violet-600"><LogIn size={10} /></div>}
                   {room.hasCheckoutToday && <div title="Check-out hoje" className="p-1 rounded bg-rose-100 text-rose-600"><LogOut size={10} /></div>}
                   {room.erbonStatus === 'DIRTY' && <div title="Sujo no PMS" className="p-1 rounded bg-orange-100 text-orange-600"><AlertTriangle size={10} /></div>}
                </div>

                {/* Action Buttons */}
                <div className="space-y-1">
                  {room.workflowStatus === 'maint_ok' && (
                    <button onClick={() => handleUpdateStatus(room, 'cleaning')} className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase rounded-lg shadow-sm">
                      Iniciar Limpeza
                    </button>
                  )}
                  {room.workflowStatus === 'cleaning' && (
                    <button onClick={() => handleUpdateStatus(room, 'clean')} className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase rounded-lg shadow-sm">
                      Marcar Limpo
                    </button>
                  )}
                  {(room.workflowStatus === 'maint_ok' || room.workflowStatus === 'cleaning') && (
                    <button onClick={() => openHistory(room)} className="w-full py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black uppercase rounded-lg">
                      Contestar
                    </button>
                  )}
                  {room.workflowStatus === 'clean' && (
                    <div className="flex items-center justify-center gap-1 py-1.5 text-emerald-500 font-bold text-[10px] uppercase">
                      <CheckCircle size={12} /> Disponível
                    </div>
                  )}
                </div>

                {/* History Icon */}
                <button onClick={() => openHistory(room)} className="absolute top-1 right-1 p-1 text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  <History size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Histórico e Contestação */}
      <Modal isOpen={!!selectedRoom} onClose={() => { setSelectedRoom(null); setContestNotes(''); }} title={`UH ${selectedRoom?.name} — Histórico do Dia`} size="lg">
        <div className="space-y-6">
          
          {/* Ações de Contestação (apenas se não estiver limpo) */}
          {selectedRoom && selectedRoom.workflowStatus !== 'clean' && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/20 rounded-2xl border border-rose-100 dark:border-rose-900/30">
              <h4 className="text-xs font-black text-rose-600 uppercase mb-3 flex items-center gap-2">
                <AlertTriangle size={14} /> Contestar Vistoria/Limpeza
              </h4>
              <textarea
                placeholder="Motivo da contestação (Ex: Ar condicionado ainda pingando, infiltração no teto...)"
                value={contestNotes}
                onChange={e => setContestNotes(e.target.value)}
                className="w-full p-3 bg-white dark:bg-gray-900 border border-rose-200 dark:border-rose-800 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 mb-3"
                rows={2}
              />
              <button
                disabled={!contestNotes.trim()}
                onClick={() => handleUpdateStatus(selectedRoom, 'contested', contestNotes)}
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-black uppercase rounded-xl transition-all shadow-lg shadow-rose-600/20"
              >
                Rejeitar e Notificar Manutenção
              </button>
            </div>
          )}

          {/* Linha do Tempo */}
          <div className="space-y-4">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <History size={14} /> Eventos Recentes
            </h4>
            
            {loadingHistory ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-300" /></div>
            ) : history.length === 0 ? (
              <p className="text-center py-8 text-xs text-gray-400 italic">Nenhum evento registrado hoje.</p>
            ) : (
              <div className="relative pl-6 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-gray-100 dark:before:bg-gray-700">
                {history.map((log, idx) => {
                  const cfg = STATUS_CONFIG[log.to_status];
                  return (
                    <div key={log.id} className="relative">
                      <div className={`absolute -left-[29px] top-0 w-6 h-6 rounded-full border-4 border-white dark:border-gray-800 flex items-center justify-center ${cfg.bg} ${cfg.color}`}>
                        <cfg.icon size={10} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <p className={`text-xs font-black uppercase ${cfg.color}`}>{cfg.label}</p>
                          <span className="text-[10px] text-gray-400 font-bold">{format(new Date(log.created_at), "HH:mm")}</span>
                        </div>
                        <p className="text-[11px] text-gray-600 dark:text-gray-300 font-medium">
                          Por: <span className="font-bold">{log.user_name}</span>
                          {log.duration_seconds && (
                            <span className="ml-2 text-[10px] text-gray-400 italic">
                              (Duração: {Math.round(log.duration_seconds / 60)} min)
                            </span>
                          )}
                        </p>
                        {log.notes && (
                          <div className="mt-1 p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-[11px] text-gray-500 italic border border-gray-100 dark:border-gray-800">
                            "{log.notes}"
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </Modal>

    </div>
  );
}
