// src/pages/Profile.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';
import {
  User, Mail, Camera, Save, Loader2, AlertCircle, CheckCircle,
  Hash, Building2, Briefcase, Calendar, Clock, LogOut,
  ShieldCheck, ArrowRight, Trash2, Info
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface EmployeeLink {
  id: string;
  name: string;
  role: string;
  sector: string;
  admission_date: string;
  hotel_id: string;
  photo_url: string | null;
  hotels?: { name: string };
}

function formatMaskedCPF(cpf: string): string {
  if (!cpf) return '';
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return cpf;
  return `${clean.substring(0, 3)}.***.***-${clean.substring(9, 11)}`;
}

export default function Profile() {
  const { user, refreshProfile, isCompatibilityMode } = useAuth();
  const { selectedHotel } = useHotel();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);
  
  // Form states
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [cpf, setCpf] = useState(user?.cpf || '');
  const [photoUrl, setPhotoUrl] = useState(user?.photo_url || '');
  
  // Link state
  const [employee, setEmployee] = useState<EmployeeLink | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setCpf(user.cpf || '');
      setPhotoUrl(user.photo_url || '');
      checkEmployeeLink();
    }
  }, [user]);

  async function checkEmployeeLink() {
    if (!user?.id) return;
    try {
      const { data: byId } = await supabase.from('employees').select('*, hotels(name)').eq('user_id', user.id).maybeSingle();
      if (byId) {
        setEmployee(byId as EmployeeLink);
        if (!cpf && byId.cpf) setCpf(byId.cpf);
        return;
      }
      if (user.cpf) {
        const cleanCpf = user.cpf.replace(/\D/g, '');
        if (cleanCpf.length === 11) {
          const { data: byCpf } = await supabase.from('employees').select('*, hotels(name)').eq('cpf', cleanCpf).maybeSingle();
          if (byCpf) {
            setEmployee(byCpf as EmployeeLink);
            if (!byCpf.user_id) await supabase.from('employees').update({ user_id: user.id }).eq('id', byCpf.id);
          }
        }
      }
    } catch (err) { console.error(err); }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const cleanCpf = cpf.replace(/\D/g, '');
      const updateData: any = { full_name: fullName, updated_at: new Date().toISOString() };
      
      // Se estamos em modo de compatibilidade, nem tentamos o CPF
      if (isCompatibilityMode) {
        const { error } = await supabase.from('profiles').update(updateData).eq('id', user?.id);
        if (error) throw error;
        setMessage({ type: 'info', text: 'Nome salvo! CPF e Foto desativados no banco.' });
      } else {
        const { error } = await supabase.from('profiles').update({ ...updateData, cpf: cleanCpf }).eq('id', user?.id);
        if (error) throw error;
        setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
      }

      await refreshProfile();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setMessage({ type: 'info', text: 'O recurso de foto exige a criação do bucket "avatars" no Supabase.' });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-indigo-900/40"><User className="h-6 w-6 text-white" /></div>
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">Seu Perfil</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie suas informações e vínculo</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 border border-slate-200 dark:border-slate-800 shadow-sm text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-indigo-500" />
            <div className="relative inline-block group mb-4">
              <div className="w-32 h-32 rounded-[2.5rem] bg-slate-100 dark:bg-slate-800 overflow-hidden border-4 border-white dark:border-slate-800 shadow-xl flex items-center justify-center">
                {photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" /> : <User className="w-16 h-16 text-slate-300" />}
              </div>
              <button onClick={() => fileInputRef.current?.click()} className="absolute bottom-0 right-0 p-3 bg-indigo-500 text-white rounded-2xl shadow-lg hover:bg-indigo-600 transition-all"><Camera className="w-4 h-4" /></button>
              <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" />
            </div>
            <h3 className="font-black text-slate-800 dark:text-white text-lg truncate">{fullName || user?.email?.split('@')[0]}</h3>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest flex items-center justify-center gap-2 mt-1"><ShieldCheck className="w-3 h-3 text-indigo-500" /> {user?.custom_role?.name || user?.role}</p>
          </div>

          {employee ? (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-[2rem] p-6 border border-indigo-100 dark:border-indigo-900/40">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center"><Briefcase className="w-4 h-4 text-white" /></div>
                <h4 className="font-black text-indigo-900 dark:text-indigo-300 text-xs uppercase tracking-widest">Colaborador Vinculado</h4>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs"><span className="text-slate-500">Unidade:</span><span className="font-bold text-slate-700 dark:text-slate-300">{employee.hotels?.name}</span></div>
                <div className="flex justify-between items-center text-xs"><span className="text-slate-500">Cargo:</span><span className="font-bold text-slate-700 dark:text-slate-300">{employee.role}</span></div>
                <div className="flex justify-between items-center text-xs"><span className="text-slate-500">Setor:</span><span className="font-bold text-slate-700 dark:text-slate-300">{employee.sector}</span></div>
              </div>
              <div className="mt-6 pt-4 border-t border-indigo-200/50 dark:border-indigo-800/50">
                <button onClick={() => navigate('/portal')} className="w-full py-3 bg-white dark:bg-slate-800 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2">Ir para Meu Portal <ArrowRight className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-[2rem] p-6 border border-dashed border-slate-300 dark:border-slate-800 text-center">
              <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">Sem vínculo ativo</h4>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSave} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Nome Completo</label>
                <div className="relative"><User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" /></div>
              </div>
              <div><label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">E-mail</label><div className="relative opacity-60"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="email" value={user?.email || ''} disabled className="w-full pl-12 pr-4 py-4 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm" /></div></div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">CPF (Requer SQL)</label>
                <div className="relative opacity-50"><Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="text" value={employee ? formatMaskedCPF(cpf) : cpf} disabled className="w-full pl-12 pr-4 py-4 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm cursor-not-allowed" /></div>
              </div>
            </div>

            {message && (
              <div className={`mt-6 p-4 rounded-2xl flex items-center gap-3 animate-fadeIn ${
                message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 
                message.type === 'info' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : 'bg-red-50 dark:bg-red-900/20 text-red-600'
              }`}>
                {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : message.type === 'info' ? <Info className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                <p className="text-sm font-bold">{message.text}</p>
              </div>
            )}

            <div className="mt-8 flex justify-end">
              <button type="submit" disabled={saving} className="px-10 py-4 bg-indigo-500 text-white font-black uppercase tracking-widest text-xs rounded-2xl hover:bg-indigo-600 transition-all shadow-xl active:scale-95 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar Perfil'}</button>
            </div>
          </form>
          
          {isCompatibilityMode && (
            <div className="p-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-3xl animate-fadeIn">
              <h4 className="text-amber-800 dark:text-amber-300 font-bold text-sm flex items-center gap-2 mb-2"><AlertCircle className="w-4 h-4" /> Atualização de Banco Pendente</h4>
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">O sistema detectou que colunas essenciais (CPF/Foto) ainda não foram criadas no seu Supabase. Os recursos de vínculo automático e avatares estão temporariamente desativados para evitar erros.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
