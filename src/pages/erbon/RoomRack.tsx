import React, { useState, useMemo, useCallback } from 'react';
import {
  LayoutGrid, RefreshCw, Loader2, Filter, Wrench, UserCheck, BedDouble,
  User, Users, Baby, Calendar, Mail, Phone, CreditCard, LogIn, LogOut,
  Clock, DollarSign, FileText, X, ChevronDown, ChevronUp, MapPin,
  Globe, Utensils, Coffee, Moon, Star,
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

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'dd/MM/yyyy', { locale: ptBR }); }
  catch { return dateStr; }
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); }
  catch { return dateStr; }
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return 'R$ 0,00';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getNights(checkIn: string, checkOut: string): number {
  try { return differenceInDays(parseISO(checkOut), parseISO(checkIn)); }
  catch { return 0; }
}

function getMealPlanLabel(plan: string | null | undefined): string {
  if (!plan) return '—';
  const map: Record<string, string> = {
    'RO': 'Sem refeição', 'BB': 'Café da manhã', 'HB': 'Meia pensão',
    'FB': 'Pensão completa', 'AI': 'All Inclusive',
  };
  return map[plan.toUpperCase()] || plan;
}

function getMealPlanIcon(plan: string | null | undefined) {
  if (!plan) return Coffee;
  const p = plan.toUpperCase();
  if (p === 'FB' || p === 'AI') return Utensils;
  if (p === 'HB') return Moon;
  return Coffee;
}

// ─── Status color helpers ───────────────────────────────────────────────────

function getRoomCardClasses(room: ErbonRoom): string {
  if (room.inMaintenance)
    return 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20';
  if (room.currentlyOccupiedOrAvailable === 'Ocupado') {
    if (room.idHousekeepingStatus === 'DIRTY')
      return 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20';
    return 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20';
  }
  if (room.idHousekeepingStatus === 'CLEAN')
    return 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20';
  return 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20';
}

function getStatusDot(room: ErbonRoom): string {
  if (room.inMaintenance) return 'bg-red-500';
  if (room.currentlyOccupiedOrAvailable === 'Ocupado') return 'bg-blue-500';
  if (room.idHousekeepingStatus === 'CLEAN') return 'bg-green-500';
  return 'bg-orange-500';
}

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

  // Load booking data when modal opens
  React.useEffect(() => {
    if (!isOpen || !room.currentBookingID) {
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Search booking by booking number
        const bookings = await erbonService.searchBookings(hotelId, {
          bookingNumber: String(room.currentBookingID),
        });
        if (bookings.length > 0) {
          setBooking(bookings[0]);
        }

        // Fetch in-house guest for this room
        const guests = await erbonService.fetchInHouseGuests(hotelId);
        const roomGuest = guests.find(g =>
          g.roomDescription === room.roomName || g.idBooking === room.currentBookingID
        );
        if (roomGuest) setGuest(roomGuest);
      } catch (err: any) {
        console.error('[ReservationModal] Error loading data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isOpen, room, hotelId]);

  if (!isOpen) return null;

  const nights = booking ? getNights(booking.checkInDateTime, booking.checkOutDateTime) : 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`UH ${room.roomName}`} size="4xl">
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
          <span className="ml-3 text-gray-500 dark:text-gray-400">Carregando detalhes...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-red-500 mb-2">Erro ao carregar dados</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
        </div>
      ) : !booking && !guest ? (
        <div className="text-center py-12">
          {/* Room info without booking */}
          <div className="space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
              <BedDouble className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">
              {room.currentlyOccupiedOrAvailable === 'Ocupado' ? 'Quarto Ocupado' : 'Quarto Livre'}
            </h3>
            <div className="grid grid-cols-2 gap-4 max-w-md mx-auto mt-6">
              <InfoCard icon={BedDouble} label="Tipo" value={room.roomTypeDescription} />
              <InfoCard icon={MapPin} label="Andar" value={`${room.numberFloor}º`} />
              <InfoCard
                icon={room.idHousekeepingStatus === 'CLEAN' ? Star : Wrench}
                label="Governança"
                value={room.descriptionHousekeepingStatus}
                valueColor={room.idHousekeepingStatus === 'CLEAN' ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}
              />
              <InfoCard
                icon={room.currentlyOccupiedOrAvailable === 'Ocupado' ? User : BedDouble}
                label="Status"
                value={room.currentlyOccupiedOrAvailable}
                valueColor={room.currentlyOccupiedOrAvailable === 'Ocupado' ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'}
              />
            </div>
            {room.bookingHolderName && (
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-4">
                <User className="w-4 h-4 inline mr-1" /> {room.bookingHolderName}
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ── Top summary bar ── */}
          <div className="bg-gradient-to-r from-teal-500 to-teal-600 dark:from-teal-700 dark:to-teal-800 rounded-xl p-4 mb-5 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                  <User className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">
                    {booking?.guestList?.[0]?.name || guest?.guestName || room.bookingHolderName || 'Hóspede'}
                  </h3>
                  <p className="text-teal-100 text-sm">
                    Reserva #{booking?.erbonNumber || guest?.bookingNumber || room.currentBookingID}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="text-center">
                  <p className="text-teal-200 text-xs">Check-in</p>
                  <p className="font-semibold">{formatDate(booking?.checkInDateTime || guest?.checkInDate)}</p>
                </div>
                <div className="flex items-center gap-1 bg-white/20 px-3 py-1.5 rounded-full">
                  <Moon className="w-3.5 h-3.5" />
                  <span className="font-bold">{nights || '—'}</span>
                  <span className="text-xs">noite{nights !== 1 ? 's' : ''}</span>
                </div>
                <div className="text-center">
                  <p className="text-teal-200 text-xs">Check-out</p>
                  <p className="font-semibold">{formatDate(booking?.checkOutDateTime || guest?.checkOutDate)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
            {([
              { key: 'reserva', label: 'Reserva', icon: FileText },
              { key: 'hospede', label: 'Hóspede', icon: User },
              { key: 'conta', label: 'Conta', icon: DollarSign },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab: Reserva ── */}
          {activeTab === 'reserva' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <InfoCard icon={FileText} label="Nº Reserva" value={String(booking?.erbonNumber || guest?.bookingNumber || '—')} />
                <InfoCard icon={BedDouble} label="Tipo de UH" value={booking?.roomTypeDescription || room.roomTypeDescription} />
                <InfoCard icon={MapPin} label="UH / Andar" value={`${room.roomName} — ${room.numberFloor}º andar`} />
                <InfoCard icon={LogIn} label="Check-in" value={formatDateTime(booking?.checkInDateTime || guest?.checkInDate)} />
                <InfoCard icon={LogOut} label="Check-out" value={formatDateTime(booking?.checkOutDateTime || guest?.checkOutDate)} />
                <InfoCard icon={Clock} label="Noites" value={`${nights}`} />
                <InfoCard icon={Users} label="Hóspedes" value={`${booking?.adultQuantity || room.adultCount || 0} ADL${room.childrenCount ? ` · ${room.childrenCount} CHD` : ''}${room.babyCount ? ` · ${room.babyCount} INF` : ''}`} />
                {(() => { const MealIcon = getMealPlanIcon(guest?.mealPlan); return (
                  <InfoCard icon={MealIcon} label="Regime" value={getMealPlanLabel(guest?.mealPlan)} />
                ); })()}
                <InfoCard icon={Star} label="Status" value={booking?.confirmedStatus || booking?.status || '—'} />
              </div>

              {/* Financial summary */}
              {booking && (
                <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" /> Resumo Financeiro
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Diária</p>
                      <p className="text-lg font-bold text-gray-800 dark:text-white">
                        {nights > 0 ? formatCurrency(booking.totalBookingRate / nights) : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Total (s/ taxa)</p>
                      <p className="text-lg font-bold text-gray-800 dark:text-white">
                        {formatCurrency(booking.totalBookingRate)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Total (c/ taxa)</p>
                      <p className="text-lg font-bold text-green-600 dark:text-green-400">
                        {formatCurrency(booking.totalBookingRateWithTax)}
                      </p>
                    </div>
                  </div>
                  {booking.rateDesc && (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Tarifa: {booking.rateDesc}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
                    {booking.segmentDesc && <span>Segmento: <b className="text-gray-700 dark:text-gray-300">{booking.segmentDesc}</b></span>}
                    {booking.sourceDesc && <span>Origem: <b className="text-gray-700 dark:text-gray-300">{booking.sourceDesc}</b></span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Hóspede ── */}
          {activeTab === 'hospede' && (
            <div className="space-y-4">
              {/* Main guest from booking */}
              {booking?.guestList?.map((g, idx) => (
                <div key={g.id} className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-900 flex items-center justify-center">
                      <User className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-800 dark:text-white">{g.name}</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {idx === 0 ? 'Titular da reserva' : `Acompanhante ${idx}`}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {g.email && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Mail className="w-4 h-4 text-gray-400" /> {g.email}
                      </div>
                    )}
                    {g.phone && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Phone className="w-4 h-4 text-gray-400" /> {g.phone}
                      </div>
                    )}
                    {g.documents?.map((doc, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <CreditCard className="w-4 h-4 text-gray-400" />
                        {doc.documentType}: {doc.number}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Guest info from in-house endpoint */}
              {guest && (
                <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                  <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 text-sm">Informações Adicionais</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {guest.localityGuest && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        {guest.localityGuest}{guest.stateGuest ? `, ${guest.stateGuest}` : ''}
                      </div>
                    )}
                    {guest.countryGuestISO && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Globe className="w-4 h-4 text-gray-400" /> {guest.countryGuestISO}
                      </div>
                    )}
                    {guest.birthDate && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Calendar className="w-4 h-4 text-gray-400" /> Nascimento: {formatDate(guest.birthDate)}
                      </div>
                    )}
                    {guest.contactEmail && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Mail className="w-4 h-4 text-gray-400" /> {guest.contactEmail}
                      </div>
                    )}
                    {guest.mealPlan && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Utensils className="w-4 h-4 text-gray-400" /> {getMealPlanLabel(guest.mealPlan)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!booking?.guestList?.length && !guest && (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">Nenhuma informação de hóspede disponível.</p>
              )}
            </div>
          )}

          {/* ── Tab: Conta ── */}
          {activeTab === 'conta' && (
            <AccountTab hotelId={hotelId} booking={booking} room={room} />
          )}
        </>
      )}
    </Modal>
  );
};

// ─── Account Tab (loads charges) ────────────────────────────────────────────

const AccountTab: React.FC<{ hotelId: string; booking: ErbonBooking | null; room: ErbonRoom }> = ({ hotelId, booking, room }) => {
  const [charges, setCharges] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await erbonService.fetchAccountsReceivable(hotelId);
        setCharges(data);
      } catch (err) {
        console.error('[AccountTab] Error:', err);
        setCharges([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [hotelId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
        <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">Carregando conta...</span>
      </div>
    );
  }

  // Try to find charges for this room/booking
  const roomCharges = charges?.filter((c: any) => {
    if (booking) {
      return c.bookingInternalID === booking.bookingInternalID ||
             c.bookingNumber === booking.erbonNumber ||
             c.roomDescription === room.roomName;
    }
    return c.roomDescription === room.roomName;
  }) || [];

  if (!booking) {
    return (
      <div className="text-center py-12">
        <DollarSign className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500 dark:text-gray-400">Não foi possível carregar a conta corrente.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-600 dark:text-blue-400">Diárias</p>
          <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatCurrency(booking.totalBookingRate)}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 border border-green-200 dark:border-green-800">
          <p className="text-xs text-green-600 dark:text-green-400">Total c/ Taxas</p>
          <p className="text-xl font-bold text-green-700 dark:text-green-300">{formatCurrency(booking.totalBookingRateWithTax)}</p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-3 border border-purple-200 dark:border-purple-800">
          <p className="text-xs text-purple-600 dark:text-purple-400">Taxas</p>
          <p className="text-xl font-bold text-purple-700 dark:text-purple-300">
            {formatCurrency(booking.totalBookingRateWithTax - booking.totalBookingRate)}
          </p>
        </div>
      </div>

      {/* Charges table */}
      {roomCharges.length > 0 ? (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs">
                <th className="text-left px-4 py-2.5">Descrição</th>
                <th className="text-right px-4 py-2.5">Valor</th>
                <th className="text-right px-4 py-2.5">Data</th>
              </tr>
            </thead>
            <tbody>
              {roomCharges.map((charge: any, idx: number) => (
                <tr key={idx} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200">{charge.description || charge.desc || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-700 dark:text-gray-300">{formatCurrency(charge.value || charge.amount)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500 dark:text-gray-400">{formatDate(charge.date || charge.transactionDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Detalhamento da conta corrente indisponível via API.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Consulte o Erbon PMS para o extrato completo de lançamentos.
          </p>
        </div>
      )}
    </div>
  );
};

// ─── Info Card component ────────────────────────────────────────────────────

interface InfoCardProps {
  icon: React.ComponentType<any>;
  label: string;
  value: string;
  valueColor?: string;
}

const InfoCard: React.FC<InfoCardProps> = ({ icon: Icon, label, value, valueColor }) => (
  <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2.5 border border-gray-100 dark:border-gray-700">
    <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
    <div className="min-w-0">
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-sm font-medium truncate ${valueColor || 'text-gray-800 dark:text-white'}`}>{value}</p>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ROOM RACK COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const RoomRack: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [filterStatus, setFilterStatus] = useState<'all' | 'CLEAN' | 'DIRTY'>('all');
  const [filterOccupancy, setFilterOccupancy] = useState<'all' | 'occupied' | 'available' | 'maintenance' | 'checkin'>('all');
  const [updatingRoom, setUpdatingRoom] = useState<number | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<ErbonRoom | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'compact'>('grid');

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

  const filteredRooms = useMemo(() => {
    if (!rooms) return [];
    return rooms.filter(r => {
      if (filterStatus !== 'all' && r.idHousekeepingStatus !== filterStatus) return false;
      if (filterOccupancy === 'occupied' && r.currentlyOccupiedOrAvailable !== 'Ocupado') return false;
      if (filterOccupancy === 'available' && r.currentlyOccupiedOrAvailable !== 'Livre') return false;
      if (filterOccupancy === 'maintenance' && !r.inMaintenance) return false;
      if (filterOccupancy === 'checkin' && !r.hasCheckinToday) return false;
      return true;
    });
  }, [rooms, filterStatus, filterOccupancy]);

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

  const stats = useMemo(() => {
    if (!rooms) return { total: 0, clean: 0, dirty: 0, occupied: 0, available: 0, maintenance: 0, checkinToday: 0 };
    return {
      total: rooms.length,
      clean: rooms.filter(r => r.idHousekeepingStatus === 'CLEAN').length,
      dirty: rooms.filter(r => r.idHousekeepingStatus === 'DIRTY').length,
      occupied: rooms.filter(r => r.currentlyOccupiedOrAvailable === 'Ocupado').length,
      available: rooms.filter(r => r.currentlyOccupiedOrAvailable === 'Livre').length,
      maintenance: rooms.filter(r => r.inMaintenance).length,
      checkinToday: rooms.filter(r => r.hasCheckinToday).length,
    };
  }, [rooms]);

  const occupancyPercent = stats.total > 0 ? Math.round((stats.occupied / stats.total) * 100) : 0;

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-900 flex items-center justify-center">
            <LayoutGrid className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Rack de UH's</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {stats.occupied}/{stats.total} ocupados · {occupancyPercent}% ocupação
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'grid' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('compact')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'compact' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <BedDouble className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={refetch} disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors text-gray-700 dark:text-gray-200">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {[
          { label: 'Total', value: stats.total, color: 'text-gray-700 dark:text-gray-200', bg: 'bg-white dark:bg-gray-800', filter: 'all' as const },
          { label: 'Ocupados', value: stats.occupied, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', filter: 'occupied' as const },
          { label: 'Livres', value: stats.available, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', filter: 'available' as const },
          { label: 'Limpos', value: stats.clean, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', filter: 'all' as const },
          { label: 'Sujos', value: stats.dirty, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', filter: 'all' as const },
          { label: 'Manutenção', value: stats.maintenance, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', filter: 'maintenance' as const },
          { label: 'Check-in Hoje', value: stats.checkinToday, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20', filter: 'checkin' as const },
        ].map(s => (
          <button
            key={s.label}
            onClick={() => {
              if (s.label === 'Limpos') { setFilterStatus('CLEAN'); setFilterOccupancy('all'); }
              else if (s.label === 'Sujos') { setFilterStatus('DIRTY'); setFilterOccupancy('all'); }
              else if (s.label === 'Total') { setFilterStatus('all'); setFilterOccupancy('all'); }
              else { setFilterStatus('all'); setFilterOccupancy(s.filter); }
            }}
            className={`${s.bg} rounded-xl p-3 text-center shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-shadow cursor-pointer`}
          >
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.label}</p>
          </button>
        ))}
      </div>

      {/* ── Occupancy bar ── */}
      <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Taxa de Ocupação</span>
          <span className="text-sm font-bold text-gray-800 dark:text-white">{occupancyPercent}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              occupancyPercent > 80 ? 'bg-red-500' : occupancyPercent > 50 ? 'bg-yellow-500' : 'bg-teal-500'
            }`}
            style={{ width: `${occupancyPercent}%` }}
          />
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            <option value="all">Todos Status</option>
            <option value="CLEAN">Limpos</option>
            <option value="DIRTY">Sujos</option>
          </select>
        </div>
        <select value={filterOccupancy} onChange={e => setFilterOccupancy(e.target.value as any)}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
          <option value="all">Todas Ocupações</option>
          <option value="occupied">Ocupados</option>
          <option value="available">Livres</option>
          <option value="maintenance">Manutenção</option>
          <option value="checkin">Check-in Hoje</option>
        </select>
        {(filterStatus !== 'all' || filterOccupancy !== 'all') && (
          <button
            onClick={() => { setFilterStatus('all'); setFilterOccupancy('all'); }}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 flex items-center gap-1 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Limpar filtros
          </button>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-4 mb-6 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500" /> Ocupado</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500" /> Livre/Limpo</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-orange-500" /> Livre/Sujo</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500" /> Manutenção</span>
        <span className="flex items-center gap-1.5"><UserCheck className="w-3 h-3 text-purple-500" /> Check-in hoje</span>
      </div>

      {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

      {/* ── Room Grid ── */}
      {loading && !rooms ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedRooms).map(([type, typeRooms]) => (
            <div key={type}>
              <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                <BedDouble className="w-5 h-5 text-teal-500" />
                {type}
                <span className="text-sm font-normal text-gray-400">({typeRooms.length})</span>
              </h2>

              {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                  {typeRooms.map(room => {
                    const isOccupied = room.currentlyOccupiedOrAvailable === 'Ocupado';
                    const isClean = room.idHousekeepingStatus === 'CLEAN';
                    const isUpdating = updatingRoom === room.idRoom;

                    return (
                      <div
                        key={room.idRoom}
                        onClick={() => setSelectedRoom(room)}
                        className={`relative rounded-xl border-2 p-3 transition-all duration-200 hover:shadow-lg hover:scale-[1.02] cursor-pointer ${getRoomCardClasses(room)}`}
                      >
                        {/* Status dot */}
                        <div className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${getStatusDot(room)}`} />

                        {/* Room number */}
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-lg font-bold text-gray-800 dark:text-white">{room.roomName}</span>
                          {room.inMaintenance && <Wrench className="w-3.5 h-3.5 text-red-500" />}
                          {room.hasCheckinToday && <UserCheck className="w-3.5 h-3.5 text-purple-500" />}
                        </div>

                        {/* Status badges */}
                        <div className="flex flex-wrap gap-1 mb-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            isClean
                              ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200'
                              : 'bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200'
                          }`}>
                            {isClean ? 'Limpo' : 'Sujo'}
                          </span>
                        </div>

                        {/* Guest info */}
                        {isOccupied && room.bookingHolderName && (
                          <p className="text-[11px] text-gray-600 dark:text-gray-300 truncate mb-1" title={room.bookingHolderName}>
                            <User className="w-3 h-3 inline mr-0.5" />
                            {room.bookingHolderName}
                          </p>
                        )}
                        {isOccupied && (room.adultCount || room.childrenCount) && (
                          <p className="text-[10px] text-gray-400 dark:text-gray-500">
                            {room.adultCount || 0} ADL {room.childrenCount ? `· ${room.childrenCount} CHD` : ''}
                          </p>
                        )}

                        {/* Toggle housekeeping button */}
                        {!room.inMaintenance && (
                          <button
                            onClick={(e) => handleToggleStatus(room, e)}
                            disabled={isUpdating}
                            className="mt-2 w-full text-[10px] font-semibold py-1 rounded-md transition-colors disabled:opacity-50
                              bg-gray-200/80 dark:bg-gray-600/80 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200"
                          >
                            {isUpdating ? <Loader2 className="w-3 h-3 mx-auto animate-spin" /> : `→ ${isClean ? 'Sujo' : 'Limpo'}`}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Compact view — list */
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400">
                        <th className="text-left px-4 py-2">UH</th>
                        <th className="text-left px-4 py-2">Status</th>
                        <th className="text-left px-4 py-2">Governança</th>
                        <th className="text-left px-4 py-2">Hóspede</th>
                        <th className="text-left px-4 py-2">Hóspedes</th>
                        <th className="text-center px-4 py-2">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {typeRooms.map(room => {
                        const isOccupied = room.currentlyOccupiedOrAvailable === 'Ocupado';
                        const isClean = room.idHousekeepingStatus === 'CLEAN';
                        return (
                          <tr
                            key={room.idRoom}
                            onClick={() => setSelectedRoom(room)}
                            className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                          >
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getStatusDot(room)}`} />
                                <span className="font-bold text-gray-800 dark:text-white">{room.roomName}</span>
                                {room.hasCheckinToday && <UserCheck className="w-3.5 h-3.5 text-purple-500" />}
                                {room.inMaintenance && <Wrench className="w-3.5 h-3.5 text-red-500" />}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-xs font-medium ${isOccupied ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {room.currentlyOccupiedOrAvailable}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                isClean
                                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                                  : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                              }`}>
                                {isClean ? 'Limpo' : 'Sujo'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 max-w-[180px] truncate">
                              {room.bookingHolderName || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">
                              {isOccupied ? `${room.adultCount || 0} ADL${room.childrenCount ? ` · ${room.childrenCount} CHD` : ''}` : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {!room.inMaintenance && (
                                <button
                                  onClick={(e) => handleToggleStatus(room, e)}
                                  disabled={updatingRoom === room.idRoom}
                                  className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50"
                                >
                                  {updatingRoom === room.idRoom ? <Loader2 className="w-3 h-3 animate-spin inline" /> : `→ ${isClean ? 'Sujo' : 'Limpo'}`}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {filteredRooms.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <BedDouble className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              <p>Nenhum quarto encontrado com os filtros selecionados.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Reservation Detail Modal ── */}
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
