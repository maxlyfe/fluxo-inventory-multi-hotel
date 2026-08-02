// src/components/financial/BackfillNfModal.tsx
// "Buscar NFs emitidas": traz para a fila de cobranças notas que já foram
// emitidas ANTES de o parceiro ser cadastrado.
//
// Por que a tela existe: o engate da cobrança roda no momento da autorização da
// nota. Quem cadastra o parceiro hoje e emitiu a nota ontem não tem nada na fila
// e nem consegue testar o envio. Este modal chama
// rpc_ar_backfill_billing_for_period, que é idempotente.

import React, { useState } from 'react';
import { History, X, Loader2, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { ModalShell } from './Fornecedores';
import { billingService, BACKFILL_REASON_LABELS, type BackfillResult } from '../../lib/billingService';
import { fmtBRL, fmtDate, todayISO } from './shared';

/**
 * Período padrão: 90 dias para trás até hoje.
 *
 * De propósito NÃO reaproveita o período da página (mês corrente em diante):
 * no dia 1º do mês, "a nota que emiti ontem" cai fora dele, e o operador rodaria
 * a busca, veria "0 encontradas" e concluiria que o sistema não funciona.
 */
function defaultBackfillRange() {
  const to = todayISO();
  const d = new Date(to + 'T12:00:00');
  d.setDate(d.getDate() - 90);
  return { from: d.toISOString().slice(0, 10), to };
}

export default function BackfillNfModal({ hotelId, onClose, onDone }: {
  hotelId: string;
  onClose: () => void;
  /** Chamado depois de um reprocessamento que mexeu na fila, para recarregar. */
  onDone: (result: BackfillResult) => void;
}) {
  const [range, setRange] = useState(defaultBackfillRange);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BackfillResult | null>(null);

  const run = async () => {
    if (range.to < range.from) { setError('A data final é anterior à inicial.'); return; }
    setRunning(true); setError(''); setResult(null);
    try {
      const res = await billingService.backfillFromEmittedNfs(hotelId, range.from, range.to);
      setResult(res);
      if (res.prepared > 0) onDone(res);
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao reprocessar as notas');
    } finally {
      setRunning(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl my-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <History className="w-4 h-4 text-rose-500" />
            Buscar NFs já emitidas
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            A cobrança normalmente entra na fila no momento em que a nota é autorizada. Se você
            cadastrou o parceiro depois de emitir a nota, ela não passou por essa etapa e não
            aparece aqui. Esta busca reprocessa as notas do período e traz para a fila as que
            casam com uma regra de faturamento.
          </p>

          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800 dark:text-blue-300">
              Pode rodar quantas vezes quiser. Cobrança já enviada ou já marcada como efetuada
              não é reescrita nem enviada de novo: o reprocessamento só monta o que ainda não
              existe.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-sm">Emitidas de</label>
              <input type="date" className="input-field" value={range.from}
                onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
            </div>
            <div>
              <label className="label-sm">até</label>
              <input type="date" className="input-field" value={range.to}
                onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Pela data de emissão da nota, não pela previsão de recebimento.
          </p>

          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4 shrink-0" />{error}
            </p>
          )}

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[
                  ['Analisadas', result.scanned, 'text-gray-700 dark:text-gray-200'],
                  ['Novas na fila', result.prepared, 'text-green-600 dark:text-green-400'],
                  ['Já estavam', result.already, 'text-blue-600 dark:text-blue-400'],
                  ['De fora', result.skipped, 'text-amber-600 dark:text-amber-400'],
                ].map(([label, value, color]) => (
                  <div key={label as string} className="p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <p className={`text-xl font-bold ${color}`}>{value as number}</p>
                    <p className="text-[11px] text-gray-500">{label as string}</p>
                  </div>
                ))}
              </div>

              {result.prepared > 0 && (
                <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {result.prepared} cobrança(s) entraram na fila. Feche esta janela para vê-las.
                </p>
              )}

              {result.scanned === 0 && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Nenhuma nota com CNPJ no tomador foi emitida nesse período. Confira as datas:
                  a busca é pela data de emissão.
                </p>
              )}

              {Object.keys(result.reasons).length > 0 && (
                <div className="border dark:border-gray-700 rounded-lg overflow-hidden">
                  <p className="px-3 py-2 bg-gray-50 dark:bg-gray-900 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    Por que algumas ficaram de fora
                  </p>
                  <ul className="divide-y dark:divide-gray-700">
                    {Object.entries(result.reasons)
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, count]) => (
                        <li key={reason} className="px-3 py-2 text-xs">
                          <span className="font-semibold text-gray-800 dark:text-gray-200">{count}×</span>{' '}
                          <span className="text-gray-600 dark:text-gray-400">
                            {BACKFILL_REASON_LABELS[reason] ?? reason}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {result.details.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                    Ver as notas que ficaram de fora ({result.details.length}
                    {result.details_truncated ? ' primeiras' : ''})
                  </summary>
                  <div className="mt-2 max-h-48 overflow-y-auto border dark:border-gray-700 rounded-lg">
                    <table className="w-full">
                      <tbody className="divide-y dark:divide-gray-700">
                        {result.details.map(d => (
                          <tr key={d.nf_invoice_id}>
                            <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">{fmtDate(d.emitida_em)}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">NF {d.numero_nf ?? '—'}</td>
                            <td className="px-2 py-1.5 truncate max-w-[160px]" title={d.tomador ?? ''}>
                              {d.tomador ?? '—'}
                            </td>
                            <td className="px-2 py-1.5 whitespace-nowrap text-right">{fmtBRL(d.valor ?? 0)}</td>
                            <td className="px-2 py-1.5 text-gray-500">{d.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t dark:border-gray-700">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            Fechar
          </button>
          <button onClick={run} disabled={running}
            className="px-5 py-2 text-sm bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2">
            {running && <Loader2 className="w-4 h-4 animate-spin" />}
            {result ? 'Buscar de novo' : 'Buscar'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
