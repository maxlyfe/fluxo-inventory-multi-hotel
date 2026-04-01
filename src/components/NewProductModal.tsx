// src/components/NewProductModal.tsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Loader2, Check, Barcode, Plus, Camera, Phone, Search, ChevronDown, ChevronUp, Building2, MessageSquare } from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import BarcodeScanner from './BarcodeScanner';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { whatsappService, SupplierContact } from '../lib/whatsappService';

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

  const [error,       setError]       = useState('');
  const [isSaving,    setIsSaving]    = useState(false);
  const [formData,    setFormData]    = useState({
    name: '', quantity: '0' as string | number, min_quantity: '0' as string | number, max_quantity: '100' as string | number,
    category: 'Outros', supplier: '', image_url: '', description: '',
    is_portionable: false, is_portion: false,
    auto_portion_product_id: null as string | null,
    auto_portion_multiplier: null as number | null,
  });

  // Produtos porção disponíveis para auto-porcionamento
  const [portionProducts, setPortionProducts] = useState<Product[]>([]);
  const [portionSearch, setPortionSearch] = useState('');

  const [sectors,         setSectors]         = useState<Sector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [loadingSectors,  setLoadingSectors]  = useState(true);

  // ── Códigos de barra ─────────────────────────────────────────────
  const [barcodes,     setBarcodes]     = useState<string[]>([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showScanner,  setShowScanner]  = useState(false);

  // ── Fornecedores (contatos WhatsApp + manuais) ─────────────────────
  const [supplierContacts,    setSupplierContacts]    = useState<SupplierContact[]>([]);
  const [selectedContactIds,  setSelectedContactIds]  = useState<Set<string>>(new Set());
  const [manualSuppliers,     setManualSuppliers]     = useState<string[]>([]);
  const [supplierSearch,      setSupplierSearch]      = useState('');
  const [manualInput,         setManualInput]         = useState('');
  const [showContactList,     setShowContactList]     = useState(false);

  // ── Carregar dados ao abrir ──────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !selectedHotel) return;

    const load = async () => {
      setLoadingSectors(true);

      // Contatos de fornecedores (compartilhados entre hotéis)
      try {
        const contacts = await whatsappService.getContacts();
        setSupplierContacts(contacts);
      } catch {
        setSupplierContacts([]);
      }

      // Setores do hotel
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

      // Produtos porção para auto-porcionamento
      const { data: portionData } = await supabase
        .from('products')
        .select('id, name, category')
        .eq('hotel_id', selectedHotel.id)
        .eq('is_portion', true)
        .eq('is_active', true)
        .order('name');
      setPortionProducts((portionData as Product[]) || []);

      if (editingProduct) {
        // Visibilidade por setor
        const { data: visibilityData, error: visErr } = await supabase
          .from('product_sector_visibility')
          .select('sector_id')
          .eq('product_id', editingProduct.id);

        if (visErr) {
          addNotification('Erro ao carregar visibilidade do produto.', 'error');
          setSelectedSectors(new Set());
        } else {
          setSelectedSectors(new Set(visibilityData.map(v => v.sector_id)));
        }

        // Códigos de barra cadastrados
        const { data: bcData } = await supabase
          .from('product_barcodes')
          .select('barcode')
          .eq('product_id', editingProduct.id)
          .order('created_at');
        setBarcodes((bcData || []).map((b: any) => b.barcode));

        // Fornecedores vinculados
        try {
          const linkedIds = await whatsappService.getProductContacts(editingProduct.id);
          setSelectedContactIds(new Set(linkedIds));
        } catch {
          setSelectedContactIds(new Set());
        }

        // Fornecedores manuais (campo texto antigo, separados por vírgula)
        const existingSupplier = editingProduct.supplier || '';
        if (existingSupplier.trim()) {
          setManualSuppliers(existingSupplier.split(',').map(s => s.trim()).filter(Boolean));
        } else {
          setManualSuppliers([]);
        }

        // Dados do produto
        setFormData({
          name:           editingProduct.name,
          quantity:       String(editingProduct.quantity),
          min_quantity:   String(editingProduct.min_quantity),
          max_quantity:   String(editingProduct.max_quantity),
          category:       editingProduct.category,
          supplier:       editingProduct.supplier    || '',
          image_url:      editingProduct.image_url   || '',
          description:    editingProduct.description || '',
          is_portionable: editingProduct.is_portionable || false,
          is_portion:     editingProduct.is_portion     || false,
          auto_portion_product_id: (editingProduct as any).auto_portion_product_id || null,
          auto_portion_multiplier: (editingProduct as any).auto_portion_multiplier || null,
        });
      } else {
        if (sectorsData) setSelectedSectors(new Set(sectorsData.map(s => s.id)));
        setBarcodes([]);
        setSelectedContactIds(new Set());
        setManualSuppliers([]);
        setFormData({
          name: '', quantity: '0', min_quantity: '0', max_quantity: '100',
          category: 'Outros', supplier: '', image_url: '', description: '',
          is_portionable: false, is_portion: false,
          auto_portion_product_id: null, auto_portion_multiplier: null,
        });
      }

      setLoadingSectors(false);
    };

    load();
  }, [editingProduct, isOpen, selectedHotel, createAsHidden, addNotification]);

  // ── Handlers do form ────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => {
        const next = { ...prev, [name]: checked };
        if (checked && name === 'is_portionable') next.is_portion = false;
        if (checked && name === 'is_portion')     { next.is_portionable = false; next.auto_portion_product_id = null; next.auto_portion_multiplier = null; }
        if (!checked && name === 'is_portionable') { next.auto_portion_product_id = null; next.auto_portion_multiplier = null; }
        return next;
      });
      return;
    }
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSectorToggle = (sectorId: string) => {
    setSelectedSectors(prev => {
      const next = new Set(prev);
      next.has(sectorId) ? next.delete(sectorId) : next.add(sectorId);
      return next;
    });
  };

  // ── Handlers de barcode ─────────────────────────────────────────
  const addBarcode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBarcodes(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
    setBarcodeInput('');
  };

  const removeBarcode = (code: string) =>
    setBarcodes(prev => prev.filter(b => b !== code));

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addBarcode(barcodeInput); }
  };

  // Leitor USB de código de barras
  useBarcodeScanner({
    onScan: addBarcode,
    enabled: isOpen && !showScanner,
  });

  const handleBarcodeScan = (code: string) => {
    addBarcode(code);
    setShowScanner(false);
  };

  // ── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      if (!selectedHotel?.id) throw new Error('Hotel não selecionado');

      const qty = parseFloat(String(formData.quantity).replace(',', '.')) || 0;
      const minQty = parseFloat(String(formData.min_quantity).replace(',', '.')) || 0;
      const maxQty = parseFloat(String(formData.max_quantity).replace(',', '.')) || 100;

      if (minQty > maxQty)
        throw new Error('Quantidade mínima não pode ser maior que a máxima.');

      // Consolidar fornecedores manuais + nomes dos contatos selecionados no campo supplier
      const contactNames = supplierContacts
        .filter(c => selectedContactIds.has(c.id))
        .map(c => c.company_name);
      const allSupplierNames = [...new Set([...manualSuppliers, ...contactNames])];
      const supplierField = allSupplierNames.join(', ');
      const dataToSave = { ...formData, supplier: supplierField, quantity: qty, min_quantity: minQty, max_quantity: maxQty };

      let savedProduct: Product | null = null;

      if (editingProduct) {
        const { data, error: updateError } = await supabase
          .from('products').update(dataToSave)
          .eq('id', editingProduct.id).select().single();
        if (updateError) throw updateError;
        savedProduct = data;
      } else {
        const { data, error: insertError } = await supabase
          .from('products')
          .insert([{ ...dataToSave, hotel_id: selectedHotel.id, is_active: !createAsHidden }])
          .select().single();
        if (insertError) throw insertError;
        savedProduct = data;
      }

      if (savedProduct) {
        // Visibilidade
        const { error: delVis } = await supabase
          .from('product_sector_visibility').delete().eq('product_id', savedProduct.id);
        if (delVis) throw new Error(`Erro ao limpar visibilidade: ${delVis.message}`);

        if (selectedSectors.size > 0) {
          const { error: insVis } = await supabase.from('product_sector_visibility')
            .insert(Array.from(selectedSectors).map(sid => ({
              product_id: savedProduct!.id, sector_id: sid,
            })));
          if (insVis) throw new Error(`Erro ao salvar visibilidade: ${insVis.message}`);
        }

        // Barcodes — sincroniza (apaga e reinsere)
        await supabase.from('product_barcodes').delete().eq('product_id', savedProduct.id);
        const unique = [...new Set(barcodes.filter(b => b.trim()))];
        if (unique.length > 0) {
          const { error: bcErr } = await supabase.from('product_barcodes')
            .insert(unique.map(barcode => ({ product_id: savedProduct!.id, barcode })));
          if (bcErr) console.error('Erro ao salvar barcodes:', bcErr);
        }

        // Fornecedores — sincroniza vínculos produto-contato
        try {
          await whatsappService.syncProductContacts(savedProduct.id, Array.from(selectedContactIds));
        } catch (err) {
          console.error('Erro ao salvar fornecedores:', err);
        }
      }

      addNotification(
        editingProduct ? 'Produto atualizado com sucesso!' : 'Produto criado com sucesso!',
        'success'
      );
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
    <>
      <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">

          {/* ── Header ─────────────────────────────────────────── */}
          <div className="flex-shrink-0 flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {editingProduct ? 'Editar Produto' : 'Novo Produto'}
            </h2>
            <button type="button" onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* ── Body (scrollável) ───────────────────────────────── */}
          <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto">
            <div className="p-6 space-y-6">

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/50 text-red-800 dark:text-red-200 rounded-md text-sm">
                  {error}
                </div>
              )}

              {/* Campos principais */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Produto</label>
                  <input name="name" type="text" value={formData.name} onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria</label>
                  <input name="category" type="text" value={formData.category} onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    required list="category-suggestions" />
                  <datalist id="category-suggestions">
                    {categories.map(cat => <option key={cat} value={cat} />)}
                  </datalist>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qtd. Atual</label>
                    <input name="quantity" type="text" inputMode="decimal" value={formData.quantity} onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      required min="0" disabled={createAsHidden} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qtd. Mínima</label>
                    <input name="min_quantity" type="text" inputMode="decimal" value={formData.min_quantity} onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      required min="0" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qtd. Máxima</label>
                    <input name="max_quantity" type="text" inputMode="decimal" value={formData.max_quantity} onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      required min="1" />
                  </div>
                </div>
                <div>{/* placeholder — fornecedores movidos para seção dedicada abaixo */}</div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URL da Imagem</label>
                  <input name="image_url" type="url" value={formData.image_url} onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    placeholder="https://..." />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
                  <textarea name="description" value={formData.description} onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" rows={2} />
                </div>
              </div>

              {/* ── CÓDIGOS DE BARRA ─────────────────────────────── */}
              <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-900/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                    <Barcode className="w-4 h-4 text-indigo-500" />
                    Códigos de Barra
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 active:scale-95 transition-all shadow-sm"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Escanear câmera
                  </button>
                </div>

                {barcodes.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {barcodes.map(bc => (
                      <div key={bc} className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700 shadow-sm">
                        <Barcode className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                        <span className="text-xs font-mono text-indigo-700 dark:text-indigo-300">{bc}</span>
                        <button type="button" onClick={() => removeBarcode(bc)}
                          className="ml-1 w-5 h-5 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={handleBarcodeKeyDown}
                    placeholder="Cole ou digite o código → pressione Enter"
                    className="flex-1 rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => addBarcode(barcodeInput)}
                    disabled={!barcodeInput.trim()}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
                <p className="text-xs text-indigo-400 mt-1.5">
                  EAN-13, QR Code, Code128, etc. — cadastre múltiplos por produto.
                </p>
              </div>

              {/* ── Porcionamento ────────────────────────────────── */}
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-3">
                <label className={`flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${formData.is_portion ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input id="is_portionable" name="is_portionable" type="checkbox"
                    checked={formData.is_portionable} onChange={handleInputChange} disabled={formData.is_portion}
                    className="h-4 w-4 rounded text-blue-600 border-gray-300 dark:bg-gray-600 dark:border-gray-500 focus:ring-blue-500" />
                  <div>
                    <span className="font-medium text-gray-800 dark:text-gray-200">Produto Porcionável</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Marque se este item precisa ser processado pelo setor (ex: peça de carne, caixa de cereal).</p>
                  </div>
                </label>
                {/* Auto-porcionamento (só aparece quando is_portionable) */}
                {formData.is_portionable && (
                  <div className="ml-7 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 space-y-3">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input type="checkbox"
                        checked={!!formData.auto_portion_product_id}
                        onChange={(e) => {
                          if (!e.target.checked) {
                            setFormData(prev => ({ ...prev, auto_portion_product_id: null, auto_portion_multiplier: null }));
                          }
                        }}
                        className="h-4 w-4 rounded text-blue-600 border-gray-300 dark:bg-gray-600 dark:border-gray-500 focus:ring-blue-500"
                        readOnly={!!formData.auto_portion_product_id}
                      />
                      <div>
                        <span className="font-medium text-sm text-blue-800 dark:text-blue-200">Auto-porcionamento</span>
                        <p className="text-xs text-blue-600 dark:text-blue-400">Converter automaticamente ao enviar para setor (ex: 1 kg → 1000 g)</p>
                      </div>
                    </label>

                    {/* Seleção de produto porção */}
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Produto porção resultante</label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Buscar produto porção..."
                          value={portionSearch}
                          onChange={e => setPortionSearch(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                        {portionSearch && (
                          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {portionProducts
                              .filter(p => p.name.toLowerCase().includes(portionSearch.toLowerCase()) && p.id !== editingProduct?.id)
                              .map(p => (
                                <button key={p.id} type="button"
                                  onClick={() => {
                                    setFormData(prev => ({ ...prev, auto_portion_product_id: p.id, auto_portion_multiplier: prev.auto_portion_multiplier || 1 }));
                                    setPortionSearch('');
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-800 dark:text-gray-200">
                                  {p.name} <span className="text-xs text-gray-400">({p.category})</span>
                                </button>
                              ))}
                            {portionProducts.filter(p => p.name.toLowerCase().includes(portionSearch.toLowerCase()) && p.id !== editingProduct?.id).length === 0 && (
                              <p className="px-3 py-2 text-xs text-gray-400">Nenhum produto porção encontrado</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Produto selecionado */}
                      {formData.auto_portion_product_id && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-sm">
                          <Check className="w-4 h-4 text-blue-600" />
                          <span className="font-medium text-blue-800 dark:text-blue-200">
                            {portionProducts.find(p => p.id === formData.auto_portion_product_id)?.name || 'Produto selecionado'}
                          </span>
                          <button type="button" onClick={() => setFormData(prev => ({ ...prev, auto_portion_product_id: null, auto_portion_multiplier: null }))}
                            className="ml-auto text-blue-500 hover:text-red-500">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {/* Multiplicador */}
                      {formData.auto_portion_product_id && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            Fator de conversão (multiplicador)
                          </label>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">1 un →</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formData.auto_portion_multiplier || ''}
                              onChange={e => setFormData(prev => ({ ...prev, auto_portion_multiplier: parseFloat(e.target.value.replace(',', '.')) || null }))}
                              className="w-28 px-3 py-2 text-sm text-center font-bold border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                              placeholder="1000"
                            />
                            <span className="text-sm text-gray-500">un porção</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">Ex: 1 kg = 1000 g → multiplicador = 1000</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <label className={`flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${formData.is_portionable ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input id="is_portion" name="is_portion" type="checkbox"
                    checked={formData.is_portion} onChange={handleInputChange} disabled={formData.is_portionable}
                    className="h-4 w-4 rounded text-green-600 border-gray-300 dark:bg-gray-600 dark:border-gray-500 focus:ring-green-500" />
                  <div>
                    <span className="font-medium text-gray-800 dark:text-gray-200">É uma Porção</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Marque se este item é o resultado do porcionamento de outro item (ex: bife, dose de bebida).</p>
                  </div>
                </label>
              </div>

              {/* ── Fornecedores ────────────────────────────────── */}
              <div className="rounded-xl border border-green-100 dark:border-green-900/50 bg-green-50/50 dark:bg-green-900/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-green-500" />
                    Fornecedores
                    <span className="text-xs font-normal text-gray-400">
                      ({selectedContactIds.size + manualSuppliers.length})
                    </span>
                  </h3>
                  {supplierContacts.length > 0 && (
                    <button type="button" onClick={() => setShowContactList(!showContactList)}
                      className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 hover:underline font-medium">
                      {showContactList ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showContactList ? 'Ocultar lista' : 'Ver lista de contatos'}
                    </button>
                  )}
                </div>

                {/* Tags dos fornecedores selecionados */}
                {(selectedContactIds.size > 0 || manualSuppliers.length > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {/* Contatos da lista */}
                    {supplierContacts.filter(c => selectedContactIds.has(c.id)).map(contact => (
                      <span key={contact.id}
                        className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-green-600 text-white text-xs font-medium shadow-sm">
                        <MessageSquare className="w-3 h-3" />
                        {contact.company_name}
                        <button type="button" onClick={() => setSelectedContactIds(prev => {
                          const next = new Set(prev); next.delete(contact.id); return next;
                        })} className="ml-0.5 w-5 h-5 flex items-center justify-center rounded-md hover:bg-green-700 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {/* Fornecedores manuais */}
                    {manualSuppliers.map((name, idx) => (
                      <span key={`manual-${idx}`}
                        className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-gray-500 text-white text-xs font-medium shadow-sm">
                        <Building2 className="w-3 h-3" />
                        {name}
                        <button type="button" onClick={() => setManualSuppliers(prev => prev.filter((_, i) => i !== idx))}
                          className="ml-0.5 w-5 h-5 flex items-center justify-center rounded-md hover:bg-gray-600 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Busca na lista de contatos */}
                {showContactList && supplierContacts.length > 0 && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={supplierSearch}
                        onChange={e => setSupplierSearch(e.target.value)}
                        placeholder="Buscar por nome ou telefone..."
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                      {supplierContacts
                        .filter(c => {
                          if (!supplierSearch) return true;
                          const q = supplierSearch.toLowerCase();
                          return c.company_name.toLowerCase().includes(q)
                            || (c.contact_name || '').toLowerCase().includes(q)
                            || c.whatsapp_number.includes(q);
                        })
                        .map(contact => (
                          <button type="button" key={contact.id}
                            onClick={() => setSelectedContactIds(prev => {
                              const next = new Set(prev);
                              next.has(contact.id) ? next.delete(contact.id) : next.add(contact.id);
                              return next;
                            })}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                              selectedContactIds.has(contact.id) ? 'bg-green-50 dark:bg-green-900/20' : ''
                            }`}>
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                              selectedContactIds.has(contact.id)
                                ? 'bg-green-600 border-green-600 text-white'
                                : 'border-gray-300 dark:border-gray-500'
                            }`}>
                              {selectedContactIds.has(contact.id) && <Check className="w-3 h-3" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{contact.company_name}</p>
                              <p className="text-xs text-gray-400 truncate">
                                {contact.whatsapp_number}
                                {contact.contact_name && ` — ${contact.contact_name}`}
                              </p>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* Adicionar fornecedor manualmente */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualInput}
                    onChange={e => setManualInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = manualInput.trim();
                        if (val && !manualSuppliers.includes(val)) {
                          setManualSuppliers(prev => [...prev, val]);
                          setManualInput('');
                        }
                      }
                    }}
                    placeholder="Digitar fornecedor manualmente → Enter"
                    className="flex-1 rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm"
                  />
                  <button type="button"
                    onClick={() => {
                      const val = manualInput.trim();
                      if (val && !manualSuppliers.includes(val)) {
                        setManualSuppliers(prev => [...prev, val]);
                        setManualInput('');
                      }
                    }}
                    disabled={!manualInput.trim()}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors">
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>

                <p className="text-xs text-green-500/70">
                  Selecione da lista de contatos (com WhatsApp) ou adicione manualmente.
                </p>
              </div>

              {/* ── Visibilidade por Setor ───────────────────────── */}
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-3">Visibilidade por Setor</h3>
                {loadingSectors ? (
                  <div className="flex justify-center items-center h-16">
                    <Loader2 className="animate-spin text-gray-400" />
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {sectors.map(sector => (
                      <button type="button" key={sector.id} onClick={() => handleSectorToggle(sector.id)}
                        className={`px-3 py-1.5 rounded-full border text-sm font-medium flex items-center gap-2 transition-colors duration-150 ${
                          selectedSectors.has(sector.id)
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-gray-100 border-gray-300 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-500 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
                        }`}>
                        {selectedSectors.has(sector.id) && <Check size={16} />}
                        {sector.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* ── Footer ─────────────────────────────────────────── */}
            <div className="flex-shrink-0 flex justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button type="button" onClick={onClose}
                className="px-4 py-2 border dark:border-gray-600 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
                Cancelar
              </button>
              <button type="submit" disabled={isSaving}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center justify-center disabled:opacity-50">
                {isSaving && <Loader2 className="animate-spin w-4 h-4 mr-2" />}
                {editingProduct ? 'Salvar Alterações' : 'Criar Produto'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ── Scanner de câmera (fullscreen, z acima do modal) ───────── */}
      {showScanner && (
        <BarcodeScanner
          onDetected={handleBarcodeScan}
          onClose={() => setShowScanner(false)}
          title="Escanear Código do Produto"
          hint="Aponte para o código de barras da embalagem"
        />
      )}
    </>
  );
};

export default NewProductModal;