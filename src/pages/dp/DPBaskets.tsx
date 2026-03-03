// src/pages/dp/DPBaskets.tsx
// Lista automatizada de cestas básicas mensais com regras de elegibilidade,
// impressão e exportação para o fornecedor.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import {
  Package, ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Loader2, Printer, User, Calendar, AlertCircle, Info,
  Building2,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, parseISO, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → Date LOCAL (sem fuso) */
const parseLocalDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const MONTHS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

// ── Tipos ────────────────────────────────────────────────────────────────────
interface Employee {
  id: string;
  name: string;
  role: string;
  sector: string;
  hotel_id: string;
  admission_date: string;
  status: string;
  hotel?: { name: string };
}

interface ScheduleEntry {
  employee_id: string;
  day_date: string;   // YYYY-MM-DD
  entry_type: string; // falta | atestado | shift | folga | etc.
}

interface EligibilityResult {
  employee: Employee;
  eligible: boolean;
  reasons: string[];        // motivos de recusa
  faltas: string[];         // datas de falta
  atestados: string[];      // datas de atestado
  admissionOk: boolean;     // cumpriu 1 mês completo
}

// ── Regras de elegibilidade ───────────────────────────────────────────────────
// Referência: mês de ANÁLISE é o mês anterior ao mês de entrega.
// Ex.: entrega em março → analisa fevereiro.
// O colaborador precisa:
//   1. Ter admission_date <= 1º dia do mês de análise (trabalhou o mês completo)
//   2. Zero faltas no mês de análise
//   3. ≤ 3 dias de atestado no mês de análise
// ─────────────────────────────────────────────────────────────────────────────

function calcEligibility(
  employee: Employee,
  entries: ScheduleEntry[],
  analysisYear: number,
  analysisMonth: number,  // 0-indexed
): EligibilityResult {
  const reasons: string[]  = [];
  const faltas: string[]   = [];
  const atestados: string[] = [];

  const firstDay = new Date(analysisYear, analysisMonth, 1);
  const lastDay  = new Date(analysisYear, analysisMonth + 1, 0);

  // 1. Verificar se cumpriu 1 mês completo antes do período de análise
  const admDate     = parseLocalDate(employee.admission_date);
  const admissionOk = admDate <= firstDay;
  if (!admissionOk) {
    const startMonth = MONTHS[admDate.getMonth()];
    reasons.push(`Admitido em ${format(admDate, 'dd/MM/yyyy')} — primeiro mês completo começa em ${startMonth}`);
  }

  // 2. Analisar entradas da escala no período
  const periodEntries = entries.filter(e => {
    if (e.employee_id !== employee.id) return false;
    const d = parseLocalDate(e.day_date);
    return d >= firstDay && d <= lastDay;
  });

  periodEntries.forEach(e => {
    if (e.entry_type === 'falta') {
      faltas.push(e.day_date);
    } else if (e.entry_type === 'atestado') {
      atestados.push(e.day_date);
    }
  });

  if (faltas.length > 0) {
    const datas = faltas.map(d => format(parseLocalDate(d), 'dd/MM')).join(', ');
    reasons.push(`Falta${faltas.length > 1 ? 's' : ''}: dia${faltas.length > 1 ? 's' : ''} ${datas}`);
  }

  if (atestados.length > 3) {
    const datas = atestados.map(d => format(parseLocalDate(d), 'dd/MM')).join(', ');
    reasons.push(`Atestados: ${atestados.length} dias (${datas}) — limite é 3 dias`);
  }

  return {
    employee,
    eligible:     admissionOk && faltas.length === 0 && atestados.length <= 3,
    reasons,
    faltas,
    atestados,
    admissionOk,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
const DPBaskets: React.FC = () => {
  const { selectedHotel } = useHotel();

  // Mês de ENTREGA selecionado (default: próximo mês)
  const today          = new Date();
  const [deliveryYear,  setDeliveryYear]  = useState(() => today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear());
  const [deliveryMonth, setDeliveryMonth] = useState(() => (today.getMonth() + 1) % 12); // 0-indexed

  const [employees,  setEmployees]  = useState<Employee[]>([]);
  const [entries,    setEntries]    = useState<ScheduleEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [showDenied, setShowDenied] = useState(false);

  // Mês de ANÁLISE = mês anterior ao mês de entrega
  const analysisMonth = deliveryMonth === 0 ? 11 : deliveryMonth - 1;
  const analysisYear  = deliveryMonth === 0 ? deliveryYear - 1 : deliveryYear;
  const analysisStart = format(new Date(analysisYear, analysisMonth, 1), 'yyyy-MM-dd');
  const analysisEnd   = format(new Date(analysisYear, analysisMonth + 1, 0), 'yyyy-MM-dd');

  // ── Navegar entre meses ──────────────────────────────────────────────────
  const prevMonth = () => {
    if (deliveryMonth === 0) { setDeliveryMonth(11); setDeliveryYear(y => y - 1); }
    else setDeliveryMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (deliveryMonth === 11) { setDeliveryMonth(0); setDeliveryYear(y => y + 1); }
    else setDeliveryMonth(m => m + 1);
  };

  // ── Buscar dados ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true);
    setError(null);
    try {
      // Colaboradores ativos
      const { data: empData, error: empErr } = await supabase
        .from('employees')
        .select('id, name, role, sector, hotel_id, admission_date, status, hotels:hotel_id(name)')
        .eq('hotel_id', selectedHotel.id)
        .eq('status', 'active')
        .order('name');
      if (empErr) throw empErr;

      const normalized = (empData || []).map((e: any) => ({
        ...e,
        hotel: Array.isArray(e.hotels) ? e.hotels[0] : e.hotels,
      }));
      setEmployees(normalized);

      // Entradas da escala no mês de análise (faltas e atestados)
      // Busca via schedule_entries → schedules (filtro por hotel + período)
      const { data: schedData, error: schedErr } = await supabase
        .from('schedules')
        .select('id')
        .eq('hotel_id', selectedHotel.id)
        .gte('week_start', analysisStart)
        .lte('week_start', analysisEnd);
      if (schedErr) throw schedErr;

      if (schedData && schedData.length > 0) {
        const schedIds = schedData.map((s: any) => s.id);
        const { data: entData, error: entErr } = await supabase
          .from('schedule_entries')
          .select('employee_id, day_date, entry_type')
          .in('schedule_id', schedIds)
          .in('entry_type', ['falta', 'atestado'])
          .gte('day_date', analysisStart)
          .lte('day_date', analysisEnd);
        if (entErr) throw entErr;
        setEntries(entData || []);
      } else {
        setEntries([]);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados.');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, analysisStart, analysisEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Calcular elegibilidade ───────────────────────────────────────────────
  const results = useMemo<EligibilityResult[]>(() =>
    employees.map(emp => calcEligibility(emp, entries, analysisYear, analysisMonth)),
    [employees, entries, analysisYear, analysisMonth]
  );

  const eligible = results.filter(r => r.eligible);
  const denied   = results.filter(r => !r.eligible);

  // ── Imprimir lista ───────────────────────────────────────────────────────
  const handlePrint = () => {
    const hotelName  = selectedHotel?.name || '';
    const delivLabel = `${MONTHS[deliveryMonth]} ${deliveryYear}`;
    const analyLabel = `${MONTHS[analysisMonth]} ${analysisYear}`;

    const CELL = 'padding:12px 14px;border:1px solid #d1d5db;font-size:13px;vertical-align:middle;';
    const rows = eligible.map((r, i) => `
      <tr style="height:52px;">
        <td style="${CELL}text-align:center;width:36px;color:#9ca3af;">${i + 1}</td>
        <td style="${CELL}font-weight:600;min-width:220px;">${r.employee.name}</td>
        <td style="${CELL}color:#374151;min-width:120px;">${r.employee.sector}</td>
        <td style="${CELL}width:210px;">&nbsp;</td>
        <td style="${CELL}width:110px;">&nbsp;</td>
      </tr>`).join('');

    const html = `
      <!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <title>Lista de Cestas — ${delivLabel}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 28px; color: #111; }
        h1  { font-size: 18px; margin: 0 0 4px; }
        .sub { font-size: 13px; color: #6b7280; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th  { background: #f3f4f6; padding: 10px 14px; text-align: left;
              font-size: 11px; text-transform: uppercase; letter-spacing: .6px;
              color: #6b7280; border: 1px solid #d1d5db; }
        tr:nth-child(even) td { background: #f9fafb; }
        @media print { body { padding: 16px; } .no-print { display: none; } }
      </style>
      </head><body>
      <h1>Lista de Cestas Básicas — ${delivLabel}</h1>
      <p class="sub">
        ${hotelName} &nbsp;&middot;&nbsp; Refer&ecirc;ncia: ${analyLabel}
        &nbsp;&middot;&nbsp; Total: <strong>${eligible.length} cestas</strong>
        &nbsp;&middot;&nbsp; Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}
      </p>
      <button class="no-print" onclick="window.print()"
        style="margin-bottom:18px;padding:9px 20px;background:#059669;color:white;
               border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
        Imprimir
      </button>
      <table>
        <thead><tr>
          <th style="width:36px;">#</th>
          <th>Nome Completo</th>
          <th>Setor</th>
          <th>Assinatura</th>
          <th>Data Retirada</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-gray-400">
      <Loader2 className="w-10 h-10 animate-spin" />
      <p className="text-sm">Calculando elegibilidade...</p>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-2 text-red-400">
      <AlertCircle className="w-8 h-8" />
      <p className="font-semibold">Erro ao carregar dados</p>
      <p className="text-sm">{error}</p>
    </div>
  );

  return (
    <div className="space-y-6">

      {/* ── Info da regra ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-800 dark:text-emerald-300">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>
          A cesta é gerada para colaboradores que <strong>trabalharam o mês completo anterior</strong>, 
          sem faltas e com no máximo 3 dias de atestado. 
          Selecione o <strong>mês de entrega</strong> e o sistema analisa automaticamente o mês anterior.
        </p>
      </div>

      {/* ── Seletor de mês de entrega ─────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
        <button onClick={prevMonth} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div className="text-center">
          <div className="flex items-center gap-2 justify-center">
            <Package className="w-5 h-5 text-emerald-500" />
            <div>
              <p className="text-xs text-gray-400">Entrega em</p>
              <h2 className="text-lg font-bold text-gray-800 dark:text-white leading-none">
                {MONTHS[deliveryMonth]} {deliveryYear}
              </h2>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Referência: <span className="font-semibold text-gray-600 dark:text-gray-300">{MONTHS[analysisMonth]} {analysisYear}</span>
          </p>
        </div>
        <button onClick={nextMonth} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <ChevronRight className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* ── Resumo + botão imprimir ───────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-3">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{eligible.length} recebem</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-bold text-red-600 dark:text-red-400">{denied.length} não recebem</span>
          </div>
        </div>
        {eligible.length > 0 && (
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 active:scale-95 transition-all shadow-sm"
          >
            <Printer className="w-4 h-4" />
            Imprimir lista
          </button>
        )}
      </div>

      {/* ── Lista: RECEBEM ────────────────────────────────────────────────── */}
      {eligible.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4" />
            Recebem cesta em {MONTHS[deliveryMonth]}
          </h3>
          <div className="space-y-2">
            {eligible.map((r, i) => (
              <div key={r.employee.id}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                <span className="text-xs font-bold text-gray-300 dark:text-gray-600 w-6 text-center flex-shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{r.employee.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{r.employee.role} · {r.employee.sector}</p>
                </div>
                {r.atestados.length > 0 && (
                  <span className="text-xs text-orange-500 dark:text-orange-400 flex items-center gap-1 flex-shrink-0">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {r.atestados.length}d atestado
                  </span>
                )}
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {eligible.length === 0 && !loading && (
        <div className="flex flex-col items-center py-12 text-gray-400 gap-3">
          <Package className="w-12 h-12 opacity-30" />
          <p className="text-sm font-medium">Nenhum colaborador elegível em {MONTHS[deliveryMonth]}</p>
        </div>
      )}

      {/* ── Lista: NÃO RECEBEM ────────────────────────────────────────────── */}
      {denied.length > 0 && (
        <div>
          <button
            onClick={() => setShowDenied(v => !v)}
            className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400 mb-3 hover:underline"
          >
            <XCircle className="w-4 h-4" />
            {showDenied ? 'Ocultar' : 'Ver'} quem não recebe ({denied.length})
          </button>

          {showDenied && (
            <div className="space-y-2">
              {denied.map(r => (
                <div key={r.employee.id}
                  className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900/40">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-red-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{r.employee.name}</p>
                      <p className="text-xs text-gray-400">{r.employee.role} · {r.employee.sector}</p>
                    </div>
                    <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  </div>
                  <ul className="ml-12 space-y-1">
                    {r.reasons.map((reason, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
                        <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DPBaskets;