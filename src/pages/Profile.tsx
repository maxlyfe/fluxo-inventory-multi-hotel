// src/pages/Profile.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';
import {
  User, Mail, Camera, Save, Loader2, AlertCircle, CheckCircle,
  Hash, Building2, Briefcase, Calendar, Clock, LogOut,
  ShieldCheck, ArrowRight, Trash2, Info, RefreshCw,
  Lock, Eye, EyeOff, Bell, BellOff
} from 'lucide-react';
import { getTodayShift } from '../lib/workHours';
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
  const [employee, setEmployee]           = useState<EmployeeLink | null>(null);
  const [matchEmployee, setMatchEmployee] = useState<EmployeeLink | null>(null); // cadastro com meu CPF, disponível para vincular
  const [linking, setLinking]             = useState(false);
  const [unlinking, setUnlinking]         = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Alterar a própria senha (sem exigir a senha atual — sessão já autenticada)
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword]   = useState(false);
  const [showPassword, setShowPassword]       = useState(false);

  // Preferência: notificações apenas no horário de trabalho
  const [notifyWorkHoursOnly, setNotifyWorkHoursOnly] = useState(false);
  const [savingNotifyPref, setSavingNotifyPref]       = useState(false);
  const [todayShift, setTodayShift]                   = useState<{ shift_start: string; shift_end: string } | null>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setCpf(user.cpf || '');
      setPhotoUrl(user.photo_url || '');
      checkEmployeeLink();
      loadNotifyPref();
    }
  }, [user]);

  async function loadNotifyPref() {
    if (!user?.id) return;
    const { data } = await supabase
      .from('profiles')
      .select('notify_work_hours_only')
      .eq('id', user.id)
      .single();
    if (data) setNotifyWorkHoursOnly(data.notify_work_hours_only ?? false);
  }

  async function checkEmployeeLink() {
    if (!user?.id) return;
    try {
      // 1. Vínculo atual (apenas por user_id) — NUNCA re-vincula sozinho
      const { data: byId } = await supabase.from('employees').select('*, hotels(name)').eq('user_id', user.id).maybeSingle();
      if (byId) {
        setEmployee(byId as EmployeeLink);
        setMatchEmployee(null);
        if (!cpf && byId.cpf) setCpf(byId.cpf);
        getTodayShift(byId.id).then(setTodayShift);
        return;
      }
      setEmployee(null);

      // 2. Não vinculado: existe um cadastro com meu CPF disponível para vincular?
      const cleanCpf = (cpf || user.cpf || '').replace(/\D/g, '');
      if (cleanCpf.length === 11) {
        const { data: byCpf } = await supabase
          .from('employees')
          .select('*, hotels(name), user_id')
          .eq('cpf', cleanCpf)
          .maybeSingle();
        // Oferece vínculo só se o cadastro existe e não está preso a OUTRO usuário
        setMatchEmployee(byCpf && (!byCpf.user_id || byCpf.user_id === user.id) ? (byCpf as EmployeeLink) : null);
      } else {
        setMatchEmployee(null);
      }
    } catch (err) { console.error(err); }
  }

  // Vincular explicitamente o cadastro encontrado por CPF
  async function handleLink() {
    if (!user?.id || !matchEmployee) return;
    setLinking(true);
    try {
      const { error } = await supabase.from('employees').update({ user_id: user.id }).eq('id', matchEmployee.id);
      if (error) throw error;
      setEmployee(matchEmployee);
      setMatchEmployee(null);
      setMessage({ type: 'success', text: `Vinculado ao cadastro de ${matchEmployee.name}! 🎉` });
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Erro ao vincular.' });
    } finally { setLinking(false); }
  }

  // Desvincular o usuário do cadastro (reversível — não re-vincula sozinho)
  async function handleUnlink() {
    if (!user?.id || !employee) return;
    setUnlinking(true);
    try {
      const { error } = await supabase.from('employees').update({ user_id: null }).eq('id', employee.id);
      if (error) throw error;
      setMatchEmployee(employee); // permanece como opção de re-vincular
      setEmployee(null);
      setMessage({ type: 'info', text: 'Vínculo removido. Você pode vincular novamente quando quiser.' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Erro ao desvincular.' });
    } finally { setUnlinking(false); }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const cleanCpf = cpf.replace(/\D/g, '');
      const updateData: any = { full_name: fullName, updated_at: new Date().toISOString() };
      
      // Tenta atualizar. Se der erro de coluna CPF ou modo compatibilidade estiver ativo, salvamos apenas nome.
      let error = null;
      if (!isCompatibilityMode) {
        const res = await supabase.from('profiles').update({ ...updateData, cpf: cleanCpf }).eq('id', user?.id);
        error = res.error;
      } else {
        const res = await supabase.from('profiles').update(updateData).eq('id', user?.id);
        error = res.error;
      }

      if (error && (error.message.includes('cpf') || (error as any).status === 400)) {
        await supabase.from('profiles').update(updateData).eq('id', user?.id);
        setMessage({ type: 'info', text: 'Nome salvo! O banco ainda não possui as colunas de CPF/Foto.' });
      } else if (error) {
        throw error;
      } else {
        setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
        // Procura (sem vincular) um cadastro com este CPF para oferecer o vínculo
        if (!employee && cleanCpf.length === 11) {
          await checkEmployeeLink();
        }
      }

      // Força uma verificação completa do esquema após salvar, para ver se o SQL já foi rodado
      await refreshProfile(true);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'As senhas não coincidem.' });
      return;
    }
    setSavingPassword(true);
    setMessage(null);
    try {
      // updateUser não exige a senha atual — a sessão já está autenticada
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword(''); setConfirmPassword('');
      setMessage({ type: 'success', text: 'Senha alterada com sucesso!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao alterar a senha.' });
    } finally {
      setSavingPassword(false);
    }
  };

  async function handleToggleNotifyPref(value: boolean) {
    if (!user?.id) return;
    setSavingNotifyPref(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notify_work_hours_only: value })
        .eq('id', user.id);
      if (error) throw error;
      setNotifyWorkHoursOnly(value);
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Erro ao salvar preferência.' });
    } finally {
      setSavingNotifyPref(false);
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validar tamanho (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'A imagem deve ter no máximo 2MB.' });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`; 

      // Tenta upload para o bucket 'avatars'
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) {
        console.error('Erro no storage:', uploadError);
        throw new Error('Falha no upload. Verifique se o bucket "avatars" foi criado no Supabase como PUBLIC.');
      }

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ photo_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setPhotoUrl(publicUrl);
      await refreshProfile(true);
      setMessage({ type: 'success', text: 'Foto atualizada com sucesso!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao processar imagem.' });
    } finally {
      setLoading(false);
    }
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
              <button disabled={isCompatibilityMode} onClick={() => fileInputRef.current?.click()} className={`absolute bottom-0 right-0 p-3 bg-indigo-500 text-white rounded-2xl shadow-lg hover:bg-indigo-600 transition-all ${isCompatibilityMode ? 'opacity-50 grayscale cursor-not-allowed' : ''}`}><Camera className="w-4 h-4" /></button>
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
              <div className="mt-6 pt-4 border-t border-indigo-200/50 dark:border-indigo-800/50 space-y-2">
                <button onClick={() => navigate('/portal')} className="w-full py-3 bg-white dark:bg-slate-800 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2">Ir para Meu Portal <ArrowRight className="w-3.5 h-3.5" /></button>
                <button onClick={handleUnlink} disabled={unlinking} className="w-full py-3 rounded-xl text-xs font-bold text-red-500 dark:text-red-400 uppercase tracking-widest hover:bg-red-50 dark:hover:bg-red-900/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                  {unlinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Desvincular meu usuário
                </button>
              </div>
            </div>
          ) : matchEmployee ? (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-[2rem] p-6 border border-emerald-100 dark:border-emerald-900/40">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center"><Briefcase className="w-4 h-4 text-white" /></div>
                <h4 className="font-black text-emerald-900 dark:text-emerald-300 text-xs uppercase tracking-widest">Cadastro encontrado</h4>
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{matchEmployee.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {matchEmployee.hotels?.name}{matchEmployee.role ? ` · ${matchEmployee.role}` : ''}
              </p>
              <button onClick={handleLink} disabled={linking} className="mt-5 w-full py-3 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95">
                {linking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Vincular ao meu cadastro
              </button>
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-[2rem] p-6 border border-dashed border-slate-300 dark:border-slate-800 text-center">
              <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">Sem vínculo ativo</h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">Informe seu CPF e salve para localizarmos seu cadastro.</p>
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
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">CPF {isCompatibilityMode && '(Bloqueado)'}</label>
                <div className="relative opacity-50"><Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="text" value={employee ? formatMaskedCPF(cpf) : cpf} disabled={isCompatibilityMode || !!employee} onChange={e => setCpf(e.target.value)} className={`w-full pl-12 pr-4 py-4 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm ${isCompatibilityMode || !!employee ? 'cursor-not-allowed' : ''}`} placeholder="000.000.000-00" /></div>
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

            <div className="mt-8 flex justify-end gap-3">
              {isCompatibilityMode && (
                <button type="button" onClick={() => refreshProfile(true)} className="flex items-center gap-2 px-6 py-4 bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold rounded-2xl hover:bg-slate-200 transition-all text-xs uppercase tracking-widest"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Tentar Reconectar</button>
              )}
              <button type="submit" disabled={saving} className="px-10 py-4 bg-indigo-500 text-white font-black uppercase tracking-widest text-xs rounded-2xl hover:bg-indigo-600 transition-all shadow-xl active:scale-95 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar Perfil'}</button>
            </div>
          </form>
          
          {/* ── Alterar senha ─────────────────────────────────────────── */}
          <form onSubmit={handleChangePassword} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Lock className="w-5 h-5 text-indigo-500" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight">Alterar Senha</h3>
                <p className="text-xs text-slate-400">Defina uma nova senha de acesso</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Nova Senha</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    autoComplete="new-password"
                    className="w-full pl-12 pr-12 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                  <button type="button" onClick={() => setShowPassword(v => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Confirmar Senha</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    autoComplete="new-password"
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>
            </div>
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-red-500 font-semibold mt-3 px-1">As senhas não coincidem.</p>
            )}
            <div className="mt-6 flex justify-end">
              <button type="submit" disabled={savingPassword || !newPassword || !confirmPassword}
                className="px-10 py-4 bg-slate-800 dark:bg-slate-700 text-white font-black uppercase tracking-widest text-xs rounded-2xl hover:bg-slate-900 dark:hover:bg-slate-600 transition-all shadow-xl active:scale-95 disabled:opacity-50 flex items-center gap-2">
                {savingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Salvar Nova Senha
              </button>
            </div>
          </form>

          {/* ── Preferências de Notificação ───────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Bell className="w-5 h-5 text-indigo-500" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight">Notificações</h3>
                <p className="text-xs text-slate-400">Controle quando receber alertas push</p>
              </div>
            </div>

            {employee ? (
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-800 dark:text-white">
                    Apenas no horário de trabalho
                  </p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Quando ativado, notificações push só chegam durante seu turno. Ao entrar no expediente, você recebe tudo de uma vez.
                  </p>
                  {notifyWorkHoursOnly && (
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20">
                      <Clock className="w-3.5 h-3.5 text-indigo-500" />
                      <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                        {todayShift
                          ? `Turno hoje: ${todayShift.shift_start.slice(0, 5)} – ${todayShift.shift_end.slice(0, 5)}`
                          : 'Sem turno cadastrado hoje'}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleToggleNotifyPref(!notifyWorkHoursOnly)}
                  disabled={savingNotifyPref}
                  className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                    notifyWorkHoursOnly ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                  role="switch"
                  aria-checked={notifyWorkHoursOnly}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                      notifyWorkHoursOnly ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800">
                <BellOff className="w-5 h-5 text-slate-400 flex-shrink-0" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Vincule seu cadastro de colaborador para ativar o filtro de horário de trabalho.
                </p>
              </div>
            )}
          </div>

          {isCompatibilityMode && (
            <div className="p-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-3xl animate-fadeIn">
              <h4 className="text-amber-800 dark:text-amber-300 font-bold text-sm flex items-center gap-2 mb-2"><AlertCircle className="w-4 h-4" /> Atualização de Banco Pendente</h4>
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">Para liberar CPF e Foto, rode o SQL no Supabase e clique em **Tentar Reconectar**. O sistema ativará os recursos automaticamente assim que as colunas existirem.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
