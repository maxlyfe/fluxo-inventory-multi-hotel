// src/components/financial/BulkMarkBilledModal.tsx
// Marca cobrança efetuada em lote, com data possivelmente retroativa.
//
// Duas decisões deliberadas de UX:
//   1. A previsão resultante é mostrada ANTES de confirmar, agrupada por
//      parceiro. Marcar cobrança move expected_date sem que nenhum recebimento
//      tenha ocorrido: o operador precisa ver o efeito antes de gravar.
//   2. O modal NÃO fecha no final. Mostra o resultado item a item, incluindo o
//      que foi ignorado e por quê. "Deu certo" escondendo 3 ignorados de 8 é
//      exatamente a falha silenciosa que esta tela existe para evitar.

import React, { useMemo, useState } from 'react';
import { CheckCircle2, X, Loader2, AlertTriangle, CalendarClock, RotateCcw } from 'lucide-react';
import { ModalShell } from './Fornecedores';
import { fmtBRL, fmtDate, todayISO } from './shared';
import {
  billingService, previewExpectedDates, partnerName,
  type BillingQueueRow, type MarkBilledResult,
} from '../../lib/billingService';

const SKIP_LABELS: Record<string, string> = {
  cancelado: 'título cancelado',
  nao_e_faturamento: 'não é um recebível de faturamento',
  ja_cobrado: 'já estava marcado como cobrado',
};

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function BulkMarkBilledModal({
  hotelId, rows, onClose, onDone,
}: {
  hotelId: string;
  /** Linhas selecionadas na fila. */
  rows: BillingQueueRow[];
  onClose: () => void;
  /** Chamado ao fechar depois de gravar, para a lista recarregar. */
  onDone: () => void;
}) {
  const [billedOn, setBilledOn] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MarkBilledResult | null>(null);

  const eligible = rows.filter(r => r.billing_status === 'aguardando_cobranca');
  const ignored = rows.filter(r => r.billing_status !== 'aguardando_cobranca');
  const total = eligible.reduce((s, r) => s + (r.net_amount - r.amount_received), 0);
  const groups = useMemo(
    () => previewExpectedDates(eligible, billedOn),
    [eligible, billedOn],
  );

  const handleConfirm = async () => {
    if (!billedOn) { setError('Informe a data do envio da cobrança.'); return; }
    setSaving(true); setError('');
    try {
      const res = await billingService.markBilled({
        hotelId,
        billedOn,
        arTitleIds: rows.map(r => r.ar_title_id),
        manual: true,
        note: note.trim() || null,
      });
      setResult(res);
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao marcar as cobranças');
    } finally {
      setSaving(false);
    }
  };

  const retryFailed = () => {
    // Só faz sentido tentar de novo o que a RPC recusou por motivo transitório.
    // 'ja_cobrado' e 'cancelado' não são transitórios, então não há retry útil:
    // o botão só aparece quando houve algo além disso.
    setResult(null);
    setError('');
  };

  const nonTerminalSkips = (result?.skipped ?? []).filter(
    s => s.reason !== 'ja_cobrado' && s.reason !== 'cancelado',
  );

  return (
    <ModalShell onClose={result ? () => { onDone(); onClose(); } : onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4 flex flex-col"
        style={{ maxHeight: 'calc(100dvh - 2rem)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            {result ? 'Resultado' : 'Marcar cobrança efetuada'}
          </h2>
          <button onClick={result ? () => { onDone(); onClose(); } : onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {result ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-gray-800 dark:text-gray-200">
                  {result.updated_count} marcada(s) como cobrada(s)
                </span>
              </div>

              {result.skipped.length > 0 && (
                <div>
                  <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    {result.skipped.length} ignorada(s)
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                    {result.skipped.map(s => (
                      <li key={s.id}>
                        · Reserva {s.booking_ref ?? '(sem número)'}: {SKIP_LABELS[s.reason] ?? s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.refs_nao_encontradas.length > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Não encontradas: {result.refs_nao_encontradas.join(', ')}
                </p>
              )}

              {nonTerminalSkips.length > 0 && (
                <button onClick={retryFailed}
                  className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
                  <RotateCcw className="w-3.5 h-3.5" /> Tentar de novo só as que falharam
                </button>
              )}
            </>
          ) : (
            <>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 text-sm">
                <p className="font-medium text-gray-800 dark:text-gray-200">
                  {eligible.length} cobrança(s) selecionada(s) · {fmtBRL(total)}
                </p>
                {ignored.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    {ignored.length} da seleção não está aguardando cobrança e será ignorada.
                  </p>
                )}
              </div>

              <div>
                <label className="label-sm">Data em que a cobrança foi enviada *</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" className="input-field !w-auto" value={billedOn}
                    max={todayISO()} onChange={e => setBilledOn(e.target.value)} />
                  <button type="button" onClick={() => setBilledOn(todayISO())}
                    className="px-2.5 py-1.5 text-xs border dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                    Hoje
                  </button>
                  <button type="button" onClick={() => setBilledOn(yesterdayISO())}
                    className="px-2.5 py-1.5 text-xs border dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                    Ontem
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  Pode ser retroativa: use a data real do envio, é dela que o prazo conta.
                </p>
              </div>

              {eligible.length > 0 && (
                <div>
                  <p className="label-sm flex items-center gap-1.5">
                    <CalendarClock className="w-3.5 h-3.5" /> Previsão que será gravada
                  </p>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border dark:border-gray-700 divide-y dark:divide-gray-700">
                    {groups.map(g => (
                      <div key={`${g.partner}-${g.days}`} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <span className="text-gray-700 dark:text-gray-300 truncate">{g.partner}</span>
                        <span className="text-gray-500 whitespace-nowrap">
                          +{g.days} dia(s) · {g.count} tít.
                        </span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                          {fmtDate(g.expected)}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 text-xs bg-white dark:bg-gray-800">
                      <span className="text-gray-500">Total</span>
                      <span className="font-semibold text-gray-800 dark:text-gray-200">
                        {eligible.length} título(s) · {fmtBRL(total)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="label-sm">Observação (opcional)</label>
                <input className="input-field" value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Enviado por e-mail pelo Outlook em 12/07" />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-1">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t dark:border-gray-700 shrink-0 flex justify-end gap-3">
          {result ? (
            <button onClick={() => { onDone(); onClose(); }}
              className="px-5 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700">
              Fechar
            </button>
          ) : (
            <>
              <button onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                Cancelar
              </button>
              <button onClick={handleConfirm} disabled={saving || eligible.length === 0}
                className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar {eligible.length} cobrança(s)
              </button>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
