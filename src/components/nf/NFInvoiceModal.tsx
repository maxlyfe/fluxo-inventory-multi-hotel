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
} from 'lucide-react';
import { nfService } from '../../lib/nfService';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import type { NFTipo, NFInvoice } from '../../types/nf';

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

interface NFInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  tipo: NFTipo;
  hotelId: string;
  booking: any;
  selectedEntries: CurrentAccountEntry[];
  onSuccess: () => void;
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
  onSuccess,
}) => {
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Classify selected items
  const [activeItems, setActiveItems] = useState<CurrentAccountEntry[]>([]);
  const [ignoredItems, setIgnoredItems] = useState<CurrentAccountEntry[]>([]);
  const [checkedItemIds, setCheckedItemIds] = useState<Set<number>>(new Set());

  // Tomador data state
  const [tomadorNome, setTomadorNome] = useState('');
  const [tomadorCpfCnpj, setTomadorCpfCnpj] = useState('');
  const [tomadorEmail, setTomadorEmail] = useState('');
  const [tomadorCep, setTomadorCep] = useState('');
  const [tomadorLogradouro, setTomadorLogradouro] = useState('');
  const [tomadorNumero, setTomadorNumero] = useState('');
  const [tomadorComplemento, setTomadorComplemento] = useState('');
  const [tomadorBairro, setTomadorBairro] = useState('');
  const [tomadorCidade, setTomadorCidade] = useState('');
  const [tomadorUf, setTomadorUf] = useState('');

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // 1. Initialize items and prefill Tomador on mount/open
  useEffect(() => {
    if (!isOpen) return;

    setStep(1);
    setFormErrors({});
    setSubmitting(false);

    // Classify entries
    const services = selectedEntries.filter(isServiceEntry);
    const products = selectedEntries.filter((e) => !isServiceEntry(e));

    const active = tipo === 'nfse' ? services : products;
    const ignored = tipo === 'nfse' ? products : services;

    setActiveItems(active);
    setIgnoredItems(ignored);
    setCheckedItemIds(new Set(active.map((e) => e.id)));

    // Prefill tomador data from booking guest
    const primaryGuest = booking?.guestList?.[0];
    if (primaryGuest) {
      setTomadorNome(primaryGuest.name || '');
      setTomadorEmail(primaryGuest.email || '');

      // Try to find CPF or CNPJ document
      const cpfDoc = primaryGuest.documents?.find(
        (d: any) =>
          d.documentType?.toUpperCase() === 'CPF' ||
          d.documentType?.toUpperCase() === 'CNPJ' ||
          d.documentType?.toUpperCase() === 'DOCUMENT'
      );
      setTomadorCpfCnpj(cpfDoc?.number || '');
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
  }, [isOpen, tipo, booking, selectedEntries]);

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

  // Validate Tomador details (Step 2)
  const validateStep2 = () => {
    const errors: Record<string, string> = {};

    if (!tomadorNome.trim()) {
      errors.tomadorNome = 'Nome é obrigatório';
    }

    const cleanCpfCnpj = tomadorCpfCnpj.replace(/\D/g, '');
    if (!cleanCpfCnpj) {
      errors.tomadorCpfCnpj = 'CPF ou CNPJ é obrigatório';
    } else if (cleanCpfCnpj.length !== 11 && cleanCpfCnpj.length !== 14) {
      errors.tomadorCpfCnpj = 'CPF deve ter 11 dígitos e CNPJ 14 dígitos';
    } else if (cleanCpfCnpj.length === 11 && !validateCpf(cleanCpfCnpj)) {
      errors.tomadorCpfCnpj = 'CPF inválido';
    } else if (cleanCpfCnpj.length === 14 && !validateCnpj(cleanCpfCnpj)) {
      errors.tomadorCpfCnpj = 'CNPJ inválido';
    }

    if (tomadorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tomadorEmail)) {
      errors.tomadorEmail = 'E-mail inválido';
    }

    // If NF-e (produtos), address is mandatory
    if (tipo === 'nfe') {
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
        addNotification({
          type: 'error',
          message: 'Selecione pelo menos um item para emitir a nota fiscal.',
        });
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
    if (step > 1) setStep(step - 1);
  };

  // Build the combined address string
  const getFullAddress = () => {
    if (!tomadorLogradouro.trim()) return '';
    return `${tomadorLogradouro}, ${tomadorNumero}${
      tomadorComplemento ? ` - ${tomadorComplemento}` : ''
    }, ${tomadorBairro}, ${tomadorCidade} - ${tomadorUf}, CEP ${tomadorCep}`;
  };

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
        tomador_email: tomadorEmail || null,
        tomador_endereco: getFullAddress() || null,
        items: finalItems.map((e) => ({
          erbon_entry_id: e.id,
          descricao: e.description,
          quantidade: 1,
          valor_unitario: e.amount,
          valor_total: e.amount,
        })),
        emitido_por: user?.id || null,
      };

      await nfService.createDraftInvoice(input);
      addNotification({
        type: 'success',
        message: 'Rascunho da nota fiscal salvo com sucesso.',
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[NFInvoiceModal] Save draft error:', err);
      addNotification({
        type: 'error',
        message: `Erro ao salvar rascunho: ${err.message || err}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmit = async () => {
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
        tomador_email: tomadorEmail || null,
        tomador_endereco: getFullAddress() || null,
        items: finalItems.map((e) => ({
          erbon_entry_id: e.id,
          descricao: e.description,
          quantidade: 1,
          valor_unitario: e.amount,
          valor_total: e.amount,
        })),
        emitido_por: user?.id || null,
      };

      // 1. Create the draft invoice first
      const draft = await nfService.createDraftInvoice(input);

      // 2. Emit the invoice via the Netlify serverless function
      const emitRes = await nfService.emitInvoice(draft.id, hotelId);

      if (emitRes.success) {
        addNotification({
          type: 'success',
          message: emitRes.message,
        });
        onSuccess();
        onClose();
      } else {
        addNotification({
          type: 'error',
          message: emitRes.message,
        });
      }
    } catch (err: any) {
      console.error('[NFInvoiceModal] Emit error:', err);
      addNotification({
        type: 'error',
        message: `Erro ao emitir nota: ${err.message || err}`,
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
            <div className={`p-2 rounded-lg ${tipo === 'nfse' ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'}`}>
              {tipo === 'nfse' ? <Receipt className="w-5 h-5" /> : <ShoppingBag className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">
                {tipo === 'nfse' ? 'Emissão de NFS-e (Serviços)' : 'Emissão de NF-e (Consumo/Produtos)'}
              </h3>
              <p className="text-xs text-gray-400">UH {booking?.roomDescription || room?.roomName || '—'} · Reserva {booking?.erbonNumber || '—'}</p>
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
          </div>
          <span className="text-[10px] text-gray-400 uppercase">Passo {step} de 3</span>
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
                    {activeItems.map((item) => (
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
                            <span className="text-[10px] text-gray-400">Depto: {item.idDepartment}</span>
                          </div>
                        </div>
                        <span className="font-mono font-bold text-gray-700 dark:text-gray-300">
                          {item.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 dark:bg-gray-900/20 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-center text-xs text-gray-400">
                    Nenhum item compatível para este tipo de nota fiscal.
                  </div>
                )}
              </div>

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

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">CPF ou CNPJ *</label>
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
                    placeholder="Apenas números"
                  />
                  {formErrors.tomadorCpfCnpj && <p className="text-[10px] text-red-500 mt-1">{formErrors.tomadorCpfCnpj}</p>}
                </div>

                <div>
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
                  <span className="text-xs font-bold uppercase tracking-wider">Endereço {tipo === 'nfe' ? '*' : '(Opcional)'}</span>
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
                      {tipo === 'nfse' ? 'NFS-e (Serviços / Búzios)' : 'NF-e (Produtos / SEFAZ-RJ)'}
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
                    <span className="text-gray-500 block">CNPJ/CPF: {tomadorCpfCnpj}</span>
                    {tomadorEmail && <span className="text-gray-500 block">Email: {tomadorEmail}</span>}
                    {getFullAddress() && <span className="text-gray-500 block">Endereço: {getFullAddress()}</span>}
                  </div>
                </div>
              </div>

              {/* Items summary list */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Lançamentos Vinculados ({finalItems.length})</p>
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-850">
                  {finalItems.map((item) => (
                    <div key={item.id} className="flex justify-between p-2.5 text-xs bg-white dark:bg-gray-800/40">
                      <span className="text-gray-700 dark:text-gray-300 font-medium">{item.description}</span>
                      <span className="font-mono font-bold text-gray-700 dark:text-gray-300">
                        {item.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex justify-between gap-3">
          {step > 1 ? (
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
              <>
                <button
                  onClick={handleSaveDraft}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Salvar Rascunho
                </button>
                <button
                  onClick={handleEmit}
                  disabled={submitting}
                  className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-lg text-xs font-bold shadow-sm transition-all disabled:opacity-50 ${
                    tipo === 'nfse'
                      ? 'bg-sky-600 hover:bg-sky-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Processando…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Emitir Nota Fiscal
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
