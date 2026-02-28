import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { 
  DollarSign, Download, Filter, ChevronDown, ChevronUp,
  Building2, ArrowLeftRight, Calendar, Search, AlertTriangle,
  Plus, X
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Hotel {
  id: string;
  name: string;
  code: string;
}

interface Balance {
  id: string;
  hotel_id: string;
  transaction_type: 'credit' | 'debit';
  amount: number;
  reason: string;
  reference_type: 'purchase' | 'transfer' | 'consumption' | 'payment';
  reference_id: string;
  balance: number;
  created_at: string;
}

interface Payment {
  id: string;
  purchase_id: string;
  hotel_id: string;
  amount: number;
  payment_date: string;
  notes?: string;
  created_at: string;
  purchases: {
    invoice_number: string;
    supplier: string;
    total_amount: number;
  };
}

const FinancialManagement = () => {
  const { selectedHotel } = useHotel();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [filteredBalances, setFilteredBalances] = useState<Balance[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filteredPayments, setFilteredPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [selectedHotelFilter, setSelectedHotelFilter] = useState<string>('');
  const [totalBalance, setTotalBalance] = useState<number>(0);
  const [newPayment, setNewPayment] = useState({
    amount: '',
    reason: '',
    notes: ''
  });

  useEffect(() => {
    if (!selectedHotel?.id) {
      setError('Selecione um hotel para visualizar os dados financeiros');
      return;
    }
    
    fetchData();
  }, [selectedHotel]);

  // Apply filters when date range or hotel filter changes
  useEffect(() => {
    if (balances.length > 0) {
      const filtered = balances.filter(balance => {
        const balanceDate = new Date(balance.created_at);
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999);

        const matchesDate = balanceDate >= startDate && balanceDate <= endDate;
        const matchesHotel = !selectedHotelFilter || balance.hotel_id === selectedHotelFilter;

        return matchesDate && matchesHotel;
      });
      setFilteredBalances(filtered);
    }

    if (payments.length > 0) {
      const filtered = payments.filter(payment => {
        const paymentDate = new Date(payment.payment_date);
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999);

        const matchesDate = paymentDate >= startDate && paymentDate <= endDate;
        const matchesHotel = !selectedHotelFilter || payment.hotel_id === selectedHotelFilter;

        return matchesDate && matchesHotel;
      });
      setFilteredPayments(filtered);
    }
  }, [dateRange, selectedHotelFilter, balances, payments]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch hotels
      const { data: hotelsData, error: hotelsError } = await supabase
        .from('hotels')
        .select('id, name, code')
        .order('name');

      if (hotelsError) throw hotelsError;
      setHotels(hotelsData || []);

      // Fetch all balances without date filter
      const { data: balancesData, error: balancesError } = await supabase
        .from('hotel_balances')
        .select('*')
        .eq('hotel_id', selectedHotel?.id)
        .order('created_at', { ascending: false });

      if (balancesError) throw balancesError;
      setBalances(balancesData || []);

      // Calculate total balance from all transactions
      if (balancesData && balancesData.length > 0) {
        setTotalBalance(balancesData[0].balance);
      }

      // Fetch all payments without date filter
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('purchase_payments')
        .select(`
          *,
          purchases (
            invoice_number,
            supplier,
            total_amount
          )
        `)
        .eq('hotel_id', selectedHotel?.id)
        .order('payment_date', { ascending: false });

      if (paymentsError) throw paymentsError;
      setPayments(paymentsData || []);

    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Erro ao carregar dados financeiros: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel não selecionado');
      }

      const amount = parseFloat(newPayment.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Valor inválido');
      }

      // Call RPC function to record payment
      const { error: rpcError } = await supabase.rpc('update_hotel_balance', {
        p_hotel_id: selectedHotel.id,
        p_transaction_type: 'credit',
        p_amount: amount,
        p_reason: newPayment.reason,
        p_reference_type: 'payment',
        p_reference_id: crypto.randomUUID()
      });

      if (rpcError) throw rpcError;

      // Reset form and refresh data
      setNewPayment({
        amount: '',
        reason: '',
        notes: ''
      });
      setShowPaymentForm(false);
      fetchData();

    } catch (err) {
      console.error('Error adding payment:', err);
      setError('Erro ao adicionar pagamento: ' + (err.message || err));
    }
  };

  const getTotalPayments = () => {
    // Calculate total payments for the filtered period
    return filteredPayments.reduce((total, payment) => total + payment.amount, 0);
  };

  const getHotelName = (hotelId: string) => {
    const hotel = hotels.find(h => h.id === hotelId);
    return hotel?.name || 'Hotel não encontrado';
  };

  const exportFinancialReport = () => {
    // Create workbook
    const wb = XLSX.utils.book_new();

    // Balances sheet
    const balancesData = filteredBalances.map(balance => ({
      'Data': format(new Date(balance.created_at), 'dd/MM/yyyy HH:mm'),
      'Tipo': balance.transaction_type === 'credit' ? 'Crédito' : 'Débito',
      'Valor': `R$ ${balance.amount.toFixed(2)}`,
      'Motivo': balance.reason,
      'Saldo': `R$ ${balance.balance.toFixed(2)}`
    }));

    const wsBalances = XLSX.utils.json_to_sheet(balancesData);
    XLSX.utils.book_append_sheet(wb, wsBalances, 'Movimentações');

    // Payments sheet
    const paymentsData = filteredPayments.map(payment => ({
      'Data': format(new Date(payment.payment_date), 'dd/MM/yyyy HH:mm'),
      'Nota Fiscal': payment.purchases.invoice_number,
      'Fornecedor': payment.purchases.supplier,
      'Valor Total NF': `R$ ${payment.purchases.total_amount.toFixed(2)}`,
      'Valor Pago': `R$ ${payment.amount.toFixed(2)}`,
      'Observações': payment.notes || '-'
    }));

    const wsPayments = XLSX.utils.json_to_sheet(paymentsData);
    XLSX.utils.book_append_sheet(wb, wsPayments, 'Pagamentos');

    // Save file
    XLSX.writeFile(wb, `relatorio-financeiro-${format(new Date(), 'dd-MM-yyyy')}.xlsx`);
  };

  if (!selectedHotel) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="bg-yellow-50 dark:bg-yellow-900/50 border border-yellow-200 dark:border-yellow-800 rounded-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
            Selecione um Hotel
          </h2>
          <p className="text-yellow-600 dark:text-yellow-300">
            Por favor, selecione um hotel para visualizar os dados financeiros.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-lg p-8">
          <div className="flex items-center">
            <AlertTriangle className="h-6 w-6 text-red-500 mr-3" />
            <h2 className="text-lg font-medium text-red-800 dark:text-red-200">
              Erro ao carregar dados
            </h2>
          </div>
          <p className="mt-2 text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-md hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white flex items-center">
          <DollarSign className="h-8 w-8 text-blue-600 dark:text-blue-400 mr-3" />
          Controle Financeiro
        </h1>
        <div className="flex items-center space-x-4 mt-4 md:mt-0">
          <button
            onClick={() => setShowPaymentForm(true)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5 mr-2" />
            Novo Pagamento
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Filter className="w-5 h-5 mr-2" />
            Filtros
            {showFilters ? (
              <ChevronUp className="w-5 h-5 ml-2" />
            ) : (
              <ChevronDown className="w-5 h-5 ml-2" />
            )}
          </button>
          <button
            onClick={exportFinancialReport}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
          >
            <Download className="w-5 h-5 mr-2" />
            Exportar
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Data Inicial
              </label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Hotel
              </label>
              <select
                value={selectedHotelFilter}
                onChange={(e) => setSelectedHotelFilter(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="">Todos os Hotéis</option>
                {hotels.map((hotel) => (
                  <option key={hotel.id} value={hotel.id}>
                    {hotel.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Saldo Total</p>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                R$ {totalBalance.toFixed(2)}
              </h3>
            </div>
            <div className="bg-blue-100 dark:bg-blue-900/20 p-3 rounded-lg">
              <DollarSign className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Pagamentos no Período</p>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                R$ {getTotalPayments().toFixed(2)}
              </h3>
            </div>
            <div className="bg-green-100 dark:bg-green-900/20 p-3 rounded-lg">
              <ArrowLeftRight className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Período</p>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                {format(new Date(dateRange.start), 'dd/MM/yyyy')} - {format(new Date(dateRange.end), 'dd/MM/yyyy')}
              </h3>
            </div>
            <div className="bg-purple-100 dark:bg-purple-900/20 p-3 rounded-lg">
              <Calendar className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden mb-8">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
            Movimentações do Período
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Data
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Tipo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Valor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Motivo
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Saldo
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredBalances.map((balance) => (
                <tr key={balance.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                    {format(new Date(balance.created_at), 'dd/MM/yyyy HH:mm')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      balance.transaction_type === 'credit'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    }`}>
                      {balance.transaction_type === 'credit' ? 'Crédito' : 'Débito'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                    R$ {balance.amount.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-200">
                    {balance.reason}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900 dark:text-gray-200">
                    R$ {balance.balance.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Form Modal */}
      {showPaymentForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Novo Pagamento
              </h2>
              <button
                onClick={() => setShowPaymentForm(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddPayment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Valor
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500 dark:text-gray-400">
                    R$
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={newPayment.amount}
                    onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })}
                    className="w-full pl-8 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Motivo
                </label>
                <input
                  type="text"
                  value={newPayment.reason}
                  onChange={(e) => setNewPayment({ ...newPayment, reason: e.target.value })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                  placeholder="Ex: Pagamento de boleto"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Observações (opcional)
                </label>
                <textarea
                  value={newPayment.notes}
                  onChange={(e) => setNewPayment({ ...newPayment, notes: e.target.value })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  rows={3}
                />
              </div>

              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowPaymentForm(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialManagement;