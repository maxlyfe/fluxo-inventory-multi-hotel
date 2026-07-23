// src/pages/erbon/InHouse.tsx
import React, { useState, useMemo } from 'react';
import {
  Users, RefreshCw, Loader2, Search, BedDouble, ChevronRight,
} from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonGuest } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';
import BookingDetailModal from './BookingDetailModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd/MM/yyyy', { locale: ptBR }); } catch { return d; }
}
function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  try { return format(parseISO(d), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); } catch { return d; }
}
function fmtBRL(v?: number | null) {
  if (v == null) return 'R$ 0,00';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function getNights(a?: string, b?: string) {
  if (!a || !b) return 0;
  try { return differenceInDays(parseISO(b), parseISO(a)); } catch { return 0; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface InHouseRow {
  bookingId: number;
  bookingNumber: string;
  room: string;
  mainGuest: ErbonGuest;
  allGuests: ErbonGuest[];
  checkIn: string;
  checkOut: string;
  mealPlan: string;
  nights: number;
}

// ── Grouping logic ────────────────────────────────────────────────────────────

function groupByBooking(guests: ErbonGuest[]): InHouseRow[] {
  const map = new Map<number, InHouseRow>();
  for (const g of guests) {
    if (!map.has(g.idBooking)) {
      map.set(g.idBooking, {
        bookingId: g.idBooking,
        bookingNumber: g.bookingNumber,
        room: g.roomDescription,
        mainGuest: g,
        allGuests: [g],
        checkIn: g.checkInDate,
        checkOut: g.checkOutDate,
        mealPlan: g.mealPlan,
        nights: getNights(g.checkInDate, g.checkOutDate),
      });
    } else {
      map.get(g.idBooking)!.allGuests.push(g);
    }
  }
  return Array.from(map.values());
}

// ── Meal plan labels ──────────────────────────────────────────────────────────

const MEAL_PLAN_LABELS: Record<string, string> = {
  RO: 'Room Only', BB: 'Café da Manhã', HB: 'Meia Pensão', FB: 'Pensão Completa', AI: 'All Inclusive',
};

// ── Small shared UI ───────────────────────────────────────────────────────────

const DetailCard: React.FC<{ icon: React.ComponentType<any>; label: string; value: string; valueColor?: string }> = ({ icon: Icon, label, value, valueColor }) => (
  <div className="bg-white dark:bg-gray-800/60 rounded-xl px-3 py-2.5 border border-gray-100 dark:border-gray-700/50 flex items-center gap-2.5">
    <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-sm font-semibold truncate ${valueColor || 'text-gray-800 dark:text-white'}`}>{value}</p>
    </div>
  </div>
);

const InfoPill: React.FC<{ icon: React.ComponentType<any>; value: string }> = ({ icon: Icon, value }) => (
  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700/50">
    <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" /><span className="truncate">{value}</span>
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────

const InHouse: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [search, setSearch] = useState('');
  const [filterMeal, setFilterMeal] = useState('all');
  const [selectedRow, setSelectedRow] = useState<InHouseRow | null>(null);

  const { data: guests, loading, error, refetch, erbonConfigured } = useErbonData<ErbonGuest[]>(
    (hotelId) => erbonService.fetchInHouseGuests(hotelId),
    [],
    { autoRefreshMs: 120_000 }
  );

  // Group by booking
  const bookingRows = useMemo(() => groupByBooking(guests || []), [guests]);

  // Unique meal plans from grouped rows
  const mealPlans = useMemo(() => {
    const plans = new Set<string>();
    bookingRows.forEach(row => { if (row.mealPlan) plans.add(row.mealPlan); });
    return Array.from(plans).sort();
  }, [bookingRows]);

  // Filter grouped rows
  const filtered = useMemo(() => {
    return bookingRows.filter(row => {
      if (filterMeal !== 'all' && row.mealPlan !== filterMeal) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !row.mainGuest.guestName?.toLowerCase().includes(q) &&
          !row.bookingNumber?.includes(q) &&
          !row.room?.toLowerCase().includes(q) &&
          !row.allGuests.some(g => g.guestName?.toLowerCase().includes(q))
        ) return false;
      }
      return true;
    });
  }, [bookingRows, search, filterMeal]);

  const totalGuests = filtered.reduce((sum, row) => sum + row.allGuests.length, 0);

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
              <Users className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">In House</h1>
          </div>
          {!loading && (
            <div className="flex items-center gap-2 pl-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300">
                <BedDouble className="w-3.5 h-3.5" /> {filtered.length} reservas
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                <Users className="w-3.5 h-3.5" /> {totalGuests} hóspedes
              </span>
            </div>
          )}
        </div>
        <button
          onClick={refetch}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition font-medium text-gray-600 dark:text-gray-300"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar hóspede, reserva ou quarto..."
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:ring-2 focus:ring-sky-500 focus:border-transparent shadow-sm"
          />
        </div>
        <select
          value={filterMeal}
          onChange={e => setFilterMeal(e.target.value)}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 shadow-sm focus:ring-2 focus:ring-sky-500"
        >
          <option value="all">Todos os Planos</option>
          {mealPlans.map(mp => <option key={mp} value={mp}>{MEAL_PLAN_LABELS[mp] || mp}</option>)}
        </select>
      </div>

      {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

      {loading && !guests ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-700">
          <Users className="w-14 h-14 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-600 dark:text-gray-400 font-semibold text-lg">Nenhum hóspede encontrado</p>
          <p className="text-sm text-gray-400 mt-1">Não há hóspedes in-house com os filtros aplicados.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {filtered.map((row, idx) => {
            const isLast = idx === filtered.length - 1;
            const guestCount = row.allGuests.length;
            return (
              <button
                key={row.bookingId}
                onClick={() => setSelectedRow(row)}
                className={`w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-sky-50 dark:hover:bg-sky-900/10 transition-colors group border-l-4 border-transparent hover:border-sky-500 ${!isLast ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}
              >
                {/* Room badge */}
                <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center shadow-sm">
                  <span className="text-xl font-black text-sky-700 dark:text-sky-300 leading-none text-center px-1">{row.room || '—'}</span>
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs text-gray-400 font-medium">#{row.bookingNumber}</span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="font-bold text-gray-800 dark:text-white truncate">
                      {row.mainGuest.guestName}
                      {row.mainGuest.lastName && row.mainGuest.lastName !== row.mainGuest.guestName ? ` ${row.mainGuest.lastName}` : ''}
                    </span>
                  </div>
                  {guestCount > 1 && (
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      <Users className="w-3 h-3" /> +{guestCount - 1} hóspede{guestCount > 2 ? 's' : ''}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <LogIn className="w-3 h-3 text-emerald-500" />
                      {fmtDate(row.checkIn)}
                    </span>
                    <span className="text-gray-300">→</span>
                    <span className="flex items-center gap-1">
                      <LogOut className="w-3 h-3 text-gray-400" />
                      {fmtDate(row.checkOut)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold">
                      {row.nights}N
                    </span>
                  </div>
                </div>

                {/* Right side: meal plan badge */}
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  {row.mealPlan && (
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300">
                      {MEAL_PLAN_LABELS[row.mealPlan] || row.mealPlan}
                    </span>
                  )}
                  <span className="text-xs font-semibold text-sky-600 dark:text-sky-400 group-hover:underline">
                    Ver detalhes
                  </span>
                </div>

                {/* Arrow */}
                <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-sky-500 transition-colors flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {selectedRow && (
        <BookingDetailModal
          hotelId={selectedHotel!.id}
          bookingInternalId={selectedRow.bookingId}
          onClose={() => setSelectedRow(null)}
          onActionDone={refetch}
        />
      )}
    </div>
  );
};

export default InHouse;
