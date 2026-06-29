import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ConversationWithMeta,
  Message,
  getMyConversations,
  getMessages,
  sendMessage as sendMessageService,
  markMessagesRead,
  getTotalUnreadCount,
} from '../lib/chat';
import { fetchProfilesBatch } from '../lib/chat';
import { useRealtimeSubscription } from './useRealtime';

// ─── useConversations ────────────────────────────────────────────────────────

export function useConversations() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalUnread, setTotalUnread] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    const data = await getMyConversations();
    setConversations(data);
    setTotalUnread(data.reduce((acc, c) => acc + c.unread_count, 0));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Zera o badge imediatamente ao abrir uma conversa (sem esperar realtime)
  const markConversationRead = useCallback((conversationId: string) => {
    setConversations(prev =>
      prev.map(c => c.id === conversationId ? { ...c, unread_count: 0 } : c)
    );
    setTotalUnread(prev => {
      const conv = conversations.find(c => c.id === conversationId);
      return Math.max(0, prev - (conv?.unread_count || 0));
    });
  }, [conversations]);

  const onConvChange = useCallback(() => { load(); }, [load]);

  // Nova mensagem → atualiza última mensagem + não-lidas
  useRealtimeSubscription('messages', undefined, onConvChange);

  // Novo membro adicionado (inclui quando sou adicionado a uma nova conversa)
  const memberFilter = user ? `user_id=eq.${user.id}` : undefined;
  useRealtimeSubscription('conversation_members', memberFilter, onConvChange);

  // Nova conversa criada
  useRealtimeSubscription('conversations', undefined, onConvChange);

  // Mensagem lida → recalcula não-lidas
  useRealtimeSubscription('message_reads', undefined, onConvChange);

  return { conversations, loading, totalUnread, refresh: load, markConversationRead };
}

// ─── useMessages ─────────────────────────────────────────────────────────────

export function useMessages(conversationId: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async () => {
    if (!conversationId || !user) return;
    setLoading(true);
    const data = await getMessages(conversationId, 50);
    setMessages(data);
    setHasMore(data.length === 50);
    setLoading(false);
    await markMessagesRead(conversationId);
  }, [conversationId, user]);

  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    load();
  }, [conversationId, load]);

  // Realtime: append nova mensagem e busca perfil do sender
  const onNewMessage = useCallback(async (payload: any) => {
    if (!conversationId || payload.eventType !== 'INSERT') return;
    const raw = payload.new as Message;

    // Buscar perfil do sender se não vier no payload
    let sender = raw.sender;
    if (!sender && raw.sender_id) {
      const map = await fetchProfilesBatch([raw.sender_id]);
      sender = map.get(raw.sender_id);
    }
    const newMsg: Message = { ...raw, sender };

    setMessages(prev => {
      if (prev.some(m => m.id === newMsg.id)) return prev;
      return [...prev, newMsg];
    });

    await markMessagesRead(conversationId);
  }, [conversationId]);

  useRealtimeSubscription(
    'messages',
    conversationId ? `conversation_id=eq.${conversationId}` : undefined,
    onNewMessage,
  );

  const sendMessage = useCallback(async (content: string) => {
    if (!conversationId || !content.trim()) return;
    const msg = await sendMessageService(conversationId, content.trim());
    if (msg) {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    }
  }, [conversationId]);

  const loadMore = useCallback(async () => {
    if (!conversationId || !hasMore || loading) return;
    const oldest = messages[0]?.created_at;
    const older = await getMessages(conversationId, 50, oldest);
    setMessages(prev => {
      const ids = new Set(prev.map(m => m.id));
      return [...older.filter(m => !ids.has(m.id)), ...prev];
    });
    setHasMore(older.length === 50);
  }, [conversationId, hasMore, loading, messages]);

  return { messages, loading, sendMessage, loadMore, hasMore };
}

// ─── useUnreadCount ───────────────────────────────────────────────────────────

export function useUnreadCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    const n = await getTotalUnreadCount();
    setCount(n);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onRefresh = useCallback(() => { refresh(); }, [refresh]);

  useRealtimeSubscription('messages', undefined, onRefresh);
  useRealtimeSubscription('message_reads', undefined, onRefresh);

  return count;
}
