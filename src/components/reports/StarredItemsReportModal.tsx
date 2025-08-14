import React from 'react';
import { Star, ImageIcon, DollarSign, Package } from 'lucide-react';
import Modal from '../Modal'; // Reutiliza o componente de modal base
import { StarredItemReportData } from '../../lib/reportsService'; // Importa a interface de dados
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface StarredItemsReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportData: StarredItemReportData[]; // Recebe os dados do relatório
  loading: boolean;
}

/**
 * Componente Modal para exibir um relatório resumido dos produtos marcados como "Principais".
 */
const StarredItemsReportModal: React.FC<StarredItemsReportModalProps> = ({ isOpen, onClose, reportData, loading }) => {
  
  /**
   * Formata um valor numérico para o padrão de moeda brasileiro (BRL).
   * @param value O número a ser formatado.
   * @returns A string formatada, ex: "R$ 1.234,56".
   */
  const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  // Calcula o valor total de todos os itens principais em estoque.
  const totalStockValue = reportData.reduce((sum, item) => sum + item.total_value, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Relatório de Itens Principais">
      <div className="space-y-4 max-h-[70vh] flex flex-col">
        {loading ? (
          <div className="text-center py-8">Carregando...</div>
        ) : reportData.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Star className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p>Nenhum item foi marcado como principal.</p>
            <p className="text-sm mt-1">Vá para a página de Inventário e clique na estrela de um produto para adicioná-lo aqui.</p>
          </div>
        ) : (
          <>
            {/* Corpo do modal com a lista de itens */}
            <div className="overflow-y-auto pr-2 flex-grow">
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {reportData.map((item) => (
                  <li key={item.id} className="py-3 grid grid-cols-3 gap-4 items-center">
                    {/* Coluna 1: Imagem e Nome */}
                    <div className="col-span-1 flex items-center space-x-3">
                      <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.name} className="w-full h-full object-contain rounded-lg" />
                        ) : (
                          <ImageIcon className="w-6 h-6 text-gray-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white truncate" title={item.name}>{item.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{item.category}</p>
                      </div>
                    </div>
                    {/* Coluna 2: Estoque e Valor */}
                    <div className="col-span-1 text-center">
                      <p className={`text-lg font-bold ${item.quantity <= item.min_quantity ? 'text-red-500' : 'text-gray-800 dark:text-white'}`}>
                        {item.quantity}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">em estoque</p>
                      <p className="text-sm font-medium text-green-600 dark:text-green-400 mt-1">{formatCurrency(item.total_value)}</p>
                    </div>
                    {/* Coluna 3: Última Compra */}
                    <div className="col-span-1 text-right text-sm">
                      <p className="text-gray-600 dark:text-gray-300">Última Compra:</p>
                      {item.last_purchase_date ? (
                        <>
                          <p className="font-semibold text-gray-800 dark:text-white">{format(new Date(item.last_purchase_date), 'dd/MM/yyyy', { locale: ptBR })}</p>
                          <p className="text-gray-500 dark:text-gray-400">{formatCurrency(item.last_purchase_price || 0)}</p>
                        </>
                      ) : (
                        <p className="text-gray-500 dark:text-gray-400 text-xs">Sem registro</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {/* Rodapé do modal com o valor total */}
            <div className="flex-shrink-0 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-end items-center">
                <span className="text-lg font-semibold text-gray-800 dark:text-white">Valor Total em Estoque:</span>
                <span className="text-xl font-bold text-blue-600 dark:text-blue-400 ml-3">{formatCurrency(totalStockValue)}</span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default StarredItemsReportModal;
