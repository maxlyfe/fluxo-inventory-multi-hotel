// src/pages/maintenance/MaintenanceRack.tsx
// Rack de UHs para a equipe de Manutenção com visual unificado

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wrench, RefreshCw, Loader2, CheckCircle, AlertTriangle,
  Search, BedDouble, History, Filter, LogIn, LogOut, User
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { governanceService, UnifiedRoom, RoomWorkflowStatus, RoomStatusLog } from '../../lib/governanceService';
import { RoomRackCard } from '../../components/ui/RoomRackCard';
import Modal from '../../components/Modal';
import { format } from 'date-fns';

type MaintenanceFilter = 'all' | 'pending' | 'checkin' | 'checkout' | 'occupied' | 'contested';

const STATUS_LABELS: Record<RoomWorkflowStatus, string> = {
  pending_maint: 'Pendente Vistoria',
  maint_ok:      'Liberado Mant.',
  cleaning:      'Em Limpeza',
  clean:         'Limpo',
  contested:     'CONTESTADO',
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

export default function MaintenanceRack() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [rooms, setRooms] = useState<UnifiedRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MaintenanceFilter>('all');
  const [search, setSearch] = useState('');
  
  const [selectedRoom, setSelectedRoom] = useState<UnifiedRoom | null>(null);
  const [history, setHistory] = useState<RoomStatusLog[]>([]);

  const loadRack = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    try {
      const data = await governanceService.fetchRoomsWithWorkflow(selectedHotel.id);
      setRooms(data);
    } catch (err: any) {
      addNotification('Erro ao carregar Rack de Manutenção.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);

  useEffect(() => { loadRack(); }, [loadRack]);

  const handleRelease = async (room: UnifiedRoom) => {
    if (!selectedHotel || !user) return;
    try {
      await governanceService.updateRoomStatus({
        hotelId: selectedHotel.id,
        roomId: room.id,
        roomName: room.name,
        toStatus: 'maint_ok',
        userId: user.id,
        userName: user.email?.split('@')[0] || 'Manutenção',
        notes: 'Checklist de manutenção aprovado.'
      });
      addNotification(`UH ${room.name} liberada para Governança.`, 'success');
      loadRack();
    } catch (err: any) {
      addNotification('Erro ao liberar UH.', 'error');
    }
  };

  const stats = useMemo(() => ({
    all:       rooms.length,
    pending:   rooms.filter(r => r.workflowStatus === 'pending_maint' || r.workflowStatus === 'contested').length,
    checkin:   rooms.filter(r => r.hasCheckinToday).length,
    checkout:  rooms.filter(r => r.hasCheckoutToday).length,
    occupied:  rooms.filter(r => r.occupied).length,
    contested: rooms.filter(r => r.workflowStatus === 'contested').length,
  }), [rooms]);

  const filteredRooms = useMemo(() => {
    return rooms.filter(r => {
      const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      switch (filter) {
        case 'pending':   return r.workflowStatus === 'pending_maint' || r.workflowStatus === 'contested';
        case 'checkin':   return r.hasCheckinToday;
        case 'checkout':  return r.hasCheckoutToday;
        case 'occupied':  return r.occupied;
        case 'contested': return r.workflowStatus === 'contested';
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
            <div className="w-10 h-10 rounded-2xl bg-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20 text-white">
              <Wrench className="h-5 w-5" />
            </div>
            Rack Manutenção
          </h1>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1 ml-[52px]">Checklist matinal e vistorias técnicas</p>
        </div>
        <button onClick={loadRack} disabled={loading} className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-orange-600 transition-all bg-white dark:bg-gray-800 shadow-sm">
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-5">
        <div className="flex flex-wrap gap-2">
          <StatPill label="Todos" count={stats.all} active={filter === 'all'} onClick={() => setFilter('all')} color="text-slate-600" />
          <StatPill label="Pendentes" count={stats.pending} active={filter === 'pending'} onClick={() => setFilter('pending')} color="text-orange-600" />
          <StatPill label="Contestados" count={stats.contested} active={filter === 'contested'} onClick={() => setFilter('contested')} color="text-rose-600" />
          <StatPill label="Check-in" count={stats.checkin} active={filter === 'checkin'} onClick={() => setFilter('checkin')} color="text-violet-600" />
          <StatPill label="Ocupados" count={stats.occupied} active={filter === 'occupied'} onClick={() => setFilter('occupied')} color="text-sky-600" />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Buscar UH..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-none rounded-2xl text-sm focus:ring-2 focus:ring-orange-500 font-medium transition-all" />
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
              onSelect={() => governanceService.fetchRoomHistory(selectedHotel.id, room.id).then(h => { setSelectedRoom(room); setHistory(h); })}
              actions={
                <div className="space-y-1 mt-2">
                  {(room.workflowStatus === 'pending_maint' || room.workflowStatus === 'contested') ? (
                    <button onClick={(e) => { e.stopPropagation(); handleRelease(room); }} className="w-full py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-black uppercase rounded-lg shadow-sm active:scale-95 transition-all">Liberar Checklist</button>
                  ) : (
                    <div className="flex items-center justify-center gap-1.5 py-1.5 text-emerald-500 font-black text-[9px] uppercase tracking-tighter bg-emerald-50 dark:bg-emerald-900/20 rounded-lg"><CheckCircle size={10} /> Liberado</div>
                  )}
                  {room.workflowStatus === 'cleaning' && (
                    <div className="flex items-center justify-center gap-1 py-1.5 text-amber-500 font-black text-[9px] uppercase tracking-tighter animate-pulse"><Clock size={10} /> Em Limpeza</div>
                  )}
                </div>
              }
            />
          ))}
        </div>
      )}

      {/* Modal Historico */}
      <Modal isOpen={!!selectedRoom} onClose={() => setSelectedRoom(null)} title={`UH ${selectedRoom?.name} — Histórico`} size="lg">
        <div className="space-y-6">
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><History size={14} /> Eventos de Hoje</h4>
            <div className="space-y-4">
              {history.map((log) => (
                <div key={log.id} className="flex gap-4">
                  <div className="shrink-0 text-[10px] font-black text-gray-400 w-10 text-right pt-0.5">{format(new Date(log.created_at), "HH:mm")}</div>
                  <div className="flex-1 pb-4 border-l border-gray-100 dark:border-gray-800 pl-4 relative">
                    <div className="absolute -left-1 top-1.5 w-2 h-2 rounded-full bg-orange-500" />
                    <p className="text-xs font-black uppercase text-gray-800 dark:text-gray-200">{STATUS_LABELS[log.to_status as RoomWorkflowStatus] || log.to_status}</p>
                    <p className="text-[10px] text-gray-500 mt-1">Por: <b className="text-orange-600">{log.user_name}</b></p>
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
