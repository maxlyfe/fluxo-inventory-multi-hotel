import React, { useState } from 'react';
import { AlertTriangle, Info, X, Plus } from 'lucide-react';

export const fmtBRL = (v: number) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

/**
 * Data que ainda não é firme, prefixada com "~".
 * Usada no título faturado cuja cobrança não foi enviada: a previsão só vira
 * definitiva quando a cobrança sai.
 */
export const estimatedDateLabel = (iso?: string | null) =>
  iso ? `~${fmtDate(iso)}` : 'sem data';

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  cartao: 'Cartão',
  dinheiro: 'Dinheiro',
  cheque: 'Cheque',
};

// ─── Status badge (AP + AR) ───────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  aberto:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  previsto:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  parcial:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  pago:      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  recebido:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelado: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  vencido:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  atrasado:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  // ── Cobrança de parceiro faturado ──
  aguardando_nf:       'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  aguardando_cobranca: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  cobrado:             'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  falhou:              'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  aberto: 'Aberto', previsto: 'Previsto', parcial: 'Parcial', pago: 'Pago',
  recebido: 'Recebido', cancelado: 'Cancelado', vencido: 'Vencido', atrasado: 'Atrasado',
  aguardando_nf: 'Aguardando NF', aguardando_cobranca: 'Aguardando cobrança',
  cobrado: 'Cobrado', falhou: 'Falhou',
};

export function FinStatusBadge({ status, dueDate }: { status: string; dueDate?: string | null }) {
  let s = status;
  if ((status === 'aberto' || status === 'previsto' || status === 'parcial') &&
      dueDate && dueDate < todayISO()) {
    s = status === 'previsto' ? 'atrasado' : 'vencido';
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLES[s] ?? STATUS_STYLES.aberto}`}>
      {STATUS_LABELS[s] ?? s}
    </span>
  );
}

// ─── Period filter ────────────────────────────────────────────────────────────

export interface Period { from: string; to: string }

export function defaultPeriod(): Period {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function PeriodFilter({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        className="input-field !w-auto text-sm"
        value={period.from}
        onChange={e => onChange({ ...period, from: e.target.value })}
      />
      <span className="text-gray-400 text-sm">até</span>
      <input
        type="date"
        className="input-field !w-auto text-sm"
        value={period.to}
        onChange={e => onChange({ ...period, to: e.target.value })}
      />
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

export function SummaryCard({ label, value, color, icon, hint, dashed, action }: {
  label: string; value: string; color: string; icon?: React.ReactNode;
  hint?: string;
  /** Moldura tracejada = número que NÃO entra na previsão de caixa. */
  dashed?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl p-4 shadow-sm ${
      dashed
        ? 'bg-amber-50/50 dark:bg-amber-900/10 border-2 border-dashed border-amber-300 dark:border-amber-700'
        : 'bg-white dark:bg-gray-800 border dark:border-gray-700'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ─── Banners ──────────────────────────────────────────────────────────────────

export function ErrorBanner({ message, detail, onRetry, onDismiss }: {
  message: string; detail?: string | null; onRetry?: () => void; onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p>{message}</p>
          {detail && <p className="text-xs opacity-75 mt-1 break-words">{detail}</p>}
        </div>
        {onRetry && (
          <button onClick={onRetry} className="text-xs font-medium underline hover:no-underline shrink-0">
            Tentar de novo
          </button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} className="p-0.5 hover:opacity-70 shrink-0"><X className="w-4 h-4" /></button>
        )}
      </div>
    </div>
  );
}

export function InfoBanner({ message, tone = 'green', children, onDismiss }: {
  message?: string;
  tone?: 'green' | 'amber' | 'blue';
  children?: React.ReactNode;
  onDismiss?: () => void;
}) {
  if (!message && !children) return null;
  const tones = {
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
    amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300',
    blue:  'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
  };
  return (
    <div className={`mb-4 p-3 border rounded-lg text-sm ${tones[tone]}`}>
      <div className="flex items-start gap-2">
        {tone === 'amber' ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          {message && <p>{message}</p>}
          {children}
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-xs font-medium underline hover:no-underline shrink-0 whitespace-nowrap">
            Dispensar por hoje
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description, action, colSpan }: {
  icon?: React.ReactNode; title: string; description?: string;
  action?: React.ReactNode;
  /** Quando informado, renderiza como <tr><td colSpan>. */
  colSpan?: number;
}) {
  const body = (
    <div className="py-12 px-4 text-center">
      {icon && <div className="flex justify-center mb-3 text-gray-300 dark:text-gray-600">{icon}</div>}
      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{title}</p>
      {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
  if (colSpan) return <tr><td colSpan={colSpan}>{body}</td></tr>;
  return body;
}

// ─── Barra de seleção em lote ─────────────────────────────────────────────────

export function SelectionBar({
  total, selectedCount, selectedLabel, allSelected, onToggleAll, onClear, children,
}: {
  total: number;
  selectedCount: number;
  /** Ex.: "R$ 31.200,00" — o valor somado do que está selecionado. */
  selectedLabel?: string;
  allSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-3 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm">
      <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={allSelected && total > 0} onChange={onToggleAll}
          className="rounded border-gray-300 dark:border-gray-600" />
        Selecionar todos os filtrados ({total})
      </label>
      {selectedCount > 0 && (
        <>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {selectedCount} selecionada{selectedCount === 1 ? '' : 's'}
            {selectedLabel ? ` · ${selectedLabel}` : ''}
          </span>
          <button onClick={onClear} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline">
            Limpar seleção
          </button>
          <div className="flex items-center gap-2 ml-auto">{children}</div>
        </>
      )}
    </div>
  );
}

// ─── Colagem de vários números de reserva ─────────────────────────────────────

export function BulkPasteBox({ onLocate, locating, result, placeholder }: {
  /** Recebe o texto cru; quem chama decide como separar (billingService.parseBookingRefsInput). */
  onLocate: (raw: string) => void;
  locating?: boolean;
  result?: React.ReactNode;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0">
        <Plus className="w-4 h-4" /> Vários números
      </button>
    );
  }

  return (
    <div className="w-full bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Colar vários números de reserva</p>
        <button onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Um por linha, ou separados por vírgula, ponto e vírgula ou espaço.
      </p>
      <textarea
        value={raw} onChange={e => setRaw(e.target.value)} rows={4}
        placeholder={placeholder ?? '88123\n88124, 88125 88126'}
        className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={() => setRaw('')} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
          Limpar
        </button>
        <button onClick={() => onLocate(raw)} disabled={!raw.trim() || locating}
          className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {locating ? 'Localizando...' : 'Localizar e selecionar'}
        </button>
      </div>
      {result && <div className="mt-3 pt-3 border-t dark:border-gray-700 text-xs space-y-1">{result}</div>}
    </div>
  );
}

// ─── Lista de e-mails em chips ────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isValidEmail = (v: string) => EMAIL_RE.test(v.trim());

export function EmailChipsInput({ value, onChange, placeholder, disabled }: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    // Aceita colagem de vários endereços de uma vez.
    const parts = draft.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft('');
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 min-h-[42px] px-2 py-1.5 bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg ${disabled ? 'opacity-60' : ''}`}>
      {value.map(email => (
        <span key={email}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
            isValidEmail(email)
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          }`}
          title={isValidEmail(email) ? undefined : 'Endereço inválido'}>
          {email}
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter(e => e !== email))} className="hover:opacity-70">
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      <input
        type="text" value={draft} disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); commit(); }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        placeholder={value.length ? '' : placeholder ?? 'e-mail e Enter'}
        className="flex-1 min-w-[140px] bg-transparent text-sm outline-none text-gray-800 dark:text-gray-200 placeholder-gray-400"
      />
    </div>
  );
}
