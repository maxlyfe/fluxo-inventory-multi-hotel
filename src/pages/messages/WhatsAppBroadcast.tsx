// src/pages/messages/WhatsAppBroadcast.tsx
// Disparos em massa via WhatsApp — seleciona destinatários, escolhe template, envia e rastreia progresso

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Radio, Users, Tag, Phone, Search, ChevronDown, ChevronUp,
  Send, CheckCircle2, XCircle, Loader2, AlertCircle, Clock,
  Filter, RefreshCw, History, MessageSquare, Building2,
  CheckSquare, Square, Info, X, Plus, FileSpreadsheet, Download, Upload, Image as ImageIcon
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { supabase } from '../../lib/supabase';
import { waInboxService, WaLabel, WaConversation } from '../../lib/whatsappService';
import { whatsappService, WhatsAppConfig, formatWhatsAppNumber, isValidWhatsAppNumber } from '../../lib/whatsappService';
import { downloadTemplate, parseContactsWorkbook, ImportSummary } from '../../lib/broadcastImport';
import {
  broadcastService, isBroadcastStale, pendingTargets,
  BroadcastRow, BroadcastTargetState, BroadcastParam, BroadcastStatus, OutboundActivity,
} from '../../lib/broadcastService';
import { useRealtimeSubscription } from '../../hooks/useRealtime';
import { MessagesHeader, EmptyState, SkeletonRows } from './MessagesUI';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BroadcastTarget {
  phone: string;
  name: string;
  conversationId?: string;
}

interface BroadcastResult {
  phone: string;
  name: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string;
  waMessageId?: string;
}

interface TemplateParam {
  key: string;
  value: string;
}

interface BroadcastRecord {
  id: string;
  hotel_id: string;
  template_name: string;
  total: number;
  sent: number;
  failed: number;
  params: TemplateParam[];
  targets: BroadcastResult[];
  provider: string | null;
  body_text: string | null;
  image_name: string | null;
  status: BroadcastStatus;
  created_at: string;
  created_by: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendente',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  sent:    { label: 'Enviado',   cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  failed:  { label: 'Falhou',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

/** Interpola {{1}}, {{2}}... com os parâmetros preenchidos */
function renderBody(body: string, params: BroadcastParam[]): string {
  const values = params.filter(p => p.value.trim()).map(p => p.value);
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, idx) => values[Number(idx) - 1] ?? m);
}

/** Percentual concluido de uma lista de destinatarios */
function calcProgress(list: BroadcastTargetState[]): number {
  if (list.length === 0) return 0;
  const feitos = list.filter(t => t.status !== 'pending').length;
  return Math.round((feitos / list.length) * 100);
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'sent')    return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'failed')  return <XCircle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface TargetSelectorProps {
  hotelId: string;
  selected: BroadcastTarget[];
  onChange: (targets: BroadcastTarget[]) => void;
  labels: WaLabel[];
}

function TargetSelector({ hotelId, selected, onChange, labels }: TargetSelectorProps) {
  const [tab, setTab] = useState<'contacts' | 'conversations' | 'manual' | 'import'>('conversations');
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState<string>('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await waInboxService.getConversations(hotelId, {
        status: 'open',
        search: search || undefined,
        labelId: labelFilter || undefined,
      });
      setConversations(data);
    } finally {
      setLoading(false);
    }
  }, [hotelId, search, labelFilter]);

  useEffect(() => {
    if (tab === 'conversations') loadConversations();
  }, [tab, loadConversations]);

  const isSelected = (phone: string) => selected.some(t => t.phone === phone);

  const toggle = (target: BroadcastTarget) => {
    if (isSelected(target.phone)) {
      onChange(selected.filter(t => t.phone !== target.phone));
    } else {
      onChange([...selected, target]);
    }
  };

  const toggleAll = () => {
    const available = conversations.map(c => ({
      phone: c.contact_phone,
      name: c.contact_name || c.contact_phone,
      conversationId: c.id,
    }));
    const allSelected = available.every(a => isSelected(a.phone));
    if (allSelected) {
      onChange(selected.filter(s => !available.some(a => a.phone === s.phone)));
    } else {
      const toAdd = available.filter(a => !isSelected(a.phone));
      onChange([...selected, ...toAdd]);
    }
  };

  /**
   * Lê a planilha e já soma os contatos à seleção. Os númaros que a lista
   * traz repetidos, ou que já estavam selecionados, entram uma vez só — quem
   * decide isso é o parser, que recebe a seleção atual.
   */
  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError(null);
    setImportSummary(null);

    try {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
        throw new Error('Formato inválido. Use .xlsx, .xls ou .csv — baixe o modelo se estiver em dúvida.');
      }
      const buffer = await file.arrayBuffer();
      const summary = parseContactsWorkbook(buffer, selected.map(t => t.phone));
      setImportSummary(summary);

      if (summary.contacts.length > 0) {
        onChange([...selected, ...summary.contacts.map(c => ({ phone: c.phone, name: c.name }))]);
      }
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Não foi possível ler a planilha.');
    } finally {
      setImporting(false);
      // Permite subir o mesmo arquivo de novo depois de corrigi-lo
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addManual = () => {
    // formatWhatsAppNumber recebe o texto cru, com o `+`: é ele que distingue
    // um número estrangeiro completo de um brasileiro sem o código do país.
    if (!isValidWhatsAppNumber(manualPhone)) return;
    const phone = formatWhatsAppNumber(manualPhone);
    const name = manualName.trim() || phone;
    if (!isSelected(phone)) {
      onChange([...selected, { phone, name }]);
    }
    setManualPhone('');
    setManualName('');
  };

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-xl">
        {[
          { key: 'conversations', label: 'Conversas abertas', icon: MessageSquare },
          { key: 'manual',        label: 'Número manual',     icon: Phone },
          { key: 'import',        label: 'Importar Excel',     icon: FileSpreadsheet },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-all
              ${tab === t.key
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Conversations tab */}
      {tab === 'conversations' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadConversations()}
                placeholder="Buscar contato..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
            {labels.length > 0 && (
              <select
                value={labelFilter}
                onChange={e => setLabelFilter(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none"
              >
                <option value="">Todas etiquetas</option>
                {labels.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-green-500" />
            </div>
          ) : (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              {/* Select all row */}
              {conversations.length > 0 && (
                <div
                  onClick={toggleAll}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-750 border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="text-green-500">
                    {conversations.every(c => isSelected(c.contact_phone))
                      ? <CheckSquare className="h-4 w-4" />
                      : <Square className="h-4 w-4 text-gray-400" />}
                  </div>
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                    Selecionar todos ({conversations.length})
                  </span>
                </div>
              )}
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                {conversations.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">
                    Nenhuma conversa aberta encontrada
                  </div>
                ) : (
                  conversations.map(conv => (
                    <div
                      key={conv.id}
                      onClick={() => toggle({ phone: conv.contact_phone, name: conv.contact_name || conv.contact_phone, conversationId: conv.id })}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <div className={`flex-shrink-0 ${isSelected(conv.contact_phone) ? 'text-green-500' : 'text-gray-300 dark:text-gray-600'}`}>
                        {isSelected(conv.contact_phone) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
                          {conv.contact_name || conv.contact_phone}
                        </p>
                        <p className="text-[10px] text-gray-400">{conv.contact_phone}</p>
                      </div>
                      {conv.labels && conv.labels.length > 0 && (
                        <div className="flex gap-1">
                          {conv.labels.slice(0, 2).map(l => (
                            <span key={l.id} className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual tab */}
      {tab === 'manual' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={manualPhone}
              onChange={e => setManualPhone(e.target.value)}
              placeholder="5511999998888 ou +54 9 351 1234567"
              className="flex-1 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <input
              value={manualName}
              onChange={e => setManualName(e.target.value)}
              placeholder="Nome (opcional)"
              className="flex-1 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <button
              onClick={addManual}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </button>
          </div>
          <p className="text-[10px] text-gray-400">
            Brasileiro pode ir sem o código do país (<code>22999476601</code>) — o 55 entra sozinho.
            Do exterior, escreva com <code>+</code> e o código do país (<code>+54 9 351 1234567</code>);
            com o <code>+</code> nada é acrescentado ao número.
          </p>
        </div>
      )}

      {/* Import tab */}
      {tab === 'import' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => downloadTemplate()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Baixar modelo
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white rounded-lg transition-colors"
            >
              {importing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Upload className="h-3.5 w-3.5" />}
              {importing ? 'Lendo planilha...' : 'Importar planilha'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>

          <p className="text-[10px] text-gray-400">
            Baixe o modelo, preencha a aba <strong>Contatos</strong> (coluna <code>telefone</code> obrigatória,
            <code> nome</code> opcional) e suba o arquivo. Número com máscara e brasileiro sem o 55 são aceitos.
            Para o exterior, escreva com <code>+</code> e o código do país.
          </p>

          {importError && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-xs text-red-700 dark:text-red-300">{importError}</span>
            </div>
          )}

          {importSummary && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 font-semibold">
                  {importSummary.contacts.length} adicionado{importSummary.contacts.length === 1 ? '' : 's'}
                </span>
                {importSummary.duplicates > 0 && (
                  <span className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    {importSummary.duplicates} repetido{importSummary.duplicates === 1 ? '' : 's'} ignorado{importSummary.duplicates === 1 ? '' : 's'}
                  </span>
                )}
                {importSummary.rejected.length > 0 && (
                  <span className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 font-semibold">
                    {importSummary.rejected.length} com problema
                  </span>
                )}
              </div>

              {importSummary.rejected.length > 0 && (
                <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
                  <div className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-[10px] font-bold text-red-700 dark:text-red-300 uppercase tracking-wide">
                    Linhas não importadas
                  </div>
                  <div className="max-h-32 overflow-y-auto divide-y divide-red-100 dark:divide-red-900/40">
                    {importSummary.rejected.map((r, i) => (
                      <div key={`${r.line}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
                        <span className="text-gray-600 dark:text-gray-300">
                          Linha {r.line}{r.value ? `: ${r.value}` : ''}
                        </span>
                        <span className="text-red-600 dark:text-red-400 flex-shrink-0">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Selected summary */}
      {selected.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <span className="text-xs font-semibold text-green-700 dark:text-green-300">
            {selected.length} destinatário{selected.length > 1 ? 's' : ''} selecionado{selected.length > 1 ? 's' : ''}
          </span>
          <button
            onClick={() => onChange([])}
            className="text-xs text-green-600 dark:text-green-400 hover:underline"
          >
            Limpar
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WhatsAppBroadcast() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  // Config
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [labels, setLabels] = useState<WaLabel[]>([]);

  // Send form
  const [targets, setTargets] = useState<BroadcastTarget[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [languageCode, setLanguageCode] = useState('pt_BR');
  const [bodyText, setBodyText] = useState('');
  const [params, setParams] = useState<TemplateParam[]>([{ key: '1', value: '' }]);
  /** Imagem anexada ao disparo: base64 puro + metadados para preview e envio */
  const [image, setImage] = useState<{ base64: string; dataUrl: string; name: string; mime: string; sizeKb: number } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<BroadcastResult[] | null>(null);
  const [progress, setProgress] = useState(0);
  /** Disparo em andamento no hotel — desta aba ou de outra */
  const [activeBroadcast, setActiveBroadcast] = useState<BroadcastRow | null>(null);
  /** Id do disparo que ESTA aba está tocando; null quando quem envia é outra */
  const [activeId, setActiveId] = useState<string | null>(null);
  const cancelRef = useRef(false);
  /** Prova de vida tirada das mensagens que realmente sairam da instancia */
  const [activity, setActivity] = useState<OutboundActivity | null>(null);

  // History
  const [history, setHistory] = useState<BroadcastRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'send' | 'history'>('send');

  /**
   * Hotel dono da configuracao de WhatsApp. Unidades do mesmo grupo podem
   * compartilhar um numero, e nesse caso tudo (conversas, etiquetas, regras)
   * fica sob o hotel de origem, porque a mensagem chega em um numero unico.
   */
  const [hotelId, setHotelId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!selectedHotel) { setHotelId(undefined); return; }
    let ativo = true;
    whatsappService.resolveConfigHotelId(selectedHotel.id)
      .then(id => { if (ativo) setHotelId(id); })
      .catch(() => { if (ativo) setHotelId(selectedHotel.id); });
    return () => { ativo = false; };
  }, [selectedHotel]);

  const isEvolution = config?.provider === 'evolution';

  /**
   * Intervalo entre envios. A Meta tem rate limit alto e previsível. O Evolution
   * roda no protocolo do WhatsApp Web, onde cadência regular e rápida é o
   * principal sinal de automação, então o intervalo é longo e aleatório.
   */
  const sendInterval = () =>
    isEvolution ? 3000 + Math.floor(Math.random() * 5000) : 300;

  /** Preview da mensagem com os parâmetros já interpolados */
  const bodyPreview = () => renderBody(bodyText, params);

  useEffect(() => {
    if (!hotelId) return;
    loadConfig();
    loadLabels();
  }, [hotelId]);

  useEffect(() => {
    if (activeTab === 'history' && hotelId) loadHistory();
  }, [activeTab, hotelId]);

  // Disparo em andamento: ao abrir a tela (ou depois de um F5), mostra o que
  // está acontecendo mesmo que quem envia seja outra aba.
  useEffect(() => {
    if (!hotelId) return;
    let ativo = true;
    broadcastService.getActive(hotelId)
      .then(row => { if (ativo) setActiveBroadcast(row); })
      .catch(() => { /* sem disparo ativo = ok */ });
    return () => { ativo = false; };
  }, [hotelId]);

  const onBroadcastChange = useCallback((payload: { new?: BroadcastRow }) => {
    const row = payload.new;
    if (!row) return;

    if (row.status === 'running') {
      setActiveBroadcast(row);
      // Quem envia é outra aba: espelha o progresso aqui também.
      if (row.id !== activeId) {
        setResults(row.targets || []);
        setProgress(calcProgress(row.targets || []));
      }
    } else if (activeBroadcast?.id === row.id) {
      setActiveBroadcast(null);
    }

    // A aba de histórico acompanha o disparo em andamento linha a linha, em vez
    // de só mostrar o resultado depois que tudo acabou.
    setHistory(prev => {
      const existe = prev.some(r => r.id === row.id);
      if (existe) return prev.map(r => (r.id === row.id ? { ...r, ...row } : r));
      return [row as unknown as BroadcastRecord, ...prev];
    });
  }, [activeId, activeBroadcast?.id]);

  useRealtimeSubscription<BroadcastRow>(
    'whatsapp_broadcasts',
    hotelId ? `hotel_id=eq.${hotelId}` : undefined,
    onBroadcastChange as never,
  );

  /**
   * O envio vive nesta aba: fechar ou recarregar mata o disparo no meio. O
   * navegador só deixa avisar, não impedir — mas o aviso é a diferença entre
   * perder 380 contatos e não perder.
   */
  useEffect(() => {
    if (!sending) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sending]);

  /**
   * Prova de vida independente da linha de disparo: conta o que saiu de verdade
   * nos últimos 15 minutos. É o único jeito de enxergar um envio disparado por
   * uma aba com a versão antiga da tela, que não grava progresso nenhum.
   */
  useEffect(() => {
    if (!hotelId) return;
    let ativo = true;

    const ler = () => {
      broadcastService.getOutboundActivity(hotelId)
        .then(a => { if (ativo) setActivity(a); })
        .catch(() => { /* silencioso: é indicador, não funcionalidade crítica */ });
    };

    ler();
    const t = window.setInterval(ler, 10_000);
    return () => { ativo = false; window.clearInterval(t); };
  }, [hotelId]);

  // Sem batimento por mais de 1 minuto, um disparo "em andamento" está morto.
  // O re-render por segundo mantém o painel honesto sem precisar de F5.
  const [, forcarTick] = useState(0);
  useEffect(() => {
    if (!activeBroadcast || sending) return;
    const t = window.setInterval(() => forcarTick(n => n + 1), 5000);
    return () => window.clearInterval(t);
  }, [activeBroadcast, sending]);

  const loadConfig = async () => {
    if (!hotelId) return;
    const cfg = await whatsappService.getConfig(hotelId);
    setConfig(cfg);
  };

  const loadLabels = async () => {
    if (!hotelId) return;
    const data = await waInboxService.getLabels(hotelId);
    setLabels(data);
  };

  const loadHistory = async () => {
    if (!hotelId) return;
    setHistoryLoading(true);
    try {
      const { data } = await supabase
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('hotel_id', hotelId)
        .order('created_at', { ascending: false })
        .limit(30);
      setHistory((data || []) as BroadcastRecord[]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const addParam = () => {
    setParams(prev => [...prev, { key: String(prev.length + 1), value: '' }]);
  };

  const removeParam = (idx: number) => {
    setParams(prev => prev.filter((_, i) => i !== idx));
  };

  const updateParam = (idx: number, value: string) => {
    setParams(prev => prev.map((p, i) => i === idx ? { ...p, value } : p));
  };

  /**
   * O Evolution recebe a imagem em base64 puro (sem o prefixo data:), igual ao
   * disparo do pedido de compra. O limite de 5 MB é o da própria mensagem de
   * mídia do WhatsApp — acima disso o envio falha contato a contato, e é muito
   * melhor barrar aqui do que descobrir no meio do lote.
   */
  const MAX_IMAGE_KB = 5 * 1024;

  const handlePickImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      addNotification('Anexe um arquivo de imagem (JPG, PNG ou WEBP).', 'error');
      return;
    }

    const sizeKb = Math.round(file.size / 1024);
    if (sizeKb > MAX_IMAGE_KB) {
      addNotification(`Imagem de ${(sizeKb / 1024).toFixed(1)} MB. O limite é 5 MB — reduza antes de enviar.`, 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
      setImage({ base64, dataUrl, name: file.name, mime: file.type, sizeKb });
    };
    reader.onerror = () => addNotification('Não foi possível ler a imagem.', 'error');
    reader.readAsDataURL(file);

    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  /**
   * Motor do disparo. Recebe a linha já criada em whatsapp_broadcasts e percorre
   * apenas os destinatários ainda pendentes — é o mesmo caminho do primeiro
   * envio e da retomada de um disparo interrompido.
   *
   * Grava o progresso a cada mensagem. Parece muita escrita, mas com 3 a 8
   * segundos entre envios o custo é irrelevante perto do que se perde quando a
   * aba morre no meio de 400 contatos.
   */
  const runBroadcast = async (row: BroadcastRow) => {
    if (!hotelId) return;

    const lista: BroadcastTargetState[] = [...(row.targets || [])];
    const bodyParams = (row.params || []).filter(p => p.value.trim()).map(p => p.value);
    const legenda = renderBody(row.body_text || '', row.params || []);

    setSending(true);
    setActiveId(row.id);
    setResults(lista);
    setProgress(calcProgress(lista));
    cancelRef.current = false;

    for (let i = 0; i < lista.length; i++) {
      if (lista[i].status !== 'pending') continue;

      if (cancelRef.current) {
        await broadcastService.saveProgress(row.id, {
          sent: lista.filter(t => t.status === 'sent').length,
          failed: lista.filter(t => t.status === 'failed').length,
          targets: lista,
        });
        await broadcastService.finish(row.id, 'canceled');
        setSending(false);
        setActiveId(null);
        setActiveBroadcast(null);
        loadHistory();
        addNotification('Disparo cancelado. Os pendentes não foram enviados.', 'info');
        return;
      }

      const t = lista[i];
      try {
        // Com imagem anexada o texto vira legenda: uma mensagem só, em vez de
        // foto e texto separados chegando fora de ordem.
        const res = image
          ? await whatsappService.sendImageBase64({
              hotelId,
              recipientPhone: t.phone,
              imageBase64: image.base64,
              caption: legenda,
              fileName: image.name,
              mimeType: image.mime,
            })
          : await whatsappService.sendTemplate({
              hotelId,
              recipientPhone: t.phone,
              templateName: row.template_name,
              languageCode,
              bodyParams: bodyParams.length > 0 ? bodyParams : undefined,
              bodyText: row.provider === 'evolution' ? (row.body_text || undefined) : undefined,
            });
        // sendTemplate devolve o erro no retorno em vez de lançar
        lista[i] = res.success
          ? { ...t, status: 'sent', waMessageId: res.messageId }
          : { ...t, status: 'failed', error: res.error || 'Erro no envio' };
      } catch (err: unknown) {
        lista[i] = { ...t, status: 'failed', error: err instanceof Error ? err.message : 'Erro desconhecido' };
      }

      const enviados = lista.filter(x => x.status === 'sent').length;
      const falhas   = lista.filter(x => x.status === 'failed').length;

      setResults([...lista]);
      setProgress(calcProgress(lista));

      // O progresso vai para o banco antes da pausa: se a aba morrer durante a
      // espera, o que já saiu está registrado.
      try {
        await broadcastService.saveProgress(row.id, { sent: enviados, failed: falhas, targets: lista });
      } catch {
        // Falha de rede na gravação não pode abortar o envio em si.
      }

      const faltam = lista.some((x, idx) => idx > i && x.status === 'pending');
      if (faltam) await new Promise(r => setTimeout(r, sendInterval()));
    }

    const enviados = lista.filter(x => x.status === 'sent').length;
    const falhas   = lista.filter(x => x.status === 'failed').length;

    await broadcastService.finish(row.id, 'completed');
    setSending(false);
    setActiveId(null);
    setActiveBroadcast(null);
    loadHistory();
    addNotification(
      `Disparo concluído: ${enviados} enviados, ${falhas} falhas.`,
      enviados > 0 ? 'success' : 'error',
    );
  };

  const handleSend = async () => {
    if (!hotelId || !config) {
      addNotification('Configure a integração WhatsApp primeiro.', 'error');
      return;
    }
    if (targets.length === 0) {
      addNotification('Selecione pelo menos um destinatário.', 'error');
      return;
    }
    if (isEvolution) {
      if (!bodyText.trim() && !image) {
        addNotification('Escreva a mensagem ou anexe uma imagem.', 'error');
        return;
      }
    } else if (image) {
      // A Meta exige mídia em URL pública e header de template aprovado; não dá
      // para mandar arquivo do disco por aqui.
      addNotification(
        'Anexo de imagem só funciona no provider Evolution. Na Meta a imagem precisa vir '
        + 'de um template aprovado com header de mídia.',
        'error',
      );
      return;
    } else if (!templateName.trim()) {
      addNotification('Informe o nome do template.', 'error');
      return;
    }

    // Um número só não pode estar em dois disparos ao mesmo tempo, e dois
    // disparos simultâneos na mesma instância é a receita para bloqueio.
    const emAndamento = await broadcastService.getActive(hotelId);
    if (emAndamento && !isBroadcastStale(emAndamento)) {
      addNotification('Já existe um disparo em andamento neste hotel. Aguarde ou cancele antes de começar outro.', 'error');
      setActiveBroadcast(emAndamento);
      return;
    }

    // No Evolution não existe template aprovado. O rótulo serve só para o histórico.
    const label = isEvolution ? (templateName.trim() || 'mensagem_livre') : templateName.trim();

    try {
      const row = await broadcastService.start({
        hotelId,
        templateName: label,
        provider: config.provider,
        bodyText: isEvolution ? bodyText : null,
        // Guarda o nome do arquivo, não a imagem: o histórico precisa dizer que
        // houve anexo, e base64 de 5 MB por linha inviabilizaria a tabela.
        imageName: image?.name || null,
        params,
        targets,
      });
      setActiveBroadcast(row);
      await runBroadcast(row);
    } catch (err: unknown) {
      setSending(false);
      addNotification(err instanceof Error ? err.message : 'Não foi possível iniciar o disparo.', 'error');
    }
  };

  /** Continua um disparo que ficou pela metade, sem reenviar quem já recebeu */
  const handleResume = async (row: BroadcastRow) => {
    if (row.image_name && !image) {
      addNotification(
        `Este disparo levava a imagem "${row.image_name}". Anexe a imagem de novo antes de retomar, `
        + 'senão quem falta receberia só o texto.',
        'error',
      );
      return;
    }
    setActiveBroadcast(row);
    await runBroadcast(row);
  };

  /** Encerra um disparo abandonado por outra aba, liberando a instância */
  const handleDiscard = async (row: BroadcastRow) => {
    await broadcastService.finish(row.id, 'interrupted');
    setActiveBroadcast(null);
    loadHistory();
    addNotification('Disparo marcado como interrompido.', 'info');
  };

  const reset = () => {
    setResults(null);
    setTargets([]);
    setImage(null);
    setTemplateName('');
    setBodyText('');
    setParams([{ key: '1', value: '' }]);
    setProgress(0);
  };

  if (!hotelId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-400">Selecione um hotel para continuar.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
      <MessagesHeader
        icon={Radio}
        tone="blue"
        title="Disparos em massa"
        subtitle="Envie a mesma mensagem para muitos contatos, um a um"
        tabs={
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
            {([['send', 'Novo disparo', Send], ['history', 'Histórico', History]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all
                  ${activeTab === key
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        }
      />

      {/* Config warning */}
      {!config && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Nenhuma configuração WhatsApp ativa para este hotel. Configure em <strong>Configurações → Integração WhatsApp</strong>.</span>
        </div>
      )}

      {/* Atividade da instância, lida das mensagens que realmente saíram.
          Aparece mesmo quando NADA está acontecendo: silêncio na tela é
          indistinguível de "sem informação", e era exatamente essa a dúvida
          de quem tinha um disparo rodando sem saber onde ele estava. */}
      {!activeBroadcast && activity && activity.count > 0 && (() => {
        const desdeUltima = activity.lastAt ? Date.now() - new Date(activity.lastAt).getTime() : Infinity;
        const enviando    = desdeUltima < 2 * 60_000;
        const lento       = enviando && (activity.paceSeconds ?? 0) > 15;

        return (
          <div className={`rounded-2xl border p-4 sm:p-5 space-y-2 ${
            enviando
              ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
          }`}>
            <div className="flex items-center gap-2.5 flex-wrap">
              {enviando ? (
                <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                </span>
              ) : (
                <Clock className="h-4 w-4 text-gray-400 flex-shrink-0" />
              )}
              <p className={`text-sm font-bold ${enviando ? 'text-blue-800 dark:text-blue-200' : 'text-gray-800 dark:text-gray-100'}`}>
                {enviando ? 'Envio acontecendo agora nesta instância' : 'Nenhum envio em andamento'}
              </p>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
              <span><strong>{activity.count}</strong> mensagens</span>
              <span><strong>{activity.contacts}</strong> contatos</span>
              {activity.paceSeconds !== null && (
                <span>ritmo <strong>~{activity.paceSeconds}s</strong> por mensagem</span>
              )}
              {activity.lastAt && (
                <span>
                  última {formatDistanceToNow(new Date(activity.lastAt), { locale: ptBR, addSuffix: true })}
                </span>
              )}
              <span className="text-gray-400">nas últimas 2 horas</span>
            </div>

            {lento && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                Bem mais lento que os 3 a 8s programados. Isso acontece quando a aba que envia fica em
                segundo plano — o navegador estrangula temporizadores de abas escondidas. Deixe aquela
                aba visível para o disparo voltar ao ritmo normal.
              </p>
            )}

            {!enviando && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                Saíram mensagens há pouco, mas nada nos últimos 2 minutos, e não há disparo registrado como
                em andamento. Se você tinha um disparo rodando, a aba que enviava não está mais ativa —
                ele parou aí. Disparos começados por esta tela ficam registrados e podem ser retomados.
              </p>
            )}

            {enviando && (
              <p className="text-[11px] text-blue-700/80 dark:text-blue-300/80 leading-relaxed">
                Se este envio não aparece com “X de Y”, ele foi começado por uma aba com a versão anterior
                da tela, que só registrava o disparo no fim. <strong>Não feche a aba que está enviando.</strong>
              </p>
            )}
          </div>
        );
      })()}

      {/* Disparo em andamento — visível em qualquer aba, sobrevive ao F5 */}
      {activeBroadcast && (() => {
        const parado   = isBroadcastStale(activeBroadcast);
        const desteTab = activeBroadcast.id === activeId && sending;
        const feitos   = activeBroadcast.sent + activeBroadcast.failed;
        const pct      = activeBroadcast.total > 0 ? Math.round((feitos / activeBroadcast.total) * 100) : 0;
        const faltam   = pendingTargets(activeBroadcast).length;

        return (
          <div className={`rounded-2xl border p-4 sm:p-5 space-y-3 ${
            parado
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800'
              : 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-800'
          }`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                {parado
                  ? <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                  : <Loader2 className="h-5 w-5 text-blue-500 animate-spin flex-shrink-0" />}
                <div>
                  <p className={`text-sm font-bold ${parado ? 'text-amber-800 dark:text-amber-200' : 'text-blue-800 dark:text-blue-200'}`}>
                    {parado ? 'Disparo interrompido' : desteTab ? 'Enviando agora' : 'Disparo em andamento em outra aba'}
                  </p>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400 font-mono">
                    {activeBroadcast.template_name}
                    {activeBroadcast.image_name && ' · com imagem'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {desteTab && (
                  <button
                    onClick={() => { cancelRef.current = true; }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Parar
                  </button>
                )}
                {parado && faltam > 0 && (
                  <button
                    onClick={() => handleResume(activeBroadcast)}
                    disabled={sending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white rounded-lg transition-colors"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Retomar ({faltam} restantes)
                  </button>
                )}
                {parado && (
                  <button
                    onClick={() => handleDiscard(activeBroadcast)}
                    className="px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition-colors"
                  >
                    Encerrar
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                <span>{feitos} de {activeBroadcast.total}</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2.5 bg-white/70 dark:bg-gray-800/70 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${parado ? 'bg-amber-400' : 'bg-blue-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-3 text-[11px]">
                <span className="text-green-600 dark:text-green-400 font-semibold">✓ {activeBroadcast.sent} enviados</span>
                {activeBroadcast.failed > 0 && (
                  <span className="text-red-500 font-semibold">✗ {activeBroadcast.failed} falhas</span>
                )}
                <span className="text-gray-500 dark:text-gray-400">⏳ {faltam} na fila</span>
                <span className="text-gray-400">
                  último sinal {formatDistanceToNow(new Date(activeBroadcast.updated_at), { locale: ptBR, addSuffix: true })}
                </span>
              </div>
            </div>

            {parado && (
              <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
                O envio roda na aba do navegador. Esta aba foi fechada ou recarregada no meio do disparo,
                então os {faltam} restantes não saíram. <strong>Retomar</strong> continua de onde parou,
                sem reenviar para quem já recebeu.
                {activeBroadcast.image_name && ' Como este disparo levava imagem, anexe o mesmo arquivo antes de retomar.'}
              </p>
            )}

            {!parado && !desteTab && (
              <p className="text-[11px] text-blue-800 dark:text-blue-200">
                Outra aba está enviando. Não feche aquela janela — este painel atualiza sozinho.
              </p>
            )}

            {desteTab && (
              <p className="text-[11px] text-blue-800 dark:text-blue-200">
                Não feche nem recarregue esta aba até terminar. O progresso fica salvo a cada envio,
                então mesmo assim dá para retomar depois.
              </p>
            )}
          </div>
        );
      })()}

      {/* Send tab */}
      {activeTab === 'send' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Recipients */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Destinatários</h2>
            </div>
            {results ? (
              // Results view
              <div className="space-y-3">
                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>Progresso</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex gap-3 text-xs">
                    <span className="text-green-600 dark:text-green-400 font-semibold">
                      ✓ {results.filter(r => r.status === 'sent').length} enviados
                    </span>
                    <span className="text-red-500 font-semibold">
                      ✗ {results.filter(r => r.status === 'failed').length} falhas
                    </span>
                    <span className="text-gray-400">
                      ⏳ {results.filter(r => r.status === 'pending').length} pendentes
                    </span>
                  </div>
                </div>
                {/* Results list */}
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                  {results.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                      <StatusIcon status={r.status} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{r.name}</p>
                        <p className="text-[10px] text-gray-400">{r.phone}</p>
                      </div>
                      {r.error && (
                        <span className="text-[10px] text-red-500 truncate max-w-[80px]" title={r.error}>
                          {r.error.slice(0, 30)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {!sending && (
                  <button
                    onClick={reset}
                    className="w-full py-2 text-xs font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Novo disparo
                  </button>
                )}
              </div>
            ) : (
              <TargetSelector
                hotelId={hotelId}
                selected={targets}
                onChange={setTargets}
                labels={labels}
              />
            )}
          </div>

          {/* Right: Template */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-gray-500" />
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">
                  {isEvolution ? 'Mensagem' : 'Template'}
                </h2>
              </div>
              {config && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
                  {isEvolution ? 'Evolution API' : 'Meta Cloud API'}
                </span>
              )}
            </div>

            {isEvolution && (
              <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  Disparo em massa pelo Evolution é o cenário de maior risco de bloqueio do número.
                  Os envios saem com intervalo aleatório de 3 a 8 segundos. Prefira lotes pequenos
                  e contatos que já conversaram com vocês.
                </p>
              </div>
            )}

            <div className="space-y-3">
              {/* Corpo da mensagem (Evolution) */}
              {isEvolution && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                    Texto da mensagem <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={bodyText}
                    onChange={e => setBodyText(e.target.value)}
                    placeholder={'Bom dia! Chegou a nova tabela de preços do {{1}}.'}
                    disabled={!!results}
                    rows={5}
                    className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 resize-y font-mono"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Use {'{{1}}'}, {'{{2}}'} para inserir os parâmetros abaixo.
                  </p>
                  {bodyText.includes('{{') && (
                    <div className="mt-2 p-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <p className="text-[10px] font-bold text-green-700 dark:text-green-400 mb-1">Prévia</p>
                      <p className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{bodyPreview()}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Imagem anexada */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Imagem (opcional)
                </label>

                {image ? (
                  <div className="flex items-center gap-3 p-2.5 border border-gray-200 dark:border-gray-600 rounded-lg">
                    <img
                      src={image.dataUrl}
                      alt="Anexo do disparo"
                      className="h-14 w-14 object-cover rounded-lg flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{image.name}</p>
                      <p className="text-[10px] text-gray-400">
                        {image.sizeKb < 1024 ? `${image.sizeKb} KB` : `${(image.sizeKb / 1024).toFixed(1)} MB`}
                      </p>
                    </div>
                    {!results && (
                      <button
                        onClick={() => setImage(null)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                        title="Remover imagem"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    disabled={!!results || !isEvolution}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    Anexar imagem
                  </button>
                )}

                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePickImage}
                  className="hidden"
                />

                <p className="text-[10px] text-gray-400 mt-1">
                  {isEvolution
                    ? 'Até 5 MB. O texto acima vai como legenda da imagem, em uma única mensagem.'
                    : 'Disponível apenas no provider Evolution — a Meta exige template aprovado com header de mídia.'}
                </p>
              </div>

              {/* Template name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  {isEvolution ? 'Rótulo do disparo' : 'Nome do template'}
                  {!isEvolution && <span className="text-red-400"> *</span>}
                </label>
                <input
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder={isEvolution ? 'ex: tabela_precos_julho' : 'ex: budget_link_single'}
                  disabled={!!results}
                  className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                />
                {isEvolution && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    Serve apenas para identificar o disparo no histórico.
                  </p>
                )}
              </div>

              {/* Language */}
              {!isEvolution && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                    Idioma
                  </label>
                  <select
                    value={languageCode}
                    onChange={e => setLanguageCode(e.target.value)}
                    disabled={!!results}
                    className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none disabled:opacity-50"
                  >
                    <option value="pt_BR">Português (Brasil)</option>
                    <option value="en_US">English (US)</option>
                    <option value="es">Español</option>
                  </select>
                </div>
              )}

              {/* Body params */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                    Parâmetros do corpo
                  </label>
                  {!results && (
                    <button
                      onClick={addParam}
                      className="flex items-center gap-0.5 text-[10px] font-bold text-blue-500 hover:text-blue-600"
                    >
                      <Plus className="h-3 w-3" /> Adicionar
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {params.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[10px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-md">
                        {`{{${i + 1}}}`}
                      </span>
                      <input
                        value={p.value}
                        onChange={e => updateParam(i, e.target.value)}
                        placeholder={`Valor do parâmetro ${i + 1}`}
                        disabled={!!results}
                        className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                      />
                      {!results && params.length > 1 && (
                        <button onClick={() => removeParam(i)} className="text-red-400 hover:text-red-600">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] text-gray-400 flex items-start gap-1">
                  <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  {isEvolution
                    ? <>Os parâmetros substituem {`{{1}}`}, {`{{2}}`}... no texto da mensagem acima.</>
                    : <>Os parâmetros substituem {`{{1}}`}, {`{{2}}`}... no corpo do template aprovado na Meta.</>}
                </p>
              </div>
            </div>

            {/* Send button */}
            {!results && (
              <button
                onClick={handleSend}
                disabled={
                  sending || !config || targets.length === 0 ||
                  (isEvolution ? !bodyText.trim() : !templateName.trim())
                }
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando... {progress}%
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Disparar para {targets.length} contato{targets.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* History tab */}
      {activeTab === 'history' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Histórico de disparos</h2>
            <button
              onClick={loadHistory}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </button>
          </div>

          {historyLoading ? (
            <div className="p-5">
              <SkeletonRows rows={4} />
            </div>
          ) : history.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nenhum disparo registrado"
              hint="Os disparos aparecem aqui assim que começam, com o progresso ao vivo e o resultado contato a contato."
            />
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {history.map(rec => (
                <div key={rec.id}>
                  <button
                    onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-gray-900 dark:text-white font-mono">
                          {rec.template_name}
                        </span>
                        <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded-full">
                          {rec.total} dest.
                        </span>
                        {rec.status && rec.status !== 'completed' && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                            rec.status === 'running'
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300'
                              : rec.status === 'canceled'
                                ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300'
                                : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                          }`}>
                            {rec.status === 'running' ? 'em andamento' : rec.status === 'canceled' ? 'cancelado' : 'interrompido'}
                          </span>
                        )}
                        {rec.image_name && (
                          <span
                            className="flex items-center gap-1 text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full"
                            title={rec.image_name}
                          >
                            <ImageIcon className="h-2.5 w-2.5" />
                            com imagem
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-green-600 dark:text-green-400 font-semibold">
                          ✓ {rec.sent} enviados
                        </span>
                        {rec.failed > 0 && (
                          <span className="text-[10px] text-red-500 font-semibold">
                            ✗ {rec.failed} falhas
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400">
                          {format(new Date(rec.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </span>
                      </div>

                      {/* Barra ao vivo: enquanto o disparo corre, a linha do
                          histórico avança junto, sem precisar recarregar. */}
                      {rec.status === 'running' && (
                        <div className="mt-1.5 space-y-1">
                          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all duration-500"
                              style={{ width: `${rec.total > 0 ? Math.round(((rec.sent + rec.failed) / rec.total) * 100) : 0}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-blue-600 dark:text-blue-300 font-semibold">
                            {rec.sent + rec.failed} de {rec.total} · {rec.total - rec.sent - rec.failed} na fila
                          </span>
                        </div>
                      )}
                    </div>
                    {expandedId === rec.id ? (
                      <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    )}
                  </button>
                  {expandedId === rec.id && (
                    <div className="px-5 pb-4 space-y-2">
                      {rec.params && rec.params.length > 0 && rec.params.some(p => p.value) && (
                        <div className="flex flex-wrap gap-1.5">
                          {rec.params.filter(p => p.value).map((p, i) => (
                            <span key={i} className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                              {`{{${p.key}}}`} = {p.value}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {(rec.targets || []).map((t, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <StatusIcon status={t.status} />
                            <span className="font-medium text-gray-800 dark:text-gray-200">{t.name}</span>
                            <span className="text-gray-400">{t.phone}</span>
                            {t.error && (
                              <span className="text-red-400 text-[10px]">{t.error.slice(0, 40)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
