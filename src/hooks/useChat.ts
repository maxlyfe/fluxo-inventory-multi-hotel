import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ConversationWithMeta,
  Message,
  getMyConversations,
  getMessages,
  sendMessage as sendMessageService,
  editMessage as editMessageService,
  deleteMessage as deleteMessageService,
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

  const markConversationRead = useCallback((conversationId: string) => {
    setConversations(prev => {
      const conv = prev.find(c => c.id === conversationId);
      if (conv && conv.unread_count > 0) {
        setTotalUnread(t => Math.max(0, t - conv.unread_count));
      }
      return prev.map(c => c.id === conversationId ? { ...c, unread_count: 0 } : c);
    });
  }, []);

  const onConvChange = useCallback(() => { load(); }, [load]);

  useRealtimeSubscription('messages', undefined, onConvChange);

  const memberFilter = user ? `user_id=eq.${user.id}` : undefined;
  useRealtimeSubscription('conversation_members', memberFilter, onConvChange);
  useRealtimeSubscription('conversations', undefined, onConvChange);
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

  // Realtime: new message or update (edit/delete)
  const onMessageChange = useCallback(async (payload: any) => {
    if (!conversationId) return;

    if (payload.eventType === 'INSERT') {
      const raw = payload.new as Message;
      if (raw.conversation_id !== conversationId) return;

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
    }

    if (payload.eventType === 'UPDATE') {
      const updated = payload.new as any;
      if (updated.conversation_id !== conversationId) return;

      setMessages(prev => prev
        .filter(m => !(m.id === updated.id && updated.deleted_at))
        .map(m => {
          if (m.id !== updated.id) return m;
          return { ...m, content: updated.content, edited_at: updated.edited_at, deleted_at: updated.deleted_at };
        })
      );
    }
  }, [conversationId]);

  useRealtimeSubscription(
    'messages',
    conversationId ? `conversation_id=eq.${conversationId}` : undefined,
    onMessageChange,
  );

  const sendMessage = useCallback(async (content: string, replyToId?: string) => {
    if (!conversationId || !content.trim()) return;
    const msg = await sendMessageService(conversationId, content.trim(), 'text', undefined, replyToId);
    if (msg) {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    }
  }, [conversationId]);

  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    const success = await editMessageService(messageId, newContent);
    if (success) {
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, content: newContent, edited_at: new Date().toISOString() }
          : m
      ));
    }
    return success;
  }, []);

  const deleteMessage = useCallback(async (messageId: string) => {
    const success = await deleteMessageService(messageId);
    if (success) {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    }
    return success;
  }, []);

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

  return { messages, loading, sendMessage, editMessage, deleteMessage, loadMore, hasMore };
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
