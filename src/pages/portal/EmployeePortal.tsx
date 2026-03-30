// src/pages/portal/EmployeePortal.tsx
// Portal do Colaborador — dashboard com widgets dinâmicos por cargo

import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { usePermissions } from '../../hooks/usePermissions';
import { format, startOfWeek, endOfWeek, addDays, isToday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Calendar, Clock, FileText, Gift, Heart, MessageCircle,
  ChevronRight, Shirt, User, CheckCircle, XCircle, AlertTriangle,
  Sparkles, PartyPopper, Loader2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Employee {
  id: string;
  name: string;
  role: string;
  sector: string;
  birth_date: string | null;
  photo_url: string | null;
  hotel_id: string;
}

interface ScheduleEntry {
  id: string;
  day_date: string;
  entry_type: string;
  shift_start: string | null;
  shift_end: string | null;
  custom_label: string | null;
}

interface MotivationalMessage {
  id: string;
  message: string;
  author: string | null;
}

interface EventItem {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  location: string | null;
  is_mandatory: boolean;
  event_type_id: string | null;
  event_types?: { name: string; color: string } | null;
}

interface UniformDelivery {
  id: string;
  delivery_date: string;
  items: { item: string; qty: number; size: string }[];
}

// ---------------------------------------------------------------------------
// Widget Components
// ---------------------------------------------------------------------------

function WidgetCard({ title, icon: Icon, children, href, color = '#3b82f6' }: {
  title: string;
  icon: React.ComponentType<any>;
  children: React.ReactNode;
  href?: string;
  color?: string;
}) {
  const header = (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <h3 className="font-semibold text-gray-800 dark:text-white text-sm">{title}</h3>
      </div>
      {href && (
        <Link to={href} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-0.5">
          Ver tudo <ChevronRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
      {header}
      {children}
    </div>
  );
}

// Widget: Minha Escala
function MyScheduleWidget({ entries, loading }: { entries: ScheduleEntry[]; loading: boolean }) {
  if (loading) return <WidgetCard title="Minha Escala" icon={Clock} color="#8b5cf6"><LoadingPlaceholder /></WidgetCard>;

  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const entryMap = new Map(entries.map(e => [e.day_date, e]));

  const entryTypeLabels: Record<string, string> = {
    shift: 'Turno', folga: 'FOLGA', compensa: 'COMPENSA', meia_dobra: 'MEIA DOBRA',
    transfer: 'Outra UH', curso: 'CURSO', inss: 'INSS', ferias: 'FÉRIAS',
    falta: 'FALTA', atestado: 'ATESTADO',
  };

  const entryTypeColors: Record<string, string> = {
    shift: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    folga: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    ferias: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    falta: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    atestado: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    compensa: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    meia_dobra: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    curso: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    inss: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
    transfer: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  };

  return (
    <WidgetCard title="Minha Escala" icon={Clock} href="/portal/my-schedule" color="#8b5cf6">
      <div className="space-y-1.5">
        {days.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const entry = entryMap.get(dateStr);
          const isCurrentDay = isToday(day);

          return (
            <div
              key={dateStr}
              className={`flex items-center justify-between py-1.5 px-2 rounded-lg text-sm ${
                isCurrentDay ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800' : ''
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-xs font-medium w-10 flex-shrink-0 ${isCurrentDay ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {format(day, 'EEEEEE', { locale: ptBR }).toUpperCase()}
                </span>
                <span className="text-gray-600 dark:text-gray-300 text-xs flex-shrink-0">
                  {format(day, 'dd/MM')}
                </span>
              </div>
              {entry ? (
                <div className="flex items-center gap-1.5">
                  {entry.entry_type === 'shift' && entry.shift_start && entry.shift_end ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${entryTypeColors.shift}`}>
                      {entry.shift_start.slice(0, 5)} — {entry.shift_end.slice(0, 5)}
                    </span>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${entryTypeColors[entry.entry_type] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                      {entry.custom_label || entryTypeLabels[entry.entry_type] || entry.entry_type}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
              )}
            </div>
          );
        })}
      </div>
    </WidgetCard>
  );
}

// Widget: Aniversariantes
function BirthdaysWidget({ employees, loading }: { employees: Employee[]; loading: boolean }) {
  if (loading) return <WidgetCard title="Aniversariantes" icon={Gift} color="#ec4899"><LoadingPlaceholder /></WidgetCard>;

  const now = new Date();
  const currentMonth = now.getMonth(); // 0-11
  const monthBirthdays = employees
    .filter(e => e.birth_date && parseISO(e.birth_date).getMonth() === currentMonth)
    .sort((a, b) => {
      const dayA = parseISO(a.birth_date!).getDate();
      const dayB = parseISO(b.birth_date!).getDate();
      return dayA - dayB;
    });

  return (
    <WidgetCard title="Aniversariantes do Mês" icon={Gift} color="#ec4899">
      {monthBirthdays.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum aniversariante este mês</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {monthBirthdays.map(emp => {
            const bday = parseISO(emp.birth_date!);
            const isTodayBday = bday.getDate() === now.getDate();
            return (
              <div key={emp.id} className={`flex items-center gap-2 py-1 px-2 rounded-lg ${isTodayBday ? 'bg-pink-50 dark:bg-pink-900/20' : ''}`}>
                {isTodayBday && <PartyPopper className="w-4 h-4 text-pink-500 flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{emp.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{emp.sector} · {format(bday, "dd 'de' MMMM", { locale: ptBR })}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

// Widget: Próximos Eventos
function EventsWidget({ events, loading }: { events: EventItem[]; loading: boolean }) {
  if (loading) return <WidgetCard title="Próximos Eventos" icon={Calendar} color="#6366f1"><LoadingPlaceholder /></WidgetCard>;

  return (
    <WidgetCard title="Próximos Eventos" icon={Calendar} href="/portal/events" color="#6366f1">
      {events.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum evento próximo</p>
      ) : (
        <div className="space-y-2">
          {events.slice(0, 5).map(ev => (
            <div key={ev.id} className="flex items-start gap-2 py-1">
              <div
                className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                style={{ backgroundColor: ev.event_types?.color || '#6366f1' }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                  {ev.title}
                  {ev.is_mandatory && <span className="ml-1 text-xs text-red-500">*</span>}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {format(parseISO(ev.event_date), "dd/MM '('EEE')'", { locale: ptBR })}
                  {ev.event_time && ` às ${ev.event_time.slice(0, 5)}`}
                  {ev.location && ` · ${ev.location}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

// Widget: Mensagem Motivacional
function MotivationalWidget({ messages, loading }: { messages: MotivationalMessage[]; loading: boolean }) {
  if (loading) return <WidgetCard title="Inspiração" icon={Sparkles} color="#f59e0b"><LoadingPlaceholder /></WidgetCard>;

  // Rotação diária baseada no dia do ano
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const message = messages.length > 0 ? messages[dayOfYear % messages.length] : null;

  return (
    <WidgetCard title="Inspiração do Dia" icon={Sparkles} color="#f59e0b">
      {message ? (
        <div className="text-center py-2">
          <p className="text-sm italic text-gray-700 dark:text-gray-200 leading-relaxed">"{message.message}"</p>
          {message.author && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">— {message.author}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">Nenhuma mensagem configurada</p>
      )}
    </WidgetCard>
  );
}

// Widget: Meus Documentos (últimos uniformes)
function DocumentsWidget({ deliveries, loading }: { deliveries: UniformDelivery[]; loading: boolean }) {
  if (loading) return <WidgetCard title="Meus Documentos" icon={FileText} color="#10b981"><LoadingPlaceholder /></WidgetCard>;

  return (
    <WidgetCard title="Últimas Entregas" icon={Shirt} href="/portal/my-documents" color="#10b981">
      {deliveries.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma entrega registrada</p>
      ) : (
        <div className="space-y-2">
          {deliveries.slice(0, 3).map(d => (
            <div key={d.id} className="flex items-center justify-between py-1">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800 dark:text-white">
                  {d.items.map(i => i.item).join(', ')}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {format(parseISO(d.delivery_date), 'dd/MM/yyyy')}
                </p>
              </div>
              <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">
                {d.items.reduce((s, i) => s + i.qty, 0)} itens
              </span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function LoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function EmployeePortal() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();
  const { roleName } = usePermissions();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntry[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [messages, setMessages] = useState<MotivationalMessage[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [deliveries, setDeliveries] = useState<UniformDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id || !selectedHotel?.id) return;
    loadPortalData();
  }, [user?.id, selectedHotel?.id]);

  async function loadPortalData() {
    setLoading(true);
    try {
      await Promise.all([
        loadEmployee(),
        loadEmployees(),
        loadMessages(),
        loadEvents(),
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployee() {
    if (!user?.id || !selectedHotel?.id) return;

    // Find employee linked to current user
    const { data: emp } = await supabase
      .from('employees')
      .select('*')
      .eq('hotel_id', selectedHotel.id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (emp) {
      setEmployee(emp);
      // Load schedule for this week
      const today = new Date();
      const weekStart = startOfWeek(today, { weekStartsOn: 0 });
      const weekEnd = endOfWeek(today, { weekStartsOn: 0 });

      const { data: schedules } = await supabase
        .from('schedules')
        .select('id')
        .eq('hotel_id', selectedHotel.id)
        .eq('week_start', format(weekStart, 'yyyy-MM-dd'))
        .maybeSingle();

      if (schedules) {
        const { data: entries } = await supabase
          .from('schedule_entries')
          .select('id, day_date, entry_type, shift_start, shift_end, custom_label')
          .eq('schedule_id', schedules.id)
          .eq('employee_id', emp.id)
          .gte('day_date', format(weekStart, 'yyyy-MM-dd'))
          .lte('day_date', format(weekEnd, 'yyyy-MM-dd'))
          .order('day_date');

        setScheduleEntries(entries || []);
      }

      // Load uniform deliveries
      const { data: uniformData } = await supabase
        .from('uniform_deliveries')
        .select('id, delivery_date, items')
        .eq('employee_id', emp.id)
        .order('delivery_date', { ascending: false })
        .limit(5);

      setDeliveries(uniformData || []);
    }
  }

  async function loadEmployees() {
    if (!selectedHotel?.id) return;
    const { data } = await supabase
      .from('employees')
      .select('id, name, role, sector, birth_date, photo_url, hotel_id')
      .eq('hotel_id', selectedHotel.id)
      .eq('status', 'active');
    setAllEmployees(data || []);
  }

  async function loadMessages() {
    const hotelId = selectedHotel?.id;
    const { data } = await supabase
      .from('motivational_messages')
      .select('id, message, author')
      .eq('is_active', true)
      .or(hotelId ? `hotel_id.eq.${hotelId},hotel_id.is.null` : 'hotel_id.is.null');
    setMessages(data || []);
  }

  async function loadEvents() {
    if (!selectedHotel?.id) return;
    const now = new Date();
    const nowISO = now.toISOString();
    const { data } = await supabase
      .from('events')
      .select('id, title, event_date, event_time, location, is_mandatory, event_type_id, event_types(name, color)')
      .or(`hotel_id.eq.${selectedHotel.id},hotel_id.is.null`)
      .gte('event_date', format(now, 'yyyy-MM-dd'))
      .or(`visibility_start.is.null,visibility_start.lte.${nowISO}`)
      .or(`visibility_end.is.null,visibility_end.gte.${nowISO}`)
      .order('event_date')
      .limit(10);
    setEvents((data as any[]) || []);
  }

  // Greeting
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }, []);

  const displayName = employee?.name || user?.email?.split('@')[0] || 'Colaborador';
  const firstName = displayName.split(' ')[0];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {greeting}, {firstName}! 👋
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
          {employee && ` · ${employee.role} — ${employee.sector}`}
          {selectedHotel && ` · ${selectedHotel.name}`}
        </p>
      </div>

      {/* Widget Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MyScheduleWidget entries={scheduleEntries} loading={loading} />
        <EventsWidget events={events} loading={loading} />
        <MotivationalWidget messages={messages} loading={loading} />
        <BirthdaysWidget employees={allEmployees} loading={loading} />
        <DocumentsWidget deliveries={deliveries} loading={loading} />
      </div>
    </div>
  );
}
