// src/components/NewProductModal.tsx
// Redesenhado — design system slate-2xl, seções com cards coloridos,
// campos com foco ring, tipo de produto como card toggle, imagem preview.

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  X, Loader2, Check, Barcode, Plus, Camera, Phone, Search,
  ChevronDown, ChevronUp, Building2, MessageSquare, Package,
  ImageIcon, Tag, Scale, FileText, Hash, Percent, Layers,
  Eye, Scissors, ArrowRight,
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import BarcodeScanner from './BarcodeScanner';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useFormatters } from '../hooks/useFormatters';
import { whatsappService, SupplierContact } from '../lib/whatsappService';
import { Product, UNIT_MEASURE_OPTIONS, PRODUCT_TYPE_OPTIONS } from '../types/product';

// ── tipos ─────────────────────────────────────────────────────────────────────

interface Sector { id: string; name: string; }

interface NewProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (newProduct?: Product) => void;
  editingProduct: Product | null;
  categories: string[];
  createAsHidden?: boolean;
}

// ── helper: campo de texto estilizado ─────────────────────────────────────────

const fieldCls =
  'w-full rounded-xl border border-slate-200 dark:border-slate-600 ' +
  'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white ' +
  'placeholder-slate-400 text-sm px-3 py-2.5 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 ' +
  'transition-colors';

const selectCls = fieldCls + ' cursor-pointer';

// ── seção card ────────────────────────────────────────────────────────────────

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  badge?: string;
  accent?: string;       // ex: 'indigo' | 'green' | 'amber' | 'blue' | 'slate'
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, title, badge, accent = 'slate', action, children }) => {
  const bg: Record<string, string> = {
    indigo: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-900/50',
    green:  'bg-green-50  dark:bg-green-900/20  border-green-100  dark:border-green-900/50',
    amber:  'bg-amber-50  dark:bg-amber-900/20  border-amber-100  dark:border-amber-900/50',
    blue:   'bg-blue-50   dark:bg-blue-900/20   border-blue-100   dark:border-blue-900/50',
    slate:  'bg-slate-50  dark:bg-slate-800/60  border-slate-200  dark:border-slate-700',
    purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-900/50',
  };
  const ic: Record<string, string> = {
    indigo: 'text-indigo-500', green: 'text-green-500', amber: 'text-amber-500',
    blue: 'text-blue-500', slate: 'text-slate-400', purple: 'text-purple-500',
  };
  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${bg[accent] ?? bg.slate}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <span className={ic[accent] ?? ic.slate}>{icon}</span>
          {title}
          {badge !== undefined && (
            <span className="ml-1 text-xs font-normal text-slate-400">({badge})</span>
          )}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
};

// ── componente principal ──────────────────────────────────────────────────────

const NewProductModal = ({
  isOpen, onClose, onSave, editingProduct, categories, createAsHidden = false,
}: NewProductModalProps) => {
  const { selectedHotel }   = useHotel();
  const { addNotification } = useNotification();

  const [error,    setError]    = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', quantity: '0' as string | number, min_quantity: '0' as string | number,
    max_quantity: '100' as string | number, category: 'Outros', supplier: '',
    image_url: '', description: '',
    is_portionable: false, is_portion: false,
    auto_portion_product_id: null as string | null,
    auto_portion_multiplier: null as number | null,
    unit_measure: 'und', product_type: 'consumo',
    mcu_code: '', tax_percentage: '0',
  });

  const [portionProducts, setPortionProducts] = useState<Product[]>([]);
  const [portionSearch,   setPortionSearch]   = useState('');
  const [sectors,          setSectors]         = useState<Sector[]>([]);
  const [selectedSectors,  setSelectedSectors] = useState<Set<string>>(new Set());
  const [loadingSectors,   setLoadingSectors]  = useState(true);

  const [barcodes,     setBarcodes]     = useState<string[]>([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showScanner,  setShowScanner]  = useState(false);

  const [supplierContacts,   setSupplierContacts]   = useState<SupplierContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [manualSuppliers,    setManualSuppliers]    = useState<string[]>([]);
  const [supplierSearch,     setSupplierSearch]     = useState('');
  const [manualInput,        setManualInput]        = useState('');
  const [showContactList,    setShowContactList]    = useState(false);

  const [imgError, setImgError] = useState(false);

  // ── load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !selectedHotel) return;
    setImgError(false);
    const load = async () => {
      setLoadingSectors(true);
      try { setSupplierContacts(await whatsappService.getContacts()); }
      catch { setSupplierContacts([]); }

      const { data: sectorsData } = await supabase
        .from('sectors').select('id, name').eq('hotel_id', selectedHotel.id).order('name');
      setSectors(sectorsData || []);

      const { data: portionData } = await supabase
        .from('products').select('id, name, category')
        .eq('hotel_id', selectedHotel.id).eq('is_portion', true).eq('is_active', true).order('name');
      setPortionProducts((portionData as Product[]) || []);

      if (editingProduct) {
        const { data: visData } = await supabase
          .from('product_sector_visibility').select('sector_id').eq('product_id', editingProduct.id);
        setSelectedSectors(new Set(visData?.map(v => v.sector_id) ?? []));

        const { data: bcData } = await supabase
          .from('product_barcodes').select('barcode').eq('product_id', editingProduct.id).order('created_at');
        setBarcodes((bcData || []).map((b: any) => b.barcode));

        try { setSelectedContactIds(new Set(await whatsappService.getProductContacts(editingProduct.id))); }
        catch { setSelectedContactIds(new Set()); }

        const existing = editingProduct.supplier || '';
        setManualSuppliers(existing.trim() ? existing.split(',').map(s => s.trim()).filter(Boolean) : []);

        setFormData({
          name:        editingProduct.name,
          quantity:    String(editingProduct.quantity),
          min_quantity: String(editingProduct.min_quantity),
          max_quantity: String(editingProduct.max_quantity),
          category:    editingProduct.category,
          supplier:    editingProduct.supplier    || '',
          image_url:   editingProduct.image_url   || '',
          description: editingProduct.description || '',
          is_portionable: editingProduct.is_portionable || false,
          is_portion:     editingProduct.is_portion     || false,
          auto_portion_product_id: (editingProduct as any).auto_portion_product_id || null,
          auto_portion_multiplier: (editingProduct as any).auto_portion_multiplier || null,
          unit_measure: editingProduct.unit_measure  || 'und',
          product_type: editingProduct.product_type  || 'consumo',
          mcu_code:     editingProduct.mcu_code      || '',
          tax_percentage: editingProduct.tax_percentage?.toString() || '0',
        });
      } else {
        if (sectorsData) setSelectedSectors(new Set(sectorsData.map(s => s.id)));
        setBarcodes([]); setSelectedContactIds(new Set()); setManualSuppliers([]);
        setFormData({
          name: '', quantity: '0', min_quantity: '0', max_quantity: '100',
          category: 'Outros', supplier: '', image_url: '', description: '',
          is_portionable: false, is_portion: false,
          auto_portion_product_id: null, auto_portion_multiplier: null,
          unit_measure: 'und', product_type: 'consumo', mcu_code: '', tax_percentage: '0',
        });
      }
      setLoadingSectors(false);
    };
    load();
  }, [editingProduct, isOpen, selectedHotel, addNotification]);

  // ── handlers ───────────────────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => {
        const next = { ...prev, [name]: checked };
        if (checked && name === 'is_portionable') next.is_portion = false;
        if (checked && name === 'is_portion') {
          next.is_portionable = false;
          next.auto_portion_product_id = null;
          next.auto_portion_multiplier = null;
        }
        if (!checked && name === 'is_portionable') {
          next.auto_portion_product_id = null;
          next.auto_portion_multiplier = null;
        }
        return next;
      });
      return;
    }
    if (name === 'image_url') setImgError(false);
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSectorToggle = (id: string) =>
    setSelectedSectors(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const addBarcode = (code: string) => {
    const t = code.trim();
    if (!t) return;
    setBarcodes(prev => prev.includes(t) ? prev : [...prev, t]);
    setBarcodeInput('');
  };
  const removeBarcode = (code: string) => setBarcodes(prev => prev.filter(b => b !== code));

  useBarcodeScanner({ onScan: addBarcode, enabled: isOpen && !showScanner });
  const handleBarcodeScan = (code: string) => { addBarcode(code); setShowScanner(false); };

  const addManualSupplier = () => {
    const val = manualInput.trim();
    if (val && !manualSuppliers.includes(val)) {
      setManualSuppliers(prev => [...prev, val]);
      setManualInput('');
    }
  };

  const { parseNumber } = useFormatters();

  // ── submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      if (!selectedHotel?.id) throw new Error('Hotel não selecionado');

      const qty    = parseNumber(formData.quantity);
      const minQty = parseNumber(formData.min_quantity);
      const maxQty = parseNumber(formData.max_quantity);
      if (minQty > maxQty) throw new Error('Quantidade mínima não pode ser maior que a máxima.');

      const contactNames  = supplierContacts.filter(c => selectedContactIds.has(c.id)).map(c => c.company_name);
      const supplierField = [...new Set([...manualSuppliers, ...contactNames])].join(', ');

      const dataToSave = {
        ...formData, supplier: supplierField, quantity: qty, min_quantity: minQty, max_quantity: maxQty,
        mcu_code: formData.mcu_code || null,
        tax_percentage: parseNumber(formData.tax_percentage),
      };

      let savedProduct: Product | null = null;
      if (editingProduct) {
        const { data, error: e } = await supabase.from('products').update(dataToSave).eq('id', editingProduct.id).select().single();
        if (e) throw e;
        savedProduct = data;
      } else {
        const { data, error: e } = await supabase.from('products')
          .insert([{ ...dataToSave, hotel_id: selectedHotel.id, is_active: !createAsHidden }])
          .select().single();
        if (e) throw e;
        savedProduct = data;
      }

      if (savedProduct) {
        await supabase.from('product_sector_visibility').delete().eq('product_id', savedProduct.id);
        if (selectedSectors.size > 0) {
          await supabase.from('product_sector_visibility')
            .insert(Array.from(selectedSectors).map(sid => ({ product_id: savedProduct!.id, sector_id: sid })));
        }
        await supabase.from('product_barcodes').delete().eq('product_id', savedProduct.id);
        const unique = [...new Set(barcodes.filter(b => b.trim()))];
        if (unique.length > 0)
          await supabase.from('product_barcodes').insert(unique.map(barcode => ({ product_id: savedProduct!.id, barcode })));
        try { await whatsappService.syncProductContacts(savedProduct.id, Array.from(selectedContactIds)); }
        catch (err) { console.error('Erro ao salvar fornecedores:', err); }
      }

      addNotification(editingProduct ? 'Produto atualizado com sucesso!' : 'Produto criado com sucesso!', 'success');
      onSave(savedProduct || undefined);
      onClose();
    } catch (err: any) {
      const msg = err.message || 'Erro desconhecido ao salvar produto.';
      setError(msg);
      addNotification(`Erro ao salvar produto: ${msg}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // ── render ─────────────────────────────────────────────────────────────────

  const hasImage = formData.image_url && !imgError;
  const portionFiltered = portionProducts
    .filter(p => p.name.toLowerCase().includes(portionSearch.toLowerCase()) && p.id !== editingProduct?.id);

  return (
    <>
      {/* overlay */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
        {/* modal */}
        <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[96vh] sm:max-h-[90vh] flex flex-col overflow-hidden">

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700/80">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ${
                editingProduct
                  ? 'bg-blue-600 shadow-blue-500/20'
                  : 'bg-emerald-600 shadow-emerald-500/20'
              }`}>
                {editingProduct ? <Package className="w-4.5 h-4.5 text-white w-5 h-5" /> : <Plus className="w-5 h-5 text-white" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-800 dark:text-white leading-tight">
                  {editingProduct ? 'Editar Produto' : 'Novo Produto'}
                </h2>
                {editingProduct && (
                  <p className="text-xs text-slate-400 leading-tight truncate max-w-[220px]">{editingProduct.name}</p>
                )}
              </div>
            </div>
            <button type="button" onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Body ───────────────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
            <div className="p-5 space-y-4">

              {/* Error banner */}
              {error && (
                <div className="flex items-start gap-2.5 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">
                  <X className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* ── Informações Básicas ──────────────────────────────────── */}
              <Section icon={<Tag className="w-4 h-4" />} title="Informações Básicas" accent="blue">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Nome */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Nome do Produto *</label>
                    <input name="name" type="text" value={formData.name} onChange={handleInputChange}
                      placeholder="Ex: Cerveja Heineken 600ml" className={fieldCls} required />
                  </div>

                  {/* Categoria */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Categoria *</label>
                    <input name="category" type="text" value={formData.category} onChange={handleInputChange}
                      list="category-suggestions" placeholder="Ex: Bebidas" className={fieldCls} required />
                    <datalist id="category-suggestions">
                      {categories.map(c => <option key={c} value={c} />)}
                    </datalist>
                  </div>

                  {/* Descrição */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Descrição</label>
                    <input name="description" type="text" value={formData.description} onChange={handleInputChange}
                      placeholder="Detalhes adicionais…" className={fieldCls} />
                  </div>
                </div>

                {/* Quantidades */}
                <div className="grid grid-cols-3 gap-3 mt-1">
                  {[
                    { name: 'quantity',     label: 'Qtd. Atual', disabled: createAsHidden },
                    { name: 'min_quantity', label: 'Mínimo',     disabled: false },
                    { name: 'max_quantity', label: 'Máximo',     disabled: false },
                  ].map(field => (
                    <div key={field.name}>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">{field.label}</label>
                      <input
                        name={field.name} type="text" inputMode="decimal"
                        value={(formData as any)[field.name]} onChange={handleInputChange}
                        disabled={field.disabled} required min="0"
                        className={fieldCls + (field.disabled ? ' opacity-50 cursor-not-allowed' : '')}
                      />
                    </div>
                  ))}
                </div>
              </Section>

              {/* ── Imagem ──────────────────────────────────────────────── */}
              <Section icon={<ImageIcon className="w-4 h-4" />} title="Imagem" accent="slate">
                <div className="flex items-start gap-3">
                  {/* preview */}
                  <div className="w-14 h-14 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden">
                    {hasImage
                      ? <img src={formData.image_url} alt="preview" className="w-full h-full object-contain"
                          onError={() => setImgError(true)} />
                      : <Package className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                    }
                  </div>
                  <div className="flex-1">
                    <input name="image_url" type="url" value={formData.image_url} onChange={handleInputChange}
                      placeholder="https://... URL da imagem do produto"
                      className={fieldCls} />
                    <p className="mt-1 text-xs text-slate-400">Cole a URL de uma imagem (JPEG, PNG, WebP)</p>
                  </div>
                </div>
              </Section>

              {/* ── Códigos de Barras ────────────────────────────────────── */}
              <Section
                icon={<Barcode className="w-4 h-4" />}
                title="Códigos de Barras"
                badge={String(barcodes.length)}
                accent="indigo"
                action={
                  <button type="button" onClick={() => setShowScanner(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 active:scale-95 transition-all shadow-sm">
                    <Camera className="w-3.5 h-3.5" /> Câmera
                  </button>
                }
              >
                {barcodes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {barcodes.map(bc => (
                      <span key={bc}
                        className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 shadow-sm">
                        <Barcode className="w-3 h-3 text-indigo-400 shrink-0" />
                        <span className="text-xs font-mono text-indigo-700 dark:text-indigo-300">{bc}</span>
                        <button type="button" onClick={() => removeBarcode(bc)}
                          className="w-4 h-4 flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input type="text" value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBarcode(barcodeInput); } }}
                    placeholder="Cole ou digite o código → Enter"
                    className={fieldCls} />
                  <button type="button" onClick={() => addBarcode(barcodeInput)} disabled={!barcodeInput.trim()}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-indigo-400/80">EAN-13, QR Code, Code128 — múltiplos por produto</p>
              </Section>

              {/* ── Porcionamento ────────────────────────────────────────── */}
              <Section icon={<Scissors className="w-4 h-4" />} title="Porcionamento" accent="amber">
                <div className="space-y-2">
                  {/* Porcionável */}
                  <label className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                    formData.is_portion ? 'opacity-40 cursor-not-allowed' : 'hover:bg-amber-100/60 dark:hover:bg-amber-900/20'
                  }`}>
                    <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                      formData.is_portionable
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}>
                      {formData.is_portionable && <Check className="w-3 h-3" />}
                    </div>
                    <input id="is_portionable" name="is_portionable" type="checkbox"
                      checked={formData.is_portionable} onChange={handleInputChange}
                      disabled={formData.is_portion} className="sr-only" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Produto Porcionável</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Item precisa ser processado antes de ir para setores (ex: peça de carne, caixa de cereal).</p>
                    </div>
                  </label>

                  {/* Auto-porcionamento (expansível) */}
                  {formData.is_portionable && (
                    <div className="ml-8 p-3 rounded-xl bg-amber-100/70 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-3">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider">Auto-porcionamento</p>

                      {/* Busca produto porção */}
                      <div>
                        <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Produto porção resultante</label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                          <input type="text" placeholder="Buscar produto porção..." value={portionSearch}
                            onChange={e => setPortionSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-colors" />
                          {portionSearch && (
                            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                              {portionFiltered.length === 0
                                ? <p className="px-3 py-2 text-xs text-slate-400">Nenhum produto porção encontrado</p>
                                : portionFiltered.map(p => (
                                  <button key={p.id} type="button"
                                    onClick={() => { setFormData(prev => ({ ...prev, auto_portion_product_id: p.id, auto_portion_multiplier: prev.auto_portion_multiplier || 1 })); setPortionSearch(''); }}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/30 text-slate-800 dark:text-slate-200">
                                    {p.name} <span className="text-xs text-slate-400">({p.category})</span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {formData.auto_portion_product_id && (
                        <>
                          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-200/60 dark:bg-amber-900/40">
                            <Check className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                            <span className="flex-1 text-sm font-medium text-amber-800 dark:text-amber-200 truncate">
                              {portionProducts.find(p => p.id === formData.auto_portion_product_id)?.name || 'Selecionado'}
                            </span>
                            <button type="button" onClick={() => setFormData(prev => ({ ...prev, auto_portion_product_id: null, auto_portion_multiplier: null }))}
                              className="text-amber-600 hover:text-red-500 transition-colors"><X className="w-3.5 h-3.5" /></button>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Fator de conversão</label>
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                              <span>1 un</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                              <input type="text" inputMode="decimal"
                                value={formData.auto_portion_multiplier || ''}
                                onChange={e => setFormData(prev => ({ ...prev, auto_portion_multiplier: parseFloat(e.target.value.replace(',', '.')) || null }))}
                                className="w-24 text-center font-bold text-sm rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400"
                                placeholder="1000" />
                              <span>un porção</span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1">Ex: 1 kg = 1000 g → 1000</p>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* É uma Porção */}
                  <label className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                    formData.is_portionable ? 'opacity-40 cursor-not-allowed' : 'hover:bg-amber-100/60 dark:hover:bg-amber-900/20'
                  }`}>
                    <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                      formData.is_portion
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}>
                      {formData.is_portion && <Check className="w-3 h-3" />}
                    </div>
                    <input id="is_portion" name="is_portion" type="checkbox"
                      checked={formData.is_portion} onChange={handleInputChange}
                      disabled={formData.is_portionable} className="sr-only" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">É uma Porção</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Este item é o resultado do porcionamento de outro (ex: bife, dose de bebida).</p>
                    </div>
                  </label>
                </div>
              </Section>

              {/* ── Fornecedores ─────────────────────────────────────────── */}
              <Section
                icon={<Phone className="w-4 h-4" />}
                title="Fornecedores"
                badge={String(selectedContactIds.size + manualSuppliers.length)}
                accent="green"
                action={supplierContacts.length > 0 ? (
                  <button type="button" onClick={() => setShowContactList(!showContactList)}
                    className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 hover:underline font-medium">
                    {showContactList ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showContactList ? 'Ocultar lista' : 'Ver contatos'}
                  </button>
                ) : undefined}
              >
                {/* Tags selecionados */}
                {(selectedContactIds.size > 0 || manualSuppliers.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {supplierContacts.filter(c => selectedContactIds.has(c.id)).map(c => (
                      <span key={c.id}
                        className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-green-600 text-white text-xs font-medium shadow-sm">
                        <MessageSquare className="w-3 h-3" />
                        {c.company_name}
                        <button type="button" onClick={() => setSelectedContactIds(prev => { const n = new Set(prev); n.delete(c.id); return n; })}
                          className="w-4 h-4 flex items-center justify-center rounded hover:bg-green-700 transition-colors">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                    {manualSuppliers.map((name, idx) => (
                      <span key={`m-${idx}`}
                        className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-slate-500 text-white text-xs font-medium shadow-sm">
                        <Building2 className="w-3 h-3" />
                        {name}
                        <button type="button" onClick={() => setManualSuppliers(prev => prev.filter((_, i) => i !== idx))}
                          className="w-4 h-4 flex items-center justify-center rounded hover:bg-slate-600 transition-colors">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Lista de contatos */}
                {showContactList && supplierContacts.length > 0 && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                      <input type="text" value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)}
                        placeholder="Buscar por nome ou telefone..."
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400/40 focus:border-green-400 transition-colors" />
                    </div>
                    <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                      {supplierContacts
                        .filter(c => {
                          if (!supplierSearch) return true;
                          const q = supplierSearch.toLowerCase();
                          return c.company_name.toLowerCase().includes(q) ||
                            (c.contact_name || '').toLowerCase().includes(q) ||
                            c.whatsapp_number.includes(q);
                        })
                        .map(c => (
                          <button type="button" key={c.id}
                            onClick={() => setSelectedContactIds(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                              selectedContactIds.has(c.id)
                                ? 'bg-green-50 dark:bg-green-900/20'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                            }`}>
                            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                              selectedContactIds.has(c.id)
                                ? 'bg-green-600 border-green-600 text-white'
                                : 'border-slate-300 dark:border-slate-500'
                            }`}>
                              {selectedContactIds.has(c.id) && <Check className="w-3 h-3" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{c.company_name}</p>
                              <p className="text-xs text-slate-400 truncate">
                                {c.whatsapp_number}{c.contact_name && ` — ${c.contact_name}`}
                              </p>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* Input manual */}
                <div className="flex gap-2">
                  <input type="text" value={manualInput} onChange={e => setManualInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManualSupplier(); } }}
                    placeholder="Digitar fornecedor manualmente → Enter"
                    className={fieldCls} />
                  <button type="button" onClick={addManualSupplier} disabled={!manualInput.trim()}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-green-500/70">Selecione da lista de contatos (WhatsApp) ou adicione manualmente.</p>
              </Section>

              {/* ── Visibilidade por Setor ───────────────────────────────── */}
              <Section icon={<Eye className="w-4 h-4" />} title="Visibilidade por Setor" accent="purple">
                {loadingSectors ? (
                  <div className="flex justify-center items-center h-12">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  </div>
                ) : sectors.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-2">Nenhum setor cadastrado.</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-slate-400">{selectedSectors.size} de {sectors.length} setores selecionados</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setSelectedSectors(new Set(sectors.map(s => s.id)))}
                          className="text-xs text-purple-600 dark:text-purple-400 hover:underline">Todos</button>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <button type="button" onClick={() => setSelectedSectors(new Set())}
                          className="text-xs text-slate-400 hover:underline">Nenhum</button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {sectors.map(sector => (
                        <button type="button" key={sector.id} onClick={() => handleSectorToggle(sector.id)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all active:scale-95 ${
                            selectedSectors.has(sector.id)
                              ? 'bg-purple-600 border-purple-600 text-white shadow-sm shadow-purple-500/20'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-purple-300 dark:hover:border-purple-700'
                          }`}>
                          {selectedSectors.has(sector.id) && <Check className="w-3 h-3" />}
                          {sector.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </Section>

              {/* ── Classificação Fiscal ─────────────────────────────────── */}
              <Section icon={<FileText className="w-4 h-4" />} title="Classificação Fiscal" accent="slate">
                {/* Tipo do Produto — card toggle */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Tipo do Produto</p>
                  <div className="grid grid-cols-2 gap-2">
                    {PRODUCT_TYPE_OPTIONS.map(opt => (
                      <button key={opt.value} type="button"
                        onClick={() => setFormData(prev => ({ ...prev, product_type: opt.value }))}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                          formData.product_type === opt.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500'
                        }`}>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                          formData.product_type === opt.value
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-slate-300 dark:border-slate-500'
                        }`}>
                          {formData.product_type === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
                  {/* Unidade de Medida */}
                  <div className="sm:col-span-1">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                      <Scale className="w-3 h-3 inline mr-1" />Unidade de Medida
                    </label>
                    <select name="unit_measure" value={formData.unit_measure} onChange={handleInputChange} className={selectCls}>
                      {UNIT_MEASURE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>

                  {/* NCM */}
                  <div className="sm:col-span-1">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                      <Hash className="w-3 h-3 inline mr-1" />Código NCM
                    </label>
                    <input name="mcu_code" type="text" value={formData.mcu_code} onChange={handleInputChange}
                      placeholder="00000000" className={fieldCls} />
                  </div>

                  {/* Imposto */}
                  <div className="sm:col-span-1">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                      <Percent className="w-3 h-3 inline mr-1" />Imposto (%)
                    </label>
                    <input name="tax_percentage" type="text" inputMode="decimal" value={formData.tax_percentage}
                      onChange={handleInputChange} placeholder="0" className={fieldCls} />
                  </div>
                </div>
              </Section>

            </div>

            {/* ── Footer ─────────────────────────────────────────────────── */}
            <div className="sticky bottom-0 flex-shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-100 dark:border-slate-700/80 bg-white dark:bg-slate-900">
              <button type="button" onClick={onClose}
                className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={isSaving}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors shadow-sm disabled:opacity-60 ${
                  editingProduct
                    ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'
                    : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                }`}>
                {isSaving
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</>
                  : editingProduct
                    ? <><Check className="w-4 h-4" /> Salvar Alterações</>
                    : <><Plus className="w-4 h-4" /> Criar Produto</>
                }
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Scanner câmera (acima do modal) */}
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
