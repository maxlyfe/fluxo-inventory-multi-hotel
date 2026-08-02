// src/pages/financial/CobrancasPage.tsx
// Fila de cobranças de parceiros faturados.
//
// Rota própria e não aba dentro de Contas a Receber por três motivos:
//   1. É fila de trabalho diária, não configuração.
//   2. O período aqui é a data de EMISSÃO da NF; no AR é a previsão de
//      recebimento. Um PeriodFilter compartilhado significaria duas coisas.
//   3. O requisito antifalha exige descoberta: item de menu com contador é
//      visível, aba escondida não é.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Send, Loader2, RefreshCw, Search, Settings2, CheckCircle2, Clock,
  AlertTriangle, XCircle, Hand, FileText, Inbox, ArrowUpCircle, History,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useHotel } from '../../context/HotelContext';
import { usePermissions } from '../../hooks/usePermissions';
import {
  billingService, parseBookingRefsInput, partnerName,
  type BillingQueueRow, type RefLookup,
} from '../../lib/billingService';
import type { ArBillingStatus } from '../../lib/arService';
import { formatCnpj } from '../../lib/supplierService';
import {
  fmtBRL, fmtDate, estimatedDateLabel, PeriodFilter, Period, defaultPeriod,
  SummaryCard, ErrorBanner, InfoBanner, EmptyState, SelectionBar, BulkPasteBox,
} from '../../components/financial/shared';
import BulkMarkBilledModal from '../../components/financial/BulkMarkBilledModal';
import BackfillNfModal from '../../components/financial/BackfillNfModal';

type Tab = 'a_disparar' | 'falhas' | 'historico';

const TAB_STATUS: Record<Tab, ArBillingStatus[]> = {
  a_disparar: ['aguardando_cobranca'],
  falhas: ['aguardando_cobranca'],
  historico: ['cobranca_enviada'],
};

/** Selo da coluna Cobrança. */
function DispatchBadge({ row }: { row: BillingQueueRow }) {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap';

  if (row.dispatch_status === 'falha') {
    return (
      <span className={`${base} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300`}
        title={row.dispatch_error ?? undefined}>
        <XCircle className="w-3 h-3" /> Falhou
      </span>
    );
  }
  if (row.billing_status === 'cobranca_enviada') {
    return row.marked_manually ? (
      <span className={`${base} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300`}
        title="Marcada manualmente pelo operador">
        <Hand className="w-3 h-3" /> Marcada {fmtDate(row.billed_at)}
      </span>
    ) : (
      <span className={`${base} bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300`}
        title={row.from_email ? `Enviada de ${row.from_email}` : undefined}>
        <CheckCircle2 className="w-3 h-3" /> Enviada {fmtDate(row.billed_at)}
      </span>
    );
  }
  if (row.billing_status === 'aguardando_nf') {
    return (
      <span className={`${base} bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300`}>
        <FileText className="w-3 h-3" /> Aguardando NF
      </span>
    );
  }
  return (
    <span className={`${base} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`}>
      <Clock className="w-3 h-3" /> Aguardando
    </span>
  );
}

export default function CobrancasPage() {
  const { selectedHotel } = useHotel();
  const { canAny } = usePermissions();
  // Marcar é registro interno; enviar fala com o cliente externo e é
  // irreversível. São permissões separadas de propósito.
  const canMark = canAny(['finances', 'finances.billing.mark']);
  const canSend = canAny(['finances', 'finances.billing.send']);
  const [tab, setTab] = useState<Tab>('a_disparar');
  const [rows, setRows] = useState<BillingQueueRow[]>([]);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [partnerFilter, setPartnerFilter] = useState('');
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasteResult, setPasteResult] = useState<RefLookup | null>(null);
  const [locating, setLocating] = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [backfillModal, setBackfillModal] = useState(false);
  const [sending, setSending] = useState(false);

  /** Envia agora as cobranças selecionadas, com resultado item a item. */
  const handleSendNow = async () => {
    if (!selectedHotel?.id || !selectedRows.length) return;
    if (!window.confirm(
      `Enviar ${selectedRows.length} cobrança(s) por e-mail agora? ` +
      'Isso manda mensagem para o parceiro e não pode ser desfeito.'
    )) return;

    setSending(true); setError(''); setInfo('');
    try {
      const res = await billingService.send(
        selectedHotel.id,
        selectedRows.map(r => r.ar_title_id),
      );
      const partes = [`${res.sent.length} enviada(s)`];
      if (res.failed.length) partes.push(`${res.failed.length} falhou(ram)`);
      if (res.skipped.length) {
        const motivos = Array.from(new Set(res.skipped.map(s => s.reason))).join(', ');
        partes.push(`${res.skipped.length} ignorada(s): ${motivos}`);
      }
      const msg = partes.join(' · ');
      if (res.failed.length || res.skipped.length) setError(msg); else setInfo(msg);
      setSelected(new Set());
      load();
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao enviar as cobranças');
    } finally {
      setSending(false);
    }
  };

  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true); setError('');
    try {
      const data = await billingService.listQueue(selectedHotel.id, {
        billing_status: TAB_STATUS[tab],
        supplier_id: partnerFilter || undefined,
        from: period.from,
        to: period.to,
      });
      setRows(data);
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao carregar a fila de cobranças');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel?.id, tab, partnerFilter, period]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedHotel?.id) return;
    billingService.listQueuePartners(selectedHotel.id).then(setPartners).catch(() => {});
  }, [selectedHotel?.id]);

  // A aba "Falhas" é um corte da mesma fila: só o que já tentou e não foi.
  const tabRows = useMemo(() => {
    if (tab === 'falhas') return rows.filter(r => r.dispatch_status === 'falha');
    if (tab === 'a_disparar') return rows.filter(r => r.dispatch_status !== 'falha');
    return rows;
  }, [rows, tab]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tabRows;
    const s = search.trim().toLowerCase();
    return tabRows.filter(r =>
      (r.booking_ref ?? '').toLowerCase().includes(s) ||
      (r.numero_nf ?? '').toLowerCase().includes(s) ||
      (r.guest_name ?? '').toLowerCase().includes(s) ||
      partnerName(r).toLowerCase().includes(s));
  }, [tabRows, search]);

  const selectedRows = filtered.filter(r => selected.has(r.ar_title_id));
  const selectedTotal = selectedRows.reduce((s, r) => s + (r.net_amount - r.amount_received), 0);

  // ── Cards ──
  const pending = rows.filter(r => r.billing_status === 'aguardando_cobranca' && r.dispatch_status !== 'falha');
  const failed = rows.filter(r => r.dispatch_status === 'falha');
  const pendingTotal = pending.reduce((s, r) => s + (r.net_amount - r.amount_received), 0);
  const sentThisPeriod = rows.filter(r => r.billing_status === 'cobranca_enviada').length;

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.ar_title_id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(filtered.map(r => r.ar_title_id)));

  /** Colagem de vários números de reserva: localiza e seleciona de uma vez. */
  const handleLocate = async (raw: string) => {
    if (!selectedHotel?.id) return;
    const refs = parseBookingRefsInput(raw);
    if (!refs.length) return;
    setLocating(true); setError('');
    try {
      const res = await billingService.lookupRefs(selectedHotel.id, refs);
      setPasteResult(res);
      // Seleciona só o que dá para marcar. Já cobrado entra no relatório, não na
      // seleção, senão o operador confirma um lote que não vai fazer nada.
      setSelected(prev => {
        const next = new Set(prev);
        for (const f of res.found) next.add(f.ar_title_id);
        return next;
      });
      if (res.found.length && !rows.some(r => res.found.some(f => f.ar_title_id === r.ar_title_id))) {
        setInfo('Parte das reservas localizadas está fora do período ou do filtro atual. Limpe os filtros para vê-las na lista.');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao localizar as reservas');
    } finally {
      setLocating(false);
    }
  };

  if (!selectedHotel?.id) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <Send className="h-8 w-8 text-rose-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Cobranças a Disparar</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/finances/contas-a-receber"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <ArrowUpCircle className="w-4 h-4" /> Contas a Receber
          </Link>
          <Link to="/finances/regras-recebimento"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <Settings2 className="w-4 h-4" /> Regras
          </Link>
          {canMark && (
            <button onClick={() => setBackfillModal(true)}
              title="Trazer para a fila notas emitidas antes de o parceiro ser cadastrado"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
              <History className="w-4 h-4" /> Buscar NFs emitidas
            </button>
          )}
          <button onClick={load} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Notas emitidas para parceiros faturados que ainda não tiveram a cobrança enviada.
        O prazo de recebimento só começa a contar da data do envio.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="A disparar" value={String(pending.length)} color="text-amber-600 dark:text-amber-400" />
        <SummaryCard label="Valor pendente" value={fmtBRL(pendingTotal)} color="text-blue-600 dark:text-blue-400" />
        <SummaryCard label="Falharam" value={String(failed.length)} color="text-red-600 dark:text-red-400" />
        <SummaryCard label="Cobradas no período" value={String(sentThisPeriod)} color="text-green-600 dark:text-green-400" />
      </div>

      {failed.length > 0 && tab !== 'falhas' && (
        <InfoBanner tone="amber">
          <p>
            {failed.length} cobrança(s) falharam no envio.{' '}
            <button onClick={() => setTab('falhas')} className="underline font-medium">Ver falhas</button>
          </p>
        </InfoBanner>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {([
          ['a_disparar', 'A disparar', pending.length],
          ['falhas', 'Falhas', failed.length],
          ['historico', 'Histórico', sentThisPeriod],
        ] as [Tab, string, number][]).map(([k, label, count]) => (
          <button key={k} onClick={() => { setTab(k); setSelected(new Set()); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === k ? 'bg-rose-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            {label}
            <span className={`px-1.5 rounded-full text-[10px] ${
              tab === k ? 'bg-white/25' : 'bg-gray-100 dark:bg-gray-700'
            }`}>{count}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <PeriodFilter period={period} onChange={setPeriod} />
        <select className="input-field !w-auto text-sm" value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)}>
          <option value="">Todos os parceiros</option>
          {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Reserva, NF, hóspede ou parceiro..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500" />
        </div>
        {tab !== 'historico' && (
          <BulkPasteBox onLocate={handleLocate} locating={locating} />
        )}
      </div>

      {pasteResult && (
        <div className="mb-4 p-3 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl text-xs space-y-1.5">
          {pasteResult.found.length > 0 && (
            <p className="text-green-700 dark:text-green-400">
              {pasteResult.found.length} encontrada(s) e selecionada(s).
            </p>
          )}
          {pasteResult.alreadyBilled.length > 0 && (
            <p className="text-blue-700 dark:text-blue-400">
              {pasteResult.alreadyBilled.length} já estava(m) marcada(s) como cobrada(s), não foram selecionadas:{' '}
              {pasteResult.alreadyBilled.map(r => r.booking_ref).join(', ')}
            </p>
          )}
          {pasteResult.notFound.length > 0 && (
            <div className="text-red-700 dark:text-red-400">
              <p className="flex flex-wrap items-center gap-2">
                {pasteResult.notFound.length} não encontrada(s): {pasteResult.notFound.join(', ')}
                <button onClick={() => navigator.clipboard?.writeText(pasteResult.notFound.join('\n'))}
                  className="underline">copiar</button>
              </p>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                Causas prováveis: a NF ainda não foi emitida, o canal não tem regra de faturamento,
                ou o número da reserva está diferente do que veio do PMS.
              </p>
              <div className="flex gap-3 mt-1">
                <Link to="/finances/emissao-nf" className="underline">Abrir Emissão de NF</Link>
                <Link to="/finances/regras-recebimento" className="underline">Abrir Regras</Link>
              </div>
            </div>
          )}
          <button onClick={() => setPasteResult(null)} className="text-gray-500 underline">Fechar resultado</button>
        </div>
      )}

      <ErrorBanner message={error} onRetry={load} onDismiss={() => setError('')} />
      <InfoBanner message={info} tone="blue" />

      {tab !== 'historico' && filtered.length > 0 && (
        <SelectionBar
          total={filtered.length}
          selectedCount={selectedRows.length}
          selectedLabel={fmtBRL(selectedTotal)}
          allSelected={allSelected}
          onToggleAll={toggleAll}
          onClear={() => setSelected(new Set())}
        >
          {canSend && (
            <button onClick={handleSendNow} disabled={sending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50">
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Enviar agora
            </button>
          )}
          {canMark && (
            <button onClick={() => setBulkModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" /> Marcar cobrança efetuada
            </button>
          )}
        </SelectionBar>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1120px]">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                {tab !== 'historico' && <th className="px-3 py-3 w-8"></th>}
                <th className="text-left px-4 py-3">Reserva</th>
                <th className="text-left px-4 py-3">Hóspede</th>
                <th className="text-left px-4 py-3">Parceiro</th>
                <th className="text-left px-4 py-3">Canal</th>
                <th className="text-left px-4 py-3">NF</th>
                <th className="text-left px-4 py-3">Emitida</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-center px-4 py-3">Regra</th>
                <th className="text-left px-4 py-3">Previsão</th>
                <th className="text-center px-4 py-3">Cobrança</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="py-12 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
                </td></tr>
              ) : filtered.length === 0 ? (
                search.trim() ? (
                  <EmptyState colSpan={11} icon={<Search className="w-8 h-8" />}
                    title="Nada encontrado com estes filtros."
                    action={<button onClick={() => setSearch('')} className="text-sm text-blue-600 hover:underline">Limpar busca</button>} />
                ) : tab === 'falhas' ? (
                  <EmptyState colSpan={11} icon={<CheckCircle2 className="w-8 h-8" />}
                    title="Nenhuma falha de envio." />
                ) : tab === 'historico' ? (
                  <EmptyState colSpan={11} icon={<Inbox className="w-8 h-8" />}
                    title="Nenhuma cobrança registrada no período." />
                ) : (
                  // A fila vazia tem duas causas MUITO diferentes: não há nada a
                  // cobrar, ou a nota foi emitida antes de o parceiro existir e
                  // por isso nunca entrou aqui. Oferecer as duas saídas evita a
                  // conclusão de que o módulo está quebrado.
                  <EmptyState colSpan={11} icon={<CheckCircle2 className="w-8 h-8" />}
                    title="Nenhuma cobrança pendente no período."
                    description="A cobrança entra na fila no momento em que a NF é autorizada para um CNPJ com regra de evento Faturamento. Se você cadastrou o parceiro depois de emitir a nota, ela não passou por essa etapa: use Buscar NFs emitidas."
                    action={
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        {canMark && (
                          <button onClick={() => setBackfillModal(true)}
                            className="text-sm text-rose-600 hover:underline font-medium">
                            Buscar NFs emitidas
                          </button>
                        )}
                        <Link to="/finances/regras-recebimento" className="text-sm text-blue-600 hover:underline">
                          Criar regra de faturamento
                        </Link>
                      </div>
                    } />
                )
              ) : filtered.map(r => (
                <React.Fragment key={r.ar_title_id}>
                  <tr className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    {tab !== 'historico' && (
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={selected.has(r.ar_title_id)}
                          onChange={() => toggle(r.ar_title_id)}
                          className="rounded border-gray-300 dark:border-gray-600" />
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                      {r.booking_ref ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-[160px] truncate">
                      {r.guest_name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-800 dark:text-gray-200 truncate max-w-[180px]">{partnerName(r)}</p>
                      <p className="text-[11px] text-gray-500 flex items-center gap-1">
                        {r.supplier_cnpj ? formatCnpj(r.supplier_cnpj) : ''}
                        {!r.billing_email && !r.supplier_email && (
                          <span className="text-amber-600 dark:text-amber-400 inline-flex items-center gap-0.5"
                            title="Sem e-mail cadastrado: o envio automático não vai funcionar, mas dá para marcar como cobrada">
                            <AlertTriangle className="w-3 h-3" /> sem e-mail
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.channel ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.numero_nf ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                      {r.nf_created_at ? fmtDate(r.nf_created_at.slice(0, 10)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtBRL(r.net_amount)}</td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500 whitespace-nowrap">
                      +{r.days_to_receive ?? 0}d
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.expected_date ? (
                        fmtDate(r.expected_date)
                      ) : (
                        <span className="italic text-gray-400 dark:text-gray-500"
                          title="Estimativa: a data firme é gravada ao marcar a cobrança como efetuada.">
                          {estimatedDateLabel(r.checkout_date)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center"><DispatchBadge row={r} /></td>
                  </tr>
                  {r.dispatch_status === 'falha' && r.dispatch_error && (
                    <tr className="bg-red-50/50 dark:bg-red-900/10">
                      <td colSpan={11} className="px-4 py-2 text-xs text-red-700 dark:text-red-300">
                        <span className="inline-flex items-start gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          Tentativa {r.attempts ?? 0}: {r.dispatch_error}
                        </span>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {bulkModal && (
        <BulkMarkBilledModal
          hotelId={selectedHotel.id}
          rows={selectedRows}
          onClose={() => setBulkModal(false)}
          onDone={() => { setSelected(new Set()); setPasteResult(null); load(); }}
        />
      )}

      {backfillModal && (
        <BackfillNfModal
          hotelId={selectedHotel.id}
          onClose={() => setBackfillModal(false)}
          onDone={res => {
            // O período da tela filtra pela data de EMISSÃO da nota. Uma nota
            // reprocessada costuma ser mais antiga que o período atual, então
            // entraria na fila sem aparecer na lista — e o operador concluiria
            // que a busca não funcionou. Amplia o período para cobri-la.
            const wider = {
              from: res.from < period.from ? res.from : period.from,
              to:   res.to   > period.to   ? res.to   : period.to,
            };
            const changed = wider.from !== period.from || wider.to !== period.to;
            setTab('a_disparar');
            setSelected(new Set());
            setInfo(
              `${res.prepared} cobrança(s) trazidas para a fila.` +
              (changed ? ' O período da tela foi ampliado para mostrá-las.' : '')
            );
            // Só um dos dois: setPeriod já dispara o recarregamento pelo efeito, e
            // chamar load() junto criaria duas buscas concorrentes.
            if (changed) setPeriod(wider); else load();
          }}
        />
      )}
    </div>
  );
}
