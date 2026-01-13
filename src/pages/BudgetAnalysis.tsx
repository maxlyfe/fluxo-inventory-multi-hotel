import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { Loader2, AlertTriangle, ArrowLeft, BarChart2, ShoppingCart, CheckCircle } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';

// Interfaces
interface BudgetItem {
  id: string;
  requested_quantity: number;
  requested_unit: string;
  product: {
    id: string;
    name: string;
    image_url?: string;
  };
}

interface SupplierQuoteItem {
  price: number;
  budget_item_id: string;
}

interface SupplierQuote {
  id: string;
  supplier_name: string;
  submitted_at: string;
  quote_items: SupplierQuoteItem[];
}

interface BudgetAnalysisData {
  id: string;
  name: string;
  budget_items: BudgetItem[];
  supplier_quotes: SupplierQuote[];
}

interface ComparisonItem {
  productId: string;
  productName: string;
  imageUrl?: string;
  requestedQuantity: number;
  requestedUnit: string;
  prices: Record<string, number | null>; // supplier_name -> price
  bestPrice: number | null;
}

const BudgetAnalysis = () => {
  const { budgetId } = useParams<{ budgetId: string }>();
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [budgetData, setBudgetData] = useState<BudgetAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // --- ALTERAÇÃO: Estado para gerenciar as seleções manuais do usuário ---
  const [selectedSuppliers, setSelectedSuppliers] = useState<Record<string, string | null>>({}); // productId -> supplierName

  useEffect(() => {
    const fetchAnalysisData = async () => {
      if (!budgetId) {
        setError('ID do orçamento não fornecido.');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const { data, error: fetchError } = await supabase
          .from('dynamic_budgets')
          .select(`
            id,
            name,
            budget_items:dynamic_budget_items(
              id,
              requested_quantity,
              requested_unit,
              product:products(id, name, image_url)
            ),
            supplier_quotes(
              id,
              supplier_name,
              submitted_at,
              quote_items:supplier_quote_items(price, budget_item_id)
            )
          `)
          .eq('id', budgetId)
          .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error('Orçamento não encontrado.');

        setBudgetData(data as unknown as BudgetAnalysisData);
      } catch (err: any) {
        setError('Erro ao carregar dados para análise: ' + err.message);
        addNotification('Erro ao carregar dados para análise.', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalysisData();
  }, [budgetId, addNotification]);

  const comparisonData = useMemo<ComparisonItem[]>(() => {
    if (!budgetData) return [];

    return budgetData.budget_items.map(item => {
      const prices: Record<string, number | null> = {};
      let bestPrice: number | null = null;

      budgetData.supplier_quotes.forEach(quote => {
        const quoteItem = quote.quote_items.find(qi => qi.budget_item_id === item.id);
        const price = quoteItem ? quoteItem.price : null;
        prices[quote.supplier_name] = price;

        if (price !== null && (bestPrice === null || price < bestPrice)) {
          bestPrice = price;
        }
      });

      return {
        productId: item.product.id,
        productName: item.product.name,
        imageUrl: item.product.image_url,
        requestedQuantity: item.requested_quantity,
        requestedUnit: item.requested_unit,
        prices,
        bestPrice,
      };
    });
  }, [budgetData]);

  // --- ALTERAÇÃO: Inicializa as seleções com base no melhor preço ---
  useEffect(() => {
    if (comparisonData.length > 0) {
        const initialSelections: Record<string, string | null> = {};
        comparisonData.forEach(item => {
            if (item.bestPrice !== null) {
                const bestSupplier = Object.entries(item.prices).find(([, price]) => price === item.bestPrice)?.[0];
                initialSelections[item.productId] = bestSupplier || null;
            } else {
                initialSelections[item.productId] = null;
            }
        });
        setSelectedSuppliers(initialSelections);
    }
  }, [comparisonData]);

  // --- ALTERAÇÃO: Listas de compra agora são baseadas nas seleções do usuário ---
  const recommendedPurchaseLists = useMemo(() => {
    const lists: Record<string, any[]> = {};
    if (!comparisonData.length || Object.keys(selectedSuppliers).length === 0) return lists;

    comparisonData.forEach(item => {
        const selectedSupplier = selectedSuppliers[item.productId];
        if (selectedSupplier) {
            const price = item.prices[selectedSupplier];
            if (price !== null && price !== undefined) {
                if (!lists[selectedSupplier]) {
                    lists[selectedSupplier] = [];
                }
                lists[selectedSupplier].push({
                    product_id: item.productId,
                    name: item.productName,
                    quantity: item.requestedQuantity,
                    unit_price: price,
                    supplier: selectedSupplier,
                    unit: item.requestedUnit,
                });
            }
        }
    });
    return lists;
  }, [comparisonData, selectedSuppliers]);

  // --- ALTERAÇÃO: Totais por fornecedor agora são baseados nas seleções do usuário ---
  const supplierTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    if (!budgetData || !comparisonData.length || Object.keys(selectedSuppliers).length === 0) return totals;

    budgetData.supplier_quotes.forEach(quote => {
        totals[quote.supplier_name] = 0;
    });

    comparisonData.forEach(item => {
        const selectedSupplier = selectedSuppliers[item.productId];
        if (selectedSupplier) {
            const price = item.prices[selectedSupplier];
            if (price !== null && price !== undefined) {
                totals[selectedSupplier] += price * item.requestedQuantity;
            }
        }
    });
    return totals;
  }, [budgetData, comparisonData, selectedSuppliers]);

  const handleCreatePurchaseList = async (supplierName: string, items: any[]) => {
    addNotification(`Preparando orçamento para ${supplierName}...`, 'info');
    try {
        const productIds = items.map(item => item.product_id);
        if (productIds.length === 0) return;

        const { data: fullProductsData, error: productsError } = await supabase
            .from('products')
            .select('*')
            .in('id', productIds);

        if (productsError) throw productsError;

        const selectedProductDetails = items.map(item => {
            const fullProduct = fullProductsData.find(p => p.id === item.product_id) || {};
            
            let formattedDate: string | undefined;
            if (fullProduct?.last_purchase_date) {
                try {
                    const parsedDate = parseISO(fullProduct.last_purchase_date);
                    if (isValid(parsedDate)) {
                        formattedDate = format(parsedDate, 'yyyy-MM-dd');
                    }
                } catch (error) {}
            }

            return {
                ...fullProduct,
                id: item.product_id,
                name: item.name,
                editedName: item.name,
                editedPrice: item.unit_price,
                editedQuantity: item.quantity,
                editedSupplier: item.supplier,
                editedUnit: item.unit,
                editedStock: fullProduct?.quantity ?? 0,
                editedLastPrice: fullProduct?.last_purchase_price,
                editedLastPurchaseDate: formattedDate,
                editedLastQuantity: fullProduct?.last_purchase_quantity,
            };
        });

        navigate('/purchases/list', { state: { selectedProductDetails } });

    } catch (err: any) {
        addNotification('Erro ao preparar orçamento: ' + err.message, 'error');
    }
  };

  // --- ALTERAÇÃO: Nova função para lidar com a seleção manual de fornecedor ---
  const handleSupplierSelection = (productId: string, supplierName: string) => {
    setSelectedSuppliers(prev => ({
        ...prev,
        [productId]: supplierName,
    }));
  };

  if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-blue-600" /></div>;
  if (error) return <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4"><div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md"><AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" /><h1 className="text-2xl font-bold text-gray-800">Ocorreu um Erro</h1><p className="text-gray-600 mt-2">{error}</p></div></div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center mb-6">
          <Link to="/purchases" className="flex items-center text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            <ArrowLeft className="h-5 w-5 mr-2" />
            Voltar para Compras
          </Link>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center space-x-3">
            <BarChart2 className="h-8 w-8 text-blue-500" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">
                Análise de Cotação
              </h1>
              <p className="text-gray-600 dark:text-gray-400">{budgetData?.name}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Listas de Compra por Fornecedor (Baseado na sua seleção)</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                As listas abaixo são atualizadas dinamicamente conforme você seleciona os preços na tabela.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(recommendedPurchaseLists).map(([supplier, items]) => {
                    const total = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
                    return (
                        <div key={supplier} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-700/50">
                            <h3 className="font-bold text-lg text-blue-600 dark:text-blue-400">{supplier}</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-300">{items.length} item(ns)</p>
                            <p className="text-2xl font-bold text-gray-800 dark:text-white my-2">R$ {total.toFixed(2).replace('.', ',')}</p>
                            <button 
                                onClick={() => handleCreatePurchaseList(supplier, items)}
                                className="w-full mt-2 flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                <ShoppingCart className="h-4 w-4 mr-2" />
                                Gerar Orçamento
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white p-6">Tabela Comparativa de Preços</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-gray-700 z-10">Produto</th>
                  {budgetData?.supplier_quotes.map(quote => (
                    <th key={quote.id} className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      {quote.supplier_name}
                      <br/>
                      <span className="font-normal normal-case">Total: R$ {supplierTotals[quote.supplier_name]?.toFixed(2).replace('.', ',')}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {comparisonData.map(item => (
                  <tr key={item.productId}>
                    <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-white dark:bg-gray-800 z-10">
                      <div className="flex items-center">
                        <img src={item.imageUrl || 'https://placehold.co/40x40/e2e8f0/a0aec0?text=?'} alt={item.productName} className="w-10 h-10 rounded-md object-cover mr-3" />
                        <div>
                            <p className="font-medium text-gray-900 dark:text-white">{item.productName}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{item.requestedQuantity} {item.requestedUnit}</p>
                        </div>
                      </div>
                    </td>
                    {budgetData?.supplier_quotes.map(quote => {
                      const price = item.prices[quote.supplier_name];
                      const isBestPrice = price !== null && price === item.bestPrice;
                      // --- ALTERAÇÃO: Lógica para determinar se a célula está selecionada ---
                      const isSelected = selectedSuppliers[item.productId] === quote.supplier_name;
                      return (
                        <td 
                            key={quote.id} 
                            className={`px-6 py-4 whitespace-nowrap text-right cursor-pointer transition-all duration-200 
                                ${isSelected ? 'ring-2 ring-blue-500 ring-inset' : ''} 
                                ${isBestPrice && !isSelected ? 'bg-green-50 dark:bg-green-900/30' : ''}`
                            }
                            onClick={() => price !== null && handleSupplierSelection(item.productId, quote.supplier_name)}
                        >
                          {price !== null ? (
                            <span className={`font-semibold ${isBestPrice ? 'text-green-600 dark:text-green-300' : 'text-gray-800 dark:text-gray-200'}`}>
                              R$ {price.toFixed(2).replace('.', ',')}
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BudgetAnalysis;
