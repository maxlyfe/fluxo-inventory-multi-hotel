// src/pages/portal/TasksPage.tsx
// Todo List: tarefas pessoais/compartilhadas com recorrência + anotações
// Tabs: Tarefas (atrasadas/hoje/próximas) | Anotações

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, parseISO, addDays, isBefore, isToday, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CheckSquare, Square, Plus, Loader2, Repeat, Clock, Users, Trash2,
  Edit2, Check, X, StickyNote, MessageSquare, ChevronDown, ChevronUp,
  Lock, Pencil, CheckCircle2, Folder, FolderPlus, List,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { useTasks, TaskOccurrenceRow, NoteRow, TaskRow, TaskGroup } from '../../hooks/useTasks';
import TaskFormModal from '../../components/tasks/TaskFormModal';
import NoteFormModal from '../../components/tasks/NoteFormModal';
import CommentsPanel from '../../components/tasks/CommentsPanel';

const FREQ_LABEL: Record<string, string> = {
  daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual', custom: 'Personalizada',
};

// ---------------------------------------------------------------------------
// Card de uma ocorrência de tarefa
// ---------------------------------------------------------------------------
function TaskCard({ occ, userId, userNames, groups, onToggle, onEdit, onDelete, onRespond, onMoveToGroup }: {
  occ: TaskOccurrenceRow;
  userId: string;
  userNames: Map<string, string>;
  groups: TaskGroup[];
  onToggle: (occ: TaskOccurrenceRow) => void;
  onEdit: (occ: TaskOccurrenceRow) => void;
  onDelete: (occ: TaskOccurrenceRow) => void;
  onRespond: (taskId: string, status: 'accepted' | 'declined') => void;
  onMoveToGroup: (occ: TaskOccurrenceRow, groupId: string | null) => void;
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

          <div className="flex items-center gap-3 flex-wrap">
            {isOwner && (
              <>
                <button onClick={() => onEdit(occ)}
                  className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1 transition-colors">
                  <Edit2 className="w-3 h-3" /> Editar tarefa
                </button>
                <button onClick={() => onDelete(occ)}
                  className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors">
                  <Trash2 className="w-3 h-3" /> Excluir {occ.recurrence_freq !== 'none' ? 'série' : ''}
                </button>
              </>
            )}
            {groups.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 ml-auto">
                <Folder className="w-3 h-3" />
                <select
                  value={occ.group_id || ''}
                  onChange={e => onMoveToGroup(occ, e.target.value || null)}
                  className="px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs focus:outline-none"
                >
                  <option value="">Sem grupo</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
          </div>

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
// Modal de criação/edição de grupo (lista)
// ---------------------------------------------------------------------------
const GROUP_COLORS = ['#6366f1', '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#0ea5e9'];

function GroupFormModal({ group, onClose, onSaved, onDeleted }: {
  group: TaskGroup | null;
  onClose: () => void;
  onSaved: (g: TaskGroup) => void;
  onDeleted: (id: string) => void;
}) {
  const { saveGroup, deleteGroup } = useTasks();
  const [name, setName]   = useState(group?.name || '');
  const [color, setColor] = useState(group?.color || '#6366f1');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || saving) return;
    setSaving(true);
    const saved = await saveGroup({ name, color }, group?.id);
    setSaving(false);
    if (saved) { onSaved(saved); onClose(); }
  }

  async function handleDelete() {
    if (!group) return;
    await deleteGroup(group.id);
    onDeleted(group.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {group ? 'Editar Grupo' : 'Novo Grupo'}
          </h2>
          <button onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 active:scale-95 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Nome *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Ex.: CNPJs, Compras Pendentes…"
              autoFocus
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Cor</label>
            <div className="flex gap-1.5 flex-wrap">
              {GROUP_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-800 scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          {group && (
            <button onClick={handleDelete}
              className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors">
              <Trash2 className="w-3 h-3" /> Excluir grupo (itens ficam "Sem grupo")
            </button>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {group ? 'Salvar' : 'Criar Grupo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card de anotação (clique abre o modal com o conteúdo)
// ---------------------------------------------------------------------------
function NoteCard({ note, userId, userNames, groups, onOpen, onDelete, onMoveToGroup }: {
  note: NoteRow;
  userId: string;
  userNames: Map<string, string>;
  groups: TaskGroup[];
  onOpen: (n: NoteRow) => void;
  onDelete: (n: NoteRow) => void;
  onMoveToGroup: (n: NoteRow, groupId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOwner = note.created_by === userId;
  const participantIds = useMemo(() => [
    note.created_by,
    ...(note.note_collaborators || []).map(c => c.user_id),
  ], [note]);

  return (
    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
      <div className="flex items-start gap-3">
        <StickyNote className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpen(note)}>
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
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => onOpen(note)}
              className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1 transition-colors">
              <Edit2 className="w-3 h-3" /> Abrir
            </button>
            {isOwner && (
              <button onClick={() => onDelete(note)}
                className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors">
                <Trash2 className="w-3 h-3" /> Excluir
              </button>
            )}
            {groups.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 ml-auto">
                <Folder className="w-3 h-3" />
                <select
                  value={note.group_id || ''}
                  onChange={e => onMoveToGroup(note, e.target.value || null)}
                  className="px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs focus:outline-none"
                >
                  <option value="">Sem grupo</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
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
    fetchNotes, deleteNote, fetchGroups, setItemGroup,
  } = useTasks();

  const [tab, setTab]               = useState<'tasks' | 'notes'>('tasks');
  const [occurrences, setOccurrences] = useState<TaskOccurrenceRow[]>([]);
  const [notes, setNotes]           = useState<NoteRow[]>([]);
  const [groups, setGroups]         = useState<TaskGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(''); // '' = Todas
  const [showGroupForm, setShowGroupForm]     = useState(false);
  const [editingGroup, setEditingGroup]       = useState<TaskGroup | null>(null);
  const [userNames, setUserNames]   = useState<Map<string, string>>(new Map());
  const [loading, setLoading]       = useState(true);
  const [showDone, setShowDone]     = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask]   = useState<TaskRow | null>(null);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [editingNote, setEditingNote]   = useState<NoteRow | null>(null);

  const filteredOccurrences = useMemo(
    () => selectedGroupId ? occurrences.filter(o => o.group_id === selectedGroupId) : occurrences,
    [occurrences, selectedGroupId],
  );
  const filteredNotes = useMemo(
    () => selectedGroupId ? notes.filter(n => n.group_id === selectedGroupId) : notes,
    [notes, selectedGroupId],
  );

  // Contagem de itens abertos por grupo (tarefas pendentes + anotações)
  const groupCounts = useMemo(() => {
    const map = new Map<string, number>();
    occurrences.filter(o => o.status !== 'done').forEach(o => {
      const k = o.group_id || '';
      map.set(k, (map.get(k) || 0) + 1);
    });
    notes.forEach(n => {
      const k = n.group_id || '';
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  }, [occurrences, notes]);

  const loadData = useCallback(async () => {
    if (!selectedHotel?.id || !user) return;
    setLoading(true);
    try {
      const from = format(addDays(new Date(), -30), 'yyyy-MM-dd');
      const to   = format(addDays(new Date(), 60), 'yyyy-MM-dd');
      const [occs, nts, grps] = await Promise.all([fetchOccurrences(from, to), fetchNotes(), fetchGroups()]);
      setOccurrences(occs);
      setNotes(nts);
      setGroups(grps);

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
  }, [selectedHotel?.id, user, fetchOccurrences, fetchNotes, fetchGroups]);

  useEffect(() => { loadData(); }, [loadData]);

  // Agrupamento: Atrasadas / Hoje / Próximas / Concluídas
  const sections = useMemo(() => {
    const today = startOfDay(new Date());
    const overdue: TaskOccurrenceRow[] = [];
    const todayList: TaskOccurrenceRow[] = [];
    const upcoming: TaskOccurrenceRow[] = [];
    const done: TaskOccurrenceRow[] = [];
    filteredOccurrences.forEach(o => {
      if (o.status === 'done') { done.push(o); return; }
      const d = parseISO(o.due_date);
      if (isToday(d)) todayList.push(o);
      else if (isBefore(d, today)) overdue.push(o);
      else upcoming.push(o);
    });
    done.sort((a, b) => b.due_date.localeCompare(a.due_date));
    return { overdue, todayList, upcoming, done };
  }, [filteredOccurrences]);

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

  async function handleMoveTask(occ: TaskOccurrenceRow, groupId: string | null) {
    await setItemGroup('task', occ.task_id, groupId);
    loadData();
  }

  async function handleMoveNote(n: NoteRow, groupId: string | null) {
    await setItemGroup('note', n.id, groupId);
    loadData();
  }

  const myNotes     = filteredNotes.filter(n => n.created_by === user?.id);
  const sharedNotes = filteredNotes.filter(n => n.created_by !== user?.id);

  function renderGroup(title: string, list: TaskOccurrenceRow[], accent?: string) {
    if (!list.length) return null;
    return (
      <div>
        <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${accent || 'text-slate-400 dark:text-slate-500'}`}>
          {title} ({list.length})
        </h3>
        <div className="space-y-2">
          {list.map(o => (
            <div key={o.occurrence_id} draggable onDragStart={e => onDragStartItem(e, 'task', o.task_id)}>
              <TaskCard
                occ={o}
                userId={user!.id}
                userNames={userNames}
                groups={groups}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onRespond={handleRespond}
                onMoveToGroup={handleMoveTask}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const selectedGroup = groups.find(g => g.id === selectedGroupId) || null;

  // ── Drag and drop: arrastar item para um grupo da sidebar ────────────────
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null); // '' = Todas

  function onDragStartItem(e: React.DragEvent, type: 'task' | 'note', id: string) {
    e.dataTransfer.setData('application/json', JSON.stringify({ type, id }));
    e.dataTransfer.effectAllowed = 'move';
  }

  async function handleDropOnGroup(e: React.DragEvent, groupId: string | null) {
    e.preventDefault();
    setDragOverGroup(null);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    try {
      const { type, id } = JSON.parse(raw);
      if (!type || !id) return;
      await setItemGroup(type, id, groupId);
      loadData();
    } catch { /* payload inválido */ }
  }

  const dropProps = (key: string, groupId: string | null) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverGroup(key); },
    onDragLeave: () => setDragOverGroup(d => (d === key ? null : d)),
    onDrop: (e: React.DragEvent) => handleDropOnGroup(e, groupId),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
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

      <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-4 items-start">
        {/* ── Sidebar de grupos (listas) ─────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-2 shadow-sm lg:sticky lg:top-4">
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible">
            <button
              onClick={() => setSelectedGroupId('')}
              {...dropProps('__all__', null)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-colors shrink-0 lg:shrink ${
                dragOverGroup === '__all__'
                  ? 'ring-2 ring-indigo-400 bg-indigo-50 dark:bg-indigo-900/30'
                  : !selectedGroupId
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
              }`}
              title="Solte aqui para remover do grupo"
            >
              <List className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">Todas</span>
              <span className="text-[10px] text-slate-400 hidden lg:inline">
                {(groupCounts.get('') || 0) + groups.reduce((s, g) => s + (groupCounts.get(g.id) || 0), 0)}
              </span>
            </button>

            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                onDoubleClick={() => { setEditingGroup(g); setShowGroupForm(true); }}
                {...dropProps(g.id, g.id)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-colors shrink-0 lg:shrink ${
                  dragOverGroup === g.id
                    ? 'ring-2 ring-indigo-400 bg-indigo-50 dark:bg-indigo-900/30'
                    : selectedGroupId === g.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
                title="Arraste itens para cá · duplo clique para editar"
              >
                <Folder className="w-4 h-4 shrink-0" style={{ color: g.color }} />
                <span className="flex-1 truncate">{g.name}</span>
                {(groupCounts.get(g.id) || 0) > 0 && (
                  <span className="text-[10px] text-slate-400 hidden lg:inline">{groupCounts.get(g.id)}</span>
                )}
                <span
                  role="button"
                  onClick={e => { e.stopPropagation(); setEditingGroup(g); setShowGroupForm(true); }}
                  className="hidden lg:block opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
                  title="Editar grupo"
                >
                  <Edit2 className="w-3 h-3" />
                </span>
              </button>
            ))}

            <button
              onClick={() => { setEditingGroup(null); setShowGroupForm(true); }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-400 hover:text-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors shrink-0 lg:shrink"
            >
              <FolderPlus className="w-4 h-4 shrink-0" />
              <span className="truncate">Novo grupo</span>
            </button>
          </div>
        </div>

        {/* ── Conteúdo ───────────────────────────────────────────────────── */}
        <div>
      {selectedGroup && (
        <div className="flex items-center gap-2 mb-3">
          <Folder className="w-4 h-4" style={{ color: selectedGroup.color }} />
          <h2 className="text-sm font-bold text-slate-800 dark:text-white">{selectedGroup.name}</h2>
        </div>
      )}

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
          {sections.overdue.length + sections.todayList.length + sections.upcoming.length + sections.done.length === 0 ? (
            <div className="text-center py-16">
              <CheckSquare className="w-10 h-10 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-400 dark:text-slate-500">Nenhuma tarefa por aqui. Crie a primeira!</p>
            </div>
          ) : (
            <>
              {renderGroup('Atrasadas', sections.overdue, 'text-red-500')}
              {renderGroup('Hoje', sections.todayList, 'text-indigo-500')}
              {renderGroup('Próximas', sections.upcoming)}
              {sections.done.length > 0 && (
                <div>
                  <button onClick={() => setShowDone(v => !v)}
                    className="text-xs font-bold uppercase tracking-wider text-emerald-500 mb-2 flex items-center gap-1">
                    Concluídas ({sections.done.length})
                    {showDone ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {showDone && (
                    <div className="space-y-2">
                      {sections.done.map(o => (
                        <div key={o.occurrence_id} draggable onDragStart={e => onDragStartItem(e, 'task', o.task_id)}>
                          <TaskCard
                            occ={o}
                            userId={user!.id}
                            userNames={userNames}
                            groups={groups}
                            onToggle={handleToggle}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onRespond={handleRespond}
                            onMoveToGroup={handleMoveTask}
                          />
                        </div>
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
          {filteredNotes.length === 0 ? (
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
                      <div key={n.id} draggable onDragStart={e => onDragStartItem(e, 'note', n.id)}>
                        <NoteCard note={n} userId={user!.id} userNames={userNames} groups={groups}
                          onOpen={nn => { setEditingNote(nn); setShowNoteForm(true); }}
                          onDelete={handleDeleteNote}
                          onMoveToGroup={handleMoveNote} />
                      </div>
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
                      <div key={n.id} draggable onDragStart={e => onDragStartItem(e, 'note', n.id)}>
                        <NoteCard note={n} userId={user!.id} userNames={userNames} groups={groups}
                          onOpen={nn => { setEditingNote(nn); setShowNoteForm(true); }}
                          onDelete={handleDeleteNote}
                          onMoveToGroup={handleMoveNote} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
        </div>
      </div>

      {/* Modals */}
      {showTaskForm && selectedHotel && (
        <TaskFormModal
          task={editingTask}
          hotelId={selectedHotel.id}
          groups={groups}
          defaultGroupId={selectedGroupId || null}
          onClose={() => { setShowTaskForm(false); setEditingTask(null); }}
          onSaved={loadData}
        />
      )}
      {showNoteForm && selectedHotel && (
        <NoteFormModal
          note={editingNote}
          hotelId={selectedHotel.id}
          groups={groups}
          defaultGroupId={selectedGroupId || null}
          onClose={() => { setShowNoteForm(false); setEditingNote(null); }}
          onSaved={loadData}
        />
      )}
      {showGroupForm && (
        <GroupFormModal
          group={editingGroup}
          onClose={() => { setShowGroupForm(false); setEditingGroup(null); }}
          onSaved={g => {
            setGroups(gs => {
              const exists = gs.some(x => x.id === g.id);
              return exists ? gs.map(x => x.id === g.id ? g : x) : [...gs, g];
            });
          }}
          onDeleted={id => {
            setGroups(gs => gs.filter(x => x.id !== id));
            if (selectedGroupId === id) setSelectedGroupId('');
            loadData();
          }}
        />
      )}
    </div>
  );
}
