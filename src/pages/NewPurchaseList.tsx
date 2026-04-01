import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart, ArrowLeft, Download, AlertTriangle, Calendar, Save, History, ChevronDown, Plus, Edit, Copy, X, Layers } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { supabase, saveBudget, getHotelInventory } from '../lib/supabase';
import { createNotification } from "../lib/notifications";

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
  isCustom?:            boolean;
  isSubstitute?:        boolean;   // veio como substituto do BudgetAnalysis
  originalProductName?: string;    // nome do produto original no inventário
  // display strings for decimal input
  editedPrice_display?: string;
  editedQuantity_display?: string;
  editedLastQuantity_display?: string;
  editedLastPrice_display?: string;
}

interface StockSector {
  id:       string;
  name:     string;
  quantity: number; // quantidade do produto naquele setor
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
    quantity: string;
    unit: string;
    price: string;
    supplier: string;
  }>({
    name: '',
    quantity: '1',
    unit: 'und',
    price: '0',
    supplier: '',
  });
  const [searchTerm, setSearchTerm] = useState("");
  
  // --- ALTERAÇÃO: Lógica de inicialização para aceitar dados pré-preenchidos da análise ---
  const [products, setProducts] = useState<EditableProduct[]>(() => {
    const initialProducts = location.state?.selectedProductDetails || [];
    
    // Se os produtos já vierem com os campos 'edited', significa que vieram da página de análise.
    if (initialProducts.length > 0 && initialProducts[0].editedQuantity !== undefined) {
        return initialProducts;
    }

    // Lógica original para quando os produtos vêm da lista de estoque baixo.
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

  // Stock dropdown: sectorStocks[productId] = lista de setores com quantidade
  const [sectorStocks,      setSectorStocks]      = useState<Record<string, StockSector[]>>({});
  const [stockDropdownOpen, setStockDropdownOpen] = useState<string | null>(null); // productId com dropdown aberto
  const [loadingSectors,    setLoadingSectors]    = useState<string | null>(null); // productId carregando
  const [dropdownPosition, setDropdownPosition] = useState<{top: number; left: number}>({top: 0, left: 0});

  const today = format(new Date(), "dd/MM/yyyy", { locale: ptBR });

  // Fechar dropdown de stock ao clicar fora
  useEffect(() => {
    if (!stockDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-stock-dropdown]')) setStockDropdownOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [stockDropdownOpen]);
  
  const purchaseListRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  // Busca estoque de um produto em todos os setores com has_stock=true
  const fetchSectorStocks = async (productId: string, originalProductName: string) => {
    if (sectorStocks[productId] || !selectedHotel?.id) return;
    setLoadingSectors(productId);
    try {
      // sector_stock: quantity por setor — filtrar só setores com has_stock=true
      const { data: rawData, error } = await supabase
        .from('sector_stock')
        .select('quantity, sectors!inner(id, name, has_stock)')
        .eq('product_id', productId)
        .eq('sectors.has_stock', true);
      const data = rawData;
      if (error) throw error;
      const items: StockSector[] = (data ?? [])
        .filter((d: any) => d.sectors?.has_stock)
        .map((d: any) => ({
          id:       d.sectors.id,
          name:     d.sectors.name,
          quantity: d.quantity ?? 0,
        }));
      setSectorStocks(prev => ({ ...prev, [productId]: items }));
    } catch (e) {
      console.warn('fetchSectorStocks error:', e);
      setSectorStocks(prev => ({ ...prev, [productId]: [] }));
    } finally {
      setLoadingSectors(null);
    }
  };

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
    const numericValue = parseFloat(value.replace(',', '.'));
    const finalValue = value === '' ? undefined : (isNaN(numericValue) ? undefined : numericValue);
    const displayField = `${field}_display` as keyof EditableProduct;

    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.id === productId
          ? { ...product, [field]: finalValue, [displayField]: value }
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

        // Persiste o nome editado para qualquer produto (não só itens personalizados).
        // O product_id é mantido — na entrada em inventário o produto original é
        // atualizado corretamente. O custom_item_name é só para exibição no histórico.
        const nameChanged     = product.editedName && product.editedName !== product.name;
        const customNameValue = (product.isCustom || nameChanged)
          ? (product.editedName || product.name)
          : null;

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

      if (result.success && result.data) {
        addNotification('Orçamento salvo com sucesso!', 'success');
        
        try {
          const mainSupplier = budgetItems.find(item => item.supplier && item.supplier !== 'Não especificado')?.supplier || 'Não especificado';
          
          await createNotification({
            event_type: 'NEW_BUDGET',
            hotel_id: selectedHotel.id,
            title: `Novo orçamento - ${selectedHotel.name}`,
            content: `Novo orçamento de ${mainSupplier} no valor de R$ ${totalBudgetValue.toFixed(2).replace('.', ',')} para o hotel ${selectedHotel.name}`,
            link: `/authorizations`,
            metadata: {
              budget_id: result.data.id,
              total_value: totalBudgetValue,
              supplier: mainSupplier,
              items_count: budgetItems.length,
              hotel_name: selectedHotel.name
            }
          });
          
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
    try {
      if (!purchaseListRef.current) {
        setError("Elemento da lista de compras não encontrado");
        addNotification("Elemento da lista de compras não encontrado", "error");
        return;
      }
      if (products.length === 0) {
        addNotification("Orçamento vazio. Adicione itens para gerar a imagem.", "warning");
        return;
      }

      addNotification("Preparando imagem do orçamento...", "info");

      const tableHTML = `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: white; color: #333;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
            <h2 style="font-size: 24px; margin: 0;">Orçamento - ${selectedHotel?.name || 'Hotel'}</h2>
            <div>${today}</div>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #f9fafb; text-align: left;">
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Item</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Quantidade</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Unidade</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Fornecedor</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Qtd. Últ. Compra</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Data Últ. Compra</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Últ. Compra</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Unitário</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Valor Total</th>
                <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">Estoque (Orçam.)</th>
                </tr>
            </thead>
            <tbody>
              ${products.map((product, index) => {
                let unitDisplay = '';
                const unitValue = product.editedUnit || '';
                if (unitValue === 'outro') {
                  unitDisplay = product.editedUnit || 'Outro';
                } else {
                  const unitOption = unitOptions.find(opt => opt.value === unitValue);
                  unitDisplay = unitOption ? unitOption.label : unitValue;
                }
                
                const quantity = product.editedQuantity ?? 0;
                const price = product.editedPrice ?? 0;
                const totalItemValue = quantity * price;
                const bgColor = index % 2 === 0 ? '#ffffff' : '#f9fafb';
                
                let displayDate = '-';
                if (product.editedLastPurchaseDate) {
                  try {
                    const dateString = product.editedLastPurchaseDate;
                    const parsedDate = new Date(dateString + 'T00:00:00');
                    if (isValid(parsedDate)) {
                      displayDate = format(parsedDate, 'dd/MM/yyyy', { locale: ptBR });
                    }
                  } catch { /* Ignore */ }
                }
                
                return `
                  <tr style="background-color: ${bgColor};">
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
                      ${product.editedName || product.name} ${product.isCustom ? '<span style="font-size: 10px; background: #e9d5ff; color: #6b21a8; padding: 2px 4px; border-radius: 4px; margin-left: 4px;">Personalizado</span>' : ''}
                    </td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${quantity}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${unitDisplay}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${product.editedSupplier || product.supplier || '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${product.editedLastQuantity ?? '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${displayDate}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${product.editedLastPrice != null ? `R$ ${product.editedLastPrice.toFixed(2).replace('.', ',')}` : '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${price != null ? `R$ ${price.toFixed(2).replace('.', ',')}` : '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${`R$ ${totalItemValue.toFixed(2).replace('.', ',')}`}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${product.isCustom ? '-' : (product.editedStock ?? '-')}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background-color: #f9fafb;">
                <td colspan="8" style="padding: 12px; border-top: 2px solid #e5e7eb; text-align: right; font-weight: bold;">Total Geral:</td>
                <td style="padding: 12px; border-top: 2px solid #e5e7eb; font-weight: bold;">R$ ${totalBudgetValue.toFixed(2).replace('.', ',')}</td>
                <td colspan="2" style="padding: 12px; border-top: 2px solid #e5e7eb;"></td>
              </tr>
            </tfoot>
          </table>
          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; color: #444;">
            <p style="margin: 0 0 5px 0; font-size: 16px;"><strong>${products.find(p => p.editedSupplier || p.supplier)?.editedSupplier || products.find(p => p.editedSupplier || p.supplier)?.supplier || 'Fornecedor'},</strong></p>
            <p style="margin: 5px 0; font-size: 14px;">FANTASIA: <strong>${selectedHotel?.fantasy_name || selectedHotel?.name || 'Hotel'}</strong></p>
            <p style="margin: 5px 0; font-size: 14px;">RAZÃO SOCIAL: ${selectedHotel?.corporate_name || 'Meridiana Turismo LTDA'}</p>
            <p style="margin: 5px 0; font-size: 14px;">CNPJ: ${selectedHotel?.cnpj || '39.232.073/0001-44'}</p>
          </div>
        </div>
      `;

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = tableHTML;
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px'; 
      document.body.appendChild(tempDiv);

      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(tempDiv.firstElementChild as HTMLElement, { 
        scale: 2, 
        backgroundColor: null, 
        logging: false, 
        useCORS: true 
      });
      
      document.body.removeChild(tempDiv);

      canvas.toBlob(async (blob) => {
        if (blob) {
          try {
            // Identifica o fornecedor principal (o primeiro da lista que não seja vazio)
            const mainSupplier = products.find(p => p.editedSupplier || p.supplier)?.editedSupplier || 
                               products.find(p => p.editedSupplier || p.supplier)?.supplier || 
                               'Fornecedor';

            // Monta o texto com os dados do hotel
            const hotelText = `
${mainSupplier},

FANTASIA: *${selectedHotel?.fantasy_name || selectedHotel?.name || 'Hotel'}*
RAZÃO SOCIAL: ${selectedHotel?.corporate_name || 'Meridiana Turismo LTDA'}
CNPJ: ${selectedHotel?.cnpj || '39.232.073/0001-44'}
`.trim();

            // Copiar apenas a imagem para garantir prioridade absoluta em todos os dispositivos
            const data = [
              new ClipboardItem({
                'image/png': blob
              })
            ];

            await navigator.clipboard.write(data);
            addNotification("Imagem do orçamento copiada com sucesso!", "success");
          } catch (clipboardError) {
            console.error('Erro ao copiar para área de transferência:', clipboardError);
            addNotification("Erro ao copiar imagem. Tente novamente.", "error");
          }
        }
      }, 'image/png');
    } catch (err) {
      console.error('Error in captureAndCopyToClipboard:', err);
      const message = err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.';
      setError(`Erro ao gerar imagem: ${message}`);
      addNotification(`Erro ao gerar imagem: ${message}`, 'error');
    }
  };

  const exportToExcel = () => {
    if (products.length === 0) {
      addNotification("Orçamento vazio. Adicione itens para exportar.", "warning");
      return;
    }

    const data = products.map(product => {
      let unitDisplay = '';
      const unitValue = product.editedUnit || '';
      if (unitValue === 'outro') {
        unitDisplay = product.editedUnit || 'Outro';
      } else {
        const unitOption = unitOptions.find(opt => opt.value === unitValue);
        unitDisplay = unitOption ? unitOption.label : unitValue;
      }

      let displayDate = '-';
      if (product.editedLastPurchaseDate) {
        try {
          const dateString = product.editedLastPurchaseDate;
          const parsedDate = new Date(dateString + 'T00:00:00');
          if (isValid(parsedDate)) {
            displayDate = format(parsedDate, 'dd/MM/yyyy', { locale: ptBR });
          }
        } catch { /* Ignore */ }
      }

      const quantity = product.editedQuantity ?? 0;
      const price = product.editedPrice ?? 0;
      const totalItemValue = quantity * price;

      return {
        'Item': product.editedName || product.name,
        'Quantidade': quantity,
        'Unidade': unitDisplay,
        'Fornecedor': product.editedSupplier || product.supplier || '-',
        'Qtd. Últ. Compra': product.editedLastQuantity ?? '-',
        'Data Últ. Compra': displayDate,
        'Valor Últ. Compra': product.editedLastPrice != null ? `R$ ${product.editedLastPrice.toFixed(2).replace('.', ',')}` : '-',
        'Valor Unitário': price != null ? `R$ ${price.toFixed(2).replace('.', ',')}` : '-',
        'Valor Total': `R$ ${totalItemValue.toFixed(2).replace('.', ',')}`,
        'Estoque (Orçam.)': product.isCustom ? '-' : (product.editedStock ?? '-'),
      };
    });

    data.push({
      'Item': 'TOTAL GERAL',
      'Quantidade': '',
      'Unidade': '',
      'Fornecedor': '',
      'Qtd. Últ. Compra': '',
      'Data Últ. Compra': '',
      'Valor Últ. Compra': '',
      'Valor Unitário': '',
      'Valor Total': `R$ ${totalBudgetValue.toFixed(2).replace('.', ',')}`,
      'Estoque (Orçam.)': '',
    });

    const ws = XLSX.utils.json_to_sheet(data);
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
      editedPrice: parseFloat(customItem.price.replace(',', '.')) || 0,
      editedQuantity: parseFloat(customItem.quantity.replace(',', '.')) || 0,
      editedUnit: customItem.unit,
      editedSupplier: customItem.supplier,
      isCustom: true,
    };

    setProducts(prev => [...prev, newCustomProduct]);
    setCustomItem({
      name: '',
      quantity: '1',
      unit: 'und',
      price: '0',
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
        {/* Header — responsivo */}
        <div className="mb-6">
          {/* Linha 1: voltar + título */}
          <div className="flex items-center gap-3 mb-3">
            <Link
              to="/purchases"
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex-shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <ShoppingCart className="h-6 w-6 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white truncate">
                Novo Orçamento (Físico)
              </h1>
            </div>
          </div>

          {/* Linha 2: ações — ícones+label no mobile, texto completo no desktop */}
          <div className="flex items-center gap-2 flex-wrap">

            <button
              onClick={captureAndCopyToClipboard}
              className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
            >
              <Copy className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Copiar Imagem</span>
              <span className="sm:hidden">Imagem</span>
            </button>
            <button
              onClick={exportToExcel}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
            >
              <Download className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Exportar Excel</span>
              <span className="sm:hidden">Excel</span>
            </button>
            <button
              onClick={saveBudgetToDatabase}
              disabled={isSaving || products.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm font-medium ml-auto sm:ml-0"
            >
              <Save className="h-4 w-4 flex-shrink-0" />
              <span>{isSaving ? 'Salvando...' : 'Salvar Orçamento'}</span>
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Adicionar Itens</h3>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setShowAddItemModal(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium text-sm"
              >
                <Plus className="h-4 w-4" />
                Adicionar do Inventário
              </button>
              <button
                onClick={() => setShowCustomItemModal(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium text-sm"
              >
                <Edit className="h-4 w-4" />
                Item Personalizado
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
              <>
                {/* ── MOBILE: cards por produto (< md) ── */}
                <div className="md:hidden space-y-3">
                  {products.map((product) => (
                    <div key={product.id} className="bg-gray-50 dark:bg-gray-700/60 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                      {/* Card header: nome + delete */}
                      <div className="flex items-start gap-2 px-4 pt-4 pb-2">
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            value={product.editedName || product.name}
                            onChange={(e) => handleTextChange(product.id, 'editedName', e.target.value)}
                            className="w-full bg-transparent text-sm font-semibold text-gray-900 dark:text-white border-b border-dashed border-gray-300 dark:border-gray-500 focus:outline-none focus:border-blue-500 pb-0.5"
                            title="Toque para editar o nome neste orçamento"
                            placeholder={product.name}
                          />
                          <div className="mt-0.5">
                            {product.isCustom
                              ? <span className="text-[11px] text-purple-500 font-medium">✦ Personalizado</span>
                              : product.isSubstitute
                                ? <span className="text-[11px] text-blue-500 font-medium" title={`Substituto de: ${product.originalProductName || 'produto original'}`}>⇄ sub. de "{product.originalProductName}"</span>
                                : (product.editedName && product.editedName !== product.name)
                                  ? <span className="text-[11px] text-amber-500 font-medium" title={`Original: ${product.name}`}>✎ editado</span>
                                  : null
                            }
                          </div>
                        </div>
                        <button
                          onClick={() => removeProductFromList(product.id)}
                          className="flex-shrink-0 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Row 1: Qtd + Unidade + Fornecedor */}
                      <div className="grid grid-cols-3 gap-0 border-t border-gray-200 dark:border-gray-700">
                        <div className="px-3 py-2.5 border-r border-gray-200 dark:border-gray-700">
                          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Qtd.</p>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={product.editedQuantity_display ?? (product.editedQuantity !== undefined ? String(product.editedQuantity) : '')}
                            onChange={(e) => handleValueChange(product.id, 'editedQuantity', e.target.value)}
                            className="w-full bg-transparent text-sm font-bold text-gray-900 dark:text-white border-b border-dashed border-gray-300 dark:border-gray-500 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="px-3 py-2.5 border-r border-gray-200 dark:border-gray-700">
                          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Unid.</p>
                          <select
                            value={product.editedUnit || ''}
                            onChange={(e) => handleUnitChange(product.id, e.target.value)}
                            className="w-full bg-transparent dark:bg-gray-800 text-sm text-gray-900 dark:text-white border-b border-dashed border-gray-300 dark:border-gray-500 focus:outline-none focus:border-blue-500"
                          >
                            {unitOptions.map(opt => <option key={opt.value} value={opt.value} className="bg-white dark:bg-gray-800 dark:text-white">{opt.value || '—'}</option>)}
                          </select>
                        </div>
                        <div className="px-3 py-2.5">
                          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Fornecedor</p>
                          <input
                            type="text"
                            value={product.editedSupplier || product.supplier || ''}
                            onChange={(e) => handleTextChange(product.id, 'editedSupplier', e.target.value)}
                            className="w-full bg-transparent text-sm text-gray-900 dark:text-white border-b border-dashed border-gray-300 dark:border-gray-500 focus:outline-none focus:border-blue-500"
                            placeholder="—"
                          />
                        </div>
                      </div>

                      {/* Row 2: Preço unit + Total destacado */}
                      <div className="grid grid-cols-2 gap-0 border-t border-gray-200 dark:border-gray-700">
                        <div className="px-3 py-2.5 border-r border-gray-200 dark:border-gray-700">
                          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Preço Unit.</p>
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-gray-400">R$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={product.editedPrice_display ?? (product.editedPrice !== undefined ? String(product.editedPrice) : '')}
                              onChange={(e) => handleValueChange(product.id, 'editedPrice', e.target.value)}
                              className="w-full bg-transparent text-sm font-semibold text-gray-900 dark:text-white border-b border-dashed border-gray-300 dark:border-gray-500 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>
                        <div className="px-3 py-2.5 bg-blue-50 dark:bg-blue-900/20">
                          <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wide mb-1">Total</p>
                          <p className="text-base font-black text-blue-700 dark:text-blue-300">
                            R$ {((product.editedQuantity ?? 0) * (product.editedPrice ?? 0)).toFixed(2).replace('.', ',')}
                          </p>
                        </div>
                      </div>

                      {/* Row 3: Histórico + Stock — colapsável */}
                      <details className="border-t border-gray-200 dark:border-gray-700">
                        <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none text-[11px] font-bold text-gray-400 uppercase tracking-wide hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors list-none">
                          <span className="flex items-center gap-1.5">
                            <History className="h-3 w-3" /> Histórico & Stock
                          </span>
                          <ChevronDown className="h-3.5 w-3.5" />
                        </summary>
                        <div className="grid grid-cols-2 gap-0 bg-gray-100/50 dark:bg-gray-800/30">
                          <div className="px-3 py-2.5 border-r border-b border-gray-200 dark:border-gray-700">
                            <p className="text-[11px] font-bold text-gray-400 uppercase mb-1">Últ. Qtd.</p>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={product.editedLastQuantity_display ?? (product.editedLastQuantity !== undefined ? String(product.editedLastQuantity) : '')}
                              onChange={(e) => handleValueChange(product.id, 'editedLastQuantity', e.target.value)}
                              className="w-full bg-transparent text-sm text-gray-700 dark:text-gray-300 border-b border-dashed border-gray-300 dark:border-gray-500 focus:outline-none"
                              disabled={product.isCustom}
                            />
                          </div>
                          <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700">
                            <p className="text-[11px] font-bold text-gray-400 uppercase mb-1">Últ. Preço</p>
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-gray-400">R$</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={product.editedLastPrice_display ?? (product.editedLastPrice !== undefined ? String(product.editedLastPrice) : '')}
                                onChange={(e) => handleValueChange(product.id, 'editedLastPrice', e.target.value)}
                                className="w-full bg-transparent text-sm text-gray-700 dark:text-gray-300 border-b border-dashed border-gray-300 dark:border-gray-500 focus:outline-none"
                                disabled={product.isCustom}
                              />
                            </div>
                          </div>
                          <div className="px-3 py-2.5 border-r border-gray-200 dark:border-gray-700">
                            <p className="text-[11px] font-bold text-gray-400 uppercase mb-1">Últ. Data</p>
                            <input
                              type="date"
                              value={product.editedLastPurchaseDate || ''}
                              onChange={(e) => handleTextChange(product.id, 'editedLastPurchaseDate', e.target.value)}
                              className="w-full bg-transparent text-xs text-gray-700 dark:text-gray-300 border-b border-dashed border-gray-300 dark:border-gray-500 focus:outline-none"
                              disabled={product.isCustom}
                            />
                          </div>
                          <div className="px-3 py-2.5 relative">
                            <p className="text-[11px] font-bold text-gray-400 uppercase mb-1">Stock</p>
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={product.editedStock ?? ''}
                                onChange={(e) => handleTextChange(product.id, 'editedStock', e.target.value)}
                                className="w-14 bg-transparent text-sm text-gray-700 dark:text-gray-300 border-b border-dashed border-gray-300 dark:border-gray-500 focus:outline-none"
                                disabled={product.isCustom}
                              />
                              {!product.isCustom && product.id && !product.id.startsWith('custom-') && (
                                <button
                                  data-stock-dropdown
                                  title="Stock por setor"
                                  onClick={() => {
                                    if (stockDropdownOpen === product.id) {
                                      setStockDropdownOpen(null);
                                    } else {
                                      fetchSectorStocks(product.id, product.name);
                                      setStockDropdownOpen(product.id);
                                    }
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-indigo-500 transition-colors"
                                >
                                  <Layers className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            {/* Dropdown stock por setor — mobile */}
                            {stockDropdownOpen === product.id && (
                              <div data-stock-dropdown className="absolute z-30 bottom-full left-0 mb-1 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Stock por Setor</span>
                                  <button onClick={() => setStockDropdownOpen(null)} className="text-gray-400 hover:text-gray-600"><X className="h-3 w-3" /></button>
                                </div>
                                {loadingSectors === product.id ? (
                                  <div className="px-3 py-3 text-xs text-gray-400 text-center">A carregar...</div>
                                ) : (sectorStocks[product.id] ?? []).length === 0 ? (
                                  <div className="px-3 py-3 text-xs text-gray-400 text-center">Sem stock em setores</div>
                                ) : (
                                  <>
                                    <button onClick={() => { handleTextChange(product.id, 'editedStock', String(product.quantity ?? 0)); setStockDropdownOpen(null); }} className="w-full flex items-center justify-between px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-sm transition-colors border-b border-gray-100 dark:border-gray-700">
                                      <span className="text-gray-700 dark:text-gray-300 font-medium">Inventário Central</span>
                                      <span className="text-indigo-600 font-bold">{product.quantity ?? 0}</span>
                                    </button>
                                    {(sectorStocks[product.id] ?? []).map(sector => (
                                      <button key={sector.id} onClick={() => { handleTextChange(product.id, 'editedStock', String(sector.quantity)); setStockDropdownOpen(null); }} className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm transition-colors">
                                        <span className="text-gray-700 dark:text-gray-300 truncate">{sector.name}</span>
                                        <span className="text-gray-900 dark:text-gray-100 font-bold ml-2">{sector.quantity}</span>
                                      </button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </details>
                    </div>
                  ))}

                  {/* Total mobile */}
                  <div className="flex items-center justify-between bg-blue-600 dark:bg-blue-700 rounded-2xl px-5 py-4 mt-2">
                    <span className="text-sm font-bold text-blue-100 uppercase tracking-wide">Total Geral</span>
                    <span className="text-2xl font-black text-white">R$ {totalBudgetValue.toFixed(2).replace('.', ',')}</span>
                  </div>
                </div>

                {/* ── DESKTOP: tabela (≥ md) ── */}
                <div className="hidden md:block overflow-x-auto" ref={tableRef}>
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
                        Valor Unitário
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[8%]">
                        Valor Total
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[8%]">
                        Estoque (Orçam.)
                      </th>
                      <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300 w-[5%]">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                    {products.map((product) => (
                      <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-3">
                          <input 
                            type="text" 
                            value={product.editedName || product.name}
                            onChange={(e) => handleTextChange(product.id, 'editedName', e.target.value)}
                            className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:ring-0 focus:border-blue-500 text-sm text-gray-900 dark:text-gray-200 p-1"
                            title="Clique para editar o nome neste orçamento (não altera o inventário)"
                            placeholder={product.name}
                          />
                          {product.isCustom
                            ? <span className="text-xs text-purple-600 dark:text-purple-400 block mt-1">Personalizado</span>
                            : product.isSubstitute
                              ? <span
                                  className="text-xs text-blue-500 dark:text-blue-400 block mt-1 cursor-help"
                                  title={`Substituto de: ${product.originalProductName || 'produto original'}. O histórico e stock exibidos são do produto original.`}
                                >
                                  ⇄ substituto {product.originalProductName ? `de "${product.originalProductName}"` : ''}
                                </span>
                              : (product.editedName && product.editedName !== product.name)
                                ? <span className="text-xs text-amber-500 dark:text-amber-400 block mt-1" title={`Nome original: ${product.name}`}>✎ editado</span>
                                : null
                          }
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={product.editedQuantity_display ?? (product.editedQuantity !== undefined ? String(product.editedQuantity) : '')}
                            onChange={(e) => handleValueChange(product.id, 'editedQuantity', e.target.value)}
                            className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:ring-0 focus:border-blue-500 text-sm text-gray-900 dark:text-gray-200 p-1"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="relative">
                            <select 
                              value={product.editedUnit || ''}
                              onChange={(e) => handleUnitChange(product.id, e.target.value)}
                              className="w-full bg-transparent dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600 focus:ring-0 focus:border-blue-500 text-sm text-gray-900 dark:text-gray-200 p-1 pr-6"
                            >
                              {unitOptions.map(opt => <option key={opt.value} value={opt.value} className="bg-white dark:bg-gray-800 dark:text-white">{opt.label}</option>)}
                            </select>
                            {customUnitOpen[product.id] && (
                              <input 
                                type="text" 
                                placeholder="Unidade" 
                                value={product.editedUnit === 'outro' ? '' : product.editedUnit}
                                onChange={(e) => handleTextChange(product.id, 'editedUnit', e.target.value)}
                                className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg p-1 text-sm z-10"
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <input 
                            type="text" 
                            value={product.editedSupplier || product.supplier || ''}
                            onChange={(e) => handleTextChange(product.id, 'editedSupplier', e.target.value)}
                            className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:ring-0 focus:border-blue-500 text-sm text-gray-900 dark:text-gray-200 p-1"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={product.editedLastQuantity_display ?? (product.editedLastQuantity !== undefined ? String(product.editedLastQuantity) : '')}
                            onChange={(e) => handleValueChange(product.id, 'editedLastQuantity', e.target.value)}
                            className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:ring-0 focus:border-blue-500 text-sm text-gray-900 dark:text-gray-200 p-1"
                            disabled={product.isCustom}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input 
                            type="date" 
                            value={product.editedLastPurchaseDate || ''}
                            onChange={(e) => handleTextChange(product.id, 'editedLastPurchaseDate', e.target.value)}
                            className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:ring-0 focus:border-blue-500 text-sm text-gray-900 dark:text-gray-200 p-1"
                            disabled={product.isCustom}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={product.editedLastPrice_display ?? (product.editedLastPrice !== undefined ? String(product.editedLastPrice) : '')}
                            onChange={(e) => handleValueChange(product.id, 'editedLastPrice', e.target.value)}
                            className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:ring-0 focus:border-blue-500 text-sm text-gray-900 dark:text-gray-200 p-1"
                            disabled={product.isCustom}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={product.editedPrice_display ?? (product.editedPrice !== undefined ? String(product.editedPrice) : '')}
                            onChange={(e) => handleValueChange(product.id, 'editedPrice', e.target.value)}
                            className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:ring-0 focus:border-blue-500 text-sm text-gray-900 dark:text-gray-200 p-1"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                            R$ {((product.editedQuantity ?? 0) * (product.editedPrice ?? 0)).toFixed(2).replace('.', ',')}
                          </span>
                        </td>
                        <td className="px-4 py-3 relative">
                          <div className="flex items-center gap-1">
                            <input 
                              type="text" 
                              value={product.editedStock ?? ''}
                              onChange={(e) => handleTextChange(product.id, 'editedStock', e.target.value)}
                              className="w-16 bg-transparent border-b border-gray-300 dark:border-gray-600 focus:ring-0 focus:border-blue-500 text-sm text-gray-900 dark:text-gray-200 p-1"
                              disabled={product.isCustom}
                            />
                            {!product.isCustom && product.id && !product.id.startsWith('custom-') && (
                              <button
                                data-stock-dropdown
                                title="Ver stock por setor"
                                onClick={(e) => {
                                  if (stockDropdownOpen === product.id) {
                                    setStockDropdownOpen(null);
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setDropdownPosition({ top: rect.bottom + 4, left: Math.max(8, rect.left - 180) });
                                    fetchSectorStocks(product.id, product.name);
                                    setStockDropdownOpen(product.id);
                                  }
                                }}
                                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-indigo-500 transition-colors"
                              >
                                <Layers className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {/* Dropdown de stock por setor */}
                          {stockDropdownOpen === product.id && (
                            <div data-stock-dropdown className="fixed z-50 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}>
                              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Stock por Setor</span>
                                <button onClick={() => setStockDropdownOpen(null)} className="text-gray-400 hover:text-gray-600"><X className="h-3 w-3" /></button>
                              </div>
                              {loadingSectors === product.id ? (
                                <div className="px-3 py-3 text-xs text-gray-400 text-center">A carregar...</div>
                              ) : (sectorStocks[product.id] ?? []).length === 0 ? (
                                <div className="px-3 py-3 text-xs text-gray-400 text-center">Sem stock em setores</div>
                              ) : (
                                <>
                                  {/* Inventário central — sempre primeiro */}
                                  <button
                                    onClick={() => {
                                      handleTextChange(product.id, 'editedStock', String(product.quantity ?? 0));
                                      setStockDropdownOpen(null);
                                    }}
                                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-sm transition-colors border-b border-gray-100 dark:border-gray-700"
                                  >
                                    <span className="text-gray-700 dark:text-gray-300 font-medium">Inventário Central</span>
                                    <span className="text-indigo-600 dark:text-indigo-400 font-bold">{product.quantity ?? 0}</span>
                                  </button>
                                  {(sectorStocks[product.id] ?? []).map(sector => (
                                    <button
                                      key={sector.id}
                                      onClick={() => {
                                        handleTextChange(product.id, 'editedStock', String(sector.quantity));
                                        setStockDropdownOpen(null);
                                      }}
                                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm transition-colors"
                                    >
                                      <span className="text-gray-700 dark:text-gray-300 truncate">{sector.name}</span>
                                      <span className="text-gray-900 dark:text-gray-100 font-bold ml-2">{sector.quantity}</span>
                                    </button>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => removeProductFromList(product.id)}
                            className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <td colSpan={8} className="px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-gray-200">
                        Total Geral:
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-gray-900 dark:text-gray-200">
                        R$ {totalBudgetValue.toFixed(2).replace('.', ',')}
                      </td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              </>
            )}
          </div>
        </div>

        {/* Modal para adicionar item do inventário — bottom sheet no mobile */}
        {showAddItemModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl">
              <div className="sticky top-0 bg-white dark:bg-gray-800 px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Adicionar Item do Inventário</h3>
                <button
                  onClick={() => setShowAddItemModal(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Buscar item..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredInventory.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                    {searchTerm ? 'Nenhum item encontrado.' : 'Digite para buscar itens do inventário.'}
                  </p>
                ) : (
                  filteredInventory.map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between items-center p-3 border border-gray-200 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <div>
                        <h4 className="font-medium text-gray-800 dark:text-white">{item.name}</h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Estoque: {item.quantity} | Categoria: {item.category}
                        </p>
                      </div>
                      <button
                        onClick={() => handleAddItem(item)}
                        className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                      >
                        Adicionar
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal para adicionar item personalizado */}
        {showCustomItemModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Adicionar Item Personalizado</h3>
                <button
                  onClick={() => setShowCustomItemModal(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nome do Item
                  </label>
                  <input
                    type="text"
                    value={customItem.name}
                    onChange={(e) => setCustomItem(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Digite o nome do item"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Quantidade
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customItem.quantity}
                    onChange={(e) => setCustomItem(prev => ({ ...prev, quantity: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Unidade
                  </label>
                  <select
                    value={customItem.unit}
                    onChange={(e) => setCustomItem(prev => ({ ...prev, unit: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    {unitOptions.filter(opt => opt.value !== '').map(opt => (
                      <option key={opt.value} value={opt.value} className="bg-white dark:bg-gray-700 dark:text-white">{opt.label}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Preço Unitário (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customItem.price}
                    onChange={(e) => setCustomItem(prev => ({ ...prev, price: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Fornecedor
                  </label>
                  <input
                    type="text"
                    value={customItem.supplier}
                    onChange={(e) => setCustomItem(prev => ({ ...prev, supplier: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Nome do fornecedor"
                  />
                </div>
              </div>
              
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowCustomItemModal(false)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddCustomItem}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Adicionar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NewPurchaseList;
