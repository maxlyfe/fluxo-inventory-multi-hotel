// src/pages/dp/DPSchedule.tsx
// Escala semanal DOM→DOM (8 colunas)
// Auto-preenchimento por padrão, célula editável, transferência de unidade, exportar como imagem

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import {
  ChevronLeft, ChevronRight, Loader2, AlertTriangle,
  Building2, Download, Check, RefreshCw, Zap, X, Image, Camera, Copy, CheckCheck, Link2, Pencil,
  Trash2, ChevronDown, ChevronUp, Settings2, ArrowUp, ArrowDown, Plus,
} from 'lucide-react';
import { format, startOfWeek, addWeeks, subWeeks, addDays, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNotification } from '../../context/NotificationContext';

// ---------------------------------------------------------------------------
// Types
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
  entry_type: string;   // shift | folga | compensa | meia_dobra | curso | inss | ferias | falta | atestado | transfer | custom | empty
  shift_start: string | null;
  shift_end: string | null;
  custom_label: string | null;
  transfer_hotel_id: string | null;
  occurrence_type_id: string | null;
}

interface Schedule { id: string; hotel_id: string; week_start: string; }

interface OccurrenceType {
  id: string;
  hotel_id: string;
  name: string;
  slug: string;
  color: string;
  causes_basket_loss: boolean;
  loss_threshold: number;
  is_system: boolean;
  sort_order: number;
  entry_type_key: string | null; // mapeia ao comportamento especial (meia_dobra→time picker, transfer→hotel+time)
}

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

// ---------------------------------------------------------------------------
// Default occurrence type seeds (auto-created per hotel on first load)
// ---------------------------------------------------------------------------
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
    .insert(missing.map(s => ({ ...s, hotel_id: hotelId })))
    .select();

  if (data && data.length > 0) {
    return [...existing, ...(data as OccurrenceType[])].sort((a, b) => a.sort_order - b.sort_order);
  }
  return existing;
}

// ---------------------------------------------------------------------------
// Constants (fallback para dados antigos sem occurrence_type_id)
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

const WORK_SCHEDULES = [
  { value: '12x36', label: '12×36' },
  { value: '6x1',   label: '6×1 (8h15m)' },
  { value: '5x2',   label: '5×2 (10h)' },
  { value: '4x2',   label: '4×2' },
  { value: 'custom', label: 'Personalizado' },
];

// DOM=0 ... SAB=6 ... DOM=7 (8 colunas)
const DAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

const SECTORS_ORDER = [
  'Recepção', 'Governança', 'Manutenção', 'Cozinha', 'Salão',
  'Reservas', 'Administrativo', 'Lavanderia', 'Segurança', 'Outro',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getWeekSunday(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 0 });
}

function getPatternForWeek(
  schedule: string,
  sundayIsWork: boolean,
  folgaDays: number[], // indices 0-7
): boolean[] {
  if (schedule === '12x36') {
    return Array.from({ length: 8 }, (_, i) =>
      sundayIsWork ? i % 2 === 0 : i % 2 !== 0
    );
  }
  return Array.from({ length: 8 }, (_, i) => !folgaDays.includes(i));
}

function formatEntry(entry: ScheduleEntry | null, hotels: Hotel[], occTypes?: OccurrenceType[]): { line1: string; line2?: string } {
  if (!entry || entry.entry_type === 'empty') return { line1: '------' };
  const t = entry.entry_type;

  // Special rendering for types with unique UI (time picker, hotel selector)
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

  // For occurrence-type-linked entries, use DB name (supports renamed types)
  if (entry.occurrence_type_id && occTypes) {
    const ot = occTypes.find(o => o.id === entry.occurrence_type_id);
    if (ot) return { line1: ot.name };
  }

  // Fallback for legacy entries (no occurrence_type_id) or custom
  if (t === 'custom') return { line1: entry.custom_label || '—' };
  // Legacy hardcoded fallback
  const legacy: Record<string, string> = {
    folga: 'FOLGA', compensa: 'COMPENSA', curso: 'CURSO', inss: 'INSS',
    ferias: 'FÉRIAS', falta: 'FALTA', atestado: 'ATESTADO',
  };
  if (legacy[t]) return { line1: legacy[t] };

  return { line1: '—' };
}

function getEntryStyle(entry: ScheduleEntry | null, occTypes?: OccurrenceType[]) {
  if (!entry || entry.entry_type === 'empty') return { color: 'text-gray-300 dark:text-gray-600', bg: '' };

  // Try occurrence_type from DB first (supports custom colors)
  if (entry.occurrence_type_id && occTypes) {
    const ot = occTypes.find(o => o.id === entry.occurrence_type_id);
    if (ot) {
      const colors = OCCURRENCE_COLORS[ot.color] || OCCURRENCE_COLORS.indigo;
      return { color: colors.text, bg: colors.bg };
    }
  }

  // Fallback to hardcoded ENTRY_TYPES for legacy data
  const cfg = ENTRY_TYPES.find(t => t.value === entry.entry_type);
  return { color: cfg?.color || '', bg: cfg?.bg || '' };
}

// ---------------------------------------------------------------------------
// Cell Editor — Layout Unificado
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
  hotelId: string;
  onSave: (e: Partial<ScheduleEntry>) => Promise<void>;
  onClose: () => void;
  onOccurrenceTypesChanged: (types: OccurrenceType[]) => void;
}

function CellEditor({ entry, employeeId, dayDate, sector, scheduleId, hotels, occurrenceTypes, hotelId, onSave, onClose, onOccurrenceTypesChanged }: CellEditorProps) {
  // ── Derive initial selection from entry ──
  const getInitialSelection = (): CellSelection => {
    if (!entry || entry.entry_type === 'empty') return { kind: 'empty' };
    if (entry.entry_type === 'shift') return { kind: 'shift' };
    // Try to find matching occurrence type
    if (entry.occurrence_type_id) {
      const ot = occurrenceTypes.find(o => o.id === entry.occurrence_type_id);
      if (ot) return { kind: 'occurrence', ot };
    }
    // Fallback: match by entry_type_key or slug
    const byKey = occurrenceTypes.find(o => o.entry_type_key === entry.entry_type);
    if (byKey) return { kind: 'occurrence', ot: byKey };
    return { kind: 'shift' };
  };

  const [selection, setSelection] = useState<CellSelection>(getInitialSelection);
  const [start, setStart]        = useState(entry?.shift_start?.slice(0, 5) || '');
  const [end, setEnd]            = useState(entry?.shift_end?.slice(0, 5) || '');
  const [transferHotel, setTransferHotel] = useState(entry?.transfer_hotel_id || '');
  const [saving, setSaving]      = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  // ── Manage state ──
  const [newOccName, setNewOccName] = useState('');
  const [newOccCausesLoss, setNewOccCausesLoss] = useState(false);
  const [newOccThreshold, setNewOccThreshold] = useState(1);
  const [creatingOcc, setCreatingOcc] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCausesLoss, setEditCausesLoss] = useState(false);
  const [editThreshold, setEditThreshold] = useState(1);
  const [savingEdit, setSavingEdit] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 60);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [onClose]);

  // ── Derived ──
  const sortedOccurrences = [...occurrenceTypes].sort((a, b) => a.sort_order - b.sort_order);
  const selectedKey = selection.kind === 'occurrence' ? (selection.ot.entry_type_key || '') : '';
  const needsTimePicker = selection.kind === 'shift' || ['meia_dobra', 'transfer'].includes(selectedKey);
  const needsHotelSelector = selectedKey === 'transfer';

  // ── Handlers ──
  const handleCreateOccurrenceType = async () => {
    if (!newOccName.trim() || creatingOcc) return;
    setCreatingOcc(true);
    const slug = newOccName.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    const { data, error } = await supabase.from('occurrence_types').insert({
      hotel_id: hotelId,
      name: newOccName.trim(),
      slug,
      color: 'indigo',
      causes_basket_loss: newOccCausesLoss,
      loss_threshold: newOccCausesLoss ? newOccThreshold : 1,
      is_system: false,
      sort_order: occurrenceTypes.length + 1,
      entry_type_key: null,
    }).select().single();

    if (data && !error) {
      const newOt = data as OccurrenceType;
      onOccurrenceTypesChanged([...occurrenceTypes, newOt]);
      setSelection({ kind: 'occurrence', ot: newOt });
      setNewOccName('');
      setNewOccCausesLoss(false);
      setNewOccThreshold(1);
    }
    setCreatingOcc(false);
  };

  const startEditing = (ot: OccurrenceType) => {
    setEditingId(ot.id);
    setEditName(ot.name);
    setEditCausesLoss(ot.causes_basket_loss);
    setEditThreshold(ot.loss_threshold);
  };

  const cancelEditing = () => { setEditingId(null); };

  const saveEdit = async (ot: OccurrenceType) => {
    if (!editName.trim()) return;
    setSavingEdit(true);
    const slug = editName.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    await supabase.from('occurrence_types').update({
      name: editName.trim(),
      slug,
      causes_basket_loss: editCausesLoss,
      loss_threshold: editCausesLoss ? editThreshold : 1,
    }).eq('id', ot.id);
    const updated = occurrenceTypes.map(o =>
      o.id === ot.id ? { ...o, name: editName.trim(), slug, causes_basket_loss: editCausesLoss, loss_threshold: editCausesLoss ? editThreshold : 1 } : o
    );
    onOccurrenceTypesChanged(updated);
    // Update selection if we edited the selected type
    if (selection.kind === 'occurrence' && selection.ot.id === ot.id) {
      const updatedOt = updated.find(o => o.id === ot.id)!;
      setSelection({ kind: 'occurrence', ot: updatedOt });
    }
    setEditingId(null);
    setSavingEdit(false);
  };

  const deleteType = async (ot: OccurrenceType) => {
    if (!confirm(`Excluir "${ot.name}"? Entradas existentes serão mantidas mas sem vínculo.`)) return;
    await supabase.from('occurrence_types').delete().eq('id', ot.id);
    onOccurrenceTypesChanged(occurrenceTypes.filter(o => o.id !== ot.id));
    if (selection.kind === 'occurrence' && selection.ot.id === ot.id) {
      setSelection({ kind: 'shift' });
    }
  };

  const moveType = async (ot: OccurrenceType, dir: -1 | 1) => {
    const sorted = [...occurrenceTypes].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex(o => o.id === ot.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx];
    const tmpOrder = ot.sort_order;
    await Promise.all([
      supabase.from('occurrence_types').update({ sort_order: other.sort_order }).eq('id', ot.id),
      supabase.from('occurrence_types').update({ sort_order: tmpOrder }).eq('id', other.id),
    ]);
    onOccurrenceTypesChanged(occurrenceTypes.map(o => {
      if (o.id === ot.id) return { ...o, sort_order: other.sort_order };
      if (o.id === other.id) return { ...o, sort_order: tmpOrder };
      return o;
    }));
  };

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

  const canSave = selection.kind !== 'occurrence' || !!selection.ot;

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

        {/* ── Grid unificado: Turno + DB types + ------ ── */}
        <div className="grid grid-cols-2 gap-1">
          {/* Turno — fixo */}
          <button onClick={() => setSelection({ kind: 'shift' })}
            className={`text-xs px-2 py-1.5 rounded-xl font-semibold transition-all text-left ${
              selection.kind === 'shift'
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 ring-2 ring-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            Turno
          </button>

          {/* Tipos do DB */}
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

          {/* ------ fixo */}
          <button onClick={() => setSelection({ kind: 'empty' })}
            className={`text-xs px-2 py-1.5 rounded-xl font-semibold transition-all text-left ${
              selection.kind === 'empty'
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-300 dark:text-gray-600 ring-2 ring-blue-400'
                : 'text-gray-300 dark:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            ------
          </button>
        </div>

        {/* ── Campos dinâmicos: horário ── */}
        {needsTimePicker && (
          <div className="flex gap-2 items-center">
            <input type="time" value={start} onChange={e => setStart(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <span className="text-xs text-gray-400">AS</span>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        )}

        {/* ── Campo: hotel de transferência ── */}
        {needsHotelSelector && (
          <select value={transferHotel} onChange={e => setTransferHotel(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none">
            <option value="">Selecione a unidade...</option>
            {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}

        {/* ── Seção expansível: Gerenciar tipos ── */}
        <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
          <button onClick={() => setManageOpen(!manageOpen)}
            className="w-full flex items-center justify-between text-[11px] font-bold text-gray-400 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-300 transition-colors py-1">
            <span className="flex items-center gap-1.5">
              <Settings2 className="w-3 h-3" />
              Gerenciar tipos
            </span>
            {manageOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {manageOpen && (
            <div className="mt-2 space-y-2">
              {sortedOccurrences.length > 0 && (
                <div className="space-y-1">
                  {sortedOccurrences.map((ot, idx) => {
                    const isEditing = editingId === ot.id;
                    const colors = OCCURRENCE_COLORS[ot.color] || OCCURRENCE_COLORS.indigo;

                    if (isEditing) {
                      return (
                        <div key={ot.id} className={`rounded-xl p-2.5 space-y-2 ${colors.bg} ring-1 ${colors.ring}`}>
                          <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                            maxLength={30} autoFocus
                            className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-500 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={editCausesLoss} onChange={e => setEditCausesLoss(e.target.checked)}
                                className="w-3.5 h-3.5 rounded border-gray-300 text-red-500 focus:ring-red-400" />
                              <span className="text-[10px] text-gray-600 dark:text-gray-300">Perde cesta</span>
                            </label>
                            {editCausesLoss && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-gray-500">após</span>
                                <input type="number" min={1} max={31} value={editThreshold}
                                  onChange={e => setEditThreshold(Math.max(1, parseInt(e.target.value) || 1))}
                                  className="w-10 px-1 py-0.5 text-[10px] text-center border border-gray-300 dark:border-gray-500 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                                <span className="text-[10px] text-gray-500">x</span>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={cancelEditing}
                              className="flex-1 py-1 text-[10px] font-semibold text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                              Cancelar
                            </button>
                            <button onClick={() => saveEdit(ot)} disabled={savingEdit || !editName.trim()}
                              className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-bold bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-60">
                              {savingEdit ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />} Salvar
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={ot.id}
                        className="group flex items-center gap-1.5 px-2 py-1.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => moveType(ot, -1)} disabled={idx === 0}
                            className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 disabled:opacity-30 p-0 leading-none">
                            <ArrowUp className="w-2.5 h-2.5" />
                          </button>
                          <button onClick={() => moveType(ot, 1)} disabled={idx === sortedOccurrences.length - 1}
                            className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 disabled:opacity-30 p-0 leading-none">
                            <ArrowDown className="w-2.5 h-2.5" />
                          </button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs font-semibold ${colors.text} truncate block`}>{ot.name}</span>
                          {ot.causes_basket_loss && (
                            <span className="text-[9px] text-red-400">
                              {ot.loss_threshold === 1 ? 'perde cesta' : `perde após ${ot.loss_threshold}x`}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEditing(ot)}
                            className="p-1 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => deleteType(ot)}
                            className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Criar novo tipo */}
              <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-1.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Criar novo tipo</p>
                <input type="text" value={newOccName} onChange={e => setNewOccName(e.target.value)}
                  placeholder="Nome da ocorrência..." maxLength={30}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                {newOccName.trim() && (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={newOccCausesLoss} onChange={e => setNewOccCausesLoss(e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-red-500 focus:ring-red-400" />
                        <span className="text-[11px] text-gray-600 dark:text-gray-300">Perde cesta básica</span>
                      </label>
                    </div>
                    {newOccCausesLoss && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500">Após</span>
                        <input type="number" min={1} max={31} value={newOccThreshold}
                          onChange={e => setNewOccThreshold(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-12 px-2 py-1 text-xs text-center border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        <span className="text-[11px] text-gray-500">vez(es) no mês</span>
                      </div>
                    )}
                    <button onClick={handleCreateOccurrenceType} disabled={creatingOcc || !newOccName.trim()}
                      className="w-full flex items-center justify-center gap-1 py-1.5 text-xs font-bold bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl disabled:opacity-60 transition-colors">
                      {creatingOcc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Criar tipo
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Botões fixos */}
      <div className="flex gap-2 p-3 pt-2 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
        <button onClick={onClose}
          className="flex-1 py-1.5 text-xs font-semibold text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          Cancelar
        </button>
        <button onClick={save} disabled={saving || !canSave}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white rounded-xl disabled:opacity-60 transition-colors">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Salvar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-fill Modal
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
                    <p className="text-[10px] font-bold text-gray-400">{DAY_LABELS[i]}</p>
                    <p className="text-[10px] font-bold mt-0.5 leading-tight">
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
// Export Image Modal
// ---------------------------------------------------------------------------
interface ExportModalProps {
  sectors: string[];
  employees: Employee[];
  weekDays: Date[];
  entries: ScheduleEntry[];
  hotels: Hotel[];
  hotelName: string;
  weekLabel: string;
  onClose: () => void;
}

function ExportModal({ sectors, employees, weekDays, entries, hotels, hotelName, weekLabel, onClose }: ExportModalProps) {
  const [selectedSectors, setSelectedSectors] = useState<string[]>(sectors);
  const [generating, setGenerating]           = useState(false);
  const [copying, setCopying]                 = useState(false);
  const [copied, setCopied]                   = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const toggleSector = (s: string) =>
    setSelectedSectors(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  // Employees filtered by selected sectors
  const filteredEmps = employees.filter(e => selectedSectors.includes(e.sector));
  const sectorGroups = sectors
    .filter(s => selectedSectors.includes(s))
    .map(s => ({ sector: s, emps: filteredEmps.filter(e => e.sector === s) }))
    .filter(g => g.emps.length > 0);

  const getEntry = (empId: string, day: string) =>
    entries.find(e => e.employee_id === empId && e.day_date === day) || null;

  const handleExport = async () => {
    if (!tableRef.current) return;
    setGenerating(true);
    try {
      // Dynamically import html2canvas
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(tableRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `escala-${weekLabel.replace(/\//g, '-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      alert('Erro ao gerar imagem. Certifique-se de ter instalado: npm install html2canvas');
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  // Copia a imagem diretamente para a área de transferência
  const handleCopy = async () => {
    if (!tableRef.current) return;
    setCopying(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(tableRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) { alert('Não foi possível gerar a imagem.'); setCopying(false); return; }
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
          setCopied(true);
          setTimeout(() => setCopied(false), 3000);
        } catch {
          // Fallback: alguns navegadores bloqueiam Clipboard API — baixa o arquivo
          const url  = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `escala-${weekLabel.replace(/\//g, '-')}.png`;
          link.href = url;
          link.click();
          URL.revokeObjectURL(url);
          alert('Seu navegador não suporta copiar imagem diretamente.\nA imagem foi baixada para você.');
        }
        setCopying(false);
      }, 'image/png');
    } catch (err) {
      alert('Erro ao gerar imagem. Certifique-se de ter instalado: npm install html2canvas');
      console.error(err);
      setCopying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-4xl bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-3xl flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Camera className="h-5 w-5 text-blue-500" />Gerar Imagem da Escala
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Selecione os setores que aparecerão na imagem</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Sector selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Setores</label>
              <div className="flex gap-2">
                <button onClick={() => setSelectedSectors(sectors)}
                  className="text-xs text-blue-500 hover:underline">Todos</button>
                <button onClick={() => setSelectedSectors([])}
                  className="text-xs text-gray-400 hover:underline">Nenhum</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sectors.map(s => (
                <button key={s} onClick={() => toggleSector(s)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                    selectedSectors.includes(s)
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 hover:border-blue-300'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Preview table (this is what gets captured) */}
          <div className="overflow-x-auto">
            <div ref={tableRef} className="bg-white p-3" style={{ fontFamily: 'Arial, sans-serif' }}>
              {/* Title */}
              <div style={{ textAlign: 'center', marginBottom: 12, padding: '8px 0', background: '#1f2937', color: 'white', borderRadius: 4 }}>
                <p style={{ fontWeight: 'bold', fontSize: 13, letterSpacing: 1, margin: 0 }}>
                  ESCALA SEMANA {weekLabel.toUpperCase()}
                </p>
                <p style={{ fontSize: 10, opacity: 0.7, margin: '2px 0 0' }}>{hotelName}</p>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <tbody>
                  {sectorGroups.map(({ sector, emps }) => (
                    <React.Fragment key={sector}>
                      {/* Repeat day/date header for each sector */}
                      <tr style={{ background: '#374151', color: 'white' }}>
                        <td style={{ padding: '5px 10px', fontWeight: 900, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'white' }}>
                          {sector}
                        </td>
                        {weekDays.map((day, i) => (
                          <td key={i} style={{ padding: '4px 4px', textAlign: 'center', fontWeight: 'bold', fontSize: 10,
                            background: i === 0 || i === 7 ? '#4b5563' : '#374151', color: 'white' }}>
                            <div>{DAY_LABELS[i]}</div>
                            <div style={{ fontWeight: 'normal', opacity: 0.7, fontSize: 9 }}>{format(day, 'dd/MM')}</div>
                          </td>
                        ))}
                      </tr>
                      {emps.map((emp, ei) => (
                        <tr key={emp.id} style={{ background: ei % 2 === 0 ? '#ffffff' : '#f9fafb', borderBottom: '2px solid #d1d5db' }}>
                          <td style={{ padding: '5px 10px', fontWeight: 600, fontSize: 10, color: '#111827', borderRight: '1px solid #e5e7eb' }}>
                            {emp.name.split(' ').slice(0, 2).join(' ')}
                          </td>
                          {weekDays.map((day, di) => {
                            const dayStr = format(day, 'yyyy-MM-dd');
                            const entry  = getEntry(emp.id, dayStr);
                            const text   = formatEntry(entry, hotels, occurrenceTypes);
                            const t      = entry?.entry_type || 'empty';

                            // Cell background colors for image
                            const bgMap: Record<string, string> = {
                              folga:      '#dcfce7',
                              compensa:   '#dbeafe',
                              meia_dobra: '#fef3c7',
                              transfer:   '#ede9fe',
                              curso:      '#f3e8ff',
                              inss:       '#f3f4f6',
                              ferias:     '#cffafe',
                              falta:      '#fee2e2',
                              custom:     '#e0e7ff',
                            };
                            const textMap: Record<string, string> = {
                              folga:      '#15803d',
                              compensa:   '#1d4ed8',
                              meia_dobra: '#92400e',
                              transfer:   '#6d28d9',
                              curso:      '#7e22ce',
                              inss:       '#6b7280',
                              ferias:     '#0e7490',
                              falta:      '#dc2626',
                              custom:     '#4338ca',
                              empty:      '#d1d5db',
                            };

                            const isSun = di === 0 || di === 7;

                            return (
                              <td key={di} style={{
                                padding: '4px 2px', textAlign: 'center', fontSize: 10, fontWeight: 600,
                                background: bgMap[t] || (isSun ? '#f9fafb' : 'transparent'),
                                color: textMap[t] || '#111827',
                                borderRight: '1px solid #f3f4f6',
                                lineHeight: 1.3,
                              }}>
                                <div>{text.line1}</div>
                                {text.line2 && <div style={{ fontSize: 8, opacity: 0.7 }}>{text.line2}</div>}
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
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-gray-800 p-4 flex gap-3 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Fechar
          </button>

          {/* Copiar para área de transferência */}
          <button onClick={handleCopy} disabled={copying || generating || selectedSectors.length === 0}
            className={`flex-1 flex items-center justify-center gap-2 py-3 font-bold rounded-xl transition-all disabled:opacity-60 ${
              copied
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 text-white'
            }`}>
            {copying
              ? <><Loader2 className="h-4 w-4 animate-spin" />Copiando...</>
              : copied
              ? <><CheckCheck className="h-4 w-4" />Copiado! Cole no WhatsApp</>
              : <><Copy className="h-4 w-4" />Copiar imagem</>
            }
          </button>

          {/* Baixar arquivo */}
          <button onClick={handleExport} disabled={generating || copying || selectedSectors.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-bold rounded-xl transition-colors">
            {generating
              ? <><Loader2 className="h-4 w-4 animate-spin" />Baixando...</>
              : <><Download className="h-4 w-4" />Baixar .png</>
            }
          </button>
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
  const { addNotification } = useNotification();
  const navigate = useNavigate();

  const canChangeHotel = ['admin', 'management'].includes(user?.role || '');
  const defaultHotelId = selectedHotel?.id || '';

  const [weekStart, setWeekStart]     = useState(getWeekSunday(new Date()));
  const [hotels, setHotels]           = useState<Hotel[]>([]);
  const [filterHotel, setFilterHotel] = useState(defaultHotelId);
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [schedule, setSchedule]       = useState<Schedule | null>(null);
  const [entries, setEntries]         = useState<ScheduleEntry[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState('');

  const [cellEditor, setCellEditor]   = useState<{
    empId: string; dayDate: string; sector: string; entry: ScheduleEntry | null;
    pos: { top: number; left: number };
  } | null>(null);
  const [autoFillEmp, setAutoFillEmp] = useState<Employee | null>(null);
  const [showExport, setShowExport]   = useState(false);
  const [occurrenceTypes, setOccurrenceTypes] = useState<OccurrenceType[]>([]);

  // 8 days: Sunday of week → Sunday of next week
  const weekDays = Array.from({ length: 8 }, (_, i) => addDays(weekStart, i));
  const weekLabel = `${format(weekStart, 'dd/MM')} a ${format(addDays(weekStart, 7), 'dd/MM/yyyy')}`;
  const hotelId   = canChangeHotel ? filterHotel : defaultHotelId;
  const hotelName = hotels.find(h => h.id === hotelId)?.name || 'Hotel';

  const activeSectors = [...new Set(employees.map(e => e.sector))]
    .sort((a, b) => SECTORS_ORDER.indexOf(a) - SECTORS_ORDER.indexOf(b));

  // ---------------------------------------------------------------------------
  useEffect(() => {
    supabase.from('hotels').select('id, name').order('name').then(({ data }) => setHotels(data || []));
  }, []);

  // Fetch occurrence types whenever hotel changes + auto-seed defaults
  useEffect(() => {
    if (!hotelId) return;
    (async () => {
      const { data } = await supabase.from('occurrence_types').select('*').eq('hotel_id', hotelId).order('sort_order');
      const existing = (data || []) as OccurrenceType[];
      const withDefaults = await ensureDefaultTypes(hotelId, existing);
      setOccurrenceTypes(withDefaults);
    })();
  }, [hotelId]);

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
        const { data: entryData } = await supabase
          .from('schedule_entries').select('*').eq('schedule_id', sched.id);
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

  const fillWeek = async (toInsert: Partial<ScheduleEntry>[]) => {
    if (!schedule) return;
    const empId    = toInsert[0]?.employee_id;
    if (!empId) return;
    const dayDates = weekDays.map(d => format(d, 'yyyy-MM-dd'));
    await supabase.from('schedule_entries')
      .delete().eq('schedule_id', schedule.id).eq('employee_id', empId).in('day_date', dayDates);
    const withId = toInsert.map(e => ({ ...e, schedule_id: schedule.id, updated_by: user?.id }));
    const { data } = await supabase.from('schedule_entries').insert(withId).select();
    if (data) {
      setEntries(prev => [
        ...prev.filter(e => !(e.employee_id === empId && dayDates.includes(e.day_date))),
        ...(data as ScheduleEntry[]),
      ]);
    }
  };

  // ---------------------------------------------------------------------------
  // Copy share link
  // ---------------------------------------------------------------------------
  const handleCopyScheduleLink = async (sector: string) => {
    if (!schedule || !hotelId) return;
    const weekStr = format(weekStart, 'yyyy-MM-dd');

    // Busca token existente
    let { data: existing } = await supabase
      .from('schedule_share_tokens')
      .select('token')
      .eq('hotel_id', hotelId)
      .eq('sector', sector)
      .eq('week_start', weekStr)
      .maybeSingle();

    if (!existing) {
      const { data: created, error } = await supabase
        .from('schedule_share_tokens')
        .insert({
          hotel_id: hotelId,
          schedule_id: schedule.id,
          sector,
          week_start: weekStr,
          created_by: user?.id,
        })
        .select('token')
        .single();
      if (error || !created) {
        addNotification('error', 'Erro ao gerar link de compartilhamento.');
        return;
      }
      existing = created;
    }

    const link = `${window.location.origin}/schedule/edit/${existing.token}`;
    try {
      await navigator.clipboard.writeText(link);
      addNotification('success', `Link da escala de ${sector} copiado!`);
    } catch {
      addNotification('error', 'Falha ao copiar o link.');
    }
  };

  const openCell = (e: React.MouseEvent, empId: string, dayDate: string, sector: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCellEditor({ empId, dayDate, sector, entry: getEntry(empId, dayDate), pos: { top: rect.bottom + 4, left: rect.left } });
  };

  // Sector groups for display — sorted by dominant shift (morning first, night last)
  const sectorGroups = useMemo(() => {
    const getShiftScore = (emp: Employee): number => {
      // Check entries for this employee: count how many days start in morning vs afternoon/night
      const empEntries = entries.filter(e => e.employee_id === emp.id && e.entry_type === 'shift');
      if (empEntries.length === 0) {
        // Fallback to default_shift_start
        const start = emp.default_shift_start;
        if (!start) return 12; // no info, middle
        const hour = parseInt(start.split(':')[0] || '12');
        return hour;
      }
      // Average start hour across entries
      let totalHour = 0;
      let count = 0;
      for (const e of empEntries) {
        if (e.shift_start) {
          const hour = parseInt(e.shift_start.split(':')[0] || '12');
          totalHour += hour;
          count++;
        }
      }
      return count > 0 ? totalHour / count : 12;
    };

    return SECTORS_ORDER
      .map(s => {
        const emps = employees
          .filter(e => e.sector === s)
          .sort((a, b) => getShiftScore(a) - getShiftScore(b));
        return { sector: s, emps };
      })
      .filter(g => g.emps.length > 0);
  }, [employees, entries]);

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
          scheduleId={schedule.id} hotels={hotels}
          occurrenceTypes={occurrenceTypes} hotelId={hotelId}
          onSave={saveEntry} onClose={() => setCellEditor(null)}
          onOccurrenceTypesChanged={setOccurrenceTypes}
        />
      )}
      {autoFillEmp && schedule && (
        <AutoFillModal
          employee={autoFillEmp} weekDays={weekDays}
          scheduleId={schedule.id}
          onFill={fillWeek} onClose={() => setAutoFillEmp(null)}
        />
      )}
      {showExport && (
        <ExportModal
          sectors={activeSectors} employees={employees}
          weekDays={weekDays} entries={entries}
          hotels={hotels} hotelName={hotelName} weekLabel={weekLabel}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Week navigation */}
        <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-1">
          <button onClick={() => setWeekStart(w => subWeeks(w, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="px-3 text-center">
            <p className="text-xs font-bold text-gray-900 dark:text-white whitespace-nowrap">
              ESCALA {weekLabel.toUpperCase()}
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
            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-gray-500 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {hotelId && employees.length > 0 && (
            <button onClick={() => setShowExport(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-xl transition-colors shadow-sm shadow-blue-200 dark:shadow-blue-900/30">
              <Camera className="h-3.5 w-3.5" />Gerar Imagem
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-2xl text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
        </div>
      )}

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
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <Zap className="h-3.5 w-3.5 text-blue-400" />
          <span>Clique no <strong className="text-blue-500">nome</strong> para auto-preencher · Clique em qualquer <strong>célula</strong> para editar</span>
        </div>
      )}

      {/* Schedule table */}
      {hotelId && employees.length > 0 && (
        <div className="overflow-x-auto overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          <table className="w-full border-collapse text-xs" style={{ minWidth: 920 }}>
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-800 dark:bg-gray-950 text-white">
                <th className="text-left px-4 py-3 font-bold uppercase tracking-wider w-36 sticky left-0 bg-gray-800 dark:bg-gray-950 z-30 border-r border-gray-700">
                  Colaborador
                </th>
                {weekDays.map((day, i) => {
                  const isToday  = isSameDay(day, new Date());
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
              {sectorGroups.map(({ sector, emps }) => (
                <React.Fragment key={sector}>
                  <tr className="bg-gray-100 dark:bg-gray-700 group/sector">
                    <td colSpan={9} className="px-4 py-2 text-xs font-black text-gray-700 dark:text-gray-200 uppercase tracking-widest sticky left-0 bg-gray-100 dark:bg-gray-700">
                      <div className="flex items-center gap-2">
                        {sector}
                        <button
                          onClick={() => handleCopyScheduleLink(sector)}
                          title={`Copiar link da escala de ${sector}`}
                          className="opacity-0 group-hover/sector:opacity-100 focus:opacity-100 transition-opacity p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          <Link2 className="h-3.5 w-3.5 text-gray-400 hover:text-blue-500 transition-colors" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {emps.map((emp, ei) => (
                    <tr key={emp.id}
                      className={`border-b border-gray-100 dark:border-gray-700 ${
                        ei % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/40 dark:bg-gray-800/50'
                      }`}>
                      {/* Name — click to auto-fill */}
                      <td className="px-3 py-2.5 sticky left-0 bg-inherit z-10 border-r border-gray-100 dark:border-gray-700 group">
                        <div className="flex items-center gap-1">
                          <span
                            onClick={() => setAutoFillEmp(emp)}
                            title={emp.name}
                            className="font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors text-xs cursor-pointer">
                            {emp.name.split(' ')[0]}&nbsp;
                            <span className="text-gray-400 font-normal">
                              {emp.name.split(' ').slice(1, 2).join('')?.charAt(0) || ''}.
                            </span>
                          </span>
                          <Zap className="h-2.5 w-2.5 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          {['admin', 'management', 'dp'].includes(user?.role || '') && (
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/dp/employee/${emp.id}`); }}
                              title="Editar ficha do colaborador"
                              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
                            >
                              <Pencil className="h-2.5 w-2.5 text-gray-400 hover:text-blue-500" />
                            </button>
                          )}
                        </div>
                        {emp.work_schedule && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            {WORK_SCHEDULES.find(w => w.value === emp.work_schedule)?.label || emp.work_schedule}
                          </span>
                        )}
                      </td>
                      {/* Cells */}
                      {weekDays.map((day, di) => {
                        const dayStr  = format(day, 'yyyy-MM-dd');
                        const entry   = getEntry(emp.id, dayStr);
                        const style   = getEntryStyle(entry, occurrenceTypes);
                        const text    = formatEntry(entry, hotels, occurrenceTypes);
                        const isToday = isSameDay(day, new Date());
                        const isSun   = di === 0 || di === 7;
                        return (
                          <td key={di}
                            onClick={e => openCell(e, emp.id, dayStr, emp.sector)}
                            className={`px-1 py-2 text-center cursor-pointer select-none transition-all
                              hover:ring-2 hover:ring-inset hover:ring-blue-400 relative
                              ${isToday ? 'bg-blue-50/30 dark:bg-blue-900/10' : isSun ? 'bg-gray-50/60 dark:bg-gray-900/20' : ''}
                              ${style.bg}
                            `}>
                            <span className={`font-semibold leading-tight block ${style.color} text-[11px]`}>
                              {text.line1}
                            </span>
                            {text.line2 && (
                              <span className="text-[9px] opacity-60 block leading-tight">{text.line2}</span>
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
        <div className="flex flex-wrap gap-2">
          {[...occurrenceTypes].sort((a, b) => a.sort_order - b.sort_order).map(ot => {
            const colors = OCCURRENCE_COLORS[ot.color] || OCCURRENCE_COLORS.indigo;
            return (
              <span key={ot.id} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-100 dark:border-gray-700 ${colors.bg} ${colors.text}`}>
                {ot.name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}