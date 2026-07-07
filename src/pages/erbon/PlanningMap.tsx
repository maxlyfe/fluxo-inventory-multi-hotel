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
  ChevronLeft, ChevronRight, Loader2, BedDouble, X, RefreshCw,
  Users, CalendarRange, Info,
} from 'lucide-react';
import {
  format, addDays, subDays, differenceInCalendarDays, parseISO, isSameDay, getDay,
  startOfDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonBooking, ErbonRoom } from '../../lib/erbonService';
import { governanceService, RoomCategory, HotelRoom } from '../../lib/governanceService';

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

// ── Componente ────────────────────────────────────────────────────────────────

const PlanningMap: React.FC<PlanningMapProps> = ({ hotelId, erbonConfigured }) => {
  const today = startOfDay(new Date());

  // Janela de tempo renderizada (livre — se estende ao navegar)
  const [rangeStart, setRangeStart] = useState<Date>(() => subDays(today, 15));
  const [rangeDays, setRangeDays] = useState(70);

  const [rows, setRows] = useState<MapRow[]>([]);
  const [bookings, setBookings] = useState<ErbonBooking[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ErbonBooking | null>(null);
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
  const seenBookingsRef = useRef<Set<number>>(new Set());
  const visibleLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── UHs (linhas) ───────────────────────────────────────────────────────────
  const loadRooms = useCallback(async () => {
    if (!hotelId) return;
    setLoadingRooms(true); setError('');
    try {
      if (erbonConfigured) {
        const erbonRooms: ErbonRoom[] = await erbonService.fetchHousekeeping(hotelId);
        setRows(erbonRooms.map(r => ({
          key: String(r.idRoom),
          name: r.roomName,
          category: r.roomTypeDescription || 'Sem categoria',
        })));
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

  useEffect(() => {
    // Reset completo ao trocar de hotel
    loadedDaysRef.current.clear();
    inFlightRef.current.clear();
    seenBookingsRef.current.clear();
    setBookings([]);
    setPendingFetches(0);
    initialScrollDone.current = false;
    loadRooms();
  }, [loadRooms]);

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
              if (!seenBookingsRef.current.has(b.bookingInternalID)) {
                seenBookingsRef.current.add(b.bookingInternalID);
                if (!isCancelled(b)) fresh.push(b);
              }
            }
          }
          // dia com falha: sai do in-flight sem marcar carregado → retenta depois
        });
        if (fresh.length > 0) setBookings(prev => [...prev, ...fresh]);
        setPendingFetches(c => Math.max(0, c - chunk.length));
        setLoadedVersion(v => v + 1);
      }
    })();
  }, [erbonConfigured, hotelId]);

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

  // Posição inicial: hoje na 3ª coluna visível
  useEffect(() => {
    if (loadingRooms || initialScrollDone.current || !scrollRef.current) return;
    initialScrollDone.current = true;
    scrollRef.current.scrollLeft = Math.max(0, todayIdx * COL_W - 2 * COL_W);
    handleScroll();
  }, [loadingRooms]);

  const goToToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = differenceInCalendarDays(today, rangeStart);
    if (idx >= 0 && idx < rangeDays) {
      el.scrollTo({ left: Math.max(0, idx * COL_W - 2 * COL_W), behavior: 'smooth' });
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
    const map = new Map<string, { booking: ErbonBooking; startPos: number; widthCols: number; clippedStart: boolean; clippedEnd: boolean }[]>();
    const rangeEndExcl = addDays(rangeStart, rangeDays);
    for (const b of bookings) {
      if (!b.roomID) continue;
      let ci: Date, co: Date;
      try { ci = parseISO(b.checkInDateTime); co = parseISO(b.checkOutDateTime); } catch { continue; }
      if (co <= rangeStart || ci >= rangeEndExcl) continue;

      const clippedStart = ci < rangeStart;
      const clippedEnd = co > rangeEndExcl;
      const startIdx = clippedStart ? 0 : differenceInCalendarDays(ci, rangeStart);
      const endIdx = clippedEnd ? rangeDays : differenceInCalendarDays(co, rangeStart);
      const startPos = clippedStart ? 0 : startIdx + 0.5;
      const endPos = clippedEnd ? rangeDays : endIdx + 0.5;

      const key = String(b.roomID);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({
        booking: b, startPos,
        widthCols: Math.max(endPos - startPos, 0.5),
        clippedStart, clippedEnd,
      });
    }
    return map;
  }, [bookings, rangeStart.getTime(), rangeDays]);

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
    () => bookings.filter(b => !b.roomID).length,
    [bookings],
  );

  const guestName = (b: ErbonBooking) =>
    b.guestList?.[0]?.name || `Reserva ${b.erbonNumber || b.bookingInternalID}`;

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
          seenBookingsRef.current.clear(); setBookings([]);
          scheduleVisibleLoad(); loadRooms();
        }} disabled={loadingRooms}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-500 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${loadingRooms ? 'animate-spin' : ''}`} />
        </button>

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
      {!erbonConfigured && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <Info className="w-4 h-4 shrink-0" />
          Hotel sem integração Erbon — exibindo as UHs cadastradas em Governança → Quartos. O lançamento interno de reservas chega em breve.
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
                            {bars.map((bar, bi) => {
                              const colors = barColor(bar.booking);
                              return (
                                <button key={bi}
                                  onClick={() => { if (dragMoved.current < 6) setSelected(bar.booking); }}
                                  title={`${guestName(bar.booking)} · ${format(parseISO(bar.booking.checkInDateTime), 'dd/MM')} → ${format(parseISO(bar.booking.checkOutDateTime), 'dd/MM')}`}
                                  className="absolute flex items-center gap-1 px-2 text-[10px] font-bold truncate shadow-sm hover:brightness-110 hover:z-10 transition-all cursor-pointer"
                                  style={{
                                    left: bar.startPos * COL_W + 1,
                                    width: bar.widthCols * COL_W - 2,
                                    top: 4,
                                    height: ROW_H - 8,
                                    background: colors.bg,
                                    color: colors.text,
                                    borderRadius: `${bar.clippedStart ? 0 : 10}px ${bar.clippedEnd ? 0 : 10}px ${bar.clippedEnd ? 0 : 10}px ${bar.clippedStart ? 0 : 10}px`,
                                  }}>
                                  {bar.clippedStart && <span className="opacity-70">◂</span>}
                                  <span className="truncate">{guestName(bar.booking)}</span>
                                  {bar.clippedEnd && <span className="ml-auto opacity-70">▸</span>}
                                </button>
                              );
                            })}
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

      {/* ── Detalhes da reserva ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div onClick={e => e.stopPropagation()}
            className="relative w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-4 flex items-start justify-between"
              style={{ background: barColor(selected).bg }}>
              <div className="text-white min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                  Reserva {selected.erbonNumber || selected.bookingInternalID} · {selected.status}
                </p>
                <h3 className="text-base font-bold truncate">{guestName(selected)}</h3>
              </div>
              <button onClick={() => setSelected(null)}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-white/80 hover:text-white hover:bg-white/20 transition-colors shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                <CalendarRange className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>
                  {format(parseISO(selected.checkInDateTime), "dd/MM/yyyy", { locale: ptBR })}
                  {' → '}
                  {format(parseISO(selected.checkOutDateTime), "dd/MM/yyyy", { locale: ptBR })}
                  <span className="text-gray-400 ml-1">
                    ({differenceInCalendarDays(parseISO(selected.checkOutDateTime), parseISO(selected.checkInDateTime))} diárias)
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                <BedDouble className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>UH <strong>{selected.roomDescription}</strong> · {selected.roomTypeDescription}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                <Users className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>
                  {selected.adultQuantity} adulto{selected.adultQuantity !== 1 ? 's' : ''}
                  {!!selected.childQuantity && ` · ${selected.childQuantity} criança${selected.childQuantity !== 1 ? 's' : ''}`}
                  {!!selected.babyQuantity && ` · ${selected.babyQuantity} bebê${selected.babyQuantity !== 1 ? 's' : ''}`}
                </span>
              </div>
              {(selected.segmentDesc || selected.sourceDesc) && (
                <p className="text-xs text-gray-400">
                  {[selected.segmentDesc, selected.sourceDesc].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlanningMap;
