// src/components/LoginBackdrop.tsx
// Fundo cinematográfico animado reutilizável (Login e GroupLogin).

import React from 'react';

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
];

const FloatingCard: React.FC<{ activity: typeof HOTEL_ACTIVITIES[0]; style: React.CSSProperties; animClass: string; }> = ({ activity, style, animClass }) => (
  <div className={`absolute flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl pointer-events-none select-none ${animClass}`}
    style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: `0 0 20px ${activity.color}18, inset 0 1px 0 rgba(255,255,255,0.06)`, ...style }}>
    <span className="text-lg leading-none flex-shrink-0">{activity.icon}</span>
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-widest leading-none mb-0.5" style={{ color: activity.color, opacity: 0.9 }}>{activity.dept}</p>
      <p className="text-[11px] text-white/60 leading-tight truncate max-w-[180px]">{activity.text}</p>
    </div>
    <div className="flex-shrink-0 ml-1"><div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: activity.color }} /></div>
  </div>
);

export const LoginBackdrop: React.FC = () => {
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
      <style>{`
        @keyframes floatUpFade { 0%{transform:translateY(0) translateX(0);opacity:0;} 8%{opacity:1;} 50%{transform:translateY(-28px) translateX(6px);} 92%{opacity:1;} 100%{transform:translateY(-55px) translateX(-4px);opacity:0;} }
        @keyframes floatSide { 0%{transform:translateY(0) translateX(0);opacity:0;} 10%{opacity:1;} 50%{transform:translateY(-20px) translateX(-10px);} 90%{opacity:1;} 100%{transform:translateY(-40px) translateX(8px);opacity:0;} }
        @keyframes floatDiag { 0%{transform:translateY(0) translateX(0) rotate(0deg);opacity:0;} 12%{opacity:1;} 50%{transform:translateY(-35px) translateX(12px) rotate(0.5deg);} 88%{opacity:1;} 100%{transform:translateY(-60px) translateX(-8px) rotate(-0.5deg);opacity:0;} }
        .lb-float-a { animation: floatUpFade var(--dur) var(--delay) ease-in-out infinite; }
        .lb-float-b { animation: floatSide var(--dur) var(--delay) ease-in-out infinite; }
        .lb-float-c { animation: floatDiag var(--dur) var(--delay) ease-in-out infinite; }
        @keyframes lbShimmer { 0%,100%{opacity:0.3;} 50%{opacity:0.6;} }
        .lb-orb { animation: lbShimmer 4s ease-in-out infinite; }
      `}</style>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #060c18 0%, #0a1628 30%, #0d1f3c 60%, #071220 100%)' }} />
        <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)`, backgroundSize: '60px 60px' }} />
        <div className="absolute lb-orb" style={{ top: '-10%', left: '-5%', width: '50vw', height: '50vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)' }} />
        <div className="absolute lb-orb" style={{ bottom: '-10%', right: '-5%', width: '60vw', height: '60vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)', animationDelay: '2s' }} />
        {cards.map((c, i) => (
          <FloatingCard key={i} activity={HOTEL_ACTIVITIES[c.idx % HOTEL_ACTIVITIES.length]} animClass={['lb-float-a','lb-float-b','lb-float-c'][i % 3]}
            style={{ left: c.x, top: c.y, opacity: c.opacity, ['--dur' as any]: c.dur, ['--delay' as any]: c.delay }} />
        ))}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)' }} />
      </div>
    </>
  );
};

export default LoginBackdrop;
