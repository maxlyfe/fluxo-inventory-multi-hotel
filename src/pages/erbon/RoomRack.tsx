import React, { useState, useMemo, useCallback } from 'react';
import { LayoutGrid, RefreshCw, Loader2, Filter, Wrench, UserCheck, BedDouble } from 'lucide-react';
import { erbonService, ErbonRoom } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

const RoomRack: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [filterStatus, setFilterStatus] = useState<'all' | 'CLEAN' | 'DIRTY'>('all');
  const [filterOccupancy, setFilterOccupancy] = useState<'all' | 'occupied' | 'available'>('all');
  const [updatingRoom, setUpdatingRoom] = useState<number | null>(null);

  const { data: rooms, loading, error, refetch, erbonConfigured } = useErbonData<ErbonRoom[]>(
    (hotelId) => erbonService.fetchHousekeeping(hotelId),
    [],
    { autoRefreshMs: 60_000 }
  );

  const handleToggleStatus = useCallback(async (room: ErbonRoom) => {
    if (!selectedHotel?.id) return;
    const newStatus = room.idHousekeepingStatus === 'CLEAN' ? 'DIRTY' : 'CLEAN';
    setUpdatingRoom(room.idRoom);
    try {
      await erbonService.updateHousekeepingStatus(selectedHotel.id, room.idRoom, newStatus);
      addNotification(`Quarto ${room.roomName} → ${newStatus === 'CLEAN' ? 'Limpo' : 'Sujo'}`, 'success');
      refetch();
    } catch (err: any) {
      addNotification(`Erro ao atualizar: ${err.message}`, 'error');
    } finally {
      setUpdatingRoom(null);
    }
  }, [selectedHotel?.id, addNotification, refetch]);

  const filteredRooms = useMemo(() => {
    if (!rooms) return [];
    return rooms.filter(r => {
      if (filterStatus !== 'all' && r.idHousekeepingStatus !== filterStatus) return false;
      if (filterOccupancy === 'occupied' && r.currentlyOccupiedOrAvailable !== 'Ocupado') return false;
      if (filterOccupancy === 'available' && r.currentlyOccupiedOrAvailable !== 'Livre') return false;
      return true;
    });
  }, [rooms, filterStatus, filterOccupancy]);

  // Agrupar por tipo de quarto
  const groupedRooms = useMemo(() => {
    const groups: Record<string, ErbonRoom[]> = {};
    filteredRooms.forEach(r => {
      const key = r.roomTypeDescription || 'Outros';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    // Ordenar quartos dentro de cada grupo
    Object.values(groups).forEach(arr => arr.sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { numeric: true })));
    return groups;
  }, [filteredRooms]);

  const stats = useMemo(() => {
    if (!rooms) return { total: 0, clean: 0, dirty: 0, occupied: 0, available: 0, maintenance: 0, checkinToday: 0 };
    return {
      total: rooms.length,
      clean: rooms.filter(r => r.idHousekeepingStatus === 'CLEAN').length,
      dirty: rooms.filter(r => r.idHousekeepingStatus === 'DIRTY').length,
      occupied: rooms.filter(r => r.currentlyOccupiedOrAvailable === 'Ocupado').length,
      available: rooms.filter(r => r.currentlyOccupiedOrAvailable === 'Livre').length,
      maintenance: rooms.filter(r => r.inMaintenance).length,
      checkinToday: rooms.filter(r => r.hasCheckinToday).length,
    };
  }, [rooms]);

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-7 h-7 text-teal-600 dark:text-teal-400" />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Rack de UH's</h1>
        </div>
        <button onClick={refetch} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {[
          { label: 'Total', value: stats.total, color: 'text-gray-700 dark:text-gray-200' },
          { label: 'Limpos', value: stats.clean, color: 'text-green-600 dark:text-green-400' },
          { label: 'Sujos', value: stats.dirty, color: 'text-orange-600 dark:text-orange-400' },
          { label: 'Ocupados', value: stats.occupied, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Livres', value: stats.available, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Manutenção', value: stats.maintenance, color: 'text-red-600 dark:text-red-400' },
          { label: 'Check-in Hoje', value: stats.checkinToday, color: 'text-purple-600 dark:text-purple-400' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm border border-gray-100 dark:border-gray-700">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            <option value="all">Todos Status</option>
            <option value="CLEAN">Limpos</option>
            <option value="DIRTY">Sujos</option>
          </select>
        </div>
        <select value={filterOccupancy} onChange={e => setFilterOccupancy(e.target.value as any)}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
          <option value="all">Todas Ocupações</option>
          <option value="occupied">Ocupados</option>
          <option value="available">Livres</option>
        </select>
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {loading && !rooms ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedRooms).map(([type, typeRooms]) => (
            <div key={type}>
              <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                <BedDouble className="w-5 h-5" />
                {type}
                <span className="text-sm font-normal text-gray-400">({typeRooms.length})</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {typeRooms.map(room => {
                  const isOccupied = room.currentlyOccupiedOrAvailable === 'Ocupado';
                  const isClean = room.idHousekeepingStatus === 'CLEAN';
                  const isUpdating = updatingRoom === room.idRoom;

                  return (
                    <div
                      key={room.idRoom}
                      className={`relative rounded-xl border-2 p-3 transition-all duration-200 hover:shadow-md ${
                        room.inMaintenance
                          ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                          : isOccupied
                            ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20'
                            : isClean
                              ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
                              : 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20'
                      }`}
                    >
                      {/* Room number */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-lg font-bold text-gray-800 dark:text-white">{room.roomName}</span>
                        {room.inMaintenance && <Wrench className="w-4 h-4 text-red-500" />}
                        {room.hasCheckinToday && <UserCheck className="w-4 h-4 text-purple-500" />}
                      </div>

                      {/* Status badges */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                          isClean ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200'
                                  : 'bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200'
                        }`}>
                          {room.descriptionHousekeepingStatus}
                        </span>
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                          isOccupied ? 'bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200'
                                     : 'bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200'
                        }`}>
                          {room.currentlyOccupiedOrAvailable}
                        </span>
                      </div>

                      {/* Guest info */}
                      {isOccupied && room.bookingHolderName && (
                        <p className="text-xs text-gray-600 dark:text-gray-300 truncate mb-1" title={room.bookingHolderName}>
                          {room.bookingHolderName}
                        </p>
                      )}
                      {isOccupied && (room.adultCount || room.childrenCount || room.babyCount) && (
                        <p className="text-[11px] text-gray-400">
                          {room.adultCount || 0} ADL {room.childrenCount ? `· ${room.childrenCount} CHD` : ''} {room.babyCount ? `· ${room.babyCount} INF` : ''}
                        </p>
                      )}

                      {/* Toggle status button */}
                      {!room.inMaintenance && (
                        <button
                          onClick={() => handleToggleStatus(room)}
                          disabled={isUpdating}
                          className="mt-2 w-full text-[11px] font-semibold py-1 rounded-md transition-colors disabled:opacity-50
                            bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200"
                        >
                          {isUpdating ? <Loader2 className="w-3 h-3 mx-auto animate-spin" /> : `→ ${isClean ? 'Sujo' : 'Limpo'}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RoomRack;
