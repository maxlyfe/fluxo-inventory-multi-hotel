import React, { useState, useEffect } from 'react';
import { Request } from '../pages/AdminPanel';
import { Check, X, ArrowLeftRight, ImageIcon, Calendar, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface RequestItemProps {
  request: Request;
  onTriggerDeliver?: (request: Request) => void;
  onTriggerReject?: (request: Request) => void;
  onTriggerSubstitute?: (request: Request) => void;
  isHistoryView?: boolean;
}

const RequestItem: React.FC<RequestItemProps> = ({ 
  request, 
  onTriggerDeliver, 
  onTriggerReject, 
  onTriggerSubstitute,
  isHistoryView = false 
}) => {
  const { selectedHotel } = useHotel();
  const [currentStock, setCurrentStock] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const product = request.products;
  const substitutedProduct = request.substituted_product;
  const isSubstituted = !!substitutedProduct;
  const displayProduct = substitutedProduct || product;
  const productId = displayProduct?.id;
  const displayProductName = isHistoryView && isSubstituted 
    ? substitutedProduct?.name || request.item_name 
    : request.item_name;

  const formatDate = (dateString: string) => {
    try {
      const date = parseISO(dateString);
      return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    } catch (error) {
      return 'Data inválida';
    }
  };

  // SINCRONIZAÇÃO GLOBAL SIMPLIFICADA
  useEffect(() => {
    if (!selectedHotel?.id || !productId || isHistoryView) return;

    const channelName = `global-stock-sync-${selectedHotel.id}`;
    const channel = supabase.channel(channelName)
      .on('broadcast', { event: 'stock_updated' }, (payload) => {
        if (payload.payload.productId === productId) {
          console.log(`Sincronizando ${displayProductName}: Novo estoque ${payload.payload.newQuantity}`);
          setCurrentStock(payload.payload.newQuantity);
        }
      })
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'products', 
        filter: `id=eq.${productId}` 
      }, (payload) => {
        console.log(`Banco atualizou ${displayProductName}: ${payload.new.quantity}`);
        setCurrentStock(payload.new.quantity);
      })
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedHotel?.id, productId, isHistoryView, displayProductName]);

  // BUSCA INICIAL
  useEffect(() => {
    if (!productId || isHistoryView) return;

    const fetchStock = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('products')
        .select('quantity')
        .eq('id', productId)
        .single();
      
      if (data) setCurrentStock(data.quantity);
      setLoading(false);
    };

    fetchStock();
  }, [productId, isHistoryView]);

  const calculatePendingTime = (createdAt: string): string => {
    try {
      const createdDate = parseISO(createdAt);
      const now = new Date();
      const diffInMinutes = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60));
      if (diffInMinutes < 60) return `${diffInMinutes} min`;
      if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h`;
      return `${Math.floor(diffInMinutes / 1440)}d`;
    } catch (error) {
      return '...';
    }
  };

  return (
    <li className="border-b dark:border-gray-700 py-3 px-4 flex flex-col md:flex-row md:items-start md:justify-between space-y-3 md:space-y-0 md:space-x-4">
      <div className="flex items-center flex-grow min-w-0">
        {displayProduct?.image_url ? (
          <img src={displayProduct.image_url} alt={displayProductName} className="w-12 h-12 object-cover rounded mr-4 flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 bg-gray-200 dark:bg-gray-600 rounded mr-4 flex items-center justify-center flex-shrink-0">
            <ImageIcon className="w-6 h-6 text-gray-400 dark:text-gray-500" />
          </div>
        )}
        <div className="flex-grow min-w-0">
          <span className="font-medium text-gray-800 dark:text-white break-words block">
            {displayProductName}
          </span>
          
          {isSubstituted && (
            <div className="text-xs text-orange-500 mt-1">
              {isHistoryView ? `✓ Original: ${request.item_name}` : `⚠ Substituir por: ${substitutedProduct?.name}`}
            </div>
          )}
          
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Qtd: {request.quantity}
            {request.delivered_quantity && <span className="text-green-600 ml-2">(Entregue: {request.delivered_quantity})</span>}
          </div>
          
          {!isHistoryView && (
            <div className="text-xs font-bold text-blue-600 dark:text-blue-400 mt-1">
              Estoque Atual: {loading ? '...' : currentStock !== null ? currentStock : 'N/A'}
            </div>
          )}
          
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400">
            <div className="flex items-center"><Calendar className="w-3 h-3 mr-1" /> {formatDate(request.created_at)}</div>
            {!isHistoryView && <div className="flex items-center text-orange-500"><Clock className="w-3 h-3 mr-1" /> Há {calculatePendingTime(request.created_at)}</div>}
            <div className="text-blue-500">Setor: {request.sector?.name}</div>
          </div>
        </div>
      </div>

      {!isHistoryView && (
        <div className="flex space-x-2 flex-shrink-0">
          <button onClick={() => onTriggerDeliver?.(request)} className="p-2 bg-green-100 text-green-700 rounded-md hover:bg-green-200"><Check className="w-4 h-4" /></button>
          <button onClick={() => onTriggerReject?.(request)} className="p-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200"><X className="w-4 h-4" /></button>
          <button onClick={() => onTriggerSubstitute?.(request)} className="p-2 bg-orange-100 text-orange-700 rounded-md hover:bg-orange-200"><ArrowLeftRight className="w-4 h-4" /></button>
        </div>
      )}

      {isHistoryView && (
        <div className="flex-shrink-0 text-sm font-medium">
          {request.status === 'delivered' ? <span className="text-green-600">Entregue</span> : <span className="text-red-600">Rejeitado</span>}
        </div>
      )}
    </li>
  );
};

export default RequestItem;
