// src/hooks/useTasks.ts
// Camada de dados do módulo de Tarefas + Anotações (Todo List)
// CRUD de tarefas/anotações, conclusão via RPC, convites, comentários e
// notificações síncronas (TASK_ASSIGNED, TASK_COMMENT, NOTE_SHARED, TASK_COMPLETED)

import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';
import { createNotification } from '../lib/notifications';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type RecurrenceFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type CompletionMode = 'any' | 'all';
export type AssigneeStatus = 'pending' | 'accepted' | 'declined';

export interface TaskInput {
  title: string;
  description?: string | null;
  due_date: string;              // yyyy-MM-dd
  due_time?: string | null;      // HH:mm
  completion_mode: CompletionMode;
  recurrence_freq: RecurrenceFreq;
  recurrence_interval?: number;
  recurrence_byweekday?: number[] | null;
  recurrence_bymonthday?: number[] | null;
  recurrence_until?: string | null;
  recurrence_count?: number | null;
  all_hotels?: boolean;          // true → hotel_id = null (rede)
  assignee_user_ids?: string[];  // colaboradores anexados (convite)
  notify_on_create?: boolean;
}

export interface TaskRow {
  id: string;
  hotel_id: string | null;
  created_by: string;
  title: string;
  description: string | null;
  due_date: string;
  due_time: string | null;
  completion_mode: CompletionMode;
  recurrence_freq: RecurrenceFreq;
  recurrence_interval: number;
  recurrence_byweekday: number[] | null;
  recurrence_bymonthday: number[] | null;
  recurrence_until: string | null;
  recurrence_count: number | null;
  is_active: boolean;
  task_assignees?: { user_id: string; status: AssigneeStatus }[];
}

export interface TaskOccurrenceRow {
  occurrence_id: string;
  task_id: string;
  title: string;
  description: string | null;
  due_date: string;
  due_time: string | null;
  status: 'pending' | 'done' | 'skipped';
  completed_at: string | null;
  completion_mode: CompletionMode;
  recurrence_freq: RecurrenceFreq;
  hotel_id: string | null;
  created_by: string;
  my_assignee_status: AssigneeStatus | null;
  is_shared: boolean;
  assignees: { user_id: string; status: AssigneeStatus }[];
  completions: { user_id: string; completed_at: string }[];
  i_completed: boolean;
}

export interface NoteRow {
  id: string;
  hotel_id: string | null;
  created_by: string;
  title: string | null;
  content: string | null;
  is_shared: boolean;
  allow_edit: boolean;
  created_at: string;
  updated_at: string;
  note_collaborators?: { user_id: string }[];
}

export interface CommentRow {
  id: string;
  entity_type: 'task' | 'note';
  entity_id: string;
  occurrence_id: string | null;
  user_id: string;
  content: string;
  created_at: string;
  author_name?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useTasks() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();

  // ── Ocorrências visíveis no período (lista e calendário) ────────────────
  const fetchOccurrences = useCallback(async (from: string, to: string): Promise<TaskOccurrenceRow[]> => {
    if (!selectedHotel?.id) return [];
    const { data, error } = await supabase.rpc('get_my_task_occurrences', {
      p_hotel_id: selectedHotel.id,
      p_from: from,
      p_to: to,
    });
    if (error) { console.error('[tasks] fetchOccurrences:', error.message); return []; }
    return (data || []) as TaskOccurrenceRow[];
  }, [selectedHotel?.id]);

  // ── Tarefa (template) + assignees ───────────────────────────────────────
  const fetchTask = useCallback(async (taskId: string): Promise<TaskRow | null> => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*, task_assignees(user_id, status)')
      .eq('id', taskId)
      .single();
    if (error) return null;
    return data as TaskRow;
  }, []);

  const saveTask = useCallback(async (input: TaskInput, existingTaskId?: string): Promise<string | null> => {
    if (!user || !selectedHotel?.id) return null;
    const payload: any = {
      hotel_id: input.all_hotels ? null : selectedHotel.id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      due_date: input.due_date,
      due_time: input.due_time || null,
      completion_mode: input.completion_mode,
      recurrence_freq: input.recurrence_freq,
      recurrence_interval: Math.max(input.recurrence_interval || 1, 1),
      recurrence_byweekday: input.recurrence_byweekday?.length ? input.recurrence_byweekday : null,
      recurrence_bymonthday: input.recurrence_bymonthday?.length ? input.recurrence_bymonthday : null,
      recurrence_until: input.recurrence_until || null,
      recurrence_count: input.recurrence_count || null,
      updated_at: new Date().toISOString(),
    };

    let taskId = existingTaskId;
    if (existingTaskId) {
      const { error } = await supabase.from('tasks').update(payload).eq('id', existingTaskId);
      if (error) { console.error('[tasks] update:', error.message); return null; }
    } else {
      payload.created_by = user.id;
      const { data, error } = await supabase.from('tasks').insert(payload).select('id').single();
      if (error || !data) { console.error('[tasks] insert:', error?.message); return null; }
      taskId = data.id;
    }

    // Sincronizar assignees (convites)
    const wanted = (input.assignee_user_ids || []).filter(id => id !== user.id);
    const { data: current } = await supabase
      .from('task_assignees')
      .select('user_id')
      .eq('task_id', taskId!);
    const currentIds = (current || []).map((a: any) => a.user_id as string);
    const toAdd = wanted.filter(id => !currentIds.includes(id));
    const toRemove = currentIds.filter(id => !wanted.includes(id));

    if (toAdd.length) {
      await supabase.from('task_assignees').insert(
        toAdd.map(uid => ({ task_id: taskId, user_id: uid }))
      );
    }
    if (toRemove.length) {
      await supabase.from('task_assignees')
        .delete()
        .eq('task_id', taskId!)
        .in('user_id', toRemove);
    }

    // Materializar ocorrências da janela imediata
    await supabase.rpc('generate_task_occurrences', { p_task_id: taskId });

    // Notificar novos convidados (sino + push)
    if (toAdd.length && input.notify_on_create !== false) {
      for (const uid of toAdd) {
        await createNotification({
          user_id: uid,
          message: `Você foi adicionado à tarefa "${input.title.trim()}"`,
          event_key: 'TASK_ASSIGNED',
          title: 'Convite de tarefa',
          target_path: '/portal/tasks',
          related_entity_id: taskId,
          related_entity_type: 'task',
          hotel_id: input.all_hotels ? null : selectedHotel.id,
          created_by: user.id,
        });
      }
    }

    return taskId || null;
  }, [user, selectedHotel?.id]);

  const deleteTask = useCallback(async (taskId: string) => {
    await supabase.from('tasks').delete().eq('id', taskId);
  }, []);

  // ── Conclusão ────────────────────────────────────────────────────────────
  const completeOccurrence = useCallback(async (occurrenceId: string, taskTitle: string, createdBy: string): Promise<boolean> => {
    const { data, error } = await supabase.rpc('complete_task_occurrence', { p_occurrence_id: occurrenceId });
    if (error) { console.error('[tasks] complete:', error.message); return false; }
    const done = (data as any)?.done === true;
    // Avisar o criador quando a tarefa fecha (se não fui eu que criei)
    if (done && user && createdBy && createdBy !== user.id) {
      await createNotification({
        user_id: createdBy,
        message: `A tarefa "${taskTitle}" foi concluída`,
        event_key: 'TASK_COMPLETED',
        title: 'Tarefa concluída',
        target_path: '/portal/tasks',
        related_entity_id: occurrenceId,
        related_entity_type: 'task_occurrence',
        created_by: user.id,
      });
    }
    return done;
  }, [user]);

  const uncompleteOccurrence = useCallback(async (occurrenceId: string) => {
    const { error } = await supabase.rpc('uncomplete_task_occurrence', { p_occurrence_id: occurrenceId });
    if (error) console.error('[tasks] uncomplete:', error.message);
  }, []);

  // ── Convite (aceitar / recusar) ─────────────────────────────────────────
  const respondInvite = useCallback(async (taskId: string, status: 'accepted' | 'declined') => {
    if (!user) return;
    await supabase.from('task_assignees')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .eq('user_id', user.id);
  }, [user]);

  // ── Anotações ────────────────────────────────────────────────────────────
  const fetchNotes = useCallback(async (): Promise<NoteRow[]> => {
    if (!selectedHotel?.id) return [];
    const { data, error } = await supabase
      .from('notes')
      .select('*, note_collaborators(user_id)')
      .or(`hotel_id.eq.${selectedHotel.id},hotel_id.is.null`)
      .order('updated_at', { ascending: false });
    if (error) { console.error('[tasks] fetchNotes:', error.message); return []; }
    return (data || []) as NoteRow[];
  }, [selectedHotel?.id]);

  const saveNote = useCallback(async (
    input: { title: string; content: string; is_shared: boolean; allow_edit: boolean; collaborator_ids: string[]; all_hotels?: boolean },
    existingNoteId?: string,
  ): Promise<string | null> => {
    if (!user || !selectedHotel?.id) return null;
    const payload: any = {
      hotel_id: input.all_hotels ? null : selectedHotel.id,
      title: input.title.trim() || null,
      content: input.content,
      is_shared: input.is_shared,
      allow_edit: input.is_shared ? input.allow_edit : false,
      updated_at: new Date().toISOString(),
    };

    let noteId = existingNoteId;
    if (existingNoteId) {
      const { error } = await supabase.from('notes').update(payload).eq('id', existingNoteId);
      if (error) { console.error('[tasks] note update:', error.message); return null; }
    } else {
      payload.created_by = user.id;
      const { data, error } = await supabase.from('notes').insert(payload).select('id').single();
      if (error || !data) { console.error('[tasks] note insert:', error?.message); return null; }
      noteId = data.id;
    }

    // Sincronizar colaboradores (só o dono consegue, RLS garante)
    const wanted = input.is_shared ? input.collaborator_ids.filter(id => id !== user.id) : [];
    const { data: current } = await supabase
      .from('note_collaborators')
      .select('user_id')
      .eq('note_id', noteId!);
    const currentIds = (current || []).map((c: any) => c.user_id as string);
    const toAdd = wanted.filter(id => !currentIds.includes(id));
    const toRemove = currentIds.filter(id => !wanted.includes(id));

    if (toAdd.length) {
      await supabase.from('note_collaborators').insert(
        toAdd.map(uid => ({ note_id: noteId, user_id: uid }))
      );
      for (const uid of toAdd) {
        await createNotification({
          user_id: uid,
          message: `"${input.title.trim() || 'Anotação'}" foi compartilhada com você`,
          event_key: 'NOTE_SHARED',
          title: 'Anotação compartilhada',
          target_path: '/portal/tasks',
          related_entity_id: noteId,
          related_entity_type: 'note',
          created_by: user.id,
        });
      }
    }
    if (toRemove.length) {
      await supabase.from('note_collaborators')
        .delete()
        .eq('note_id', noteId!)
        .in('user_id', toRemove);
    }

    return noteId || null;
  }, [user, selectedHotel?.id]);

  const deleteNote = useCallback(async (noteId: string) => {
    await supabase.from('notes').delete().eq('id', noteId);
  }, []);

  // ── Comentários ──────────────────────────────────────────────────────────
  const fetchComments = useCallback(async (entityType: 'task' | 'note', entityId: string): Promise<CommentRow[]> => {
    const { data, error } = await supabase
      .from('task_comments')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true });
    if (error) return [];
    const comments = (data || []) as CommentRow[];
    // Nomes dos autores (profiles)
    const authorIds = [...new Set(comments.map(c => c.user_id))];
    if (authorIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', authorIds);
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
      comments.forEach(c => { c.author_name = nameMap.get(c.user_id) || 'Colaborador'; });
    }
    return comments;
  }, []);

  const addComment = useCallback(async (
    entityType: 'task' | 'note',
    entityId: string,
    content: string,
    entityTitle: string,
    participantIds: string[],
  ): Promise<CommentRow | null> => {
    if (!user || !content.trim()) return null;
    const { data, error } = await supabase
      .from('task_comments')
      .insert({ entity_type: entityType, entity_id: entityId, user_id: user.id, content: content.trim() })
      .select()
      .single();
    if (error || !data) { console.error('[tasks] comment:', error?.message); return null; }

    // Notificar demais participantes
    const others = [...new Set(participantIds)].filter(id => id && id !== user.id);
    for (const uid of others) {
      await createNotification({
        user_id: uid,
        message: `Novo comentário em "${entityTitle}"`,
        event_key: 'TASK_COMMENT',
        title: 'Novo comentário',
        target_path: '/portal/tasks',
        related_entity_id: entityId,
        related_entity_type: entityType,
        created_by: user.id,
      });
    }
    return data as CommentRow;
  }, [user]);

  const deleteComment = useCallback(async (commentId: string) => {
    await supabase.from('task_comments').delete().eq('id', commentId);
  }, []);

  return {
    fetchOccurrences, fetchTask, saveTask, deleteTask,
    completeOccurrence, uncompleteOccurrence, respondInvite,
    fetchNotes, saveNote, deleteNote,
    fetchComments, addComment, deleteComment,
  };
}
