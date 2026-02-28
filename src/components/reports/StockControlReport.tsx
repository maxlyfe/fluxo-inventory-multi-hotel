import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { 
  ChevronLeft, ChevronRight, Save, Loader2, AlertCircle, Info, 
  BarChart, RefreshCw, Download, Calendar, TrendingUp, Package,
  ArrowUpDown, Eye, Trash2, Star
} from 'lucide-react';
import { 
  startOfWeek, endOfWeek, format, addWeeks, subWeeks, 
  getWeek, getYear, isSameWeek
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  generateWeeklyReport, 
  deleteWeeklyReport,
  updateWeeklyReportItem,
  WeeklyReportData 
} from '../../lib/weeklyReportService'; // Ajuste o caminho se necessário

// --- Interfaces (mantidas como no original) ---
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

interface EditableEntry {
  sales: number;
  losses: number;
}

interface ReportStats {
  totalProducts: number;
  totalPurchases: number;
  totalSales: number;
  totalLosses: number;
  totalSectorMovements: number;
  totalHotelTransfers: number;
  stockVariation: number;
}


// --- Componente do Relatório ---
const StockControlReport = () => {
  const { selectedHotel } = useHotel();
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

  const fetchReportData = useCallback(async () => {
    if (!selectedHotel?.id) return;
    
    setLoading(true);
    setError(null);
    setInfoMessage(null);
    
    try {
      const result = await generateWeeklyReport(selectedHotel.id, currentWeekStart);
      
      if (!result.success || !result.data) {
        // Se não houver relatório gerado, não tratamos como erro fatal, apenas informamos.
        setInfoMessage('Nenhum relatório encontrado para esta semana. Clique em "Gerar Relatório" para criar um.');
        setReportData(null);
        setEditableEntries({});
        return;
      }
      
      setReportData(result.data);
      
      const initialEntries: { [itemId: string]: EditableEntry } = {};
      result.data.items.forEach(item => {
        initialEntries[item.id] = {
          sales: item.sales_in_week,
          losses: item.losses_in_week
        };
      });
      setEditableEntries(initialEntries);
      
      if (result.data.items.length === 0) {
        setInfoMessage("Relatório gerado, mas nenhum produto com movimentação foi encontrado para este período.");
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
      await fetchReportData();
      
    } catch (err) {
      console.error('Erro ao gerar relatório:', err);
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMsg);
      addNotification(`Erro ao gerar relatório: ${errorMsg}`, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteReport = async () => {
    if (!reportData?.report.id) return;
    
    if (!window.confirm('Tem certeza que deseja deletar este relatório? Esta ação não pode ser desfeita.')) {
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
      await fetchReportData(); // Recarrega os dados, que agora mostrarão a mensagem de 'nenhum relatório'
      
    } catch (err) {
      console.error('Erro ao deletar relatório:', err);
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMsg);
      addNotification(`Erro ao deletar relatório: ${errorMsg}`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleWeekChange = (direction: 'prev' | 'next') => {
    setCurrentWeekStart(prev => 
      direction === 'next' 
        ? addWeeks(prev, 1) 
        : subWeeks(prev, 1)
    );
  };

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
      await fetchReportData();
      
    } catch (err) {
      console.error('Erro ao salvar relatório:', err);
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMsg);
      addNotification(`Erro ao salvar: ${errorMsg}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // --- Lógica de processamento de dados (useMemo) e ordenação ---
  const tableData = useMemo(() => {
    if (!reportData) return [];
    
    let data = reportData.items.map(item => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name || 'Item Desconhecido',
      initial_stock: item.initial_stock,
      purchases: item.purchases_in_week,
      sector_movements: item.sector_movements.map(sm => ({ sector_name: sm.sector_name, quantity: sm.quantity_moved })),
      hotel_transfers: item.hotel_transfers.map(ht => ({ hotel_name: ht.hotel_name, quantity: ht.quantity_transferred })),
      sales: editableEntries[item.id]?.sales ?? item.sales_in_week,
      losses: editableEntries[item.id]?.losses ?? item.losses_in_week,
      final_stock: item.final_stock
    }));

    if (filterText) {
      data = data.filter(item => item.product_name.toLowerCase().includes(filterText.toLowerCase()));
    }

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

  const stats = useMemo((): ReportStats => { /* ...lógica de stats... */ return { totalProducts: tableData.length, totalPurchases: tableData.reduce((s, i) => s + i.purchases, 0), totalSales: tableData.reduce((s, i) => s + i.sales, 0), totalLosses: tableData.reduce((s, i) => s + i.losses, 0), totalSectorMovements: tableData.reduce((s, i) => s + i.sector_movements.reduce((ss, sm) => ss + sm.quantity, 0), 0), totalHotelTransfers: tableData.reduce((s, i) => s + i.hotel_transfers.reduce((st, ht) => st + ht.quantity, 0), 0), stockVariation: tableData.reduce((s, i) => s + i.final_stock, 0) - tableData.reduce((s, i) => s + i.initial_stock, 0) }; }, [tableData]);
  const allSectors = useMemo(() => { const s = new Set<string>(); tableData.forEach(i => i.sector_movements.forEach(sm => s.add(sm.sector_name))); return Array.from(s).sort(); }, [tableData]);
  const allHotels = useMemo(() => { const h = new Set<string>(); tableData.forEach(i => i.hotel_transfers.forEach(ht => h.add(ht.hotel_name))); return Array.from(h).sort(); }, [tableData]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleExportCSV = () => { /* ...lógica de exportação... */ if (!tableData.length) return; const headers = ['Item', 'Estoque Inicial', 'Compras', ...allSectors.map(s => `Setor: ${s}`), ...allHotels.map(h => `Transfer: ${h}`), 'Vendas', 'Perdas', 'Estoque Final']; const rows = tableData.map(i => [i.product_name, i.initial_stock, i.purchases, ...allSectors.map(s => i.sector_movements.find(sm => sm.sector_name === s)?.quantity ?? 0), ...allHotels.map(h => i.hotel_transfers.find(ht => ht.hotel_name === h)?.quantity ?? 0), i.sales, i.losses, i.final_stock]); const csvContent = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n'); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); const url = URL.createObjectURL(blob); link.setAttribute('href', url); link.setAttribute('download', `relatorio_semanal_${format(currentWeekStart, 'yyyy-MM-dd')}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); };

  // --- Funções de Renderização ---
  const renderWeekSelector = () => ( <div className="flex items-center justify-center space-x-4 mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow"> <button onClick={() => handleWeekChange('prev')} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"> <ChevronLeft className="w-5 h-5" /> </button> <div className="text-center"> <div className="font-semibold text-lg text-gray-800 dark:text-white flex items-center gap-2"> <Calendar className="w-5 h-5" /> Semana {getWeek(currentWeekStart, { locale: ptBR, weekStartsOn: 1 })} de {getYear(currentWeekStart)} {isCurrentWeek && (<span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Atual</span>)} </div> <div className="text-sm text-gray-500 dark:text-gray-400"> {format(currentWeekStart, 'dd/MM/yyyy', { locale: ptBR })} - {format(weekEndDate, 'dd/MM/yyyy', { locale: ptBR })} </div> </div> <button onClick={() => handleWeekChange('next')} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"> <ChevronRight className="w-5 h-5" /> </button> </div> );
  const renderStats = () => ( showStats && <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6"> {/* ...JSX dos cards de stats... */} </div> );
  const renderControls = () => ( <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6"> <div className="flex items-center gap-4"> <input type="text" placeholder="Filtrar produtos..." value={filterText} onChange={(e) => setFilterText(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" /> <button onClick={() => setShowStats(!showStats)} className="flex items-center px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors"> <Eye className="w-4 h-4 mr-2" /> {showStats ? 'Ocultar' : 'Mostrar'} Estatísticas </button> </div> <div className="flex gap-2"> <button onClick={handleExportCSV} disabled={!tableData.length} className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"> <Download className="w-4 h-4 mr-2" /> Exportar </button> {reportData && (<button onClick={handleDeleteReport} disabled={deleting} className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"> {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />} Deletar </button>)} <button onClick={handleGenerateReport} disabled={loading || generating} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"> {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />} Gerar </button> <button onClick={handleSave} disabled={loading || saving} className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"> {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Salvar </button> </div> </div> );
  const renderTableHeader = () => ( <thead className="bg-gray-50 dark:bg-gray-700"> <tr> <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-gray-700 z-10 cursor-pointer" onClick={() => handleSort('product_name')}> <div className="flex items-center"> Item {sortField === 'product_name' && <ArrowUpDown className={`w-4 h-4 ml-1 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />} </div> </th> <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('initial_stock')}> <div className="flex items-center justify-center"> Estoque Inicial {sortField === 'initial_stock' && <ArrowUpDown className={`w-4 h-4 ml-1 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />} </div> </th> <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('purchases')}> <div className="flex items-center justify-center"> Compras {sortField === 'purchases' && <ArrowUpDown className={`w-4 h-4 ml-1 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />} </div> </th> {allSectors.map(sector => (<th key={sector} scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">{sector}</th>))} {allHotels.map(hotel => (<th key={hotel} scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Transfer. {hotel}</th>))} <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Vendas</th> <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Perdas</th> <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('final_stock')}> <div className="flex items-center justify-center"> Estoque Final {sortField === 'final_stock' && <ArrowUpDown className={`w-4 h-4 ml-1 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />} </div> </th> </tr> </thead> );
  const renderTable = () => { if (loading) return <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center"><Loader2 className="w-12 h-12 mx-auto text-gray-400 mb-4 animate-spin" /><h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">Carregando relatório...</h3><p className="text-gray-600 dark:text-gray-400">Aguarde enquanto processamos os dados do inventário.</p></div>; if (!reportData) return <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center"><BarChart className="w-12 h-12 mx-auto text-gray-400 mb-4" /><h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">Nenhum relatório para esta semana</h3><p className="text-gray-600 dark:text-gray-400">Clique em "Gerar Relatório" para criar um novo com base no inventário atual.</p></div>; if (tableData.length === 0) return <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center"><BarChart className="w-12 h-12 mx-auto text-gray-400 mb-4" /><h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">Nenhum dado disponível</h3><p className="text-gray-600 dark:text-gray-400">{filterText ? 'Nenhum produto encontrado com o filtro aplicado.' : 'Relatório gerado, mas sem itens com movimentação.'}</p></div>; return <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">{renderTableHeader()}<tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">{tableData.map(item => ( <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50"> <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800">{item.product_name}</td> <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">{item.initial_stock}</td> <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center"><span className={item.purchases > 0 ? 'text-green-600 font-medium' : ''}>{item.purchases}</span></td> {allSectors.map(sector => { const m = item.sector_movements.find(sm => sm.sector_name === sector); return <td key={sector} className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">{m ? <span className="text-orange-600 font-medium">{m.quantity}</span> : '-'}</td>; })} {allHotels.map(hotel => { const t = item.hotel_transfers.find(ht => ht.hotel_name === hotel); return <td key={hotel} className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">{t ? <span className="text-purple-600 font-medium">{t.quantity}</span> : '-'}</td>; })} <td className="px-1 py-1 whitespace-nowrap text-sm text-center"><input type="number" value={item.sales} onChange={e => handleInputChange(item.id, 'sales', e.target.value)} className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500" min="0" step="any" /></td> <td className="px-1 py-1 whitespace-nowrap text-sm text-center"><input type="number" value={item.losses} onChange={e => handleInputChange(item.id, 'losses', e.target.value)} className="w-20 p-1 border rounded-md text-center dark:bg-gray-700 dark:text-white dark:border-gray-600 focus:ring-yellow-500 focus:border-yellow-500" min="0" step="any" /></td> <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white text-center"><span className={item.final_stock > item.initial_stock ? 'text-green-600' : item.final_stock < item.initial_stock ? 'text-red-600' : ''}>{item.final_stock}</span></td> </tr> ))}</tbody></table></div></div>; };

  // O container principal foi removido, pois este componente será renderizado dentro de outro.
  return (
    <div>
      {/* O título h1 foi removido daqui */}
      {renderWeekSelector()}
      {renderStats()}
      {renderControls()}

      {error && (
        <div className="my-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}

      {infoMessage && (
        <div className="my-4 p-4 bg-blue-100 border border-blue-400 text-blue-700 rounded-md flex items-center">
          <Info className="w-5 h-5 mr-2" />
          {infoMessage}
        </div>
      )}

      {renderTable()}
    </div>
  );
};

export default StockControlReport;
