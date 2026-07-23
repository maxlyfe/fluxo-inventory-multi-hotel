// src/pages/erbon/CheckInList.tsx
import React, { useState } from 'react';
import {
  LogIn, LogOut, RefreshCw, Loader2, Calendar, BedDouble, Users,
  UserCheck, Search, Clock, ChevronRight,
} from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonBooking } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';
import BookingDetailModal from './BookingDetailModal';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  BOOKING:    'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  CONFIRMED:  'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  PENDING:    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  CHECKIN:    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  CHECKOUT:   'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  CANCELLED:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  CANCELADA:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  NOSHOW:     'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
};
const STATUS_LABEL: Record<string, string> = {
  BOOKING:   'Reserva',
  CONFIRMED: 'Confirmada',
  PENDING:   'Pendente',
  CHECKIN:   'Check-in Feito',
  CHECKOUT:  'Check-out Feito',
  CANCELLED: 'Cancelada',
  CANCELADA: 'Cancelada',
  NOSHOW:    'No-Show',
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

const FormField: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string }> = ({ label, value, onChange, type = 'text' }) => (
  <div>
    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────

const CheckInList: React.FC = () => {
  const { selectedHotel } = useHotel();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(today);
  const [view, setView] = useState<'pendentes' | 'realizados'>('pendentes');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ErbonBooking | null>(null);

  const { data: bookings, loading, error, refetch, erbonConfigured } = useErbonData<ErbonBooking[]>(
    (hotelId) => erbonService.searchBookings(hotelId, { checkin: date }),
    [date],
  );

  // Pendentes: ainda não entraram (canceladas continuam visíveis, com badge,
  // mas o modal bloqueia o check-in); Realizados: já deram entrada na data
  const pending = (bookings || []).filter(b => b.status !== 'CHECKIN' && b.status !== 'CHECKOUT');
  const done = (bookings || []).filter(b => b.status === 'CHECKIN' || b.status === 'CHECKOUT');
  const viewList = view === 'pendentes' ? pending : done;

  const filtered = search.trim()
    ? viewList.filter(b =>
        b.guestList?.some(g => g.name?.toLowerCase().includes(search.toLowerCase())) ||
        String(b.erbonNumber).includes(search) ||
        b.roomDescription?.toLowerCase().includes(search.toLowerCase())
      )
    : viewList;

  const totalGuests = filtered.reduce((sum, b) => sum + (b.guestList?.length || 0), 0);

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <LogIn className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Check-ins</h1>
          </div>
          {!loading && (
            <div className="flex items-center gap-2 ml-13 pl-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
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
              className="pl-9 pr-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent shadow-sm"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar hóspede, UH ou reserva..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent w-72 shadow-sm"
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
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${view === 'pendentes' ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
          <Clock className="w-4 h-4" /> Pendentes
          <span className={`px-1.5 py-0.5 rounded-full text-xs ${view === 'pendentes' ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'}`}>{pending.length}</span>
        </button>
        <button
          onClick={() => setView('realizados')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${view === 'realizados' ? 'bg-sky-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
          <UserCheck className="w-4 h-4" /> Realizados
          <span className={`px-1.5 py-0.5 rounded-full text-xs ${view === 'realizados' ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'}`}>{done.length}</span>
        </button>
      </div>

      {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-700">
          <UserCheck className="w-14 h-14 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-600 dark:text-gray-400 font-semibold text-lg">
            {view === 'pendentes' ? 'Nenhum check-in pendente' : 'Nenhum check-in realizado'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {view === 'pendentes'
              ? 'Todos os hóspedes já realizaram check-in ou não há reservas para a data escolhida.'
              : 'Nenhuma reserva deu entrada na data escolhida.'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {filtered.map((booking, idx) => {
            const mainGuest = booking.guestList?.[0];
            const guestCount = booking.guestList?.length || 0;
            const nights = getNights(booking.checkInDateTime, booking.checkOutDateTime);
            const isLast = idx === filtered.length - 1;
            return (
              <button
                key={booking.bookingInternalID}
                onClick={() => setSelected(booking)}
                className={`w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors group border-l-4 border-transparent hover:border-emerald-500 ${!isLast ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}
              >
                {/* Room badge */}
                <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shadow-sm">
                  <span className="text-xl font-black text-emerald-700 dark:text-emerald-300 leading-none text-center px-1">{booking.roomDescription || '—'}</span>
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs text-gray-400 font-medium">#{booking.erbonNumber}</span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="font-bold text-gray-800 dark:text-white truncate">{mainGuest?.name || 'Hóspede'}</span>
                  </div>
                  {guestCount > 1 && (
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      <Users className="w-3 h-3" /> +{guestCount - 1} hóspede{guestCount > 2 ? 's' : ''}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <LogIn className="w-3 h-3 text-emerald-500" />
                      {fmtDate(booking.checkInDateTime)}
                    </span>
                    <span className="text-gray-300">→</span>
                    <span className="flex items-center gap-1">
                      <LogOut className="w-3 h-3 text-gray-400" />
                      {fmtDate(booking.checkOutDateTime)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold">
                      {nights}N
                    </span>
                  </div>
                </div>

                {/* Right side */}
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${STATUS_STYLE[booking.status] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[booking.status] || booking.status}
                  </span>
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-200">
                    {fmtBRL(booking.totalBookingRateWithTax)}
                  </span>
                </div>

                {/* Arrow */}
                <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-emerald-500 transition-colors flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <BookingDetailModal
          hotelId={selectedHotel!.id}
          booking={selected}
          onClose={() => setSelected(null)}
          onActionDone={refetch}
        />
      )}
    </div>
  );
};

export default CheckInList;
