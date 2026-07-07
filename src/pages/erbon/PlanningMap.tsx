// src/pages/erbon/PlanningMap.tsx
// Mapa de hospedagem estilo Desbravador: linhas = UHs (agrupadas por
// categoria), colunas = dias do mês, reservas como barras contínuas.
//
// - Hotel COM Erbon: UHs vêm do housekeeping e as reservas do booking/search.
// - Hotel SEM Erbon: UHs/categorias vêm de governance/rooms (hotel_rooms /
//   hotel_room_categories) e a grade renderiza vazia (reservas internas: futuro).

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Loader2, BedDouble, X, RefreshCw,
  Users, CalendarRange, Info,
} from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, addMonths, subMonths, addDays, subDays,
  differenceInCalendarDays, parseISO, isSameDay, getDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonBooking, ErbonRoom } from '../../lib/erbonService';
import { governanceService, RoomCategory, HotelRoom } from '../../lib/governanceService';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface MapRow {
  key: string;            // idRoom (Erbon) ou uuid local
  name: string;           // "101", "201A"...
  category: string;       // descrição da categoria/tipo
  erbonRoomId?: number;
}

interface Bar {
  booking: ErbonBooking;
  /** posição inicial em colunas (fração — meia diária no check-in) */
  startPos: number;
  /** largura em colunas */
  widthCols: number;
  clippedStart: boolean;  // reserva começou antes do mês visível
  clippedEnd: boolean;    // reserva termina depois do mês visível
}

interface PlanningMapProps {
  hotelId: string;
  erbonConfigured: boolean;
}

// ── Constantes visuais ────────────────────────────────────────────────────────

const COL_W = 42;         // largura de cada dia (px)
const ROW_H = 34;         // altura de cada linha de UH (px)
const LABEL_W = 132;      // largura da coluna fixa de UHs (px)

// Cor da barra conforme situação da reserva
function barColor(b: ErbonBooking): { bg: string; text: string } {
  const s = `${b.status || ''} ${b.confirmedStatus || ''}`.toUpperCase();
  const now = new Date();
  const ci = parseISO(b.checkInDateTime);
  const co = parseISO(b.checkOutDateTime);
  if (s.includes('CHECKOUT') || co < now)
    return { bg: 'linear-gradient(135deg, #94a3b8, #64748b)', text: '#fff' };          // hospedagem encerrada
  if (s.includes('CHECKIN') || s.includes('HOUSE') || (ci <= now && co >= now))
    return { bg: 'linear-gradient(135deg, #34d399, #059669)', text: '#fff' };          // in-house
  if (s.includes('PEND') || s.includes('WAIT'))
    return { bg: 'linear-gradient(135deg, #fbbf24, #d97706)', text: '#fff' };          // pendente
  return { bg: 'linear-gradient(135deg, #818cf8, #4f46e5)', text: '#fff' };            // confirmada (futura)
}

function isCancelled(b: ErbonBooking): boolean {
  const s = `${b.status || ''} ${b.confirmedStatus || ''}`.toUpperCase();
  return s.includes('CANCEL') || s.includes('NOSHOW') || s.includes('NO SHOW');
}

// ── Componente ────────────────────────────────────────────────────────────────

const PlanningMap: React.FC<PlanningMapProps> = ({ hotelId, erbonConfigured }) => {
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [rows, setRows] = useState<MapRow[]>([]);
  const [bookings, setBookings] = useState<ErbonBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ErbonBooking | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const monthStart = month;
  const monthEnd = endOfMonth(month);
  const daysInMonth = differenceInCalendarDays(monthEnd, monthStart) + 1;
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => addDays(monthStart, i)),
    [monthStart.getTime(), daysInMonth],
  );
  const today = new Date();

  // ── Carregar UHs + reservas ────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true); setError('');
    try {
      if (erbonConfigured) {
        // UHs do Erbon (housekeeping traz todas com tipo/andar)
        const erbonRooms: ErbonRoom[] = await erbonService.fetchHousekeeping(hotelId);
        const mapRows: MapRow[] = erbonRooms.map(r => ({
          key: String(r.idRoom),
          name: r.roomName,
          category: r.roomTypeDescription || 'Sem categoria',
          erbonRoomId: r.idRoom,
        }));
        setRows(mapRows);

        // A API Erbon filtra por data de check-in ESPECÍFICA (não intervalo)
        // — mesma limitação tratada no PickupReport. Fazemos 1 chamada por
        // dia (mês + 30 dias antes, para pegar hospedagens longas em
        // andamento), em lotes paralelos, deduplicando por bookingInternalID.
        const LOOKBACK = 30;
        const totalDays = LOOKBACK + daysInMonth;
        const dates = Array.from({ length: totalDays }, (_, i) =>
          format(addDays(subDays(monthStart, LOOKBACK), i), 'yyyy-MM-dd'));

        const all: ErbonBooking[] = [];
        const seen = new Set<number>();
        const CHUNK = 10;
        for (let i = 0; i < dates.length; i += CHUNK) {
          const settled = await Promise.allSettled(
            dates.slice(i, i + CHUNK).map(date =>
              erbonService.searchBookings(hotelId, { checkin: date })),
          );
          for (const r of settled) {
            if (r.status !== 'fulfilled') continue;
            for (const b of r.value || []) {
              if (!seen.has(b.bookingInternalID)) { seen.add(b.bookingInternalID); all.push(b); }
            }
          }
        }
        setBookings(all.filter(b => !isCancelled(b)));
      } else {
        // Sem Erbon: UHs e categorias do módulo de governança
        const [localRooms, categories]: [HotelRoom[], RoomCategory[]] = await Promise.all([
          governanceService.fetchLocalRooms(hotelId),
          governanceService.fetchCategories(hotelId),
        ]);
        const catMap = new Map(categories.map(c => [c.id, c.name]));
        setRows(localRooms
          .filter(r => r.is_active)
          .map(r => ({
            key: r.id,
            name: r.name,
            category: (r.category_id && catMap.get(r.category_id)) || 'Sem categoria',
          })));
        setBookings([]);
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar o mapa.');
    } finally {
      setLoading(false);
    }
  }, [hotelId, erbonConfigured, monthStart.getTime()]);

  useEffect(() => { load(); }, [load]);

  // ── Agrupar linhas por categoria ───────────────────────────────────────────
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

  // ── Barras por UH ─────────────────────────────────────────────────────────
  const barsByRoom = useMemo(() => {
    const map = new Map<string, Bar[]>();
    const monthEndExcl = addDays(monthEnd, 1);
    for (const b of bookings) {
      if (!b.roomID) continue; // reservas sem UH atribuída não entram no mapa
      let ci: Date, co: Date;
      try { ci = parseISO(b.checkInDateTime); co = parseISO(b.checkOutDateTime); } catch { continue; }
      if (co <= monthStart || ci >= monthEndExcl) continue; // não toca o mês

      const clippedStart = ci < monthStart;
      const clippedEnd = co > monthEndExcl;
      const startIdx = clippedStart ? 0 : differenceInCalendarDays(ci, monthStart);
      const endIdx = clippedEnd ? daysInMonth : differenceInCalendarDays(co, monthStart);

      // Convenção de mapa: barra começa na METADE do dia do check-in e termina
      // na METADE do dia do check-out (bordas cortadas quando extrapola o mês).
      const startPos = clippedStart ? 0 : startIdx + 0.5;
      const endPos = clippedEnd ? daysInMonth : endIdx + 0.5;
      const widthCols = Math.max(endPos - startPos, 0.5);

      const key = String(b.roomID);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ booking: b, startPos, widthCols, clippedStart, clippedEnd });
    }
    return map;
  }, [bookings, monthStart.getTime(), daysInMonth]);

  const unassignedCount = useMemo(
    () => bookings.filter(b => {
      if (b.roomID) return false;
      try {
        const ci = parseISO(b.checkInDateTime); const co = parseISO(b.checkOutDateTime);
        return co > monthStart && ci < addDays(monthEnd, 1);
      } catch { return false; }
    }).length,
    [bookings, monthStart.getTime()],
  );

  // Rola até "hoje" quando o mês visível é o atual
  useEffect(() => {
    if (loading || !scrollRef.current) return;
    if (today >= monthStart && today <= monthEnd) {
      const idx = differenceInCalendarDays(today, monthStart);
      scrollRef.current.scrollLeft = Math.max(0, idx * COL_W - 3 * COL_W);
    }
  }, [loading, monthStart.getTime()]);

  const gridWidth = daysInMonth * COL_W;

  const guestName = (b: ErbonBooking) =>
    b.guestList?.[0]?.name || `Reserva ${b.erbonNumber || b.bookingInternalID}`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Navegação do mês */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-1">
          <button onClick={() => setMonth(m => subMonths(m, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="px-3 text-center min-w-[150px]">
            <p className="text-sm font-bold text-gray-900 dark:text-white capitalize whitespace-nowrap">
              {format(month, 'MMMM yyyy', { locale: ptBR })}
            </p>
          </div>
          <button onClick={() => setMonth(m => addMonths(m, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button onClick={() => setMonth(startOfMonth(new Date()))}
          className="px-3 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
          Hoje
        </button>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-500 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {/* Legenda */}
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
          {unassignedCount} reserva{unassignedCount > 1 ? 's' : ''} do período ainda sem UH atribuída (não aparece{unassignedCount > 1 ? 'm' : ''} no mapa).
        </div>
      )}
      {error && <p className="text-red-500 text-sm">{error}</p>}

      {/* Grade */}
      {loading ? (
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
        <div ref={scrollRef} className="overflow-auto rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-900"
          style={{ maxHeight: 'calc(100vh - 250px)' }}>
          <div style={{ width: LABEL_W + gridWidth, position: 'relative' }}>

            {/* ── Cabeçalho: dias do mês ── */}
            <div className="sticky top-0 z-30 flex" style={{ height: 44 }}>
              <div className="sticky left-0 z-40 flex items-center px-3 bg-gray-800 dark:bg-gray-950 text-white text-[11px] font-black uppercase tracking-wider border-r border-gray-700"
                style={{ width: LABEL_W, minWidth: LABEL_W }}>
                UH
              </div>
              {days.map((d, i) => {
                const isToday = isSameDay(d, today);
                const dow = getDay(d);
                const isWeekend = dow === 0 || dow === 6;
                return (
                  <div key={i}
                    className={`flex flex-col items-center justify-center border-r border-gray-700/40 text-white
                      ${isToday ? 'bg-indigo-600' : isWeekend ? 'bg-gray-700 dark:bg-gray-900' : 'bg-gray-800 dark:bg-gray-950'}`}
                    style={{ width: COL_W, minWidth: COL_W }}>
                    <span className="text-[9px] uppercase opacity-60 leading-none">
                      {format(d, 'EEEEEE', { locale: ptBR })}
                    </span>
                    <span className="text-xs font-black leading-tight">{format(d, 'dd')}</span>
                  </div>
                );
              })}
            </div>

            {/* ── Corpo: categorias e UHs ── */}
            {groups.map(({ category, rooms }) => (
              <React.Fragment key={category}>
                {/* Linha da categoria */}
                <div className="sticky left-0 z-20 flex items-center px-3 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
                  style={{ height: 26, width: LABEL_W + gridWidth }}>
                  <span className="sticky left-3 text-[10px] font-black text-gray-600 dark:text-gray-300 uppercase tracking-widest">
                    {category} <span className="font-normal text-gray-400">({rooms.length})</span>
                  </span>
                </div>

                {rooms.map((room, ri) => {
                  const bars = barsByRoom.get(room.key) || [];
                  return (
                    <div key={room.key} className="flex relative border-b border-gray-100 dark:border-gray-800"
                      style={{ height: ROW_H }}>
                      {/* Nome da UH — fixo à esquerda */}
                      <div className={`sticky left-0 z-20 flex items-center px-3 border-r border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200
                        ${ri % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/60'}`}
                        style={{ width: LABEL_W, minWidth: LABEL_W }}>
                        {room.name}
                      </div>

                      {/* Células dos dias (fundo) */}
                      <div className="relative" style={{ width: gridWidth, minWidth: gridWidth }}>
                        <div className="absolute inset-0 flex">
                          {days.map((d, i) => {
                            const isToday = isSameDay(d, today);
                            const dow = getDay(d);
                            const isWeekend = dow === 0 || dow === 6;
                            return (
                              <div key={i}
                                className={`border-r border-gray-100 dark:border-gray-800 h-full
                                  ${isToday ? 'bg-indigo-50/70 dark:bg-indigo-900/20' : isWeekend ? 'bg-gray-50/80 dark:bg-gray-800/40' : ''}`}
                                style={{ width: COL_W, minWidth: COL_W }} />
                            );
                          })}
                        </div>

                        {/* Barras de reserva */}
                        {bars.map((bar, bi) => {
                          const colors = barColor(bar.booking);
                          return (
                            <button key={bi}
                              onClick={() => setSelected(bar.booking)}
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
      )}

      {/* ── Popover de detalhes da reserva ── */}
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
