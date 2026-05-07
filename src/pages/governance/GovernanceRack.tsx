// src/pages/governance/GovernanceRack.tsx
// Rack central da Governança com visual unificado e filtros estratégicos

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles, RefreshCw, Loader2, Filter, Clock, CheckCircle,
  AlertTriangle, Wrench, ChevronRight, History, Info,
  LogIn, LogOut, Search, User, MapPin, MessageSquare, BedDouble
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { governanceService, UnifiedRoom, RoomWorkflowStatus, RoomStatusLog } from '../../lib/governanceService';
import { RoomRackCard } from '../../components/ui/RoomRackCard';
import Modal from '../../components/Modal';
import { format } from 'date-fns';

type RackFilter = 'all' | 'checkin' | 'checkout' | 'occupied' | 'maint_ok' | 'cleaning' | 'contested' | 'dirty';

const STATUS_LABELS: Record<RoomWorkflowStatus, string> = {
  pending_maint: 'Aguard. Mant.',
  maint_ok:      'Lib. Mant.',
  cleaning:      'Em Limpeza',
  clean:         'Limpo',
  contested:     'Contestado',
};

function StatPill({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all whitespace-nowrap
      ${active ? `${color} border-current/30 shadow-sm font-black` : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-500 hover:border-gray-300 font-bold'}`}>
      <span className="text-[10px] uppercase tracking-wider">{label}</span>
      <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${active ? 'bg-white/30' : 'bg-gray-100 dark:bg-gray-700'}`}>{count}</span>
    </button>
  );
}

export default function GovernanceRack() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [rooms, setRooms] = useState<UnifiedRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RackFilter>('all');
  const [search, setSearch] = useState('');
  
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
      addNotification(`UH ${room.name} atualizada para ${STATUS_LABELS[toStatus]}`, 'success');
      loadRack();
      if (selectedRoom?.id === room.id) setSelectedRoom(null);
    } catch (err: any) {
      addNotification('Erro ao atualizar status.', 'error');
    }
  };

  const stats = useMemo(() => ({
    all:       rooms.length,
    checkin:   rooms.filter(r => r.hasCheckinToday).length,
    checkout:  rooms.filter(r => r.hasCheckoutToday).length,
    occupied:  rooms.filter(r => r.occupied).length,
    maint_ok:  rooms.filter(r => r.workflowStatus === 'maint_ok').length,
    cleaning:  rooms.filter(r => r.workflowStatus === 'cleaning').length,
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
        case 'occupied':  return r.occupied;
        case 'maint_ok':  return r.workflowStatus === 'maint_ok';
        case 'cleaning':  return r.workflowStatus === 'cleaning';
        case 'dirty':     return r.erbonStatus === 'DIRTY';
        default: return true;
      }
    });
  }, [rooms, filter, search]);

  if (!selectedHotel) return null;

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-3 uppercase tracking-tighter">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            Rack Governança
          </h1>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1 ml-[52px]">Limpeza, Vistoria e Sincronização Erbon</p>
        </div>
        <button onClick={loadRack} disabled={loading} className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-emerald-600 transition-all bg-white dark:bg-gray-800 shadow-sm">
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-5">
        <div className="flex flex-wrap gap-2">
          <StatPill label="Todos" count={stats.all} active={filter === 'all'} onClick={() => setFilter('all')} color="text-slate-600" />
          <StatPill label="Check-in" count={stats.checkin} active={filter === 'checkin'} onClick={() => setFilter('checkin')} color="text-violet-600" />
          <StatPill label="Check-out" count={stats.checkout} active={filter === 'checkout'} onClick={() => setFilter('checkout')} color="text-rose-600" />
          <StatPill label="Ocupados" count={stats.occupied} active={filter === 'occupied'} onClick={() => setFilter('occupied')} color="text-sky-600" />
          <StatPill label="Lib. Mant." count={stats.maint_ok} active={filter === 'maint_ok'} onClick={() => setFilter('maint_ok')} color="text-blue-600" />
          <StatPill label="Em Limpeza" count={stats.cleaning} active={filter === 'cleaning'} onClick={() => setFilter('cleaning')} color="text-amber-600" />
          <StatPill label="Sujos (PMS)" count={stats.dirty} active={filter === 'dirty'} onClick={() => setFilter('dirty')} color="text-orange-600" />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Buscar UH ou hóspede..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-none rounded-2xl text-sm focus:ring-2 focus:ring-emerald-500 font-medium transition-all" />
        </div>
      </div>

      {loading && rooms.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 text-gray-400"><Loader2 className="h-10 w-10 animate-spin" /><p className="font-black uppercase text-[10px] tracking-widest">Sincronizando Rack...</p></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3">
          {filteredRooms.map(room => (
            <RoomRackCard
              key={room.id}
              roomName={room.name}
              categoryName={room.categoryName}
              floor={room.floor}
              workflowStatus={room.workflowStatus}
              erbonStatus={room.erbonStatus}
              occupied={room.occupied}
              hasCheckinToday={room.hasCheckinToday}
              hasCheckoutToday={room.hasCheckoutToday}
              bookingHolder={room.bookingHolder}
              onSelect={() => governanceService.fetchRoomHistory(selectedHotel.id, room.id).then(h => { setSelectedRoom(room); setHistory(h); })}
              actions={
                <div className="space-y-1 mt-2">
                  {room.workflowStatus === 'maint_ok' && (
                    <button onClick={(e) => { e.stopPropagation(); handleUpdateStatus(room, 'cleaning'); }} className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase rounded-lg shadow-sm active:scale-95 transition-all">Iniciar Limpeza</button>
                  )}
                  {room.workflowStatus === 'cleaning' && (
                    <button onClick={(e) => { e.stopPropagation(); handleUpdateStatus(room, 'clean'); }} className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase rounded-lg shadow-sm active:scale-95 transition-all">Marcar Limpo</button>
                  )}
                  {(room.workflowStatus === 'maint_ok' || room.workflowStatus === 'cleaning') && (
                    <button onClick={(e) => { e.stopPropagation(); setSelectedRoom(room); setContestNotes(''); }} className="w-full py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black uppercase rounded-lg active:scale-95 transition-all">Contestar</button>
                  )}
                  {room.workflowStatus === 'clean' && (
                    <div className="flex items-center justify-center gap-1 py-1.5 text-emerald-500 font-black text-[9px] uppercase tracking-tighter"><CheckCircle size={10} /> Disponível</div>
                  )}
                </div>
              }
            />
          ))}
        </div>
      )}

      {/* Modal Historico */}
      <Modal isOpen={!!selectedRoom} onClose={() => { setSelectedRoom(null); setContestNotes(''); }} title={`UH ${selectedRoom?.name} — Histórico e Ações`} size="lg">
        <div className="space-y-6">
          {selectedRoom && selectedRoom.workflowStatus !== 'clean' && (
            <div className="p-5 bg-rose-50 dark:bg-rose-950/20 rounded-3xl border border-rose-100 dark:border-rose-900/30">
              <h4 className="text-[10px] font-black text-rose-600 uppercase mb-3 flex items-center gap-2"><AlertTriangle size={14} /> Contestar Vistoria/Limpeza</h4>
              <textarea placeholder="Motivo da contestação..." value={contestNotes} onChange={e => setContestNotes(e.target.value)} className="w-full p-4 bg-white dark:bg-gray-900 border border-rose-200 dark:border-rose-800 rounded-2xl text-sm focus:ring-2 focus:ring-rose-500 mb-4" rows={2} />
              <button disabled={!contestNotes.trim()} onClick={() => handleUpdateStatus(selectedRoom, 'contested', contestNotes)} className="w-full py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-black uppercase rounded-2xl transition-all shadow-lg shadow-rose-600/20">Rejeitar e Notificar Manutenção</button>
            </div>
          )}
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><History size={14} /> Linha do Tempo</h4>
            <div className="space-y-4">
              {history.map((log) => (
                <div key={log.id} className="flex gap-4">
                  <div className="shrink-0 text-[10px] font-black text-gray-400 w-10 text-right pt-0.5">{format(new Date(log.created_at), "HH:mm")}</div>
                  <div className="flex-1 pb-4 border-l border-gray-100 dark:border-gray-800 pl-4 relative">
                    <div className="absolute -left-1 top-1.5 w-2 h-2 rounded-full bg-emerald-500" />
                    <p className="text-xs font-black uppercase text-gray-800 dark:text-gray-200">{STATUS_LABELS[log.to_status as RoomWorkflowStatus] || log.to_status}</p>
                    <p className="text-[10px] text-gray-500 mt-1">Realizado por: <b className="text-emerald-600">{log.user_name}</b> {log.duration_seconds && <span>· {Math.round(log.duration_seconds / 60)} min</span>}</p>
                    {log.notes && <p className="mt-2 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl text-[11px] text-gray-500 italic border border-gray-100 dark:border-gray-800 leading-relaxed">"{log.notes}"</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
