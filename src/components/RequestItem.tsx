import React from 'react';
import { Request } from '../pages/AdminPanel';
import { Check, X, ArrowLeftRight, ImageIcon, Calendar, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface RequestItemProps {
  request: Request;
  currentStock?: number | null; // Recebe o estoque centralizado do AdminPanel
  onTriggerDeliver?: (request: Request) => void;
  onTriggerReject?: (request: Request) => void;
  onTriggerSubstitute?: (request: Request) => void;
  isHistoryView?: boolean;
}

const RequestItem: React.FC<RequestItemProps> = ({ 
  request, 
  currentStock,
  onTriggerDeliver, 
  onTriggerReject, 
  onTriggerSubstitute,
  isHistoryView = false 
}) => {
  const product = request.products;
  const substitutedProduct = request.substituted_product;
  const isSubstituted = !!substitutedProduct;
  const displayProduct = substitutedProduct || product;
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
              Estoque Atual: {currentStock !== undefined && currentStock !== null ? currentStock : '...'}
            </div>
          )}
          
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400">
            <div className="flex items-center"><Calendar className="w-3.5 h-3.5 mr-1" /> {formatDate(request.created_at)}</div>
            {!isHistoryView && <div className="flex items-center text-orange-500"><Clock className="w-3.5 h-3.5 mr-1" /> Há {calculatePendingTime(request.created_at)}</div>}
            <div className="text-blue-500">Setor: {request.sector?.name}</div>
          </div>
        </div>
      </div>

      {!isHistoryView && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Botão Entregar - Verde Esmeralda */}
          <button 
            onClick={() => onTriggerDeliver?.(request)} 
            title="Marcar como entregue"
            className="flex items-center justify-center p-2.5 bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white rounded-lg shadow-sm transition-all active:scale-95"
          >
            <Check className="w-5 h-5" />
          </button>

          {/* Botão Substituir - Âmbar/Laranja */}
          <button 
            onClick={() => onTriggerSubstitute?.(request)} 
            title="Entregar outro produto no lugar"
            className="flex items-center justify-center p-2.5 bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700 text-white rounded-lg shadow-sm transition-all active:scale-95"
          >
            <ArrowLeftRight className="w-5 h-5" />
          </button>

          {/* Botão Cancelar - Rosa/Vermelho */}
          <button 
            onClick={() => onTriggerReject?.(request)} 
            title="Cancelar requisição"
            className="flex items-center justify-center p-2.5 bg-rose-500 hover:bg-rose-600 dark:bg-rose-600 dark:hover:bg-rose-700 text-white rounded-lg shadow-sm transition-all active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {isHistoryView && (
        <div className="flex-shrink-0 text-sm font-medium">
          {request.status === 'delivered' ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
              Entregue
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
              Rejeitado
            </span>
          )}
        </div>
      )}
    </li>
  );
};

export default RequestItem;
