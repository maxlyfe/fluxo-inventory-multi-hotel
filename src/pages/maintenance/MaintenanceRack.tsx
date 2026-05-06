// src/pages/maintenance/MaintenanceRack.tsx
// Rack de UHs para a equipe de Manutenção realizar vistorias e liberação

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HardHat, RefreshCw, Loader2, CheckCircle, AlertTriangle,
  Search, BedDouble, History, Info, Wrench, Clock
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { governanceService, UnifiedRoom } from '../../lib/governanceService';
import Modal from '../../components/Modal';

export default function MaintenanceRack() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [rooms, setRooms] = useState<UnifiedRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
        notes: 'Checklist de manutenção realizado e aprovado.'
      });
      addNotification(`UH ${room.name} liberada para Governança.`, 'success');
      loadRack();
    } catch (err: any) {
      addNotification('Erro ao liberar UH.', 'error');
    }
  };

  const filteredRooms = useMemo(() => {
    return rooms.filter(r => 
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.categoryName?.toLowerCase().includes(search.toLowerCase())
    );
  }, [rooms, search]);

  if (!selectedHotel) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-orange-500 flex items-center justify-center shadow-lg shadow-orange-200 dark:shadow-orange-900/40">
              <Wrench className="h-5 w-5 text-white" />
            </div>
            Vistoria de Manutenção (Rack)
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[52px]">
            Realize o checklist matinal e libere as UHs para a limpeza da Governança.
          </p>
        </div>
        <button onClick={loadRack} disabled={loading} className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-orange-600 transition-all">
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Search */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar UH por número ou tipo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900 border-none rounded-xl text-sm focus:ring-2 focus:ring-orange-500 transition-all"
          />
        </div>
      </div>

      {/* Rack Grid */}
      {loading && rooms.length === 0 ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredRooms.map(room => {
            const isPending = room.workflowStatus === 'pending_maint' || room.workflowStatus === 'contested';
            const isOk = room.workflowStatus !== 'pending_maint' && room.workflowStatus !== 'contested';
            
            return (
              <div key={room.id} className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 shadow-sm transition-all
                ${room.workflowStatus === 'contested' ? 'border-rose-200 bg-rose-50/30 dark:border-rose-900/30 dark:bg-rose-950/10' : 'border-gray-100 dark:border-gray-700'}`}>
                
                <div className="flex justify-between items-start mb-2">
                  <span className={`text-2xl font-black ${isOk ? 'text-emerald-500' : 'text-gray-400'}`}>{room.name}</span>
                  {room.workflowStatus === 'contested' && (
                    <div className="p-1 rounded bg-rose-100 text-rose-600 animate-pulse"><AlertTriangle size={12} /></div>
                  )}
                </div>
                
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-4 truncate">{room.categoryName || 'Apartamento'}</p>

                <div className="space-y-2">
                  {isPending ? (
                    <button
                      onClick={() => handleRelease(room)}
                      className="w-full py-2 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-black uppercase rounded-xl shadow-lg shadow-orange-600/20 active:scale-95 transition-all"
                    >
                      Liberar Checklist
                    </button>
                  ) : (
                    <div className="flex items-center justify-center gap-1.5 py-2 text-emerald-500 font-bold text-[10px] uppercase bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                      <CheckCircle size={12} /> Liberado
                    </div>
                  )}
                  
                  {room.workflowStatus === 'cleaning' && (
                    <div className="flex items-center justify-center gap-1.5 py-1 text-amber-500 font-bold text-[9px] uppercase italic">
                      <Clock size={10} /> Em Limpeza
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
