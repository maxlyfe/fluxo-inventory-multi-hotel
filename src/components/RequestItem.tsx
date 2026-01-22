import React from 'react';
import { Request } from '../pages/AdminPanel';
import { Check, X, ArrowLeftRight, ImageIcon, Calendar, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface RequestItemProps {
  request: Request;
  currentStock?: number | null; 
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
    <li className="border-b border-gray-100 dark:border-gray-700/50 py-4 px-4 flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 md:space-x-6 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
      <div className="flex items-center flex-grow min-w-0">
        <div className="relative flex-shrink-0">
          {displayProduct?.image_url ? (
            <img 
              src={displayProduct.image_url} 
              alt={displayProductName} 
              className="w-14 h-14 object-contain bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-1" 
              onError={(e) => {
                (e.target as any).src = '';
                (e.target as any).style.display = 'none';
                (e.target as any).nextSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <div className={`w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center ${displayProduct?.image_url ? 'hidden' : 'flex'}`}>
            <ImageIcon className="w-7 h-7 text-gray-400 dark:text-gray-500" />
          </div>
          {isSubstituted && !isHistoryView && (
            <div className="absolute -top-2 -right-2 bg-orange-500 text-white p-1 rounded-full shadow-sm">
              <ArrowLeftRight className="w-3 h-3" />
            </div>
          )}
        </div>

        <div className="ml-4 flex-grow min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <span className="font-bold text-gray-900 dark:text-white text-base truncate">
              {displayProductName}
            </span>
            {request.is_custom && (
              <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-bold rounded-full uppercase tracking-wider">
                Personalizado
              </span>
            )}
          </div>
          
          {isSubstituted && (
            <div className="text-xs font-medium text-orange-600 dark:text-orange-400 mt-0.5 flex items-center">
              <ArrowLeftRight className="w-3 h-3 mr-1" />
              {isHistoryView ? `Original: ${request.item_name}` : `Substituir por: ${substitutedProduct?.name}`}
            </div>
          )}
          
          <div className="flex items-center flex-wrap gap-x-3 mt-1">
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Qtd: <span className="text-blue-600 dark:text-blue-400">{request.quantity}</span>
            </div>
            {request.delivered_quantity && (
              <div className="text-sm font-semibold text-green-600 dark:text-green-400">
                Entregue: {request.delivered_quantity}
              </div>
            )}
            {!isHistoryView && (
              <div className="text-xs font-bold px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded border border-blue-100 dark:border-blue-800/50">
                Estoque: {currentStock !== undefined && currentStock !== null ? currentStock : '...'}
              </div>
            )}
          </div>
          
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">
            <div className="flex items-center"><Calendar className="w-3 h-3 mr-1" /> {formatDate(request.created_at)}</div>
            {!isHistoryView && (
              <div className="flex items-center text-orange-600 dark:text-orange-400">
                <Clock className="w-3 h-3 mr-1" /> Há {calculatePendingTime(request.created_at)}
              </div>
            )}
          </div>
        </div>
      </div>

      {!isHistoryView && (
        <div className="flex items-center space-x-2 flex-shrink-0">
          <button 
            onClick={() => onTriggerDeliver?.(request)} 
            className="group flex items-center justify-center p-2.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-xl border border-green-200 dark:border-green-800/50 hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white transition-all duration-200 shadow-sm"
            title="Marcar como entregue"
          >
            <Check className="w-5 h-5" />
            <span className="max-w-0 overflow-hidden group-hover:max-w-xs group-hover:ml-2 transition-all duration-300 text-sm font-bold whitespace-nowrap">Entregar</span>
          </button>
          
          <button 
            onClick={() => onTriggerSubstitute?.(request)} 
            className="group flex items-center justify-center p-2.5 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 rounded-xl border border-orange-200 dark:border-orange-800/50 hover:bg-orange-500 hover:text-white dark:hover:bg-orange-500 dark:hover:text-white transition-all duration-200 shadow-sm"
            title="Substituir produto"
          >
            <ArrowLeftRight className="w-5 h-5" />
            <span className="max-w-0 overflow-hidden group-hover:max-w-xs group-hover:ml-2 transition-all duration-300 text-sm font-bold whitespace-nowrap">Substituir</span>
          </button>

          <button 
            onClick={() => onTriggerReject?.(request)} 
            className="group flex items-center justify-center p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-800/50 hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white transition-all duration-200 shadow-sm"
            title="Cancelar requisição"
          >
            <X className="w-5 h-5" />
            <span className="max-w-0 overflow-hidden group-hover:max-w-xs group-hover:ml-2 transition-all duration-300 text-sm font-bold whitespace-nowrap">Cancelar</span>
          </button>
        </div>
      )}

      {isHistoryView && (
        <div className="flex-shrink-0">
          {request.status === 'delivered' ? (
            <div className="flex items-center px-3 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full text-xs font-bold border border-green-200 dark:border-green-800">
              <Check className="w-3 h-3 mr-1" /> Entregue
            </div>
          ) : (
            <div className="flex items-center px-3 py-1 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-full text-xs font-bold border border-red-200 dark:border-red-800">
              <X className="w-3 h-3 mr-1" /> Rejeitado
            </div>
          )}
        </div>
      )}
    </li>
  );
};

export default RequestItem;
