// src/pages/rh/JobOpenings.tsx
// CRUD de vagas com geração de link público para candidatos

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Briefcase, Plus, X, Loader2, Link2, Copy, CheckCheck,
  Edit2, Trash2, Pause, Play, Users, ExternalLink,
  ChevronDown, ChevronUp, Search,
} from 'lucide-react';

interface JobOpening {
  id: string;
  hotel_id: string;
  title: string;
  sector: string;
  description: string | null;
  requirements: string | null;
  salary_range_min: number | null;
  salary_range_max: number | null;
  contract_type: string | null;
  work_schedule: string | null;
  status: 'open' | 'paused' | 'closed' | 'filled';
  public_token: string;
  max_candidates: number | null;
  created_at: string;
  closed_at: string | null;
  candidate_count?: number;
}

interface Questionnaire {
  id: string;
  title: string;
  is_active: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open:   { label: 'Aberta',    color: 'text-green-700 dark:text-green-300',  bg: 'bg-green-100 dark:bg-green-900/30' },
  paused: { label: 'Pausada',   color: 'text-amber-700 dark:text-amber-300',  bg: 'bg-amber-100 dark:bg-amber-900/30' },
  closed: { label: 'Encerrada', color: 'text-gray-700 dark:text-gray-300',    bg: 'bg-gray-100 dark:bg-gray-700/50' },
  filled: { label: 'Preenchida', color: 'text-blue-700 dark:text-blue-300',   bg: 'bg-blue-100 dark:bg-blue-900/30' },
};

const SECTORS = ['Recepção', 'Governança', 'Manutenção', 'Cozinha', 'Salão', 'Reservas', 'Administrativo', 'Lavanderia', 'Segurança', 'Outro'];
const CONTRACT_TYPES = [
  { value: 'clt', label: 'CLT' },
  { value: 'pj', label: 'PJ' },
  { value: 'temporario', label: 'Temporário' },
  { value: 'estagio', label: 'Estágio' },
  { value: 'experiencia', label: 'Experiência' },
];
const SCHEDULES = ['12x36', '6x1', '5x2', '4x2', 'custom'];

export default function JobOpenings() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();

  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<JobOpening | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'paused' | 'closed'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (selectedHotel?.id) loadOpenings();
  }, [selectedHotel?.id]);

  async function loadOpenings() {
    setLoading(true);
    const { data } = await supabase
      .from('job_openings')
      .select('*')
      .eq('hotel_id', selectedHotel!.id)
      .order('created_at', { ascending: false });

    if (data) {
      // Count candidates per opening
      const ids = data.map(d => d.id);
      const { data: counts } = await supabase
        .from('candidates')
        .select('job_opening_id')
        .in('job_opening_id', ids);

      const countMap = new Map<string, number>();
      counts?.forEach(c => countMap.set(c.job_opening_id, (countMap.get(c.job_opening_id) || 0) + 1));

      setOpenings(data.map(d => ({ ...d, candidate_count: countMap.get(d.id) || 0 })));
    }
    setLoading(false);
  }

  const filtered = openings.filter(o => {
    if (filter !== 'all' && o.status !== filter) return false;
    if (search && !o.title.toLowerCase().includes(search.toLowerCase()) && !o.sector.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function handleCopyLink(token: string) {
    const url = `${window.location.origin}/jobs/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  async function toggleStatus(opening: JobOpening) {
    const newStatus = opening.status === 'open' ? 'paused' : 'open';
    await supabase.from('job_openings').update({
      status: newStatus,
      closed_at: newStatus === 'open' ? null : opening.closed_at,
    }).eq('id', opening.id);
    loadOpenings();
  }

  async function closeOpening(id: string, status: 'closed' | 'filled') {
    await supabase.from('job_openings').update({
      status,
      closed_at: new Date().toISOString(),
    }).eq('id', id);
    loadOpenings();
  }

  async function deleteOpening(id: string) {
    if (!confirm('Excluir esta vaga? Candidatos associados perderão a referência.')) return;
    await supabase.from('job_openings').delete().eq('id', id);
    loadOpenings();
  }

  const stats = {
    total: openings.length,
    open: openings.filter(o => o.status === 'open').length,
    candidates: openings.reduce((s, o) => s + (o.candidate_count || 0), 0),
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Vagas</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {stats.open} abertas · {stats.candidates} candidatos
            </p>
          </div>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm"
        >
          <Plus className="w-4 h-4" /> Nova Vaga
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar vagas..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'open', 'paused', 'closed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-lg text-xs font-medium ${
                filter === f
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {f === 'all' ? 'Todas' : STATUS_CONFIG[f].label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Briefcase className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma vaga encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(opening => {
            const st = STATUS_CONFIG[opening.status];
            return (
              <div key={opening.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{opening.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{opening.sector}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <span>{format(parseISO(opening.created_at), 'dd/MM/yyyy')}</span>
                      {opening.contract_type && <span>· {CONTRACT_TYPES.find(c => c.value === opening.contract_type)?.label || opening.contract_type}</span>}
                      {opening.work_schedule && <span>· {opening.work_schedule}</span>}
                      {(opening.salary_range_min || opening.salary_range_max) && (
                        <span>· R$ {opening.salary_range_min?.toLocaleString('pt-BR') || '?'} — {opening.salary_range_max?.toLocaleString('pt-BR') || '?'}</span>
                      )}
                    </div>
                    {opening.description && (
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 line-clamp-2">{opening.description}</p>
                    )}
                  </div>

                  {/* Candidate count */}
                  <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 px-2.5 py-1.5 rounded-lg flex-shrink-0">
                    <Users className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{opening.candidate_count || 0}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex-wrap">
                  <button
                    onClick={() => handleCopyLink(opening.public_token)}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400"
                  >
                    {copiedToken === opening.public_token
                      ? <><CheckCheck className="w-3 h-3" /> Copiado!</>
                      : <><Link2 className="w-3 h-3" /> Copiar Link</>
                    }
                  </button>
                  {opening.status !== 'closed' && opening.status !== 'filled' && (
                    <button
                      onClick={() => toggleStatus(opening)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                    >
                      {opening.status === 'open'
                        ? <><Pause className="w-3 h-3" /> Pausar</>
                        : <><Play className="w-3 h-3" /> Reabrir</>
                      }
                    </button>
                  )}
                  <button
                    onClick={() => { setEditing(opening); setShowForm(true); }}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                  >
                    <Edit2 className="w-3 h-3" /> Editar
                  </button>
                  {opening.status === 'open' && (
                    <>
                      <button
                        onClick={() => closeOpening(opening.id, 'filled')}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 dark:text-green-400"
                      >
                        <CheckCheck className="w-3 h-3" /> Preenchida
                      </button>
                      <button
                        onClick={() => closeOpening(opening.id, 'closed')}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                      >
                        Encerrar
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => deleteOpening(opening.id)}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 ml-auto"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form Modal */}
      {showForm && <JobFormModal
        opening={editing}
        hotelId={selectedHotel!.id}
        userId={user!.id}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSaved={loadOpenings}
      />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form Modal
// ---------------------------------------------------------------------------
function JobFormModal({ opening, hotelId, userId, onClose, onSaved }: {
  opening: JobOpening | null;
  hotelId: string;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: opening?.title || '',
    sector: opening?.sector || 'Recepção',
    description: opening?.description || '',
    requirements: opening?.requirements || '',
    salary_range_min: opening?.salary_range_min?.toString() || '',
    salary_range_max: opening?.salary_range_max?.toString() || '',
    contract_type: opening?.contract_type || 'clt',
    work_schedule: opening?.work_schedule || '6x1',
    max_candidates: opening?.max_candidates?.toString() || '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        hotel_id: hotelId,
        title: form.title.trim(),
        sector: form.sector,
        description: form.description.trim() || null,
        requirements: form.requirements.trim() || null,
        salary_range_min: form.salary_range_min ? Number(form.salary_range_min) : null,
        salary_range_max: form.salary_range_max ? Number(form.salary_range_max) : null,
        contract_type: form.contract_type || null,
        work_schedule: form.work_schedule || null,
        max_candidates: form.max_candidates ? Number(form.max_candidates) : null,
      };

      if (opening) {
        await supabase.from('job_openings').update(payload).eq('id', opening.id);
      } else {
        payload.created_by = userId;
        await supabase.from('job_openings').insert(payload);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const SECTORS = ['Recepção', 'Governança', 'Manutenção', 'Cozinha', 'Salão', 'Reservas', 'Administrativo', 'Lavanderia', 'Segurança', 'Outro'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {opening ? 'Editar Vaga' : 'Nova Vaga'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Título da Vaga *</label>
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              placeholder="Ex: Recepcionista Noturno" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Setor</label>
              <select value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm">
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contrato</label>
              <select value={form.contract_type} onChange={e => setForm(f => ({ ...f, contract_type: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm">
                {CONTRACT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Escala</label>
              <select value={form.work_schedule} onChange={e => setForm(f => ({ ...f, work_schedule: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm">
                {SCHEDULES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Máx. Candidatos</label>
              <input type="number" value={form.max_candidates} onChange={e => setForm(f => ({ ...f, max_candidates: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                placeholder="Ilimitado" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Salário Mín.</label>
              <input type="number" value={form.salary_range_min} onChange={e => setForm(f => ({ ...f, salary_range_min: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                placeholder="R$" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Salário Máx.</label>
              <input type="number" value={form.salary_range_max} onChange={e => setForm(f => ({ ...f, salary_range_max: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                placeholder="R$" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none"
              placeholder="Detalhes da vaga, responsabilidades..." />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Requisitos</label>
            <textarea value={form.requirements} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none"
              placeholder="Experiência, formação, habilidades..." />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !form.title.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {opening ? 'Salvar' : 'Criar Vaga'}
          </button>
        </div>
      </div>
    </div>
  );
}
