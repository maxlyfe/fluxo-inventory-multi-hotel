import React from 'react';
import { LogOut, RefreshCw, Loader2, Calendar, Mail, MapPin } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonGuest } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

const CheckOutList: React.FC = () => {
  const { selectedHotel } = useHotel();

  const { data: guests, loading, error, refetch, erbonConfigured } = useErbonData<ErbonGuest[]>(
    (hotelId) => erbonService.fetchTodayCheckouts(hotelId),
  );

  const fmtDate = (d: string) => { try { return format(parseISO(d), 'dd/MM/yy HH:mm', { locale: ptBR }); } catch { return d; } };
  const fmtShort = (d: string) => { try { return format(parseISO(d), 'dd/MM/yy', { locale: ptBR }); } catch { return d; } };

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <LogOut className="w-7 h-7 text-amber-600 dark:text-amber-400" />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Check-outs de Hoje</h1>
          {guests && <span className="text-sm text-gray-500">({guests.length})</span>}
        </div>
        <button onClick={refetch} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {loading && !guests ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
      ) : !guests || guests.length === 0 ? (
        <div className="text-center py-16">
          <LogOut className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Nenhum check-out previsto para hoje.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {guests.map(guest => (
            <div key={`${guest.idBooking}-${guest.idGuest}`}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{guest.roomDescription}</span>
                  <p className="text-sm text-gray-500 mt-0.5">#{guest.bookingNumber}</p>
                </div>
                <span className="px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  CHECK-OUT
                </span>
              </div>
              <p className="font-semibold text-gray-800 dark:text-white mb-2">{guest.guestName} {guest.lastName !== guest.guestName ? guest.lastName : ''}</p>
              <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                <p className="flex items-center gap-1.5"><Calendar className="w-3 h-3 text-green-500" /> In: {fmtShort(guest.checkInDate)}</p>
                <p className="flex items-center gap-1.5"><Calendar className="w-3 h-3 text-red-500" /> Out: {fmtDate(guest.checkOutDate)}</p>
                {guest.contactEmail && <p className="flex items-center gap-1.5"><Mail className="w-3 h-3" />{guest.contactEmail}</p>}
                {guest.localityGuest && <p className="flex items-center gap-1.5"><MapPin className="w-3 h-3" />{guest.localityGuest}{guest.stateGuest ? `, ${guest.stateGuest}` : ''}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CheckOutList;
