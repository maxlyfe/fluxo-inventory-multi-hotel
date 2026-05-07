import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  RefreshCw, Loader2, Wrench, UserCheck, BedDouble,
  User, Users, Calendar, Mail, Phone, CreditCard, LogIn, LogOut,
  Clock, DollarSign, FileText, X, MapPin,
  Globe, Utensils, Coffee, Moon, Star, Sparkles,
  Edit2, Trash2, UserPlus, Save,
} from 'lucide-react';
import { erbonService, ErbonRoom, ErbonBooking, ErbonGuest } from '../../lib/erbonService';
import { governanceService, RoomWorkflowStatus } from '../../lib/governanceService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { supabase } from '../../lib/supabase';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';
import Modal from '../../components/Modal';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_WF_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_maint: { label: 'Vistoria Mant.', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  maint_ok:      { label: 'Pronto Limpeza', color: 'text-blue-400',  bg: 'bg-blue-500/10'  },
  cleaning:      { label: 'Em Limpeza',     color: 'text-amber-400', bg: 'bg-amber-500/10' },
  clean:         { label: 'Limpo/Lib',      color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  contested:     { label: 'Contestado',      color: 'text-rose-400',  bg: 'bg-rose-500/10'  },
};


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

const STATUS_WF_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_maint: { label: 'Vistoria Mant.', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  maint_ok:      { label: 'Pronto Limpeza', color: 'text-blue-400',  bg: 'bg-blue-500/10'  },
  cleaning:      { label: 'Em Limpeza',     color: 'text-amber-400', bg: 'bg-amber-500/10' },
  clean:         { label: 'Limpo/Lib',      color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  contested:     { label: 'Contestado',      color: 'text-rose-400',  bg: 'bg-rose-500/10'  },
};

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
  workflowStatus?: RoomWorkflowStatus;
  onSelect: () => void;
  onToggleStatus: (e: React.MouseEvent) => void;
  isUpdating: boolean;
}

const RoomCard: React.FC<RoomCardProps> = React.memo(({ room, workflowStatus, onSelect, onToggleStatus, isUpdating }) => {
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

        {/* Workflow indicator bottom overlay */}
        {wf && workflowStatus !== 'clean' && (
          <div className={`absolute bottom-0 left-0 right-0 py-0.5 text-[8px] font-black uppercase text-center backdrop-blur-md ${wf.bg} ${wf.color} border-t border-white/5`}>
            {wf.label}
          </div>
        )}

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
  isOpen: boolean; onClose: () => void; room: ErbonRoom; hotelId: string; onRefresh: () => void;
}> = ({ isOpen, onClose, room, hotelId, onRefresh }) => {
  const { addNotification } = useNotification();
  const [booking, setBooking] = useState<ErbonBooking | null>(null);
  const [allGuests, setAllGuests] = useState<ErbonGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'reserva' | 'hospede' | 'conta'>('reserva');
  const [checkingIn, setCheckingIn] = useState(false);

  const loadData = useCallback(async () => {
    if (!room.currentBookingID) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      // Busca primária: GET direto pelo ID interno (mais confiável).
      // Fallback: searchBookings caso o GET falhe.
      const [bookingDirect, inHouseGuests] = await Promise.all([
        erbonService.fetchBookingByInternalId(hotelId, room.currentBookingID),
        erbonService.fetchInHouseGuests(hotelId),
      ]);

      let b: ErbonBooking | null = bookingDirect;
      if (!b) {
        const results = await erbonService.searchBookings(hotelId, { bookingNumber: String(room.currentBookingID) });
        if (results.length > 0) b = results[0];
      }
      setBooking(b);

      const roomGuests = inHouseGuests.filter(g =>
        g.idBooking === room.currentBookingID ||
        g.roomDescription === room.roomName
      );
      setAllGuests(roomGuests);
      console.log(`[RoomRack] Booking ${room.currentBookingID}: direct=${!!bookingDirect}, ${roomGuests.length} in-house, guestList: ${b?.guestList?.length || 0}, status=${b?.confirmedStatus || b?.status}`);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, [room, hotelId]);

  React.React.useEffect(() => {
    if (!isOpen) return;
    loadData();
  }, [isOpen, loadData]);

  const handleCheckIn = async () => {
    if (!room.currentBookingID) return;
    if (!window.confirm(`Confirmar check-in da reserva #${room.currentBookingID} para a UH ${room.roomName}?`)) return;
    setCheckingIn(true);
    try {
      await erbonService.checkInBooking(hotelId, room.currentBookingID, { roomId: room.idRoom });
      addNotification(`✅ Check-in realizado na UH ${room.roomName}`, 'success');
      await loadData();
      onRefresh();
    } catch (err: any) {
      addNotification(`Erro no check-in: ${err.message}`, 'error');
    } finally {
      setCheckingIn(false);
    }
  };

  if (!isOpen) return null;

  const isOccupied = room.currentlyOccupiedOrAvailable === 'Ocupado';
  // Fallback para noites: usar booking se disponível; senão, usar datas do in-house guest.
  const nights = (() => {
    if (booking) return getNights(booking.checkInDateTime, booking.checkOutDateTime);
    const ih = allGuests[0];
    if (ih?.checkInDate && ih?.checkOutDate) return getNights(ih.checkInDate, ih.checkOutDate);
    return 0;
  })();
  // Fallback para status: booking → inferido pelo estado do quarto (ocupado = Checked-in).
  const statusLabel = booking?.confirmedStatus || booking?.status || (isOccupied ? 'Checked-in' : (room.hasCheckinToday ? 'Pendente Check-in' : '—'));
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
            <div className="flex items-center gap-2">
              {/* Check-in button: aparece se reserva tem checkin hoje e quarto ainda não ocupado */}
              {room.hasCheckinToday && !isOccupied && room.currentBookingID && (
                <button
                  onClick={handleCheckIn}
                  disabled={checkingIn}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-emerald-700 hover:bg-emerald-50 font-semibold rounded-xl shadow-lg transition-all disabled:opacity-50"
                >
                  {checkingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                  {checkingIn ? 'Processando...' : 'Fazer Check-in'}
                </button>
              )}
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
                <DetailCard icon={FileText} label="Reserva" value={`#${booking?.erbonNumber || allGuests[0]?.bookingNumber || room.currentBookingID}`} />
                <DetailCard icon={BedDouble} label="UH / Tipo" value={`${room.roomName} · ${room.roomTypeDescription}`} />
                <DetailCard icon={LogIn} label="Check-in" value={fmtDate(booking?.checkInDateTime || allGuests[0]?.checkInDate)} />
                <DetailCard icon={LogOut} label="Check-out" value={fmtDate(booking?.checkOutDateTime || allGuests[0]?.checkOutDate)} />
                <DetailCard icon={Clock} label="Noites" value={`${nights}`} />
                <DetailCard icon={Users} label="Hóspedes"
                  value={`${booking?.adultQuantity || room.adultCount || 0} ADL${room.childrenCount ? ` + ${room.childrenCount} CHD` : ''}${room.babyCount ? ` + ${room.babyCount} INF` : ''}`} />
                {(() => { const MI = getMealIcon(allGuests[0]?.mealPlan); return <DetailCard icon={MI} label="Regime" value={getMealLabel(allGuests[0]?.mealPlan)} />; })()}
                <DetailCard icon={Star} label="Status" value={statusLabel} />
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
            <GuestTab
              hotelId={hotelId}
              booking={booking}
              allGuests={allGuests}
              bookingId={room.currentBookingID}
              onReload={loadData}
            />
          )}

          {activeTab === 'conta' && <AccountTab hotelId={hotelId} booking={booking} room={room} />}
        </>
      )}
    </Modal>
  );
};

// ─── Guest Tab ──────────────────────────────────────────────────────────────

interface UnifiedGuest {
  id?: number;
  name: string;
  email: string;
  phone: string;
  role: string;
  documents: Array<{ documentType: string; number: string }>;
  inHouseData?: ErbonGuest;
}

const GuestTab: React.FC<{
  hotelId: string;
  booking: ErbonBooking | null;
  allGuests: ErbonGuest[];
  bookingId: number | null;
  onReload: () => void;
}> = ({ hotelId, booking, allGuests, bookingId, onReload }) => {
  const { addNotification } = useNotification();
  const [editingGuest, setEditingGuest] = useState<UnifiedGuest | null>(null);
  const [isAddingGuest, setIsAddingGuest] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Merge: booking.guestList (dados da reserva) + allGuests (in-house com mais detalhes)
  const bookingGuests = booking?.guestList || [];
  const inHouseByName = new Map<string, ErbonGuest>();
  allGuests.forEach(g => {
    const key = g.guestName?.toLowerCase().trim();
    if (key) inHouseByName.set(key, g);
  });

  const unifiedGuests: UnifiedGuest[] = [];
  const addedNames = new Set<string>();

  bookingGuests.forEach((g, idx) => {
    const key = g.name?.toLowerCase().trim();
    const inHouse = key ? inHouseByName.get(key) : undefined;
    unifiedGuests.push({
      id: g.id || inHouse?.idGuest,
      name: g.name, email: g.email || inHouse?.contactEmail || '', phone: g.phone || '',
      role: idx === 0 ? 'Titular da reserva' : `Acompanhante ${idx}`,
      documents: g.documents || [],
      inHouseData: inHouse,
    });
    if (key) addedNames.add(key);
  });

  allGuests.forEach(g => {
    const key = g.guestName?.toLowerCase().trim();
    if (key && !addedNames.has(key)) {
      unifiedGuests.push({
        id: g.idGuest,
        name: g.guestName, email: g.contactEmail || '', phone: '',
        role: unifiedGuests.length === 0 ? 'Titular da reserva' : `Acompanhante ${unifiedGuests.length}`,
        documents: [],
        inHouseData: g,
      });
      addedNames.add(key);
    }
  });

  const handleDelete = async (guest: UnifiedGuest) => {
    if (!bookingId || !guest.id) {
      addNotification('ID do hóspede não disponível', 'error');
      return;
    }
    if (!window.confirm(`Remover "${guest.name}" da reserva?`)) return;
    setDeletingId(guest.id);
    try {
      await erbonService.removeGuestFromBooking(hotelId, bookingId, guest.id);
      addNotification(`Hóspede ${guest.name} removido`, 'success');
      onReload();
    } catch (err: any) {
      addNotification(`Erro ao remover: ${err.message}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const gradients = [
    'from-sky-500 to-cyan-400 shadow-sky-500/20',
    'from-violet-500 to-purple-400 shadow-violet-500/20',
    'from-emerald-500 to-teal-400 shadow-emerald-500/20',
    'from-amber-500 to-orange-400 shadow-amber-500/20',
    'from-rose-500 to-pink-400 shadow-rose-500/20',
  ];

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <Users className="w-4 h-4 inline mr-1" />
            {unifiedGuests.length} hóspede{unifiedGuests.length !== 1 ? 's' : ''} nesta reserva
          </p>
          {bookingId && (
            <button
              onClick={() => setIsAddingGuest(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg shadow-sm transition-all"
            >
              <UserPlus className="w-4 h-4" />
              Adicionar Hóspede
            </button>
          )}
        </div>

        {unifiedGuests.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl">
            <User className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Nenhum hóspede cadastrado ainda.</p>
            {bookingId && (
              <button onClick={() => setIsAddingGuest(true)} className="mt-3 text-sm text-emerald-500 hover:underline">
                + Adicionar primeiro hóspede
              </button>
            )}
          </div>
        ) : (
          unifiedGuests.map((g, idx) => {
            const ih = g.inHouseData;
            return (
              <div key={idx} className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-5 border border-gray-200 dark:border-gray-700/50 group">
                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${gradients[idx % gradients.length]} flex items-center justify-center text-white font-bold text-sm shadow-lg flex-shrink-0`}>
                    {g.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-800 dark:text-white truncate">{g.name}</h4>
                    <p className="text-xs text-gray-500">{g.role}</p>
                  </div>
                  {ih?.mealPlan && (
                    <span className="text-xs bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 px-2 py-1 rounded-full font-medium whitespace-nowrap">
                      {getMealLabel(ih.mealPlan)}
                    </span>
                  )}
                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditingGuest(g)}
                      className="p-1.5 hover:bg-sky-500/20 text-sky-500 rounded-lg transition"
                      title="Editar hóspede"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(g)}
                      disabled={deletingId === g.id}
                      className="p-1.5 hover:bg-rose-500/20 text-rose-500 rounded-lg transition disabled:opacity-40"
                      title="Remover hóspede"
                    >
                      {deletingId === g.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
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
          })
        )}
      </div>

      {/* Edit/Add Modal */}
      {(editingGuest || isAddingGuest) && bookingId && (
        <GuestEditModal
          hotelId={hotelId}
          bookingId={bookingId}
          guest={editingGuest}
          onClose={() => { setEditingGuest(null); setIsAddingGuest(false); }}
          onSaved={() => { setEditingGuest(null); setIsAddingGuest(false); onReload(); }}
        />
      )}
    </>
  );
};

// ─── Guest Edit/Add Modal ───────────────────────────────────────────────────
const GuestEditModal: React.FC<{
  hotelId: string;
  bookingId: number;
  guest: UnifiedGuest | null; // null = adding
  onClose: () => void;
  onSaved: () => void;
}> = ({ hotelId, bookingId, guest, onClose, onSaved }) => {
  const { addNotification } = useNotification();
  const isEditing = !!guest;
  const ih = guest?.inHouseData;
  const doc = guest?.documents?.[0];

  const [form, setForm] = useState({
    // Schema real Erbon: nome único
    name: guest?.name || [ih?.guestName, ih?.lastName].filter(Boolean).join(' ').trim() || '',
    email: guest?.email || ih?.contactEmail || '',
    phone: guest?.phone || '',
    birthDate: ih?.birthDate ? ih.birthDate.split('T')[0] : '',
    genderID: '' as string, // int no envio, '' = não informado
    nationality: ih?.countryGuestISO || 'BR',
    profession: '',
    vehicleRegistration: '',
    // Documento principal (um; API aceita array)
    documentType: doc?.documentType || 'CPF',
    documentNumber: doc?.number || '',
    // Endereço
    country: ih?.countryGuestISO || 'BR',
    state: ih?.stateGuest || '',
    city: ih?.localityGuest || '',
    street: '',
    zipcode: '',
    neighborhood: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSaveGuest = async () => {
    if (saving) return; // Proteção contra duplo clique

    if (!form.name.trim()) {
      addNotification('Nome é obrigatório', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        birthDate: form.birthDate ? new Date(form.birthDate).toISOString() : null,
        genderID: form.genderID ? parseInt(form.genderID, 10) : null,
        nationality: form.nationality.trim() || null,
        profession: form.profession.trim() || null,
        vehicleRegistration: form.vehicleRegistration.trim() || null,
        isClient: true,
        isProvider: false,
        address: {
          country: form.country.trim() || null,
          state: form.state.trim() || null,
          city: form.city.trim() || null,
          street: form.street.trim() || null,
          zipcode: form.zipcode.trim() || null,
          neighborhood: form.neighborhood.trim() || null,
        },
        documents: form.documentNumber.trim()
          ? [{ documentType: form.documentType, number: form.documentNumber.trim() }]
          : [],
      };
      if (isEditing && guest?.id) {
        await erbonService.updateGuest(hotelId, guest.id, payload);
        addNotification(`Hóspede ${payload.name} atualizado`, 'success');
      } else {
        await erbonService.addGuestToBooking(hotelId, bookingId, payload);
        addNotification(`Hóspede ${payload.name} adicionado`, 'success');
      }
      onSaved();
    } catch (err: any) {
      addNotification(`Erro: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={isEditing ? `Editar Hóspede` : 'Adicionar Hóspede'} size="2xl">
      <div className="space-y-5">
        {/* Dados pessoais */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Dados Pessoais</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <FormField label="Nome Completo *" value={form.name} onChange={v => setForm({ ...form, name: v })} />
            </div>
            <FormField label="E-mail" type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} />
            <FormField label="Telefone" value={form.phone} onChange={v => setForm({ ...form, phone: v })} />
            <FormField label="Data de Nascimento" type="date" value={form.birthDate} onChange={v => setForm({ ...form, birthDate: v })} />
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Gênero (ID)</label>
              <select
                value={form.genderID}
                onChange={e => setForm({ ...form, genderID: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-800 dark:text-white"
              >
                <option value="">— não informado —</option>
                <option value="1">Masculino (1)</option>
                <option value="2">Feminino (2)</option>
                <option value="3">Outro (3)</option>
              </select>
            </div>
            <FormField label="Profissão" value={form.profession} onChange={v => setForm({ ...form, profession: v })} />
            <FormField label="Nacionalidade (ISO)" value={form.nationality} onChange={v => setForm({ ...form, nationality: v.toUpperCase() })} />
            <FormField label="Placa Veículo" value={form.vehicleRegistration} onChange={v => setForm({ ...form, vehicleRegistration: v.toUpperCase() })} />
          </div>
        </div>

        {/* Documento */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Documento</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
              <select
                value={form.documentType}
                onChange={e => setForm({ ...form, documentType: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-800 dark:text-white"
              >
                <option value="CPF">CPF</option>
                <option value="RG">RG</option>
                <option value="PASSPORT">Passaporte</option>
                <option value="CNH">CNH</option>
                <option value="OTHER">Outro</option>
              </select>
            </div>
            <FormField label="Número" value={form.documentNumber} onChange={v => setForm({ ...form, documentNumber: v })} />
          </div>
        </div>

        {/* Endereço */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Endereço</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="País" value={form.country} onChange={v => setForm({ ...form, country: v.toUpperCase() })} />
            <FormField label="Estado" value={form.state} onChange={v => setForm({ ...form, state: v.toUpperCase() })} />
            <FormField label="Cidade" value={form.city} onChange={v => setForm({ ...form, city: v })} />
            <FormField label="Bairro" value={form.neighborhood} onChange={v => setForm({ ...form, neighborhood: v })} />
            <FormField label="Rua" value={form.street} onChange={v => setForm({ ...form, street: v })} />
            <FormField label="CEP" value={form.zipcode} onChange={v => setForm({ ...form, zipcode: v })} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEditing ? 'Salvar Alterações' : 'Adicionar Hóspede'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ─── Form Field Helper ──────────────────────────────────────────────────────
const FormField: React.FC<{
  label: string; value: string; onChange: (v: string) => void; type?: string;
}> = ({ label, value, onChange, type = 'text' }) => (
  <div>
    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
    />
  </div>
);

// ─── Account Tab ────────────────────────────────────────────────────────────
// CurrentAccountModel: { id, description, amount, isDebit, isCredit, currency, isInvoiced, idDepartment }
interface CurrentAccountEntry {
  id: number;
  description: string;
  amount: number;
  isDebit: boolean;
  isCredit: boolean;
  currency: string;
  isInvoiced: boolean;
  idDepartment: number;
}

const AccountTab: React.FC<{ hotelId: string; booking: ErbonBooking | null; room: ErbonRoom }> = ({ hotelId, booking, room }) => {
  const [entries, setEntries] = useState<CurrentAccountEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Usa o bookingInternalID do booking (quando carregado) ou do próprio room como fallback
  const bookingInternalId = booking?.bookingInternalID ?? room.currentBookingID;

  React.React.React.useEffect(() => {
    if (!bookingInternalId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        const data = await erbonService.fetchBookingAccount(hotelId, bookingInternalId);
        console.log(`[RoomRack] AccountTab: ${data.length} lançamentos carregados para booking ${bookingInternalId}`);
        setEntries(data as CurrentAccountEntry[]);
      } catch (err) {
        console.error('[RoomRack] AccountTab error:', err);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [hotelId, bookingInternalId]);

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-sky-500" /></div>;
  if (!bookingInternalId) return <div className="text-center py-12"><DollarSign className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" /><p className="text-sm text-gray-500">Nenhuma reserva vinculada a esta UH.</p></div>;

  const totalDebit = entries.filter(e => e.isDebit).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalCredit = entries.filter(e => e.isCredit).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const balance = totalDebit - totalCredit;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-sky-50 dark:bg-sky-900/15 rounded-xl p-4 border border-sky-200 dark:border-sky-800/40">
          <p className="text-[10px] uppercase tracking-wide text-sky-500 mb-1">Diárias</p>
          <p className="text-lg font-bold text-sky-700 dark:text-sky-300">{booking ? fmtCurrency(booking.totalBookingRate) : '—'}</p>
        </div>
        <div className="bg-rose-50 dark:bg-rose-900/15 rounded-xl p-4 border border-rose-200 dark:border-rose-800/40">
          <p className="text-[10px] uppercase tracking-wide text-rose-500 mb-1">Total Débitos</p>
          <p className="text-lg font-bold text-rose-700 dark:text-rose-300">{fmtCurrency(totalDebit)}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/15 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800/40">
          <p className="text-[10px] uppercase tracking-wide text-emerald-500 mb-1">Total Créditos</p>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{fmtCurrency(totalCredit)}</p>
        </div>
        <div className={`rounded-xl p-4 border ${balance > 0
          ? 'bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800/40'
          : 'bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800/40'}`}>
          <p className={`text-[10px] uppercase tracking-wide mb-1 ${balance > 0 ? 'text-amber-500' : 'text-green-500'}`}>Saldo</p>
          <p className={`text-lg font-bold ${balance > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}`}>
            {fmtCurrency(balance)}
          </p>
        </div>
      </div>

      {/* Entries table */}
      {entries.length > 0 ? (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Extrato da Conta</h4>
            <span className="text-[10px] text-gray-400">{entries.length} lançamento{entries.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-[10px] uppercase tracking-wide text-gray-400 sticky top-0">
                  <th className="text-left px-4 py-2.5">Descrição</th>
                  <th className="text-left px-4 py-2.5">Depto</th>
                  <th className="text-right px-4 py-2.5">Débito</th>
                  <th className="text-right px-4 py-2.5">Crédito</th>
                  <th className="text-center px-4 py-2.5">NF</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 max-w-[250px] truncate" title={e.description}>
                      {e.description || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{e.idDepartment || ''}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-red-600 dark:text-red-400">
                      {e.isDebit ? fmtCurrency(e.amount) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {e.isCredit ? fmtCurrency(e.amount) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {e.isInvoiced && <span className="text-[10px] bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 px-1.5 py-0.5 rounded font-medium">Faturado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 font-semibold">
                  <td colSpan={2} className="px-4 py-3 text-gray-600 dark:text-gray-300 text-xs uppercase">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-red-700 dark:text-red-300">{totalDebit > 0 ? fmtCurrency(totalDebit) : ''}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-300">{totalCredit > 0 ? fmtCurrency(totalCredit) : ''}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700/50">
          <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 mb-1">Nenhum lançamento na conta desta reserva.</p>
          <p className="text-xs text-gray-400">Lançamentos aparecerão conforme consumos forem registrados no PDV.</p>
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
  const [workflows, setWorkflows] = useState<Record<string, RoomWorkflowStatus>>({});

  const { data: rooms, loading, error, refetch, erbonConfigured } = useErbonData<ErbonRoom[]>(
    (hotelId) => erbonService.fetchHousekeeping(hotelId), [], { autoRefreshMs: 60_000 }
  );

  const fetchWorkflows = useCallback(async () => {
    if (!selectedHotel) return;
    try {
      const { data } = await supabase
        .from('hotel_room_workflow')
        .select('room_id, status')
        .eq('hotel_id', selectedHotel.id);
      
      const map: Record<string, RoomWorkflowStatus> = {};
      (data || []).forEach(w => map[w.room_id] = w.status as RoomWorkflowStatus);
      setWorkflows(map);
    } catch { /* ignore */ }
  }, [selectedHotel]);

  React.React.useEffect(() => {
    if (selectedHotel) fetchWorkflows();
  }, [selectedHotel, fetchWorkflows, rooms]);

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
        <ReservationModal isOpen={!!selectedRoom} onClose={() => setSelectedRoom(null)} room={selectedRoom} hotelId={selectedHotel.id} onRefresh={refetch} />
      )}
    </div>
  );
};

export default RoomRack;
