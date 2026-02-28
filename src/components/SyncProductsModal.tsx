import React, { useState, useEffect, useMemo } from 'react';
import { X, RefreshCw, Loader2, Search, Package, ChevronLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';

// Interface para Hotel
interface Hotel {
  id: string;
  name: string;
}

// Interface para os dados do produto que precisamos para a sincronização
interface ProductToSync {
  id: string;
  name: string;
  category: string;
  supplier?: string;
  image_url?: string;
  description?: string;
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
  const { addNotification } = useNotification();

  const [step, setStep] = useState<'selectHotel' | 'selectProducts'>('selectHotel');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [sourceHotelId, setSourceHotelId] = useState('');
  
  const [productsToSync, setProductsToSync] = useState<ProductToSync[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchHotels = async () => {
      if (!selectedHotel) return;
      const { data } = await supabase
        .from('hotels')
        .select('id, name')
        .neq('id', selectedHotel.id)
        .order('name');
      setHotels(data || []);
    };
    fetchHotels();
  }, [selectedHotel]);

  const handleFindProducts = async () => {
    if (!sourceHotelId || !selectedHotel?.id) return;
    
    setLoading(true);
    setError(null);
    setProductsToSync([]);

    try {
      const { data: sourceProducts, error: sourceError } = await supabase
        .from('products')
        .select('id, name, category, supplier, image_url, description')
        .eq('hotel_id', sourceHotelId);
      if (sourceError) throw sourceError;
      if (!sourceProducts?.length) {
        throw new Error('Nenhum produto encontrado no hotel de origem para comparar.');
      }

      const { data: existingProducts, error: existingError } = await supabase
        .from('products')
        .select('name')
        .eq('hotel_id', selectedHotel.id);
      if (existingError) throw existingError;

      const existingNames = new Set(existingProducts?.map(p => p.name.trim().toLowerCase()) || []);
      const newProducts = sourceProducts.filter(p => !existingNames.has(p.name.trim().toLowerCase()));

      if (newProducts.length === 0) {
        setError('Todos os produtos do hotel de origem já existem no hotel atual.');
      } else {
        setProductsToSync(newProducts);
        setStep('selectProducts');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar produtos para sincronização');
    } finally {
      setLoading(false);
    }
  };
  
  const handleSyncSelected = async () => {
    if (selectedProducts.size === 0 || !selectedHotel?.id) return;

    setLoading(true);
    setError(null);

    try {
      const productsToInsert = productsToSync.filter(p => selectedProducts.has(p.id));
      const insertData = productsToInsert.map(product => ({
        name: product.name,
        category: product.category,
        supplier: product.supplier,
        image_url: product.image_url,
        description: product.description,
        hotel_id: selectedHotel.id,
        quantity: 0,
        min_quantity: 0,
        max_quantity: 100,
        is_active: true
      }));

      const { error: insertError } = await supabase
        .from('products')
        .insert(insertData);

      if (insertError) throw insertError;

      addNotification(`${insertData.length} produtos sincronizados com sucesso!`, 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao sincronizar produtos selecionados');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProduct = (productId: string) => {
    setSelectedProducts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  const filteredProductsToSync = useMemo(() => {
    return productsToSync.filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [productsToSync, searchTerm]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedProducts(new Set(filteredProductsToSync.map(p => p.id)));
    } else {
      setSelectedProducts(new Set());
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        {/* Cabeçalho Fixo */}
        <div className="flex-shrink-0 flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Sincronizar Produtos
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="flex-grow overflow-y-auto p-6 space-y-4">
          {step === 'selectHotel' && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Selecione o hotel de origem para buscar os produtos. Apenas itens que não existem no hotel atual (por nome) serão listados para importação.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sincronizar de:
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
            </>
          )}
          {step === 'selectProducts' && (
            <>
              <div className="flex items-center justify-between">
                <button onClick={() => { setStep('selectHotel'); setError(null); }} className="flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white">
                    <ChevronLeft className="h-4 w-4 mr-1"/> Voltar
                </button>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input type="text" placeholder="Filtrar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"/>
                </div>
              </div>
              <div className="border rounded-lg overflow-hidden divide-y dark:border-gray-600 dark:divide-gray-600">
                  <div className="p-3 bg-gray-50 dark:bg-gray-700/50">
                      <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-200">
                          <input type="checkbox" onChange={handleSelectAll} checked={filteredProductsToSync.length > 0 && selectedProducts.size === filteredProductsToSync.length} className="h-4 w-4 rounded text-blue-600 border-gray-300 dark:border-gray-500 focus:ring-blue-500 mr-3"/>
                          Selecionar Todos ({selectedProducts.size} / {filteredProductsToSync.length})
                      </label>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {filteredProductsToSync.map(product => (
                        <label key={product.id} className="flex items-center p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                            <input type="checkbox" checked={selectedProducts.has(product.id)} onChange={() => handleSelectProduct(product.id)} className="h-4 w-4 rounded text-blue-600 border-gray-300 dark:border-gray-500 focus:ring-blue-500 mr-3"/>
                            <div className="w-10 h-10 bg-gray-100 dark:bg-gray-600 rounded-md flex items-center justify-center mr-3 flex-shrink-0">
                                {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain"/> : <Package className="w-5 h-5 text-gray-400"/>}
                            </div>
                            <div className="flex-grow">
                                <p className="font-medium text-gray-800 dark:text-gray-100">{product.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{product.category}</p>
                            </div>
                        </label>
                    ))}
                  </div>
              </div>
            </>
          )}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-md p-3 text-sm text-red-800 dark:text-red-200">
              {error}
            </div>
          )}
        </div>

        {/* Rodapé Fixo com Botões */}
        <div className="flex-shrink-0 flex justify-end space-x-2 p-4 border-t border-gray-200 dark:border-gray-700">
          {step === 'selectHotel' && (
            <>
              <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700" disabled={loading}>
                Cancelar
              </button>
              <button onClick={handleFindProducts} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center space-x-2" disabled={loading || !sourceHotelId}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span>{loading ? 'A procurar...' : 'Procurar Produtos'}</span>
              </button>
            </>
          )}
          {step === 'selectProducts' && (
            <>
              <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700" disabled={loading}>
                Cancelar
              </button>
              <button onClick={handleSyncSelected} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled={loading || selectedProducts.size === 0}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                <span>{loading ? 'A sincronizar...' : `Sincronizar (${selectedProducts.size})`}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SyncProductsModal;
