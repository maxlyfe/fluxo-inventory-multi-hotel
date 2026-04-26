import React, { useEffect, useState } from 'react';
import { TrendingUp, Users, BedDouble, DollarSign, Loader2 } from 'lucide-react';
import { erbonService } from '../../lib/erbonService';
import { useHotel } from '../../context/HotelContext';
import { format } from 'date-fns';

export default function PickupMiniWidget() {
  const { selectedHotel } = useHotel();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBrief() {
      if (!selectedHotel?.id) return;
      setLoading(true);
      try {
        const today = format(new Date(), 'yyyy-MM-dd');
        // Busca ocupação de hoje
        const occupancy = await erbonService.fetchOccupancyWithPension(selectedHotel.id, today, today);
        if (occupancy && occupancy[0]) {
          setData(occupancy[0]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchBrief();
  }, [selectedHotel?.id]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 flex items-center justify-center h-full min-h-[160px]">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  const sold = data ? (
    (data.roomSalledConfirmed || 0) +
    (data.roomSalledRateDefault || 0) +
    (data.roomSalledPending || 0) +
    (data.roomSalledInvited || 0) +
    (data.roomSalledHouseUse || 0) +
    (data.roomSalledPermut || 0) +
    (data.roomSalledCrewMember || 0) +
    (data.roomSalledDayUse || 0)
  ) : 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-white text-sm">Performance Hoje</h3>
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Erbon Realtime</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <div className="flex items-center gap-1.5 text-slate-400 mb-1">
            <BedDouble className="w-3 h-3" />
            <span className="text-[10px] font-bold uppercase">UHs</span>
          </div>
          <p className="text-xl font-black text-slate-800 dark:text-white leading-none">{sold}</p>
        </div>

        <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <div className="flex items-center gap-1.5 text-slate-400 mb-1">
            <DollarSign className="w-3 h-3" />
            <span className="text-[10px] font-bold uppercase">Receita</span>
          </div>
          <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 leading-none">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(data?.totalRevenue || 0)}
          </p>
        </div>
      </div>
    </div>
  );
}
