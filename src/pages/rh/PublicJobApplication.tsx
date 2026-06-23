// src/pages/rh/PublicJobApplication.tsx
// Página pública para candidatos se inscreverem em vagas via token

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  Briefcase, Loader2, CheckCircle, AlertTriangle, MapPin, Clock,
  DollarSign, FileText, Send, User, Phone, Mail, Calendar, Home,
  Upload, X, File, Search,
} from 'lucide-react';

interface JobOpening {
  id: string;
  title: string;
  sector: string;
  description: string | null;
  requirements: string | null;
  salary_range_min: number | null;
  salary_range_max: number | null;
  contract_type: string | null;
  work_schedule: string | null;
  status: string;
  hotel_id: string;
  hotels?: { name: string } | null;
}

const CONTRACT_LABELS: Record<string, string> = {
  clt: 'CLT',
  pj: 'PJ',
  temporario: 'Temporário',
  estagio: 'Estágio',
};

export default function PublicJobApplication() {
  const { token } = useParams<{ token: string }>();

  const [job, setJob] = useState<JobOpening | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [cep, setCep] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState('');
  const lastLookedUpCep = useRef('');
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [address, setAddress] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [addressState, setAddressState] = useState('');
  const [experience, setExperience] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumePreview, setResumePreview] = useState<string | null>(null);

  useEffect(() => {
    if (token) loadJob();
  }, [token]);

  async function loadJob() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('job_openings')
      .select('*, hotels(name)')
      .eq('public_token', token!)
      .single();

    if (err || !data) {
      setError('Vaga não encontrada ou link inválido.');
    } else if (data.status !== 'open') {
      setError('Esta vaga não está mais recebendo candidaturas.');
    } else {
      setJob(data as any);
    }
    setLoading(false);
  }

  const lookupCep = async (digits: string) => {
    if (digits.length !== 8 || digits === lastLookedUpCep.current) return;
    lastLookedUpCep.current = digits;
    setCepLoading(true);
    setCepError('');
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!res.ok) { setCepError('Erro ao consultar CEP'); return; }
      const data = await res.json();
      if (data.erro) { setCepError('CEP não encontrado'); return; }
      if (data.logradouro) setAddress(data.logradouro);
      if (data.bairro) setNeighborhood(data.bairro);
      if (data.localidade) setCity(data.localidade);
      if (data.uf) setAddressState(data.uf);
    } catch {
      setCepError('Falha na conexão. Preencha manualmente.');
    } finally { setCepLoading(false); }
  };

  const handleCepChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    const formatted = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
    setCep(formatted);
    setCepError('');
    if (digits.length < 8) lastLookedUpCep.current = '';
    if (digits.length === 8) lookupCep(digits);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!job || !name.trim() || !cpf.trim()) return;

    setSubmitting(true);

    const cleanCpf = cpf.replace(/\D/g, '');

    // Check if CPF already applied to this job
    const { data: existing } = await supabase
      .from('candidates')
      .select('id')
      .eq('job_opening_id', job.id)
      .eq('cpf', cleanCpf)
      .limit(1);

    if (existing && existing.length > 0) {
      alert('Você já se candidatou a esta vaga.');
      setSubmitting(false);
      return;
    }

    let resumeUrl: string | null = null;

    if (resumeFile) {
      const ext = resumeFile.name.split('.').pop() || 'pdf';
      const path = `resumes/${job.id}/${cleanCpf}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('candidates')
        .upload(path, resumeFile, { upsert: true });

      if (uploadErr) {
        console.error('Erro ao subir currículo:', uploadErr);
      } else {
        const { data: urlData } = supabase.storage
          .from('candidates')
          .getPublicUrl(path);
        resumeUrl = urlData.publicUrl;
      }
    }

    const { error: insertErr } = await supabase.from('candidates').insert({
      job_opening_id: job.id,
      hotel_id: job.hotel_id,
      name: name.trim(),
      cpf: cleanCpf,
      phone: phone.trim() || null,
      email: email.trim() || null,
      birth_date: birthDate || null,
      cep: cep.trim() || null,
      city: city.trim() || null,
      neighborhood: neighborhood.trim() || null,
      address: address.trim() || null,
      address_number: addressNumber.trim() || null,
      state: addressState || null,
      experience: experience.trim() || null,
      referral_source: referralSource.trim() || null,
      resume_url: resumeUrl,
      status: 'applied',
    });

    if (insertErr) {
      alert('Erro ao enviar candidatura. Tente novamente.');
    } else {
      setSubmitted(true);
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-900 mb-2">Ops!</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-900 mb-2">Candidatura Enviada!</h2>
          <p className="text-gray-600">
            Obrigado, <strong>{name}</strong>! Sua candidatura para <strong>{job?.title}</strong> foi recebida com sucesso.
            Entraremos em contato em breve.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Job Info Card */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center">
              <Briefcase className="w-6 h-6 text-violet-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{job!.title}</h1>
              <p className="text-sm text-gray-500">
                {job!.hotels?.name}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mb-4">
            <InfoBadge icon={Briefcase} text={job!.sector} />
            {job!.contract_type && <InfoBadge icon={FileText} text={CONTRACT_LABELS[job!.contract_type] || job!.contract_type} />}
            {job!.work_schedule && <InfoBadge icon={Clock} text={job!.work_schedule} />}
            {(job!.salary_range_min || job!.salary_range_max) && (
              <InfoBadge icon={DollarSign} text={
                job!.salary_range_min && job!.salary_range_max
                  ? `R$ ${job!.salary_range_min.toLocaleString('pt-BR')} – ${job!.salary_range_max.toLocaleString('pt-BR')}`
                  : job!.salary_range_min
                  ? `A partir de R$ ${job!.salary_range_min.toLocaleString('pt-BR')}`
                  : `Até R$ ${job!.salary_range_max!.toLocaleString('pt-BR')}`
              } />
            )}
          </div>

          {job!.description && (
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Descrição</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{job!.description}</p>
            </div>
          )}
          {job!.requirements && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Requisitos</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{job!.requirements}</p>
            </div>
          )}
        </div>

        {/* Application Form */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Candidatar-se</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Nome completo *" icon={User}>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="CPF *" icon={FileText}>
                <input type="text" value={cpf} onChange={e => setCpf(e.target.value)} required
                  placeholder="000.000.000-00"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="Telefone" icon={Phone}>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="(00) 00000-0000"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="E-mail" icon={Mail}>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="Data de nascimento" icon={Calendar}>
                <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <div>
                <FormField label="CEP" icon={Search}>
                  <input type="text" value={cep} onChange={e => handleCepChange(e.target.value)}
                    onBlur={() => { const d = cep.replace(/\D/g, ''); if (d.length === 8) lookupCep(d); }}
                    placeholder="00000-000"
                    className={`w-full pl-9 pr-9 py-2.5 rounded-lg border text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 ${cepError ? 'border-amber-400' : 'border-gray-300'}`} />
                  {cepLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-violet-500" />}
                </FormField>
                {cepError && <p className="text-xs text-amber-600 mt-1 ml-1">{cepError}</p>}
              </div>
              <FormField label="Rua" icon={Home}>
                <input type="text" value={address} onChange={e => setAddress(e.target.value)}
                  placeholder="Nome da rua"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="Nº" icon={Home}>
                <input type="text" value={addressNumber} onChange={e => setAddressNumber(e.target.value)}
                  placeholder="Nº"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="Bairro" icon={MapPin}>
                <input type="text" value={neighborhood} onChange={e => setNeighborhood(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="Cidade" icon={MapPin}>
                <input type="text" value={city} onChange={e => setCity(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="Estado" icon={MapPin}>
                <select value={addressState} onChange={e => setAddressState(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 appearance-none">
                  <option value="">Selecione</option>
                  {'AC,AL,AP,AM,BA,CE,DF,ES,GO,MA,MT,MS,MG,PA,PB,PR,PE,PI,RJ,RN,RS,RO,RR,SC,SP,SE,TO'.split(',').map(uf => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Experiência profissional</label>
              <textarea value={experience} onChange={e => setExperience(e.target.value)} rows={3}
                placeholder="Descreva sua experiência anterior..."
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm resize-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Como soube da vaga?</label>
              <input type="text" value={referralSource} onChange={e => setReferralSource(e.target.value)}
                placeholder="Ex: indicação, site, redes sociais..."
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
            </div>

            {/* Resume Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currículo (PDF, foto ou imagem)</label>
              {resumeFile ? (
                <div className="flex items-center gap-3 p-3 bg-violet-50 border border-violet-200 rounded-lg">
                  {resumePreview ? (
                    <img src={resumePreview} alt="Preview" className="w-12 h-12 rounded object-cover flex-shrink-0 border border-violet-200" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-violet-100 flex items-center justify-center flex-shrink-0">
                      <File className="w-6 h-6 text-violet-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{resumeFile.name}</p>
                    <p className="text-xs text-gray-500">{(resumeFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setResumeFile(null); setResumePreview(null); }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-violet-400 hover:bg-violet-50/50 transition-colors">
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600 font-medium">Clique para enviar seu currículo</span>
                  <span className="text-xs text-gray-400 mt-1">PDF, JPG, PNG — até 10MB</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 10 * 1024 * 1024) {
                        alert('Arquivo muito grande. Máximo: 10MB.');
                        return;
                      }
                      setResumeFile(file);
                      if (file.type.startsWith('image/')) {
                        const reader = new FileReader();
                        reader.onload = (ev) => setResumePreview(ev.target?.result as string);
                        reader.readAsDataURL(file);
                      } else {
                        setResumePreview(null);
                      }
                    }}
                  />
                </label>
              )}
            </div>

            <button type="submit" disabled={submitting || !name.trim() || !cpf.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-medium disabled:opacity-50 transition-colors">
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              Enviar Candidatura
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Seus dados serão utilizados exclusivamente para o processo seletivo.
        </p>
      </div>
    </div>
  );
}

function InfoBadge({ icon: Icon, text }: { icon: React.ComponentType<any>; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
      <Icon className="w-3 h-3" /> {text}
    </span>
  );
}

function FormField({ label, icon: Icon, children }: { label: string; icon: React.ComponentType<any>; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        {children}
      </div>
    </div>
  );
}
