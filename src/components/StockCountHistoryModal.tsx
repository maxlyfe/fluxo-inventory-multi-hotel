import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Package, ChevronDown, ChevronUp, History, RotateCcw, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNotification } from '../context/NotificationContext';
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
  onReopened?: () => void; // callback quando uma conferência é reaberta
}

const StockCountHistoryModal: React.FC<StockCountHistoryModalProps> = ({
  isOpen,
  onClose,
  hotelId,
  sectorId,
  onReopened
}) => {
  const { addNotification } = useNotification();
  const [history, setHistory] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [confirmReopenId, setConfirmReopenId] = useState<string | null>(null);

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

  const handleReopen = async (countId: string) => {
    setReopening(true);
    try {
      // 1. Mudar status para 'draft' e limpar finished_at
      const { error: updateError } = await supabase
        .from('stock_counts')
        .update({ status: 'draft', finished_at: null })
        .eq('id', countId);

      if (updateError) throw updateError;

      addNotification('Conferência reaberta como rascunho. Abra "Conferência" para continuar.', 'success');
      setConfirmReopenId(null);
      fetchHistory();
      onReopened?.();
    } catch (err: any) {
      console.error('Erro ao reabrir conferência:', err);
      addNotification('Erro ao reabrir: ' + (err.message || 'Erro desconhecido'), 'error');
    } finally {
      setReopening(false);
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
              {history.map((count, index) => (
                <div key={count.id} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                  <div
                    className="w-full p-4 flex items-center justify-between bg-gray-50 dark:bg-gray-900/30 hover:bg-gray-100 dark:hover:bg-gray-900/50 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId === count.id ? null : count.id)}
                  >
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Calendar className="w-4 h-4" />
                        {count.finished_at
                          ? format(parseISO(count.finished_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                          : 'Rascunho'}
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400">
                        <Package className="w-4 h-4" />
                        {count.items?.length || 0} itens conferidos
                      </div>
                      {index === 0 && count.finished_at && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                          Mais recente
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Botão reabrir — só no mais recente finalizado */}
                      {index === 0 && count.finished_at && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmReopenId(count.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50 transition-colors"
                          title="Reabrir esta conferência como rascunho"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reabrir
                        </button>
                      )}
                      {expandedId === count.id ? <ChevronUp /> : <ChevronDown />}
                    </div>
                  </div>

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

        {/* Modal de confirmação de reabertura */}
        {confirmReopenId && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 dark:text-white">Reabrir conferência?</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Esta ação transforma em rascunho</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
                A conferência será reaberta como rascunho. Você poderá ajustar as contagens e finalizar novamente pelo botão "Conferência".
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmReopenId(null)}
                  disabled={reopening}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleReopen(confirmReopenId)}
                  disabled={reopening}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {reopening ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      Reabrir
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StockCountHistoryModal;
