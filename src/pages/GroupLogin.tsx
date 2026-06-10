// src/pages/GroupLogin.tsx
// Login escopado por grupo — rota pública /grupo/:slug (e /grupo/:slug/login)
// Resolve o grupo pelo slug e valida que a conta logada pertence a ele.

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { supabase } from '../lib/supabase';
import LoginBackdrop from '../components/LoginBackdrop';
import { Lock, Mail, Eye, EyeOff, AlertCircle, Loader2, Building2 } from 'lucide-react';

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

interface GroupInfo { id: string; name: string; slug: string; }

export default function GroupLogin() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user, login, loginWithGoogle, logout } = useAuth();
  const { setCurrentGroup } = useGroup();

  const [group, setGroup]       = useState<GroupInfo | null>(null);
  const [resolving, setResolving] = useState(true);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError]       = useState('');
  const [pendingVerify, setPendingVerify] = useState(false);
  const [blocked, setBlocked]   = useState(false); // sessão de outro grupo

  // Resolve o grupo pelo slug
  useEffect(() => {
    let active = true;
    (async () => {
      setResolving(true);
      const { data } = await supabase.rpc('get_group_by_slug', { p_slug: slug });
      if (!active) return;
      const g = Array.isArray(data) ? data[0] : data;
      const resolved = g ? { id: g.id, name: g.name, slug: g.slug } : null;
      setGroup(resolved);
      // NÃO define o grupo atual aqui — só após validar que a conta pertence a ele.
      setResolving(false);
    })();
    return () => { active = false; };
  }, [slug]);

  // Validação ESTRITA de grupo após o login (e ao chegar já logado).
  // Só entra quem pertence ao grupo da URL. Sem bypass de dev.
  useEffect(() => {
    if (!user || !group) return;
    if (user.group_id === group.id) {
      setCurrentGroup(group);                 // grupo verificado → escopa a sessão
      navigate('/', { replace: true });
      return;
    }
    // Conta de OUTRO grupo nesta porta — bloqueia
    setError('Esta conta não pertence a este grupo.');
    if (pendingVerify) {
      setPendingVerify(false);
      logout();                               // tentativa de login → encerra a sessão
    } else {
      setBlocked(true);                        // sessão pré-existente de outro grupo
    }
  }, [user, group, pendingVerify, navigate, logout, setCurrentGroup]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setPendingVerify(true);
    try {
      const result = await login(email, password);
      if (!result.success) {
        setError(result.message || 'Credenciais inválidas.');
        setPendingVerify(false);
      }
      // sucesso → o efeito de validação cuida de entrar/bloquear
    } catch {
      setError('Ocorreu um erro. Tente novamente.');
      setPendingVerify(false);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setGoogleLoading(true);
    setPendingVerify(true);
    const result = await loginWithGoogle(`/grupo/${slug}`);
    if (!result.success) {
      setError(result.message || 'Erro ao entrar com Google.');
      setGoogleLoading(false);
      setPendingVerify(false);
    }
  };

  const inputBase: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'white',
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      <LoginBackdrop />
      <div className="relative z-10 w-full max-w-sm">
        <div className="relative rounded-3xl overflow-hidden" style={{
          background: 'rgba(255,255,255,0.035)', backdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>
          <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.6), rgba(59,130,246,0.4), transparent)' }} />

          {resolving ? (
            <div className="px-8 py-16 flex flex-col items-center gap-3 text-white/50">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">Carregando grupo…</p>
            </div>
          ) : !group ? (
            <div className="px-8 py-14 text-center">
              <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <AlertCircle className="h-7 w-7 text-red-400" />
              </div>
              <h1 className="text-lg font-bold text-white">Grupo indisponível</h1>
              <p className="text-sm text-white/40 mt-2">O link <span className="font-mono">/grupo/{slug}</span> não existe ou está inativo. Confira o link com o responsável.</p>
            </div>
          ) : (
            <>
              {/* Header com o grupo */}
              <div className="px-8 pt-9 pb-7 text-center">
                <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.25) 0%, rgba(59,130,246,0.15) 100%)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <Building2 className="w-7 h-7 text-amber-400" />
                </div>
                <h1 className="text-2xl font-black tracking-tight text-white">{group.name}</h1>
                <p className="text-xs text-white/30 mt-1 tracking-widest uppercase">Acesso do grupo</p>
              </div>

              {blocked ? (
                <div className="px-8 pb-8 space-y-4">
                  <div className="flex items-start gap-2 text-amber-300 text-sm px-3 py-3 rounded-xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>Você está logado em <b>outro grupo</b>. Esta conta não tem acesso a <b>{group.name}</b>.</span>
                  </div>
                  <button onClick={async () => { await logout(); setBlocked(false); setError(''); }}
                    className="w-full py-3.5 rounded-2xl text-sm font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(59,130,246,0.2) 100%)', border: '1px solid rgba(245,158,11,0.3)' }}>
                    Sair e entrar com outra conta
                  </button>
                </div>
              ) : (
              <div className="px-8 pb-8 space-y-3.5">
                {/* Google */}
                <button onClick={handleGoogle} disabled={googleLoading || loading}
                  className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl font-semibold text-sm transition-all disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.95)', color: '#1a1a1a' }}>
                  {googleLoading ? <Loader2 className="h-5 w-5 animate-spin text-gray-500" /> : <GoogleIcon />}
                  <span>{googleLoading ? 'Redirecionando...' : 'Entrar com Google'}</span>
                </button>

                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  <span className="text-[11px] tracking-widest uppercase font-medium" style={{ color: 'rgba(255,255,255,0.2)' }}>ou e-mail</span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                </div>

                <form onSubmit={handleSubmit} className="space-y-2.5">
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'rgba(255,255,255,0.2)' }} />
                    <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
                      placeholder="E-mail" required
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none" style={inputBase} />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'rgba(255,255,255,0.2)' }} />
                    <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
                      placeholder="Senha" required
                      className="w-full pl-10 pr-11 py-3 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none" style={inputBase} />
                    <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.2)' }}>
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-xs px-3 py-2.5 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />{error}
                    </div>
                  )}

                  <button type="submit" disabled={loading || googleLoading}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-all disabled:opacity-40 mt-1"
                    style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(59,130,246,0.2) 100%)', border: '1px solid rgba(245,158,11,0.3)', color: 'white' }}>
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {loading ? 'Entrando...' : 'Entrar'}
                  </button>
                </form>
              </div>
              )}

              <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.3), rgba(245,158,11,0.3), transparent)' }} />
            </>
          )}
        </div>
        <p className="text-center mt-5 text-[11px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.12)' }}>
          LyFe Hoteles · Acesso por grupo
        </p>
      </div>
    </div>
  );
}
