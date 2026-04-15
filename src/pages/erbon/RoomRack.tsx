import React, { useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Loader2, Wrench, UserCheck, BedDouble,
  User, Users, Calendar, Mail, Phone, CreditCard, LogIn, LogOut,
  Clock, DollarSign, FileText, X, MapPin,
  Globe, Utensils, Coffee, Moon, Star, Eye,
  ChevronRight, Sparkles, Shield, ArrowUpDown,
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

// ─── Room status logic ──────────────────────────────────────────────────────

type RoomStatus = 'occupied-clean' | 'occupied-dirty' | 'free-clean' | 'free-dirty' | 'maintenance' | 'checkin-today';

function getRoomStatus(r: ErbonRoom): RoomStatus {
  if (r.inMaintenance) return 'maintenance';
  const occ = r.currentlyOccupiedOrAvailable === 'Ocupado';
  const clean = r.idHousekeepingStatus === 'CLEAN';
  if (occ && clean) return 'occupied-clean';
  if (occ && !clean) return 'occupied-dirty';
  if (!occ && clean) return 'free-clean';
  return 'free-dirty';
}

const STATUS_CONFIG: Record<RoomStatus, {
  label: string; accent: string; bg: string; border: string;
  ring: string; icon: string; badge: string; badgeText: string;
}> = {
  'occupied-clean': {
    label: 'Ocupado', accent: 'text-sky-400', bg: 'bg-gradient-to-br from-sky-500/10 to-sky-600/5',
    border: 'border-sky-500/30', ring: 'ring-sky-400', icon: 'text-sky-400',
    badge: 'bg-sky-500/20 text-sky-300', badgeText: 'Ocupado',
  },
  'occupied-dirty': {
    label: 'Ocupado · Sujo', accent: 'text-sky-400', bg: 'bg-gradient-to-br from-sky-500/10 to-amber-500/5',
    border: 'border-sky-500/30', ring: 'ring-sky-400', icon: 'text-sky-400',
    badge: 'bg-amber-500/20 text-amber-300', badgeText: 'Sujo',
  },
  'free-clean': {
    label: 'Livre · Limpo', accent: 'text-emerald-400', bg: 'bg-gradient-to-br from-emerald-500/8 to-emerald-600/3',
    border: 'border-emerald-500/20', ring: 'ring-emerald-400', icon: 'text-emerald-400',
    badge: 'bg-emerald-500/20 text-emerald-300', badgeText: 'Limpo',
  },
  'free-dirty': {
    label: 'Livre · Sujo', accent: 'text-amber-400', bg: 'bg-gradient-to-br from-amber-500/10 to-amber-600/5',
    border: 'border-amber-500/30', ring: 'ring-amber-400', icon: 'text-amber-400',
    badge: 'bg-amber-500/20 text-amber-300', badgeText: 'Sujo',
  },
  'maintenance': {
    label: 'Manutenção', accent: 'text-rose-400', bg: 'bg-gradient-to-br from-rose-500/10 to-rose-600/5',
    border: 'border-rose-500/30', ring: 'ring-rose-400', icon: 'text-rose-400',
    badge: 'bg-rose-500/20 text-rose-300', badgeText: 'Manutenção',
  },
  'checkin-today': {
    label: 'Check-in Hoje', accent: 'text-violet-400', bg: 'bg-gradient-to-br from-violet-500/10 to-violet-600/5',
    border: 'border-violet-500/30', ring: 'ring-violet-400', icon: 'text-violet-400',
    badge: 'bg-violet-500/20 text-violet-300', badgeText: 'Check-in',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// ROOM CARD
// ═══════════════════════════════════════════════════════════════════════════

interface RoomCardProps {
  room: ErbonRoom;
  onSelect: () => void;
  onToggleStatus: (e: React.MouseEvent) => void;
  isUpdating: boolean;
}

const RoomCard: React.FC<RoomCardProps> = React.memo(({ room, onSelect, onToggleStatus, isUpdating }) => {
  const status = getRoomStatus(room);
  const cfg = STATUS_CONFIG[status];
  const isOccupied = room.currentlyOccupiedOrAvailable === 'Ocupado';
  const isClean = room.idHousekeepingStatus === 'CLEAN';

  return (
    <div
      onClick={onSelect}
      className={`group relative rounded-2xl border ${cfg.border} ${cfg.bg} backdrop-blur-sm
        p-0 overflow-hidden cursor-pointer transition-all duration-300
        hover:shadow-lg hover:shadow-black/20 hover:scale-[1.03] hover:border-opacity-60
        dark:bg-gray-800/60`}
    >
      {/* ── Accent strip top ── */}
      <div className={`h-1 w-full ${
        status === 'maintenance' ? 'bg-gradient-to-r from-rose-500 to-rose-400' :
        status === 'occupied-dirty' ? 'bg-gradient-to-r from-sky-500 to-amber-400' :
        isOccupied ? 'bg-gradient-to-r from-sky-500 to-sky-400' :
        isClean ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' :
        'bg-gradient-to-r from-amber-500 to-amber-400'
      }`} />

      <div className="px-3 pt-2.5 pb-3">
        {/* ── Header: number + icons ── */}
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black tracking-tight text-white/90">{room.roomName}</span>
            {room.numberFloor > 0 && (
              <span className="text-[10px] text-gray-500 font-medium">{room.numberFloor}°</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {room.hasCheckinToday && (
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/20">
                <LogIn className="w-3 h-3 text-violet-400" />
              </span>
            )}
            {room.inMaintenance && (
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-rose-500/20">
                <Wrench className="w-3 h-3 text-rose-400" />
              </span>
            )}
            {/* View icon on hover */}
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Eye className="w-3 h-3 text-gray-400" />
            </span>
          </div>
        </div>

        {/* ── Status badge ── */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
            {isOccupied ? 'Ocupado' : 'Livre'}
          </span>
          {status === 'occupied-dirty' && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Sujo</span>
          )}
          {!isOccupied && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              isClean ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
            }`}>
              {isClean ? '✓ Limpo' : '● Sujo'}
            </span>
          )}
        </div>

        {/* ── Guest info ── */}
        {isOccupied ? (
          <div className="min-h-[36px]">
            {room.bookingHolderName && (
              <p className="text-[11px] text-gray-300 truncate leading-tight" title={room.bookingHolderName}>
                {room.bookingHolderName}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              {(room.adultCount || room.childrenCount || room.babyCount) && (
                <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                  <User className="w-2.5 h-2.5" />
                  {room.adultCount || 0}
                  {room.childrenCount ? <span className="ml-1">+{room.childrenCount}</span> : null}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-[36px] flex items-center">
            <span className="text-[10px] text-gray-600 italic">Disponível</span>
          </div>
        )}

        {/* ── Housekeeping toggle ── */}
        {!room.inMaintenance && (
          <button
            onClick={onToggleStatus}
            disabled={isUpdating}
            className={`mt-1.5 w-full text-[10px] font-semibold py-1.5 rounded-lg transition-all duration-200 disabled:opacity-40
              ${isClean
                ? 'bg-white/5 hover:bg-amber-500/20 text-gray-400 hover:text-amber-300 border border-white/5 hover:border-amber-500/30'
                : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/40'
              }`}
          >
            {isUpdating
              ? <Loader2 className="w-3 h-3 mx-auto animate-spin" />
              : isClean ? 'Marcar sujo' : '✓ Marcar limpo'
            }
          </button>
        )}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// STAT PILL
// ═══════════════════════════════════════════════════════════════════════════

interface StatPillProps {
  label: string;
  value: number;
  icon: React.ComponentType<any>;
  color: string;
  bgColor: string;
  active?: boolean;
  onClick: () => void;
}

const StatPill: React.FC<StatPillProps> = ({ label, value, icon: Icon, color, bgColor, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-all duration-200 border
      ${active
        ? `${bgColor} border-current shadow-lg shadow-black/10 scale-[1.02]`
        : 'bg-gray-800/40 border-gray-700/50 hover:bg-gray-800/60 hover:border-gray-600'
      }`}
  >
    <div className={`w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center`}>
      <Icon className={`w-4 h-4 ${color}`} />
    </div>
    <div className="text-left">
      <p className={`text-lg font-bold leading-none ${active ? color : 'text-white'}`}>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
    </div>
  </button>
);

// ═══════════════════════════════════════════════════════════════════════════
// RESERVATION DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: ErbonRoom;
  hotelId: string;
}

const ReservationModal: React.FC<ReservationModalProps> = ({ isOpen, onClose, room, hotelId }) => {
  const [booking, setBooking] = useState<ErbonBooking | null>(null);
  const [guest, setGuest] = useState<ErbonGuest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'reserva' | 'hospede' | 'conta'>('reserva');

  React.useEffect(() => {
    if (!isOpen) return;
    if (!room.currentBookingID) { setLoading(false); return; }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [bookings, guests] = await Promise.all([
          erbonService.searchBookings(hotelId, { bookingNumber: String(room.currentBookingID) }),
          erbonService.fetchInHouseGuests(hotelId),
        ]);
        if (bookings.length > 0) setBooking(bookings[0]);
        const rg = guests.find(g => g.roomDescription === room.roomName || g.idBooking === room.currentBookingID);
        if (rg) setGuest(rg);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isOpen, room, hotelId]);

  if (!isOpen) return null;

  const nights = booking ? getNights(booking.checkInDateTime, booking.checkOutDateTime) : 0;
  const status = getRoomStatus(room);
  const cfg = STATUS_CONFIG[status];
  const isOccupied = room.currentlyOccupiedOrAvailable === 'Ocupado';
  const guestName = booking?.guestList?.[0]?.name || guest?.guestName || room.bookingHolderName || 'Hóspede';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="4xl">
      {/* Custom header replacing modal title */}
      <div className="-mt-4 -mx-4 mb-5">
        {/* Hero gradient */}
        <div className={`relative overflow-hidden rounded-t-lg ${
          isOccupied
            ? 'bg-gradient-to-r from-sky-600 via-sky-500 to-cyan-500'
            : status === 'maintenance'
              ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-pink-500'
              : 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500'
        }`}>
          {/* Decorative circles */}
          <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10" />
          <div className="absolute -right-2 top-12 w-16 h-16 rounded-full bg-white/5" />

          <div className="relative px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
                  <span className="text-xl font-black text-white">{room.roomName}</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">{guestName}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs bg-white/20 text-white/90 px-2 py-0.5 rounded-full font-medium">
                      {room.roomTypeDescription}
                    </span>
                    <span className="text-xs text-white/70">{room.numberFloor}° andar</span>
                    {booking && (
                      <span className="text-xs text-white/70">· Reserva #{booking.erbonNumber}</span>
                    )}
                  </div>
                </div>
              </div>

              {isOccupied && booking && (
                <div className="hidden sm:flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2">
                  <div className="text-center">
                    <p className="text-[10px] text-white/60 uppercase tracking-wide">In</p>
                    <p className="text-sm font-bold text-white">{fmtDate(booking.checkInDateTime)}</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="w-8 border-t border-white/30" />
                    <span className="text-xs font-bold text-white/80 mt-0.5">{nights}N</span>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-white/60 uppercase tracking-wide">Out</p>
                    <p className="text-sm font-bold text-white">{fmtDate(booking.checkOutDateTime)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-3" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Carregando detalhes da reserva...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-red-500 mb-2">Erro ao carregar dados</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      ) : !booking && !guest && !isOccupied ? (
        /* Free room — show room info */
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DetailCard icon={BedDouble} label="Tipo" value={room.roomTypeDescription} />
          <DetailCard icon={MapPin} label="Andar" value={`${room.numberFloor}°`} />
          <DetailCard icon={room.idHousekeepingStatus === 'CLEAN' ? Sparkles : Wrench} label="Governança"
            value={room.idHousekeepingStatus === 'CLEAN' ? 'Limpo' : 'Sujo'}
            valueColor={room.idHousekeepingStatus === 'CLEAN' ? 'text-emerald-400' : 'text-amber-400'} />
          <DetailCard icon={Shield} label="Status" value={room.inMaintenance ? 'Em manutenção' : 'Disponível'}
            valueColor={room.inMaintenance ? 'text-rose-400' : 'text-emerald-400'} />
        </div>
      ) : (
        <>
          {/* ── Tabs ── */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl mb-5">
            {([
              { key: 'reserva' as const, label: 'Reserva', icon: FileText },
              { key: 'hospede' as const, label: 'Hóspede', icon: User },
              { key: 'conta' as const, label: 'Financeiro', icon: DollarSign },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                  activeTab === tab.key
                    ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab: Reserva ── */}
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
                {(() => { const MI = getMealIcon(guest?.mealPlan); return (
                  <DetailCard icon={MI} label="Regime" value={getMealLabel(guest?.mealPlan)} />
                ); })()}
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
                      <p className="text-lg font-bold text-gray-800 dark:text-white">
                        {nights > 0 ? fmtCurrency(booking.totalBookingRate / nights) : '—'}
                      </p>
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
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                    {booking.rateDesc && <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">Tarifa: <b className="text-gray-700 dark:text-gray-300">{booking.rateDesc}</b></span>}
                    {booking.segmentDesc && <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">Segmento: <b className="text-gray-700 dark:text-gray-300">{booking.segmentDesc}</b></span>}
                    {booking.sourceDesc && <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">Origem: <b className="text-gray-700 dark:text-gray-300">{booking.sourceDesc}</b></span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Hóspede ── */}
          {activeTab === 'hospede' && (
            <div className="space-y-4">
              {booking?.guestList?.map((g, idx) => (
                <div key={g.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-5 border border-gray-200 dark:border-gray-700/50">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-sky-500/20">
                      {g.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-800 dark:text-white">{g.name}</h4>
                      <p className="text-xs text-gray-500">{idx === 0 ? 'Titular da reserva' : `Acompanhante ${idx}`}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {g.email && <InfoRow icon={Mail} value={g.email} />}
                    {g.phone && <InfoRow icon={Phone} value={g.phone} />}
                    {g.documents?.map((doc, i) => (
                      <InfoRow key={i} icon={CreditCard} value={`${doc.documentType}: ${doc.number}`} />
                    ))}
                  </div>
                </div>
              ))}

              {guest && (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-5 border border-gray-200 dark:border-gray-700/50">
                  <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 text-sm">Informações Complementares</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {guest.localityGuest && <InfoRow icon={MapPin} value={`${guest.localityGuest}${guest.stateGuest ? `, ${guest.stateGuest}` : ''}`} />}
                    {guest.countryGuestISO && <InfoRow icon={Globe} value={guest.countryGuestISO} />}
                    {guest.birthDate && <InfoRow icon={Calendar} value={`Nascimento: ${fmtDate(guest.birthDate)}`} />}
                    {guest.contactEmail && <InfoRow icon={Mail} value={guest.contactEmail} />}
                    {guest.mealPlan && <InfoRow icon={Utensils} value={getMealLabel(guest.mealPlan)} />}
                  </div>
                </div>
              )}

              {!booking?.guestList?.length && !guest && (
                <div className="text-center py-10">
                  <User className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Nenhuma informação de hóspede disponível.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Financeiro ── */}
          {activeTab === 'conta' && (
            <AccountTab hotelId={hotelId} booking={booking} room={room} />
          )}
        </>
      )}
    </Modal>
  );
};

// ─── Account Tab ────────────────────────────────────────────────────────────

const AccountTab: React.FC<{ hotelId: string; booking: ErbonBooking | null; room: ErbonRoom }> = ({ hotelId, booking, room }) => {
  const [charges, setCharges] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await erbonService.fetchAccountsReceivable(hotelId);
        setCharges(data);
      } catch { setCharges([]); }
      finally { setLoading(false); }
    };
    load();
  }, [hotelId]);

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
      <span className="ml-2 text-sm text-gray-500">Carregando...</span>
    </div>
  );

  if (!booking) return (
    <div className="text-center py-12">
      <DollarSign className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
      <p className="text-sm text-gray-500">Dados financeiros indisponíveis.</p>
    </div>
  );

  const roomCharges = charges?.filter((c: any) =>
    c.bookingInternalID === booking.bookingInternalID ||
    c.bookingNumber === booking.erbonNumber ||
    c.roomDescription === room.roomName
  ) || [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-sky-50 dark:bg-sky-900/15 rounded-xl p-4 border border-sky-200 dark:border-sky-800/40">
          <p className="text-[10px] uppercase tracking-wide text-sky-500 mb-1">Diárias</p>
          <p className="text-xl font-bold text-sky-700 dark:text-sky-300">{fmtCurrency(booking.totalBookingRate)}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/15 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800/40">
          <p className="text-[10px] uppercase tracking-wide text-emerald-500 mb-1">Total c/ Taxas</p>
          <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{fmtCurrency(booking.totalBookingRateWithTax)}</p>
        </div>
        <div className="bg-violet-50 dark:bg-violet-900/15 rounded-xl p-4 border border-violet-200 dark:border-violet-800/40">
          <p className="text-[10px] uppercase tracking-wide text-violet-500 mb-1">Taxas</p>
          <p className="text-xl font-bold text-violet-700 dark:text-violet-300">
            {fmtCurrency(booking.totalBookingRateWithTax - booking.totalBookingRate)}
          </p>
        </div>
      </div>

      {roomCharges.length > 0 ? (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-[10px] uppercase tracking-wide text-gray-400">
                <th className="text-left px-4 py-3">Descrição</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-right px-4 py-3">Data</th>
              </tr>
            </thead>
            <tbody>
              {roomCharges.map((c: any, i: number) => (
                <tr key={i} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{c.description || c.desc || '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">{fmtCurrency(c.value || c.amount)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{fmtDate(c.date || c.transactionDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700/50">
          <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Extrato detalhado indisponível via API.</p>
          <p className="text-xs text-gray-400 mt-1">Consulte o Erbon PMS para lançamentos individuais.</p>
        </div>
      )}
    </div>
  );
};

// ─── Shared tiny components ─────────────────────────────────────────────────

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
    <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
    <span className="truncate">{value}</span>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ROOM RACK
// ═══════════════════════════════════════════════════════════════════════════

type ActiveFilter = 'all' | 'occupied' | 'free' | 'clean' | 'dirty' | 'maintenance' | 'checkin';

const RoomRack: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [updatingRoom, setUpdatingRoom] = useState<number | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<ErbonRoom | null>(null);

  const { data: rooms, loading, error, refetch, erbonConfigured } = useErbonData<ErbonRoom[]>(
    (hotelId) => erbonService.fetchHousekeeping(hotelId),
    [],
    { autoRefreshMs: 60_000 }
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
    } catch (err: any) {
      addNotification(`Erro ao atualizar: ${err.message}`, 'error');
    } finally {
      setUpdatingRoom(null);
    }
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
    Object.values(groups).forEach(arr =>
      arr.sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { numeric: true }))
    );
    return groups;
  }, [filteredRooms]);

  const occPct = stats.total > 0 ? Math.round((stats.occupied / stats.total) * 100) : 0;

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 py-6 max-w-[1600px]">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black text-gray-800 dark:text-white tracking-tight">
              Rack de UH's
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Visualização em tempo real · Atualização automática a cada minuto
            </p>
          </div>
          <button onClick={refetch} disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl
              bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
              hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-gray-700 dark:text-gray-200
              shadow-sm hover:shadow">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        {/* ── Occupancy hero ── */}
        <div className="bg-white dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl p-5 mb-6 border border-gray-100 dark:border-gray-700/50 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                occPct > 80 ? 'bg-rose-100 dark:bg-rose-900/30' : occPct > 50 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30'
              }`}>
                <span className={`text-xl font-black ${
                  occPct > 80 ? 'text-rose-600 dark:text-rose-400' : occPct > 50 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                }`}>{occPct}%</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Taxa de Ocupação</p>
                <p className="text-xs text-gray-500">{stats.occupied} de {stats.total} unidades ocupadas</p>
              </div>
            </div>
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                occPct > 80 ? 'bg-gradient-to-r from-rose-500 to-rose-400' :
                occPct > 50 ? 'bg-gradient-to-r from-amber-500 to-amber-400' :
                'bg-gradient-to-r from-emerald-500 to-teal-400'
              }`}
              style={{ width: `${occPct}%` }}
            />
          </div>
        </div>

        {/* ── Filter pills ── */}
        <div className="flex flex-wrap gap-2 mb-8">
          <StatPill label="Todos" value={stats.total} icon={BedDouble}
            color="text-gray-400" bgColor="bg-gray-500/10"
            active={activeFilter === 'all'} onClick={() => setActiveFilter('all')} />
          <StatPill label="Ocupados" value={stats.occupied} icon={User}
            color="text-sky-400" bgColor="bg-sky-500/10"
            active={activeFilter === 'occupied'} onClick={() => setActiveFilter('occupied')} />
          <StatPill label="Livres" value={stats.free} icon={BedDouble}
            color="text-emerald-400" bgColor="bg-emerald-500/10"
            active={activeFilter === 'free'} onClick={() => setActiveFilter('free')} />
          <StatPill label="Limpos" value={stats.clean} icon={Sparkles}
            color="text-green-400" bgColor="bg-green-500/10"
            active={activeFilter === 'clean'} onClick={() => setActiveFilter('clean')} />
          <StatPill label="Sujos" value={stats.dirty} icon={ArrowUpDown}
            color="text-amber-400" bgColor="bg-amber-500/10"
            active={activeFilter === 'dirty'} onClick={() => setActiveFilter('dirty')} />
          <StatPill label="Manutenção" value={stats.maintenance} icon={Wrench}
            color="text-rose-400" bgColor="bg-rose-500/10"
            active={activeFilter === 'maintenance'} onClick={() => setActiveFilter('maintenance')} />
          <StatPill label="Check-in Hoje" value={stats.checkin} icon={LogIn}
            color="text-violet-400" bgColor="bg-violet-500/10"
            active={activeFilter === 'checkin'} onClick={() => setActiveFilter('checkin')} />
        </div>

        {error && <p className="text-rose-500 mb-4 text-sm bg-rose-500/10 px-4 py-2 rounded-xl">{error}</p>}

        {/* ── Room Grid ── */}
        {loading && !rooms ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="w-10 h-10 animate-spin text-sky-500 mb-4" />
            <p className="text-sm text-gray-500">Carregando quartos...</p>
          </div>
        ) : (
          <div className="space-y-10">
            {Object.entries(groupedRooms).map(([type, typeRooms]) => (
              <div key={type}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <BedDouble className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </div>
                  <h2 className="text-lg font-bold text-gray-800 dark:text-white">{type}</h2>
                  <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full font-medium">
                    {typeRooms.length}
                  </span>
                  <div className="flex-1 border-t border-gray-100 dark:border-gray-800 ml-2" />
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9 2xl:grid-cols-10 gap-3">
                  {typeRooms.map(room => (
                    <RoomCard
                      key={room.idRoom}
                      room={room}
                      onSelect={() => setSelectedRoom(room)}
                      onToggleStatus={(e) => handleToggleStatus(room, e)}
                      isUpdating={updatingRoom === room.idRoom}
                    />
                  ))}
                </div>
              </div>
            ))}

            {filteredRooms.length === 0 && !loading && (
              <div className="text-center py-16">
                <BedDouble className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-gray-500 dark:text-gray-400">Nenhum quarto encontrado com este filtro.</p>
                <button onClick={() => setActiveFilter('all')} className="mt-2 text-sm text-sky-500 hover:underline">
                  Limpar filtro
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Reservation Modal ── */}
      {selectedRoom && selectedHotel && (
        <ReservationModal
          isOpen={!!selectedRoom}
          onClose={() => setSelectedRoom(null)}
          room={selectedRoom}
          hotelId={selectedHotel.id}
        />
      )}
    </div>
  );
};

export default RoomRack;
