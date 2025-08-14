// Importações de bibliotecas e componentes.
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

// Mapeamento de ícones para setores específicos para uma UI mais rica.
const SECTOR_ICON_MAP: { [key: string]: React.ElementType } = {
  'cozinha': ChefHat,
  'restaurante': UtensilsCrossed,
  'governança': BedDouble,
  'bar piscina': GlassWater,
  'default': Package,
};

// Lista de setores que terão abas fixas na navegação do relatório.
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

  // Função para buscar e processar os dados do relatório do backend.
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
            currentStock: String(row.sectorStocks[sector.id].calculatedFinalStock) // Inicia com o valor calculado
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

  // Separa os setores entre fixos e "outros" para a navegação por abas.
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
    fixed.sort((a, b) => FIXED_SECTORS.indexOf(a.name.toLowerCase()) - FIXED_SECTORS.indexOf(b.name.toLowerCase()));
    return { fixedSectors: fixed, otherSectors: others };
  }, [reportData?.sectors]);

  // Agrupa as linhas do relatório por categoria para a renderização.
  const groupedReportRows = useMemo(() => {
    if (!reportData?.reportRows) return {};
    return reportData.reportRows.reduce((acc, row) => {
      const category = row.category || 'Sem Categoria';
      if (!acc[category]) acc[category] = [];
      acc[category].push(row);
      return acc;
    }, {} as Record<string, typeof reportData.reportRows>);
  }, [reportData?.reportRows]);

  // --- INÍCIO: LÓGICA DE NAVEGAÇÃO PELO TECLADO ---

  // Cria uma lista simples de IDs de produtos na ordem em que são exibidos, para navegação vertical.
  const navigableRows = useMemo(() => 
    Object.values(groupedReportRows).flat().map(row => row.productId),
  [groupedReportRows]);

  // Define a ordem das colunas editáveis para navegação horizontal.
  const navigableCols = ['sales', 'consumption', 'currentStock'];

  /**
   * Manipula eventos de teclado nos inputs da tabela de setor.
   * @param e - O evento do teclado.
   * @param productId - O ID do produto da linha atual.
   * @param field - O campo ('sales', 'consumption', 'currentStock') da célula atual.
   */
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, productId: string, field: string) => {
    // Se a tecla não for de navegação, não faz nada.
    if (!['Enter', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    
    e.preventDefault(); // Previne o comportamento padrão (ex: submeter formulário com Enter).

    // Encontra a posição (linha e coluna) da célula atual.
    const currentRowIndex = navigableRows.indexOf(productId);
    const currentColIndex = navigableCols.indexOf(field);

    let nextRowIndex = currentRowIndex;
    let nextColIndex = currentColIndex;

    // Lógica para determinar a próxima célula com base na tecla pressionada.
    switch (e.key) {
      case 'Enter':
      case 'ArrowDown':
        nextRowIndex = Math.min(currentRowIndex + 1, navigableRows.length - 1);
        break;
      case 'ArrowUp':
        nextRowIndex = Math.max(currentRowIndex - 1, 0);
        break;
      case 'ArrowRight':
        nextColIndex = Math.min(currentColIndex + 1, navigableCols.length - 1);
        break;
      case 'ArrowLeft':
        nextColIndex = Math.max(currentColIndex - 1, 0);
        break;
    }

    // Pega o ID do produto e o nome do campo da próxima célula.
    const nextProductId = navigableRows[nextRowIndex];
    const nextField = navigableCols[nextColIndex];

    // Monta o ID do próximo input a ser focado.
    const nextInputId = `input-${nextField}-${nextProductId}-${activeView}`;
    const nextInput = document.getElementById(nextInputId);

    // Se o próximo input for encontrado, foca nele e seleciona seu conteúdo.
    if (nextInput) {
      nextInput.focus();
      (nextInput as HTMLInputElement).select();
    }
  };
  // --- FIM: LÓGICA DE NAVEGAÇÃO PELO TECLADO ---

  // Lida com a mudança nos campos de input manuais.
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

  // Navega para a semana anterior ou seguinte.
  const handleWeekChange = (direction: 'prev' | 'next') => {
    setCurrentWeekStart(prev => 
      direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1)
    );
  };
  
  // Exporta a planilha completa com todos os dados para um arquivo Excel.
  const handleExportAll = () => {
    // ... (código de exportação existente, sem alterações)
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
            <nav className="-mb-px flex space-x-4 px-4 overflow-x-auto" aria-label="Tabs">
              <button onClick={() => setActiveView('main')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center ${activeView === 'main' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                <Warehouse className="mr-2 h-5 w-5" /> Estoque Principal
              </button>
              {fixedSectors.map(sector => {
                const Icon = SECTOR_ICON_MAP[sector.name.toLowerCase()] || SECTOR_ICON_MAP.default;
                return (
                  <button key={sector.id} onClick={() => setActiveView(sector.id)} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center ${activeView === sector.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                    <Icon className="mr-2 h-5 w-5" /> {sector.name}
                  </button>
                )
              })}
              {otherSectors.length > 0 && (
                <div className="relative" ref={othersMenuRef}>
                  <button onClick={() => setIsOthersMenuOpen(prev => !prev)} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center ${otherSectors.some(s => s.id === activeView) ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                    <Boxes className="mr-2 h-5 w-5" /> Outros <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${isOthersMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOthersMenuOpen && (
                    <div className="origin-top-left absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 focus:outline-none z-20">
                      <div className="py-1">
                        {otherSectors.map(sector => (
                          <button key={sector.id} onClick={() => { setActiveView(sector.id); setIsOthersMenuOpen(false); }}
                            className={`w-full text-left block px-4 py-2 text-sm ${activeView === sector.id ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
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
                    {Object.entries(groupedReportRows).map(([category, rows]) => (
                        <React.Fragment key={category}>
                            <tr className="bg-gray-100 dark:bg-gray-700"><td colSpan={6} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 sticky left-0 bg-gray-100 dark:bg-gray-700 z-10">{category}</td></tr>
                            {rows.map(row => (
                                <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                    <td title={row.productName} className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10 w-48 max-w-xs truncate">{row.productName}</td>
                                    <td className="px-3 py-3 text-center text-sm">{row.mainStock.initialStock}</td>
                                    <td className="px-3 py-3 text-center text-sm text-green-600 font-medium">{row.mainStock.purchases > 0 ? `+${row.mainStock.purchases}` : '-'}</td>
                                    <td className="px-3 py-3 text-center text-sm text-orange-600 font-medium">{row.mainStock.deliveredToSectors > 0 ? `-${row.mainStock.deliveredToSectors}` : '-'}</td>
                                    <td className="px-3 py-3 text-center text-sm font-semibold">{row.mainStock.calculatedFinalStock}</td>
                                    <td className={`px-3 py-3 text-center text-sm font-bold ${row.mainStock.loss !== 0 ? 'text-red-500' : ''}`}>{row.mainStock.loss}</td>
                                </tr>
                            ))}
                        </React.Fragment>
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
                    {Object.entries(groupedReportRows).map(([category, rows]) => (
                        <React.Fragment key={category}>
                            <tr className="bg-gray-100 dark:bg-gray-700"><td colSpan={7} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 sticky left-0 bg-gray-100 dark:bg-gray-700 z-10">{category}</td></tr>
                            {rows.map(row => {
                              const sectorStock = row.sectorStocks[activeView];
                              const editable = editableValues[row.productId]?.[activeView];
                              if (!sectorStock || !editable) return null;

                              const salesNum = parseFloat(editable.sales) || 0;
                              const consumptionNum = parseFloat(editable.consumption) || 0;
                              const currentStockNum = parseFloat(editable.currentStock) || 0;
                              
                              let loss = sectorStock.initialStock + sectorStock.receivedFromMain - salesNum - consumptionNum - currentStockNum;

                              return (
                                <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                  <td title={row.productName} className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10 w-48 max-w-xs truncate">{row.productName}</td>
                                  <td className="px-3 py-3 text-center text-sm">{sectorStock.initialStock}</td>
                                  <td className="px-3 py-3 text-center text-sm text-green-600 font-medium">{sectorStock.receivedFromMain > 0 ? `+${sectorStock.receivedFromMain}` : '-'}</td>
                                  <td className="px-1 py-1 text-center">
                                    <input type="number" value={editable.sales} 
                                        id={`input-sales-${row.productId}-${activeView}`}
                                        onKeyDown={(e) => handleInputKeyDown(e, row.productId, 'sales')}
                                        onChange={e => handleInputChange(row.productId, activeView, 'sales', e.target.value)} className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                                  </td>
                                  <td className="px-1 py-1 text-center">
                                    <input type="number" value={editable.consumption} 
                                        id={`input-consumption-${row.productId}-${activeView}`}
                                        onKeyDown={(e) => handleInputKeyDown(e, row.productId, 'consumption')}
                                        onChange={e => handleInputChange(row.productId, activeView, 'consumption', e.target.value)} className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                                  </td>
                                  <td className="px-1 py-1 text-center">
                                      <input type="number" value={editable.currentStock} 
                                        id={`input-currentStock-${row.productId}-${activeView}`}
                                        onKeyDown={(e) => handleInputKeyDown(e, row.productId, 'currentStock')}
                                        onChange={e => handleInputChange(row.productId, activeView, 'currentStock', e.target.value)} className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                                  </td>
                                  <td className={`px-3 py-3 text-center text-sm font-bold ${loss !== 0 ? 'text-red-500' : ''}`}>{loss.toFixed(2)}</td>
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
      )}
    </div>
  );
};

export default WeeklyReconciliationReport;
