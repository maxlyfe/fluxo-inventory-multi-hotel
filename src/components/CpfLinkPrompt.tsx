// src/components/CpfLinkPrompt.tsx
// ---------------------------------------------------------------------------
// Pop-up que incentiva novos usuários a informar o CPF em /profile, para
// vínculo automático com o cadastro do DP (acesso ao portal, escalas, eventos
// por setor, etc.).
//
// Aparece quando: usuário logado, sem CPF, sem vínculo com colaborador e que
// ainda não dispensou o aviso ("não notificar novamente" — para genéricos).
// Mostra 1x por sessão do navegador.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { IdCard, X, CheckCircle2, ArrowRight, BellOff } from 'lucide-react';

const SESSION_KEY = 'cpf_prompt_shown';

export default function CpfLinkPrompt() {
  const { user, isCompatibilityMode, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    if (isCompatibilityMode) return;              // banco sem colunas — não incomoda
    if (user.cpf) return;                         // já tem CPF
    if (user.cpf_prompt_dismissed) return;        // optou por não ver
    if (sessionStorage.getItem(SESSION_KEY)) return; // já mostrado nesta sessão

    let cancelled = false;
    const timer = setTimeout(async () => {
      // Não mostra se já houver vínculo com colaborador
      const { data: emp } = await supabase
        .from('employees')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled || emp) return;
      sessionStorage.setItem(SESSION_KEY, '1');
      setOpen(true);
    }, 2500);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [user?.id, user?.cpf, user?.cpf_prompt_dismissed, isCompatibilityMode]);

  if (!open) return null;

  const goToProfile = () => { setOpen(false); navigate('/profile'); };

  const dismissForever = async () => {
    if (!user?.id) return;
    setDismissing(true);
    try {
      await supabase.from('profiles').update({ cpf_prompt_dismissed: true }).eq('id', user.id);
      await refreshProfile(true);
    } catch { /* best-effort */ }
    finally { setDismissing(false); setOpen(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
        {/* Drag handle mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>

        {/* Header */}
        <div className="relative px-6 pt-5 pb-4 bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
          <button
            onClick={() => setOpen(false)}
            aria-label="Fechar"
            className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center mb-3">
            <IdCard className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold leading-tight">Vincule seu cadastro</h2>
          <p className="text-sm text-white/80 mt-1">Informe seu CPF e desbloqueie seu acesso completo</p>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
            Ao informar seu <strong>CPF</strong>, o sistema te conecta automaticamente ao seu
            cadastro de colaborador. Assim você passa a ter:
          </p>
          <ul className="space-y-2.5 mb-5">
            {[
              'Acesso ao seu Portal do Colaborador',
              'Suas escalas e documentos pessoais',
              'Eventos e avisos do seu setor',
              'Aniversários e benefícios',
            ].map(item => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                {item}
              </li>
            ))}
          </ul>

          <button
            onClick={goToProfile}
            className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 active:scale-[.98] transition-all shadow-lg shadow-indigo-500/25"
          >
            Preencher meu CPF <ArrowRight className="w-4 h-4" />
          </button>

          <div className="flex items-center justify-between gap-3 mt-3">
            <button
              onClick={() => setOpen(false)}
              className="flex-1 min-h-[44px] rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
            >
              Agora não
            </button>
            <button
              onClick={dismissForever}
              disabled={dismissing}
              className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-2xl text-slate-400 dark:text-slate-500 text-xs font-semibold hover:text-slate-600 dark:hover:text-slate-300 transition-all disabled:opacity-50"
            >
              <BellOff className="w-3.5 h-3.5" /> Não notificar novamente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
