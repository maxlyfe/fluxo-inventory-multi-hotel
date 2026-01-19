// Importações de bibliotecas e componentes.
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Modal from '../Modal'; // Reutiliza o componente de modal genérico.
import { useHotel } from '../../context/HotelContext';
import { 
  Loader2, Star, AlertCircle, ChevronLeft, ChevronRight, Calendar, ImageIcon,
  Warehouse, ChefHat, UtensilsCrossed, BedDouble, GlassWater, Boxes, ChevronDown
} from 'lucide-react';
import { startOfWeek, endOfWeek, format, addWeeks, subWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';
// Importa a função de serviço e as interfaces de dados.
import { generateStarredItemsReconciliationReport, ReportData } from '../../lib/weeklyReconciliationService';

// Props do componente.
interface StarredItemsReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Mapeamento de ícones para setores, para uma UI mais rica.
const SECTOR_ICON_MAP: { [key: string]: React.ElementType } = {
  'cozinha': ChefHat,
  'restaurante': UtensilsCrossed,
  'governança': BedDouble,
  'bar piscina': GlassWater,
  'default': Warehouse,
};

// Lista de setores fixos para as abas principais.
const FIXED_SECTORS = ['cozinha', 'restaurante', 'governança', 'bar piscina'];

/**
 * Componente Modal para exibir um relatório de reconciliação semanal
 * focado APENAS nos produtos marcados como "Principais" (com estrela).
 */
const StarredItemsReportModal: React.FC<StarredItemsReportModalProps> = ({ isOpen, onClose }) => {
  // --- ESTADOS (HOOKS) ---
  const { selectedHotel } = useHotel();
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { locale: ptBR, weekStartsOn: 1 }));
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Estado para controlar a visão ativa (abas: 'main' para estoque principal, ou o ID do setor).
  const [activeView, setActiveView] = useState<'main' | string>('main');
  const [isOthersMenuOpen, setIsOthersMenuOpen] = useState(false);
  const othersMenuRef = useRef<HTMLDivElement>(null);

  // --- FUNÇÕES DE BUSCA DE DADOS ---
  const fetchReport = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    setError(null);
    // Chama a função de serviço que busca apenas itens com estrela.
    const result = await generateStarredItemsReconciliationReport(selectedHotel.id, currentWeekStart);
    if (result.success && result.data) {
      setReportData(result.data);
    } else {
      setError(result.error || 'Erro desconhecido ao gerar relatório.');
      setReportData(null);
    }
    setLoading(false);
  }, [selectedHotel, currentWeekStart]);

  useEffect(() => {
    if (isOpen) {
      // Reseta a visão para 'main' e busca os dados sempre que o modal abre.
      setActiveView('main');
      fetchReport();
    }
  }, [isOpen, fetchReport]);

  // Efeito para fechar o menu "Outros" ao clicar fora.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (othersMenuRef.current && !othersMenuRef.current.contains(event.target as Node)) {
        setIsOthersMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- LÓGICA DE DADOS (MEMOIZED) ---
  // Separa os setores entre fixos e "outros" para a navegação por abas.
  const { fixedSectors, otherSectors } = useMemo(() => {
    const fixed: { id: string; name: string }[] = [];
    const others: { id: string; name: string }[] = [];
    reportData?.sectors.forEach(sector => {
      if (FIXED_SECTORS.includes(sector.name.toLowerCase())) fixed.push(sector);
      else others.push(sector);
    });
    fixed.sort((a, b) => FIXED_SECTORS.indexOf(a.name.toLowerCase()) - FIXED_SECTORS.indexOf(b.name.toLowerCase()));
    return { fixedSectors: fixed, otherSectors: others };
  }, [reportData?.sectors]);

  // Agrupa as linhas do relatório por categoria para a renderização.
  const groupedReportRows = useMemo(() => {
    if (!reportData?.reportRows) return {};
    return reportData.reportRows.reduce((acc, row) => {
      const category = row.category || 'Sem Categoria';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(row);
      return acc;
    }, {} as Record<string, typeof reportData.reportRows>);
  }, [reportData?.reportRows]);

  // --- HANDLERS DE EVENTOS ---
  const handleWeekChange = (direction: 'prev' | 'next') => {
    setCurrentWeekStart(prev => direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1));
  };

  // --- RENDERIZAÇÃO ---
  const renderWeekSelector = () => (
    <div className="flex items-center justify-center space-x-4 mb-4 bg-gray-100 dark:bg-gray-700 p-2 rounded-lg">
      <button onClick={() => handleWeekChange('prev')} className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"><ChevronLeft className="w-5 h-5" /></button>
      <div className="text-center">
        <div className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          {format(currentWeekStart, 'dd/MM/yyyy')} - {format(reportData?.weekEndDate || endOfWeek(currentWeekStart, { locale: ptBR, weekStartsOn: 1 }), 'dd/MM/yyyy')}
        </div>
      </div>
      <button onClick={() => handleWeekChange('next')} className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"><ChevronRight className="w-5 h-5" /></button>
    </div>
  );

  const renderContent = () => {
    if (loading) return <div className="text-center py-8"><Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-500" /></div>;
    if (error) return <div className="text-center py-8 text-red-500"><AlertCircle className="mx-auto h-10 w-10 mb-2" /><p>{error}</p></div>;
    if (!reportData || reportData.reportRows.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <Star className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <p>Nenhum item principal encontrado para esta semana.</p>
          <p className="text-sm mt-1">Vá para a página de Inventário e clique na estrela de um produto para adicioná-lo aqui.</p>
        </div>
      );
    }

    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {/* Navegação por Abas */}
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

        {/* Renderização condicional da tabela */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            {activeView === 'main' ? (
              // Tabela do Estoque Principal
              <>
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">Item</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Est. Ant.</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Compras</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Entregas</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Est. Final (Calc)</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Est. Atual</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Perda/Sobra</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {Object.entries(groupedReportRows).map(([category, rows]) => (
                    <React.Fragment key={category}>
                      <tr className="bg-gray-100 dark:bg-gray-700">
                        <td colSpan={7} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 sticky left-0 bg-gray-100 dark:bg-gray-700 z-10">{category}</td>
                      </tr>
                      {rows.map(row => (
                        <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10">
                            <div className="flex items-center gap-3">
                              {row.imageUrl ? (<img src={row.imageUrl} alt={row.productName} className="w-10 h-10 rounded-md object-cover flex-shrink-0" />) : (<div className="w-10 h-10 rounded-md bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0"><ImageIcon className="w-5 h-5 text-gray-400" /></div>)}
                              <span>{row.productName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center text-sm">{row.mainStock.initialStock}</td>
                          <td className="px-3 py-3 text-center text-sm text-green-600 font-medium">{row.mainStock.purchases > 0 ? `+${row.mainStock.purchases}` : '-'}</td>
                          <td className="px-3 py-3 text-center text-sm text-orange-600 font-medium">{row.mainStock.deliveredToSectors > 0 ? `-${row.mainStock.deliveredToSectors}` : '-'}</td>
                          <td className="px-3 py-3 text-center text-sm font-semibold">{row.mainStock.calculatedFinalStock}</td>
                          <td className="px-3 py-3 text-center text-sm font-bold">{row.mainStock.currentActualStock}</td>
                          <td className={`px-3 py-3 text-center text-sm font-bold ${row.mainStock.loss !== 0 ? 'text-red-500' : ''}`}>{row.mainStock.loss}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                {/* Cabeçalho para a visão de setor */}
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">Item</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Recebidos</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {Object.entries(groupedReportRows).map(([category, rows]) => (
                    <React.Fragment key={category}>
                      <tr className="bg-gray-100 dark:bg-gray-700">
                        <td colSpan={2} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 sticky left-0 bg-gray-100 dark:bg-gray-700 z-10">{category}</td>
                      </tr>
                      {rows.map(row => {
                        const sectorStock = row.sectorStocks[activeView];
                        if (!sectorStock) return null;
                        return (
                          <tr key={row.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-10">
                              <div className="flex items-center gap-3">
                                {row.imageUrl ? (<img src={row.imageUrl} alt={row.productName} className="w-10 h-10 rounded-md object-cover flex-shrink-0" />) : (<div className="w-10 h-10 rounded-md bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0"><ImageIcon className="w-5 h-5 text-gray-400" /></div>)}
                                <span>{row.productName}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center text-sm text-green-600 font-medium">{sectorStock.receivedFromMain > 0 ? `+${sectorStock.receivedFromMain}` : '-'}</td>
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
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reconciliação Semanal de Itens Principais" size="7xl">
      <div className="space-y-4 max-h-[80vh] flex flex-col">
        {renderWeekSelector()}
        <div className="flex-grow overflow-y-auto pr-2">
          {renderContent()}
        </div>
      </div>
    </Modal>
  );
};

export default StarredItemsReportModal;
