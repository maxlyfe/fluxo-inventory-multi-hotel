import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Coffee, Users, Search, RefreshCw, Loader2, CheckCircle, 
  Package, Clock, AlertCircle, LogIn, UtensilsCrossed,
  ChevronDown, ChevronUp, UserPlus, X, Plus, Sun, Moon, Utensils
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { erbonService, ErbonGuest } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import { supabase } from '../../lib/supabase';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

interface BreakfastRecord {
  id_guest: number | string;
  status: 'pending' | 'checked_in' | 'kit_requested';
  consumed_at: string | null;
  guest_name: string;
  room_number: string;
  meal_type: 'breakfast' | 'map' | 'fap';
}

type MealType = 'breakfast' | 'map' | 'fap';

const BreakfastHall: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [activeMeal, setActiveMeal] = useState<MealType>('breakfast');
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<number | string | null>(null);
  const [records, setRecords] = useState<Record<string, BreakfastRecord>>({});
  const [config, setConfig] = useState<any>(null);
  const [showHistory, setShowHistory] = useState(false);
  
  // Day Use Modal State
  const [isDayUseModalOpen, setIsDayUseModalOpen] = useState(false);
  const [dayUseName, setDayUseName] = useState('');
  const [isSavingDayUse, setIsSavingDayUse] = useState(false);

  // 1. Fetch Guests from Erbon
  const { data: allGuests, loading: loadingErbon, error: erbonError, refetch, erbonConfigured } = useErbonData<ErbonGuest[]>(
    (hotelId) => erbonService.fetchBreakfastGuests(hotelId),
    [],
    { autoRefreshMs: 300_000 }
  );

  // Filtrar hóspedes baseado no plano de refeição
  const guests = useMemo(() => {
    if (!allGuests) return [];
    if (activeMeal === 'breakfast') return allGuests;
    
    // DEBUG: Logar o que estamos recebendo do Erbon
    console.log('[BreakfastHall] guests meal plans:', JSON.stringify(allGuests.map(g => ({ name: g.guestName, plan: g.mealPlan }))));
    
    return allGuests.filter(g => {
      const plan = (g.mealPlan || '').toUpperCase();
      
      // Ajuste: verificar se o plano contém a sigla, tratando casos como 'MAP-PENSÃO' ou 'FAP'
      if (activeMeal === 'map') return plan.includes('MAP') || plan.includes('FAP');
      if (activeMeal === 'fap') return plan.includes('FAP');
      
      return true;
    });
  }, [allGuests, activeMeal]);

  // 2. Fetch Records from Supabase for Today
  const loadRecords = useCallback(async () => {
    if (!selectedHotel) return;
    const today = new Date().toISOString().split('T')[0];
    
    try {
      const { data, error } = await supabase
        .from('breakfast_records')
        .select('*')
        .eq('hotel_id', selectedHotel.id)
        .eq('date', today)
        .eq('meal_type', activeMeal);

      if (error) throw error;
      
      const recordsMap: Record<string, BreakfastRecord> = {};
      data?.forEach(r => {
        recordsMap[String(r.id_guest)] = r as BreakfastRecord;
      });
      setRecords(recordsMap);
    } catch (err) {
      console.error('[BreakfastHall] Error loading records:', err);
    }
  }, [selectedHotel, activeMeal]);

  // 3. Fetch Config
  const loadConfig = useCallback(async () => {
    if (!selectedHotel) return;
    try {
      const { data } = await supabase
        .from('breakfast_configs')
        .select('*')
        .eq('hotel_id', selectedHotel.id)
        .maybeSingle();
      if (data) setConfig(data);
    } catch {}
  }, [selectedHotel]);

  useEffect(() => {
    loadRecords();
    loadConfig();
  }, [loadRecords, loadConfig]);

  // 4. Update Status (Check-in or Kit)
  const handleStatusChange = async (guestId: number | string, guestData: Partial<ErbonGuest>, newStatus: 'pending' | 'checked_in' | 'kit_requested') => {
    if (!selectedHotel || updatingId) return;
    
    setUpdatingId(guestId);
    const today = new Date().toISOString().split('T')[0];
    const consumedAt = newStatus === 'checked_in' ? new Date().toISOString() : null;

    try {
      if (newStatus === 'pending') {
        const { error } = await supabase
          .from('breakfast_records')
          .update({ status: 'pending', consumed_at: null, updated_at: new Date().toISOString() })
          .eq('hotel_id', selectedHotel.id)
          .eq('date', today)
          .eq('id_guest', guestId)
          .eq('meal_type', activeMeal);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('breakfast_records')
          .upsert({
            hotel_id: selectedHotel.id,
            date: today,
            id_booking: guestData.idBooking || 0,
            id_guest: guestId,
            guest_name: guestData.guestName || guestData.guestName,
            room_number: guestData.roomDescription || 'DAY USE',
            status: newStatus,
            consumed_at: consumedAt,
            meal_type: activeMeal,
            updated_at: new Date().toISOString()
          }, { onConflict: 'hotel_id,date,id_guest,meal_type' });

        if (error) throw error;
      }
      
      await loadRecords();
    } catch (err: any) {
      alert('Erro ao atualizar status: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  // 5. Add Day Use (Registering a visitor in 'pending' status)
  const handleAddDayUse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHotel || isSavingDayUse || !dayUseName.trim()) return;
    setIsSavingDayUse(true);
    
    const today = new Date().toISOString().split('T')[0];
    const tempId = `DU-${Date.now()}`;

    try {
      const { error } = await supabase
        .from('breakfast_records')
        .insert({
          hotel_id: selectedHotel.id,
          date: today,
          id_booking: 0,
          id_guest: tempId,
          guest_name: dayUseName.trim(),
          room_number: 'DAY USE',
          status: 'pending',
          meal_type: activeMeal,
          adults: 1,
          children: 0
        });

      if (error) throw error;
      
      setDayUseName('');
      setIsDayUseModalOpen(false);
      await loadRecords();
    } catch (err: any) {
      alert('Erro ao registrar Day Use: ' + err.message);
    } finally {
      setIsSavingDayUse(false);
    }
  };

  // 6. Filter and Separate Guests
  const { pendingList, completedList } = useMemo(() => {
    const pending: any[] = [];
    const completed: any[] = [];

    // Erbon Guests
    guests?.forEach(g => {
      const record = records[String(g.idGuest)];
      const item = { ...g, record };
      
      if (!record || record.status === 'pending') {
        pending.push(item);
      } else {
        completed.push(item);
      }
    });

    // Day Use Records
    Object.values(records).forEach(r => {
      if (String(r.id_guest).startsWith('DU-')) {
        const item = {
          idGuest: r.id_guest,
          guestName: r.guest_name,
          roomDescription: 'DAY USE',
          bookingNumber: 'RES-DU',
          mealPlan: 'Extra / Day Use',
          record: r
        };
        if (r.status === 'pending') pending.push(item);
        else completed.push(item);
      }
    });

    const filterFn = (item: any) => {
      const q = search.toLowerCase();
      return (
        item.guestName?.toLowerCase().includes(q) ||
        String(item.roomDescription)?.toLowerCase().includes(q)
      );
    };

    return {
      pendingList: pending.filter(filterFn).sort((a, b) => (a.roomDescription || '').localeCompare(b.roomDescription || '')),
      completedList: completed.filter(filterFn).sort((a, b) => (b.record?.consumed_at || '').localeCompare(a.record?.consumed_at || ''))
    };
  }, [guests, records, search]);

  const stats = useMemo(() => {
    const totalErbon = guests?.length || 0;
    const dayUseCount = Object.values(records).filter(r => String(r.id_guest).startsWith('DU-')).length;
    const total = totalErbon + dayUseCount;
    
    const ate = Object.values(records).filter(r => r.status === 'checked_in').length;
    const kits = Object.values(records).filter(r => r.status === 'kit_requested').length;
    return { total, ate, kits, pending: total - ate - kits };
  }, [guests, records]);

  // Determinar horários exibidos
  const displayTimeRange = useMemo(() => {
    if (!config) return 'Horário não configurado';
    if (activeMeal === 'breakfast') return `${config.start_time.substring(0, 5)} às ${config.end_time.substring(0, 5)}`;
    if (activeMeal === 'map') return `${(config.lunch_start_time || '12:00').substring(0, 5)} às ${(config.lunch_end_time || '14:30').substring(0, 5)}`;
    if (activeMeal === 'fap') return `${(config.dinner_start_time || '19:00').substring(0, 5)} às ${(config.dinner_end_time || '22:00').substring(0, 5)}`;
    return '';
  }, [config, activeMeal]);

  if (!erbonConfigured && !loadingErbon) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  const mealStyles = {
    breakfast: {
      color: 'orange',
      bgLight: 'bg-orange-100 dark:bg-orange-900/30',
      text: 'text-orange-600',
      btn: 'bg-orange-500 hover:bg-orange-600 shadow-orange-200'
    },
    map: {
      color: 'amber',
      bgLight: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-600',
      btn: 'bg-amber-500 hover:bg-amber-600 shadow-amber-200'
    },
    fap: {
      color: 'purple',
      bgLight: 'bg-purple-100 dark:bg-purple-900/30',
      text: 'text-purple-600',
      btn: 'bg-purple-500 hover:bg-purple-600 shadow-purple-200'
    }
  };

  const currentStyle = mealStyles[activeMeal];
  const mealIcon = activeMeal === 'breakfast' ? <Coffee className={`w-5 h-5 ${currentStyle.text}`} /> : 
                   activeMeal === 'map' ? <Sun className={`w-5 h-5 ${currentStyle.text}`} /> : 
                   <Moon className={`w-5 h-5 ${currentStyle.text}`} />;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-10 h-10 rounded-xl ${currentStyle.bgLight} flex items-center justify-center`}>
              {mealIcon}
            </div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Checklist {activeMeal === 'breakfast' ? 'Salão' : activeMeal === 'map' ? 'Almoço' : 'Jantar'}</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 font-medium">
            <Clock className="w-4 h-4" />
            {displayTimeRange}
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
            <button onClick={() => setActiveMeal('breakfast')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeMeal === 'breakfast' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>CAFÉ</button>
            <button onClick={() => setActiveMeal('map')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeMeal === 'map' ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>ALMOÇO</button>
            <button onClick={() => setActiveMeal('fap')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeMeal === 'fap' ? 'bg-purple-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>JANTAR</button>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsDayUseModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-xl hover:bg-sky-700 transition font-bold text-sm shadow-lg shadow-sky-200 dark:shadow-none"
            >
              <UserPlus className="w-4 h-4" />
              Registrar Visitante
            </button>
            <button 
              onClick={() => { refetch(); loadRecords(); }}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition font-medium text-sm shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${(loadingErbon) ? 'animate-spin' : ''}`} />
              Sincronizar
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
          <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Total {activeMeal === 'breakfast' ? 'Hóspedes' : 'MAP/FAP'}</p>
          <p className="text-2xl font-black text-gray-800 dark:text-white">{stats.total}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/20 shadow-sm text-center">
          <p className="text-[10px] uppercase font-bold text-emerald-500 mb-1">Entradas</p>
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{stats.ate}</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/10 p-4 rounded-2xl border border-amber-100 dark:border-amber-900/20 shadow-sm text-center">
          <p className="text-[10px] uppercase font-bold text-amber-500 mb-1">Kits/Extras</p>
          <p className="text-2xl font-black text-amber-700 dark:text-amber-400">{stats.kits}</p>
        </div>
        <div className="bg-sky-50 dark:bg-sky-900/10 p-4 rounded-2xl border border-sky-100 dark:border-sky-900/20 shadow-sm text-center">
          <p className="text-[10px] uppercase font-bold text-sky-500 mb-1">Pendentes</p>
          <p className="text-2xl font-black text-sky-700 dark:text-sky-400">{stats.pending}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar hóspede ou UH..."
          className="w-full pl-12 pr-4 py-3.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-gray-800 dark:text-white outline-none shadow-sm focus:ring-2 focus:ring-orange-500 transition-all"
        />
      </div>

      {/* Pending List */}
      <div className="space-y-3">
        <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest px-1">Aguardando</h2>
        {loadingErbon && pendingList.length === 0 ? (
          <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
        ) : pendingList.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-8 text-center text-gray-400">
            <Utensils className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p className="font-medium">Ninguém pendente</p>
          </div>
        ) : (
          pendingList.map(guest => (
            <GuestCard 
              key={guest.idGuest} 
              guest={guest} 
              isUpdating={updatingId === guest.idGuest}
              activeMeal={activeMeal}
              onUpdate={(status) => handleStatusChange(guest.idGuest, guest, status)}
            />
          ))
        )}
      </div>

      {/* Completed History */}
      <div className="mt-12">
        <button 
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-sm font-black text-gray-400 uppercase tracking-widest px-1 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        >
          {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Histórico ({completedList.length})
        </button>
        
        {showHistory && (
          <div className="mt-4 space-y-3">
            {completedList.length === 0 ? (
              <p className="text-center py-6 text-gray-400 italic text-sm">Nenhum registro ainda</p>
            ) : (
              completedList.map(guest => (
                <GuestCard 
                  key={guest.idGuest} 
                  guest={guest} 
                  isUpdating={updatingId === guest.idGuest}
                  activeMeal={activeMeal}
                  onUpdate={(status) => handleStatusChange(guest.idGuest, guest, status)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Day Use Modal */}
      {isDayUseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-black text-gray-800 dark:text-white">Novo Visitante</h2>
              <button onClick={() => setIsDayUseModalOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition text-gray-400"><X className="w-6 h-6" /></button>
            </div>
            <form onSubmit={handleAddDayUse} className="p-8 space-y-6">
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Nome do Visitante</label>
                <input 
                  type="text" 
                  autoFocus
                  required
                  value={dayUseName}
                  onChange={e => setDayUseName(e.target.value)}
                  placeholder="Digite o nome completo"
                  className="w-full px-5 py-4 rounded-2xl bg-gray-50 dark:bg-gray-900 border-none outline-none focus:ring-2 focus:ring-sky-500 text-gray-800 dark:text-white font-medium"
                />
                <p className="mt-2 text-[10px] text-gray-400 font-medium">O visitante será adicionado à lista atual de <strong>{activeMeal === 'breakfast' ? 'Café' : activeMeal === 'map' ? 'Almoço' : 'Jantar'}</strong>.</p>
              </div>
              <button 
                type="submit"
                disabled={isSavingDayUse || !dayUseName.trim()}
                className="w-full py-5 bg-sky-600 hover:bg-sky-700 text-white rounded-[2rem] font-black text-lg transition-all shadow-xl shadow-sky-200 dark:shadow-none flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isSavingDayUse ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
                RESERVAR ENTRADA
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface GuestCardProps {
  guest: any;
  isUpdating: boolean;
  activeMeal: MealType;
  onUpdate: (status: 'pending' | 'checked_in' | 'kit_requested') => void;
}

const GuestCard: React.FC<GuestCardProps> = ({ guest, isUpdating, activeMeal, onUpdate }) => {
  const status = guest.record?.status || 'pending';
  const [showFullNames, setShowFullNames] = useState(false);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  const startPress = () => {
    timerRef.current = setTimeout(() => {
      setShowFullNames(true);
      if (window.navigator.vibrate) window.navigator.vibrate(50);
    }, 1000);
  };

  const endPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const buttonColor = activeMeal === 'breakfast' ? 'orange' : activeMeal === 'map' ? 'amber' : 'purple';

  return (
    <>
      <div className={`bg-white dark:bg-gray-800 rounded-2xl border transition-all shadow-sm ${
        status === 'checked_in' ? 'border-emerald-200 dark:border-emerald-800/40 opacity-70' :
        status === 'kit_requested' ? 'border-amber-200 dark:border-amber-800/40 opacity-70' :
        'border-gray-100 dark:border-gray-700 hover:border-sky-200'
      }`}>
        <div className="p-3 md:p-4 flex items-center gap-3 md:gap-4">
          {/* Room Box */}
          <div className={`w-12 h-12 md:w-14 md:h-14 rounded-xl flex flex-col items-center justify-center flex-shrink-0 shadow-sm ${
            status === 'checked_in' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
            status === 'kit_requested' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
            'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
          }`}>
            <span className="text-[8px] md:text-[10px] uppercase font-black opacity-50 leading-none mb-0.5 md:mb-1">UH</span>
            <span className="text-base md:text-lg font-black leading-none">{guest.roomDescription}</span>
          </div>

          {/* Info */}
          <div 
            className="flex-1 min-w-0 cursor-help"
            onTouchStart={startPress}
            onTouchEnd={endPress}
            onMouseDown={startPress}
            onMouseUp={endPress}
            onMouseLeave={endPress}
          >
            <h3 className="font-bold text-gray-800 dark:text-white truncate text-sm md:text-base">{guest.guestName}</h3>
            <p className="text-[9px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest">{guest.mealPlan}</p>
            {guest.record?.consumed_at && (
              <p className="text-[9px] md:text-[10px] font-bold text-emerald-600 mt-0.5 md:mt-1 uppercase">Entrada às {format(parseISO(guest.record.consumed_at), 'HH:mm')}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 md:gap-2">
            {status === 'pending' ? (
              <>
                <button
                  onClick={() => onUpdate('kit_requested')}
                  disabled={isUpdating}
                  className="w-10 h-10 md:w-12 md:h-12 rounded-xl border border-amber-200 dark:border-amber-800/50 flex items-center justify-center text-amber-600 dark:text-amber-400 hover:bg-amber-50"
                  title="Solicitar Kit / Extra"
                >
                  {isUpdating ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <Package className="w-4 h-4 md:w-5 md:h-5" />}
                </button>
                <button
                  onClick={() => onUpdate('checked_in')}
                  disabled={isUpdating}
                  className={`px-4 md:px-6 h-10 md:h-12 rounded-xl bg-${buttonColor}-600 hover:bg-${buttonColor}-700 text-white font-black text-xs md:text-sm transition-all flex items-center gap-1.5 md:gap-2 shadow-lg shadow-${buttonColor}-200 dark:shadow-none`}
                >
                  {isUpdating ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" /> : <LogIn className="w-3.5 h-3.5 md:w-4 md:h-4" />}
                  <span className="hidden xs:inline">ENTRADA</span>
                  <span className="xs:hidden">IN</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => onUpdate('pending')}
                disabled={isUpdating}
                className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-1.5 md:py-2 rounded-xl border font-bold text-[10px] md:text-xs ${
                  status === 'checked_in' ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 text-emerald-700' :
                  'bg-amber-50 dark:bg-amber-900/10 border-amber-200 text-amber-700'
                }`}
              >
                {isUpdating ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" /> : <UtensilsCrossed className="w-3.5 h-3.5 md:w-4 md:h-4 rotate-45" />}
                <span className="hidden xs:inline">REVERTER</span>
                <span className="xs:hidden">REV</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Full Name Modal (Overlay) */}
      {showFullNames && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setShowFullNames(false)}
        >
          <div className="bg-white dark:bg-gray-800 p-8 rounded-[2rem] shadow-2xl border border-white/20 text-center max-w-sm w-full transform animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className={`w-16 h-16 bg-${buttonColor}-100 dark:bg-${buttonColor}-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6 text-${buttonColor}-600 dark:text-${buttonColor}-400`}>
              <Users className="w-8 h-8" />
            </div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">Nome Completo</p>
            <h2 className="text-2xl font-black text-gray-900 dark:text-white leading-tight mb-4">
              {guest.guestName}
            </h2>
            <div className="flex items-center justify-center gap-4 py-3 border-y border-gray-100 dark:border-gray-700">
              <div className="text-center">
                <p className="text-[9px] font-bold text-gray-400 uppercase">UH</p>
                <p className="font-black text-gray-800 dark:text-white">{guest.roomDescription}</p>
              </div>
              <div className="w-px h-8 bg-gray-100 dark:bg-gray-700" />
              <div className="text-center">
                <p className="text-[9px] font-bold text-gray-400 uppercase">Reserva</p>
                <p className="font-black text-gray-800 dark:text-white">{guest.bookingNumber}</p>
              </div>
            </div>
            <button 
              className="mt-8 w-full py-4 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white rounded-xl font-bold"
              onClick={() => setShowFullNames(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default BreakfastHall;
