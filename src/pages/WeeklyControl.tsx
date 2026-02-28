import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { 
  ChevronLeft, ChevronRight, Save, Loader2, AlertCircle, Info, 
  BarChart, RefreshCw, Download, Calendar, TrendingUp, Package,
  ArrowUpDown, Eye, Trash2
} from 'lucide-react';
import { 
  startOfWeek, endOfWeek, format, addWeeks, subWeeks, 
  getWeek, getYear, isToday, isSameWeek
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  generateWeeklyReport, 
  getWeeklyReportData, 
  updateWeeklyReportItem,
  deleteWeeklyReport,
  WeeklyReportData 
} from '../lib/weeklyReportService';

// Interface para dados da tabela
interface TableRowData {
  id: string;
  product_id: string | null;
  product_name: string;
  initial_stock: number;
  purchases: number;
  sector_movements: { sector_name: string; quantity: number }[];
  hotel_transfers: { hotel_name: string; quantity: number }[];
  sales: number;
  losses: number;
  final_stock: number;
}

// Interface para entradas editáveis
interface EditableEntry {
  sales: number;
  losses: number;
}

// Interface para estatísticas do relatório
interface ReportStats {
  totalProducts: number;
  totalPurchases: number;
  totalSales: number;
  totalLosses: number;
  totalSectorMovements: number;
  totalHotelTransfers: number;
  stockVariation: number;
}

const WeeklyControl = () => {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();
  
  const [currentWeekStart, setCurrentWeekStart] = useState(
    startOfWeek(new Date(), { locale: ptBR, weekStartsOn: 1 })
  );
  const [reportData, setReportData] = useState<WeeklyReportData | null>(null);
  const [editableEntries, setEditableEntries] = useState<{ [itemId: string]: EditableEntry }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(true);
  const [sortField, setSortField] = useState<string>('product_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterText, setFilterText] = useState('');

  const weekEndDate = endOfWeek(currentWeekStart, { locale: ptBR, weekStartsOn: 1 });
  const isCurrentWeek = isSameWeek(currentWeekStart, new Date(), { locale: ptBR, weekStartsOn: 1 });

  // Buscar dados do relatório
  const fetchReportData = useCallback(async () => {
    if (!selectedHotel?.id) return;
    
    setLoading(true);
    setError(null);
    setInfoMessage(null);
    
    try {
      // Primeiro, tentar gerar/obter o relatório
      const result = await generateWeeklyReport(selectedHotel.id, currentWeekStart);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Erro ao gerar relatório');
      }
      
      setReportData(result.data);
      
      // Inicializar entradas editáveis
      const initialEntries: { [itemId: string]: EditableEntry } = {};
      result.data.items.forEach(item => {
        initialEntries[item.id] = {
          sales: item.sales_in_week,
          losses: item.losses_in_week
        };
      });
      setEditableEntries(initialEntries);
      
      if (result.data.items.length === 0) {
        setInfoMessage("Nenhum produto cadastrado para este hotel.");
      }
      
    } catch (err) {
      console.error('Erro ao buscar dados do relatório:', err);
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setReportData(null);
      setEditableEntries({});
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, currentWeekStart]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  // Gerar novo relatório
  const handleGenerateReport = async () => {
    if (!selectedHotel?.id) return;
    
    setGenerating(true);
    setError(null);
    
    try {
      const result = await generateWeeklyReport(selectedHotel.id, currentWeekStart);
      
      if (!result.success) {
        throw new Error(result.error || 'Erro ao gerar relatório');
      }
      
      addNotification('Relatório gerado com sucesso!', 'success');
      await fetchReportData(); // Recarregar dados
      
    } catch (err) {
      console.error('Erro ao gerar relatório:', err);
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMsg);
      addNotification(`Erro ao gerar relatório: ${errorMsg}`, 'error');
    } finally {
      setGenerating(false);
    }
  };

  // Deletar relatório
  const handleDeleteReport = async () => {
    if (!reportData?.report.id) return;
    
    if (!confirm('Tem certeza que deseja deletar este relatório? Esta ação não pode ser desfeita.')) {
      return;
    }
    
    setDeleting(true);
    setError(null);
    
    try {
      const result = await deleteWeeklyReport(reportData.report.id);
      
      if (!result.success) {
        throw new Error(result.error || 'Erro ao deletar relatório');
      }
      
      addNotification('Relatório deletado com sucesso!', 'success');
      setReportData(null);
      setEditableEntries({});
      
    } catch (err) {
      console.error('Erro ao deletar relatório:', err);
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMsg);
      addNotification(`Erro ao deletar relatório: ${errorMsg}`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Navegar entre semanas
  const handleWeekChange = (direction: 'prev' | 'next') => {
    setCurrentWeekStart(prev => 
      direction === 'next' 
        ? addWeeks(prev, 1) 
        : subWeeks(prev, 1)
    );
  };

  // Atualizar entrada editável
  const handleInputChange = (itemId: string, field: 'sales' | 'losses', value: string) => {
    const numericValue = value === '' ? 0 : parseFloat(value.replace(',', '.'));
    if (!isNaN(numericValue) && numericValue >= 0) {
      setEditableEntries(prev => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          [field]: numericValue
        }
      }));
    }
  };

  // Salvar alterações
  const handleSave = async () => {
    if (!reportData || Object.keys(editableEntries).length === 0) return;
    
    setSaving(true);
    setError(null);
    
    try {
      const updatePromises = Object.entries(editableEntries).map(([itemId, entry]) => {
        const originalItem = reportData.items.find(item => item.id === itemId);
        if (originalItem && 
            (originalItem.sales_in_week !== entry.sales || originalItem.losses_in_week !== entry.losses)) {
          return updateWeeklyReportItem(itemId, entry.sales, entry.losses);
        }
        return Promise.resolve({ success: true });
      });
      
      const results = await Promise.all(updatePromises);
      const failedUpdates = results.filter(result => !result.success);
      
      if (failedUpdates.length > 0) {
        throw new Error(`Falha ao atualizar ${failedUpdates.length} itens`);
      }
      
      addNotification('Relatório salvo com sucesso!', 'success');
      await fetchReportData(); // Recarregar dados
      
    } catch (err) {
      console.error('Erro ao salvar relatório:', err);
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMsg);
      addNotification(`Erro ao salvar: ${errorMsg}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Processar dados para a tabela
  const tableData = useMemo(() => {
    if (!reportData) return [];
    
    let data = reportData.items.map(item => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name || 'Item Desconhecido',
      initial_stock: item.initial_stock,
      purchases: item.purchases_in_week,
      sector_movements: item.sector_movements.map(sm => ({
        sector_name: sm.sector_name,
        quantity: sm.quantity_moved
      })),
      hotel_transfers: item.hotel_transfers.map(ht => ({
        hotel_name: ht.hotel_name,
        quantity: ht.quantity_transferred
      })),
      sales: editableEntries[item.id]?.sales ?? item.sales_in_week,
      losses: editableEntries[item.id]?.losses ?? item.losses_in_week,
      final_stock: item.final_stock
    }));

    // Filtrar por texto
    if (filterText) {
      data = data.filter(item => 
        item.product_name.toLowerCase().includes(filterText.toLowerCase())
      );
    }

    // Ordenar
    data.sort((a, b) => {
      let aValue = a[sortField as keyof typeof a];
      let bValue = b[sortField as keyof typeof b];
      
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = (bValue as string).toLowerCase();
      }
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return data;
  }, [reportData, editableEntries, filterText, sortField, sortDirection]);

  // Calcular estatísticas
  const stats = useMemo((): ReportStats => {
    if (!tableData.length) {
      return {
        totalProducts: 0,
        totalPurchases: 0,
        totalSales: 0,
        totalLosses: 0,
        totalSectorMovements: 0,
        totalHotelTransfers: 0,
        stockVariation: 0
      };
    }

    const totalPurchases = tableData.reduce((sum, item) => sum + item.purchases, 0);
    const totalSales = tableData.reduce((sum, item) => sum + item.sales, 0);
    const totalLosses = tableData.reduce((sum, item) => sum + item.losses, 0);
    const totalSectorMovements = tableData.reduce((sum, item) => 
      sum + item.sector_movements.reduce((sectorSum, sm) => sectorSum + sm.quantity, 0), 0
    );
    const totalHotelTransfers = tableData.reduce((sum, item) => 
      sum + item.hotel_transfers.reduce((transferSum, ht) => transferSum + ht.quantity, 0), 0
    );
    const initialStock = tableData.reduce((sum, item) => sum + item.initial_stock, 0);
    const finalStock = tableData.reduce((sum, item) => sum + item.final_stock, 0);

    return {
      totalProducts: tableData.length,
      totalPurchases,
      totalSales,
      totalLosses,
      totalSectorMovements,
      totalHotelTransfers,
      stockVariation: finalStock - initialStock
    };
  }, [tableData]);

  // Obter todos os setores únicos
  const allSectors = useMemo(() => {
    const sectors = new Set<string>();
    tableData.forEach(item => {
      item.sector_movements.forEach(sm => sectors.add(sm.sector_name));
    });
    return Array.from(sectors).sort();
  }, [tableData]);

  // Obter todos os hotéis únicos
  const allHotels = useMemo(() => {
    const hotels = new Set<string>();
    tableData.forEach(item => {
      item.hotel_transfers.forEach(ht => hotels.add(ht.hotel_name));
    });
    return Array.from(hotels).sort();
  }, [tableData]);

  // Função para ordenar colunas
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Exportar dados para CSV
  const handleExportCSV = () => {
    if (!tableData.length) return;

    const headers = [
      'Item',
      'Estoque Inicial',
      'Compras',
      ...allSectors.map(sector => `Setor: ${sector}`),
      ...allHotels.map(hotel => `Transfer: ${hotel}`),
      'Vendas',
      'Perdas',
      'Estoque Final'
    ];

    const rows = tableData.map(item => [
      item.product_name,
      item.initial_stock,
      item.purchases,
      ...allSectors.map(sector => {
        const movement = item.sector_movements.find(sm => sm.sector_name === sector);
        return movement ? movement.quantity : 0;
      }),
      ...allHotels.map(hotel => {
        const transfer = item.hotel_transfers.find(ht => ht.hotel_name === hotel);
        return transfer ? transfer.quantity : 0;
      }),
      item.sales,
      item.losses,
      item.final_stock
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `relatorio_semanal_${format(currentWeekStart, 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Renderizar seletor de semana
  const renderWeekSelector = () => (
    <div className="flex items-center justify-center space-x-4 mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
      <button 
        onClick={() => handleWeekChange('prev')}
        className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
        aria-label="Semana anterior"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <div className="text-center">
        <div className="font-semibold text-lg text-gray-800 dark:text-white flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Semana {getWeek(currentWeekStart, { locale: ptBR, weekStartsOn: 1 })} de {getYear(currentWeekStart)}
          {isCurrentWeek && (
            <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
              Atual
            </span>
          )}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {format(currentWeekStart, 'dd/MM/yyyy', { locale: ptBR })} - {format(weekEndDate, 'dd/MM/yyyy', { locale: ptBR })}
        </div>
      </div>
      <button 
        onClick={() => handleWeekChange('next')}
        className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
        aria-label="Próxima semana"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );

  // Renderizar estatísticas
  const renderStats = () => {
    if (!showStats) return null;

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex items-center">
            <Package className="w-8 h-8 text-blue-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Produtos</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{stats.totalProducts}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex items-center">
            <TrendingUp className="w-8 h-8 text-green-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Compras</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{stats.totalPurchases}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex items-center">
            <ArrowUpDown className="w-8 h-8 text-orange-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Setores</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{stats.totalSectorMovements}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex items-center">
            <ArrowUpDown className="w-8 h-8 text-purple-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Transferências</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{stats.totalHotelTransfers}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex items-center">
            <TrendingUp className="w-8 h-8 text-red-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Vendas</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{stats.totalSales}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex items-center">
            <AlertCircle className="w-8 h-8 text-yellow-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Perdas</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{stats.totalLosses}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex items-center">
            <BarChart className={`w-8 h-8 ${stats.stockVariation >= 0 ? 'text-green-500' : 'text-red-500'}`} />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Variação</p>
              <p className={`text-2xl font-semibold ${stats.stockVariation >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {stats.stockVariation >= 0 ? '+' : ''}{stats.stockVariation}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Renderizar controles
  const renderControls = () => (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
      <div className="flex items-center gap-4">
        <input
          type="text"
          placeholder="Filtrar produtos..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
        <button
          onClick={() => setShowStats(!showStats)}
          className="flex items-center px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors"
        >
          <Eye className="w-4 h-4 mr-2" />
          {showStats ? 'Ocultar' : 'Mostrar'} Estatísticas
        </button>
      </div>
      
      <div className="flex gap-2">
        <button
          onClick={handleExportCSV}
          disabled={!tableData.length}
          className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4 mr-2" />
          Exportar CSV
        </button>
        
        {reportData && (
          <button
            onClick={handleDeleteReport}
            disabled={deleting}
            className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Deletar
          </button>
        )}
        
        <button
          onClick={handleGenerateReport}
          disabled={loading || generating}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Gerar Relatório
        </button>
        
        <button
          onClick={handleSave}
          disabled={loading || saving}
          className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Salvar Alterações
        </button>
      </div>
    </div>
  );

  // Renderizar cabeçalho da tabela
  const renderTableHeader = () => (
    <thead className="bg-gray-50 dark:bg-gray-700">
      <tr>
        <th 
          scope="col" 
          className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-gray-700 z-10 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
          onClick={() => handleSort('product_name')}
        >
          <div className="flex items-center">
            Item
            {sortField === 'product_name' && (
              <ArrowUpDown className={`w-4 h-4 ml-1 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
            )}
          </div>
        </th>
        <th 
          scope="col" 
          className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
          onClick={() => handleSort('initial_stock')}
        >
          <div className="flex items-center justify-center">
            Estoque Inicial
            {sortField === 'initial_stock' && (
              <ArrowUpDown className={`w-4 h-4 ml-1 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
            )}
          </div>
        </th>
        <th 
          scope="col" 
          className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
          onClick={() => handleSort('purchases')}
        >
          <div className="flex items-center justify-center">
            Compras
            {sortField === 'purchases' && (
              <ArrowUpDown className={`w-4 h-4 ml-1 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
            )}
          </div>
        </th>
        {allSectors.map(sector => (
          <th key={sector} scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
            {sector}
          </th>
        ))}
        {allHotels.map(hotel => (
          <th key={hotel} scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
            Transfer. {hotel}
          </th>
        ))}
        <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
          Vendas
        </th>
        <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
          Perdas
        </th>
        <th 
          scope="col" 
          className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
          onClick={() => handleSort('final_stock')}
        >
          <div className="flex items-center justify-center">
            Estoque Final
            {sortField === 'final_stock' && (
              <ArrowUpDown className={`w-4 h-4 ml-1 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
            )}
          </div>
        </th>
      </tr>
    </thead>
  );

  // Renderizar tabela
  const renderTable = () => {
    if (loading) {
      return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
          <Loader2 className="w-12 h-12 mx-auto text-gray-400 mb-4 animate-spin" />
          <h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">
            Carregando relatório...
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Aguarde enquanto processamos os dados do inventário.
          </p>
        </div>
      );
    }

    if (tableData.length === 0) {
      return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
          <BarChart className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">
            Nenhum dado disponível
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            {filterText ? 'Nenhum produto encontrado com o filtro aplicado.' : 'Não há produtos cadastrados para este hotel ou período.'}
          </p>
        </div>
      );
    }

    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            {renderTableHeader()}
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {tableData.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800">
                    {item.product_name}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">
                    {item.initial_stock}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">
                    <span className={item.purchases > 0 ? 'text-green-600 font-medium' : ''}>
                      {item.purchases}
                    </span>
                  </td>
                  {allSectors.map(sector => {
                    const movement = item.sector_movements.find(sm => sm.sector_name === sector);
                    return (
                      <td key={sector} className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">
                        {movement ? (
                          <span className="text-orange-600 font-medium">{movement.quantity}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                    );
                  })}
                  {allHotels.map(hotel => {
                    const transfer = item.hotel_transfers.find(ht => ht.hotel_name === hotel);
                    return (
                      <td key={hotel} className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">
                        {transfer ? (
                          <span className="text-purple-600 font-medium">{transfer.quantity}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 whitespace-nowrap text-sm text-center">
                    <input 
                      type="number" 
                      value={item.sales} 
                      onChange={(e) => handleInputChange(item.id, 'sales', e.target.value)}
                      className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                      min="0"
                      step="any" 
                    />
                  </td>
                  <td className="px-1 py-1 whitespace-nowrap text-sm text-center">
                    <input 
                      type="number" 
                      value={item.losses} 
                      onChange={(e) => handleInputChange(item.id, 'losses', e.target.value)}
                      className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600 focus:ring-yellow-500 focus:border-yellow-500"
                      min="0"
                      step="any"
                    />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white text-center">
                    <span className={item.final_stock > item.initial_stock ? 'text-green-600' : item.final_stock < item.initial_stock ? 'text-red-600' : ''}>
                      {item.final_stock}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-full mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">
          Relatório Semanal de Inventário
        </h1>
        {selectedHotel && (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Hotel: <span className="font-medium">{selectedHotel.name}</span>
          </div>
        )}
      </div>

      {renderWeekSelector()}
      {renderStats()}
      {renderControls()}

      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}

      {infoMessage && (
        <div className="mb-4 p-4 bg-blue-100 border border-blue-400 text-blue-700 rounded-md flex items-center">
          <Info className="w-5 h-5 mr-2" />
          {infoMessage}
        </div>
      )}

      {renderTable()}
    </div>
  );
};

export default WeeklyControl;

