import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Edit2, Trash2, Loader2, AlertTriangle, X,
} from 'lucide-react';
import {
  CreditCard, CardBrand, BRAND_LABELS,
  listAll, save, remove,
} from '../../lib/creditCardService';
import { ModalShell } from './Fornecedores';

interface Props { hotelId: string }

const BRANDS: CardBrand[] = ['visa', 'master', 'elo', 'amex', 'hipercard', 'outros'];

const BRAND_COLORS: Record<CardBrand, string> = {
  visa: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  master: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  elo: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  amex: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  hipercard: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  outros: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

function BrandBadge({ brand }: { brand: CardBrand | null }) {
  if (!brand) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BRAND_COLORS[brand]}`}>
      {BRAND_LABELS[brand]}
    </span>
  );
}

interface FormState {
  id?: string;
  name: string;
  last_4_digits: string;
  card_brand: CardBrand | '';
  closing_day: number;
  due_day: number;
}

const emptyForm = (): FormState => ({
  name: '', last_4_digits: '', card_brand: '', closing_day: 10, due_day: 5,
});

function CardModal({
  initial,
  hotelId,
  onSaved,
  onClose,
}: {
  initial: FormState;
  hotelId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || form.last_4_digits.length !== 4) return;
    setSaving(true);
    setError('');
    try {
      await save({
        id: form.id,
        hotel_id: hotelId,
        name: form.name.trim(),
        last_4_digits: form.last_4_digits,
        card_brand: (form.card_brand || null) as CardBrand | null,
        closing_day: form.closing_day,
        due_day: form.due_day,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof FormState, v: any) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <ModalShell onClose={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
            {form.id ? 'Editar Cartão' : 'Novo Cartão'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <form id="card-form" onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 dark:bg-red-900/20 p-2 rounded">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ex: Itaú Platinum"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Últimos 4 dígitos</label>
              <input
                type="text"
                value={form.last_4_digits}
                onChange={(e) => set('last_4_digits', e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                maxLength={4}
                pattern="\d{4}"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono tracking-widest"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bandeira</label>
              <select
                value={form.card_brand}
                onChange={(e) => set('card_brand', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Selecione</option>
                {BRANDS.map((b) => <option key={b} value={b}>{BRAND_LABELS[b]}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dia de Fechamento</label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.closing_day}
                onChange={(e) => set('closing_day', Math.max(1, Math.min(31, Number(e.target.value))))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dia de Vencimento</label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.due_day}
                onChange={(e) => set('due_day', Math.max(1, Math.min(31, Number(e.target.value))))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>
        </form>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            Cancelar
          </button>
          <button
            type="submit"
            form="card-form"
            disabled={saving || form.last_4_digits.length !== 4 || !form.name.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {form.id ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export default function CreditCardManager({ hotelId }: Props) {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<FormState | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAll(hotelId);
      setCards(data);
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  const handleEdit = (c: CreditCard) => {
    setModal({
      id: c.id,
      name: c.name,
      last_4_digits: c.last_4_digits,
      card_brand: c.card_brand ?? '',
      closing_day: c.closing_day,
      due_day: c.due_day,
    });
  };

  const handleRemove = async (c: CreditCard) => {
    if (!confirm(`Desativar o cartão "${c.name} •••• ${c.last_4_digits}"?`)) return;
    await remove(c.id);
    load();
  };

  const filtered = showInactive ? cards : cards.filter((c) => c.active);

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            Mostrar inativos
          </label>
        </div>
        <button
          onClick={() => setModal(emptyForm())}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus className="h-4 w-4" /> Novo Cartão
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          Nenhum cartão cadastrado.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                <th className="py-3 px-4 font-medium">Nome</th>
                <th className="py-3 px-4 font-medium">Final</th>
                <th className="py-3 px-4 font-medium">Bandeira</th>
                <th className="py-3 px-4 font-medium text-center">Fechamento</th>
                <th className="py-3 px-4 font-medium text-center">Vencimento</th>
                <th className="py-3 px-4 font-medium text-center">Status</th>
                <th className="py-3 px-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={`border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                    !c.active ? 'opacity-50' : ''
                  }`}
                >
                  <td className="py-3 px-4 font-medium text-gray-800 dark:text-white">{c.name}</td>
                  <td className="py-3 px-4 font-mono text-gray-600 dark:text-gray-300">•••• {c.last_4_digits}</td>
                  <td className="py-3 px-4"><BrandBadge brand={c.card_brand} /></td>
                  <td className="py-3 px-4 text-center text-gray-600 dark:text-gray-300">Dia {c.closing_day}</td>
                  <td className="py-3 px-4 text-center text-gray-600 dark:text-gray-300">Dia {c.due_day}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      c.active
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    }`}>
                      {c.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleEdit(c)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                        title="Editar"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      {c.active && (
                        <button
                          onClick={() => handleRemove(c)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          title="Desativar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <CardModal
          initial={modal}
          hotelId={hotelId}
          onSaved={() => { setModal(null); load(); }}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
