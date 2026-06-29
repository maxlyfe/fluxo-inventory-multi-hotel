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

  // Realtime: qualquer nova mensagem recalcula a lista
  useRealtimeSubscription('messages', undefined, useCallback(() => {
    load();
  }, [load]));

  return { conversations, loading, totalUnread, refresh: load };
}

// ─── useMessages ─────────────────────────────────────────────────────────────

export function useMessages(conversationId: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!conversationId || !user) return;
    setLoading(true);
    const data = await getMessages(conversationId, 50);
    setMessages(data);
    setHasMore(data.length === 50);
    setLoading(false);
    loadedRef.current = true;
    // Marcar como lido ao abrir o chat
    await markMessagesRead(conversationId);
  }, [conversationId, user]);

  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    loadedRef.current = false;
    load();
  }, [conversationId, load]);

  // Realtime: append de novas mensagens nesta conversa
  useRealtimeSubscription(
    'messages',
    conversationId ? `conversation_id=eq.${conversationId}` : undefined,
    useCallback(async (payload: any) => {
      if (!conversationId || payload.eventType !== 'INSERT') return;
      const newMsg = payload.new as Message;
      setMessages(prev => {
        // evitar duplicatas
        if (prev.some(m => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      // Marcar como lido automaticamente (chat está aberto)
      await markMessagesRead(conversationId);
    }, [conversationId])
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

  // Atualiza quando chegam novas mensagens ou leituras
  useRealtimeSubscription('messages', undefined, useCallback(() => {
    refresh();
  }, [refresh]));

  useRealtimeSubscription('message_reads', undefined, useCallback(() => {
    refresh();
  }, [refresh]));

  return count;
}
