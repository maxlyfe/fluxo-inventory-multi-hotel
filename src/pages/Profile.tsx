// src/pages/Profile.tsx
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';
import {
  User, Mail, Camera, Save, Loader2, AlertCircle, CheckCircle,
  Hash, Building2, Briefcase, Calendar, Clock, LogOut,
  ShieldCheck, ArrowRight, Trash2
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

export default function Profile() {
  const { user, refreshProfile } = useAuth();
  const { selectedHotel } = useHotel();
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  
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
      checkEmployeeLink(user.cpf || '');
    }
  }, [user]);

  async function checkEmployeeLink(cpfValue: string) {
    if (!cpfValue) return;
    const cleanCpf = cpfValue.replace(/\D/g, '');
    if (cleanCpf.length !== 11) return;

    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*, hotels(name)')
        .eq('cpf', cleanCpf)
        .maybeSingle();
      
      if (!error && data) {
        setEmployee(data as EmployeeLink);
      } else {
        setEmployee(null);
      }
    } catch (err) {
      console.error('Erro ao buscar colaborador:', err);
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const cleanCpf = cpf.replace(/\D/g, '');
      
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          cpf: cleanCpf,
          updated_at: new Date().toISOString()
        })
        .eq('id', user?.id);

      if (error) throw error;

      // Se o CPF for de um colaborador, vincula o user_id na tabela employees
      if (cleanCpf.length === 11) {
        const { data: empData } = await supabase
          .from('employees')
          .select('id')
          .eq('cpf', cleanCpf)
          .maybeSingle();

        if (empData) {
          await supabase
            .from('employees')
            .update({ user_id: user?.id })
            .eq('id', empData.id);
          
          checkEmployeeLink(cleanCpf);
        }
      }

      await refreshProfile();
      setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao salvar perfil.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setLoading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Math.random()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      // Upload para o bucket 'avatars' (assume-se que existe)
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ photo_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setPhotoUrl(publicUrl);
      await refreshProfile();
      setMessage({ type: 'success', text: 'Foto atualizada!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Erro no upload: Verifique se o bucket "avatars" existe ou use a coluna photo_url.' });
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-indigo-900/40">
          <User className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">Seu Perfil</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie suas informações e vínculo com a rede</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Lado Esquerdo: Foto e Status */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 border border-slate-200 dark:border-slate-800 shadow-sm text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-indigo-500" />
            
            <div className="relative inline-block group mb-4">
              <div className="w-32 h-32 rounded-[2.5rem] bg-slate-100 dark:bg-slate-800 overflow-hidden border-4 border-white dark:border-slate-800 shadow-xl flex items-center justify-center">
                {photoUrl ? (
                  <img src={photoUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-16 h-16 text-slate-300" />
                )}
              </div>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 p-3 bg-indigo-500 text-white rounded-2xl shadow-lg hover:bg-indigo-600 transition-all active:scale-95"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handlePhotoUpload} 
                accept="image/*" 
                className="hidden" 
              />
            </div>

            <h3 className="font-black text-slate-800 dark:text-white text-lg truncate">
              {fullName || user?.email?.split('@')[0]}
            </h3>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest flex items-center justify-center gap-2 mt-1">
              <ShieldCheck className="w-3 h-3 text-indigo-500" /> {user?.custom_role?.name || user?.role}
            </p>
          </div>

          {/* Card de Vínculo com Colaborador */}
          {employee ? (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-[2rem] p-6 border border-indigo-100 dark:border-indigo-900/40">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center">
                  <Briefcase className="w-4 h-4 text-white" />
                </div>
                <h4 className="font-black text-indigo-900 dark:text-indigo-300 text-xs uppercase tracking-widest">Colaborador Vinculado</h4>
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Unidade:</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300">{employee.hotels?.name}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Cargo:</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300">{employee.role}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Setor:</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300">{employee.sector}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Admissão:</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {employee.admission_date ? format(new Date(employee.admission_date), 'dd/MM/yyyy') : '—'}
                  </span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-indigo-200/50 dark:border-indigo-800/50">
                <button 
                  onClick={() => navigate('/portal')}
                  className="w-full py-3 bg-white dark:bg-slate-800 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2"
                >
                  Ir para Meu Portal <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-[2rem] p-6 border border-dashed border-slate-300 dark:border-slate-800 text-center">
              <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">Nenhum vínculo detectado</h4>
              <p className="text-xs text-slate-400 mt-2">Informe seu CPF corretamente para sincronizar sua escala e dados do RH.</p>
            </div>
          )}
        </div>

        {/* Lado Direito: Formulário */}
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSave} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Nome Completo</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="Seu nome oficial"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">E-mail (Login)</label>
                <div className="relative opacity-60">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="email" 
                    value={user?.email || ''} 
                    disabled 
                    className="w-full pl-12 pr-4 py-4 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">CPF</label>
                <div className="relative">
                  <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    value={cpf}
                    onChange={e => setCpf(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="000.000.000-00"
                  />
                </div>
              </div>
            </div>

            {message && (
              <div className={`mt-6 p-4 rounded-2xl flex items-center gap-3 animate-fadeIn ${
                message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 'bg-red-50 dark:bg-red-900/20 text-red-600'
              }`}>
                {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                <p className="text-sm font-bold">{message.text}</p>
              </div>
            )}

            <div className="mt-8 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-10 py-4 bg-indigo-500 text-white font-black uppercase tracking-widest text-xs rounded-2xl hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-500/20 active:scale-95 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Salvar Alterações'}
              </button>
            </div>
          </form>

          {/* Bloco de Segurança */}
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-800 shadow-sm">
            <h4 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight mb-4">Segurança</h4>
            <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Último Acesso</p>
                  <p className="text-xs text-slate-400">
                    {user?.last_sign_in_at ? format(new Date(user.last_sign_in_at), "d 'de' MMMM 'às' HH:mm", { locale: ptBR }) : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
