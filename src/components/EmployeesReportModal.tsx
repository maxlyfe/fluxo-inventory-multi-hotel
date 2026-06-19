// src/components/EmployeesReportModal.tsx
// Relatório de colaboradores da unidade — escolhe status (Ativos/Inativos/
// Desligados), quais campos exibir, e gera um documento HTML organizado por
// SETOR. Abre em janela nova com window.print() (vira PDF pela impressora).

import React, { useMemo, useState } from 'react';
import { X, FileText, Loader2, Check } from 'lucide-react';

// ── Campos selecionáveis ────────────────────────────────────────────────────
export interface EmployeeRow {
  id: string; name: string; sector: string; role: string; status: string;
  cpf: string | null; rg: string | null; phone: string | null; email: string | null;
  birth_date: string | null; address: string | null;
  admission_date: string; contract_type: string; experience_end: string | null;
  shirt_size: string | null; pants_size: string | null; shoe_size: string | null;
  hat_size: string | null; apron_size: string | null; raincoat_size: string | null;
  epi_items?: string[]; notes: string | null;
}

const ALL_FIELDS: { key: keyof EmployeeRow | 'experience'; label: string; group: string }[] = [
  { key: 'role',           label: 'Cargo',           group: 'Identificação' },
  { key: 'cpf',            label: 'CPF',             group: 'Identificação' },
  { key: 'rg',             label: 'RG',              group: 'Identificação' },
  { key: 'birth_date',     label: 'Nascimento',      group: 'Identificação' },
  { key: 'phone',          label: 'Telefone',        group: 'Contato' },
  { key: 'email',          label: 'E-mail',          group: 'Contato' },
  { key: 'address',        label: 'Endereço',        group: 'Contato' },
  { key: 'admission_date', label: 'Admissão',        group: 'Contrato' },
  { key: 'contract_type',  label: 'Tipo contrato',   group: 'Contrato' },
  { key: 'experience',     label: 'Fim experiência', group: 'Contrato' },
  { key: 'shirt_size',     label: 'Camisa',          group: 'Uniforme' },
  { key: 'pants_size',     label: 'Calça',           group: 'Uniforme' },
  { key: 'shoe_size',      label: 'Calçado',         group: 'Uniforme' },
  { key: 'hat_size',       label: 'Touca',           group: 'Uniforme' },
  { key: 'apron_size',     label: 'Avental',         group: 'Uniforme' },
  { key: 'raincoat_size',  label: 'Capa de chuva',   group: 'Uniforme' },
  { key: 'epi_items',      label: 'EPIs',            group: 'Uniforme' },
  { key: 'notes',          label: 'Observações',     group: 'Outros' },
];

const STATUS_LABELS: Record<string, string> = { active: 'Ativo', inactive: 'Inativo', dismissed: 'Desligado' };
const CONTRACT_LABELS: Record<string, string> = {
  experiencia: 'Experiência', determinado: 'Determinado', clt: 'CLT',
  pj: 'PJ', estagio: 'Estágio', temporario: 'Temporário',
};

const formatDate = (s: string | null): string => {
  if (!s) return '—';
  const d = new Date(s + 'T12:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
};

// Cálculo de fim de experiência (aproximação: 90 dias após admissão).
const expEnd = (e: EmployeeRow): string => {
  if (e.contract_type !== 'experiencia' || !e.admission_date) return '—';
  if (e.experience_end) return formatDate(e.experience_end);
  const d = new Date(e.admission_date + 'T12:00:00');
  d.setDate(d.getDate() + 90);
  return d.toLocaleDateString('pt-BR');
};

const cellValue = (e: EmployeeRow, key: typeof ALL_FIELDS[number]['key']): string => {
  if (key === 'experience')      return expEnd(e);
  if (key === 'contract_type')   return CONTRACT_LABELS[e.contract_type] || e.contract_type || '—';
  if (key === 'admission_date')  return formatDate(e.admission_date);
  if (key === 'birth_date')      return formatDate(e.birth_date);
  if (key === 'epi_items')       return (e.epi_items || []).join(', ') || '—';
  const v = (e as any)[key];
  return v == null || v === '' ? '—' : String(v);
};

// ── Componente ──────────────────────────────────────────────────────────────
interface Props {
  isOpen: boolean;
  onClose: () => void;
  employees: EmployeeRow[];
  hotelName: string;
}

export default function EmployeesReportModal({ isOpen, onClose, employees, hotelName }: Props) {
  // Status default: o que está na tela hoje (Ativos)
  const [statuses, setStatuses] = useState<Set<string>>(new Set(['active']));
  const [fields, setFields]     = useState<Set<string>>(new Set(['role', 'cpf', 'phone', 'admission_date']));
  // Setores: por padrão TODOS selecionados (re-sincroniza quando a lista muda)
  const allSectors = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => set.add((e.sector && e.sector.trim()) || 'Sem setor'));
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [employees]);
  const [sectorsSel, setSectorsSel] = useState<Set<string>>(new Set());
  React.useEffect(() => { setSectorsSel(new Set(allSectors)); }, [allSectors]);
  const [generating, setGenerating] = useState(false);

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void) => (k: string) => {
    const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setSet(n);
  };

  const filtered = useMemo(
    () => employees.filter(e => statuses.has(e.status) && sectorsSel.has((e.sector && e.sector.trim()) || 'Sem setor')),
    [employees, statuses, sectorsSel],
  );
  const fieldsByGroup = useMemo(() => {
    const groups: Record<string, typeof ALL_FIELDS> = {};
    ALL_FIELDS.forEach(f => { (groups[f.group] = groups[f.group] || []).push(f); });
    return groups;
  }, []);

  // Conta por status para o cabeçalho da listagem do modal
  const counts = useMemo(() => ({
    active:    employees.filter(e => e.status === 'active').length,
    inactive:  employees.filter(e => e.status === 'inactive').length,
    dismissed: employees.filter(e => e.status === 'dismissed').length,
  }), [employees]);

  const generate = () => {
    setGenerating(true);
    try {
      const selectedFields = ALL_FIELDS.filter(f => fields.has(f.key as string));
      // Agrupa por setor (ordem alfabética por setor; nome dentro)
      const bySector = new Map<string, EmployeeRow[]>();
      filtered.forEach(e => {
        const s = (e.sector && e.sector.trim()) || 'Sem setor';
        const arr = bySector.get(s);
        if (arr) arr.push(e);
        else bySector.set(s, [e]);
      });
      const sectors = [...bySector.entries()]
        .map(([s, list]) => [s, [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))] as const)
        .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));

      const statusLabels = [...statuses].map(s => STATUS_LABELS[s] || s).join(' · ');
      const issuedAt = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

      const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

      // Decisões de layout conforme nº de campos selecionados:
      //  ≤4 campos → A4 RETRATO; >4 → A4 PAISAGEM. Mantém leitura confortável.
      const totalCols = 1 /* nome */ + selectedFields.length + 1 /* status */;
      const orientation = selectedFields.length > 4 ? 'landscape' : 'portrait';
      // Fonte ligeiramente menor quando há muitas colunas.
      const baseFontPt = totalCols >= 8 ? 9 : totalCols >= 6 ? 9.5 : 10.5;
      // Largura proporcional: Nome 18% · Status 9% · restante distribuído entre os campos.
      const fieldWidthPct = ((100 - 18 - 9) / Math.max(selectedFields.length, 1)).toFixed(2);

      const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Relatório de Colaboradores — ${esc(hotelName)}</title>
<style>
  /* Folha A4 com margens generosas (NÃO corta nada) */
  @page { size: A4 ${orientation}; margin: 16mm 14mm 18mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
    color: #1f2937;
    font-size: ${baseFontPt}pt;
    line-height: 1.45;
    background: #fff;
  }

  /* Container: limita à área útil da folha — evita rolagem/overflow horizontal */
  .page { width: 100%; max-width: 100%; overflow: hidden; }

  /* ────────────────  CABEÇALHO INSTITUCIONAL  ──────────────── */
  .doc-header {
    border-bottom: 2px solid #0f172a;
    padding-bottom: 10px;
    margin-bottom: 16px;
  }
  .doc-header .row {
    display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
  }
  .brand .name { font-size: 18pt; font-weight: 800; letter-spacing: -0.01em; color: #0f172a; line-height: 1; }
  .brand .sub  { font-size: 9pt; color: #6b7280; letter-spacing: 0.18em; text-transform: uppercase; margin-top: 4px; }
  .brand .hotel { font-size: 10.5pt; color: #334155; margin-top: 8px; font-weight: 600; }
  .meta { text-align: right; font-size: 8.5pt; color: #475569; line-height: 1.5; }
  .meta .row2 { display: inline-block; }
  .meta strong { color: #0f172a; font-weight: 700; }

  /* ────────────────  RESUMO  ──────────────── */
  .summary {
    display: flex; flex-wrap: wrap; gap: 6px;
    margin: 0 0 14px;
  }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: #f8fafc; border: 1px solid #e5e7eb;
    border-radius: 999px; padding: 3px 10px;
    font-size: 8.5pt; color: #334155;
  }
  .chip .dot { width: 7px; height: 7px; border-radius: 999px; }
  .dot.active    { background: #16a34a; }
  .dot.inactive  { background: #94a3b8; }
  .dot.dismissed { background: #dc2626; }
  .chip strong { color: #0f172a; }

  /* ────────────────  SETOR  ──────────────── */
  .sector-block { margin-bottom: 14px; }
  h2.sector {
    margin: 0 0 6px;
    padding: 7px 12px;
    background: #0f172a; color: #fff;
    border-radius: 4px;
    font-size: 9pt; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase;
    display: flex; justify-content: space-between; align-items: baseline;
  }
  h2.sector .count { font-weight: 500; opacity: 0.7; font-size: 8.5pt; letter-spacing: 0.04em; }

  /* ────────────────  TABELA  ──────────────── */
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;       /* evita estouro */
  }
  thead th {
    background: #f3f4f6;
    font-weight: 700;
    font-size: 7.5pt;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 6px;
    text-align: left;
    border-bottom: 1.5px solid #d1d5db;
  }
  tbody td {
    padding: 5.5px 6px;
    border-bottom: 0.75px solid #e5e7eb;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    hyphens: auto;
  }
  tbody tr:nth-child(even) td { background: #fafafa; }
  td.name { font-weight: 600; color: #0f172a; }
  .status-badge {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 3px;
    font-size: 7.5pt;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .badge-active    { background: #dcfce7; color: #14532d; }
  .badge-inactive  { background: #e5e7eb; color: #374151; }
  .badge-dismissed { background: #fee2e2; color: #7f1d1d; }

  /* ────────────────  RODAPÉ  ──────────────── */
  .doc-footer {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    color: #6b7280;
    font-size: 8pt;
    display: flex; justify-content: space-between;
  }
  .empty {
    text-align: center; color: #9ca3af; padding: 40px;
    font-style: italic; border: 1px dashed #d1d5db; border-radius: 8px;
  }

  /* ────────────────  IMPRESSÃO  ──────────────── */
  @media print {
    .no-print { display: none !important; }
    .sector-block { page-break-inside: auto; break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    h2.sector { break-after: avoid; page-break-after: avoid; }
  }

  /* ────────────────  BARRA DE AÇÕES (não imprime)  ──────────────── */
  .actions {
    position: fixed; top: 14px; right: 14px;
    display: flex; gap: 8px; z-index: 1000;
  }
  .actions button {
    border: 0; border-radius: 8px;
    padding: 9px 16px;
    font: 700 10pt 'Segoe UI', sans-serif;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(15, 23, 42, .15);
  }
  .actions button.primary { background: #4f46e5; color: #fff; }
  .actions button.primary:hover { background: #4338ca; }
  .actions button.secondary { background: #fff; color: #0f172a; border: 1px solid #e5e7eb; }
  .actions button.secondary:hover { background: #f3f4f6; }
</style></head>
<body>
  <div class="actions no-print">
    <button class="primary" onclick="window.print()">Imprimir / PDF</button>
    <button class="secondary" onclick="window.close()">Fechar</button>
  </div>

  <div class="page">
    <header class="doc-header">
      <div class="row">
        <div class="brand">
          <div class="name">Relatório de Colaboradores</div>
          <div class="sub">Departamento Pessoal</div>
          <div class="hotel">${esc(hotelName)}</div>
        </div>
        <div class="meta">
          <div><strong>Emitido em:</strong> ${esc(issuedAt)}</div>
          <div><strong>Status:</strong> ${esc(statusLabels || '—')}</div>
          <div><strong>Total:</strong> ${filtered.length} colaborador(es) · ${sectors.length} setor(es)</div>
        </div>
      </div>
    </header>

    <div class="summary">
      ${[...statuses].map(s => `<span class="chip"><span class="dot ${esc(s)}"></span><strong>${esc(STATUS_LABELS[s] || s)}:</strong> ${filtered.filter(e => e.status === s).length}</span>`).join('')}
    </div>

    ${filtered.length === 0
      ? `<div class="empty">Nenhum colaborador encontrado para os filtros selecionados.</div>`
      : sectors.map(([sector, list]) => `
        <section class="sector-block">
          <h2 class="sector"><span>${esc(sector)}</span><span class="count">${list.length} colaborador(es)</span></h2>
          <table>
            <colgroup>
              <col style="width: 18%" />
              ${selectedFields.map(() => `<col style="width: ${fieldWidthPct}%" />`).join('')}
              <col style="width: 9%" />
            </colgroup>
            <thead><tr>
              <th>Nome</th>
              ${selectedFields.map(f => `<th>${esc(f.label)}</th>`).join('')}
              <th>Status</th>
            </tr></thead>
            <tbody>
              ${list.map(e => `<tr>
                <td class="name">${esc(e.name)}</td>
                ${selectedFields.map(f => `<td>${esc(cellValue(e, f.key))}</td>`).join('')}
                <td><span class="status-badge badge-${esc(e.status)}">${esc(STATUS_LABELS[e.status] || e.status)}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </section>
      `).join('')}

    <footer class="doc-footer">
      <span><strong>LyFe Hoteles</strong> · Departamento Pessoal</span>
      <span>Documento gerado automaticamente — ${esc(issuedAt)}</span>
    </footer>
  </div>
  <script>setTimeout(() => { try { window.focus(); } catch(_){} }, 100);</script>
</body></html>`;

      // Usa Blob URL + link disparado por gesto do usuário → não cai no bloqueio
      // de pop-up de navegadores agressivos. Se o navegador AINDA assim bloquear,
      // o relatório abre num iframe inline (fallback dentro do próprio modal).
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); a.remove();
      // Solta a URL depois — alguns navegadores precisam de tempo
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <FileText className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" style={{ width: 18, height: 18 }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Relatório de Colaboradores</h2>
              <p className="text-xs text-gray-400">{hotelName} · organizado por setor</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Status */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Incluir colaboradores</p>
            <div className="grid grid-cols-3 gap-2">
              {(['active', 'inactive', 'dismissed'] as const).map(s => {
                const on = statuses.has(s);
                return (
                  <button key={s} onClick={() => toggle(statuses, setStatuses)(s)}
                    className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-colors ${
                      on
                        ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300'
                    }`}>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-200">
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${on ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 dark:border-gray-600'}`}>
                        {on && <Check className="w-2.5 h-2.5 text-white" />}
                      </span>
                      {STATUS_LABELS[s]}
                    </span>
                    <span className="text-[11px] text-gray-400">{counts[s]} {counts[s] === 1 ? 'pessoa' : 'pessoas'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Setores */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Setores incluídos</p>
              <div className="flex gap-2">
                <button onClick={() => setSectorsSel(new Set(allSectors))}
                  className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Todos</button>
                <button onClick={() => setSectorsSel(new Set())}
                  className="text-[11px] font-semibold text-gray-400 hover:underline">Nenhum</button>
              </div>
            </div>
            {allSectors.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Sem setores cadastrados.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allSectors.map(s => {
                  const on = sectorsSel.has(s);
                  const count = employees.filter(e => ((e.sector && e.sector.trim()) || 'Sem setor') === s).length;
                  return (
                    <button key={s} onClick={() => toggle(sectorsSel, setSectorsSel)(s)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        on
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-gray-50 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-indigo-300'
                      }`}>
                      {on && <Check className="w-3 h-3" />}{s}
                      <span className={`text-[10px] ${on ? 'text-white/70' : 'text-gray-400'}`}>·{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Campos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Campos exibidos no relatório</p>
              <div className="flex gap-2">
                <button onClick={() => setFields(new Set(ALL_FIELDS.map(f => f.key as string)))}
                  className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Todos</button>
                <button onClick={() => setFields(new Set())}
                  className="text-[11px] font-semibold text-gray-400 hover:underline">Nenhum</button>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(fieldsByGroup).map(([group, list]) => (
                <div key={group}>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{group}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map(f => {
                      const on = fields.has(f.key as string);
                      return (
                        <button key={f.key as string} onClick={() => toggle(fields, setFields)(f.key as string)}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            on
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-gray-50 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-indigo-300'
                          }`}>
                          {on && <Check className="w-3 h-3" />}{f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-3">Nome, setor e status são incluídos automaticamente.</p>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
            {filtered.length} colaborador(es) em {new Set(filtered.map(e => (e.sector && e.sector.trim()) || 'Sem setor')).size} setor(es) entrarão no relatório.
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold text-gray-500 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button onClick={generate} disabled={generating || statuses.size === 0 || sectorsSel.size === 0 || filtered.length === 0}
            className="flex-[2] flex items-center justify-center gap-2 py-2.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl transition-colors">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Gerar relatório
          </button>
        </div>
      </div>
    </div>
  );
}
