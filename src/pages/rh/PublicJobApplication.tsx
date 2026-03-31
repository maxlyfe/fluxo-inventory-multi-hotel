// src/pages/rh/PublicJobApplication.tsx
// Página pública para candidatos se inscreverem em vagas via token

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  Briefcase, Loader2, CheckCircle, AlertTriangle, MapPin, Clock,
  DollarSign, FileText, Send, User, Phone, Mail, Calendar, Home,
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
  hotels?: { name: string; city?: string } | null;
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
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [address, setAddress] = useState('');
  const [experience, setExperience] = useState('');
  const [referralSource, setReferralSource] = useState('');

  useEffect(() => {
    if (token) loadJob();
  }, [token]);

  async function loadJob() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('job_openings')
      .select('*, hotels(name, city)')
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

    const { error: insertErr } = await supabase.from('candidates').insert({
      job_opening_id: job.id,
      hotel_id: job.hotel_id,
      name: name.trim(),
      cpf: cleanCpf,
      phone: phone.trim() || null,
      email: email.trim() || null,
      birth_date: birthDate || null,
      city: city.trim() || null,
      neighborhood: neighborhood.trim() || null,
      address: address.trim() || null,
      experience: experience.trim() || null,
      referral_source: referralSource.trim() || null,
      status: 'applied',
    });

    if (insertErr) {
      alert('Erro ao enviar candidatura. Tente novamente.');
    } else {
      // Add timeline entry
      // We can't add timeline here since we don't have the candidate id from insert
      // The trigger or backend can handle this
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
                {job!.hotels?.name}{job!.hotels?.city ? ` — ${job!.hotels.city}` : ''}
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
              <FormField label="Cidade" icon={MapPin}>
                <input type="text" value={city} onChange={e => setCity(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="Bairro" icon={MapPin}>
                <input type="text" value={neighborhood} onChange={e => setNeighborhood(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
              </FormField>
              <FormField label="Endereço" icon={Home}>
                <input type="text" value={address} onChange={e => setAddress(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" />
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
