// src/components/nf/NFInvoiceModal.tsx
import React, { useState, useEffect } from 'react';
import {
  X,
  Receipt,
  ShoppingBag,
  User,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Info,
  CheckCircle,
  AlertCircle,
  Printer,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabase';
import { nfService, type FiscalLineItem, type FiscalResolutionResult, type ServiceFiscalResult, type WCIGuestData } from '../../lib/nfService';
import { printNFA4 } from './NFPrintA4';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import type { NFTipo, NFDocTipo, NFHotelConfig } from '../../types/nf';

export interface CurrentAccountEntry {
  id: number;
  description: string;
  amount: number;
  isDebit: boolean;
  isCredit: boolean;
  currency: string;
  isInvoiced: boolean;
  idDepartment: number;
}

/** Item genérico (fora da Erbon): lançamentos de reservas internas/Omnibees */
export interface GenericNFItem {
  /** ID local apenas para a UI (use negativos para não colidir com IDs Erbon) */
  id: number;
  description: string;
  amount: number;
  /** Serviço do catálogo — resolve a tributação diretamente, sem heurística */
  service_id?: string | null;
}

interface NFInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  tipo: NFTipo;
  hotelId: string;
  booking: any;
  selectedEntries: CurrentAccountEntry[];
  /** Se informado, substitui selectedEntries (fluxo de reservas internas) */
  genericItems?: GenericNFItem[];
  /** invoiceId da nota criada é passado quando disponível */
  onSuccess: (invoiceId?: string) => void;
  viewInvoiceId?: string | null;
}

// Helper to classify entries as service or product
export function isServiceEntry(entry: { description: string }) {
  const desc = (entry.description || '').toLowerCase();
  return (
    desc.includes('diária') ||
    desc.includes('diaria') ||
    desc.includes('hospedagem') ||
    desc.includes('taxa') ||
    desc.includes('no show') ||
    desc.includes('room charge') ||
    desc.includes('turismo') ||
    desc.includes('iss') ||
    desc.includes('serviço') ||
    desc.includes('servico')
  );
}

// Brazilian CPF/CNPJ validation helpers
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
  if (rev !== parseInt(clean.charAt(10))) return false;
  return true;
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
  if (result !== parseInt(digits.charAt(1))) return false;
  return true;
}

export const NFInvoiceModal: React.FC<NFInvoiceModalProps> = ({
  isOpen,
  onClose,
  tipo,
  hotelId,
  booking,
  selectedEntries,
  genericItems,
  onSuccess,
  viewInvoiceId = null,
}) => {
  const isGeneric = !!genericItems?.length;
  const { user } = useAuth();
  const { addNotification } = useNotification();
  const [nfConfig, setNfConfig] = useState<NFHotelConfig | null>(null);

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Fiscal resolution for NF-e (products)
  const [fiscalData, setFiscalData] = useState<FiscalResolutionResult | null>(null);
  const [loadingFiscal, setLoadingFiscal] = useState(false);

  // Fiscal resolution for NFS-e (serviços do catálogo mapeados via Erbon)
  const [serviceFiscal, setServiceFiscal] = useState<ServiceFiscalResult | null>(null);

  // Classify selected items
  const [activeItems, setActiveItems] = useState<CurrentAccountEntry[]>([]);
  const [ignoredItems, setIgnoredItems] = useState<CurrentAccountEntry[]>([]);
  const [checkedItemIds, setCheckedItemIds] = useState<Set<number>>(new Set());

  // Emitted invoice (for print after emission)
  const [emittedInvoice, setEmittedInvoice] = useState<any>(null);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);

  // Inline error state (shown within the modal, not just toast)
  const [emitError, setEmitError] = useState<{ title: string; details: string; canRetry: boolean } | null>(null);

  // Tomador data state
  const [tomadorDocTipo, setTomadorDocTipo] = useState<NFDocTipo>('cpf');
  const [tomadorNome, setTomadorNome] = useState('');
  const [tomadorCpfCnpj, setTomadorCpfCnpj] = useState('');
  const [tomadorNacionalidade, setTomadorNacionalidade] = useState('');
  const [tomadorEmail, setTomadorEmail] = useState('');
  const [wciLoaded, setWciLoaded] = useState(false);
  const [tomadorCep, setTomadorCep] = useState('');
  const [tomadorLogradouro, setTomadorLogradouro] = useState('');
  const [tomadorNumero, setTomadorNumero] = useState('');
  const [tomadorComplemento, setTomadorComplemento] = useState('');
  const [tomadorBairro, setTomadorBairro] = useState('');
  const [tomadorCidade, setTomadorCidade] = useState('');
  const [tomadorUf, setTomadorUf] = useState('');

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Derived from prop — available in render and effects
  const isProduct = tipo === 'nfe' || tipo === 'nfce';

  // Reset step and items when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setEmittedInvoice(null);
      setInvoiceItems([]);
    }
  }, [isOpen]);

  // 1. Initialize items and prefill Tomador on mount/open
  useEffect(() => {
    if (!isOpen) return;

    setFormErrors({});
    setSubmitting(false);
    setFiscalData(null);
    setServiceFiscal(null);

    // Load NF config for print receipt header
    nfService.getConfig(hotelId).then(c => setNfConfig(c)).catch(() => {});

    if (viewInvoiceId) {
      setLoadingFiscal(true);
      const fetchInvoiceData = async () => {
        try {
          // 1. Buscar a nota fiscal
          const { data: inv, error: invErr } = await supabase
            .from('nf_invoices')
            .select('*')
            .eq('id', viewInvoiceId)
            .single();
          if (invErr) throw invErr;

          // 2. Buscar os itens da nota fiscal
          const { data: items, error: itemsErr } = await supabase
            .from('nf_invoice_items')
            .select('*')
            .eq('invoice_id', viewInvoiceId);
          if (itemsErr) throw itemsErr;

          setEmittedInvoice(inv);
          setInvoiceItems(items || []);
          setStep(4);
        } catch (err) {
          console.error('[NFInvoiceModal] Error loading invoice for view:', err);
          addNotification('Erro ao carregar dados da nota fiscal emitida.', 'error');
          onClose();
        } finally {
          setLoadingFiscal(false);
        }
      };
      fetchInvoiceData();
      return;
    }

    // Classify entries. Itens genéricos (reservas internas) não passam pela
    // heurística Erbon: entram todos como ativos, do tipo pedido.
    const genericEntries: CurrentAccountEntry[] = (genericItems ?? []).map(g => ({
      id: g.id,
      description: g.description,
      amount: g.amount,
      isDebit: true,
      isCredit: false,
      currency: 'BRL',
      isInvoiced: false,
      idDepartment: 0,
    }));

    const services = isGeneric ? genericEntries : selectedEntries.filter(isServiceEntry);
    const products = isGeneric ? genericEntries : selectedEntries.filter((e) => !isServiceEntry(e));

    const active = isProduct ? products : services;
    const ignored = isGeneric ? [] : (isProduct ? services : products);

    setActiveItems(active);
    setIgnoredItems(ignored);
    setCheckedItemIds(new Set(active.map((e) => e.id)));

    // For NF-e/NFC-e (products), resolve fiscal data (NCM, tax %)
    if (isProduct && products.length > 0) {
      setLoadingFiscal(true);
      nfService.resolveEntryFiscalData(
        hotelId,
        products.map(e => ({ id: e.id, description: e.description, amount: e.amount, idDepartment: e.idDepartment }))
      ).then(result => {
        setFiscalData(result);
      }).catch(err => {
        console.error('[NFInvoiceModal] Fiscal resolution error:', err);
        setFiscalData({ items: [], warnings: ['Erro ao resolver dados fiscais dos produtos'], hasErrors: true });
      }).finally(() => {
        setLoadingFiscal(false);
      });
    }

    // For NFS-e, resolve tributação por serviço do catálogo (mapeamento Erbon
    // ou service_id direto nos itens genéricos)
    if (tipo === 'nfse' && services.length > 0) {
      const genericServiceIds = new Map((genericItems ?? []).map(g => [g.id, g.service_id ?? null]));
      nfService.resolveServiceFiscalData(
        hotelId,
        services.map(e => ({ id: e.id, description: e.description, amount: e.amount, service_id: genericServiceIds.get(e.id) ?? null }))
      ).then(result => {
        setServiceFiscal(result);
      }).catch(err => {
        console.error('[NFInvoiceModal] Service fiscal resolution error:', err);
        setServiceFiscal(null);
      });
    }

    // Reset tomador
    setTomadorDocTipo('cpf');
    setTomadorNacionalidade('');
    setEmittedInvoice(null);
    setWciLoaded(false);

    // Prefill tomador data from booking guest
    const primaryGuest = booking?.guestList?.[0];
    if (primaryGuest) {
      setTomadorNome(primaryGuest.name || '');
      setTomadorEmail(primaryGuest.email || '');

      // Detect document type
      const passportDoc = primaryGuest.documents?.find(
        (d: any) => d.documentType?.toUpperCase() === 'PASSAPORTE' || d.documentType?.toUpperCase() === 'PASSPORT'
      );
      const cpfDoc = primaryGuest.documents?.find(
        (d: any) =>
          d.documentType?.toUpperCase() === 'CPF' ||
          d.documentType?.toUpperCase() === 'CNPJ' ||
          d.documentType?.toUpperCase() === 'DOCUMENT'
      );

      if (passportDoc?.number) {
        setTomadorDocTipo('passaporte');
        setTomadorCpfCnpj(passportDoc.number);
      } else if (cpfDoc?.number) {
        const clean = cpfDoc.number.replace(/\D/g, '');
        setTomadorDocTipo(clean.length === 14 ? 'cnpj' : 'cpf');
        setTomadorCpfCnpj(cpfDoc.number);
      } else {
        setTomadorCpfCnpj('');
      }

      // Try WCI lookup for complete data (address, nationality)
      const bookingNum = booking?.erbonNumber ? String(booking.erbonNumber) : null;
      if (bookingNum && primaryGuest.name) {
        nfService.lookupWCIGuest(hotelId, bookingNum, primaryGuest.name).then(wci => {
          if (!wci) return;
          setWciLoaded(true);
          if (wci.nationality) setTomadorNacionalidade(wci.nationality);
          if (wci.document_type?.toUpperCase() === 'PASSAPORTE') {
            setTomadorDocTipo('passaporte');
            if (wci.document_number) setTomadorCpfCnpj(wci.document_number);
          } else if (wci.document_type?.toUpperCase() === 'CPF' && wci.document_number) {
            setTomadorDocTipo('cpf');
            setTomadorCpfCnpj(wci.document_number);
          }
          if (wci.email) setTomadorEmail(prev => prev || wci.email!);
          // Fill address from WCI ficha
          if (wci.address_street) setTomadorLogradouro(wci.address_street);
          if (wci.address_neighborhood) setTomadorBairro(wci.address_neighborhood);
          if (wci.address_city) setTomadorCidade(wci.address_city);
          if (wci.address_state) setTomadorUf(wci.address_state);
          if (wci.address_zipcode) setTomadorCep(wci.address_zipcode);
        }).catch(() => {});
      }
    } else {
      setTomadorNome('');
      setTomadorEmail('');
      setTomadorCpfCnpj('');
    }

    // Reset address
    setTomadorCep('');
    setTomadorLogradouro('');
    setTomadorNumero('');
    setTomadorComplemento('');
    setTomadorBairro('');
    setTomadorCidade('');
    setTomadorUf('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tipo, booking, selectedEntries, hotelId, viewInvoiceId]);

  if (!isOpen) return null;

  // Toggle item in active items list
  const handleToggleItem = (id: number) => {
    const next = new Set(checkedItemIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setCheckedItemIds(next);
  };

  // Get total of selected active items
  const finalItems = activeItems.filter((e) => checkedItemIds.has(e.id));
  const subtotal = finalItems.reduce((sum, e) => sum + e.amount, 0);

  const isForeigner = tomadorDocTipo === 'passaporte';

  // Validate Tomador details (Step 2)
  const validateStep2 = () => {
    const errors: Record<string, string> = {};

    // NFC-e: tomador is optional (consumer invoice)
    if (tipo === 'nfce') {
      const cleanCpfCnpj = tomadorCpfCnpj.replace(/\D/g, '');
      if (cleanCpfCnpj) {
        if (tomadorDocTipo === 'cpf' && cleanCpfCnpj.length !== 11) {
          errors.tomadorCpfCnpj = 'CPF deve ter 11 dígitos';
        } else if (tomadorDocTipo === 'cpf' && !validateCpf(cleanCpfCnpj)) {
          errors.tomadorCpfCnpj = 'CPF inválido';
        }
      }
    } else {
      if (!tomadorNome.trim()) {
        errors.tomadorNome = 'Nome é obrigatório';
      }

      if (tomadorDocTipo === 'passaporte') {
        if (!tomadorCpfCnpj.trim()) {
          errors.tomadorCpfCnpj = 'Número do passaporte é obrigatório';
        }
      } else {
        const cleanCpfCnpj = tomadorCpfCnpj.replace(/\D/g, '');
        if (!cleanCpfCnpj) {
          errors.tomadorCpfCnpj = 'CPF ou CNPJ é obrigatório';
        } else if (tomadorDocTipo === 'cpf' && cleanCpfCnpj.length !== 11) {
          errors.tomadorCpfCnpj = 'CPF deve ter 11 dígitos';
        } else if (tomadorDocTipo === 'cnpj' && cleanCpfCnpj.length !== 14) {
          errors.tomadorCpfCnpj = 'CNPJ deve ter 14 dígitos';
        } else if (tomadorDocTipo === 'cpf' && !validateCpf(cleanCpfCnpj)) {
          errors.tomadorCpfCnpj = 'CPF inválido';
        } else if (tomadorDocTipo === 'cnpj' && !validateCnpj(cleanCpfCnpj)) {
          errors.tomadorCpfCnpj = 'CNPJ inválido';
        }
      }
    }

    if (tomadorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tomadorEmail)) {
      errors.tomadorEmail = 'E-mail inválido';
    }

    // Address mandatory for NF-e with Brazilian nationals (foreigners and NFC-e optional)
    if (tipo === 'nfe' && !isForeigner) {
      if (!tomadorLogradouro.trim()) errors.tomadorLogradouro = 'Rua é obrigatória';
      if (!tomadorNumero.trim()) errors.tomadorNumero = 'Número é obrigatório';
      if (!tomadorBairro.trim()) errors.tomadorBairro = 'Bairro é obrigatório';
      if (!tomadorCidade.trim()) errors.tomadorCidade = 'Cidade é obrigatória';
      if (!tomadorUf.trim()) errors.tomadorUf = 'UF é obrigatória';
      if (!tomadorCep.trim()) errors.tomadorCep = 'CEP é obrigatório';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNext = () => {
    if (step === 1) {
      if (checkedItemIds.size === 0) {
        addNotification('Selecione pelo menos um item para emitir a nota fiscal.', 'error');
        return;
      }
      if ((tipo === 'nfe' || tipo === 'nfce') && loadingFiscal) {
        addNotification('Aguarde a resolução dos dados fiscais.', 'error');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (validateStep2()) {
        setStep(3);
      }
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setEmitError(null);
      setStep(step - 1);
    }
  };

  // Build the combined address string
  const getFullAddress = () => {
    if (!tomadorLogradouro.trim()) return '';
    return `${tomadorLogradouro}, ${tomadorNumero}${
      tomadorComplemento ? ` - ${tomadorComplemento}` : ''
    }, ${tomadorBairro}, ${tomadorCidade} - ${tomadorUf}, CEP ${tomadorCep}`;
  };

  // Monta os itens da nota com os dados fiscais resolvidos:
  // produtos → NCM/CFOP/ICMS; serviços (NFS-e) → código de serviço/ISS por item
  const buildInvoiceItems = () =>
    finalItems.map((e) => {
      const fiscal = fiscalData?.items.find(f => f.erbon_entry_id === e.id);
      const svc = serviceFiscal?.items.find(s => s.erbon_entry_id === e.id);
      return {
        // Itens genéricos usam IDs locais que NÃO podem ser gravados como
        // erbon_entry_id (colidiriam com lançamentos reais da Erbon)
        erbon_entry_id: isGeneric ? null : e.id,
        descricao: e.description,
        quantidade: 1,
        valor_unitario: e.amount,
        valor_total: e.amount,
        ...(isProduct && fiscal ? {
          ncm: fiscal.ncm || null,
          cfop: '5102',
          icms_aliquota: fiscal.tax_percentage ?? null,
          icms_valor: fiscal.tax_percentage != null ? e.amount * (fiscal.tax_percentage / 100) : null,
        } : {}),
        ...(tipo === 'nfse' && svc ? {
          codigo_servico: svc.codigo_servico ?? null,
          iss_aliquota: svc.iss_aliquota ?? null,
          iss_valor: svc.iss_aliquota != null ? Math.round(e.amount * svc.iss_aliquota) / 100 : null,
        } : {}),
      };
    });

  // Action handlers
  const handleSaveDraft = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const input = {
        hotel_id: hotelId,
        tipo,
        erbon_booking_id: booking?.bookingInternalID || null,
        booking_number: booking?.erbonNumber ? String(booking.erbonNumber) : null,
        room_description: booking?.roomDescription || null,
        tomador_nome: tomadorNome,
        tomador_cpf_cnpj: tomadorCpfCnpj,
        tomador_doc_tipo: tomadorDocTipo,
        tomador_nacionalidade: tomadorNacionalidade || null,
        tomador_email: tomadorEmail || null,
        tomador_endereco: getFullAddress() || null,
        items: buildInvoiceItems(),
        emitido_por: user?.id || null,
      };

      const draft = await nfService.createDraftInvoice(input);
      addNotification('Rascunho da nota fiscal salvo com sucesso.', 'success');
      onSuccess(draft.id);
      onClose();
    } catch (err: any) {
      console.error('[NFInvoiceModal] Save draft error:', err);
      addNotification(`Erro ao salvar rascunho: ${err.message || err}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const validateConfig = (): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    if (!nfConfig) {
      errors.push('Configuração fiscal não encontrada. Acesse Configurações > NF-e / NFS-e para cadastrar os dados da empresa.');
      return { valid: false, errors };
    }
    if (!nfConfig.is_active) {
      errors.push('A configuração fiscal está desativada para este hotel.');
    }
    if (!nfConfig.cnpj) errors.push('CNPJ da empresa não cadastrado.');
    if (!nfConfig.razao_social) errors.push('Razão social não cadastrada.');
    if (!nfConfig.nome_fantasia) errors.push('Nome fantasia não cadastrado.');

    if (tipo === 'nfse') {
      if (!nfConfig.nfse_enabled) errors.push('Emissão de NFS-e está desabilitada nas configurações.');
      if (!nfConfig.inscricao_municipal) errors.push('Inscrição Municipal não cadastrada (obrigatória para NFS-e).');
      // Código de serviço: aceito quando todos os itens têm serviço do catálogo
      // com LC 116 resolvido; senão o código global da config é obrigatório
      const allItemsResolved = finalItems.length > 0 && finalItems.every(e =>
        serviceFiscal?.items.find(s => s.erbon_entry_id === e.id)?.codigo_servico
      );
      if (!nfConfig.codigo_servico && !allItemsResolved) {
        errors.push('Código de serviço não cadastrado (configure na aba NFS-e ou mapeie os itens a serviços do catálogo).');
      }
    } else if (tipo === 'nfce') {
      if (!nfConfig.nfce_enabled) errors.push('Emissão de NFC-e está desabilitada nas configurações.');
      if (!nfConfig.inscricao_estadual) errors.push('Inscrição Estadual não cadastrada (compartilhada com NF-e).');
      if (!nfConfig.nfce_csc_id) errors.push('CSC ID da NFC-e não cadastrado.');
      if (!nfConfig.nfce_csc_token) errors.push('CSC Token da NFC-e não cadastrado.');
    } else {
      if (!nfConfig.nfe_enabled) errors.push('Emissão de NF-e está desabilitada nas configurações.');
      if (!nfConfig.inscricao_estadual) errors.push('Inscrição Estadual não cadastrada (obrigatória para NF-e).');
    }

    if (!nfConfig.certificado_base64) {
      errors.push('Certificado digital A1 não cadastrado.');
    } else if (nfConfig.certificado_validade) {
      const validade = new Date(nfConfig.certificado_validade);
      if (validade < new Date()) {
        errors.push(`Certificado digital vencido em ${validade.toLocaleDateString('pt-BR')}.`);
      }
    }

    return { valid: errors.length === 0, errors };
  };

  const handleContingencia = async () => {
    if (submitting) return;
    setEmitError(null);
    setSubmitting(true);
    try {
      const input = {
        hotel_id: hotelId,
        tipo,
        erbon_booking_id: booking?.bookingInternalID || null,
        booking_number: booking?.erbonNumber ? String(booking.erbonNumber) : null,
        room_description: booking?.roomDescription || null,
        tomador_nome: tomadorNome,
        tomador_cpf_cnpj: tomadorCpfCnpj,
        tomador_doc_tipo: tomadorDocTipo,
        tomador_nacionalidade: tomadorNacionalidade || null,
        tomador_email: tomadorEmail || null,
        tomador_endereco: getFullAddress() || null,
        items: buildInvoiceItems(),
        emitido_por: user?.id || null,
      };

      const draft = await nfService.createDraftInvoice(input);
      const result = await nfService.emitContingencia(draft.id, hotelId, 'Sistema fiscal indisponível');

      if (result.success) {
        setEmittedInvoice(result.invoice);
        addNotification(result.message, 'success');
        onSuccess(draft.id);
        setStep(4);
      } else {
        setEmitError({
          title: 'Falha na emissão em contingência',
          details: result.message,
          canRetry: true,
        });
      }
    } catch (err: any) {
      setEmitError({
        title: 'Erro na contingência',
        details: err.message || String(err),
        canRetry: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrint = () => {
    const content = document.getElementById('nf-receipt-print');
    if (!content) return;

    const printWindow = window.open('', '_blank', 'width=320,height=600');
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cupom Fiscal</title><style>
@page { margin: 0; size: 80mm auto; }
* { margin: 0; padding: 0; box-sizing: border-box; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: 400; width: 72mm; margin: 0; padding: 2mm 7mm 2mm 2mm; color: #000; line-height: 1.3; }
.text-center { text-align: center; }
.font-bold { font-weight: 700; }
.text-sm { font-size: 14px; }
.text-\\[10px\\] { font-size: 11px; }
.text-\\[9px\\] { font-size: 10px; }
.text-\\[8px\\] { font-size: 9px; }
.border-t { border-top: 1px dashed #000; }
.border-dashed { border-style: dashed; }
.my-2 { margin: 5px 0; }
.mt-1 { margin-top: 3px; }
.mb-1 { margin-bottom: 3px; }
svg { display: block; margin: 4px auto 0; width: 32mm !important; height: 32mm !important; }
.flex { display: flex; }
.justify-between { justify-content: space-between; }
.items-start { align-items: flex-start; }
.gap-2 { gap: 6px; }
.flex-1 { flex: 1 1 auto; min-width: 0; }
.break-words { overflow-wrap: anywhere; word-break: break-word; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mr-2 { margin-right: 4px; }
.whitespace-nowrap { white-space: nowrap; }
.break-all { word-break: break-all; }
</style></head><body>${content.innerHTML}<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}<\/script></body></html>`);
    printWindow.document.close();
  };

  // Impressão A4 (NFS-e e DANFE); NFC-e continua no cupom 80mm (handlePrint)
  const handlePrintA4 = async () => {
    if (!emittedInvoice) return;
    let items = invoiceItems;
    if (!items?.length && emittedInvoice.id) {
      const { data } = await supabase
        .from('nf_invoice_items')
        .select('*')
        .eq('invoice_id', emittedInvoice.id);
      items = data || [];
      setInvoiceItems(items);
    }
    printNFA4(emittedInvoice, items || [], nfConfig);
  };

  const handleEmit = async () => {
    if (submitting) return;
    setEmitError(null);

    const configCheck = validateConfig();
    if (!configCheck.valid) {
      setEmitError({
        title: 'Configuração fiscal incompleta',
        details: configCheck.errors.join('\n'),
        canRetry: false,
      });
      return;
    }

    if (isProduct && fiscalData?.hasErrors && nfConfig?.ambiente !== 'homologacao') {
      setEmitError({
        title: 'Dados fiscais com pendências',
        details: `Corrija os dados fiscais (NCM/tributação) antes de emitir a ${tipo === 'nfce' ? 'NFC-e' : 'NF-e'}. Verifique os itens marcados com alerta no Passo 1.`,
        canRetry: false,
      });
      return;
    }

    setSubmitting(true);
    try {
      const input = {
        hotel_id: hotelId,
        tipo,
        erbon_booking_id: booking?.bookingInternalID || null,
        booking_number: booking?.erbonNumber ? String(booking.erbonNumber) : null,
        room_description: booking?.roomDescription || null,
        tomador_nome: tomadorNome,
        tomador_cpf_cnpj: tomadorCpfCnpj,
        tomador_doc_tipo: tomadorDocTipo,
        tomador_nacionalidade: tomadorNacionalidade || null,
        tomador_email: tomadorEmail || null,
        tomador_endereco: getFullAddress() || null,
        items: buildInvoiceItems(),
        emitido_por: user?.id || null,
      };

      const draft = await nfService.createDraftInvoice(input);
      const emitRes = await nfService.emitInvoice(draft.id, hotelId);

      if (emitRes.success) {
        // Garante os dados do cupom no passo 4 mesmo se o retorno não trouxer a
        // nota (busca fresca pelo id do rascunho emitido).
        let emitted = emitRes.invoice;
        if (!emitted) {
          const { data } = await supabase
            .from('nf_invoices')
            .select('*')
            .eq('id', draft.id)
            .single();
          emitted = data || undefined;
        }
        setEmittedInvoice(emitted || null);
        addNotification(emitRes.message, 'success');
        onSuccess(draft.id);
        setStep(4);
      } else {
        setEmitError({
          title: 'Nota fiscal rejeitada',
          details: emitRes.message,
          canRetry: true,
        });
      }
    } catch (err: any) {
      console.error('[NFInvoiceModal] Emit error:', err);
      const msg = err?.message || String(err);
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('Failed');
      setEmitError({
        title: isNetwork ? 'Erro de comunicação' : 'Erro ao emitir nota',
        details: isNetwork
          ? `Não foi possível conectar ao serviço fiscal. Verifique sua conexão ou tente emitir em contingência.\n\nDetalhes: ${msg}`
          : msg,
        canRetry: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300">
      <div className="relative w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${tipo === 'nfse' ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400' : tipo === 'nfce' ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'}`}>
              {tipo === 'nfse' ? <Receipt className="w-5 h-5" /> : <ShoppingBag className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">
                {tipo === 'nfse' ? 'Emissão de NFS-e (Serviços)' : tipo === 'nfce' ? 'Emissão de NFC-e (Consumidor)' : 'Emissão de NF-e (Consumo/Produtos)'}
              </h3>
              <p className="text-xs text-gray-400">UH {booking?.roomDescription || '—'} · Reserva {booking?.erbonNumber || '—'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Steps indicator */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-850 flex items-center justify-between text-xs font-semibold select-none">
          <div className="flex items-center gap-4">
            <span className={`pb-1 border-b-2 transition-all ${step >= 1 ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400'}`}>1. Itens</span>
            <span className={`pb-1 border-b-2 transition-all ${step >= 2 ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400'}`}>2. Tomador</span>
            <span className={`pb-1 border-b-2 transition-all ${step >= 3 ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400'}`}>3. Confirmar</span>
            {step >= 4 && <span className="pb-1 border-b-2 border-emerald-500 text-emerald-500">4. Emitida</span>}
          </div>
          <span className="text-[10px] text-gray-400 uppercase">{step <= 3 ? `Passo ${step} de 3` : 'Concluído'}</span>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* STEP 1: ITENS */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">Selecione os lançamentos da nota</h4>
                <p className="text-xs text-gray-400">Classificação baseada nos tipos de departamento da reserva.</p>
              </div>

              {/* Active list */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Itens Inclusos</p>
                {activeItems.length > 0 ? (
                  <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
                    {activeItems.map((item) => {
                      const fiscalItem = fiscalData?.items.find(f => f.erbon_entry_id === item.id);
                      const svcItem = tipo === 'nfse' ? serviceFiscal?.items.find(s => s.erbon_entry_id === item.id) : undefined;
                      return (
                        <label
                          key={item.id}
                          className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-900/30 cursor-pointer text-sm transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={checkedItemIds.has(item.id)}
                              onChange={() => handleToggleItem(item.id)}
                              className="rounded border-gray-300 text-amber-500 focus:ring-amber-500 w-4 h-4"
                            />
                            <div>
                              <span className="text-gray-850 dark:text-gray-200 font-medium block">{item.description}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-gray-400">Depto: {item.idDepartment}</span>
                                {isProduct && fiscalItem && (
                                  <>
                                    {fiscalItem.ncm ? (
                                      <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-mono">
                                        NCM {fiscalItem.ncm}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                        <AlertCircle className="w-2.5 h-2.5" /> NCM ausente
                                      </span>
                                    )}
                                    {fiscalItem.tax_percentage != null && (
                                      <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">
                                        Imp. {fiscalItem.tax_percentage.toFixed(2)}%
                                      </span>
                                    )}
                                    {fiscalItem.source && (
                                      <span className="text-[10px] text-gray-400">via {fiscalItem.source}</span>
                                    )}
                                  </>
                                )}
                                {isProduct && loadingFiscal && (
                                  <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                                )}
                                {svcItem && (
                                  svcItem.source === 'service' ? (
                                    <span className="text-[10px] bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 px-1.5 py-0.5 rounded">
                                      {svcItem.service_name} · LC116 {svcItem.codigo_servico || '—'} · ISS {svcItem.iss_aliquota ?? '—'}%
                                    </span>
                                  ) : (
                                    <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
                                      Tributação padrão do hotel {svcItem.codigo_servico ? `(${svcItem.codigo_servico} · ${svcItem.iss_aliquota ?? '—'}%)` : '(incompleta)'}
                                    </span>
                                  )
                                )}
                              </div>
                              {isProduct && fiscalItem?.warnings && fiscalItem.warnings.length > 0 && (
                                <div className="mt-1">
                                  {fiscalItem.warnings.map((w, i) => (
                                    <p key={i} className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                      <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" /> {w}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <span className="font-mono font-bold text-gray-700 dark:text-gray-300">
                            {item.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 dark:bg-gray-900/20 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-center text-xs text-gray-400">
                    Nenhum item compatível para este tipo de nota fiscal.
                  </div>
                )}
              </div>

              {/* Fiscal resolution warnings (NF-e only) */}
              {isProduct && loadingFiscal && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-700 dark:text-blue-400">
                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                  Resolvendo dados fiscais (NCM, impostos) dos produtos…
                </div>
              )}
              {isProduct && fiscalData && fiscalData.warnings.length > 0 && (
                <div className={`p-3 rounded-xl border text-xs space-y-1 ${fiscalData.hasErrors ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
                  <div className="flex items-center gap-1.5 font-bold">
                    {fiscalData.hasErrors ? (
                      <><AlertCircle className="w-4 h-4 text-red-500" /><span className="text-red-700 dark:text-red-400">Erros na resolução fiscal</span></>
                    ) : (
                      <><AlertTriangle className="w-4 h-4 text-amber-500" /><span className="text-amber-700 dark:text-amber-400">Avisos fiscais</span></>
                    )}
                  </div>
                  {fiscalData.warnings.map((w, i) => (
                    <p key={i} className={fiscalData.hasErrors ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}>• {w}</p>
                  ))}
                  {fiscalData.hasErrors && (
                    <p className="font-bold text-red-700 dark:text-red-400 pt-1">A emissão será bloqueada até que os dados fiscais sejam corrigidos.</p>
                  )}
                </div>
              )}

              {/* Ignored list */}
              {ignoredItems.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <Info className="w-3.5 h-3.5" />
                    <p className="text-[10px] uppercase font-bold tracking-wider">Itens Não Inclusos (Outro Tipo)</p>
                  </div>
                  <div className="border border-gray-150 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-850 opacity-60 bg-gray-50/50 dark:bg-gray-900/10">
                    {ignoredItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-3 text-xs">
                        <div className="flex items-center gap-3">
                          <input type="checkbox" disabled checked={false} className="rounded border-gray-300 text-gray-300 w-3.5 h-3.5 cursor-not-allowed" />
                          <div>
                            <span className="text-gray-500 dark:text-gray-400 font-medium block">{item.description}</span>
                            <span className="text-[10px] text-gray-400">Depto: {item.idDepartment}</span>
                          </div>
                        </div>
                        <span className="font-mono text-gray-500 dark:text-gray-400">
                          {item.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Estes itens pertencem ao outro tipo de nota fiscal. Emita-os separadamente.
                  </p>
                </div>
              )}

              {/* Step 1 Subtotal Summary */}
              {checkedItemIds.size > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-350 font-medium">
                    {checkedItemIds.size} item{checkedItemIds.size > 1 ? 's' : ''} selecionado{checkedItemIds.size > 1 ? 's' : ''}
                  </span>
                  <span className="font-bold text-amber-600 dark:text-amber-400 text-base">
                    Subtotal: {subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: TOMADOR */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">Dados do Tomador (Destinatário)</h4>
                <p className="text-xs text-gray-400">Preencha as informações do hóspede responsável pelo pagamento.</p>
              </div>

              {/* WCI auto-fill indicator */}
              {wciLoaded && (
                <div className="flex items-center gap-2 p-2.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  Dados preenchidos automaticamente a partir da ficha de check-in (WCI).
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nome Completo *</label>
                  <input
                    type="text"
                    value={tomadorNome}
                    onChange={(e) => {
                      setTomadorNome(e.target.value);
                      if (formErrors.tomadorNome) setFormErrors({ ...formErrors, tomadorNome: '' });
                    }}
                    className={`w-full p-2.5 bg-white dark:bg-gray-900 border rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${
                      formErrors.tomadorNome ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
                    }`}
                    placeholder="Nome completo do destinatário"
                  />
                  {formErrors.tomadorNome && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorNome}</p>}
                </div>

                {/* Document type selector */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tipo de Documento *</label>
                  <select
                    value={tomadorDocTipo}
                    onChange={(e) => {
                      setTomadorDocTipo(e.target.value as NFDocTipo);
                      setTomadorCpfCnpj('');
                      setFormErrors({});
                    }}
                    className="w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors"
                  >
                    <option value="cpf">CPF (Pessoa Física)</option>
                    <option value="cnpj">CNPJ (Pessoa Jurídica)</option>
                    <option value="passaporte">Passaporte (Estrangeiro)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">
                    {tomadorDocTipo === 'cpf' ? 'CPF *' : tomadorDocTipo === 'cnpj' ? 'CNPJ *' : 'Nº Passaporte *'}
                  </label>
                  <input
                    type="text"
                    value={tomadorCpfCnpj}
                    onChange={(e) => {
                      setTomadorCpfCnpj(e.target.value);
                      if (formErrors.tomadorCpfCnpj) setFormErrors({ ...formErrors, tomadorCpfCnpj: '' });
                    }}
                    className={`w-full p-2.5 bg-white dark:bg-gray-900 border rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${
                      formErrors.tomadorCpfCnpj ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
                    }`}
                    placeholder={tomadorDocTipo === 'passaporte' ? 'Ex: AB123456' : 'Apenas números'}
                    maxLength={tomadorDocTipo === 'cpf' ? 14 : tomadorDocTipo === 'cnpj' ? 18 : 20}
                  />
                  {formErrors.tomadorCpfCnpj && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorCpfCnpj}</p>}
                </div>

                {/* Nationality (shown for passport, optional for others) */}
                {isForeigner && (
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nacionalidade</label>
                    <input
                      type="text"
                      value={tomadorNacionalidade}
                      onChange={(e) => setTomadorNacionalidade(e.target.value)}
                      className="w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors"
                      placeholder="Ex: US, AR, FR"
                      maxLength={2}
                    />
                  </div>
                )}

                <div className={isForeigner ? '' : 'md:col-span-2'}>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">E-mail</label>
                  <input
                    type="email"
                    value={tomadorEmail}
                    onChange={(e) => {
                      setTomadorEmail(e.target.value);
                      if (formErrors.tomadorEmail) setFormErrors({ ...formErrors, tomadorEmail: '' });
                    }}
                    className={`w-full p-2.5 bg-white dark:bg-gray-900 border rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${
                      formErrors.tomadorEmail ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
                    }`}
                    placeholder="exemplo@email.com"
                  />
                  {formErrors.tomadorEmail && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorEmail}</p>}
                </div>
              </div>

              {/* Endereço (Obrigatório para NF-e, opcional para NFS-e) */}
              <div className="pt-4 border-t border-gray-150 dark:border-gray-800">
                <div className="flex items-center gap-1.5 mb-3 text-gray-500">
                  <MapPin className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">Endereço {tipo === 'nfe' && !isForeigner ? '*' : tipo === 'nfce' ? '(Opcional — CPF na nota)' : '(Opcional)'}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text--[10px] font-bold text-gray-400 uppercase mb-1">CEP {tipo === 'nfe' && '*'}</label>
                    <input
                      type="text"
                      value={tomadorCep}
                      onChange={(e) => {
                        setTomadorCep(e.target.value);
                        if (formErrors.tomadorCep) setFormErrors({ ...formErrors, tomadorCep: '' });
                      }}
                      className={`w-full p-2 bg-white dark:bg-gray-900 border rounded-lg text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${
                        formErrors.tomadorCep ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
                      }`}
                      placeholder="00000-000"
                    />
                    {formErrors.tomadorCep && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorCep}</p>}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text--[10px] font-bold text-gray-400 uppercase mb-1">Rua / Logradouro {tipo === 'nfe' && '*'}</label>
                    <input
                      type="text"
                      value={tomadorLogradouro}
                      onChange={(e) => {
                        setTomadorLogradouro(e.target.value);
                        if (formErrors.tomadorLogradouro) setFormErrors({ ...formErrors, tomadorLogradouro: '' });
                      }}
                      className={`w-full p-2 bg-white dark:bg-gray-900 border rounded-lg text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${
                        formErrors.tomadorLogradouro ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
                      }`}
                      placeholder="Ex: Av. José Bento Ribeiro Dantas"
                    />
                    {formErrors.tomadorLogradouro && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorLogradouro}</p>}
                  </div>

                  <div>
                    <label className="block text--[10px] font-bold text-gray-400 uppercase mb-1">Número {tipo === 'nfe' && '*'}</label>
                    <input
                      type="text"
                      value={tomadorNumero}
                      onChange={(e) => {
                        setTomadorNumero(e.target.value);
                        if (formErrors.tomadorNumero) setFormErrors({ ...formErrors, tomadorNumero: '' });
                      }}
                      className={`w-full p-2 bg-white dark:bg-gray-900 border rounded-lg text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${
                        formErrors.tomadorNumero ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
                      }`}
                      placeholder="Ex: 123 ou S/N"
                    />
                    {formErrors.tomadorNumero && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorNumero}</p>}
                  </div>

                  <div>
                    <label className="block text--[10px] font-bold text-gray-400 uppercase mb-1">Complemento</label>
                    <input
                      type="text"
                      value={tomadorComplemento}
                      onChange={(e) => setTomadorComplemento(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors"
                      placeholder="Ex: Apto 101"
                    />
                  </div>

                  <div>
                    <label className="block text--[10px] font-bold text-gray-400 uppercase mb-1">Bairro {tipo === 'nfe' && '*'}</label>
                    <input
                      type="text"
                      value={tomadorBairro}
                      onChange={(e) => {
                        setTomadorBairro(e.target.value);
                        if (formErrors.tomadorBairro) setFormErrors({ ...formErrors, tomadorBairro: '' });
                      }}
                      className={`w-full p-2 bg-white dark:bg-gray-900 border rounded-lg text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${
                        formErrors.tomadorBairro ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
                      }`}
                      placeholder="Ex: Geribá"
                    />
                    {formErrors.tomadorBairro && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorBairro}</p>}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text--[10px] font-bold text-gray-400 uppercase mb-1">Cidade {tipo === 'nfe' && '*'}</label>
                    <input
                      type="text"
                      value={tomadorCidade}
                      onChange={(e) => {
                        setTomadorCidade(e.target.value);
                        if (formErrors.tomadorCidade) setFormErrors({ ...formErrors, tomadorCidade: '' });
                      }}
                      className={`w-full p-2 bg-white dark:bg-gray-900 border rounded-lg text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${
                        formErrors.tomadorCidade ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
                      }`}
                      placeholder="Armação dos Búzios"
                    />
                    {formErrors.tomadorCidade && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorCidade}</p>}
                  </div>

                  <div>
                    <label className="block text--[10px] font-bold text-gray-400 uppercase mb-1">UF {tipo === 'nfe' && '*'}</label>
                    <input
                      type="text"
                      value={tomadorUf}
                      onChange={(e) => {
                        setTomadorUf(e.target.value);
                        if (formErrors.tomadorUf) setFormErrors({ ...formErrors, tomadorUf: '' });
                      }}
                      className={`w-full p-2 bg-white dark:bg-gray-900 border rounded-lg text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors ${
                        formErrors.tomadorUf ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
                      }`}
                      placeholder="RJ"
                      maxLength={2}
                    />
                    {formErrors.tomadorUf && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorUf}</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: CONFIRM & EMIT */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">Confirme as informações antes de emitir</h4>
                <p className="text-xs text-gray-400">Após a emissão, os lançamentos serão marcados como faturados.</p>
              </div>

              {/* Review card */}
              <div className="bg-gray-50 dark:bg-gray-900/40 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Tipo de Nota</span>
                    <span className="font-semibold text-gray-800 dark:text-gray-200">
                      {tipo === 'nfse' ? 'NFS-e (Serviços / Búzios)' : tipo === 'nfce' ? 'NFC-e (Consumidor / SEFAZ-RJ)' : 'NF-e (Produtos / SEFAZ-RJ)'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Valor Total</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400 text-sm">
                      {subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Destinatário (Tomador)</span>
                    <span className="font-semibold text-gray-850 dark:text-gray-200 block">{tomadorNome}</span>
                    <span className="text-gray-500 block">
                      {tomadorDocTipo === 'cpf' ? 'CPF' : tomadorDocTipo === 'cnpj' ? 'CNPJ' : 'Passaporte'}: {tomadorCpfCnpj}
                    </span>
                    {isForeigner && tomadorNacionalidade && (
                      <span className="text-gray-500 block">Nacionalidade: {tomadorNacionalidade.toUpperCase()}</span>
                    )}
                    {tomadorEmail && <span className="text-gray-500 block">Email: {tomadorEmail}</span>}
                    {getFullAddress() && <span className="text-gray-500 block">Endereço: {getFullAddress()}</span>}
                  </div>
                </div>
              </div>

              {/* Items summary list */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Lançamentos Vinculados ({finalItems.length})</p>
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-850">
                  {finalItems.map((item) => {
                    const fiscalItem = fiscalData?.items.find(f => f.erbon_entry_id === item.id);
                    return (
                      <div key={item.id} className="p-2.5 text-xs bg-white dark:bg-gray-800/40">
                        <div className="flex justify-between">
                          <span className="text-gray-700 dark:text-gray-300 font-medium">{item.description}</span>
                          <span className="font-mono font-bold text-gray-700 dark:text-gray-300">
                            {item.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        </div>
                        {isProduct && fiscalItem && (
                          <div className="flex items-center gap-2 mt-1">
                            {fiscalItem.ncm && (
                              <span className="text-[10px] font-mono text-gray-500">NCM: {fiscalItem.ncm}</span>
                            )}
                            {fiscalItem.tax_percentage != null && (
                              <span className="text-[10px] text-gray-500">Imposto: {fiscalItem.tax_percentage.toFixed(2)}%</span>
                            )}
                            {fiscalItem.source && (
                              <span className="text-[10px] text-gray-400">({fiscalItem.source})</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Fiscal errors block emission */}
              {isProduct && fiscalData?.hasErrors && !emitError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="font-bold">
                    {nfConfig?.ambiente === 'homologacao' 
                      ? 'Aviso: Há pendências fiscais (NCM/impostos), mas a emissão é permitida em modo de Homologação.'
                      : 'Emissão bloqueada: corrija os dados fiscais (NCM/impostos) dos produtos antes de emitir.'}
                  </span>
                </div>
              )}

              {/* Inline error panel */}
              {emitError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 bg-red-100 dark:bg-red-900/40 border-b border-red-200 dark:border-red-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <span className="font-bold text-sm text-red-800 dark:text-red-300">{emitError.title}</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="text-xs text-red-700 dark:text-red-400 whitespace-pre-line leading-relaxed">
                      {emitError.details}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => setEmitError(null)}
                        className="px-3 py-1.5 text-xs font-bold text-red-700 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-all"
                      >
                        Fechar
                      </button>
                      {emitError.canRetry && (
                        <>
                          <button
                            onClick={() => { setEmitError(null); handleEmit(); }}
                            className="px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-all"
                          >
                            Tentar Novamente
                          </button>
                          <button
                            onClick={() => { setEmitError(null); handleContingencia(); }}
                            className="px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-all"
                          >
                            Emitir em Contingência
                          </button>
                        </>
                      )}
                      {!emitError.canRetry && (
                        <button
                          onClick={() => { const base = window.location.pathname.match(/^\/grupo\/[^/]+/)?.[0] || ''; window.open(`${base}/admin/nfe`, '_blank'); }}
                          className="px-3 py-1.5 text-xs font-bold text-sky-700 dark:text-sky-400 border border-sky-300 dark:border-sky-700 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-all"
                        >
                          Abrir Configurações
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: EMITIDA - PRINT RECEIPT */}
          {step === 4 && emittedInvoice && (() => {
            const displayItems = viewInvoiceId
              ? invoiceItems.map(it => ({ description: it.descricao, amount: Number(it.valor_total) }))
              : finalItems;

            return (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                  <CheckCircle className="w-8 h-8 text-emerald-500 flex-shrink-0" />
                  <div>
                    <h4 className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                      {emittedInvoice.status === 'contingencia' ? 'Nota emitida em contingência' : 'Nota fiscal autorizada'}
                    </h4>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      {emittedInvoice.numero_nf ? `Nº ${emittedInvoice.numero_nf}` : ''}
                      {emittedInvoice.numero_rps ? ` · RPS: ${emittedInvoice.numero_rps}` : ''}
                      {emittedInvoice.status === 'contingencia' && ' · Retransmissão automática pendente'}
                    </p>
                  </div>
                </div>

                {/* Inline receipt preview */}
                <div className="bg-white border border-gray-200 dark:border-gray-700 rounded-xl p-4 font-mono text-[11px] text-gray-900 dark:text-gray-100 leading-relaxed mx-auto" style={{ maxWidth: '300px' }} id="nf-receipt-print">
                  {nfConfig?.logo_url && (
                    <div className="text-center mb-2">
                      <img src={nfConfig.logo_url} alt="" className="mx-auto" style={{ maxHeight: '40px', maxWidth: '120px', objectFit: 'contain' }} />
                    </div>
                  )}
                  <div className="text-center font-bold text-sm">{nfConfig?.nome_fantasia || 'Hotel'}</div>
                  {nfConfig?.razao_social && <div className="text-center text-[9px] text-gray-500">{nfConfig.razao_social}</div>}
                  {nfConfig?.cnpj && <div className="text-center text-[9px] text-gray-500">CNPJ: {nfConfig.cnpj}</div>}
                  {nfConfig?.endereco_logradouro && (
                    <div className="text-center text-[9px] text-gray-500">
                      {[nfConfig.endereco_logradouro, nfConfig.endereco_numero, nfConfig.endereco_bairro, nfConfig.endereco_cidade, nfConfig.endereco_uf].filter(Boolean).join(', ')}
                    </div>
                  )}
                  {nfConfig?.telefone && <div className="text-center text-[9px] text-gray-500">Tel: {nfConfig.telefone}</div>}

                  <div className="border-t border-dashed border-gray-300 my-2" />

                  <div className="text-center font-bold">
                    {emittedInvoice.tipo === 'nfse' ? 'NFS-e' : emittedInvoice.tipo === 'nfce' ? 'NFC-e' : 'NF-e'} - {emittedInvoice.status === 'contingencia' ? 'CONTINGÊNCIA' : 'AUTORIZADA'}
                  </div>
                  {emittedInvoice.numero_nf && <div className="text-center text-[10px]">Nº {emittedInvoice.numero_nf} · Série {emittedInvoice.serie || '1'}</div>}
                  {emittedInvoice.numero_rps && <div className="text-center text-[10px]">RPS: {emittedInvoice.numero_rps}</div>}
                  <div className="text-center text-[9px] text-gray-500">
                    {new Date().toLocaleDateString('pt-BR')} {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="text-center text-[9px] text-gray-500">
                    Reserva: {emittedInvoice.booking_number || '—'} · UH: {emittedInvoice.room_description || '—'}
                  </div>

                  <div className="border-t border-dashed border-gray-300 my-2" />

                  <div className="font-bold text-[10px]">DESTINATÁRIO</div>
                  <div>{emittedInvoice.tomador_nome}</div>
                  <div>{emittedInvoice.tomador_doc_tipo === 'passaporte' ? 'Passaporte' : emittedInvoice.tomador_doc_tipo === 'cnpj' ? 'CNPJ' : 'CPF'}: {emittedInvoice.tomador_cpf_cnpj}</div>
                  {emittedInvoice.tomador_email && <div className="text-[9px]">{emittedInvoice.tomador_email}</div>}

                  <div className="border-t border-dashed border-gray-300 my-2" />

                  <div className="font-bold text-[10px] mb-1">ITENS</div>
                  {displayItems.map((item, i) => (
                    <div key={i} className="flex justify-between items-start gap-2 text-[10px]">
                      <span className="flex-1 break-words">{item.description}</span>
                      <span className="font-bold whitespace-nowrap">{item.amount.toFixed(2)}</span>
                    </div>
                  ))}

                <div className="border-t border-dashed border-gray-300 my-2" />

                <div className="flex justify-between font-bold text-sm">
                  <span>TOTAL</span>
                  <span>R$ {Number(emittedInvoice.valor_total).toFixed(2)}</span>
                </div>

                {emittedInvoice.chave_acesso && (
                  <>
                    <div className="border-t border-dashed border-gray-300 my-2" />
                    <div className="font-bold text-[9px]">CHAVE DE ACESSO</div>
                    <div className="text-[8px] break-all">{emittedInvoice.chave_acesso}</div>
                  </>
                )}
                {emittedInvoice.numero_protocolo && (
                  <div className="mt-1">
                    <span className="font-bold text-[9px]">PROTOCOLO: </span>
                    <span className="text-[9px]">{emittedInvoice.numero_protocolo}</span>
                  </div>
                )}

                {emittedInvoice.qrcode_url && (
                  <>
                    <div className="border-t border-dashed border-gray-300 my-2" />
                    <div className="font-bold text-[9px] text-center">CONSULTE PELA CHAVE DE ACESSO EM</div>
                    <div className="text-[8px] text-center text-blue-600 break-all">{emittedInvoice.url_consulta || emittedInvoice.qrcode_url}</div>
                    <div className="text-center mt-1">
                      <div className="inline-block bg-white p-1">
                        <QRCodeSVG value={emittedInvoice.qrcode_url} size={110} level="M" />
                      </div>
                    </div>
                  </>
                )}

                <div className="border-t border-dashed border-gray-300 my-2" />
                <div className="text-center text-[8px] text-gray-400">LyFe Hoteles - Sistema de Gestão</div>
              </div>
            </div>
          );
        })()}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex justify-between gap-3">
          {step === 4 && (
            <React.Fragment>
              <div />
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition-all"
                >
                  Fechar
                </button>
                {tipo !== 'nfce' && (
                  <button
                    onClick={handlePrintA4}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-xs font-bold shadow-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-all"
                  >
                    <Printer className="w-4 h-4" />
                    Imprimir A4
                  </button>
                )}
                <button
                  onClick={handlePrint}
                  className={
                    tipo === 'nfce'
                      ? 'flex items-center gap-2 px-5 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-xs font-bold shadow-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-all'
                      : 'flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition-all'
                  }
                >
                  <Printer className="w-4 h-4" />
                  {tipo === 'nfce' ? 'Imprimir' : 'Cupom'}
                </button>
              </div>
            </React.Fragment>
          )}
          {step !== 4 && (
            <React.Fragment>
              {step > 1 && step <= 3 ? (
                <button
                  onClick={handleBack}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-gray-750 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Voltar
                </button>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                {step < 3 ? (
                  <button
                    onClick={handleNext}
                    className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold shadow-sm transition-all"
                  >
                    Continuar
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <React.Fragment>
                    <button
                      onClick={handleSaveDraft}
                      disabled={submitting}
                      className="flex items-center gap-2 px-3 py-2.5 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                    >
                      {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Rascunho
                    </button>
                    <button
                      onClick={handleContingencia}
                      disabled={submitting}
                      className="flex items-center gap-2 px-3 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold shadow-sm transition-all disabled:opacity-50"
                      title="Emitir em contingência (RPS/EPEC) quando o sistema fiscal estiver indisponível"
                    >
                      {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                      Contingência
                    </button>
                    <button
                      onClick={handleEmit}
                      disabled={submitting || (isProduct && fiscalData?.hasErrors && nfConfig?.ambiente !== 'homologacao')}
                      className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-lg text-xs font-bold shadow-sm transition-all disabled:opacity-50 ${
                        tipo === 'nfse'
                          ? 'bg-sky-600 hover:bg-sky-700'
                          : tipo === 'nfce'
                          ? 'bg-violet-600 hover:bg-violet-700'
                          : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      {submitting ? (
                        <React.Fragment>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Processando…
                        </React.Fragment>
                      ) : (
                        <React.Fragment>
                          <CheckCircle2 className="w-4 h-4" />
                          Emitir NF
                        </React.Fragment>
                      )}
                    </button>
                  </React.Fragment>
                )}
              </div>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
};
