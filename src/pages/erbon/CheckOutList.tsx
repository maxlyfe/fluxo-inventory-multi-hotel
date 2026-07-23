// src/pages/erbon/CheckOutList.tsx
import React, { useState, useMemo } from 'react';
import {
  LogOut, LogIn, RefreshCw, Loader2, Calendar, Users, BedDouble,
  Search, Clock, UserCheck, ChevronRight,
} from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonBooking } from '../../lib/erbonService';
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

interface CheckoutRow {
  bookingId: number;
  bookingNumber: string;
  room: string;
  guestName: string;
  guestCount: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: string;
  isCheckedOut: boolean;
  isCancelled: boolean;
  /** Só quem está na casa (status CHECKIN) pode dar check-out */
  canCheckOut: boolean;
}

// Cancelamento pode vir em status OU confirmedStatus, com grafias variadas
// (CANCELLED/CANCELADA) — normaliza para não deixar cancelada passar
function isCancelledBooking(b: ErbonBooking): boolean {
  return `${b.status || ''} ${(b as any).confirmedStatus || ''}`.toUpperCase().includes('CANCEL');
}

function bookingToRow(b: ErbonBooking): CheckoutRow {
  const cancelled = isCancelledBooking(b);
  return {
    bookingId: b.bookingInternalID,
    bookingNumber: String(b.erbonNumber),
    room: b.roomDescription || b.roomTypeDescription || '',
    guestName: b.guestList?.[0]?.name || 'Hóspede',
    guestCount: b.guestList?.length || 0,
    checkIn: b.checkInDateTime,
    checkOut: b.checkOutDateTime,
    nights: getNights(b.checkInDateTime, b.checkOutDateTime),
    status: b.status,
    isCheckedOut: !cancelled && b.status === 'CHECKOUT',
    isCancelled: cancelled,
    canCheckOut: !cancelled && b.status === 'CHECKIN',
  };
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

const InfoRow: React.FC<{ icon: React.ComponentType<any>; value: string }> = ({ icon: Icon, value }) => (
  <div className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700/50">
    <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" /><span className="truncate">{value}</span>
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────

const CheckOutList: React.FC = () => {
  const { selectedHotel } = useHotel();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(today);
  const [view, setView] = useState<'pendentes' | 'realizados'>('pendentes');
  const [search, setSearch] = useState('');
  const [selectedRow, setSelectedRow] = useState<CheckoutRow | null>(null);

  const { data: bookings, loading, error, refetch, erbonConfigured } = useErbonData<ErbonBooking[]>(
    (hotelId) => erbonService.searchBookings(hotelId, { checkout: date }),
    [date],
  );

  // Canceladas continuam visíveis (com badge), mas sem ação de check-out
  const bookingRows = useMemo(() => (bookings || []).map(bookingToRow), [bookings]);

  // Pendentes: saída prevista na data e ainda não saíram; Realizados: já saíram
  const pendingRows = useMemo(() => bookingRows.filter(r => !r.isCheckedOut), [bookingRows]);
  const doneRows = useMemo(() => bookingRows.filter(r => r.isCheckedOut), [bookingRows]);
  const viewRows = view === 'pendentes' ? pendingRows : doneRows;

  const filtered = useMemo(() => {
    if (!search.trim()) return viewRows;
    const q = search.toLowerCase();
    return viewRows.filter(row =>
      row.guestName?.toLowerCase().includes(q) ||
      row.bookingNumber?.includes(q) ||
      row.room?.toLowerCase().includes(q)
    );
  }, [viewRows, search]);

  const totalGuests = filtered.reduce((sum, row) => sum + (row.guestCount || 1), 0);

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <LogOut className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Check-outs</h1>
          </div>
          {!loading && (
            <div className="flex items-center gap-2 pl-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                <BedDouble className="w-3.5 h-3.5" /> {filtered.length} reservas
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                <Users className="w-3.5 h-3.5" /> {totalGuests} hóspedes
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="date"
              value={date}
              onChange={e => e.target.value && setDate(e.target.value)}
              className="pl-9 pr-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent shadow-sm"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar hóspede, UH ou reserva..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-amber-500 focus:border-transparent w-72 shadow-sm"
            />
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
      </div>

      {/* Abas: pendentes × realizados na data escolhida */}
      <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 max-w-md">
        <button
          onClick={() => setView('pendentes')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${view === 'pendentes' ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
          <Clock className="w-4 h-4" /> Pendentes
          <span className={`px-1.5 py-0.5 rounded-full text-xs ${view === 'pendentes' ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'}`}>{pendingRows.length}</span>
        </button>
        <button
          onClick={() => setView('realizados')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${view === 'realizados' ? 'bg-sky-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
          <UserCheck className="w-4 h-4" /> Realizados
          <span className={`px-1.5 py-0.5 rounded-full text-xs ${view === 'realizados' ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'}`}>{doneRows.length}</span>
        </button>
      </div>

      {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-700">
          <UserCheck className="w-14 h-14 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-600 dark:text-gray-400 font-semibold text-lg">
            {view === 'pendentes' ? 'Nenhum check-out pendente' : 'Nenhum check-out realizado'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {view === 'pendentes'
              ? 'Não há check-outs aguardando saída na data escolhida.'
              : 'Nenhuma reserva deu saída na data escolhida.'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {filtered.map((row, idx) => {
            const isLast = idx === filtered.length - 1;
            const guestCount = row.guestCount;
            return (
              <button
                key={row.bookingId}
                onClick={() => setSelectedRow(row)}
                className={`w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors group border-l-4 border-transparent hover:border-amber-500 ${!isLast ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}
              >
                {/* Room badge */}
                <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shadow-sm">
                  <span className="text-xl font-black text-amber-700 dark:text-amber-300 leading-none text-center px-1">{row.room || '—'}</span>
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs text-gray-400 font-medium">#{row.bookingNumber}</span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="font-bold text-gray-800 dark:text-white truncate">{row.guestName}</span>
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
                      <LogOut className="w-3 h-3 text-amber-500" />
                      {fmtDate(row.checkOut)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold">
                      {row.nights}N
                    </span>
                  </div>
                </div>

                {/* Right side: status + action */}
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                    row.isCancelled ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : row.isCheckedOut ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                    : row.canCheckOut ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}>
                    {row.isCancelled ? 'Cancelada'
                      : row.isCheckedOut ? 'Check-out Feito'
                      : row.canCheckOut ? 'Aguardando saída'
                      : 'Sem check-in'}
                  </span>
                  <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 group-hover:underline">
                    {row.canCheckOut ? 'Fazer Check-out' : 'Ver detalhes / NF'}
                  </span>
                </div>

                {/* Arrow */}
                <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-amber-500 transition-colors flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {selectedRow && (
        <BookingDetailModal
          hotelId={selectedHotel!.id}
          booking={(bookings || []).find(b => b.bookingInternalID === selectedRow.bookingId) || null}
          bookingInternalId={selectedRow.bookingId}
          onClose={() => setSelectedRow(null)}
          onActionDone={refetch}
        />
      )}
    </div>
  );
};

export default CheckOutList;
