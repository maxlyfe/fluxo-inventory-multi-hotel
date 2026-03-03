// src/components/NewProductModal.tsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Loader2, Check, Barcode, Plus, Camera } from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import BarcodeScanner from './BarcodeScanner';

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
    name: '', quantity: 0, min_quantity: 0, max_quantity: 100,
    category: 'Outros', supplier: '', image_url: '', description: '',
    is_portionable: false, is_portion: false,
  });

  const [sectors,         setSectors]         = useState<Sector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [loadingSectors,  setLoadingSectors]  = useState(true);

  // ── Códigos de barra ─────────────────────────────────────────────
  const [barcodes,     setBarcodes]     = useState<string[]>([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showScanner,  setShowScanner]  = useState(false);

  // ── Carregar dados ao abrir ──────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !selectedHotel) return;

    const load = async () => {
      setLoadingSectors(true);

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

        // Dados do produto
        setFormData({
          name:           editingProduct.name,
          quantity:       editingProduct.quantity,
          min_quantity:   editingProduct.min_quantity,
          max_quantity:   editingProduct.max_quantity,
          category:       editingProduct.category,
          supplier:       editingProduct.supplier    || '',
          image_url:      editingProduct.image_url   || '',
          description:    editingProduct.description || '',
          is_portionable: editingProduct.is_portionable || false,
          is_portion:     editingProduct.is_portion     || false,
        });
      } else {
        if (sectorsData) setSelectedSectors(new Set(sectorsData.map(s => s.id)));
        setBarcodes([]);
        setFormData({
          name: '', quantity: 0, min_quantity: 0, max_quantity: 100,
          category: 'Outros', supplier: '', image_url: '', description: '',
          is_portionable: false, is_portion: false,
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
        if (checked && name === 'is_portion')     next.is_portionable = false;
        return next;
      });
      return;
    }
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? (parseInt(value) || 0) : value,
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
      if (formData.min_quantity > formData.max_quantity)
        throw new Error('Quantidade mínima não pode ser maior que a máxima.');

      let savedProduct: Product | null = null;

      if (editingProduct) {
        const { data, error: updateError } = await supabase
          .from('products').update({ ...formData })
          .eq('id', editingProduct.id).select().single();
        if (updateError) throw updateError;
        savedProduct = data;
      } else {
        const { data, error: insertError } = await supabase
          .from('products')
          .insert([{ ...formData, hotel_id: selectedHotel.id, is_active: !createAsHidden }])
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
                    <input name="quantity" type="number" value={formData.quantity} onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      required min="0" disabled={createAsHidden} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qtd. Mínima</label>
                    <input name="min_quantity" type="number" value={formData.min_quantity} onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      required min="0" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qtd. Máxima</label>
                    <input name="max_quantity" type="number" value={formData.max_quantity} onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      required min="1" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fornecedor</label>
                  <input name="supplier" type="text" value={formData.supplier} onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                </div>
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