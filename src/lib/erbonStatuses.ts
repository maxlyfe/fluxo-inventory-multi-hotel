// src/lib/erbonStatuses.ts
// Mapeamento central de todos os statuses devolvidos pela API Erbon.
// Actualizar aqui quando novos valores forem descobertos via console.log.

export interface ErbonStatusInfo {
  label: string;          // Exibição em PT
  color: string;          // Tailwind classes para badge
  allowWCI: boolean;      // Permite web check-in?
  wciError?: string;      // Mensagem de erro para o hóspede (se !allowWCI)
}

// ── Mapa principal ────────────────────────────────────────────────────────────
// Chave: valor EXACTO devolvido pela API Erbon (case-sensitive comparado em UPPER)

export const ERBON_STATUS_MAP: Record<string, ErbonStatusInfo> = {

  // ── Reserva activa (permite WCI) ──────────────────────────────────────────
  BOOKING: {
    label: 'Reserva',
    color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    allowWCI: true,
  },
  CONFIRMED: {
    label: 'Confirmada',
    color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    allowWCI: true,
  },
  PENDING: {
    label: 'Pendente',
    color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    allowWCI: true,
  },
  RESERVED: {
    label: 'Reservada',
    color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    allowWCI: true,
  },

  // ── Check-in já feito (bloqueia WCI) ─────────────────────────────────────
  CHECKIN: {
    label: 'Check-in Feito',
    color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    allowWCI: false,
    wciError: 'Check-in já realizado. Dirija-se à recepção se precisar de ajuda.',
  },

  // ── Check-out feito (bloqueia WCI) ────────────────────────────────────────
  CHECKOUT: {
    label: 'Check-out Feito',
    color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    allowWCI: false,
    wciError: 'Check-out já realizado para esta reserva.',
  },
  CHECKOUTDONE: {
    label: 'Check-out Feito',
    color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    allowWCI: false,
    wciError: 'Check-out já realizado para esta reserva.',
  },

  // ── Cancelada (bloqueia WCI) ──────────────────────────────────────────────
  CANCELLED: {
    label: 'Cancelada',
    color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    allowWCI: false,
    wciError: 'Esta reserva está cancelada.',
  },
  CANCELADA: {
    label: 'Cancelada',
    color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    allowWCI: false,
    wciError: 'Esta reserva está cancelada.',
  },
  CANCELADO: {
    label: 'Cancelada',
    color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    allowWCI: false,
    wciError: 'Esta reserva está cancelada.',
  },

  // ── No-show ───────────────────────────────────────────────────────────────
  NOSHOW: {
    label: 'No-Show',
    color: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
    allowWCI: false,
    wciError: 'Esta reserva foi marcada como no-show.',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Devolve info do status ou fallback genérico */
export function getErbonStatusInfo(status: string | null | undefined): ErbonStatusInfo {
  if (!status) return {
    label: '—',
    color: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
    allowWCI: false,
    wciError: 'Não foi possível verificar o status desta reserva.',
  };
  return ERBON_STATUS_MAP[status.toUpperCase()] ?? {
    label: status,
    color: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
    allowWCI: false,
    wciError: `Esta reserva não está disponível para web check-in (status: ${status}).`,
  };
}

/** Devolve o status efectivo: prefere `status`, fallback `confirmedStatus` */
export function resolveErbonStatus(status?: string | null, confirmedStatus?: string | null): string {
  return status || confirmedStatus || '';
}
