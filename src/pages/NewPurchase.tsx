import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  ArrowLeft, Search, Plus, Trash2, DollarSign, 
  Package, AlertTriangle, Image as ImageIcon 
} from 'lucide-react';
import { useNotification } from "../context/NotificationContext";
import { useHotel } from '../context/HotelContext';

interface Product {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  category: string;
}

interface PurchaseItem {
  product_id?: string;
  product?: Product;
  isNew: boolean;
  newProduct?: {
    name: string;
    category: string;
    description?: string;
    supplier?: string;
    image_url?: string;
  };
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface Budget {
  id: string;
  status: 'pending' | 'approved' | 'delivered' | 'canceled';
  budget_items?: Array<{
    product_id?: string;
    custom_item_name?: string;
    supplier?: string;
    unit_price?: number;
    quantity?: number;
    product?: {
        name?: string;
        category?: string;
        description?: string;
        image_url?: string;
    };
  }>;
  hotel_id?: string;
  purchase_id?: string | null;
}

const NewPurchase = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const budgetDataFromState: Budget | undefined = location.state?.budgetData;
  const budgetIdToUpdate = budgetDataFromState?.id;

  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [showNewProductForm, setShowNewProductForm] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '',
    category: '',
    description: '',
    supplier: '',
    image_url: ''
  });
  
  const [purchaseData, setPurchaseData] = useState({
    invoice_number: '',
    supplier: '',
    purchase_date: new Date().toISOString().split('T')[0],
    notes: ''
  });

  const [budgetProcessed, setBudgetProcessed] = useState(false);

  useEffect(() => {
    if (location.state?.budgetData) {
      console.log("[NewPurchase] New budget data detected in location state. Resetting budgetProcessed.");
      setBudgetProcessed(false);
      setItems([]); 
      setPurchaseData(prev => ({...prev, supplier: ''})); 
    }
  }, [location.state?.budgetData]);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        if (!selectedHotel?.id) {
          setProducts([]);
          setFilteredProducts([]);
          setLoading(false);
          return;
        }
        console.log("[NewPurchase] Fetching products for hotel:", selectedHotel.id);
        setLoading(true);
        const { data, error: fetchError } = await supabase
          .from('products')
          .select('*')
          .eq('hotel_id', selectedHotel.id)
          .order('name');

        if (fetchError) throw fetchError;
        setProducts(data || []);
        setFilteredProducts(data || []);
      } catch (err: any) {
        console.error('Error fetching products:', err);
        setError('Erro ao carregar produtos: ' + err.message);
        addNotification('Erro ao carregar produtos: ' + err.message, 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [selectedHotel, addNotification]);

  useEffect(() => {
    if (budgetDataFromState && products.length > 0 && !budgetProcessed) {
      console.log("[NewPurchase] Budget data received, products loaded, and budget not yet processed. Prefilling form...");
      
      const mainSupplier = budgetDataFromState.budget_items?.find((item: any) => item.supplier)?.supplier || 
                           budgetDataFromState.budget_items?.[0]?.supplier || 
                           '';
      
      setPurchaseData(prev => ({
         ...prev,
         supplier: mainSupplier || prev.supplier
      }));

      const prefilledItems = budgetDataFromState.budget_items?.map((budgetItem: any) => {
        const unitPrice = budgetItem.unit_price ?? 0;
        const quantity = budgetItem.quantity ?? 1;
        const totalPrice = unitPrice * quantity;
        const correspondingProduct = products.find(p => p.id === budgetItem.product_id);

        if (budgetItem.product_id && correspondingProduct) {
          return {
            product_id: budgetItem.product_id,
            product: correspondingProduct,
            isNew: false,
            quantity: quantity,
            unit_price: unitPrice,
            total_price: totalPrice
          };
        } else if (budgetItem.custom_item_name) {
          return {
            isNew: true,
            newProduct: {
              name: budgetItem.custom_item_name,
              category: 'Diversos',
              description: '',
              supplier: budgetItem.supplier || mainSupplier,
              image_url: '',
            },
            quantity: quantity,
            unit_price: unitPrice,
            total_price: totalPrice
          };
        } else if (budgetItem.product_id && !correspondingProduct) {
           console.warn(`Product with ID ${budgetItem.product_id} from budget not found in inventory. Treating as new.`);
           return {
            isNew: true,
            newProduct: {
              name: budgetItem.product?.name || `Produto ID ${budgetItem.product_id}`,
              category: budgetItem.product?.category || 'Diversos',
              description: budgetItem.product?.description || '',
              supplier: budgetItem.supplier || mainSupplier,
              image_url: budgetItem.product?.image_url || '',
            },
            quantity: quantity,
            unit_price: unitPrice,
            total_price: totalPrice
          };
        }
        return null;
      }).filter((item: PurchaseItem | null): item is PurchaseItem => item !== null);

      if (prefilledItems && prefilledItems.length > 0) {
        setItems(prefilledItems);
        addNotification('Formulário pré-preenchido com dados do orçamento.', 'info');
      } else {
        console.warn("[NewPurchase] Could not prefill items from budget data:", budgetDataFromState);
        addNotification('Não foi possível pré-preencher os itens do orçamento.', 'warning');
      }
      setBudgetProcessed(true);
    }
  }, [budgetDataFromState, products, addNotification, budgetProcessed]);

  useEffect(() => {
    const filtered = products.filter(product =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.description && product.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      product.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredProducts(filtered);
  }, [searchTerm, products]);

  const addItem = (product: Product) => {
    const existingItem = items.find(item => !item.isNew && item.product_id === product.id);
    if (existingItem) {
      setError('Este item já foi adicionado à compra');
      addNotification('Este item já foi adicionado à compra.', 'warning');
      setTimeout(() => setError(null), 3000);
      return;
    }
    setItems([...items, {
      product_id: product.id,
      product: product,
      isNew: false,
      quantity: 1,
      unit_price: 0,
      total_price: 0
    }]);
    setSearchTerm('');
  };

  const addNewProduct = () => {
    if (!newProduct.name || !newProduct.category) {
      setError('Nome e Categoria são obrigatórios para novos produtos.');
      addNotification('Nome e Categoria são obrigatórios para novos produtos.', 'error');
      setTimeout(() => setError(null), 3000);
      return;
    }
    const existingItem = items.find(item => 
      item.isNew && item.newProduct?.name.toLowerCase() === newProduct.name.toLowerCase()
    );
    if (existingItem) {
      setError('Um produto com este nome já foi adicionado à compra (como novo)');
      addNotification('Um produto com este nome já foi adicionado à compra (como novo).', 'warning');
      setTimeout(() => setError(null), 3000);
      return;
    }
    setItems([...items, {
      isNew: true,
      newProduct: { ...newProduct, supplier: newProduct.supplier || purchaseData.supplier },
      quantity: 1,
      unit_price: 0,
      total_price: 0
    }]);
    setNewProduct({ name: '', category: '', description: '', supplier: purchaseData.supplier, image_url: '' });
    setShowNewProductForm(false);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: 'quantity' | 'unit_price', value: string) => {
    const numericValue = parseFloat(value.replace(',', '.')) || 0;
    setItems(items.map((item, i) => {
      if (i === index) {
        let updatedItem = { ...item };
        if (field === 'quantity') {
          updatedItem.quantity = numericValue;
        } else if (field === 'unit_price') {
          updatedItem.unit_price = numericValue;
        }
        updatedItem.total_price = updatedItem.quantity * updatedItem.unit_price;
        return updatedItem;
      }
      return item;
    }));
  };

  const calculateTotal = () => items.reduce((total, item) => total + item.total_price, 0);

  const handlePurchaseDataChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPurchaseData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitLoading(true);

    try {
      if (!selectedHotel?.id) throw new Error('Hotel não selecionado');
      if (items.length === 0) throw new Error('Adicione pelo menos um item à compra');
      if (!purchaseData.supplier) throw new Error('Fornecedor é obrigatório');
      if (!purchaseData.purchase_date) throw new Error('Data da compra é obrigatória');

      const { data: purchase, error: purchaseError } = await supabase
        .from('purchases')
        .insert({
          invoice_number: purchaseData.invoice_number || null,
          supplier: purchaseData.supplier,
          purchase_date: purchaseData.purchase_date,
          notes: purchaseData.notes || null,
          total_amount: calculateTotal(),
          hotel_id: selectedHotel.id
        })
        .select()
        .single();

      if (purchaseError) throw purchaseError;

      for (const item of items) {
        let productId = item.product_id;
        let productName = item.product?.name || item.newProduct?.name;
        let wasNewProductDuplicate = false;
        let productInsertionError: any = null; 

        if (item.isNew && item.newProduct) {
          const { data: newDbProduct, error: capturedError } = await supabase
            .from('products')
            .insert({
              name: item.newProduct.name,
              category: item.newProduct.category,
              description: item.newProduct.description || null,
              supplier: item.newProduct.supplier || purchaseData.supplier,
              image_url: item.newProduct.image_url || null,
              hotel_id: selectedHotel.id,
              quantity: item.quantity 
            })
            .select()
            .single();
          
          productInsertionError = capturedError;

          if (productInsertionError) {
            if (productInsertionError.code === '23505') { 
              wasNewProductDuplicate = true;
              console.warn(`Produto "${item.newProduct.name}" já existe (erro 23505). Buscando ID...`);
              const { data: existingProduct, error: findError } = await supabase
                .from('products')
                .select('id, name')
                .eq('name', item.newProduct.name)
                .eq('hotel_id', selectedHotel.id)
                .single();
              
              if (findError || !existingProduct) {
                console.error('Erro ao buscar produto existente que causou duplicidade:', findError);
                throw new Error(`Erro ao processar novo produto duplicado "${item.newProduct.name}": ${productInsertionError.message}`);
              }
              productId = existingProduct.id;
              productName = existingProduct.name;
            } else {
              throw productInsertionError;
            }
          } else {
            productId = newDbProduct.id;
            productName = newDbProduct.name;
          }
        }

        if (productId) {
          const { error: itemError } = await supabase
            .from('purchase_items')
            .insert({
              purchase_id: purchase.id,
              product_id: productId,
              quantity: item.quantity,
              unit_price: item.unit_price,
              total_price: item.total_price
            });
          if (itemError) throw itemError;

          if (!item.isNew || wasNewProductDuplicate) { 
            // console.log(`Chamando RPC update_product_stock para ${wasNewProductDuplicate ? 'produto duplicado' : 'produto existente'}: ${productName} (ID: ${productId})`);
            // const { error: stockUpdateError } = await supabase.rpc(
            //   'update_product_stock',
            //   { 
            //     p_product_id: productId,
            //     p_quantity_change: item.quantity,
            //     p_movement_type: 'compra',
            //     p_purchase_id: purchase.id
            //   }
            // );
            // if (stockUpdateError) {
            //   console.error(`Erro RPC update_product_stock para ${productId} (${productName}):`, JSON.stringify(stockUpdateError));
            //   addNotification(
            //     `Erro ao atualizar estoque para ${productName}. Verifique se a função 'update_product_stock' existe e está correta no Supabase (Erro: ${stockUpdateError.message}). Estoque pode precisar de ajuste manual.`,
            //      'error',
            //      10000
            //   );
            // }
            console.warn(`[INFO] A chamada para atualização de estoque (update_product_stock) para o produto ${productName} (ID: ${productId}) foi desabilitada temporariamente, pois a função RPC correspondente não foi encontrada ou não está configurada corretamente no backend (Supabase). O estoque precisará ser ajustado manualmente.`);
            addNotification(`Atualização de estoque para '${productName}' desabilitada (função RPC ausente). Ajuste manual necessário.`, 'warning', 10000);
          }
        } else {
          console.error("ID do produto não definido para o item:", item);
          addNotification(`Erro crítico: ID do produto não encontrado para ${productName || 'item desconhecido'}.`, 'error');
        }
      }

      console.log("[NewPurchase] Tentando atualizar status do orçamento. Budget ID:", budgetIdToUpdate, "Selected Hotel ID:", selectedHotel?.id);
      if (budgetIdToUpdate && selectedHotel?.id) {
        const { error: budgetUpdateError } = await supabase
          .from('budgets')
          .update({ status: 'delivered' })
          .eq('id', budgetIdToUpdate)
          .eq('hotel_id', selectedHotel.id);

        if (budgetUpdateError) {
          console.error('Erro ao atualizar status do orçamento:', budgetUpdateError);
          addNotification('Compra registrada, mas erro ao atualizar status do orçamento. Verifique o console para detalhes.', 'warning');
        } else {
          console.log("[NewPurchase] Status do orçamento atualizado com sucesso para Concluído.");
          addNotification('Status do orçamento atualizado para Concluído.', 'info');
        }
      } else {
        console.warn("[NewPurchase] Não foi possível atualizar o status do orçamento: budgetIdToUpdate ou selectedHotel.id está faltando.", { budgetIdToUpdate, selectedHotelId: selectedHotel?.id });
        if (budgetIdToUpdate) { // Se apenas o budgetIdToUpdate estiver presente, mas não o hotel, ainda é um problema
            addNotification('Não foi possível atualizar o status do orçamento pois o hotel não está selecionado corretamente.', 'warning');
        }
      }

      addNotification('Compra registrada com sucesso!', 'success');
      navigate('/inventory');

    } catch (err: any) {
      console.error('Erro ao registrar compra:', err);
      setError('Erro ao registrar compra: ' + err.message);
      addNotification('Erro ao registrar compra: ' + err.message, 'error');
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 bg-gray-100 dark:bg-gray-900 min-h-screen">
      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <button 
              onClick={() => navigate(-1)} 
              className="mr-4 p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Registrar Nova Compra</h1>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-800 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-100 rounded-md flex items-center">
            <AlertTriangle size={20} className="mr-2" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <label htmlFor="invoice_number" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nº da Nota Fiscal (Opcional)</label>
              <input 
                type="text" 
                id="invoice_number" 
                name="invoice_number"
                value={purchaseData.invoice_number}
                onChange={handlePurchaseDataChange}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
            <div>
              <label htmlFor="supplier" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fornecedor *</label>
              <input 
                type="text" 
                id="supplier" 
                name="supplier"
                value={purchaseData.supplier}
                onChange={handlePurchaseDataChange}
                required
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
            <div>
              <label htmlFor="purchase_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data da Compra *</label>
              <input 
                type="date" 
                id="purchase_date" 
                name="purchase_date"
                value={purchaseData.purchase_date}
                onChange={handlePurchaseDataChange}
                required
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:[color-scheme:dark]"
              />
            </div>
          </div>

          <div className="mb-6">
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observações (Opcional)</label>
            <textarea 
              id="notes" 
              name="notes"
              rows={3}
              value={purchaseData.notes}
              onChange={handlePurchaseDataChange}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          <div className="mb-6 p-4 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-3">Adicionar Itens à Compra</h2>
            <div className="mb-4">
              <label htmlFor="searchProduct" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Buscar Produto Existente</label>
              <div className="relative">
                <input 
                  type="text" 
                  id="searchProduct"
                  placeholder="Digite para buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full p-2 pl-10 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                />
                <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              </div>
              {searchTerm && (
                <ul className="mt-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-750 max-h-60 overflow-y-auto shadow-lg z-10">
                  {loading && <li className="p-2 text-gray-500 dark:text-gray-400">Carregando...</li>}
                  {!loading && filteredProducts.length === 0 && <li className="p-2 text-gray-500 dark:text-gray-400">Nenhum produto encontrado.</li>}
                  {!loading && filteredProducts.map(product => (
                    <li 
                      key={product.id} 
                      onClick={() => addItem(product)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer flex items-center justify-between text-gray-800 dark:text-gray-100"
                    >
                      <div className="flex items-center">
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.name} className="w-8 h-8 rounded-sm object-cover mr-2"/>
                        ) : (
                          <ImageIcon size={20} className="w-8 h-8 text-gray-400 dark:text-gray-500 mr-2" />
                        )}
                        <span>{product.name} <span className="text-xs text-gray-500 dark:text-gray-400">({product.category})</span></span>
                      </div>
                      <Plus size={18} className="text-blue-500" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button 
              type="button"
              onClick={() => setShowNewProductForm(true)}
              className="mb-4 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md shadow-sm flex items-center transition-colors"
            >
              <Plus size={18} className="mr-2" />
              Adicionar Novo Produto (Não Cadastrado)
            </button>

            {showNewProductForm && (
              <div className="p-4 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 mb-4">
                <h3 className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-2">Detalhes do Novo Produto</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="newProductName" className="block text-sm font-medium text-gray-600 dark:text-gray-300">Nome *</label>
                    <input type="text" id="newProductName" value={newProduct.name} onChange={(e) => setNewProduct({...newProduct, name: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
                  </div>
                  <div>
                    <label htmlFor="newProductCategory" className="block text-sm font-medium text-gray-600 dark:text-gray-300">Categoria *</label>
                    <input type="text" id="newProductCategory" value={newProduct.category} onChange={(e) => setNewProduct({...newProduct, category: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
                  </div>
                  <div>
                    <label htmlFor="newProductDescription" className="block text-sm font-medium text-gray-600 dark:text-gray-300">Descrição</label>
                    <input type="text" id="newProductDescription" value={newProduct.description} onChange={(e) => setNewProduct({...newProduct, description: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
                  </div>
                  <div>
                    <label htmlFor="newProductSupplier" className="block text-sm font-medium text-gray-600 dark:text-gray-300">Fornecedor (Opcional)</label>
                    <input type="text" id="newProductSupplier" value={newProduct.supplier} onChange={(e) => setNewProduct({...newProduct, supplier: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
                  </div>
                  <div>
                    <label htmlFor="newProductImageUrl" className="block text-sm font-medium text-gray-600 dark:text-gray-300">URL da Imagem (Opcional)</label>
                    <input type="text" id="newProductImageUrl" value={newProduct.image_url} onChange={(e) => setNewProduct({...newProduct, image_url: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
                  </div>
                </div>
                <div className="mt-3 flex justify-end space-x-2">
                  <button type="button" onClick={() => setShowNewProductForm(false)} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors">Cancelar</button>
                  <button type="button" onClick={addNewProduct} className="px-3 py-1.5 text-sm rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors">Adicionar Produto à Lista</button>
                </div>
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-3">Itens da Compra</h2>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-100 dark:bg-gray-750">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Produto</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Quantidade</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Preço Unit. (R$)</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Total (R$)</th>
                      <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {items.map((item, index) => (
                      <tr key={index} className="text-gray-900 dark:text-gray-100">
                        <td className="px-4 py-3 whitespace-nowrap">
                          {item.isNew ? (
                            <span className="font-medium">{item.newProduct?.name} <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200 rounded-full">NOVO</span></span>
                          ) : (
                            <span className="font-medium">{item.product?.name}</span>
                          )}
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {item.isNew ? item.newProduct?.category : item.product?.category}
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <input 
                            type="number" 
                            value={item.quantity}
                            onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                            min="0.01" step="any"
                            className="w-24 p-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500"
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <input 
                            type="number" 
                            value={item.unit_price}
                            onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                            min="0.00" step="any"
                            className="w-28 p-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500"
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          R$ {item.total_price.toFixed(2).replace('.', ',')}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <button 
                            type="button" 
                            onClick={() => removeItem(index)}
                            className="p-1.5 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col items-end">
            <div className="text-2xl font-bold text-gray-800 dark:text-white mb-4">
              Total da Compra: <span className="text-blue-600 dark:text-blue-400">R$ {calculateTotal().toFixed(2).replace('.', ',')}</span>
            </div>
            <button 
              type="submit" 
              disabled={submitLoading || items.length === 0}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 ease-in-out flex items-center justify-center"
            >
              {submitLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Registrando...
                </>
              ) : (
                <>
                  <DollarSign size={20} className="mr-2" />
                  Registrar Compra
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewPurchase;

