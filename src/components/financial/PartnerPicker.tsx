// src/components/financial/PartnerPicker.tsx
// Identificação do parceiro (tomador da NF) dentro de outra tela.
//
// Dois modos:
//   1. Buscar por CNPJ — UMA ação faz tudo: procura no cadastro do hotel (não
//      gasta crédito da API), se não achar consulta a Receita, cadastra o
//      fornecedor e devolve vinculado.
//   2. Escolher um fornecedor já cadastrado, por razão social, fantasia ou CNPJ.
//
// Reusa supplierService.findOrCreateByCnpj (a mesma sequência que o
// NFeXMLImportModal usa) e o SupplierQuickCreateModal como saída manual quando a
// Receita está fora do ar.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Search, Loader2, Building2, Check, Sparkles, AlertTriangle, X, Mail, Phone,
  ExternalLink, Plus, CircleDot, Circle,
} from 'lucide-react';
import {
  supplierService, formatCnpj, type Supplier,
} from '../../lib/supplierService';
import SupplierQuickCreateModal from '../SupplierQuickCreateModal';

export interface LinkedPartner {
  supplier_id: string;
  cnpj: string;
  /** Nome de exibição já resolvido (fantasia, senão razão social). */
  name: string;
  razao_social: string | null;
  email: string | null;
  telefone: string | null;
  situacao: string | null;
  /** Como o vínculo aconteceu, para o chip de status. */
  source: 'local' | 'cnpja' | 'manual';
}

export function supplierToPartner(s: Supplier, source: LinkedPartner['source']): LinkedPartner {
  return {
    supplier_id: s.id!,
    cnpj: (s.cnpj ?? '').replace(/\D/g, ''),
    name: s.nome_fantasia || s.razao_social || s.nome || 'Sem nome',
    razao_social: s.razao_social ?? null,
    email: s.email ?? null,
    telefone: s.telefone ?? null,
    situacao: s.situacao ?? null,
    source,
  };
}

type Step = 'idle' | 'local' | 'api' | 'saving';

const STEP_LABELS: Record<Exclude<Step, 'idle'>, string> = {
  local:  'Procurando no cadastro do hotel',
  api:    'Consultando a Receita',
  saving: 'Cadastrando fornecedor',
};

export default function PartnerPicker({
  hotelId, value, onChange, required, disabled,
}: {
  hotelId: string;
  value: LinkedPartner | null;
  onChange: (partner: LinkedPartner | null) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<'cnpj' | 'existing'>('cnpj');
  const [cnpj, setCnpj] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');

  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Supplier[]>([]);
  const [searching, setSearching] = useState(false);
  const [quickCreate, setQuickCreate] = useState(false);

  const cleanCnpj = cnpj.replace(/\D/g, '');
  const cnpjReady = cleanCnpj.length === 14;
  const busy = step !== 'idle';

  // ── Modo 1: uma ação, do CNPJ ao vínculo ────────────────────────────────────
  const linkByCnpj = async () => {
    if (!cnpjReady || busy) return;
    setError('');
    setStep('local');
    try {
      // O passo local é explícito porque o operador precisa ver que a consulta
      // paga só acontece quando o cadastro do hotel não tem o CNPJ.
      const local = await supplierService.findByCnpj(hotelId, cleanCnpj);
      if (local) {
        onChange(supplierToPartner(local, 'local'));
        setStep('idle');
        return;
      }

      setStep('api');
      const { supplier, source } = await supplierService.findOrCreateByCnpj(hotelId, cleanCnpj);
      setStep('saving');
      onChange(supplierToPartner(supplier, source === 'cnpja' ? 'cnpja' : 'local'));
    } catch (err: any) {
      setError(err?.message ?? 'Não conseguimos consultar o CNPJ agora.');
    } finally {
      setStep('idle');
    }
  };

  // ── Modo 2: autocomplete de fornecedor já cadastrado ────────────────────────
  const debounce = useRef<ReturnType<typeof setTimeout>>();
  const searchSuppliers = useCallback((q: string) => {
    clearTimeout(debounce.current);
    if (q.trim().length < 2) { setOptions([]); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const all = await supplierService.list(hotelId);
        const needle = q.trim().toLowerCase();
        const digits = q.replace(/\D/g, '');
        setOptions(
          all
            .filter(s => s.type === 'juridica' && s.status === 'ativo')
            .filter(s =>
              (s.razao_social ?? '').toLowerCase().includes(needle) ||
              (s.nome_fantasia ?? '').toLowerCase().includes(needle) ||
              (digits.length >= 3 && (s.cnpj ?? '').replace(/\D/g, '').includes(digits)))
            .slice(0, 8),
        );
      } catch (err: any) {
        setError(err?.message ?? 'Não conseguimos carregar os fornecedores.');
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [hotelId]);

  useEffect(() => () => clearTimeout(debounce.current), []);

  // ── Parceiro já vinculado ───────────────────────────────────────────────────
  if (value) {
    const chip = value.source === 'cnpja'
      ? { icon: <Sparkles className="w-3 h-3" />, label: 'Cadastrado agora', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' }
      : { icon: <Check className="w-3 h-3" />, label: 'Já cadastrado', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' };

    return (
      <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border dark:border-gray-700 p-3">
        <div className="flex items-start gap-3">
          <Building2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{value.name}</p>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${chip.cls}`}>
                {chip.icon}{chip.label}
              </span>
              {!value.email && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  <AlertTriangle className="w-3 h-3" /> Sem e-mail no cadastro
                </span>
              )}
            </div>
            {value.razao_social && value.razao_social !== value.name && (
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{value.razao_social}</p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {formatCnpj(value.cnpj)}
              {value.situacao ? ` · ${value.situacao}` : ''}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
              {value.email && <span className="inline-flex items-center gap-1 truncate"><Mail className="w-3 h-3" />{value.email}</span>}
              {value.telefone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{value.telefone}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <a href="/finances/fornecedores" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline">
              Abrir ficha <ExternalLink className="w-3 h-3" />
            </a>
            {!disabled && (
              <button type="button" onClick={() => { onChange(null); setCnpj(''); setError(''); }}
                className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-red-600">
                <X className="w-3 h-3" /> Trocar parceiro
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Sem parceiro: escolher o caminho ────────────────────────────────────────
  return (
    <div className={`bg-gray-50 dark:bg-gray-900 rounded-xl border p-3 ${
      required ? 'border-amber-300 dark:border-amber-700' : 'dark:border-gray-700'
    }`}>
      <div className="flex flex-wrap gap-4 mb-3">
        {([['cnpj', 'Buscar por CNPJ'], ['existing', 'Escolher fornecedor cadastrado']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setMode(k); setError(''); }}
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              mode === k ? 'text-purple-600 dark:text-purple-400' : 'text-gray-500 dark:text-gray-400'
            }`}>
            {mode === k ? <CircleDot className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
            {label}
          </button>
        ))}
      </div>

      {mode === 'cnpj' ? (
        <>
          <div className="flex gap-2">
            <input
              className="input-field flex-1" inputMode="numeric" disabled={disabled || busy}
              value={cnpj} onChange={e => setCnpj(formatCnpj(e.target.value))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); linkByCnpj(); } }}
              placeholder="00.000.000/0000-00"
            />
            <button type="button" onClick={linkByCnpj} disabled={!cnpjReady || busy || disabled}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 shrink-0">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar e vincular
            </button>
          </div>

          {busy ? (
            <ul className="mt-2 space-y-1">
              {(['local', 'api', 'saving'] as const).map(s => {
                const order = { local: 0, api: 1, saving: 2 };
                const done = order[s] < order[step as Exclude<Step, 'idle'>];
                const active = s === step;
                return (
                  <li key={s} className={`flex items-center gap-2 text-xs ${
                    done ? 'text-green-600' : active ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'
                  }`}>
                    {done ? <Check className="w-3.5 h-3.5" />
                      : active ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Circle className="w-3.5 h-3.5" />}
                    {STEP_LABELS[s]}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
              Uma ação só: procura no cadastro deste hotel e, se não achar, consulta a Receita
              e cadastra o fornecedor automaticamente.
            </p>
          )}

          {cnpj && !cnpjReady && !busy && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              CNPJ incompleto: faltam {14 - cleanCnpj.length} dígito(s).
            </p>
          )}
        </>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input-field !pl-9" disabled={disabled}
              value={term}
              onChange={e => { setTerm(e.target.value); searchSuppliers(e.target.value); }}
              placeholder="Razão social, nome fantasia ou CNPJ"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
          </div>

          {term.trim().length >= 2 && !searching && (
            <div className="mt-2 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg overflow-hidden">
              {options.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                  Nenhum fornecedor com esse nome neste hotel.
                </p>
              ) : options.map(s => (
                <button key={s.id} type="button"
                  onClick={() => { onChange(supplierToPartner(s, 'local')); setTerm(''); setOptions([]); }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 border-b last:border-b-0 dark:border-gray-700">
                  <p className="text-sm text-gray-800 dark:text-gray-200 truncate">
                    {s.nome_fantasia || s.razao_social}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {formatCnpj(s.cnpj ?? '')}
                    {s.email ? ` · ${s.email}` : ' · sem e-mail'}
                  </p>
                </button>
              ))}
              <button type="button" onClick={() => setQuickCreate(true)}
                className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 inline-flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Cadastrar novo fornecedor
              </button>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </p>
          <div className="flex gap-3 mt-1.5">
            <button type="button" onClick={linkByCnpj} className="text-[11px] text-red-700 dark:text-red-300 underline">
              Tentar de novo
            </button>
            <button type="button" onClick={() => setQuickCreate(true)} className="text-[11px] text-red-700 dark:text-red-300 underline">
              Cadastrar manualmente
            </button>
          </div>
        </div>
      )}

      {required && !error && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          Obrigatório no faturamento: é este CNPJ que casa a NF emitida com a cobrança.
        </p>
      )}

      <SupplierQuickCreateModal
        isOpen={quickCreate}
        hotelId={hotelId}
        onClose={() => setQuickCreate(false)}
        onSaved={s => { onChange(supplierToPartner(s, 'manual')); setQuickCreate(false); setError(''); }}
      />
    </div>
  );
}
