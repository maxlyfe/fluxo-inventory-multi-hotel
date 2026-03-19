import React, { useState, useMemo } from 'react';
import { Users, RefreshCw, Loader2, Search, Mail, MapPin, Calendar } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonGuest } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

const MEAL_PLAN_LABELS: Record<string, string> = {
  RO: 'Room Only', BB: 'Café da Manhã', HB: 'Meia Pensão', FB: 'Pensão Completa', AI: 'All Inclusive',
};

const InHouse: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [search, setSearch] = useState('');
  const [filterMeal, setFilterMeal] = useState('all');

  const { data: guests, loading, error, refetch, erbonConfigured } = useErbonData<ErbonGuest[]>(
    (hotelId) => erbonService.fetchInHouseGuests(hotelId),
    [],
    { autoRefreshMs: 120_000 }
  );

  const filtered = useMemo(() => {
    if (!guests) return [];
    return guests.filter(g => {
      if (search && !`${g.guestName} ${g.lastName} ${g.roomDescription}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterMeal !== 'all' && g.mealPlan !== filterMeal) return false;
      return true;
    });
  }, [guests, search, filterMeal]);

  const mealPlans = useMemo(() => {
    if (!guests) return [];
    return [...new Set(guests.map(g => g.mealPlan).filter(Boolean))].sort();
  }, [guests]);

  const fmtDate = (d: string) => { try { return format(parseISO(d), 'dd/MM/yy', { locale: ptBR }); } catch { return d; } };

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-7 h-7 text-blue-600 dark:text-blue-400" />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">In House</h1>
          {guests && <span className="text-sm text-gray-500 dark:text-gray-400">({guests.length} hóspedes)</span>}
        </div>
        <button onClick={refetch} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar hóspede ou quarto..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
        </div>
        <select value={filterMeal} onChange={e => setFilterMeal(e.target.value)}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
          <option value="all">Todos Planos</option>
          {mealPlans.map(mp => <option key={mp} value={mp}>{MEAL_PLAN_LABELS[mp] || mp}</option>)}
        </select>
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {loading && !guests ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-10">Nenhum hóspede encontrado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left">Quarto</th>
                <th className="px-4 py-3 text-left">Hóspede</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Email</th>
                <th className="px-4 py-3 text-center">Check-in</th>
                <th className="px-4 py-3 text-center">Check-out</th>
                <th className="px-4 py-3 text-center">Pensão</th>
                <th className="px-4 py-3 text-left hidden lg:table-cell">Reserva</th>
                <th className="px-4 py-3 text-left hidden lg:table-cell">Origem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(guest => (
                <tr key={`${guest.idBooking}-${guest.idGuest}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-3 font-bold text-blue-600 dark:text-blue-400">{guest.roomDescription}</td>
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-white">{guest.guestName} {guest.lastName !== guest.guestName ? guest.lastName : ''}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {guest.contactEmail ? (
                      <span className="flex items-center gap-1 text-gray-500"><Mail className="w-3 h-3" />{guest.contactEmail}</span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center"><span className="flex items-center justify-center gap-1"><Calendar className="w-3 h-3 text-green-500" />{fmtDate(guest.checkInDate)}</span></td>
                  <td className="px-4 py-3 text-center"><span className="flex items-center justify-center gap-1"><Calendar className="w-3 h-3 text-red-500" />{fmtDate(guest.checkOutDate)}</span></td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                      {MEAL_PLAN_LABELS[guest.mealPlan] || guest.mealPlan || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-500">#{guest.bookingNumber}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {guest.localityGuest ? (
                      <span className="flex items-center gap-1 text-gray-500"><MapPin className="w-3 h-3" />{guest.localityGuest}{guest.stateGuest ? `, ${guest.stateGuest}` : ''}</span>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default InHouse;
