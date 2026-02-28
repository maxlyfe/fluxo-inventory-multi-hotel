import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Package, ChevronDown, ChevronUp, History } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface StockCount {
  id: string;
  started_at: string;
  finished_at: string;
  notes: string;
  items_count: number;
  items?: any[];
}

interface StockCountHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  hotelId: string;
  sectorId?: string;
}

const StockCountHistoryModal: React.FC<StockCountHistoryModalProps> = ({
  isOpen,
  onClose,
  hotelId,
  sectorId
}) => {
  const [history, setHistory] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen, hotelId, sectorId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('stock_counts')
        .select(`
          *,
          items:stock_count_items(
            *,
            product:products(name)
          )
        `)
        .eq('hotel_id', hotelId)
        .order('finished_at', { ascending: false });

      if (sectorId) {
        query = query.eq('sector_id', sectorId);
      } else {
        query = query.is('sector_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      setHistory(data || []);
    } catch (err) {
      console.error('Erro ao buscar histórico:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800 dark:text-white">
            <History className="w-6 h-6 text-blue-600" />
            Histórico de Conferências
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              Nenhuma conferência registrada ainda.
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((count) => (
                <div key={count.id} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedId(expandedId === count.id ? null : count.id)}
                    className="w-full p-4 flex items-center justify-between bg-gray-50 dark:bg-gray-900/30 hover:bg-gray-100 dark:hover:bg-gray-900/50 transition-colors"
                  >
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Calendar className="w-4 h-4" />
                        {format(parseISO(count.finished_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400">
                        <Package className="w-4 h-4" />
                        {count.items?.length || 0} itens conferidos
                      </div>
                    </div>
                    {expandedId === count.id ? <ChevronUp /> : <ChevronDown />}
                  </button>

                  {expandedId === count.id && (
                    <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-500 border-b border-gray-100 dark:border-gray-700">
                            <th className="pb-2 font-medium">Produto</th>
                            <th className="pb-2 font-medium text-center">Anterior</th>
                            <th className="pb-2 font-medium text-center">Contado</th>
                            <th className="pb-2 font-medium text-right">Diferença</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                          {count.items?.map((item: any) => (
                            <tr key={item.id}>
                              <td className="py-2 text-gray-800 dark:text-gray-200">{item.product?.name}</td>
                              <td className="py-2 text-center text-gray-500">{item.previous_quantity}</td>
                              <td className="py-2 text-center font-bold text-gray-800 dark:text-white">{item.counted_quantity}</td>
                              <td className={`py-2 text-right font-medium ${item.difference > 0 ? 'text-green-600' : item.difference < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                {item.difference > 0 ? `+${item.difference}` : item.difference}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StockCountHistoryModal;
