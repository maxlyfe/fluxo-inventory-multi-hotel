// src/pages/dp/TrainingRecords.tsx
// CRUD de registros de treinamento NR-1

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { format, parseISO, differenceInDays } from 'date-fns';
import {
  GraduationCap, Search, Loader2, Plus, Edit2, Trash2, Save, X,
  Filter, Clock, CheckCircle, AlertTriangle, ChevronLeft,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface TrainingRecord {
  id: string;
  employee_id: string;
  training_type: string;
  topic: string;
  trainer: string | null;
  training_date: string;
  valid_until: string | null;
  certificate_url: string | null;
  hours: number | null;
  notes: string | null;
  created_at: string;
  employees?: { name: string; sector: string } | null;
}

interface Employee {
  id: string;
  name: string;
  sector: string;
}

const TRAINING_TYPES: Record<string, string> = {
  integracao: 'Integração',
  reciclagem: 'Reciclagem',
  especifico: 'Específico',
  nr: 'NR Obrigatório',
  brigada: 'Brigada de Incêndio',
  cipa: 'CIPA',
};

export default function TrainingRecords() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();

  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form
  const [formEmployeeId, setFormEmployeeId] = useState('');
  const [formType, setFormType] = useState('integracao');
  const [formTopic, setFormTopic] = useState('');
  const [formTrainer, setFormTrainer] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formValidUntil, setFormValidUntil] = useState('');
  const [formHours, setFormHours] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (selectedHotel?.id) loadData();
  }, [selectedHotel?.id]);

  async function loadData() {
    setLoading(true);
    const [recRes, empRes] = await Promise.all([
      supabase
        .from('nr1_training_records')
        .select('*, employees(name, sector)')
        .eq('hotel_id', selectedHotel!.id)
        .order('training_date', { ascending: false }),
      supabase
        .from('employees')
        .select('id, name, sector')
        .eq('hotel_id', selectedHotel!.id)
        .eq('status', 'active')
        .order('name'),
    ]);
    setRecords(recRes.data || []);
    setEmployees(empRes.data || []);
    setLoading(false);
  }

  function resetForm() {
    setFormEmployeeId('');
    setFormType('integracao');
    setFormTopic('');
    setFormTrainer('');
    setFormDate('');
    setFormValidUntil('');
    setFormHours('');
    setFormNotes('');
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(r: TrainingRecord) {
    setFormEmployeeId(r.employee_id);
    setFormType(r.training_type);
    setFormTopic(r.topic);
    setFormTrainer(r.trainer || '');
    setFormDate(r.training_date);
    setFormValidUntil(r.valid_until || '');
    setFormHours(r.hours?.toString() || '');
    setFormNotes(r.notes || '');
    setEditingId(r.id);
    setShowForm(true);
  }

  async function saveRecord() {
    if (!formEmployeeId || !formTopic.trim() || !formDate || !selectedHotel) return;
    setSaving(true);

    const payload = {
      hotel_id: selectedHotel.id,
      employee_id: formEmployeeId,
      training_type: formType,
      topic: formTopic.trim(),
      trainer: formTrainer.trim() || null,
      training_date: formDate,
      valid_until: formValidUntil || null,
      hours: formHours ? parseFloat(formHours) : null,
      notes: formNotes.trim() || null,
    };

    if (editingId) {
      await supabase.from('nr1_training_records').update(payload).eq('id', editingId);
    } else {
      await supabase.from('nr1_training_records').insert({ ...payload, created_by: user?.id });
    }

    setSaving(false);
    resetForm();
    loadData();
  }

  async function deleteRecord(id: string) {
    if (!confirm('Remover este registro de treinamento?')) return;
    await supabase.from('nr1_training_records').delete().eq('id', id);
    loadData();
  }

  const today = new Date();

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (search) {
        const q = search.toLowerCase();
        if (!(r.employees?.name || '').toLowerCase().includes(q) && !r.topic.toLowerCase().includes(q)) return false;
      }
      if (filterType && r.training_type !== filterType) return false;
      if (filterStatus === 'expired' && !(r.valid_until && parseISO(r.valid_until) < today)) return false;
      if (filterStatus === 'expiring' && !(r.valid_until && differenceInDays(parseISO(r.valid_until), today) >= 0 && differenceInDays(parseISO(r.valid_until), today) <= 30)) return false;
      if (filterStatus === 'valid' && !(r.valid_until && parseISO(r.valid_until) > today || !r.valid_until)) return false;
      return true;
    });
  }, [records, search, filterType, filterStatus]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/dp/nr1" className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <ChevronLeft className="w-5 h-5 text-gray-400" />
          </Link>
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Treinamentos</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{records.length} registros</p>
          </div>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          <Plus className="w-4 h-4" /> Novo Treinamento
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-5">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingId ? 'Editar Treinamento' : 'Novo Treinamento'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Colaborador *</label>
                <select value={formEmployeeId} onChange={e => setFormEmployeeId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                  <option value="">Selecione...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.sector}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
                  <select value={formType} onChange={e => setFormType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                    {Object.entries(TRAINING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tópico *</label>
                  <input type="text" value={formTopic} onChange={e => setFormTopic(e.target.value)}
                    placeholder="Ex: NR-10 Eletricidade"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data *</label>
                  <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Validade</label>
                  <input type="date" value={formValidUntil} onChange={e => setFormValidUntil(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Horas</label>
                  <input type="number" value={formHours} onChange={e => setFormHours(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Instrutor</label>
                <input type="text" value={formTrainer} onChange={e => setFormTrainer(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Observações</label>
                <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetForm}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
              <button onClick={saveRecord} disabled={saving || !formEmployeeId || !formTopic.trim() || !formDate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou tópico..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
          <option value="">Todos os tipos</option>
          {Object.entries(TRAINING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
          <option value="">Todos</option>
          <option value="expired">Vencidos</option>
          <option value="expiring">Vencendo (30d)</option>
          <option value="valid">Válidos</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Colaborador</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Tipo</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Tópico</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Data</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Validade</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">Nenhum treinamento encontrado</td></tr>
            )}
            {filtered.map(r => {
              const days = r.valid_until ? differenceInDays(parseISO(r.valid_until), today) : null;
              const isExpired = days !== null && days < 0;
              const isExpiring = days !== null && days >= 0 && days <= 30;
              return (
                <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800 dark:text-white">{r.employees?.name || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{r.employees?.sector}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">
                      {TRAINING_TYPES[r.training_type] || r.training_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200 max-w-[180px] truncate">{r.topic}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{format(parseISO(r.training_date), 'dd/MM/yy')}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {r.valid_until ? format(parseISO(r.valid_until), 'dd/MM/yy') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {isExpired ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                        <AlertTriangle className="w-3 h-3" /> Vencido
                      </span>
                    ) : isExpiring ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        <Clock className="w-3 h-3" /> {days}d
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                        <CheckCircle className="w-3 h-3" /> OK
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEdit(r)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                        <Edit2 className="w-3.5 h-3.5 text-gray-400 hover:text-blue-500" />
                      </button>
                      <button onClick={() => deleteRecord(r.id)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                        <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
