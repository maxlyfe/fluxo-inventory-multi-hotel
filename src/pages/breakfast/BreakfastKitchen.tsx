import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  UtensilsCrossed, Users, Loader2, Package, CheckCircle,
  ChefHat, Timer, Clock,
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
  const [config, setConfig] = useState<{ start_time: string; end_time: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // ── data: guests from Erbon ──────────────────────────────────────────────
  const { data: guests, loading: loadingErbon } = useErbonData<ErbonGuest[]>(
    (hotelId) => erbonService.fetchBreakfastGuests(hotelId),
    [],
    { autoRefreshMs: 600_000 },
  );

  // ── data: breakfast records ──────────────────────────────────────────────
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
      data?.forEach((r) => { map[String(r.id_guest)] = r; });
      setRecords(map);
    } catch (err) {
      console.error('[BreakfastKitchen] Error loading records:', err);
    }
  }, [selectedHotel]);

  // ── data: config ─────────────────────────────────────────────────────────
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

  // ── realtime ─────────────────────────────────────────────────────────────
  const handleRealtimeUpdate = useCallback((payload: any) => {
    const today = new Date().toISOString().split('T')[0];
    if (payload.eventType === 'DELETE') {
      const oldId = (payload.old as any)?.id_guest;
      if (oldId) {
        setRecords((prev) => { const m = { ...prev }; delete m[oldId]; return m; });
        setRefreshTrigger((v) => v + 1);
      }
      return;
    }
    if (payload.new && payload.new.date === today) {
      setRecords((prev) => {
        if (prev[payload.new.id_guest]?.status === payload.new.status) return prev;
        return { ...prev, [payload.new.id_guest]: payload.new as BreakfastRecord };
      });
      setRefreshTrigger((v) => v + 1);
    }
  }, []);

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
    const totalErbon = guests?.length || 0;
    const dayUseCount = Object.values(records).filter((r) => String(r.id_guest).startsWith('DU-')).length;
    const total = totalErbon + dayUseCount;
    const recordList = Object.values(records);
    const ate = recordList.filter((r) => r.status === 'checked_in').length;
    const kits = recordList.filter((r) => r.status === 'kit_requested').length;
    const pending = Math.max(0, total - ate - kits);
    const progress = total > 0 ? Math.round(((ate + kits) / total) * 100) : 0;
    return { total, ate, kits, pending, progress };
  }, [guests, records, refreshTrigger]);

  // ── timer info ────────────────────────────────────────────────────────────
  const timerInfo = useMemo(() => {
    if (!config) return null;
    const todayStr = format(currentTime, 'yyyy-MM-dd');
    const start = parseISO(`${todayStr}T${config.start_time}`);
    const end = parseISO(`${todayStr}T${config.end_time}`);
    if (currentTime < start) {
      return { label: 'INÍCIO EM', colorClass: 'text-amber-400', seconds: differenceInSeconds(start, currentTime) };
    } else if (currentTime < end) {
      return { label: 'ENCERRA EM', colorClass: 'text-emerald-400', seconds: differenceInSeconds(end, currentTime) };
    }
    return { label: 'ENCERRADO', colorClass: 'text-rose-400', seconds: 0 };
  }, [config, currentTime]);

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
            className="rounded-2xl bg-sky-600 flex items-center justify-center shrink-0"
            style={{ width: 'clamp(48px,5vw,80px)', height: 'clamp(48px,5vw,80px)' }}
          >
            <ChefHat style={{ width: 'clamp(28px,3vw,48px)', height: 'clamp(28px,3vw,48px)' }} className="text-white" />
          </div>
          <div>
            <h1
              className="font-black uppercase tracking-tight text-white leading-none"
              style={{ fontSize: 'clamp(1.25rem,2.5vw,3rem)' }}
            >
              COZINHA — CAFÉ DA MANHÃ
            </h1>
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
        <div className="flex flex-col items-center shrink-0">
          <div className="flex items-center gap-2">
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
            className="font-bold text-gray-500 uppercase tracking-[0.2em]"
            style={{ fontSize: 'clamp(0.6rem,0.8vw,0.875rem)' }}
          >
            HORA ATUAL
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
          className="h-full bg-sky-500 rounded-full transition-all duration-1000"
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
            Já Tomaram Café
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
        <div className="bg-sky-600 border border-sky-500 rounded-3xl flex flex-col items-center justify-center shadow-2xl shadow-sky-500/20">
          <div
            className="rounded-2xl bg-white/10 flex items-center justify-center"
            style={{ width: 'clamp(48px,5vw,80px)', height: 'clamp(48px,5vw,80px)', marginBottom: '2vh' }}
          >
            <UtensilsCrossed
              className="text-white"
              style={{ width: 'clamp(26px,3vw,44px)', height: 'clamp(26px,3vw,44px)' }}
            />
          </div>
          <p
            className="font-black text-white/70 uppercase tracking-widest text-center"
            style={{ fontSize: 'clamp(0.65rem,1vw,1.1rem)', marginBottom: '1vh' }}
          >
            Pendentes de Café
          </p>
          <p
            className="font-black text-white tabular-nums leading-none"
            style={{ fontSize: 'clamp(4rem,11vw,13rem)' }}
          >
            {stats.pending}
          </p>
        </div>

        {/* Kits */}
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
            Kits Entregues
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
