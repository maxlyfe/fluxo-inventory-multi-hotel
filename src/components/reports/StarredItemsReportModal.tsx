import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Modal from '../Modal';
import { useHotel } from '../../context/HotelContext';
import { 
  Loader2, Star, AlertCircle, ChevronLeft, ChevronRight, Calendar, ImageIcon,
  Warehouse, ChefHat, UtensilsCrossed, BedDouble, GlassWater, Boxes
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { dynamicReconciliationService, DynamicReconciliationData } from '../../lib/dynamicReconciliationService';
import { supabase } from '../../lib/supabase';

interface StarredItemsReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SECTOR_ICON_MAP: { [key: string]: React.ElementType } = {
  'cozinha': ChefHat,
  'restaurante': UtensilsCrossed,
  'governança': BedDouble,
  'bar piscina': GlassWater,
  'default': Warehouse,
};

const StarredItemsReportModal: React.FC<StarredItemsReportModalProps> = ({ isOpen, onClose }) => {
  const { selectedHotel } = useHotel();
  const [counts, setCounts] = useState<any[]>([]);
  const [startCountId, setStartCountId] = useState('');
  const [endCountId, setEndCountId] = useState('');
  const [reportData, setReportData] = useState<DynamicReconciliationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'main' | string>('main');

  useEffect(() => {
    const fetchCounts = async () => {
      if (!selectedHotel || !isOpen) return;
      setLoadingCounts(true);
      try {
        const { data, error } = await supabase
          .from('stock_counts')
          .select('id, finished_at')
          .eq('hotel_id', selectedHotel.id)
          .eq('status', 'completed')
          .order('finished_at', { ascending: false });
        
        if (error) throw error;
        setCounts(data || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoadingCounts(false);
      }
    };
    fetchCounts();
  }, [selectedHotel, isOpen]);

  const fetchReport = async () => {
    if (!selectedHotel || !startCountId || !endCountId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await dynamicReconciliationService.generateReport(selectedHotel.id, startCountId, endCountId);
      setReportData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const starredRows = useMemo(() => {
    if (!reportData) return [];
    return reportData.rows.filter(r => r.isStarred);
  }, [reportData]);

  const groupedRows = useMemo(() => {
    return starredRows.reduce((acc, row) => {
      if (!acc[row.category]) acc[row.category] = [];
      acc[row.category].push(row);
      return acc;
    }, {} as Record<string, any[]>);
  }, [starredRows]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Itens Principais - Reconciliação" maxWidth="max-w-6xl">
      <div className="space-y-6">
        <div className="grid md:grid-cols-2 gap-4 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase">Contagem Inicial</label>
            <select 
              value={startCountId} 
              onChange={(e) => setStartCountId(e.target.value)}
              className="w-full p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Selecione...</option>
              {counts.map(c => (
                <option key={c.id} value={c.id}>{format(new Date(c.finished_at), "dd/MM/yyyy 'às' HH:mm")}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase">Contagem Final</label>
            <div className="flex gap-2">
              <select 
                value={endCountId} 
                onChange={(e) => setEndCountId(e.target.value)}
                className="flex-1 p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecione...</option>
                {counts.map(c => (
                  <option key={c.id} value={c.id}>{format(new Date(c.finished_at), "dd/MM/yyyy 'às' HH:mm")}</option>
                ))}
              </select>
              <button 
                onClick={fetchReport}
                disabled={!startCountId || !endCountId || loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-bold transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Gerar'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5" /> {error}
          </div>
        )}

        {reportData && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
              <nav className="flex space-x-4 px-4 overflow-x-auto">
                <button 
                  onClick={() => setActiveView('main')}
                  className={`py-4 px-2 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeView === 'main' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  <Warehouse className="w-5 h-5" /> Estoque Principal
                </button>
                {reportData.sectors.map(s => {
                  const Icon = SECTOR_ICON_MAP[s.name.toLowerCase()] || SECTOR_ICON_MAP.default;
                  return (
                    <button 
                      key={s.id}
                      onClick={() => setActiveView(s.id)}
                      className={`py-4 px-2 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeView === s.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                      <Icon className="w-5 h-5" /> {s.name}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 uppercase text-xs font-bold">
                  <tr>
                    <th className="px-6 py-4 sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">Item</th>
                    <th className="px-4 py-4 text-center">Est. Anterior</th>
                    <th className="px-4 py-4 text-center">{activeView === 'main' ? 'Compras' : 'Recebidos'}</th>
                    <th className="px-4 py-4 text-center">Est. Atual</th>
                    <th className="px-4 py-4 text-center">Diferença</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {starredRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-gray-500">Nenhum item principal encontrado no período.</td>
                    </tr>
                  ) : (
                    Object.entries(groupedRows).map(([category, rows]) => (
                      <React.Fragment key={category}>
                        <tr className="bg-gray-50/50 dark:bg-gray-800/50">
                          <td colSpan={5} className="px-6 py-2 font-bold text-blue-600 dark:text-blue-400 text-xs uppercase tracking-wider">{category}</td>
                        </tr>
                        {rows.map(row => {
                          const data = activeView === 'main' ? row.mainStock : row.sectorStocks[activeView];
                          const initial = data?.initialStock || 0;
                          const movement = activeView === 'main' ? (data?.purchases || 0) - (data?.deliveredToSectors || 0) : (data?.received || 0);
                          const actual = data?.actualFinalStock || 0;
                          const diff = actual - (initial + movement);

                          return (
                            <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                              <td className="px-6 py-4 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10">{row.productName}</td>
                              <td className="px-4 py-4 text-center font-mono">{initial}</td>
                              <td className="px-4 py-4 text-center font-mono text-blue-600">{movement > 0 ? `+${movement}` : movement}</td>
                              <td className="px-4 py-4 text-center font-mono font-bold">{actual}</td>
                              <td className={`px-4 py-4 text-center font-mono font-bold ${diff < 0 ? 'text-red-500' : 'text-green-500'}`}>
                                {diff > 0 ? `+${diff}` : diff}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default StarredItemsReportModal;
