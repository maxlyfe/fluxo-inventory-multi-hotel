import React, { useState, useMemo } from 'react';
import { BedDouble, RefreshCw, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addDays, parseISO, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonAvailabilityDay, ErbonRoomType } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

const DAYS_VISIBLE = 14;

const RoomAvailability: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [startDate, setStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const endDate = useMemo(() => format(addDays(parseISO(startDate), DAYS_VISIBLE - 1), 'yyyy-MM-dd'), [startDate]);

  // Fetch room types
  const { data: roomTypes, loading: loadingTypes, erbonConfigured } = useErbonData<ErbonRoomType[]>(
    (hotelId) => erbonService.fetchRoomTypes(hotelId),
  );

  // Fetch availability
  const { data: availability, loading: loadingAvail, error, refetch } = useErbonData<ErbonAvailabilityDay[]>(
    (hotelId) => erbonService.fetchAvailabilityInventory(hotelId, startDate, endDate),
    [startDate, endDate],
  );

  const loading = loadingTypes || loadingAvail;

  // Gerar colunas de datas
  const dateColumns = useMemo(() => {
    const cols: string[] = [];
    for (let i = 0; i < DAYS_VISIBLE; i++) {
      cols.push(format(addDays(parseISO(startDate), i), 'yyyy-MM-dd'));
    }
    return cols;
  }, [startDate]);

  // Parse availability data into a map: date -> roomTypeId -> available count
  const availMap = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    if (!availability) return map;

    availability.forEach((day: any) => {
      const date = day.date || day.stayDate;
      if (!date) return;
      const dateKey = format(parseISO(date), 'yyyy-MM-dd');
      if (!map.has(dateKey)) map.set(dateKey, new Map());
      const dayMap = map.get(dateKey)!;

      // A API pode retornar roomTypes como array ou propriedades
      if (day.roomTypes && Array.isArray(day.roomTypes)) {
        day.roomTypes.forEach((rt: any) => {
          dayMap.set(rt.idRoomType || rt.roomTypeId, rt.available ?? rt.roomAvailable ?? 0);
        });
      } else if (day.idRoomType || day.roomTypeId) {
        dayMap.set(day.idRoomType || day.roomTypeId, day.available ?? day.roomAvailable ?? 0);
      }
    });
    return map;
  }, [availability]);

  const navigateDays = (direction: number) => {
    setStartDate(format(addDays(parseISO(startDate), direction * DAYS_VISIBLE), 'yyyy-MM-dd'));
  };

  const goToToday = () => {
    setStartDate(format(startOfDay(new Date()), 'yyyy-MM-dd'));
  };

  const isToday = (dateStr: string) => dateStr === format(new Date(), 'yyyy-MM-dd');
  const isWeekend = (dateStr: string) => {
    const d = parseISO(dateStr).getDay();
    return d === 0 || d === 6;
  };

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <BedDouble className="w-7 h-7 text-purple-600 dark:text-purple-400" />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Disponibilidade de UH's</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigateDays(-1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
          <button onClick={goToToday} className="px-3 py-1.5 text-sm font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors">
            Hoje
          </button>
          <button onClick={() => navigateDays(1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
          <button onClick={refetch} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors ml-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

      {loading && !availability ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800">
                <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 min-w-[180px] border-r border-gray-200 dark:border-gray-700">
                  Tipo UH
                </th>
                {dateColumns.map(date => (
                  <th
                    key={date}
                    className={`px-2 py-3 text-center text-xs font-medium min-w-[60px] ${
                      isToday(date)
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                        : isWeekend(date)
                        ? 'bg-orange-50 dark:bg-orange-900/10 text-orange-600 dark:text-orange-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    <div>{format(parseISO(date), 'EEE', { locale: ptBR })}</div>
                    <div className="font-bold text-sm">{format(parseISO(date), 'dd')}</div>
                    <div className="text-[10px]">{format(parseISO(date), 'MMM', { locale: ptBR })}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roomTypes && roomTypes.length > 0 ? (
                roomTypes.map(rt => (
                  <tr key={rt.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="sticky left-0 z-10 bg-white dark:bg-gray-900 px-4 py-3 border-r border-gray-200 dark:border-gray-700">
                      <p className="font-medium text-gray-800 dark:text-white">{rt.description}</p>
                      <p className="text-xs text-gray-400">{rt.roomCount} UH · max {rt.maxPax} pax</p>
                    </td>
                    {dateColumns.map(date => {
                      const dayMap = availMap.get(date);
                      const available = dayMap?.get(rt.id);
                      const hasData = available !== undefined;
                      const pct = hasData && rt.roomCount > 0 ? (available / rt.roomCount) * 100 : 100;

                      return (
                        <td
                          key={date}
                          className={`px-2 py-3 text-center font-bold ${
                            isToday(date) ? 'bg-purple-50/50 dark:bg-purple-900/10' : ''
                          } ${
                            !hasData
                              ? 'text-gray-300 dark:text-gray-600'
                              : pct === 0
                              ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                              : pct <= 30
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-green-600 dark:text-green-400'
                          }`}
                        >
                          {hasData ? available : '-'}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={dateColumns.length + 1} className="text-center py-10 text-gray-400">
                    Nenhum tipo de quarto encontrado.
                  </td>
                </tr>
              )}

              {/* Linha total */}
              {roomTypes && roomTypes.length > 0 && (
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 font-bold">
                  <td className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 border-r border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
                    Total
                  </td>
                  {dateColumns.map(date => {
                    const dayMap = availMap.get(date);
                    let total = 0;
                    let hasAny = false;
                    if (dayMap) {
                      roomTypes.forEach(rt => {
                        const v = dayMap.get(rt.id);
                        if (v !== undefined) { total += v; hasAny = true; }
                      });
                    }
                    return (
                      <td key={date} className={`px-2 py-3 text-center ${isToday(date) ? 'bg-purple-50/50 dark:bg-purple-900/10' : ''} text-gray-700 dark:text-gray-200`}>
                        {hasAny ? total : '-'}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda */}
      <div className="flex flex-wrap gap-4 mt-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500" /> Disponível</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-500" /> Baixa disponibilidade</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500" /> Esgotado</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-purple-400" /> Hoje</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-300" /> Fim de semana</span>
      </div>
    </div>
  );
};

export default RoomAvailability;
