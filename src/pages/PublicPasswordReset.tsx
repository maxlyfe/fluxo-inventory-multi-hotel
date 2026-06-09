// src/pages/PublicPasswordReset.tsx
// Página pública (sem login) para redefinir a senha via link temporário (5 min).
// Rota: /reset-password/:token

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Lock, Eye, EyeOff, CheckCircle2, Loader2, ShieldAlert, ArrowRight } from 'lucide-react';

type Step = 'validating' | 'invalid' | 'form' | 'done';

export default function PublicPasswordReset() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [step, setStep]               = useState<Step>('validating');
  const [reason, setReason]           = useState<string>('');
  const [email, setEmail]             = useState<string | null>(null);
  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [show, setShow]               = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Valida o token ao montar
  useEffect(() => {
    if (!token) { setStep('invalid'); return; }
    (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke('password-reset', {
          body: { mode: 'validate', token },
        });
        if (fnErr || !data?.valid) {
          setReason(data?.reason || 'invalid');
          setStep('invalid');
          return;
        }
        setEmail(data.email || null);
        setStep('form');
      } catch {
        setStep('invalid');
      }
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError('A senha deve ter pelo menos 6 caracteres.'); return; }
    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    setSaving(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('password-reset', {
        body: { mode: 'apply', token, password },
      });
      if (fnErr) throw new Error('Não foi possível redefinir. O link pode ter expirado.');
      if (data?.error) throw new Error(data.error);
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Erro ao redefinir a senha.');
    } finally {
      setSaving(false);
    }
  };

  const reasonText = (r: string) => {
    if (r === 'expired') return 'Este link expirou (válido por 5 minutos). Peça um novo ao responsável.';
    if (r === 'used')    return 'Este link já foi utilizado. Peça um novo ao responsável.';
    return 'Este link é inválido. Peça um novo ao responsável.';
  };

  const inputWrap = 'relative';
  const inputCls = 'w-full pl-12 pr-12 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-slate-900 dark:text-white';

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="px-7 pt-7 pb-5 bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold">Definir nova senha</h1>
          <p className="text-sm text-white/80 mt-1">LyFe Hoteles</p>
        </div>

        <div className="p-7">
          {step === 'validating' && (
            <div className="flex flex-col items-center py-8 gap-3 text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
              <p className="text-sm">Verificando link…</p>
            </div>
          )}

          {step === 'invalid' && (
            <div className="flex flex-col items-center py-6 gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <ShieldAlert className="w-7 h-7 text-red-500" />
              </div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">Link indisponível</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{reasonText(reason)}</p>
            </div>
          )}

          {step === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {email && (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                  Conta: <span className="font-semibold text-slate-700 dark:text-slate-200">{email}</span>
                </p>
              )}
              <div className={inputWrap}>
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Nova senha (mín. 6 caracteres)"
                  autoComplete="new-password"
                  className={inputCls}
                />
                <button type="button" onClick={() => setShow(v => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className={inputWrap}>
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={show ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Confirmar nova senha"
                  autoComplete="new-password"
                  className={inputCls}
                />
              </div>

              {error && (
                <p className="text-sm text-red-500 font-semibold text-center">{error}</p>
              )}

              <button type="submit" disabled={saving || !password || !confirm}
                className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 active:scale-[.98] transition-all disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Salvar nova senha
              </button>
              <p className="text-[11px] text-slate-400 text-center">Este link expira em 5 minutos.</p>
            </form>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-6 gap-3 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">Senha alterada!</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Já pode entrar no sistema com a nova senha.</p>
              <button onClick={() => navigate('/login')}
                className="mt-2 inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-all">
                Ir para o login <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
