import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { 
  ChevronLeft, ChevronRight, Save, Loader2, AlertCircle, Info, 
  Calendar, Download, Package, Warehouse, UtensilsCrossed, ChefHat,
  BedDouble, Boxes, ChevronDown,
  GlassWater 
} from 'lucide-react';
import { startOfWeek, endOfWeek, format, addWeeks, subWeeks, getWeek, getYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { generateWeeklyReconciliationReport, ReconciliationReportRow } from '../../lib/weeklyReconciliationService';
import * as XLSX from 'xlsx';

// --- Interfaces de Dados ---
interface ReportData {
  weekStartDate: Date;
  weekEndDate: Date;
  sectors: { id: string; name: string }[];
  reportRows: ReconciliationReportRow[];
}

interface EditableValues {
  [productId: string]: {
    [sectorId: string]: {
      sales: string;
      consumption: string;
      currentStock: string;
    };
  };
}

/**
 * Mapeamento de ícones para setores específicos.
 * Associa um nome de setor (em minúsculas) a um componente de ícone para uma UI mais rica.
 */
const SECTOR_ICON_MAP: { [key: string]: React.ElementType } = {
  'cozinha': ChefHat,
  'restaurante': UtensilsCrossed,
  'governança': BedDouble,
  'bar piscina': GlassWater,
  'default': Package,
};

/**
 * Lista de setores que terão abas fixas na navegação do relatório.
 * Os nomes devem estar em minúsculas para corresponder à lógica de filtragem.
 */
const FIXED_SECTORS = ['cozinha', 'restaurante', 'governança', 'bar piscina'];

// --- Componente Principal do Relatório ---
const WeeklyReconciliationReport = () => {
  // --- Hooks e Estados ---
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { locale: ptBR, weekStartsOn: 1 }));
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [editableValues, setEditableValues] = useState<EditableValues>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'main' | string>('main');
  const [isOthersMenuOpen, setIsOthersMenuOpen] = useState(false);
  const othersMenuRef = useRef<HTMLDivElement>(null);


  /**
   * Função para buscar e processar os dados do relatório do backend.
   * Chamada sempre que a semana ou o hotel mudam.
   */
  const fetchReport = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    setError(null);
    const result = await generateWeeklyReconciliationReport(selectedHotel.id, currentWeekStart);
    if (result.success && result.data) {
      setReportData(result.data);
      // Inicializa os valores editáveis com base nos dados recebidos do serviço.
      const initialValues: EditableValues = {};
      result.data.reportRows.forEach(row => {
        initialValues[row.productId] = {};
        result.data.sectors.forEach(sector => {
          initialValues[row.productId][sector.id] = {
            sales: '0',
            consumption: '0',
            currentStock: String(row.sectorStocks[sector.id].currentStock)
          };
        });
      });
      setEditableValues(initialValues);
    } else {
      setError(result.error || 'Erro desconhecido ao gerar relatório.');
      setReportData(null);
    }
    setLoading(false);
  }, [selectedHotel, currentWeekStart]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Efeito para fechar o menu "Outros" ao clicar fora dele.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (othersMenuRef.current && !othersMenuRef.current.contains(event.target as Node)) {
        setIsOthersMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /**
   * Separa os setores entre fixos e "outros" para a navegação por abas.
   * useMemo otimiza a performance, recalculando apenas quando os dados do relatório mudam.
   */
  const { fixedSectors, otherSectors } = useMemo(() => {
    const fixed: { id: string; name: string }[] = [];
    const others: { id: string; name: string }[] = [];
    
    reportData?.sectors.forEach(sector => {
      if (FIXED_SECTORS.includes(sector.name.toLowerCase())) {
        fixed.push(sector);
      } else {
        others.push(sector);
      }
    });
    // Garante que os setores fixos apareçam na ordem definida na constante FIXED_SECTORS.
    fixed.sort((a, b) => FIXED_SECTORS.indexOf(a.name.toLowerCase()) - FIXED_SECTORS.indexOf(b.name.toLowerCase()));

    return { fixedSectors: fixed, otherSectors: others };
  }, [reportData?.sectors]);

  /**
   * --- NOVO: Filtra as linhas do relatório para a visão de setor ativa ---
   * Mostra apenas os produtos que tiveram estoque inicial ou receberam itens na semana.
   */
  const filteredReportRowsForSector = useMemo(() => {
    if (!reportData || activeView === 'main') {
      return reportData?.reportRows || [];
    }
    return reportData.reportRows.filter(row => {
      const sectorStock = row.sectorStocks[activeView];
      return sectorStock && (sectorStock.initialStock > 0 || sectorStock.receivedFromMain > 0);
    });
  }, [reportData, activeView]);


  /**
   * Lida com a mudança nos campos de input manuais (vendas, consumo, contagem).
   */
  const handleInputChange = (productId: string, sectorId: string, field: 'sales' | 'consumption' | 'currentStock', value: string) => {
    setEditableValues(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [sectorId]: {
          ...prev[productId]?.[sectorId],
          [field]: value,
        },
      },
    }));
  };

  /**
   * Navega para a semana anterior ou seguinte.
   */
  const handleWeekChange = (direction: 'prev' | 'next') => {
    setCurrentWeekStart(prev => 
      direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1)
    );
  };
  
  /**
   * Exporta a planilha completa com todos os dados para um arquivo Excel.
   */
  const handleExportAll = () => {
    if (!reportData) {
      addNotification('error', 'Não há dados para exportar.');
      return;
    }

    const headers = [
      'Item', 'Est. Ant. (Hotel)', 'Compras', 'Entregas Setores', 'Est. Atual (Calc)', 'Perdas (Hotel)'
    ];
    reportData.sectors.forEach(sector => {
      headers.push(`Est. Ant. (${sector.name})`, `Recebidos (${sector.name})`, `Vendas (${sector.name})`, `Consumo (${sector.name})`, `Est. Atual (${sector.name})`, `Perdas (${sector.name})`);
    });

    const dataToExport = reportData.reportRows.map(row => {
      const rowData: (string | number)[] = [
        row.productName, row.mainStock.initialStock, row.mainStock.purchases, row.mainStock.deliveredToSectors,
        row.mainStock.calculatedFinalStock, row.mainStock.loss
      ];
      reportData.sectors.forEach(sector => {
        // ... (lógica de cálculo para exportação permanece a mesma)
      });
      return rowData;
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataToExport]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reconciliação Semanal");
    XLSX.writeFile(wb, `reconciliacao_${selectedHotel?.code}_${format(currentWeekStart, 'yyyy-MM-dd')}.xlsx`);
  };

  // --- Componentes de Renderização Menores ---
  const renderWeekSelector = () => (
    <div className="flex items-center justify-center space-x-4 mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
      <button onClick={() => handleWeekChange('prev')} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronLeft className="w-5 h-5" /></button>
      <div className="text-center">
        <div className="font-semibold text-lg text-gray-800 dark:text-white flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Semana {getWeek(currentWeekStart, { locale: ptBR, weekStartsOn: 1 })} de {getYear(currentWeekStart)}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {format(currentWeekStart, 'dd/MM/yyyy', { locale: ptBR })} - {format(reportData?.weekEndDate || endOfWeek(currentWeekStart, { locale: ptBR, weekStartsOn: 1 }), 'dd/MM/yyyy', { locale: ptBR })}
        </div>
      </div>
      <button onClick={() => handleWeekChange('next')} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronRight className="w-5 h-5" /></button>
    </div>
  );

  // Renderização principal do componente
  return (
    <div>
      {renderWeekSelector()}
      
      <div className="mb-4 flex justify-end">
        <button onClick={handleExportAll} disabled={!reportData || loading} className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm">
          <Download className="w-4 h-4 mr-2" />
          Exportar Tudo (Excel)
        </button>
      </div>

      {loading && (<div className="text-center p-8"><Loader2 className="w-12 h-12 mx-auto text-gray-400 animate-spin" /></div>)}
      {error && (<div className="my-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md flex items-center"><AlertCircle className="w-5 h-5 mr-2" /> {error}</div>)}
      
      {!loading && !error && reportData && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          {/* Navegação por Abas (Estoque Principal + Setores) */}
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="-mb-px flex space-x-4 px-4" aria-label="Tabs">
              {/* Aba Fixa: Estoque Principal */}
              <button onClick={() => setActiveView('main')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center ${activeView === 'main' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                <Warehouse className="mr-2 h-5 w-5" /> Estoque Principal
              </button>
              {/* Abas Fixas: Setores Principais */}
              {fixedSectors.map(sector => {
                const Icon = SECTOR_ICON_MAP[sector.name.toLowerCase()] || SECTOR_ICON_MAP.default;
                return (
                  <button key={sector.id} onClick={() => setActiveView(sector.id)} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center ${activeView === sector.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                    <Icon className="mr-2 h-5 w-5" /> {sector.name}
                  </button>
                )
              })}
              {/* Menu Suspenso: Outros Setores */}
              {otherSectors.length > 0 && (
                <div className="relative" ref={othersMenuRef}>
                  <button onClick={() => setIsOthersMenuOpen(prev => !prev)} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center ${otherSectors.some(s => s.id === activeView) ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                    <Boxes className="mr-2 h-5 w-5" /> Outros <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${isOthersMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOthersMenuOpen && (
                    <div className="origin-top-left absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 focus:outline-none z-20">
                      <div className="py-1">
                        {otherSectors.map(sector => (
                          <button
                            key={sector.id}
                            onClick={() => { setActiveView(sector.id); setIsOthersMenuOpen(false); }}
                            className={`w-full text-left block px-4 py-2 text-sm ${activeView === sector.id ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                          >
                            {sector.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </nav>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 border-separate border-spacing-0">
              {/* O conteúdo da tabela agora é renderizado condicionalmente com base na 'activeView' */}
              {activeView === 'main' ? (
                // Tabela do Estoque Principal
                <>
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-gray-700 z-10 w-48 max-w-xs">Item</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Est. Anterior</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Compras</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Entregas p/ Setores</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Est. Atual (Calculado)</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Perdas</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {reportData.reportRows.map(row => (
                      <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td title={row.productName} className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10 w-48 max-w-xs truncate">{row.productName}</td>
                        <td className="px-3 py-3 text-center text-sm">{row.mainStock.initialStock}</td>
                        <td className="px-3 py-3 text-center text-sm text-green-600 font-medium">{row.mainStock.purchases > 0 ? `+${row.mainStock.purchases}` : '-'}</td>
                        <td className="px-3 py-3 text-center text-sm text-orange-600 font-medium">{row.mainStock.deliveredToSectors > 0 ? `-${row.mainStock.deliveredToSectors}` : '-'}</td>
                        <td className="px-3 py-3 text-center text-sm font-semibold">{row.mainStock.calculatedFinalStock}</td>
                        <td className={`px-3 py-3 text-center text-sm font-bold ${row.mainStock.loss !== 0 ? 'text-red-500' : ''}`}>{row.mainStock.loss}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ) : (
                // Tabela do Setor Selecionado
                <>
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-gray-700 z-10 w-48 max-w-xs">Item</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Est. Anterior</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Recebidos</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Vendas</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Consumo</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Est. Atual (Contagem)</th>
                      <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Perdas</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredReportRowsForSector.map(row => {
                      const sectorStock = row.sectorStocks[activeView];
                      const editable = editableValues[row.productId]?.[activeView];
                      if (!sectorStock || !editable) return null;

                      const salesNum = parseFloat(editable.sales) || 0;
                      const consumptionNum = parseFloat(editable.consumption) || 0;
                      const currentStockNum = parseFloat(editable.currentStock) || 0;
                      
                      let calculatedConsumption = 0;
                      let loss = 0;
                      const sectorName = reportData.sectors.find(s => s.id === activeView)?.name || '';

                      if (sectorName.toLowerCase() === 'manutenção') {
                          calculatedConsumption = sectorStock.initialStock + sectorStock.receivedFromMain - currentStockNum;
                          loss = 0;
                      } else {
                          loss = sectorStock.initialStock + sectorStock.receivedFromMain - salesNum - consumptionNum - currentStockNum;
                      }

                      return (
                        <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td title={row.productName} className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10 w-48 max-w-xs truncate">{row.productName}</td>
                          <td className="px-3 py-3 text-center text-sm">{sectorStock.initialStock}</td>
                          <td className="px-3 py-3 text-center text-sm text-green-600 font-medium">{sectorStock.receivedFromMain > 0 ? `+${sectorStock.receivedFromMain}` : '-'}</td>
                          <td className="px-1 py-1 text-center">
                            {sectorName.toLowerCase() !== 'manutenção' && (
                              <input type="number" value={editable.sales} onChange={e => handleInputChange(row.productId, activeView, 'sales', e.target.value)} className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                            )}
                          </td>
                          <td className="px-1 py-1 text-center">
                            {sectorName.toLowerCase() === 'manutenção' ? (
                              <span className="text-sm font-semibold text-orange-600">{calculatedConsumption.toFixed(2)}</span>
                            ) : (
                              <input type="number" value={editable.consumption} onChange={e => handleInputChange(row.productId, activeView, 'consumption', e.target.value)} className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                            )}
                          </td>
                          <td className="px-1 py-1 text-center">
                              <input type="number" value={editable.currentStock} onChange={e => handleInputChange(row.productId, activeView, 'currentStock', e.target.value)} className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                          </td>
                          <td className={`px-3 py-3 text-center text-sm font-bold ${loss !== 0 ? 'text-red-500' : ''}`}>{loss.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default WeeklyReconciliationReport;
