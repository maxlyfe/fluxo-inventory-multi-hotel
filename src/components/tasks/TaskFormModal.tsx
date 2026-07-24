// src/components/tasks/TaskFormModal.tsx
// Modal de criação/edição de tarefa: recorrência (presets + personalizado),
// colaboradores anexados (convite) e modo de conclusão any/all

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import {
  X, Loader2, Users, Search, Check, Repeat, Bell, Globe,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTasks, TaskRow, TaskInput, TaskGroup, RecurrenceFreq, CompletionMode } from '../../hooks/useTasks';

const inputCls = 'w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors';
const labelCls = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  { value: 'none',    label: 'Não repete' },
  { value: 'daily',   label: 'Diária' },
  { value: 'weekly',  label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'yearly',  label: 'Anual' },
  { value: 'custom',  label: 'Personalizada' },
];

interface Person { user_id: string; name: string; sector: string | null }

export default function TaskFormModal({ task, hotelId, groups = [], defaultGroupId = null, onClose, onSaved }: {
  task: TaskRow | null;
  hotelId: string;
  groups?: TaskGroup[];
  defaultGroupId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { saveTask } = useTasks();

  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    due_date: task?.due_date || format(new Date(), 'yyyy-MM-dd'),
    due_time: task?.due_time?.slice(0, 5) || '',
    completion_mode: (task?.completion_mode || 'any') as CompletionMode,
    all_hotels: task ? task.hotel_id === null : false,
    notify_on_create: true,
  });
  const [groupId, setGroupId]       = useState<string>(task ? (task.group_id || '') : (defaultGroupId || ''));
  const [freq, setFreq]             = useState<RecurrenceFreq>(task?.recurrence_freq || 'none');
  const [interval, setIntervalN]    = useState(task?.recurrence_interval || 1);
  const [byWeekday, setByWeekday]   = useState<number[]>(task?.recurrence_byweekday || []);
  const [byMonthday, setByMonthday] = useState<number[]>(task?.recurrence_bymonthday || []);
  const [until, setUntil]           = useState(task?.recurrence_until || '');
  const [customBase, setCustomBase] = useState<'daily' | 'weekly' | 'monthly'>(
    task?.recurrence_bymonthday?.length ? 'monthly' : task?.recurrence_byweekday?.length ? 'weekly' : 'daily'
  );

  const [selUserIds, setSelUserIds]   = useState<string[]>(
    (task?.task_assignees || []).map(a => a.user_id)
  );
  const [people, setPeople]           = useState<Person[]>([]);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [saving, setSaving]           = useState(false);

  // Funcionários com login do hotel (mesmo padrão do EventsCalendar)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('employees')
        .select('user_id, name, sector')
        .eq('hotel_id', hotelId)
        .eq('status', 'active')
        .not('user_id', 'is', null)
        .order('name');
      setPeople(((data || []) as Person[]).filter(p => p.user_id !== user?.id));
    })();
  }, [hotelId, user?.id]);

  const filteredPeople = peopleSearch.trim()
    ? people.filter(p => p.name.toLowerCase().includes(peopleSearch.toLowerCase()))
    : people;

  const toggleNum = (arr: number[], v: number, set: (a: number[]) => void) =>
    set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const toggleStr = (arr: string[], v: string, set: (a: string[]) => void) =>
    set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const isShared = selUserIds.length > 0;
  const showCustom = freq === 'custom';
  const isRecurring = freq !== 'none';

  async function handleSave() {
    if (!form.title.trim() || !form.due_date || saving) return;
    setSaving(true);
    try {
      const input: TaskInput = {
        title: form.title,
        group_id: groupId || null,
        description: form.description,
        due_date: form.due_date,
        due_time: form.due_time || null,
        completion_mode: isShared ? form.completion_mode : 'any',
        recurrence_freq: freq,
        recurrence_interval: interval,
        recurrence_byweekday: showCustom && customBase === 'weekly' ? byWeekday
                            : freq === 'weekly' && byWeekday.length ? byWeekday : null,
        recurrence_bymonthday: showCustom && customBase === 'monthly' ? byMonthday : null,
        recurrence_until: isRecurring ? (until || null) : null,
        all_hotels: form.all_hotels,
        assignee_user_ids: selUserIds,
        notify_on_create: form.notify_on_create,
      };
      const id = await saveTask(input, task?.id);
      if (id) { onSaved(); onClose(); }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {task ? 'Editar Tarefa' : 'Nova Tarefa'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 active:scale-95 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Título */}
          <div>
            <label className={labelCls}>Título *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className={inputCls}
              placeholder="O que precisa ser feito?"
            />
          </div>

          {/* Data + Horário */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{isRecurring ? 'Início *' : 'Data *'}</label>
              <input
                type="date"
                value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Horário</label>
              <input
                type="time"
                value={form.due_time}
                onChange={e => setForm(f => ({ ...f, due_time: e.target.value }))}
                className={inputCls}
              />
            </div>
          </div>

          {/* Grupo */}
          {groups.length > 0 && (
            <div>
              <label className={labelCls}>Grupo</label>
              <select
                value={groupId}
                onChange={e => setGroupId(e.target.value)}
                className={inputCls}
              >
                <option value="">Sem grupo</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Descrição */}
          <div>
            <label className={labelCls}>Descrição</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className={`${inputCls} resize-none`}
              placeholder="Detalhes da tarefa…"
            />
          </div>

          {/* Recorrência */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Repeat className="w-3.5 h-3.5" /> Repetição
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {FREQ_OPTIONS.map(o => (
                <button key={o.value} type="button" onClick={() => setFreq(o.value)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    freq === o.value
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                  }`}>
                  {o.label}
                </button>
              ))}
            </div>

            {/* Dias da semana (semanal) */}
            {freq === 'weekly' && (
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1.5">
                  Dias da semana (vazio = mesmo dia da data de início)
                </label>
                <div className="flex gap-1.5">
                  {WEEKDAYS.map((d, i) => (
                    <button key={d} type="button" onClick={() => toggleNum(byWeekday, i, setByWeekday)}
                      className={`w-9 h-9 rounded-lg text-xs font-semibold border transition-all ${
                        byWeekday.includes(i)
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                      }`}>
                      {d[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Personalizada */}
            {showCustom && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-slate-600 dark:text-slate-300">A cada</span>
                  <input
                    type="number" min={1} value={interval}
                    onChange={e => setIntervalN(Math.max(parseInt(e.target.value) || 1, 1))}
                    className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <select
                    value={customBase}
                    onChange={e => setCustomBase(e.target.value as any)}
                    className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  >
                    <option value="daily">dia(s)</option>
                    <option value="weekly">semana(s)</option>
                    <option value="monthly">mês(es)</option>
                  </select>
                </div>

                {customBase === 'weekly' && (
                  <div className="flex gap-1.5">
                    {WEEKDAYS.map((d, i) => (
                      <button key={d} type="button" onClick={() => toggleNum(byWeekday, i, setByWeekday)}
                        className={`w-9 h-9 rounded-lg text-xs font-semibold border transition-all ${
                          byWeekday.includes(i)
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                        }`}>
                        {d[0]}
                      </button>
                    ))}
                  </div>
                )}

                {customBase === 'monthly' && (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1.5">
                      Dias do mês
                    </label>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                        <button key={d} type="button" onClick={() => toggleNum(byMonthday, d, setByMonthday)}
                          className={`h-8 rounded-lg text-xs font-medium border transition-all ${
                            byMonthday.includes(d)
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                          }`}>
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Intervalo simples para presets */}
            {isRecurring && !showCustom && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-300">A cada</span>
                <input
                  type="number" min={1} value={interval}
                  onChange={e => setIntervalN(Math.max(parseInt(e.target.value) || 1, 1))}
                  className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  {freq === 'daily' ? 'dia(s)' : freq === 'weekly' ? 'semana(s)' : freq === 'monthly' ? 'mês(es)' : 'ano(s)'}
                </span>
              </div>
            )}

            {/* Até quando */}
            {isRecurring && (
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1.5">
                  Repetir até (opcional)
                </label>
                <input
                  type="date"
                  value={until}
                  onChange={e => setUntil(e.target.value)}
                  className={inputCls}
                />
              </div>
            )}
          </div>

          {/* Colaboradores */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Colaboradores {selUserIds.length > 0 && `(${selUserIds.length})`}
            </h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-1">
              Cada colaborador recebe um convite e a tarefa aparece na agenda dele como pendente.
            </p>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <input type="text" value={peopleSearch} onChange={e => setPeopleSearch(e.target.value)}
                placeholder="Buscar pessoa…"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
            </div>
            <div className="max-h-36 overflow-y-auto space-y-0.5 rounded-lg border border-slate-100 dark:border-slate-700 p-1">
              {filteredPeople.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-3">Nenhum funcionário com acesso encontrado.</p>
              ) : filteredPeople.map(p => {
                const checked = selUserIds.includes(p.user_id);
                return (
                  <button key={p.user_id} type="button" onClick={() => toggleStr(selUserIds, p.user_id, setSelUserIds)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                      checked ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                    }`}>
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      checked ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 dark:border-slate-600'
                    }`}>
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="text-sm text-slate-700 dark:text-slate-200 truncate flex-1">{p.name}</span>
                    {p.sector && <span className="text-[10px] text-slate-400 shrink-0">{p.sector}</span>}
                  </button>
                );
              })}
            </div>

            {/* Modo de conclusão */}
            {isShared && (
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1.5">
                  Conclusão
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setForm(f => ({ ...f, completion_mode: 'any' }))}
                    className={`p-2.5 rounded-lg text-xs font-semibold border text-left transition-all ${
                      form.completion_mode === 'any'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                    }`}>
                    Qualquer um conclui
                    <span className="block font-normal opacity-80 mt-0.5">Basta 1 pessoa marcar como feita</span>
                  </button>
                  <button type="button" onClick={() => setForm(f => ({ ...f, completion_mode: 'all' }))}
                    className={`p-2.5 rounded-lg text-xs font-semibold border text-left transition-all ${
                      form.completion_mode === 'all'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                    }`}>
                    Todos concluem
                    <span className="block font-normal opacity-80 mt-0.5">Cada pessoa marca a sua conclusão</span>
                  </button>
                </div>
              </div>
            )}

            {isShared && !task && (
              <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                <input type="checkbox" checked={form.notify_on_create}
                  onChange={e => setForm(f => ({ ...f, notify_on_create: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-indigo-600" />
                <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-indigo-500" /> Notificar colaboradores agora
                </span>
              </label>
            )}
          </div>

          {/* Todas as unidades */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.all_hotels}
              onChange={e => setForm(f => ({ ...f, all_hotels: e.target.checked }))}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-indigo-600"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-400" /> Visível em todas as unidades
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.title.trim() || !form.due_date}
            className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {task ? 'Salvar Alterações' : 'Criar Tarefa'}
          </button>
        </div>
      </div>
    </div>
  );
}
