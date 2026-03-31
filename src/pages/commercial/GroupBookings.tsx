// src/pages/commercial/GroupBookings.tsx
// Gestão de reservas de grupo com vínculos a clientes corporativos

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { format, parseISO, differenceInDays } from 'date-fns';
import {
  Users, Search, Loader2, Plus, Edit2, Trash2,
  Calendar, DollarSign, BedDouble, CheckCircle, XCircle, Clock, Briefcase,
} from 'lucide-react';

interface GroupBooking {
  id: string;
  hotel_id: string;
  client_id: string | null;
  event_name: string;
  check_in: string;
  check_out: string;
  rooms_blocked: number;
  rate_per_night: number | null;
  total_value: number | null;
  status: string;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
  corporate_clients?: { company_name: string } | null;
}

interface CorpClient { id: string; company_name: string; }

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  tentative:  { label: 'Tentativa',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  confirmed:  { label: 'Confirmada', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  cancelled:  { label: 'Cancelada',  color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  completed:  { label: 'Concluída',  color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
};

export default function GroupBookings() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();

  const [bookings, setBookings] = useState<GroupBooking[]>([]);
  const [clients, setClients] = useState<CorpClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formClientId, setFormClientId] = useState('');
  const [formEvent, setFormEvent] = useState('');
  const [formCheckIn, setFormCheckIn] = useState('');
  const [formCheckOut, setFormCheckOut] = useState('');
  const [formRooms, setFormRooms] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formTotal, setFormTotal] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (selectedHotel?.id) loadData();
  }, [selectedHotel?.id]);

  async function loadData() {
    setLoading(true);
    const [bkRes, clRes] = await Promise.all([
      supabase
        .from('group_bookings')
        .select('*, corporate_clients(company_name)')
        .eq('hotel_id', selectedHotel!.id)
        .order('check_in', { ascending: false }),
      supabase
        .from('corporate_clients')
        .select('id, company_name')
        .eq('hotel_id', selectedHotel!.id)
        .eq('is_active', true)
        .order('company_name'),
    ]);
    setBookings(bkRes.data || []);
    setClients(clRes.data || []);
    setLoading(false);
  }

  function resetForm() {
    setFormClientId(''); setFormEvent(''); setFormCheckIn(''); setFormCheckOut('');
    setFormRooms(''); setFormRate(''); setFormTotal(''); setFormContact('');
    setFormPhone(''); setFormNotes('');
    setEditingId(null); setShowForm(false);
  }

  function startEdit(b: GroupBooking) {
    setFormClientId(b.client_id || ''); setFormEvent(b.event_name);
    setFormCheckIn(b.check_in); setFormCheckOut(b.check_out);
    setFormRooms(b.rooms_blocked.toString()); setFormRate(b.rate_per_night?.toString() || '');
    setFormTotal(b.total_value?.toString() || ''); setFormContact(b.contact_name || '');
    setFormPhone(b.contact_phone || ''); setFormNotes(b.notes || '');
    setEditingId(b.id); setShowForm(true);
  }

  async function saveBooking() {
    if (!formEvent.trim() || !formCheckIn || !formCheckOut || !formRooms || !selectedHotel) return;
    setSaving(true);
    const payload = {
      hotel_id: selectedHotel.id,
      client_id: formClientId || null,
      event_name: formEvent.trim(),
      check_in: formCheckIn,
      check_out: formCheckOut,
      rooms_blocked: parseInt(formRooms),
      rate_per_night: formRate ? parseFloat(formRate) : null,
      total_value: formTotal ? parseFloat(formTotal) : null,
      contact_name: formContact.trim() || null,
      contact_phone: formPhone.trim() || null,
      notes: formNotes.trim() || null,
    };
    if (editingId) {
      await supabase.from('group_bookings').update(payload).eq('id', editingId);
    } else {
      await supabase.from('group_bookings').insert({ ...payload, created_by: user?.id });
    }
    setSaving(false); resetForm(); loadData();
  }

  async function changeStatus(id: string, status: string) {
    await supabase.from('group_bookings').update({ status }).eq('id', id);
    loadData();
  }

  async function deleteBooking(id: string) {
    if (!confirm('Remover esta reserva de grupo?')) return;
    await supabase.from('group_bookings').delete().eq('id', id);
    loadData();
  }

  const filtered = useMemo(() => {
    return bookings.filter(b => {
      if (search && !b.event_name.toLowerCase().includes(search.toLowerCase()) && !(b.corporate_clients?.company_name || '').toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus && b.status !== filterStatus) return false;
      return true;
    });
  }, [bookings, search, filterStatus]);

  const totalRooms = bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + b.rooms_blocked, 0);
  const totalRevenue = bookings.filter(b => b.status === 'confirmed' || b.status === 'completed').reduce((s, b) => s + (b.total_value || 0), 0);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reservas de Grupo</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{totalRooms} UHs confirmadas · R$ {totalRevenue.toLocaleString('pt-BR')}</p>
          </div>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          <Plus className="w-4 h-4" /> Nova Reserva
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar evento ou empresa..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
          <option value="">Todos os status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && <p className="text-center text-gray-400 py-12">Nenhuma reserva encontrada</p>}
        {filtered.map(b => {
          const st = STATUS_CONFIG[b.status] || STATUS_CONFIG.tentative;
          const nights = differenceInDays(parseISO(b.check_out), parseISO(b.check_in));
          return (
            <div key={b.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800 dark:text-white">{b.event_name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {b.corporate_clients && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {b.corporate_clients.company_name}</span>}
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(parseISO(b.check_in), 'dd/MM')} — {format(parseISO(b.check_out), 'dd/MM/yy')} ({nights}n)</span>
                    <span className="flex items-center gap-1"><BedDouble className="w-3 h-3" /> {b.rooms_blocked} UHs</span>
                    {b.total_value && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> R$ {b.total_value.toLocaleString('pt-BR')}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  {b.status === 'tentative' && (
                    <button onClick={() => changeStatus(b.id, 'confirmed')} title="Confirmar"
                      className="p-1.5 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    </button>
                  )}
                  {b.status === 'confirmed' && (
                    <button onClick={() => changeStatus(b.id, 'completed')} title="Concluir"
                      className="p-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30">
                      <CheckCircle className="w-4 h-4 text-blue-500" />
                    </button>
                  )}
                  {(b.status === 'tentative' || b.status === 'confirmed') && (
                    <button onClick={() => changeStatus(b.id, 'cancelled')} title="Cancelar"
                      className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30">
                      <XCircle className="w-4 h-4 text-red-400" />
                    </button>
                  )}
                  <button onClick={() => startEdit(b)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    <Edit2 className="w-4 h-4 text-gray-400" />
                  </button>
                  <button onClick={() => deleteBooking(b.id)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    <Trash2 className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{editingId ? 'Editar Reserva' : 'Nova Reserva de Grupo'}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Cliente Corporativo</label>
                <select value={formClientId} onChange={e => setFormClientId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                  <option value="">Sem vínculo</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Evento / Grupo *</label>
                <input type="text" value={formEvent} onChange={e => setFormEvent(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Check-in *</label>
                  <input type="date" value={formCheckIn} onChange={e => setFormCheckIn(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Check-out *</label>
                  <input type="date" value={formCheckOut} onChange={e => setFormCheckOut(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">UHs *</label>
                  <input type="number" value={formRooms} onChange={e => setFormRooms(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Diária (R$)</label>
                  <input type="number" value={formRate} onChange={e => setFormRate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Valor Total (R$)</label>
                  <input type="number" value={formTotal} onChange={e => setFormTotal(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Contato</label>
                  <input type="text" value={formContact} onChange={e => setFormContact(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Telefone</label>
                  <input type="tel" value={formPhone} onChange={e => setFormPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Observações</label>
                <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetForm} className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
              <button onClick={saveBooking} disabled={saving || !formEvent.trim() || !formCheckIn || !formCheckOut || !formRooms}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
