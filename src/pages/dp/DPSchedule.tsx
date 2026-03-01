// src/pages/dp/DPSchedule.tsx
// Escala semanal DOM→DOM — auto-preenchimento por padrão de escala
// Clique no nome do colaborador para auto-preencher a semana toda

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import {
  ChevronLeft, ChevronRight, Loader2, AlertTriangle,
  Building2, Download, Check, RefreshCw, Zap, X,
} from 'lucide-react';
import { format, startOfWeek, addWeeks, subWeeks, addDays, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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
}

interface Schedule {
  id: string; hotel_id: string; week_start: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ENTRY_TYPES = [
  { value: 'shift',      label: 'Turno',        color: 'text-gray-800 dark:text-gray-100', bg: '' },
  { value: 'folga',      label: 'FOLGA',         color: 'text-green-700 dark:text-green-300', bg: 'bg-green-50 dark:bg-green-900/30' },
  { value: 'compensa',   label: 'COMPENSA',      color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-900/30' },
  { value: 'meia_dobra', label: 'MEIA DOBRA',    color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/30' },
  { value: 'curso',      label: 'CURSO',         color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-900/30' },
  { value: 'inss',       label: 'INSS',          color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-700' },
  { value: 'ferias',     label: 'FÉRIAS',        color: 'text-cyan-700 dark:text-cyan-300', bg: 'bg-cyan-50 dark:bg-cyan-900/30' },
  { value: 'falta',      label: 'FALTA',         color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
  { value: 'brava',      label: 'BRAVA',         color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  { value: 'custom',     label: 'Outro',         color: 'text-indigo-700 dark:text-indigo-300', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
  { value: 'empty',      label: '------',        color: 'text-gray-300 dark:text-gray-600', bg: '' },
];

const WORK_SCHEDULES = [
  { value: '12x36', label: '12×36' },
  { value: '6x1',   label: '6×1 (8h15m)' },
  { value: '5x2',   label: '5×2 (10h)' },
  { value: '4x2',   label: '4×2' },
  { value: 'custom', label: 'Personalizado' },
];

// DOM = 0, SEG = 1, ... SAB = 6
const DAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

const SECTORS_ORDER = [
  'Recepção', 'Governança', 'Manutenção', 'Cozinha', 'Salão',
  'Reservas', 'Administrativo', 'Lavanderia', 'Segurança', 'Outro',
];

// ---------------------------------------------------------------------------
// Schedule pattern logic
// Returns array of 7 booleans (true = work, false = folga) for DOM→SAB
// ---------------------------------------------------------------------------
function getPatternForWeek(
  workSchedule: string,
  sundayIsWork: boolean, // used for 12x36
  folgaDays: number[],   // 0-6 indices for patterns with fixed folga days
): boolean[] {
  switch (workSchedule) {
    case '12x36':
      // Alternates each day starting from Sunday
      return Array.from({ length: 7 }, (_, i) =>
        sundayIsWork ? i % 2 === 0 : i % 2 !== 0
      );
    case '6x1':
      // 6 work, 1 folga — folga is whichever day user picks
      return Array.from({ length: 7 }, (_, i) => !folgaDays.includes(i));
    case '5x2':
      // 5 work, 2 folgas
      return Array.from({ length: 7 }, (_, i) => !folgaDays.includes(i));
    case '4x2':
      // 4 work, 2 folgas (but 2 folgas are consecutive)
      return Array.from({ length: 7 }, (_, i) => !folgaDays.includes(i));
    default:
      return Array(7).fill(true);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getWeekSunday(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 0 });
}

function formatEntry(entry: ScheduleEntry | null): { line1: string; line2?: string } {
  if (!entry || entry.entry_type === 'empty') return { line1: '------' };
  const t = entry.entry_type;
  if (t === 'folga')      return { line1: 'FOLGA' };
  if (t === 'compensa')   return { line1: 'COMPENSA' };
  if (t === 'meia_dobra') {
    const times = entry.shift_start && entry.shift_end
      ? `${entry.shift_start.slice(0,5)} AS ${entry.shift_end.slice(0,5)}`
      : '';
    return { line1: 'MEIA DOBRA', line2: times ? `(${times})` : undefined };
  }
  if (t === 'curso')  return { line1: 'CURSO' };
  if (t === 'inss')   return { line1: 'INSS' };
  if (t === 'ferias') return { line1: 'FÉRIAS' };
  if (t === 'falta')  return { line1: 'FALTA' };
  if (t === 'brava')  return { line1: 'BRAVA' };
  if (t === 'custom') return { line1: entry.custom_label || '—' };
  if (t === 'shift' && entry.shift_start && entry.shift_end)
    return { line1: `${entry.shift_start.slice(0,5)} AS ${entry.shift_end.slice(0,5)}` };
  return { line1: '—' };
}

function getEntryStyle(entry: ScheduleEntry | null) {
  if (!entry || entry.entry_type === 'empty') return { color: 'text-gray-300 dark:text-gray-600', bg: '' };
  const cfg = ENTRY_TYPES.find(t => t.value === entry.entry_type);
  return { color: cfg?.color || '', bg: cfg?.bg || '' };
}

// ---------------------------------------------------------------------------
// Cell Editor
// ---------------------------------------------------------------------------
interface CellEditorProps {
  entry: ScheduleEntry | null;
  employeeId: string; dayDate: string; sector: string; scheduleId: string;
  onSave: (e: Partial<ScheduleEntry>) => Promise<void>;
  onClose: () => void;
  position: { top: number; left: number };
}

function CellEditor({ entry, employeeId, dayDate, sector, scheduleId, onSave, onClose, position }: CellEditorProps) {
  const [type, setType]     = useState(entry?.entry_type || 'shift');
  const [start, setStart]   = useState(entry?.shift_start?.slice(0,5) || '');
  const [end, setEnd]       = useState(entry?.shift_end?.slice(0,5) || '');
  const [custom, setCustom] = useState(entry?.custom_label || '');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 60);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    await onSave({
      employee_id: employeeId, day_date: dayDate, sector, schedule_id: scheduleId,
      entry_type: type,
      shift_start: (type === 'shift' || type === 'meia_dobra') ? (start || null) : null,
      shift_end:   (type === 'shift' || type === 'meia_dobra') ? (end   || null) : null,
      custom_label: type === 'custom' ? custom : null,
    });
    setSaving(false);
    onClose();
  };

  const style: React.CSSProperties = {
    position: 'fixed',
    top:  Math.min(position.top,  window.innerHeight - 340),
    left: Math.min(position.left, window.innerWidth  - 268),
    zIndex: 200,
  };

  return (
    <div ref={ref} style={style}
      className="w-64 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-1">
        {ENTRY_TYPES.map(t => (
          <button key={t.value} onClick={() => setType(t.value)}
            className={`text-xs px-2 py-1.5 rounded-xl font-semibold transition-all text-left ${
              type === t.value
                ? `${t.bg || 'bg-gray-100 dark:bg-gray-700'} ${t.color} ring-2 ring-blue-400`
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {(type === 'shift' || type === 'meia_dobra') && (
        <div className="flex gap-2 items-center">
          <input type="time" value={start} onChange={e => setStart(e.target.value)}
            className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <span className="text-xs text-gray-400">AS</span>
          <input type="time" value={end} onChange={e => setEnd(e.target.value)}
            className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
      )}

      {type === 'custom' && (
        <input type="text" value={custom} onChange={e => setCustom(e.target.value)}
          placeholder="Ex: BRAVA, EXTRA 15HS..." maxLength={20}
          className="w-full px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
      )}

      <div className="flex gap-2">
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
// Auto-fill Modal — opens when clicking employee name
// ---------------------------------------------------------------------------
interface AutoFillModalProps {
  employee: Employee;
  weekDays: Date[];
  scheduleId: string;
  onFill: (entries: Partial<ScheduleEntry>[]) => Promise<void>;
  onClose: () => void;
}

function AutoFillModal({ employee, weekDays, scheduleId, onFill, onClose }: AutoFillModalProps) {
  const ws = employee.work_schedule || '';

  // State
  const [schedule, setSchedule]   = useState(ws || '6x1');
  const [shiftStart, setStart]    = useState(employee.default_shift_start?.slice(0,5) || '07:00');
  const [shiftEnd, setEnd]        = useState(employee.default_shift_end?.slice(0,5) || '15:00');
  const [folgaDays, setFolgaDays] = useState<number[]>(ws === '12x36' ? [] : ws === '5x2' ? [0,6] : ws === '4x2' ? [0,6] : [0]);
  const [sundayWork, setSundayWork] = useState(false); // for 12x36
  const [saving, setSaving]       = useState(false);

  const maxFolgas = schedule === '6x1' ? 1 : schedule === '5x2' ? 2 : schedule === '4x2' ? 3 : 0;

  const toggleFolga = (day: number) => {
    if (schedule === '12x36') return;
    setFolgaDays(prev => {
      if (prev.includes(day)) return prev.filter(d => d !== day);
      if (prev.length >= maxFolgas) return [...prev.slice(1), day]; // replace oldest
      return [...prev, day];
    });
  };

  const preview = schedule === '12x36'
    ? getPatternForWeek('12x36', sundayWork, [])
    : getPatternForWeek(schedule, false, folgaDays);

  const handleFill = async () => {
    setSaving(true);
    const toInsert: Partial<ScheduleEntry>[] = weekDays.map((day, i) => ({
      schedule_id:  scheduleId,
      employee_id:  employee.id,
      sector:       employee.sector,
      day_date:     format(day, 'yyyy-MM-dd'),
      entry_type:   preview[i] ? 'shift' : 'folga',
      shift_start:  preview[i] ? shiftStart : null,
      shift_end:    preview[i] ? shiftEnd   : null,
      custom_label: null,
    }));
    await onFill(toInsert);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
              {employee.name.split(' ').slice(0,2).map(n => n[0]).join('')}
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
          {/* Tipo de escala */}
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Tipo de escala</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {WORK_SCHEDULES.map(w => (
                <button key={w.value} onClick={() => {
                  setSchedule(w.value);
                  if (w.value === '12x36') setFolgaDays([]);
                  else if (w.value === '6x1') setFolgaDays([0]);
                  else if (w.value === '5x2') setFolgaDays([0, 6]);
                  else if (w.value === '4x2') setFolgaDays([0, 5, 6]);
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

          {/* 12x36: domingo trabalha ou folga? */}
          {schedule === '12x36' && (
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Domingo desta semana</label>
              <div className="flex gap-2">
                <button onClick={() => setSundayWork(true)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${sundayWork ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-blue-300'}`}>
                  Trabalha (DOM)
                </button>
                <button onClick={() => setSundayWork(false)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${!sundayWork ? 'bg-green-500 border-green-500 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-green-300'}`}>
                  Folga (DOM)
                </button>
              </div>
            </div>
          )}

          {/* Folga days selector */}
          {schedule !== '12x36' && maxFolgas > 0 && (
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Folga{maxFolgas > 1 ? 's' : ''} desta semana
                <span className="ml-2 font-normal text-gray-400 normal-case">
                  (selecione {maxFolgas} dia{maxFolgas > 1 ? 's' : ''})
                </span>
              </label>
              <div className="grid grid-cols-7 gap-1">
                {DAY_LABELS.map((label, i) => {
                  const isFolga = folgaDays.includes(i);
                  return (
                    <button key={i} onClick={() => toggleFolga(i)}
                      className={`py-2 rounded-xl text-xs font-bold transition-all ${
                        isFolga
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview */}
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Preview da semana</label>
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map((day, i) => {
                const works = preview[i];
                return (
                  <div key={i} className={`p-2 rounded-xl text-center border ${
                    works
                      ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                      : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                  }`}>
                    <p className="text-xs font-bold text-gray-400">{DAY_LABELS[i]}</p>
                    <p className="text-xs font-bold mt-0.5">
                      {works
                        ? <span className="text-gray-700 dark:text-gray-200 text-[10px] leading-tight block">{shiftStart}<br/>AS<br/>{shiftEnd}</span>
                        : <span className="text-green-600 dark:text-green-400">FOLGA</span>
                      }
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action */}
          <div className="flex gap-3 pb-2">
            <button onClick={onClose}
              className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancelar
            </button>
            <button onClick={handleFill} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-bold rounded-xl transition-colors">
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin" />Preenchendo...</>
                : <><Zap className="h-4 w-4" />Preencher semana</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function DPSchedule() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();

  const canChangeHotel = ['admin', 'management'].includes(user?.role || '');
  const defaultHotelId = selectedHotel?.id || '';

  const [weekStart, setWeekStart]     = useState(getWeekSunday(new Date()));
  const [hotels, setHotels]           = useState<{ id: string; name: string }[]>([]);
  const [filterHotel, setFilterHotel] = useState(defaultHotelId);
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [schedule, setSchedule]       = useState<Schedule | null>(null);
  const [entries, setEntries]         = useState<ScheduleEntry[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState('');

  // Cell editor
  const [cellEditor, setCellEditor] = useState<{
    empId: string; dayDate: string; sector: string; entry: ScheduleEntry | null;
    pos: { top: number; left: number };
  } | null>(null);

  // Auto-fill modal
  const [autoFillEmp, setAutoFillEmp] = useState<Employee | null>(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekLabel = `${format(weekStart, 'dd/MM')} a ${format(addDays(weekStart, 6), 'dd/MM/yyyy')}`;
  const hotelId = canChangeHotel ? filterHotel : defaultHotelId;

  // ---------------------------------------------------------------------------
  useEffect(() => {
    supabase.from('hotels').select('id, name').order('name').then(({ data }) => setHotels(data || []));
  }, []);

  useEffect(() => {
    if (!canChangeHotel && selectedHotel?.id) setFilterHotel(selectedHotel.id);
  }, [selectedHotel?.id]);

  // ---------------------------------------------------------------------------
  const loadSchedule = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    setRefreshing(true); setError('');
    try {
      const weekStr = format(weekStart, 'yyyy-MM-dd');

      const { data: empData } = await supabase
        .from('employees')
        .select('id, name, sector, role, status, work_schedule, default_shift_start, default_shift_end')
        .eq('hotel_id', hotelId).eq('status', 'active').order('sector').order('name');
      setEmployees((empData || []) as Employee[]);

      let { data: sched } = await supabase
        .from('schedules').select('*').eq('hotel_id', hotelId).eq('week_start', weekStr).maybeSingle();
      if (!sched) {
        const { data: c } = await supabase
          .from('schedules').insert({ hotel_id: hotelId, week_start: weekStr, created_by: user?.id }).select().single();
        sched = c;
      }
      setSchedule(sched as Schedule);

      if (sched?.id) {
        const { data: entryData } = await supabase.from('schedule_entries').select('*').eq('schedule_id', sched.id);
        setEntries((entryData || []) as ScheduleEntry[]);
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar escala.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [weekStart, hotelId]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  // ---------------------------------------------------------------------------
  const getEntry = (empId: string, day: string) =>
    entries.find(e => e.employee_id === empId && e.day_date === day) || null;

  // ---------------------------------------------------------------------------
  // Upsert single entry
  const saveEntry = async (partial: Partial<ScheduleEntry>) => {
    if (!schedule) return;
    const existing = entries.find(e => e.employee_id === partial.employee_id && e.day_date === partial.day_date);
    try {
      if (existing?.id) {
        const { data } = await supabase.from('schedule_entries')
          .update({ ...partial, updated_by: user?.id }).eq('id', existing.id).select().single();
        if (data) setEntries(prev => prev.map(e => e.id === existing.id ? data as ScheduleEntry : e));
      } else {
        const { data } = await supabase.from('schedule_entries')
          .insert({ ...partial, schedule_id: schedule.id, updated_by: user?.id }).select().single();
        if (data) setEntries(prev => [...prev, data as ScheduleEntry]);
      }
    } catch (e) { console.error('Erro ao salvar célula:', e); }
  };

  // ---------------------------------------------------------------------------
  // Batch upsert for auto-fill
  const fillWeek = async (toInsert: Partial<ScheduleEntry>[]) => {
    if (!schedule) return;
    // Delete existing entries for this employee this week, then insert all
    const empId = toInsert[0]?.employee_id;
    if (!empId) return;
    const dayDates = weekDays.map(d => format(d, 'yyyy-MM-dd'));

    await supabase.from('schedule_entries')
      .delete()
      .eq('schedule_id', schedule.id)
      .eq('employee_id', empId)
      .in('day_date', dayDates);

    const withScheduleId = toInsert.map(e => ({ ...e, schedule_id: schedule.id, updated_by: user?.id }));
    const { data } = await supabase.from('schedule_entries').insert(withScheduleId).select();
    if (data) {
      setEntries(prev => [
        ...prev.filter(e => !(e.employee_id === empId && dayDates.includes(e.day_date))),
        ...(data as ScheduleEntry[]),
      ]);
    }
  };

  // ---------------------------------------------------------------------------
  // Open cell editor
  const openCell = (e: React.MouseEvent, empId: string, dayDate: string, sector: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCellEditor({ empId, dayDate, sector, entry: getEntry(empId, dayDate), pos: { top: rect.bottom + 4, left: rect.left } });
  };

  // ---------------------------------------------------------------------------
  // Sector groups
  const sectorGroups = SECTORS_ORDER
    .map(s => ({ sector: s, emps: employees.filter(e => e.sector === s) }))
    .filter(g => g.emps.length > 0);

  // ---------------------------------------------------------------------------
  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Modals */}
      {cellEditor && schedule && (
        <CellEditor
          entry={cellEditor.entry} employeeId={cellEditor.empId}
          dayDate={cellEditor.dayDate} sector={cellEditor.sector}
          scheduleId={schedule.id} position={cellEditor.pos}
          onSave={saveEntry} onClose={() => setCellEditor(null)}
        />
      )}
      {autoFillEmp && schedule && (
        <AutoFillModal
          employee={autoFillEmp} weekDays={weekDays}
          scheduleId={schedule.id}
          onFill={fillWeek} onClose={() => setAutoFillEmp(null)}
        />
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Week nav */}
        <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-1">
          <button onClick={() => setWeekStart(w => subWeeks(w, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="px-3 text-center">
            <p className="text-xs font-bold text-gray-900 dark:text-white whitespace-nowrap">
              ESCALA SEMANA {weekLabel.toUpperCase()}
            </p>
          </div>
          <button onClick={() => setWeekStart(w => addWeeks(w, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <button onClick={() => setWeekStart(getWeekSunday(new Date()))}
          className="px-3 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
          Semana atual
        </button>

        {canChangeHotel && hotels.length > 1 && (
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <select value={filterHotel} onChange={e => setFilterHotel(e.target.value)}
              className="pl-9 pr-8 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none">
              <option value="">Selecione o hotel...</option>
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}

        {refreshing && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}

        <div className="ml-auto flex gap-2">
          <button onClick={loadSchedule}
            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-gray-500 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors print:hidden">
            <RefreshCw className="h-3.5 w-3.5" />Atualizar
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold rounded-xl hover:border-gray-300 transition-colors print:hidden">
            <Download className="h-3.5 w-3.5" />Exportar
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-2xl text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* Empty states */}
      {!hotelId && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Building2 className="h-10 w-10 opacity-30" />
          <p className="text-sm">Selecione um hotel para ver a escala.</p>
        </div>
      )}

      {hotelId && !loading && employees.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <p className="text-sm">Nenhum colaborador ativo nesta unidade.</p>
        </div>
      )}

      {/* Hint */}
      {hotelId && employees.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 print:hidden">
          <Zap className="h-3.5 w-3.5 text-blue-400" />
          <span>Clique no <strong className="text-blue-500">nome</strong> do colaborador para auto-preencher a semana · Clique em qualquer <strong>célula</strong> para editar</span>
        </div>
      )}

      {/* Schedule table */}
      {hotelId && employees.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm print-area">
          <table className="w-full border-collapse text-xs" style={{ minWidth: 860 }}>
            <thead>
              <tr className="bg-gray-800 dark:bg-gray-950 text-white">
                {/* Name column */}
                <th className="text-left px-4 py-3 font-bold uppercase tracking-wider w-36 sticky left-0 bg-gray-800 dark:bg-gray-950 z-10 border-r border-gray-700">
                  Colaborador
                </th>
                {/* Day headers DOM→SAB */}
                {weekDays.map((day, i) => {
                  const isToday   = isSameDay(day, new Date());
                  const isSunday  = i === 0 || i === 6;
                  return (
                    <th key={i} className={`px-1 py-3 font-bold text-center w-24 ${
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
              {sectorGroups.map(({ sector, emps }) => (
                <React.Fragment key={sector}>
                  {/* Sector row */}
                  <tr className="bg-gray-100 dark:bg-gray-700">
                    <td colSpan={8} className="px-4 py-2 text-xs font-black text-gray-700 dark:text-gray-200 uppercase tracking-widest sticky left-0 bg-gray-100 dark:bg-gray-700">
                      {sector}
                    </td>
                  </tr>

                  {/* Employee rows */}
                  {emps.map((emp, ei) => (
                    <tr key={emp.id}
                      className={`border-b border-gray-100 dark:border-gray-700 ${
                        ei % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/40 dark:bg-gray-800/50'
                      }`}>

                      {/* Name — click to auto-fill */}
                      <td
                        onClick={() => setAutoFillEmp(emp)}
                        className="px-3 py-2.5 sticky left-0 bg-inherit z-10 border-r border-gray-100 dark:border-gray-700 cursor-pointer group"
                        title="Clique para auto-preencher a semana">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors text-xs">
                            {emp.name.split(' ')[0]}&nbsp;
                            <span className="text-gray-400 font-normal">
                              {emp.name.split(' ').slice(1, 2).join('')?.charAt(0) || ''}.
                            </span>
                          </span>
                          {emp.work_schedule && (
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <Zap className="h-3 w-3 text-blue-400" />
                            </span>
                          )}
                        </div>
                        {emp.work_schedule && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            {WORK_SCHEDULES.find(w => w.value === emp.work_schedule)?.label || emp.work_schedule}
                          </span>
                        )}
                      </td>

                      {/* Day cells */}
                      {weekDays.map((day, di) => {
                        const dayStr  = format(day, 'yyyy-MM-dd');
                        const entry   = getEntry(emp.id, dayStr);
                        const style   = getEntryStyle(entry);
                        const text    = formatEntry(entry);
                        const isToday = isSameDay(day, new Date());
                        const isSun   = di === 0 || di === 6;

                        return (
                          <td key={di}
                            onClick={e => openCell(e, emp.id, dayStr, emp.sector)}
                            className={`px-1 py-2 text-center cursor-pointer select-none transition-all
                              hover:ring-2 hover:ring-inset hover:ring-blue-400 relative
                              ${isToday ? 'bg-blue-50/30 dark:bg-blue-900/10' : isSun ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''}
                              ${style.bg}
                            `}>
                            <span className={`font-semibold leading-tight block ${style.color} text-[11px]`}>
                              {text.line1}
                            </span>
                            {text.line2 && (
                              <span className="text-[10px] opacity-60 block leading-tight">{text.line2}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {hotelId && employees.length > 0 && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {ENTRY_TYPES.filter(t => !['shift','empty','custom'].includes(t.value)).map(t => (
            <span key={t.value} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-100 dark:border-gray-700 ${t.bg || 'bg-gray-50 dark:bg-gray-800'} ${t.color}`}>
              {t.label}
            </span>
          ))}
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; top: 0; left: 0; width: 100%; }
          @page { size: A3 landscape; margin: 8mm; }
          table { font-size: 9pt; }
        }
      `}</style>
    </div>
  );
}