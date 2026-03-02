// src/pages/Login.tsx
// Login com background cinematográfico — operações hoteleiras em tempo real

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, Mail, User, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Ícone Google
// ---------------------------------------------------------------------------
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

// ---------------------------------------------------------------------------
// Atividades do hotel que flutuam no fundo
// ---------------------------------------------------------------------------
const HOTEL_ACTIVITIES = [
  { icon: '🛒', dept: 'Compras',       text: 'Farinha especial · 50kg aprovada',        color: '#f59e0b' },
  { icon: '🎂', dept: 'Cozinha',       text: 'Produção de bolo de chocolate iniciada',   color: '#f97316' },
  { icon: '🛏️', dept: 'Governança',   text: 'Quarto 204 — limpeza concluída',           color: '#8b5cf6' },
  { icon: '🔧', dept: 'Manutenção',   text: 'Ar cond. Suíte 3 — ticket encerrado',      color: '#06b6d4' },
  { icon: '📦', dept: 'Almoxarifado', text: 'Requisição Bar Piscina · 24 cervejas',     color: '#10b981' },
  { icon: '🍽️', dept: 'Restaurante', text: 'Mesa 8 servida — 4 pratos entregues',       color: '#ef4444' },
  { icon: '🥐', dept: 'Cozinha',       text: 'Croissants saindo do forno — 48 un',      color: '#f97316' },
  { icon: '📋', dept: 'Recepção',      text: 'Check-in Família Silva — quarto 312',     color: '#3b82f6' },
  { icon: '🧴', dept: 'Governança',   text: 'Amenities repostos — andares 2 e 3',       color: '#8b5cf6' },
  { icon: '💰', dept: 'Financeiro',   text: 'Orçamento Q2 aprovado — R$ 48.200',        color: '#22c55e' },
  { icon: '🍰', dept: 'Cozinha',       text: 'Torta de morango — produção finalizada',  color: '#f97316' },
  { icon: '🔑', dept: 'Recepção',      text: 'Check-out suite presidencial liberado',   color: '#3b82f6' },
  { icon: '🧹', dept: 'Governança',   text: 'Área da piscina — vistoria aprovada',      color: '#8b5cf6' },
  { icon: '📊', dept: 'Gerência',      text: 'Relatório semanal gerado — OK',           color: '#14b8a6' },
  { icon: '🛁', dept: 'Manutenção',   text: 'Banheira Suíte 1 — reparada e testada',   color: '#06b6d4' },
  { icon: '🥩', dept: 'Cozinha',       text: 'Filé mignon — 12 porções preparadas',     color: '#f97316' },
  { icon: '🍾', dept: 'Bar Piscina',  text: 'Reposição champagne — 6 garrafas',         color: '#eab308' },
  { icon: '📱', dept: 'T.I.',          text: 'Backup sistema — concluído com sucesso',  color: '#64748b' },
  { icon: '🧺', dept: 'Lavanderia',   text: 'Enxoval quarto 401 — higienizado',         color: '#a855f7' },
  { icon: '⭐', dept: 'Gerência',      text: 'Avaliação 5 estrelas — hóspede #1204',   color: '#14b8a6' },
];

// ---------------------------------------------------------------------------
// Componente de card flutuante individual
// ---------------------------------------------------------------------------
interface FloatingCardProps {
  activity: typeof HOTEL_ACTIVITIES[0];
  style: React.CSSProperties;
  animClass: string;
}

const FloatingCard: React.FC<FloatingCardProps> = ({ activity, style, animClass }) => (
  <div
    className={`absolute flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl pointer-events-none select-none ${animClass}`}
    style={{
      background: 'rgba(255,255,255,0.04)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: `0 0 20px ${activity.color}18, inset 0 1px 0 rgba(255,255,255,0.06)`,
      ...style,
    }}
  >
    <span className="text-lg leading-none flex-shrink-0">{activity.icon}</span>
    <div className="min-w-0">
      <p
        className="text-[10px] font-bold uppercase tracking-widest leading-none mb-0.5"
        style={{ color: activity.color, opacity: 0.9 }}
      >
        {activity.dept}
      </p>
      <p className="text-[11px] text-white/60 leading-tight truncate max-w-[180px]">
        {activity.text}
      </p>
    </div>
    {/* Dot pulsante */}
    <div className="flex-shrink-0 ml-1">
      <div
        className="w-1.5 h-1.5 rounded-full animate-pulse"
        style={{ background: activity.color }}
      />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Background animado — gerencia os cards flutuantes
// ---------------------------------------------------------------------------
const AnimatedBackground: React.FC = () => {
  // 16 cards distribuídos em posições estratégicas, animações CSS puras
  const cards = [
    { idx: 0,  x: '2%',   y: '8%',   delay: '0s',    dur: '18s', opacity: 0.85 },
    { idx: 1,  x: '68%',  y: '5%',   delay: '2s',    dur: '22s', opacity: 0.7  },
    { idx: 2,  x: '15%',  y: '22%',  delay: '4s',    dur: '20s', opacity: 0.75 },
    { idx: 3,  x: '72%',  y: '20%',  delay: '1s',    dur: '19s', opacity: 0.65 },
    { idx: 4,  x: '3%',   y: '42%',  delay: '6s',    dur: '23s', opacity: 0.8  },
    { idx: 5,  x: '60%',  y: '38%',  delay: '3s',    dur: '17s', opacity: 0.7  },
    { idx: 6,  x: '30%',  y: '55%',  delay: '8s',    dur: '21s', opacity: 0.6  },
    { idx: 7,  x: '75%',  y: '55%',  delay: '5s',    dur: '20s', opacity: 0.75 },
    { idx: 8,  x: '8%',   y: '70%',  delay: '7s',    dur: '18s', opacity: 0.65 },
    { idx: 9,  x: '55%',  y: '72%',  delay: '0.5s',  dur: '24s', opacity: 0.7  },
    { idx: 10, x: '20%',  y: '80%',  delay: '9s',    dur: '19s', opacity: 0.6  },
    { idx: 11, x: '78%',  y: '82%',  delay: '2.5s',  dur: '22s', opacity: 0.65 },
    { idx: 12, x: '40%',  y: '12%',  delay: '11s',   dur: '20s', opacity: 0.55 },
    { idx: 13, x: '44%',  y: '65%',  delay: '13s',   dur: '18s', opacity: 0.6  },
    { idx: 14, x: '1%',   y: '88%',  delay: '15s',   dur: '21s', opacity: 0.5  },
    { idx: 15, x: '65%',  y: '88%',  delay: '10s',   dur: '23s', opacity: 0.55 },
  ];

  return (
    <>
      {/* Inject CSS animations */}
      <style>{`
        @keyframes floatUpFade {
          0%   { transform: translateY(0px) translateX(0px); opacity: 0; }
          8%   { opacity: 1; }
          50%  { transform: translateY(-28px) translateX(6px); }
          92%  { opacity: 1; }
          100% { transform: translateY(-55px) translateX(-4px); opacity: 0; }
        }
        @keyframes floatSide {
          0%   { transform: translateY(0px) translateX(0px); opacity: 0; }
          10%  { opacity: 1; }
          50%  { transform: translateY(-20px) translateX(-10px); }
          90%  { opacity: 1; }
          100% { transform: translateY(-40px) translateX(8px); opacity: 0; }
        }
        @keyframes floatDiag {
          0%   { transform: translateY(0px) translateX(0px) rotate(0deg); opacity: 0; }
          12%  { opacity: 1; }
          50%  { transform: translateY(-35px) translateX(12px) rotate(0.5deg); }
          88%  { opacity: 1; }
          100% { transform: translateY(-60px) translateX(-8px) rotate(-0.5deg); opacity: 0; }
        }
        .float-a { animation: floatUpFade var(--dur) var(--delay) ease-in-out infinite; }
        .float-b { animation: floatSide var(--dur) var(--delay) ease-in-out infinite; }
        .float-c { animation: floatDiag var(--dur) var(--delay) ease-in-out infinite; }

        @keyframes shimmer {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
        .orb-pulse { animation: shimmer 4s ease-in-out infinite; }

        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
      `}</style>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Fundo base — gradiente profundo noturno */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(135deg, #060c18 0%, #0a1628 30%, #0d1f3c 60%, #071220 100%)'
        }} />

        {/* Grid sutil */}
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }} />

        {/* Orbs de luz ambiente */}
        <div className="absolute orb-pulse" style={{
          top: '-10%', left: '-5%',
          width: '50vw', height: '50vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)',
          animationDelay: '0s',
        }} />
        <div className="absolute orb-pulse" style={{
          bottom: '-10%', right: '-5%',
          width: '60vw', height: '60vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)',
          animationDelay: '2s',
        }} />
        <div className="absolute orb-pulse" style={{
          top: '30%', left: '40%',
          width: '40vw', height: '40vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(16,185,129,0.04) 0%, transparent 70%)',
          animationDelay: '4s',
        }} />

        {/* Linha de scan sutil */}
        <div style={{
          position: 'absolute',
          left: 0, right: 0,
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.15), transparent)',
          animation: 'scanline 12s linear infinite',
          animationDelay: '3s',
        }} />

        {/* Cards flutuantes */}
        {cards.map((c, i) => {
          const activity = HOTEL_ACTIVITIES[c.idx % HOTEL_ACTIVITIES.length];
          const animClass = ['float-a', 'float-b', 'float-c'][i % 3];
          return (
            <FloatingCard
              key={i}
              activity={activity}
              animClass={animClass}
              style={{
                left: c.x,
                top: c.y,
                opacity: c.opacity,
                '--dur': c.dur,
                '--delay': c.delay,
              } as React.CSSProperties}
            />
          );
        })}

        {/* Vinheta nas bordas */}
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)'
        }} />

        {/* Grain/noise overlay */}
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")`,
          opacity: 0.4,
        }} />
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Overlay de nome — aparece após Google login para novos colaboradores
// ---------------------------------------------------------------------------
function NameOverlay() {
  const { user, saveName, logout } = useAuth();
  const [name, setName]     = useState(user?.full_name || '');
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || name.trim().length < 2) {
      setError('Por favor, insira seu nome completo.');
      return;
    }
    setSaving(true);
    const result = await saveName(name);
    if (!result.success) setError(result.message || 'Erro ao salvar.');
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{
      background: 'rgba(6,12,24,0.85)',
      backdropFilter: 'blur(16px)',
    }}>
      <div className="w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl" style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 0 60px rgba(245,158,11,0.15)',
      }}>
        {/* Header */}
        <div className="px-6 pt-8 pb-6 text-center" style={{
          background: 'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(59,130,246,0.1) 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="avatar"
              className="w-16 h-16 rounded-2xl mx-auto mb-4 ring-2 ring-amber-500/30" />
          ) : (
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <User className="h-8 w-8 text-amber-400" />
            </div>
          )}
          <h2 className="text-lg font-bold text-white">Bem-vindo à LyFe Hoteles!</h2>
          <p className="text-sm text-white/40 mt-1">Como devemos te chamar?</p>
        </div>

        {/* Form */}
        <div className="px-6 py-6">
          <p className="text-xs text-white/30 text-center mb-5 leading-relaxed">
            Seu nome aparecerá em requisições, chamados e registros do sistema.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-amber-400/80 uppercase tracking-widest mb-1.5">
                Nome completo
              </label>
              <input
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setError(''); }}
                placeholder="Ex: Maria da Silva"
                autoFocus
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.1)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs px-3 py-2 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#0a0f1e',
                boxShadow: saving || !name.trim() ? 'none' : '0 4px 20px rgba(245,158,11,0.3)',
              }}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Salvando...' : 'Continuar →'}
            </button>
          </form>
          <button onClick={() => logout()}
            className="w-full text-center text-xs text-white/20 hover:text-white/40 mt-4 transition-colors">
            Cancelar e sair
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login principal
// ---------------------------------------------------------------------------
const Login: React.FC = () => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPwd, setShowPwd]   = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [mounted, setMounted]   = useState(false);

  const { login, loginWithGoogle, needsName } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from     = (location.state as any)?.from?.pathname || '/';

  // Entrada suave
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.success) navigate(from, { replace: true });
      else setError(result.message || 'Credenciais inválidas.');
    } catch {
      setError('Ocorreu um erro. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setGoogleLoading(true);
    const result = await loginWithGoogle();
    if (!result.success) {
      setError(result.message || 'Erro ao iniciar login com Google.');
      setGoogleLoading(false);
    }
  };

  const inputBase: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'white',
  };

  return (
    <>
      {needsName && <NameOverlay />}

      <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
        <AnimatedBackground />

        {/* Card de login */}
        <div
          className="relative z-10 w-full max-w-sm transition-all duration-700"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.97)',
          }}
        >
          {/* Glow atrás do card */}
          <div className="absolute inset-0 rounded-3xl pointer-events-none" style={{
            background: 'radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.12) 0%, transparent 70%)',
            filter: 'blur(20px)',
            transform: 'translateY(-10px) scale(1.1)',
          }} />

          <div className="relative rounded-3xl overflow-hidden" style={{
            background: 'rgba(255,255,255,0.035)',
            backdropFilter: 'blur(32px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}>

            {/* Barra dourada superior */}
            <div className="h-px w-full" style={{
              background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.6), rgba(59,130,246,0.4), transparent)',
            }} />

            {/* Header */}
            <div className="px-8 pt-9 pb-7 text-center">
              {/* Logo */}
              <div className="relative w-16 h-16 mx-auto mb-5">
                <div className="absolute inset-0 rounded-2xl animate-pulse" style={{
                  background: 'rgba(245,158,11,0.2)',
                  filter: 'blur(8px)',
                }} />
                <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center" style={{
                  background: 'linear-gradient(135deg, rgba(245,158,11,0.25) 0%, rgba(59,130,246,0.15) 100%)',
                  border: '1px solid rgba(245,158,11,0.3)',
                }}>
                  <svg viewBox="0 0 28 28" className="w-7 h-7" fill="none">
                    {/* Ícone de hotel estilizado */}
                    <rect x="3" y="12" width="22" height="13" rx="1.5" fill="rgba(245,158,11,0.8)"/>
                    <rect x="7" y="6" width="14" height="8" rx="1" fill="rgba(245,158,11,0.6)"/>
                    <rect x="11" y="2" width="6" height="6" rx="0.5" fill="rgba(245,158,11,0.5)"/>
                    <rect x="6" y="16" width="3" height="3" rx="0.5" fill="rgba(6,12,24,0.6)"/>
                    <rect x="12.5" y="16" width="3" height="3" rx="0.5" fill="rgba(6,12,24,0.6)"/>
                    <rect x="19" y="16" width="3" height="3" rx="0.5" fill="rgba(6,12,24,0.6)"/>
                    <rect x="11" y="20" width="6" height="5" rx="0.5" fill="rgba(6,12,24,0.5)"/>
                  </svg>
                </div>
              </div>

              <h1 className="text-2xl font-black tracking-tight text-white">
                LyFe Hoteles
              </h1>
              <p className="text-xs text-white/30 mt-1 tracking-widest uppercase">
                Sistema de Gestão
              </p>
            </div>

            <div className="px-8 pb-8 space-y-3.5">
              {/* Botão Google */}
              <button
                onClick={handleGoogle}
                disabled={googleLoading || loading}
                className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl font-semibold text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'rgba(255,255,255,0.95)',
                  color: '#1a1a1a',
                  boxShadow: googleLoading || loading ? 'none' : '0 4px 24px rgba(255,255,255,0.1)',
                }}
                onMouseEnter={e => !googleLoading && !loading && (e.currentTarget.style.background = '#ffffff')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.95)')}
              >
                {googleLoading
                  ? <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                  : <GoogleIcon />
                }
                <span>{googleLoading ? 'Redirecionando...' : 'Entrar com Google'}</span>
              </button>

              {/* Divisor */}
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                <span className="text-[10px] tracking-widest uppercase font-medium" style={{ color: 'rgba(255,255,255,0.2)' }}>
                  ou acesso admin
                </span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-2.5">
                {/* Email */}
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'rgba(255,255,255,0.2)' }} />
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(''); }}
                    placeholder="E-mail"
                    required
                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none transition-all"
                    style={inputBase}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = 'rgba(245,158,11,0.4)';
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.08)';
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                </div>

                {/* Senha */}
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'rgba(255,255,255,0.2)' }} />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    placeholder="Senha"
                    required
                    className="w-full pl-10 pr-11 py-3 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none transition-all"
                    style={inputBase}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = 'rgba(245,158,11,0.4)';
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.08)';
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: 'rgba(255,255,255,0.2)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Erro */}
                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-xs px-3 py-2.5 rounded-xl"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {error}
                  </div>
                )}

                {/* Botão entrar */}
                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed mt-1"
                  style={{
                    background: loading || googleLoading
                      ? 'rgba(245,158,11,0.3)'
                      : 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(59,130,246,0.2) 100%)',
                    border: '1px solid rgba(245,158,11,0.3)',
                    color: 'white',
                    boxShadow: loading || googleLoading ? 'none' : '0 4px 20px rgba(245,158,11,0.1)',
                  }}
                  onMouseEnter={e => {
                    if (!loading && !googleLoading) {
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.3) 0%, rgba(59,130,246,0.25) 100%)';
                      e.currentTarget.style.borderColor = 'rgba(245,158,11,0.5)';
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(59,130,246,0.2) 100%)';
                    e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)';
                  }}
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>
              </form>

              {/* Nota */}
              <p className="text-center text-[11px] leading-relaxed pt-1" style={{ color: 'rgba(255,255,255,0.18)' }}>
                Colaboradores entram com sua conta Google<br />
                Administradores usam e-mail e senha
              </p>
            </div>

            {/* Barra inferior */}
            <div className="h-px w-full" style={{
              background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.3), rgba(245,158,11,0.3), transparent)',
            }} />
          </div>

          {/* Rodapé */}
          <p className="text-center mt-5 text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.12)' }}>
            LyFe Hoteles · Todos os direitos reservados
          </p>
        </div>
      </div>
    </>
  );
};

export default Login;