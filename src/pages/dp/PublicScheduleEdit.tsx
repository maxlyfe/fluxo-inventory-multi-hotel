// src/pages/dp/PublicScheduleEdit.tsx
// Página pública para líder de setor preencher escala (sem login)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useNotification } from '../../context/NotificationContext';
import {
  Loader2, AlertTriangle, Check, Zap, X, Calendar, Building2,
} from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay } from 'date-fns';

// ---------------------------------------------------------------------------
// Types (mirrored from DPSchedule)
// ---------------------------------------------------------------------------
interface Hotel { id: string; name: string; }

interface Employee {
  id: string; name: string; sector: string; role: string; status: string;
  work_schedule: string | null;
  default_shift_start: string | null;
  default_shift_end: string | null;
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
  custom_label: string | null;
  transfer_hotel_id: string | null;
  occurrence_type_id: string | null;
}

interface Schedule { id: string; hotel_id: string; week_start: string; }

interface OccurrenceType {
  id: string; hotel_id: string; name: string; slug: string; color: string;
  causes_basket_loss: boolean; loss_threshold: number; is_system: boolean; sort_order: number;
  entry_type_key: string | null;
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
  { entry_type_key: 'inss',       name: 'INSS',          slug: 'inss',       color: 'gray',   causes_basket_loss: false, loss_threshold: 1, is_system: true,  sort_order: 6 },
  { entry_type_key: 'ferias',     name: 'FÉRIAS',        slug: 'ferias',     color: 'cyan',   causes_basket_loss: false, loss_threshold: 1, is_system: true,  sort_order: 7 },
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

function formatEntry(entry: ScheduleEntry | null, hotels: Hotel[], occTypes?: OccurrenceType[]): { line1: string; line2?: string } {
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
  onSave: (e: Partial<ScheduleEntry>) => Promise<void>;
  onClose: () => void;
}

function CellEditor({ entry, employeeId, dayDate, sector, scheduleId, hotels, occurrenceTypes, onSave, onClose }: CellEditorProps) {
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
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 60);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [onClose]);

  const sortedOccurrences = [...occurrenceTypes].sort((a, b) => a.sort_order - b.sort_order);
  const selectedKey = selection.kind === 'occurrence' ? (selection.ot.entry_type_key || '') : '';
  const needsTimePicker = selection.kind === 'shift' || ['meia_dobra', 'transfer'].includes(selectedKey);
  const needsHotelSelector = selectedKey === 'transfer';

  const save = async () => {
    setSaving(true);
    if (selection.kind === 'shift') {
      await onSave({
        employee_id: employeeId, day_date: dayDate, sector, schedule_id: scheduleId,
        entry_type: 'shift',
        shift_start: start || null, shift_end: end || null,
        custom_label: null, transfer_hotel_id: null, occurrence_type_id: null,
      });
    } else if (selection.kind === 'empty') {
      await onSave({
        employee_id: employeeId, day_date: dayDate, sector, schedule_id: scheduleId,
        entry_type: 'empty',
        shift_start: null, shift_end: null,
        custom_label: null, transfer_hotel_id: null, occurrence_type_id: null,
      });
    } else {
      const ot = selection.ot;
      const key = ot.entry_type_key;
      const entryType = key || 'custom';
      const wantsTime = ['meia_dobra', 'transfer'].includes(key || '');
      await onSave({
        employee_id: employeeId, day_date: dayDate, sector, schedule_id: scheduleId,
        entry_type: entryType,
        shift_start: wantsTime ? (start || null) : null,
        shift_end: wantsTime ? (end || null) : null,
        custom_label: !key ? ot.name : null,
        transfer_hotel_id: key === 'transfer' ? (transferHotel || null) : null,
        occurrence_type_id: ot.id,
      });
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
          <button onClick={() => setSelection({ kind: 'shift' })}
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

        {needsTimePicker && (
          <div className="flex gap-2 items-center">
            <input type="time" value={start} onChange={e => setStart(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <span className="text-xs text-gray-400">AS</span>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        )}

        {needsHotelSelector && (
          <select value={transferHotel} onChange={e => setTransferHotel(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none">
            <option value="">Selecione a unidade...</option>
            {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
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
    const toInsert: Partial<ScheduleEntry>[] = weekDays.map((day, i) => ({
      schedule_id: scheduleId,
      employee_id: employee.id,
      sector:      employee.sector,
      day_date:    format(day, 'yyyy-MM-dd'),
      entry_type:  preview[i] ? 'shift' : 'folga',
      shift_start: preview[i] ? shiftStart : null,
      shift_end:   preview[i] ? shiftEnd   : null,
      custom_label: null,
      transfer_hotel_id: null,
    }));
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
                    <p className="text-[11px] font-bold mt-0.5 leading-tight">
                      {works
                        ? <span className="text-gray-700 dark:text-gray-200 block">{shiftStart}<br/>AS<br/>{shiftEnd}</span>
                        : <span className="text-green-600 dark:text-green-400">FOLGA</span>
                      }
                    </p>
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
          .select('id, name, sector, role, status, work_schedule, default_shift_start, default_shift_end')
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

  const saveEntry = async (partial: Partial<ScheduleEntry>) => {
    if (!tokenData) return;

    // Double-check: block past week edits
    const currentWeekStart = getWeekSunday(new Date());
    if (new Date(tokenData.week_start + 'T00:00:00') < currentWeekStart) {
      addNotification('error', 'Esta semana já passou. Edição bloqueada.');
      return;
    }

    const existing = entries.find(e => e.employee_id === partial.employee_id && e.day_date === partial.day_date);
    try {
      if (existing?.id) {
        const { data } = await supabase.from('schedule_entries')
          .update({ ...partial, updated_by: null }).eq('id', existing.id).select().single();
        if (data) setEntries(prev => prev.map(e => e.id === existing.id ? data as ScheduleEntry : e));
      } else {
        const { data } = await supabase.from('schedule_entries')
          .insert({ ...partial, schedule_id: tokenData.schedule_id, updated_by: null }).select().single();
        if (data) setEntries(prev => [...prev, data as ScheduleEntry]);
      }
    } catch (e) {
      console.error('Erro ao salvar célula:', e);
      addNotification('error', 'Erro ao salvar. Tente novamente.');
    }
  };

  const fillWeek = async (toInsert: Partial<ScheduleEntry>[]) => {
    if (!tokenData) return;
    const empId = toInsert[0]?.employee_id;
    if (!empId) return;
    const dayDates = weekDays.map(d => format(d, 'yyyy-MM-dd'));
    await supabase.from('schedule_entries')
      .delete().eq('schedule_id', tokenData.schedule_id).eq('employee_id', empId).in('day_date', dayDates);
    const withId = toInsert.map(e => ({ ...e, schedule_id: tokenData.schedule_id, updated_by: null }));
    const { data } = await supabase.from('schedule_entries').insert(withId).select();
    if (data) {
      setEntries(prev => [
        ...prev.filter(e => !(e.employee_id === empId && dayDates.includes(e.day_date))),
        ...(data as ScheduleEntry[]),
      ]);
    }
  };

  const openCell = (e: React.MouseEvent, empId: string, dayDate: string, sector: string) => {
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Modals */}
      {cellEditor && tokenData && (
        <CellEditor
          entry={cellEditor.entry} employeeId={cellEditor.empId}
          dayDate={cellEditor.dayDate} sector={cellEditor.sector}
          scheduleId={tokenData.schedule_id} hotels={hotels}
          occurrenceTypes={occurrenceTypes}
          onSave={saveEntry}
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
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
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
            <span className="text-[11px] text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2.5 py-1 rounded-full font-bold">
              Salvamento automático
            </span>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="max-w-6xl mx-auto px-4 pt-3">
        <p className="text-xs text-blue-600 dark:text-blue-400">
          ⚡ Clique no <strong>nome</strong> para auto-preencher · Clique em qualquer <strong>célula</strong> para editar
        </p>
      </div>

      {/* Table */}
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
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
              <tr className="bg-gray-100 dark:bg-gray-700">
                <td colSpan={9} className="px-4 py-2 text-xs font-black text-gray-700 dark:text-gray-200 uppercase tracking-widest sticky left-0 bg-gray-100 dark:bg-gray-700">
                  {tokenData?.sector}
                </td>
              </tr>

              {employees.map((emp, ei) => (
                <tr key={emp.id}
                  className={`border-b border-gray-100 dark:border-gray-700 ${
                    ei % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/40 dark:bg-gray-800/50'
                  }`}>
                  {/* Name — click to auto-fill */}
                  <td onClick={() => setAutoFillEmp(emp)}
                    className="px-3 py-2.5 sticky left-0 bg-inherit z-10 border-r border-gray-100 dark:border-gray-700 cursor-pointer group">
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors text-xs">
                        {emp.name.split(' ')[0]}&nbsp;
                        <span className="text-gray-400 font-normal">
                          {emp.name.split(' ').slice(1, 2).join('')?.charAt(0) || ''}.
                        </span>
                      </span>
                      <Zap className="h-2.5 w-2.5 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
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
                          style.bg || (isSun ? 'bg-gray-50/60 dark:bg-gray-800/60' : '')
                        } ${isToday ? 'ring-1 ring-blue-200 dark:ring-blue-800' : ''}`}>
                        <p className={`text-[11px] font-bold leading-tight ${style.color}`}>
                          {text.line1}
                        </p>
                        {text.line2 && (
                          <p className={`text-[9px] leading-tight mt-0.5 ${style.color} opacity-70`}>
                            {text.line2}
                          </p>
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
