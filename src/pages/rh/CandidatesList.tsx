// src/pages/rh/CandidatesList.tsx
// Pipeline de candidatos com visualização Kanban e lista

import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { format, parseISO } from 'date-fns';
import {
  Users, Search, Filter, Loader2, ChevronRight, Phone, Mail,
  AlertTriangle, MapPin, Briefcase, Eye, ArrowRight, LayoutGrid, List,
} from 'lucide-react';

interface Candidate {
  id: string;
  name: string;
  cpf: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  status: string;
  created_at: string;
  job_opening_id: string | null;
  job_openings?: { title: string; sector: string } | null;
  cpf_alert?: boolean;
}

const PIPELINE_STAGES = [
  { key: 'applied',   label: 'Inscritos',    color: 'bg-blue-500',   lightBg: 'bg-blue-50 dark:bg-blue-900/20' },
  { key: 'screening', label: 'Triagem',      color: 'bg-amber-500',  lightBg: 'bg-amber-50 dark:bg-amber-900/20' },
  { key: 'interview', label: 'Entrevista',   color: 'bg-purple-500', lightBg: 'bg-purple-50 dark:bg-purple-900/20' },
  { key: 'approved',  label: 'Aprovados',    color: 'bg-green-500',  lightBg: 'bg-green-50 dark:bg-green-900/20' },
  { key: 'rejected',  label: 'Rejeitados',   color: 'bg-red-500',    lightBg: 'bg-red-50 dark:bg-red-900/20' },
  { key: 'hired',     label: 'Contratados',  color: 'bg-emerald-500', lightBg: 'bg-emerald-50 dark:bg-emerald-900/20' },
];

export default function CandidatesList() {
  const { selectedHotel } = useHotel();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterJob, setFilterJob] = useState('');
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [cpfAlerts, setCpfAlerts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (selectedHotel?.id) loadData();
  }, [selectedHotel?.id]);

  async function loadData() {
    setLoading(true);
    const [candidatesRes, jobsRes, cpfRes] = await Promise.all([
      supabase
        .from('candidates')
        .select('*, job_openings(title, sector)')
        .eq('hotel_id', selectedHotel!.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('job_openings')
        .select('id, title')
        .eq('hotel_id', selectedHotel!.id)
        .order('title'),
      supabase
        .from('cpf_registry')
        .select('cpf')
        .eq('hotel_id', selectedHotel!.id),
    ]);

    const alertCpfs = new Set((cpfRes.data || []).map(r => r.cpf));
    setCpfAlerts(alertCpfs);

    const data = (candidatesRes.data || []).map(c => ({
      ...c,
      cpf_alert: alertCpfs.has(c.cpf),
    }));
    setCandidates(data);
    setJobs(jobsRes.data || []);
    setLoading(false);
  }

  async function moveCandidate(id: string, newStatus: string) {
    await supabase.from('candidates').update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    // Add timeline entry
    await supabase.from('candidate_timeline').insert({
      candidate_id: id,
      action: 'status_change',
      details: { new_status: newStatus },
    });

    loadData();
  }

  const filtered = useMemo(() => {
    return candidates.filter(c => {
      if (search) {
        const q = search.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !c.cpf.includes(q) && !(c.email || '').toLowerCase().includes(q)) return false;
      }
      if (filterJob && c.job_opening_id !== filterJob) return false;
      return true;
    });
  }, [candidates, search, filterJob]);

  const byStage = useMemo(() => {
    const map = new Map<string, Candidate[]>();
    PIPELINE_STAGES.forEach(s => map.set(s.key, []));
    filtered.forEach(c => {
      const arr = map.get(c.status);
      if (arr) arr.push(c);
    });
    return map;
  }, [filtered]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Users className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Candidatos</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{candidates.length} candidatos</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('kanban')}
            className={`p-2 rounded-lg ${view === 'kanban' ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-2 rounded-lg ${view === 'list' ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, CPF ou e-mail..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
        </div>
        <select value={filterJob} onChange={e => setFilterJob(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
          <option value="">Todas as vagas</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
      </div>

      {/* Kanban View */}
      {view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {PIPELINE_STAGES.filter(s => s.key !== 'rejected' || (byStage.get(s.key)?.length || 0) > 0).map(stage => {
            const items = byStage.get(stage.key) || [];
            return (
              <div key={stage.key} className="flex-shrink-0 w-64">
                <div className={`flex items-center gap-2 mb-2 px-3 py-2 rounded-lg ${stage.lightBg}`}>
                  <div className={`w-2 h-2 rounded-full ${stage.color}`} />
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{stage.label}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map(c => (
                    <CandidateCard key={c.id} candidate={c} onMove={moveCandidate} currentStage={stage.key} />
                  ))}
                  {items.length === 0 && (
                    <div className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">Nenhum</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Nome</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Vaga</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Data</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const stage = PIPELINE_STAGES.find(s => s.key === c.status);
                return (
                  <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {c.cpf_alert && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" title="CPF com alerta" />}
                        <div>
                          <p className="font-medium text-gray-800 dark:text-white">{c.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{c.cpf}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{c.job_openings?.title || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${stage?.lightBg || ''} font-medium`}>
                        {stage?.label || c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{format(parseISO(c.created_at), 'dd/MM/yy')}</td>
                    <td className="px-4 py-3">
                      <Link to={`/rh/candidate/${c.id}`} className="text-blue-500 hover:text-blue-600">
                        <Eye className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Candidate Card (Kanban)
// ---------------------------------------------------------------------------
function CandidateCard({ candidate: c, onMove, currentStage }: {
  candidate: Candidate;
  onMove: (id: string, status: string) => void;
  currentStage: string;
}) {
  const [showMove, setShowMove] = useState(false);
  const nextStages = PIPELINE_STAGES.filter(s => s.key !== currentStage && s.key !== 'blacklisted');

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {c.cpf_alert && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
            <Link to={`/rh/candidate/${c.id}`} className="text-sm font-medium text-gray-800 dark:text-white truncate hover:text-blue-500">
              {c.name}
            </Link>
          </div>
          {c.job_openings && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{c.job_openings.title}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 text-xs text-gray-400 dark:text-gray-500">
        {c.phone && <span className="flex items-center gap-0.5"><Phone className="w-3 h-3" />{c.phone}</span>}
        {c.city && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{c.city}</span>}
      </div>

      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={() => setShowMove(!showMove)}
          className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-0.5"
        >
          <ArrowRight className="w-3 h-3" /> Mover
        </button>
        <span className="text-xs text-gray-400 ml-auto">{format(parseISO(c.created_at), 'dd/MM')}</span>
      </div>

      {showMove && (
        <div className="flex flex-wrap gap-1 mt-2">
          {nextStages.map(s => (
            <button
              key={s.key}
              onClick={() => { onMove(c.id, s.key); setShowMove(false); }}
              className={`text-[10px] px-2 py-0.5 rounded-full ${s.lightBg} hover:opacity-80`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
