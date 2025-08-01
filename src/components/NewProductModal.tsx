import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Loader2, Check } from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';

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
  is_portionable?: boolean;
  is_portion?: boolean;
}

interface Sector {
  id: string;
  name: string;
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
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    quantity: 0,
    min_quantity: 0,
    max_quantity: 100,
    category: 'Outros',
    supplier: '',
    image_url: '',
    description: '',
    is_portionable: false,
    is_portion: false,
  });

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [loadingSectors, setLoadingSectors] = useState(true);

  useEffect(() => {
    if (isOpen && selectedHotel) {
      const fetchSectorsAndVisibility = async () => {
        setLoadingSectors(true);
        
        const { data: sectorsData, error: sectorsError } = await supabase
          .from('sectors')
          .select('id, name')
          .eq('hotel_id', selectedHotel.id)
          .order('name');

        if (sectorsError) {
          addNotification('Erro ao carregar setores.', 'error');
          setSectors([]);
        } else {
          setSectors(sectorsData || []);
        }

        if (editingProduct) {
          const { data: visibilityData, error: visibilityError } = await supabase
            .from('product_sector_visibility')
            .select('sector_id')
            .eq('product_id', editingProduct.id);
          
          if (visibilityError) {
            addNotification('Erro ao carregar visibilidade do produto.', 'error');
            setSelectedSectors(new Set());
          } else {
            setSelectedSectors(new Set(visibilityData.map(v => v.sector_id)));
          }
        } else {
          if (sectorsData) {
            setSelectedSectors(new Set(sectorsData.map(s => s.id)));
          }
        }
        setLoadingSectors(false);
      };

      fetchSectorsAndVisibility();

      if (editingProduct) {
        setFormData({
          name: editingProduct.name,
          quantity: editingProduct.quantity,
          min_quantity: editingProduct.min_quantity,
          max_quantity: editingProduct.max_quantity,
          category: editingProduct.category,
          supplier: editingProduct.supplier || '',
          image_url: editingProduct.image_url || '',
          description: editingProduct.description || '',
          is_portionable: editingProduct.is_portionable || false,
          is_portion: editingProduct.is_portion || false,
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
          description: '',
          is_portionable: false,
          is_portion: false,
        });
      }
    }
  }, [editingProduct, isOpen, selectedHotel, createAsHidden, addNotification]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    if (type === 'checkbox') {
        const checked = (e.target as HTMLInputElement).checked;
        setFormData(prev => {
            const newState = { ...prev, [name]: checked };
            if (checked) {
                if (name === 'is_portionable') {
                    newState.is_portion = false;
                } else if (name === 'is_portion') {
                    newState.is_portionable = false;
                }
            }
            return newState;
        });
        return;
    }

    let processedValue: string | number = value;
    if (type === 'number') {
      processedValue = parseInt(value) || 0;
    }
    setFormData(prev => ({ ...prev, [name]: processedValue }));
  };

  const handleSectorToggle = (sectorId: string) => {
    setSelectedSectors(prevSelected => {
      const newSelected = new Set(prevSelected);
      if (newSelected.has(sectorId)) {
        newSelected.delete(sectorId);
      } else {
        newSelected.add(sectorId);
      }
      return newSelected;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSaving(true);
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
      }

      if (savedProduct) {
        const { error: deleteError } = await supabase
          .from('product_sector_visibility')
          .delete()
          .eq('product_id', savedProduct.id);

        if (deleteError) throw new Error(`Erro ao limpar visibilidade antiga: ${deleteError.message}`);

        if (selectedSectors.size > 0) {
          const visibilityData = Array.from(selectedSectors).map(sectorId => ({
            product_id: savedProduct!.id,
            sector_id: sectorId,
          }));
          const { error: insertVisibilityError } = await supabase
            .from('product_sector_visibility')
            .insert(visibilityData);

          if (insertVisibilityError) throw new Error(`Erro ao salvar visibilidade: ${insertVisibilityError.message}`);
        }
      }
      
      addNotification(editingProduct ? 'Produto atualizado com sucesso!' : 'Produto criado com sucesso!', 'success');
      onSave(savedProduct || undefined);
      onClose();
    } catch (err: any) {
      const message = err.message || 'Erro desconhecido ao salvar produto.';
      setError(message);
      addNotification(`Erro ao salvar produto: ${message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="flex-shrink-0 flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {editingProduct ? 'Editar Produto' : 'Novo Produto'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto">
          <div className="p-6">
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
            
            {/* --- ALTERAÇÃO: Textos "(Pai)" e "(Filho)" removidos --- */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                <label htmlFor="is_portionable" className={`flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${formData.is_portion ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <input
                        id="is_portionable"
                        name="is_portionable"
                        type="checkbox"
                        checked={formData.is_portionable}
                        onChange={handleInputChange}
                        disabled={formData.is_portion}
                        className="h-4 w-4 rounded text-blue-600 border-gray-300 dark:bg-gray-600 dark:border-gray-500 focus:ring-blue-500"
                    />
                    <div>
                        <span className="font-medium text-gray-800 dark:text-gray-200">Produto Porcionável</span>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Marque se este item precisa ser processado pelo setor (ex: peça de carne, caixa de cereal).</p>
                    </div>
                </label>
                <label htmlFor="is_portion" className={`flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${formData.is_portionable ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <input
                        id="is_portion"
                        name="is_portion"
                        type="checkbox"
                        checked={formData.is_portion}
                        onChange={handleInputChange}
                        disabled={formData.is_portionable}
                        className="h-4 w-4 rounded text-green-600 border-gray-300 dark:bg-gray-600 dark:border-gray-500 focus:ring-green-500"
                    />
                    <div>
                        <span className="font-medium text-gray-800 dark:text-gray-200">É uma Porção</span>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Marque se este item é o resultado do porcionamento de outro item (ex: bife, dose de bebida).</p>
                    </div>
                </label>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-3">Visibilidade por Setor</h3>
              {loadingSectors ? (
                <div className="flex justify-center items-center h-24">
                  <Loader2 className="animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sectors.map(sector => (
                    <button
                      type="button"
                      key={sector.id}
                      onClick={() => handleSectorToggle(sector.id)}
                      className={`px-3 py-1.5 rounded-full border text-sm font-medium flex items-center gap-2 transition-colors duration-150 ${selectedSectors.has(sector.id) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-100 border-gray-300 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-500 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'}`}
                    >
                      {selectedSectors.has(sector.id) && <Check size={16} />}
                      {sector.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 flex justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
            <button type="button" onClick={onClose} className="px-4 py-2 border dark:border-gray-600 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-700">Cancelar</button>
            <button type="submit" disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center justify-center disabled:opacity-50">
              {isSaving && <Loader2 className="animate-spin w-4 h-4 mr-2" />}
              {editingProduct ? 'Salvar Alterações' : 'Criar Produto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewProductModal;
