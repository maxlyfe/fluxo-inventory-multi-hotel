import React, { useState, useEffect, useMemo } from 'react';
import Modal from './Modal';
import { supabase } from '../lib/supabase';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';
import { Loader2, Search, X, Package, Trash2, ArrowRight, DollarSign } from 'lucide-react';
import { transferMultipleProducts } from '../lib/transferService';

interface Product {
  id: string;
  name: string;
  quantity: number;
  image_url?: string;
  average_price?: number;
  is_active: boolean; // Adicionado para filtro
}

interface Hotel {
  id: string;
  name: string;
}

interface NewHotelTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  products: Product[];
}

const NewHotelTransferModal: React.FC<NewHotelTransferModalProps> = ({ isOpen, onClose, onSuccess, products }) => {
  const { addNotification } = useNotification();
  const { user } = useAuth();
  const { selectedHotel } = useHotel();
  
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [destinationHotelId, setDestinationHotelId] = useState<string>('');
  const [itemsToTransfer, setItemsToTransfer] = useState<{ product: Product, quantity: number }[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && selectedHotel) {
      const fetchHotels = async () => {
        const { data, error } = await supabase.from('hotels').select('id, name').neq('id', selectedHotel.id);
        if (error) { addNotification("Erro ao buscar hotéis.", 'error'); } 
        else { setHotels(data || []); }
      };
      fetchHotels();
    }
    if (!isOpen) {
        setDestinationHotelId('');
        setItemsToTransfer([]);
        setSearchTerm('');
    }
  }, [isOpen, selectedHotel, addNotification]);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    const transferIds = new Set(itemsToTransfer.map(item => item.product.id));
    return products
      .filter(p => p.is_active && !transferIds.has(p.id))
      .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [searchTerm, products, itemsToTransfer]);
  
  const totalTransferValue = useMemo(() => {
    return itemsToTransfer.reduce((total, item) => {
        const price = item.product.average_price || 0;
        return total + (price * item.quantity);
    }, 0);
  }, [itemsToTransfer]);

  const handleAddProduct = (product: Product) => {
    setItemsToTransfer(prev => [...prev, { product, quantity: 1 }]);
    setSearchTerm('');
  };

  const handleRemoveProduct = (productId: string) => {
    setItemsToTransfer(prev => prev.filter(item => item.product.id !== productId));
  };

  const handleQuantityChange = (productId: string, quantity: number) => {
    const productInStock = products.find(p => p.id === productId);
    const maxQuantity = productInStock?.quantity || 0;
    const newQuantity = Math.max(0, Math.min(quantity, maxQuantity));
    setItemsToTransfer(prev => prev.map(item => item.product.id === productId ? { ...item, quantity: newQuantity } : item));
  };
  
  const handleTransfer = async () => {
    console.log("[DEBUG] Clicou em 'Confirmar Transferência'");

    if (!destinationHotelId) {
      addNotification("Selecione um hotel de destino.", 'error');
      console.log("[DEBUG] Falha na validação: Hotel de destino não selecionado.");
      return;
    }
    if (itemsToTransfer.length === 0) {
      addNotification("Adicione pelo menos um item para transferir.", 'error');
      console.log("[DEBUG] Falha na validação: Nenhum item na lista.");
      return;
    }
    if (itemsToTransfer.some(item => item.quantity <= 0)) {
      addNotification("Todos os itens devem ter quantidade maior que zero.", 'error');
      console.log("[DEBUG] Falha na validação: Item com quantidade zero ou negativa.");
      return;
    }
    
    setIsLoading(true);
    
    const itemsPayload = itemsToTransfer.map(item => ({
      product_id: item.product.id,
      quantity: item.quantity
    }));

    console.log("[DEBUG] Enviando para o backend:", {
        sourceHotelId: selectedHotel!.id,
        destinationHotelId,
        itemsPayload
    });

    const result = await transferMultipleProducts(
      selectedHotel!.id,
      destinationHotelId,
      itemsPayload,
      user?.email || 'Sistema'
    );
    
    console.log("[DEBUG] Resultado recebido do backend:", result);
    
    if (result?.success) {
      addNotification("Transferência realizada com sucesso!", 'success');
      onSuccess();
    } else {
      addNotification(`Falha na transferência: ${result?.message || 'Erro desconhecido.'}`, 'error');
    }

    setIsLoading(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Transferir Itens entre Hotéis">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Transferir de <strong>{selectedHotel?.name}</strong> para:</label>
          <select value={destinationHotelId} onChange={e => setDestinationHotelId(e.target.value)} className="w-full px-3 py-2 mt-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600">
            <option value="">Selecione o hotel de destino...</option>
            {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div className="relative">
           <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Adicionar Itens</label>
           <div className="relative mt-1">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
             <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Digite para buscar um item..." className="w-full pl-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:border-gray-600" />
           </div>
           {searchTerm && (
             <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
               {filteredProducts.map(p => (
                 <div key={p.id} onClick={() => handleAddProduct(p)} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                   <img src={p.image_url || '/placeholder.png'} alt={p.name} className="w-8 h-8 rounded-md object-cover" onError={(e) => { e.currentTarget.src = '/placeholder.png'; }}/>
                   <div className="text-sm"> <p className="font-medium text-gray-800 dark:text-gray-200">{p.name}</p> <p className="text-xs text-gray-500">Estoque: {p.quantity}</p> </div>
                 </div>
               ))}
                {filteredProducts.length === 0 && <p className="p-3 text-sm text-center text-gray-500">Nenhum item encontrado.</p>}
             </div>
           )}
        </div>
        <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
            <h4 className="font-semibold text-gray-800 dark:text-gray-200">Itens na Lista ({itemsToTransfer.length})</h4>
            {itemsToTransfer.length === 0 ? (<p className="text-sm text-center text-gray-500 py-4">Nenhum item adicionado.</p>) : (
                itemsToTransfer.map(item => (
                    <div key={item.product.id} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <img src={item.product.image_url || '/placeholder.png'} alt={item.product.name} className="w-12 h-12 rounded-md object-cover flex-shrink-0" onError={(e) => { e.currentTarget.src = '/placeholder.png'; }}/>
                        <div className="flex-grow">
                            <p className="font-semibold text-gray-900 dark:text-white">{item.product.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Valor Unit.: {(item.product.average_price || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</p>
                            <p className="text-sm font-bold text-gray-800 dark:text-gray-200">Subtotal: {((item.product.average_price || 0) * item.quantity).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</p>
                        </div>
                        <input type="number" value={item.quantity} onChange={e => handleQuantityChange(item.product.id, parseInt(e.target.value))} max={item.product.quantity} min="1" className="w-20 p-1 text-center border rounded-md dark:bg-gray-800 dark:border-gray-600"/>
                        <button onClick={() => handleRemoveProduct(item.product.id)} className="p-1 text-red-500 hover:text-red-700 hover:bg-red-100 rounded-full"><Trash2 className="w-4 h-4"/></button>
                    </div>
                ))
            )}
        </div>
        {itemsToTransfer.length > 0 && (
            <div className="pt-4 border-t dark:border-gray-700 flex justify-end items-center gap-4">
                <span className="text-lg font-bold text-gray-800 dark:text-white">Valor Total da Transferência:</span>
                <span className="text-xl font-bold text-green-600 dark:text-green-400">{totalTransferValue.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
            </div>
        )}
        <div className="flex justify-end gap-4 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-600 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500">Cancelar</button>
          <button onClick={handleTransfer} disabled={isLoading} className="flex items-center justify-center px-4 py-2 text-white font-semibold rounded-lg shadow-md bg-orange-600 hover:bg-orange-700 disabled:opacity-50">
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin"/> : <ArrowRight className="w-5 h-5"/>} Confirmar Transferência
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default NewHotelTransferModal;