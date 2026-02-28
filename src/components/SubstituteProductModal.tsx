import React, { useState, useEffect, useMemo } from 'react';
import Modal from './Modal'; // Assuming Modal component is in the same directory
import { Product, Request } from '../pages/AdminPanel'; // Import types from AdminPanel
import { Search, X, Check, AlertTriangle, Image as ImageIcon } from 'lucide-react';

interface SubstituteProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (productId: string, quantity: number, reason: string) => void; // *** ASSINATURA CORRIGIDA ***
  products: Product[]; // Available products to substitute with
  request: Request; // The original request being substituted
}

const SubstituteProductModal: React.FC<SubstituteProductModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  products,
  request,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number | string>(request.quantity); // Default to original quantity
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  // Reset state when modal opens/closes or request changes
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setSelectedProductId(null);
      setQuantity(request.quantity);
      setReason('');
      setError('');
    } else {
      // Optional: Clear state when closed, though Modal unmount might handle this
      setSearchTerm('');
      setSelectedProductId(null);
      setQuantity('');
      setReason('');
      setError('');
    }
  }, [isOpen, request]);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) {
      return products;
    }
    return products.filter(p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  const selectedProductDetails = useMemo(() => {
    return products.find(p => p.id === selectedProductId);
  }, [products, selectedProductId]);

  const handleConfirmClick = () => {
    setError('');
    const numQuantity = typeof quantity === 'string' ? parseFloat(quantity.replace(',', '.')) : quantity;

    if (!selectedProductId) {
      setError('Por favor, selecione um produto substituto.');
      return;
    }
    if (isNaN(numQuantity) || numQuantity <= 0) {
      setError('Por favor, insira uma quantidade válida maior que zero.');
      return;
    }
    if (!reason.trim()) {
      setError('Por favor, insira o motivo da substituição.');
      return;
    }
    if (selectedProductDetails && numQuantity > selectedProductDetails.quantity) {
        setError(`Quantidade insuficiente em estoque para ${selectedProductDetails.name}. Disponível: ${selectedProductDetails.quantity}`);
        return;
    }

    // *** CORREÇÃO: Passar quantidade como segundo parâmetro ***
    onConfirm(selectedProductId, numQuantity, reason.trim());
  };

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow empty string, numbers, and comma/dot for decimals
    if (value === '' || /^[0-9]*[,.]?[0-9]*$/.test(value)) {
        setQuantity(value);
        setError(''); // Clear error when user types
    } else {
        setError('Quantidade inválida. Use apenas números e vírgula/ponto decimal.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Substituir Produto">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Substituindo: <span className="font-medium">{request.item_name}</span> (Qtd: {request.quantity})
        </p>

        {/* Search Input */}
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar produto substituto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white pl-10"
          />
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
        </div>

        {/* Product List */}
        <div className="max-h-60 overflow-y-auto border rounded-md dark:border-gray-600">
          {filteredProducts.length > 0 ? (
            <ul className="divide-y dark:divide-gray-600">
              {filteredProducts.map((product) => (
                <li
                  key={product.id}
                  onClick={() => setSelectedProductId(product.id)}
                  className={`p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center ${selectedProductId === product.id ? 'bg-blue-100 dark:bg-blue-900/50' : ''}`}
                >
                  <div className="flex items-center">
                    {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="w-8 h-8 object-cover rounded mr-3 flex-shrink-0" />
                    ) : (
                        <div className="w-8 h-8 bg-gray-200 dark:bg-gray-600 rounded mr-3 flex items-center justify-center flex-shrink-0">
                            <ImageIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                        </div>
                    )}
                    <span className="text-sm dark:text-white">{product.name}</span>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Estoque: {product.quantity}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">Nenhum produto encontrado.</p>
          )}
        </div>

        {/* Selected Product Info */}
        {selectedProductDetails && (
          <div className="p-3 bg-blue-50 dark:bg-gray-700 rounded-md border border-blue-200 dark:border-gray-600">
            <p className="text-sm font-medium dark:text-white">Selecionado: {selectedProductDetails.name}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Estoque disponível: {selectedProductDetails.quantity}</p>
          </div>
        )}

        {/* Quantity Input */}
        <div>
          <label htmlFor="substituteQuantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Quantidade a Entregar
          </label>
          <input
            type="text" // Use text to allow comma/dot input
            inputMode="decimal" // Hint for mobile keyboards
            id="substituteQuantity"
            value={quantity}
            onChange={handleQuantityChange}
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            placeholder={`Original: ${request.quantity}`}
          />
        </div>

        {/* Reason Input */}
        <div>
          <label htmlFor="substituteReason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Motivo da Substituição
          </label>
          <textarea
            id="substituteReason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            placeholder="Ex: Produto original sem estoque"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center p-2 text-sm text-red-700 bg-red-100 rounded-md dark:bg-red-900/30 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 text-sm"
          >
            <X className="w-4 h-4 inline mr-1" /> Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmClick}
            disabled={!selectedProductId || !quantity || !reason}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            <Check className="w-4 h-4 inline mr-1" /> Confirmar Substituição
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SubstituteProductModal;

