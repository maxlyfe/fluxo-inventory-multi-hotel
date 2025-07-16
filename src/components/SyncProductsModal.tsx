import React, { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';

interface Hotel {
  id: string;
  name: string;
}

interface SyncProductsModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const SyncProductsModal: React.FC<SyncProductsModalProps> = ({
  onClose,
  onSuccess
}) => {
  const { selectedHotel } = useHotel();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceHotelId, setSourceHotelId] = useState('');

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

  const handleSync = async () => {
    if (!sourceHotelId || !selectedHotel?.id) return;
    
    setLoading(true);
    setError(null);

    try {
      // Get products from source hotel
      const { data: sourceProducts } = await supabase
        .from('products')
        .select('name, category, supplier, image_url, description')
        .eq('hotel_id', sourceHotelId);

      if (!sourceProducts?.length) {
        throw new Error('Nenhum produto encontrado no hotel de origem');
      }

      // Get existing products in destination hotel
      const { data: existingProducts } = await supabase
        .from('products')
        .select('name')
        .eq('hotel_id', selectedHotel.id);

      const existingNames = new Set(existingProducts?.map(p => p.name) || []);

      // Filter out products that already exist
      const newProducts = sourceProducts.filter(p => !existingNames.has(p.name));

      if (newProducts.length === 0) {
        throw new Error('Todos os produtos já existem no hotel atual');
      }

      // Insert new products
      const { error: insertError } = await supabase
        .from('products')
        .insert(
          newProducts.map(product => ({
            ...product,
            hotel_id: selectedHotel.id,
            quantity: 0
          }))
        );

      if (insertError) throw insertError;

      onSuccess();
      onClose();
      alert(`${newProducts.length} produtos sincronizados com sucesso!`);
    } catch (err) {
      console.error('Error syncing products:', err);
      setError(err.message || 'Erro ao sincronizar produtos');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Sincronizar Produtos
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Selecione o hotel de origem para sincronizar os produtos. Apenas produtos que não existem no hotel atual serão adicionados.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Hotel de Origem
            </label>
            <select
              value={sourceHotelId}
              onChange={(e) => setSourceHotelId(e.target.value)}
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
              onClick={handleSync}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center space-x-2"
              disabled={loading || !sourceHotelId}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Sincronizando...' : 'Sincronizar'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SyncProductsModal;