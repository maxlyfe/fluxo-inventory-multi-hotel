// src/pages/erbon/CheckOutList.tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  LogOut, LogIn, RefreshCw, Loader2, Calendar, Users, BedDouble,
  Search, FileText, User, DollarSign, Mail, MapPin, Clock,
  Star, UserCheck, ChevronRight,
} from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonGuest, ErbonBooking } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';
import Modal from '../../components/Modal';

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
  mainGuest: ErbonGuest;
  allGuests: ErbonGuest[];
  checkIn: string;
  checkOut: string;
  mealPlan: string;
  nights: number;
}

// ── Grouping logic ────────────────────────────────────────────────────────────

function groupByBooking(guests: ErbonGuest[]): CheckoutRow[] {
  const map = new Map<number, CheckoutRow>();
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

const InfoRow: React.FC<{ icon: React.ComponentType<any>; value: string }> = ({ icon: Icon, value }) => (
  <div className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700/50">
    <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" /><span className="truncate">{value}</span>
  </div>
);

// ── Checkout Modal ────────────────────────────────────────────────────────────

const CheckOutModal: React.FC<{
  hotelId: string;
  guest: ErbonGuest;
  onClose: () => void;
  onDone: () => void;
}> = ({ hotelId, guest, onClose, onDone }) => {
  const { addNotification } = useNotification();
  const [activeTab, setActiveTab] = useState<'reserva' | 'hospede' | 'conta'>('reserva');
  const [booking, setBooking] = useState<ErbonBooking | null>(null);
  const [inHouseGuests, setInHouseGuests] = useState<ErbonGuest[]>([]);
  const [accountEntries, setAccountEntries] = useState<any[]>([]);
  const [loadingBooking, setLoadingBooking] = useState(true);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const nights = getNights(guest.checkInDate, guest.checkOutDate);

  // Load booking details + in-house guests at open
  React.useEffect(() => {
    (async () => {
      setLoadingBooking(true);
      try {
        const [b, all] = await Promise.all([
          erbonService.fetchBookingByInternalId(hotelId, guest.idBooking),
          erbonService.fetchInHouseGuests(hotelId),
        ]);
        setBooking(b);
        setInHouseGuests(all.filter(g => g.idBooking === guest.idBooking));
      } catch (err: any) {
        console.error('[CheckOutModal] load error:', err.message);
      } finally { setLoadingBooking(false); }
    })();
  }, [hotelId, guest.idBooking]);

  const loadAccount = useCallback(async () => {
    setLoadingAccount(true);
    try {
      const data = await erbonService.fetchBookingAccount(hotelId, guest.idBooking);
      setAccountEntries(data);
    } catch { } finally { setLoadingAccount(false); }
  }, [hotelId, guest.idBooking]);

  React.useEffect(() => { if (activeTab === 'conta') loadAccount(); }, [activeTab, loadAccount]);

  const handleCheckOut = async () => {
    if (!window.confirm(`Confirmar check-out da reserva #${guest.bookingNumber}?`)) return;
    setCheckingOut(true);
    try {
      await erbonService.checkOutBooking(hotelId, guest.idBooking);
      addNotification(`✅ Check-out realizado — ${guest.guestName} · ${guest.roomDescription}`, 'success');
      onDone();
    } catch (err: any) {
      addNotification('Erro no check-out: ' + err.message, 'error');
    } finally { setCheckingOut(false); }
  };

  const totalDebit = accountEntries.filter(e => e.isDebit).reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalCredit = accountEntries.filter(e => e.isCredit).reduce((s, e) => s + Number(e.amount || 0), 0);
  const balance = totalDebit - totalCredit;

  return (
    <Modal isOpen={true} onClose={onClose} title="" size="4xl">
      {/* Hero */}
      <div className="-mt-4 -mx-4 mb-5">
        <div className="relative overflow-hidden rounded-t-lg bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500">
          <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-white/10" />
          <div className="relative px-6 py-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-lg">
                <span className="text-lg font-black text-white">{guest.roomDescription || '—'}</span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{guest.guestName}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs bg-white/20 text-white/90 px-2 py-0.5 rounded-full font-medium">
                    #{guest.bookingNumber}
                  </span>
                  <span className="text-xs text-white/70">{guest.mealPlan}</span>
                </div>
              </div>
            </div>
            <button onClick={handleCheckOut} disabled={checkingOut}
              className="flex items-center gap-2 px-4 py-2 bg-white text-amber-700 hover:bg-amber-50 font-semibold rounded-xl shadow-lg transition disabled:opacity-50">
              {checkingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              {checkingOut ? 'Processando...' : 'Fazer Check-out'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl mb-5">
        {([
          { key: 'reserva' as const, label: 'Reserva', icon: FileText },
          { key: 'hospede' as const, label: 'Hóspedes', icon: User },
          { key: 'conta' as const, label: 'Financeiro', icon: DollarSign },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === tab.key ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <tab.icon className="w-4 h-4" />{tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Reserva */}
      {activeTab === 'reserva' && (
        <div className="space-y-4">
          {loadingBooking ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <DetailCard icon={FileText} label="Reserva" value={`#${guest.bookingNumber}`} />
                <DetailCard icon={BedDouble} label="UH" value={guest.roomDescription || '—'} />
                <DetailCard icon={LogIn} label="Check-in" value={fmtDate(guest.checkInDate)} />
                <DetailCard icon={LogOut} label="Check-out" value={fmtDateTime(guest.checkOutDate)} valueColor="text-amber-600 dark:text-amber-400" />
                <DetailCard icon={Clock} label="Noites" value={`${nights}`} />
                <DetailCard icon={Users} label="Hóspedes" value={`${inHouseGuests.length} in-house`} />
                <DetailCard icon={Star} label="Regime" value={MEAL_PLAN_LABELS[guest.mealPlan] || guest.mealPlan || '—'} />
                {booking && <DetailCard icon={DollarSign} label="Total" value={fmtBRL(booking.totalBookingRateWithTax)} />}
              </div>

              {booking && (
                <div className="bg-amber-50 dark:bg-amber-900/10 rounded-2xl p-5 border border-amber-200 dark:border-amber-800/40">
                  <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-300 mb-4 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" /> Resumo Financeiro
                  </h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Diária Média</p>
                      <p className="text-lg font-bold text-gray-800 dark:text-white">{nights > 0 ? fmtBRL(booking.totalBookingRate / nights) : '—'}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Total s/ Taxa</p>
                      <p className="text-lg font-bold text-gray-800 dark:text-white">{fmtBRL(booking.totalBookingRate)}</p>
                    </div>
                    <div className="bg-amber-100 dark:bg-amber-900/30 rounded-xl p-3 border border-amber-200 dark:border-amber-800/50">
                      <p className="text-[10px] uppercase tracking-wide text-amber-600 mb-1">Total c/ Taxa</p>
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{fmtBRL(booking.totalBookingRateWithTax)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                    {booking.segmentDesc && <span className="bg-white dark:bg-gray-800 px-2 py-1 rounded-md border border-gray-100 dark:border-gray-700">Segmento: <b>{booking.segmentDesc}</b></span>}
                    {booking.sourceDesc && <span className="bg-white dark:bg-gray-800 px-2 py-1 rounded-md border border-gray-100 dark:border-gray-700">Origem: <b>{booking.sourceDesc}</b></span>}
                    {booking.rateDesc && <span className="bg-white dark:bg-gray-800 px-2 py-1 rounded-md border border-gray-100 dark:border-gray-700">Tarifa: <b>{booking.rateDesc}</b></span>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab: Hóspedes */}
      {activeTab === 'hospede' && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Hóspedes in-house ({inHouseGuests.length})</h3>
          {inHouseGuests.length === 0 ? (
            <div className="text-center py-10 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              <User className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Nenhum hóspede in-house registrado.</p>
            </div>
          ) : (
            inHouseGuests.map(g => (
              <div key={g.idGuest} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white">{g.guestName} {g.lastName && g.lastName !== g.guestName ? g.lastName : ''}</p>
                    <p className="text-xs text-gray-400">ID #{g.idGuest}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {g.contactEmail && <InfoRow icon={Mail} value={g.contactEmail} />}
                  {g.localityGuest && <InfoRow icon={MapPin} value={`${g.localityGuest}${g.stateGuest ? `, ${g.stateGuest}` : ''}`} />}
                  {g.checkInDate && <InfoRow icon={LogIn} value={`In: ${fmtDateTime(g.checkInDate)}`} />}
                  {g.checkOutDate && <InfoRow icon={LogOut} value={`Out: ${fmtDate(g.checkOutDate)}`} />}
                  {g.mealPlan && <InfoRow icon={Star} value={`Regime: ${MEAL_PLAN_LABELS[g.mealPlan] || g.mealPlan}`} />}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Financeiro */}
      {activeTab === 'conta' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-rose-50 dark:bg-rose-900/15 rounded-xl p-4 border border-rose-200 dark:border-rose-800/40">
              <p className="text-[10px] uppercase tracking-wide text-rose-500 mb-1">Débitos</p>
              <p className="text-lg font-bold text-rose-700 dark:text-rose-300">{fmtBRL(totalDebit)}</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/15 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800/40">
              <p className="text-[10px] uppercase tracking-wide text-emerald-500 mb-1">Créditos</p>
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{fmtBRL(totalCredit)}</p>
            </div>
            <div className={`rounded-xl p-4 border ${balance > 0 ? 'bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800/40' : 'bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800/40'}`}>
              <p className={`text-[10px] uppercase tracking-wide mb-1 ${balance > 0 ? 'text-amber-500' : 'text-green-500'}`}>Saldo</p>
              <p className={`text-lg font-bold ${balance > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}`}>{fmtBRL(balance)}</p>
            </div>
          </div>
          {loadingAccount ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>
          ) : accountEntries.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700/50">
              <DollarSign className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Nenhum lançamento nesta reserva.</p>
            </div>
          ) : (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800 text-[10px] uppercase tracking-wide text-gray-400 sticky top-0">
                      <th className="text-left px-4 py-2.5">Descrição</th>
                      <th className="text-right px-4 py-2.5">Débito</th>
                      <th className="text-right px-4 py-2.5">Crédito</th>
                      <th className="text-center px-4 py-2.5">NF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountEntries.map((e: any, i: number) => (
                      <tr key={e.id ?? i} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 truncate max-w-[280px]" title={e.description}>{e.description || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-red-600 dark:text-red-400">{e.isDebit ? fmtBRL(e.amount) : ''}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400">{e.isCredit ? fmtBRL(e.amount) : ''}</td>
                        <td className="px-4 py-2.5 text-center">
                          {e.isInvoiced && <span className="text-[10px] bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 px-1.5 py-0.5 rounded font-medium">Faturado</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 font-semibold">
                      <td colSpan={1} className="px-4 py-3 text-gray-600 dark:text-gray-300 text-xs uppercase">Total</td>
                      <td className="px-4 py-3 text-right font-mono text-red-700 dark:text-red-300">{totalDebit > 0 ? fmtBRL(totalDebit) : ''}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-300">{totalCredit > 0 ? fmtBRL(totalCredit) : ''}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const CheckOutList: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [search, setSearch] = useState('');
  const [selectedRow, setSelectedRow] = useState<CheckoutRow | null>(null);

  const { data: guests, loading, error, refetch, erbonConfigured } = useErbonData<ErbonGuest[]>(
    (hotelId) => erbonService.fetchTodayCheckouts(hotelId),
  );

  // Group by booking
  const bookingRows = useMemo(() => groupByBooking(guests || []), [guests]);

  // Filter on grouped rows
  const filtered = useMemo(() => {
    if (!search.trim()) return bookingRows;
    const q = search.toLowerCase();
    return bookingRows.filter(row =>
      row.mainGuest.guestName?.toLowerCase().includes(q) ||
      row.bookingNumber?.includes(q) ||
      row.room?.toLowerCase().includes(q) ||
      row.allGuests.some(g => g.guestName?.toLowerCase().includes(q))
    );
  }, [bookingRows, search]);

  const totalGuests = filtered.reduce((sum, row) => sum + row.allGuests.length, 0);

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
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Check-outs de Hoje</h1>
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
        <div className="flex items-center gap-2">
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

      {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-700">
          <UserCheck className="w-14 h-14 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-600 dark:text-gray-400 font-semibold text-lg">Nenhum check-out previsto</p>
          <p className="text-sm text-gray-400 mt-1">Não há check-outs agendados para hoje.</p>
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
                      <LogOut className="w-3 h-3 text-amber-500" />
                      {fmtDate(row.checkOut)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold">
                      {row.nights}N
                    </span>
                  </div>
                </div>

                {/* Right side: meal plan + action */}
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  {row.mealPlan && (
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                      {MEAL_PLAN_LABELS[row.mealPlan] || row.mealPlan}
                    </span>
                  )}
                  <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 group-hover:underline">
                    Fazer Check-out
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
        <CheckOutModal
          hotelId={selectedHotel!.id}
          guest={selectedRow.mainGuest}
          onClose={() => setSelectedRow(null)}
          onDone={() => { setSelectedRow(null); refetch(); }}
        />
      )}
    </div>
  );
};

export default CheckOutList;
