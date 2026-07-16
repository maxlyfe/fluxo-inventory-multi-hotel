import React, { useState, useCallback } from 'react';
import {
  FileText, Search, Loader2, Download, RefreshCw, ChevronDown, ChevronUp,
  Calendar, User, Filter, Link2, ExternalLink,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { nfService, type NfseConsultaItem } from '../../lib/nfService';
import { supabase } from '../../lib/supabase';

interface MatchedNfse extends NfseConsultaItem {
  booking_number?: string;
  booking_guest?: string;
}

function formatCurrency(v: string | null): string {
  if (!v) return '—';
  const n = parseFloat(v);
  return isNaN(n) ? v : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

function formatDoc(doc: string | null): string {
  if (!doc) return '—';
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

export default function NFSeEmitidasPage() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const hotelId = selectedHotel?.id || '';

  const [mode, setMode] = useState<'periodo' | 'faixa'>('periodo');
  const [dataInicial, setDataInicial] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dataFinal, setDataFinal] = useState(() => new Date().toISOString().slice(0, 10));
  const [numInicial, setNumInicial] = useState('1');
  const [numFinal, setNumFinal] = useState('100');
  const [filterDoc, setFilterDoc] = useState('');

  const [loading, setLoading] = useState(false);
  const [notas, setNotas] = useState<MatchedNfse[]>([]);
  const [expandedNum, setExpandedNum] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true);
    setSearched(true);
    try {
      let result: { success: boolean; notas: NfseConsultaItem[]; message: string };

      if (mode === 'periodo') {
        result = await nfService.consultarNfseEmitidas(
          hotelId, dataInicial, dataFinal, 1,
          filterDoc.trim() || undefined,
        );
      } else {
        result = await nfService.consultarNfsePorFaixa(
          hotelId, parseInt(numInicial) || 1, parseInt(numFinal) || 9999,
        );
      }

      if (!result.success) {
        addNotification('error', result.message);
        setNotas([]);
        return;
      }

      // Match with bookings by tomador CPF/CNPJ
      const docs = [...new Set(result.notas.map(n => n.tomador_cpf_cnpj).filter(Boolean))] as string[];
      const matched: MatchedNfse[] = result.notas.map(n => ({ ...n }));

      if (docs.length > 0) {
        // Try to find matching invoices in our DB
        const { data: invoices } = await supabase
          .from('nf_invoices')
          .select('tomador_cpf_cnpj, booking_number, tomador_nome, numero_nf')
          .eq('hotel_id', hotelId)
          .in('tomador_cpf_cnpj', docs);

        // Also try erbon bookings via guest doc
        const invoiceMap = new Map<string, { booking_number: string; guest: string }>();
        if (invoices) {
          for (const inv of invoices) {
            if (inv.tomador_cpf_cnpj && inv.booking_number) {
              invoiceMap.set(inv.tomador_cpf_cnpj.replace(/\D/g, ''), {
                booking_number: inv.booking_number,
                guest: inv.tomador_nome || '',
              });
            }
          }
        }

        for (const nota of matched) {
          if (nota.tomador_cpf_cnpj) {
            const clean = nota.tomador_cpf_cnpj.replace(/\D/g, '');
            const match = invoiceMap.get(clean);
            if (match) {
              nota.booking_number = match.booking_number;
              nota.booking_guest = match.guest;
            }
          }
        }
      }

      setNotas(matched);
      if (matched.length > 0) {
        addNotification('success', `${matched.length} NFS-e encontrada(s).`);
      } else {
        addNotification('info', 'Nenhuma NFS-e encontrada no período/faixa.');
      }
    } catch (err: any) {
      addNotification('error', err.message || 'Erro ao consultar.');
      setNotas([]);
    } finally {
      setLoading(false);
    }
  }, [hotelId, mode, dataInicial, dataFinal, numInicial, numFinal, filterDoc, addNotification]);

  const totalValor = notas.reduce((s, n) => s + (parseFloat(n.valor_servicos || '0') || 0), 0);
  const totalIss = notas.reduce((s, n) => s + (parseFloat(n.valor_iss || '0') || 0), 0);
  const matchedCount = notas.filter(n => n.booking_number).length;

  if (!hotelId) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <FileText className="h-8 w-8 text-amber-500" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">NFS-e Emitidas</h1>
          <p className="text-sm text-gray-500">Consulta retroativa de NFS-e emitidas na Prefeitura (E&L Cloud)</p>
        </div>
      </div>

      {/* Search Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
        {/* Mode Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('periodo')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === 'periodo'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            <Calendar className="h-4 w-4 inline mr-1" />
            Por Período
          </button>
          <button
            onClick={() => setMode('faixa')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === 'faixa'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            <Filter className="h-4 w-4 inline mr-1" />
            Por Faixa de Número
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {mode === 'periodo' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Data Inicial</label>
                <input
                  type="date" value={dataInicial} onChange={e => setDataInicial(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Data Final</label>
                <input
                  type="date" value={dataFinal} onChange={e => setDataFinal(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">CPF/CNPJ Tomador (opcional)</label>
                <input
                  type="text" value={filterDoc} onChange={e => setFilterDoc(e.target.value)}
                  placeholder="Filtrar por documento"
                  className="px-3 py-2 border rounded-lg text-sm w-48 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Número Inicial</label>
                <input
                  type="number" value={numInicial} onChange={e => setNumInicial(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm w-28 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Número Final</label>
                <input
                  type="number" value={numFinal} onChange={e => setNumFinal(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm w-28 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
            </>
          )}

          <button
            onClick={search}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Consultar
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {searched && notas.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 mb-1">Total de NFS-e</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{notas.length}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 mb-1">Valor Total Serviços</p>
            <p className="text-2xl font-bold text-green-600">{totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 mb-1">Total ISS</p>
            <p className="text-2xl font-bold text-blue-600">{totalIss.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 mb-1">Vinculadas a Reservas</p>
            <p className="text-2xl font-bold text-amber-600">{matchedCount} / {notas.length}</p>
          </div>
        </div>
      )}

      {/* Results Table */}
      {searched && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          {notas.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              {loading ? 'Consultando...' : 'Nenhuma NFS-e encontrada.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500">Nº</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Data</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Tomador</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Documento</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Valor</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">ISS</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Reserva</th>
                    <th className="px-4 py-3 font-medium text-gray-500 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {notas.map(nota => (
                    <React.Fragment key={nota.numero}>
                      <tr
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
                        onClick={() => setExpandedNum(expandedNum === nota.numero ? null : nota.numero)}
                      >
                        <td className="px-4 py-3 font-mono font-medium text-gray-800 dark:text-white">{nota.numero}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{formatDate(nota.data_emissao)}</td>
                        <td className="px-4 py-3 text-gray-800 dark:text-white truncate max-w-[200px]">{nota.tomador_nome || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{formatDoc(nota.tomador_cpf_cnpj)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-white">{formatCurrency(nota.valor_servicos)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(nota.valor_iss)}</td>
                        <td className="px-4 py-3">
                          {nota.booking_number ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 rounded-full text-xs font-medium">
                              <Link2 className="h-3 w-3" />
                              #{nota.booking_number}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {expandedNum === nota.numero
                            ? <ChevronUp className="h-4 w-4 text-gray-400" />
                            : <ChevronDown className="h-4 w-4 text-gray-400" />
                          }
                        </td>
                      </tr>
                      {expandedNum === nota.numero && (
                        <tr>
                          <td colSpan={8} className="px-4 py-4 bg-gray-50 dark:bg-gray-700/20">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1">Discriminação</p>
                                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line text-xs">
                                  {nota.discriminacao || 'Não informada'}
                                </p>
                              </div>
                              <div className="space-y-2">
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Competência:</span>
                                  <span className="font-medium">{nota.competencia || '—'}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Alíquota ISS:</span>
                                  <span className="font-medium">
                                    {nota.aliquota ? `${(parseFloat(nota.aliquota) * 100).toFixed(2)}%` : '—'}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Cód. Verificação:</span>
                                  <span className="font-mono text-xs">{nota.codigo_verificacao || '—'}</span>
                                </div>
                                {nota.booking_number && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Reserva vinculada:</span>
                                    <span className="font-medium text-amber-600">#{nota.booking_number}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Empty state before search */}
      {!searched && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-12 text-center">
          <Search className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 mb-2">Consulte NFS-e emitidas na Prefeitura de Búzios</p>
          <p className="text-xs text-gray-400">
            Selecione um período ou faixa de números e clique em "Consultar" para buscar as notas emitidas diretamente no servidor da prefeitura.
          </p>
        </div>
      )}
    </div>
  );
}
