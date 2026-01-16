import React, { useState, useEffect } from 'react';
import { Request } from '../pages/AdminPanel'; // Assuming types are exported
import { Check, X, ArrowLeftRight, ImageIcon, Calendar, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { format, parseISO } from 'date-fns'; // *** IMPORTAR date-fns ***
import { ptBR } from 'date-fns/locale'; // *** IMPORTAR locale brasileiro ***

interface RequestItemProps {
  request: Request;
  onTriggerDeliver?: (request: Request) => void;
  onTriggerReject?: (request: Request) => void;
  onTriggerSubstitute?: (request: Request) => void;
  isHistoryView?: boolean; // *** NOVA PROP para identificar se é visualização de histórico ***
}

const RequestItem: React.FC<RequestItemProps> = ({ 
  request, 
  onTriggerDeliver, 
  onTriggerReject, 
  onTriggerSubstitute,
  isHistoryView = false // *** PADRÃO false ***
}) => {
  const { selectedHotel } = useHotel();
  const [currentStock, setCurrentStock] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const product = request.products;
  const substitutedProduct = request.substituted_product;
  const isSubstituted = !!substitutedProduct;
  
  // *** CORREÇÃO: Lógica para exibir o produto correto ***
  const displayProduct = substitutedProduct || product;
  const productId = displayProduct?.id;
  
  // *** CORREÇÃO: Nome do produto a ser exibido ***
  const displayProductName = isHistoryView && isSubstituted 
    ? substitutedProduct?.name || request.item_name  // No histórico, mostra produto substituto
    : request.item_name; // Em pendentes, sempre mostra o solicitado

  // *** CORREÇÃO: Nome do produto para busca de estoque ***
  const stockSearchName = isSubstituted && substitutedProduct?.name 
    ? substitutedProduct.name 
    : request.item_name;

  // *** NOVA: Formatação de datas ***
  const formatDate = (dateString: string) => {
    try {
      const date = parseISO(dateString);
      return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    } catch (error) {
      console.error('Erro ao formatar data:', error);
      return 'Data inválida';
    }
  };

  // Fetch current stock for the selected hotel and subscribe to changes
  useEffect(() => {
    let isMounted = true;
    let productChannel: any = null;

    const fetchCurrentStock = async () => {
      if (!selectedHotel?.id || !stockSearchName) {
        if (isMounted) setCurrentStock(null);
        return;
      }

      if (isMounted) setLoading(true);
      try {
        // 1. Buscar o produto para obter o ID correto e a quantidade inicial
        const { data, error } = await supabase
          .from('products')
          .select('id, quantity')
          .eq('hotel_id', selectedHotel.id)
          .ilike('name', stockSearchName)
          .limit(1);

        if (error) throw error;

        let targetProductId = data && data.length > 0 ? data[0].id : null;
        let initialQuantity = data && data.length > 0 ? data[0].quantity : null;

        // 2. Se não encontrou por nome exato, tenta busca flexível
        if (!targetProductId) {
          const { data: fuzzyData } = await supabase
            .from('products')
            .select('id, quantity')
            .eq('hotel_id', selectedHotel.id)
            .ilike('name', `%${stockSearchName.split(' ')[0]}%`)
            .limit(1);
          
          if (fuzzyData && fuzzyData.length > 0) {
            targetProductId = fuzzyData[0].id;
            initialQuantity = fuzzyData[0].quantity;
          }
        }

        if (isMounted) {
          setCurrentStock(initialQuantity);
          setLoading(false);
        }

        // 3. Configurar Realtime: Escutar QUALQUER mudança na tabela products para este hotel
        // Isso é mais robusto do que filtrar por ID, pois garante que o componente reaja
        productChannel = supabase.channel(`request-item-stock-${request.id}`)
          .on(
            'postgres_changes',
            { 
              event: 'UPDATE', 
              schema: 'public', 
              table: 'products', 
              filter: `hotel_id=eq.${selectedHotel.id}` 
            },
            (payload) => {
              // Se a mudança foi no produto que este card representa, atualiza o estado
              if (targetProductId && payload.new.id === targetProductId) {
                if (isMounted) {
                  console.log(`Realtime: Estoque de ${stockSearchName} atualizado para ${payload.new.quantity}`);
                  setCurrentStock(payload.new.quantity);
                }
              }
            }
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              console.log(`Realtime: Inscrito para atualizações de estoque no hotel ${selectedHotel.id}`);
            }
          });

      } catch (err) {
        console.error('Error in fetchCurrentStock:', err);
        if (isMounted) {
          setCurrentStock(null);
          setLoading(false);
        }
      }
    };

    fetchCurrentStock();
    
    return () => {
      isMounted = false;
      if (productChannel) {
        supabase.removeChannel(productChannel);
      }
    };
  }, [stockSearchName, selectedHotel?.id, request.id]);

  // Handler functions to stop propagation
  const handleDeliverClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onTriggerDeliver?.(request);
  };

  const handleRejectClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onTriggerReject?.(request);
  };

  const handleSubstituteClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onTriggerSubstitute?.(request);
  };

  return (
    <li className="border-b dark:border-gray-700 py-3 px-4 flex flex-col md:flex-row md:items-start md:justify-between space-y-3 md:space-y-0 md:space-x-4">
      {/* Item Info */}
      <div className="flex items-center flex-grow min-w-0">
        {displayProduct?.image_url ? (
          <img src={displayProduct.image_url} alt={displayProductName} className="w-12 h-12 object-cover rounded mr-4 flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 bg-gray-200 dark:bg-gray-600 rounded mr-4 flex items-center justify-center flex-shrink-0">
            <ImageIcon className="w-6 h-6 text-gray-400 dark:text-gray-500" />
          </div>
        )}
        <div className="flex-grow min-w-0">
          {/* *** CORREÇÃO: Exibir nome correto do produto *** */}
          <span className="font-medium text-gray-800 dark:text-white break-words">
            {displayProductName}
          </span>
          
          {/* *** CORREÇÃO: Mostrar informação de substituição de forma mais clara *** */}
          {isSubstituted && (
            <div className="text-xs text-orange-500 mt-1">
              {isHistoryView ? (
                <span>✓ Produto substituto entregue (Original: {request.item_name})</span>
              ) : (
                <span>⚠ Produto será substituído por: {substitutedProduct?.name}</span>
              )}
            </div>
          )}
          
          <span className="text-sm text-gray-500 dark:text-gray-400 block">
            Qtd Solicitada: {request.quantity}
            {request.delivered_quantity && request.delivered_quantity !== request.quantity && (
              <span className="text-green-600 ml-2">
                (Entregue: {request.delivered_quantity})
              </span>
            )}
          </span>
          
          {/* *** CORREÇÃO: Mostrar estoque do produto correto *** */}
          {productId && !isHistoryView && (
            <span className="text-xs text-gray-400 dark:text-gray-500 block">
              Estoque Atual: {loading ? '...' : currentStock !== null ? currentStock : 'N/A'}
            </span>
          )}
          
          {/* *** NOVO: Mostrar setor da requisição *** */}
          <span className="text-xs text-blue-600 dark:text-blue-400 block">
            Setor: {request.sector?.name || 'N/A'}
          </span>

          {/* *** NOVA SEÇÃO: INFORMAÇÕES DE DATA *** */}
          <div className="mt-2 space-y-1">
            {/* *** DATA DO PEDIDO (sempre mostrar) *** */}
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
              <Calendar className="w-3 h-3 mr-1 flex-shrink-0" />
              <span>Pedido em: {formatDate(request.created_at)}</span>
            </div>

            {/* *** DATA DE ENTREGA (apenas no histórico e se foi entregue) *** */}
            {isHistoryView && request.status === 'delivered' && request.updated_at && (
              <div className="flex items-center text-xs text-green-600 dark:text-green-400">
                <Check className="w-3 h-3 mr-1 flex-shrink-0" />
                <span>Entregue em: {formatDate(request.updated_at)}</span>
              </div>
            )}

            {/* *** DATA DE REJEIÇÃO (apenas no histórico e se foi rejeitado) *** */}
            {isHistoryView && request.status === 'rejected' && request.updated_at && (
              <div className="flex items-center text-xs text-red-600 dark:text-red-400">
                <X className="w-3 h-3 mr-1 flex-shrink-0" />
                <span>Rejeitado em: {formatDate(request.updated_at)}</span>
              </div>
            )}

            {/* *** TEMPO PENDENTE (apenas em pendentes) *** */}
            {!isHistoryView && request.status === 'pending' && (
              <div className="flex items-center text-xs text-orange-500 dark:text-orange-400">
                <Clock className="w-3 h-3 mr-1 flex-shrink-0" />
                <span>Aguardando há: {calculatePendingTime(request.created_at)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Actions - Only show for pending requests */}
      {!isHistoryView && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end space-y-2 sm:space-y-0 sm:space-x-2 flex-shrink-0">
          {request.status === 'pending' && (
            <>
              {/* Delivery Button */}
              <button
                type="button"
                onClick={handleDeliverClick}
                className="p-1.5 bg-green-100 text-green-700 rounded-md hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 flex items-center justify-center sm:justify-start space-x-1"
                title="Atender"
              >
                <Check className="w-4 h-4" />
              </button>

              {/* Reject Button */}
              <button
                type="button"
                onClick={handleRejectClick}
                className="p-1.5 bg-red-100 text-red-700 rounded-md hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 flex items-center justify-center sm:justify-start space-x-1"
                title="Rejeitar"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Substitution Button */}
              <button
                type="button"
                onClick={handleSubstituteClick}
                className="p-1.5 bg-orange-100 text-orange-700 rounded-md hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50 flex items-center justify-center sm:justify-start space-x-1"
                title="Substituir Produto"
              >
                <ArrowLeftRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Status Display for History View */}
      {isHistoryView && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end space-y-2 sm:space-y-0 sm:space-x-2 flex-shrink-0">
          {request.status === 'delivered' && (
            <div className="text-sm text-green-600 dark:text-green-400 flex items-center">
              <Check className="w-4 h-4 mr-1" />
              Entregue ({request.delivered_quantity || request.quantity})
              {isSubstituted && <span className="text-xs ml-1">(Subst.)</span>}
            </div>
          )}
          {request.status === 'rejected' && (
            <div className="text-sm text-red-600 dark:text-red-400 flex items-center" title={`Motivo: ${request.rejection_reason}`}>
              <X className="w-4 h-4 mr-1" />
              Rejeitado
            </div>
          )}
        </div>
      )}
    </li>
  );
};

// *** NOVA FUNÇÃO: Calcular tempo pendente ***
const calculatePendingTime = (createdAt: string): string => {
  try {
    const createdDate = parseISO(createdAt);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 60) {
      return `${diffInMinutes} minuto${diffInMinutes !== 1 ? 's' : ''}`;
    } else if (diffInMinutes < 1440) { // 24 horas
      const hours = Math.floor(diffInMinutes / 60);
      return `${hours} hora${hours !== 1 ? 's' : ''}`;
    } else {
      const days = Math.floor(diffInMinutes / 1440);
      return `${days} dia${days !== 1 ? 's' : ''}`;
    }
  } catch (error) {
    console.error('Erro ao calcular tempo pendente:', error);
    return 'tempo indeterminado';
  }
};

export default RequestItem;
