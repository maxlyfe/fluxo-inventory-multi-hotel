// src/pages/admin/GroupsManagement.tsx
// Gestão de grupos hoteleiros — EXCLUSIVO do dev (dono do SaaS).
// Cria/edita/ativa grupos e atribui hotéis a cada grupo.

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useNotification } from '../../context/NotificationContext';
import {
  Boxes, Plus, X, Loader2, Building2, Check, Edit3, Trash2,
  EyeOff, Eye, Search,
} from 'lucide-react';

interface Group {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
}
interface HotelRow {
  id: string;
  name: string;
  code: string;
  group_id: string | null;
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export default function GroupsManagement() {
  const { addNotification } = useNotification();
  const [groups, setGroups]   = useState<Group[]>([]);
  const [hotels, setHotels]   = useState<HotelRow[]>([]);
  const [loading, setLoading] = useState(true);

  // form de grupo
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<Group | null>(null);
  const [form, setForm]         = useState({ name: '', slug: '' });
  const [saving, setSaving]     = useState(false);

  // gerenciar hotéis de um grupo
  const [manageGroup, setManageGroup] = useState<Group | null>(null);
  const [hotelSearch, setHotelSearch] = useState('');
  const [busyHotel, setBusyHotel]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, h] = await Promise.all([
        supabase.from('groups').select('id, name, slug, is_active').order('name'),
        supabase.from('hotels').select('id, name, code, group_id').order('name'),
      ]);
      if (g.error) throw g.error;
      setGroups(g.data || []);
      setHotels((h.data as HotelRow[]) || []);
    } catch (e: any) {
      addNotification('Erro ao carregar grupos: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm({ name: '', slug: '' }); setShowForm(true); };
  const openEdit = (g: Group) => { setEditing(g); setForm({ name: g.name, slug: g.slug || '' }); setShowForm(true); };

  const saveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), slug: (form.slug.trim() || slugify(form.name)) };
      if (editing) {
        const { error } = await supabase.from('groups').update(payload).eq('id', editing.id);
        if (error) throw error;
        addNotification('Grupo atualizado.', 'success');
      } else {
        const { error } = await supabase.from('groups').insert(payload);
        if (error) throw error;
        addNotification('Grupo criado.', 'success');
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      addNotification('Erro ao salvar grupo: ' + (e.message?.includes('duplicate') ? 'slug já em uso.' : e.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleGroupActive = async (g: Group) => {
    try {
      const { error } = await supabase.from('groups').update({ is_active: !g.is_active }).eq('id', g.id);
      if (error) throw error;
      addNotification(g.is_active ? 'Grupo desativado.' : 'Grupo ativado.', 'success');
      load();
    } catch (e: any) {
      addNotification('Erro: ' + e.message, 'error');
    }
  };

  // Atribui / remove um hotel do grupo em gestão
  const toggleHotelInGroup = async (hotel: HotelRow) => {
    if (!manageGroup) return;
    const assignedHere = hotel.group_id === manageGroup.id;
    setBusyHotel(hotel.id);
    try {
      const { error } = await supabase
        .from('hotels')
        .update({ group_id: assignedHere ? null : manageGroup.id })
        .eq('id', hotel.id);
      if (error) throw error;
      setHotels(prev => prev.map(h => h.id === hotel.id ? { ...h, group_id: assignedHere ? null : manageGroup.id } : h));
    } catch (e: any) {
      addNotification('Erro ao atualizar hotel: ' + e.message, 'error');
    } finally {
      setBusyHotel(null);
    }
  };

  const hotelsOfGroup = (gid: string) => hotels.filter(h => h.group_id === gid).length;

  const filteredHotels = hotelSearch.trim()
    ? hotels.filter(h => h.name.toLowerCase().includes(hotelSearch.toLowerCase()) || (h.code || '').toLowerCase().includes(hotelSearch.toLowerCase()))
    : hotels;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Boxes className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Grupos Hoteleiros</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Clientes do sistema — exclusivo do dev</p>
          </div>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 text-sm font-semibold active:scale-95 transition-all">
          <Plus className="w-4 h-4" /> Novo Grupo
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Boxes className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum grupo cadastrado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(g => (
            <div key={g.id} className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 ${!g.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-800 dark:text-white truncate">{g.name}</h3>
                    {!g.is_active && <span className="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">INATIVO</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    <span className="font-mono">/{g.slug}</span> · {hotelsOfGroup(g.id)} hotel(éis)
                  </p>
                </div>
                <button onClick={() => setManageGroup(g)} title="Hotéis do grupo"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors">
                  <Building2 className="w-3.5 h-3.5" /> Hotéis
                </button>
                <button onClick={() => openEdit(g)} className="w-9 h-9 flex items-center justify-center rounded-xl text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Editar">
                  <Edit3 className="w-4 h-4" />
                </button>
                <button onClick={() => toggleGroupActive(g)} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" title={g.is_active ? 'Desativar' : 'Ativar'}>
                  {g.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-emerald-500" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal — novo/editar grupo */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={saveGroup} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">{editing ? 'Editar Grupo' : 'Novo Grupo'}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Nome do grupo *</label>
              <input type="text" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: editing ? f.slug : slugify(e.target.value) }))}
                className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" placeholder="Ex: Rede Acme Hotéis" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Slug (usado no link de acesso)</label>
              <input type="text" value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))}
                className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/40" placeholder="acme" />
              <p className="text-[11px] text-slate-400 mt-1">lyfehoteles.com.br/grupo/<span className="font-mono">{form.slug || 'slug'}</span></p>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancelar</button>
              <button type="submit" disabled={saving || !form.name.trim()} className="flex-1 py-3 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{editing ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal — hotéis do grupo */}
      {manageGroup && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg flex flex-col max-h-[90dvh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Hotéis de {manageGroup.name}</h2>
                <p className="text-xs text-slate-400">Marque os hotéis que pertencem a este grupo</p>
              </div>
              <button onClick={() => { setManageGroup(null); setHotelSearch(''); }} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" value={hotelSearch} onChange={e => setHotelSearch(e.target.value)} placeholder="Buscar hotel…"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
              </div>
              <div className="space-y-1.5 overflow-y-auto max-h-[55vh]">
                {filteredHotels.map(h => {
                  const here  = h.group_id === manageGroup.id;
                  const other = h.group_id && !here;
                  return (
                    <button key={h.id} onClick={() => toggleHotelInGroup(h)} disabled={busyHotel === h.id}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${here ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${here ? 'bg-violet-600 border-violet-600' : 'border-slate-300 dark:border-slate-600'}`}>
                        {busyHotel === h.id ? <Loader2 className="w-3 h-3 animate-spin text-slate-400" /> : here ? <Check className="w-3.5 h-3.5 text-white" /> : null}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{h.name}</span>
                        <span className="text-xs text-slate-400 ml-2">{h.code}</span>
                      </span>
                      {other && <span className="text-[10px] text-amber-500 font-semibold shrink-0">outro grupo</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
