// src/components/nf/NFRecebidasTab.tsx
// Aba "NF Recebidas" do Financeiro — lista NF-e emitidas contra o CNPJ do hotel
// (sincronizadas via Distribuição DF-e), com download do XML e lançamento em compra.

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox, RefreshCw, Search, Download, ShoppingCart, EyeOff, RotateCcw,
  Loader2, AlertCircle, CheckCircle, FileText,
} from 'lucide-react';
import { nfService } from '../../lib/nfService';
import type { NFReceived, NFHotelConfig } from '../../types/nf';

interface Props {
  hotelId: string;
}

const SITUACAO_BADGE: Record<NFReceived['situacao'], { label: string; cls: string }> = {
  nova:     { label: 'Nova',      cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  lancada:  { label: 'Lançada',   cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  ignorada: { label: 'Ignorada',  cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
};

function formatCnpj(cnpj: string | null): string {
  const d = (cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return cnpj || '—';
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

const NFRecebidasTab: React.FC<Props> = ({ hotelId }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<NFReceived[]>([]);
  const [config, setConfig] = useState<NFHotelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [situacaoFilter, setSituacaoFilter] = useState<string>('');

  // Cooldown da SEFAZ: após "nenhum documento" ou rejeição 656 (consumo
  // indevido), é obrigatório aguardar 1 hora antes de nova consulta.
  const cooldownKey = `dfe_cooldown_${hotelId}`;
  const [cooldownUntil, setCooldownUntil] = useState<number>(() => {
    const saved = Number(localStorage.getItem(`dfe_cooldown_${hotelId}`) || 0);
    return saved > Date.now() ? saved : 0;
  });
  const cooldownActive = cooldownUntil > Date.now();
  const cooldownMinutes = cooldownActive ? Math.ceil((cooldownUntil - Date.now()) / 60000) : 0;

  function startCooldown() {
    const until = Date.now() + 60 * 60 * 1000;
    localStorage.setItem(cooldownKey, String(until));
    setCooldownUntil(until);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, data] = await Promise.all([
        nfService.getConfig(hotelId),
        nfService.getReceivedNFs(hotelId),
      ]);
      setConfig(cfg);
      setRows(data);
    } catch (err) {
      console.error('[NFRecebidas] load:', err);
      setMessage({ type: 'error', text: 'Erro ao carregar notas recebidas.' });
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (message?.type === 'success') {
      const t = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(t);
    }
  }, [message]);

  async function handleSync() {
    if (cooldownUntil > Date.now()) {
      const min = Math.ceil((cooldownUntil - Date.now()) / 60000);
      setMessage({ type: 'error', text: `A SEFAZ exige aguardar 1 hora entre consultas sem documentos novos. Tente novamente em ~${min} min.` });
      return;
    }
    setSyncing(true);
    setMessage(null);
    try {
      const result = await nfService.syncNFRecebidas(hotelId);
      setMessage({ type: result.success ? 'success' : 'error', text: result.message });
      // Sem documentos novos ou rejeição 656 → SEFAZ manda aguardar 1 hora
      if ((result.success && result.novas === 0) || /656/.test(result.message)) {
        startCooldown();
      }
      if (result.success) await load();
    } catch (err) {
      console.error('[NFRecebidas] sync:', err);
      setMessage({ type: 'error', text: 'Erro ao consultar a SEFAZ.' });
    } finally {
      setSyncing(false);
    }
  }

  function handleDownloadXml(nf: NFReceived) {
    if (!nf.xml) return;
    const blob = new Blob([nf.xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NFe-${nf.chave_acesso}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLancarCompra(nf: NFReceived) {
    if (!nf.xml || nf.tipo !== 'completa') return;
    navigate('/inventory/new-purchase', {
      state: { nfeXml: nf.xml, nfReceivedId: nf.id },
    });
  }

  async function handleSituacao(nf: NFReceived, situacao: NFReceived['situacao']) {
    try {
      await nfService.updateReceivedSituacao(nf.id, situacao);
      setRows(prev => prev.map(r => (r.id === nf.id ? { ...r, situacao } : r)));
    } catch {
      setMessage({ type: 'error', text: 'Erro ao atualizar situação da nota.' });
    }
  }

  const filtered = rows.filter(r => {
    if (situacaoFilter && r.situacao !== situacaoFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.emitente_nome || '').toLowerCase().includes(q) ||
      (r.emitente_cnpj || '').includes(q.replace(/\D/g, '') || q) ||
      (r.numero_nf || '').includes(q) ||
      r.chave_acesso.includes(q)
    );
  });

  const totalFiltered = filtered.reduce((s, r) => s + (r.valor_total || 0), 0);

  // ── Não habilitado ─────────────────────────────────────────────────────────
  if (!loading && config && !config.nf_recebidas_enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Inbox className="w-12 h-12 text-gray-300 dark:text-gray-600" />
        <p className="font-bold text-gray-600 dark:text-gray-300">Consulta de NF recebidas desabilitada</p>
        <p className="text-sm text-gray-400 max-w-md">
          Habilite em <span className="font-semibold">Configurações → NF-e / NFS-e → aba "Receber NF"</span>.
          A consulta usa o CNPJ e o Certificado A1 já cadastrados.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por fornecedor, CNPJ, número ou chave…"
            className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={situacaoFilter}
          onChange={e => setSituacaoFilter(e.target.value)}
          className="px-3 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300"
        >
          <option value="">Todas as situações</option>
          <option value="nova">Novas</option>
          <option value="lancada">Lançadas</option>
          <option value="ignorada">Ignoradas</option>
        </select>
        <button
          onClick={handleSync}
          disabled={syncing || cooldownActive}
          title={cooldownActive ? `A SEFAZ exige 1 hora de espera entre consultas sem documentos novos (~${cooldownMinutes} min restantes)` : undefined}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {syncing ? 'Consultando SEFAZ…' : cooldownActive ? `Aguarde ~${cooldownMinutes} min (SEFAZ)` : 'Buscar novas notas'}
        </button>
      </div>

      {/* Mensagens */}
      {message && (
        <div className={`p-3 rounded-xl flex items-center gap-3 text-sm border ${
          message.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <p className="flex-1">{message.text}</p>
          <button onClick={() => setMessage(null)} className="font-bold">OK</button>
        </div>
      )}

      {/* Resumo */}
      {!loading && filtered.length > 0 && (
        <p className="text-xs text-gray-500">
          {filtered.length} nota(s) · Total: <span className="font-bold">R$ {totalFiltered.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          {config?.dfe_ultima_consulta && (
            <> · Última consulta: {new Date(config.dfe_ultima_consulta).toLocaleString('pt-BR')}</>
          )}
        </p>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-6 h-6 mr-2 animate-spin" /> Carregando notas recebidas…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <Inbox className="w-12 h-12 text-gray-300 dark:text-gray-600" />
          <p className="font-bold text-gray-600 dark:text-gray-300">Nenhuma nota recebida</p>
          <p className="text-sm text-gray-400 max-w-md">
            Clique em "Buscar novas notas" para consultar na SEFAZ as NF-e emitidas contra o CNPJ da empresa.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(nf => {
            const badge = SITUACAO_BADGE[nf.situacao];
            return (
              <div
                key={nf.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 flex flex-col md:flex-row md:items-center gap-3"
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg shrink-0">
                    <FileText className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm text-gray-900 dark:text-white truncate">
                        {nf.emitente_nome || 'Emitente não identificado'}
                      </p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
                      {nf.tipo === 'resumo' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                          Resumo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      CNPJ {formatCnpj(nf.emitente_cnpj)}
                      {nf.numero_nf && <> · NF {nf.numero_nf}{nf.serie ? `/${nf.serie}` : ''}</>}
                      {nf.data_emissao && <> · {new Date(nf.data_emissao).toLocaleDateString('pt-BR')}</>}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono truncate mt-0.5" title={nf.chave_acesso}>
                      {nf.chave_acesso}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 md:gap-3 shrink-0 flex-wrap">
                  <p className="font-extrabold text-gray-900 dark:text-white text-sm mr-1">
                    {nf.valor_total != null
                      ? `R$ ${nf.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                      : '—'}
                  </p>

                  <button
                    onClick={() => handleDownloadXml(nf)}
                    disabled={!nf.xml}
                    title="Baixar XML"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-3.5 h-3.5" /> XML
                  </button>

                  <button
                    onClick={() => handleLancarCompra(nf)}
                    disabled={!nf.xml || nf.tipo !== 'completa' || nf.situacao === 'lancada'}
                    title={
                      nf.situacao === 'lancada'
                        ? 'Nota já lançada como compra'
                        : nf.tipo !== 'completa'
                        ? 'XML resumido — a nota completa ainda não foi disponibilizada pela SEFAZ'
                        : 'Lançar como compra com os dados do XML'
                    }
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" /> Lançar compra
                  </button>

                  {nf.situacao === 'ignorada' ? (
                    <button
                      onClick={() => handleSituacao(nf, 'nova')}
                      title="Restaurar nota"
                      className="p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  ) : nf.situacao === 'nova' ? (
                    <button
                      onClick={() => handleSituacao(nf, 'ignorada')}
                      title="Ignorar nota"
                      className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <EyeOff className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NFRecebidasTab;
