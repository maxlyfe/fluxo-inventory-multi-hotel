// src/components/SupplierQuickCreateModal.tsx
// Modal rápido de criação de fornecedor para uso em outras telas (ex: Nova Compra).
// Reutiliza PFModal e PJModal de Fornecedores.tsx sem duplicar lógica.

import React, { useState } from 'react';
import { Building2, User } from 'lucide-react';
import { PFModal, PJModal } from './financial/Fornecedores';
import type { Supplier } from '../lib/supplierService';

interface Props {
  isOpen: boolean;
  hotelId: string;
  onClose: () => void;
  /** Retorna o fornecedor salvo para que a tela chamadora possa auto-selecionar */
  onSaved: (supplier: Supplier) => void;
}

export default function SupplierQuickCreateModal({ isOpen, hotelId, onClose, onSaved }: Props) {
  const [type, setType] = useState<'pj' | 'pf' | null>(null);

  const handleSaved = (saved?: Supplier) => {
    if (saved) onSaved(saved);
    setType(null);
    onClose();
  };

  const handleClose = () => { setType(null); onClose(); };

  if (!isOpen) return null;

  // Tipo já escolhido → abre o modal correspondente
  if (type === 'pj') return (
    <PJModal hotelId={hotelId} onClose={handleClose} onSaved={handleSaved} />
  );
  if (type === 'pf') return (
    <PFModal hotelId={hotelId} onClose={handleClose} onSaved={handleSaved} />
  );

  // Seletor de tipo
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Novo Fornecedor</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Selecione o tipo de cadastro:</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setType('pj')}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors"
          >
            <Building2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Pessoa Jurídica</span>
            <span className="text-[10px] text-slate-400">Empresa / CNPJ</span>
          </button>
          <button
            onClick={() => setType('pf')}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
          >
            <User className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Pessoa Física</span>
            <span className="text-[10px] text-slate-400">Autônomo / CPF</span>
          </button>
        </div>
        <button onClick={handleClose} className="w-full text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 py-1">
          Cancelar
        </button>
      </div>
    </div>
  );
}
