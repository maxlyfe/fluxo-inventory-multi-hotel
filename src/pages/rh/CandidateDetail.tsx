// src/pages/rh/CandidateDetail.tsx
// Perfil do candidato com timeline, docs e botão de contratação

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  User, Phone, Mail, MapPin, Calendar, Briefcase, FileText,
  AlertTriangle, Loader2, ChevronLeft, ArrowRight, UserPlus,
  Clock, MessageCircle, CheckCircle, XCircle, Edit2, Save, X,
} from 'lucide-react';

interface Candidate {
  id: string;
  name: string;
  cpf: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  address: string | null;
  city: string | null;
  neighborhood: string | null;
  experience: string | null;
  referral_source: string | null;
  status: string;
  status_notes: string | null;
  questionnaire_answers: any;
  documents: any;
  created_at: string;
  updated_at: string;
  job_opening_id: string | null;
  hotel_id: string;
  job_openings?: { title: string; sector: string } | null;
}

interface TimelineEntry {
  id: string;
  action: string;
  details: any;
  created_at: string;
  created_by: string | null;
}

interface CpfAlert {
  registry_type: string;
  reason: string | null;
  registered_at: string;
  employee_name: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  applied:    { label: 'Inscrito',    color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300',     icon: User },
  screening:  { label: 'Triagem',     color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300', icon: FileText },
  interview:  { label: 'Entrevista',  color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300', icon: MessageCircle },
  approved:   { label: 'Aprovado',    color: 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle },
  rejected:   { label: 'Rejeitado',   color: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-300',         icon: XCircle },
  hired:      { label: 'Contratado',  color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300', icon: UserPlus },
  blacklisted:{ label: 'Bloqueado',   color: 'text-gray-600 bg-gray-100 dark:bg-gray-700 dark:text-gray-300',       icon: AlertTriangle },
};

export default function CandidateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedHotel } = useHotel();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [cpfAlerts, setCpfAlerts] = useState<CpfAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [statusNotes, setStatusNotes] = useState('');

  useEffect(() => {
    if (id) loadCandidate();
  }, [id]);

  async function loadCandidate() {
    setLoading(true);
    const [candRes, timeRes] = await Promise.all([
      supabase
        .from('candidates')
        .select('*, job_openings(title, sector)')
        .eq('id', id!)
        .single(),
      supabase
        .from('candidate_timeline')
        .select('*')
        .eq('candidate_id', id!)
        .order('created_at', { ascending: false }),
    ]);

    if (candRes.data) {
      setCandidate(candRes.data as any);
      setStatusNotes(candRes.data.status_notes || '');

      // Check CPF alerts
      const { data: alerts } = await supabase
        .from('cpf_registry')
        .select('registry_type, reason, registered_at, employee_name')
        .eq('cpf', candRes.data.cpf);
      setCpfAlerts(alerts || []);
    }
    setTimeline(timeRes.data || []);
    setLoading(false);
  }

  async function changeStatus(newStatus: string) {
    if (!candidate) return;
    await supabase.from('candidates').update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', candidate.id);

    await supabase.from('candidate_timeline').insert({
      candidate_id: candidate.id,
      action: 'status_change',
      details: { old_status: candidate.status, new_status: newStatus },
      created_by: user?.id,
    });

    loadCandidate();
  }

  async function addNote() {
    if (!noteText.trim() || !candidate) return;
    setSavingNote(true);
    await supabase.from('candidate_timeline').insert({
      candidate_id: candidate.id,
      action: 'note',
      details: { text: noteText.trim() },
      created_by: user?.id,
    });
    setNoteText('');
    setSavingNote(false);
    loadCandidate();
  }

  async function saveStatusNotes() {
    if (!candidate) return;
    await supabase.from('candidates').update({ status_notes: statusNotes.trim() || null }).eq('id', candidate.id);
    setEditingNotes(false);
    loadCandidate();
  }

  async function handleHire() {
    if (!candidate || !selectedHotel) return;
    if (!confirm(`Contratar ${candidate.name}? Será criado um novo colaborador no DP.`)) return;

    // Create employee from candidate
    const { error } = await supabase.from('employees').insert({
      hotel_id: selectedHotel.id,
      name: candidate.name,
      cpf: candidate.cpf,
      phone: candidate.phone,
      email: candidate.email,
      birth_date: candidate.birth_date,
      address: candidate.address,
      role: candidate.job_openings?.title || '',
      sector: candidate.job_openings?.sector || 'Outro',
      admission_date: format(new Date(), 'yyyy-MM-dd'),
      contract_type: 'experiencia',
      status: 'active',
    });

    if (!error) {
      await changeStatus('hired');
      alert(`${candidate.name} contratado com sucesso! Cadastro criado no DP.`);
    } else {
      alert('Erro ao criar colaborador: ' + error.message);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  if (!candidate) {
    return <div className="max-w-2xl mx-auto px-4 py-12 text-center"><p className="text-gray-500">Candidato não encontrado</p></div>;
  }

  const st = STATUS_LABELS[candidate.status] || STATUS_LABELS.applied;
  const StIcon = st.icon;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Back */}
      <button onClick={() => navigate('/rh/candidates')}
        className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-4">
        <ChevronLeft className="w-4 h-4" /> Candidatos
      </button>

      {/* CPF Alert */}
      {cpfAlerts.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h3 className="text-sm font-bold text-red-700 dark:text-red-300">Alerta de CPF</h3>
          </div>
          {cpfAlerts.map((a, i) => (
            <div key={i} className="text-sm text-red-600 dark:text-red-400 mt-1">
              <span className="font-medium">{a.registry_type === 'dismissed_cause' ? 'Justa causa' : a.registry_type === 'abandoned' ? 'Abandono' : a.registry_type === 'blacklisted' ? 'Bloqueado' : 'Saída normal'}</span>
              {a.reason && <span> — {a.reason}</span>}
              <span className="text-xs ml-2">({format(parseISO(a.registered_at), 'dd/MM/yyyy')})</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Profile Card */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-center mb-4">
              <div className="w-16 h-16 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mx-auto mb-2">
                <User className="w-8 h-8 text-violet-500" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{candidate.name}</h2>
              <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${st.color} mt-1`}>
                <StIcon className="w-3 h-3" /> {st.label}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              <InfoRow icon={FileText} label="CPF" value={candidate.cpf} />
              <InfoRow icon={Phone} label="Telefone" value={candidate.phone} />
              <InfoRow icon={Mail} label="E-mail" value={candidate.email} />
              <InfoRow icon={Calendar} label="Nascimento" value={candidate.birth_date ? format(parseISO(candidate.birth_date), 'dd/MM/yyyy') : null} />
              <InfoRow icon={MapPin} label="Cidade" value={[candidate.neighborhood, candidate.city].filter(Boolean).join(', ') || null} />
              <InfoRow icon={MapPin} label="Endereço" value={candidate.address} />
              <InfoRow icon={Briefcase} label="Vaga" value={candidate.job_openings?.title} />
              <InfoRow icon={User} label="Indicação" value={candidate.referral_source} />
            </div>

            {candidate.experience && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Experiência</p>
                <p className="text-sm text-gray-700 dark:text-gray-200">{candidate.experience}</p>
              </div>
            )}
          </div>

          {/* Status Notes */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Observações</h3>
              {!editingNotes && (
                <button onClick={() => setEditingNotes(true)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                  <Edit2 className="w-3.5 h-3.5 text-gray-400" />
                </button>
              )}
            </div>
            {editingNotes ? (
              <div>
                <textarea value={statusNotes} onChange={e => setStatusNotes(e.target.value)} rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none" />
                <div className="flex gap-1 mt-2">
                  <button onClick={saveStatusNotes} className="text-xs px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Salvar</button>
                  <button onClick={() => setEditingNotes(false)} className="text-xs px-2 py-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">{candidate.status_notes || 'Sem observações'}</p>
            )}
          </div>

          {/* Actions */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-2">Ações</h3>
            {candidate.status !== 'hired' && candidate.status !== 'rejected' && (
              <div className="flex flex-wrap gap-1.5">
                {candidate.status !== 'screening' && <ActionBtn label="Triagem" onClick={() => changeStatus('screening')} color="amber" />}
                {candidate.status !== 'interview' && <ActionBtn label="Entrevista" onClick={() => changeStatus('interview')} color="purple" />}
                {candidate.status !== 'approved' && <ActionBtn label="Aprovar" onClick={() => changeStatus('approved')} color="green" />}
                <ActionBtn label="Rejeitar" onClick={() => changeStatus('rejected')} color="red" />
              </div>
            )}
            {candidate.status === 'approved' && (
              <button onClick={handleHire}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium mt-2">
                <UserPlus className="w-4 h-4" /> Contratar
              </button>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-4">Timeline</h3>

            {/* Add note */}
            <div className="flex gap-2 mb-4">
              <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addNote()}
                placeholder="Adicionar observação..."
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
              <button onClick={addNote} disabled={savingNote || !noteText.trim()}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
              </button>
            </div>

            {/* Timeline entries */}
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
              <div className="space-y-4">
                {timeline.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 pl-10">Nenhuma atividade registrada</p>
                )}
                {timeline.map(entry => (
                  <div key={entry.id} className="flex gap-3 relative">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                      entry.action === 'status_change' ? 'bg-blue-100 dark:bg-blue-900/30' :
                      entry.action === 'note' ? 'bg-amber-100 dark:bg-amber-900/30' :
                      'bg-gray-100 dark:bg-gray-700'
                    }`}>
                      {entry.action === 'status_change' ? <ArrowRight className="w-4 h-4 text-blue-500" /> :
                       entry.action === 'note' ? <MessageCircle className="w-4 h-4 text-amber-500" /> :
                       <Clock className="w-4 h-4 text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <p className="text-sm text-gray-800 dark:text-white">
                        {entry.action === 'status_change' && entry.details?.new_status
                          ? `Movido para ${STATUS_LABELS[entry.details.new_status]?.label || entry.details.new_status}`
                          : entry.action === 'note' && entry.details?.text
                          ? entry.details.text
                          : entry.action}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {format(parseISO(entry.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<any>; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      <span className="text-xs text-gray-500 dark:text-gray-400 w-16 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{value}</span>
    </div>
  );
}

function ActionBtn({ label, onClick, color }: { label: string; onClick: () => void; color: string }) {
  const colors: Record<string, string> = {
    amber: 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
    purple: 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300',
    green: 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300',
    red: 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <button onClick={onClick} className={`text-xs px-2.5 py-1 rounded-lg font-medium ${colors[color] || colors.amber}`}>
      {label}
    </button>
  );
}
