import React from 'react';

export const fmtBRL = (v: number) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

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
};

const STATUS_LABELS: Record<string, string> = {
  aberto: 'Aberto', previsto: 'Previsto', parcial: 'Parcial', pago: 'Pago',
  recebido: 'Recebido', cancelado: 'Cancelado', vencido: 'Vencido', atrasado: 'Atrasado',
};

export function FinStatusBadge({ status, dueDate }: { status: string; dueDate?: string }) {
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

export function SummaryCard({ label, value, color, icon }: {
  label: string; value: string; color: string; icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
