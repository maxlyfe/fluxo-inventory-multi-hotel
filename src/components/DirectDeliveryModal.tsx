import React, { useState, useMemo, useRef, useEffect } from 'react';
import Modal from './Modal';
import { Product } from '../pages/AdminPanel'; // Ajuste o caminho se necessário
import { ImageIcon } from 'lucide-react'; // Importamos um ícone para o caso de não haver imagem

interface DirectDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  sectors: { id: string; name: string }[];
  onConfirm: (productId: string, sectorId: string, quantity: number, reason: string) => void;
}

const DirectDeliveryModal: React.FC<DirectDeliveryModalProps> = ({
  isOpen,
  onClose,
  products,
  sectors,
  onConfirm,
}) => {
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [quantity, setQuantity] = useState<number | string>(1);
  const [reason, setReason] = useState('');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId),
    [selectedProductId, products]
  );

  const filteredProducts = useMemo(
    () => {
      if (!searchTerm) return [];
      return products.filter((p) =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    },
    [products, searchTerm]
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [searchWrapperRef]);


  const handleConfirm = () => {
    const numQuantity = Number(quantity);
    if (!selectedProductId || !selectedSectorId || !numQuantity || numQuantity <= 0) {
      alert('Por favor, preencha todos os campos corretamente.');
      return;
    }
    if (selectedProduct && numQuantity > selectedProduct.quantity) {
      alert(`Quantidade em estoque insuficiente. Disponível: ${selectedProduct.quantity}`);
      return;
    }
    onConfirm(selectedProductId, selectedSectorId, numQuantity, reason);
    resetState();
  };
  
  const handleClose = () => {
    resetState();
    onClose();
  }

  const resetState = () => {
      setSelectedProductId('');
      setSelectedSectorId('');
      setQuantity(1);
      setReason('');
      setSearchTerm('');
      setShowResults(false);
  }

  const handleSelectProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setSearchTerm(product.name); 
    setShowResults(false);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(e.target.value);
      setSelectedProductId('');
      setShowResults(true);
  }

  const isButtonDisabled = !selectedProductId || !selectedSectorId || Number(quantity) <= 0 || (selectedProduct && Number(quantity) > selectedProduct.quantity);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Entrega Direta de Item">
      <div className="space-y-4">
        
        <div className="relative" ref={searchWrapperRef}>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Produto
          </label>
          <input
            type="text"
            placeholder="Digite para pesquisar um produto..."
            value={searchTerm}
            onChange={handleSearchChange}
            onFocus={() => setShowResults(true)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          {showResults && searchTerm && filteredProducts.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              
              {/* ÁREA MODIFICADA PARA MOSTRAR A IMAGEM */}
              {filteredProducts.map((p) => (
                <div
                  key={p.id}
                  onClick={() => handleSelectProduct(p)}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {/* Imagem ou Placeholder */}
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.name}
                      className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                      <ImageIcon className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                    </div>
                  )}
                  {/* Nome e Estoque */}
                  <div className="text-gray-800 dark:text-gray-200">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-sm text-gray-500">Estoque: {p.quantity}</div>
                  </div>
                </div>
              ))}
              
            </div>
          )}
           {showResults && searchTerm && filteredProducts.length === 0 && (
             <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg p-4">
                <p className="text-center text-gray-500">Nenhum produto encontrado.</p>
             </div>
           )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Setor de Destino
          </label>
          <select
            value={selectedSectorId}
            onChange={(e) => setSelectedSectorId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">Selecione um setor</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Quantidade a Entregar
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min="1"
            max={selectedProduct?.quantity || undefined}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            disabled={!selectedProduct}
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Motivo/Nota (Opcional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: Reposição de emergência"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        <div className="flex space-x-3 pt-4">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={isButtonDisabled}
            className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Confirmar Entrega
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default DirectDeliveryModal;