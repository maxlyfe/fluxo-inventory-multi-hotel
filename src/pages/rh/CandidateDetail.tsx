// src/pages/rh/CandidateDetail.tsx
// Perfil do candidato com timeline, docs, copiar dados e visualização de currículo

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  User, Phone, Mail, MapPin, Calendar, Briefcase, FileText,
  AlertTriangle, Loader2, ChevronLeft, ArrowRight, UserPlus,
  Clock, MessageCircle, CheckCircle, XCircle, Edit2, Save, X,
  Copy, Check, Download, ExternalLink, Eye, FileImage, File,
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
  cep: string | null;
  address_number: string | null;
  state: string | null;
  experience: string | null;
  referral_source: string | null;
  status: string;
  status_notes: string | null;
  questionnaire_answers: any;
  documents: any;
  resume_url: string | null;
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

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; icon: React.ComponentType<any> }> = {
  applied:    { label: 'Inscrito',    color: 'text-blue-600 dark:text-blue-300',     bg: 'bg-blue-100 dark:bg-blue-900/30',     icon: User },
  screening:  { label: 'Triagem',     color: 'text-amber-600 dark:text-amber-300',   bg: 'bg-amber-100 dark:bg-amber-900/30',   icon: FileText },
  interview:  { label: 'Entrevista',  color: 'text-purple-600 dark:text-purple-300', bg: 'bg-purple-100 dark:bg-purple-900/30', icon: MessageCircle },
  approved:   { label: 'Aprovado',    color: 'text-green-600 dark:text-green-300',   bg: 'bg-green-100 dark:bg-green-900/30',   icon: CheckCircle },
  rejected:   { label: 'Rejeitado',   color: 'text-red-600 dark:text-red-300',       bg: 'bg-red-100 dark:bg-red-900/30',       icon: XCircle },
  hired:      { label: 'Contratado',  color: 'text-emerald-600 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-900/30', icon: UserPlus },
  blacklisted:{ label: 'Bloqueado',   color: 'text-gray-600 dark:text-gray-300',     bg: 'bg-gray-100 dark:bg-gray-700',       icon: AlertTriangle },
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
  const [copied, setCopied] = useState(false);
  const [showResumePreview, setShowResumePreview] = useState(false);

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

    const { error } = await supabase.from('employees').insert({
      hotel_id: selectedHotel.id,
      name: candidate.name,
      cpf: candidate.cpf,
      phone: candidate.phone,
      email: candidate.email,
      birth_date: candidate.birth_date,
      address: candidate.address,
      address_cep: candidate.cep || null,
      address_street: candidate.address || null,
      address_number: candidate.address_number || null,
      address_neighborhood: candidate.neighborhood || null,
      address_city: candidate.city || null,
      address_state: candidate.state || null,
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

  function copyAllData() {
    if (!candidate) return;
    const lines = [
      `Nome: ${candidate.name}`,
      `CPF: ${candidate.cpf}`,
      candidate.phone && `Telefone: ${candidate.phone}`,
      candidate.email && `E-mail: ${candidate.email}`,
      candidate.birth_date && `Nascimento: ${format(parseISO(candidate.birth_date), 'dd/MM/yyyy')}`,
      candidate.city && `Cidade: ${[candidate.neighborhood, candidate.city].filter(Boolean).join(', ')}`,
      candidate.address && `Endereço: ${candidate.address}`,
      candidate.job_openings?.title && `Vaga: ${candidate.job_openings.title}`,
      candidate.referral_source && `Indicação: ${candidate.referral_source}`,
      candidate.experience && `Experiência: ${candidate.experience}`,
      `Status: ${STATUS_LABELS[candidate.status]?.label || candidate.status}`,
      candidate.status_notes && `Observações: ${candidate.status_notes}`,
    ].filter(Boolean).join('\n');

    navigator.clipboard.writeText(lines).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function getResumeFileType(url: string): 'pdf' | 'image' | 'other' {
    const lower = url.toLowerCase();
    if (lower.includes('.pdf')) return 'pdf';
    if (lower.match(/\.(jpg|jpeg|png|gif|webp|bmp)/)) return 'image';
    return 'other';
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  if (!candidate) {
    return <div className="max-w-2xl mx-auto px-4 py-12 text-center"><p className="text-gray-500">Candidato não encontrado</p></div>;
  }

  const st = STATUS_LABELS[candidate.status] || STATUS_LABELS.applied;
  const StIcon = st.icon;
  const resumeType = candidate.resume_url ? getResumeFileType(candidate.resume_url) : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Back + Header Bar */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => navigate('/rh/candidates')}
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Candidatos
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={copyAllData}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              copied
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado!' : 'Copiar Dados'}
          </button>
        </div>
      </div>

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

      {/* Hero Card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 mb-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
            <span className="text-white text-2xl font-bold">{candidate.name.charAt(0).toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">{candidate.name}</h1>
              <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium ${st.color} ${st.bg}`}>
                <StIcon className="w-3 h-3" /> {st.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              {candidate.job_openings && (
                <span className="flex items-center gap-1">
                  <Briefcase className="w-3 h-3" /> {candidate.job_openings.title} · {candidate.job_openings.sector}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" /> Inscrito {formatDistanceToNow(parseISO(candidate.created_at), { addSuffix: true, locale: ptBR })}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Info + Resume + Actions */}
        <div className="lg:col-span-1 space-y-4">
          {/* Contact Info Card */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Informações</h3>
            </div>
            <div className="p-4 space-y-3">
              <InfoRow icon={FileText} label="CPF" value={candidate.cpf} copyable />
              <InfoRow icon={Phone} label="Telefone" value={candidate.phone} copyable />
              <InfoRow icon={Mail} label="E-mail" value={candidate.email} copyable />
              <InfoRow icon={Calendar} label="Nascimento" value={candidate.birth_date ? format(parseISO(candidate.birth_date), 'dd/MM/yyyy') : null} />
              <InfoRow icon={MapPin} label="Cidade" value={[candidate.neighborhood, candidate.city].filter(Boolean).join(', ') || null} />
              <InfoRow icon={MapPin} label="Endereço" value={candidate.address} />
              <InfoRow icon={User} label="Indicação" value={candidate.referral_source} />
            </div>
          </div>

          {/* Experience */}
          {candidate.experience && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Experiência</h3>
              </div>
              <div className="p-4">
                <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{candidate.experience}</p>
              </div>
            </div>
          )}

          {/* Resume / Currículo */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Currículo</h3>
            </div>
            <div className="p-4">
              {candidate.resume_url ? (
                <div className="space-y-3">
                  {/* Preview */}
                  {resumeType === 'image' && (
                    <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                      <img
                        src={candidate.resume_url}
                        alt="Currículo"
                        className="w-full max-h-72 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setShowResumePreview(true)}
                      />
                    </div>
                  )}
                  {resumeType === 'pdf' && (
                    <div
                      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-6 flex flex-col items-center gap-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      onClick={() => setShowResumePreview(true)}
                    >
                      <File className="w-10 h-10 text-red-500" />
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Documento PDF</span>
                      <span className="text-[10px] text-gray-400">Clique para visualizar</span>
                    </div>
                  )}
                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowResumePreview(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> Visualizar
                    </button>
                    <a
                      href={candidate.resume_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" /> Baixar
                    </a>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <FileImage className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-xs text-gray-400">Nenhum currículo anexado</p>
                </div>
              )}
            </div>
          </div>

          {/* Status Notes */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Observações</h3>
              {!editingNotes && (
                <button onClick={() => setEditingNotes(true)} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                  <Edit2 className="w-3.5 h-3.5 text-gray-400" />
                </button>
              )}
            </div>
            <div className="p-4">
              {editingNotes ? (
                <div>
                  <textarea value={statusNotes} onChange={e => setStatusNotes(e.target.value)} rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={saveStatusNotes} className="text-xs px-2.5 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-medium transition-colors">Salvar</button>
                    <button onClick={() => setEditingNotes(false)} className="text-xs px-2.5 py-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">Cancelar</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{candidate.status_notes || 'Sem observações'}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ações</h3>
            </div>
            <div className="p-4 space-y-2">
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
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium transition-colors shadow-sm">
                  <UserPlus className="w-4 h-4" /> Contratar
                </button>
              )}
              {candidate.status === 'hired' && (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  Candidato já foi contratado
                </div>
              )}
              {candidate.status === 'rejected' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-xs text-red-700 dark:text-red-400">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    Candidato rejeitado
                  </div>
                  <button onClick={() => changeStatus('screening')}
                    className="w-full text-xs px-3 py-2 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    Reabrir candidatura
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Timeline */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Timeline</h3>
              <span className="text-[10px] text-gray-400">{timeline.length} evento{timeline.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="p-4">
              {/* Add note */}
              <div className="flex gap-2 mb-5">
                <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addNote()}
                  placeholder="Adicionar observação na timeline..."
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors" />
                <button onClick={addNote} disabled={savingNote || !noteText.trim()}
                  className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 text-sm font-medium transition-colors">
                  {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
                </button>
              </div>

              {/* Timeline entries */}
              <div className="relative">
                <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-700" />
                <div className="space-y-4">
                  {timeline.length === 0 && (
                    <p className="text-sm text-gray-400 pl-10">Nenhuma atividade registrada</p>
                  )}
                  {timeline.map(entry => {
                    const isStatus = entry.action === 'status_change';
                    const isNote = entry.action === 'note';
                    return (
                      <div key={entry.id} className="flex gap-3 relative group">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 ring-4 ring-white dark:ring-gray-800 ${
                          isStatus ? 'bg-blue-100 dark:bg-blue-900/40' :
                          isNote ? 'bg-amber-100 dark:bg-amber-900/40' :
                          'bg-gray-100 dark:bg-gray-700'
                        }`}>
                          {isStatus ? <ArrowRight className="w-3.5 h-3.5 text-blue-500" /> :
                           isNote ? <MessageCircle className="w-3.5 h-3.5 text-amber-500" /> :
                           <Clock className="w-3.5 h-3.5 text-gray-400" />}
                        </div>
                        <div className="flex-1 min-w-0 bg-gray-50 dark:bg-gray-900/30 rounded-lg p-3 border border-gray-100 dark:border-gray-700/50">
                          <p className="text-sm text-gray-800 dark:text-white">
                            {isStatus && entry.details?.new_status
                              ? <>Movido para <span className={`font-medium ${STATUS_LABELS[entry.details.new_status]?.color || ''}`}>{STATUS_LABELS[entry.details.new_status]?.label || entry.details.new_status}</span></>
                              : isNote && entry.details?.text
                              ? entry.details.text
                              : entry.action}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-1">
                            {format(parseISO(entry.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Resume Preview Modal */}
      {showResumePreview && candidate.resume_url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShowResumePreview(false)}>
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800 dark:text-white">Currículo — {candidate.name}</h3>
              <div className="flex items-center gap-2">
                <a
                  href={candidate.resume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir em nova aba
                </a>
                <button
                  onClick={() => setShowResumePreview(false)}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900">
              {resumeType === 'pdf' ? (
                <iframe src={candidate.resume_url} className="w-full h-full min-h-[70vh]" title="Currículo PDF" />
              ) : resumeType === 'image' ? (
                <div className="flex items-center justify-center p-4">
                  <img src={candidate.resume_url} alt="Currículo" className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-lg" />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12">
                  <File className="w-12 h-12 text-gray-400 mb-3" />
                  <p className="text-sm text-gray-500">Formato não suportado para preview</p>
                  <a href={candidate.resume_url} target="_blank" rel="noopener noreferrer" download
                    className="mt-3 flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700">
                    <Download className="w-4 h-4" /> Baixar arquivo
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, copyable }: { icon: React.ComponentType<any>; label: string; value: string | null | undefined; copyable?: boolean }) {
  const [justCopied, setJustCopied] = useState(false);

  if (!value) return null;

  function handleCopy() {
    navigator.clipboard.writeText(value!).then(() => {
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    });
  }

  return (
    <div className="flex items-center gap-2 group">
      <Icon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      <span className="text-[10px] text-gray-500 dark:text-gray-400 w-16 flex-shrink-0 uppercase font-medium">{label}</span>
      <span className="text-sm text-gray-700 dark:text-gray-200 truncate flex-1">{value}</span>
      {copyable && (
        <button
          onClick={handleCopy}
          className={`p-1 rounded transition-all flex-shrink-0 ${
            justCopied
              ? 'text-emerald-500'
              : 'text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 hover:text-gray-500 dark:hover:text-gray-400'
          }`}
          title="Copiar"
        >
          {justCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      )}
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
    <button onClick={onClick} className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${colors[color] || colors.amber}`}>
      {label}
    </button>
  );
}
