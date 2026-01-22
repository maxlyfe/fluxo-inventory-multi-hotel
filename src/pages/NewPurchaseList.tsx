import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart, ArrowLeft, Download, AlertTriangle, Calendar, Save, History, ChevronDown, Plus, Edit, Copy, X, Globe } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { saveBudget, getHotelInventory, supabase } from '../lib/supabase';

interface Product {
  id: string;
  name: string;
  quantity: number; 
  min_quantity: number;
  max_quantity: number;
  category: string;
  supplier?: string;
  last_purchase_price?: number;
  average_price?: number;
  last_purchase_date?: string;
  weight?: number;
  unit?: string;
}

interface EditableProduct extends Product {
  editedName?: string;
  editedPrice?: number;
  editedQuantity?: number; 
  editedLastQuantity?: number;
  editedLastPrice?: number;
  editedSupplier?: string;
  editedWeight?: number;
  editedUnit?: string;
  editedLastPurchaseDate?: string;
  editedStock?: string | number; 
  isCustom?: boolean;
}

const unitOptions = [
  { value: '', label: 'Selecione' },
  { value: 'kg', label: 'kg (Quilograma)' },
  { value: 'g', label: 'g (Grama)' },
  { value: 'l', label: 'l (Litro)' },
  { value: 'ml', label: 'ml (Mililitro)' },
  { value: 'und', label: 'und (Unidade)' },
  { value: 'cx', label: 'cx (Caixa)' },
  { value: 'pct', label: 'pct (Pacote)' },
  { value: 'fardo', label: 'fardo (Fardo)' },
  { value: 'balde', label: 'balde (Balde)' },
  { value: 'saco', label: 'saco (Saco)' },
  { value: 'outro', label: 'Outro' }
];

const removeAccents = (str: string) => {
  if (!str) return "";
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const NewPurchaseList = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [customUnitOpen, setCustomUnitOpen] = useState<{[key: string]: boolean}>({});
  const [fullInventory, setFullInventory] = useState<Product[]>([]);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  const [customItem, setCustomItem] = useState<{
    name: string;
    quantity: number;
    unit: string;
    price: number;
    supplier: string;
  }>({
    name: '',
    quantity: 1,
    unit: 'und',
    price: 0,
    supplier: '',
  });
  const [searchTerm, setSearchTerm] = useState("");
  
  const [products, setProducts] = useState<EditableProduct[]>(() => {
    const initialProducts = location.state?.selectedProductDetails || [];
    
    if (initialProducts.length > 0 && initialProducts[0].editedQuantity !== undefined) {
        return initialProducts;
    }

    return initialProducts.map((p: Product) => {
      let formattedDate: string | undefined;
      if (p.last_purchase_date) {
        try {
          const parsedDate = parseISO(p.last_purchase_date);
          if (isValid(parsedDate)) {
            formattedDate = format(parsedDate, 'yyyy-MM-dd');
          }
        } catch (error) {
          console.warn(`Could not parse date for initial product ${p.id}: ${p.last_purchase_date}`, error);
        }
      }
      return {
        ...p,
        editedName: p.name,
        editedPrice: p.last_purchase_price,
        editedQuantity: Math.max(0, p.max_quantity - p.quantity),
        editedLastQuantity: p.last_purchase_quantity, 

        editedLastPrice: p.last_purchase_price,
        editedSupplier: p.supplier,
        editedWeight: p.weight,
        editedUnit: p.unit || '',
        editedLastPurchaseDate: formattedDate,
        editedStock: p.quantity, 
      };
    });
  });

  const today = format(new Date(), "dd/MM/yyyy", { locale: ptBR });
  
  const purchaseListRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const fetchInventory = async () => {
      if (!selectedHotel?.id) return;
      try {
        const result = await getHotelInventory(selectedHotel.id);
        if (result.success && result.data) {
          setFullInventory(result.data);
        } else {
          throw new Error(result.error || "Failed to fetch inventory");
        }
      } catch (err) {
        console.error("Error fetching full inventory:", err);
        addNotification("Erro ao carregar inventário completo.", "error");
      }
    };
    fetchInventory();
  }, [selectedHotel, addNotification, location.state?.selectedProductDetails]);

  const handleValueChange = (productId: string, field: keyof EditableProduct, value: string) => {
    const numericValue = parseFloat(value);
    const finalValue = value === '' ? undefined : (isNaN(numericValue) ? undefined : numericValue);

    setProducts(prevProducts => 
      prevProducts.map(product => 
        product.id === productId 
          ? { ...product, [field]: finalValue }
          : product
      )
    );
  };

  const handleTextChange = (productId: string, field: keyof EditableProduct, value: string) => {
    setProducts(prevProducts => 
      prevProducts.map(product => 
        product.id === productId 
          ? { ...product, [field]: value }
          : product
      )
    );
  };

  const handleUnitChange = (productId: string, unit: string) => {
    setProducts(prevProducts => 
      prevProducts.map(product => 
        product.id === productId 
          ? { ...product, editedUnit: unit }
          : product
      )
    );
    
    if (unit === 'outro') {
      setCustomUnitOpen(prev => ({...prev, [productId]: true}));
    } else {
      setCustomUnitOpen(prev => ({...prev, [productId]: false}));
    }
  };

  const totalBudgetValue = useMemo(() => 
    products.reduce((sum, product) => {
      const quantity = product.editedQuantity ?? 0;
      const price = product.editedPrice ?? 0;
      return sum + (quantity * price);
    }, 0),
    [products]
  );

  const saveBudgetToDatabase = async () => {
    if (!selectedHotel?.id) {
      setError('Hotel não selecionado. Impossível salvar o orçamento.');
      addNotification('Hotel não selecionado. Impossível salvar o orçamento.', 'error');
      return;
    }
    if (products.length === 0) {
      setError('Orçamento vazio. Adicione itens antes de salvar.');
      addNotification('Orçamento vazio. Adicione itens antes de salvar.', 'warning');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const budgetItems = products.map(product => {
        let formattedDate: string | null = null;
        if (product.editedLastPurchaseDate) {
          try {
            const dateString = product.editedLastPurchaseDate;
            const parsedDate = new Date(dateString + 'T00:00:00');
            if (isValid(parsedDate)) {
              formattedDate = parsedDate.toISOString();
            } else {
              console.warn(`Invalid date format for product ${product.id}: ${product.editedLastPurchaseDate}`);
            }
          } catch (dateError) {
            console.warn(`Error parsing date for product ${product.id}: ${product.editedLastPurchaseDate}`, dateError);
          }
        }

        const customNameValue = product.isCustom ? (product.editedName || product.name) : null;

        return {
          product_id: product.isCustom ? null : product.id,
          custom_item_name: customNameValue, 
          quantity: product.editedQuantity ?? 0,
          unit_price: product.editedPrice ?? null,
          supplier: (product.editedSupplier || product.supplier || '').trim() || 'Não especificado',
          last_purchase_quantity: product.editedLastQuantity ?? null,
          last_purchase_price: product.editedLastPrice ?? null,
          last_purchase_date: formattedDate,
          weight: product.editedWeight || product.weight || null,
          unit: product.editedUnit || 'und',
          stock_at_creation: product.isCustom ? null : (product.editedStock ?? null),
        };
      });

      const result = await saveBudget(selectedHotel.id, totalBudgetValue, budgetItems);

      if (result.success && result.data?.id) {
        addNotification('Orçamento salvo com sucesso!', 'success');
        
        try {
          const mainSupplier = budgetItems.find(item => item.supplier && item.supplier !== 'Não especificado')?.supplier || 'Não especificado';
          
          // CORREÇÃO: Usando a função process_notification_event via RPC para garantir compatibilidade com o banco
          await supabase.rpc('process_notification_event', {
            p_hotel_id: selectedHotel.id,
            p_type: 'NEW_BUDGET',
            p_title: 'Novo orçamento criado',
            p_message: `Novo orçamento de ${mainSupplier} no valor de R$ ${totalBudgetValue.toFixed(2).replace('.', ',')} para ${selectedHotel.name}`,
            p_data: {
              budget_id: result.data.id,
              total_value: totalBudgetValue,
              supplier: mainSupplier,
              items_count: budgetItems.length,
              hotel_name: selectedHotel.name
            }
          });
          
          console.log('Notificação de novo orçamento enviada com sucesso');
        } catch (notificationError) {
          console.error('Erro ao enviar notificação de novo orçamento:', notificationError);
        }
        
      } else {
        console.error('Supabase save error:', result.error);
        throw new Error(result.error || 'Erro desconhecido retornado pelo backend.');
      }
    } catch (err) {
      console.error('Error in saveBudgetToDatabase:', err);
      const message = err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.';
      setError(`Erro ao salvar orçamento: ${message}`);
      addNotification(`Erro ao salvar orçamento: ${message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const captureAndCopyToClipboard = async () => {
    addNotification("Funcionalidade de captura de imagem não disponível no navegador.", "info");
  };

  const exportToExcel = () => {
    const dataToExport = products.map(p => ({
      'Item': p.editedName || p.name,
      'Quantidade': p.editedQuantity,
      'Unidade': p.editedUnit,
      'Fornecedor': p.editedSupplier || p.supplier,
      'Preço Unitário': p.editedPrice,
      'Total': (p.editedQuantity ?? 0) * (p.editedPrice ?? 0)
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orçamento");

    const fileName = `Orçamento_${selectedHotel?.name || 'Hotel'}_${format(new Date(), 'dd-MM-yyyy')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    addNotification("Orçamento exportado com sucesso!", "success");
  };

  const handleAddItem = (item: Product) => {
    const isAlreadyAdded = products.some(p => p.id === item.id);
    if (isAlreadyAdded) {
      addNotification("Este item já foi adicionado ao orçamento.", "warning");
      return;
    }

    let formattedDate: string | undefined;
    if (item.last_purchase_date) {
      try {
        const parsedDate = parseISO(item.last_purchase_date);
        if (isValid(parsedDate)) {
          formattedDate = format(parsedDate, 'yyyy-MM-dd');
        }
      } catch (error) {
        console.warn(`Could not parse date for item ${item.id}: ${item.last_purchase_date}`, error);
      }
    }

    const newProduct: EditableProduct = {
      ...item,
      editedName: item.name,
      editedPrice: item.last_purchase_price,
      editedQuantity: Math.max(0, item.max_quantity - item.quantity),
      editedLastQuantity: item.last_purchase_quantity,
      editedLastPrice: item.last_purchase_price,
      editedSupplier: item.supplier,
      editedWeight: item.weight,
      editedUnit: item.unit || '',
      editedLastPurchaseDate: formattedDate,
      editedStock: item.quantity,
    };

    setProducts(prev => [...prev, newProduct]);
    setShowAddItemModal(false);
    addNotification(`${item.name} adicionado ao orçamento.`, "success");
  };

  const handleAddCustomItem = () => {
    if (!customItem.name.trim()) {
      addNotification("Nome do item é obrigatório.", "warning");
      return;
    }

    const newCustomProduct: EditableProduct = {
      id: `custom-${Date.now()}`,
      name: customItem.name,
      quantity: 0,
      min_quantity: 0,
      max_quantity: 0,
      category: 'Personalizado',
      editedName: customItem.name,
      editedPrice: customItem.price,
      editedQuantity: customItem.quantity,
      editedUnit: customItem.unit,
      editedSupplier: customItem.supplier,
      isCustom: true,
    };

    setProducts(prev => [...prev, newCustomProduct]);
    setCustomItem({
      name: '',
      quantity: 1,
      unit: 'und',
      price: 0,
      supplier: '',
    });
    setShowCustomItemModal(false);
    addNotification(`${customItem.name} adicionado ao orçamento.`, "success");
  };

  const filteredInventory = useMemo(() => {
    if (!searchTerm.trim()) return [];
    
    const searchLower = removeAccents(searchTerm.toLowerCase());
    return fullInventory.filter(item => {
      const nameMatch = removeAccents(item.name.toLowerCase()).includes(searchLower);
      const categoryMatch = removeAccents(item.category.toLowerCase()).includes(searchLower);
      const supplierMatch = item.supplier ? removeAccents(item.supplier.toLowerCase()).includes(searchLower) : false;
      
      return nameMatch || categoryMatch || supplierMatch;
    }).filter(item => !products.some(p => p.id === item.id));
  }, [searchTerm, fullInventory, products]);

  const removeProductFromList = (productId: string) => {
    setProducts(prev => prev.filter(p => p.id !== productId));
    addNotification("Item removido do orçamento.", "info");
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <Link 
              to="/purchases" 
              className="flex items-center text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              <ArrowLeft className="h-5 w-5 mr-2" />
              Voltar
            </Link>
            <div className="flex items-center space-x-2">
              <ShoppingCart className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Novo Orçamento (Físico)</h1>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={() => navigate('/purchases/online')}
              className="flex items-center px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
            >
              <Globe className="h-4 w-4 mr-2" />
              Orçamentos Online
            </button>
            <button
              onClick={captureAndCopyToClipboard}
              className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copiar Imagem
            </button>
            <button
              onClick={exportToExcel}
              className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <Download className="h-4 w-4 mr-2" />
              Exportar Excel
            </button>
            <button
              onClick={saveBudgetToDatabase}
              disabled={isSaving || products.length === 0}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Salvando...' : 'Salvar Orçamento'}
            </button>
          </div>
        </div>

        {/* Hotel Info */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
            Orçamento para {selectedHotel?.name || 'Hotel não selecionado'}
          </h2>
          <div className="flex items-center text-gray-600 dark:text-gray-400">
            <Calendar className="h-4 w-4 mr-2" />
            <span>{today}</span>
          </div>
        </div>

        {/* Add Items Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Adicionar Itens</h3>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowAddItemModal(true)}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4 mr-2" />
                Adicionar do Inventário
              </button>
              <button
                onClick={() => setShowCustomItemModal(true)}
                className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Edit className="h-4 w-4 mr-2" />
                Adicionar Item Personalizado
              </button>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mr-2" />
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          </div>
        )}

        {/* Purchase List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm" ref={purchaseListRef}>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Lista de Compras</h3>
            
            {products.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2">
                  Nenhum item adicionado
                </h4>
                <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
                  Adicione itens do inventário ou crie itens personalizados para iniciar seu orçamento.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto" ref={tableRef}>
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 table-fixed">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[25%]">
                        Item
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[8%]">
                        Qtd. Comprar
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[10%]">
                        Unidade
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[10%]">
                        Fornecedor
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[8%]">
                        Qtd. Últ. Compra
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[10%]">
                        Data Últ. Compra
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[8%]">
                        Valor Últ. Compra
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[8%]">
                        Preço Unit.
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[8%]">
                        Total
                      </th>
                      <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[5%]">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {products.map((product) => (
                      <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {product.isCustom ? (
                              <input
                                type="text"
                                value={product.editedName || ''}
                                onChange={(e) => handleTextChange(product.id, 'editedName', e.target.value)}
                                className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:border-blue-500 outline-none"
                              />
                            ) : (
                              product.name
                            )}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{product.category}</div>
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="number"
                            value={product.editedQuantity ?? ''}
                            onChange={(e) => handleValueChange(product.id, 'editedQuantity', e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <select
                            value={product.editedUnit || ''}
                            onChange={(e) => handleUnitChange(product.id, e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                          >
                            {unitOptions.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          {customUnitOpen[product.id] && (
                            <input
                              type="text"
                              placeholder="Especifique"
                              onChange={(e) => handleTextChange(product.id, 'editedUnit', e.target.value)}
                              className="mt-1 w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                            />
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="text"
                            value={product.editedSupplier || ''}
                            onChange={(e) => handleTextChange(product.id, 'editedSupplier', e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="number"
                            value={product.editedLastQuantity ?? ''}
                            onChange={(e) => handleValueChange(product.id, 'editedLastQuantity', e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="date"
                            value={product.editedLastPurchaseDate || ''}
                            onChange={(e) => handleTextChange(product.id, 'editedLastPurchaseDate', e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="number"
                            step="0.01"
                            value={product.editedLastPrice ?? ''}
                            onChange={(e) => handleValueChange(product.id, 'editedLastPrice', e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="number"
                            step="0.01"
                            value={product.editedPrice ?? ''}
                            onChange={(e) => handleValueChange(product.id, 'editedPrice', e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                          />
                        </td>
                        <td className="px-4 py-4 text-sm font-medium text-gray-900 dark:text-white">
                          R$ {((product.editedQuantity ?? 0) * (product.editedPrice ?? 0)).toFixed(2).replace('.', ',')}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <button
                            onClick={() => removeProductFromList(product.id)}
                            className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <td colSpan={8} className="px-6 py-4 text-right text-sm font-bold text-gray-900 dark:text-white">
                        Total do Orçamento:
                      </td>
                      <td className="px-4 py-4 text-sm font-bold text-blue-600 dark:text-blue-400">
                        R$ {totalBudgetValue.toFixed(2).replace('.', ',')}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Item Modal */}
      {showAddItemModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-middle bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white dark:bg-gray-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white mb-4">
                      Adicionar do Inventário
                    </h3>
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                      <input
                        type="text"
                        placeholder="Buscar por nome, categoria ou fornecedor..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {filteredInventory.length === 0 ? (
                        <p className="text-center text-gray-500 py-4">Nenhum item encontrado.</p>
                      ) : (
                        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                          {filteredInventory.map(item => (
                            <li 
                              key={item.id} 
                              className="py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700 px-2 rounded cursor-pointer"
                              onClick={() => handleAddItem(item)}
                            >
                              <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{item.category} | Estoque: {item.quantity}</p>
                              </div>
                              <Plus className="h-4 w-4 text-blue-600" />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Item Modal */}
      {showCustomItemModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-middle bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white dark:bg-gray-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white mb-4">
                  Novo Item Personalizado
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Item</label>
                    <input
                      type="text"
                      value={customItem.name}
                      onChange={(e) => setCustomItem({...customItem, name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantidade</label>
                      <input
                        type="number"
                        value={customItem.quantity}
                        onChange={(e) => setCustomItem({...customItem, quantity: parseInt(e.target.value)})}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unidade</label>
                      <select
                        value={customItem.unit}
                        onChange={(e) => setCustomItem({...customItem, unit: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                      >
                        {unitOptions.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Preço Unitário</label>
                      <input
                        type="number"
                        step="0.01"
                        value={customItem.price}
                        onChange={(e) => setCustomItem({...customItem, price: parseFloat(e.target.value)})}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fornecedor</label>
                      <input
                        type="text"
                        value={customItem.supplier}
                        onChange={(e) => setCustomItem({...customItem, supplier: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleAddCustomItem}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Adicionar
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomItemModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NewPurchaseList;
