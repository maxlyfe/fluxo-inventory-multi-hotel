import React from 'react';
import { LogIn, RefreshCw, Loader2, Calendar, BedDouble, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonBooking } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

const CheckInList: React.FC = () => {
  const { selectedHotel } = useHotel();
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: bookings, loading, error, refetch, erbonConfigured } = useErbonData<ErbonBooking[]>(
    (hotelId) => erbonService.searchBookings(hotelId, { checkin: today }),
  );

  // Filtrar apenas reservas confirmadas ou com check-in hoje
  const todayCheckins = bookings?.filter(b =>
    b.status === 'CONFIRMED' || b.status === 'CHECKIN'
  ) || [];

  const fmtDate = (d: string) => { try { return format(parseISO(d), 'dd/MM/yy', { locale: ptBR }); } catch { return d; } };
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const statusColor: Record<string, string> = {
    CONFIRMED: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    CHECKIN: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    PENDING: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  };

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <LogIn className="w-7 h-7 text-green-600 dark:text-green-400" />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Check-ins de Hoje</h1>
          <span className="text-sm text-gray-500">({todayCheckins.length})</span>
        </div>
        <button onClick={refetch} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {loading && !bookings ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-green-500" /></div>
      ) : todayCheckins.length === 0 ? (
        <div className="text-center py-16">
          <LogIn className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Nenhum check-in previsto para hoje.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {todayCheckins.map(booking => {
            const mainGuest = booking.guestList?.[0];
            return (
              <div key={booking.bookingInternalID}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="text-2xl font-bold text-green-600 dark:text-green-400">{booking.roomDescription || '-'}</span>
                    <p className="text-sm text-gray-500 mt-0.5">Reserva #{booking.erbonNumber}</p>
                  </div>
                  <span className={`px-2 py-1 rounded-lg text-xs font-bold ${statusColor[booking.status] || 'bg-gray-100 text-gray-600'}`}>
                    {booking.status}
                  </span>
                </div>

                {mainGuest && (
                  <p className="font-semibold text-gray-800 dark:text-white mb-2">{mainGuest.name}</p>
                )}

                <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <p className="flex items-center gap-1.5">
                    <BedDouble className="w-3 h-3" /> {booking.roomTypeDescription}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-green-500" /> In: {fmtDate(booking.checkInDateTime)}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-red-500" /> Out: {fmtDate(booking.checkOutDateTime)}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Users className="w-3 h-3" /> {booking.adultQuantity} adulto(s)
                  </p>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                  <span className="text-xs text-gray-400">{booking.segmentDesc} · {booking.sourceDesc}</span>
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{fmtBRL(booking.totalBookingRate)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CheckInList;
