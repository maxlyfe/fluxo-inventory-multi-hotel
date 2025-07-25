import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X } from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';

// Interface para o produto, pode ser exportada para um arquivo de tipos no futuro
interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  category: string;
  updated_at: string;
  supplier?: string;
  image_url?: string;
  description?: string;
  is_active: boolean;
}

interface NewProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (newProduct?: Product) => void; 
  editingProduct: Product | null;
  categories: string[];
  createAsHidden?: boolean; 
}

const NewProductModal = ({ isOpen, onClose, onSave, editingProduct, categories, createAsHidden = false }: NewProductModalProps) => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    quantity: 0,
    min_quantity: 0,
    max_quantity: 100,
    category: 'Outros',
    supplier: '',
    image_url: '',
    description: ''
  });

  useEffect(() => {
    if (isOpen) {
        if (editingProduct) {
          setFormData({
            name: editingProduct.name,
            quantity: editingProduct.quantity,
            min_quantity: editingProduct.min_quantity,
            max_quantity: editingProduct.max_quantity,
            category: editingProduct.category,
            supplier: editingProduct.supplier || '',
            image_url: editingProduct.image_url || '',
            description: editingProduct.description || ''
          });
        } else {
          setFormData({
            name: '',
            quantity: createAsHidden ? 0 : 0,
            min_quantity: 0,
            max_quantity: 100,
            category: 'Outros',
            supplier: '',
            image_url: '',
            description: ''
          });
        }
    }
  }, [editingProduct, isOpen, createAsHidden]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    let processedValue: string | number = value;
    if (e.target instanceof HTMLInputElement && e.target.type === 'number') {
      processedValue = parseInt(value) || 0;
    }
    setFormData(prev => ({ ...prev, [name]: processedValue }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (!selectedHotel?.id) throw new Error('Hotel não selecionado');
      if (formData.min_quantity > formData.max_quantity) {
        throw new Error('Quantidade mínima não pode ser maior que a máxima.');
      }

      let savedProduct: Product | null = null;

      if (editingProduct) {
        const { data, error: updateError } = await supabase
          .from('products')
          .update({ ...formData })
          .eq('id', editingProduct.id)
          .select()
          .single();
        if (updateError) throw updateError;
        savedProduct = data;
        addNotification('Produto atualizado com sucesso!', 'success');
      } else {
        const { data, error: insertError } = await supabase
          .from('products')
          .insert([{
            ...formData,
            hotel_id: selectedHotel.id,
            is_active: !createAsHidden,
          }])
          .select()
          .single();
        if (insertError) throw insertError;
        savedProduct = data;
        addNotification('Produto criado com sucesso!', 'success');
      }
      onSave(savedProduct || undefined);
      onClose();
    } catch (err: any) {
      const message = err.message || 'Erro desconhecido ao salvar produto.';
      setError(message);
      addNotification(`Erro ao salvar produto: ${message}`, 'error');
    }
  };
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full my-8">
        <form onSubmit={handleSubmit} className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {editingProduct ? 'Editar Produto' : 'Novo Produto'}
            </h2>
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              <X className="h-5 w-5" />
            </button>
          </div>
          {error && (<div className="mb-4 p-3 bg-red-50 dark:bg-red-900/50 text-red-800 dark:text-red-200 rounded-md text-sm">{error}</div>)}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Produto</label>
              <input id="name" name="name" type="text" value={formData.name} onChange={handleInputChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required />
            </div>
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria</label>
              <input id="category" name="category" type="text" value={formData.category} onChange={handleInputChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required list="category-suggestions"/>
              <datalist id="category-suggestions">{categories.map(cat => <option key={cat} value={cat} />)}</datalist>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qtd. Atual</label>
                <input id="quantity" name="quantity" type="number" value={formData.quantity} onChange={handleInputChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required min="0" disabled={createAsHidden} />
              </div>
              <div>
                <label htmlFor="min_quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qtd. Mínima</label>
                <input id="min_quantity" name="min_quantity" type="number" value={formData.min_quantity} onChange={handleInputChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required min="0"/>
              </div>
              <div>
                <label htmlFor="max_quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qtd. Máxima</label>
                <input id="max_quantity" name="max_quantity" type="number" value={formData.max_quantity} onChange={handleInputChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required min="1"/>
              </div>
            </div>
             <div>
              <label htmlFor="supplier" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fornecedor</label>
              <input id="supplier" name="supplier" type="text" value={formData.supplier} onChange={handleInputChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="image_url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URL da Imagem</label>
              <input id="image_url" name="image_url" type="url" value={formData.image_url} onChange={handleInputChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" placeholder="https://..." />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
              <textarea id="description" name="description" value={formData.description} onChange={handleInputChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" rows={3}/>
            </div>
          </div>
          <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button type="button" onClick={onClose} className="px-4 py-2 border dark:border-gray-600 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-700">Cancelar</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm">{editingProduct ? 'Salvar Alterações' : 'Criar Produto'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewProductModal;