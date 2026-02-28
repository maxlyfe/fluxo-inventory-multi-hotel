import React, { useState, useEffect, useMemo } from 'react';
import { supabase, getSectorConsumptionData, getItemPriceHistory } from '../lib/supabase';
import { 
  Download, Filter, ChevronDown, ChevronUp, 
  DollarSign, Package, TrendingUp, Calendar, Search, X // Added Search and X icons
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { 
  format, parseISO, eachDayOfInterval, compareAsc, 
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, // Added date-fns functions
  getWeek, getMonth, getYear // Added for grouping
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../context/HotelContext';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell
} from 'recharts';

// --- Interfaces (remain the same) ---
interface Product {
  id: string;
  name: string;
  quantity: number;
  category: string;
  last_purchase_date: string;
  last_purchase_price: number;
  average_price: number;
}

interface Purchase {
  id: string;
  invoice_number: string;
  supplier: string;
  purchase_date: string; // ISO string date 'YYYY-MM-DD'
  total_amount: number;
  notes: string;
  items: {
    product_id: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    product: {
      name: string;
      category: string;
    };
  }[];
}

interface SectorConsumptionChartData {
  sectorName: string;
  totalCost: number;
}

interface ItemPriceHistoryData {
  date: string; // ISO string date
  price: number;
}

interface SpendingByDateData {
  date: string; // ISO string date 'YYYY-MM-DD'
  totalSpending: number;
}

interface TopCostItemData {
  name: string;
  totalValue: number;
}

// --- Constants ---
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC0CB', '#A52A2A', '#D2691E', '#FFD700'];

type PeriodType = 'month' | 'week' | 'custom';

// --- Utility Function for Accent Insensitive Search ---
const removeAccents = (str: string) => {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

// --- Component ---
const ManagementPanel = () => {
  const { selectedHotel } = useHotel();
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [sectorConsumption, setSectorConsumption] = useState<SectorConsumptionChartData[]>([]);
  const [itemPriceHistory, setItemPriceHistory] = useState<ItemPriceHistoryData[]>([]);
  const [spendingByDate, setSpendingByDate] = useState<SpendingByDateData[]>([]);
  const [topCostItems, setTopCostItems] = useState<TopCostItemData[]>([]);
  const [selectedProductIdForChart, setSelectedProductIdForChart] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadingCharts, setLoadingCharts] = useState(true);
  const [loadingPriceChart, setLoadingPriceChart] = useState(false);
  const [searchTerm, setSearchTerm] = useState(''); // Search term for inventory table
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // State for period selection
  const [selectedPeriodType, setSelectedPeriodType] = useState<PeriodType>('month');
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'), // Default to start of current month
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd') // Default to end of current month
  });

  // State for collapsible sections
  const [isPurchasesExpanded, setIsPurchasesExpanded] = useState(false);
  const [isInventoryExpanded, setIsInventoryExpanded] = useState(false);

  // --- Effects ---
  useEffect(() => {
    // Update date range based on selected period type
    const today = new Date();
    let newStartDate = dateRange.start;
    let newEndDate = dateRange.end;

    if (selectedPeriodType === 'month') {
      newStartDate = format(startOfMonth(today), 'yyyy-MM-dd');
      newEndDate = format(endOfMonth(today), 'yyyy-MM-dd');
    } else if (selectedPeriodType === 'week') {
      newStartDate = format(startOfWeek(today, { locale: ptBR }), 'yyyy-MM-dd'); // Use ptBR for week start
      newEndDate = format(endOfWeek(today, { locale: ptBR }), 'yyyy-MM-dd');
    } // 'custom' uses the manually set dateRange

    // Only update if the range actually changed to avoid infinite loops
    if (newStartDate !== dateRange.start || newEndDate !== dateRange.end) {
      setDateRange({ start: newStartDate, end: newEndDate });
    }
  }, [selectedPeriodType]); // Run only when period type changes

  useEffect(() => {
    // Fetch data whenever hotel or the calculated dateRange changes
    if (selectedHotel?.id) {
      fetchData();
      fetchChartData();
    }
  }, [selectedHotel, dateRange]); // Depend on dateRange which is updated by selectedPeriodType effect

  useEffect(() => {
    if (selectedProductIdForChart && selectedHotel?.id) {
      fetchItemPriceHistory();
    }
  }, [selectedProductIdForChart, dateRange, selectedHotel]);

  useEffect(() => {
    processSpendingByDate();
  }, [purchases, dateRange]);

  useEffect(() => {
    processTopCostItems();
  }, [products]);

  // --- Data Fetching Functions (fetchData, fetchChartData, fetchItemPriceHistory - remain mostly the same, using dateRange) ---
  const fetchData = async () => {
    if (!selectedHotel?.id) return;
    try {
      setLoading(true);
      setError(null);

      // Fetch products (no date filter needed here)
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*')
        .eq('hotel_id', selectedHotel.id)
        .order('name');
      if (productsError) throw productsError;
      setProducts(productsData || []);

      // Fetch purchases within the current dateRange
      const { data: purchasesData, error: purchasesError } = await supabase
        .from('purchases')
        .select(`
          *,
          items:purchase_items(
            product_id,
            quantity,
            unit_price,
            total_price,
            product:products(name, category)
          )
        `)
        .eq('hotel_id', selectedHotel.id)
        .gte('purchase_date', dateRange.start)
        .lte('purchase_date', dateRange.end)
        .order('purchase_date', { ascending: false });
      if (purchasesError) throw purchasesError;
      setPurchases(purchasesData || []);

      // Extract categories from fetched products
      const uniqueCategories = [...new Set(productsData?.map(p => p.category) || [])];
      setCategories(uniqueCategories.sort());

      // Set default product for price chart if needed
      if (!selectedProductIdForChart && productsData && productsData.length > 0) {
        setSelectedProductIdForChart(productsData[0].id);
      }

    } catch (err) {
      console.error('Error fetching table data:', err);
      setError('Erro ao carregar dados das tabelas');
    } finally {
      setLoading(false);
    }
  };

  const fetchChartData = async () => {
    if (!selectedHotel?.id) return;
    try {
      setLoadingCharts(true);
      // Fetch consumption data using the current dateRange
      const consumptionResult = await getSectorConsumptionData(selectedHotel.id, dateRange.start, dateRange.end);
      if (consumptionResult.success) {
        setSectorConsumption(consumptionResult.data || []);
      } else {
        console.error('Error fetching consumption data:', consumptionResult.error);
        setError(`Erro ao carregar dados de consumo: ${consumptionResult.error}`);
        setSectorConsumption([]); // Clear data on error
      }
    } catch (err) {
      console.error('Error fetching general chart data:', err);
      setError('Erro geral ao carregar dados dos gráficos.');
      setSectorConsumption([]);
    } finally {
      setLoadingCharts(false);
    }
  };

  const fetchItemPriceHistory = async () => {
    if (!selectedHotel?.id || !selectedProductIdForChart) return;
    try {
      setLoadingPriceChart(true);
      // Fetch price history using the current dateRange
      const priceHistoryResult = await getItemPriceHistory(
        selectedHotel.id,
        selectedProductIdForChart,
        dateRange.start,
        dateRange.end
      );
      if (priceHistoryResult.success) {
        setItemPriceHistory(priceHistoryResult.data || []);
      } else {
        console.error('Error fetching item price history:', priceHistoryResult.error);
        setItemPriceHistory([]);
      }
    } catch (err) {
      console.error('Error in fetchItemPriceHistory:', err);
      setItemPriceHistory([]);
    } finally {
      setLoadingPriceChart(false);
    }
  };

  // --- Data Processing Functions (processSpendingByDate, processTopCostItems - remain the same) ---
   const processSpendingByDate = () => {
    const spendingMap: { [date: string]: number } = {};
    try {
      // Ensure dateRange is valid before creating interval
      if (dateRange.start && dateRange.end && parseISO(dateRange.start) <= parseISO(dateRange.end)) {
        const interval = eachDayOfInterval({
          start: parseISO(dateRange.start),
          end: parseISO(dateRange.end)
        });
        interval.forEach(day => {
          const formattedDate = format(day, 'yyyy-MM-dd');
          spendingMap[formattedDate] = 0;
        });
      } else {
         console.warn("Invalid date range for spending processing:", dateRange);
      }
    } catch (e) {
      console.error("Error creating date interval:", e);
    }
    purchases.forEach(purchase => {
      const date = purchase.purchase_date;
      if (spendingMap[date] !== undefined) {
        spendingMap[date] += purchase.total_amount;
      } else if (date >= dateRange.start && date <= dateRange.end) {
         // Add purchase if it falls within the range but wasn't in the initial map (edge case)
         spendingMap[date] = purchase.total_amount;
      }
    });
    const processedData = Object.entries(spendingMap)
      .map(([date, totalSpending]) => ({ date, totalSpending }))
      .sort((a, b) => compareAsc(parseISO(a.date), parseISO(b.date)));
    setSpendingByDate(processedData);
  };

  const processTopCostItems = () => {
    const itemsWithValue = products.map(product => {
      const price = product.average_price || product.last_purchase_price || 0;
      const totalValue = product.quantity * price;
      return { name: product.name, totalValue };
    });

    const sortedItems = itemsWithValue.sort((a, b) => b.totalValue - a.totalValue);
    setTopCostItems(sortedItems.slice(0, 10)); // Pega os top 10
  };

  // --- Calculation Functions (calculateTotalStockValue, calculateTotalPurchases - remain the same) ---
  const calculateTotalStockValue = () => {
    return products.reduce((total, product) => {
      const price = product.average_price || product.last_purchase_price || 0;
      return total + (price * product.quantity);
    }, 0);
  };

  const calculateTotalPurchases = () => {
    return purchases.reduce((total, purchase) => total + purchase.total_amount, 0);
  };

  // --- Export Function (remains the same) ---
  const exportReport = () => {
    const wb = XLSX.utils.book_new();
    // Filter products based on search term before exporting
    const filteredStockData = filteredInventoryProducts.map(product => ({
      'Item': product.name,
      'Categoria': product.category,
      'Quantidade': product.quantity,
      'Último Preço': product.last_purchase_price ? 
        `R$ ${product.last_purchase_price.toFixed(2)}` : '-',
      'Preço Médio': product.average_price ? 
        `R$ ${product.average_price.toFixed(2)}` : '-',
      'Valor em Estoque': product.quantity * (product.average_price || product.last_purchase_price || 0),
      'Última Compra': product.last_purchase_date ? 
        format(parseISO(product.last_purchase_date), 'dd/MM/yyyy') : '-'
    }));
    const ws1 = XLSX.utils.json_to_sheet(filteredStockData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Valor em Estoque');

    // Group purchases by week for export?
    // For now, export as is
    const purchaseData = purchases.map(purchase => ({
      'Data': format(parseISO(purchase.purchase_date), 'dd/MM/yyyy'),
      'Nota Fiscal': purchase.invoice_number,
      'Fornecedor': purchase.supplier,
      'Valor Total': `R$ ${purchase.total_amount.toFixed(2)}`,
      'Observações': purchase.notes || '-'
    }));
    const ws2 = XLSX.utils.json_to_sheet(purchaseData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Compras');

    const itemsData = purchases.flatMap(purchase => 
      purchase.items.map(item => ({
        'Data': format(parseISO(purchase.purchase_date), 'dd/MM/yyyy'),
        'Nota Fiscal': purchase.invoice_number,
        'Fornecedor': purchase.supplier,
        'Item': item.product?.name || 'N/A',
        'Categoria': item.product?.category || 'N/A',
        'Quantidade': item.quantity,
        'Preço Unitário': `R$ ${item.unit_price.toFixed(2)}`,
        'Total': `R$ ${item.total_price.toFixed(2)}`
      }))
    );
    const ws3 = XLSX.utils.json_to_sheet(itemsData);
    XLSX.utils.book_append_sheet(wb, ws3, 'Itens Comprados');

    XLSX.writeFile(wb, `relatorio-gerencial-${format(new Date(), 'dd-MM-yyyy')}.xlsx`);
  };

  // --- Formatting Functions (remain the same) ---
  const formatCurrency = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const formatCurrencyTooltip = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatDate = (dateString: string) => {
      try {
          return format(parseISO(dateString), 'dd/MM/yy', { locale: ptBR });
      } catch (e) {
          return dateString; // Return original string if parsing fails
      }
  };
  const formatYAxisLabel = (label: string) => {
    const maxLength = 25;
    if (label.length > maxLength) {
      return `${label.substring(0, maxLength)}...`;
    }
    return label;
  };

  // --- Tooltip Renderers (remain the same) ---
  const renderConsumptionTooltipContent = (props: any) => {
    const { payload, label } = props;
    if (payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-700 p-2 border border-gray-300 dark:border-gray-600 rounded shadow-lg">
          <p className="font-bold text-gray-800 dark:text-white">{label}</p>
          <p className="text-sm text-blue-600 dark:text-blue-400">
            {`Gasto: ${formatCurrencyTooltip(payload[0].value)}`}
          </p>
        </div>
      );
    }
    return null;
  };

  const renderPriceTooltipContent = (props: any) => {
    const { payload, label } = props;
    if (payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-700 p-2 border border-gray-300 dark:border-gray-600 rounded shadow-lg">
          <p className="font-bold text-gray-800 dark:text-white">{formatDate(label)}</p>
          <p className="text-sm text-green-600 dark:text-green-400">
            {`Preço: ${formatCurrencyTooltip(payload[0].value)}`}
          </p>
        </div>
      );
    }
    return null;
  };

  const renderSpendingTooltipContent = (props: any) => {
    const { payload, label } = props;
    if (payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-700 p-2 border border-gray-300 dark:border-gray-600 rounded shadow-lg">
          <p className="font-bold text-gray-800 dark:text-white">{formatDate(label)}</p>
          <p className="text-sm text-indigo-600 dark:text-indigo-400">
            {`Gasto Total: ${formatCurrencyTooltip(payload[0].value)}`}
          </p>
        </div>
      );
    }
    return null;
  };

  const renderTopCostTooltipContent = (props: any) => {
    const { payload, label } = props;
    if (payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-700 p-2 border border-gray-300 dark:border-gray-600 rounded shadow-lg">
          <p className="font-bold text-gray-800 dark:text-white">{label}</p>
          <p className="text-sm text-orange-600 dark:text-orange-400">
            {`Valor em Estoque: ${formatCurrencyTooltip(payload[0].value)}`}
          </p>
        </div>
      );
    }
    return null;
  };

  // --- Filtering and Grouping Logic ---

  // Filter inventory products based on search term
  const filteredInventoryProducts = useMemo(() => {
    if (!searchTerm) {
      return products;
    }
    const lowerCaseSearchTerm = removeAccents(searchTerm.toLowerCase());
    return products.filter(product => 
      removeAccents(product.name.toLowerCase()).includes(lowerCaseSearchTerm)
    );
  }, [products, searchTerm]);

  // Group purchases by week
  const groupedPurchases = useMemo(() => {
    const groups: { [weekYear: string]: Purchase[] } = {};
    purchases.forEach(purchase => {
      try {
        const date = parseISO(purchase.purchase_date);
        const week = getWeek(date, { locale: ptBR });
        const year = getYear(date);
        const key = `${year}-W${week.toString().padStart(2, '0')}`;
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(purchase);
      } catch (e) {
        console.error("Error parsing purchase date for grouping:", purchase.purchase_date, e);
      }
    });
    // Sort weeks chronologically (descending)
    return Object.entries(groups).sort(([keyA], [keyB]) => keyB.localeCompare(keyA));
  }, [purchases]);

  // --- Render Logic ---
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header and Global Filters */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 space-y-4 md:space-y-0">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">
          Relatório Gerencial
        </h1>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
          >
            <Filter className="w-4 h-4 mr-2" />
            Filtros
            {showFilters ? (
              <ChevronUp className="w-4 h-4 ml-2" />
            ) : (
              <ChevronDown className="w-4 h-4 ml-2" />
            )}
          </button>
          <button
            onClick={exportReport}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm"
          >
            <Download className="w-4 h-4 mr-2" />
            Exportar
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Filter Section */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8">
          <h2 className="text-lg font-semibold mb-4 text-gray-700 dark:text-gray-200">Filtros Globais</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            {/* Period Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Período
              </label>
              <select
                value={selectedPeriodType}
                onChange={(e) => setSelectedPeriodType(e.target.value as PeriodType)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              >
                <option value="month">Mês Atual</option>
                <option value="week">Semana Atual</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>

            {/* Custom Date Range Inputs (shown only if 'custom' is selected) */}
            {selectedPeriodType === 'custom' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Data Inicial
                  </label>
                  <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Data Final
                  </label>
                  <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
              </>
            )}
            {/* Fill empty grid cells if custom range is not shown */} 
            {selectedPeriodType !== 'custom' && <div className="md:col-span-2"></div>}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 mr-4">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Valor Total em Estoque</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{formatCurrency(calculateTotalStockValue())}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 mr-4">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total em Compras (Período)</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{formatCurrency(calculateTotalPurchases())}</p>
            </div>
          </div>
        </div>
        {/* Add a third summary card if needed, e.g., Number of Purchases */}
         <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 mr-4">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Período Selecionado</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatDate(dateRange.start)} - {formatDate(dateRange.end)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Sector Consumption Chart */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-700 dark:text-gray-200">Consumo por Setor (R$)</h2>
          {loadingCharts ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : sectorConsumption.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sectorConsumption} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" dark:stroke="#555" />
                <XAxis dataKey="sectorName" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={formatCurrency} tick={{ fontSize: 12 }} />
                <Tooltip content={renderConsumptionTooltipContent} />
                <Bar dataKey="totalCost" name="Gasto Total" fill="#3B82F6" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400 h-64 flex items-center justify-center">Sem dados de consumo para o período.</p>
          )}
        </div>

        {/* Spending Over Time Chart */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-700 dark:text-gray-200">Gastos Totais por Período</h2>
           {loadingCharts ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : spendingByDate.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={spendingByDate} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" dark:stroke="#555" />
                <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={formatCurrency} tick={{ fontSize: 12 }} />
                <Tooltip content={renderSpendingTooltipContent} />
                <Line type="monotone" dataKey="totalSpending" name="Gasto Total" stroke="#6366F1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
           ) : (
            <p className="text-center text-gray-500 dark:text-gray-400 h-64 flex items-center justify-center">Sem dados de gastos para o período.</p>
          )}
        </div>

        {/* Item Price Trend Chart */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Tendência de Preço de Item</h2>
            <select
              value={selectedProductIdForChart}
              onChange={(e) => setSelectedProductIdForChart(e.target.value)}
              className="text-sm rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {loadingPriceChart ? (
             <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            </div>
          ) : itemPriceHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={itemPriceHistory} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" dark:stroke="#555" />
                <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={formatCurrencyTooltip} tick={{ fontSize: 12 }} domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip content={renderPriceTooltipContent} />
                <Line type="monotone" dataKey="price" name="Preço Unitário" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
             <p className="text-center text-gray-500 dark:text-gray-400 h-64 flex items-center justify-center">Sem histórico de preços para este item no período.</p>
          )}
        </div>

        {/* Top 10 Items by Stock Value Chart */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-700 dark:text-gray-200">Top 10 Itens por Valor em Estoque</h2>
          {loadingCharts ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
            </div>
          ) : topCostItems.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              {/* Horizontal Bar Chart */}
              <BarChart data={topCostItems} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" dark:stroke="#555" />
                <XAxis type="number" tickFormatter={formatCurrency} tick={{ fontSize: 12 }} />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  width={100} 
                  tickFormatter={formatYAxisLabel} 
                  tick={{ fontSize: 12 }} 
                />
                <Tooltip content={renderTopCostTooltipContent} />
                <Bar dataKey="totalValue" name="Valor em Estoque" fill="#F97316">
                  {topCostItems.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400 h-64 flex items-center justify-center">Sem dados de estoque para exibir.</p>
          )}
        </div>
      </div>

      {/* Detailed Tables Section */}
      <div className="space-y-8">
        {/* Recent Purchases Table (Collapsible & Grouped) */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <button 
            onClick={() => setIsPurchasesExpanded(!isPurchasesExpanded)}
            className="w-full flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
          >
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Compras Recentes (por Semana)</h2>
            {isPurchasesExpanded ? <ChevronUp className="w-5 h-5 text-gray-500 dark:text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400" />}
          </button>
          {isPurchasesExpanded && (
            <div className="p-4">
              {groupedPurchases.length > 0 ? (
                groupedPurchases.map(([weekYear, weekPurchases]) => (
                  <div key={weekYear} className="mb-6 last:mb-0">
                    <h3 className="text-md font-semibold text-gray-600 dark:text-gray-300 mb-2 border-b pb-1 border-gray-200 dark:border-gray-600">
                      Semana {weekYear.split('-W')[1]} de {weekYear.split('-W')[0]}
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Data</th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Nota Fiscal</th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Fornecedor</th>
                            <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Valor Total</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                          {weekPurchases.map((purchase) => (
                            <tr key={purchase.id}>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 dark:text-white">{formatDate(purchase.purchase_date)}</td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{purchase.invoice_number || '-'}</td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{purchase.supplier || '-'}</td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 dark:text-white text-right">{formatCurrencyTooltip(purchase.total_amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-gray-500 dark:text-gray-400 py-4">Sem compras no período selecionado.</p>
              )}
            </div>
          )}
        </div>

        {/* Inventory Value Table (Collapsible & Filterable) */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <button 
            onClick={() => setIsInventoryExpanded(!isInventoryExpanded)}
            className="w-full flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
          >
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Valor em Estoque por Item</h2>
            {isInventoryExpanded ? <ChevronUp className="w-5 h-5 text-gray-500 dark:text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400" />}
          </button>
          {isInventoryExpanded && (
            <div className="p-4">
              {/* Search Input */}
              <div className="mb-4 relative">
                <input
                  type="text"
                  placeholder="Buscar item..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                {searchTerm && (
                    <button 
                        onClick={() => setSearchTerm('')} 
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}
              </div>

              {/* Inventory Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Item</th>
                      <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Qtd.</th>
                      <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Preço Médio</th>
                      <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Valor Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredInventoryProducts.length > 0 ? (
                      filteredInventoryProducts.map((product) => {
                        const price = product.average_price || product.last_purchase_price || 0;
                        const totalValue = product.quantity * price;
                        return (
                          <tr key={product.id}>
                            <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{product.name}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-right">{product.quantity}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-right">{formatCurrencyTooltip(price)}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 dark:text-white text-right">{formatCurrencyTooltip(totalValue)}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                          {searchTerm ? 'Nenhum item encontrado.' : 'Nenhum item em estoque.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManagementPanel;

