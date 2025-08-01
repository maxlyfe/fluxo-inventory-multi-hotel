import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2, CheckCircle, AlertTriangle, Building, ShoppingCart } from 'lucide-react';

// Interfaces para os dados que vamos buscar e enviar
interface BudgetItem {
  id: string; // id do dynamic_budget_items
  requested_quantity: number;
  requested_unit: string;
  product: {
    name: string;
    image_url?: string;
    description?: string;
  };
}

interface BudgetDetails {
  id: string;
  name: string;
  hotel: {
    name: string;
  };
  budget_items: BudgetItem[];
}

interface QuoteItem {
  budgetItemId: string;
  price: number | string;
}

const PublicQuotePage = () => {
  const { budgetId } = useParams<{ budgetId: string }>();
  const [budget, setBudget] = useState<BudgetDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    const fetchBudgetDetails = async () => {
      if (!budgetId) {
        setError('ID do orçamento não encontrado na URL.');
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
            hotel:hotels(name),
            budget_items:dynamic_budget_items(
              id,
              requested_quantity,
              requested_unit,
              product:products(name, image_url, description)
            )
          `)
          .eq('id', budgetId)
          .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error('Orçamento não encontrado.');

        setBudget(data as unknown as BudgetDetails);
        // Inicializa o estado para os preços dos itens
        setQuoteItems(data.budget_items.map(item => ({ budgetItemId: item.id, price: '' })));

      } catch (err: any) {
        setError('Não foi possível carregar os detalhes do orçamento. Verifique se o link está correto.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchBudgetDetails();
  }, [budgetId]);

  const handlePriceChange = (budgetItemId: string, price: string) => {
    const numericPrice = price.replace(',', '.');
    setQuoteItems(prev => 
      prev.map(item => 
        item.budgetItemId === budgetItemId ? { ...item, price: numericPrice } : item
      )
    );
  };

  const handleSubmitQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierName.trim()) {
      alert('Por favor, informe o nome da sua empresa.');
      return;
    }
    if (!budget) return;

    setIsSubmitting(true);
    try {
      // 1. Criar a cotação principal do fornecedor
      const { data: quoteData, error: quoteError } = await supabase
        .from('supplier_quotes')
        .insert({
          budget_id: budget.id,
          supplier_name: supplierName.trim(),
        })
        .select('id')
        .single();
      
      if (quoteError) throw quoteError;
      const quoteId = quoteData.id;

      // 2. Preparar e inserir os itens com preço
      const itemsToInsert = quoteItems
        .filter(item => item.price !== '' && !isNaN(Number(item.price)))
        .map(item => ({
          quote_id: quoteId,
          budget_item_id: item.budgetItemId,
          price: Number(item.price),
        }));

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from('supplier_quote_items')
          .insert(itemsToInsert);

        if (itemsError) throw itemsError;
      }
      
      setIsSubmitted(true);

    } catch (err: any) {
      alert('Ocorreu um erro ao enviar sua cotação. Por favor, tente novamente.\nDetalhes: ' + err.message);
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800">Ocorreu um Erro</h1>
          <p className="text-gray-600 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800">Obrigado!</h1>
          <p className="text-gray-600 mt-2">
            Sua cotação para o orçamento <strong>{budget?.name}</strong> foi enviada com sucesso para <strong>{budget?.hotel.name}</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 md:p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
        <header className="bg-blue-600 p-6 text-white">
          <div className="flex items-center space-x-4">
            <ShoppingCart className="h-10 w-10"/>
            <div>
                <h1 className="text-2xl md:text-3xl font-bold">Pedido de Cotação</h1>
                <p className="text-blue-200">Para: {budget?.hotel.name}</p>
            </div>
          </div>
          <p className="mt-2 text-lg">"{budget?.name}"</p>
        </header>

        <form onSubmit={handleSubmitQuote} className="p-6 md:p-8">
          <div className="mb-8 p-4 bg-gray-50 rounded-lg border">
            <label htmlFor="supplierName" className="block text-sm font-medium text-gray-700 mb-2">
              Nome da sua Empresa / Fornecedor *
            </label>
            <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400"/>
                {/* --- ALTERAÇÃO: Adicionado text-gray-900 para melhor contraste --- */}
                <input
                    id="supplierName"
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    required
                    placeholder="Digite o nome da sua empresa aqui"
                    className="w-full pl-10 p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
            </div>
          </div>

          <h2 className="text-xl font-semibold text-gray-800 mb-4">Itens Solicitados</h2>
          <div className="space-y-4">
            {budget?.budget_items.map((item, index) => (
              <div key={item.id} className="p-4 border rounded-lg grid grid-cols-1 md:grid-cols-4 gap-4 items-center bg-white">
                <div className="flex items-center space-x-4 md:col-span-2">
                  <img 
                    src={item.product.image_url || 'https://placehold.co/64x64/e2e8f0/a0aec0?text=?'} 
                    alt={item.product.name} 
                    className="w-16 h-16 rounded-md object-cover flex-shrink-0"
                  />
                  <div>
                    <p className="font-semibold text-gray-900">{item.product.name}</p>
                    {/* --- ALTERAÇÃO: Cor da descrição melhorada --- */}
                    <p className="text-sm text-gray-600">{item.product.description}</p>
                  </div>
                </div>
                
                <div className="text-center">
                  <p className="text-xs text-gray-600">Quantidade</p>
                  {/* --- ALTERAÇÃO: Cor e peso da fonte da quantidade melhorados --- */}
                  <p className="font-bold text-xl text-gray-900">{item.requested_quantity} <span className="text-base font-medium text-gray-700">{item.requested_unit}</span></p>
                </div>

                <div>
                  <label htmlFor={`price-${item.id}`} className="block text-xs text-gray-600 mb-1">
                    Preço Unitário (R$)
                  </label>
                  <input
                    id={`price-${item.id}`}
                    type="text"
                    inputMode="decimal"
                    value={quoteItems.find(q => q.budgetItemId === item.id)?.price || ''}
                    onChange={(e) => handlePriceChange(item.id, e.target.value)}
                    placeholder="0,00"
                    className="w-full p-2 border border-gray-300 rounded-md text-right focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              </div>
            ))}
          </div>

          <footer className="mt-8 pt-6 border-t">
            <p className="text-sm text-gray-600 mb-4">
              * Preencha o preço para os itens que você fornece. Itens com preço 0 ou em branco não serão incluídos na sua cotação.
            </p>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
            >
              {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : null}
              {isSubmitting ? 'Enviando...' : 'Enviar Cotação'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default PublicQuotePage;
