// src/pages/messages/WhatsAppInbox.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  MessageCircle, Search, X, Check, CheckCheck, Clock, Tag,
  User, Users, ChevronDown, Send, Paperclip, MoreVertical,
  Phone, Archive, RefreshCw, Loader2, Plus, Trash2, Edit3,
  Bot, ArrowLeft, AlertCircle, Lock, Unlock,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { waInboxService, WaConversation, WaMessage, WaLabel, WhatsAppMessageTemplate } from '../../lib/whatsappService';
import { whatsappService } from '../../lib/whatsappService';
import { useRealtimeSubscription } from '../../hooks/useRealtime';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── helpers ──────────────────────────────────────────────────────────────────

const formatMsgTime = (iso: string) => {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Ontem';
  return format(d, 'dd/MM');
};

const formatFullTime = (iso: string) => format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

const getInitials = (name: string | null, phone: string) => {
  if (name) return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return phone.slice(-2);
};

const AVATAR_COLORS = [
  'bg-green-500', 'bg-blue-500', 'bg-violet-500', 'bg-orange-500',
  'bg-pink-500',  'bg-teal-500', 'bg-amber-500',  'bg-red-500',
];
const avatarColor = (id: string) => AVATAR_COLORS[id.charCodeAt(0) % AVATAR_COLORS.length];

// ─── StatusIcon ───────────────────────────────────────────────────────────────
const StatusIcon = ({ status }: { status: WaMessage['status'] }) => {
  if (status === 'pending') return <Clock className="w-3 h-3 text-gray-400" />;
  if (status === 'sent')    return <Check className="w-3 h-3 text-gray-400" />;
  if (status === 'delivered') return <CheckCheck className="w-3 h-3 text-gray-400" />;
  if (status === 'read')    return <CheckCheck className="w-3 h-3 text-blue-500" />;
  if (status === 'failed')  return <AlertCircle className="w-3 h-3 text-red-400" />;
  return null;
};

// ─── LabelChip ────────────────────────────────────────────────────────────────
const LabelChip = ({ label, onRemove }: { label: WaLabel; onRemove?: () => void }) => (
  <span
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
    style={{ background: label.color + '22', color: label.color, border: `1px solid ${label.color}44` }}
  >
    {label.name}
    {onRemove && (
      <button onClick={onRemove} className="hover:opacity-70 transition-opacity">
        <X className="w-2.5 h-2.5" />
      </button>
    )}
  </span>
);

// ─── DateSeparator ────────────────────────────────────────────────────────────
const DateSeparator = ({ date }: { date: string }) => (
  <div className="flex items-center gap-3 my-4">
    <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
    <span className="text-xs text-gray-400 font-semibold px-2">
      {isToday(new Date(date)) ? 'Hoje' : isYesterday(new Date(date)) ? 'Ontem' : format(new Date(date), "dd 'de' MMMM", { locale: ptBR })}
    </span>
    <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const WhatsAppInbox: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();

  // ── state ──────────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [messages, setMessages]           = useState<WaMessage[]>([]);
  const [labels, setLabels]               = useState<WaLabel[]>([]);
  const [templates, setTemplates]         = useState<WhatsAppMessageTemplate[]>([]);

  const [loading, setLoading]           = useState(true);
  const [loadingMsgs, setLoadingMsgs]   = useState(false);
  const [sending, setSending]           = useState(false);
  const [messageText, setMessageText]   = useState('');

  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed' | 'bot'>('all');
  const [labelFilter, setLabelFilter]   = useState<string | null>(null);
  const [search, setSearch]             = useState('');

  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showLabelMenu, setShowLabelMenu]       = useState(false);
  const [showMoreMenu, setShowMoreMenu]         = useState(false);
  const [showLabelManager, setShowLabelManager] = useState(false);

  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLTextAreaElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const labelMenuRef    = useRef<HTMLDivElement>(null);
  const moreMenuRef     = useRef<HTMLDivElement>(null);

  // ── selected conversation ──────────────────────────────────────────────────
  const selectedConv = useMemo(
    () => conversations.find(c => c.id === selectedId) || null,
    [conversations, selectedId],
  );

  const within24h = selectedConv ? waInboxService.isWithin24hWindow(selectedConv) : false;

  // ── load ───────────────────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    if (!selectedHotel) return;
    try {
      setLoading(true);
      const data = await waInboxService.getConversations(selectedHotel.id, {
        status: statusFilter,
        labelId: labelFilter || undefined,
        search: search || undefined,
      });
      setConversations(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, statusFilter, labelFilter, search]);

  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMsgs(true);
    try {
      const data = await waInboxService.getMessages(convId);
      setMessages(data);
      await waInboxService.markConversationRead(convId);
      setConversations(prev =>
        prev.map(c => c.id === convId ? { ...c, unread_count: 0 } : c),
      );
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  const loadLabels = useCallback(async () => {
    if (!selectedHotel) return;
    try { setLabels(await waInboxService.getLabels(selectedHotel.id)); } catch { /* noop */ }
  }, [selectedHotel]);

  const loadTemplates = useCallback(async () => {
    try { setTemplates(await whatsappService.getTemplates()); } catch { /* noop */ }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { loadLabels(); loadTemplates(); }, [loadLabels, loadTemplates]);

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
    else setMessages([]);
  }, [selectedId, loadMessages]);

  // auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── outside click for menus ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) setShowTemplateMenu(false);
      if (labelMenuRef.current    && !labelMenuRef.current.contains(e.target as Node))    setShowLabelMenu(false);
      if (moreMenuRef.current     && !moreMenuRef.current.contains(e.target as Node))     setShowMoreMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── realtime ───────────────────────────────────────────────────────────────
  const handleConvRealtime = useCallback((payload: any) => {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === payload.new.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...payload.new };
          return updated.sort((a, b) =>
            new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime(),
          );
        }
        // new conversation — reload
        loadConversations();
        return prev;
      });
    }
    if (payload.eventType === 'DELETE') {
      setConversations(prev => prev.filter(c => c.id !== payload.old?.id));
    }
  }, [loadConversations]);

  const handleMsgRealtime = useCallback((payload: any) => {
    if (payload.eventType === 'INSERT' && payload.new.conversation_id === selectedId) {
      setMessages(prev => {
        if (prev.find(m => m.id === payload.new.id)) return prev;
        return [...prev, payload.new as WaMessage];
      });
      // mark read if inbound
      if (payload.new.direction === 'inbound') {
        waInboxService.markConversationRead(selectedId!);
      }
    }
    if (payload.eventType === 'UPDATE') {
      setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m));
    }
  }, [selectedId]);

  useRealtimeSubscription<any>(
    'whatsapp_conversations',
    `hotel_id=eq.${selectedHotel?.id}`,
    handleConvRealtime,
  );
  useRealtimeSubscription<any>(
    'whatsapp_messages',
    selectedId ? `conversation_id=eq.${selectedId}` : 'id=eq.00000000-0000-0000-0000-000000000000',
    handleMsgRealtime,
  );

  // ── send ───────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!messageText.trim() || !selectedConv || !selectedHotel || sending) return;
    if (!within24h) return;
    setSending(true);
    const text = messageText.trim();
    setMessageText('');
    try {
      const res = await waInboxService.sendText({
        conversationId: selectedConv.id,
        hotelId: selectedHotel.id,
        recipientPhone: selectedConv.contact_phone,
        text,
        sentBy: user?.id,
      });
      if (!res.success) throw new Error(res.error);
    } catch (err: any) {
      setMessageText(text);
      alert(err.message || 'Erro ao enviar');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleSendTemplate = async (template: WhatsAppMessageTemplate) => {
    if (!selectedConv || !selectedHotel) return;
    setShowTemplateMenu(false);
    setSending(true);
    try {
      await waInboxService.sendTemplateFromInbox({
        conversationId: selectedConv.id,
        hotelId: selectedHotel.id,
        recipientPhone: selectedConv.contact_phone,
        templateName: template.template_name,
        languageCode: template.language_code,
        sentBy: user?.id,
      });
    } catch (err: any) {
      alert(err.message || 'Erro ao enviar template');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── label management ───────────────────────────────────────────────────────
  const handleAddLabel = async (labelId: string) => {
    if (!selectedConv) return;
    await waInboxService.addLabelToConversation(selectedConv.id, labelId);
    setShowLabelMenu(false);
    const convData = await waInboxService.getConversation(selectedConv.id);
    if (convData) setConversations(prev => prev.map(c => c.id === convData.id ? convData : c));
  };

  const handleRemoveLabel = async (labelId: string) => {
    if (!selectedConv) return;
    await waInboxService.removeLabelFromConversation(selectedConv.id, labelId);
    const convData = await waInboxService.getConversation(selectedConv.id);
    if (convData) setConversations(prev => prev.map(c => c.id === convData.id ? convData : c));
  };

  const handleUpdateStatus = async (status: WaConversation['status']) => {
    if (!selectedConv) return;
    setShowMoreMenu(false);
    await waInboxService.updateConversation(selectedConv.id, { status });
    setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, status } : c));
  };

  // ── grouped messages by date ───────────────────────────────────────────────
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: WaMessage[] }[] = [];
    for (const msg of messages) {
      const d = msg.sent_at.split('T')[0];
      const last = groups[groups.length - 1];
      if (last && last.date === d) { last.messages.push(msg); }
      else { groups.push({ date: d, messages: [msg] }); }
    }
    return groups;
  }, [messages]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-gray-50 dark:bg-gray-950">

      {/* ══ LEFT PANEL — Conversation List ══ */}
      <div className="w-80 xl:w-96 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col shrink-0">

        {/* Header */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-green-500 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-base font-black text-gray-900 dark:text-white">Mensagens</h1>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowLabelManager(true)}
                title="Gerenciar etiquetas"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Tag className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={loadConversations}
                title="Recarregar"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar conversas..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-800 dark:text-gray-100 placeholder-gray-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            )}
          </div>

          {/* Status filter tabs */}
          <div className="flex gap-1">
            {(['all', 'open', 'closed', 'bot'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${
                  statusFilter === s
                    ? 'bg-green-500 text-white'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {s === 'all' ? 'Todas' : s === 'open' ? 'Abertas' : s === 'closed' ? 'Fechadas' : 'Bot'}
              </button>
            ))}
          </div>

          {/* Label filters */}
          {labels.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {labels.map(lbl => (
                <button
                  key={lbl.id}
                  onClick={() => setLabelFilter(labelFilter === lbl.id ? null : lbl.id)}
                  className="px-2 py-0.5 rounded-full text-xs font-semibold border transition-all"
                  style={
                    labelFilter === lbl.id
                      ? { background: lbl.color, color: '#fff', borderColor: lbl.color }
                      : { background: lbl.color + '18', color: lbl.color, borderColor: lbl.color + '44' }
                  }
                >
                  {lbl.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-green-500" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-gray-400 px-6 text-center">
              <MessageCircle className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">Nenhuma conversa encontrada</p>
              <p className="text-xs">As mensagens recebidas via WhatsApp aparecerão aqui automaticamente</p>
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={`w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-gray-800/50 text-left ${
                  selectedId === conv.id ? 'bg-green-50 dark:bg-green-900/10 border-l-2 border-l-green-500' : ''
                }`}
              >
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0 ${avatarColor(conv.id)}`}>
                  {getInitials(conv.contact_name, conv.contact_phone)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className={`text-sm font-semibold truncate ${conv.unread_count > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                      {conv.contact_name || conv.contact_phone}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {conv.last_message_at ? formatMsgTime(conv.last_message_at) : ''}
                    </span>
                  </div>
                  <p className={`text-xs truncate ${conv.unread_count > 0 ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-400'}`}>
                    {conv.last_message_preview || 'Sem mensagens'}
                  </p>
                  {/* labels + unread */}
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex gap-1 flex-wrap">
                      {conv.labels?.slice(0, 2).map(lbl => (
                        <span
                          key={lbl.id}
                          className="px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                          style={{ background: lbl.color + '22', color: lbl.color }}
                        >
                          {lbl.name}
                        </span>
                      ))}
                      {conv.status === 'bot' && (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
                          Bot
                        </span>
                      )}
                      {conv.status === 'closed' && (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-gray-100 text-gray-500 dark:bg-gray-800">
                          Fechada
                        </span>
                      )}
                    </div>
                    {conv.unread_count > 0 && (
                      <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-black flex items-center justify-center">
                        {conv.unread_count > 9 ? '9+' : conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ══ RIGHT PANEL — Chat ══ */}
      {selectedConv ? (
        <div className="flex-1 flex flex-col min-w-0">

          {/* Chat header */}
          <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-3 flex items-center gap-3 shrink-0">
            <button
              onClick={() => setSelectedId(null)}
              className="md:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            {/* Avatar */}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-black shrink-0 ${avatarColor(selectedConv.id)}`}>
              {getInitials(selectedConv.contact_name, selectedConv.contact_phone)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-gray-900 dark:text-white text-sm truncate">
                  {selectedConv.contact_name || selectedConv.contact_phone}
                </h2>
                {selectedConv.status === 'closed' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 font-semibold">Fechada</span>
                )}
                {selectedConv.status === 'bot' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-semibold flex items-center gap-1">
                    <Bot className="w-3 h-3" />Bot
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Phone className="w-3 h-3" />{selectedConv.contact_phone}
                </span>
                {within24h ? (
                  <span className="text-xs text-green-500 font-semibold flex items-center gap-1">
                    <Unlock className="w-3 h-3" />Janela aberta
                  </span>
                ) : (
                  <span className="text-xs text-amber-500 font-semibold flex items-center gap-1">
                    <Lock className="w-3 h-3" />Apenas templates
                  </span>
                )}
              </div>
            </div>

            {/* Labels on conversation */}
            <div className="flex items-center gap-1.5 flex-wrap max-w-[30%]">
              {selectedConv.labels?.map(lbl => (
                <LabelChip key={lbl.id} label={lbl} onRemove={() => handleRemoveLabel(lbl.id)} />
              ))}
            </div>

            {/* Add label button */}
            <div className="relative" ref={labelMenuRef}>
              <button
                onClick={() => setShowLabelMenu(v => !v)}
                title="Adicionar etiqueta"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Tag className="w-4 h-4" />
              </button>
              {showLabelMenu && (
                <div className="absolute right-0 top-10 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-50 p-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-2 py-1 mb-1">Etiquetas</p>
                  {labels.length === 0 && (
                    <p className="text-xs text-gray-400 px-2 py-1">Nenhuma etiqueta criada</p>
                  )}
                  {labels.map(lbl => {
                    const already = selectedConv.labels?.some(l => l.id === lbl.id);
                    return (
                      <button
                        key={lbl.id}
                        onClick={() => already ? handleRemoveLabel(lbl.id) : handleAddLabel(lbl.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                      >
                        <div className="w-3 h-3 rounded-full" style={{ background: lbl.color }} />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{lbl.name}</span>
                        {already && <Check className="w-3 h-3 text-green-500 ml-auto" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* More menu */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu(v => !v)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-10 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-50 p-2">
                  {selectedConv.status !== 'open' && (
                    <button onClick={() => handleUpdateStatus('open')} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                      <Unlock className="w-4 h-4 text-green-500" /> Reabrir conversa
                    </button>
                  )}
                  {selectedConv.status !== 'closed' && (
                    <button onClick={() => handleUpdateStatus('closed')} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                      <Archive className="w-4 h-4 text-gray-400" /> Fechar conversa
                    </button>
                  )}
                  {selectedConv.status !== 'bot' && (
                    <button onClick={() => handleUpdateStatus('bot')} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                      <Bot className="w-4 h-4 text-violet-500" /> Ativar modo bot
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Messages thread */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-gray-50 dark:bg-gray-950">
            {loadingMsgs ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-5 h-5 animate-spin text-green-500" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2 text-gray-400">
                <MessageCircle className="w-10 h-10 opacity-20" />
                <p className="text-sm">Nenhuma mensagem ainda</p>
              </div>
            ) : (
              groupedMessages.map(group => (
                <React.Fragment key={group.date}>
                  <DateSeparator date={group.date} />
                  {group.messages.map(msg => {
                    const isOut = msg.direction === 'outbound';
                    const isAutoResp = (msg.content as any)?.auto_response;
                    const text = msg.content?.text as string | undefined;
                    const tplName = msg.content?.template_name as string | undefined;

                    return (
                      <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-1`}>
                        <div
                          className={`max-w-[72%] px-3.5 py-2 rounded-2xl shadow-sm ${
                            isOut
                              ? 'bg-green-500 text-white rounded-br-sm'
                              : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-bl-sm border border-gray-100 dark:border-gray-700'
                          }`}
                        >
                          {msg.type === 'template' ? (
                            <div>
                              <div className="flex items-center gap-1 mb-1 opacity-70">
                                <Bot className="w-3 h-3" />
                                <span className="text-[10px] font-bold uppercase tracking-wide">Template</span>
                              </div>
                              <p className="text-sm">{tplName}</p>
                            </div>
                          ) : msg.type === 'image' ? (
                            <div>
                              <div className="w-48 h-32 bg-black/10 rounded-lg flex items-center justify-center mb-1">
                                <Paperclip className="w-6 h-6 opacity-40" />
                              </div>
                              {(msg.content?.caption as string) && <p className="text-sm">{msg.content.caption as string}</p>}
                            </div>
                          ) : msg.type === 'audio' ? (
                            <p className="text-sm flex items-center gap-1.5 opacity-80">🎵 Mensagem de voz</p>
                          ) : msg.type === 'document' ? (
                            <p className="text-sm flex items-center gap-1.5">📄 {(msg.content?.filename as string) || 'Documento'}</p>
                          ) : msg.type === 'location' ? (
                            <p className="text-sm flex items-center gap-1.5">📍 {(msg.content?.name as string) || 'Localização'}</p>
                          ) : (
                            <p className="text-sm whitespace-pre-wrap">{text || ''}</p>
                          )}

                          {/* Time + status */}
                          <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                            {isAutoResp && (
                              <span className="text-[9px] opacity-60 flex items-center gap-0.5">
                                <Bot className="w-2.5 h-2.5" />auto
                              </span>
                            )}
                            <span className={`text-[10px] ${isOut ? 'text-white/70' : 'text-gray-400'}`}>
                              {formatMsgTime(msg.sent_at)}
                            </span>
                            {isOut && <StatusIcon status={msg.status} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Compose area */}
          <div className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 p-3 shrink-0">
            {!within24h && (
              <div className="mb-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-500 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Janela de 24h expirada — use um template para iniciar a conversa.
                </p>
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* Template button */}
              <div className="relative" ref={templateMenuRef}>
                <button
                  onClick={() => setShowTemplateMenu(v => !v)}
                  title="Enviar template"
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-colors"
                >
                  <Bot className="w-4 h-4" />
                </button>
                {showTemplateMenu && (
                  <div className="absolute bottom-12 left-0 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-50 p-2 max-h-60 overflow-y-auto">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-2 py-1 mb-1">Templates aprovados</p>
                    {templates.length === 0 ? (
                      <p className="text-xs text-gray-400 px-2 py-2">Nenhum template disponível</p>
                    ) : (
                      templates.map(t => (
                        <button
                          key={t.id}
                          onClick={() => handleSendTemplate(t)}
                          disabled={sending}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t.template_key}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{t.description || t.template_name}</p>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Text input */}
              <textarea
                ref={inputRef}
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={within24h ? 'Digite uma mensagem... (Enter para enviar)' : 'Selecione um template →'}
                disabled={!within24h || selectedConv.status === 'closed'}
                rows={1}
                className="flex-1 px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-800 dark:text-gray-100 placeholder-gray-400 resize-none disabled:opacity-50 disabled:cursor-not-allowed max-h-32"
                style={{ minHeight: 42 }}
              />

              {/* Send button */}
              <button
                onClick={handleSend}
                disabled={!messageText.trim() || !within24h || selectedConv.status === 'closed' || sending}
                className="w-9 h-9 rounded-xl bg-green-500 flex items-center justify-center text-white hover:bg-green-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400 bg-gray-50 dark:bg-gray-950">
          <div className="w-20 h-20 rounded-3xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center shadow-sm">
            <MessageCircle className="w-10 h-10 text-green-400" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-gray-600 dark:text-gray-300 text-lg">Selecione uma conversa</p>
            <p className="text-sm mt-1">As mensagens recebidas aparecerão na lista à esquerda</p>
          </div>
        </div>
      )}

      {/* ── Label Manager Modal ── */}
      {showLabelManager && (
        <LabelManagerModal
          labels={labels}
          hotelId={selectedHotel!.id}
          onClose={() => { setShowLabelManager(false); loadLabels(); }}
        />
      )}
    </div>
  );
};

// ─── Label Manager Modal ──────────────────────────────────────────────────────
const LabelManagerModal: React.FC<{
  labels: WaLabel[];
  hotelId: string;
  onClose: () => void;
}> = ({ labels, hotelId, onClose }) => {
  const [list, setList] = useState<WaLabel[]>(labels);
  const [editing, setEditing] = useState<Partial<WaLabel> | null>(null);
  const [saving, setSaving]   = useState(false);

  const PRESET_COLORS = ['#22c55e','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#06b6d4','#ec4899','#64748b'];

  const handleSave = async () => {
    if (!editing?.name?.trim()) return;
    setSaving(true);
    try {
      const saved = await waInboxService.saveLabel({ ...editing as any, hotel_id: hotelId });
      setList(prev => {
        const idx = prev.findIndex(l => l.id === saved.id);
        if (idx >= 0) { const u = [...prev]; u[idx] = saved; return u; }
        return [...prev, saved];
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await waInboxService.deleteLabel(id);
    setList(prev => prev.filter(l => l.id !== id));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Tag className="w-4 h-4 text-green-500" /> Etiquetas
          </h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
          {list.map(lbl => (
            <div key={lbl.id} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: lbl.color }} />
              <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{lbl.name}</span>
              <button onClick={() => setEditing(lbl)} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-blue-500">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(lbl.id)} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {editing ? (
          <div className="p-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
            <input
              value={editing.name || ''}
              onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
              placeholder="Nome da etiqueta"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setEditing(p => ({ ...p, color: c }))}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${editing.color === c ? 'scale-125 border-gray-700 dark:border-white' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} className="flex-1 py-2 text-xs font-semibold text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-xs font-bold bg-green-500 text-white rounded-xl hover:bg-green-600 disabled:opacity-60">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Salvar'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 border-t border-gray-100 dark:border-gray-700">
            <button
              onClick={() => setEditing({ name: '', color: '#22c55e' })}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold text-green-600 border-2 border-dashed border-green-300 dark:border-green-700 rounded-2xl hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
            >
              <Plus className="w-4 h-4" /> Nova etiqueta
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default WhatsAppInbox;
