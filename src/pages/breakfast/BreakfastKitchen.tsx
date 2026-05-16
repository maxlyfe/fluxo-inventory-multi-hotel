import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  UtensilsCrossed, Users, Loader2, Package, CheckCircle,
  ChefHat, Timer, Clock, Settings, ArrowLeft, Sun, Moon, Utensils
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { erbonService, ErbonGuest } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { supabase } from '../../lib/supabase';
import { useRealtimeSubscription } from '../../hooks/useRealtime';
import { format, parseISO, differenceInSeconds, addMinutes, isAfter, isBefore } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface BreakfastRecord {
  id_guest: number | string;
  status: 'pending' | 'checked_in' | 'kit_requested';
  consumed_at: string | null;
  date: string;
  meal_type: 'breakfast' | 'map' | 'fap';
}

interface FullConfig {
  start_time: string;
  end_time: string;
  lunch_start_time: string;
  lunch_end_time: string;
  dinner_start_time: string;
  dinner_end_time: string;
  clock_transition_minutes: number;
}

type MealType = 'breakfast' | 'map' | 'fap';

// ─── helpers ────────────────────────────────────────────────────────────────

const formatSeconds = (s: number) => {
  if (s <= 0) return '00:00:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

// ─── component ───────────────────────────────────────────────────────────────

const BreakfastKitchen: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [records, setRecords] = useState<Record<string, BreakfastRecord>>({});
  const [allRecords, setAllRecords] = useState<any[]>([]);
  const [config, setConfig] = useState<FullConfig | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeMeal, setActiveMeal] = useState<MealType>('breakfast');
  const [showClockOnly, setShowClockOnly] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);

  // ── data: guests from Erbon (In-House + Arrivals) ────────────────────────
  const { data: allGuests, loading: loadingErbon } = useErbonData<ErbonGuest[]>(
    (hotelId) => erbonService.fetchHallGuests(hotelId),
    [],
    { autoRefreshMs: 600_000 },
  );

  // Identificar tipo de pensão
  const getPensionType = (g: ErbonGuest): 'CM' | 'MAP' | 'FAP' | 'RO' => {
    const plan = (g.mealPlan || '').toUpperCase();
    if (plan.includes('FAP') || plan.includes('FB') || plan.includes('COMPLETA')) return 'FAP';
    if (plan.includes('MAP') || plan.includes('HB') || plan.includes('MEIA')) return 'MAP';
    if (plan.includes('BB') || plan.includes('CAFÉ') || plan.includes('BREAKFAST')) return 'CM';
    return 'RO';
  };

  // Filtrar hóspedes baseado no plano de refeição e na lógica de migração MAP
  const filteredGuests = useMemo(() => {
    if (!allGuests) return [];
    
    return allGuests.filter(g => {
      const type = getPensionType(g);
      
      // CAFÉ: Todos que tem algum plano de refeição (BB, MAP, FAP)
      if (activeMeal === 'breakfast') {
        return type === 'CM' || type === 'MAP' || type === 'FAP';
      }
      
      // ALMOÇO: MAP e FAP
      if (activeMeal === 'map') {
        return type === 'MAP' || type === 'FAP';
      }
      
      // JANTAR: FAP sempre. MAP somente se NÃO almoçou hoje.
      if (activeMeal === 'fap') {
        if (type === 'FAP') return true;
        if (type === 'MAP') {
          // Lógica de Migração: Verificar se almoçou hoje
          const hadLunch = allRecords.some(r => 
            String(r.id_guest) === String(g.idGuest) && 
            r.meal_type === 'map' && 
            (r.status === 'checked_in' || r.status === 'kit_requested')
          );
          return !hadLunch;
        }
      }
      
      return false;
    });
  }, [allGuests, activeMeal, allRecords]);

  // ── data: records ──────────────────────────────────────────────
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
      
      setAllRecords(data || []);

      const map: Record<string, BreakfastRecord> = {};
      data?.filter(r => r.meal_type === activeMeal).forEach((r) => { 
        map[String(r.id_guest)] = r; 
      });
      setRecords(map);
    } catch (err) {
      console.error('[BreakfastKitchen] Error loading records:', err);
    }
  }, [selectedHotel, activeMeal]);

  // ── data: config ─────────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    if (!selectedHotel) return;
    try {
      const { data, error } = await supabase
        .from('breakfast_configs')
        .select('*')
        .eq('hotel_id', selectedHotel.id)
        .maybeSingle();
      if (error) throw error;
      if (data) setConfig(data as FullConfig);
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

  // ── logic: auto-clock and auto-meal detection ───────────────────────────
  useEffect(() => {
    // Se o usuário interagiu manualmente, não fazemos NADA nessa função de auto-toggle.
    if (!config || manualOverride) return;

    const todayStr = format(currentTime, 'yyyy-MM-dd');
    const transitionMs = (config.clock_transition_minutes || 30) * 60 * 1000;

    const meals = [
      { type: 'breakfast', end: config.end_time ? `${todayStr}T${config.end_time}` : null },
      { type: 'map', end: config.lunch_end_time ? `${todayStr}T${config.lunch_end_time}` : null },
      { type: 'fap', end: config.dinner_end_time ? `${todayStr}T${config.dinner_end_time}` : null }
    ];

    let shouldShowClock = true;
    for (const m of meals) {
      if (!m.end) continue;
      const endTime = parseISO(m.end);
      if (isNaN(endTime.getTime())) continue;

      const transitionTime = new Date(endTime.getTime() + transitionMs);
      
      // Se estamos na janela ativa, não mostra o relógio
      if (isBefore(currentTime, transitionTime) && isAfter(currentTime, addMinutes(endTime, -240))) {
        shouldShowClock = false;
        break;
      }
    }
    
    if (showClockOnly !== shouldShowClock) {
      setShowClockOnly(shouldShowClock);
    }
  }, [config, currentTime, manualOverride]); // Removi showClockOnly desta dependência para não causar loops estranhos.

  // Event handler para clicar no relógio (fullscreen)
  const handleToggleFullscreen = () => {
    setManualOverride(true);
    setShowClockOnly(true);
  };

  // Event handler para sair do relógio
  const handleExitFullscreen = () => {
    setManualOverride(true); // O usuário agora está no controle, mantém override
    setShowClockOnly(false);
  };

  // ── realtime ─────────────────────────────────────────────────────────────
  const handleRealtimeUpdate = useCallback((payload: any) => {
    const today = new Date().toISOString().split('T')[0];
    if (payload.eventType === 'DELETE') {
      const oldId = (payload.old as any)?.id_guest;
      if (oldId) {
        setRecords((prev) => { const m = { ...prev }; delete m[oldId]; return m; });
      }
      return;
    }
    if (payload.new && payload.new.date === today && payload.new.meal_type === activeMeal) {
      setRecords((prev) => {
        if (prev[payload.new.id_guest]?.status === payload.new.status) return prev;
        return { ...prev, [payload.new.id_guest]: payload.new as BreakfastRecord };
      });
    }
  }, [activeMeal]);

  useRealtimeSubscription<any>(
    'breakfast_records',
    `hotel_id=eq.${selectedHotel?.id}`,
    handleRealtimeUpdate,
  );

  useEffect(() => {
    const poll = setInterval(() => loadInitialRecords(), 30_000);
    return () => clearInterval(poll);
  }, [loadInitialRecords]);

  // ── stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalErbon = filteredGuests?.length || 0;
    const dayUseCount = Object.values(records).filter((r) => String(r.id_guest).startsWith('DU-')).length;
    const total = totalErbon + dayUseCount;
    const recordList = Object.values(records);
    const ate = recordList.filter((r) => r.status === 'checked_in').length;
    const kits = recordList.filter((r) => r.status === 'kit_requested').length;
    const pending = Math.max(0, total - ate - kits);
    const progress = total > 0 ? Math.round(((ate + kits) / total) * 100) : 0;
    return { total, ate, kits, pending, progress };
  }, [filteredGuests, records]);

  // ── timer info ────────────────────────────────────────────────────────────
  const timerInfo = useMemo(() => {
    if (!config) return null;
    const todayStr = format(currentTime, 'yyyy-MM-dd');
    
    let startTimeStr = config.start_time;
    let endTimeStr = config.end_time;
    
    if (activeMeal === 'map') { startTimeStr = config.lunch_start_time; endTimeStr = config.lunch_end_time; }
    if (activeMeal === 'fap') { startTimeStr = config.dinner_start_time; endTimeStr = config.dinner_end_time; }

    const start = parseISO(`${todayStr}T${startTimeStr}`);
    const end = parseISO(`${todayStr}T${endTimeStr}`);
    
    if (currentTime < start) {
      return { label: 'INÍCIO EM', colorClass: 'text-amber-400', seconds: differenceInSeconds(start, currentTime) };
    } else if (currentTime < end) {
      return { label: 'ENCERRA EM', colorClass: 'text-emerald-400', seconds: differenceInSeconds(end, currentTime) };
    }
    return { label: 'ENCERRADO', colorClass: 'text-rose-400', seconds: 0 };
  }, [config, currentTime, activeMeal]);

  // ─────────────────────────────────────────────────────────────────────────
  // CLOCK ONLY VIEW
  // ─────────────────────────────────────────────────────────────────────────
  if (showClockOnly) {
    return (
      <div className="h-screen w-screen bg-black flex flex-col items-center justify-center text-white p-10 select-none">
        <div className="text-[25vw] font-black font-mono leading-none tracking-tighter">
          {format(currentTime, 'HH:mm')}
        </div>
        <div className="text-[5vw] font-bold text-gray-500 uppercase tracking-[1em] -mt-4">
          {format(currentTime, 'ss')}
        </div>
        <div className="text-[3vw] font-semibold text-sky-500 mt-10 uppercase tracking-widest">
          {format(currentTime, "eeee, d 'de' MMMM", { locale: ptBR })}
        </div>
        <button 
          onClick={handleExitFullscreen}
          className="absolute bottom-10 right-10 p-6 bg-gray-900/50 hover:bg-gray-800 rounded-full transition-all group shadow-2xl border border-white/5"
        >
          <ArrowLeft className="w-10 h-10 text-gray-400 group-hover:text-white" />
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — locked to viewport, TV-optimised
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="h-screen w-screen overflow-hidden bg-gray-950 text-white flex flex-col select-none"
      style={{ padding: '2vh 2.5vw', gap: '2vh' }}
    >

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between shrink-0" style={{ gap: '2vw' }}>

        {/* Left: logo + title */}
        <div className="flex items-center" style={{ gap: '1.5vw' }}>
          <div
            className={`rounded-2xl flex items-center justify-center shrink-0 ${
              activeMeal === 'breakfast' ? 'bg-sky-600' : activeMeal === 'map' ? 'bg-orange-600' : 'bg-purple-600'
            }`}
            style={{ width: 'clamp(48px,5vw,80px)', height: 'clamp(48px,5vw,80px)' }}
          >
            {activeMeal === 'breakfast' ? <ChefHat style={{ width: 'clamp(28px,3vw,48px)' }} /> : 
             activeMeal === 'map' ? <Sun style={{ width: 'clamp(28px,3vw,48px)' }} /> : 
             <Moon style={{ width: 'clamp(28px,3vw,48px)' }} />}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1
                className="font-black uppercase tracking-tight text-white leading-none"
                style={{ fontSize: 'clamp(1.25rem,2.5vw,3rem)' }}
              >
                COZINHA — {activeMeal === 'breakfast' ? 'CAFÉ DA MANHÃ' : activeMeal === 'map' ? 'ALMOÇO (MAP/FAP)' : 'JANTAR (FAP)'}
              </h1>
              <div className="flex gap-1">
                <button onClick={() => setActiveMeal('breakfast')} className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${activeMeal === 'breakfast' ? 'bg-sky-500 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}>CAFÉ</button>
                <button onClick={() => setActiveMeal('map')} className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${activeMeal === 'map' ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}>ALMOÇO</button>
                <button onClick={() => setActiveMeal('fap')} className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${activeMeal === 'fap' ? 'bg-purple-500 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}>JANTAR</button>
              </div>
            </div>
            <p
              className="font-semibold text-gray-400 mt-1"
              style={{ fontSize: 'clamp(0.75rem,1.2vw,1.25rem)' }}
            >
              {selectedHotel?.name} &middot;{' '}
              {format(currentTime, "eeee, d 'de' MMMM", { locale: ptBR }).toUpperCase()}
            </p>
          </div>
        </div>

        {/* Center: clock */}
        <div 
          className="flex flex-col items-center shrink-0 cursor-pointer group"
          onClick={handleToggleFullscreen}
        >
          <div className="flex items-center gap-2 group-hover:scale-110 transition-transform">
            <Clock
              className="text-sky-400"
              style={{ width: 'clamp(18px,2vw,32px)', height: 'clamp(18px,2vw,32px)' }}
            />
            <span
              className="font-mono font-black tabular-nums text-white leading-none"
              style={{ fontSize: 'clamp(2rem,5.5vw,7rem)' }}
            >
              {format(currentTime, 'HH:mm:ss')}
            </span>
          </div>
          <span
            className="font-bold text-gray-500 uppercase tracking-[0.2em] group-hover:text-sky-400 transition-colors"
            style={{ fontSize: 'clamp(0.6rem,0.8vw,0.875rem)' }}
          >
            {manualOverride ? 'CLIQUE PARA VOLTAR AO RELÓGIO' : 'HORA ATUAL'}
          </span>
        </div>

        {/* Right: countdown timer */}
        <div
          className="bg-gray-900 border border-gray-800 rounded-2xl flex items-center shrink-0"
          style={{ gap: '1.5vw', padding: '1.5vh 2vw' }}
        >
          <div className="flex flex-col items-end">
            <span
              className="font-black text-gray-500 uppercase tracking-[0.15em]"
              style={{ fontSize: 'clamp(0.6rem,0.8vw,0.875rem)' }}
            >
              {timerInfo?.label || 'AGUARDANDO'}
            </span>
            <span
              className={`font-mono font-black tabular-nums leading-none ${timerInfo?.colorClass || 'text-gray-600'}`}
              style={{ fontSize: 'clamp(1.5rem,3.2vw,4rem)' }}
            >
              {timerInfo && timerInfo.seconds > 0 ? formatSeconds(timerInfo.seconds) : '--:--:--'}
            </span>
          </div>
          <Timer
            className={timerInfo?.colorClass || 'text-gray-600'}
            style={{ width: 'clamp(24px,2.5vw,40px)', height: 'clamp(24px,2.5vw,40px)' }}
          />
        </div>
      </div>

      {/* ── PROGRESS BAR ── */}
      <div className="shrink-0 w-full bg-gray-800 rounded-full overflow-hidden" style={{ height: '0.6vh', minHeight: 4 }}>
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            activeMeal === 'breakfast' ? 'bg-sky-500' : activeMeal === 'map' ? 'bg-orange-500' : 'bg-purple-500'
          }`}
          style={{ width: `${stats.progress}%` }}
        />
      </div>

      {/* ── CARDS ── */}
      <div
        className="grid grid-cols-4 flex-1 min-h-0"
        style={{ gap: '2vw' }}
      >

        {/* Total */}
        <div className="bg-gray-900 border border-gray-800 rounded-3xl flex flex-col items-center justify-center">
          <div
            className="rounded-2xl bg-sky-900/40 flex items-center justify-center"
            style={{ width: 'clamp(48px,5vw,80px)', height: 'clamp(48px,5vw,80px)', marginBottom: '2vh' }}
          >
            <Users
              className="text-sky-400"
              style={{ width: 'clamp(26px,3vw,44px)', height: 'clamp(26px,3vw,44px)' }}
            />
          </div>
          <p
            className="font-black text-gray-500 uppercase tracking-widest text-center"
            style={{ fontSize: 'clamp(0.65rem,1vw,1.1rem)', marginBottom: '1vh' }}
          >
            Total de Hóspedes
          </p>
          <p
            className="font-black text-white tabular-nums leading-none"
            style={{ fontSize: 'clamp(4rem,11vw,13rem)' }}
          >
            {stats.total}
          </p>
        </div>

        {/* Já tomaram */}
        <div className="bg-gray-900 border border-gray-800 rounded-3xl flex flex-col items-center justify-center">
          <div
            className="rounded-2xl bg-emerald-900/40 flex items-center justify-center"
            style={{ width: 'clamp(48px,5vw,80px)', height: 'clamp(48px,5vw,80px)', marginBottom: '2vh' }}
          >
            <CheckCircle
              className="text-emerald-400"
              style={{ width: 'clamp(26px,3vw,44px)', height: 'clamp(26px,3vw,44px)' }}
            />
          </div>
          <p
            className="font-black text-gray-500 uppercase tracking-widest text-center"
            style={{ fontSize: 'clamp(0.65rem,1vw,1.1rem)', marginBottom: '1vh' }}
          >
            {activeMeal === 'breakfast' ? 'Já Tomaram Café' : 'Já Almoçaram/Jantaram'}
          </p>
          <p
            className="font-black text-emerald-400 tabular-nums leading-none"
            style={{ fontSize: 'clamp(4rem,11vw,13rem)' }}
          >
            {stats.ate}
          </p>
          <p
            className="font-black text-emerald-600 tabular-nums"
            style={{ fontSize: 'clamp(0.9rem,1.5vw,2rem)', marginTop: '0.5vh' }}
          >
            {stats.progress}% CONCLUÍDO
          </p>
        </div>

        {/* Pendentes — destaque */}
        <div className={`border rounded-3xl flex flex-col items-center justify-center shadow-2xl ${
          activeMeal === 'breakfast' ? 'bg-sky-600 border-sky-500 shadow-sky-500/20' : 
          activeMeal === 'map' ? 'bg-orange-600 border-orange-500 shadow-orange-500/20' : 
          'bg-purple-600 border-purple-500 shadow-purple-500/20'
        }`}>
          <div
            className="rounded-2xl bg-white/10 flex items-center justify-center"
            style={{ width: 'clamp(48px,5vw,80px)', height: 'clamp(48px,5vw,80px)', marginBottom: '2vh' }}
          >
            <Utensils
              className="text-white"
              style={{ width: 'clamp(26px,3vw,44px)', height: 'clamp(26px,3vw,44px)' }}
            />
          </div>
          <p
            className="font-black text-white/70 uppercase tracking-widest text-center"
            style={{ fontSize: 'clamp(0.65rem,1vw,1.1rem)', marginBottom: '1vh' }}
          >
            Pendentes
          </p>
          <p
            className="font-black text-white tabular-nums leading-none"
            style={{ fontSize: 'clamp(4rem,11vw,13rem)' }}
          >
            {stats.pending}
          </p>
        </div>

        {/* Kits / Extras */}
        <div className="bg-gray-900 border border-gray-800 rounded-3xl flex flex-col items-center justify-center">
          <div
            className="rounded-2xl bg-amber-900/40 flex items-center justify-center"
            style={{ width: 'clamp(48px,5vw,80px)', height: 'clamp(48px,5vw,80px)', marginBottom: '2vh' }}
          >
            <Package
              className="text-amber-400"
              style={{ width: 'clamp(26px,3vw,44px)', height: 'clamp(26px,3vw,44px)' }}
            />
          </div>
          <p
            className="font-black text-gray-500 uppercase tracking-widest text-center"
            style={{ fontSize: 'clamp(0.65rem,1vw,1.1rem)', marginBottom: '1vh' }}
          >
            Kits/Solicitações
          </p>
          <p
            className="font-black text-amber-400 tabular-nums leading-none"
            style={{ fontSize: 'clamp(4rem,11vw,13rem)' }}
          >
            {stats.kits}
          </p>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="shrink-0 flex items-center justify-between">
        <p
          className="text-gray-600 font-semibold uppercase tracking-widest animate-pulse"
          style={{ fontSize: 'clamp(0.6rem,0.85vw,0.875rem)' }}
        >
          ● Atualização em tempo real · Aguardando interações do salão
        </p>
        <p
          className="text-gray-700 font-semibold"
          style={{ fontSize: 'clamp(0.6rem,0.85vw,0.875rem)' }}
        >
          {format(currentTime, "dd/MM/yyyy")}
        </p>
      </div>

      {/* ── Loading badge ── */}
      {loadingErbon && (
        <div className="fixed bottom-6 right-6 bg-gray-900 border border-gray-800 px-4 py-3 rounded-2xl flex items-center gap-3 shadow-xl">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
          <span className="text-sm font-bold text-gray-400">Sincronizando com Erbon...</span>
        </div>
      )}
    </div>
  );
};

export default BreakfastKitchen;
