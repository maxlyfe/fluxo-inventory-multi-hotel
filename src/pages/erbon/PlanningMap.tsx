// src/pages/erbon/PlanningMap.tsx
// Mapa de hospedagem estilo Desbravador com LINHA DO TEMPO LIVRE:
// arraste para navegar (como a Linha do Tempo dos relatórios), o range de
// dias se estende automaticamente nas bordas e as reservas da Erbon vão
// carregando em segundo plano conforme você se move — sem bloquear a
// navegação. Colunas ainda não carregadas exibem um shimmer sutil.
//
// - Hotel COM Erbon: UHs do housekeeping; reservas do booking/search
//   (a API só filtra por data de check-in específica → 1 chamada por dia,
//   com cache por dia e deduplicação por bookingInternalID).
// - Hotel SEM Erbon: UHs/categorias de governance/rooms, grade vazia.

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Loader2, BedDouble, RefreshCw, Info, Plus,
} from 'lucide-react';
import {
  format, addDays, subDays, differenceInCalendarDays, parseISO, isSameDay, getDay,
  startOfDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonBooking, ErbonRoom } from '../../lib/erbonService';
import { governanceService, RoomCategory, HotelRoom } from '../../lib/governanceService';
import { supabase } from '../../lib/supabase';
import BookingDetailModal from './BookingDetailModal';
import InternalBookingModal, { InternalBooking } from './InternalBookingModal';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface MapRow {
  key: string;
  name: string;
  category: string;
}

interface PlanningMapProps {
  hotelId: string;
  erbonConfigured: boolean;
}

// ── Constantes visuais ────────────────────────────────────────────────────────

const COL_W = 42;          // largura de cada dia (px)
const ROW_H = 34;          // altura de cada linha de UH (px)
const LABEL_W = 132;       // largura da coluna fixa de UHs (px)
const EXTEND_BY = 30;      // dias adicionados ao alcançar a borda
const MAX_DAYS = 400;      // limite do range renderizado (janela deslizante)
const LOOKBACK = 30;       // dias de check-in anteriores buscados p/ estadias longas
const FETCH_CHUNK = 8;     // chamadas paralelas à Erbon por lote

function barColor(b: ErbonBooking): { bg: string; text: string } {
  const s = `${b.status || ''} ${b.confirmedStatus || ''}`.toUpperCase();
  const now = new Date();
  const ci = parseISO(b.checkInDateTime);
  const co = parseISO(b.checkOutDateTime);
  if (s.includes('CHECKOUT') || co < now)
    return { bg: 'linear-gradient(135deg, #94a3b8, #64748b)', text: '#fff' };
  if (s.includes('CHECKIN') || s.includes('HOUSE') || (ci <= now && co >= now))
    return { bg: 'linear-gradient(135deg, #34d399, #059669)', text: '#fff' };
  if (s.includes('PEND') || s.includes('WAIT'))
    return { bg: 'linear-gradient(135deg, #fbbf24, #d97706)', text: '#fff' };
  return { bg: 'linear-gradient(135deg, #818cf8, #4f46e5)', text: '#fff' };
}

function isCancelled(b: ErbonBooking): boolean {
  const s = `${b.status || ''} ${b.confirmedStatus || ''}`.toUpperCase();
  return s.includes('CANCEL') || s.includes('NOSHOW') || s.includes('NO SHOW');
}

// Cor da barra para reservas INTERNAS (hotéis sem Erbon)
function internalBarColor(status: string): string {
  if (status === 'checkedin')  return 'linear-gradient(135deg, #34d399, #059669)';
  if (status === 'checkedout') return 'linear-gradient(135deg, #94a3b8, #64748b)';
  return 'linear-gradient(135deg, #818cf8, #4f46e5)';
}

// Barra pronta para renderização — une reservas Erbon e internas
interface RenderBar {
  id: string;
  label: string;
  startPos: number;
  widthCols: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  bg: string;
  title: string;
  erbon?: ErbonBooking;
  internal?: InternalBooking;
}

// ── Componente ────────────────────────────────────────────────────────────────

const PlanningMap: React.FC<PlanningMapProps> = ({ hotelId, erbonConfigured }) => {
  const today = startOfDay(new Date());

  // Janela de tempo renderizada (livre — se estende ao navegar)
  const [rangeStart, setRangeStart] = useState<Date>(() => subDays(today, 15));
  const [rangeDays, setRangeDays] = useState(70);

  const [rows, setRows] = useState<MapRow[]>([]);
  const [bookings, setBookings] = useState<ErbonBooking[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomsSyncing, setRoomsSyncing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ErbonBooking | null>(null);
  const [internalBookings, setInternalBookings] = useState<InternalBooking[]>([]);
  const [internalModal, setInternalModal] = useState<{ booking: InternalBooking | null } | null>(null);
  const [centerLabel, setCenterLabel] = useState('');
  const [pendingFetches, setPendingFetches] = useState(0);
  // bump para re-render do shimmer quando dias terminam de carregar
  const [, setLoadedVersion] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingShiftRef = useRef(0);          // colunas a compensar no scroll após estender à esquerda
  const initialScrollDone = useRef(false);

  // Cache de carregamento por dia (chave 'yyyy-MM-dd' do check-in)
  const loadedDaysRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const visibleLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reservas indexadas por bookingInternalID — dados frescos da Erbon
  // SUBSTITUEM os do cache local (status pode ter mudado)
  const bookingMapRef = useRef<Map<number, ErbonBooking>>(new Map());
  const commitBookings = useCallback(() => {
    setBookings([...bookingMapRef.current.values()]);
  }, []);

  // Drag-to-pan (mesmo padrão da Linha do Tempo dos relatórios)
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const scrollStartLeft = useRef(0);
  const dragMoved = useRef(0);

  const days = useMemo(
    () => Array.from({ length: rangeDays }, (_, i) => addDays(rangeStart, i)),
    [rangeStart.getTime(), rangeDays],
  );
  const gridWidth = rangeDays * COL_W;
  const todayIdx = differenceInCalendarDays(today, rangeStart);

  // ── UHs (linhas): cache local primeiro, Erbon sincroniza em background ─────
  const loadRooms = useCallback(async () => {
    if (!hotelId) return;
    setError('');
    try {
      if (erbonConfigured) {
        // 1) Resultado rápido: UHs já mapeadas no banco
        const { data: cached } = await supabase
          .from('erbon_rooms_cache')
          .select('erbon_room_id, room_name, room_type')
          .eq('hotel_id', hotelId);
        if (cached && cached.length > 0) {
          setRows(cached.map((r: any) => ({
            key: String(r.erbon_room_id),
            name: r.room_name,
            category: r.room_type || 'Sem categoria',
          })));
          setLoadingRooms(false);
        }

        // 2) Sincroniza com a Erbon e atualiza banco + tela
        setRoomsSyncing(true);
        try {
          const erbonRooms: ErbonRoom[] = await erbonService.fetchHousekeeping(hotelId);
          setRows(erbonRooms.map(r => ({
            key: String(r.idRoom),
            name: r.roomName,
            category: r.roomTypeDescription || 'Sem categoria',
          })));
          const now = new Date().toISOString();
          await supabase.from('erbon_rooms_cache').upsert(
            erbonRooms.map(r => ({
              hotel_id: hotelId,
              erbon_room_id: r.idRoom,
              room_name: r.roomName,
              room_type: r.roomTypeDescription || null,
              floor: r.numberFloor ?? null,
              synced_at: now,
            })),
            { onConflict: 'hotel_id,erbon_room_id' },
          );
        } finally {
          setRoomsSyncing(false);
        }
      } else {
        const [localRooms, categories]: [HotelRoom[], RoomCategory[]] = await Promise.all([
          governanceService.fetchLocalRooms(hotelId),
          governanceService.fetchCategories(hotelId),
        ]);
        const catMap = new Map(categories.map(c => [c.id, c.name]));
        setRows(localRooms.filter(r => r.is_active).map(r => ({
          key: r.id,
          name: r.name,
          category: (r.category_id && catMap.get(r.category_id)) || 'Sem categoria',
        })));
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar as UHs.');
    } finally {
      setLoadingRooms(false);
    }
  }, [hotelId, erbonConfigured]);

  // Reservas já mapeadas no banco — pinta o mapa imediatamente
  const loadCachedBookings = useCallback(async () => {
    if (!hotelId || !erbonConfigured) return;
    const { data } = await supabase
      .from('erbon_bookings_cache')
      .select('booking_internal_id, payload')
      .eq('hotel_id', hotelId)
      .gte('checkout', subDays(today, 90).toISOString())
      .limit(3000);
    if (data && data.length > 0) {
      for (const row of data as any[]) {
        // Dados frescos da Erbon têm prioridade sobre o cache
        if (!bookingMapRef.current.has(row.booking_internal_id)) {
          bookingMapRef.current.set(row.booking_internal_id, row.payload as ErbonBooking);
        }
      }
      commitBookings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, erbonConfigured, commitBookings]);

  // Reservas internas (hotéis sem Erbon)
  const loadInternalBookings = useCallback(async () => {
    if (!hotelId || erbonConfigured) { setInternalBookings([]); return; }
    const { data } = await supabase
      .from('internal_bookings')
      .select('*')
      .eq('hotel_id', hotelId)
      .neq('status', 'cancelled')
      .gte('checkout', format(subDays(today, 120), 'yyyy-MM-dd'));
    setInternalBookings((data || []) as InternalBooking[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, erbonConfigured]);

  useEffect(() => {
    // Reset completo ao trocar de hotel
    loadedDaysRef.current.clear();
    inFlightRef.current.clear();
    bookingMapRef.current.clear();
    setBookings([]);
    setPendingFetches(0);
    initialScrollDone.current = false;
    setLoadingRooms(true);
    loadCachedBookings();
    loadInternalBookings();
    loadRooms();
  }, [loadRooms, loadCachedBookings, loadInternalBookings]);

  // ── Carregamento progressivo de reservas (por dia de check-in) ─────────────
  const ensureDaysLoaded = useCallback((dates: string[]) => {
    if (!erbonConfigured || !hotelId) return;
    const missing = dates.filter(d => !loadedDaysRef.current.has(d) && !inFlightRef.current.has(d));
    if (missing.length === 0) return;
    missing.forEach(d => inFlightRef.current.add(d));
    setPendingFetches(c => c + missing.length);

    (async () => {
      for (let i = 0; i < missing.length; i += FETCH_CHUNK) {
        const chunk = missing.slice(i, i + FETCH_CHUNK);
        const settled = await Promise.allSettled(
          chunk.map(date => erbonService.searchBookings(hotelId, { checkin: date })),
        );
        const fresh: ErbonBooking[] = [];
        settled.forEach((r, idx) => {
          const date = chunk[idx];
          inFlightRef.current.delete(date);
          if (r.status === 'fulfilled') {
            loadedDaysRef.current.add(date);
            for (const b of r.value || []) {
              // Substitui a versão do cache — status pode ter mudado
              bookingMapRef.current.set(b.bookingInternalID, b);
              fresh.push(b);
            }
          }
          // dia com falha: sai do in-flight sem marcar carregado → retenta depois
        });
        if (fresh.length > 0) {
          commitBookings();
          // Persiste no cache local (fire-and-forget — não trava a UI)
          const now = new Date().toISOString();
          supabase.from('erbon_bookings_cache').upsert(
            fresh.map(b => ({
              hotel_id: hotelId,
              booking_internal_id: b.bookingInternalID,
              status: b.status || null,
              checkin: b.checkInDateTime || null,
              checkout: b.checkOutDateTime || null,
              room_id: b.roomID || null,
              payload: b,
              synced_at: now,
            })),
            { onConflict: 'hotel_id,booking_internal_id' },
          ).then(({ error: upErr }) => {
            if (upErr) console.error('[PlanningMap] cache upsert:', upErr.message);
          });
        }
        setPendingFetches(c => Math.max(0, c - chunk.length));
        setLoadedVersion(v => v + 1);
      }
    })();
  }, [erbonConfigured, hotelId, commitBookings]);

  // Agenda o carregamento dos dias visíveis (+ lookback e buffer), debounced
  const scheduleVisibleLoad = useCallback(() => {
    if (!erbonConfigured) return;
    if (visibleLoadTimer.current) clearTimeout(visibleLoadTimer.current);
    visibleLoadTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const firstIdx = Math.floor(el.scrollLeft / COL_W);
      const lastIdx = Math.ceil((el.scrollLeft + el.clientWidth) / COL_W);
      const from = subDays(addDays(rangeStart, firstIdx), LOOKBACK);
      const to = addDays(rangeStart, lastIdx + 7); // buffer à direita
      const n = differenceInCalendarDays(to, from) + 1;
      const dates = Array.from({ length: n }, (_, i) => format(addDays(from, i), 'yyyy-MM-dd'));
      ensureDaysLoaded(dates);
    }, 250);
  }, [erbonConfigured, rangeStart.getTime(), ensureDaysLoaded]);

  // ── Extensão automática do range nas bordas ────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Rótulo do mês no centro da janela visível
    const centerIdx = Math.floor((el.scrollLeft + el.clientWidth / 2 - LABEL_W) / COL_W);
    const centerDay = addDays(rangeStart, Math.max(0, Math.min(rangeDays - 1, centerIdx)));
    const label = format(centerDay, 'MMMM yyyy', { locale: ptBR });
    setCenterLabel(label.charAt(0).toUpperCase() + label.slice(1));

    scheduleVisibleLoad();

    const nearStart = el.scrollLeft < 6 * COL_W;
    const nearEnd = el.scrollWidth - el.scrollLeft - el.clientWidth < 6 * COL_W;
    if (nearStart) {
      pendingShiftRef.current += EXTEND_BY;
      setRangeStart(s => subDays(s, EXTEND_BY));
      setRangeDays(d => Math.min(d + EXTEND_BY, MAX_DAYS));
    } else if (nearEnd) {
      setRangeDays(d => {
        if (d + EXTEND_BY <= MAX_DAYS) return d + EXTEND_BY;
        // Janela deslizante: descarta dias do início para não crescer sem fim
        pendingShiftRef.current -= EXTEND_BY;
        setRangeStart(s => addDays(s, EXTEND_BY));
        return d;
      });
    }
  }, [rangeStart.getTime(), rangeDays, scheduleVisibleLoad]);

  // Compensa o scroll quando o range é estendido/deslocado à esquerda
  useLayoutEffect(() => {
    if (pendingShiftRef.current !== 0 && scrollRef.current) {
      scrollRef.current.scrollLeft += pendingShiftRef.current * COL_W;
      pendingShiftRef.current = 0;
    }
  }, [rangeStart.getTime(), rangeDays]);

  // Posição inicial: hoje encostado à esquerda (1 dia de contexto atrás) —
  // o foco do planning é o presente e o futuro; o passado fica a um arrasto
  // de distância.
  useEffect(() => {
    if (loadingRooms || rows.length === 0 || initialScrollDone.current || !scrollRef.current) return;
    initialScrollDone.current = true;
    scrollRef.current.scrollLeft = Math.max(0, todayIdx * COL_W - 1 * COL_W);
    handleScroll();
  }, [loadingRooms, rows.length]);

  const goToToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = differenceInCalendarDays(today, rangeStart);
    if (idx >= 0 && idx < rangeDays) {
      el.scrollTo({ left: Math.max(0, idx * COL_W - 1 * COL_W), behavior: 'smooth' });
    } else {
      setRangeStart(subDays(today, 15));
      setRangeDays(70);
      initialScrollDone.current = false;
    }
  };

  const nudge = (dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 7 * COL_W, behavior: 'smooth' });
  };

  // ── Drag-to-pan ────────────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    isDragging.current = true;
    dragMoved.current = 0;
    dragStartX.current = e.clientX;
    scrollStartLeft.current = scrollRef.current.scrollLeft;
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !scrollRef.current) return;
    const delta = dragStartX.current - e.clientX;
    dragMoved.current = Math.max(dragMoved.current, Math.abs(delta));
    scrollRef.current.scrollLeft = scrollStartLeft.current + delta;
  };
  const endDrag = () => { isDragging.current = false; };

  // ── Agrupamento por categoria ──────────────────────────────────────────────
  const groups = useMemo(() => {
    const byCat = new Map<string, MapRow[]>();
    for (const r of rows) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }
    return [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, rs]) => ({
        category,
        rooms: rs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      }));
  }, [rows]);

  // ── Barras por UH (recortadas na janela renderizada) ───────────────────────
  const barsByRoom = useMemo(() => {
    const map = new Map<string, RenderBar[]>();
    const rangeEndExcl = addDays(rangeStart, rangeDays);

    // Geometria da barra (meia diária no in/out, recortada na janela)
    const clip = (ci: Date, co: Date) => {
      if (co <= rangeStart || ci >= rangeEndExcl) return null;
      const clippedStart = ci < rangeStart;
      const clippedEnd = co > rangeEndExcl;
      const startIdx = clippedStart ? 0 : differenceInCalendarDays(ci, rangeStart);
      const endIdx = clippedEnd ? rangeDays : differenceInCalendarDays(co, rangeStart);
      const startPos = clippedStart ? 0 : startIdx + 0.5;
      const endPos = clippedEnd ? rangeDays : endIdx + 0.5;
      return { startPos, widthCols: Math.max(endPos - startPos, 0.5), clippedStart, clippedEnd };
    };
    const push = (key: string, bar: RenderBar) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(bar);
    };

    if (erbonConfigured) {
      for (const b of bookings) {
        if (!b.roomID || isCancelled(b)) continue;
        let ci: Date, co: Date;
        try { ci = parseISO(b.checkInDateTime); co = parseISO(b.checkOutDateTime); } catch { continue; }
        const g = clip(ci, co);
        if (!g) continue;
        const label = b.guestList?.[0]?.name || `Reserva ${b.erbonNumber || b.bookingInternalID}`;
        push(String(b.roomID), {
          id: `e-${b.bookingInternalID}`, label, ...g,
          bg: barColor(b).bg,
          title: `${label} · ${format(ci, 'dd/MM')} → ${format(co, 'dd/MM')}`,
          erbon: b,
        });
      }
    } else {
      for (const ib of internalBookings) {
        if (!ib.room_id || ib.status === 'cancelled') continue;
        let ci: Date, co: Date;
        try { ci = parseISO(ib.checkin); co = parseISO(ib.checkout); } catch { continue; }
        const g = clip(ci, co);
        if (!g) continue;
        push(ib.room_id, {
          id: `i-${ib.id}`, label: ib.guest_name, ...g,
          bg: internalBarColor(ib.status),
          title: `${ib.guest_name} · ${format(ci, 'dd/MM')} → ${format(co, 'dd/MM')} · ${ib.code}`,
          internal: ib,
        });
      }
    }
    return map;
  }, [erbonConfigured, bookings, internalBookings, rangeStart.getTime(), rangeDays]);

  // ── Fundo das linhas: grade + fim de semana via CSS (leve) ─────────────────
  const rowBackground = useMemo(() => {
    const startDow = getDay(rangeStart); // 0=DOM
    const stops: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dow = (startDow + i) % 7;
      const weekend = dow === 0 || dow === 6;
      const c = weekend ? 'rgba(100,116,139,0.10)' : 'transparent';
      stops.push(`${c} ${i * COL_W}px, ${c} ${(i + 1) * COL_W - 1}px, rgba(100,116,139,0.18) ${(i + 1) * COL_W - 1}px, rgba(100,116,139,0.18) ${(i + 1) * COL_W}px`);
    }
    return {
      backgroundImage: `repeating-linear-gradient(to right, ${stops.join(', ')})`,
      backgroundSize: `${7 * COL_W}px 100%`,
    } as React.CSSProperties;
  }, [rangeStart.getTime()]);

  // ── Segmentos ainda não carregados (shimmer) ───────────────────────────────
  const unloadedSegments = useMemo(() => {
    if (!erbonConfigured) return [] as { start: number; len: number }[];
    const segs: { start: number; len: number }[] = [];
    let runStart = -1;
    for (let i = 0; i < rangeDays; i++) {
      const key = format(addDays(rangeStart, i), 'yyyy-MM-dd');
      const loaded = loadedDaysRef.current.has(key);
      if (!loaded && runStart === -1) runStart = i;
      if (loaded && runStart !== -1) { segs.push({ start: runStart, len: i - runStart }); runStart = -1; }
    }
    if (runStart !== -1) segs.push({ start: runStart, len: rangeDays - runStart });
    return segs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erbonConfigured, rangeStart.getTime(), rangeDays, pendingFetches, bookings.length]);

  const unassignedCount = useMemo(
    () => bookings.filter(b => !b.roomID && !isCancelled(b)).length,
    [bookings],
  );

  const bodyHeight = groups.reduce((h, g) => h + 26 + g.rooms.length * ROW_H, 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <style>{`
        @keyframes planningShimmer {
          0% { background-position: -200px 0; }
          100% { background-position: 200px 0; }
        }
        @keyframes planningIndeterminate {
          0% { left: -35%; width: 35%; }
          60% { left: 100%; width: 40%; }
          100% { left: 100%; width: 40%; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-1">
          <button onClick={() => nudge(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="px-3 text-center min-w-[150px]">
            <p className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">
              {centerLabel || '—'}
            </p>
          </div>
          <button onClick={() => nudge(1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button onClick={goToToday}
          className="px-3 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
          Hoje
        </button>
        <button onClick={() => {
          loadedDaysRef.current.clear(); inFlightRef.current.clear();
          scheduleVisibleLoad(); loadInternalBookings(); loadRooms();
        }} disabled={loadingRooms}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-500 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${loadingRooms ? 'animate-spin' : ''}`} />
        </button>

        {/* Nova reserva interna — apenas hotéis sem Erbon */}
        {!erbonConfigured && rows.length > 0 && (
          <button onClick={() => setInternalModal({ booking: null })}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors shadow-sm">
            <Plus className="h-3.5 w-3.5" /> Nova Reserva
          </button>
        )}

        {erbonConfigured && (
          <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg,#818cf8,#4f46e5)' }} /> Confirmada</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg,#34d399,#059669)' }} /> In-house</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg,#fbbf24,#d97706)' }} /> Pendente</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg,#94a3b8,#64748b)' }} /> Encerrada</span>
          </div>
        )}
      </div>

      {/* Avisos */}
      {erbonConfigured && (roomsSyncing || pendingFetches > 0) && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-700 dark:text-indigo-300">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500" />
          </span>
          Sincronização com a Erbon em andamento — exibindo os dados já salvos; o mapa atualiza sozinho.
        </div>
      )}
      {!erbonConfigured && rows.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <Info className="w-4 h-4 shrink-0" />
          Reservas internas — crie pelo botão "Nova Reserva" e clique numa barra para editar datas, lançar pagamentos, incluir hóspedes e dar check-in/out.
        </div>
      )}
      {erbonConfigured && unassignedCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
          <BedDouble className="w-4 h-4 shrink-0" />
          {unassignedCount} reserva{unassignedCount > 1 ? 's' : ''} carregada{unassignedCount > 1 ? 's' : ''} sem UH atribuída (não aparece{unassignedCount > 1 ? 'm' : ''} no mapa).
        </div>
      )}
      {error && <p className="text-red-500 text-sm">{error}</p>}

      {/* Grade */}
      {loadingRooms ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
          <BedDouble className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhuma UH cadastrada.</p>
          {!erbonConfigured && (
            <p className="text-xs">Cadastre categorias e apartamentos em <strong>Governança → Quartos</strong>.</p>
          )}
        </div>
      ) : (
        <div className="relative rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-900 overflow-hidden">
          {/* Barra de progresso indeterminada — indicador visual, sem texto */}
          <div className="absolute top-0 left-0 right-0 h-[3px] z-50 overflow-hidden pointer-events-none"
            style={{ opacity: pendingFetches > 0 ? 1 : 0, transition: 'opacity 0.4s' }}>
            <div className="absolute h-full rounded-full"
              style={{
                background: 'linear-gradient(90deg, transparent, #6366f1, #a5b4fc, transparent)',
                animation: 'planningIndeterminate 1.4s ease-in-out infinite',
              }} />
          </div>

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            className="overflow-auto select-none cursor-grab active:cursor-grabbing"
            style={{ maxHeight: 'calc(100vh - 250px)' }}
          >
            <div style={{ width: LABEL_W + gridWidth, position: 'relative' }}>

              {/* ── Cabeçalho: dias ── */}
              <div className="sticky top-0 z-30 flex" style={{ height: 44 }}>
                <div className="sticky left-0 z-40 flex items-center px-3 bg-gray-800 dark:bg-gray-950 text-white text-[11px] font-black uppercase tracking-wider border-r border-gray-700"
                  style={{ width: LABEL_W, minWidth: LABEL_W }}>
                  UH
                </div>
                {days.map((d, i) => {
                  const isToday = isSameDay(d, today);
                  const dow = getDay(d);
                  const isWeekend = dow === 0 || dow === 6;
                  const isFirstOfMonth = d.getDate() === 1;
                  return (
                    <div key={i}
                      className={`flex flex-col items-center justify-center border-r text-white
                        ${isFirstOfMonth ? 'border-l-2 border-l-indigo-400' : ''}
                        border-gray-700/40
                        ${isToday ? 'bg-indigo-600' : isWeekend ? 'bg-gray-700 dark:bg-gray-900' : 'bg-gray-800 dark:bg-gray-950'}`}
                      style={{ width: COL_W, minWidth: COL_W }}>
                      <span className="text-[9px] uppercase opacity-60 leading-none">
                        {isFirstOfMonth ? format(d, 'MMM', { locale: ptBR }) : format(d, 'EEEEEE', { locale: ptBR })}
                      </span>
                      <span className="text-xs font-black leading-tight">{format(d, 'dd')}</span>
                    </div>
                  );
                })}
              </div>

              {/* ── Corpo ── */}
              <div className="relative">
                {/* Destaque do dia de hoje (coluna inteira) */}
                {todayIdx >= 0 && todayIdx < rangeDays && (
                  <div className="absolute top-0 bottom-0 pointer-events-none z-[5] bg-indigo-500/10 border-x border-indigo-400/30"
                    style={{ left: LABEL_W + todayIdx * COL_W, width: COL_W }} />
                )}

                {/* Shimmer nas colunas ainda não carregadas */}
                {unloadedSegments.map((seg, i) => (
                  <div key={i} className="absolute top-0 pointer-events-none z-[6]"
                    style={{
                      left: LABEL_W + seg.start * COL_W,
                      width: seg.len * COL_W,
                      height: bodyHeight,
                      background: 'linear-gradient(90deg, rgba(148,163,184,0.05) 25%, rgba(148,163,184,0.16) 50%, rgba(148,163,184,0.05) 75%)',
                      backgroundSize: '400px 100%',
                      animation: 'planningShimmer 1.2s linear infinite',
                    }} />
                ))}

                {groups.map(({ category, rooms }) => (
                  <React.Fragment key={category}>
                    <div className="flex items-center bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
                      style={{ height: 26, width: LABEL_W + gridWidth }}>
                      <span className="sticky left-0 z-20 px-3 text-[10px] font-black text-gray-600 dark:text-gray-300 uppercase tracking-widest whitespace-nowrap">
                        {category} <span className="font-normal text-gray-400">({rooms.length})</span>
                      </span>
                    </div>

                    {rooms.map((room, ri) => {
                      const bars = barsByRoom.get(room.key) || [];
                      return (
                        <div key={room.key} className="flex relative border-b border-gray-100 dark:border-gray-800"
                          style={{ height: ROW_H }}>
                          <div className={`sticky left-0 z-20 flex items-center px-3 border-r border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200
                            ${ri % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/60'}`}
                            style={{ width: LABEL_W, minWidth: LABEL_W }}>
                            {room.name}
                          </div>

                          <div className="relative" style={{ width: gridWidth, minWidth: gridWidth, ...rowBackground }}>
                            {bars.map(bar => (
                              <button key={bar.id}
                                onClick={() => {
                                  if (dragMoved.current >= 6) return;
                                  if (bar.erbon) setSelected(bar.erbon);
                                  else if (bar.internal) setInternalModal({ booking: bar.internal });
                                }}
                                title={bar.title}
                                className="absolute flex items-center gap-1 px-2 text-[10px] font-bold truncate shadow-sm hover:brightness-110 hover:z-10 transition-all cursor-pointer"
                                style={{
                                  left: bar.startPos * COL_W + 1,
                                  width: bar.widthCols * COL_W - 2,
                                  top: 4,
                                  height: ROW_H - 8,
                                  background: bar.bg,
                                  color: '#fff',
                                  borderRadius: `${bar.clippedStart ? 0 : 10}px ${bar.clippedEnd ? 0 : 10}px ${bar.clippedEnd ? 0 : 10}px ${bar.clippedStart ? 0 : 10}px`,
                                }}>
                                {bar.clippedStart && <span className="opacity-70">◂</span>}
                                <span className="truncate">{bar.label}</span>
                                {bar.clippedEnd && <span className="ml-auto opacity-70">▸</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal detalhado da reserva Erbon ── */}
      {selected && (
        <BookingDetailModal
          hotelId={hotelId}
          booking={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {/* ── Modal de reserva interna (sem Erbon) ── */}
      {internalModal && (
        <InternalBookingModal
          hotelId={hotelId}
          rooms={rows.map(r => ({ id: r.key, name: r.name, category: r.category }))}
          booking={internalModal.booking}
          onSaved={loadInternalBookings}
          onClose={() => setInternalModal(null)}
        />
      )}
    </div>
  );
};

export default PlanningMap;
