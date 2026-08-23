// src/pages/messages/MessagesUI.tsx
// Peças visuais compartilhadas pelas três telas de /messages.
//
// As telas nasceram separadas e cada uma repetia o próprio cabeçalho, os
// próprios cards e os próprios estados vazios — parecidos, mas nunca iguais, e
// sem nenhuma forma de ir de uma para a outra. Aqui ficam as peças comuns, e a
// navegação entre as três passa a existir no topo de todas.

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MessageCircle, Radio, Bot, LucideIcon } from 'lucide-react';

/** Tom de cor do módulo — cada tela tem o seu, mantido do desenho original */
export type Tone = 'green' | 'blue' | 'violet';

const TONE: Record<Tone, { chip: string; icon: string; active: string }> = {
  green: {
    chip: 'bg-green-100 dark:bg-green-900/30',
    icon: 'text-green-600 dark:text-green-400',
    active: 'bg-green-500 text-white shadow-sm shadow-green-500/30',
  },
  blue: {
    chip: 'bg-blue-100 dark:bg-blue-900/30',
    icon: 'text-blue-600 dark:text-blue-400',
    active: 'bg-blue-500 text-white shadow-sm shadow-blue-500/30',
  },
  violet: {
    chip: 'bg-violet-100 dark:bg-violet-900/30',
    icon: 'text-violet-600 dark:text-violet-400',
    active: 'bg-violet-500 text-white shadow-sm shadow-violet-500/30',
  },
};

const NAV: Array<{ to: string; label: string; short: string; icon: LucideIcon; tone: Tone }> = [
  { to: '/messages',                label: 'Conversas',     short: 'Conversas', icon: MessageCircle, tone: 'green'  },
  { to: '/messages/broadcast',      label: 'Disparos',      short: 'Disparos',  icon: Radio,         tone: 'blue'   },
  { to: '/messages/auto-responses', label: 'Auto-respostas', short: 'Automático', icon: Bot,         tone: 'violet' },
];

/**
 * Navegação entre as três telas do módulo. Ficava faltando: para sair do inbox
 * e chegar nos disparos era preciso voltar pelo menu lateral.
 */
export function MessagesNav({ compact = false }: { compact?: boolean }) {
  const { pathname } = useLocation();

  return (
    <nav className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
      {NAV.map(item => {
        // '/messages' casaria com tudo; as filhas exigem match exato.
        const ativo = item.to === '/messages'
          ? pathname === '/messages'
          : pathname.startsWith(item.to);
        const Icon = item.icon;

        return (
          <Link
            key={item.to}
            to={item.to}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-all
              ${ativo
                ? TONE[item.tone].active
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-white/70 dark:hover:bg-gray-700/70'}`}
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className={compact ? 'hidden sm:inline' : ''}>
              {compact ? item.short : item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

interface HeaderProps {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  subtitle?: string;
  /** Botões da direita (ação principal da tela) */
  actions?: React.ReactNode;
  /** Abas internas da própria tela, abaixo do título */
  tabs?: React.ReactNode;
}

export function MessagesHeader({ icon: Icon, tone, title, subtitle, actions, tabs }: HeaderProps) {
  return (
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2.5 rounded-xl flex-shrink-0 ${TONE[tone].chip}`}>
            <Icon className={`h-5 w-5 ${TONE[tone].icon}`} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">{title}</h1>
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <MessagesNav />
        {tabs}
      </div>
    </header>
  );
}

/** Card padrão das telas do módulo */
export function Panel({
  children,
  className = '',
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700
        ${padded ? 'p-5' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/** Título de seção dentro de um Panel */
export function PanelTitle({ icon: Icon, children, right }: {
  icon?: LucideIcon;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-gray-400" />}
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">{children}</h2>
      </div>
      {right}
    </div>
  );
}

/**
 * Estado vazio com voz de instrução, não de erro: quem chega numa lista vazia
 * quer saber o que fazer para preenchê-la.
 */
export function EmptyState({ icon: Icon, title, hint, action }: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-10 gap-2">
      <div className="p-3 rounded-2xl bg-gray-100 dark:bg-gray-700/50">
        <Icon className="h-6 w-6 text-gray-400" />
      </div>
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</p>
      {hint && <p className="text-xs text-gray-400 max-w-xs leading-relaxed">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Placeholder de carregamento — menos brusco que trocar a tela por um spinner */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/40">
          <div className="h-9 w-9 rounded-full bg-gray-200 dark:bg-gray-600 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-1/3 rounded bg-gray-200 dark:bg-gray-600" />
            <div className="h-2 w-1/2 rounded bg-gray-100 dark:bg-gray-700" />
          </div>
        </div>
      ))}
    </div>
  );
}
