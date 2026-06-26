import React, { useState, useMemo } from 'react';
import { FileSpreadsheet, Download, ChevronDown, ChevronUp } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useNotification } from '../context/NotificationContext';

interface Product {
  id: string;
  name: string;
  category: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  supplier?: string;
  description?: string;
  is_active: boolean;
  last_purchase_date?: string;
  last_purchase_price?: number;
  average_price?: number;
  is_portionable?: boolean;
  is_portion?: boolean;
  unit_measure?: string;
  product_type?: string;
  mcu_code?: string;
  tax_percentage?: number;
}

interface ExportInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  categories: string[];
  hotelCode?: string;
}

type ProductTypeFilter = 'all' | 'full' | 'portion';
type StatusFilter = 'active' | 'inactive' | 'all';

const FIELD_GROUPS = [
  {
    label: 'Identificação',
    fields: [
      { key: 'name',         label: 'Nome',              required: true },
      { key: 'category',     label: 'Categoria' },
      { key: 'unit_measure', label: 'Unidade de Medida' },
      { key: 'product_type', label: 'Tipo de Produto' },
      { key: 'mcu_code',     label: 'Código MCU' },
      { key: 'barcodes',     label: 'Código(s) de Barras' },
    ],
  },
  {
    label: 'Estoque',
    fields: [
      { key: 'quantity',     label: 'Quantidade Atual' },
      { key: 'min_quantity', label: 'Quantidade Mínima' },
      { key: 'max_quantity', label: 'Quantidade Máxima' },
    ],
  },
  {
    label: 'Financeiro',
    fields: [
      { key: 'last_purchase_date',  label: 'Última Compra' },
      { key: 'last_purchase_price', label: 'Último Preço' },
      { key: 'average_price',       label: 'Preço Médio' },
      { key: 'tax_percentage',      label: 'Percentual de Imposto (%)' },
    ],
  },
  {
    label: 'Informações Adicionais',
    fields: [
      { key: 'supplier',      label: 'Fornecedor' },
      { key: 'description',   label: 'Descrição' },
      { key: 'is_portionable', label: 'É Porcionável' },
      { key: 'is_portion',    label: 'É Porção' },
      { key: 'status',        label: 'Status (Ativo/Inativo)' },
    ],
  },
];

const ALL_FIELD_KEYS = FIELD_GROUPS.flatMap(g => g.fields.map(f => f.key));

const UNIT_MEASURE_LABELS: Record<string, string> = {
  und: 'Unidade', kg: 'Quilograma', g: 'Grama', l: 'Litro', ml: 'Mililitro', cx: 'Caixa', pct: 'Pacote',
};

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  consumo: 'Consumo', controle: 'Controle',
};

export default function ExportInventoryModal({
  isOpen, onClose, products, categories, hotelCode,
}: ExportInventoryModalProps) {
  const { addNotification } = useNotification();

  // Category filter
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(categories));
  const [catExpanded, setCatExpanded] = useState(true);

  // Product type filter
  const [productTypeFilter, setProductTypeFilter] = useState<ProductTypeFilter>('all');

  // Status filter
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

  // Fields
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    new Set(ALL_FIELD_KEYS.filter(k => k !== 'mcu_code' && k !== 'tax_percentage' && k !== 'is_portionable' && k !== 'is_portion'))
  );

  const [exporting, setExporting] = useState(false);

  // Reset state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setSelectedCategories(new Set(categories));
      setProductTypeFilter('all');
      setStatusFilter('active');
      setSelectedFields(new Set(ALL_FIELD_KEYS.filter(k => k !== 'mcu_code' && k !== 'tax_percentage' && k !== 'is_portionable' && k !== 'is_portion')));
    }
  }, [isOpen, categories]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const toggleField = (key: string) => {
    if (key === 'name') return; // required
    setSelectedFields(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleAllCategories = () => {
    if (selectedCategories.size === categories.length) {
      setSelectedCategories(new Set());
    } else {
      setSelectedCategories(new Set(categories));
    }
  };

  const toggleGroupFields = (groupFields: { key: string; required?: boolean }[]) => {
    const keys = groupFields.filter(f => !f.required).map(f => f.key);
    const allSelected = keys.every(k => selectedFields.has(k));
    setSelectedFields(prev => {
      const next = new Set(prev);
      keys.forEach(k => allSelected ? next.delete(k) : next.add(k));
      return next;
    });
  };

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (!selectedCategories.has(p.category)) return false;
      if (statusFilter === 'active' && !p.is_active) return false;
      if (statusFilter === 'inactive' && p.is_active) return false;
      if (productTypeFilter === 'full' && p.is_portion) return false;
      if (productTypeFilter === 'portion' && !p.is_portion) return false;
      return true;
    });
  }, [products, selectedCategories, statusFilter, productTypeFilter]);

  const handleExport = async () => {
    if (filteredProducts.length === 0) {
      addNotification('warning', 'Nenhum produto corresponde aos filtros selecionados.');
      return;
    }
    setExporting(true);
    try {
      // Fetch barcodes if needed
      let barcodeMap: Record<string, string[]> = {};
      if (selectedFields.has('barcodes')) {
        const ids = filteredProducts.map(p => p.id);
        const { data } = await supabase
          .from('product_barcodes')
          .select('product_id, barcode')
          .in('product_id', ids);
        if (data) {
          data.forEach(row => {
            if (!barcodeMap[row.product_id]) barcodeMap[row.product_id] = [];
            barcodeMap[row.product_id].push(row.barcode);
          });
        }
      }

      const rows = filteredProducts.map(p => {
        const row: Record<string, string | number> = {};
        if (selectedFields.has('name'))         row['Nome'] = p.name;
        if (selectedFields.has('category'))     row['Categoria'] = p.category;
        if (selectedFields.has('unit_measure')) row['Unidade'] = p.unit_measure ? (UNIT_MEASURE_LABELS[p.unit_measure] ?? p.unit_measure) : '';
        if (selectedFields.has('product_type')) row['Tipo'] = p.product_type ? (PRODUCT_TYPE_LABELS[p.product_type] ?? p.product_type) : '';
        if (selectedFields.has('mcu_code'))     row['Código MCU'] = p.mcu_code ?? '';
        if (selectedFields.has('barcodes'))     row['Código(s) de Barras'] = (barcodeMap[p.id] ?? []).join(' | ');
        if (selectedFields.has('quantity'))     row['Qtd Atual'] = p.quantity;
        if (selectedFields.has('min_quantity')) row['Qtd Mínima'] = p.min_quantity;
        if (selectedFields.has('max_quantity')) row['Qtd Máxima'] = p.max_quantity;
        if (selectedFields.has('last_purchase_date'))
          row['Última Compra'] = p.last_purchase_date ? new Date(p.last_purchase_date).toLocaleDateString('pt-BR') : '';
        if (selectedFields.has('last_purchase_price'))
          row['Último Preço (R$)'] = p.last_purchase_price != null ? p.last_purchase_price : '';
        if (selectedFields.has('average_price'))
          row['Preço Médio (R$)'] = p.average_price != null ? p.average_price : '';
        if (selectedFields.has('tax_percentage'))
          row['Imposto (%)'] = p.tax_percentage != null ? p.tax_percentage : '';
        if (selectedFields.has('supplier'))     row['Fornecedor'] = p.supplier ?? '';
        if (selectedFields.has('description'))  row['Descrição'] = p.description ?? '';
        if (selectedFields.has('is_portionable')) row['Porcionável'] = p.is_portionable ? 'Sim' : 'Não';
        if (selectedFields.has('is_portion'))   row['É Porção'] = p.is_portion ? 'Sim' : 'Não';
        if (selectedFields.has('status'))       row['Status'] = p.is_active ? 'Ativo' : 'Inativo';
        return row;
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      // Auto column widths
      const colWidths = Object.keys(rows[0] ?? {}).map(key => ({
        wch: Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length)) + 2,
      }));
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Inventário');
      const date = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `inventario_${hotelCode ?? 'geral'}_${date}.xlsx`);
      addNotification('success', `${rows.length} produto(s) exportado(s) com sucesso!`);
      onClose();
    } catch {
      addNotification('error', 'Erro ao gerar o arquivo Excel.');
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Exportar Inventário</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Configure o arquivo Excel antes de exportar</p>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">

          {/* Categories */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <button
              onClick={() => setCatExpanded(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Categorias</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">{selectedCategories.size}/{categories.length} selecionadas</span>
                {catExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>
            </button>
            {catExpanded && (
              <div className="px-4 py-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedCategories.size === categories.length}
                    onChange={toggleAllCategories}
                    className="rounded text-green-600"
                  />
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Todas as categorias</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
                  {categories.map(cat => (
                    <label key={cat} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={selectedCategories.has(cat)}
                        onChange={() => toggleCategory(cat)}
                        className="rounded text-green-600"
                      />
                      <span className="text-xs text-slate-600 dark:text-slate-300 truncate" title={cat}>{cat}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Filters row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Tipo de Produto</label>
              <div className="flex flex-col gap-1">
                {([['all','Todos'],['full','Apenas Cheios'],['portion','Apenas Porções']] as const).map(([val, lbl]) => (
                  <label key={val} className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="radio" name="productType" value={val}
                      checked={productTypeFilter === val}
                      onChange={() => setProductTypeFilter(val)}
                      className="text-green-600" />
                    <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Status</label>
              <div className="flex flex-col gap-1">
                {([['active','Apenas Ativos'],['inactive','Apenas Inativos'],['all','Todos']] as const).map(([val, lbl]) => (
                  <label key={val} className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="radio" name="status" value={val}
                      checked={statusFilter === val}
                      onChange={() => setStatusFilter(val)}
                      className="text-green-600" />
                    <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Fields */}
          <div>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Colunas do Excel</p>
            <div className="space-y-3">
              {FIELD_GROUPS.map(group => {
                const groupKeys = group.fields.filter(f => !f.required).map(f => f.key);
                const allGroupSelected = groupKeys.every(k => selectedFields.has(k));
                return (
                  <div key={group.label} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-700/50">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{group.label}</span>
                      <button
                        onClick={() => toggleGroupFields(group.fields)}
                        className="text-[10px] text-green-600 dark:text-green-400 hover:underline"
                      >
                        {allGroupSelected ? 'Desmarcar grupo' : 'Selecionar grupo'}
                      </button>
                    </div>
                    <div className="px-4 py-2 grid grid-cols-2 gap-1.5">
                      {group.fields.map(field => (
                        <label key={field.key} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={selectedFields.has(field.key)}
                            onChange={() => toggleField(field.key)}
                            disabled={field.required}
                            className="rounded text-green-600 disabled:opacity-60"
                          />
                          <span className="text-xs text-slate-600 dark:text-slate-300">
                            {field.label}
                            {field.required && <span className="ml-1 text-[10px] text-slate-400">(obrigatório)</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 shrink-0">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredProducts.length}</span> produto(s) · <span className="font-semibold text-slate-700 dark:text-slate-200">{selectedFields.size}</span> coluna(s)
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || filteredProducts.length === 0 || selectedFields.size === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {exporting ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              ) : (
                <Download className="w-4 h-4" />
              )}
              {exporting ? 'Gerando...' : 'Exportar Excel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
