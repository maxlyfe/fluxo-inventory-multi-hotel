import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  UtensilsCrossed, Users, Clock, Loader2, Package, CheckCircle, 
  ChefHat, Timer
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { erbonService, ErbonGuest } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { supabase } from '../../lib/supabase';
import { useRealtimeSubscription } from '../../hooks/useRealtime';
import { format, parseISO, differenceInSeconds } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface BreakfastRecord {
  id_guest: number | string;
  status: 'pending' | 'checked_in' | 'kit_requested';
  consumed_at: string | null;
  date: string;
}

const BreakfastKitchen: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [records, setRecords] = useState<Record<string, BreakfastRecord>>({});
  const [config, setConfig] = useState<{ start_time: string, end_time: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 1. Fetch Guests from Erbon (Base for total count)
  const { data: guests, loading: loadingErbon } = useErbonData<ErbonGuest[]>(
    (hotelId) => erbonService.fetchBreakfastGuests(hotelId),
    [],
    { autoRefreshMs: 600_000 } // 10 min refresh for guest list
  );

  // 2. Fetch Initial Records from Supabase
  const loadInitialRecords = useCallback(async () => {
    if (!selectedHotel) return;
    const today = new Date().toISOString().split('T')[0];
    try {
      const { data, error } = await supabase
        .from('breakfast_records')
        .select('*')
        .eq('hotel_id', selectedHotel.id)
        .eq('date', today);
      
      if (error) throw error;

      const map: Record<string, BreakfastRecord> = {};
      data?.forEach(r => { map[String(r.id_guest)] = r; });
      setRecords(map);
    } catch (err) {
      console.error('[BreakfastKitchen] Error loading records:', err);
    }
  }, [selectedHotel]);

  // 3. Fetch Config
  const loadConfig = useCallback(async () => {
    if (!selectedHotel) return;
    try {
      const { data, error } = await supabase
        .from('breakfast_configs')
        .select('start_time, end_time')
        .eq('hotel_id', selectedHotel.id)
        .maybeSingle();
      
      if (error) throw error;
      if (data) setConfig(data);
    } catch (err) {
      console.error('[BreakfastKitchen] Error loading config:', err);
    }
  }, [selectedHotel]);

  useEffect(() => {
    loadInitialRecords();
    loadConfig();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [loadInitialRecords, loadConfig]);

  // 4. Real-time updates - Dashboard updates automatically when hall interacts
  const handleRealtimeUpdate = useCallback((payload: any) => {
    console.log('[BreakfastKitchen] Real-time event received:', payload);
    const today = new Date().toISOString().split('T')[0];
    
    if (payload.eventType === 'DELETE') {
      const oldId = (payload.old as any)?.id_guest;
      if (oldId) {
        setRecords(prev => {
          const newMap = { ...prev };
          delete newMap[oldId];
          return newMap;
        });
        setRefreshTrigger(v => v + 1);
      }
      return;
    }

    // INSERT ou UPDATE
    if (payload.new && payload.new.date === today) {
      setRecords(prev => {
        // Só atualiza se o dado for realmente novo ou diferente para evitar loops
        if (prev[payload.new.id_guest]?.status === payload.new.status) return prev;
        
        return {
          ...prev,
          [payload.new.id_guest]: payload.new as BreakfastRecord
        };
      });
      setRefreshTrigger(v => v + 1);
    }
  }, []);

  useRealtimeSubscription<any>(
    'breakfast_records',
    `hotel_id=eq.${selectedHotel?.id}`,
    handleRealtimeUpdate
  );

  // Fallback Polling - A cada 30 segundos busca dados frescos se o Realtime falhar
  useEffect(() => {
    const pollInterval = setInterval(() => {
      console.log('[BreakfastKitchen] Polling for fresh data...');
      loadInitialRecords();
    }, 30000);
    return () => clearInterval(pollInterval);
  }, [loadInitialRecords]);

  // 5. Calculations
  const stats = useMemo(() => {
    const totalErbon = guests?.length || 0;
    // Contar visitantes (Day Use) que estão nos records
    const dayUseCount = Object.values(records).filter(r => String(r.id_guest).startsWith('DU-')).length;
    const total = totalErbon + dayUseCount;
    
    const recordList = Object.values(records);
    const ate = recordList.filter(r => r.status === 'checked_in').length;
    const kits = recordList.filter(r => r.status === 'kit_requested').length;
    const pending = Math.max(0, total - ate - kits);
    const progress = total > 0 ? Math.round(((ate + kits) / total) * 100) : 0;

    return { total, ate, kits, pending, progress };
  }, [guests, records, refreshTrigger]);

  // 6. Timers
  const timerInfo = useMemo(() => {
    if (!config) return null;
    
    const todayStr = format(currentTime, 'yyyy-MM-dd');
    const start = parseISO(`${todayStr}T${config.start_time}`);
    const end = parseISO(`${todayStr}T${config.end_time}`);

    if (currentTime < start) {
      const diff = differenceInSeconds(start, currentTime);
      return { label: 'INÍCIO EM', color: 'text-amber-500', seconds: diff };
    } else if (currentTime < end) {
      const diff = differenceInSeconds(end, currentTime);
      return { label: 'ENCERRA EM', color: 'text-emerald-500', seconds: diff };
    } else {
      return { label: 'ENCERRADO', color: 'text-rose-500', seconds: 0 };
    }
  }, [config, currentTime]);

  const formatSeconds = (s: number) => {
    if (s <= 0) return '00:00:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 md:p-12 flex flex-col justify-center">
      {/* Header */}
      <div className="flex items-center justify-between mb-12">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-3xl bg-sky-600 flex items-center justify-center shadow-2xl shadow-sky-500/20">
            <ChefHat className="w-12 h-12 text-white" />
          </div>
          <div>
            <h1 className="text-5xl font-black text-gray-900 dark:text-white tracking-tighter uppercase">COZINHA — CAFÉ DA MANHÃ</h1>
            <p className="text-2xl font-bold text-gray-500 dark:text-gray-400 mt-2">
              {selectedHotel?.name} · {format(currentTime, "eeee, d 'de' MMMM", { locale: ptBR }).toUpperCase()}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 px-10 py-6 rounded-[2.5rem] border border-gray-100 dark:border-gray-800 shadow-2xl flex items-center gap-8">
          <div className="flex flex-col items-end">
            <span className="text-sm font-black text-gray-400 tracking-[0.2em]">{timerInfo?.label || 'AGUARDANDO'}</span>
            <span className={`text-6xl font-mono font-black tabular-nums ${timerInfo?.color || 'text-gray-300'}`}>
              {timerInfo && timerInfo.seconds > 0 ? formatSeconds(timerInfo.seconds) : '--:--:--'}
            </span>
          </div>
          <div className="w-16 h-16 rounded-3xl bg-gray-50 dark:bg-gray-800 flex items-center justify-center">
            <Timer className={`w-8 h-8 ${timerInfo?.color || 'text-gray-300'}`} />
          </div>
        </div>
      </div>

      {/* Main Stats Grid - Huge cards for TV display */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        
        {/* Total Card */}
        <div className="bg-white dark:bg-gray-900 rounded-[3rem] p-12 border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-3xl bg-sky-50 dark:bg-sky-900/10 flex items-center justify-center mb-6">
            <Users className="w-10 h-10 text-sky-500" />
          </div>
          <p className="text-lg font-black text-gray-400 uppercase tracking-widest mb-4">Total de Hóspedes</p>
          <p className="text-9xl font-black text-gray-900 dark:text-white tabular-nums">{stats.total}</p>
        </div>

        {/* Ate Card */}
        <div className="bg-white dark:bg-gray-900 rounded-[3rem] p-12 border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-3xl bg-emerald-50 dark:bg-emerald-900/10 flex items-center justify-center mb-6">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
          </div>
          <p className="text-lg font-black text-gray-400 uppercase tracking-widest mb-4">Já Tomaram Café</p>
          <div className="flex flex-col items-center">
            <p className="text-9xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.ate}</p>
            <span className="text-2xl font-black text-emerald-600/50 mt-2">{stats.progress}% CONCLUÍDO</span>
          </div>
        </div>

        {/* Pending Card - Focus Point */}
        <div className="bg-sky-600 rounded-[3rem] p-12 border border-sky-500 shadow-2xl shadow-sky-500/20 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-3xl bg-white/10 flex items-center justify-center mb-6">
            <UtensilsCrossed className="w-10 h-10 text-white" />
          </div>
          <p className="text-lg font-black text-white/70 uppercase tracking-widest mb-4">Pendentes de Café</p>
          <p className="text-9xl font-black text-white tabular-nums">{stats.pending}</p>
        </div>

        {/* Kits Card */}
        <div className="bg-white dark:bg-gray-900 rounded-[3rem] p-12 border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-3xl bg-amber-50 dark:bg-amber-900/10 flex items-center justify-center mb-6">
            <Package className="w-10 h-10 text-amber-500" />
          </div>
          <p className="text-lg font-black text-gray-400 uppercase tracking-widest mb-4">Kits Entregues</p>
          <p className="text-9xl font-black text-amber-600 dark:text-amber-400 tabular-nums">{stats.kits}</p>
        </div>

      </div>

      {/* Footer message */}
      <div className="mt-16 text-center">
        <p className="text-gray-400 dark:text-gray-500 text-xl font-medium animate-pulse uppercase">
          Atualização em tempo real · Aguardando interações do salão
        </p>
      </div>

      {loadingErbon && (
        <div className="fixed bottom-8 right-8 bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-gray-100 dark:border-gray-800">
          <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
          <span className="text-sm font-bold text-gray-500">Sincronizando com Erbon...</span>
        </div>
      )}
    </div>
  );
};

export default BreakfastKitchen;
