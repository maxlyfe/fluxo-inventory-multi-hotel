// src/pages/rh/CpfRegistry.tsx
// Consulta e gestão de CPFs com alertas (justa causa, abandono, bloqueio)

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { format, parseISO } from 'date-fns';
import {
  Shield, Search, Loader2, Plus, Trash2, Edit2, Save, X,
  AlertTriangle, UserX, LogOut, Ban, ChevronDown,
} from 'lucide-react';

interface CpfEntry {
  id: string;
  cpf: string;
  employee_name: string;
  hotel_id: string;
  registry_type: string;
  reason: string | null;
  registered_by: string | null;
  registered_at: string;
}

const REGISTRY_TYPES = [
  { key: 'dismissed_cause', label: 'Justa Causa', icon: UserX, color: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-300' },
  { key: 'abandoned', label: 'Abandono', icon: LogOut, color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300' },
  { key: 'blacklisted', label: 'Bloqueado', icon: Ban, color: 'text-gray-600 bg-gray-100 dark:bg-gray-700 dark:text-gray-300' },
  { key: 'normal_exit', label: 'Saída Normal', icon: ChevronDown, color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300' },
];

export default function CpfRegistry() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();

  const [entries, setEntries] = useState<CpfEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formCpf, setFormCpf] = useState('');
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('dismissed_cause');
  const [formReason, setFormReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedHotel?.id) loadEntries();
  }, [selectedHotel?.id]);

  async function loadEntries() {
    setLoading(true);
    const { data } = await supabase
      .from('cpf_registry')
      .select('*')
      .eq('hotel_id', selectedHotel!.id)
      .order('registered_at', { ascending: false });
    setEntries(data || []);
    setLoading(false);
  }

  function resetForm() {
    setFormCpf('');
    setFormName('');
    setFormType('dismissed_cause');
    setFormReason('');
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(entry: CpfEntry) {
    setFormCpf(entry.cpf);
    setFormName(entry.employee_name);
    setFormType(entry.registry_type);
    setFormReason(entry.reason || '');
    setEditingId(entry.id);
    setShowForm(true);
  }

  async function saveEntry() {
    if (!formCpf.trim() || !formName.trim() || !selectedHotel) return;
    setSaving(true);

    if (editingId) {
      await supabase.from('cpf_registry').update({
        cpf: formCpf.replace(/\D/g, ''),
        employee_name: formName.trim(),
        registry_type: formType,
        reason: formReason.trim() || null,
      }).eq('id', editingId);
    } else {
      await supabase.from('cpf_registry').insert({
        cpf: formCpf.replace(/\D/g, ''),
        employee_name: formName.trim(),
        hotel_id: selectedHotel.id,
        registry_type: formType,
        reason: formReason.trim() || null,
        registered_by: user?.id,
      });
    }

    setSaving(false);
    resetForm();
    loadEntries();
  }

  async function deleteEntry(id: string) {
    if (!confirm('Remover este registro de CPF?')) return;
    await supabase.from('cpf_registry').delete().eq('id', id);
    loadEntries();
  }

  // CPF lookup
  const [lookupCpf, setLookupCpf] = useState('');
  const [lookupResult, setLookupResult] = useState<CpfEntry[] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  async function doLookup() {
    if (!lookupCpf.trim()) return;
    setLookupLoading(true);
    const { data } = await supabase
      .from('cpf_registry')
      .select('*')
      .eq('cpf', lookupCpf.replace(/\D/g, ''));
    setLookupResult(data || []);
    setLookupLoading(false);
  }

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (search) {
        const q = search.toLowerCase();
        if (!e.employee_name.toLowerCase().includes(q) && !e.cpf.includes(q.replace(/\D/g, ''))) return false;
      }
      if (filterType && e.registry_type !== filterType) return false;
      return true;
    });
  }, [entries, search, filterType]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <Shield className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Registro de CPF</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{entries.length} registros</p>
          </div>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium">
          <Plus className="w-4 h-4" /> Novo Registro
        </button>
      </div>

      {/* CPF Lookup */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-2">Consulta Rápida de CPF</h3>
        <div className="flex gap-2">
          <input type="text" value={lookupCpf} onChange={e => setLookupCpf(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doLookup()}
            placeholder="Digite o CPF para consultar..."
            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
          <button onClick={doLookup} disabled={lookupLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50">
            {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Consultar'}
          </button>
        </div>
        {lookupResult !== null && (
          <div className="mt-3">
            {lookupResult.length === 0 ? (
              <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                ✓ CPF limpo — nenhum registro encontrado
              </p>
            ) : (
              <div className="space-y-2">
                {lookupResult.map(r => {
                  const rt = REGISTRY_TYPES.find(t => t.key === r.registry_type);
                  return (
                    <div key={r.id} className="flex items-center gap-2 text-sm">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rt?.color || ''}`}>{rt?.label || r.registry_type}</span>
                      <span className="text-gray-700 dark:text-gray-200">{r.employee_name}</span>
                      {r.reason && <span className="text-gray-500 dark:text-gray-400">— {r.reason}</span>}
                      <span className="text-xs text-gray-400 ml-auto">{format(parseISO(r.registered_at), 'dd/MM/yyyy')}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">
            {editingId ? 'Editar Registro' : 'Novo Registro'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">CPF *</label>
              <input type="text" value={formCpf} onChange={e => setFormCpf(e.target.value)}
                placeholder="000.000.000-00"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome do Colaborador *</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
              <select value={formType} onChange={e => setFormType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                {REGISTRY_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Motivo</label>
              <input type="text" value={formReason} onChange={e => setFormReason(e.target.value)}
                placeholder="Descreva o motivo..."
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={saveEntry} disabled={saving || !formCpf.trim() || !formName.trim()}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Atualizar' : 'Salvar'}
            </button>
            <button onClick={resetForm}
              className="flex items-center gap-1.5 px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm">
              <X className="w-4 h-4" /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou CPF..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
          <option value="">Todos os tipos</option>
          {REGISTRY_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Nome</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">CPF</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Tipo</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Motivo</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Data</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400 dark:text-gray-500">Nenhum registro encontrado</td></tr>
            )}
            {filtered.map(entry => {
              const rt = REGISTRY_TYPES.find(t => t.key === entry.registry_type);
              const RtIcon = rt?.icon || AlertTriangle;
              return (
                <tr key={entry.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-white">{entry.employee_name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-xs">{entry.cpf}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${rt?.color || ''}`}>
                      <RtIcon className="w-3 h-3" /> {rt?.label || entry.registry_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{entry.reason || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{format(parseISO(entry.registered_at), 'dd/MM/yy')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEdit(entry)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                        <Edit2 className="w-3.5 h-3.5 text-gray-400 hover:text-blue-500" />
                      </button>
                      <button onClick={() => deleteEntry(entry.id)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
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
