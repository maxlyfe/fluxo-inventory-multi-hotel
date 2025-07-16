import React from 'react';
   import { format } from 'date-fns';
   import { ptBR } from 'date-fns/locale';

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

   interface BalanceHistoryProps {
     balances: Balance[];
   }

   const BalanceHistory: React.FC<BalanceHistoryProps> = ({ balances }) => {
     const formatCurrency = (value: number) => {
       return new Intl.NumberFormat('pt-BR', {
         style: 'currency',
         currency: 'BRL'
       }).format(value);
     };

     return (
       <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
         <div className="p-6 border-b border-gray-200 dark:border-gray-700">
           <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
             Histórico de Movimentações
           </h2>
         </div>
         
         <div className="overflow-x-auto">
           <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
             <thead className="bg-gray-50 dark:bg-gray-700">
               <tr>
                 <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                   Data
                 </th>
                 <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                   Descrição
                 </th>
                 <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                   Tipo
                 </th>
                 <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                   Valor
                 </th>
                 <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                   Saldo
                 </th>
               </tr>
             </thead>
             <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
               {balances.map((balance) => (
                 <tr key={balance.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                     {format(new Date(balance.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                   </td>
                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                     {balance.reason}
                   </td>
                   <td className="px-6 py-4 whitespace-nowrap text-sm">
                     <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                       balance.transaction_type === 'credit'
                         ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
                         : 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100'
                     }`}>
                       {balance.transaction_type === 'credit' ? 'Crédito' : 'Débito'}
                     </span>
                   </td>
                   <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                     <span className={balance.transaction_type === 'credit' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                       {balance.transaction_type === 'credit' ? '+' : '-'} {formatCurrency(balance.amount)}
                     </span>
                   </td>
                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200 text-right font-medium">
                     {formatCurrency(balance.balance)}
                   </td>
                 </tr>
               ))}
             </tbody>
           </table>
         </div>
       </div>
     );
   };

   export default React.memo(BalanceHistory);