import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { supabase } from '../../lib/supabase';
import { Calendar, Users, Save, Loader2, Shirt, Settings, AlertCircle, Edit2, PlusCircle, BedDouble, Trash2 } from 'lucide-react';
import { format, parseISO, eachDayOfInterval } from 'date-fns';
import {
    getExistingReports,
    createLaundryReport,
    getReportDetails,
    saveLaundryReportData,
    saveItemPrice,
    deleteLaundryReport,
    LaundryReport as LaundryReportType,
    FullReportData,
} from '../../lib/laundryReportService';
import CreateLaundryReportModal from './CreateLaundryReportModal';
import FortnightDefinitionModal from './FortnightDefinitionModal';

type GuestState = { [date: string]: number };
type UhState = { [date: string]: number };
type EntryState = { [itemId: string]: { [date: string]: number } };

const LaundryReport = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [existingReports, setExistingReports] = useState<LaundryReportType[]>([]);
  const [activeReport, setActiveReport] = useState<LaundryReportType | null>(null);
  const [reportDetails, setReportDetails] = useState<FullReportData | null>(null);

  const [guestState, setGuestState] = useState<GuestState>({});
  const [uhState, setUhState] = useState<UhState>({});
  const [entryState, setEntryState] = useState<EntryState>({});
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [currentPriceValue, setCurrentPriceValue] = useState<string>('');

  const [focusedCell, setFocusedCell] = useState<{rowId: string, dateStr: string} | null>(null);

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDefinitionModal, setShowDefinitionModal] = useState(false);

  const carouselRef = useRef<HTMLDivElement>(null);

  const handleReportCreated = useCallback((newReport: LaundryReportType) => {
    setExistingReports(prev => [newReport, ...prev].sort((a,b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()));
    setActiveReport(newReport);
    setShowCreateModal(false); // Fecha o modal após a criação
  }, []);

  const fetchExistingReports = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    const { data, error } = await getExistingReports(selectedHotel.id);
    if (error) { addNotification(`Erro ao buscar relatórios: ${error.message}`, 'error'); }
    else {
      const reports = data || [];
      setExistingReports(reports);
      if (reports.length > 0) {
        setActiveReport(prev => reports.find(r => r.id === prev?.id) || reports[0]);
      } else {
        setActiveReport(null);
      }
    }
    setLoading(false);
  }, [selectedHotel, addNotification]);

  useEffect(() => {
    fetchExistingReports();
  }, [selectedHotel]);

  const fetchDetails = useCallback(async () => {
    if (!activeReport || !selectedHotel) { setReportDetails(null); setLoading(false); return; };
    setLoading(true);

    const { data, error } = await getReportDetails(activeReport.id, selectedHotel.id, activeReport.start_date);

    if (error) { addNotification(`Erro ao carregar detalhes: ${error.message}`, 'error'); }
    else if (data) {
      setReportDetails(data);
      const initialGuests: GuestState = {};
      data.guestCounts.forEach(gc => { initialGuests[format(parseISO(gc.date), 'yyyy-MM-dd')] = gc.guest_count; });
      setGuestState(initialGuests);
      const initialUhs: UhState = {};
      data.uhCounts.forEach(uc => { initialUhs[format(parseISO(uc.date), 'yyyy-MM-dd')] = uc.uh_count; });
      setUhState(initialUhs);
      const initialEntries: EntryState = {};
      data.laundryEntries.forEach(le => {
        if (!initialEntries[le.item_id]) initialEntries[le.item_id] = {};
        initialEntries[le.item_id][format(parseISO(le.entry_date), 'yyyy-MM-dd')] = le.quantity;
      });
      setEntryState(initialEntries);
    }
    setLoading(false);
  }, [activeReport, selectedHotel, addNotification]);

  useEffect(() => { if(activeReport){ fetchDetails(); } else { setLoading(false); } }, [activeReport]);

  useEffect(() => {
    if (activeReport && carouselRef.current) {
        const activeElement = document.getElementById(`report-${activeReport.id}`);
        if(activeElement) {
            carouselRef.current.scrollTo({ left: activeElement.offsetLeft - carouselRef.current.offsetWidth / 2 + activeElement.offsetWidth / 2, behavior: 'smooth' });
        }
    }
  }, [activeReport]);

  const daysInPeriod = useMemo(() => {
    if (!activeReport) return [];
    try { return eachDayOfInterval({ start: parseISO(activeReport.start_date), end: parseISO(activeReport.end_date) }); }
    catch { return []; }
  }, [activeReport]);

  const calculations = useMemo(() => {
    if (!reportDetails?.items || daysInPeriod.length === 0) return { itemsWithTotals: [], totalValue: 0, totalGuests: 0, totalUhs: 0, costPerGuest: 0, costPerUh: 0 };
    const itemsWithTotals = reportDetails.items.map(item => {
      const quantity = daysInPeriod.reduce((sum, day) => sum + (entryState[item.id]?.[format(day, 'yyyy-MM-dd')] || 0), 0);
      const totalValue = quantity * item.price;
      return { ...item, quantity, totalValue };
    });
    const totalValue = itemsWithTotals.reduce((sum, item) => sum + item.totalValue, 0);
    const totalGuests = daysInPeriod.reduce((sum, day) => sum + (guestState[format(day, 'yyyy-MM-dd')] || 0), 0);
    const totalUhs = daysInPeriod.reduce((sum, day) => sum + (uhState[format(day, 'yyyy-MM-dd')] || 0), 0);
    const costPerGuest = totalGuests > 0 ? totalValue / totalGuests : 0;
    const costPerUh = totalUhs > 0 ? totalValue / totalUhs : 0;
    return { itemsWithTotals, totalValue, totalGuests, totalUhs, costPerGuest, costPerUh };
  }, [reportDetails, guestState, uhState, entryState, daysInPeriod]);

  const navigableRows = useMemo(() => [
    { id: 'guests' },
    { id: 'uhs' },
    ...(calculations.itemsWithTotals || [])
  ], [calculations.itemsWithTotals]);

  const dateStringsInPeriod = useMemo(() => daysInPeriod.map(day => format(day, 'yyyy-MM-dd')), [daysInPeriod]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, currentRowId: string, currentDateStr: string) => {
    const key = e.key;
    if (!['Enter', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    
    e.preventDefault();

    const currentRowIndex = navigableRows.findIndex(row => row.id === currentRowId);
    const currentColIndex = dateStringsInPeriod.findIndex(date => date === currentDateStr);

    let nextRowIndex = currentRowIndex;
    let nextColIndex = currentColIndex;

    if (key === 'Enter' || key === 'ArrowDown') {
      nextRowIndex = Math.min(currentRowIndex + 1, navigableRows.length - 1);
    } else if (key === 'ArrowUp') {
      nextRowIndex = Math.max(currentRowIndex - 1, 0);
    } else if (key === 'ArrowRight') {
      nextColIndex = Math.min(currentColIndex + 1, dateStringsInPeriod.length - 1);
    } else if (key === 'ArrowLeft') {
      nextColIndex = Math.max(currentColIndex - 1, 0);
    }

    const nextRowId = navigableRows[nextRowIndex]?.id;
    const nextDateStr = dateStringsInPeriod[nextColIndex];

    if (nextRowId && nextDateStr) {
      const nextInput = document.getElementById(`input-${nextRowId}-${nextDateStr}`);
      if (nextInput) {
        nextInput.focus();
        (nextInput as HTMLInputElement).select();
      }
    }
  };

  const handlePriceClick = (itemId: string, currentPrice: number) => { setEditingPriceId(itemId); setCurrentPriceValue(String(currentPrice)); };
  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => { setCurrentPriceValue(e.target.value); };
  const handlePriceSave = async (itemId: string) => { if(!activeReport) return; const newPrice = parseFloat(currentPriceValue); if (isNaN(newPrice) || newPrice < 0) { addNotification("Valor inválido.", 'error'); setEditingPriceId(null); return; } const { error } = await saveItemPrice(itemId, newPrice, activeReport.start_date); if (error) { addNotification(`Erro: ${error.message}`, 'error'); } else { addNotification("Preço atualizado!", 'success'); fetchDetails(); } setEditingPriceId(null); };
  const handleGuestChange = (date: string, value: string) => { const numValue = value === '' ? 0 : parseInt(value, 10); setGuestState(prev => ({ ...prev, [date]: isNaN(numValue) ? 0 : numValue })); };
  const handleUhChange = (date: string, value: string) => { const numValue = value === '' ? 0 : parseInt(value, 10); setUhState(prev => ({ ...prev, [date]: isNaN(numValue) ? 0 : numValue })); };
  const handleEntryChange = (itemId: string, date: string, value: string) => { const numValue = value === '' ? 0 : parseInt(value, 10); setEntryState(prev => ({ ...prev, [itemId]: { ...prev[itemId], [date]: isNaN(numValue) ? 0 : numValue } })); };
  const handleSave = async () => { if(!selectedHotel || !activeReport) return; setIsSaving(true); const guestCountsToSave = Object.entries(guestState).map(([date, guest_count]) => ({date, guest_count})); const uhCountsToSave = Object.entries(uhState).map(([date, uh_count]) => ({date, uh_count})); const laundryEntriesToSave: {item_id: string, entry_date: string, quantity: number}[] = []; Object.entries(entryState).forEach(([itemId, dateEntries]) => { Object.entries(dateEntries).forEach(([date, quantity]) => { laundryEntriesToSave.push({item_id: itemId, entry_date: date, quantity}); }); }); const { error: saveError } = await saveLaundryReportData(activeReport.id, guestCountsToSave, uhCountsToSave, laundryEntriesToSave); if (saveError) { addNotification(`Erro ao salvar: ${saveError.message}`, 'error'); } else { addNotification('Relatório salvo com sucesso!', 'success'); } setIsSaving(false); };
  const handleDeleteReport = async () => { if(!activeReport) return; if(!window.confirm(`Tem certeza que deseja apagar o relatório "${activeReport.report_name}"?`)) return; setIsDeleting(true); const { error } = await deleteLaundryReport(activeReport.id); if(error){ addNotification(`Erro ao apagar: ${error.message}`, 'error'); } else { addNotification("Relatório apagado com sucesso!", 'success'); setActiveReport(null); fetchExistingReports(); } setIsDeleting(false); }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <h3 className="text-xl font-bold text-gray-800 dark:text-white">Relatório de Lavanderia</h3>
        <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700"> <PlusCircle className="w-5 h-5"/> Criar Novo Relatório </button>
      </div>

      <div ref={carouselRef} className="flex items-center gap-2 overflow-x-auto pb-3 -mx-4 px-4 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent">
        {existingReports.map(r => ( <button key={r.id} id={`report-${r.id}`} onClick={() => setActiveReport(r)} className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-colors duration-200 border-2 ${activeReport?.id === r.id ? 'bg-blue-600 text-white border-blue-700' : 'bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'}`}> {r.report_name} </button> ))}
      </div>

      {loading ? ( <div className="text-center p-8"><Loader2 className="w-8 h-8 mx-auto text-gray-400 animate-spin" /></div> ) 
      : !activeReport ? ( <div className="text-center p-8 bg-gray-50 dark:bg-gray-800 rounded-lg"><h4 className="text-lg font-semibold text-gray-700 dark:text-white">Nenhum Relatório</h4><p className="text-gray-500 dark:text-gray-400 mt-1">Crie seu primeiro relatório para começar.</p></div> ) 
      : (
        <>
            <div className="overflow-x-auto rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm border-separate border-spacing-0">
                    <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase sticky top-0 z-30 bg-gray-100/80 dark:bg-gray-900/80 backdrop-blur-sm">
                    <tr>
                        <th className="px-3 py-3 text-left sticky left-0 z-40 bg-inherit">Item</th>
                        <th className="px-3 py-3 text-center bg-inherit">Valor</th>
                        {daysInPeriod.map(day => { const dateStr = format(day, 'yyyy-MM-dd'); return ( <th key={dateStr} className={`px-2 py-3 text-center w-16 transition-colors ${focusedCell?.dateStr === dateStr ? 'bg-blue-200 dark:bg-blue-800' : 'bg-inherit'}`}> {format(day, 'dd/MM')} </th> )})}
                        <th className="px-3 py-3 text-center bg-inherit">QTD</th>
                        <th className="px-3 py-3 text-right bg-inherit">Valor Total</th>
                    </tr>
                    </thead>
                    <tbody>
                    {[
                      { id: 'guests', label: 'Hóspedes', icon: Users, state: guestState, handler: handleGuestChange, total: calculations.totalGuests, color: 'blue' },
                      { id: 'uhs', label: 'UHs Ocupadas', icon: BedDouble, state: uhState, handler: handleUhChange, total: calculations.totalUhs, color: 'purple' }
                    ].map(row => {
                      const Icon = row.icon;
                      const isRowFocused = focusedCell?.rowId === row.id;
                      return (
                        <tr key={row.id}>
                          <td className={`px-3 py-2 font-bold text-${row.color}-800 dark:text-${row.color}-300 sticky left-0 z-10 flex items-center gap-2 transition-colors ${isRowFocused ? `bg-${row.color}-200 dark:bg-${row.color}-800/50` : `bg-${row.color}-50 dark:bg-${row.color}-900/20`}`}><Icon className="w-4 h-4" /> {row.label}</td>
                          <td className={`px-3 py-2 text-center transition-colors ${isRowFocused ? `bg-${row.color}-100 dark:bg-${row.color}-900/30` : `bg-${row.color}-50 dark:bg-${row.color}-900/20`}`}>-</td>
                          {daysInPeriod.map(day => { const dateStr = format(day, 'yyyy-MM-dd'); const isCellFocused = focusedCell?.rowId === row.id && focusedCell?.dateStr === dateStr; return ( <td key={dateStr} className={`p-1 transition-colors ${focusedCell?.dateStr === dateStr || isRowFocused ? `bg-${row.color}-100 dark:bg-${row.color}-900/30` : `bg-${row.color}-50 dark:bg-${row.color}-900/20`}`}><input type="number" id={`input-${row.id}-${dateStr}`} onKeyDown={(e) => handleInputKeyDown(e, row.id, dateStr)} value={row.state[dateStr] || ''} onFocus={() => setFocusedCell({rowId: row.id, dateStr})} onBlur={() => setFocusedCell(null)} onChange={e => row.handler(dateStr, e.target.value)} onWheel={e => e.currentTarget.blur()} className={`w-14 p-1 text-center border rounded-md bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600 focus:ring-2 ${isCellFocused ? `ring-${row.color}-500` : `focus:ring-${row.color}-500 ring-transparent`}`} /></td> )})}
                          <td className={`px-3 py-2 text-center font-bold text-${row.color}-800 dark:text-${row.color}-300 transition-colors ${isRowFocused ? `bg-${row.color}-100 dark:bg-${row.color}-900/30` : `bg-${row.color}-50 dark:bg-${row.color}-900/20`}`}>{row.total}</td>
                          <td className="px-3 py-2 text-right sticky right-0 bg-inherit z-10">-</td>
                        </tr>
                      )
                    })}
                    {calculations.itemsWithTotals.map(item => {
                      const isRowFocused = focusedCell?.rowId === item.id;
                      return (
                        <tr key={item.id} className={`border-b dark:border-gray-700`}>
                          <td className={`px-3 py-2 font-medium text-gray-900 dark:text-white sticky left-0 transition-colors ${isRowFocused ? 'bg-blue-200 dark:bg-blue-800/50' : 'bg-white dark:bg-gray-800'}`}>{item.name}</td>
                          <td className={`px-3 py-2 text-center text-gray-500 dark:text-gray-400 transition-colors ${isRowFocused ? 'bg-blue-100 dark:bg-blue-900/40' : ''}`}>
                            {editingPriceId === item.id ? ( <input type="number" value={currentPriceValue} onChange={handlePriceChange} onBlur={() => handlePriceSave(item.id)} onKeyDown={(e) => { if (e.key === 'Enter') handlePriceSave(item.id); if (e.key === 'Escape') setEditingPriceId(null); }} className="w-20 p-1 text-center border rounded-md bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600 focus:ring-1 focus:ring-blue-500" autoFocus /> ) 
                            : ( <div onClick={() => handlePriceClick(item.id, item.price)} className="cursor-pointer flex items-center justify-center gap-1 hover:text-blue-500 group"> {item.price.toLocaleString('pt-BR', {style:'currency', currency: 'BRL'})} <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"/> </div> )}
                          </td>
                          {daysInPeriod.map(day => { const dateStr = format(day, 'yyyy-MM-dd'); const isCellFocused = focusedCell?.rowId === item.id && focusedCell?.dateStr === dateStr; return ( <td key={dateStr} className={`p-1 transition-colors ${focusedCell?.dateStr === dateStr || isRowFocused ? 'bg-blue-100 dark:bg-blue-900/30' : ''}`}><input type="number" value={entryState[item.id]?.[dateStr] || ''} id={`input-${item.id}-${dateStr}`} onKeyDown={(e) => handleInputKeyDown(e, item.id, dateStr)} onFocus={() => setFocusedCell({rowId: item.id, dateStr})} onBlur={() => setFocusedCell(null)} onChange={e => handleEntryChange(item.id, dateStr, e.target.value)} onWheel={e => e.currentTarget.blur()} className={`w-14 p-1 text-center border rounded-md bg-transparent dark:border-gray-600 focus:ring-2 ${isCellFocused ? 'ring-blue-500' : 'focus:ring-indigo-500 ring-transparent'}`} /></td> )})}
                          <td className={`px-3 py-2 text-center font-semibold text-gray-800 dark:text-gray-100 transition-colors ${isRowFocused ? 'bg-blue-100 dark:bg-blue-900/40' : ''}`}>{item.quantity}</td>
                          <td className={`px-3 py-2 text-right font-bold text-gray-900 dark:text-white transition-colors ${isRowFocused ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-white dark:bg-gray-800'}`}>{item.totalValue.toLocaleString('pt-BR', {style:'currency', currency: 'BRL'})}</td>
                        </tr>
                      )
                    })}
                    </tbody>
                    <tfoot className="text-sm font-bold text-gray-900 dark:text-white bg-gray-200 dark:bg-gray-900 sticky bottom-0 z-30">
                    <tr><td colSpan={2} className="px-3 py-3 text-right sticky left-0 bg-inherit">Custo por Hóspede:</td><td colSpan={daysInPeriod.length + 1} className="px-3 py-3 text-left text-green-600 text-base">{calculations.costPerGuest.toLocaleString('pt-BR', {style:'currency', currency: 'BRL'})}</td><td className="px-3 py-3 text-right">{calculations.totalValue.toLocaleString('pt-BR', {style:'currency', currency: 'BRL'})}</td></tr>
                    </tfoot>
                </table>
            </div>
            <div className="flex justify-between items-center mt-4">
                <button onClick={handleDeleteReport} disabled={isDeleting || isSaving} className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50"> {isDeleting ? <Loader2 className="animate-spin w-4 h-4"/> : <Trash2 className="w-4 h-4"/>} Apagar Relatório </button>
                <button onClick={handleSave} disabled={isSaving || loading} className="flex items-center justify-center px-6 py-3 text-white font-semibold rounded-lg shadow-md bg-green-600 hover:bg-green-700 disabled:opacity-50"> {isSaving ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : <Save className="w-5 h-5 mr-2" />} Salvar Alterações </button>
            </div>
        </>
      )}

      {/* ADIÇÃO DO MODAL DE CRIAÇÃO */}
      {showCreateModal && selectedHotel && (
        <CreateLaundryReportModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onReportCreated={handleReportCreated}
            hotelId={selectedHotel.id}
        />
      )}

      {selectedHotel && activeReport && (
        <FortnightDefinitionModal isOpen={showDefinitionModal} onClose={() => setShowDefinitionModal(false)} hotelId={selectedHotel.id} currentMonth={parseISO(activeReport.start_date)} onSave={fetchDetails} />
      )}
    </div>
  );
};

export default LaundryReport;
