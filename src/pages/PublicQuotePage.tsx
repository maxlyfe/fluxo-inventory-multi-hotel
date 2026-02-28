import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Loader2, CheckCircle, AlertTriangle, Building,
  ShoppingCart, RefreshCw, X
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface BudgetItem {
  id: string;
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
  hotel: { name: string };
  budget_items: BudgetItem[];
}

interface QuoteItem {
  budgetItemId: string;
  price: string; // preço direto (string para facilitar input)
}

/** Estado do formulário de substituto por item */
interface SubstituteOffer {
  enabled: boolean;
  name: string;        // ex: "Creme de leite Nestlé"
  unitSize: string;    // ex: "200"
  unitType: string;    // und | ml | L | g | kg
  price: string;       // preço do substituto
}

const UNIT_TYPES = ['und', 'ml', 'L', 'g', 'kg'] as const;

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

const PublicQuotePage = () => {
  const { budgetId } = useParams<{ budgetId: string }>();

  const [budget, setBudget] = useState<BudgetDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [substituteOffers, setSubstituteOffers] = useState<Record<string, SubstituteOffer>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // -------------------------------------------------------------------------
  // Fetch do orçamento
  // -------------------------------------------------------------------------

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

        // Inicializa estado de preços e substitutos
        const items = (data as any).budget_items as BudgetItem[];
        setQuoteItems(items.map(item => ({ budgetItemId: item.id, price: '' })));
        setSubstituteOffers(
          Object.fromEntries(
            items.map(item => [
              item.id,
              { enabled: false, name: '', unitSize: '', unitType: 'und', price: '' },
            ])
          )
        );
      } catch (err: any) {
        setError('Não foi possível carregar os detalhes do orçamento. Verifique se o link está correto.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchBudgetDetails();
  }, [budgetId]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handlePriceChange = (budgetItemId: string, value: string) => {
    setQuoteItems(prev =>
      prev.map(item =>
        item.budgetItemId === budgetItemId
          ? { ...item, price: value.replace(',', '.') }
          : item
      )
    );
  };

  const handleToggleSubstitute = (budgetItemId: string) => {
    setSubstituteOffers(prev => ({
      ...prev,
      [budgetItemId]: {
        ...prev[budgetItemId],
        enabled: !prev[budgetItemId].enabled,
      },
    }));
    // Limpa preço direto ao ativar substituto
    setQuoteItems(prev =>
      prev.map(item =>
        item.budgetItemId === budgetItemId ? { ...item, price: '' } : item
      )
    );
  };

  const handleSubstituteChange = (
    budgetItemId: string,
    field: keyof Omit<SubstituteOffer, 'enabled'>,
    value: string
  ) => {
    setSubstituteOffers(prev => ({
      ...prev,
      [budgetItemId]: { ...prev[budgetItemId], [field]: value },
    }));
  };

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const handleSubmitQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierName.trim()) {
      alert('Por favor, informe o nome da sua empresa.');
      return;
    }
    if (!budget) return;

    // Valida que pelo menos 1 item foi preenchido (direto ou substituto)
    const hasAnyItem = budget.budget_items.some(item => {
      const directPrice = quoteItems.find(q => q.budgetItemId === item.id)?.price;
      const sub = substituteOffers[item.id];
      const hasDirectPrice = directPrice && !isNaN(Number(directPrice)) && Number(directPrice) > 0;
      const hasSubstitute = sub?.enabled && sub.name.trim() && sub.price && Number(sub.price.replace(',', '.')) > 0;
      return hasDirectPrice || hasSubstitute;
    });

    if (!hasAnyItem) {
      alert('Preencha o preço de pelo menos um item ou ofereça um substituto.');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Cria a cotação do fornecedor
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

      // 2. Prepara os itens (diretos + substitutos)
      const itemsToInsert: any[] = [];

      budget.budget_items.forEach(item => {
        const directPrice = quoteItems.find(q => q.budgetItemId === item.id)?.price;
        const sub = substituteOffers[item.id];

        if (sub?.enabled && sub.name.trim() && sub.price) {
          // Oferta de substituto
          const subPrice = Number(sub.price.replace(',', '.'));
          if (!isNaN(subPrice) && subPrice > 0) {
            itemsToInsert.push({
              quote_id: quoteId,
              budget_item_id: item.id,
              price: subPrice,
              substitute_name: sub.name.trim(),
              substitute_unit_size: sub.unitSize ? Number(sub.unitSize) : null,
              substitute_unit_type: sub.unitType || null,
            });
          }
        } else if (directPrice && !isNaN(Number(directPrice)) && Number(directPrice) > 0) {
          // Preço direto
          itemsToInsert.push({
            quote_id: quoteId,
            budget_item_id: item.id,
            price: Number(directPrice),
            substitute_name: null,
            substitute_unit_size: null,
            substitute_unit_type: null,
          });
        }
        // Se nenhum dos dois → não insere (item sem cotação)
      });

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

  // -------------------------------------------------------------------------
  // Estados de loading / erro / sucesso
  // -------------------------------------------------------------------------

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
            Sua cotação para <strong>{budget?.name}</strong> foi enviada com sucesso para{' '}
            <strong>{budget?.hotel.name}</strong>.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render principal
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 md:p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">

        {/* Header */}
        <header className="bg-blue-600 p-6 text-white">
          <div className="flex items-center space-x-4">
            <ShoppingCart className="h-10 w-10 flex-shrink-0" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Pedido de Cotação</h1>
              <p className="text-blue-200">Para: {budget?.hotel.name}</p>
            </div>
          </div>
          <p className="mt-2 text-lg">"{budget?.name}"</p>
        </header>

        <form onSubmit={handleSubmitQuote} className="p-5 sm:p-8">

          {/* Nome do fornecedor */}
          <div className="mb-8 p-4 bg-gray-50 rounded-xl border border-gray-200">
            <label htmlFor="supplierName" className="block text-sm font-medium text-gray-700 mb-2">
              Nome da sua Empresa / Fornecedor *
            </label>
            <div className="relative">
              <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                id="supplierName"
                type="text"
                value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
                required
                placeholder="Digite o nome da sua empresa aqui"
                className="w-full pl-10 p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
          </div>

          {/* Lista de itens */}
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Itens Solicitados</h2>
          <p className="text-sm text-gray-500 mb-5">
            Preencha o preço para os itens que você fornece. Se não tiver o produto exato mas tiver
            um substituto, use o botão <strong>"Oferecer substituto"</strong>.
          </p>

          <div className="space-y-4">
            {budget?.budget_items.map(item => {
              const sub = substituteOffers[item.id];
              const directPrice = quoteItems.find(q => q.budgetItemId === item.id)?.price ?? '';

              return (
                <div
                  key={item.id}
                  className={`rounded-xl border overflow-hidden transition-all ${
                    sub?.enabled
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  {/* Linha principal do produto */}
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">

                    {/* Imagem + nome */}
                    <div className="flex items-center space-x-3 sm:col-span-2">
                      <img
                        src={item.product.image_url || 'https://placehold.co/64x64/e2e8f0/a0aec0?text=?'}
                        alt={item.product.name}
                        className="w-14 h-14 rounded-lg object-contain flex-shrink-0 bg-gray-50"
                        onError={e => { (e.target as HTMLImageElement).src = 'https://placehold.co/64x64/e2e8f0/a0aec0?text=?'; }}
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 leading-tight">{item.product.name}</p>
                        {item.product.description && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.product.description}</p>
                        )}
                      </div>
                    </div>

                    {/* Quantidade solicitada */}
                    <div className="text-center sm:text-left">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Solicitado</p>
                      <p className="font-bold text-xl text-gray-900">
                        {item.requested_quantity}{' '}
                        <span className="text-base font-medium text-gray-600">{item.requested_unit}</span>
                      </p>
                    </div>

                    {/* Preço direto (oculto quando substituto ativado) */}
                    {!sub?.enabled ? (
                      <div>
                        <label htmlFor={`price-${item.id}`} className="block text-xs text-gray-600 mb-1 font-medium">
                          Preço Unitário (R$)
                        </label>
                        <input
                          id={`price-${item.id}`}
                          type="text"
                          inputMode="decimal"
                          value={directPrice}
                          onChange={e => handlePriceChange(item.id, e.target.value)}
                          placeholder="0,00"
                          className="w-full p-2.5 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 font-medium"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-end sm:justify-start">
                        <span className="text-xs text-amber-600 font-medium italic">
                          Usando substituto
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Botão toggle substituto */}
                  <div className="px-4 pb-3 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleToggleSubstitute(item.id)}
                      className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                        sub?.enabled
                          ? 'bg-amber-200 text-amber-800 hover:bg-amber-300'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {sub?.enabled ? (
                        <>
                          <X className="w-3.5 h-3.5" />
                          Cancelar substituto
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" />
                          Não tenho — oferecer substituto
                        </>
                      )}
                    </button>
                  </div>

                  {/* Formulário de substituto */}
                  {sub?.enabled && (
                    <div className="px-4 pb-5 pt-1 border-t border-amber-200 bg-amber-50 space-y-3">
                      <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
                        ⚠️ Produto Substituto
                      </p>

                      {/* Nome do produto substituto */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Nome do produto + marca *
                        </label>
                        <input
                          type="text"
                          value={sub.name}
                          onChange={e => handleSubstituteChange(item.id, 'name', e.target.value)}
                          placeholder="Ex: Creme de leite Nestlé"
                          required={sub.enabled}
                          className="w-full p-2.5 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-900 bg-white text-sm"
                        />
                      </div>

                      {/* Apresentação: quantidade + unidade */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Apresentação por unidade
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="0"
                            inputMode="decimal"
                            value={sub.unitSize}
                            onChange={e => handleSubstituteChange(item.id, 'unitSize', e.target.value)}
                            placeholder="Ex: 200"
                            className="flex-1 p-2.5 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-900 bg-white text-sm"
                          />
                          <select
                            value={sub.unitType}
                            onChange={e => handleSubstituteChange(item.id, 'unitType', e.target.value)}
                            className="w-24 p-2.5 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-900 bg-white text-sm font-medium"
                          >
                            {UNIT_TYPES.map(u => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Ex: 200 ml, 1 kg, 500 g, 1 und
                        </p>
                      </div>

                      {/* Preço do substituto */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Preço unitário do substituto (R$) *
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={sub.price}
                          onChange={e => handleSubstituteChange(item.id, 'price', e.target.value.replace(',', '.'))}
                          placeholder="0,00"
                          required={sub.enabled}
                          className="w-full p-2.5 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 text-right font-bold text-gray-900 bg-white text-sm"
                        />
                      </div>

                      {/* Preview */}
                      {sub.name && sub.price && (
                        <div className="bg-amber-100 rounded-lg p-3 text-xs text-amber-800">
                          <strong>Resumo:</strong> {sub.name}
                          {sub.unitSize && sub.unitType && ` — ${sub.unitSize}${sub.unitType}`}
                          {' '}por{' '}
                          <strong>R$ {Number(sub.price || 0).toFixed(2).replace('.', ',')}</strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <footer className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500 mb-4">
              * Itens com preço em branco e sem substituto não serão incluídos na sua cotação.
            </p>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center px-6 py-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-wait transition-colors text-base shadow-lg shadow-blue-200"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin h-5 w-5 mr-2" />
                  Enviando...
                </>
              ) : (
                'Enviar Cotação'
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default PublicQuotePage;
