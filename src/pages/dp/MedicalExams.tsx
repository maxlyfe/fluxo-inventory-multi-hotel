// src/pages/dp/MedicalExams.tsx
// CRUD de exames médicos (ASO) — NR-1

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { format, parseISO, differenceInDays } from 'date-fns';
import {
  Stethoscope, Search, Loader2, Plus, Edit2, Trash2, Save, X,
  Clock, CheckCircle, AlertTriangle, ChevronLeft, XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface MedicalExam {
  id: string;
  employee_id: string;
  exam_type: string;
  exam_date: string;
  valid_until: string | null;
  result: string | null;
  restrictions: string | null;
  clinic: string | null;
  doctor_name: string | null;
  crm: string | null;
  document_url: string | null;
  notes: string | null;
  created_at: string;
  employees?: { name: string; sector: string } | null;
}

interface Employee {
  id: string;
  name: string;
  sector: string;
}

const EXAM_TYPES: Record<string, string> = {
  admissional: 'Admissional',
  periodico: 'Periódico',
  retorno: 'Retorno ao Trabalho',
  mudanca_funcao: 'Mudança de Função',
  demissional: 'Demissional',
};

const RESULT_LABELS: Record<string, { label: string; color: string }> = {
  apto:            { label: 'Apto',            color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  inapto:          { label: 'Inapto',          color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  apto_restricao:  { label: 'Apto c/ Restrição', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
};

export default function MedicalExams() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();

  const [exams, setExams] = useState<MedicalExam[]>([]);
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
  const [formType, setFormType] = useState('periodico');
  const [formDate, setFormDate] = useState('');
  const [formValidUntil, setFormValidUntil] = useState('');
  const [formResult, setFormResult] = useState('apto');
  const [formRestrictions, setFormRestrictions] = useState('');
  const [formClinic, setFormClinic] = useState('');
  const [formDoctor, setFormDoctor] = useState('');
  const [formCrm, setFormCrm] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (selectedHotel?.id) loadData();
  }, [selectedHotel?.id]);

  async function loadData() {
    setLoading(true);
    const [examRes, empRes] = await Promise.all([
      supabase
        .from('medical_exams')
        .select('*, employees(name, sector)')
        .eq('hotel_id', selectedHotel!.id)
        .order('exam_date', { ascending: false }),
      supabase
        .from('employees')
        .select('id, name, sector')
        .eq('hotel_id', selectedHotel!.id)
        .eq('status', 'active')
        .order('name'),
    ]);
    setExams(examRes.data || []);
    setEmployees(empRes.data || []);
    setLoading(false);
  }

  function resetForm() {
    setFormEmployeeId('');
    setFormType('periodico');
    setFormDate('');
    setFormValidUntil('');
    setFormResult('apto');
    setFormRestrictions('');
    setFormClinic('');
    setFormDoctor('');
    setFormCrm('');
    setFormNotes('');
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(e: MedicalExam) {
    setFormEmployeeId(e.employee_id);
    setFormType(e.exam_type);
    setFormDate(e.exam_date);
    setFormValidUntil(e.valid_until || '');
    setFormResult(e.result || 'apto');
    setFormRestrictions(e.restrictions || '');
    setFormClinic(e.clinic || '');
    setFormDoctor(e.doctor_name || '');
    setFormCrm(e.crm || '');
    setFormNotes(e.notes || '');
    setEditingId(e.id);
    setShowForm(true);
  }

  async function saveExam() {
    if (!formEmployeeId || !formDate || !selectedHotel) return;
    setSaving(true);

    const payload = {
      hotel_id: selectedHotel.id,
      employee_id: formEmployeeId,
      exam_type: formType,
      exam_date: formDate,
      valid_until: formValidUntil || null,
      result: formResult || null,
      restrictions: formRestrictions.trim() || null,
      clinic: formClinic.trim() || null,
      doctor_name: formDoctor.trim() || null,
      crm: formCrm.trim() || null,
      notes: formNotes.trim() || null,
    };

    if (editingId) {
      await supabase.from('medical_exams').update(payload).eq('id', editingId);
    } else {
      await supabase.from('medical_exams').insert({ ...payload, created_by: user?.id });
    }

    setSaving(false);
    resetForm();
    loadData();
  }

  async function deleteExam(id: string) {
    if (!confirm('Remover este exame médico?')) return;
    await supabase.from('medical_exams').delete().eq('id', id);
    loadData();
  }

  const today = new Date();

  const filtered = useMemo(() => {
    return exams.filter(e => {
      if (search) {
        const q = search.toLowerCase();
        if (!(e.employees?.name || '').toLowerCase().includes(q) && !(e.clinic || '').toLowerCase().includes(q)) return false;
      }
      if (filterType && e.exam_type !== filterType) return false;
      if (filterStatus === 'expired' && !(e.valid_until && parseISO(e.valid_until) < today)) return false;
      if (filterStatus === 'expiring' && !(e.valid_until && differenceInDays(parseISO(e.valid_until), today) >= 0 && differenceInDays(parseISO(e.valid_until), today) <= 30)) return false;
      if (filterStatus === 'valid' && !(e.valid_until && parseISO(e.valid_until) > today || !e.valid_until)) return false;
      return true;
    });
  }, [exams, search, filterType, filterStatus]);

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
          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Stethoscope className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Exames Médicos (ASO)</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{exams.length} registros</p>
          </div>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium">
          <Plus className="w-4 h-4" /> Novo Exame
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingId ? 'Editar Exame' : 'Novo Exame Médico'}
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
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo *</label>
                  <select value={formType} onChange={e => setFormType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                    {Object.entries(EXAM_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Resultado</label>
                  <select value={formResult} onChange={e => setFormResult(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                    {Object.entries(RESULT_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data do Exame *</label>
                  <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Validade</label>
                  <input type="date" value={formValidUntil} onChange={e => setFormValidUntil(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
              </div>
              {formResult === 'apto_restricao' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Restrições</label>
                  <textarea value={formRestrictions} onChange={e => setFormRestrictions(e.target.value)} rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none" />
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Clínica</label>
                  <input type="text" value={formClinic} onChange={e => setFormClinic(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Médico</label>
                  <input type="text" value={formDoctor} onChange={e => setFormDoctor(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">CRM</label>
                  <input type="text" value={formCrm} onChange={e => setFormCrm(e.target.value)}
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
              <button onClick={resetForm}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
              <button onClick={saveExam} disabled={saving || !formEmployeeId || !formDate}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium disabled:opacity-50">
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
            placeholder="Buscar por nome ou clínica..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
          <option value="">Todos os tipos</option>
          {Object.entries(EXAM_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Data</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Validade</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Resultado</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Clínica</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">Nenhum exame encontrado</td></tr>
            )}
            {filtered.map(e => {
              const days = e.valid_until ? differenceInDays(parseISO(e.valid_until), today) : null;
              const isExpired = days !== null && days < 0;
              const isExpiring = days !== null && days >= 0 && days <= 30;
              const rl = e.result ? RESULT_LABELS[e.result] : null;
              return (
                <tr key={e.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800 dark:text-white">{e.employees?.name || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{e.employees?.sector}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">
                      {EXAM_TYPES[e.exam_type] || e.exam_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{format(parseISO(e.exam_date), 'dd/MM/yy')}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {e.valid_until ? format(parseISO(e.valid_until), 'dd/MM/yy') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {rl ? (
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${rl.color}`}>{rl.label}</span>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300 max-w-[120px] truncate">{e.clinic || '—'}</td>
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
                      <button onClick={() => startEdit(e)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                        <Edit2 className="w-3.5 h-3.5 text-gray-400 hover:text-blue-500" />
                      </button>
                      <button onClick={() => deleteExam(e.id)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
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
