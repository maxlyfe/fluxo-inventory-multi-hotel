// src/components/nf/NFRecebidasTab.tsx
// Aba "NF Recebidas" do Financeiro — lista NF-e emitidas contra o CNPJ do hotel
// (sincronizadas via Distribuição DF-e), com download do XML e lançamento em compra.

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox, RefreshCw, Search, Download, ShoppingCart, EyeOff, RotateCcw,
  Loader2, AlertCircle, CheckCircle, FileText, Bell, CheckCheck, XCircle, HelpCircle,
  ChevronDown, ChevronUp, Package, CreditCard, Building2, Hash, MapPin, Calendar,
  FileArchive,
} from 'lucide-react';
import { nfService } from '../../lib/nfService';
import NFExportXmlModal from './NFExportXmlModal';
import type { NFReceived, NFHotelConfig, TipoManifestacao } from '../../types/nf';

interface Props {
  hotelId: string;
}

const SITUACAO_BADGE: Record<NFReceived['situacao'], { label: string; cls: string }> = {
  nova:     { label: 'Nova',      cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  lancada:  { label: 'Lançada',   cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  ignorada: { label: 'Ignorada',  cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
};

const MANIFESTACAO_BADGE: Record<string, { label: string; cls: string }> = {
  '210210': { label: 'Ciência',            cls: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' },
  '210200': { label: 'Confirmada',         cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  '210220': { label: 'Desconhecida',       cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  '210240': { label: 'Op. não Realizada',  cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' },
};

function formatCnpj(cnpj: string | null): string {
  const d = (cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return cnpj || '—';
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDateBR(iso: string | null | undefined) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// ── XML Detail Parser ────────────────────────────────────────────────────────

function xmlText(parent: Element | Document, tag: string): string {
  const el = parent.getElementsByTagName(tag)[0]
    ?? parent.getElementsByTagNameNS('http://www.portalfiscal.inf.br/nfe', tag)[0];
  return el?.textContent?.trim() ?? '';
}

interface NFeDetail {
  emit: { nome: string; fantasia: string; cnpj: string; ie: string; uf: string; municipio: string; endereco: string; cep: string };
  ide: { nNF: string; serie: string; dhEmi: string; natOp: string; tpNF: string; modFrete: string };
  items: { nItem: number; xProd: string; cEAN: string; ncm: string; cfop: string; uCom: string; qCom: number; vUnCom: number; vProd: number; ibs: number; cbs: number }[];
  totais: { vProd: number; vFrete: number; vSeg: number; vDesc: number; vOutro: number; vNF: number; vICMS: number; vPIS: number; vCOFINS: number; vIPI: number; vIBS: number; vCBS: number };
  dups: { nDup: string; dVenc: string; vDup: number }[];
  infAdic: string;
  transp: { nome: string; cnpj: string };
}

function parseNFeDetail(xml: string): NFeDetail | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return null;

    const emitEl = doc.getElementsByTagName('emit')[0];
    const enderEmit = emitEl?.getElementsByTagName('enderEmit')[0];
    const emit = {
      nome: xmlText(doc, 'xNome'),
      fantasia: emitEl ? xmlText(emitEl, 'xFant') : '',
      cnpj: emitEl ? xmlText(emitEl, 'CNPJ') : '',
      ie: emitEl ? xmlText(emitEl, 'IE') : '',
      uf: enderEmit ? xmlText(enderEmit, 'UF') : '',
      municipio: enderEmit ? xmlText(enderEmit, 'xMun') : '',
      endereco: enderEmit ? `${xmlText(enderEmit, 'xLgr')}, ${xmlText(enderEmit, 'nro')}${xmlText(enderEmit, 'xCpl') ? ' - ' + xmlText(enderEmit, 'xCpl') : ''}, ${xmlText(enderEmit, 'xBairro')}` : '',
      cep: enderEmit ? xmlText(enderEmit, 'CEP').replace(/(\d{5})(\d{3})/, '$1-$2') : '',
    };

    const ide = {
      nNF: xmlText(doc, 'nNF'),
      serie: xmlText(doc, 'serie'),
      dhEmi: xmlText(doc, 'dhEmi') || xmlText(doc, 'dEmi'),
      natOp: xmlText(doc, 'natOp'),
      tpNF: xmlText(doc, 'tpNF'),
      modFrete: xmlText(doc, 'modFrete'),
    };

    const detNodes = doc.getElementsByTagName('det');
    const items = Array.from(detNodes).map((det, idx) => {
      const prod = det.getElementsByTagName('prod')[0];
      if (!prod) return null;
      const imposto = det.getElementsByTagName('imposto')[0];
      return {
        nItem: idx + 1,
        xProd: xmlText(prod, 'xProd'),
        cEAN: xmlText(prod, 'cEAN'),
        ncm: xmlText(prod, 'NCM'),
        cfop: xmlText(prod, 'CFOP'),
        uCom: xmlText(prod, 'uCom') || xmlText(prod, 'uTrib'),
        qCom: parseFloat(xmlText(prod, 'qCom') || '0'),
        vUnCom: parseFloat(xmlText(prod, 'vUnCom') || '0'),
        vProd: parseFloat(xmlText(prod, 'vProd') || '0'),
        ibs: imposto ? parseFloat(xmlText(imposto, 'vIBS') || '0') : 0,
        cbs: imposto ? parseFloat(xmlText(imposto, 'vCBS') || '0') : 0,
      };
    }).filter(Boolean) as NFeDetail['items'];

    const totalEl = doc.getElementsByTagName('ICMSTot')[0];
    const totais = {
      vProd: parseFloat(totalEl ? xmlText(totalEl, 'vProd') : '0'),
      vFrete: parseFloat(totalEl ? xmlText(totalEl, 'vFrete') : '0'),
      vSeg: parseFloat(totalEl ? xmlText(totalEl, 'vSeg') : '0'),
      vDesc: parseFloat(totalEl ? xmlText(totalEl, 'vDesc') : '0'),
      vOutro: parseFloat(totalEl ? xmlText(totalEl, 'vOutro') : '0'),
      vNF: parseFloat(totalEl ? xmlText(totalEl, 'vNF') : '0'),
      vICMS: parseFloat(totalEl ? xmlText(totalEl, 'vICMS') : '0'),
      vPIS: parseFloat(totalEl ? xmlText(totalEl, 'vPIS') : '0'),
      vCOFINS: parseFloat(totalEl ? xmlText(totalEl, 'vCOFINS') : '0'),
      vIPI: parseFloat(totalEl ? xmlText(totalEl, 'vIPI') : '0'),
      vIBS: parseFloat(totalEl ? xmlText(totalEl, 'vIBS') : '0'),
      vCBS: parseFloat(totalEl ? xmlText(totalEl, 'vCBS') : '0'),
    };

    const dupNodes = doc.getElementsByTagName('dup');
    const dups = Array.from(dupNodes).map(dup => ({
      nDup: xmlText(dup, 'nDup'),
      dVenc: xmlText(dup, 'dVenc'),
      vDup: parseFloat(xmlText(dup, 'vDup') || '0'),
    })).filter(d => d.dVenc);

    const infAdic = xmlText(doc, 'infCpl');
    const transpEl = doc.getElementsByTagName('transporta')[0];
    const transp = {
      nome: transpEl ? xmlText(transpEl, 'xNome') : '',
      cnpj: transpEl ? xmlText(transpEl, 'CNPJ') : '',
    };

    return { emit, ide, items, totais, dups, infAdic, transp };
  } catch {
    return null;
  }
}

const FRETE_LABELS: Record<string, string> = {
  '0': 'Emitente', '1': 'Destinatário', '2': 'Terceiros', '9': 'Sem frete',
};

// ── Expanded Detail Panel ────────────────────────────────────────────────────

function NFDetailPanel({ nf }: { nf: NFReceived }) {
  const detail = nf.xml ? parseNFeDetail(nf.xml) : null;

  if (!detail) {
    return (
      <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
        <p className="font-medium">XML completo indisponível</p>
        <p className="text-xs mt-1">Envie a "Ciência da Operação" para que a SEFAZ libere o XML completo na próxima sincronização.</p>
      </div>
    );
  }

  const { emit, ide, items, totais, dups, infAdic, transp } = detail;

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
      {/* ── Header: Emitter + NF Info ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-gray-200 dark:bg-gray-700">
        {/* Emitente */}
        <div className="bg-white dark:bg-gray-800 p-4 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Emitente</h4>
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{emit.nome}</p>
          {emit.fantasia && emit.fantasia !== emit.nome && (
            <p className="text-xs text-gray-500 dark:text-gray-400">Nome fantasia: {emit.fantasia}</p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
            <span><span className="text-gray-400">CNPJ:</span> {formatCnpj(emit.cnpj)}</span>
            <span><span className="text-gray-400">IE:</span> {emit.ie || '—'}</span>
            {emit.endereco && <span className="col-span-2"><span className="text-gray-400">Endereço:</span> {emit.endereco}</span>}
            <span><span className="text-gray-400">Município:</span> {emit.municipio}/{emit.uf}</span>
            {emit.cep && <span><span className="text-gray-400">CEP:</span> {emit.cep}</span>}
          </div>
        </div>

        {/* Dados da NF */}
        <div className="bg-white dark:bg-gray-800 p-4 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
              <Hash className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Dados da Nota</h4>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-gray-300">
            <span><span className="text-gray-400">Número:</span> <span className="font-semibold text-gray-900 dark:text-white">{ide.nNF}</span>{ide.serie ? ` / série ${ide.serie}` : ''}</span>
            <span><span className="text-gray-400">Emissão:</span> {fmtDateBR(ide.dhEmi)}</span>
            <span className="col-span-2"><span className="text-gray-400">Nat. Operação:</span> {ide.natOp || '—'}</span>
            <span><span className="text-gray-400">Frete:</span> {FRETE_LABELS[ide.modFrete] ?? ide.modFrete ?? '—'}</span>
            {transp.nome && <span><span className="text-gray-400">Transportadora:</span> {transp.nome}</span>}
          </div>
          <p className="text-[10px] text-gray-400 font-mono break-all pt-1" title="Chave de acesso">{nf.chave_acesso}</p>
        </div>
      </div>

      {/* ── Items Table ── */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
            <Package className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Itens ({items.length})
          </h4>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-2 w-8">#</th>
                <th className="text-left px-3 py-2">Produto</th>
                <th className="text-left px-3 py-2 w-20">NCM</th>
                <th className="text-left px-3 py-2 w-14">CFOP</th>
                <th className="text-right px-3 py-2 w-14">Qtd</th>
                <th className="text-left px-3 py-2 w-10">Un</th>
                <th className="text-right px-3 py-2 w-24">Unit.</th>
                <th className="text-right px-3 py-2 w-24">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map(it => (
                <tr key={it.nItem} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-3 py-2 text-gray-400 font-mono">{it.nItem}</td>
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium">
                    {it.xProd}
                    {it.cEAN && it.cEAN !== 'SEM GTIN' && (
                      <span className="text-[10px] text-gray-400 ml-1.5 font-mono">EAN {it.cEAN}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500 font-mono">{it.ncm}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono">{it.cfop}</td>
                  <td className="px-3 py-2 text-right font-mono">{it.qCom.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
                  <td className="px-3 py-2 text-gray-500">{it.uCom}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtBRL(it.vUnCom)}</td>
                  <td className="px-3 py-2 text-right font-semibold font-mono">{fmtBRL(it.vProd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Totais + Cobrança ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-gray-200 dark:bg-gray-700">
        {/* Totais */}
        <div className="bg-white dark:bg-gray-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <CreditCard className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Totais</h4>
          </div>
          <div className="space-y-1 text-xs">
            {[
              ['Produtos', totais.vProd],
              ['Frete', totais.vFrete],
              ['Seguro', totais.vSeg],
              ['Outras despesas', totais.vOutro],
              ['Desconto', totais.vDesc],
            ].filter(([, v]) => (v as number) > 0).map(([label, val]) => (
              <div key={label as string} className="flex justify-between text-gray-600 dark:text-gray-300">
                <span>{label}</span><span className="font-mono">{fmtBRL(val as number)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700 font-bold text-sm text-gray-900 dark:text-white">
              <span>Total NF-e</span><span className="font-mono">{fmtBRL(totais.vNF)}</span>
            </div>
            {/* Tax summary */}
            {(totais.vICMS > 0 || totais.vPIS > 0 || totais.vCOFINS > 0 || totais.vIPI > 0 || totais.vIBS > 0 || totais.vCBS > 0) && (
              <div className="pt-2 mt-2 border-t border-dashed border-gray-200 dark:border-gray-700 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Impostos destacados</p>
                {[
                  ['ICMS', totais.vICMS], ['PIS', totais.vPIS], ['COFINS', totais.vCOFINS],
                  ['IPI', totais.vIPI], ['IBS', totais.vIBS], ['CBS', totais.vCBS],
                ].filter(([, v]) => (v as number) > 0).map(([label, val]) => (
                  <div key={label as string} className="flex justify-between text-gray-500 dark:text-gray-400">
                    <span>{label}</span><span className="font-mono">{fmtBRL(val as number)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cobrança / Duplicatas */}
        <div className="bg-white dark:bg-gray-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
              <Calendar className="w-4 h-4 text-orange-600 dark:text-orange-400" />
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Cobrança {dups.length > 0 && `(${dups.length} parcela${dups.length > 1 ? 's' : ''})`}
            </h4>
          </div>
          {dups.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Sem dados de cobrança na NF-e.</p>
          ) : (
            <div className="space-y-1.5">
              {dups.map((d, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-700 dark:text-orange-400 font-bold text-[10px]">
                      {d.nDup || (i + 1)}
                    </span>
                    <span className="text-gray-600 dark:text-gray-300">{fmtDateBR(d.dVenc)}</span>
                  </div>
                  <span className="font-semibold text-gray-900 dark:text-white font-mono">{fmtBRL(d.vDup)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Inf. adicional */}
          {infAdic && (
            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Informações Adicionais</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-line break-words max-h-32 overflow-y-auto leading-relaxed">
                {infAdic}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
  const [manifestando, setManifestando] = useState<Record<string, boolean>>({});
  const [justModal, setJustModal] = useState<{ nfId: string; chave: string } | null>(null);
  const [justText, setJustText] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

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
      // Vínculo retroativo: casa notas "novas" com compras já registradas
      // no histórico (nº da NF + CNPJ do fornecedor) antes de listar.
      const linked = await nfService.linkReceivedToPurchases(hotelId).catch(err => {
        console.error('[NFRecebidas] linkReceivedToPurchases:', err);
        return 0;
      });
      const [cfg, data] = await Promise.all([
        nfService.getConfig(hotelId),
        nfService.getReceivedNFs(hotelId),
      ]);
      setConfig(cfg);
      setRows(data);
      if (linked > 0) {
        setMessage({ type: 'success', text: `${linked} nota(s) vinculada(s) a compras já registradas no histórico.` });
      }
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

  async function handleManifestar(nf: NFReceived, tipo: TipoManifestacao, xJust?: string) {
    setManifestando(prev => ({ ...prev, [nf.id]: true }));
    try {
      const result = await nfService.manifestarNFe(hotelId, nf.chave_acesso, tipo, xJust);
      if (result.success) {
        setRows(prev => prev.map(r =>
          r.id === nf.id ? { ...r, manifestacao: tipo, manifestacao_at: new Date().toISOString() } : r
        ));
        setMessage({ type: 'success', text: result.message });
        if (tipo === '210210') {
          setMessage({
            type: 'success',
            text: `${result.message} — O XML completo será disponibilizado na próxima sincronização.`,
          });
        }
      } else {
        setMessage({ type: 'error', text: result.message });
      }
    } catch {
      setMessage({ type: 'error', text: 'Erro ao enviar manifestação.' });
    } finally {
      setManifestando(prev => ({ ...prev, [nf.id]: false }));
    }
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
          onClick={() => setShowExportModal(true)}
          disabled={rows.length === 0}
          title="Exportar XMLs em lote (.zip)"
          className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 rounded-lg font-bold text-sm transition-all hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <FileArchive className="w-4 h-4" />
          Exportar XMLs
        </button>
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
            const isExpanded = expandedId === nf.id;
            return (
              <div
                key={nf.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden"
              >
                <div className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div
                  className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer group"
                  onClick={() => setExpandedId(isExpanded ? null : nf.id)}
                >
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg shrink-0 relative">
                    <FileText className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    <div className="absolute -bottom-0.5 -right-0.5 bg-white dark:bg-gray-800 rounded-full">
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                        : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                      }
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {nf.emitente_nome || 'Emitente não identificado'}
                      </p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
                      {nf.tipo === 'resumo' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                          Resumo
                        </span>
                      )}
                      {nf.manifestacao && MANIFESTACAO_BADGE[nf.manifestacao] && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${MANIFESTACAO_BADGE[nf.manifestacao].cls}`}>
                          {MANIFESTACAO_BADGE[nf.manifestacao].label}
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

                  {/* Manifestação */}
                  {!nf.manifestacao && (
                    <button
                      onClick={() => handleManifestar(nf, '210210')}
                      disabled={manifestando[nf.id]}
                      title="Enviar Ciência da Operação para liberar o download do XML completo"
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        nf.tipo === 'resumo'
                          ? 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-sm'
                          : 'border border-yellow-400 dark:border-yellow-600 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                      }`}
                    >
                      {manifestando[nf.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
                      Ciência
                    </button>
                  )}
                  {nf.manifestacao === '210210' && (
                    <>
                      <button
                        onClick={() => handleManifestar(nf, '210200')}
                        disabled={manifestando[nf.id]}
                        title="Confirmar operação"
                        className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-green-300 dark:border-green-700 text-xs font-bold text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                      >
                        {manifestando[nf.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                        Confirmar
                      </button>
                      <button
                        onClick={() => handleManifestar(nf, '210220')}
                        disabled={manifestando[nf.id]}
                        title="Desconhecer operação"
                        className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-red-300 dark:border-red-700 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Desconhecer
                      </button>
                      <button
                        onClick={() => { setJustModal({ nfId: nf.id, chave: nf.chave_acesso }); setJustText(''); }}
                        disabled={manifestando[nf.id]}
                        title="Operação não realizada (requer justificativa)"
                        className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        Não realiz.
                      </button>
                    </>
                  )}

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
                    className={
                      nf.situacao === 'lancada'
                        ? 'flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold cursor-default'
                        : 'flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
                    }
                  >
                    {nf.situacao === 'lancada'
                      ? <><CheckCircle className="w-3.5 h-3.5" /> Compra lançada</>
                      : <><ShoppingCart className="w-3.5 h-3.5" /> Lançar compra</>}
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
                {isExpanded && <NFDetailPanel nf={nf} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de exportação em lote de XMLs */}
      {showExportModal && (
        <NFExportXmlModal rows={rows} onClose={() => setShowExportModal(false)} />
      )}

      {/* Modal de justificativa para Op. não Realizada (210240) */}
      {justModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-gray-900 dark:text-white">Operação não Realizada</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Informe a justificativa (15 a 255 caracteres):
            </p>
            <textarea
              value={justText}
              onChange={e => setJustText(e.target.value)}
              maxLength={255}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ex.: Mercadoria não recebida, NF emitida por engano…"
            />
            <p className="text-xs text-gray-400">{justText.length}/255 caracteres</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setJustModal(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const nf = rows.find(r => r.id === justModal.nfId);
                  if (nf) {
                    handleManifestar(nf, '210240', justText);
                    setJustModal(null);
                  }
                }}
                disabled={justText.length < 15}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NFRecebidasTab;
