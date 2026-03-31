// src/pages/dp/NR1Dashboard.tsx
// Painel NR-1: riscos por setor, treinamentos pendentes, exames vencidos

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { format, parseISO, differenceInDays, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ShieldAlert, GraduationCap, Stethoscope, AlertTriangle, CheckCircle,
  Clock, Plus, Search, Loader2, ChevronRight, Filter, BarChart3,
  Users, Building, TrendingUp, XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface RiskAssessment {
  id: string;
  sector: string;
  risk_type: string;
  description: string;
  severity: string;
  status: string;
  review_date: string | null;
  mitigation_measures: string | null;
  responsible: string | null;
  created_at: string;
}

interface TrainingRecord {
  id: string;
  employee_id: string;
  training_type: string;
  topic: string;
  training_date: string;
  valid_until: string | null;
  employees?: { name: string; sector: string } | null;
}

interface MedicalExam {
  id: string;
  employee_id: string;
  exam_type: string;
  exam_date: string;
  valid_until: string | null;
  result: string | null;
  employees?: { name: string; sector: string } | null;
}

const RISK_TYPES: Record<string, { label: string; color: string }> = {
  fisico:      { label: 'Físico',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  quimico:     { label: 'Químico',     color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  biologico:   { label: 'Biológico',   color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  ergonomico:  { label: 'Ergonômico',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  acidente:    { label: 'Acidente',    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

const SEVERITY_COLORS: Record<string, string> = {
  baixo:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  medio:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  alto:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  critico: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export default function NR1Dashboard() {
  const { selectedHotel } = useHotel();
  const [risks, setRisks] = useState<RiskAssessment[]>([]);
  const [trainings, setTrainings] = useState<TrainingRecord[]>([]);
  const [exams, setExams] = useState<MedicalExam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (selectedHotel?.id) loadAll();
  }, [selectedHotel?.id]);

  async function loadAll() {
    setLoading(true);
    const [riskRes, trainRes, examRes] = await Promise.all([
      supabase
        .from('nr1_risk_assessments')
        .select('*')
        .eq('hotel_id', selectedHotel!.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('nr1_training_records')
        .select('*, employees(name, sector)')
        .eq('hotel_id', selectedHotel!.id)
        .order('valid_until', { ascending: true }),
      supabase
        .from('medical_exams')
        .select('*, employees(name, sector)')
        .eq('hotel_id', selectedHotel!.id)
        .order('valid_until', { ascending: true }),
    ]);
    setRisks(riskRes.data || []);
    setTrainings(trainRes.data || []);
    setExams(examRes.data || []);
    setLoading(false);
  }

  const today = new Date();
  const in30 = addDays(today, 30);

  // Stats
  const activeRisks = risks.filter(r => r.status === 'active');
  const criticalRisks = activeRisks.filter(r => r.severity === 'critico' || r.severity === 'alto');
  const overdueReviews = activeRisks.filter(r => r.review_date && parseISO(r.review_date) < today);

  const expiringTrainings = trainings.filter(t => t.valid_until && parseISO(t.valid_until) <= in30 && parseISO(t.valid_until) >= today);
  const expiredTrainings = trainings.filter(t => t.valid_until && parseISO(t.valid_until) < today);

  const expiringExams = exams.filter(e => e.valid_until && parseISO(e.valid_until) <= in30 && parseISO(e.valid_until) >= today);
  const expiredExams = exams.filter(e => e.valid_until && parseISO(e.valid_until) < today);

  // Group risks by sector
  const risksBySector = useMemo(() => {
    const map: Record<string, RiskAssessment[]> = {};
    activeRisks.forEach(r => {
      if (!map[r.sector]) map[r.sector] = [];
      map[r.sector].push(r);
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [risks]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">NR-1 — Segurança do Trabalho</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Riscos, treinamentos e exames médicos</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/dp/trainings"
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
            <GraduationCap className="w-4 h-4" /> Treinamentos
          </Link>
          <Link to="/dp/medical-exams"
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium">
            <Stethoscope className="w-4 h-4" /> Exames
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard
          icon={AlertTriangle}
          label="Riscos Ativos"
          value={activeRisks.length}
          sublabel={`${criticalRisks.length} alto/crítico`}
          color="orange"
          alert={criticalRisks.length > 0}
        />
        <KPICard
          icon={Clock}
          label="Revisões Pendentes"
          value={overdueReviews.length}
          sublabel="prazo vencido"
          color="red"
          alert={overdueReviews.length > 0}
        />
        <KPICard
          icon={GraduationCap}
          label="Treinamentos"
          value={expiredTrainings.length}
          sublabel={`vencidos · ${expiringTrainings.length} vencendo`}
          color="amber"
          alert={expiredTrainings.length > 0}
        />
        <KPICard
          icon={Stethoscope}
          label="Exames Médicos"
          value={expiredExams.length}
          sublabel={`vencidos · ${expiringExams.length} vencendo`}
          color="emerald"
          alert={expiredExams.length > 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Risks by Sector */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
            <Building className="w-4 h-4 text-gray-400" /> Riscos por Setor
          </h3>
          {risksBySector.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Nenhum risco ativo cadastrado</p>
          ) : (
            <div className="space-y-2">
              {risksBySector.map(([sector, sectorRisks]) => (
                <div key={sector} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{sector}</span>
                  <div className="flex items-center gap-2">
                    {sectorRisks.some(r => r.severity === 'critico') && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">Crítico</span>
                    )}
                    <span className="text-sm text-gray-500 dark:text-gray-400">{sectorRisks.length} risco{sectorRisks.length > 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expiring Trainings */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-gray-400" /> Treinamentos Vencendo (30 dias)
          </h3>
          {[...expiredTrainings, ...expiringTrainings].length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Nenhum treinamento vencendo</p>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {[...expiredTrainings, ...expiringTrainings].slice(0, 10).map(t => {
                const days = t.valid_until ? differenceInDays(parseISO(t.valid_until), today) : 0;
                const isExpired = days < 0;
                return (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{t.employees?.name || '—'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{t.topic}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ml-2 ${
                      isExpired ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300'
                    }`}>
                      {isExpired ? `Vencido ${Math.abs(days)}d` : `${days}d restantes`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Expiring Exams */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-gray-400" /> Exames Vencendo (30 dias)
          </h3>
          {[...expiredExams, ...expiringExams].length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Nenhum exame vencendo</p>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {[...expiredExams, ...expiringExams].slice(0, 10).map(e => {
                const days = e.valid_until ? differenceInDays(parseISO(e.valid_until), today) : 0;
                const isExpired = days < 0;
                const examLabels: Record<string, string> = {
                  admissional: 'Admissional', periodico: 'Periódico', retorno: 'Retorno',
                  mudanca_funcao: 'Mudança Função', demissional: 'Demissional',
                };
                return (
                  <div key={e.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{e.employees?.name || '—'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{examLabels[e.exam_type] || e.exam_type}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ml-2 ${
                      isExpired ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300'
                    }`}>
                      {isExpired ? `Vencido ${Math.abs(days)}d` : `${days}d restantes`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Risks */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-gray-400" /> Últimos Riscos Cadastrados
          </h3>
          {risks.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Nenhum risco cadastrado</p>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {risks.slice(0, 8).map(r => {
                const rt = RISK_TYPES[r.risk_type];
                return (
                  <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{r.description}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{r.sector}</p>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${rt?.color || ''}`}>{rt?.label || r.risk_type}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${SEVERITY_COLORS[r.severity] || ''}`}>{r.severity}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Full Risk Table */}
      <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Todas as Avaliações de Risco</h3>
          <RiskFormButton onSave={loadAll} hotelId={selectedHotel?.id} />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Setor</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Tipo</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Descrição</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Gravidade</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Revisão</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400"></th>
            </tr>
          </thead>
          <tbody>
            {risks.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">Nenhuma avaliação de risco</td></tr>
            )}
            {risks.map(r => {
              const rt = RISK_TYPES[r.risk_type];
              const overdue = r.review_date && parseISO(r.review_date) < today && r.status === 'active';
              return (
                <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-white">{r.sector}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${rt?.color || ''}`}>{rt?.label || r.risk_type}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{r.description}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${SEVERITY_COLORS[r.severity] || ''}`}>{r.severity}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      r.status === 'active' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                      r.status === 'mitigated' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}>
                      {r.status === 'active' ? 'Ativo' : r.status === 'mitigated' ? 'Mitigado' : 'Fechado'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.review_date ? (
                      <span className={overdue ? 'text-red-600 dark:text-red-400 font-medium text-xs' : 'text-xs text-gray-500 dark:text-gray-400'}>
                        {format(parseISO(r.review_date), 'dd/MM/yy')}
                        {overdue && ' ⚠'}
                      </span>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <RiskActions risk={r} onUpdate={loadAll} />
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

// ─── KPI Card ──────────────────────────────────────────────────────────────────
function KPICard({ icon: Icon, label, value, sublabel, color, alert }: {
  icon: React.ComponentType<any>; label: string; value: number; sublabel: string; color: string; alert?: boolean;
}) {
  const colors: Record<string, string> = {
    orange: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
  };
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border ${alert ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sublabel}</p>
    </div>
  );
}

// ─── Risk Form Button (inline modal) ────────────────────────────────────────
function RiskFormButton({ onSave, hotelId }: { onSave: () => void; hotelId?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sector, setSector] = useState('');
  const [riskType, setRiskType] = useState('fisico');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medio');
  const [mitigation, setMitigation] = useState('');
  const [responsible, setResponsible] = useState('');
  const [reviewDate, setReviewDate] = useState('');

  async function save() {
    if (!sector.trim() || !description.trim() || !hotelId) return;
    setSaving(true);
    await supabase.from('nr1_risk_assessments').insert({
      hotel_id: hotelId,
      sector: sector.trim(),
      risk_type: riskType,
      description: description.trim(),
      severity,
      mitigation_measures: mitigation.trim() || null,
      responsible: responsible.trim() || null,
      review_date: reviewDate || null,
      created_by: user?.id,
    });
    setSaving(false);
    setOpen(false);
    setSector(''); setDescription(''); setMitigation(''); setResponsible(''); setReviewDate('');
    onSave();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700">
        <Plus className="w-3.5 h-3.5" /> Novo Risco
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-5">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Nova Avaliação de Risco</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Setor *</label>
              <input type="text" value={sector} onChange={e => setSector(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo de Risco</label>
              <select value={riskType} onChange={e => setRiskType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                {Object.entries(RISK_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Descrição *</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Gravidade</label>
              <select value={severity} onChange={e => setSeverity(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                <option value="baixo">Baixo</option>
                <option value="medio">Médio</option>
                <option value="alto">Alto</option>
                <option value="critico">Crítico</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Responsável</label>
              <input type="text" value={responsible} onChange={e => setResponsible(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Revisão</label>
              <input type="date" value={reviewDate} onChange={e => setReviewDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Medidas de Mitigação</label>
            <textarea value={mitigation} onChange={e => setMitigation(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setOpen(false)}
            className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
          <button onClick={save} disabled={saving || !sector.trim() || !description.trim()}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-medium disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Risk Actions (update status) ──────────────────────────────────────────
function RiskActions({ risk, onUpdate }: { risk: RiskAssessment; onUpdate: () => void }) {
  async function updateStatus(status: string) {
    await supabase.from('nr1_risk_assessments').update({ status }).eq('id', risk.id);
    onUpdate();
  }

  async function deleteRisk() {
    if (!confirm('Remover esta avaliação de risco?')) return;
    await supabase.from('nr1_risk_assessments').delete().eq('id', risk.id);
    onUpdate();
  }

  return (
    <div className="flex items-center gap-1">
      {risk.status === 'active' && (
        <button onClick={() => updateStatus('mitigated')} title="Marcar como mitigado"
          className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30">
          <CheckCircle className="w-3.5 h-3.5 text-green-500" />
        </button>
      )}
      {risk.status !== 'closed' && (
        <button onClick={() => updateStatus('closed')} title="Fechar"
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
          <XCircle className="w-3.5 h-3.5 text-gray-400" />
        </button>
      )}
      <button onClick={deleteRisk} title="Remover"
        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
      </button>
    </div>
  );
}
