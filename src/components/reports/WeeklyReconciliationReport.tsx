import React, { useState, useEffect, useMemo } from 'react';
import { 
  Loader2, AlertCircle, ChevronLeft, Warehouse, ChefHat, 
  UtensilsCrossed, BedDouble, GlassWater, Boxes, Star, 
  Plus, History, Save, CheckCircle, Trash2, Calendar, ArrowRight
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../../context/HotelContext';
import { supabase } from '../../lib/supabase';
import { dynamicReconciliationService, DynamicReconciliationData } from '../../lib/dynamicReconciliationService';
import { reconciliationPersistenceService, SavedReconciliationReport } from '../../lib/reconciliationPersistenceService';

const SECTOR_ICON_MAP: { [key: string]: React.ElementType } = {
  'cozinha': ChefHat,
  'restaurante': UtensilsCrossed,
  'governança': BedDouble,
  'bar piscina': GlassWater,
  'default': Warehouse,
};

const WeeklyReconciliationReport: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [savedReports, setSavedReports] = useState<SavedReconciliationReport[]>([]);
  const [counts, setCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados para o relatório ativo
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [startCountId, setStartCountId] = useState('');
  const [endCountId, setEndCountId] = useState('');
  const [reportData, setReportData] = useState<DynamicReconciliationData | null>(null);
  const [activeView, setActiveView] = useState<'main' | string>('main');
  const [showOnlyStarred, setShowOnlyStarred] = useState(false);
  const [editableValues, setEditableValues] = useState<Record<string, any>>({});

  useEffect(() => {
    if (selectedHotel) {
      fetchInitialData();
    }
  }, [selectedHotel]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [reports, countsRes] = await Promise.all([
        reconciliationPersistenceService.listReports(selectedHotel!.id),
supabase.from('stock_counts')
          .select('id, finished_at, hotel_id, sector_id, status')
          .eq('hotel_id', selectedHotel!.id)
          .eq('status', 'completed')
          .order('finished_at', { ascending: false })
      ]);
      setSavedReports(reports);
      setCounts(countsRes.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!startCountId || !endCountId) return;
    setProcessing(true);
    setError(null);
    try {
      const data = await dynamicReconciliationService.generateReport(selectedHotel!.id, startCountId, endCountId);
      setReportData(data);
      setEditableValues({});
      setView('create');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleLoadReport = async (report: SavedReconciliationReport) => {
    setProcessing(true);
    try {
      const [data, items] = await Promise.all([
        dynamicReconciliationService.generateReport(selectedHotel!.id, report.start_count_id, report.end_count_id),
        reconciliationPersistenceService.getSavedItems(report.id)
      ]);
      
      const values: Record<string, any> = {};
      items.forEach((item: any) => {
        values[`${item.sector_id}-${item.product_id}-sales`] = item.sales;
        values[`${item.sector_id}-${item.product_id}-consumption`] = item.consumption;
      });

      setReportData(data);
      setEditableValues(values);
      setCurrentReportId(report.id);
      setStartCountId(report.start_count_id);
      setEndCountId(report.end_count_id);
      setView('edit');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async (finalize = false) => {
    if (!reportData) return;
    setProcessing(true);
    try {
      const itemsToSave: any[] = [];
      reportData.rows.forEach(row => {
        reportData.sectors.forEach(sector => {
          const sales = editableValues[`${sector.id}-${row.productId}-sales`] || 0;
          const consumption = editableValues[`${sector.id}-${row.productId}-consumption`] || 0;
          if (sales > 0 || consumption > 0) {
            itemsToSave.push({
              productId: row.productId,
              sectorId: sector.id,
              sales,
              consumption
            });
          }
        });
      });

      const id = await reconciliationPersistenceService.saveReport(
        selectedHotel!.id,
        startCountId,
        endCountId,
        itemsToSave,
        currentReportId || undefined
      );

      if (finalize) {
        await reconciliationPersistenceService.finalizeReport(id);
      }

      await fetchInitialData();
      setView('list');
      setCurrentReportId(null);
      setReportData(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este relatório?')) return;
    try {
      await reconciliationPersistenceService.deleteReport(id);
      await fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const groupedRows = useMemo(() => {
    if (!reportData) return {};
    const filtered = showOnlyStarred ? reportData.rows.filter(r => r.isStarred) : reportData.rows;
    return filtered.reduce((acc, row) => {
      if (!acc[row.category]) acc[row.category] = [];
      acc[row.category].push(row);
      return acc;
    }, {} as Record<string, any[]>);
  }, [reportData, showOnlyStarred]);

  if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;

  return (
    <div className="space-y-6">
      {/* Cabeçalho de Navegação Interna */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <History className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">Reconciliação Semanal</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie e acompanhe as perdas por período</p>
          </div>
        </div>
        <div className="flex gap-2">
          {view === 'list' ? (
            <button 
              onClick={() => setView('create')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> Novo Relatório
            </button>
          ) : (
            <button 
              onClick={() => { setView('list'); setCurrentReportId(null); setReportData(null); }}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Voltar para Lista
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {view === 'list' && (
        <div className="grid gap-4">
          {savedReports.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
              <History className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">Nenhum relatório salvo encontrado.</p>
              <button onClick={() => setView('create')} className="mt-4 text-blue-600 font-medium hover:underline">Criar meu primeiro relatório</button>
            </div>
          ) : (
            savedReports.map(report => (
              <div key={report.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between hover:border-blue-200 transition-all group">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-full ${report.status === 'finalized' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                    {report.status === 'finalized' ? <CheckCircle className="w-5 h-5" /> : <Save className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-white">
                      <span>{format(new Date(report.start_count?.finished_at || ''), 'dd/MM/yy')}</span>
                      <ArrowRight className="w-3 h-3 text-gray-400" />
                      <span>{format(new Date(report.end_count?.finished_at || ''), 'dd/MM/yy')}</span>
                    </div>
                    <p className="text-xs text-gray-500">Criado em {format(new Date(report.created_at), 'dd/MM/yyyy HH:mm')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleLoadReport(report)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                    <Save className="w-5 h-5" />
                  </button>
                  <button onClick={() => handleDelete(report.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {(view === 'create' && !reportData) && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 max-w-2xl mx-auto">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" /> Definir Período de Reconciliação
          </h3>
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Conferência Inicial</label>
              <select 
                value={startCountId} 
                onChange={(e) => setStartCountId(e.target.value)}
                className="w-full p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Selecione a contagem inicial...</option>
                {counts.map(c => {
                  // Tenta encontrar o nome do setor se houver sector_id
                  const sectorName = c.sector_id ? 'Setor' : 'Principal';
                  return (
                    <option key={c.id} value={c.id}>
                      {format(new Date(c.finished_at), "dd/MM/yyyy 'às' HH:mm")} ({sectorName})
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Conferência Final</label>
              <select 
                value={endCountId} 
                onChange={(e) => setEndCountId(e.target.value)}
                className="w-full p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Selecione a contagem final...</option>
                {counts.map(c => {
                  // Tenta encontrar o nome do setor se houver sector_id
                  const sectorName = c.sector_id ? 'Setor' : 'Principal';
                  return (
                    <option key={c.id} value={c.id}>
                      {format(new Date(c.finished_at), "dd/MM/yyyy 'às' HH:mm")} ({sectorName})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
          <button 
            onClick={handleGenerateReport}
            disabled={!startCountId || !endCountId || processing}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-2"
          >
            {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Gerar Relatório para Preenchimento'}
          </button>
        </div>
      )}

      {reportData && (
        <div className="space-y-6">
          {/* Barra de Ações do Relatório */}
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowOnlyStarred(!showOnlyStarred)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                  showOnlyStarred ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' : 'bg-gray-100 text-gray-600 border border-gray-200'
                }`}
              >
                <Star className={`w-4 h-4 ${showOnlyStarred ? 'fill-yellow-500 text-yellow-500' : ''}`} />
                {showOnlyStarred ? 'Itens Principais' : 'Todos os Itens'}
              </button>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => handleSave(false)}
                disabled={processing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg font-medium transition-colors"
              >
                <Save className="w-4 h-4" /> Salvar Rascunho
              </button>
              <button 
                onClick={() => handleSave(true)}
                disabled={processing}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors shadow-sm"
              >
                <CheckCircle className="w-4 h-4" /> Finalizar Relatório
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-100 dark:border-gray-700">
            {/* Navegação de Abas */}
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
                {activeView === 'main' ? (
                  <>
                    <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 uppercase text-xs font-bold">
                      <tr>
                        <th className="px-6 py-4 sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">Item</th>
                        <th className="px-4 py-4 text-center">Est. Anterior</th>
                        <th className="px-4 py-4 text-center">Compras</th>
                        <th className="px-4 py-4 text-center">Entregas</th>
                        <th className="px-4 py-4 text-center">Est. Atual (Contagem)</th>
                        <th className="px-4 py-4 text-center">Perdas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {Object.entries(groupedRows).map(([category, rows]) => (
                        <React.Fragment key={category}>
                          <tr className="bg-gray-50/50 dark:bg-gray-800/50">
                            <td colSpan={6} className="px-6 py-2 font-bold text-blue-600 dark:text-blue-400 text-xs uppercase tracking-wider">{category}</td>
                          </tr>
                          {rows.map(row => (
                            <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                              <td className="px-6 py-4 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10">{row.productName}</td>
                              <td className="px-4 py-4 text-center font-mono">{row.mainStock.initialStock}</td>
                              <td className="px-4 py-4 text-center font-mono text-green-600">+{row.mainStock.purchases}</td>
                              <td className="px-4 py-4 text-center font-mono text-orange-600">-{row.mainStock.deliveredToSectors}</td>
                              <td className="px-4 py-4 text-center font-mono font-bold">{row.mainStock.actualFinalStock}</td>
                              <td className={`px-4 py-4 text-center font-mono font-bold ${row.mainStock.loss < 0 ? 'text-red-500' : 'text-green-500'}`}>
                                {row.mainStock.loss > 0 ? `+${row.mainStock.loss}` : row.mainStock.loss}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 uppercase text-xs font-bold">
                      <tr>
                        <th className="px-6 py-4 sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">Item</th>
                        <th className="px-4 py-4 text-center">Est. Anterior</th>
                        <th className="px-4 py-4 text-center">Recebidos</th>
                        <th className="px-4 py-4 text-center">Vendas</th>
                        <th className="px-4 py-4 text-center">Consumo</th>
                        <th className="px-4 py-4 text-center">Est. Atual (Contagem)</th>
                        <th className="px-4 py-4 text-center">Perdas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {Object.entries(groupedRows).map(([category, rows]) => (
                        <React.Fragment key={category}>
                          <tr className="bg-gray-50/50 dark:bg-gray-800/50">
                            <td colSpan={7} className="px-6 py-2 font-bold text-blue-600 dark:text-blue-400 text-xs uppercase tracking-wider">{category}</td>
                          </tr>
                          {rows.map(row => {
                            const sectorData = row.sectorStocks[activeView];
                            const sales = editableValues[`${activeView}-${row.productId}-sales`] || 0;
                            const consumption = editableValues[`${activeView}-${row.productId}-consumption`] || 0;
                            const expected = (sectorData?.initialStock || 0) + (sectorData?.received || 0) - sales - consumption;
                            const loss = (sectorData?.actualFinalStock || 0) - expected;

                            return (
                              <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                                <td className="px-6 py-4 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10">{row.productName}</td>
                                <td className="px-4 py-4 text-center font-mono">{sectorData?.initialStock || 0}</td>
                                <td className="px-4 py-4 text-center font-mono text-green-600">+{sectorData?.received || 0}</td>
                                <td className="px-4 py-4 text-center">
                                  <input 
                                    type="number" 
                                    value={sales}
                                    onChange={(e) => setEditableValues(prev => ({ ...prev, [`${activeView}-${row.productId}-sales`]: Number(e.target.value) }))}
                                    className="w-16 p-1 text-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                                  />
                                </td>
                                <td className="px-4 py-4 text-center">
                                  <input 
                                    type="number" 
                                    value={consumption}
                                    onChange={(e) => setEditableValues(prev => ({ ...prev, [`${activeView}-${row.productId}-consumption`]: Number(e.target.value) }))}
                                    className="w-16 p-1 text-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                                  />
                                </td>
                                <td className="px-4 py-4 text-center font-mono font-bold">{sectorData?.actualFinalStock || 0}</td>
                                <td className={`px-4 py-4 text-center font-mono font-bold ${loss < 0 ? 'text-red-500' : 'text-green-500'}`}>
                                  {loss > 0 ? `+${loss}` : loss}
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WeeklyReconciliationReport;
