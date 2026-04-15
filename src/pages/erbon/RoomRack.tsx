import React, { useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Loader2, Wrench, UserCheck, BedDouble,
  User, Users, Calendar, Mail, Phone, CreditCard, LogIn, LogOut,
  Clock, DollarSign, FileText, X, MapPin,
  Globe, Utensils, Coffee, Moon, Star, Sparkles,
} from 'lucide-react';
import { erbonService, ErbonRoom, ErbonBooking, ErbonGuest } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';
import Modal from '../../components/Modal';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd/MM/yyyy', { locale: ptBR }); } catch { return d; }
}
function fmtDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  try { return format(parseISO(d), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); } catch { return d; }
}
function fmtCurrency(v: number | null | undefined): string {
  if (v == null) return 'R$ 0,00';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function getNights(a: string, b: string): number {
  try { return differenceInDays(parseISO(b), parseISO(a)); } catch { return 0; }
}
function getMealLabel(p: string | null | undefined): string {
  if (!p) return '—';
  const m: Record<string, string> = { RO: 'Room Only', BB: 'Café da manhã', HB: 'Meia pensão', FB: 'Pensão completa', AI: 'All Inclusive' };
  return m[p.toUpperCase()] || p;
}
function getMealIcon(p: string | null | undefined) {
  if (!p) return Coffee;
  const u = p.toUpperCase();
  if (u === 'FB' || u === 'AI') return Utensils;
  if (u === 'HB') return Moon;
  return Coffee;
}

// ═══════════════════════════════════════════════════════════════════════════
// SVG DOOR ILLUSTRATIONS
// ═══════════════════════════════════════════════════════════════════════════

/** Porta aberta — quarto livre */
const DoorOpen: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 80" fill="none" className={className}>
    {/* Door frame */}
    <rect x="8" y="4" width="48" height="72" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    {/* Open door (perspective) */}
    <path d="M8 4 L28 12 L28 68 L8 76 Z" fill="currentColor" opacity="0.08" stroke="currentColor" strokeWidth="1.5" />
    {/* Interior visible */}
    <rect x="28" y="12" width="24" height="56" fill="currentColor" opacity="0.04" />
    {/* Door handle */}
    <circle cx="24" cy="42" r="2" fill="currentColor" opacity="0.5" />
    {/* Light rays from inside */}
    <line x1="32" y1="30" x2="40" y2="28" stroke="currentColor" strokeWidth="1" opacity="0.15" />
    <line x1="32" y1="40" x2="42" y2="40" stroke="currentColor" strokeWidth="1" opacity="0.15" />
    <line x1="32" y1="50" x2="40" y2="52" stroke="currentColor" strokeWidth="1" opacity="0.15" />
  </svg>
);

/** Porta fechada — quarto ocupado */
const DoorClosed: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 80" fill="none" className={className}>
    {/* Door frame */}
    <rect x="8" y="4" width="48" height="72" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    {/* Closed door */}
    <rect x="10" y="6" width="44" height="68" rx="2" fill="currentColor" opacity="0.12" />
    {/* Door panels */}
    <rect x="16" y="12" width="32" height="24" rx="1.5" stroke="currentColor" strokeWidth="1" opacity="0.15" />
    <rect x="16" y="42" width="32" height="24" rx="1.5" stroke="currentColor" strokeWidth="1" opacity="0.15" />
    {/* Door handle */}
    <circle cx="44" cy="42" r="2.5" fill="currentColor" opacity="0.4" />
    <rect x="42" y="44" width="4" height="6" rx="1" fill="currentColor" opacity="0.25" />
    {/* Lock indicator */}
    <rect x="41" y="38" width="6" height="4" rx="1" fill="currentColor" opacity="0.3" />
  </svg>
);

/** Porta com faixa — manutenção */
const DoorBlocked: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 80" fill="none" className={className}>
    {/* Door frame */}
    <rect x="8" y="4" width="48" height="72" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    {/* Closed door */}
    <rect x="10" y="6" width="44" height="68" rx="2" fill="currentColor" opacity="0.08" />
    {/* X mark */}
    <line x1="18" y1="20" x2="46" y2="56" stroke="currentColor" strokeWidth="2.5" opacity="0.35" strokeLinecap="round" />
    <line x1="46" y1="20" x2="18" y2="56" stroke="currentColor" strokeWidth="2.5" opacity="0.35" strokeLinecap="round" />
    {/* Barrier tape stripes */}
    <rect x="4" y="34" width="56" height="8" rx="1" fill="currentColor" opacity="0.15" />
    <line x1="4" y1="34" x2="12" y2="42" stroke="currentColor" strokeWidth="2" opacity="0.25" />
    <line x1="12" y1="34" x2="20" y2="42" stroke="currentColor" strokeWidth="2" opacity="0.25" />
    <line x1="20" y1="34" x2="28" y2="42" stroke="currentColor" strokeWidth="2" opacity="0.25" />
    <line x1="28" y1="34" x2="36" y2="42" stroke="currentColor" strokeWidth="2" opacity="0.25" />
    <line x1="36" y1="34" x2="44" y2="42" stroke="currentColor" strokeWidth="2" opacity="0.25" />
    <line x1="44" y1="34" x2="52" y2="42" stroke="currentColor" strokeWidth="2" opacity="0.25" />
    <line x1="52" y1="34" x2="60" y2="42" stroke="currentColor" strokeWidth="2" opacity="0.25" />
  </svg>
);

/** DND — Do Not Disturb (ocupado + sujo) */
const DoorDND: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 80" fill="none" className={className}>
    {/* Door frame */}
    <rect x="8" y="4" width="48" height="72" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    {/* Closed door */}
    <rect x="10" y="6" width="44" height="68" rx="2" fill="currentColor" opacity="0.12" />
    {/* Door panels */}
    <rect x="16" y="12" width="32" height="24" rx="1.5" stroke="currentColor" strokeWidth="1" opacity="0.12" />
    <rect x="16" y="42" width="32" height="24" rx="1.5" stroke="currentColor" strokeWidth="1" opacity="0.12" />
    {/* DND hanger */}
    <ellipse cx="32" cy="6" rx="12" ry="3" fill="currentColor" opacity="0.25" />
    <rect x="22" y="2" width="20" height="10" rx="3" fill="currentColor" opacity="0.2" />
    {/* Door handle */}
    <circle cx="44" cy="42" r="2.5" fill="currentColor" opacity="0.35" />
  </svg>
);

// ═══════════════════════════════════════════════════════════════════════════
// ROOM CARD — DOOR CONCEPT
// ═══════════════════════════════════════════════════════════════════════════

interface RoomCardProps {
  room: ErbonRoom;
  onSelect: () => void;
  onToggleStatus: (e: React.MouseEvent) => void;
  isUpdating: boolean;
}

const RoomCard: React.FC<RoomCardProps> = React.memo(({ room, onSelect, onToggleStatus, isUpdating }) => {
  const isOccupied = room.currentlyOccupiedOrAvailable === 'Ocupado';
  const isClean = room.idHousekeepingStatus === 'CLEAN';
  const isMaint = room.inMaintenance;

  // Pick door + colors
  let DoorIcon = DoorOpen;
  let doorColor = 'text-emerald-500';
  let cardBg = 'from-emerald-950/40 to-gray-900';
  let borderColor = 'border-emerald-500/25 hover:border-emerald-400/50';
  let numberColor = 'text-emerald-400';
  let glowColor = 'shadow-emerald-500/10';
  let statusLabel = 'Disponível';
  let statusDot = 'bg-emerald-400';

  if (isMaint) {
    DoorIcon = DoorBlocked;
    doorColor = 'text-rose-500';
    cardBg = 'from-rose-950/40 to-gray-900';
    borderColor = 'border-rose-500/30 hover:border-rose-400/50';
    numberColor = 'text-rose-400';
    glowColor = 'shadow-rose-500/10';
    statusLabel = 'Manutenção';
    statusDot = 'bg-rose-400';
  } else if (isOccupied && !isClean) {
    DoorIcon = DoorDND;
    doorColor = 'text-amber-500';
    cardBg = 'from-amber-950/30 to-gray-900';
    borderColor = 'border-amber-500/25 hover:border-amber-400/50';
    numberColor = 'text-amber-400';
    glowColor = 'shadow-amber-500/10';
    statusLabel = 'Ocupado · Sujo';
    statusDot = 'bg-amber-400';
  } else if (isOccupied) {
    DoorIcon = DoorClosed;
    doorColor = 'text-sky-500';
    cardBg = 'from-sky-950/40 to-gray-900';
    borderColor = 'border-sky-500/25 hover:border-sky-400/50';
    numberColor = 'text-sky-400';
    glowColor = 'shadow-sky-500/10';
    statusLabel = 'Ocupado';
    statusDot = 'bg-sky-400';
  } else if (!isClean) {
    DoorIcon = DoorOpen;
    doorColor = 'text-amber-500';
    cardBg = 'from-amber-950/30 to-gray-900';
    borderColor = 'border-amber-500/25 hover:border-amber-400/50';
    numberColor = 'text-amber-400';
    glowColor = 'shadow-amber-500/10';
    statusLabel = 'Livre · Sujo';
    statusDot = 'bg-amber-400';
  }

  return (
    <div
      onClick={onSelect}
      className={`group relative border rounded-2xl overflow-hidden cursor-pointer
        transition-all duration-300 hover:scale-[1.04] hover:shadow-xl ${glowColor}
        bg-gradient-to-b ${cardBg} ${borderColor}`}
    >
      {/* ── Door illustration ── */}
      <div className="relative flex items-center justify-center pt-3 pb-1">
        <DoorIcon className={`w-12 h-14 ${doorColor} transition-transform duration-300 group-hover:scale-110`} />

        {/* Room number overlay on door */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xl font-black ${numberColor} drop-shadow-lg`}>
            {room.roomName}
          </span>
        </div>

        {/* Badges top-right */}
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-0.5">
          {room.hasCheckinToday && (
            <span className="w-5 h-5 rounded-full bg-violet-500/30 flex items-center justify-center" title="Check-in hoje">
              <LogIn className="w-2.5 h-2.5 text-violet-400" />
            </span>
          )}
          {isMaint && (
            <span className="w-5 h-5 rounded-full bg-rose-500/30 flex items-center justify-center" title="Manutenção">
              <Wrench className="w-2.5 h-2.5 text-rose-400" />
            </span>
          )}
        </div>

        {/* Floor badge top-left */}
        {room.numberFloor > 0 && (
          <span className="absolute top-1.5 left-1.5 text-[9px] font-bold text-gray-500 bg-gray-800/60 px-1.5 py-0.5 rounded-md">
            {room.numberFloor}°
          </span>
        )}
      </div>

      {/* ── Info area ── */}
      <div className="px-2.5 pb-2.5">
        {/* Status line */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot} animate-pulse`} />
          <span className="text-[10px] font-semibold text-gray-400">{statusLabel}</span>
        </div>

        {/* Guest name or Available */}
        {isOccupied && room.bookingHolderName ? (
          <div className="min-h-[28px]">
            <p className="text-[11px] text-gray-300 truncate leading-tight font-medium" title={room.bookingHolderName}>
              {room.bookingHolderName}
            </p>
            {(room.adultCount || room.childrenCount) && (
              <p className="text-[9px] text-gray-500 mt-0.5 flex items-center gap-0.5">
                <User className="w-2.5 h-2.5" />
                {room.adultCount || 0}{room.childrenCount ? ` +${room.childrenCount}` : ''}
              </p>
            )}
          </div>
        ) : (
          <div className="min-h-[28px] flex items-center">
            {!isMaint && (
              <span className={`text-[10px] italic ${isClean ? 'text-emerald-600' : 'text-amber-600'}`}>
                {isClean ? 'Pronto para hóspede' : 'Aguarda limpeza'}
              </span>
            )}
          </div>
        )}

        {/* Housekeeping toggle */}
        {!isMaint && (
          <button
            onClick={onToggleStatus}
            disabled={isUpdating}
            className={`mt-1 w-full text-[9px] font-bold py-1.5 rounded-lg transition-all duration-200 disabled:opacity-40 uppercase tracking-wider
              ${isClean
                ? 'bg-gray-800/60 hover:bg-amber-500/20 text-gray-500 hover:text-amber-400 border border-gray-700/50 hover:border-amber-500/30'
                : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 border border-emerald-500/25 hover:border-emerald-400/40'
              }`}
          >
            {isUpdating
              ? <Loader2 className="w-3 h-3 mx-auto animate-spin" />
              : isClean ? 'Marcar sujo' : '✓ Limpo'
            }
          </button>
        )}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// STAT CARD
// ═══════════════════════════════════════════════════════════════════════════

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<any>;
  color: string;
  active?: boolean;
  onClick: () => void;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, color, active, onClick }) => (
  <button onClick={onClick}
    className={`relative overflow-hidden rounded-xl px-4 py-3 text-left transition-all duration-200 border
      ${active
        ? `bg-gray-800 border-gray-600 shadow-lg`
        : 'bg-gray-900/60 border-gray-800 hover:bg-gray-800/80 hover:border-gray-700'
      }`}
  >
    <div className="flex items-center gap-3">
      <Icon className={`w-5 h-5 ${color}`} />
      <div>
        <p className={`text-xl font-black leading-none ${active ? 'text-white' : 'text-gray-300'}`}>{value}</p>
        <p className="text-[10px] text-gray-500 mt-0.5 font-medium">{label}</p>
      </div>
    </div>
  </button>
);

// ═══════════════════════════════════════════════════════════════════════════
// RESERVATION DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════

const ReservationModal: React.FC<{
  isOpen: boolean; onClose: () => void; room: ErbonRoom; hotelId: string;
}> = ({ isOpen, onClose, room, hotelId }) => {
  const [booking, setBooking] = useState<ErbonBooking | null>(null);
  const [allGuests, setAllGuests] = useState<ErbonGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'reserva' | 'hospede' | 'conta'>('reserva');

  React.useEffect(() => {
    if (!isOpen) return;
    if (!room.currentBookingID) { setLoading(false); return; }
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const [bookings, inHouseGuests] = await Promise.all([
          erbonService.searchBookings(hotelId, { bookingNumber: String(room.currentBookingID) }),
          erbonService.fetchInHouseGuests(hotelId),
        ]);
        if (bookings.length > 0) setBooking(bookings[0]);
        // Filtrar TODOS os hóspedes desta reserva (por bookingID ou por quarto)
        const roomGuests = inHouseGuests.filter(g =>
          g.idBooking === room.currentBookingID ||
          g.roomDescription === room.roomName
        );
        setAllGuests(roomGuests);
        console.log(`[RoomRack] Booking ${room.currentBookingID}: ${bookings.length} bookings, ${roomGuests.length} in-house guests, guestList: ${bookings[0]?.guestList?.length || 0}`);
      } catch (err: any) { setError(err.message); }
      finally { setLoading(false); }
    };
    load();
  }, [isOpen, room, hotelId]);

  if (!isOpen) return null;

  const isOccupied = room.currentlyOccupiedOrAvailable === 'Ocupado';
  const nights = booking ? getNights(booking.checkInDateTime, booking.checkOutDateTime) : 0;
  const guestName = booking?.guestList?.[0]?.name || allGuests[0]?.guestName || room.bookingHolderName || 'Hóspede';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="4xl">
      {/* Hero header */}
      <div className="-mt-4 -mx-4 mb-5">
        <div className={`relative overflow-hidden rounded-t-lg ${
          room.inMaintenance ? 'bg-gradient-to-r from-rose-700 to-rose-600' :
          isOccupied ? 'bg-gradient-to-r from-sky-700 via-sky-600 to-cyan-600' :
          'bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600'
        }`}>
          <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-white/10" />
          <div className="absolute right-8 -bottom-4 w-16 h-16 rounded-full bg-white/5" />
          <div className="relative px-6 py-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-lg">
                <span className="text-xl font-black text-white">{room.roomName}</span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{guestName}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs bg-white/20 text-white/90 px-2 py-0.5 rounded-full font-medium">{room.roomTypeDescription}</span>
                  <span className="text-xs text-white/60">{room.numberFloor}° andar</span>
                  {booking && <span className="text-xs text-white/60">· #{booking.erbonNumber}</span>}
                </div>
              </div>
            </div>
            {isOccupied && booking && (
              <div className="hidden sm:flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2">
                <div className="text-center">
                  <p className="text-[10px] text-white/50 uppercase tracking-wide">In</p>
                  <p className="text-sm font-bold text-white">{fmtDate(booking.checkInDateTime)}</p>
                </div>
                <div className="flex flex-col items-center">
                  <div className="w-8 border-t border-white/30" />
                  <span className="text-xs font-bold text-white/80 mt-0.5">{nights}N</span>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-white/50 uppercase tracking-wide">Out</p>
                  <p className="text-sm font-bold text-white">{fmtDate(booking.checkOutDateTime)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-3" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Carregando...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12"><p className="text-red-500">{error}</p></div>
      ) : !booking && allGuests.length === 0 && !isOccupied ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DetailCard icon={BedDouble} label="Tipo" value={room.roomTypeDescription} />
          <DetailCard icon={MapPin} label="Andar" value={`${room.numberFloor}°`} />
          <DetailCard icon={room.idHousekeepingStatus === 'CLEAN' ? Sparkles : Wrench} label="Governança"
            value={room.idHousekeepingStatus === 'CLEAN' ? 'Limpo' : 'Sujo'}
            valueColor={room.idHousekeepingStatus === 'CLEAN' ? 'text-emerald-400' : 'text-amber-400'} />
          <DetailCard icon={room.inMaintenance ? Wrench : BedDouble} label="Status"
            value={room.inMaintenance ? 'Em manutenção' : 'Disponível'}
            valueColor={room.inMaintenance ? 'text-rose-400' : 'text-emerald-400'} />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl mb-5">
            {([
              { key: 'reserva' as const, label: 'Reserva', icon: FileText },
              { key: 'hospede' as const, label: 'Hóspede', icon: User },
              { key: 'conta' as const, label: 'Financeiro', icon: DollarSign },
            ]).map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                  activeTab === tab.key
                    ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}>
                <tab.icon className="w-4 h-4" />{tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'reserva' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <DetailCard icon={FileText} label="Reserva" value={`#${booking?.erbonNumber || guest?.bookingNumber || room.currentBookingID}`} />
                <DetailCard icon={BedDouble} label="UH / Tipo" value={`${room.roomName} · ${room.roomTypeDescription}`} />
                <DetailCard icon={LogIn} label="Check-in" value={fmtDate(booking?.checkInDateTime || guest?.checkInDate)} />
                <DetailCard icon={LogOut} label="Check-out" value={fmtDate(booking?.checkOutDateTime || guest?.checkOutDate)} />
                <DetailCard icon={Clock} label="Noites" value={`${nights}`} />
                <DetailCard icon={Users} label="Hóspedes"
                  value={`${booking?.adultQuantity || room.adultCount || 0} ADL${room.childrenCount ? ` + ${room.childrenCount} CHD` : ''}${room.babyCount ? ` + ${room.babyCount} INF` : ''}`} />
                {(() => { const MI = getMealIcon(guest?.mealPlan); return <DetailCard icon={MI} label="Regime" value={getMealLabel(guest?.mealPlan)} />; })()}
                <DetailCard icon={Star} label="Status" value={booking?.confirmedStatus || booking?.status || '—'} />
              </div>
              {booking && (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-5 border border-gray-200 dark:border-gray-700/50">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-500" /> Resumo Financeiro
                  </h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Diária Média</p>
                      <p className="text-lg font-bold text-gray-800 dark:text-white">{nights > 0 ? fmtCurrency(booking.totalBookingRate / nights) : '—'}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Total s/ Taxa</p>
                      <p className="text-lg font-bold text-gray-800 dark:text-white">{fmtCurrency(booking.totalBookingRate)}</p>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-200 dark:border-emerald-800/50">
                      <p className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 mb-1">Total c/ Taxa</p>
                      <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{fmtCurrency(booking.totalBookingRateWithTax)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                    {booking.rateDesc && <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">Tarifa: <b className="text-gray-700 dark:text-gray-300">{booking.rateDesc}</b></span>}
                    {booking.segmentDesc && <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">Segmento: <b className="text-gray-700 dark:text-gray-300">{booking.segmentDesc}</b></span>}
                    {booking.sourceDesc && <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">Origem: <b className="text-gray-700 dark:text-gray-300">{booking.sourceDesc}</b></span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'hospede' && (
            <GuestTab booking={booking} allGuests={allGuests} />
          )}

          {activeTab === 'conta' && <AccountTab hotelId={hotelId} booking={booking} room={room} />}
        </>
      )}
    </Modal>
  );
};

// ─── Guest Tab ──────────────────────────────────────────────────────────────
const GuestTab: React.FC<{ booking: ErbonBooking | null; allGuests: ErbonGuest[] }> = ({ booking, allGuests }) => {
  // Merge: booking.guestList (dados da reserva) + allGuests (in-house com mais detalhes)
  const bookingGuests = booking?.guestList || [];
  // Map in-house guests by name for enrichment
  const inHouseByName = new Map<string, ErbonGuest>();
  allGuests.forEach(g => {
    const key = g.guestName?.toLowerCase().trim();
    if (key) inHouseByName.set(key, g);
  });

  // Build unified list: booking guests enriched with in-house data
  const unifiedGuests: Array<{
    name: string; email: string; phone: string; role: string;
    documents: Array<{ documentType: string; number: string }>;
    inHouseData?: ErbonGuest;
  }> = [];

  const addedNames = new Set<string>();

  bookingGuests.forEach((g, idx) => {
    const key = g.name?.toLowerCase().trim();
    const inHouse = key ? inHouseByName.get(key) : undefined;
    unifiedGuests.push({
      name: g.name, email: g.email || inHouse?.contactEmail || '', phone: g.phone || '',
      role: idx === 0 ? 'Titular da reserva' : `Acompanhante ${idx}`,
      documents: g.documents || [],
      inHouseData: inHouse,
    });
    if (key) addedNames.add(key);
  });

  // Add in-house guests not in booking.guestList
  allGuests.forEach(g => {
    const key = g.guestName?.toLowerCase().trim();
    if (key && !addedNames.has(key)) {
      unifiedGuests.push({
        name: g.guestName, email: g.contactEmail || '', phone: '',
        role: unifiedGuests.length === 0 ? 'Titular da reserva' : `Acompanhante ${unifiedGuests.length}`,
        documents: [],
        inHouseData: g,
      });
      addedNames.add(key);
    }
  });

  if (unifiedGuests.length === 0) {
    return (
      <div className="text-center py-10">
        <User className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-500">Nenhuma informação de hóspede disponível.</p>
      </div>
    );
  }

  const gradients = [
    'from-sky-500 to-cyan-400 shadow-sky-500/20',
    'from-violet-500 to-purple-400 shadow-violet-500/20',
    'from-emerald-500 to-teal-400 shadow-emerald-500/20',
    'from-amber-500 to-orange-400 shadow-amber-500/20',
    'from-rose-500 to-pink-400 shadow-rose-500/20',
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          <Users className="w-4 h-4 inline mr-1" />
          {unifiedGuests.length} hóspede{unifiedGuests.length > 1 ? 's' : ''} nesta reserva
        </p>
      </div>

      {unifiedGuests.map((g, idx) => {
        const ih = g.inHouseData;
        return (
          <div key={idx} className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-5 border border-gray-200 dark:border-gray-700/50">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${gradients[idx % gradients.length]} flex items-center justify-center text-white font-bold text-sm shadow-lg`}>
                {g.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-gray-800 dark:text-white truncate">{g.name}</h4>
                <p className="text-xs text-gray-500">{g.role}</p>
              </div>
              {ih?.mealPlan && (
                <span className="text-xs bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 px-2 py-1 rounded-full font-medium">
                  {getMealLabel(ih.mealPlan)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {g.email && <InfoRow icon={Mail} value={g.email} />}
              {g.phone && <InfoRow icon={Phone} value={g.phone} />}
              {g.documents?.map((doc, i) => (
                <InfoRow key={i} icon={CreditCard} value={`${doc.documentType}: ${doc.number}`} />
              ))}
              {ih?.localityGuest && (
                <InfoRow icon={MapPin} value={`${ih.localityGuest}${ih.stateGuest ? `, ${ih.stateGuest}` : ''}`} />
              )}
              {ih?.countryGuestISO && <InfoRow icon={Globe} value={ih.countryGuestISO} />}
              {ih?.birthDate && <InfoRow icon={Calendar} value={`Nascimento: ${fmtDate(ih.birthDate)}`} />}
              {ih?.checkInDate && <InfoRow icon={LogIn} value={`Check-in: ${fmtDate(ih.checkInDate)}`} />}
              {ih?.checkOutDate && <InfoRow icon={LogOut} value={`Check-out: ${fmtDate(ih.checkOutDate)}`} />}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Account Tab ────────────────────────────────────────────────────────────
const AccountTab: React.FC<{ hotelId: string; booking: ErbonBooking | null; room: ErbonRoom }> = ({ hotelId, booking, room }) => {
  const [charges, setCharges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>('');

  React.useEffect(() => {
    if (!booking) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        // 1) Tenta endpoint específico por booking
        const bookingAccount = await erbonService.fetchBookingAccount(hotelId, booking.bookingInternalID);
        if (bookingAccount.length > 0) {
          setCharges(bookingAccount);
          setSource('bookingAccount');
          return;
        }

        // 2) Fallback: buscar contas a receber e filtrar
        const allAccounts = await erbonService.fetchAccountsReceivable(hotelId);
        if (allAccounts.length > 0) {
          // Log keys do primeiro item para debug
          console.log('[RoomRack] AccountReceivable keys:', Object.keys(allAccounts[0]));

          // Tentar filtrar por múltiplas chaves possíveis
          const filtered = allAccounts.filter((c: any) => {
            const matchId = c.bookingInternalID === booking.bookingInternalID ||
              c.idBooking === booking.bookingInternalID ||
              c.bookingId === booking.bookingInternalID;
            const matchNumber = c.bookingNumber === booking.erbonNumber ||
              c.erbonNumber === booking.erbonNumber ||
              c.reservationNumber === booking.erbonNumber ||
              String(c.bookingNumber) === String(booking.erbonNumber);
            const matchRoom = c.roomDescription === room.roomName ||
              c.room === room.roomName ||
              c.roomName === room.roomName ||
              String(c.idRoom) === String(room.idRoom);
            return matchId || matchNumber || matchRoom;
          });

          if (filtered.length > 0) {
            setCharges(filtered);
            setSource('accountsReceivable-filtered');
          } else {
            // Se não conseguiu filtrar, mostra tudo que tem (para debug)
            console.log('[RoomRack] No match found. Booking:', { bookingInternalID: booking.bookingInternalID, erbonNumber: booking.erbonNumber, roomName: room.roomName });
            console.log('[RoomRack] Sample account data (first 2):', JSON.stringify(allAccounts.slice(0, 2)));
            setCharges([]);
            setSource('no-match');
          }
        }
      } catch (err) {
        console.error('[RoomRack] AccountTab error:', err);
        setCharges([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [hotelId, booking, room]);

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-sky-500" /></div>;
  if (!booking) return <div className="text-center py-12"><DollarSign className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" /><p className="text-sm text-gray-500">Dados financeiros indisponíveis.</p></div>;

  // Auto-detect field names from first charge
  const getField = (obj: any, ...keys: string[]): any => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return null;
  };

  const totalCharges = charges.reduce((sum, c) => {
    const val = getField(c, 'valueTotal', 'value', 'amount', 'totalValue', 'debit', 'valor') || 0;
    return sum + Number(val);
  }, 0);

  const totalPayments = charges.reduce((sum, c) => {
    const val = getField(c, 'credit', 'payment', 'creditValue', 'pagamento') || 0;
    return sum + Number(val);
  }, 0);

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-sky-50 dark:bg-sky-900/15 rounded-xl p-4 border border-sky-200 dark:border-sky-800/40">
          <p className="text-[10px] uppercase tracking-wide text-sky-500 mb-1">Diárias</p>
          <p className="text-lg font-bold text-sky-700 dark:text-sky-300">{fmtCurrency(booking.totalBookingRate)}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/15 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800/40">
          <p className="text-[10px] uppercase tracking-wide text-emerald-500 mb-1">Total c/ Taxas</p>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{fmtCurrency(booking.totalBookingRateWithTax)}</p>
        </div>
        <div className="bg-violet-50 dark:bg-violet-900/15 rounded-xl p-4 border border-violet-200 dark:border-violet-800/40">
          <p className="text-[10px] uppercase tracking-wide text-violet-500 mb-1">Taxas</p>
          <p className="text-lg font-bold text-violet-700 dark:text-violet-300">{fmtCurrency(booking.totalBookingRateWithTax - booking.totalBookingRate)}</p>
        </div>
        {charges.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/15 rounded-xl p-4 border border-amber-200 dark:border-amber-800/40">
            <p className="text-[10px] uppercase tracking-wide text-amber-500 mb-1">Extras</p>
            <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{fmtCurrency(totalCharges)}</p>
          </div>
        )}
      </div>

      {/* Charges table */}
      {charges.length > 0 ? (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Extrato da Conta</h4>
            <span className="text-[10px] text-gray-400">{charges.length} lançamento{charges.length > 1 ? 's' : ''}</span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-[10px] uppercase tracking-wide text-gray-400 sticky top-0">
                  <th className="text-left px-4 py-2.5">Descrição</th>
                  <th className="text-left px-4 py-2.5">Depto</th>
                  <th className="text-right px-4 py-2.5">Débito</th>
                  <th className="text-right px-4 py-2.5">Crédito</th>
                  <th className="text-right px-4 py-2.5">Data</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c: any, i: number) => {
                  const desc = getField(c, 'serviceDescription', 'description', 'desc', 'itemDescription', 'descricao') || '—';
                  const dept = getField(c, 'department', 'departmentDescription', 'departamento') || '';
                  const debit = Number(getField(c, 'valueTotal', 'value', 'amount', 'debit', 'valor', 'totalValue') || 0);
                  const credit = Number(getField(c, 'credit', 'payment', 'creditValue', 'pagamento') || 0);
                  const date = getField(c, 'transactionDate', 'date', 'createdAt', 'data', 'postingDate');
                  const canceled = getField(c, 'isCanceled', 'canceled', 'cancelled');

                  return (
                    <tr key={i} className={`border-t border-gray-100 dark:border-gray-800 ${canceled ? 'opacity-40 line-through' : ''}`}>
                      <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 max-w-[200px] truncate" title={desc}>
                        {desc}
                        {getField(c, 'quantity', 'qty') > 1 && <span className="text-gray-400 ml-1">×{getField(c, 'quantity', 'qty')}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{dept}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-red-600 dark:text-red-400">
                        {debit > 0 ? fmtCurrency(debit) : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {credit > 0 ? fmtCurrency(credit) : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500 text-xs whitespace-nowrap">{fmtDate(date)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {(totalCharges > 0 || totalPayments > 0) && (
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 font-semibold">
                    <td colSpan={2} className="px-4 py-3 text-gray-600 dark:text-gray-300 text-xs uppercase">Total</td>
                    <td className="px-4 py-3 text-right font-mono text-red-700 dark:text-red-300">{totalCharges > 0 ? fmtCurrency(totalCharges) : ''}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-300">{totalPayments > 0 ? fmtCurrency(totalPayments) : ''}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700/50">
          <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 mb-1">Nenhum lançamento encontrado na conta.</p>
          <p className="text-xs text-gray-400">Verifique o console para diagnóstico da API.</p>
        </div>
      )}
    </div>
  );
};

// ─── Shared components ──────────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RACK
// ═══════════════════════════════════════════════════════════════════════════

type ActiveFilter = 'all' | 'occupied' | 'free' | 'clean' | 'dirty' | 'maintenance' | 'checkin';

const RoomRack: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [updatingRoom, setUpdatingRoom] = useState<number | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<ErbonRoom | null>(null);

  const { data: rooms, loading, error, refetch, erbonConfigured } = useErbonData<ErbonRoom[]>(
    (hotelId) => erbonService.fetchHousekeeping(hotelId), [], { autoRefreshMs: 60_000 }
  );

  const handleToggleStatus = useCallback(async (room: ErbonRoom, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedHotel?.id) return;
    const newStatus = room.idHousekeepingStatus === 'CLEAN' ? 'DIRTY' : 'CLEAN';
    setUpdatingRoom(room.idRoom);
    try {
      await erbonService.updateHousekeepingStatus(selectedHotel.id, room.idRoom, newStatus);
      addNotification(`UH ${room.roomName} → ${newStatus === 'CLEAN' ? 'Limpo' : 'Sujo'}`, 'success');
      refetch();
    } catch (err: any) { addNotification(`Erro: ${err.message}`, 'error'); }
    finally { setUpdatingRoom(null); }
  }, [selectedHotel?.id, addNotification, refetch]);

  const stats = useMemo(() => {
    if (!rooms) return { total: 0, clean: 0, dirty: 0, occupied: 0, free: 0, maintenance: 0, checkin: 0 };
    return {
      total: rooms.length,
      clean: rooms.filter(r => r.idHousekeepingStatus === 'CLEAN' && !r.inMaintenance).length,
      dirty: rooms.filter(r => r.idHousekeepingStatus === 'DIRTY' && !r.inMaintenance).length,
      occupied: rooms.filter(r => r.currentlyOccupiedOrAvailable === 'Ocupado').length,
      free: rooms.filter(r => r.currentlyOccupiedOrAvailable === 'Livre' && !r.inMaintenance).length,
      maintenance: rooms.filter(r => r.inMaintenance).length,
      checkin: rooms.filter(r => r.hasCheckinToday).length,
    };
  }, [rooms]);

  const filteredRooms = useMemo(() => {
    if (!rooms) return [];
    return rooms.filter(r => {
      switch (activeFilter) {
        case 'occupied': return r.currentlyOccupiedOrAvailable === 'Ocupado';
        case 'free': return r.currentlyOccupiedOrAvailable === 'Livre' && !r.inMaintenance;
        case 'clean': return r.idHousekeepingStatus === 'CLEAN' && !r.inMaintenance;
        case 'dirty': return r.idHousekeepingStatus === 'DIRTY' && !r.inMaintenance;
        case 'maintenance': return r.inMaintenance;
        case 'checkin': return r.hasCheckinToday;
        default: return true;
      }
    });
  }, [rooms, activeFilter]);

  const groupedRooms = useMemo(() => {
    const groups: Record<string, ErbonRoom[]> = {};
    filteredRooms.forEach(r => {
      const key = r.roomTypeDescription || 'Outros';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    Object.values(groups).forEach(arr => arr.sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { numeric: true })));
    return groups;
  }, [filteredRooms]);

  const occPct = stats.total > 0 ? Math.round((stats.occupied / stats.total) * 100) : 0;

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="container mx-auto px-4 py-6 max-w-[1600px]">

        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Rack de UH's</h1>
            <p className="text-sm text-gray-500 mt-1">Atualização automática · {stats.occupied}/{stats.total} ocupados</p>
          </div>
          <button onClick={refetch} disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-gray-800 border border-gray-700 hover:bg-gray-700 transition-all text-gray-300 shadow-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>

        {/* Occupancy bar */}
        <div className="bg-gray-900 rounded-2xl p-5 mb-6 border border-gray-800">
          <div className="flex items-center gap-4 mb-3">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
              occPct > 80 ? 'bg-rose-500/15' : occPct > 50 ? 'bg-amber-500/15' : 'bg-emerald-500/15'
            }`}>
              <span className={`text-2xl font-black ${
                occPct > 80 ? 'text-rose-400' : occPct > 50 ? 'text-amber-400' : 'text-emerald-400'
              }`}>{occPct}%</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-300">Taxa de Ocupação</p>
              <p className="text-xs text-gray-500">{stats.occupied} de {stats.total} unidades</p>
            </div>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${
              occPct > 80 ? 'bg-gradient-to-r from-rose-500 to-rose-400' :
              occPct > 50 ? 'bg-gradient-to-r from-amber-500 to-amber-400' :
              'bg-gradient-to-r from-emerald-500 to-teal-400'
            }`} style={{ width: `${occPct}%` }} />
          </div>
        </div>

        {/* Legend — door visual reference */}
        <div className="flex flex-wrap items-center gap-5 mb-6 px-1">
          <div className="flex items-center gap-2">
            <DoorOpen className="w-5 h-6 text-emerald-500" />
            <span className="text-[11px] text-gray-400 font-medium">Disponível</span>
          </div>
          <div className="flex items-center gap-2">
            <DoorClosed className="w-5 h-6 text-sky-500" />
            <span className="text-[11px] text-gray-400 font-medium">Ocupado</span>
          </div>
          <div className="flex items-center gap-2">
            <DoorDND className="w-5 h-6 text-amber-500" />
            <span className="text-[11px] text-gray-400 font-medium">Ocupado · Sujo</span>
          </div>
          <div className="flex items-center gap-2">
            <DoorOpen className="w-5 h-6 text-amber-500" />
            <span className="text-[11px] text-gray-400 font-medium">Livre · Sujo</span>
          </div>
          <div className="flex items-center gap-2">
            <DoorBlocked className="w-5 h-6 text-rose-500" />
            <span className="text-[11px] text-gray-400 font-medium">Manutenção</span>
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2 mb-8">
          <StatCard label="Todos" value={stats.total} icon={BedDouble} color="text-gray-400" active={activeFilter === 'all'} onClick={() => setActiveFilter('all')} />
          <StatCard label="Ocupados" value={stats.occupied} icon={User} color="text-sky-400" active={activeFilter === 'occupied'} onClick={() => setActiveFilter('occupied')} />
          <StatCard label="Livres" value={stats.free} icon={BedDouble} color="text-emerald-400" active={activeFilter === 'free'} onClick={() => setActiveFilter('free')} />
          <StatCard label="Limpos" value={stats.clean} icon={Sparkles} color="text-green-400" active={activeFilter === 'clean'} onClick={() => setActiveFilter('clean')} />
          <StatCard label="Sujos" value={stats.dirty} icon={Wrench} color="text-amber-400" active={activeFilter === 'dirty'} onClick={() => setActiveFilter('dirty')} />
          <StatCard label="Manutenção" value={stats.maintenance} icon={Wrench} color="text-rose-400" active={activeFilter === 'maintenance'} onClick={() => setActiveFilter('maintenance')} />
          <StatCard label="Check-in Hoje" value={stats.checkin} icon={LogIn} color="text-violet-400" active={activeFilter === 'checkin'} onClick={() => setActiveFilter('checkin')} />
        </div>

        {error && <p className="text-rose-400 mb-4 text-sm bg-rose-500/10 px-4 py-2 rounded-xl">{error}</p>}

        {/* Room Grid */}
        {loading && !rooms ? (
          <div className="flex flex-col items-center py-24">
            <Loader2 className="w-10 h-10 animate-spin text-sky-500 mb-4" />
            <p className="text-sm text-gray-500">Carregando quartos...</p>
          </div>
        ) : (
          <div className="space-y-10">
            {Object.entries(groupedRooms).map(([type, typeRooms]) => (
              <div key={type}>
                <div className="flex items-center gap-3 mb-4">
                  <BedDouble className="w-5 h-5 text-gray-600" />
                  <h2 className="text-base font-bold text-gray-300">{type}</h2>
                  <span className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full font-medium">{typeRooms.length}</span>
                  <div className="flex-1 border-t border-gray-800 ml-2" />
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9 2xl:grid-cols-10 gap-3">
                  {typeRooms.map(room => (
                    <RoomCard key={room.idRoom} room={room}
                      onSelect={() => setSelectedRoom(room)}
                      onToggleStatus={(e) => handleToggleStatus(room, e)}
                      isUpdating={updatingRoom === room.idRoom} />
                  ))}
                </div>
              </div>
            ))}
            {filteredRooms.length === 0 && !loading && (
              <div className="text-center py-16">
                <BedDouble className="w-12 h-12 mx-auto mb-3 text-gray-700" />
                <p className="text-gray-500">Nenhum quarto encontrado.</p>
                <button onClick={() => setActiveFilter('all')} className="mt-2 text-sm text-sky-500 hover:underline">Limpar filtro</button>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedRoom && selectedHotel && (
        <ReservationModal isOpen={!!selectedRoom} onClose={() => setSelectedRoom(null)} room={selectedRoom} hotelId={selectedHotel.id} />
      )}
    </div>
  );
};

export default RoomRack;
