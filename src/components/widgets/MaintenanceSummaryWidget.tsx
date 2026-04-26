import React, { useEffect, useState } from 'react';
import { Wrench, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';

export default function MaintenanceSummaryWidget() {
  const { selectedHotel } = useHotel();
  const [stats, setStats] = useState({ open: 0, urgent: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      if (!selectedHotel?.id) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('maintenance_tickets')
          .select('id, priority, status')
          .eq('hotel_id', selectedHotel.id)
          .neq('status', 'resolved')
          .neq('status', 'cancelled');
        
        if (!error && data) {
          setStats({
            open: data.length,
            urgent: data.filter(t => t.priority === 'urgent' || t.priority === 'emergency').length
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [selectedHotel?.id]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 flex items-center justify-center h-full min-h-[140px]">
        <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm h-full flex flex-col justify-between">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
          <Wrench className="w-4 h-4 text-orange-500" />
        </div>
        <h3 className="font-bold text-slate-800 dark:text-white text-xs">Manutenção</h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-300" />
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Abertos</span>
          </div>
          <span className="text-sm font-black text-slate-800 dark:text-white">{stats.open}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className={`w-3.5 h-3.5 ${stats.urgent > 0 ? 'text-red-500 animate-pulse' : 'text-slate-300'}`} />
            <span className={`text-xs font-bold ${stats.urgent > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>Urgentes</span>
          </div>
          <span className={`text-sm font-black ${stats.urgent > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-white'}`}>{stats.urgent}</span>
        </div>
      </div>
    </div>
  );
}
