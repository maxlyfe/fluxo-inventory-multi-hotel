// src/pages/portal/EventsCalendar.tsx
// Calendário de eventos com visibilidade programada, CRUD de eventos e tipos

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { usePermissions } from '../../hooks/usePermissions';
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  addMonths, subMonths, isToday, isSameDay, isSameMonth, isBefore,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Calendar, ChevronLeft, ChevronRight, Plus, X, Clock,
  MapPin, AlertCircle, Loader2, Trash2, Edit2, Check,
  Tag, Eye, EyeOff, Users, Building2, Globe, Briefcase, Bell, Search,
  CheckSquare, Square, Repeat,
} from 'lucide-react';
import { useTasks, TaskOccurrenceRow } from '../../hooks/useTasks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface EventType {
  id: string;
  hotel_id: string;
  name: string;
  color: string;
  icon: string | null;
  is_active: boolean;
}

interface EventItem {
  id: string;
  hotel_id: string | null;
  title: string;
  description: string | null;
  event_date: string;
  event_time: string | null;
  end_date: string | null;
  location: string | null;
  event_type_id: string | null;
  visibility_start: string | null;
  visibility_end: string | null;
  target_sectors: string[] | null;
  target_roles: string[] | null;
  is_mandatory: boolean;
  created_by: string | null;
  // Audiência dinâmica (participantes)
  audience_all_network?: boolean;
  audience_all_hotel?: boolean;
  target_user_ids?: string[] | null;
  notify_on_create?: boolean;
  event_types?: { name: string; color: string } | null;
}

interface ParticipantUser {
  user_id: string;
  name: string;
  sector: string | null;
}

// ---------------------------------------------------------------------------
// Input style helpers
// ---------------------------------------------------------------------------
const inputCls = 'w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors';
const labelCls = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5';

// ---------------------------------------------------------------------------
// Event Form Modal (Novo / Editar Evento)
// ---------------------------------------------------------------------------
function EventFormModal({ event, eventTypes, hotelId, onClose, onSaved }: {
  event: EventItem | null;
  eventTypes: EventType[];
  hotelId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    title: event?.title || '',
    description: event?.description || '',
    event_date: event?.event_date || format(new Date(), 'yyyy-MM-dd'),
    event_time: event?.event_time?.slice(0, 5) || '',
    end_date: event?.end_date || '',
    location: event?.location || '',
    event_type_id: event?.event_type_id || '',
    is_mandatory: event?.is_mandatory || false,
    visibility_start: event?.visibility_start
      ? format(parseISO(event.visibility_start), "yyyy-MM-dd'T'HH:mm") : '',
    visibility_end: event?.visibility_end
      ? format(parseISO(event.visibility_end), "yyyy-MM-dd'T'HH:mm") : '',
    apply_to_all_hotels: event?.hotel_id === null,
  });
  const [saving, setSaving] = useState(false);

  // ── Audiência (participantes) ──────────────────────────────────────────
  const [allNetwork, setAllNetwork]   = useState(event?.audience_all_network || false);
  const [allHotel, setAllHotel]       = useState(event?.audience_all_hotel || false);
  const [selSectors, setSelSectors]   = useState<string[]>(event?.target_sectors || []);
  const [selUserIds, setSelUserIds]   = useState<string[]>(event?.target_user_ids || []);
  const [notifyOnCreate, setNotifyOnCreate] = useState(event?.notify_on_create ?? true);

  const [sectors, setSectors]         = useState<string[]>([]);
  const [people, setPeople]           = useState<ParticipantUser[]>([]);
  const [peopleSearch, setPeopleSearch] = useState('');

  // Carrega setores do DP e funcionários com login (user_id) do hotel
  useEffect(() => {
    (async () => {
      const { data: emps } = await supabase
        .from('employees')
        .select('user_id, name, sector')
        .eq('hotel_id', hotelId)
        .eq('status', 'active')
        .not('user_id', 'is', null)
        .order('name');
      const list = (emps || []) as ParticipantUser[];
      setPeople(list);
      const { data: allEmps } = await supabase
        .from('employees')
        .select('sector')
        .eq('hotel_id', hotelId)
        .not('sector', 'is', null);
      const uniqueSectors = Array.from(new Set((allEmps || []).map((e: any) => e.sector).filter(Boolean))).sort();
      setSectors(uniqueSectors);
    })();
  }, [hotelId]);

  const toggle = (arr: string[], v: string, set: (a: string[]) => void) =>
    set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const filteredPeople = peopleSearch.trim()
    ? people.filter(p => p.name.toLowerCase().includes(peopleSearch.toLowerCase()))
    : people;

  const hasAudience = allNetwork || allHotel || selSectors.length > 0 || selUserIds.length > 0;

  async function handleSave() {
    if (!form.title.trim() || !form.event_date) return;
    setSaving(true);
    try {
      const payload: any = {
        hotel_id: form.apply_to_all_hotels ? null : hotelId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        event_date: form.event_date,
        event_time: form.event_time || null,
        end_date: form.end_date || null,
        location: form.location.trim() || null,
        event_type_id: form.event_type_id || null,
        is_mandatory: form.is_mandatory,
        visibility_start: form.visibility_start ? new Date(form.visibility_start).toISOString() : null,
        visibility_end: form.visibility_end ? new Date(form.visibility_end).toISOString() : null,
        audience_all_network: allNetwork,
        audience_all_hotel: allHotel,
        target_sectors: selSectors.length ? selSectors : null,
        target_user_ids: selUserIds.length ? selUserIds : null,
        notify_on_create: notifyOnCreate,
      };
      let eventId = event?.id;
      if (event) {
        await supabase.from('events').update(payload).eq('id', event.id);
      } else {
        payload.created_by = user?.id;
        const { data: created } = await supabase.from('events').insert(payload).select('id').single();
        eventId = created?.id;
      }

      // Notificar participantes na criação (opcional). Edge function resolve a
      // audiência com service role e dispara sino + push (sem o limite de 403).
      if (!event && eventId && notifyOnCreate && hasAudience) {
        try {
          await supabase.functions.invoke('event-reminders', {
            body: { mode: 'created', event_id: eventId },
          });
        } catch { /* best-effort */ }
      }

      onSaved();
      onClose();
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
            {event ? 'Editar Evento' : 'Novo Evento'}
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
              placeholder="Nome do evento"
            />
          </div>

          {/* Data + Horário */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Data *</label>
              <input
                type="date"
                value={form.event_date}
                onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Horário</label>
              <input
                type="time"
                value={form.event_time}
                onChange={e => setForm(f => ({ ...f, event_time: e.target.value }))}
                className={inputCls}
              />
            </div>
          </div>

          {/* Data Final + Local */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Data Final</label>
              <input
                type="date"
                value={form.end_date}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Local</label>
              <input
                type="text"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className={inputCls}
                placeholder="Salão, piscina…"
              />
            </div>
          </div>

          {/* Tipo */}
          <div>
            <label className={labelCls}>Tipo de Evento</label>
            <select
              value={form.event_type_id}
              onChange={e => setForm(f => ({ ...f, event_type_id: e.target.value }))}
              className={inputCls}
            >
              <option value="">Sem tipo</option>
              {eventTypes.filter(t => t.is_active).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Descrição */}
          <div>
            <label className={labelCls}>Descrição</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className={`${inputCls} resize-none`}
              placeholder="Detalhes do evento…"
            />
          </div>

          {/* Visibilidade Programada */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> Visibilidade Programada
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Visível a partir de</label>
                <input
                  type="datetime-local"
                  value={form.visibility_start}
                  onChange={e => setForm(f => ({ ...f, visibility_start: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Visível até</label>
                <input
                  type="datetime-local"
                  value={form.visibility_end}
                  onChange={e => setForm(f => ({ ...f, visibility_end: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Participantes (audiência) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Participantes
            </h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-1">
              Sem participantes = evento público do hotel. Com participantes = visível só para eles.
            </p>

            {/* Grupos rápidos */}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAllNetwork(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  allNetwork ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                }`}>
                <Globe className="w-3.5 h-3.5" /> Toda a rede
              </button>
              <button type="button" onClick={() => setAllHotel(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  allHotel ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                }`}>
                <Building2 className="w-3.5 h-3.5" /> Todo o hotel
              </button>
            </div>

            {/* Setores do DP */}
            {!allNetwork && !allHotel && sectors.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1 mb-1.5">
                  <Briefcase className="w-3 h-3" /> Por setor
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {sectors.map(s => (
                    <button key={s} type="button" onClick={() => toggle(selSectors, s, setSelSectors)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                        selSectors.includes(s) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Usuários individuais */}
            {!allNetwork && !allHotel && (
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1 mb-1.5">
                  <Users className="w-3 h-3" /> Pessoas {selUserIds.length > 0 && `(${selUserIds.length})`}
                </label>
                <div className="relative mb-1.5">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  <input type="text" value={peopleSearch} onChange={e => setPeopleSearch(e.target.value)}
                    placeholder="Buscar pessoa…"
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-0.5 rounded-lg border border-slate-100 dark:border-slate-700 p-1">
                  {filteredPeople.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-3">Nenhum funcionário com acesso encontrado.</p>
                  ) : filteredPeople.map(p => {
                    const checked = selUserIds.includes(p.user_id);
                    return (
                      <button key={p.user_id} type="button" onClick={() => toggle(selUserIds, p.user_id, setSelUserIds)}
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
              </div>
            )}

            {/* Notificar ao criar */}
            {hasAudience && (
              <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                <input type="checkbox" checked={notifyOnCreate}
                  onChange={e => setNotifyOnCreate(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-indigo-600" />
                <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-indigo-500" /> Notificar participantes agora
                </span>
              </label>
            )}
            {hasAudience && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Lembretes automáticos: 24h antes, na manhã do dia (7h) e 10 min antes.
              </p>
            )}
          </div>

          {/* Opções */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_mandatory}
                onChange={e => setForm(f => ({ ...f, is_mandatory: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-indigo-600"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">Obrigatório</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.apply_to_all_hotels}
                onChange={e => setForm(f => ({ ...f, apply_to_all_hotels: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-indigo-600"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">Todas as unidades</span>
            </label>
          </div>
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
            disabled={saving || !form.title.trim() || !form.event_date}
            className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {event ? 'Salvar Alterações' : 'Criar Evento'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event Type Manager Modal
// ---------------------------------------------------------------------------
function EventTypeManagerModal({ eventTypes, hotelId, onClose, onSaved }: {
  eventTypes: EventType[];
  hotelId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [types, setTypes]       = useState(eventTypes);
  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [saving, setSaving]     = useState(false);

  const COLORS = ['#6366f1', '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#0ea5e9'];

  async function addType() {
    if (!newName.trim()) return;
    setSaving(true);
    const { data } = await supabase
      .from('event_types')
      .insert({ hotel_id: hotelId, name: newName.trim(), color: newColor })
      .select()
      .single();
    if (data) { setTypes(t => [...t, data]); setNewName(''); }
    setSaving(false);
    onSaved();
  }

  async function toggleType(id: string, isActive: boolean) {
    await supabase.from('event_types').update({ is_active: !isActive }).eq('id', id);
    setTypes(t => t.map(x => x.id === id ? { ...x, is_active: !isActive } : x));
    onSaved();
  }

  async function deleteType(id: string) {
    await supabase.from('event_types').delete().eq('id', id);
    setTypes(t => t.filter(x => x.id !== id));
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Tipos de Evento</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 active:scale-95 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-[55vh] overflow-y-auto">
          {types.map(t => (
            <div key={t.id} className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
              <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
              <span className={`flex-1 text-sm ${t.is_active ? 'text-slate-800 dark:text-white' : 'text-slate-400 dark:text-slate-500 line-through'}`}>
                {t.name}
              </span>
              <button
                onClick={() => toggleType(t.id, t.is_active)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-all"
                title={t.is_active ? 'Desativar' : 'Ativar'}
              >
                {t.is_active
                  ? <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                  : <Eye className="w-3.5 h-3.5 text-emerald-500" />}
              </button>
              <button
                onClick={() => deleteType(t.id)}
                className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 active:scale-95 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </button>
            </div>
          ))}

          {/* Add new */}
          <div className="flex items-center gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <div className="flex gap-1 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`w-5 h-5 rounded-full transition-transform ${newColor === c ? 'ring-2 ring-offset-1 ring-slate-400 scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addType()}
              placeholder="Nome do tipo…"
              className="flex-1 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors"
            />
            <button
              onClick={addType}
              disabled={saving || !newName.trim()}
              className="p-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Calendar Component
// ---------------------------------------------------------------------------
export default function EventsCalendar() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();
  const { isAdmin, can } = usePermissions();
  const { fetchOccurrences, completeOccurrence, uncompleteOccurrence, respondInvite } = useTasks();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents]             = useState<EventItem[]>([]);
  const [taskOccs, setTaskOccs]         = useState<TaskOccurrenceRow[]>([]);
  const [showTasks, setShowTasks]       = useState(true);
  const [eventTypes, setEventTypes]     = useState<EventType[]>([]);
  const [myInvites, setMyInvites]       = useState<Record<string, string>>({}); // event_id → status
  const [loading, setLoading]           = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showEventForm, setShowEventForm]     = useState(false);
  const [editingEvent, setEditingEvent]       = useState<EventItem | null>(null);
  const [showTypeManager, setShowTypeManager] = useState(false);

  useEffect(() => {
    if (selectedHotel?.id) loadData();
  }, [selectedHotel?.id, currentMonth]);

  async function loadData() {
    setLoading(true);
    try {
      const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
      const monthEnd   = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

      const [eventsRes, typesRes] = await Promise.all([
        // RPC aplica a visibilidade por participante no servidor (eventos
        // privados só voltam para quem participa / criou).
        supabase.rpc('get_my_events', {
          p_hotel_id: selectedHotel!.id,
          p_from: monthStart,
          p_to: monthEnd,
        }),
        supabase
          .from('event_types')
          .select('*')
          .eq('hotel_id', selectedHotel!.id),
      ]);

      const types = typesRes.data || [];
      const typeMap = new Map(types.map((t: any) => [t.id, t]));
      const evs = ((eventsRes.data as any[]) || []).map(e => ({
        ...e,
        event_types: e.event_type_id && typeMap.get(e.event_type_id)
          ? { name: typeMap.get(e.event_type_id).name, color: typeMap.get(e.event_type_id).color }
          : null,
      }));
      setEvents(evs);
      setEventTypes(types);

      // Minhas respostas a convites (aceito/recusado)
      const eventIds = evs.map(e => e.id);
      const inviteMap: Record<string, string> = {};
      if (eventIds.length && user) {
        const { data: inv } = await supabase
          .from('event_invitations')
          .select('event_id, status')
          .eq('user_id', user.id)
          .in('event_id', eventIds);
        (inv || []).forEach((i: any) => { inviteMap[i.event_id] = i.status; });
      }
      setMyInvites(inviteMap);

      // Tarefas do período (mesma janela do calendário)
      if (can('tasks')) {
        setTaskOccs(await fetchOccurrences(monthStart, monthEnd));
      }
    } finally {
      setLoading(false);
    }
  }

  // Tarefas agrupadas por data
  const tasksByDate = useMemo(() => {
    const map = new Map<string, TaskOccurrenceRow[]>();
    if (!showTasks) return map;
    taskOccs.forEach(o => {
      if (!map.has(o.due_date)) map.set(o.due_date, []);
      map.get(o.due_date)!.push(o);
    });
    return map;
  }, [taskOccs, showTasks]);

  async function handleTaskToggle(occ: TaskOccurrenceRow) {
    if (occ.i_completed || occ.status === 'done') {
      await uncompleteOccurrence(occ.occurrence_id);
    } else {
      await completeOccurrence(occ.occurrence_id, occ.title, occ.created_by);
    }
    loadData();
  }

  async function handleTaskInvite(taskId: string, status: 'accepted' | 'declined') {
    await respondInvite(taskId, status);
    loadData();
  }

  // Papel do usuário em relação ao evento
  function eventRole(ev: EventItem) {
    const isOwner = ev.created_by === user?.id;
    const isPublic = !(
      ev.audience_all_network || ev.audience_all_hotel ||
      (ev.target_sectors?.length) || (ev.target_user_ids?.length)
    );
    const isInvite = !isOwner && !isPublic;
    const inviteStatus = myInvites[ev.id] || 'pending';
    return { isOwner, isPublic, isInvite, inviteStatus };
  }

  // Aceitar / recusar convite (não bloqueia agenda até aceitar)
  async function handleInviteResponse(eventId: string, status: 'accepted' | 'declined') {
    if (!user) return;
    await supabase.from('event_invitations').upsert(
      { event_id: eventId, user_id: user.id, status, responded_at: new Date().toISOString() },
      { onConflict: 'event_id,user_id' },
    );
    setMyInvites(m => ({ ...m, [eventId]: status }));
  }

  const visibleEvents = useMemo(() => {
    const now = new Date();
    return events.filter(ev => {
      // Convites recusados não bloqueiam a agenda (somem da grade)
      const isOwner = ev.created_by === user?.id;
      const isPublic = !(
        ev.audience_all_network || ev.audience_all_hotel ||
        (ev.target_sectors?.length) || (ev.target_user_ids?.length)
      );
      if (!isOwner && !isPublic && myInvites[ev.id] === 'declined') return false;
      // Visibilidade programada (admin vê tudo)
      if (!isAdmin) {
        if (ev.visibility_start && isBefore(now, parseISO(ev.visibility_start))) return false;
        if (ev.visibility_end && isBefore(parseISO(ev.visibility_end), now)) return false;
      }
      return true;
    });
  }, [events, isAdmin, myInvites, user?.id]);

  const monthStart     = startOfMonth(currentMonth);
  const monthEnd       = endOfMonth(currentMonth);
  const calendarDays   = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    visibleEvents.forEach(ev => {
      const key = ev.event_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    });
    return map;
  }, [visibleEvents]);

  const selectedDateEvents = selectedDate ? (eventsByDate.get(selectedDate) || []) : [];
  const selectedDateTasks  = selectedDate ? (tasksByDate.get(selectedDate) || []) : [];

  async function handleDeleteEvent(eventId: string) {
    await supabase.from('events').delete().eq('id', eventId);
    loadData();
  }

  const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Calendário de Eventos</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{selectedHotel?.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowTypeManager(true)}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 active:scale-95 transition-all"
              title="Gerenciar tipos"
            >
              <Tag className="w-4 h-4" />
            </button>
          )}
          {/* Qualquer usuário pode criar eventos (agenda pessoal + convites) */}
          <button
            onClick={() => { setEditingEvent(null); setShowEventForm(true); }}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-semibold active:scale-95 transition-all shadow-sm shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" /> Novo Evento
          </button>
        </div>
      </div>

      {/* ── Month Navigation ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 mb-4 shadow-sm">
        <button
          onClick={() => setCurrentMonth(m => subMonths(m, 1))}
          className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 active:scale-95 transition-all"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-slate-800 dark:text-white capitalize">
            {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
          </span>
          {can('tasks') && taskOccs.length > 0 && (
            <button
              onClick={() => setShowTasks(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                showTasks
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                  : 'bg-slate-50 dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600'
              }`}
              title={showTasks ? 'Ocultar tarefas' : 'Mostrar tarefas'}
            >
              <CheckSquare className="w-3 h-3" /> Tarefas
            </button>
          )}
        </div>
        <button
          onClick={() => setCurrentMonth(m => addMonths(m, 1))}
          className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 active:scale-95 transition-all"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Calendar Grid ────────────────────────────────────────────── */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEKDAYS.map(d => (
                <div key={d} className="text-center text-xs font-semibold text-slate-400 dark:text-slate-500 py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: startDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="h-16" />
              ))}

              {calendarDays.map(day => {
                const dateStr  = format(day, 'yyyy-MM-dd');
                const dayEvs   = eventsByDate.get(dateStr) || [];
                const dayTasks = tasksByDate.get(dateStr) || [];
                const isCurrent  = isToday(day);
                const isSelected = selectedDate === dateStr;

                return (
                  <button
                    key={dateStr}
                    onClick={() => setSelectedDate(dateStr)}
                    className={`h-16 p-1.5 rounded-xl text-left transition-colors ${
                      isSelected
                        ? 'bg-indigo-100 dark:bg-indigo-900/30 ring-2 ring-indigo-400'
                        : isCurrent
                          ? 'bg-indigo-50 dark:bg-indigo-900/10'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    <div className={`text-xs font-bold ${
                      isCurrent ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'
                    }`}>
                      {format(day, 'd')}
                    </div>
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {dayEvs.slice(0, 3).map(ev => (
                        <div
                          key={ev.id}
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: ev.event_types?.color || '#6366f1' }}
                          title={ev.title}
                        />
                      ))}
                      {dayEvs.length > 3 && (
                        <span className="text-[10px] text-slate-400">+{dayEvs.length - 3}</span>
                      )}
                      {dayTasks.slice(0, 3).map(t => (
                        <div
                          key={t.occurrence_id}
                          className={`w-2 h-2 rounded-[3px] ${t.status === 'done' ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-emerald-500'}`}
                          title={`Tarefa: ${t.title}`}
                        />
                      ))}
                      {dayTasks.length > 3 && (
                        <span className="text-[10px] text-emerald-500">+{dayTasks.length - 3}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Day Detail Panel ─────────────────────────────────────────── */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
            {selectedDate ? (
              <>
                <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-3 capitalize">
                  {format(parseISO(selectedDate), "dd 'de' MMMM, EEEE", { locale: ptBR })}
                </h3>

                {selectedDateEvents.length === 0 && selectedDateTasks.length === 0 ? (
                  <div className="text-center py-8">
                    <Calendar className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-2" />
                    <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum evento neste dia</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedDateEvents.map(ev => (
                      <div
                        key={ev.id}
                        className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ev.event_types?.color || '#6366f1' }} />
                              <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{ev.title}</p>
                            </div>
                            {ev.event_types && (
                              <span className="text-xs text-slate-500 dark:text-slate-400">{ev.event_types.name}</span>
                            )}
                          </div>
                          {ev.is_mandatory && (
                            <span className="shrink-0 text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300 px-1.5 py-0.5 rounded-full font-medium">
                              Obrigatório
                            </span>
                          )}
                        </div>

                        {ev.event_time && (
                          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <Clock className="w-3 h-3" /> {ev.event_time.slice(0, 5)}
                          </div>
                        )}
                        {ev.location && (
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 dark:text-slate-400">
                            <MapPin className="w-3 h-3" /> {ev.location}
                          </div>
                        )}
                        {ev.description && (
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">{ev.description}</p>
                        )}

                        {/* Ações de gestão — admin ou criador do evento */}
                        {(isAdmin || ev.created_by === user?.id) && (
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                            <button
                              onClick={() => { setEditingEvent(ev); setShowEventForm(true); }}
                              className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-0.5 transition-colors"
                            >
                              <Edit2 className="w-3 h-3" /> Editar
                            </button>
                            <span className="text-slate-300 dark:text-slate-600">·</span>
                            <button
                              onClick={() => handleDeleteEvent(ev.id)}
                              className="text-xs text-red-500 hover:text-red-600 flex items-center gap-0.5 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" /> Excluir
                            </button>
                            {ev.visibility_start && (
                              <>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                  <Eye className="w-3 h-3" />
                                  {format(parseISO(ev.visibility_start), 'dd/MM HH:mm')}
                                </span>
                              </>
                            )}
                          </div>
                        )}

                        {/* Convite — participante (não-criador) de evento privado */}
                        {(() => {
                          const role = eventRole(ev);
                          if (role.isOwner || role.isPublic) return null;
                          if (role.inviteStatus === 'accepted') {
                            return (
                              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                  <Check className="w-3 h-3" /> Você confirmou
                                </span>
                                <button
                                  onClick={() => handleInviteResponse(ev.id, 'declined')}
                                  className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                                >
                                  Cancelar presença
                                </button>
                              </div>
                            );
                          }
                          // pending
                          return (
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                              <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold mr-auto">
                                Convite pendente
                              </span>
                              <button
                                onClick={() => handleInviteResponse(ev.id, 'accepted')}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors"
                              >
                                <Check className="w-3 h-3" /> Aceitar
                              </button>
                              <button
                                onClick={() => handleInviteResponse(ev.id, 'declined')}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors"
                              >
                                <X className="w-3 h-3" /> Recusar
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Tarefas do dia ──────────────────────────────────── */}
                {selectedDateTasks.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-500 mb-2 flex items-center gap-1">
                      <CheckSquare className="w-3 h-3" /> Tarefas
                    </h4>
                    <div className="space-y-2">
                      {selectedDateTasks.map(t => {
                        const isTaskOwner = t.created_by === user?.id;
                        const isPendingInvite = !isTaskOwner && t.my_assignee_status === 'pending';
                        const isDone = t.status === 'done';
                        return (
                          <div key={t.occurrence_id}
                            className={`p-3 rounded-xl border ${
                              isPendingInvite
                                ? 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10'
                                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900'
                            }`}>
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => !isPendingInvite && handleTaskToggle(t)}
                                disabled={isPendingInvite}
                                className="mt-0.5 shrink-0 disabled:opacity-40"
                              >
                                {isDone || t.i_completed
                                  ? <CheckSquare className="w-4 h-4 text-emerald-500" />
                                  : <Square className="w-4 h-4 text-slate-300 dark:text-slate-600 hover:text-emerald-500 transition-colors" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-semibold truncate ${
                                  isDone ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-white'
                                }`}>
                                  {t.title}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                  {t.due_time && (
                                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {t.due_time.slice(0, 5)}</span>
                                  )}
                                  {t.recurrence_freq !== 'none' && (
                                    <span className="flex items-center gap-1 text-indigo-500"><Repeat className="w-3 h-3" /> Recorrente</span>
                                  )}
                                  {t.is_shared && (
                                    <span className="flex items-center gap-1 text-violet-500"><Users className="w-3 h-3" /> Compartilhada</span>
                                  )}
                                </div>
                                {isPendingInvite && (
                                  <div className="flex items-center gap-2 mt-2">
                                    <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold mr-auto">Convite pendente</span>
                                    <button onClick={() => handleTaskInvite(t.task_id, 'accepted')}
                                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors">
                                      <Check className="w-3 h-3" /> Aceitar
                                    </button>
                                    <button onClick={() => handleTaskInvite(t.task_id, 'declined')}
                                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors">
                                      <X className="w-3 h-3" /> Recusar
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <Calendar className="w-10 h-10 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-slate-400 dark:text-slate-500">Selecione um dia para ver os eventos</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showEventForm && selectedHotel && (
        <EventFormModal
          event={editingEvent}
          eventTypes={eventTypes}
          hotelId={selectedHotel.id}
          onClose={() => { setShowEventForm(false); setEditingEvent(null); }}
          onSaved={loadData}
        />
      )}

      {showTypeManager && selectedHotel && (
        <EventTypeManagerModal
          eventTypes={eventTypes}
          hotelId={selectedHotel.id}
          onClose={() => setShowTypeManager(false)}
          onSaved={loadData}
        />
      )}
    </div>
  );
}
