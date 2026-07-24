// src/components/widgets/TasksTodayWidget.tsx
// Widget do dashboard: atalho visual da tela "Hoje" de /portal/tasks —
// cabeçalho com o dia, tarefas agrupadas pelos grupos do usuário e
// conclusão rápida (global). Clicar no widget abre a tela de Tarefas.

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CheckSquare, Square, Loader2, ChevronRight, Clock, Sun, Folder, List,
  Repeat, Users,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useTasks, TaskOccurrenceRow, TaskGroup } from '../../hooks/useTasks';

export default function TasksTodayWidget() {
  const { selectedHotel } = useHotel();
  const { fetchOccurrences, fetchGroups, completeOccurrence, uncompleteOccurrence } = useTasks();
  const navigate = useNavigate();

  const [occs, setOccs] = useState<TaskOccurrenceRow[]>([]);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const from = format(addDays(new Date(), -30), 'yyyy-MM-dd');
    const [all, grps] = await Promise.all([fetchOccurrences(from, todayStr), fetchGroups()]);
    // Pendentes de hoje + atrasadas (1 por tarefa, a mais antiga)
    const byTask = new Map<string, TaskOccurrenceRow>();
    all.forEach(o => {
      if (o.status === 'done') return;
      const cur = byTask.get(o.task_id);
      if (!cur || o.due_date < cur.due_date) byTask.set(o.task_id, o);
    });
    const list = [...byTask.values()].sort((a, b) =>
      a.due_date.localeCompare(b.due_date) || (a.due_time || '99').localeCompare(b.due_time || '99'));
    setOccs(list);
    setGroups(grps);
    setLoading(false);
  }, [selectedHotel?.id, fetchOccurrences, fetchGroups]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  async function toggle(e: React.MouseEvent, o: TaskOccurrenceRow) {
    e.stopPropagation();
    if (o.i_completed || o.status === 'done') await uncompleteOccurrence(o.occurrence_id);
    else await completeOccurrence(o.occurrence_id, o.title, o.created_by);
    load();
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const overdueCount = occs.filter(o => o.due_date < todayStr).length;

  // Agrupar pelos grupos pessoais (como na tela Hoje)
  const byGroup = new Map<string, TaskOccurrenceRow[]>();
  occs.forEach(o => {
    const k = o.group_id || '';
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(o);
  });

  if (loading) {
    return (
      <div className="rounded-3xl p-6 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center h-full min-h-[160px]">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div
      onClick={() => navigate('/portal/tasks')}
      className="group/tw relative rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm h-full flex flex-col overflow-hidden cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-lg hover:shadow-emerald-500/10 transition-all"
      title="Abrir Tarefas"
    >
      {/* Cabeçalho — espelho da barra da tela Hoje */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent dark:from-emerald-500/15 dark:via-teal-500/5 border-b border-slate-100 dark:border-slate-700/60">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center shrink-0">
            <Sun className="w-4 h-4 text-amber-500" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-tight truncate">
              Hoje · {format(new Date(), "dd 'de' MMMM", { locale: ptBR })}
            </p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
              {occs.length === 0
                ? 'Tudo em dia'
                : `${occs.length} pendente${occs.length > 1 ? 's' : ''}${overdueCount > 0 ? ` · ${overdueCount} atrasada${overdueCount > 1 ? 's' : ''}` : ''}`}
            </p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover/tw:text-emerald-500 group-hover/tw:translate-x-0.5 transition-all shrink-0" />
      </div>

      {/* Corpo — grupos e tarefas, como na tela Hoje */}
      {occs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 px-4">
          <Sun className="w-8 h-8 text-amber-200 dark:text-amber-900 mb-2" />
          <p className="text-xs text-slate-400 dark:text-slate-500">Nada pendente. Dia livre!</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2.5 max-h-56">
          {[...byGroup.entries()]
            .sort(([a], [b]) => {
              const na = groups.find(g => g.id === a)?.name || 'zzz';
              const nb = groups.find(g => g.id === b)?.name || 'zzz';
              return na.localeCompare(nb);
            })
            .map(([gid, list]) => {
              const g = groups.find(x => x.id === gid) || null;
              return (
                <div key={gid || '__none__'}>
                  <div className="flex items-center gap-1.5 px-1 mb-1">
                    {g
                      ? <Folder className="w-3 h-3 shrink-0" style={{ color: g.color }} />
                      : <List className="w-3 h-3 shrink-0 text-slate-400" />}
                    <span className="text-[10px] font-black uppercase tracking-widest truncate"
                      style={{ color: g?.color || undefined }}>
                      <span className={g ? '' : 'text-slate-400'}>{g?.name || 'Sem grupo'}</span>
                    </span>
                    <span className="text-[10px] text-slate-400">({list.length})</span>
                  </div>
                  <div className="space-y-1">
                    {list.slice(0, 4).map(o => {
                      const isOverdue = o.due_date < todayStr;
                      return (
                        <div key={o.occurrence_id}
                          className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-colors ${
                            isOverdue
                              ? 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10'
                              : 'border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/50'
                          }`}>
                          <button onClick={e => toggle(e, o)} className="shrink-0" title="Concluir">
                            {o.i_completed
                              ? <CheckSquare className="w-4 h-4 text-emerald-500" />
                              : <Square className={`w-4 h-4 ${isOverdue ? 'text-red-400' : 'text-slate-300 dark:text-slate-600'} hover:text-emerald-500 transition-colors`} />}
                          </button>
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate flex-1">
                            {o.title}
                          </span>
                          {o.recurrence_freq !== 'none' && (
                            <Repeat className="w-3 h-3 text-indigo-400 shrink-0" title="Recorrente" />
                          )}
                          {o.is_shared && (
                            <Users className="w-3 h-3 text-violet-400 shrink-0" title="Compartilhada" />
                          )}
                          {o.due_time && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-0.5 shrink-0">
                              <Clock className="w-2.5 h-2.5" /> {o.due_time.slice(0, 5)}
                            </span>
                          )}
                          {isOverdue && (
                            <span className="text-[9px] font-black text-red-500 shrink-0">
                              {format(new Date(o.due_date + 'T12:00:00'), 'dd/MM')}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {list.length > 4 && (
                      <p className="text-[10px] text-slate-400 px-1">+{list.length - 4} neste grupo…</p>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Rodapé */}
      <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tarefas</span>
        <span className="flex items-center gap-1 text-[11px] font-black text-emerald-600 dark:text-emerald-400 uppercase">
          Abrir <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </div>
  );
}
