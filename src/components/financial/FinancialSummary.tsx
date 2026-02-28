import React from 'react';

   interface FinancialSummaryProps {
     totalBalance: number;
     periodPayments: number;
   }

   const FinancialSummary: React.FC<FinancialSummaryProps> = ({ 
     totalBalance, 
     periodPayments 
   }) => {
     const formatCurrency = (value: number) => {
       return new Intl.NumberFormat('pt-BR', {
         style: 'currency',
         currency: 'BRL'
       }).format(value);
     };

     return (
       <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
         <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
           <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
             Saldo Total
           </h2>
           <p className="text-3xl font-bold text-gray-900 dark:text-white">
             {formatCurrency(totalBalance)}
           </p>
         </div>
         
         <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
           <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
             Pagamentos no Período
           </h2>
           <p className="text-3xl font-bold text-gray-900 dark:text-white">
             {formatCurrency(periodPayments)}
           </p>
         </div>
       </div>
     );
   };

   export default FinancialSummary;
   ```

2. **Refatorar a Página FinancialManagement**:
   - Atualize o arquivo `src/pages/FinancialManagement.tsx`:

   ```tsx
   import React, { useState, useEffect } from 'react';
   import { supabase } from '../lib/supabase';
   import { useHotel } from '../context/HotelContext';
   import { Download, Plus } from 'lucide-react';
   import { format, subDays } from 'date-fns';
   import { ptBR } from 'date-fns/locale';
   import * as XLSX from 'xlsx';

   // Importar os novos componentes
   import PaymentForm from '../components/financial/PaymentForm';
   import BalanceHistory from '../components/financial/BalanceHistory';
   import FinancialSummary from '../components/financial/FinancialSummary';

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

   const FinancialManagement = () => {
     const { selectedHotel } = useHotel();
     const [balances, setBalances] = useState<Balance[]>([]);
     const [loading, setLoading] = useState(true);
     const [error, setError] = useState<string | null>(null);
     const [showPaymentForm, setShowPaymentForm] = useState(false);
     const [dateRange, setDateRange] = useState({
       start: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
       end: format(new Date(), 'yyyy-MM-dd')
     });

     // Valores calculados
     const totalBalance = balances.length > 0 ? balances[0].balance : 0;
     const periodPayments = balances
       .filter(b => b.transaction_type === 'credit' && b.reference_type === 'payment')
       .reduce((sum, b) => sum + b.amount, 0);

     useEffect(() => {
       if (selectedHotel?.id) {
         fetchData();
       }
     }, [selectedHotel, dateRange]);

     const fetchData = async () => {
       try {
         setLoading(true);
         setError(null);

         const { data, error } = await supabase
           .from('hotel_balances')
           .select('*')
           .eq('hotel_id', selectedHotel?.id)
           .gte('created_at', `${dateRange.start}T00:00:00`)
           .lte('created_at', `${dateRange.end}T23:59:59`)
           .order('created_at', { ascending: false });

         if (error) throw error;
         setBalances(data || []);
       } catch (err) {
         console.error('Error fetching balances:', err);
         setError('Erro ao carregar dados financeiros');
       } finally {
         setLoading(false);
       }
     };

     const handleExportExcel = () => {
       try {
         const worksheet = XLSX.utils.json_to_sheet(
           balances.map(b => ({
             Data: format(new Date(b.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }),
             Descrição: b.reason,
             Tipo: b.transaction_type === 'credit' ? 'Crédito' : 'Débito',
             Valor: b.amount,
             Saldo: b.balance
           }))
         );

         const workbook = XLSX.utils.book_new();
         XLSX.utils.book_append_sheet(workbook, worksheet, 'Financeiro');
         
         XLSX.writeFile(workbook, `Financeiro_${selectedHotel?.name}_${format(new Date(), 'dd-MM-yyyy')}.xlsx`);
       } catch (err) {
         console.error('Error exporting to Excel:', err);
         setError('Erro ao exportar para Excel');
       }
     };

     if (loading && balances.length === 0) {
       return (
         <div className="flex justify-center items-center min-h-screen">
           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
         </div>
       );
     }

     return (
       <div>
         <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
           <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-4 md:mb-0">
             Gerenciamento Financeiro
           </h1>
           
           <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
             <div className="flex items-center space-x-2">
               <label className="text-sm text-gray-600 dark:text-gray-300">De:</label>
               <input
                 type="date"
                 value={dateRange.start}
                 onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                 className="form-input py-1 px-2 text-sm"
               />
             </div>
             
             <div className="flex items-center space-x-2">
               <label className="text-sm text-gray-600 dark:text-gray-300">Até:</label>
               <input
                 type="date"
                 value={dateRange.end}
                 onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                 className="form-input py-1 px-2 text-sm"
               />
             </div>
             
             <button
               onClick={handleExportExcel}
               className="button-secondary flex items-center justify-center"
               title="Exportar para Excel"
             >
               <Download className="h-4 w-4 mr-1" />
               Exportar
             </button>
             
             <button
               onClick={() => setShowPaymentForm(true)}
               className="button-primary flex items-center justify-center"
             >
               <Plus className="h-4 w-4 mr-1" />
               Novo Pagamento
             </button>
           </div>
         </div>

         {error && (
           <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
             {error}
           </div>
         )}

         <FinancialSummary 
           totalBalance={totalBalance} 
           periodPayments={periodPayments} 
         />

         {showPaymentForm ? (
           <PaymentForm 
             hotelId={selectedHotel?.id || ''} 
             onSuccess={() => {
               setShowPaymentForm(false);
               fetchData();
             }}
             onCancel={() => setShowPaymentForm(false)}
           />
         ) : (
           <BalanceHistory balances={balances} />
         )}
       </div>
     );
   };

   export default FinancialManagement;