// src/components/widgets/TasksTodayWidget.tsx
// Widget do dashboard: tarefas de hoje (+atrasadas) com conclusão rápida
// e botão que leva para /portal/tasks

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { CheckSquare, Square, Loader2, ChevronRight, Clock } from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useTasks, TaskOccurrenceRow } from '../../hooks/useTasks';

export default function TasksTodayWidget() {
  const { selectedHotel } = useHotel();
  const { fetchOccurrences, completeOccurrence, uncompleteOccurrence } = useTasks();
  const navigate = useNavigate();

  const [occs, setOccs] = useState<TaskOccurrenceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const from = format(addDays(new Date(), -30), 'yyyy-MM-dd');
    const all = await fetchOccurrences(from, todayStr);
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
    setLoading(false);
  }, [selectedHotel?.id, fetchOccurrences]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  async function toggle(o: TaskOccurrenceRow) {
    if (o.i_completed || o.status === 'done') await uncompleteOccurrence(o.occurrence_id);
    else await completeOccurrence(o.occurrence_id, o.title, o.created_by);
    load();
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const overdueCount = occs.filter(o => o.due_date < todayStr).length;

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 flex items-center justify-center h-full min-h-[140px]">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl shrink-0">
            <CheckSquare className="w-4 h-4 text-emerald-500" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-white text-xs truncate">Tarefas de Hoje</h3>
        </div>
        {occs.length > 0 && (
          <span className="text-[10px] font-black text-white bg-emerald-500 rounded-full px-2 py-0.5 shrink-0">
            {occs.length}
          </span>
        )}
      </div>

      {occs.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500 flex-1">Tudo em dia. Nada pendente!</p>
      ) : (
        <div className="space-y-1.5 flex-1 overflow-y-auto max-h-44 pr-1">
          {occs.slice(0, 6).map(o => {
            const isOverdue = o.due_date < todayStr;
            return (
              <div key={o.occurrence_id} className="flex items-center gap-2">
                <button onClick={() => toggle(o)} className="shrink-0" title="Concluir">
                  {o.i_completed
                    ? <CheckSquare className="w-4 h-4 text-emerald-500" />
                    : <Square className={`w-4 h-4 ${isOverdue ? 'text-red-400' : 'text-slate-300 dark:text-slate-600'} hover:text-emerald-500 transition-colors`} />}
                </button>
                <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1">{o.title}</span>
                {o.due_time && (
                  <span className="text-[10px] text-slate-400 flex items-center gap-0.5 shrink-0">
                    <Clock className="w-2.5 h-2.5" /> {o.due_time.slice(0, 5)}
                  </span>
                )}
                {isOverdue && (
                  <span className="text-[9px] font-bold text-red-500 shrink-0">
                    {format(new Date(o.due_date + 'T12:00:00'), 'dd/MM')}
                  </span>
                )}
              </div>
            );
          })}
          {occs.length > 6 && (
            <p className="text-[10px] text-slate-400">+{occs.length - 6} tarefas…</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        {overdueCount > 0 ? (
          <span className="text-[10px] font-bold text-red-500">{overdueCount} atrasada{overdueCount > 1 ? 's' : ''}</span>
        ) : <span />}
        <button
          onClick={() => navigate('/portal/tasks')}
          className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors"
        >
          Abrir Tarefas <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
