// src/pages/Landing.tsx
// Página pública de marketing do LyFe Hoteles — mostra o poder do sistema.
// NÃO exibe nenhum dado de clientes/unidades. Acesso de cliente é por link
// privado do grupo (/grupo/<slug>).

import React, { useState, useEffect } from 'react';
import LoginBackdrop from '../components/LoginBackdrop';
import {
  Boxes, Users, Wrench, ShoppingCart, BedDouble, CalendarDays, BarChart3,
  CreditCard, Bell, ShieldCheck, ArrowRight, Sparkles, Hotel, ChevronRight,
  Smartphone, Layers, Building2, X,
} from 'lucide-react';

const MODULES = [
  { icon: Boxes,       title: 'Estoque & Inventário',  desc: 'Contagem offline, transferências entre unidades e requisições por setor.', color: '#8b5cf6' },
  { icon: ShoppingCart,title: 'Compras & Orçamentos',  desc: 'Cotações, autorizações e aprovações com fluxo completo e WhatsApp.',        color: '#f59e0b' },
  { icon: Users,       title: 'Departamento Pessoal',  desc: 'Funcionários, escalas, NR-1, aniversários e portal do colaborador.',        color: '#3b82f6' },
  { icon: Wrench,      title: 'Manutenção',            desc: 'Chamados por QR Code, equipamentos e checklists de governança.',           color: '#06b6d4' },
  { icon: BedDouble,   title: 'Recepção & PMS',        desc: 'Integração Erbon, rack de UHs, check-in/out e web check-in.',              color: '#ec4899' },
  { icon: CreditCard,  title: 'PDV & Financeiro',      desc: 'Vendas, consumos e análises financeiras por unidade.',                     color: '#22c55e' },
  { icon: CalendarDays,title: 'Eventos & Agenda',      desc: 'Calendário corporativo com convites e lembretes automáticos.',             color: '#a855f7' },
  { icon: BarChart3,   title: 'Diretoria & BI',        desc: 'KPIs, comparativos entre unidades e relatórios em tempo real.',            color: '#14b8a6' },
];

const HIGHLIGHTS = [
  { icon: Layers,      title: 'Tudo em um só lugar',   desc: 'Da cozinha à diretoria — uma plataforma única para toda a operação.' },
  { icon: Building2,   title: 'Multi-unidade',         desc: 'Gerencie uma rede inteira com isolamento e controle por hotel.' },
  { icon: Smartphone,  title: 'App Android',           desc: 'Notificações push e operação no celular, mesmo offline.' },
  { icon: ShieldCheck, title: 'Seguro por grupo',      desc: 'Cada cliente isolado; acesso por hotel liberado individualmente.' },
];

export default function Landing() {
  const [mounted, setMounted] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [slug, setSlug] = useState('');

  useEffect(() => { const t = setTimeout(() => setMounted(true), 60); return () => clearTimeout(t); }, []);

  const goToGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    // Reload de página (não SPA): cruza o basename → /grupo/<slug> é recalculado
    if (s) window.location.assign(`/grupo/${s}`);
  };

  return (
    <div className="relative min-h-[100dvh] text-white overflow-x-hidden" style={{ background: '#070d18' }}>
      {/* Fundo animado FIXO atrás de tudo, escurecido para não atrapalhar a leitura */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="opacity-50"><LoginBackdrop /></div>
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(6,12,24,0.45) 0%, rgba(6,12,24,0.85) 100%)' }} />
      </div>

      {/* ── Top bar ───────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-5 sm:px-8 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.3), rgba(59,130,246,0.2))', border: '1px solid rgba(245,158,11,0.3)' }}>
            <Hotel className="w-5 h-5 text-amber-400" />
          </div>
          <span className="font-black tracking-tight text-lg">LyFe Hoteles</span>
        </div>
        <button onClick={() => setShowAccess(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
          <ShieldCheck className="w-4 h-4 text-amber-400" /> Área do cliente
        </button>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-5xl mx-auto px-5 sm:px-8 pt-10 sm:pt-20 pb-16 text-center"
        style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(20px)', transition: 'all 0.8s ease' }}>
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full mb-6 text-xs font-bold uppercase tracking-widest"
          style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}>
          <Sparkles className="w-3.5 h-3.5" /> Gestão hoteleira inteligente
        </div>
        <h1 className="text-4xl sm:text-6xl font-black leading-[1.05] tracking-tight">
          Toda a operação do seu hotel
          <br />
          <span style={{ background: 'linear-gradient(90deg, #fbbf24, #60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            em um só lugar.
          </span>
        </h1>
        <p className="mt-6 text-base sm:text-lg text-white/55 max-w-2xl mx-auto leading-relaxed">
          Estoque, compras, pessoas, manutenção, recepção, PDV e diretoria — integrados,
          em tempo real, no computador e no celular. Da cozinha à gestão, sem planilhas soltas.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button onClick={() => setShowAccess(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3.5 rounded-2xl text-sm font-bold text-slate-900 transition-all active:scale-95"
            style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', boxShadow: '0 8px 30px rgba(245,158,11,0.25)' }}>
            Acessar meu grupo <ArrowRight className="w-4 h-4" />
          </button>
          <a href="#modulos"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3.5 rounded-2xl text-sm font-semibold transition-all"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
            Conhecer o sistema <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      {/* ── Módulos ───────────────────────────────────────────────── */}
      <section id="modulos" className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 py-12">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-black">Um módulo para cada parte da operação</h2>
          <p className="text-white/45 mt-2 text-sm sm:text-base">Tudo conversa entre si — uma plataforma, zero retrabalho.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {MODULES.map((m, i) => {
            const Icon = m.icon;
            return (
              <div key={m.title}
                className="group p-5 rounded-2xl transition-all hover:-translate-y-1"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)',
                  opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(16px)', transition: `all 0.6s ease ${0.1 + i * 0.05}s` }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3.5"
                  style={{ background: `${m.color}1f`, border: `1px solid ${m.color}40` }}>
                  <Icon className="w-5.5 h-5.5" style={{ color: m.color, width: 22, height: 22 }} />
                </div>
                <h3 className="font-bold text-[15px] mb-1.5">{m.title}</h3>
                <p className="text-[13px] text-white/45 leading-relaxed">{m.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Destaques ─────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {HIGHLIGHTS.map(h => {
            const Icon = h.icon;
            return (
              <div key={h.title} className="flex items-start gap-3.5 p-5 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(59,130,246,0.15)' }}>
                  <Icon className="w-4.5 h-4.5 text-blue-300" style={{ width: 18, height: 18 }} />
                </div>
                <div>
                  <h4 className="font-bold text-sm">{h.title}</h4>
                  <p className="text-xs text-white/45 mt-1 leading-relaxed">{h.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CTA final ─────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-3xl mx-auto px-5 sm:px-8 py-16 text-center">
        <div className="p-8 sm:p-10 rounded-3xl" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(59,130,246,0.08))', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Bell className="w-9 h-9 text-amber-400 mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-black">Pronto para profissionalizar sua rede?</h2>
          <p className="text-white/55 mt-3 text-sm sm:text-base">
            O LyFe Hoteles é entregue de forma isolada para cada grupo hoteleiro.
            Já é cliente? Acesse pelo link do seu grupo.
          </p>
          <button onClick={() => setShowAccess(true)}
            className="mt-6 inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl text-sm font-bold text-slate-900 active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}>
            Acessar meu grupo <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      <footer className="relative z-10 text-center py-8 text-[11px] tracking-widest uppercase text-white/20">
        LyFe Hoteles · Todos os direitos reservados
      </footer>

      {/* ── Modal: acessar grupo ──────────────────────────────────── */}
      {showAccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl overflow-hidden" style={{ background: 'rgba(13,20,35,0.97)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="font-bold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-400" /> Área do cliente</h3>
              <button onClick={() => setShowAccess(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-all"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={goToGroup} className="p-6 space-y-4">
              <p className="text-sm text-white/50 leading-relaxed">Digite o <b className="text-white/80">nome do seu grupo</b> para acessar o login.</p>
              <div className="flex items-center rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <span className="pl-3 text-xs text-white/30 font-mono whitespace-nowrap">/grupo/</span>
                <input autoFocus value={slug} onChange={e => setSlug(e.target.value)} placeholder="seu-grupo"
                  className="flex-1 bg-transparent px-2 py-3 text-sm text-white placeholder-white/25 focus:outline-none font-mono" />
              </div>
              <button type="submit" disabled={!slug.trim()}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-slate-900 disabled:opacity-40 transition-all"
                style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}>
                Continuar <ArrowRight className="w-4 h-4" />
              </button>
              <p className="text-[11px] text-white/25 text-center">Não tem o link do seu grupo? Fale com o responsável pela conta.</p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
