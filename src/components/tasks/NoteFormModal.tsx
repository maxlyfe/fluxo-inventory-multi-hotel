// src/components/tasks/NoteFormModal.tsx
// Modal de criação/edição de anotação: individual ou compartilhada,
// com controle de edição pelos colaboradores (allow_edit)

import React, { useState, useEffect } from 'react';
import { X, Loader2, Users, Search, Check, Lock, Pencil, Globe } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTasks, NoteRow, TaskGroup } from '../../hooks/useTasks';

const inputCls = 'w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors';
const labelCls = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5';

interface Person { user_id: string; name: string; sector: string | null }

export default function NoteFormModal({ note, hotelId, groups = [], defaultGroupId = null, onClose, onSaved }: {
  note: NoteRow | null;
  hotelId: string;
  groups?: TaskGroup[];
  defaultGroupId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { saveNote } = useTasks();
  const isOwner = !note || note.created_by === user?.id;

  const [form, setForm] = useState({
    title: note?.title || '',
    content: note?.content || '',
    is_shared: note?.is_shared || false,
    allow_edit: note?.allow_edit || false,
    all_hotels: note ? note.hotel_id === null : false,
  });
  const [groupId, setGroupId]       = useState<string>(note ? (note.group_id || '') : (defaultGroupId || ''));
  const [selUserIds, setSelUserIds] = useState<string[]>(
    (note?.note_collaborators || []).map(c => c.user_id)
  );
  const [people, setPeople]         = useState<Person[]>([]);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (!isOwner) return;
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
  }, [hotelId, user?.id, isOwner]);

  const filteredPeople = peopleSearch.trim()
    ? people.filter(p => p.name.toLowerCase().includes(peopleSearch.toLowerCase()))
    : people;

  const toggle = (v: string) =>
    setSelUserIds(a => a.includes(v) ? a.filter(x => x !== v) : [...a, v]);

  async function handleSave() {
    if (!form.content.trim() || saving) return;
    setSaving(true);
    try {
      const id = await saveNote({
        title: form.title,
        content: form.content,
        is_shared: form.is_shared,
        allow_edit: form.allow_edit,
        collaborator_ids: selUserIds,
        all_hotels: form.all_hotels,
        group_id: groupId || null,
      }, note?.id, isOwner);
      if (id) { onSaved(); onClose(); }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {note ? 'Editar Anotação' : 'Nova Anotação'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 active:scale-95 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Título</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className={inputCls}
              placeholder="Título da anotação"
              disabled={!isOwner && !note?.allow_edit}
            />
          </div>

          <div>
            <label className={labelCls}>Conteúdo *</label>
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              rows={7}
              className={`${inputCls} resize-none`}
              placeholder="Escreva sua anotação…"
              disabled={!isOwner && !note?.allow_edit}
            />
          </div>

          {/* Grupo — só o dono */}
          {isOwner && groups.length > 0 && (
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

          {/* Compartilhamento — só o dono gerencia */}
          {isOwner && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={form.is_shared}
                  onChange={e => setForm(f => ({ ...f, is_shared: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-indigo-600" />
                <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-1.5 font-semibold">
                  <Users className="w-3.5 h-3.5 text-indigo-500" /> Compartilhar com colaboradores
                </span>
              </label>

              {form.is_shared && (
                <>
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
                        <button key={p.user_id} type="button" onClick={() => toggle(p.user_id)}
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

                  {/* Permitir edição */}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setForm(f => ({ ...f, allow_edit: false }))}
                      className={`p-2.5 rounded-lg text-xs font-semibold border text-left transition-all flex items-start gap-1.5 ${
                        !form.allow_edit
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                      }`}>
                      <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Somente leitura<span className="block font-normal opacity-80 mt-0.5">Só você edita</span></span>
                    </button>
                    <button type="button" onClick={() => setForm(f => ({ ...f, allow_edit: true }))}
                      className={`p-2.5 rounded-lg text-xs font-semibold border text-left transition-all flex items-start gap-1.5 ${
                        form.allow_edit
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                      }`}>
                      <Pencil className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Edição liberada<span className="block font-normal opacity-80 mt-0.5">Colaboradores editam</span></span>
                    </button>
                  </div>
                </>
              )}

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
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.content.trim() || (!isOwner && !note?.allow_edit)}
            className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {note ? 'Salvar Alterações' : 'Criar Anotação'}
          </button>
        </div>
      </div>
    </div>
  );
}
