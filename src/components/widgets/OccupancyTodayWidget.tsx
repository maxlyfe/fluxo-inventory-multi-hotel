import React, { useEffect, useState } from 'react';
import { Hotel, UserCheck, UserMinus, Loader2 } from 'lucide-react';
import { erbonService } from '../../lib/erbonService';
import { useHotel } from '../../context/HotelContext';
import { format } from 'date-fns';

export default function OccupancyTodayWidget() {
  const { selectedHotel } = useHotel();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      if (!selectedHotel?.id) return;
      setLoading(true);
      try {
        const today = format(new Date(), 'yyyy-MM-dd');
        const occupancy = await erbonService.fetchOccupancyWithPension(selectedHotel.id, today, today);
        if (occupancy && occupancy[0]) setData(occupancy[0]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [selectedHotel?.id]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 flex items-center justify-center h-full min-h-[140px]">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm h-full flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
            <Hotel className="w-4 h-4 text-indigo-500" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-white text-xs">Ocupação</h3>
        </div>
        <p className="text-xl font-black text-indigo-600 dark:text-indigo-400 leading-none">
          {data?.occupancy?.toFixed(1) || 0}%
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-700/50">
          <UserCheck className="w-3.5 h-3.5 text-blue-500" />
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase leading-none">In</p>
            <p className="text-sm font-black text-slate-800 dark:text-white">{data?.totalCheckInsSingleDay || 0}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-700/50">
          <UserMinus className="w-3.5 h-3.5 text-amber-500" />
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase leading-none">Out</p>
            <p className="text-sm font-black text-slate-800 dark:text-white">{data?.totalCheckOutsSingleDay || 0}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
