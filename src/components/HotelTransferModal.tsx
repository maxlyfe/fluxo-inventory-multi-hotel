import React, { useState, useEffect } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';

interface Hotel {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  quantity: number;
  category: string;
  min_quantity: number;
  max_quantity: number;
  supplier?: string;
  image_url?: string;
  description?: string;
  average_price?: number;
  last_purchase_price?: number;
}

interface HotelTransferModalProps {
  onClose: () => void;
  onSuccess: () => void;
  products: Product[];
}

const HotelTransferModal: React.FC<HotelTransferModalProps> = ({
  onClose,
  onSuccess,
  products
}) => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [transferData, setTransferData] = useState({
    destinationHotelId: '',
    productId: '',
    quantity: 1,
    notes: ''
  });

  useEffect(() => {
    const fetchHotels = async () => {
      const { data } = await supabase
        .from('hotels')
        .select('id, name')
        .neq('id', selectedHotel?.id)
        .order('name');
      
      setHotels(data || []);
    };

    fetchHotels();
  }, [selectedHotel]);

  // Função para atualizar o saldo financeiro quando produtos são transferidos
  const updateFinancialBalance = async (productId: string, quantity: number, unitValue: number) => {
    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel de origem não selecionado');
      }

      const totalValue = unitValue * quantity;
      
      if (totalValue <= 0) {
        console.log('Valor zero ou negativo, não será registrado no financeiro');
        return;
      }

      // Registrar débito no hotel de origem
      const { error: sourceError } = await supabase.rpc('update_hotel_balance', {
        p_hotel_id: selectedHotel.id,
        p_transaction_type: 'debit',
        p_amount: totalValue,
        p_reason: `Transferência de ${quantity} unidades de produto para outro hotel`,
        p_reference_type: 'transfer',
        p_reference_id: productId
      });

      if (sourceError) throw sourceError;

      // Registrar crédito no hotel de destino
      const { error: destError } = await supabase.rpc('update_hotel_balance', {
        p_hotel_id: transferData.destinationHotelId,
        p_transaction_type: 'credit',
        p_amount: totalValue,
        p_reason: `Recebimento de ${quantity} unidades de produto de outro hotel`,
        p_reference_type: 'transfer',
        p_reference_id: productId
      });

      if (destError) throw destError;

      console.log(`Saldo financeiro atualizado: Hotel origem -R$ ${totalValue.toFixed(2)}, Hotel destino +R$ ${totalValue.toFixed(2)}`);
      return true;
    } catch (err) {
      console.error('Erro ao atualizar saldo financeiro:', err);
      addNotification(`Erro ao atualizar saldo financeiro: ${err.message}`, 'error');
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel de origem não selecionado');
      }

      // Validate quantity and get product details
      const product = products.find(p => p.id === transferData.productId);
      if (!product) {
        throw new Error('Produto não encontrado');
      }

      if (transferData.quantity > product.quantity) {
        throw new Error(`Quantidade insuficiente em estoque. Disponível: ${product.quantity}`);
      }

      // Calculate transfer value based on average price or last purchase price
      const unitValue = product.average_price || product.last_purchase_price || 0;

      // Create transfer record with value information
      const { error: transferError } = await supabase
        .from('hotel_transfers')
        .insert({
          source_hotel_id: selectedHotel.id,
          destination_hotel_id: transferData.destinationHotelId,
          product_id: transferData.productId,
          quantity: transferData.quantity,
          unit_value: unitValue,
          notes: transferData.notes,
          status: 'pending'
        });

      if (transferError) throw transferError;

      // Update source product quantity immediately
      const { error: updateError } = await supabase
        .from('products')
        .update({ 
          quantity: product.quantity - transferData.quantity,
          updated_at: new Date().toISOString()
        })
        .eq('id', product.id)
        .eq('hotel_id', selectedHotel.id);

      if (updateError) throw updateError;

      // Check if product exists in destination hotel
      const { data: existingProduct } = await supabase
        .from('products')
        .select('id, quantity')
        .eq('name', product.name)
        .eq('hotel_id', transferData.destinationHotelId)
        .single();

      if (existingProduct) {
        // Update existing product in destination hotel
        const { error: destUpdateError } = await supabase
          .from('products')
          .update({ 
            quantity: existingProduct.quantity + transferData.quantity,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingProduct.id)
          .eq('hotel_id', transferData.destinationHotelId);

        if (destUpdateError) throw destUpdateError;
      } else {
        // Create new product in destination hotel
        const { error: createError } = await supabase
          .from('products')
          .insert({
            name: product.name,
            category: product.category,
            quantity: transferData.quantity,
            min_quantity: product.min_quantity,
            max_quantity: product.max_quantity,
            supplier: product.supplier,
            image_url: product.image_url,
            description: product.description,
            average_price: unitValue,
            last_purchase_price: unitValue,
            hotel_id: transferData.destinationHotelId,
            is_active: true
          });

        if (createError) throw createError;
      }

      // Atualizar o saldo financeiro para ambos os hotéis
      await updateFinancialBalance(product.id, transferData.quantity, unitValue);

      addNotification('Transferência realizada com sucesso!', 'success');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error creating transfer:', err);
      setError(err.message || 'Erro ao criar transferência');
      addNotification(err.message || 'Erro ao criar transferência', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getAvailableQuantity = (productId: string) => {
    const product = products.find(p => p.id === productId);
    return product?.quantity || 0;
  };

  const getSelectedProduct = () => {
    return products.find(p => p.id === transferData.productId);
  };

  const calculateTransferValue = () => {
    const product = getSelectedProduct();
    if (!product) return 0;
    const unitValue = product.average_price || product.last_purchase_price || 0;
    return unitValue * transferData.quantity;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Transferir Item
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Hotel Destino
            </label>
            <select
              value={transferData.destinationHotelId}
              onChange={(e) => setTransferData({ ...transferData, destinationHotelId: e.target.value })}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            >
              <option value="">Selecione um hotel</option>
              {hotels.map((hotel) => (
                <option key={hotel.id} value={hotel.id}>
                  {hotel.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Item
            </label>
            <select
              value={transferData.productId}
              onChange={(e) => setTransferData({ ...transferData, productId: e.target.value })}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            >
              <option value="">Selecione um item</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} (Disponível: {product.quantity})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Quantidade
            </label>
            <input
              type="number"
              min="1"
              max={getAvailableQuantity(transferData.productId)}
              value={transferData.quantity}
              onChange={(e) => setTransferData({ ...transferData, quantity: parseInt(e.target.value) })}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>

          {transferData.productId && (
            <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Informações da Transferência
              </h3>
              <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <p>
                  Valor Unitário: R$ {(getSelectedProduct()?.average_price || getSelectedProduct()?.last_purchase_price || 0).toFixed(2)}
                </p>
                <p>
                  Valor Total: R$ {calculateTransferValue().toFixed(2)}
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Observações
            </label>
            <textarea
              value={transferData.notes}
              onChange={(e) => setTransferData({ ...transferData, notes: e.target.value })}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
              rows={3}
            />
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-md p-4 text-sm text-red-800 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center space-x-2"
              disabled={loading}
            >
              <span>{loading ? 'Enviando...' : 'Transferir'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default HotelTransferModal;
