import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, 
  ChevronRight, 
  FileText, 
  Plus, 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Star, 
  Warehouse, 
  Utensils, 
  Trash2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { format } from 'date-fns';
import { 
  dynamicReconciliationService, 
  DynamicReconciliationData, 
  SectorCountSelection 
} from '../../lib/dynamicReconciliationService';
import { 
  reconciliationPersistenceService, 
  SavedReconciliationReport,
  SectorCountPair
} from '../../lib/reconciliationPersistenceService';

const WeeklyReconciliationReport: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'create'>('list');
  
  const [savedReports, setSavedReports] = useState<SavedReconciliationReport[]>([]);
  const [counts, setCounts] = useState<any[]>([]);
  const [sectors, setSectors] = useState<any[]>([]);
  
  const [sectorSelections, setSectorSelections] = useState<Record<string, { 
    enabled: boolean; 
    startCountId: string; 
    endCountId: string;
  }>>({});
  
  const [reportData, setReportData] = useState<DynamicReconciliationData | null>(null);
  const [activeView, setActiveView] = useState<'main' | string>('main');
  const [editableValues, setEditableValues] = useState<Record<string, number>>({});
  const [showOnlyStarred, setShowOnlyStarred] = useState(true);
  const [currentReportId, setCurrentReportId] = useState<string | undefined>();

  useEffect(() => {
    if (selectedHotel) {
      fetchInitialData();
    }
  }, [selectedHotel]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [reports, countsRes, sectorsRes] = await Promise.all([
        reconciliationPersistenceService.listReports(selectedHotel!.id),
        supabase.from('stock_counts')
          .select('id, finished_at, hotel_id, sector_id, status, notes')
          .eq('hotel_id', selectedHotel!.id)
          .eq('status', 'finished')
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false }),
        supabase.from('sectors')
          .select('id, name')
          .eq('hotel_id', selectedHotel!.id)
      ]);

      setSavedReports(reports);
      setCounts(countsRes.data || []);
      setSectors(sectorsRes.data || []);
      
      const initialSelections: Record<string, any> = {
        'main': { enabled: true, startCountId: '', endCountId: '' }
      };
      (sectorsRes.data || []).forEach((s: any) => {
        initialSelections[s.id] = { enabled: false, startCountId: '', endCountId: '' };
      });
      setSectorSelections(initialSelections);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    const activeSelections: SectorCountSelection[] = [];
    
    if (sectorSelections['main'].enabled) {
      if (!sectorSelections['main'].startCountId || !sectorSelections['main'].endCountId) {
        setError('Selecione as contagens inicial e final para o Estoque Principal.');
        return;
      }
      activeSelections.push({
        sector_id: null,
        start_count_id: sectorSelections['main'].startCountId,
        end_count_id: sectorSelections['main'].endCountId
      });
    }

    sectors.forEach(s => {
      if (sectorSelections[s.id]?.enabled) {
        if (!sectorSelections[s.id].startCountId || !sectorSelections[s.id].endCountId) {
          setError(\`Selecione as contagens inicial e final para o setor \${s.name}.\`);
          return;
        }
        activeSelections.push({
          sector_id: s.id,
          start_count_id: sectorSelections[s.id].startCountId,
          end_count_id: sectorSelections[s.id].endCountId
        });
      }
    });

    if (activeSelections.length === 0) {
      setError('Selecione pelo menos um setor para o relatório.');
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const data = await dynamicReconciliationService.generateReport(selectedHotel!.id, activeSelections);
      setReportData(data);
      
      if (!sectorSelections['main'].enabled && data.sectors.length > 0) {
        setActiveView(data.sectors[0].id);
      } else {
        setActiveView('main');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async (finalize: boolean = false) => {
    if (!reportData || !selectedHotel) return;
    
    setProcessing(true);
    try {
      const items = reportData.rows.flatMap(row => {
        const sectorItems: any[] = [];
        
        if (sectorSelections['main'].enabled) {
          sectorItems.push({
            productId: row.productId,
            sectorId: null,
            sales: 0,
            consumption: 0
          });
        }

        reportData.sectors.forEach(s => {
          sectorItems.push({
            productId: row.productId,
            sectorId: s.id,
            sales: editableValues[\`\${s.id}-\${row.productId}-sales\`] || 0,
            consumption: editableValues[\`\${s.id}-\${row.productId}-consumption\`] || 0
          });
        });
        
        return sectorItems;
      });

      const sectorCountPairs: SectorCountPair[] = Object.entries(sectorSelections)
        .filter(([_, val]) => val.enabled)
        .map(([key, val]) => ({
          sector_id: key === 'main' ? null : key,
          start_count_id: val.startCountId,
          end_count_id: val.endCountId
        }));

      const reportId = await reconciliationPersistenceService.saveReport(
        selectedHotel.id,
        sectorCountPairs,
        items,
        currentReportId
      );

      if (finalize) {
        await reconciliationPersistenceService.finalizeReport(reportId);
        alert('Relatório finalizado com sucesso!');
        setView('list');
        fetchInitialData();
        setReportData(null);
      } else {
        setCurrentReportId(reportId);
        alert('Rascunho salvo com sucesso!');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleLoadReport = async (report: SavedReconciliationReport) => {
    setProcessing(true);
    try {
      const newSelections: Record<string, any> = {};
      newSelections['main'] = { enabled: false, startCountId: '', endCountId: '' };
      sectors.forEach(s => {
        newSelections[s.id] = { enabled: false, startCountId: '', endCountId: '' };
      });

      if (report.sector_counts) {
        report.sector_counts.forEach(sc => {
          const key = sc.sector_id || 'main';
          newSelections[key] = {
            enabled: true,
            startCountId: sc.start_count_id,
            endCountId: sc.end_count_id
          };
        });
      } else if (report.start_count_id && report.end_count_id) {
        newSelections['main'] = {
          enabled: true,
          startCountId: report.start_count_id,
          endCountId: report.end_count_id
        };
      }

      setSectorSelections(newSelections);

      const selectionsForService: SectorCountSelection[] = Object.entries(newSelections)
        .filter(([_, v]) => v.enabled)
        .map(([k, v]) => ({
          sector_id: k === 'main' ? null : k,
          start_count_id: v.startCountId,
          end_count_id: v.endCountId
        }));

      const data = await dynamicReconciliationService.generateReport(selectedHotel!.id, selectionsForService);
      
      const savedItems = await reconciliationPersistenceService.getSavedItems(report.id);
      const newEditableValues: Record<string, number> = {};
      savedItems.forEach((item: any) => {
        const key = item.sector_id || 'main';
        newEditableValues[\`\${key}-\${item.product_id}-sales\`] = item.sales;
        newEditableValues[\`\${key}-\${item.product_id}-consumption\`] = item.consumption;
      });

      setReportData(data);
      setEditableValues(newEditableValues);
      setCurrentReportId(report.id);
      setView('create');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteReport = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este relatório?')) return;
    try {
      await reconciliationPersistenceService.deleteReport(id);
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const groupedRows = useMemo(() => {
    if (!reportData) return {};
    const filtered = showOnlyStarred 
      ? reportData.rows.filter(r => r.isStarred)
      : reportData.rows;
    
    return filtered.reduce((acc, row) => {
      if (!acc[row.category]) acc[row.category] = [];
      acc[row.category].push(row);
      return acc;
    }, {} as Record<string, typeof reportData.rows>);
  }, [reportData, showOnlyStarred]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Calendar className="w-6 h-6 text-blue-600" />
            Reconciliação Semanal
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            {view === 'list' ? 'Histórico de relatórios gerados' : 'Configuração do período de reconciliação'}
          </p>
        </div>
        {view === 'list' ? (
          <button 
            onClick={() => {
              setView('create');
              setReportData(null);
              setCurrentReportId(undefined);
              setEditableValues({});
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-all shadow-sm"
          >
            <Plus className="w-5 h-5" /> Novo Relatório
          </button>
        ) : (
          <button 
            onClick={() => setView('list')}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            Voltar ao Histórico
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-3 text-red-700 dark:text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-sm font-bold">OK</button>
        </div>
      )}

      {view === 'list' && (
        <div className="grid gap-4">
          {savedReports.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 p-12 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-center">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">Nenhum relatório encontrado.</p>
            </div>
          ) : (
            savedReports.map(report => (
              <div 
                key={report.id}
                className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4">
                  <div className={\`p-3 rounded-lg \${report.status === 'finalized' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}\`}>
                    {report.status === 'finalized' ? <CheckCircle className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 dark:text-white">
                      Relatório de {format(new Date(report.created_at), 'dd/MM/yyyy')}
                    </h4>
                    <p className="text-sm text-gray-500">
                      Status: {report.status === 'finalized' ? 'Finalizado' : 'Rascunho'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleLoadReport(report)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleDeleteReport(report.id)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {view === 'create' && !reportData && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 max-w-4xl mx-auto">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            Definir Período de Reconciliação por Setor
          </h3>
          
          <div className="space-y-6 mb-8">
            <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Warehouse className="w-5 h-5 text-blue-600" />
                  <span className="font-bold text-gray-900 dark:text-white">Estoque Principal</span>
                </div>
                <input 
                  type="checkbox" 
                  checked={sectorSelections['main']?.enabled}
                  onChange={(e) => setSectorSelections(prev => ({
                    ...prev,
                    'main': { ...prev['main'], enabled: e.target.checked }
                  }))}
                  className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </div>
              
              {sectorSelections['main']?.enabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500 uppercase">Contagem Inicial</label>
                    <select 
                      value={sectorSelections['main'].startCountId}
                      onChange={(e) => setSectorSelections(prev => ({
                        ...prev,
                        'main': { ...prev['main'], startCountId: e.target.value }
                      }))}
                      className="w-full p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
                    >
                      <option value="">Selecione...</option>
                      {counts.filter(c => !c.sector_id).map(c => (
                        <option key={c.id} value={c.id}>
                          {format(new Date(c.finished_at), "dd/MM/yyyy HH:mm")} {c.notes ? \`- \${c.notes}\` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500 uppercase">Contagem Final</label>
                    <select 
                      value={sectorSelections['main'].endCountId}
                      onChange={(e) => setSectorSelections(prev => ({
                        ...prev,
                        'main': { ...prev['main'], endCountId: e.target.value }
                      }))}
                      className="w-full p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
                    >
                      <option value="">Selecione...</option>
                      {counts.filter(c => !c.sector_id).map(c => (
                        <option key={c.id} value={c.id}>
                          {format(new Date(c.finished_at), "dd/MM/yyyy HH:mm")} {c.notes ? \`- \${c.notes}\` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {sectors.map(sector => (
              <div key={sector.id} className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Utensils className="w-5 h-5 text-green-600" />
                    <span className="font-bold text-gray-900 dark:text-white">{sector.name}</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={sectorSelections[sector.id]?.enabled}
                    onChange={(e) => setSectorSelections(prev => ({
                      ...prev,
                      [sector.id]: { ...prev[sector.id], enabled: e.target.checked }
                    }))}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                
                {sectorSelections[sector.id]?.enabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-500 uppercase">Contagem Inicial</label>
                      <select 
                        value={sectorSelections[sector.id].startCountId}
                        onChange={(e) => setSectorSelections(prev => ({
                          ...prev,
                          [sector.id]: { ...prev[sector.id], startCountId: e.target.value }
                        }))}
                        className="w-full p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
                      >
                        <option value="">Selecione...</option>
                        {counts.filter(c => c.sector_id === sector.id).map(c => (
                          <option key={c.id} value={c.id}>
                            {format(new Date(c.finished_at), "dd/MM/yyyy HH:mm")} {c.notes ? \`- \${c.notes}\` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-500 uppercase">Contagem Final</label>
                      <select 
                        value={sectorSelections[sector.id].endCountId}
                        onChange={(e) => setSectorSelections(prev => ({
                          ...prev,
                          [sector.id]: { ...prev[sector.id], endCountId: e.target.value }
                        }))}
                        className="w-full p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
                      >
                        <option value="">Selecione...</option>
                        {counts.filter(c => c.sector_id === sector.id).map(c => (
                          <option key={c.id} value={c.id}>
                            {format(new Date(c.finished_at), "dd/MM/yyyy HH:mm")} {c.notes ? \`- \${c.notes}\` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button 
            onClick={handleGenerateReport}
            disabled={processing}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg"
          >
            {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Gerar Relatório Consolidado'}
          </button>
        </div>
      )}

      {reportData && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowOnlyStarred(!showOnlyStarred)}
                className={\`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all \${
                  showOnlyStarred ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' : 'bg-gray-100 text-gray-600 border border-gray-200'
                }\`}
              >
                <Star className={\`w-4 h-4 \${showOnlyStarred ? 'fill-yellow-500 text-yellow-500' : ''}\`} />
                {showOnlyStarred ? 'Itens Principais' : 'Todos os Itens'}
              </button>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => handleSave(false)}
                disabled={processing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg font-medium transition-colors"
              >
                Salvar Rascunho
              </button>
              <button 
                onClick={() => handleSave(true)}
                disabled={processing}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors shadow-sm"
              >
                Finalizar Relatório
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-100 dark:border-gray-700">
            <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
              <nav className="flex space-x-4 px-4 overflow-x-auto">
                {sectorSelections['main']?.enabled && (
                  <button 
                    onClick={() => setActiveView('main')}
                    className={\`py-4 px-2 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap \${activeView === 'main' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}\`}
                  >
                    <Warehouse className="w-5 h-5" /> Estoque Principal
                  </button>
                )}
                {reportData.sectors.map(s => (
                  <button 
                    key={s.id}
                    onClick={() => setActiveView(s.id)}
                    className={\`py-4 px-2 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap \${activeView === s.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}\`}
                  >
                    <Utensils className="w-5 h-5" /> {s.name}
                  </button>
                ))}
              </nav>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                {activeView === 'main' ? (
                  <>
                    <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 uppercase text-xs font-bold sticky top-0 z-20 shadow-sm">
                      <tr>
                        <th className="px-6 py-4 sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">Item</th>
                        <th className="px-4 py-4 text-center">Est. Inicial</th>
                        <th className="px-4 py-4 text-center">Compras (+)</th>
                        <th className="px-4 py-4 text-center">Saídas (-)</th>
                        <th className="px-4 py-4 text-center">Est. Calculado</th>
                        <th className="px-4 py-4 text-center">Est. Atual (Contagem)</th>
                        <th className="px-4 py-4 text-center">Perdas/Ganhos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {Object.entries(groupedRows).map(([category, rows]) => (
                        <React.Fragment key={category}>
                          <tr className="bg-gray-50/50 dark:bg-gray-800/50">
                            <td colSpan={7} className="px-6 py-2 font-bold text-blue-600 dark:text-blue-400 text-xs uppercase tracking-wider">{category}</td>
                          </tr>
                          {rows.map(row => (
                            <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                              <td className="px-6 py-4 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10">{row.productName}</td>
                              <td className="px-4 py-4 text-center font-mono">{row.mainStock.initialStock}</td>
                              <td className="px-4 py-4 text-center font-mono text-green-600">+{row.mainStock.purchases}</td>
                              <td className="px-4 py-4 text-center font-mono text-red-500">-{row.mainStock.deliveredToSectors}</td>
                              <td className="px-4 py-4 text-center font-mono font-bold text-blue-600">{row.mainStock.calculatedFinalStock}</td>
                              <td className="px-4 py-4 text-center font-mono font-bold">{row.mainStock.actualFinalStock}</td>
                              <td className={\`px-4 py-4 text-center font-mono font-bold \${row.mainStock.loss < 0 ? 'text-red-500' : 'text-green-500'}\`}>
                                {row.mainStock.loss > 0 ? \`+\${row.mainStock.loss}\` : row.mainStock.loss}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 uppercase text-xs font-bold sticky top-0 z-20 shadow-sm">
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
                            const sales = editableValues[\`\${activeView}-\${row.productId}-sales\`] || 0;
                            const consumption = editableValues[\`\${activeView}-\${row.productId}-consumption\`] || 0;
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
                                    onChange={(e) => setEditableValues(prev => ({ ...prev, [\`\${activeView}-\${row.productId}-sales\`]: Number(e.target.value) }))}
                                    className="w-16 p-1 text-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                                  />
                                </td>
                                <td className="px-4 py-4 text-center">
                                  <input 
                                    type="number" 
                                    value={consumption}
                                    onChange={(e) => setEditableValues(prev => ({ ...prev, [\`\${activeView}-\${row.productId}-consumption\`]: Number(e.target.value) }))}
                                    className="w-16 p-1 text-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                                  />
                                </td>
                                <td className="px-4 py-4 text-center font-mono font-bold">{sectorData?.actualFinalStock || 0}</td>
                                <td className={\`px-4 py-4 text-center font-mono font-bold \${loss < 0 ? 'text-red-500' : 'text-green-500'}\`}>
                                  {loss > 0 ? \`+\${loss}\` : loss}
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
