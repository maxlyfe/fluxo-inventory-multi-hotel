// src/pages/dp/PublicScheduleEdit.tsx
// Página pública para líder de setor preencher escala (sem login)

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useNotification } from '../../context/NotificationContext';
import {
  Loader2, AlertTriangle, Check, Zap, X, Calendar, Building2, Moon, Sun,
} from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, parseISO, differenceInCalendarDays, subWeeks } from 'date-fns';

// ---------------------------------------------------------------------------
// Types (mirrored from DPSchedule)
// ---------------------------------------------------------------------------
interface Hotel { id: string; name: string; }

interface Employee {
  id: string; name: string; sector: string; role: string; status: string;
  work_schedule: string | null;
  default_shift_start: string | null;
  default_shift_end: string | null;
  default_rest_start: string | null;
  default_rest_end: string | null;
}

interface ScheduleEntry {
  id?: string;
  schedule_id: string;
  employee_id: string;
  sector: string;
  day_date: string;
  entry_type: string;
  shift_start: string | null;
  shift_end: string | null;
  rest_start: string | null;
  rest_end: string | null;
  custom_label: string | null;
  transfer_hotel_id: string | null;
  transfer_sector: string | null;   // setor do hotel destino onde o colaborador vai atuar
  occurrence_type_id: string | null;
}

interface Schedule { id: string; hotel_id: string; week_start: string; }

interface OccurrenceType {
  id: string; hotel_id: string; name: string; slug: string; color: string;
  causes_basket_loss: boolean; loss_threshold: number; is_system: boolean; sort_order: number;
  entry_type_key: string | null;
  has_rest?: boolean; asks_shift_time?: boolean; rest_start?: string | null; rest_end?: string | null;
  is_recurring?: boolean;        // ao atribuir, pergunta "até quando" e preenche o intervalo
}

interface ShareToken {
  id: string; token: string; hotel_id: string; schedule_id: string;
  sector: string; week_start: string; expires_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
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
  violet: { bg: 'bg-violet-50 dark:bg-violet-900/20',  text: 'text-violet-700 dark:text-violet-300', ring: 'ring-violet-400' },
  pink:   { bg: 'bg-pink-50 dark:bg-pink-900/20',     text: 'text-pink-700 dark:text-pink-300',     ring: 'ring-pink-400' },
  cyan:   { bg: 'bg-cyan-50 dark:bg-cyan-900/20',     text: 'text-cyan-700 dark:text-cyan-300',     ring: 'ring-cyan-400' },
  gray:   { bg: 'bg-gray-50 dark:bg-gray-700',        text: 'text-gray-500 dark:text-gray-400',     ring: 'ring-gray-400' },
  teal:   { bg: 'bg-teal-50 dark:bg-teal-900/20',     text: 'text-teal-700 dark:text-teal-300',     ring: 'ring-teal-400' },
  blue:   { bg: 'bg-blue-50 dark:bg-blue-900/20',     text: 'text-blue-700 dark:text-blue-300',     ring: 'ring-blue-400' },
  green:  { bg: 'bg-green-50 dark:bg-green-900/20',   text: 'text-green-700 dark:text-green-300',   ring: 'ring-green-400' },
};

const WORK_SCHEDULES = [
  { value: '12x36', label: '12×36' },
  { value: '6x1',   label: '6×1 (8h15m)' },
  { value: '5x2',   label: '5×2 (10h)' },
  { value: '4x2',   label: '4×2' },
  { value: 'custom', label: 'Personalizado' },
];

const DAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getWeekSunday(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 0 });
}

const DEFAULT_OCCURRENCE_SEEDS: Omit<OccurrenceType, 'id' | 'hotel_id'>[] = [
  { entry_type_key: 'folga',      name: 'FOLGA',         slug: 'folga',      color: 'green',  causes_basket_loss: false, loss_threshold: 1, is_system: true,  sort_order: 1 },
  { entry_type_key: 'compensa',   name: 'COMPENSA',      slug: 'compensa',   color: 'blue',   causes_basket_loss: false, loss_threshold: 1, is_system: true,  sort_order: 2 },
  { entry_type_key: 'meia_dobra', name: 'MEIA DOBRA',    slug: 'meia_dobra', color: 'amber',  causes_basket_loss: false, loss_threshold: 1, is_system: true,  sort_order: 3 },
  { entry_type_key: 'transfer',   name: 'Outra unidade', slug: 'transfer',   color: 'violet', causes_basket_loss: false, loss_threshold: 1, is_system: true,  sort_order: 4 },
  { entry_type_key: 'curso',      name: 'CURSO',         slug: 'curso',      color: 'purple', causes_basket_loss: false, loss_threshold: 1, is_system: true,  sort_order: 5 },
  { entry_type_key: 'inss',       name: 'INSS',          slug: 'inss',       color: 'gray',   causes_basket_loss: false, loss_threshold: 1, is_system: true,  sort_order: 6, is_recurring: true },
  { entry_type_key: 'ferias',     name: 'FÉRIAS',        slug: 'ferias',     color: 'cyan',   causes_basket_loss: false, loss_threshold: 1, is_system: true,  sort_order: 7, is_recurring: true },
  { entry_type_key: 'falta',      name: 'FALTA',         slug: 'falta',      color: 'red',    causes_basket_loss: true,  loss_threshold: 1, is_system: true,  sort_order: 8 },
  { entry_type_key: 'atestado',   name: 'ATESTADO',      slug: 'atestado',   color: 'orange', causes_basket_loss: true,  loss_threshold: 4, is_system: true,  sort_order: 9 },
];

async function ensureDefaultTypes(hotelId: string, existing: OccurrenceType[]): Promise<OccurrenceType[]> {
  const existingKeys = new Set(existing.map(ot => ot.entry_type_key).filter(Boolean));
  const missing = DEFAULT_OCCURRENCE_SEEDS.filter(s => s.entry_type_key && !existingKeys.has(s.entry_type_key));
  if (missing.length === 0) return existing;
  const { data } = await supabase.from('occurrence_types')
    .upsert(missing.map(s => ({ ...s, hotel_id: hotelId })), { onConflict: 'hotel_id,entry_type_key', ignoreDuplicates: true }).select();
  if (data && data.length > 0) return [...existing, ...(data as OccurrenceType[])].sort((a, b) => a.sort_order - b.sort_order);
  return existing;
}

function getPatternForWeek(schedule: string, sundayIsWork: boolean, folgaDays: number[]): boolean[] {
  if (schedule === '12x36') {
    return Array.from({ length: 8 }, (_, i) => sundayIsWork ? i % 2 === 0 : i % 2 !== 0);
  }
  return Array.from({ length: 8 }, (_, i) => !folgaDays.includes(i));
}

function formatEntry(entry: ScheduleEntry | null, hotels: Hotel[], occTypes?: OccurrenceType[]): { line1: string; line2?: string; rest?: string } {
  if (!entry || entry.entry_type === 'empty') return { line1: '------' };
  const t = entry.entry_type;
  const rest = (entry.rest_start && entry.rest_end)
    ? `desc ${entry.rest_start.slice(0, 5)}–${entry.rest_end.slice(0, 5)}`
    : undefined;
  if (t === 'meia_dobra') {
    const ot = occTypes?.find(o => o.id === entry.occurrence_type_id || o.entry_type_key === 'meia_dobra');
    const label = ot?.name || 'MEIA DOBRA';
    const times = entry.shift_start && entry.shift_end
      ? `${entry.shift_start.slice(0, 5)} AS ${entry.shift_end.slice(0, 5)}` : '';
    return { line1: label, line2: times ? `(${times})` : undefined, rest };
  }
  if (t === 'transfer') {
    const hotelName = hotels.find(h => h.id === entry.transfer_hotel_id)?.name || 'Outra un.';
    const shortName = hotelName.split(' ')[0];
    const times = entry.shift_start && entry.shift_end
      ? `${entry.shift_start.slice(0, 5)} AS ${entry.shift_end.slice(0, 5)}` : '';
    return { line1: shortName, line2: times || undefined, rest };
  }
  if (t === 'shift' && entry.shift_start && entry.shift_end)
    return { line1: `${entry.shift_start.slice(0, 5)} AS ${entry.shift_end.slice(0, 5)}`, rest };
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

function getEntryStyle(entry: ScheduleEntry | null, occTypes?: OccurrenceType[]) {
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

// ---------------------------------------------------------------------------
// Cell Editor (simplified — no manage section, unified grid)
// ---------------------------------------------------------------------------
type CellSelection =
  | { kind: 'shift' }
  | { kind: 'occurrence'; ot: OccurrenceType }
  | { kind: 'empty' };

interface CellEditorProps {
  entry: ScheduleEntry | null;
  employeeId: string; dayDate: string; sector: string; scheduleId: string;
  hotels: Hotel[];
  occurrenceTypes: OccurrenceType[];
  defaultRestStart?: string | null;
  defaultRestEnd?: string | null;
  onSave: (e: Partial<ScheduleEntry>) => Promise<void>;
  /** Preenche o mesmo tipo em todos os dias de day_date até untilDate (inclusive) */
  onSaveRange: (e: Partial<ScheduleEntry>, untilDate: string) => Promise<void>;
  onClose: () => void;
}

function CellEditor({ entry, employeeId, dayDate, sector, scheduleId, hotels, occurrenceTypes, defaultRestStart, defaultRestEnd, onSave, onSaveRange, onClose }: CellEditorProps) {
  const getInitialSelection = (): CellSelection => {
    if (!entry || entry.entry_type === 'empty') return { kind: 'empty' };
    if (entry.entry_type === 'shift') return { kind: 'shift' };
    if (entry.occurrence_type_id) {
      const ot = occurrenceTypes.find(o => o.id === entry.occurrence_type_id);
      if (ot) return { kind: 'occurrence', ot };
    }
    const byKey = occurrenceTypes.find(o => o.entry_type_key === entry.entry_type);
    if (byKey) return { kind: 'occurrence', ot: byKey };
    return { kind: 'shift' };
  };

  const [selection, setSelection] = useState<CellSelection>(getInitialSelection);
  const [start, setStart]        = useState(entry?.shift_start?.slice(0, 5) || '');
  const [end, setEnd]            = useState(entry?.shift_end?.slice(0, 5) || '');
  const [transferHotel, setTransferHotel] = useState(entry?.transfer_hotel_id || '');
  const [transferSector, setTransferSector] = useState(entry?.transfer_sector || '');
  const [destSectors, setDestSectors] = useState<string[]>([]);
  // Tipo recorrente: "até quando" — padrão o próprio dia (preenche 1 dia só).
  // Campos espelhados: informar a data final calcula os dias e vice-versa,
  // contando o dia lançado como o dia 1.
  const [untilDate, setUntilDate] = useState(dayDate);
  const recurringDays = Math.max(1, differenceInCalendarDays(parseISO(untilDate || dayDate), parseISO(dayDate)) + 1);
  const handleUntilDateChange = (v: string) => {
    if (!v) { setUntilDate(dayDate); return; }
    setUntilDate(v < dayDate ? dayDate : v);
  };
  const handleDaysChange = (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1) { setUntilDate(dayDate); return; }
    setUntilDate(format(addDays(parseISO(dayDate), n - 1), 'yyyy-MM-dd'));
  };
  // Rascunho de digitação: enquanto o campo está focado pode ficar vazio;
  // o cálculo só acontece ao sair do campo (blur).
  const [daysDraft, setDaysDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restStart, setRestStart]     = useState(entry?.rest_start?.slice(0, 5) || '');
  const [restEnd, setRestEnd]         = useState(entry?.rest_end?.slice(0, 5) || '');
  const applyDefaultRest = (s?: string | null, e?: string | null) => {
    if (s && e && !restStart && !restEnd) {
      setRestStart(s.slice(0, 5)); setRestEnd(e.slice(0, 5));
    }
  };
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 60);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [onClose]);

  const sortedOccurrences = [...occurrenceTypes].sort((a, b) => a.sort_order - b.sort_order);
  const selectedKey = selection.kind === 'occurrence' ? (selection.ot.entry_type_key || '') : '';
  const wantsTime = selection.kind === 'shift'
    || ['meia_dobra', 'transfer'].includes(selectedKey)
    || (selection.kind === 'occurrence' && !!selection.ot.asks_shift_time);
  const wantsRest = selection.kind === 'shift'
    || (selection.kind === 'occurrence' && !!selection.ot.has_rest);
  const needsHotelSelector = selectedKey === 'transfer';
  const isRecurring = selection.kind === 'occurrence' && !!selection.ot.is_recurring;

  // Setores do hotel DESTINO (derivados dos colaboradores ativos de lá)
  useEffect(() => {
    if (!needsHotelSelector || !transferHotel) { setDestSectors([]); return; }
    let alive = true;
    supabase.from('employees')
      .select('sector')
      .eq('hotel_id', transferHotel)
      .eq('status', 'active')
      .then(({ data }) => {
        if (!alive) return;
        const fallback = ['Recepção', 'Governança', 'Manutenção', 'Cozinha', 'Salão',
          'Reservas', 'Administrativo', 'Lavanderia', 'Segurança', 'Outro'];
        const uniq = [...new Set((data || []).map((r: any) => r.sector).filter(Boolean))] as string[];
        uniq.sort((a, b) => fallback.indexOf(a) - fallback.indexOf(b));
        setDestSectors(uniq.length > 0 ? uniq : fallback);
      });
    return () => { alive = false; };
  }, [needsHotelSelector, transferHotel]);

  const save = async () => {
    setSaving(true);
    const rs = (wantsRest && !!restStart && !!restEnd) ? restStart : null;
    const re = (wantsRest && !!restStart && !!restEnd) ? restEnd : null;
    if (selection.kind === 'shift') {
      await onSave({
        employee_id: employeeId, day_date: dayDate, sector, schedule_id: scheduleId,
        entry_type: 'shift',
        shift_start: start || null, shift_end: end || null,
        rest_start: rs, rest_end: re,
        custom_label: null, transfer_hotel_id: null, transfer_sector: null, occurrence_type_id: null,
      });
    } else if (selection.kind === 'empty') {
      await onSave({
        employee_id: employeeId, day_date: dayDate, sector, schedule_id: scheduleId,
        entry_type: 'empty',
        shift_start: null, shift_end: null,
        rest_start: null, rest_end: null,
        custom_label: null, transfer_hotel_id: null, transfer_sector: null, occurrence_type_id: null,
      });
    } else {
      const ot = selection.ot;
      const key = ot.entry_type_key;
      const entryType = key || 'custom';
      const base: Partial<ScheduleEntry> = {
        employee_id: employeeId, day_date: dayDate, sector, schedule_id: scheduleId,
        entry_type: entryType,
        shift_start: wantsTime ? (start || null) : null,
        shift_end: wantsTime ? (end || null) : null,
        rest_start: rs, rest_end: re,
        custom_label: !key ? ot.name : null,
        transfer_hotel_id: key === 'transfer' ? (transferHotel || null) : null,
        transfer_sector: key === 'transfer' ? (transferSector || null) : null,
        occurrence_type_id: ot.id,
      };
      if (isRecurring && untilDate && untilDate > dayDate) {
        await onSaveRange(base, untilDate);
      } else {
        await onSave(base);
      }
    }
    setSaving(false);
    onClose();
  };

  const maxH = window.innerHeight - 24;
  const style: React.CSSProperties = {
    position: 'fixed', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)', zIndex: 200,
    maxHeight: maxH, display: 'flex', flexDirection: 'column',
  };

  return (
    <div ref={ref} style={style}
      className="w-80 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700">

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Unified grid: Turno + DB types + ------ */}
        <div className="grid grid-cols-2 gap-1">
          <button onClick={() => { setSelection({ kind: 'shift' }); applyDefaultRest(defaultRestStart, defaultRestEnd); }}
            className={`text-xs px-2 py-1.5 rounded-xl font-semibold transition-all text-left ${
              selection.kind === 'shift'
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 ring-2 ring-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            Turno
          </button>

          {sortedOccurrences.map(ot => {
            const colors = OCCURRENCE_COLORS[ot.color] || OCCURRENCE_COLORS.indigo;
            const isSelected = selection.kind === 'occurrence' && selection.ot.id === ot.id;
            return (
              <button key={ot.id} onClick={() => setSelection({ kind: 'occurrence', ot })}
                className={`text-xs px-2 py-1.5 rounded-xl font-semibold transition-all text-left truncate ${
                  isSelected
                    ? `${colors.bg} ${colors.text} ring-2 ${colors.ring}`
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}>
                {ot.name}
              </button>
            );
          })}

          <button onClick={() => setSelection({ kind: 'empty' })}
            className={`text-xs px-2 py-1.5 rounded-xl font-semibold transition-all text-left ${
              selection.kind === 'empty'
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-300 dark:text-gray-600 ring-2 ring-blue-400'
                : 'text-gray-300 dark:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            ------
          </button>
        </div>

        {wantsTime && (
          <div className="flex gap-2 items-center">
            <input type="time" value={start} onChange={e => setStart(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <span className="text-xs text-gray-400">AS</span>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        )}

        {/* Descanso (almoço/jantar) — aparece direto; em branco = sem descanso */}
        {wantsRest && (
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Descanso (almoço/jantar)</p>
            <div className="flex gap-2 items-center">
              <input type="time" value={restStart} onChange={e => setRestStart(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <span className="text-xs text-gray-400">AS</span>
              <input type="time" value={restEnd} onChange={e => setRestEnd(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <p className="text-[10px] text-gray-400">Deixe em branco se não houver descanso.</p>
          </div>
        )}

        {/* ── Tipo recorrente: data final OU quantidade de dias (espelhados) ── */}
        {isRecurring && (
          <div className="rounded-xl border border-cyan-100 dark:border-cyan-900/40 p-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400">Período (o dia lançado conta como dia 1)</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-[10px] text-gray-400 mb-0.5">Até (inclusive)</label>
                <input type="date" value={untilDate} min={dayDate}
                  onChange={e => handleUntilDateChange(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              </div>
              <div className="w-20">
                <label className="block text-[10px] text-gray-400 mb-0.5">Dias</label>
                <input type="number" min={1} inputMode="numeric"
                  value={daysDraft ?? String(recurringDays)}
                  onFocus={e => { setDaysDraft(''); e.target.select(); }}
                  onChange={e => setDaysDraft(e.target.value)}
                  onBlur={() => { if (daysDraft && daysDraft.trim()) handleDaysChange(daysDraft); setDaysDraft(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-full px-2 py-1.5 text-xs text-center border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              </div>
            </div>
            <p className="text-[10px] text-gray-400">
              {recurringDays > 1
                ? `${recurringDays} dias serão preenchidos de uma vez, terminando em ${format(parseISO(untilDate), 'dd/MM/yyyy')}.`
                : 'Mantendo 1 dia, preenche apenas o dia selecionado.'}
            </p>
          </div>
        )}

        {needsHotelSelector && (
          <div className="space-y-1.5">
            <select value={transferHotel}
              onChange={e => { setTransferHotel(e.target.value); setTransferSector(''); }}
              className="w-full px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none">
              <option value="">Selecione a unidade...</option>
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            {transferHotel && (
              <select value={transferSector} onChange={e => setTransferSector(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none">
                <option value="">Setor no hotel destino...</option>
                {destSectors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Footer buttons */}
      <div className="flex gap-2 p-3 pt-2 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
        <button onClick={onClose}
          className="flex-1 py-1.5 text-xs font-semibold text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          Cancelar
        </button>
        <button onClick={save} disabled={saving}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white rounded-xl disabled:opacity-60 transition-colors">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Salvar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-fill Modal (simplified — no auth dependency)
// ---------------------------------------------------------------------------
interface AutoFillProps {
  employee: Employee;
  weekDays: Date[];
  scheduleId: string;
  onFill: (entries: Partial<ScheduleEntry>[]) => Promise<void>;
  onClose: () => void;
}

function AutoFillModal({ employee, weekDays, scheduleId, onFill, onClose }: AutoFillProps) {
  const ws = employee.work_schedule || '6x1';
  const [schedule, setSchedule]     = useState(ws);
  const [shiftStart, setStart]      = useState(employee.default_shift_start?.slice(0, 5) || '07:00');
  const [shiftEnd, setEnd]          = useState(employee.default_shift_end?.slice(0, 5) || '15:00');
  const [restEnabled, setRestEnabled] = useState(!!(employee.default_rest_start && employee.default_rest_end));
  const [restStart, setRestStart]   = useState(employee.default_rest_start?.slice(0, 5) || '12:00');
  const [restEnd, setRestEnd]       = useState(employee.default_rest_end?.slice(0, 5) || '13:00');
  const [folgaDays, setFolgaDays]   = useState<number[]>(
    ws === '12x36' ? [] : ws === '5x2' ? [0, 7] : ws === '4x2' ? [0, 6, 7] : [0]
  );
  const [sundayWork, setSundayWork] = useState(false);
  const [saving, setSaving]         = useState(false);

  const maxFolgas = schedule === '6x1' ? 1 : schedule === '5x2' ? 2 : schedule === '4x2' ? 3 : 0;

  const toggleFolga = (day: number) => {
    if (schedule === '12x36') return;
    setFolgaDays(prev => {
      if (prev.includes(day)) return prev.filter(d => d !== day);
      if (prev.length >= maxFolgas) return [...prev.slice(1), day];
      return [...prev, day];
    });
  };

  const preview = getPatternForWeek(schedule, sundayWork, folgaDays);

  const handleFill = async () => {
    setSaving(true);
    const useRest = restEnabled && !!restStart && !!restEnd;
    const toInsert: Partial<ScheduleEntry>[] = weekDays.map((day, i) => ({
      schedule_id: scheduleId,
      employee_id: employee.id,
      sector:      employee.sector,
      day_date:    format(day, 'yyyy-MM-dd'),
      entry_type:  preview[i] ? 'shift' : 'folga',
      shift_start: preview[i] ? shiftStart : null,
      shift_end:   preview[i] ? shiftEnd   : null,
      rest_start:  preview[i] && useRest ? restStart : null,
      rest_end:    preview[i] && useRest ? restEnd   : null,
      custom_label: null,
      transfer_hotel_id: null,
    }));
    supabase.from('employees').update({
      default_rest_start: useRest ? restStart : null,
      default_rest_end:   useRest ? restEnd   : null,
    }).eq('id', employee.id).then(() => { /* best-effort */ });
    await onFill(toInsert);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
              {employee.name.split(' ').slice(0, 2).map(n => n[0]).join('')}
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{employee.name}</p>
              <p className="text-xs text-gray-400">{employee.sector} · Auto-preencher semana</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Tipo */}
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Tipo de escala</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {WORK_SCHEDULES.map(w => (
                <button key={w.value} onClick={() => {
                  setSchedule(w.value);
                  if (w.value === '12x36') setFolgaDays([]);
                  else if (w.value === '6x1')  setFolgaDays([0]);
                  else if (w.value === '5x2')  setFolgaDays([0, 7]);
                  else if (w.value === '4x2')  setFolgaDays([0, 6, 7]);
                }}
                  className={`px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    schedule === w.value
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-300'
                  }`}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {/* Horário */}
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Horário do turno</label>
            <div className="flex gap-3 items-center">
              <input type="time" value={shiftStart} onChange={e => setStart(e.target.value)}
                className="flex-1 px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="text-sm font-bold text-gray-400">AS</span>
              <input type="time" value={shiftEnd} onChange={e => setEnd(e.target.value)}
                className="flex-1 px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Descanso (almoço / jantar) */}
          <div>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 cursor-pointer">
              <input type="checkbox" checked={restEnabled} onChange={e => setRestEnabled(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-amber-500 focus:ring-amber-400" />
              Descanso (almoço / jantar)
            </label>
            {restEnabled && (
              <div className="flex gap-3 items-center">
                <input type="time" value={restStart} onChange={e => setRestStart(e.target.value)}
                  className="flex-1 px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                <span className="text-sm font-bold text-gray-400">AS</span>
                <input type="time" value={restEnd} onChange={e => setRestEnd(e.target.value)}
                  className="flex-1 px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            )}
          </div>

          {/* 12×36 Sunday */}
          {schedule === '12x36' && (
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Domingo desta semana</label>
              <div className="flex gap-2">
                <button onClick={() => setSundayWork(true)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${sundayWork ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-blue-300'}`}>
                  Trabalha
                </button>
                <button onClick={() => setSundayWork(false)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${!sundayWork ? 'bg-green-500 border-green-500 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-green-300'}`}>
                  Folga
                </button>
              </div>
            </div>
          )}

          {/* Folga days */}
          {schedule !== '12x36' && maxFolgas > 0 && (
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Folga{maxFolgas > 1 ? 's' : ''} desta semana
                <span className="ml-2 font-normal text-gray-400 normal-case">(selecione {maxFolgas})</span>
              </label>
              <div className="grid grid-cols-8 gap-1">
                {DAY_LABELS.map((label, i) => (
                  <button key={i} onClick={() => toggleFolga(i)}
                    className={`py-2 rounded-xl text-xs font-bold transition-all ${
                      folgaDays.includes(i)
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Preview</label>
            <div className="grid grid-cols-8 gap-1">
              {weekDays.map((day, i) => {
                const works = preview[i];
                return (
                  <div key={i} className={`p-1.5 rounded-xl text-center border ${
                    works ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                          : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                  }`}>
                    <p className="text-[11px] font-bold text-gray-400">{DAY_LABELS[i]}</p>
                    {works ? (
                      <div className="text-[11px] font-bold mt-0.5 leading-tight text-gray-700 dark:text-gray-200">
                        <span>{shiftStart}</span>
                        <span className="block text-gray-400">AS</span>
                        <span>{shiftEnd}</span>
                      </div>
                    ) : (
                      <p className="text-[11px] font-bold mt-0.5 leading-tight text-green-600 dark:text-green-400">FOLGA</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 pb-2">
            <button onClick={onClose}
              className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancelar
            </button>
            <button onClick={handleFill} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-bold rounded-xl transition-colors">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Preenchendo...</> : <><Zap className="h-4 w-4" />Preencher semana</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Public Page
// ---------------------------------------------------------------------------
export default function PublicScheduleEdit() {
  const { token } = useParams<{ token: string }>();
  const { addNotification } = useNotification();

  const [tokenData, setTokenData] = useState<ShareToken | null>(null);
  const [hotelName, setHotelName] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries]     = useState<ScheduleEntry[]>([]);
  const [hotels, setHotels]       = useState<Hotel[]>([]);
  const [occurrenceTypes, setOccurrenceTypes] = useState<OccurrenceType[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  // Tema local do link público (sem login): persiste no navegador do supervisor
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('public-schedule-theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('public-schedule-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const [cellEditor, setCellEditor] = useState<{
    empId: string; dayDate: string; sector: string; entry: ScheduleEntry | null;
  } | null>(null);
  const [autoFillEmp, setAutoFillEmp] = useState<Employee | null>(null);

  // Derived
  const weekStart = tokenData ? new Date(tokenData.week_start + 'T00:00:00') : new Date();
  const weekDays  = Array.from({ length: 8 }, (_, i) => addDays(weekStart, i));
  const weekLabel = tokenData
    ? `${format(weekStart, 'dd/MM')} a ${format(addDays(weekStart, 7), 'dd/MM/yyyy')}`
    : '';

  // ---------------------------------------------------------------------------
  // Load data
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!token) { setError('Token inválido.'); setLoading(false); return; }

    (async () => {
      try {
        // 1. Validate token
        const { data: tk, error: tkErr } = await supabase
          .from('schedule_share_tokens')
          .select('*')
          .eq('token', token)
          .maybeSingle();

        if (tkErr || !tk) { setError('Link inválido ou expirado.'); setLoading(false); return; }

        // Check expiration
        if (new Date(tk.expires_at) < new Date()) {
          setError('Este link expirou. Solicite um novo link ao departamento pessoal.');
          setLoading(false); return;
        }

        // Check past week
        const currentWeekStart = getWeekSunday(new Date());
        const tokenWeek = new Date(tk.week_start + 'T00:00:00');
        if (tokenWeek < currentWeekStart) {
          setError('Esta escala pertence a uma semana passada e não pode mais ser editada por este link.');
          setLoading(false); return;
        }

        setTokenData(tk as ShareToken);

        // 2. Load hotel name
        const { data: hotel } = await supabase
          .from('hotels').select('id, name').eq('id', tk.hotel_id).single();
        if (hotel) setHotelName(hotel.name);

        // 3. Load all hotels (for transfer dropdown)
        const { data: allHotels } = await supabase
          .from('hotels').select('id, name').order('name');
        setHotels((allHotels || []) as Hotel[]);

        // 4. Load employees for this hotel + sector
        const { data: empData } = await supabase
          .from('employees')
          .select('id, name, sector, role, status, work_schedule, default_shift_start, default_shift_end, default_rest_start, default_rest_end')
          .eq('hotel_id', tk.hotel_id)
          .eq('sector', tk.sector)
          .eq('status', 'active')
          .order('name');
        setEmployees((empData || []) as Employee[]);

        // 5. Load entries
        const { data: entryData } = await supabase
          .from('schedule_entries')
          .select('*')
          .eq('schedule_id', tk.schedule_id)
          .eq('sector', tk.sector);
        setEntries((entryData || []) as ScheduleEntry[]);

        // 6. Load occurrence types + auto-seed defaults
        const { data: occData } = await supabase
          .from('occurrence_types')
          .select('*')
          .eq('hotel_id', tk.hotel_id)
          .order('sort_order');
        const withDefaults = await ensureDefaultTypes(tk.hotel_id, (occData || []) as OccurrenceType[]);
        setOccurrenceTypes(withDefaults);

      } catch (e: any) {
        setError(e.message || 'Erro ao carregar dados.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // ---------------------------------------------------------------------------
  // Entry helpers
  // ---------------------------------------------------------------------------
  const getEntry = (empId: string, day: string) =>
    entries.find(e => e.employee_id === empId && e.day_date === day) || null;

  const [isSaving, setIsSaving] = useState(false);

  const isFutureWeek = useMemo(() => {
    if (!tokenData) return false;
    const currentWeekStart = getWeekSunday(new Date());
    const targetWeekStart = new Date(tokenData.week_start + 'T00:00:00');
    return targetWeekStart > currentWeekStart;
  }, [tokenData]);

  // Um mesmo domingo aparece em duas escalas: coluna 8 da semana anterior e
  // coluna 1 da semana seguinte. Replica a última edição para a escala gêmea
  // (criando a escala da própria semana do domingo se preciso), para que o
  // lançamento mais recente seja a verdade única do dia — evita o domingo
  // antigo "voltar" e a duplicidade de transferências entre unidades.
  const syncSundayTwin = async (partial: Partial<ScheduleEntry>, savedScheduleId: string) => {
    try {
      if (!tokenData || !partial.day_date || !partial.employee_id) return;
      const d = parseISO(partial.day_date);
      if (d.getDay() !== 0) return;
      const ownWeek  = partial.day_date;
      const prevWeek = format(subWeeks(d, 1), 'yyyy-MM-dd');
      const { data: scheds } = await supabase.from('schedules')
        .select('id, week_start').eq('hotel_id', tokenData.hotel_id).in('week_start', [ownWeek, prevWeek]);
      const byWeek = new Map((scheds || []).map(s => [s.week_start as string, s.id as string]));
      let ownId = byWeek.get(ownWeek);
      if (!ownId) {
        const { data: c } = await supabase.from('schedules')
          .insert({ hotel_id: tokenData.hotel_id, week_start: ownWeek })
          .select('id').single();
        ownId = c?.id;
      }
      const targets = [ownId, byWeek.get(prevWeek)]
        .filter((id): id is string => !!id && id !== savedScheduleId);
      if (targets.length === 0) return;
      const { id: _drop, ...clean } = partial as any;
      await supabase.from('schedule_entries').upsert(
        targets.map(sid => ({ ...clean, schedule_id: sid, updated_by: null })),
        { onConflict: 'schedule_id,employee_id,day_date' });
    } catch (e) {
      console.error('Erro ao sincronizar domingo gêmeo:', e);
    }
  };

  const saveEntry = async (partial: Partial<ScheduleEntry>) => {
    if (!tokenData || isSaving) return;

    if (!isFutureWeek) {
      addNotification('error', 'Edição bloqueada: O link público permite apenas alterações em semanas futuras.');
      return;
    }

    setIsSaving(true);
    try {
      console.log('Upserting entry:', { ...partial, schedule_id: tokenData.schedule_id });
      const { data, error } = await supabase.from('schedule_entries')
        .upsert({
          ...partial,
          schedule_id: tokenData.schedule_id,
          updated_by: null
        }, {
          onConflict: 'schedule_id,employee_id,day_date'
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setEntries(prev => {
          const exists = prev.some(e => e.id === data.id);
          if (exists) {
            return prev.map(e => e.id === data.id ? data as ScheduleEntry : e);
          }
          return [...prev, data as ScheduleEntry];
        });
      }
      await syncSundayTwin(partial, tokenData.schedule_id);
    } catch (e) {
      console.error('Erro ao salvar célula:', e);
      addNotification('error', 'Erro ao salvar. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  // Preenche um tipo recorrente (ex.: Férias) do dia inicial até untilDate,
  // inclusive atravessando semanas — cria a escala das semanas futuras se preciso.
  const saveEntryRange = async (base: Partial<ScheduleEntry>, untilDate: string) => {
    if (!tokenData || isSaving) return;

    if (!isFutureWeek) {
      addNotification('error', 'Edição bloqueada: O link público permite apenas alterações em semanas futuras.');
      return;
    }

    setIsSaving(true);
    try {
      const startDate = parseISO(base.day_date!);
      const endDate   = parseISO(untilDate);
      const totalDays = differenceInCalendarDays(endDate, startDate) + 1;
      if (totalDays < 1) return;

      // Agrupa as datas pela semana (domingo) a que pertencem.
      // A grade exibe 8 colunas (DOM→DOM): um domingo é coluna 8 da semana
      // anterior E coluna 1 da seguinte — grava nas duas escalas.
      const visibleWeekStr = format(weekStart, 'yyyy-MM-dd');
      const byWeek = new Map<string, string[]>();
      const push = (wk: string, ds: string) => {
        if (!byWeek.has(wk)) byWeek.set(wk, []);
        byWeek.get(wk)!.push(ds);
      };
      for (let i = 0; i < totalDays; i++) {
        const d  = addDays(startDate, i);
        const ds = format(d, 'yyyy-MM-dd');
        const wk = format(getWeekSunday(d), 'yyyy-MM-dd');
        push(wk, ds);
        if (d.getDay() === 0) {
          const prevWk = format(subWeeks(d, 1), 'yyyy-MM-dd');
          if (byWeek.has(prevWk) || prevWk === visibleWeekStr) push(prevWk, ds);
        }
      }

      for (const [weekStr, dates] of byWeek) {
        // Garante que existe uma escala para a semana
        let scheduleId: string;
        if (weekStr === visibleWeekStr) {
          scheduleId = tokenData.schedule_id;
        } else {
          const { data: existing } = await supabase
            .from('schedules').select('id').eq('hotel_id', tokenData.hotel_id).eq('week_start', weekStr).maybeSingle();
          if (existing) {
            scheduleId = existing.id;
          } else {
            const { data: created, error: ce } = await supabase
              .from('schedules').insert({ hotel_id: tokenData.hotel_id, week_start: weekStr })
              .select('id').single();
            if (ce) throw ce;
            scheduleId = created!.id;
          }
        }

        const rows = dates.map(d => ({
          ...base,
          day_date: d,
          schedule_id: scheduleId,
          updated_by: null,
        }));
        const { data, error } = await supabase.from('schedule_entries')
          .upsert(rows, { onConflict: 'schedule_id,employee_id,day_date' })
          .select();
        if (error) throw error;

        // Atualiza o estado local apenas para a semana visível
        if (scheduleId === tokenData.schedule_id && data) {
          setEntries(prev => [
            ...prev.filter(e => !(e.employee_id === base.employee_id && dates.includes(e.day_date))),
            ...(data as ScheduleEntry[]),
          ]);
        }
      }
      // Sincroniza os domingos do intervalo com as escalas gêmeas não cobertas pelo loop
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(startDate, i);
        if (d.getDay() === 0) await syncSundayTwin({ ...base, day_date: format(d, 'yyyy-MM-dd') }, '');
      }
      addNotification('success', `${totalDays} dia${totalDays > 1 ? 's' : ''} preenchido${totalDays > 1 ? 's' : ''} até ${format(endDate, 'dd/MM/yyyy')}.`);
    } catch (e) {
      console.error('Erro ao preencher intervalo:', e);
      addNotification('error', 'Erro ao salvar o período. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const fillWeek = async (toInsert: Partial<ScheduleEntry>[]) => {
    if (!tokenData || isSaving) return;

    if (!isFutureWeek) {
      addNotification('error', 'Edição bloqueada: O link público permite apenas alterações em semanas futuras.');
      return;
    }

    const empId = toInsert[0]?.employee_id;
    if (!empId) return;
    const dayDates = weekDays.map(d => format(d, 'yyyy-MM-dd'));
    
    setIsSaving(true);
    try {
      // 1. Clear existing to be clean
      await supabase.from('schedule_entries')
        .delete().eq('schedule_id', tokenData.schedule_id).eq('employee_id', empId).in('day_date', dayDates);

      // 2. Upsert new entries
      const withId = toInsert.map(e => ({ ...e, schedule_id: tokenData.schedule_id, updated_by: null }));
      const { data, error } = await supabase.from('schedule_entries')
        .upsert(withId, { onConflict: 'schedule_id,employee_id,day_date' })
        .select();

      if (error) throw error;
      if (data) {
        setEntries(prev => [
          ...prev.filter(e => !(e.employee_id === empId && dayDates.includes(e.day_date))),
          ...(data as ScheduleEntry[]),
        ]);
      }
      // Domingos das colunas 1 e 8 também existem nas escalas vizinhas
      for (const e of toInsert) {
        if (e.day_date && parseISO(e.day_date).getDay() === 0) {
          await syncSundayTwin(e, tokenData.schedule_id);
        }
      }
    } catch (e) {
      console.error('Erro ao preencher semana:', e);
      addNotification('error', 'Erro ao salvar. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const openCell = (e: React.MouseEvent, empId: string, dayDate: string, sector: string) => {
    if (!isFutureWeek) return;
    setCellEditor({ empId, dayDate, sector, entry: getEntry(empId, dayDate) });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center space-y-3">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Carregando escala...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 max-w-md text-center space-y-4">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Link indisponível</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* Modals */}
      {cellEditor && tokenData && (
        <CellEditor
          entry={cellEditor.entry} employeeId={cellEditor.empId}
          dayDate={cellEditor.dayDate} sector={cellEditor.sector}
          scheduleId={tokenData.schedule_id} hotels={hotels}
          occurrenceTypes={occurrenceTypes}
          defaultRestStart={employees.find(e => e.id === cellEditor.empId)?.default_rest_start}
          defaultRestEnd={employees.find(e => e.id === cellEditor.empId)?.default_rest_end}
          onSave={saveEntry}
          onSaveRange={saveEntryRange}
          onClose={() => setCellEditor(null)}
        />
      )}

      {autoFillEmp && tokenData && (
        <AutoFillModal
          employee={autoFillEmp}
          weekDays={weekDays}
          scheduleId={tokenData.schedule_id}
          onFill={fillWeek}
          onClose={() => setAutoFillEmp(null)}
        />
      )}

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 shadow-sm px-4 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Calendar className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 dark:text-white">
                Escala — {tokenData?.sector}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <Building2 className="h-3 w-3" />
                {hotelName} · Semana {weekLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2.5 py-1 rounded-full font-bold">
              Salvamento automático
            </span>
            <button onClick={() => setDarkMode(d => !d)}
              title={darkMode ? 'Modo claro' : 'Modo escuro'}
              className="w-8 h-8 flex items-center justify-center rounded-xl border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="max-w-6xl mx-auto px-4 pt-3">
        {isFutureWeek ? (
          <p className="text-xs text-blue-600 dark:text-blue-400">
            ⚡ Clique no <strong>nome</strong> para auto-preencher · Clique em qualquer <strong>célula</strong> para editar
          </p>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-xs font-bold">
              Edição bloqueada: O link público permite apenas alterações em semanas futuras.
            </p>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-300 dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800 text-white">
                <th className="px-3 py-3 text-left font-bold text-xs sticky left-0 bg-gray-800 z-10 min-w-[140px]">
                  COLABORADOR
                </th>
                {weekDays.map((day, i) => {
                  const isToday = isSameDay(day, new Date());
                  const isSunday = i === 0 || i === 7;
                  return (
                    <th key={i} className={`px-1 py-3 font-bold text-center w-[90px] ${
                      isToday ? 'bg-blue-600' : isSunday ? 'bg-gray-700' : ''
                    }`}>
                      <div className="text-xs font-black">{DAY_LABELS[i]}</div>
                      <div className="text-xs opacity-60 font-normal">{format(day, 'dd/MM')}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Sector header */}
              <tr className="bg-gray-200 dark:bg-gray-700">
                <td colSpan={9} className="px-4 py-2 text-xs font-black text-gray-800 dark:text-gray-200 uppercase tracking-widest sticky left-0 bg-gray-200 dark:bg-gray-700">
                  {tokenData?.sector}
                </td>
              </tr>

              {employees.map((emp, ei) => (
                <tr key={emp.id}
                  className={`border-b border-gray-200 dark:border-gray-700 ${
                    ei % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-100/70 dark:bg-gray-800/50'
                  }`}>
                  {/* Name — click to auto-fill */}
                  <td onClick={() => isFutureWeek && setAutoFillEmp(emp)}
                    className={`px-3 py-2.5 sticky left-0 bg-inherit z-10 border-r border-gray-200 dark:border-gray-700 group ${isFutureWeek ? 'cursor-pointer' : 'cursor-default'}`}>
                    <div className="flex items-center gap-1">
                      <span className={`font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap transition-colors text-xs ${isFutureWeek ? 'group-hover:text-blue-600 dark:group-hover:text-blue-400' : ''}`}>
                        {emp.name.split(' ')[0]}&nbsp;
                        <span className="text-gray-400 font-normal">
                          {emp.name.split(' ').slice(1, 2).join('')?.charAt(0) || ''}.
                        </span>
                      </span>
                      {isFutureWeek && <Zap className="h-2.5 w-2.5 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </div>
                    {emp.work_schedule && (
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        {WORK_SCHEDULES.find(w => w.value === emp.work_schedule)?.label || emp.work_schedule}
                      </span>
                    )}
                  </td>

                  {/* Day cells */}
                  {weekDays.map((day, di) => {
                    const dayStr = format(day, 'yyyy-MM-dd');
                    const ent    = getEntry(emp.id, dayStr);
                    const text   = formatEntry(ent, hotels, occurrenceTypes);
                    const style  = getEntryStyle(ent, occurrenceTypes);
                    const isSun  = di === 0 || di === 7;
                    const isToday = isSameDay(day, new Date());

                    return (
                      <td key={di}
                        onClick={(e) => openCell(e, emp.id, dayStr, emp.sector)}
                        className={`px-1 py-2 text-center cursor-pointer transition-all hover:ring-2 hover:ring-blue-400 hover:ring-inset ${
                          style.bg || (isSun ? 'bg-gray-200/50 dark:bg-gray-800/60' : '')
                        } ${isToday ? 'ring-1 ring-blue-200 dark:ring-blue-800' : ''}`}>
                        <p className={`text-[11px] font-bold leading-tight ${style.color}`}>
                          {text.line1}
                        </p>
                        {text.line2 && (
                          <p className={`text-[9px] leading-tight mt-0.5 ${style.color} opacity-70`}>
                            {text.line2}
                          </p>
                        )}
                        {text.rest && (
                          <p className="text-[9px] leading-tight text-amber-600 dark:text-amber-400">{text.rest}</p>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {employees.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400 dark:text-gray-500">
                    Nenhum colaborador encontrado para este setor.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="max-w-6xl mx-auto px-4 pb-6">
        <div className="flex flex-wrap gap-2">
          {[...occurrenceTypes].sort((a, b) => a.sort_order - b.sort_order).map(ot => {
            const colors = OCCURRENCE_COLORS[ot.color] || OCCURRENCE_COLORS.indigo;
            return (
              <span key={ot.id}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${colors.bg} ${colors.text}`}>
                {ot.name}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
