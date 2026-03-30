// src/pages/portal/MySchedule.tsx
// Visualização pessoal da escala do colaborador (read-only)

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks, isToday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, Clock, Calendar, AlertTriangle,
  Loader2, User,
} from 'lucide-react';

interface ScheduleEntry {
  id: string;
  day_date: string;
  entry_type: string;
  shift_start: string | null;
  shift_end: string | null;
  custom_label: string | null;
  occurrence_type_id: string | null;
}

interface OccurrenceType {
  id: string;
  name: string;
  color: string;
}

const ENTRY_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; darkBg: string }> = {
  shift:      { label: 'Turno',       color: 'text-blue-700',    bg: 'bg-blue-100',    darkBg: 'dark:bg-blue-900/30 dark:text-blue-300' },
  folga:      { label: 'FOLGA',       color: 'text-green-700',   bg: 'bg-green-100',   darkBg: 'dark:bg-green-900/30 dark:text-green-300' },
  compensa:   { label: 'COMPENSA',    color: 'text-blue-700',    bg: 'bg-blue-100',    darkBg: 'dark:bg-blue-900/30 dark:text-blue-300' },
  meia_dobra: { label: 'MEIA DOBRA',  color: 'text-amber-700',   bg: 'bg-amber-100',   darkBg: 'dark:bg-amber-900/30 dark:text-amber-300' },
  transfer:   { label: 'Outra UH',    color: 'text-violet-700',  bg: 'bg-violet-100',  darkBg: 'dark:bg-violet-900/30 dark:text-violet-300' },
  curso:      { label: 'CURSO',       color: 'text-purple-700',  bg: 'bg-purple-100',  darkBg: 'dark:bg-purple-900/30 dark:text-purple-300' },
  inss:       { label: 'INSS',        color: 'text-gray-700',    bg: 'bg-gray-100',    darkBg: 'dark:bg-gray-700/50 dark:text-gray-300' },
  ferias:     { label: 'FÉRIAS',      color: 'text-cyan-700',    bg: 'bg-cyan-100',    darkBg: 'dark:bg-cyan-900/30 dark:text-cyan-300' },
  falta:      { label: 'FALTA',       color: 'text-red-700',     bg: 'bg-red-100',     darkBg: 'dark:bg-red-900/30 dark:text-red-300' },
  atestado:   { label: 'ATESTADO',    color: 'text-orange-700',  bg: 'bg-orange-100',  darkBg: 'dark:bg-orange-900/30 dark:text-orange-300' },
};

export default function MySchedule() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();

  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [occurrenceTypes, setOccurrenceTypes] = useState<OccurrenceType[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id || !selectedHotel?.id) return;
    loadEmployee();
  }, [user?.id, selectedHotel?.id]);

  useEffect(() => {
    if (employeeId && selectedHotel?.id) {
      loadSchedule();
    }
  }, [employeeId, selectedHotel?.id, currentWeek]);

  async function loadEmployee() {
    const { data: emp } = await supabase
      .from('employees')
      .select('id, name')
      .eq('hotel_id', selectedHotel!.id)
      .eq('user_id', user!.id)
      .eq('status', 'active')
      .maybeSingle();

    if (emp) {
      setEmployeeId(emp.id);
      setEmployeeName(emp.name);
    }
    setLoading(false);
  }

  async function loadSchedule() {
    setLoading(true);
    try {
      const weekStartStr = format(currentWeek, 'yyyy-MM-dd');
      const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 0 });

      // Load occurrence types
      const { data: ot } = await supabase
        .from('occurrence_types')
        .select('id, name, color')
        .eq('hotel_id', selectedHotel!.id);
      setOccurrenceTypes(ot || []);

      // Find schedule for this week
      const { data: schedule } = await supabase
        .from('schedules')
        .select('id')
        .eq('hotel_id', selectedHotel!.id)
        .eq('week_start', weekStartStr)
        .maybeSingle();

      if (schedule) {
        const { data: entryData } = await supabase
          .from('schedule_entries')
          .select('id, day_date, entry_type, shift_start, shift_end, custom_label, occurrence_type_id')
          .eq('schedule_id', schedule.id)
          .eq('employee_id', employeeId!)
          .order('day_date');
        setEntries(entryData || []);
      } else {
        setEntries([]);
      }
    } finally {
      setLoading(false);
    }
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));
  const entryMap = new Map(entries.map(e => [e.day_date, e]));
  const occMap = new Map(occurrenceTypes.map(o => [o.id, o]));

  const weekLabel = `${format(currentWeek, "dd/MM", { locale: ptBR })} — ${format(addDays(currentWeek, 6), "dd/MM/yyyy", { locale: ptBR })}`;

  if (!employeeId && !loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">Conta não vinculada</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Sua conta de usuário não está vinculada a um colaborador. Peça ao administrador para vincular sua conta no cadastro de funcionários.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
          <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Minha Escala</h1>
          {employeeName && <p className="text-sm text-gray-500 dark:text-gray-400">{employeeName}</p>}
        </div>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 mb-4">
        <button
          onClick={() => setCurrentWeek(w => subWeeks(w, 1))}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-medium text-gray-800 dark:text-white">{weekLabel}</span>
        <button
          onClick={() => setCurrentWeek(w => addWeeks(w, 1))}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Schedule Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-2">
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const entry = entryMap.get(dateStr);
            const isCurrent = isToday(day);
            const config = entry ? ENTRY_TYPE_CONFIG[entry.entry_type] : null;

            // Check for occurrence type override
            let displayLabel = config?.label || entry?.entry_type || '';
            let displayColor = '';
            if (entry?.occurrence_type_id) {
              const occ = occMap.get(entry.occurrence_type_id);
              if (occ) displayLabel = occ.name;
            }

            return (
              <div
                key={dateStr}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                  isCurrent
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                }`}
              >
                {/* Day Info */}
                <div className="text-center min-w-[50px]">
                  <div className={`text-xs font-bold uppercase ${isCurrent ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>
                    {format(day, 'EEE', { locale: ptBR })}
                  </div>
                  <div className={`text-2xl font-bold ${isCurrent ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-white'}`}>
                    {format(day, 'dd')}
                  </div>
                </div>

                {/* Entry Info */}
                <div className="flex-1">
                  {entry ? (
                    <>
                      <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${config?.bg || 'bg-gray-100'} ${config?.color || 'text-gray-700'} ${config?.darkBg || 'dark:bg-gray-700 dark:text-gray-300'}`}>
                        {entry.custom_label || displayLabel}
                      </span>
                      {entry.entry_type === 'shift' && entry.shift_start && entry.shift_end && (
                        <div className="flex items-center gap-1 mt-1.5 text-sm text-gray-600 dark:text-gray-300">
                          <Clock className="w-3.5 h-3.5" />
                          {entry.shift_start.slice(0, 5)} — {entry.shift_end.slice(0, 5)}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-gray-400 dark:text-gray-500">Sem escala definida</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
