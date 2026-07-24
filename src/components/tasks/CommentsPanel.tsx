// src/components/tasks/CommentsPanel.tsx
// Thread de comentários para tarefas e anotações

import React, { useState, useEffect, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MessageSquare, Send, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTasks, CommentRow } from '../../hooks/useTasks';

export default function CommentsPanel({ entityType, entityId, entityTitle, participantIds }: {
  entityType: 'task' | 'note';
  entityId: string;
  entityTitle: string;
  participantIds: string[];
}) {
  const { user } = useAuth();
  const { fetchComments, addComment, deleteComment } = useTasks();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [text, setText]         = useState('');
  const [sending, setSending]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setComments(await fetchComments(entityType, entityId));
      setLoading(false);
    })();
  }, [entityType, entityId, fetchComments]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  // Realtime: comentários de outros usuários aparecem na hora
  useEffect(() => {
    const channel = supabase
      .channel(`task-comments-${entityType}-${entityId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'task_comments',
        filter: `entity_id=eq.${entityId}`,
      }, async () => {
        setComments(await fetchComments(entityType, entityId));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [entityType, entityId, fetchComments]);

  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    const created = await addComment(entityType, entityId, text, entityTitle, participantIds);
    if (created) {
      created.author_name = 'Você';
      setComments(c => [...c, created]);
      setText('');
    }
    setSending(false);
  }

  async function handleDelete(id: string) {
    await deleteComment(id);
    setComments(c => c.filter(x => x.id !== id));
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3">
      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5" /> Comentários {comments.length > 0 && `(${comments.length})`}
      </h3>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-2">Nenhum comentário ainda.</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {comments.map(c => (
            <div key={c.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 group">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 truncate">
                  {c.user_id === user?.id ? 'Você' : (c.author_name || 'Colaborador')}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-slate-400">
                    {format(parseISO(c.created_at), "dd/MM HH:mm", { locale: ptBR })}
                  </span>
                  {c.user_id === user?.id && (
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                      title="Excluir comentário"
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5 whitespace-pre-wrap break-words">{c.content}</p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Escreva um comentário…"
          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <button
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 active:scale-95 transition-all"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
