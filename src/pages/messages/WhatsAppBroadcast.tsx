// src/pages/messages/WhatsAppBroadcast.tsx
// Disparos em massa via WhatsApp — seleciona destinatários, escolhe template, envia e rastreia progresso

import React, { useState, useEffect, useCallback } from 'react';
import {
  Radio, Users, Tag, Phone, Search, ChevronDown, ChevronUp,
  Send, CheckCircle2, XCircle, Loader2, AlertCircle, Clock,
  Filter, RefreshCw, History, MessageSquare, Building2,
  CheckSquare, Square, Info, X, Plus
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { supabase } from '../../lib/supabase';
import { waInboxService, WaLabel, WaConversation } from '../../lib/whatsappService';
import { whatsappService, WhatsAppConfig } from '../../lib/whatsappService';

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
  created_at: string;
  created_by: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendente',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  sent:    { label: 'Enviado',   cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  failed:  { label: 'Falhou',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

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
  const [tab, setTab] = useState<'contacts' | 'conversations' | 'manual'>('conversations');
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState<string>('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');

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

  const addManual = () => {
    const phone = manualPhone.replace(/\D/g, '');
    if (phone.length < 10) return;
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
              placeholder="55119xxxxx (somente dígitos)"
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
            Informe o número com código do país. Ex: <code>5511999887766</code>
          </p>
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
  const [params, setParams] = useState<TemplateParam[]>([{ key: '1', value: '' }]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<BroadcastResult[] | null>(null);
  const [progress, setProgress] = useState(0);

  // History
  const [history, setHistory] = useState<BroadcastRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'send' | 'history'>('send');

  const hotelId = selectedHotel?.id;

  useEffect(() => {
    if (!hotelId) return;
    loadConfig();
    loadLabels();
  }, [hotelId]);

  useEffect(() => {
    if (activeTab === 'history' && hotelId) loadHistory();
  }, [activeTab, hotelId]);

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

  const handleSend = async () => {
    if (!hotelId || !config) {
      addNotification('Configure a integração WhatsApp primeiro.', 'error');
      return;
    }
    if (targets.length === 0) {
      addNotification('Selecione pelo menos um destinatário.', 'error');
      return;
    }
    if (!templateName.trim()) {
      addNotification('Informe o nome do template.', 'error');
      return;
    }

    setSending(true);
    setProgress(0);
    const resultsList: BroadcastResult[] = targets.map(t => ({ ...t, status: 'pending' as const }));
    setResults([...resultsList]);

    const bodyParams = params.filter(p => p.value.trim()).map(p => p.value);

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      try {
        await whatsappService.sendTemplate({
          hotelId,
          recipientPhone: t.phone,
          templateName: templateName.trim(),
          languageCode,
          bodyParams: bodyParams.length > 0 ? bodyParams : undefined,
        });
        resultsList[i] = { ...resultsList[i], status: 'sent' };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro desconhecido';
        resultsList[i] = { ...resultsList[i], status: 'failed', error: msg };
      }
      setProgress(Math.round(((i + 1) / targets.length) * 100));
      setResults([...resultsList]);
      // Small delay to avoid rate limiting
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    // Persist broadcast record
    const sentCount   = resultsList.filter(r => r.status === 'sent').length;
    const failedCount = resultsList.filter(r => r.status === 'failed').length;

    await supabase.from('whatsapp_broadcasts').insert({
      hotel_id: hotelId,
      template_name: templateName.trim(),
      total: targets.length,
      sent: sentCount,
      failed: failedCount,
      params,
      targets: resultsList,
    });

    setSending(false);
    addNotification(`Disparo concluído: ${sentCount} enviados, ${failedCount} falhas.`, sentCount > 0 ? 'success' : 'error');
  };

  const reset = () => {
    setResults(null);
    setTargets([]);
    setTemplateName('');
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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
            <Radio className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Disparos em massa</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Envie templates WhatsApp para múltiplos contatos</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-xl">
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
      </div>

      {/* Config warning */}
      {!config && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Nenhuma configuração WhatsApp ativa para este hotel. Configure em <strong>Configurações → Integração WhatsApp</strong>.</span>
        </div>
      )}

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
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Template</h2>
            </div>

            <div className="space-y-3">
              {/* Template name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Nome do template <span className="text-red-400">*</span>
                </label>
                <input
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder="ex: budget_link_single"
                  disabled={!!results}
                  className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                />
              </div>

              {/* Language */}
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
                  Os parâmetros substituem {`{{1}}`}, {`{{2}}`}... no corpo do template aprovado na Meta.
                </p>
              </div>
            </div>

            {/* Send button */}
            {!results && (
              <button
                onClick={handleSend}
                disabled={sending || !config || targets.length === 0 || !templateName.trim()}
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
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
              <History className="h-10 w-10 opacity-30" />
              <p className="text-sm">Nenhum disparo registrado</p>
            </div>
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
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
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
