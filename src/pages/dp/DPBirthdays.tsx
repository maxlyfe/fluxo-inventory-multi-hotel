// src/pages/dp/DPBirthdays.tsx
// Lista de aniversariantes por mês — navega entre meses, mostra todos os colaboradores ativos

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import {
  ChevronLeft, ChevronRight, Cake, User, Building2,
  Phone, Mail, Loader2, PartyPopper, CalendarHeart,
} from 'lucide-react';
import { format, differenceInYears } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ── Tipos ────────────────────────────────────────────────────────────────────
interface Employee {
  id: string;
  name: string;           // coluna real: employees.name
  role: string;
  sector: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  hotel_id: string;
  hotel?: { name: string };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → Date LOCAL (sem conversão UTC — evita bug de -1 dia) */
const parseLocalDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Iniciais para avatar */
const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/** Cor do avatar baseada no nome (determinística) */
const AVATAR_COLORS = [
  'bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500',
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-teal-500',
];
const avatarColor = (name: string) =>
  AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

/** Verifica se hoje é o aniversário (ignora ano) */
const isBirthdayToday = (birthDate: string): boolean => {
  const today = new Date();
  const d = parseLocalDate(birthDate);
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
};

const MONTHS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

// ─────────────────────────────────────────────────────────────────────────────
const DPBirthdays: React.FC = () => {
  const { selectedHotel } = useHotel();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  // Mês selecionado (0-11), começa no mês atual
  const [monthIdx, setMonthIdx] = useState(() => new Date().getMonth());

  // ── Buscar colaboradores ativos com data de nascimento ───────────────────
  useEffect(() => {
    const fetchEmployees = async () => {
      setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from('employees')
          .select('id, name, role, sector, phone, email, birth_date, hotel_id, hotels:hotel_id(name)')
          .eq('status', 'active')
          .not('birth_date', 'is', null)
          .order('name');

        if (selectedHotel?.id) {
          query = query.eq('hotel_id', selectedHotel.id);
        }

        const { data, error: err } = await query;
        if (err) throw err;

        // Normalizar o join hotels → hotel
        const normalized: Employee[] = (data || []).map((e: any) => ({
          ...e,
          hotel: Array.isArray(e.hotels) ? e.hotels[0] : e.hotels,
        }));

        setEmployees(normalized);
      } catch (err: any) {
        setError(err.message || 'Erro ao carregar aniversariantes.');
      } finally {
        setLoading(false);
      }
    };

    fetchEmployees();
  }, [selectedHotel]);

  // ── Filtrar pelo mês selecionado, ordenar por dia ────────────────────────
  const birthdayThisMonth = useMemo(() => {
    return employees
      .filter(e => {
        if (!e.birth_date) return false;
        return parseLocalDate(e.birth_date).getMonth() === monthIdx;
      })
      .sort((a, b) =>
        parseLocalDate(a.birth_date!).getDate() - parseLocalDate(b.birth_date!).getDate()
      );
  }, [employees, monthIdx]);

  // Aniversariantes de HOJE (independente do mês navegado)
  const todayBirthdays = useMemo(
    () => employees.filter(e => e.birth_date && isBirthdayToday(e.birth_date)),
    [employees]
  );

  const prevMonth = () => setMonthIdx(m => (m === 0 ? 11 : m - 1));
  const nextMonth = () => setMonthIdx(m => (m === 11 ? 0 : m + 1));

  // ── Estados de loading / erro ────────────────────────────────────────────
  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-gray-400">
      <Loader2 className="w-10 h-10 animate-spin" />
      <p className="text-sm">Carregando aniversariantes...</p>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-2 text-red-400">
      <p className="font-semibold">Erro ao carregar dados</p>
      <p className="text-sm">{error}</p>
    </div>
  );

  return (
    <div className="space-y-6">

      {/* ── Banner de aniversariantes de HOJE ─────────────────────────────── */}
      {todayBirthdays.length > 0 && (
        <div className="rounded-2xl bg-gradient-to-r from-pink-500 to-purple-600 p-5 text-white shadow-lg">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <PartyPopper className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg leading-none">Parabéns hoje! 🎂</h2>
              <p className="text-white/70 text-sm mt-0.5">
                {todayBirthdays.length === 1
                  ? '1 colaborador faz aniversário hoje'
                  : `${todayBirthdays.length} colaboradores fazem aniversário hoje`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {todayBirthdays.map(e => (
              <div key={e.id} className="flex items-center gap-2.5 bg-white/15 rounded-xl px-3 py-2">
                <div className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center text-xs font-bold">
                  {initials(e.name)}
                </div>
                <div>
                  <p className="font-semibold text-sm leading-none">{e.name.split(' ')[0]}</p>
                  <p className="text-white/60 text-xs mt-0.5">
                    {differenceInYears(new Date(), parseLocalDate(e.birth_date!))} anos hoje
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Navegação de meses ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
        <button
          onClick={prevMonth}
          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>

        <div className="text-center">
          <div className="flex items-center gap-2 justify-center">
            <CalendarHeart className="w-5 h-5 text-pink-500" />
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">
              {MONTHS[monthIdx]}
            </h2>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {birthdayThisMonth.length === 0
              ? 'Nenhum aniversariante'
              : birthdayThisMonth.length === 1
              ? '1 aniversariante'
              : `${birthdayThisMonth.length} aniversariantes`}
          </p>
        </div>

        <button
          onClick={nextMonth}
          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* ── Mini-calendário (scroll horizontal) ──────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {MONTHS.map((monthName, idx) => {
          const count = employees.filter(e =>
            e.birth_date && parseLocalDate(e.birth_date).getMonth() === idx
          ).length;
          const isActive  = idx === monthIdx;
          const isCurrent = idx === new Date().getMonth();
          return (
            <button
              key={idx}
              onClick={() => setMonthIdx(idx)}
              className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                isActive
                  ? 'bg-pink-500 text-white border-pink-500 shadow-md'
                  : isCurrent
                  ? 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400 border-pink-200 dark:border-pink-800'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-100 dark:border-gray-700 hover:border-pink-300'
              }`}
            >
              <span>{monthName.slice(0, 3)}</span>
              {count > 0 && (
                <span className={`mt-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  isActive
                    ? 'bg-white/30 text-white'
                    : 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Lista de aniversariantes do mês ───────────────────────────────── */}
      {birthdayThisMonth.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
          <Cake className="w-12 h-12 opacity-30" />
          <p className="text-sm font-medium">Nenhum aniversariante em {MONTHS[monthIdx]}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {birthdayThisMonth.map(emp => {
            const bd      = parseLocalDate(emp.birth_date!);
            const day     = bd.getDate();
            const age     = differenceInYears(new Date(), bd);
            const isToday = isBirthdayToday(emp.birth_date!);

            return (
              <div
                key={emp.id}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                  isToday
                    ? 'bg-gradient-to-r from-pink-50 to-purple-50 dark:from-pink-900/20 dark:to-purple-900/20 border-pink-200 dark:border-pink-800 shadow-sm'
                    : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'
                }`}
              >
                {/* Bloco do dia */}
                <div className={`flex-shrink-0 w-14 h-14 rounded-2xl flex flex-col items-center justify-center font-bold shadow-sm ${
                  isToday
                    ? 'bg-gradient-to-br from-pink-500 to-purple-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                }`}>
                  <span className="text-xl leading-none">{String(day).padStart(2, '0')}</span>
                  <span className="text-[10px] uppercase tracking-wider opacity-70 mt-0.5">
                    {MONTHS[monthIdx].slice(0, 3)}
                  </span>
                </div>

                {/* Avatar + Informações */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${avatarColor(emp.name)}`}>
                    {initials(emp.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{emp.name}</p>
                      {isToday && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pink-500 text-white text-[10px] font-bold">
                          🎂 Hoje!
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {emp.role} · {emp.sector}
                      </span>
                      {emp.hotel?.name && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {emp.hotel.name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {age} anos — {format(bd, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                    </p>
                  </div>
                </div>

                {/* Contatos (visível em telas maiores) */}
                <div className="hidden sm:flex flex-col gap-1.5 flex-shrink-0">
                  {emp.phone && (
                    <a href={`tel:${emp.phone}`}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors">
                      <Phone className="w-3.5 h-3.5" />
                      {emp.phone}
                    </a>
                  )}
                  {emp.email && (
                    <a href={`mailto:${emp.email}`}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors truncate max-w-[200px]">
                      <Mail className="w-3.5 h-3.5" />
                      {emp.email}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DPBirthdays;