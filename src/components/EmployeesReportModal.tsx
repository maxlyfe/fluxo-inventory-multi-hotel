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
  const [generating, setGenerating] = useState(false);

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void) => (k: string) => {
    const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setSet(n);
  };

  const filtered = useMemo(() => employees.filter(e => statuses.has(e.status)), [employees, statuses]);
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
        const s = e.sector || 'Sem setor';
        (bySector.get(s) || bySector.set(s, []).get(s)!).push(e);
      });
      const sectors = [...bySector.entries()]
        .map(([s, list]) => [s, [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))] as const)
        .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));

      const statusLabels = [...statuses].map(s => STATUS_LABELS[s] || s).join(' · ');
      const issuedAt = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

      const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
      const colCount = 1 /* nome */ + selectedFields.length + 1 /* status */;

      const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Relatório de Colaboradores — ${esc(hotelName)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 11px; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1e293b; padding-bottom: 10px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 16px; letter-spacing: .02em; }
  .meta { font-size: 10.5px; color: #475569; text-align: right; }
  .meta strong { color: #0f172a; }
  .summary { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .chip { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 999px; padding: 4px 10px; font-size: 10.5px; }
  h2.sector { font-size: 11.5px; margin: 16px 0 6px; padding: 6px 10px; background: #0f172a; color: #fff; border-radius: 6px; letter-spacing: .04em; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 6px; text-align: left; word-wrap: break-word; overflow-wrap: anywhere; vertical-align: top; }
  th { background: #f8fafc; font-weight: 700; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: .03em; }
  td.name { font-weight: 600; }
  .status { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 9.5px; font-weight: 700; }
  .s-active    { background: #dcfce7; color: #14532d; }
  .s-inactive  { background: #f1f5f9; color: #334155; }
  .s-dismissed { background: #fee2e2; color: #7f1d1d; }
  footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 9.5px; display: flex; justify-content: space-between; }
  .empty { text-align: center; color: #94a3b8; padding: 30px; font-style: italic; }
  @media print {
    .no-print { display: none; }
    h2.sector { break-after: avoid; }
    table { break-inside: auto; }
    tr { break-inside: avoid; }
  }
  .actions { position: fixed; top: 12px; right: 12px; display: flex; gap: 6px; }
  .actions button { background: #0ea5e9; color: #fff; border: 0; padding: 8px 14px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 12px; }
  .actions button.secondary { background: #e2e8f0; color: #0f172a; }
</style></head>
<body>
  <div class="actions no-print">
    <button onclick="window.print()">Imprimir / PDF</button>
    <button class="secondary" onclick="window.close()">Fechar</button>
  </div>
  <header>
    <div>
      <h1>Relatório de Colaboradores</h1>
      <div style="color:#475569;margin-top:4px;font-size:11px">${esc(hotelName)}</div>
    </div>
    <div class="meta">
      <div><strong>Emitido:</strong> ${esc(issuedAt)}</div>
      <div><strong>Filtros:</strong> ${esc(statusLabels || '—')}</div>
      <div><strong>Total:</strong> ${filtered.length} colaborador(es)</div>
    </div>
  </header>

  <div class="summary">
    ${[...statuses].map(s => `<div class="chip"><strong>${esc(STATUS_LABELS[s] || s)}:</strong> ${employees.filter(e => e.status === s).length}</div>`).join('')}
  </div>

  ${filtered.length === 0 ? `<div class="empty">Nenhum colaborador encontrado para os filtros selecionados.</div>` : sectors.map(([sector, list]) => `
    <h2 class="sector">${esc(sector)} <span style="font-weight:500;opacity:.7">· ${list.length}</span></h2>
    <table>
      <thead><tr>
        <th style="width: 18%">Nome</th>
        ${selectedFields.map(f => `<th>${esc(f.label)}</th>`).join('')}
        <th style="width: 8%">Status</th>
      </tr></thead>
      <tbody>
        ${list.map(e => `<tr>
          <td class="name">${esc(e.name)}</td>
          ${selectedFields.map(f => `<td>${esc(cellValue(e, f.key))}</td>`).join('')}
          <td><span class="status s-${esc(e.status)}">${esc(STATUS_LABELS[e.status] || e.status)}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  `).join('')}

  <footer>
    <span>LyFe Hoteles — Departamento Pessoal</span>
    <span>Página gerada automaticamente</span>
  </footer>
  <script>setTimeout(() => { try { window.focus(); } catch(_){} }, 100);</script>
</body></html>`;

      const w = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
      if (!w) { alert('Permita pop-ups para gerar o relatório.'); return; }
      w.document.open(); w.document.write(html); w.document.close();
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
            {filtered.length} colaborador(es) entrarão no relatório, distribuídos por setor.
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold text-gray-500 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button onClick={generate} disabled={generating || statuses.size === 0 || filtered.length === 0}
            className="flex-[2] flex items-center justify-center gap-2 py-2.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl transition-colors">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Gerar relatório
          </button>
        </div>
      </div>
    </div>
  );
}
