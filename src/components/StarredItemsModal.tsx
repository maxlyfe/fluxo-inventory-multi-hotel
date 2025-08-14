import React from 'react';
import { X, Star, ImageIcon, Package } from 'lucide-react';
import Modal from './Modal'; // Reutiliza o componente de modal base

/**
 * Interface para os dados do produto que este modal espera receber.
 * Inclui o novo campo 'is_starred'.
 */
interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  category: string;
  image_url?: string;
  is_starred?: boolean;
}

interface StarredItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  starredProducts: Product[]; // Recebe a lista de produtos já filtrada
}

/**
 * Componente Modal para exibir uma lista de produtos marcados como "Principais" (favoritos).
 */
const StarredItemsModal: React.FC<StarredItemsModalProps> = ({ isOpen, onClose, starredProducts }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Principais Itens">
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        {/* Verifica se a lista de produtos favoritados está vazia */}
        {starredProducts.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Star className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p>Nenhum item foi marcado como principal.</p>
            <p className="text-sm mt-1">Clique na estrela ao lado de um produto no inventário para adicioná-lo aqui.</p>
          </div>
        ) : (
          // Mapeia e exibe cada produto favoritado
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {starredProducts.map((product) => (
              <li key={product.id} className="py-3 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  {/* Exibe a imagem do produto ou um ícone placeholder */}
                  <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} className="w-full h-full object-contain rounded-lg" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-gray-400" />
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white">{product.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{product.category}</p>
                  </div>
                </div>
                {/* Exibe a quantidade atual em estoque */}
                <div className="text-right">
                    <p className={`text-lg font-bold ${product.quantity <= product.min_quantity ? 'text-red-500' : 'text-gray-800 dark:text-white'}`}>
                        {product.quantity}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">em estoque</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default StarredItemsModal;
