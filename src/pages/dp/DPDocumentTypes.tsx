// src/pages/dp/DPDocumentTypes.tsx
//
// CRUD dos tipos de documento do colaborador.
//
// Existe por causa do princípio do projeto de nada hardcoded: contracheque é só
// o primeiro tipo. Férias, 13º, advertência, ASO e contrato entram por aqui,
// sem migration nem deploy.
//
// Duas flags mudam comportamento de verdade e por isso ficam explicadas na tela:
// `requires_signature` decide se o Portal cobra assinatura, e `is_payslip` liga
// a leitura automática de verbas no envio em lote.

import { useCallback, useEffect, useState } from 'react';
import { useGroup } from '../../context/GroupContext';
import { sanitizeError } from '../../utils/errorHandler';
import {
  listDocumentTypes, saveDocumentType,
  type EmployeeDocumentType,
} from '../../lib/employeeDocumentsService';
import {
  Plus, Loader2, AlertTriangle, Settings, PenLine, Eye, EyeOff, Receipt, Check, X,
} from 'lucide-react';

interface FormState {
  id?: string;
  name: string;
  requires_signature: boolean;
  visible_in_portal: boolean;
  is_payslip: boolean;
  is_active: boolean;
  sort_order: number;
}

const EMPTY_FORM: FormState = {
  name: '',
  requires_signature: true,
  visible_in_portal: true,
  is_payslip: false,
  is_active: true,
  sort_order: 0,
};

export default function DPDocumentTypes() {
  const { currentGroup } = useGroup();

  const [types, setTypes] = useState<EmployeeDocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTypes(await listDocumentTypes(currentGroup?.id, { includeInactive: true }));
    } catch (err) {
      setError(sanitizeError(err));
    } finally {
      setLoading(false);
    }
  }, [currentGroup?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    // Trava de duplo clique — convenção obrigatória do projeto.
    if (isSaving || !form || !currentGroup?.id) return;

    if (!form.name.trim()) {
      setError('Informe o nome do tipo.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await saveDocumentType(currentGroup.id, form);
      setForm(null);
      await load();
    } catch (err) {
      setError(sanitizeError(err));
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Tipos de documento</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Cada tipo define se o Portal cobra assinatura e se aparece para o colaborador.
          </p>
        </div>
        <button
          onClick={() => setForm({ ...EMPTY_FORM, sort_order: types.length })}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold shadow-sm"
        >
          <Plus className="h-4 w-4" /> Novo tipo
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3.5">
          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
        </div>
      )}

      {types.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center shadow-sm">
          <Settings className="h-10 w-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Nenhum tipo cadastrado. Crie ao menos um (por exemplo, Contracheque).
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {types.map(t => (
            <div
              key={t.id}
              className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 shadow-sm ${
                t.is_active
                  ? 'border-gray-200 dark:border-gray-700'
                  : 'border-gray-200 dark:border-gray-700 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">
                    {t.name}
                    {!t.is_active && <span className="ml-2 text-xs font-normal text-gray-400">(inativo)</span>}
                  </p>
                  <p className="text-xs text-gray-400 font-mono">{t.slug}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <Flag on={t.requires_signature} icon={PenLine} onLabel="exige assinatura" offLabel="sem assinatura" />
                    <Flag
                      on={t.visible_in_portal}
                      icon={t.visible_in_portal ? Eye : EyeOff}
                      onLabel="visível no Portal"
                      offLabel="oculto no Portal"
                    />
                    {t.is_payslip && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                        <Receipt className="h-3 w-3" /> leitura automática
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setForm({
                    id: t.id,
                    name: t.name,
                    requires_signature: t.requires_signature,
                    visible_in_portal: t.visible_in_portal,
                    is_payslip: t.is_payslip,
                    is_active: t.is_active,
                    sort_order: t.sort_order,
                  })}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0"
                >
                  Editar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de edição */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                {form.id ? 'Editar tipo' : 'Novo tipo de documento'}
              </h2>
              <button
                onClick={() => setForm(null)}
                disabled={isSaving}
                className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  Nome
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Contracheque, Férias, Advertência..."
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                />
              </div>

              <Toggle
                checked={form.requires_signature}
                onChange={v => setForm({ ...form, requires_signature: v })}
                label="Exige assinatura do colaborador"
                hint="O documento aparece no Portal com o botão Assinar e fica pendente até ser assinado."
              />

              <Toggle
                checked={form.visible_in_portal}
                onChange={v => setForm({ ...form, visible_in_portal: v })}
                label="Visível no Portal do colaborador"
                hint="Desmarque para documentos de uso interno do DP."
              />

              <Toggle
                checked={form.is_payslip}
                onChange={v => setForm({ ...form, is_payslip: v })}
                label="É contracheque (leitura automática)"
                hint="Liga a leitura de matrícula, competência e verbas no envio em lote. Só marque para o demonstrativo de pagamento — em outro layout a leitura erraria."
              />

              <Toggle
                checked={form.is_active}
                onChange={v => setForm({ ...form, is_active: v })}
                label="Ativo"
                hint="Tipo inativo não aparece para escolher no envio, mas os documentos já enviados continuam."
              />
            </div>

            <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <button
                onClick={() => setForm(null)}
                disabled={isSaving}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold shadow-sm disabled:opacity-60"
              >
                {isSaving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
                  : <><Check className="h-4 w-4" /> Salvar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Flag({ on, icon: Icon, onLabel, offLabel }: {
  on: boolean; icon: any; onLabel: string; offLabel: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
      on
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
    }`}>
      <Icon className="h-3 w-3" /> {on ? onLabel : offLabel}
    </span>
  );
}

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 shrink-0"
      />
      <span>
        <span className="block text-sm font-medium text-gray-800 dark:text-white">{label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>
      </span>
    </label>
  );
}
