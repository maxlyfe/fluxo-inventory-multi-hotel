import React, { useState } from 'react';
import { X, Plus, Trash2, PackagePlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';

interface Product {
  id: string;
  name: string;
  quantity: number;
}

interface PurchaseItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  isNew?: boolean;
  newProduct?: {
    name: string;
    category: string;
    description?: string;
    supplier?: string;
  };
}

interface NewPurchaseModalProps {
  onClose: () => void;
  onSuccess: () => void;
  products: Product[];
}

const NewPurchaseModal: React.FC<NewPurchaseModalProps> = ({
  onClose,
  onSuccess,
  products
}) => {
  const { selectedHotel } = useHotel();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [purchaseData, setPurchaseData] = useState({
    invoice_number: '',
    supplier: '',
    purchase_date: new Date().toISOString().split('T')[0],
    notes: ''
  });

  const [items, setItems] = useState<PurchaseItem[]>([{
    product_id: '',
    quantity: 1,
    unit_price: 0,
    isNew: false
  }]);

  const addItem = () => {
    setItems([...items, {
      product_id: '',
      quantity: 1,
      unit_price: 0,
      isNew: false
    }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof PurchaseItem | keyof Required<PurchaseItem>['newProduct'], value: string | number | boolean) => {
    const newItems = [...items];
    
    if (field === 'isNew') {
      newItems[index] = {
        ...newItems[index],
        isNew: value as boolean,
        product_id: '',
        newProduct: value ? {
          name: '',
          category: '',
          description: '',
          supplier: purchaseData.supplier
        } : undefined
      };
    } else if (field === 'name' || field === 'category' || field === 'description' || field === 'supplier') {
      newItems[index] = {
        ...newItems[index],
        newProduct: {
          ...newItems[index].newProduct!,
          [field]: value
        }
      };
    } else {
      newItems[index] = {
        ...newItems[index],
        [field]: value
      };
    }
    
    setItems(newItems);
  };

  const calculateTotal = () => {
    return items.reduce((total, item) => total + (item.quantity * item.unit_price), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel não selecionado');
      }

      // Validate items
      if (items.some(item => {
        if (item.isNew) {
          return !item.newProduct?.name || !item.newProduct.category || item.quantity <= 0 || item.unit_price <= 0;
        }
        return !item.product_id || item.quantity <= 0 || item.unit_price <= 0;
      })) {
        throw new Error('Preencha todos os campos corretamente');
      }

      // Calculate total amount
      const total_amount = calculateTotal();

      // Create purchase record
      const { data: purchase, error: purchaseError } = await supabase
        .from('purchases')
        .insert({
          ...purchaseData,
          total_amount,
          hotel_id: selectedHotel.id
        })
        .select()
        .single();

      if (purchaseError) throw purchaseError;

      // Process each item
      for (const item of items) {
        let productId = item.product_id;

        // If it's a new product, create it first
        if (item.isNew && item.newProduct) {
          const { data: newProduct, error: productError } = await supabase
            .from('products')
            .insert({
              name: item.newProduct.name,
              category: item.newProduct.category,
              description: item.newProduct.description,
              supplier: item.newProduct.supplier || purchaseData.supplier,
              quantity: 0, // Will be updated by trigger
              hotel_id: selectedHotel.id
            })
            .select()
            .single();

          if (productError) throw productError;
          productId = newProduct.id;
        }

        // Create purchase item
        const { error: itemError } = await supabase
          .from('purchase_items')
          .insert({
            purchase_id: purchase.id,
            product_id: productId,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.quantity * item.unit_price
          });

        if (itemError) throw itemError;
      }

      onSuccess();
    } catch (err) {
      console.error('Error creating purchase:', err);
      setError(err.message || 'Erro ao registrar compra');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Nova Entrada de Produtos
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Purchase Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Número da Nota Fiscal
              </label>
              <input
                type="text"
                value={purchaseData.invoice_number}
                onChange={(e) => setPurchaseData({ ...purchaseData, invoice_number: e.target.value })}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Fornecedor
              </label>
              <input
                type="text"
                value={purchaseData.supplier}
                onChange={(e) => setPurchaseData({ ...purchaseData, supplier: e.target.value })}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Data da Compra
              </label>
              <input
                type="date"
                value={purchaseData.purchase_date}
                onChange={(e) => setPurchaseData({ ...purchaseData, purchase_date: e.target.value })}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Observações
              </label>
              <input
                type="text"
                value={purchaseData.notes}
                onChange={(e) => setPurchaseData({ ...purchaseData, notes: e.target.value })}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Items */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                Itens
              </h3>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center px-3 py-1.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-800"
              >
                <Plus className="h-4 w-4 mr-1" />
                Adicionar Item
              </button>
            </div>

            <div className="space-y-4">
              {items.map((item, index) => (
                <div key={index} className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => updateItem(index, 'isNew', !item.isNew)}
                        className={`flex items-center px-3 py-1.5 rounded-md transition-colors ${
                          item.isNew
                            ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <PackagePlus className="h-4 w-4 mr-1" />
                        {item.isNew ? 'Novo Produto' : 'Produto Existente'}
                      </button>
                    </div>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {item.isNew ? (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Nome do Produto
                          </label>
                          <input
                            type="text"
                            value={item.newProduct?.name || ''}
                            onChange={(e) => updateItem(index, 'name', e.target.value)}
                            className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            required={item.isNew}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Categoria
                          </label>
                          <input
                            type="text"
                            value={item.newProduct?.category || ''}
                            onChange={(e) => updateItem(index, 'category', e.target.value)}
                            className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            required={item.isNew}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Produto
                        </label>
                        <select
                          value={item.product_id}
                          onChange={(e) => updateItem(index, 'product_id', e.target.value)}
                          className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                          required={!item.isNew}
                        >
                          <option value="">Selecione um produto</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Quantidade
                      </label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value))}
                        min="1"
                        className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Preço Unitário
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500 dark:text-gray-400">
                          R$
                        </span>
                        <input
                          type="number"
                          value={item.unit_price}
                          onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value))}
                          step="0.01"
                          min="0"
                          className="w-full pl-8 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {item.isNew && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Descrição (opcional)
                        </label>
                        <input
                          type="text"
                          value={item.newProduct?.description || ''}
                          onChange={(e) => updateItem(index, 'description', e.target.value)}
                          className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Fornecedor Específico (opcional)
                        </label>
                        <input
                          type="text"
                          value={item.newProduct?.supplier || ''}
                          onChange={(e) => updateItem(index, 'supplier', e.target.value)}
                          placeholder={purchaseData.supplier}
                          className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                      Total: R$ {(item.quantity * item.unit_price).toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Total */}
          <div className="flex justify-end items-center space-x-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <span className="text-lg font-medium text-gray-700 dark:text-gray-300">
              Total:
            </span>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              R$ {calculateTotal().toFixed(2)}
            </span>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-md p-4 text-sm text-red-800 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewPurchaseModal;