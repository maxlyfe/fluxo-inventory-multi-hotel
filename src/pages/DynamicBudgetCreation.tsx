import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { ArrowLeft, Search, Plus, Trash2, Link as LinkIcon, Copy, Check, Loader2, Globe, ListChecks, Edit2 } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  category: string;
  image_url?: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  unit?: string;
}

interface BudgetItem {
  product_id: string;
  name: string;
  image_url?: string;
  requested_quantity: number;
  requested_unit: string;
}

const unitOptions = [
  { value: 'und', label: 'Unidade (und)' },
  { value: 'kg', label: 'Quilograma (kg)' },
  { value: 'g', label: 'Grama (g)' },
  { value: 'l', label: 'Litro (l)' },
  { value: 'ml', label: 'Mililitro (ml)' },
  { value: 'cx', label: 'Caixa (cx)' },
  { value: 'pct', label: 'Pacote (pct)' },
  { value: 'fardo', label: 'Fardo' },
  { value: 'balde', label: 'Balde' },
  { value: 'saco', label: 'Saco' },
  { value: 'galão', label: 'Galão' },
];

const DynamicBudgetCreation = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [budgetName, setBudgetName] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  
  const [generatedLink, setGeneratedLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const [view, setView] = useState<'selection' | 'review'>('selection');

  useEffect(() => {
    const fetchProducts = async () => {
      if (!selectedHotel?.id) {
        addNotification('Por favor, selecione um hotel primeiro.', 'warning');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('products')
          .select('id, name, category, image_url, quantity, min_quantity, max_quantity, unit')
          .eq('hotel_id', selectedHotel.id)
          .eq('is_active', true)
          .order('name');

        if (error) throw error;

        setAllProducts(data || []);
        const uniqueCategories = [...new Set(data.map(p => p.category).filter(Boolean))].sort();
        setCategories(uniqueCategories);
      } catch (err: any) {
        addNotification('Erro ao carregar produtos do inventário: ' + err.message, 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, [selectedHotel, addNotification]);

  const filteredProducts = useMemo(() => {
    return allProducts.filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = !selectedCategory || product.category === selectedCategory;
      const notInBudget = !budgetItems.some(item => item.product_id === product.id);
      return matchesSearch && matchesCategory && notInBudget;
    });
  }, [allProducts, searchTerm, selectedCategory, budgetItems]);

  const handleAddItemToBudget = (product: Product) => {
    if (budgetItems.some(item => item.product_id === product.id)) {
      addNotification('Este item já está na lista de cotação.', 'warning');
      return;
    }
    const quantityToBuy = Math.max(0, (product.max_quantity ?? 0) - (product.quantity ?? 0));
    const newItem: BudgetItem = {
      product_id: product.id,
      name: product.name,
      image_url: product.image_url,
      requested_quantity: quantityToBuy,
      requested_unit: product.unit || 'und',
    };
    setBudgetItems(prev => [...prev, newItem]);
  };

  const handleRemoveItem = (productId: string) => {
    setBudgetItems(prev => prev.filter(item => item.product_id !== productId));
  };

  const handleQuantityChange = (productId: string, quantity: number) => {
    setBudgetItems(prev => prev.map(item => 
      item.product_id === productId 
        ? { ...item, requested_quantity: Math.max(0, quantity) }
        : item
    ));
  };
  
  const handleUnitChange = (productId: string, unit: string) => {
    setBudgetItems(prev => prev.map(item => 
      item.product_id === productId 
        ? { ...item, requested_unit: unit } 
        : item
    ));
  };

  const handleSaveAndGenerateLink = async () => {
    if (!budgetName.trim()) {
      addNotification('Por favor, dê um nome ao seu pedido de orçamento.', 'warning');
      return;
    }
    if (budgetItems.length === 0) {
      addNotification('Adicione pelo menos um item à lista de cotação.', 'warning');
      return;
    }
    if (!selectedHotel?.id || !user?.id) {
      addNotification('Sessão inválida. Por favor, recarregue a página.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const { data: budgetData, error: budgetError } = await supabase
        .from('dynamic_budgets')
        .insert({
          name: budgetName,
          hotel_id: selectedHotel.id,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (budgetError) throw budgetError;
      const budgetId = budgetData.id;

      const itemsToInsert = budgetItems.map(item => ({
        budget_id: budgetId,
        product_id: item.product_id,
        requested_quantity: item.requested_quantity,
        requested_unit: item.requested_unit,
      }));

      const { error: itemsError } = await supabase
        .from('dynamic_budget_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      const link = `${window.location.origin}/quote/${budgetId}`;
      setGeneratedLink(link);
      addNotification('Orçamento criado e link gerado com sucesso!', 'success');

    } catch (err: any) {
      addNotification('Erro ao salvar orçamento: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(generatedLink).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };
  
  const renderContent = () => {
    if (generatedLink) {
      return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
            <Check className="mx-auto h-16 w-16 text-green-500 bg-green-100 dark:bg-green-900/30 rounded-full p-2" />
            <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mt-4">Link Gerado com Sucesso!</h2>
            <p className="text-gray-600 dark:text-gray-400 mt-2">Envie o link abaixo para seus fornecedores para que eles possam preencher a cotação.</p>
            <div className="mt-6 flex items-center justify-center max-w-lg mx-auto">
                <input 
                    type="text" 
                    readOnly 
                    value={generatedLink} 
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-l-md bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                />
                <button 
                    onClick={handleCopyLink}
                    className="px-4 py-3 bg-blue-600 text-white rounded-r-md hover:bg-blue-700 flex items-center"
                >
                    {isCopied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                </button>
            </div>
            <button
                onClick={() => navigate('/purchases')}
                className="mt-8 px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600"
            >
                Concluir
            </button>
        </div>
      );
    }

    if (view === 'selection') {
      return renderSelectionView();
    }
    
    if (view === 'review') {
      return renderReviewView();
    }
  };

  const renderSelectionView = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Inventário de Produtos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input 
            type="text"
            placeholder="Buscar por nome..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
          />
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
          >
            <option value="">Todas as Categorias</option>
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>
        <div className="max-h-[60vh] overflow-y-auto pr-2">
          {loading ? (
            <p className="text-center text-gray-600 dark:text-gray-400">Carregando produtos...</p>
          ) : (
            <ul className="space-y-3">
              {filteredProducts.map(product => (
                <li key={product.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                  <div className="flex items-center space-x-3">
                    <img src={product.image_url || 'https://placehold.co/40x40/e2e8f0/a0aec0?text=?'} alt={product.name} className="w-10 h-10 rounded-md object-cover" />
                    <div>
                      <p className="font-medium text-gray-800 dark:text-gray-200">{product.name}</p>
                      {/* --- CORREÇÃO: Usando '??' para tratar valores nulos --- */}
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Estoque: <span className="font-semibold">{product.quantity ?? 0}</span> | 
                        Mín: <span className="font-semibold">{product.min_quantity ?? 0}</span> | 
                        Máx: <span className="font-semibold">{product.max_quantity ?? 0}</span>
                      </p>
                    </div>
                  </div>
                  <button onClick={() => handleAddItemToBudget(product)} className="p-2 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800">
                    <Plus className="h-5 w-5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col">
        <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Itens Selecionados ({budgetItems.length})</h2>
        <div className="flex-grow max-h-[60vh] overflow-y-auto pr-2 mb-4">
          {budgetItems.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">Adicione produtos do inventário para começar.</p>
          ) : (
            <ul className="space-y-2">
              {budgetItems.map(item => (
                <li key={item.product_id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                  <p className="font-medium text-sm text-gray-800 dark:text-gray-200">{item.name}</p>
                  <button onClick={() => handleRemoveItem(item.product_id)} className="p-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button 
          onClick={() => setView('review')}
          disabled={budgetItems.length === 0}
          className="w-full mt-auto flex items-center justify-center px-4 py-3 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Avançar para Quantidades
        </button>
      </div>
    </div>
  );
  
  const renderReviewView = () => (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <div className="mb-6">
        <label htmlFor="budgetName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Orçamento *</label>
        <input 
          type="text"
          id="budgetName"
          value={budgetName}
          onChange={e => setBudgetName(e.target.value)}
          placeholder="Ex: Cotação Semanal de Bebidas"
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
        />
      </div>
      <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Definir Quantidades ({budgetItems.length})</h2>
      <div className="max-h-[50vh] overflow-y-auto pr-2 mb-6">
        <ul className="space-y-3">
          {budgetItems.map(item => (
            <li key={item.product_id} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <img src={item.image_url || 'https://placehold.co/40x40/e2e8f0/a0aec0?text=?'} alt={item.name} className="w-10 h-10 rounded-md object-cover" />
                  <p className="font-medium text-sm text-gray-800 dark:text-gray-200">{item.name}</p>
                </div>
                <button onClick={() => handleRemoveItem(item.product_id)} className="p-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs text-gray-600 dark:text-gray-400">Quantidade</label>
                    <input 
                    type="number"
                    value={item.requested_quantity}
                    onChange={e => handleQuantityChange(item.product_id, parseInt(e.target.value))}
                    min="0"
                    className="w-full mt-1 p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm dark:bg-gray-700 dark:text-white"
                    />
                </div>
                <div>
                    <label className="text-xs text-gray-600 dark:text-gray-400">Unidade</label>
                    <select
                        value={item.requested_unit}
                        onChange={e => handleUnitChange(item.product_id, e.target.value)}
                        className="w-full mt-1 p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm dark:bg-gray-700 dark:text-white"
                    >
                        {unitOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center space-x-4">
        <button 
          onClick={() => setView('selection')}
          className="w-full flex items-center justify-center px-4 py-3 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
        >
          Voltar para Seleção
        </button>
        <button 
          onClick={handleSaveAndGenerateLink}
          disabled={isSaving || budgetItems.length === 0}
          className="w-full flex items-center justify-center px-4 py-3 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <LinkIcon className="h-5 w-5 mr-2" />}
          {isSaving ? 'Salvando...' : 'Salvar e Gerar Link'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate('/purchases')} className="flex items-center text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
          <ArrowLeft className="h-5 w-5 mr-2" />
          Voltar para Compras
        </button>
        <div className="flex items-center space-x-2 p-1 bg-gray-200 dark:bg-gray-700 rounded-lg">
            <button 
                onClick={() => setView('selection')}
                className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center ${view === 'selection' ? 'bg-white dark:bg-gray-800 shadow text-teal-600' : 'text-gray-600 dark:text-gray-300'}`}
            >
                <ListChecks className="h-4 w-4 mr-2" />
                Passo 1: Selecionar Itens
            </button>
            <button 
                onClick={() => setView('review')}
                disabled={budgetItems.length === 0}
                className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed ${view === 'review' ? 'bg-white dark:bg-gray-800 shadow text-teal-600' : 'text-gray-600 dark:text-gray-300'}`}
            >
                <Edit2 className="h-4 w-4 mr-2" />
                Passo 2: Definir Quantidades
            </button>
        </div>
      </div>
      
      {renderContent()}

    </div>
  );
};

export default DynamicBudgetCreation;
