// src/pages/portal/TasksPage.tsx
// Todo List: tarefas pessoais/compartilhadas com recorrência + anotações
// Tabs: Tarefas (atrasadas/hoje/próximas) | Anotações

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, parseISO, addDays, isBefore, isToday, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CheckSquare, Square, Plus, Loader2, Repeat, Clock, Users, Trash2,
  Edit2, Check, X, StickyNote, MessageSquare, ChevronDown, ChevronUp,
  Lock, Pencil, CheckCircle2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { useTasks, TaskOccurrenceRow, NoteRow, TaskRow } from '../../hooks/useTasks';
import TaskFormModal from '../../components/tasks/TaskFormModal';
import NoteFormModal from '../../components/tasks/NoteFormModal';
import CommentsPanel from '../../components/tasks/CommentsPanel';

const FREQ_LABEL: Record<string, string> = {
  daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual', custom: 'Personalizada',
};

// ---------------------------------------------------------------------------
// Card de uma ocorrência de tarefa
// ---------------------------------------------------------------------------
function TaskCard({ occ, userId, userNames, onToggle, onEdit, onDelete, onRespond }: {
  occ: TaskOccurrenceRow;
  userId: string;
  userNames: Map<string, string>;
  onToggle: (occ: TaskOccurrenceRow) => void;
  onEdit: (occ: TaskOccurrenceRow) => void;
  onDelete: (occ: TaskOccurrenceRow) => void;
  onRespond: (taskId: string, status: 'accepted' | 'declined') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOwner = occ.created_by === userId;
  const isPendingInvite = !isOwner && occ.my_assignee_status === 'pending';
  const isDone = occ.status === 'done';
  const overdue = !isDone && isBefore(parseISO(occ.due_date), startOfDay(new Date()));

  const participantIds = useMemo(() => [
    occ.created_by,
    ...occ.assignees.filter(a => a.status !== 'declined').map(a => a.user_id),
  ], [occ]);

  return (
    <div className={`p-3.5 rounded-xl border transition-colors ${
      isDone
        ? 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40'
        : isPendingInvite
          ? 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
    }`}>
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => !isPendingInvite && onToggle(occ)}
          disabled={isPendingInvite}
          className="mt-0.5 shrink-0 disabled:opacity-40"
          title={occ.i_completed ? 'Desfazer minha conclusão' : 'Concluir'}
        >
          {isDone || occ.i_completed
            ? <CheckSquare className="w-5 h-5 text-emerald-500" />
            : <Square className={`w-5 h-5 ${overdue ? 'text-red-400' : 'text-slate-300 dark:text-slate-600'} hover:text-indigo-500 transition-colors`} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-semibold truncate ${
              isDone ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-800 dark:text-white'
            }`}>
              {occ.title}
            </p>
            {occ.recurrence_freq !== 'none' && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-full shrink-0">
                <Repeat className="w-2.5 h-2.5" /> {FREQ_LABEL[occ.recurrence_freq]}
              </span>
            )}
            {occ.is_shared && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-violet-500 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded-full shrink-0">
                <Users className="w-2.5 h-2.5" />
                {occ.completion_mode === 'all' ? 'Todos concluem' : 'Compartilhada'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 mt-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
            <span className={overdue ? 'text-red-500 font-semibold' : ''}>
              {format(parseISO(occ.due_date), "dd/MM (EEE)", { locale: ptBR })}
            </span>
            {occ.due_time && (
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {occ.due_time.slice(0, 5)}</span>
            )}
            {overdue && <span className="text-red-500 font-semibold">Atrasada</span>}
          </div>

          {/* Progresso no modo 'all': quem já concluiu */}
          {occ.completion_mode === 'all' && occ.is_shared && occ.completions.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {occ.completions.map(c => (
                <span key={c.user_id}
                  className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full"
                  title={format(parseISO(c.completed_at), "dd/MM/yyyy HH:mm")}>
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  {c.user_id === userId ? 'Você' : (userNames.get(c.user_id) || 'Colaborador')}
                </span>
              ))}
            </div>
          )}

          {/* Convite pendente */}
          {isPendingInvite && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold mr-auto">Convite pendente</span>
              <button onClick={() => onRespond(occ.task_id, 'accepted')}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors">
                <Check className="w-3 h-3" /> Aceitar
              </button>
              <button onClick={() => onRespond(occ.task_id, 'declined')}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors">
                <X className="w-3 h-3" /> Recusar
              </button>
            </div>
          )}
        </div>

        {/* Expandir */}
        <button onClick={() => setExpanded(v => !v)}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0 transition-colors"
          title="Detalhes e comentários">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
          {occ.description && (
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{occ.description}</p>
          )}

          {occ.is_shared && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-400 uppercase">Colaboradores:</span>
              {occ.assignees.map(a => (
                <span key={a.user_id} className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  a.status === 'accepted' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                  : a.status === 'declined' ? 'bg-red-50 dark:bg-red-900/20 text-red-500 line-through'
                  : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                }`}>
                  {a.user_id === userId ? 'Você' : (userNames.get(a.user_id) || 'Colaborador')}
                </span>
              ))}
            </div>
          )}

          {isOwner && (
            <div className="flex items-center gap-3">
              <button onClick={() => onEdit(occ)}
                className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1 transition-colors">
                <Edit2 className="w-3 h-3" /> Editar tarefa
              </button>
              <button onClick={() => onDelete(occ)}
                className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors">
                <Trash2 className="w-3 h-3" /> Excluir {occ.recurrence_freq !== 'none' ? 'série' : ''}
              </button>
            </div>
          )}

          <CommentsPanel
            entityType="task"
            entityId={occ.task_id}
            entityTitle={occ.title}
            participantIds={participantIds}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card de anotação
// ---------------------------------------------------------------------------
function NoteCard({ note, userId, userNames, onEdit, onDelete }: {
  note: NoteRow;
  userId: string;
  userNames: Map<string, string>;
  onEdit: (n: NoteRow) => void;
  onDelete: (n: NoteRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOwner = note.created_by === userId;
  const canEdit = isOwner || note.allow_edit;
  const participantIds = useMemo(() => [
    note.created_by,
    ...(note.note_collaborators || []).map(c => c.user_id),
  ], [note]);

  return (
    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <StickyNote className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">
              {note.title || 'Sem título'}
            </p>
            {note.is_shared && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-violet-500 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded-full shrink-0">
                {note.allow_edit ? <Pencil className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
                {note.allow_edit ? 'Edição liberada' : 'Somente leitura'}
              </span>
            )}
            {!isOwner && (
              <span className="text-[10px] text-slate-400 shrink-0">
                de {userNames.get(note.created_by) || 'Colaborador'}
              </span>
            )}
          </div>
          <p className={`text-xs text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-2'}`}>
            {note.content}
          </p>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Atualizada em {format(parseISO(note.updated_at), "dd/MM/yyyy HH:mm")}
          </p>
        </div>
        <button onClick={() => setExpanded(v => !v)}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0 transition-colors">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
          <div className="flex items-center gap-3">
            {canEdit && (
              <button onClick={() => onEdit(note)}
                className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1 transition-colors">
                <Edit2 className="w-3 h-3" /> Editar
              </button>
            )}
            {isOwner && (
              <button onClick={() => onDelete(note)}
                className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors">
                <Trash2 className="w-3 h-3" /> Excluir
              </button>
            )}
          </div>
          <CommentsPanel
            entityType="note"
            entityId={note.id}
            entityTitle={note.title || 'Anotação'}
            participantIds={participantIds}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function TasksPage() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();
  const {
    fetchOccurrences, fetchTask, deleteTask,
    completeOccurrence, uncompleteOccurrence, respondInvite,
    fetchNotes, deleteNote,
  } = useTasks();

  const [tab, setTab]               = useState<'tasks' | 'notes'>('tasks');
  const [occurrences, setOccurrences] = useState<TaskOccurrenceRow[]>([]);
  const [notes, setNotes]           = useState<NoteRow[]>([]);
  const [userNames, setUserNames]   = useState<Map<string, string>>(new Map());
  const [loading, setLoading]       = useState(true);
  const [showDone, setShowDone]     = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask]   = useState<TaskRow | null>(null);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [editingNote, setEditingNote]   = useState<NoteRow | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedHotel?.id || !user) return;
    setLoading(true);
    try {
      const from = format(addDays(new Date(), -30), 'yyyy-MM-dd');
      const to   = format(addDays(new Date(), 60), 'yyyy-MM-dd');
      const [occs, nts] = await Promise.all([fetchOccurrences(from, to), fetchNotes()]);
      setOccurrences(occs);
      setNotes(nts);

      // Nomes dos usuários envolvidos (colaboradores/donos/conclusões)
      const ids = new Set<string>();
      occs.forEach(o => {
        ids.add(o.created_by);
        o.assignees.forEach(a => ids.add(a.user_id));
        o.completions.forEach(c => ids.add(c.user_id));
      });
      nts.forEach(n => {
        ids.add(n.created_by);
        (n.note_collaborators || []).forEach(c => ids.add(c.user_id));
      });
      ids.delete(user.id);
      if (ids.size) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', [...ids]);
        setUserNames(new Map((profiles || []).map((p: any) => [p.id, p.full_name])));
      }
    } finally {
      setLoading(false);
    }
  }, [selectedHotel?.id, user, fetchOccurrences, fetchNotes]);

  useEffect(() => { loadData(); }, [loadData]);

  // Agrupamento: Atrasadas / Hoje / Próximas / Concluídas
  const groups = useMemo(() => {
    const today = startOfDay(new Date());
    const overdue: TaskOccurrenceRow[] = [];
    const todayList: TaskOccurrenceRow[] = [];
    const upcoming: TaskOccurrenceRow[] = [];
    const done: TaskOccurrenceRow[] = [];
    occurrences.forEach(o => {
      if (o.status === 'done') { done.push(o); return; }
      const d = parseISO(o.due_date);
      if (isToday(d)) todayList.push(o);
      else if (isBefore(d, today)) overdue.push(o);
      else upcoming.push(o);
    });
    done.sort((a, b) => b.due_date.localeCompare(a.due_date));
    return { overdue, todayList, upcoming, done };
  }, [occurrences]);

  async function handleToggle(occ: TaskOccurrenceRow) {
    if (occ.i_completed || occ.status === 'done') {
      await uncompleteOccurrence(occ.occurrence_id);
    } else {
      await completeOccurrence(occ.occurrence_id, occ.title, occ.created_by);
    }
    loadData();
  }

  async function handleEdit(occ: TaskOccurrenceRow) {
    const t = await fetchTask(occ.task_id);
    if (t) { setEditingTask(t); setShowTaskForm(true); }
  }

  async function handleDelete(occ: TaskOccurrenceRow) {
    await deleteTask(occ.task_id);
    loadData();
  }

  async function handleRespond(taskId: string, status: 'accepted' | 'declined') {
    await respondInvite(taskId, status);
    loadData();
  }

  async function handleDeleteNote(n: NoteRow) {
    await deleteNote(n.id);
    loadData();
  }

  const myNotes     = notes.filter(n => n.created_by === user?.id);
  const sharedNotes = notes.filter(n => n.created_by !== user?.id);

  function renderGroup(title: string, list: TaskOccurrenceRow[], accent?: string) {
    if (!list.length) return null;
    return (
      <div>
        <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${accent || 'text-slate-400 dark:text-slate-500'}`}>
          {title} ({list.length})
        </h3>
        <div className="space-y-2">
          {list.map(o => (
            <TaskCard
              key={o.occurrence_id}
              occ={o}
              userId={user!.id}
              userNames={userNames}
              onToggle={handleToggle}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRespond={handleRespond}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
            <CheckSquare className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Tarefas</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{selectedHotel?.name}</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (tab === 'tasks') { setEditingTask(null); setShowTaskForm(true); }
            else { setEditingNote(null); setShowNoteForm(true); }
          }}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-semibold active:scale-95 transition-all shadow-sm shadow-indigo-600/20"
        >
          <Plus className="w-4 h-4" /> {tab === 'tasks' ? 'Nova Tarefa' : 'Nova Anotação'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('tasks')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            tab === 'tasks'
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}>
          <CheckSquare className="w-4 h-4" /> Tarefas
        </button>
        <button onClick={() => setTab('notes')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            tab === 'notes'
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}>
          <StickyNote className="w-4 h-4" /> Anotações
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : tab === 'tasks' ? (
        <div className="space-y-6">
          {groups.overdue.length + groups.todayList.length + groups.upcoming.length + groups.done.length === 0 ? (
            <div className="text-center py-16">
              <CheckSquare className="w-10 h-10 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-400 dark:text-slate-500">Nenhuma tarefa por aqui. Crie a primeira!</p>
            </div>
          ) : (
            <>
              {renderGroup('Atrasadas', groups.overdue, 'text-red-500')}
              {renderGroup('Hoje', groups.todayList, 'text-indigo-500')}
              {renderGroup('Próximas', groups.upcoming)}
              {groups.done.length > 0 && (
                <div>
                  <button onClick={() => setShowDone(v => !v)}
                    className="text-xs font-bold uppercase tracking-wider text-emerald-500 mb-2 flex items-center gap-1">
                    Concluídas ({groups.done.length})
                    {showDone ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {showDone && (
                    <div className="space-y-2">
                      {groups.done.map(o => (
                        <TaskCard
                          key={o.occurrence_id}
                          occ={o}
                          userId={user!.id}
                          userNames={userNames}
                          onToggle={handleToggle}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                          onRespond={handleRespond}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {notes.length === 0 ? (
            <div className="text-center py-16">
              <StickyNote className="w-10 h-10 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-400 dark:text-slate-500">Nenhuma anotação. Crie a primeira!</p>
            </div>
          ) : (
            <>
              {myNotes.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                    Minhas anotações ({myNotes.length})
                  </h3>
                  <div className="space-y-2">
                    {myNotes.map(n => (
                      <NoteCard key={n.id} note={n} userId={user!.id} userNames={userNames}
                        onEdit={nn => { setEditingNote(nn); setShowNoteForm(true); }}
                        onDelete={handleDeleteNote} />
                    ))}
                  </div>
                </div>
              )}
              {sharedNotes.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-violet-500 mb-2">
                    Compartilhadas comigo ({sharedNotes.length})
                  </h3>
                  <div className="space-y-2">
                    {sharedNotes.map(n => (
                      <NoteCard key={n.id} note={n} userId={user!.id} userNames={userNames}
                        onEdit={nn => { setEditingNote(nn); setShowNoteForm(true); }}
                        onDelete={handleDeleteNote} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {showTaskForm && selectedHotel && (
        <TaskFormModal
          task={editingTask}
          hotelId={selectedHotel.id}
          onClose={() => { setShowTaskForm(false); setEditingTask(null); }}
          onSaved={loadData}
        />
      )}
      {showNoteForm && selectedHotel && (
        <NoteFormModal
          note={editingNote}
          hotelId={selectedHotel.id}
          onClose={() => { setShowNoteForm(false); setEditingNote(null); }}
          onSaved={loadData}
        />
      )}
    </div>
  );
}
