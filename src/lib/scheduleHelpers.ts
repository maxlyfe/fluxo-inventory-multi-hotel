// src/lib/scheduleHelpers.ts
// Funções puras extraídas de DPSchedule.tsx para reutilização e testes

export interface ScheduleEntry {
  id?: string;
  schedule_id: string;
  employee_id: string;
  sector: string;
  day_date: string;
  entry_type: string;
  shift_start: string | null;
  shift_end: string | null;
  custom_label: string | null;
  transfer_hotel_id: string | null;
  occurrence_type_id: string | null;
}

export interface Hotel { id: string; name: string; }

export interface OccurrenceType {
  id: string;
  hotel_id: string;
  name: string;
  slug: string;
  color: string;
  causes_basket_loss: boolean;
  loss_threshold: number;
  is_system: boolean;
  sort_order: number;
  entry_type_key?: string;
}

/**
 * Gera padrão de trabalho de 8 dias (DOM-DOM) baseado no tipo de escala.
 * Retorna array de 8 booleans — true = dia de trabalho, false = folga.
 */
export function getPatternForWeek(
  schedule: string,
  sundayIsWork: boolean,
  folgaDays: number[],
): boolean[] {
  if (schedule === '12x36') {
    return Array.from({ length: 8 }, (_, i) =>
      sundayIsWork ? i % 2 === 0 : i % 2 !== 0
    );
  }
  return Array.from({ length: 8 }, (_, i) => !folgaDays.includes(i));
}

const ENTRY_TYPES = [
  { value: 'shift',      label: 'Turno',          color: 'text-gray-800 dark:text-gray-100',         bg: '' },
  { value: 'folga',      label: 'FOLGA',           color: 'text-green-700 dark:text-green-300',        bg: 'bg-green-50 dark:bg-green-900/30' },
  { value: 'compensa',   label: 'COMPENSA',        color: 'text-blue-700 dark:text-blue-300',          bg: 'bg-blue-50 dark:bg-blue-900/30' },
  { value: 'meia_dobra', label: 'MEIA DOBRA',      color: 'text-amber-700 dark:text-amber-300',        bg: 'bg-amber-50 dark:bg-amber-900/30' },
  { value: 'transfer',   label: 'Outra unidade',   color: 'text-violet-700 dark:text-violet-300',      bg: 'bg-violet-50 dark:bg-violet-900/20' },
  { value: 'curso',      label: 'CURSO',           color: 'text-purple-700 dark:text-purple-300',      bg: 'bg-purple-50 dark:bg-purple-900/30' },
  { value: 'inss',       label: 'INSS',            color: 'text-gray-500 dark:text-gray-400',          bg: 'bg-gray-50 dark:bg-gray-700' },
  { value: 'ferias',     label: 'FÉRIAS',          color: 'text-cyan-700 dark:text-cyan-300',          bg: 'bg-cyan-50 dark:bg-cyan-900/30' },
  { value: 'falta',      label: 'FALTA',           color: 'text-red-600 dark:text-red-400',            bg: 'bg-red-50 dark:bg-red-900/20' },
  { value: 'atestado',   label: 'ATESTADO',        color: 'text-orange-600 dark:text-orange-400',      bg: 'bg-orange-50 dark:bg-orange-900/20' },
  { value: 'custom',     label: 'Outro',           color: 'text-indigo-700 dark:text-indigo-300',      bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
  { value: 'empty',      label: '------',          color: 'text-gray-300 dark:text-gray-600',          bg: '' },
];

const OCCURRENCE_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  red:    { bg: 'bg-red-50 dark:bg-red-900/20',       text: 'text-red-700 dark:text-red-300',       ring: 'ring-red-400' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-900/20',  text: 'text-orange-700 dark:text-orange-300', ring: 'ring-orange-400' },
  indigo: { bg: 'bg-indigo-50 dark:bg-indigo-900/20',  text: 'text-indigo-700 dark:text-indigo-300', ring: 'ring-indigo-400' },
  amber:  { bg: 'bg-amber-50 dark:bg-amber-900/20',   text: 'text-amber-700 dark:text-amber-300',   ring: 'ring-amber-400' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-900/20',  text: 'text-purple-700 dark:text-purple-300', ring: 'ring-purple-400' },
  pink:   { bg: 'bg-pink-50 dark:bg-pink-900/20',     text: 'text-pink-700 dark:text-pink-300',     ring: 'ring-pink-400' },
  teal:   { bg: 'bg-teal-50 dark:bg-teal-900/20',     text: 'text-teal-700 dark:text-teal-300',     ring: 'ring-teal-400' },
  blue:   { bg: 'bg-blue-50 dark:bg-blue-900/20',     text: 'text-blue-700 dark:text-blue-300',     ring: 'ring-blue-400' },
  green:  { bg: 'bg-green-50 dark:bg-green-900/20',   text: 'text-green-700 dark:text-green-300',   ring: 'ring-green-400' },
};

/**
 * Formata entrada da escala para exibição.
 */
export function formatEntry(
  entry: ScheduleEntry | null,
  hotels: Hotel[],
  occTypes?: OccurrenceType[],
): { line1: string; line2?: string } {
  if (!entry || entry.entry_type === 'empty') return { line1: '------' };
  const t = entry.entry_type;

  if (t === 'meia_dobra') {
    const ot = occTypes?.find(o => o.id === entry.occurrence_type_id || o.entry_type_key === 'meia_dobra');
    const label = ot?.name || 'MEIA DOBRA';
    const times = entry.shift_start && entry.shift_end
      ? `${entry.shift_start.slice(0, 5)} AS ${entry.shift_end.slice(0, 5)}` : '';
    return { line1: label, line2: times ? `(${times})` : undefined };
  }
  if (t === 'transfer') {
    const hotelName = hotels.find(h => h.id === entry.transfer_hotel_id)?.name || 'Outra un.';
    const shortName = hotelName.split(' ')[0];
    const times = entry.shift_start && entry.shift_end
      ? `${entry.shift_start.slice(0, 5)} AS ${entry.shift_end.slice(0, 5)}` : '';
    return { line1: shortName, line2: times || undefined };
  }
  if (t === 'shift' && entry.shift_start && entry.shift_end)
    return { line1: `${entry.shift_start.slice(0, 5)} AS ${entry.shift_end.slice(0, 5)}` };

  if (entry.occurrence_type_id && occTypes) {
    const ot = occTypes.find(o => o.id === entry.occurrence_type_id);
    if (ot) return { line1: ot.name };
  }

  if (t === 'custom') return { line1: entry.custom_label || '—' };

  const legacy: Record<string, string> = {
    folga: 'FOLGA', compensa: 'COMPENSA', curso: 'CURSO', inss: 'INSS',
    ferias: 'FÉRIAS', falta: 'FALTA', atestado: 'ATESTADO',
  };
  if (legacy[t]) return { line1: legacy[t] };

  return { line1: '—' };
}

/**
 * Retorna classes Tailwind de cor para o tipo de entrada.
 */
export function getEntryStyle(
  entry: ScheduleEntry | null,
  occTypes?: OccurrenceType[],
): { color: string; bg: string } {
  if (!entry || entry.entry_type === 'empty') return { color: 'text-gray-300 dark:text-gray-600', bg: '' };

  if (entry.occurrence_type_id && occTypes) {
    const ot = occTypes.find(o => o.id === entry.occurrence_type_id);
    if (ot) {
      const colors = OCCURRENCE_COLORS[ot.color] || OCCURRENCE_COLORS.indigo;
      return { color: colors.text, bg: colors.bg };
    }
  }

  const cfg = ENTRY_TYPES.find(t => t.value === entry.entry_type);
  return { color: cfg?.color || '', bg: cfg?.bg || '' };
}
