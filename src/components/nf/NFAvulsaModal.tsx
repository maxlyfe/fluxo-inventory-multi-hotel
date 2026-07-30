// NFAvulsaModal — Emissão de NF avulsa (sem reserva): NFS-e, NFC-e ou ambas.
// Serviços do catálogo → NFS-e; produtos da ficha técnica (com NCM) → NFC-e.
// Reusa o pipeline existente: createDraftInvoice + emitInvoice.

import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Search, Loader2, Building2, Receipt, ShoppingBag, FileText,
  CheckCircle2, AlertCircle, Plus, Minus, Trash2, Eye, RefreshCw, Layers,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { nfService, matchesEligibleService, type NfceEligibleService, type ServiceFiscalResult } from '../../lib/nfService';
import { serviceCatalogService, type HotelService } from '../../lib/serviceCatalogService';
import type { NFHotelConfig, NFInvoice, NFTipo, NFDocTipo } from '../../types/nf';

// ── Tipos ────────────────────────────────────────────────────────────────────

type TipoAvulsa = 'nfse' | 'nfce' | 'ambas';
type StepKey = 'tipo' | 'itens' | 'pagamento' | 'tomador' | 'confirmar' | 'emitida';

interface ProductOption {
  id: string;
  name: string;
  price: number | null;
  ncm: string;
  cfop: string;
  icms_aliquota: number | null;
  pis_cst: string | null;
  pis_aliquota: number | null;
  cofins_cst: string | null;
  cofins_aliquota: number | null;
  ibs_cbs_cst: string | null;
  ibs_cbs_cclasstrib: string | null;
  ibs_aliquota: number | null;
  cbs_aliquota: number | null;
}

interface AvulsaItem {
  key: string;
  kind: 'service' | 'product';
  refId: string;
  description: string;
  qty: number;
  unitPrice: string;          // string para edição no input
  priceEditable: boolean;
  fiscal?: Omit<ProductOption, 'id' | 'name' | 'price'>;
}

interface EmitSlot {
  draftId: string;
  status: 'pending' | 'ok' | 'error';
  invoice?: NFInvoice;
  error?: string;
}

interface NFAvulsaModalProps {
  isOpen: boolean;
  hotelId: string;
  canNfse: boolean;
  canNfce: boolean;
  onClose: () => void;
  onEmitted: () => void;
  onView: (invoiceId: string, tipo: NFTipo) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TPAG_OPTS: Array<[string, string]> = [
  ['01', 'Dinheiro'], ['17', 'PIX'], ['03', 'Cartão de Crédito'], ['04', 'Cartão de Débito'],
  ['15', 'Boleto Bancário'], ['05', 'Crédito Loja'], ['18', 'Transferência / Carteira Digital'],
  ['90', 'Sem Pagamento'], ['99', 'Outros'],
];

function validateCpf(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(clean.charAt(i)) * (10 - i);
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(9))) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(clean.charAt(i)) * (11 - i);
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  return rev === parseInt(clean.charAt(10));
}

function validateCnpj(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(clean)) return false;
  let size = clean.length - 2;
  let numbers = clean.substring(0, size);
  const digits = clean.substring(size);
  let sum = 0;
  let pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(digits.charAt(0))) return false;
  size = size + 1;
  numbers = clean.substring(0, size);
  sum = 0;
  pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return result === parseInt(digits.charAt(1));
}

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const parsePrice = (s: string) => {
  const n = Number(String(s).replace(/[^0-9.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

let localKey = 0;
const nextKey = () => `av-${++localKey}`;

// ── Componente ───────────────────────────────────────────────────────────────

export const NFAvulsaModal: React.FC<NFAvulsaModalProps> = ({
  isOpen, hotelId, canNfse, canNfce, onClose, onEmitted, onView,
}) => {
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [step, setStep] = useState<StepKey>('tipo');
  const [tipoAvulsa, setTipoAvulsa] = useState<TipoAvulsa | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Catálogos
  const [loadingData, setLoadingData] = useState(false);
  const [services, setServices] = useState<HotelService[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [nfceEligible, setNfceEligible] = useState<NfceEligibleService[]>([]);
  const [nfConfig, setNfConfig] = useState<NFHotelConfig | null>(null);
  const [emitterConfig, setEmitterConfig] = useState<NFHotelConfig | null>(null);

  // Itens selecionados
  const [items, setItems] = useState<AvulsaItem[]>([]);
  const [svcSearch, setSvcSearch] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [svcFiscal, setSvcFiscal] = useState<ServiceFiscalResult | null>(null);

  // Pagamento (NFC-e)
  const [pagMulti, setPagMulti] = useState(false);
  const [pagUnico, setPagUnico] = useState('');
  const [pagRows, setPagRows] = useState<{ tPag: string; valor: string }[]>([{ tPag: '', valor: '' }]);

  // Tomador
  const [tomadorDocTipo, setTomadorDocTipo] = useState<NFDocTipo>('cpf');
  const [tomadorNome, setTomadorNome] = useState('');
  const [tomadorCpfCnpj, setTomadorCpfCnpj] = useState('');
  const [tomadorNacionalidade, setTomadorNacionalidade] = useState('');
  const [tomadorEmail, setTomadorEmail] = useState('');
  const [tomadorCep, setTomadorCep] = useState('');
  const [tomadorLogradouro, setTomadorLogradouro] = useState('');
  const [tomadorNumero, setTomadorNumero] = useState('');
  const [tomadorComplemento, setTomadorComplemento] = useState('');
  const [tomadorBairro, setTomadorBairro] = useState('');
  const [tomadorCidade, setTomadorCidade] = useState('');
  const [tomadorUf, setTomadorUf] = useState('');
  // Codigo IBGE do municipio do tomador. Vai em <endNac><cMun> da DPS e nao
  // e digitado: vem da consulta de CEP, para nao divergir do CEP (rejeicao
  // E0240 quando CEP e municipio nao combinam).
  const [tomadorCodMunicipio, setTomadorCodMunicipio] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Busca de empresas cadastradas (fornecedores PJ)
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierResults, setSupplierResults] = useState<any[]>([]);
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [showSupplierPicker, setShowSupplierPicker] = useState(false);

  // Emissão
  const [emitError, setEmitError] = useState<{ title: string; details: string } | null>(null);
  const [emitState, setEmitState] = useState<{ nfse?: EmitSlot; nfce?: EmitSlot } | null>(null);

  // ── Derivados ──────────────────────────────────────────────────────────────

  const serviceItems = useMemo(() => items.filter(i => i.kind === 'service'), [items]);
  const productItems = useMemo(() => items.filter(i => i.kind === 'product'), [items]);
  const includesNfse = tipoAvulsa === 'nfse' || tipoAvulsa === 'ambas';
  const includesNfce = tipoAvulsa === 'nfce' || tipoAvulsa === 'ambas';
  const willEmitNfse = includesNfse && serviceItems.length > 0;
  const willEmitNfce = includesNfce && productItems.length > 0;
  const isForeigner = tomadorDocTipo === 'passaporte';

  const itemTotal = (it: AvulsaItem) => +(it.qty * parsePrice(it.unitPrice)).toFixed(2);
  const serviceSubtotal = useMemo(() => +serviceItems.reduce((s, it) => s + itemTotal(it), 0).toFixed(2), [serviceItems]);
  const productSubtotal = useMemo(() => +productItems.reduce((s, it) => s + itemTotal(it), 0).toFixed(2), [productItems]);

  const stepsFlow = useMemo<StepKey[]>(() => {
    const flow: StepKey[] = ['tipo', 'itens'];
    if (willEmitNfce) flow.push('pagamento');
    flow.push('tomador', 'confirmar');
    return flow;
  }, [willEmitNfce]);
  const stepIndex = stepsFlow.indexOf(step);

  const STEP_LABELS: Record<StepKey, string> = {
    tipo: 'Tipo', itens: 'Itens', pagamento: 'Pagamento', tomador: 'Tomador', confirmar: 'Confirmar', emitida: 'Emitida',
  };

  // ── Reset ao fechar ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) {
      setStep('tipo'); setTipoAvulsa(null); setItems([]); setSvcFiscal(null);
      setPagMulti(false); setPagUnico(''); setPagRows([{ tPag: '', valor: '' }]);
      setTomadorDocTipo('cpf'); setTomadorNome(''); setTomadorCpfCnpj(''); setTomadorNacionalidade('');
      setTomadorEmail(''); setTomadorCep(''); setTomadorLogradouro(''); setTomadorNumero('');
      setTomadorComplemento(''); setTomadorBairro(''); setTomadorCidade(''); setTomadorUf('');
      setFormErrors({}); setEmitError(null); setEmitState(null); setSubmitting(false);
      setSvcSearch(''); setProdSearch('');
    }
  }, [isOpen]);

  // ── Carga de catálogos ao abrir ────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !hotelId) return;
    let cancelled = false;
    setLoadingData(true);
    (async () => {
      try {
        const [svcs, dishRes, priceRes, elig, cfg] = await Promise.all([
          serviceCatalogService.list(hotelId).catch(() => [] as HotelService[]),
          supabase.from('dishes')
            .select('id, name, nfce_ncm, nfce_cfop, nfce_icms_aliquota, nfce_pis_cst, nfce_pis_aliquota, nfce_cofins_cst, nfce_cofins_aliquota, ibs_cbs_cst, ibs_cbs_cclasstrib, ibs_aliquota, cbs_aliquota')
            .or(`hotel_id.eq.${hotelId},hotel_id.is.null`)
            .not('nfce_ncm', 'is', null)
            .neq('nfce_ncm', '')
            .order('name'),
          supabase.from('pdv_menu_prices')
            .select('dish_id, sale_price')
            .eq('hotel_id', hotelId)
            .not('dish_id', 'is', null),
          nfService.getNfceEligibleServices(hotelId).catch(() => [] as NfceEligibleService[]),
          nfService.getConfig(hotelId).catch(() => null),
        ]);
        if (cancelled) return;

        setServices(svcs);
        setNfceEligible(elig);
        setNfConfig(cfg);
        if (cfg && (cfg as any).nfce_emit_redirect_enabled && (cfg as any).nfce_emit_redirect_hotel_id) {
          nfService.getConfig((cfg as any).nfce_emit_redirect_hotel_id).then(c => { if (!cancelled) setEmitterConfig(c); }).catch(() => {});
        } else {
          setEmitterConfig(null);
        }

        const priceMap = new Map<string, number>();
        (priceRes.data || []).forEach((p: any) => {
          if (p.dish_id && p.sale_price != null) priceMap.set(p.dish_id, Number(p.sale_price));
        });
        setProducts((dishRes.data || []).map((d: any) => ({
          id: d.id,
          name: d.name,
          price: priceMap.get(d.id) ?? null,
          ncm: d.nfce_ncm,
          cfop: d.nfce_cfop || '5102',
          icms_aliquota: d.nfce_icms_aliquota != null ? Number(d.nfce_icms_aliquota) : null,
          pis_cst: d.nfce_pis_cst || null,
          pis_aliquota: d.nfce_pis_aliquota != null ? Number(d.nfce_pis_aliquota) : null,
          cofins_cst: d.nfce_cofins_cst || null,
          cofins_aliquota: d.nfce_cofins_aliquota != null ? Number(d.nfce_cofins_aliquota) : null,
          ibs_cbs_cst: d.ibs_cbs_cst || null,
          ibs_cbs_cclasstrib: d.ibs_cbs_cclasstrib || null,
          ibs_aliquota: d.ibs_aliquota != null ? Number(d.ibs_aliquota) : null,
          cbs_aliquota: d.cbs_aliquota != null ? Number(d.cbs_aliquota) : null,
        })));
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, hotelId]);

  // ── Resolução fiscal dos serviços (badges LC116/ISS + uso na nota) ─────────

  useEffect(() => {
    if (serviceItems.length === 0) { setSvcFiscal(null); return; }
    let cancelled = false;
    nfService.resolveServiceFiscalData(
      hotelId,
      serviceItems.map((it, i) => ({ id: -(i + 1), description: it.description, amount: itemTotal(it), service_id: it.refId })),
    ).then(r => { if (!cancelled) setSvcFiscal(r); }).catch(() => { if (!cancelled) setSvcFiscal(null); });
    return () => { cancelled = true; };
  }, [hotelId, serviceItems]);

  // ── Ações de itens ─────────────────────────────────────────────────────────

  const addService = (s: HotelService) => {
    setItems(prev => [...prev, {
      key: nextKey(), kind: 'service', refId: s.id, description: s.name,
      qty: 1,
      unitPrice: s.pricing_mode === 'fixed' && s.price != null ? String(s.price) : '',
      priceEditable: s.pricing_mode !== 'fixed' || s.price == null,
    }]);
  };

  const addProduct = (p: ProductOption) => {
    setItems(prev => [...prev, {
      key: nextKey(), kind: 'product', refId: p.id, description: p.name,
      qty: 1,
      unitPrice: p.price != null ? String(p.price) : '',
      priceEditable: true,
      fiscal: {
        ncm: p.ncm, cfop: p.cfop, icms_aliquota: p.icms_aliquota,
        pis_cst: p.pis_cst, pis_aliquota: p.pis_aliquota,
        cofins_cst: p.cofins_cst, cofins_aliquota: p.cofins_aliquota,
        ibs_cbs_cst: p.ibs_cbs_cst, ibs_cbs_cclasstrib: p.ibs_cbs_cclasstrib,
        ibs_aliquota: p.ibs_aliquota, cbs_aliquota: p.cbs_aliquota,
      },
    }]);
  };

  const updateItem = (key: string, patch: Partial<AvulsaItem>) => {
    setItems(prev => prev.map(it => it.key === key ? { ...it, ...patch } : it));
  };
  const removeItem = (key: string) => setItems(prev => prev.filter(it => it.key !== key));

  // ── Fornecedores (empresas PJ) ─────────────────────────────────────────────

  const searchSuppliers = async (term: string) => {
    if (!hotelId) return;
    setSupplierLoading(true);
    try {
      let query = supabase
        .from('suppliers')
        .select('id, cnpj, razao_social, nome_fantasia, email, telefone, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_municipio, endereco_uf, endereco_cep')
        .eq('hotel_id', hotelId)
        .eq('type', 'juridica')
        .eq('status', 'ativo');
      if (term.trim()) {
        const t = `%${term.trim()}%`;
        query = query.or(`razao_social.ilike.${t},nome_fantasia.ilike.${t},cnpj.ilike.${t}`);
      }
      const { data } = await query.order('razao_social').limit(20);
      setSupplierResults(data || []);
    } finally {
      setSupplierLoading(false);
    }
  };

  const fillFromSupplier = (s: any) => {
    setTomadorDocTipo('cnpj');
    setTomadorNome(s.razao_social || s.nome_fantasia || '');
    setTomadorCpfCnpj(s.cnpj || '');
    setTomadorEmail(s.email || '');
    if (s.endereco_logradouro) setTomadorLogradouro(s.endereco_logradouro);
    if (s.endereco_numero) setTomadorNumero(s.endereco_numero);
    if (s.endereco_complemento) setTomadorComplemento(s.endereco_complemento);
    if (s.endereco_bairro) setTomadorBairro(s.endereco_bairro);
    if (s.endereco_municipio) setTomadorCidade(s.endereco_municipio);
    if (s.endereco_uf) setTomadorUf(s.endereco_uf);
    if (s.endereco_cep) { setTomadorCep(s.endereco_cep); void lookupCep(s.endereco_cep); }
    setShowSupplierPicker(false);
    setSupplierSearch('');
    setFormErrors({});
  };

  const lookupCep = async (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 8) return;
    setCepLoading(true);
    setCepError(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!res.ok) { setCepError('Erro ao consultar o CEP'); return; }
      const data = await res.json();
      if (data.erro) { setCepError('CEP nao encontrado'); return; }
      if (data.logradouro) setTomadorLogradouro(data.logradouro);
      if (data.bairro) setTomadorBairro(data.bairro);
      if (data.localidade) setTomadorCidade(data.localidade);
      if (data.uf) setTomadorUf(data.uf);
      if (data.ibge) setTomadorCodMunicipio(String(data.ibge));
    } catch {
      setCepError('Falha na consulta. Preencha o endereco manualmente.');
    } finally {
      setCepLoading(false);
    }
  };

  const getFullAddress = () => {
    if (!tomadorLogradouro.trim()) return '';
    return `${tomadorLogradouro}, ${tomadorNumero}${tomadorComplemento ? ` (${tomadorComplemento})` : ''}, ${tomadorBairro}, ${tomadorCidade} / ${tomadorUf}, CEP ${tomadorCep}`;
  };

  // ── Validações por passo ───────────────────────────────────────────────────

  const validateItensStep = (): string | null => {
    if (items.length === 0) return 'Adicione pelo menos um item.';
    if (includesNfse && !includesNfce && serviceItems.length === 0) return 'Adicione pelo menos um serviço para a NFS-e.';
    if (includesNfce && !includesNfse && productItems.length === 0) return 'Adicione pelo menos um produto para a NFC-e.';
    for (const it of items) {
      if (it.qty < 1) return `Quantidade inválida em "${it.description}".`;
      if (parsePrice(it.unitPrice) <= 0) return `Informe o valor de "${it.description}".`;
    }
    return null;
  };

  const validatePagamentoStep = (): string | null => {
    if (!willEmitNfce) return null;
    const total = productSubtotal;
    if (!pagMulti) {
      if (!pagUnico) return 'Selecione a forma de pagamento.';
      return null;
    }
    const rows = pagRows.filter(r => r.tPag || r.valor);
    if (rows.length === 0 || rows.some(r => !r.tPag || !r.valor || Number(r.valor) <= 0)) {
      return 'Preencha a forma e o valor de cada pagamento.';
    }
    const soma = +rows.reduce((s, r) => s + Number(r.valor), 0).toFixed(2);
    if (Math.abs(soma - total) > 0.01) {
      return `A soma das formas (${fmtBRL(soma)}) precisa ser igual ao total dos produtos (${fmtBRL(total)}).`;
    }
    return null;
  };

  const validateTomadorStep = (): boolean => {
    const errors: Record<string, string> = {};
    const cleanDoc = tomadorCpfCnpj.replace(/\D/g, '');

    if (willEmitNfse) {
      if (!tomadorNome.trim()) errors.tomadorNome = 'Nome é obrigatório para NFS-e';
      if (tomadorDocTipo === 'passaporte') {
        if (!tomadorCpfCnpj.trim()) errors.tomadorCpfCnpj = 'Número do passaporte é obrigatório';
      } else if (!cleanDoc) {
        errors.tomadorCpfCnpj = 'CPF ou CNPJ é obrigatório para NFS-e';
      }
    }

    if (cleanDoc && tomadorDocTipo === 'cpf' && !validateCpf(cleanDoc)) errors.tomadorCpfCnpj = 'CPF inválido';
    if (cleanDoc && tomadorDocTipo === 'cnpj' && !validateCnpj(cleanDoc)) errors.tomadorCpfCnpj = 'CNPJ inválido';
    if (tomadorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tomadorEmail)) errors.tomadorEmail = 'E-mail inválido';

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateConfig = (): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    if (!nfConfig) {
      errors.push('Configuração fiscal não encontrada. Acesse Configurações > NF-e / NFS-e para cadastrar os dados da empresa.');
      return { valid: false, errors };
    }
    const c = emitterConfig || nfConfig;
    if (!c.is_active) errors.push('A configuração fiscal está desativada para este hotel.');
    if (!c.cnpj) errors.push('CNPJ da empresa não cadastrado.');
    if (!c.razao_social) errors.push('Razão social não cadastrada.');

    if (willEmitNfse) {
      if (!nfConfig.nfse_enabled) errors.push('Emissão de NFS-e está desabilitada nas configurações.');
      if (!nfConfig.inscricao_municipal) errors.push('Inscrição Municipal não cadastrada (obrigatória para NFS-e).');
      const allResolved = serviceItems.length > 0 && serviceItems.every((_, i) =>
        svcFiscal?.items.find(s => s.erbon_entry_id === -(i + 1))?.codigo_servico
      );
      if (!nfConfig.codigo_servico && !allResolved) {
        errors.push('Código de serviço não cadastrado (configure na aba NFS-e ou cadastre o LC 116 nos serviços do catálogo).');
      }
      // A DPS da NFS-e Nacional (formatos 'adn' e 'el-nacional') exige o
      // endereço do tomador com o código IBGE do município. Sem isso a
      // Plataforma Nacional devolve a rejeição E0234, então barramos antes de
      // gastar uma tentativa de emissão.
      const provider = (nfConfig as any).nfse_provider;
      if (provider === 'adn' || provider === 'el-nacional') {
        if (!tomadorLogradouro.trim() || !tomadorNumero.trim() || !tomadorBairro.trim()) {
          errors.push('Endereço do tomador incompleto: logradouro, número e bairro são obrigatórios na NFS-e Nacional.');
        }
        if (!tomadorCodMunicipio.trim()) {
          errors.push('Município do tomador não identificado. Digite o CEP para o sistema buscar o município (a NFS-e Nacional exige o código IBGE, que vem dessa consulta).');
        }
      }
    }
    if (willEmitNfce) {
      if (!c.nfce_enabled) errors.push('Emissão de NFC-e está desabilitada nas configurações.');
      if (!c.inscricao_estadual) errors.push('Inscrição Estadual não cadastrada.');
      if (!c.nfce_csc_id) errors.push('CSC ID da NFC-e não cadastrado.');
      if (!c.nfce_csc_token) errors.push('CSC Token da NFC-e não cadastrado.');
    }

    if (!nfConfig.certificado_base64) {
      errors.push('Certificado digital A1 não cadastrado.');
    } else if (nfConfig.certificado_validade) {
      const validade = new Date(nfConfig.certificado_validade);
      if (validade < new Date()) errors.push(`Certificado digital vencido em ${validade.toLocaleDateString('pt-BR')}.`);
    }

    return { valid: errors.length === 0, errors };
  };

  // ── Navegação ──────────────────────────────────────────────────────────────

  const goNext = () => {
    setEmitError(null);
    if (step === 'tipo') {
      if (!tipoAvulsa) return;
      setStep('itens');
      return;
    }
    if (step === 'itens') {
      const err = validateItensStep();
      if (err) { setEmitError({ title: 'Itens da nota', details: err }); return; }
      setStep(willEmitNfce ? 'pagamento' : 'tomador');
      return;
    }
    if (step === 'pagamento') {
      const err = validatePagamentoStep();
      if (err) { setEmitError({ title: 'Forma de pagamento', details: err }); return; }
      setStep('tomador');
      return;
    }
    if (step === 'tomador') {
      if (!validateTomadorStep()) return;
      setStep('confirmar');
    }
  };

  const goBack = () => {
    setEmitError(null);
    const idx = stepsFlow.indexOf(step);
    if (idx > 0) setStep(stepsFlow[idx - 1]);
  };

  // ── Emissão ────────────────────────────────────────────────────────────────

  const buildPagamentos = (): { tPag: string; vPag: number }[] => {
    const total = productSubtotal;
    if (!pagMulti) return [{ tPag: pagUnico, vPag: total }];
    return pagRows.filter(r => r.tPag && r.valor).map(r => ({ tPag: r.tPag, vPag: +Number(r.valor).toFixed(2) }));
  };

  const emitSlot = async (tipo: 'nfse' | 'nfce', draftId: string) => {
    const pagamentos = tipo === 'nfce' ? buildPagamentos() : undefined;
    const res = await nfService.emitInvoice(draftId, hotelId, pagamentos);
    let invoice = res.invoice;
    if (res.success && !invoice) {
      const { data } = await supabase.from('nf_invoices').select('*').eq('id', draftId).single();
      invoice = (data as NFInvoice) || undefined;
    }
    setEmitState(prev => ({
      ...prev,
      [tipo]: {
        draftId,
        status: res.success ? 'ok' : 'error',
        invoice,
        error: res.success ? undefined : res.message,
      } as EmitSlot,
    }));
    return res.success;
  };

  const handleEmit = async () => {
    if (submitting) return;
    setEmitError(null);

    const cfgCheck = validateConfig();
    if (!cfgCheck.valid) {
      setEmitError({ title: 'Configuração fiscal incompleta', details: cfgCheck.errors.join('\n') });
      return;
    }

    setSubmitting(true);
    try {
      const tomadorBase = {
        tomador_nome: tomadorNome.trim() || 'Consumidor final',
        tomador_cpf_cnpj: tomadorCpfCnpj.trim() || null,
        tomador_doc_tipo: tomadorDocTipo,
        tomador_nacionalidade: tomadorNacionalidade || null,
        tomador_email: tomadorEmail || null,
        tomador_endereco: getFullAddress() || null,
        // Campos separados: sao estes que viram <end><endNac> na DPS da NFS-e
        // Nacional. O texto acima segue para telas e PDF.
        tomador_logradouro: tomadorLogradouro.trim() || null,
        tomador_numero: tomadorNumero.trim() || null,
        tomador_complemento: tomadorComplemento.trim() || null,
        tomador_bairro: tomadorBairro.trim() || null,
        tomador_cidade: tomadorCidade.trim() || null,
        tomador_uf: tomadorUf.trim().toUpperCase() || null,
        tomador_cep: tomadorCep.replace(/\D/g, '') || null,
        tomador_codigo_municipio: tomadorCodMunicipio.trim() || null,
      };
      const common = {
        hotel_id: hotelId,
        erbon_booking_id: null,
        booking_number: null,
        room_description: null,
        emitido_por: user?.id || null,
        ...tomadorBase,
      };

      const next: { nfse?: EmitSlot; nfce?: EmitSlot } = {};

      if (willEmitNfse) {
        const draft = await nfService.createDraftInvoice({
          ...common,
          tipo: 'nfse',
          items: serviceItems.map((it, i) => {
            const svc = svcFiscal?.items.find(s => s.erbon_entry_id === -(i + 1));
            const total = itemTotal(it);
            const unit = parsePrice(it.unitPrice);
            return {
              erbon_entry_id: null,
              descricao: it.qty !== 1 ? `${it.description} (${it.qty}x)` : it.description,
              quantidade: it.qty,
              valor_unitario: unit,
              valor_total: total,
              codigo_servico: svc?.codigo_servico ?? null,
              iss_aliquota: svc?.iss_aliquota ?? null,
              iss_valor: svc?.iss_aliquota != null ? +(total * svc.iss_aliquota / 100).toFixed(2) : null,
            };
          }),
        });
        next.nfse = { draftId: draft.id, status: 'pending' };
      }

      if (willEmitNfce) {
        const draft = await nfService.createDraftInvoice({
          ...common,
          tipo: 'nfce',
          items: productItems.map(it => {
            const total = itemTotal(it);
            const unit = parsePrice(it.unitPrice);
            return {
              erbon_entry_id: null,
              descricao: it.description,
              quantidade: it.qty,
              valor_unitario: unit,
              valor_total: total,
              ncm: it.fiscal?.ncm ?? null,
              cfop: it.fiscal?.cfop ?? '5102',
              icms_aliquota: it.fiscal?.icms_aliquota ?? null,
              icms_valor: it.fiscal?.icms_aliquota != null ? +(total * it.fiscal.icms_aliquota / 100).toFixed(2) : null,
              pis_cst: it.fiscal?.pis_cst ?? null,
              pis_aliquota: it.fiscal?.pis_aliquota ?? null,
              cofins_cst: it.fiscal?.cofins_cst ?? null,
              cofins_aliquota: it.fiscal?.cofins_aliquota ?? null,
              ibs_cbs_cst: it.fiscal?.ibs_cbs_cst ?? null,
              ibs_cbs_cclasstrib: it.fiscal?.ibs_cbs_cclasstrib ?? null,
              ibs_aliquota: it.fiscal?.ibs_aliquota ?? null,
              cbs_aliquota: it.fiscal?.cbs_aliquota ?? null,
            };
          }),
        });
        next.nfce = { draftId: draft.id, status: 'pending' };
      }

      setEmitState(next);
      setStep('emitida');

      // Emissão sequencial (evita concorrência nos números de série)
      let okCount = 0;
      if (next.nfse) { if (await emitSlot('nfse', next.nfse.draftId)) okCount++; }
      if (next.nfce) { if (await emitSlot('nfce', next.nfce.draftId)) okCount++; }

      if (okCount > 0) {
        addNotification('success', okCount === 2 ? 'NFS-e e NFC-e emitidas com sucesso.' : 'Nota fiscal emitida com sucesso.');
        onEmitted();
      }
    } catch (err: any) {
      setEmitError({ title: 'Erro ao emitir', details: err?.message || String(err) });
      if (step === 'emitida') setStep('confirmar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async (tipo: 'nfse' | 'nfce') => {
    const slot = emitState?.[tipo];
    if (!slot || submitting) return;
    setSubmitting(true);
    setEmitState(prev => ({ ...prev, [tipo]: { ...slot, status: 'pending', error: undefined } }));
    try {
      const ok = await emitSlot(tipo, slot.draftId);
      if (ok) { addNotification('success', `${tipo === 'nfse' ? 'NFS-e' : 'NFC-e'} emitida com sucesso.`); onEmitted(); }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const inputCls = (err?: string) =>
    `w-full p-2.5 bg-white dark:bg-gray-900 border rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${err ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'}`;
  const selCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500';

  const filteredServices = services.filter(s => !svcSearch.trim() || s.name.toLowerCase().includes(svcSearch.trim().toLowerCase()));
  const filteredProducts = products.filter(p => !prodSearch.trim() || p.name.toLowerCase().includes(prodSearch.trim().toLowerCase()));

  const eligibleWarnings = willEmitNfce
    ? productItems.filter(it => nfceEligible.some(s => matchesEligibleService(it.description, s))).map(it => it.description)
    : [];

  const renderSelectedItem = (it: AvulsaItem, badge?: React.ReactNode) => (
    <div key={it.key} className="p-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{it.description}</span>
        <button type="button" onClick={() => removeItem(it.key)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => updateItem(it.key, { qty: Math.max(1, it.qty - 1) })}
            className="p-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"><Minus className="w-3 h-3" /></button>
          <span className="w-8 text-center text-sm font-semibold">{it.qty}</span>
          <button type="button" onClick={() => updateItem(it.key, { qty: it.qty + 1 })}
            className="p-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"><Plus className="w-3 h-3" /></button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">R$</span>
          <input
            type="text" inputMode="decimal" value={it.unitPrice}
            readOnly={!it.priceEditable}
            onChange={e => updateItem(it.key, { unitPrice: e.target.value.replace(/[^0-9.,]/g, '') })}
            placeholder="0,00"
            className={`w-24 p-1.5 text-sm border rounded-lg ${it.priceEditable ? 'bg-white dark:bg-gray-900 border-amber-300 dark:border-amber-700' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
          />
        </div>
        <span className="ml-auto text-sm font-bold text-gray-800 dark:text-gray-200">{fmtBRL(itemTotal(it))}</span>
      </div>
      {badge}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">Nova NF avulsa</h3>
              <p className="text-xs text-gray-400">Emissão sem vínculo com reserva</p>
            </div>
          </div>
          <button onClick={onClose} disabled={submitting} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs font-semibold select-none overflow-x-auto">
          <div className="flex items-center gap-4">
            {stepsFlow.map((s, i) => (
              <span key={s} className={`pb-1 border-b-2 whitespace-nowrap transition-all ${stepIndex >= i && step !== 'emitida' ? 'border-amber-500 text-amber-500' : step === 'emitida' ? 'border-transparent text-gray-300 dark:text-gray-600' : 'border-transparent text-gray-400'}`}>
                {i + 1}. {STEP_LABELS[s]}
              </span>
            ))}
            {step === 'emitida' && <span className="pb-1 border-b-2 border-emerald-500 text-emerald-500 whitespace-nowrap">{stepsFlow.length + 1}. Emitida</span>}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* PASSO: TIPO */}
          {step === 'tipo' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">O que você quer emitir?</h4>
                <p className="text-xs text-gray-400">Serviços saem na NFS-e (prefeitura) e produtos na NFC-e (SEFAZ).</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {([
                  ['nfse', 'NFS-e', 'Somente serviços', <Receipt key="i" className="w-6 h-6" />, canNfse],
                  ['nfce', 'NFC-e', 'Somente produtos', <ShoppingBag key="i" className="w-6 h-6" />, canNfce],
                  ['ambas', 'Ambas', 'Serviços + produtos', <Layers key="i" className="w-6 h-6" />, canNfse && canNfce],
                ] as Array<[TipoAvulsa, string, string, React.ReactNode, boolean]>).map(([key, label, desc, icon, allowed]) => (
                  <button
                    key={key}
                    type="button"
                    disabled={!allowed}
                    onClick={() => setTipoAvulsa(key)}
                    className={`p-4 rounded-2xl border-2 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      tipoAvulsa === key
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-amber-300 dark:hover:border-amber-700'
                    }`}
                  >
                    <div className={`mb-2 ${tipoAvulsa === key ? 'text-amber-500' : 'text-gray-400'}`}>{icon}</div>
                    <span className="block font-bold text-gray-900 dark:text-white text-sm">{label}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{desc}</span>
                    {!allowed && <span className="block text-[10px] text-red-400 mt-1">Sem permissão</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PASSO: ITENS */}
          {step === 'itens' && (
            <div className="space-y-5">
              {loadingData ? (
                <div className="flex items-center justify-center py-10 text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando catálogos…
                </div>
              ) : (
                <>
                  {/* Serviços */}
                  {includesNfse && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-sky-500" />
                        <h4 className="text-sm font-bold text-gray-800 dark:text-white">Serviços (NFS-e)</h4>
                        <span className="text-xs text-gray-400">{serviceItems.length} selecionado(s)</span>
                      </div>
                      {serviceItems.map((it, i) => {
                        const svc = svcFiscal?.items.find(s => s.erbon_entry_id === -(i + 1));
                        return renderSelectedItem(it, svc && (
                          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
                            {svc.codigo_servico && <span className="font-mono">LC 116: {svc.codigo_servico}</span>}
                            {svc.iss_aliquota != null && <span>ISS {svc.iss_aliquota}%</span>}
                            {!svc.codigo_servico && <span className="text-amber-500">Usará tributação padrão do hotel</span>}
                          </div>
                        ));
                      })}
                      <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40">
                          <Search className="w-4 h-4 text-gray-400" />
                          <input
                            type="text" value={svcSearch} onChange={e => setSvcSearch(e.target.value)}
                            placeholder="Buscar serviço do catálogo…"
                            className="flex-1 text-sm bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
                          />
                        </div>
                        <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                          {filteredServices.length === 0 ? (
                            <p className="text-center text-xs text-gray-400 py-4">Nenhum serviço encontrado. Cadastre em Serviços do hotel.</p>
                          ) : filteredServices.map(s => (
                            <button
                              key={s.id} type="button" onClick={() => addService(s)}
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                            >
                              <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{s.name}</span>
                              <span className="text-xs text-gray-400 whitespace-nowrap">
                                {s.pricing_mode === 'fixed' && s.price != null ? fmtBRL(Number(s.price)) : 'Valor variável'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Produtos */}
                  {includesNfce && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <ShoppingBag className="w-4 h-4 text-violet-500" />
                        <h4 className="text-sm font-bold text-gray-800 dark:text-white">Produtos (NFC-e)</h4>
                        <span className="text-xs text-gray-400">{productItems.length} selecionado(s)</span>
                      </div>
                      {productItems.map(it => renderSelectedItem(it, it.fiscal && (
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
                          <span className="font-mono">NCM {it.fiscal.ncm}</span>
                          {it.fiscal.icms_aliquota != null && <span>ICMS {it.fiscal.icms_aliquota}%</span>}
                        </div>
                      )))}
                      <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40">
                          <Search className="w-4 h-4 text-gray-400" />
                          <input
                            type="text" value={prodSearch} onChange={e => setProdSearch(e.target.value)}
                            placeholder="Buscar produto da ficha técnica…"
                            className="flex-1 text-sm bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
                          />
                        </div>
                        <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                          {filteredProducts.length === 0 ? (
                            <p className="text-center text-xs text-gray-400 py-4">
                              Nenhum produto com dados fiscais. Cadastre o NCM na aba Impostos da ficha técnica.
                            </p>
                          ) : filteredProducts.map(p => (
                            <button
                              key={p.id} type="button" onClick={() => addProduct(p)}
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                            >
                              <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{p.name}</span>
                              <span className="text-xs text-gray-400 whitespace-nowrap">
                                {p.price != null ? fmtBRL(p.price) : 'Definir valor'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Aviso "ambas" com um lado vazio */}
                  {tipoAvulsa === 'ambas' && items.length > 0 && (serviceItems.length === 0 || productItems.length === 0) && (
                    <div className="p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {serviceItems.length === 0
                        ? 'Sem serviços selecionados: apenas a NFC-e será emitida.'
                        : 'Sem produtos selecionados: apenas a NFS-e será emitida.'}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* PASSO: PAGAMENTO */}
          {step === 'pagamento' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">Forma de pagamento da NFC-e</h4>
                <p className="text-xs text-gray-400">
                  Total dos produtos: <span className="font-bold text-gray-700 dark:text-gray-300">{fmtBRL(productSubtotal)}</span>
                  {willEmitNfse && ' · A NFS-e não exige forma de pagamento.'}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Forma de pagamento *</label>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={pagMulti} onChange={e => setPagMulti(e.target.checked)} className="rounded" />
                  Mais de uma forma
                </label>
              </div>
              {!pagMulti ? (
                <select value={pagUnico} onChange={e => setPagUnico(e.target.value)} className={selCls}>
                  <option value="">Selecione…</option>
                  {TPAG_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <div className="space-y-2">
                  {pagRows.map((row, i) => {
                    const somaRows = pagRows.reduce((s, r) => s + (Number(r.valor) || 0), 0);
                    const restante = +(productSubtotal - somaRows).toFixed(2);
                    return (
                      <React.Fragment key={i}>
                        <div className="flex items-center gap-2">
                          <select value={row.tPag} onChange={e => setPagRows(rs => rs.map((r, j) => j === i ? { ...r, tPag: e.target.value } : r))} className={selCls + ' flex-1'}>
                            <option value="">Selecione…</option>
                            {TPAG_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          <input
                            type="text" inputMode="decimal" value={row.valor} placeholder="Valor"
                            onChange={e => setPagRows(rs => rs.map((r, j) => j === i ? { ...r, valor: e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.') } : r))}
                            className={selCls + ' w-28'}
                          />
                          {pagRows.length > 1 && (
                            <button type="button" onClick={() => setPagRows(rs => rs.filter((_, j) => j !== i))}
                              className="text-red-500 hover:text-red-600 text-xs font-bold px-2">✕</button>
                          )}
                        </div>
                        {i === pagRows.length - 1 && (
                          <div className="flex items-center justify-between">
                            <button type="button" onClick={() => setPagRows(rs => [...rs, { tPag: '', valor: restante > 0 ? String(restante) : '' }])}
                              className="text-xs font-bold text-blue-600 hover:underline">+ Adicionar forma</button>
                            <span className={`text-xs font-semibold ${Math.abs(restante) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {Math.abs(restante) < 0.01 ? 'Soma confere ✓' : `Falta ${fmtBRL(restante)}`}
                            </span>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* PASSO: TOMADOR */}
          {step === 'tomador' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">Dados do cliente (tomador)</h4>
                <p className="text-xs text-gray-400">
                  {willEmitNfse ? 'Nome e documento são obrigatórios para a NFS-e.' : 'Opcional para NFC-e (CPF na nota, se informado).'}
                </p>
              </div>

              {/* Buscar empresa cadastrada */}
              <div className="relative">
                {!showSupplierPicker ? (
                  <button
                    type="button"
                    onClick={() => { setShowSupplierPicker(true); searchSuppliers(''); }}
                    className="flex items-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-xl text-xs font-bold text-indigo-700 dark:text-indigo-400 transition-colors w-full"
                  >
                    <Building2 className="w-4 h-4" />
                    Preencher com empresa cadastrada (fornecedores)
                  </button>
                ) : (
                  <div className="border border-indigo-200 dark:border-indigo-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-indigo-100 dark:border-indigo-800">
                      <Search className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={supplierSearch}
                        onChange={(e) => { setSupplierSearch(e.target.value); searchSuppliers(e.target.value); }}
                        placeholder="Buscar por razão social, nome fantasia ou CNPJ…"
                        className="flex-1 text-sm bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
                        autoFocus
                      />
                      <button type="button" onClick={() => { setShowSupplierPicker(false); setSupplierSearch(''); }} className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                        <X className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {supplierLoading ? (
                        <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-indigo-500" /></div>
                      ) : supplierResults.length === 0 ? (
                        <p className="text-center text-xs text-gray-400 py-4">Nenhuma empresa encontrada.</p>
                      ) : (
                        supplierResults.map((s) => (
                          <button
                            key={s.id} type="button" onClick={() => fillFromSupplier(s)}
                            className="w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors"
                          >
                            <span className="text-sm font-medium text-gray-900 dark:text-white block truncate">{s.nome_fantasia || s.razao_social}</span>
                            <span className="text-[10px] text-gray-500 block">
                              {s.razao_social !== s.nome_fantasia && s.razao_social && <>{s.razao_social} · </>}
                              CNPJ: {s.cnpj}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nome completo {willEmitNfse && '*'}</label>
                  <input
                    type="text" value={tomadorNome}
                    onChange={(e) => { setTomadorNome(e.target.value); if (formErrors.tomadorNome) setFormErrors({ ...formErrors, tomadorNome: '' }); }}
                    className={inputCls(formErrors.tomadorNome)}
                    placeholder="Nome do cliente ou razão social"
                  />
                  {formErrors.tomadorNome && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorNome}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tipo de documento</label>
                  <select
                    value={tomadorDocTipo}
                    onChange={(e) => { setTomadorDocTipo(e.target.value as NFDocTipo); setTomadorCpfCnpj(''); setFormErrors({}); }}
                    className={selCls}
                  >
                    <option value="cpf">CPF (Pessoa Física)</option>
                    <option value="cnpj">CNPJ (Pessoa Jurídica)</option>
                    <option value="passaporte">Passaporte (Estrangeiro)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">
                    {tomadorDocTipo === 'cpf' ? 'CPF' : tomadorDocTipo === 'cnpj' ? 'CNPJ' : 'Nº Passaporte'} {willEmitNfse && '*'}
                  </label>
                  <input
                    type="text" value={tomadorCpfCnpj}
                    onChange={(e) => { setTomadorCpfCnpj(e.target.value); if (formErrors.tomadorCpfCnpj) setFormErrors({ ...formErrors, tomadorCpfCnpj: '' }); }}
                    className={inputCls(formErrors.tomadorCpfCnpj)}
                    placeholder={tomadorDocTipo === 'passaporte' ? 'Ex: AB123456' : 'Apenas números'}
                    maxLength={tomadorDocTipo === 'cpf' ? 14 : tomadorDocTipo === 'cnpj' ? 18 : 20}
                  />
                  {formErrors.tomadorCpfCnpj && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorCpfCnpj}</p>}
                </div>

                {isForeigner && (
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nacionalidade</label>
                    <input
                      type="text" value={tomadorNacionalidade}
                      onChange={(e) => setTomadorNacionalidade(e.target.value)}
                      className={inputCls()}
                      placeholder="Ex: US, AR, FR" maxLength={2}
                    />
                  </div>
                )}

                <div className={isForeigner ? '' : 'md:col-span-2'}>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">E-mail</label>
                  <input
                    type="email" value={tomadorEmail}
                    onChange={(e) => { setTomadorEmail(e.target.value); if (formErrors.tomadorEmail) setFormErrors({ ...formErrors, tomadorEmail: '' }); }}
                    className={inputCls(formErrors.tomadorEmail)}
                    placeholder="exemplo@email.com"
                  />
                  {formErrors.tomadorEmail && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorEmail}</p>}
                </div>
              </div>

              {/* Endereço (opcional) */}
              <div className="pt-4 border-t border-gray-150 dark:border-gray-800">
                <span className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Endereço (opcional)</span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={tomadorCep}
                    onChange={e => {
                      const v = e.target.value;
                      setTomadorCep(v);
                      if (v.replace(/\D/g, '').length === 8) void lookupCep(v);
                    }}
                    onBlur={e => void lookupCep(e.target.value)}
                    className={inputCls()}
                    placeholder="CEP"
                  />
                  <input type="text" value={tomadorLogradouro} onChange={e => setTomadorLogradouro(e.target.value)} className={inputCls() + ' md:col-span-2'} placeholder="Rua / Logradouro" />
                  <input type="text" value={tomadorNumero} onChange={e => setTomadorNumero(e.target.value)} className={inputCls()} placeholder="Número" />
                  <input type="text" value={tomadorComplemento} onChange={e => setTomadorComplemento(e.target.value)} className={inputCls()} placeholder="Complemento" />
                  <input type="text" value={tomadorBairro} onChange={e => setTomadorBairro(e.target.value)} className={inputCls()} placeholder="Bairro" />
                  <input type="text" value={tomadorCidade} onChange={e => setTomadorCidade(e.target.value)} className={inputCls() + ' md:col-span-2'} placeholder="Cidade" />
                  <input type="text" value={tomadorUf} onChange={e => setTomadorUf(e.target.value)} className={inputCls()} placeholder="UF" maxLength={2} />
                  {(cepLoading || cepError || tomadorCodMunicipio) && (
                    <p className={`md:col-span-3 text-xs ${cepError ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'}`}>
                      {cepLoading
                        ? 'Buscando o endereço pelo CEP...'
                        : cepError
                          ? `${cepError} Sem o município identificado a NFS-e Nacional recusa a nota.`
                          : `Município identificado (código IBGE ${tomadorCodMunicipio}).`}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PASSO: CONFIRMAR */}
          {step === 'confirmar' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">Confirme antes de emitir</h4>
                <p className="text-xs text-gray-400">
                  {willEmitNfse && willEmitNfce ? 'Serão emitidas duas notas: NFS-e (serviços) e NFC-e (produtos).' : willEmitNfse ? 'Será emitida uma NFS-e.' : 'Será emitida uma NFC-e.'}
                </p>
              </div>

              {/* Tomador */}
              <div className="bg-gray-50 dark:bg-gray-900/40 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 text-xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-gray-400 block">Cliente (tomador)</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200 block">{tomadorNome.trim() || 'Consumidor final'}</span>
                {tomadorCpfCnpj && (
                  <span className="text-gray-500 block">
                    {tomadorDocTipo === 'cpf' ? 'CPF' : tomadorDocTipo === 'cnpj' ? 'CNPJ' : 'Passaporte'}: {tomadorCpfCnpj}
                  </span>
                )}
                {tomadorEmail && <span className="text-gray-500 block">E-mail: {tomadorEmail}</span>}
                {getFullAddress() && <span className="text-gray-500 block">Endereço: {getFullAddress()}</span>}
              </div>

              <div className={`grid grid-cols-1 ${willEmitNfse && willEmitNfce ? 'md:grid-cols-2' : ''} gap-3`}>
                {willEmitNfse && (
                  <div className="border border-sky-200 dark:border-sky-800 rounded-2xl overflow-hidden">
                    <div className="px-3 py-2 bg-sky-50 dark:bg-sky-900/20 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-sky-700 dark:text-sky-400"><Receipt className="w-3.5 h-3.5" /> NFS-e (Serviços)</span>
                      <span className="text-xs font-bold text-sky-700 dark:text-sky-400">{fmtBRL(serviceSubtotal)}</span>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-40 overflow-y-auto">
                      {serviceItems.map(it => (
                        <div key={it.key} className="px-3 py-2 text-xs flex justify-between gap-2">
                          <span className="text-gray-700 dark:text-gray-300 truncate">{it.qty !== 1 ? `${it.description} (${it.qty}x)` : it.description}</span>
                          <span className="font-mono font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtBRL(itemTotal(it))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {willEmitNfce && (
                  <div className="border border-violet-200 dark:border-violet-800 rounded-2xl overflow-hidden">
                    <div className="px-3 py-2 bg-violet-50 dark:bg-violet-900/20 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-violet-700 dark:text-violet-400"><ShoppingBag className="w-3.5 h-3.5" /> NFC-e (Produtos)</span>
                      <span className="text-xs font-bold text-violet-700 dark:text-violet-400">{fmtBRL(productSubtotal)}</span>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-40 overflow-y-auto">
                      {productItems.map(it => (
                        <div key={it.key} className="px-3 py-2 text-xs flex justify-between gap-2">
                          <span className="text-gray-700 dark:text-gray-300 truncate">{it.qty !== 1 ? `${it.description} (${it.qty}x)` : it.description}</span>
                          <span className="font-mono font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtBRL(itemTotal(it))}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-500">
                      Pagamento: {!pagMulti
                        ? (TPAG_OPTS.find(([v]) => v === pagUnico)?.[1] || '')
                        : pagRows.filter(r => r.tPag).map(r => `${TPAG_OPTS.find(([v]) => v === r.tPag)?.[1]} (${fmtBRL(Number(r.valor) || 0)})`).join(' + ')}
                    </div>
                  </div>
                )}
              </div>

              {eligibleWarnings.length > 0 && (
                <div className="p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    Atenção: {eligibleWarnings.join(', ')} casa(m) com um serviço marcado como elegível a NFC-e e será(ão) tratado(s) como acréscimo na nota, não como item.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* PASSO: EMITIDA */}
          {step === 'emitida' && emitState && (
            <div className="space-y-3">
              {([['nfse', 'NFS-e'], ['nfce', 'NFC-e']] as Array<['nfse' | 'nfce', string]>).map(([key, label]) => {
                const slot = emitState[key];
                if (!slot) return null;
                return (
                  <div key={key} className={`p-4 rounded-2xl border ${
                    slot.status === 'ok' ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10'
                    : slot.status === 'error' ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
                    : 'border-gray-200 dark:border-gray-700'
                  }`}>
                    <div className="flex items-center gap-2">
                      {slot.status === 'pending' && <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}
                      {slot.status === 'ok' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                      {slot.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                      <span className="font-bold text-sm text-gray-900 dark:text-white">{label}</span>
                      {slot.status === 'ok' && slot.invoice?.numero_nf && (
                        <span className="text-xs text-gray-500">nº {slot.invoice.numero_nf}</span>
                      )}
                      <div className="flex-1" />
                      {slot.status === 'ok' && (
                        <button
                          type="button"
                          onClick={() => onView(slot.draftId, key)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" /> Ver {key === 'nfse' ? 'NFS-e' : 'cupom'}
                        </button>
                      )}
                      {slot.status === 'error' && (
                        <button
                          type="button" disabled={submitting}
                          onClick={() => handleRetry(key)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${submitting ? 'animate-spin' : ''}`} /> Tentar novamente
                        </button>
                      )}
                    </div>
                    {slot.status === 'error' && slot.error && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400 whitespace-pre-line">{slot.error}</p>
                    )}
                    {slot.status === 'pending' && (
                      <p className="mt-2 text-xs text-gray-400">Transmitindo…</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Painel de erro inline */}
          {emitError && step !== 'emitida' && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-red-100 dark:bg-red-900/40 border-b border-red-200 dark:border-red-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                <span className="font-bold text-sm text-red-800 dark:text-red-300">{emitError.title}</span>
              </div>
              <div className="p-4">
                <div className="text-xs text-red-700 dark:text-red-400 whitespace-pre-line leading-relaxed">{emitError.details}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
          {step === 'emitida' ? (
            <>
              <div />
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-800 dark:bg-gray-700 hover:bg-gray-900 dark:hover:bg-gray-600 text-white rounded-xl text-sm font-bold transition-colors"
              >
                Fechar
              </button>
            </>
          ) : (
            <>
              <button
                onClick={step === 'tipo' ? onClose : goBack}
                disabled={submitting}
                className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              >
                {step === 'tipo' ? 'Cancelar' : 'Voltar'}
              </button>
              {step !== 'confirmar' ? (
                <button
                  onClick={goNext}
                  disabled={submitting || (step === 'tipo' && !tipoAvulsa) || loadingData}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors"
                >
                  Avançar
                </button>
              ) : (
                <button
                  onClick={handleEmit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Emitir {willEmitNfse && willEmitNfce ? 'notas' : willEmitNfse ? 'NFS-e' : 'NFC-e'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NFAvulsaModal;
