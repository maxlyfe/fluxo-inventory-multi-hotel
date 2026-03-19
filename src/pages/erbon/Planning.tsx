import React, { useState, useMemo } from 'react';
import { BarChart3, RefreshCw, Loader2, TrendingUp, Users, DollarSign, Coffee, UtensilsCrossed, CalendarRange, BedDouble } from 'lucide-react';
import { format, addDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonOTB, ErbonOccupancyPension } from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';

type ViewMode = 'otb' | 'occupancy';

const Planning: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [viewMode, setViewMode] = useState<ViewMode>('occupancy');
  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(addDays(new Date(), 30), 'yyyy-MM-dd'));

  // OTB data
  const { data: otbData, loading: loadingOTB, error: errorOTB, refetch: refetchOTB, erbonConfigured } = useErbonData<ErbonOTB[]>(
    (hotelId) => erbonService.fetchOTB(hotelId, dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  // Occupancy + Pension data
  const { data: occupancyData, loading: loadingOcc, error: errorOcc, refetch: refetchOcc } = useErbonData<ErbonOccupancyPension[]>(
    (hotelId) => erbonService.fetchOccupancyWithPension(hotelId, dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  const loading = viewMode === 'otb' ? loadingOTB : loadingOcc;
  const error = viewMode === 'otb' ? errorOTB : errorOcc;
  const refetch = viewMode === 'otb' ? refetchOTB : refetchOcc;

  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const fmtDate = (d: string) => { try { return format(parseISO(d), 'dd/MM', { locale: ptBR }); } catch { return d; } };
  const fmtDateFull = (d: string) => { try { return format(parseISO(d), 'EEE dd/MM', { locale: ptBR }); } catch { return d; } };

  // Totais OTB
  const otbSummary = useMemo(() => {
    if (!otbData || otbData.length === 0) return null;
    return {
      totalRooms: otbData.reduce((s, d) => s + d.totalRoomsDeductedTransient + d.totalRoomsDeductedBlocks, 0),
      totalRevenue: otbData.reduce((s, d) => s + d.netRoomRevenueTransient, 0),
      avgInventory: Math.round(otbData.reduce((s, d) => s + d.totalInventory, 0) / otbData.length),
      days: otbData.length,
    };
  }, [otbData]);

  // Totais Occupancy
  const occSummary = useMemo(() => {
    if (!occupancyData || occupancyData.length === 0) return null;
    const totalRevenue = occupancyData.reduce((s, d) => s + d.totalRevenue, 0);
    const avgOcc = occupancyData.reduce((s, d) => s + d.occupancy, 0) / occupancyData.length;
    const avgADR = occupancyData.reduce((s, d) => s + d.adr, 0) / occupancyData.length;
    const totalCheckins = occupancyData.reduce((s, d) => s + d.totalCheckInsSingleDay, 0);
    const totalCheckouts = occupancyData.reduce((s, d) => s + d.totalCheckOutsSingleDay, 0);
    const totalBreakfast = occupancyData.reduce((s, d) => s + d.totalBreakfast, 0);
    const totalLunch = occupancyData.reduce((s, d) => s + d.totalLunch, 0);
    const totalDinner = occupancyData.reduce((s, d) => s + d.totalDinner, 0);
    return { totalRevenue, avgOcc, avgADR, totalCheckins, totalCheckouts, totalBreakfast, totalLunch, totalDinner, days: occupancyData.length };
  }, [occupancyData]);

  const setQuickRange = (days: number) => {
    setDateFrom(format(new Date(), 'yyyy-MM-dd'));
    setDateTo(format(addDays(new Date(), days), 'yyyy-MM-dd'));
  };

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Planning</h1>
        </div>
        <button onClick={refetch} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          {/* View mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
            <button
              onClick={() => setViewMode('occupancy')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'occupancy'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Ocupação & Pensão
            </button>
            <button
              onClick={() => setViewMode('otb')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'otb'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              OTB (On The Books)
            </button>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">De</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Até</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white" />
            </div>
          </div>

          {/* Quick ranges */}
          <div className="flex items-center gap-2">
            <button onClick={() => setQuickRange(7)} className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">7d</button>
            <button onClick={() => setQuickRange(14)} className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">14d</button>
            <button onClick={() => setQuickRange(30)} className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">30d</button>
            <button onClick={() => setQuickRange(60)} className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">60d</button>
            <button onClick={() => setQuickRange(90)} className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">90d</button>
          </div>
        </div>
      </div>

      {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
      ) : viewMode === 'occupancy' ? (
        /* ═══ OCCUPANCY & PENSION VIEW ═══ */
        <>
          {/* Summary cards */}
          {occSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <SummaryCard icon={<TrendingUp className="w-5 h-5 text-indigo-500" />} label="Ocupação Média" value={fmtPct(occSummary.avgOcc)} />
              <SummaryCard icon={<DollarSign className="w-5 h-5 text-green-500" />} label="Receita Total" value={fmtBRL(occSummary.totalRevenue)} />
              <SummaryCard icon={<DollarSign className="w-5 h-5 text-blue-500" />} label="ADR Médio" value={fmtBRL(occSummary.avgADR)} />
              <SummaryCard icon={<Users className="w-5 h-5 text-orange-500" />} label="Check-ins/Outs" value={`${occSummary.totalCheckins} / ${occSummary.totalCheckouts}`} />
            </div>
          )}

          {/* Pension summary */}
          {occSummary && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
                <Coffee className="w-8 h-8 text-amber-500" />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Café da Manhã</p>
                  <p className="text-xl font-bold text-gray-800 dark:text-white">{occSummary.totalBreakfast.toLocaleString()}</p>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
                <UtensilsCrossed className="w-8 h-8 text-green-500" />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Almoço</p>
                  <p className="text-xl font-bold text-gray-800 dark:text-white">{occSummary.totalLunch.toLocaleString()}</p>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
                <UtensilsCrossed className="w-8 h-8 text-purple-500" />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Jantar</p>
                  <p className="text-xl font-bold text-gray-800 dark:text-white">{occSummary.totalDinner.toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Daily table */}
          {occupancyData && occupancyData.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-3 text-left font-medium">Data</th>
                    <th className="px-3 py-3 text-center font-medium">Ocupação</th>
                    <th className="px-3 py-3 text-center font-medium">UH Vendidas</th>
                    <th className="px-3 py-3 text-center font-medium">Disponíveis</th>
                    <th className="px-3 py-3 text-center font-medium">Check-in</th>
                    <th className="px-3 py-3 text-center font-medium">Check-out</th>
                    <th className="px-3 py-3 text-center font-medium"><Coffee className="w-3 h-3 inline" /> Café</th>
                    <th className="px-3 py-3 text-center font-medium"><UtensilsCrossed className="w-3 h-3 inline" /> Alm.</th>
                    <th className="px-3 py-3 text-center font-medium"><UtensilsCrossed className="w-3 h-3 inline" /> Jan.</th>
                    <th className="px-3 py-3 text-right font-medium">ADR</th>
                    <th className="px-3 py-3 text-right font-medium">Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {occupancyData.map((day, idx) => {
                    const isToday = day.date === format(new Date(), 'yyyy-MM-dd');
                    const occPct = day.occupancy * 100;
                    return (
                      <tr key={day.date || idx}
                        className={`border-t border-gray-100 dark:border-gray-700 ${isToday ? 'bg-indigo-50 dark:bg-indigo-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
                        <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-white whitespace-nowrap">
                          {fmtDateFull(day.date)}
                          {isToday && <span className="ml-2 text-xs text-indigo-500 font-bold">HOJE</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${occPct >= 90 ? 'bg-red-500' : occPct >= 70 ? 'bg-orange-500' : 'bg-green-500'}`}
                                style={{ width: `${Math.min(occPct, 100)}%` }}
                              />
                            </div>
                            <span className={`text-xs font-bold ${occPct >= 90 ? 'text-red-600' : occPct >= 70 ? 'text-orange-600' : 'text-green-600'}`}>
                              {occPct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center font-medium text-gray-700 dark:text-gray-200">{day.roomSalledConfirmed}</td>
                        <td className="px-3 py-2.5 text-center text-gray-500">{day.roomAvailable}</td>
                        <td className="px-3 py-2.5 text-center text-green-600 font-medium">{day.totalCheckInsSingleDay}</td>
                        <td className="px-3 py-2.5 text-center text-red-600 font-medium">{day.totalCheckOutsSingleDay}</td>
                        <td className="px-3 py-2.5 text-center text-amber-600">{day.totalBreakfast}</td>
                        <td className="px-3 py-2.5 text-center text-green-600">{day.totalLunch}</td>
                        <td className="px-3 py-2.5 text-center text-purple-600">{day.totalDinner}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-gray-700 dark:text-gray-200">{fmtBRL(day.adr)}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-gray-800 dark:text-white">{fmtBRL(day.totalRevenue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        /* ═══ OTB VIEW ═══ */
        <>
          {/* Summary cards */}
          {otbSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <SummaryCard icon={<CalendarRange className="w-5 h-5 text-indigo-500" />} label="Período" value={`${otbSummary.days} dias`} />
              <SummaryCard icon={<BedDouble className="w-5 h-5 text-blue-500" />} label="UH's On The Books" value={otbSummary.totalRooms.toLocaleString()} />
              <SummaryCard icon={<DollarSign className="w-5 h-5 text-green-500" />} label="Receita Net" value={fmtBRL(otbSummary.totalRevenue)} />
              <SummaryCard icon={<BedDouble className="w-5 h-5 text-gray-500" />} label="Inventário Médio" value={`${otbSummary.avgInventory} UH/dia`} />
            </div>
          )}

          {/* Daily table */}
          {otbData && otbData.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-3 text-left font-medium">Data</th>
                    <th className="px-3 py-3 text-center font-medium">Inventário</th>
                    <th className="px-3 py-3 text-center font-medium">UH Transient</th>
                    <th className="px-3 py-3 text-center font-medium">UH Blocos</th>
                    <th className="px-3 py-3 text-right font-medium">Receita Net UH</th>
                    <th className="px-3 py-3 text-right font-medium">Receita Gross UH</th>
                    <th className="px-3 py-3 text-right font-medium">Receita Net F&B</th>
                    <th className="px-3 py-3 text-right font-medium">Receita Net Outros</th>
                  </tr>
                </thead>
                <tbody>
                  {otbData.map((day, idx) => {
                    const isToday = day.stayDate === format(new Date(), 'yyyy-MM-dd');
                    return (
                      <tr key={day.stayDate || idx}
                        className={`border-t border-gray-100 dark:border-gray-700 ${isToday ? 'bg-indigo-50 dark:bg-indigo-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
                        <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-white whitespace-nowrap">
                          {fmtDateFull(day.stayDate)}
                          {isToday && <span className="ml-2 text-xs text-indigo-500 font-bold">HOJE</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-500">{day.totalInventory}</td>
                        <td className="px-3 py-2.5 text-center font-medium text-blue-600">{day.totalRoomsDeductedTransient}</td>
                        <td className="px-3 py-2.5 text-center font-medium text-purple-600">{day.totalRoomsDeductedBlocks}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-gray-700 dark:text-gray-200">{fmtBRL(day.netRoomRevenueTransient)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-500">{fmtBRL(day.grossRoomRevenueTransient)}</td>
                        <td className="px-3 py-2.5 text-right text-green-600">{fmtBRL(day.netFBRevenueTransient)}</td>
                        <td className="px-3 py-2.5 text-right text-orange-600">{fmtBRL(day.netOtherRevenueTransient)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── Summary Card Component ────────────────────────────────────────────
const SummaryCard: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
    <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-gray-500 dark:text-gray-400">{label}</span></div>
    <p className="text-lg font-bold text-gray-800 dark:text-white">{value}</p>
  </div>
);

export default Planning;
