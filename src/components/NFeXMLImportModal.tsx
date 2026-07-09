// src/components/NFeXMLImportModal.tsx
// Modal de importação de XML NF-e para a tela de Nova Compra.
// Fluxo: upload XML → parse → reconcilia via cEAN com inventário → confirma

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  FileText, Upload, CheckCircle2, PlusCircle, Sparkles,
  AlertCircle, ChevronDown, ChevronUp, X, Building2, Calendar,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { lookupCnpj, supplierService, formatCnpj } from '../lib/supplierService';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string;
  description?: string;
  image_url?: string;
}

interface CurrentItem {
  product_id?: string;
  product?: Product;
  isNew: boolean;
  newProduct?: { name: string; category: string };
}

/** Resultado de um item da NF-e após reconciliação */
export interface NFeLineResult {
  /** Ação a ser tomada ao confirmar */
  action: 'update' | 'add' | 'create';
  xProd: string;   // nome no XML
  cEAN: string;    // código EAN (pode ser "SEM GTIN")
  ncm: string;
  cfop: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unit: string;    // uCom
  /** Crédito IBS do item conforme NF-e (vIBS) */
  ibs: number;
  /** Crédito CBS do item conforme NF-e (vCBS) */
  cbs: number;
  // produto encontrado (ações update / add)
  product?: Product;
  // índice no array items atual (apenas ação update)
  currentItemIndex?: number;
}

export interface NFeImportDup {
  nDup: string;
  dVenc: string;
  vDup: number;
}

export interface NFeImportResult {
  supplier: string;
  supplierCnpj: string;
  supplierId?: string;
  invoiceNumber: string;
  emissionDate: string;
  /** Duplicatas da NF-e: 0=sem cobrança, 1=à vista, >1=parcelado */
  dups: NFeImportDup[];
  lines: NFeLineResult[];
}

interface NFeXMLImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentItems: CurrentItem[];
  hotelId: string;
  onConfirm: (result: NFeImportResult) => void;
  /** XML pré-carregado (ex.: vindo de Financeiro → NF Recebidas) — pula a etapa de upload */
  initialXml?: string;
}

// ── XML helpers ────────────────────────────────────────────────────────────────

function getText(parent: Element | Document, tag: string): string {
  // Tenta com e sem namespace
  const el = parent.getElementsByTagName(tag)[0]
    ?? parent.getElementsByTagNameNS('http://www.portalfiscal.inf.br/nfe', tag)[0];
  return el?.textContent?.trim() ?? '';
}

interface ParsedDup {
  nDup: string;
  dVenc: string;   // YYYY-MM-DD
  vDup: number;
}

interface ParsedNFe {
  supplier: string;
  supplierCnpj: string;
  invoiceNumber: string;
  emissionDate: string;
  items: Array<{
    xProd: string; cEAN: string; ncm: string; cfop: string;
    quantity: number; unitPrice: number; totalPrice: number; unit: string;
    ibs: number; cbs: number;
  }>;
  // Cobrança (vencimentos)
  dups: ParsedDup[];   // 0 = sem cobrança, 1 = à vista, >1 = parcelado
}

function parseNFe(xmlString: string): ParsedNFe | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');
    if (doc.querySelector('parsererror')) return null;

    const supplier     = getText(doc, 'xNome') || getText(doc, 'xFant');
    const supplierCnpj = getText(doc, 'CNPJ');
    const nNF          = getText(doc, 'nNF');
    const dhEmi        = getText(doc, 'dhEmi') || getText(doc, 'dEmi');
    const emissionDate = dhEmi ? dhEmi.split('T')[0] : '';

    const detNodes = doc.getElementsByTagName('det');
    const items = Array.from(detNodes).map(det => {
      const prod = det.getElementsByTagName('prod')[0];
      if (!prod) return null;
      const xProd     = getText(prod, 'xProd');
      const rawEan    = getText(prod, 'cEAN');
      const cEAN      = rawEan === 'SEM GTIN' ? '' : rawEan;
      const ncm       = getText(prod, 'NCM');
      const cfop      = getText(prod, 'CFOP');
      const unit      = getText(prod, 'uCom') || getText(prod, 'uTrib');
      const quantity  = parseFloat(getText(prod, 'qCom') || getText(prod, 'qTrib') || '0');
      const unitPrice = parseFloat(getText(prod, 'vUnCom') || getText(prod, 'vUnTrib') || '0');
      const totalPrice= parseFloat(getText(prod, 'vProd') || '0');
      // IBS e CBS reais conforme NF-e (bloco <IBSCBS><gIBSCBS>)
      const imposto   = det.getElementsByTagName('imposto')[0];
      const ibs       = imposto ? parseFloat(getText(imposto, 'vIBS') || '0') : 0;
      const cbs       = imposto ? parseFloat(getText(imposto, 'vCBS') || '0') : 0;
      return { xProd, cEAN, ncm, cfop, unit, quantity, unitPrice, totalPrice, ibs, cbs };
    }).filter(Boolean) as ParsedNFe['items'];

    // Duplicatas (<cobr><dup>) — um nó por parcela
    const dupNodes = doc.getElementsByTagName('dup');
    const dups: ParsedDup[] = Array.from(dupNodes).map(dup => ({
      nDup:  getText(dup, 'nDup'),
      dVenc: getText(dup, 'dVenc'),   // formato YYYY-MM-DD na NF-e
      vDup:  parseFloat(getText(dup, 'vDup') || '0'),
    })).filter(d => d.dVenc);

    return { supplier, supplierCnpj, invoiceNumber: nNF, emissionDate, items, dups };
  } catch {
    return null;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  update:  { label: 'Atualizar item',   color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', icon: CheckCircle2 },
  add:     { label: 'Adicionar ao carrinho', color: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-50 dark:bg-blue-900/20',       border: 'border-blue-200 dark:border-blue-800',       icon: PlusCircle   },
  create:  { label: 'Criar produto',    color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-900/20',     border: 'border-amber-200 dark:border-amber-800',     icon: Sparkles     },
} as const;

export default function NFeXMLImportModal({
  isOpen, onClose, currentItems, hotelId, onConfirm, initialXml,
}: NFeXMLImportModalProps) {
  const [step, setStep]           = useState<'upload' | 'review'>('upload');
  const [dragging, setDragging]   = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [parseError, setParseError] = useState('');
  const [result, setResult]       = useState<NFeImportResult | null>(null);
  const [expanded, setExpanded]   = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setStep('upload'); setResult(null); setParseError(''); setExpanded(new Set()); };

  const handleClose = () => { reset(); onClose(); };

  // ── Reconciliation ──────────────────────────────────────────────────────────

  const reconcile = useCallback(async (parsed: ReturnType<typeof parseNFe>) => {
    if (!parsed) return;
    setParsing(true);
    try {
      // ── 1. Fornecedor: busca interna primeiro, depois API ──────────────────
      let supplierId: string | undefined;
      const cleanCnpj = parsed.supplierCnpj.replace(/\D/g, '');

      if (cleanCnpj.length === 14) {
        // Consulta banco interno (não consome créditos da API)
        const { data: existing } = await supabase
          .from('suppliers')
          .select('id')
          .eq('hotel_id', hotelId)
          .eq('cnpj', cleanCnpj)
          .maybeSingle();

        if (existing) {
          supplierId = existing.id;
        } else {
          // Não existe localmente → consulta API e cadastra automaticamente
          try {
            const cnpjaData = await lookupCnpj(cleanCnpj);
            const saved = await supplierService.save({
              type: 'juridica',
              status: 'ativo',
              hotel_id: hotelId,
              cnpj:               cnpjaData.cnpj,
              razao_social:       cnpjaData.razao_social,
              nome_fantasia:      cnpjaData.nome_fantasia,
              situacao:           cnpjaData.situacao,
              situacao_cadastral: cnpjaData.situacao_cadastral,
              tipo_empresa:       cnpjaData.tipo_empresa,
              data_abertura:      cnpjaData.data_abertura,
              porte:              cnpjaData.porte,
              capital_social:     cnpjaData.capital_social,
              natureza_juridica:  cnpjaData.natureza_juridica,
              cnae_principal_id:  cnpjaData.cnae_principal_id,
              cnae_principal_desc: cnpjaData.cnae_principal_desc,
              atividade_economica: cnpjaData.atividade_economica,
              simples_nacional:   cnpjaData.simples_nacional,
              mei:                cnpjaData.mei,
              ibs:                cnpjaData.ibs,
              cbs:                cnpjaData.cbs,
              lista_exclusao:     cnpjaData.lista_exclusao,
              email:              cnpjaData.email,
              telefone:           cnpjaData.telefone,
              endereco_cep:       cnpjaData.endereco_cep,
              endereco_logradouro: cnpjaData.endereco_logradouro,
              endereco_numero:    cnpjaData.endereco_numero,
              endereco_complemento: cnpjaData.endereco_complemento,
              endereco_bairro:    cnpjaData.endereco_bairro,
              endereco_municipio: cnpjaData.endereco_municipio,
              endereco_uf:        cnpjaData.endereco_uf,
            });
            supplierId = saved.id;
          } catch {
            // Falha na API — continua sem supplierId (usuário pode selecionar manualmente)
          }
        }
      }

      // ── 2. Barcode → produto ───────────────────────────────────────────────
      const eans = parsed.items.map(i => i.cEAN).filter(Boolean);
      let eanToProductId: Record<string, string> = {};
      if (eans.length > 0) {
        const { data: rows } = await supabase
          .from('product_barcodes')
          .select('barcode, product_id, products!inner(hotel_id)')
          .in('barcode', eans)
          .eq('products.hotel_id', hotelId);
        (rows ?? []).forEach((r: any) => { eanToProductId[r.barcode] = r.product_id; });
      }

      // ── 3. Detalhes dos produtos encontrados ──────────────────────────────
      const productIds = [...new Set(Object.values(eanToProductId))];
      let productMap: Record<string, Product> = {};
      if (productIds.length > 0) {
        const { data: prods } = await supabase
          .from('products')
          .select('id, name, category, description, image_url')
          .in('id', productIds);
        (prods ?? []).forEach((p: any) => { productMap[p.id] = p; });
      }

      // ── 4. Reconciliação de linhas ─────────────────────────────────────────
      const lines: NFeLineResult[] = parsed.items.map(xmlItem => {
        const productId = xmlItem.cEAN ? eanToProductId[xmlItem.cEAN] : undefined;
        const product   = productId ? productMap[productId] : undefined;

        const currentItemIndex = product
          ? currentItems.findIndex(ci => !ci.isNew && ci.product_id === product.id)
          : -1;

        let action: NFeLineResult['action'];
        if (product && currentItemIndex >= 0) action = 'update';
        else if (product) action = 'add';
        else action = 'create';

        return {
          action,
          xProd:      xmlItem.xProd,
          cEAN:       xmlItem.cEAN,
          ncm:        xmlItem.ncm,
          cfop:       xmlItem.cfop,
          quantity:   xmlItem.quantity,
          unitPrice:  xmlItem.unitPrice,
          totalPrice: xmlItem.totalPrice,
          unit:       xmlItem.unit,
          ibs:        xmlItem.ibs,
          cbs:        xmlItem.cbs,
          product,
          currentItemIndex: currentItemIndex >= 0 ? currentItemIndex : undefined,
        };
      });

      setResult({
        supplier:      parsed.supplier,
        supplierCnpj:  parsed.supplierCnpj,
        supplierId,
        invoiceNumber: parsed.invoiceNumber,
        emissionDate:  parsed.emissionDate,
        dups:          parsed.dups,
        lines,
      });
      setStep('review');
    } catch {
      setParseError('Erro ao consultar o inventário. Tente novamente.');
    } finally {
      setParsing(false);
    }
  }, [currentItems, hotelId]);

  // XML pré-carregado (Financeiro → NF Recebidas): parseia e reconcilia direto,
  // sem etapa de upload. Precisa vir depois da declaração de `reconcile`.
  const initialXmlProcessed = useRef(false);
  useEffect(() => {
    if (!isOpen) { initialXmlProcessed.current = false; return; }
    if (!initialXml || initialXmlProcessed.current) return;
    initialXmlProcessed.current = true;
    const parsed = parseNFe(initialXml);
    if (!parsed) { setParseError('Não foi possível ler o XML da nota recebida.'); return; }
    if (parsed.items.length === 0) { setParseError('Nenhum item (det) encontrado no XML da nota recebida.'); return; }
    reconcile(parsed);
  }, [isOpen, initialXml, reconcile]);

  // ── File handling ───────────────────────────────────────────────────────────

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      setParseError('Selecione um arquivo .xml'); return;
    }
    setParseError('');
    const reader = new FileReader();
    reader.onload = async e => {
      const text = e.target?.result as string;
      const parsed = parseNFe(text);
      if (!parsed) { setParseError('Não foi possível ler o XML. Verifique se é uma NF-e válida.'); return; }
      if (parsed.items.length === 0) { setParseError('Nenhum item (det) encontrado no XML.'); return; }
      await reconcile(parsed);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const toggleExpand = (idx: number) =>
    setExpanded(prev => { const s = new Set(prev); s.has(idx) ? s.delete(idx) : s.add(idx); return s; });

  // ── Summary counts ──────────────────────────────────────────────────────────
  const counts = result ? {
    update: result.lines.filter(l => l.action === 'update').length,
    add:    result.lines.filter(l => l.action === 'add').length,
    create: result.lines.filter(l => l.action === 'create').length,
  } : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Importar NF-e (XML)</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {step === 'upload' ? 'Selecione o arquivo XML da nota fiscal' : 'Revise os itens antes de confirmar'}
            </p>
          </div>
          <button onClick={handleClose} className="ml-auto p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── STEP: UPLOAD ── */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`
                  relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed
                  cursor-pointer transition-colors py-14
                  ${dragging
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-slate-300 dark:border-slate-600 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'}
                `}
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <Upload className="w-7 h-7 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Arraste o XML aqui ou clique para selecionar</p>
                  <p className="text-xs text-slate-400 mt-1">Arquivo .xml da NF-e (nfeProc ou NFe)</p>
                </div>
                <input ref={fileRef} type="file" accept=".xml" className="hidden" onChange={onFileChange} />
              </div>

              {parsing && (
                <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Lendo XML e consultando inventário…
                </div>
              )}

              {parseError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {parseError}
                </div>
              )}

              <div className="text-xs text-slate-400 dark:text-slate-500 space-y-1">
                <p className="font-medium text-slate-500 dark:text-slate-400">Como funciona:</p>
                <p>• <span className="font-medium text-violet-600 dark:text-violet-400">Fornecedor:</span> busca no banco interno → se não existir, consulta API via CNPJ e cadastra automaticamente</p>
                <p>• Itens com cEAN já na lista de compra → <span className="text-emerald-600 dark:text-emerald-400 font-medium">quantidade e preço atualizados</span></p>
                <p>• Itens com cEAN no inventário → <span className="text-blue-600 dark:text-blue-400 font-medium">adicionados à lista de compra</span></p>
                <p>• Itens sem correspondência → <span className="text-amber-600 dark:text-amber-400 font-medium">novo produto criado ao salvar</span></p>
              </div>
            </div>
          )}

          {/* ── STEP: REVIEW ── */}
          {step === 'review' && result && (
            <div className="space-y-4">

              {/* NF-e header info */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Fornecedor', value: result.supplier },
                  { label: 'Número NF',  value: result.invoiceNumber },
                  { label: 'Emissão',    value: result.emissionDate ? new Date(result.emissionDate + 'T12:00:00').toLocaleDateString('pt-BR') : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl bg-slate-50 dark:bg-slate-700/50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</p>
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate mt-0.5" title={value}>{value || '—'}</p>
                  </div>
                ))}
              </div>

              {/* Supplier status badge */}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border ${
                result.supplierId
                  ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300'
                  : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
              }`}>
                <Building2 className="w-3.5 h-3.5 shrink-0" />
                {result.supplierId
                  ? `Fornecedor vinculado${result.supplierCnpj ? ` · CNPJ ${formatCnpj(result.supplierCnpj)}` : ''}`
                  : `Fornecedor não cadastrado${result.supplierCnpj ? ` (CNPJ: ${formatCnpj(result.supplierCnpj)})` : ''} — selecione manualmente`}
              </div>

              {/* Vencimentos / duplicatas */}
              {result.dups.length > 0 && (
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-indigo-200 dark:border-indigo-800">
                    <Calendar className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                      {result.dups.length === 1 ? 'Vencimento (à vista)' : `Parcelado em ${result.dups.length}×`}
                    </span>
                    <span className="ml-auto text-xs text-indigo-500 dark:text-indigo-400 font-medium">
                      Total: R$ {result.dups.reduce((s, d) => s + d.vDup, 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="divide-y divide-indigo-100 dark:divide-indigo-800/50">
                    {result.dups.map((dup, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5">
                        <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-mono">
                          {dup.nDup || String(i + 1).padStart(3, '0')}
                        </span>
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          {dup.dVenc ? new Date(dup.dVenc + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                          R$ {dup.vDup.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary badges */}
              {counts && (
                <div className="flex flex-wrap gap-2">
                  {counts.update > 0 && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="w-3 h-3" /> {counts.update} item(s) a atualizar
                    </span>
                  )}
                  {counts.add > 0 && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-xs font-medium border border-blue-200 dark:border-blue-800">
                      <PlusCircle className="w-3 h-3" /> {counts.add} item(s) a adicionar
                    </span>
                  )}
                  {counts.create > 0 && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium border border-amber-200 dark:border-amber-800">
                      <Sparkles className="w-3 h-3" /> {counts.create} produto(s) a criar
                    </span>
                  )}
                </div>
              )}

              {/* Lines */}
              <div className="space-y-2">
                {result.lines.map((line, idx) => {
                  const cfg = ACTION_LABELS[line.action];
                  const Icon = cfg.icon;
                  const isExp = expanded.has(idx);
                  return (
                    <div key={idx} className={`rounded-xl border ${cfg.border} ${cfg.bg} overflow-hidden`}>
                      <button
                        type="button"
                        onClick={() => toggleExpand(idx)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left"
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${cfg.color}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                            {line.product?.name ?? line.xProd}
                          </p>
                          {line.product && line.product.name !== line.xProd && (
                            <p className="text-[10px] text-slate-400 truncate">XML: {line.xProd}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {line.quantity} {line.unit} × R$ {line.unitPrice.toFixed(2)}
                          </p>
                          <p className={`text-[10px] font-medium ${cfg.color}`}>{cfg.label}</p>
                        </div>
                        {isExp ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
                      </button>

                      {isExp && (
                        <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-200/50 dark:border-slate-700/50 pt-2">
                          {[
                            ['cEAN', line.cEAN || '—'],
                            ['NCM',  line.ncm  || '—'],
                            ['CFOP', line.cfop || '—'],
                            ['Categoria', line.product?.category ?? '—'],
                            ['Total', `R$ ${line.totalPrice.toFixed(2)}`],
                            line.currentItemIndex !== undefined
                              ? ['Posição na lista', `Item #${line.currentItemIndex + 1}`]
                              : ['', ''],
                          ].map(([k, v], i) => k ? (
                            <div key={i} className="flex gap-1">
                              <span className="text-[10px] text-slate-400 shrink-0">{k}:</span>
                              <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium truncate">{v}</span>
                            </div>
                          ) : null)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 shrink-0">
          {step === 'review' ? (
            <>
              <button
                type="button"
                onClick={() => { reset(); }}
                className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                ← Trocar arquivo
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={handleClose}
                  className="px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => { onConfirm(result!); handleClose(); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Confirmar importação
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={handleClose}
              className="ml-auto px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
