import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import {
  Calendar,
  Plus,
  Save,
  Loader2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ClipboardList,
  PlusCircle,
  X,
  Printer,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  getSurplusReportsByMonth,
  getSurplusReportWithItems,
  createSurplusReport,
  updateSurplusReport,
  deleteSurplusReport,
  saveSurplusReportItems,
  getAvailableMonths,
  getDistinctDestinations,
  SurplusReport as SurplusReportType,
  SurplusReportItem,
  SurplusReportWithItems,
} from '../../lib/surplusReportService';

const DEFAULT_DESTINATIONS = ['funcionário', 'café', 'descarte', 'produção', 'suco'];

// Combo-box component for destination field
const DestinationComboBox = ({
  value,
  onChange,
  allDestinations,
}: {
  value: string;
  onChange: (val: string) => void;
  allDestinations: string[];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = useMemo(() => {
    const term = inputValue.toLowerCase().trim();
    if (!term) return allDestinations;
    return allDestinations.filter((d) => d.toLowerCase().includes(term));
  }, [inputValue, allDestinations]);

  const openDropdown = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setIsOpen(true);
  };

  const handleSelect = (dest: string) => {
    setInputValue(dest);
    onChange(dest);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    openDropdown();
  };

  const handleBlur = () => {
    setTimeout(() => {
      onChange(inputValue);
      setIsOpen(false);
    }, 200);
  };

  const showNewOption = inputValue.trim() && !allDestinations.some((d) => d.toLowerCase() === inputValue.toLowerCase().trim());

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        placeholder="Digite ou selecione..."
      />
      {isOpen && (filtered.length > 0 || showNewOption) && (
        <div
          className="fixed z-[9999] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          {filtered.map((dest) => (
            <button
              key={dest}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(dest)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors ${
                dest.toLowerCase() === inputValue.toLowerCase()
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-700 dark:text-gray-200'
              }`}
            >
              {dest}
            </button>
          ))}
          {showNewOption && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(inputValue.trim())}
              className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 border-t border-gray-100 dark:border-gray-700 font-medium"
            >
              + Criar "{inputValue.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

interface EditableItem {
  id?: string;
  qty_out: string;
  description: string;
  qty_return: string;
  destination: string;
}

const SurplusReport = () => {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  // Navigation state
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);

  // Data state
  const [monthReports, setMonthReports] = useState<SurplusReportType[]>([]);
  const [activeReport, setActiveReport] = useState<SurplusReportWithItems | null>(null);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [knownDestinations, setKnownDestinations] = useState<string[]>([]);

  // Edit state
  const [editItems, setEditItems] = useState<EditableItem[]>([]);
  const [editLoggedBy, setEditLoggedBy] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // UI state
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newReportDate, setNewReportDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // View mode: 'list' (month view) or 'detail' (single report)
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');

  // Fetch reports for current month
  const fetchMonthReports = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    const { data, error } = await getSurplusReportsByMonth(selectedHotel.id, currentYear, currentMonth);
    if (error) {
      addNotification(`Erro ao buscar relatórios: ${error.message}`, 'error');
    } else {
      setMonthReports(data || []);
    }
    setLoading(false);
  }, [selectedHotel, currentYear, currentMonth, addNotification]);

  // Fetch available months for navigation hints
  const fetchAvailableMonths = useCallback(async () => {
    if (!selectedHotel) return;
    const { data } = await getAvailableMonths(selectedHotel.id);
    if (data) setAvailableMonths(data);
  }, [selectedHotel]);

  useEffect(() => {
    fetchMonthReports();
  }, [fetchMonthReports]);

  useEffect(() => {
    fetchAvailableMonths();
  }, [fetchAvailableMonths]);

  // Fetch known destinations from DB
  const fetchDestinations = useCallback(async () => {
    if (!selectedHotel) return;
    const { data } = await getDistinctDestinations(selectedHotel.id);
    if (data) setKnownDestinations(data);
  }, [selectedHotel]);

  useEffect(() => {
    fetchDestinations();
  }, [fetchDestinations]);

  // Merge default + DB destinations (unique, sorted)
  const allDestinations = useMemo(() => {
    const merged = new Set([...DEFAULT_DESTINATIONS, ...knownDestinations]);
    return Array.from(merged).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [knownDestinations]);

  // Open a report detail
  const openReport = useCallback(async (reportId: string) => {
    setLoading(true);
    const { data, error } = await getSurplusReportWithItems(reportId);
    if (error) {
      addNotification(`Erro ao carregar relatório: ${error.message}`, 'error');
      setLoading(false);
      return;
    }
    if (data) {
      setActiveReport(data);
      setEditLoggedBy(data.logged_by || '');
      setEditItems(
        data.items.length > 0
          ? data.items.map((it) => ({
              id: it.id,
              qty_out: it.qty_out,
              description: it.description,
              qty_return: it.qty_return,
              destination: it.destination,
            }))
          : [emptyItem()]
      );
      setIsEditing(false);
      setViewMode('detail');
    }
    setLoading(false);
  }, [addNotification]);

  const emptyItem = (): EditableItem => ({
    qty_out: '',
    description: '',
    qty_return: '',
    destination: '',
  });

  // Create new report
  const handleCreateReport = async () => {
    if (!selectedHotel || !user) return;

    // Check if report already exists for this date
    const existingReport = monthReports.find((r) => r.report_date === newReportDate);
    if (existingReport) {
      addNotification('Já existe um relatório para esta data.', 'error');
      return;
    }

    setIsSaving(true);
    const { data, error } = await createSurplusReport(
      selectedHotel.id,
      newReportDate,
      user.full_name || user.email || '',
      user.id
    );
    if (error) {
      addNotification(`Erro ao criar relatório: ${error.message}`, 'error');
    } else if (data) {
      addNotification('Relatório criado com sucesso!', 'success');
      setShowCreateModal(false);
      // Navigate to the month of the new report
      const d = parseISO(newReportDate);
      setCurrentYear(d.getFullYear());
      setCurrentMonth(d.getMonth() + 1);
      await fetchMonthReports();
      await fetchAvailableMonths();
      // Open the new report
      openReport(data.id);
    }
    setIsSaving(false);
  };

  // Save report
  const handleSave = async () => {
    if (!activeReport) return;
    setIsSaving(true);

    // Update logged_by
    const { error: updateError } = await updateSurplusReport(activeReport.id, {
      logged_by: editLoggedBy,
    });
    if (updateError) {
      addNotification(`Erro ao salvar: ${updateError.message}`, 'error');
      setIsSaving(false);
      return;
    }

    // Filter out completely empty items
    const validItems = editItems.filter(
      (it) => it.qty_out.trim() || it.description.trim() || it.qty_return.trim() || it.destination.trim()
    );

    const { error: itemsError } = await saveSurplusReportItems(
      activeReport.id,
      validItems.map((it, idx) => ({
        qty_out: it.qty_out,
        description: it.description,
        qty_return: it.qty_return,
        destination: it.destination,
        sort_order: idx,
      }))
    );

    if (itemsError) {
      addNotification(`Erro ao salvar itens: ${itemsError.message}`, 'error');
    } else {
      addNotification('Relatório salvo com sucesso!', 'success');
      setIsEditing(false);
      // Refresh destinations list + report
      await fetchDestinations();
      await openReport(activeReport.id);
    }
    setIsSaving(false);
  };

  // Delete report
  const handleDelete = async () => {
    if (!activeReport) return;
    setIsDeleting(true);
    const { error } = await deleteSurplusReport(activeReport.id);
    if (error) {
      addNotification(`Erro ao excluir: ${error.message}`, 'error');
    } else {
      addNotification('Relatório excluído.', 'success');
      setActiveReport(null);
      setViewMode('list');
      setShowDeleteConfirm(false);
      await fetchMonthReports();
      await fetchAvailableMonths();
    }
    setIsDeleting(false);
  };

  // Edit items helpers
  const updateItem = (index: number, field: keyof EditableItem, value: string) => {
    setEditItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addItem = () => {
    setEditItems((prev) => [...prev, emptyItem()]);
  };

  const removeItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Print blank template (2 per A4 landscape)
  const handlePrintTemplate = () => {
    const EMPTY_ROWS = 20;
    const rowsHtml = Array.from({ length: EMPTY_ROWS })
      .map(() => `<tr><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td></tr>`)
      .join('');

    const formHtml = `
      <div class="form">
        <h2 class="title">LANÇAMENTO DE SOBRANTE</h2>
        <div class="meta">
          <span><b>DATA:</b> ____/____/________</span>
          <span><b>LANÇADO POR:</b> ________________________________________</span>
        </div>
        <table>
          <thead>
            <tr>
              <th class="th" style="width:15%">QTD SAÍDA</th>
              <th class="th" style="width:40%">DESCRIÇÃO</th>
              <th class="th" style="width:15%">QTD RETORNO</th>
              <th class="th" style="width:30%">DESTINO</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Modelo Sobrante</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10px; }
  .page { display: flex; gap: 8mm; width: 100%; height: 100vh; }
  .form { flex: 1; border: 1.5px solid #000; padding: 4mm; display: flex; flex-direction: column; }
  .title { text-align: center; font-size: 13px; font-weight: bold; margin-bottom: 3mm; letter-spacing: 1px; }
  .meta { display: flex; gap: 6mm; margin-bottom: 3mm; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; flex: 1; }
  .th { border: 1px solid #000; padding: 2mm 1.5mm; text-align: center; font-size: 9px; font-weight: bold; background: #e8e8e8; }
  .cell { border: 1px solid #000; padding: 1.5mm 1.5mm; height: 5.5mm; font-size: 9px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body><div class="page">${formHtml}${formHtml}</div></body></html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      w.onload = () => { w.print(); };
    }
  };

  // Month navigation
  const goToPrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const hasReportsInMonth = availableMonths.includes(currentMonthKey);

  // Back to list
  const backToList = () => {
    setActiveReport(null);
    setViewMode('list');
    fetchMonthReports();
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    } catch {
      return dateStr;
    }
  };

  const formatDateShort = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), 'dd/MM/yyyy');
    } catch {
      return dateStr;
    }
  };

  // ========== RENDER ==========

  if (!selectedHotel) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        Selecione um hotel para ver os relatórios de sobrantes.
      </div>
    );
  }

  // Loading
  if (loading && viewMode === 'list' && monthReports.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // ===== DETAIL VIEW =====
  if (viewMode === 'detail' && activeReport) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={backToList}
            className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para lista
          </button>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2"
                >
                  <ClipboardList className="w-4 h-4" />
                  Editar
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    if (activeReport) openReport(activeReport.id);
                  }}
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 text-sm font-medium flex items-center gap-2"
                >
                  <X className="w-4 h-4" />
                  Cancelar
                </button>
              </>
            )}
          </div>
        </div>

        {/* Report Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Title */}
          <div className="bg-blue-600 dark:bg-blue-700 px-6 py-4">
            <h2 className="text-lg font-bold text-white text-center uppercase tracking-wide">
              Lançamento de Sobrante
            </h2>
          </div>

          {/* Meta fields */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Data:</span>
              <span className="text-sm font-semibold text-gray-800 dark:text-white">
                {formatDate(activeReport.report_date)}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Lançado por:</span>
              {isEditing ? (
                <input
                  type="text"
                  value={editLoggedBy}
                  onChange={(e) => setEditLoggedBy(e.target.value)}
                  className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Nome do responsável"
                />
              ) : (
                <span className="text-sm font-semibold text-gray-800 dark:text-white">
                  {activeReport.logged_by || '—'}
                </span>
              )}
            </div>
          </div>

          {/* Items Table - Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase w-[120px]">
                    Qtd Saída
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">
                    Descrição
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase w-[120px]">
                    Qtd Retorno
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase w-[160px]">
                    Destino
                  </th>
                  {isEditing && (
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase w-[60px]">
                      Ação
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {(isEditing ? editItems : activeReport.items).map((item, index) => (
                  <tr
                    key={index}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={(item as EditableItem).qty_out}
                          onChange={(e) => updateItem(index, 'qty_out', e.target.value)}
                          className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Ex: 14 fat"
                        />
                      ) : (
                        <span className="text-sm text-gray-800 dark:text-gray-200">
                          {item.qty_out || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={(item as EditableItem).description}
                          onChange={(e) => updateItem(index, 'description', e.target.value)}
                          className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Descrição do item"
                        />
                      ) : (
                        <span className="text-sm text-gray-800 dark:text-gray-200">
                          {item.description || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={(item as EditableItem).qty_return}
                          onChange={(e) => updateItem(index, 'qty_return', e.target.value)}
                          className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Ex: 4"
                        />
                      ) : (
                        <span className="text-sm text-gray-800 dark:text-gray-200">
                          {item.qty_return || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <DestinationComboBox
                          value={(item as EditableItem).destination}
                          onChange={(val) => updateItem(index, 'destination', val)}
                          allDestinations={allDestinations}
                        />
                      ) : (
                        <span className="text-sm text-gray-800 dark:text-gray-200">
                          {item.destination || '—'}
                        </span>
                      )}
                    </td>
                    {isEditing && (
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => removeItem(index)}
                          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1"
                          title="Remover item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Items Cards - Mobile */}
          <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
            {(isEditing ? editItems : activeReport.items).map((item, index) => (
              <div key={index} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                    Item {index + 1}
                  </span>
                  {isEditing && (
                    <button
                      onClick={() => removeItem(index)}
                      className="text-red-500 hover:text-red-700 dark:text-red-400 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Qtd Saída
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={(item as EditableItem).qty_out}
                        onChange={(e) => updateItem(index, 'qty_out', e.target.value)}
                        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                        placeholder="Ex: 14 fat"
                      />
                    ) : (
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        {item.qty_out || '—'}
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Qtd Retorno
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={(item as EditableItem).qty_return}
                        onChange={(e) => updateItem(index, 'qty_return', e.target.value)}
                        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                        placeholder="Ex: 4"
                      />
                    ) : (
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        {item.qty_return || '—'}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Descrição
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={(item as EditableItem).description}
                      onChange={(e) => updateItem(index, 'description', e.target.value)}
                      className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                      placeholder="Descrição do item"
                    />
                  ) : (
                    <span className="text-sm text-gray-800 dark:text-gray-200">
                      {item.description || '—'}
                    </span>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Destino
                  </label>
                  {isEditing ? (
                    <DestinationComboBox
                      value={(item as EditableItem).destination}
                      onChange={(val) => updateItem(index, 'destination', val)}
                      allDestinations={allDestinations}
                    />
                  ) : (
                    <span className="text-sm text-gray-800 dark:text-gray-200 capitalize">
                      {item.destination || '—'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add item button */}
          {isEditing && (
            <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={addItem}
                className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium"
              >
                <PlusCircle className="w-4 h-4" />
                Adicionar item
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isEditing && activeReport.items.length === 0 && (
            <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
              <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum item registrado. Clique em "Editar" para adicionar itens.</p>
            </div>
          )}
        </div>

        {/* Delete confirm modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white">
                Excluir relatório?
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Tem certeza que deseja excluir o relatório de{' '}
                <strong>{formatDate(activeReport.report_date)}</strong>? Esta ação não pode ser desfeita.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== LIST VIEW (month navigation + day reports) =====
  return (
    <div className="space-y-4">
      {/* Header with create button */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white flex items-center gap-2">
          <ClipboardList className="w-5 h-5" />
          Sobrantes
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrintTemplate}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm font-medium flex items-center gap-2 shadow-sm"
          >
            <Printer className="w-4 h-4" />
            Imprimir Modelo
          </button>
          <button
            onClick={() => {
              setNewReportDate(format(new Date(), 'yyyy-MM-dd'));
              setShowCreateModal(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Criar Novo
          </button>
        </div>
      </div>

      {/* Month/Year navigation */}
      <div className="flex items-center justify-center gap-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-4 py-3">
        <button
          onClick={goToPrevMonth}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center min-w-[180px]">
          <span className="text-lg font-semibold text-gray-800 dark:text-white">
            {MONTHS_PT[currentMonth - 1]} {currentYear}
          </span>
          {hasReportsInMonth && (
            <span className="ml-2 inline-block w-2 h-2 bg-blue-500 rounded-full" title="Possui relatórios" />
          )}
        </div>
        <button
          onClick={goToNextMonth}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Reports list for this month */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : monthReports.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-6 py-12 text-center">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Nenhum relatório de sobrante para {MONTHS_PT[currentMonth - 1]} de {currentYear}.
          </p>
          <button
            onClick={() => {
              setNewReportDate(format(new Date(), 'yyyy-MM-dd'));
              setShowCreateModal(true);
            }}
            className="mt-4 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium"
          >
            Criar primeiro relatório
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {monthReports.map((report) => (
            <button
              key={report.id}
              onClick={() => openReport(report.id)}
              className="w-full text-left bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-5 py-4 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-800 dark:text-white">
                      {formatDateShort(report.report_date)}
                    </div>
                    {report.logged_by && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        por {report.logged_by}
                      </div>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-blue-500 transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create Report Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-blue-500" />
              Novo Relatório de Sobrante
            </h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Data do relatório
              </label>
              <input
                type="date"
                value={newReportDate}
                onChange={(e) => setNewReportDate(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateReport}
                disabled={isSaving || !newReportDate}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Criar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SurplusReport;
