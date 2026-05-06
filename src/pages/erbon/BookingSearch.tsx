import React, { useState, useCallback } from 'react';
import { Search, RefreshCw, Loader2, Calendar, BedDouble, Users, Hash, Mail, Filter, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonBooking } from '../../lib/erbonService';
import { useHotel } from '../../context/HotelContext';
import { useErbonData } from '../../hooks/useErbonData';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

type SearchField = 'checkin' | 'checkout' | 'status' | 'bookingNumber' | 'guestEmail';

const STATUSES = [
  { value: '', label: 'Todos' },
  { value: 'BOOKING',   label: 'Reserva' },
  { value: 'CONFIRMED', label: 'Confirmada' },
  { value: 'PENDING',   label: 'Pendente' },
  { value: 'CHECKIN',   label: 'Check-in' },
  { value: 'CHECKOUT',  label: 'Check-out' },
  { value: 'CANCELLED', label: 'Cancelada' },
  { value: 'NOSHOW',    label: 'No-Show' },
];

const statusColor: Record<string, string> = {
  BOOKING:   'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  CONFIRMED: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  PENDING:   'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  CHECKIN:   'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  CHECKOUT:  'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  CANCELLED: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  CANCELED:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  CANCELADA: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  NOSHOW:    'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};

const BookingSearch: React.FC = () => {
  const { selectedHotel } = useHotel();

  // Filtros
  const [checkin, setCheckin] = useState('');
  const [checkout, setCheckout] = useState('');
  const [status, setStatus] = useState('');
  const [bookingNumber, setBookingNumber] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  // Resultados
  const [bookings, setBookings] = useState<ErbonBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Expandir detalhes
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Verificar config Erbon
  const { erbonConfigured, loading: configLoading } = useErbonData<null>(
    async () => null,
  );

  const handleSearch = useCallback(async () => {
    if (!selectedHotel?.id) return;

    const params: Record<SearchField, string | undefined> = {
      checkin: checkin || undefined,
      checkout: checkout || undefined,
      status: status || undefined,
      bookingNumber: bookingNumber || undefined,
      guestEmail: guestEmail || undefined,
    };

    // Precisa ao menos 1 filtro
    const hasFilter = Object.values(params).some(v => v);
    if (!hasFilter) {
      setError('Selecione ao menos um filtro para pesquisar.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await erbonService.searchBookings(selectedHotel.id, params);
      setBookings(result);
      setSearched(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar reservas');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel?.id, checkin, checkout, status, bookingNumber, guestEmail]);

  const clearFilters = () => {
    setCheckin('');
    setCheckout('');
    setStatus('');
    setBookingNumber('');
    setGuestEmail('');
    setBookings([]);
    setSearched(false);
    setError(null);
  };

  const fmtDate = (d: string) => {
    try { return format(parseISO(d), 'dd/MM/yyyy', { locale: ptBR }); } catch { return d; }
  };
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (!erbonConfigured && !configLoading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Search className="w-7 h-7 text-blue-600 dark:text-blue-400" />
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Pesquisa de Reservas</h1>
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Filtros</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {/* Check-in */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Check-in</label>
            <input
              type="date"
              value={checkin}
              onChange={e => setCheckin(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white"
            />
          </div>

          {/* Check-out */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Check-out</label>
            <input
              type="date"
              value={checkout}
              onChange={e => setCheckout(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white"
            >
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* Nº Reserva */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nº Reserva</label>
            <input
              type="text"
              value={bookingNumber}
              onChange={e => setBookingNumber(e.target.value)}
              placeholder="Ex: 12345"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white placeholder-gray-400"
            />
          </div>

          {/* E-mail hóspede */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">E-mail Hóspede</label>
            <input
              type="email"
              value={guestEmail}
              onChange={e => setGuestEmail(e.target.value)}
              placeholder="email@exemplo.com"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white placeholder-gray-400"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSearch}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Pesquisar
          </button>
          <button
            onClick={clearFilters}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" /> Limpar
          </button>
        </div>
      </div>

      {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

      {/* Resultados */}
      {loading && (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
      )}

      {!loading && searched && bookings.length === 0 && (
        <div className="text-center py-16">
          <Search className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Nenhuma reserva encontrada com os filtros selecionados.</p>
        </div>
      )}

      {!loading && bookings.length > 0 && (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{bookings.length} reserva(s) encontrada(s)</p>
          <div className="space-y-3">
            {bookings.map(booking => {
              const mainGuest = booking.guestList?.[0];
              const isExpanded = expandedId === booking.bookingInternalID;

              return (
                <div
                  key={booking.bookingInternalID}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
                >
                  {/* Linha principal */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : booking.bookingInternalID)}
                    className="w-full p-4 flex flex-wrap items-center gap-4 text-left"
                  >
                    {/* Número */}
                    <div className="flex items-center gap-2 min-w-[100px]">
                      <Hash className="w-4 h-4 text-gray-400" />
                      <span className="font-bold text-gray-800 dark:text-white">{booking.erbonNumber}</span>
                    </div>

                    {/* Status */}
                    <span className={`px-2 py-1 rounded-lg text-xs font-bold ${statusColor[booking.status] || 'bg-gray-100 text-gray-600'}`}>
                      {booking.status}
                    </span>

                    {/* Hóspede */}
                    <div className="flex-1 min-w-[150px]">
                      <p className="text-sm font-medium text-gray-800 dark:text-white">{mainGuest?.name || '-'}</p>
                      {mainGuest?.email && <p className="text-xs text-gray-400">{mainGuest.email}</p>}
                    </div>

                    {/* UH */}
                    <div className="flex items-center gap-1.5 text-sm text-gray-500">
                      <BedDouble className="w-4 h-4" />
                      <span>{booking.roomDescription || '-'}</span>
                    </div>

                    {/* Datas */}
                    <div className="flex items-center gap-1.5 text-sm text-gray-500">
                      <Calendar className="w-4 h-4" />
                      <span>{fmtDate(booking.checkInDateTime)} → {fmtDate(booking.checkOutDateTime)}</span>
                    </div>

                    {/* Valor */}
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-200 min-w-[100px] text-right">
                      {fmtBRL(booking.totalBookingRate)}
                    </span>
                  </button>

                  {/* Detalhes expandidos */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Tipo UH</p>
                          <p className="text-gray-700 dark:text-gray-200">{booking.roomTypeDescription}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Adultos</p>
                          <p className="text-gray-700 dark:text-gray-200 flex items-center gap-1"><Users className="w-3 h-3" />{booking.adultQuantity}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Segmento</p>
                          <p className="text-gray-700 dark:text-gray-200">{booking.segmentDesc || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Origem</p>
                          <p className="text-gray-700 dark:text-gray-200">{booking.sourceDesc || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Tarifa</p>
                          <p className="text-gray-700 dark:text-gray-200">{booking.rateDesc || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Total c/ Impostos</p>
                          <p className="font-semibold text-gray-800 dark:text-white">{fmtBRL(booking.totalBookingRateWithTax)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Status Confirmação</p>
                          <p className="text-gray-700 dark:text-gray-200">{booking.confirmedStatus || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Criada em</p>
                          <p className="text-gray-700 dark:text-gray-200">{fmtDate(booking.createdAt)}</p>
                        </div>
                      </div>

                      {/* Lista de hóspedes */}
                      {booking.guestList && booking.guestList.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs text-gray-400 mb-2 font-medium">Hóspedes ({booking.guestList.length})</p>
                          <div className="space-y-2">
                            {booking.guestList.map((guest, idx) => (
                              <div key={guest.id || idx} className="flex items-center gap-3 text-sm bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                                <span className="font-medium text-gray-700 dark:text-gray-200">{guest.name}</span>
                                {guest.email && <span className="text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" />{guest.email}</span>}
                                {guest.phone && <span className="text-gray-400">{guest.phone}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default BookingSearch;
