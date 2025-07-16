import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, ArrowLeft, Download, AlertTriangle, Calendar, Save, History, ExternalLink, Plus, Edit, X, Trash2, Copy, Image } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { saveBudget } from '../lib/supabase';
import { createNotification } from '../lib/notifications'; // Importação para o sistema de notificações

interface OnlineProduct {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  shipping: number;
  shippingFree: boolean;
  totalUnitPrice: number;
  totalPrice: number;
  productLink: string;
  imageUrl: string;
}

const OnlinePurchaseList = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [products, setProducts] = useState<OnlineProduct[]>([]);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [newProduct, setNewProduct] = useState<OnlineProduct>({
    id: '',
    name: '',
    quantity: 1,
    unitPrice: 0,
    shipping: 0,
    shippingFree: false,
    totalUnitPrice: 0,
    totalPrice: 0,
    productLink: '',
    imageUrl: ''
  });
  
  const today = format(new Date(), "dd/MM/yyyy", { locale: ptBR });
  const purchaseListRef = useRef<HTMLDivElement>(null);

  // Calcular preço unitário total e preço total quando os valores mudam
  useEffect(() => {
    const totalUnitPrice = newProduct.shippingFree 
      ? newProduct.unitPrice 
      : newProduct.unitPrice + (newProduct.shipping / newProduct.quantity);
    
    setNewProduct(prev => ({
      ...prev,
      totalUnitPrice,
      totalPrice: totalUnitPrice * prev.quantity
    }));
  }, [newProduct.unitPrice, newProduct.shipping, newProduct.quantity, newProduct.shippingFree]);

  // Calcular valor total do orçamento
  const totalBudgetValue = products.reduce((sum, product) => sum + product.totalPrice, 0);

  const handleInputChange = (field: keyof OnlineProduct, value: string | number | boolean) => {
    setNewProduct(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addProduct = async () => {
    if (!newProduct.name || newProduct.quantity <= 0 || newProduct.unitPrice <= 0) {
      addNotification("Preencha o nome, quantidade e preço unitário do produto.", "warning");
      return;
    }

    const productToAdd: OnlineProduct = {
      ...newProduct,
      id: `online-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    };

    setProducts(prev => [...prev, productToAdd]);
    resetNewProduct();
    setShowAddProductModal(false);
    addNotification(`${productToAdd.name} adicionado ao orçamento.`, "success");
  };

  const resetNewProduct = () => {
    setNewProduct({
      id: '',
      name: '',
      quantity: 1,
      unitPrice: 0,
      shipping: 0,
      shippingFree: false,
      totalUnitPrice: 0,
      totalPrice: 0,
      productLink: '',
      imageUrl: ''
    });
  };

  const removeProduct = (productId: string) => {
    setProducts(prev => prev.filter(product => product.id !== productId));
    addNotification("Produto removido do orçamento.", "info");
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link)
      .then(() => {
        addNotification("Link copiado para a área de transferência!", "success");
      })
      .catch(err => {
        console.error('Erro ao copiar link:', err);
        addNotification("Erro ao copiar link.", "error");
      });
  };

  const openLink = (link: string) => {
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  const saveBudgetToDatabase = async () => {
    if (!selectedHotel?.id) {
      setError('Hotel não selecionado. Impossível salvar o orçamento.');
      addNotification('Hotel não selecionado. Impossível salvar o orçamento.', 'error');
      return;
    }
    if (products.length === 0) {
      setError('Orçamento vazio. Adicione produtos antes de salvar.');
      addNotification('Orçamento vazio. Adicione produtos antes de salvar.', 'warning');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const budgetItems = products.map(product => {
        return {
          product_id: null, // Produtos online não têm ID no inventário
          custom_item_name: product.name,
          quantity: product.quantity,
          unit_price: product.totalUnitPrice,
          supplier: product.productLink ? new URL(product.productLink).hostname : 'Loja Online',
          last_purchase_quantity: null,
          last_purchase_price: null,
          last_purchase_date: null,
          weight: null,
          unit: 'und',
          stock_at_creation: null,
          // Campos adicionais específicos para orçamentos online
          is_online_product: true,
          product_link: product.productLink,
          shipping_cost: product.shippingFree ? 0 : product.shipping,
          shipping_free: product.shippingFree,
          image_url: product.imageUrl
        };
      });

      const result = await saveBudget(selectedHotel.id, totalBudgetValue, budgetItems);

      if (result.success) {
        addNotification('Orçamento online salvo com sucesso!', 'success');
        
        // Disparar notificação de novo orçamento para usuários com preferência
        try {
          // Determinar o fornecedor principal (site) para incluir na notificação
          let mainSupplier = 'Loja Online';
          if (products.length > 0 && products[0].productLink) {
            try {
              mainSupplier = new URL(products[0].productLink).hostname;
            } catch (e) {
              console.warn('Erro ao extrair hostname do link:', e);
            }
          }
          
          // Criar notificação para o evento NEW_BUDGET
          await createNotification({
            event_type: 'NEW_BUDGET',
            hotel_id: selectedHotel.id,
            title: 'Novo orçamento online criado',
            content: `Novo orçamento online de ${mainSupplier} no valor de R$ ${totalBudgetValue.toFixed(2).replace('.', ',')}`,
            link: `/budget/${result.data?.id || ''}`,
            metadata: {
              budget_id: result.data?.id || '',
              total_value: totalBudgetValue,
              supplier: mainSupplier,
              items_count: budgetItems.length,
              is_online: true
            }
          });
          
          console.log('Notificação de novo orçamento online enviada com sucesso');
        } catch (notificationError) {
          console.error('Erro ao enviar notificação de novo orçamento online:', notificationError);
          // Não interrompe o fluxo principal se a notificação falhar
        }
        
        // Opcionalmente limpar ou navegar
        // setProducts([]);
        // navigate('/budget-history');
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
    try {
      if (!purchaseListRef.current) {
        setError("Elemento da lista de compras não encontrado");
        addNotification("Elemento da lista de compras não encontrado", "error");
        return;
      }
      if (products.length === 0) {
        addNotification("Orçamento vazio. Adicione produtos para gerar a imagem.", "warning");
        return;
      }

      addNotification("Preparando imagem do orçamento...", "info");

      const tableHTML = `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: white; color: #333;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
            <h2 style="font-size: 24px; margin: 0;">Orçamento Online</h2>
            <div>${today}</div>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #f9fafb; text-align: left;">
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Produto</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Quantidade</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Unitário</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Frete</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Unit. c/ Frete</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Total</th>
              </tr>
            </thead>
            <tbody>
              ${products.map((product, index) => {
                const bgColor = index % 2 === 0 ? '#ffffff' : '#f9fafb';
                
                return `
                  <tr style="background-color: ${bgColor};">
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
                      <div style="display: flex; align-items: center;">
                        ${product.imageUrl ? `<img src="${product.imageUrl}" style="width: 50px; height: 50px; object-fit: cover; margin-right: 10px;" onerror="this.onerror=null; this.src='https://via.placeholder.com/50?text=Erro';" />` : ''}
                        <span>${product.name}</span>
                      </div>
                    </td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${product.quantity}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">R$ ${product.unitPrice.toFixed(2).replace('.', ',')}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${product.shippingFree ? 'FRETE GRÁTIS' : `R$ ${product.shipping.toFixed(2).replace('.', ',')}`}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">R$ ${product.totalUnitPrice.toFixed(2).replace('.', ',')}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">R$ ${product.totalPrice.toFixed(2).replace('.', ',')}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background-color: #f9fafb;">
                <td colspan="5" style="padding: 12px; border-top: 2px solid #e5e7eb; text-align: right; font-weight: 600; text-transform: uppercase;">Total Geral</td>
                <td style="padding: 12px; border-top: 2px solid #e5e7eb; font-weight: 600;">R$ ${totalBudgetValue.toFixed(2).replace('.', ',')}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;

      const renderDiv = document.createElement("div");
      renderDiv.style.position = "absolute";
      renderDiv.style.left = "-9999px";
      renderDiv.style.top = "0";
      renderDiv.innerHTML = tableHTML;
      document.body.appendChild(renderDiv);
      
      try {
        const html2canvas = (await import("html2canvas")).default;
        
        const canvas = await html2canvas(renderDiv, {
          scale: 2,
          logging: false,
          useCORS: true,
          allowTaint: true,
        });
        
        // Em vez de criar um link para download, copiar para a área de transferência
        canvas.toBlob(async (blob) => {
          if (!blob) {
            throw new Error('Falha ao gerar imagem');
          }
          
          try {
            // Verificar se a API Clipboard está disponível
            if (!navigator.clipboard || !navigator.clipboard.write) {
              // Fallback para método alternativo em navegadores que não suportam clipboard.write
              const imageData = canvas.toDataURL("image/png");
              
              // Criar um elemento temporário para copiar
              const tempInput = document.createElement('textarea');
              tempInput.value = 'Imagem do orçamento não pode ser copiada diretamente. Use o botão direito do mouse na imagem e selecione "Copiar imagem".';
              document.body.appendChild(tempInput);
              tempInput.select();
              document.execCommand('copy');
              document.body.removeChild(tempInput);
              
              // Mostrar a imagem em uma nova janela para que o usuário possa copiar manualmente
              const newWindow = window.open();
              if (newWindow) {
                newWindow.document.write(`
                  <html>
                    <head>
                      <title>Orçamento Online - ${today}</title>
                      <style>
                        body { display: flex; flex-direction: column; align-items: center; font-family: Arial, sans-serif; }
                        p { margin: 20px; text-align: center; }
                      </style>
                    </head>
                    <body>
                      <h2>Orçamento Online - ${today}</h2>
                      <p>Clique com o botão direito na imagem abaixo e selecione "Copiar imagem" para copiar para a área de transferência.</p>
                      <img src="${imageData}" alt="Orçamento Online" style="max-width: 100%;" />
                    </body>
                  </html>
                `);
                newWindow.document.close();
              }
              
              addNotification('Imagem gerada! Clique com o botão direito e selecione "Copiar imagem".', 'success');
            } else {
              // Usar a API moderna do Clipboard para copiar a imagem
              const clipboardItem = new ClipboardItem({
                [blob.type]: blob
              });
              
              await navigator.clipboard.write([clipboardItem]);
              addNotification('Imagem copiada para a área de transferência!', 'success');
            }
          } catch (clipboardError) {
            console.error('Erro ao copiar para a área de transferência:', clipboardError);
            
            // Fallback para download se a cópia falhar
            const imageData = canvas.toDataURL("image/png");
            const link = document.createElement('a');
            link.href = imageData;
            link.download = `orcamento_online_${format(new Date(), 'yyyy-MM-dd')}.png`;
            link.click();
            
            addNotification('Não foi possível copiar para a área de transferência. A imagem foi baixada.', 'warning');
          }
        }, 'image/png');
      } catch (renderError) {
        console.error('Erro ao renderizar HTML:', renderError);
        addNotification('Erro ao gerar imagem do orçamento', 'error');
      } finally {
        document.body.removeChild(renderDiv);
      }
    } catch (err) {
      console.error('Erro ao capturar orçamento:', err);
      addNotification('Erro ao gerar imagem do orçamento', 'error');
    }
  };

  // Função para verificar se uma URL é válida
  const isValidUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch (e) {
      return false;
    }
  };

  // Função para verificar se uma URL é uma imagem
  const isImageUrl = (url: string) => {
    return /\.(jpg|jpeg|png|webp|avif|gif|svg)$/.test(url.toLowerCase());
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
        <div className="flex items-center mb-4 md:mb-0">
          <Link to="/purchases/list" className="mr-4">
            <ArrowLeft className="h-6 w-6 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center">
            <ShoppingCart className="h-7 w-7 text-blue-600 dark:text-blue-400 mr-3" />
            Orçamento Online
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => navigate("/budget-history")}
            className="flex items-center px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
          >
            <History className="h-5 w-5 mr-2" />
            Histórico
          </button>
          <button
            onClick={captureAndCopyToClipboard}
            className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
            disabled={products.length === 0}
          >
            <Copy className="h-5 w-5 mr-2" />
            Copiar Imagem
          </button>
          <button
            onClick={saveBudgetToDatabase}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            disabled={products.length === 0 || isSaving}
          >
            {isSaving ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-5 w-5 mr-2" />
                Salvar Orçamento
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-md dark:bg-red-900 dark:text-red-200 dark:border-red-700" role="alert">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6 mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
          <div className="mb-4 md:mb-0">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
              {selectedHotel ? `Orçamento Online - ${selectedHotel.name}` : 'Orçamento Online'}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              <Calendar className="inline-block h-4 w-4 mr-1" />
              {today}
            </p>
          </div>
          <div>
            <button
              onClick={() => setShowAddProductModal(true)}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5 mr-2" />
              Adicionar Produto
            </button>
          </div>
        </div>

        <div ref={purchaseListRef}>
          {products.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
              <ShoppingCart className="h-12 w-12 mx-auto text-gray-400 dark:text-gray-500 mb-4" />
              <h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">Nenhum produto adicionado</h3>
              <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
                Adicione produtos ao orçamento online clicando no botão "Adicionar Produto" acima.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                      Produto
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                      Quantidade
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                      Valor Unitário
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                      Frete
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                      Valor Unit. c/ Frete
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                      Valor Total
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  {products.map((product) => (
                    <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {product.imageUrl && (
                            <div className="flex-shrink-0 h-10 w-10 mr-4">
                              <img
                                className="h-10 w-10 rounded-md object-cover"
                                src={product.imageUrl}
                                alt={product.name}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = 'https://via.placeholder.com/40?text=Erro';
                                }}
                              />
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-200">{product.name}</div>
                            {product.productLink && (
                              <div className="text-xs text-blue-600 dark:text-blue-400 flex items-center mt-1">
                                <button
                                  onClick={() => copyLink(product.productLink)}
                                  className="mr-2 hover:text-blue-800 dark:hover:text-blue-300"
                                  title="Copiar link"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => openLink(product.productLink)}
                                  className="hover:text-blue-800 dark:hover:text-blue-300 flex items-center"
                                  title="Abrir link"
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  <span className="truncate max-w-xs">
                                    {product.productLink.length > 30
                                      ? product.productLink.substring(0, 30) + '...'
                                      : product.productLink}
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {product.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        R$ {product.unitPrice.toFixed(2).replace('.', ',')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {product.shippingFree ? (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            FRETE GRÁTIS
                          </span>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">
                            R$ {product.shipping.toFixed(2).replace('.', ',')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        R$ {product.totalUnitPrice.toFixed(2).replace('.', ',')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">
                        R$ {product.totalPrice.toFixed(2).replace('.', ',')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => removeProduct(product.id)}
                          className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                          title="Remover produto"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-right text-sm font-medium text-gray-900 dark:text-gray-200">
                      Total Geral
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-gray-200">
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

      {/* Modal para adicionar produto */}
      {showAddProductModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 dark:bg-opacity-75 overflow-y-auto h-full w-full z-50 flex justify-center items-center px-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Adicionar Produto Online
              </h3>
              <button
                onClick={() => {
                  setShowAddProductModal(false);
                  resetNewProduct();
                }}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="productName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Nome do Produto *
                </label>
                <input
                  type="text"
                  id="productName"
                  value={newProduct.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="productQuantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Quantidade *
                  </label>
                  <input
                    type="number"
                    id="productQuantity"
                    value={newProduct.quantity}
                    onChange={(e) => handleInputChange('quantity', e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value)))}
                    min="1"
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="productUnitPrice" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Valor Unitário (R$) *
                  </label>
                  <input
                    type="number"
                    id="productUnitPrice"
                    value={newProduct.unitPrice || ''}
                    onChange={(e) => handleInputChange('unitPrice', e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value)))}
                    min="0"
                    step="0.01"
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="productShipping" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Valor do Frete (R$)
                  </label>
                  <input
                    type="number"
                    id="productShipping"
                    value={newProduct.shipping || ''}
                    onChange={(e) => handleInputChange('shipping', e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value)))}
                    min="0"
                    step="0.01"
                    disabled={newProduct.shippingFree}
                    className={`mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 ${
                      newProduct.shippingFree ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  />
                </div>
                <div className="flex items-center h-full pt-6">
                  <input
                    id="shippingFree"
                    type="checkbox"
                    checked={newProduct.shippingFree}
                    onChange={(e) => handleInputChange('shippingFree', e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded dark:border-gray-600 dark:bg-gray-700"
                  />
                  <label htmlFor="shippingFree" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                    Frete Grátis
                  </label>
                </div>
              </div>

              <div>
                <label htmlFor="productLink" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Link do Produto
                </label>
                <input
                  type="url"
                  id="productLink"
                  value={newProduct.productLink}
                  onChange={(e) => handleInputChange('productLink', e.target.value)}
                  placeholder="https://..."
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                />
                {newProduct.productLink && !isValidUrl(newProduct.productLink) && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">URL inválida. Inclua http:// ou https://</p>
                )}
              </div>

              <div>
                <label htmlFor="productImage" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Link da Imagem
                </label>
                <input
                  type="url"
                  id="productImage"
                  value={newProduct.imageUrl}
                  onChange={(e) => handleInputChange('imageUrl', e.target.value)}
                  placeholder="https://..."
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                />
                {newProduct.imageUrl && !isValidUrl(newProduct.imageUrl) && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">URL inválida. Inclua http:// ou https://</p>
                )}
                {newProduct.imageUrl && isValidUrl(newProduct.imageUrl) && !isImageUrl(newProduct.imageUrl) && (
                  <p className="mt-1 text-sm text-yellow-600 dark:text-yellow-400">
                    A URL não parece ser uma imagem. Certifique-se de que termina com .jpg, .png, etc.
                  </p>
                )}
              </div>

              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Resumo</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-gray-500 dark:text-gray-400">Valor unitário:</div>
                  <div className="text-gray-900 dark:text-gray-200">
                    R$ {newProduct.unitPrice.toFixed(2).replace('.', ',')}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">Frete por unidade:</div>
                  <div className="text-gray-900 dark:text-gray-200">
                    {newProduct.shippingFree
                      ? 'Grátis'
                      : `R$ ${(newProduct.shipping / newProduct.quantity).toFixed(2).replace('.', ',')}`}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">Valor unitário com frete:</div>
                  <div className="text-gray-900 dark:text-gray-200">
                    R$ {newProduct.totalUnitPrice.toFixed(2).replace('.', ',')}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">Quantidade:</div>
                  <div className="text-gray-900 dark:text-gray-200">{newProduct.quantity}</div>
                  <div className="text-gray-500 dark:text-gray-400 font-medium">Valor total:</div>
                  <div className="text-gray-900 dark:text-gray-200 font-medium">
                    R$ {newProduct.totalPrice.toFixed(2).replace('.', ',')}
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddProductModal(false);
                    resetNewProduct();
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:border-gray-600"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={addProduct}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600"
                  disabled={!newProduct.name || newProduct.quantity <= 0 || newProduct.unitPrice <= 0}
                >
                  Adicionar Produto
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnlinePurchaseList;
