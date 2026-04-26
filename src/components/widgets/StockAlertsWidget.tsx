import React, { useEffect, useState } from 'react';
import { Boxes, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useNavigate } from 'react-router-dom';

export default function StockAlertsWidget() {
  const { selectedHotel } = useHotel();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAlerts() {
      if (!selectedHotel?.id) return;
      setLoading(true);
      try {
        // Busca itens com estoque abaixo do mínimo
        const { data, error } = await supabase
          .from('stock_items')
          .select('id, quantity, min_quantity, products(name, unit)')
          .eq('hotel_id', selectedHotel.id)
          .lt('quantity', supabase.raw('min_quantity'))
          .limit(3);
        
        if (!error && data) {
          setAlerts(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchAlerts();
  }, [selectedHotel?.id]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 flex items-center justify-center h-full min-h-[160px]">
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
            <Boxes className="w-5 h-5 text-amber-500" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-white text-sm">Alertas de Estoque</h3>
        </div>
        {alerts.length > 0 && (
          <span className="flex h-2 w-2 rounded-full bg-red-500 animate-ping" />
        )}
      </div>

      <div className="space-y-2 flex-1">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <p className="text-xs text-slate-400">Tudo em conformidade.</p>
          </div>
        ) : (
          alerts.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700/50">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">{(item.products as any)?.name}</p>
                <p className="text-[9px] text-red-500 font-bold uppercase">Crítico: {item.quantity} / {item.min_quantity}</p>
              </div>
              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 ml-2" />
            </div>
          ))
        )}
      </div>

      <button 
        onClick={() => navigate('/inventory')}
        className="mt-3 flex items-center justify-center gap-1.5 py-2 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors w-full uppercase tracking-wider"
      >
        Ver Inventário <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}
