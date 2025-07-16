import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useNotification } from '../../context/NotificationContext';
import LoadingIndicator from '../ui/LoadingIndicator';



   interface PaymentFormProps {
     hotelId: string;
     onSuccess: () => void;
     onCancel: () => void;
   }

   interface NewPayment {
     amount: string;
     reason: string;
     notes: string;
   }

   const PaymentForm: React.FC<PaymentFormProps> = ({ hotelId, onSuccess, onCancel }) => {
     const [newPayment, setNewPayment] = useState<NewPayment>({
       amount: '',
       reason: '',
       notes: ''
     });
     const [loading, setLoading] = useState(false);
     const { addNotification } = useNotification();
     const [error, setError] = useState<string | null>(null);

     const handleSubmit = async (e: React.FormEvent) => {
       e.preventDefault();
       setError(null);

       try {
         if (!hotelId) {
           throw new Error('Hotel não selecionado');
         }

         const amount = parseFloat(newPayment.amount);
         if (isNaN(amount) || amount <= 0) {
           throw new Error('Valor inválido');
         }

         // Call RPC function to record payment
         const { error: rpcError } = await supabase.rpc('update_hotel_balance', {
           p_hotel_id: hotelId,
           p_transaction_type: 'credit',
           p_amount: amount,
           p_reason: newPayment.reason,
           p_reference_type: 'payment',
           p_reference_id: crypto.randomUUID()
         });

         if (rpcError) throw rpcError;

         addNotification('success', 'Pagamento adicionado com sucesso');
         onSuccess();
       } catch (err) {
         console.error('Error adding payment:', err);
         setError('Erro ao adicionar pagamento: ' + (err.message || err));
       }finally {
         setLoading(false);
       }
     };

     return (
       <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
         <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
           Novo Pagamento
         </h2>
         
         {error && (
           <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg">
             {error}
           </div>
         )}
         
         <form onSubmit={handleSubmit} className="space-y-4">
           <div>
             <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
               Valor
             </label>
             <input
               type="number"
               step="0.01"
               value={newPayment.amount}
               onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })}
               className="form-input"
               required
             />
           </div>
           
           <div>
             <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
               Descrição
             </label>
             <input
               type="text"
               value={newPayment.reason}
               onChange={(e) => setNewPayment({ ...newPayment, reason: e.target.value })}
               className="form-input"
               required
             />
           </div>
           
           <div>
             <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
               Observações (opcional)
             </label>
             <textarea
               value={newPayment.notes}
               onChange={(e) => setNewPayment({ ...newPayment, notes: e.target.value })}
               className="form-input"
               rows={3}
             />
           </div>
           
          <div className="flex justify-end space-x-2">
             <button
               type="button"
               onClick={onCancel}
               className="button-secondary"
               disabled={loading}
             >
               Cancelar
             </button>
             <button
               type="submit"
               className="button-primary"
               disabled={loading}
             >
               {loading ? (
                 <span className="flex items-center">
                   <LoadingIndicator size="small" />
                   <span className="ml-2">Processando...</span>
                 </span>
               ) : (
                 'Adicionar Pagamento'
               )}
             </button>
           </div>
         </form>
       </div>
     );
   };

   export default PaymentForm;