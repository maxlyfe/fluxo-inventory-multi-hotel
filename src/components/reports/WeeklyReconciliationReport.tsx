import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { 
  Loader2, AlertCircle, Calendar, Download, Warehouse, 
  UtensilsCrossed, ChefHat, BedDouble, Boxes, ChevronDown,
  GlassWater, Package, History, ArrowRight
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  getHotelStockCounts, 
  generateDynamicReconciliation, 
  DynamicReconciliationData 
} from '../../lib/dynamicReconciliationService';
import * as XLSX from 'xlsx';

const SECTOR_ICON_MAP: { [key: string]: React.ElementType } = {
  'cozinha': ChefHat,
  'restaurante': UtensilsCrossed,
  'governança': BedDouble,
  'bar piscina': GlassWater,
  'default': Package,
};

const FIXED_SECTORS = ['cozinha', 'restaurante', 'governança', 'bar piscina'];

const WeeklyReconciliationReport = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  
  const [counts, setCounts] = useState<any[]>([]);
  const [startCountId, setStartCountId] = useState('');
  const [endCountId, setEndCountId] = useState('');
  
  const [reportData, setReportData] = useState<DynamicReconciliationData | null>(null);
  const [editableValues, setEditableValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'main' | string>('main');

  // Carregar lista de conferências
  useEffect(() => {
    const fetchCounts = async () => {
      if (!selectedHotel) return;
      try {
        const data = await getHotelStockCounts(selectedHotel.id);
        setCounts(data || []);
      } catch (err) {
        console.error('Erro ao buscar conferências:', err);
      } finally {
        setLoadingCounts(false);
      }
    };
    fetchCounts();
  }, [selectedHotel]);

  const handleGenerateReport = async () => {
    if (!selectedHotel || !startCountId || !endCountId) {
      addNotification('Selecione as conferências inicial e final.', 'warning');
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const data = await generateDynamicReconciliation(selectedHotel.id, startCountId, endCountId);
      setReportData(data);
      
      // Inicializar valores editáveis (Vendas e Consumo)
      const initialValues: Record<string, any> = {};
      data.rows.forEach(row => {
        initialValues[row.productId] = {};
        data.sectors.forEach(s => {
          initialValues[row.productId][s.id] = {
            sales: '0',
            consumption: '0'
          };
        });
      });
      setEditableValues(initialValues);
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar relatório.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (productId: string, sectorId: string, field: 'sales' | 'consumption', value: string) => {
    setEditableValues(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [sectorId]: {
          ...prev[productId][sectorId],
          [field]: value
        }
      }
    }));
  };

  const groupedRows = useMemo(() => {
    if (!reportData) return {};
    return reportData.rows.reduce((acc, row) => {
      if (!acc[row.category]) acc[row.category] = [];
      acc[row.category].push(row);
      return acc;
    }, {} as Record<string, any[]>);
  }, [reportData]);

  const totalsByProduct = useMemo(() => {
    if (!reportData) return {};
    const totals: Record<string, number> = {};
    reportData.rows.forEach(row => {
      let total = row.mainStock.actualFinalStock;
      Object.values(row.sectorStocks).forEach((ss: any) => {
        total += ss.actualFinalStock;
      });
      totals[row.productId] = total;
    });
    return totals;
  }, [reportData]);

  if (loadingCounts) {
    return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Seleção de Período */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <History className="text-blue-500" /> Definir Período de Reconciliação
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-1">Conferência Inicial</label>
            <select 
              value={startCountId} 
              onChange={e => setStartCountId(e.target.value)}
              className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="">Selecione...</option>
              {counts.map(c => (
                <option key={c.id} value={c.id}>
                  {format(parseISO(c.finished_at), 'dd/MM/yyyy HH:mm')} - {c.notes || 'Sem notas'}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-center pb-2 hidden md:flex">
            <ArrowRight className="text-gray-400" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Conferência Final</label>
            <select 
              value={endCountId} 
              onChange={e => setEndCountId(e.target.value)}
              className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="">Selecione...</option>
              {counts.map(c => (
                <option key={c.id} value={c.id}>
                  {format(parseISO(c.finished_at), 'dd/MM/yyyy HH:mm')} - {c.notes || 'Sem notas'}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3 mt-4">
            <button 
              onClick={handleGenerateReport}
              disabled={loading || !startCountId || !endCountId}
              className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : 'Gerar Reconciliação'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {reportData && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-100 dark:border-gray-700">
          {/* Navegação */}
          <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
            <nav className="flex space-x-4 px-4 overflow-x-auto">
              <button 
                onClick={() => setActiveView('main')}
                className={`py-4 px-2 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${activeView === 'main' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                <Warehouse className="w-5 h-5" /> Estoque Principal
              </button>
              {reportData.sectors.map(s => {
                const Icon = SECTOR_ICON_MAP[s.name.toLowerCase()] || SECTOR_ICON_MAP.default;
                return (
                  <button 
                    key={s.id}
                    onClick={() => setActiveView(s.id)}
                    className={`py-4 px-2 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${activeView === s.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  >
                    <Icon className="w-5 h-5" /> {s.name}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Tabela */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-300 uppercase text-xs font-semibold">
                {activeView === 'main' ? (
                  <tr>
                    <th className="px-4 py-3 sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">Item</th>
                    <th className="px-4 py-3 text-center">Est. Anterior</th>
                    <th className="px-4 py-3 text-center">Compras</th>
                    <th className="px-4 py-3 text-center">Entregas Setores</th>
                    <th className="px-4 py-3 text-center">Est. Atual (Contagem)</th>
                    <th className="px-4 py-3 text-center">Perdas</th>
                    <th className="px-4 py-3 text-center bg-blue-50 dark:bg-blue-900/20">Total Hotel</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-4 py-3 sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">Item</th>
                    <th className="px-4 py-3 text-center">Est. Anterior</th>
                    <th className="px-4 py-3 text-center">Recebidos</th>
                    <th className="px-4 py-3 text-center">Vendas</th>
                    <th className="px-4 py-3 text-center">Consumo</th>
                    <th className="px-4 py-3 text-center">Est. Atual (Contagem)</th>
                    <th className="px-4 py-3 text-center">Perdas</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {Object.entries(groupedRows).map(([category, rows]) => (
                  <React.Fragment key={category}>
                    <tr className="bg-gray-50/50 dark:bg-gray-900/30">
                      <td colSpan={10} className="px-4 py-2 font-bold text-blue-600 dark:text-blue-400 sticky left-0">{category}</td>
                    </tr>
                    {rows.map((row: any) => {
                      if (activeView === 'main') {
                        return (
                          <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <td className="px-4 py-3 font-medium sticky left-0 bg-white dark:bg-gray-800 z-10">{row.productName}</td>
                            <td className="px-4 py-3 text-center">{row.mainStock.initialStock}</td>
                            <td className="px-4 py-3 text-center text-green-600">+{row.mainStock.purchases}</td>
                            <td className="px-4 py-3 text-center text-orange-600">-{row.mainStock.deliveredToSectors}</td>
                            <td className="px-4 py-3 text-center font-bold">{row.mainStock.actualFinalStock}</td>
                            <td className={`px-4 py-3 text-center font-bold ${row.mainStock.loss < 0 ? 'text-red-500' : 'text-green-500'}`}>
                              {row.mainStock.loss}
                            </td>
                            <td className="px-4 py-3 text-center font-black bg-blue-50/30 dark:bg-blue-900/10 text-blue-700 dark:text-blue-300">
                              {totalsByProduct[row.productId]}
                            </td>
                          </tr>
                        );
                      } else {
                        const ss = row.sectorStocks[activeView];
                        const ev = editableValues[row.productId]?.[activeView] || { sales: '0', consumption: '0' };
                        const sales = parseFloat(ev.sales) || 0;
                        const consumption = parseFloat(ev.consumption) || 0;
                        const loss = ss.actualFinalStock - (ss.initialStock + ss.received - sales - consumption);

                        return (
                          <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <td className="px-4 py-3 font-medium sticky left-0 bg-white dark:bg-gray-800 z-10">{row.productName}</td>
                            <td className="px-4 py-3 text-center">{ss.initialStock}</td>
                            <td className="px-4 py-3 text-center text-green-600">+{ss.received}</td>
                            <td className="px-2 py-2 text-center">
                              <input 
                                type="number" 
                                value={ev.sales}
                                onChange={e => handleInputChange(row.productId, activeView, 'sales', e.target.value)}
                                className="w-16 p-1 border rounded text-center dark:bg-gray-700 dark:border-gray-600"
                              />
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input 
                                type="number" 
                                value={ev.consumption}
                                onChange={e => handleInputChange(row.productId, activeView, 'consumption', e.target.value)}
                                className="w-16 p-1 border rounded text-center dark:bg-gray-700 dark:border-gray-600"
                              />
                            </td>
                            <td className="px-4 py-3 text-center font-bold">{ss.actualFinalStock}</td>
                            <td className={`px-4 py-3 text-center font-bold ${loss < 0 ? 'text-red-500' : 'text-green-500'}`}>
                              {loss.toFixed(2)}
                            </td>
                          </tr>
                        );
                      }
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default WeeklyReconciliationReport;
