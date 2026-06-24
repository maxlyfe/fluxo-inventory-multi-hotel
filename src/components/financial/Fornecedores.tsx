import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, User, Plus, Search, X, Loader2, AlertTriangle,
  Edit2, Trash2, CheckCircle, XCircle, ChevronDown, ChevronUp,
  Users, FileSearch, RefreshCw, MapPin, Phone, Mail, Briefcase,
  Check,
} from 'lucide-react';
import {
  supplierService, lookupCnpj, formatCnpj, formatCpf,
  Supplier, CnpjaResult, SupplierType,
} from '../../lib/supplierService';
import { useHotel } from '../../context/HotelContext';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtCurrency = (v?: number) =>
  v != null ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';

const emptyPF = (): Supplier => ({
  type: 'fisica', status: 'ativo', nome: '', cpf: '', rg: '',
  email: '', telefone: '', endereco_logradouro: '', endereco_numero: '',
  endereco_bairro: '', endereco_municipio: '', endereco_uf: '', endereco_cep: '',
});

const emptyPJ = (): Supplier => ({
  type: 'juridica', status: 'ativo', cnpj: '', razao_social: '', nome_fantasia: '',
  situacao: '', situacao_cadastral: '', tipo_empresa: '', data_abertura: '', porte: '',
  capital_social: undefined, natureza_juridica: '', cnae_principal_id: '',
  cnae_principal_desc: '', atividade_economica: [], simples_nacional: false, mei: false,
  ibs: '', cbs: '', lista_exclusao: [], email: '', telefone: '',
  endereco_cep: '', endereco_logradouro: '', endereco_numero: '',
  endereco_complemento: '', endereco_bairro: '', endereco_municipio: '', endereco_uf: '',
});

// ─── Shared modal wrapper — scrollable overlay, modal centered/top on mobile ──

function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 overflow-y-auto"
      onClick={handleBackdrop}
    >
      {/* centering wrapper — min-h-full so short modals are vertically centered */}
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-6">
        {children}
      </div>
    </div>
  );
}

// ─── Reusable section divider ─────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3 mt-1">
      {children}
    </p>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ ok }: { ok?: boolean | string }) {
  const active = ok === true || (typeof ok === 'string' && /ativ/i.test(ok));
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      active
        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    }`}>
      {active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {typeof ok === 'string' ? ok : (active ? 'Ativo' : 'Inativo')}
    </span>
  );
}

// ─── Modal Pessoa Física ──────────────────────────────────────────────────────

interface PFModalProps {
  hotelId: string;
  initial?: Supplier;
  onClose: () => void;
  onSaved: () => void;
}

function PFModal({ hotelId, initial, onClose, onSaved }: PFModalProps) {
  const [form, setForm] = useState<Supplier>(initial ?? emptyPF());
  const [employees, setEmployees] = useState<any[]>([]);
  const [loadingEmp, setLoadingEmp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showEmpPicker, setShowEmpPicker] = useState(false);
  const [empSearch, setEmpSearch] = useState('');

  useEffect(() => {
    setLoadingEmp(true);
    supplierService.listEmployees(hotelId)
      .then(setEmployees).catch(() => {}).finally(() => setLoadingEmp(false));
  }, [hotelId]);

  const set = (k: keyof Supplier, v: any) => setForm(f => ({ ...f, [k]: v }));

  const importEmployee = (emp: any) => {
    setForm(f => ({
      ...f,
      employee_id: emp.id,
      nome: emp.name,
      cpf: emp.cpf ?? '',
      email: emp.email ?? '',
      telefone: emp.phone ?? '',
      endereco_cep: emp.address_cep ?? '',
      endereco_logradouro: emp.address_street ?? '',
      endereco_numero: emp.address_number ?? '',
      endereco_bairro: emp.address_neighborhood ?? '',
      endereco_municipio: emp.address_city ?? '',
      endereco_uf: emp.address_state ?? '',
    }));
    setShowEmpPicker(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome?.trim()) { setError('Nome é obrigatório'); return; }
    setSaving(true); setError('');
    try {
      await supplierService.save({ ...form, hotel_id: hotelId });
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  const filteredEmp = employees.filter(e =>
    !empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase())
  );

  return (
    <ModalShell onClose={onClose}>
      {/* Modal card — max-h + flex-col so header/footer stay visible while body scrolls */}
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl flex flex-col my-4"
        style={{ maxHeight: 'calc(100dvh - 2rem)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — sticky */}
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <User className="w-4 h-4 text-blue-500 shrink-0" />
            {initial?.id ? 'Editar Fornecedor PF' : 'Novo Fornecedor — Pessoa Física'}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <form id="pf-form" onSubmit={handleSave} className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Importar do DP */}
          {!initial?.id && (
            <div>
              <button
                type="button"
                onClick={() => setShowEmpPicker(p => !p)}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-xl border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 shrink-0" />
                  Importar do Departamento Pessoal
                </span>
                {showEmpPicker ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
              </button>

              {showEmpPicker && (
                <div className="mt-2 border dark:border-gray-700 rounded-xl overflow-hidden">
                  <div className="p-2 bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        value={empSearch}
                        onChange={e => setEmpSearch(e.target.value)}
                        placeholder="Buscar colaborador..."
                        className="w-full pl-8 pr-3 py-2 text-sm bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {loadingEmp ? (
                      <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                    ) : filteredEmp.length === 0 ? (
                      <p className="text-center text-sm text-gray-500 py-4">Nenhum colaborador encontrado</p>
                    ) : filteredEmp.map(emp => (
                      <button
                        key={emp.id}
                        type="button"
                        onClick={() => importEmployee(emp)}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-between border-b last:border-0 dark:border-gray-700 transition-colors"
                      >
                        <span className="font-medium text-gray-800 dark:text-white">{emp.name}</span>
                        {emp.cpf && <span className="text-xs text-gray-500 font-mono">{formatCpf(emp.cpf)}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label-sm">Nome completo *</label>
              <input className="input-field" value={form.nome ?? ''} onChange={e => set('nome', e.target.value)} required />
            </div>
            <div>
              <label className="label-sm">CPF</label>
              <input className="input-field" value={form.cpf ?? ''} onChange={e => set('cpf', formatCpf(e.target.value))} maxLength={14} />
            </div>
            <div>
              <label className="label-sm">RG</label>
              <input className="input-field" value={form.rg ?? ''} onChange={e => set('rg', e.target.value)} />
            </div>
            <div>
              <label className="label-sm">E-mail</label>
              <input className="input-field" type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className="label-sm">Telefone</label>
              <input className="input-field" value={form.telefone ?? ''} onChange={e => set('telefone', e.target.value)} />
            </div>
            <div>
              <label className="label-sm">CEP</label>
              <input className="input-field" value={form.endereco_cep ?? ''} onChange={e => set('endereco_cep', e.target.value)} maxLength={9} />
            </div>
            <div>
              <label className="label-sm">UF</label>
              <input className="input-field" placeholder="SP" value={form.endereco_uf ?? ''} onChange={e => set('endereco_uf', e.target.value.toUpperCase())} maxLength={2} />
            </div>
            <div className="sm:col-span-2">
              <label className="label-sm">Município</label>
              <input className="input-field" value={form.endereco_municipio ?? ''} onChange={e => set('endereco_municipio', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label-sm">Logradouro</label>
              <div className="flex gap-2">
                <input className="input-field flex-1 min-w-0" placeholder="Rua / Av." value={form.endereco_logradouro ?? ''} onChange={e => set('endereco_logradouro', e.target.value)} />
                <input className="input-field w-20 shrink-0" placeholder="Nº" value={form.endereco_numero ?? ''} onChange={e => set('endereco_numero', e.target.value)} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label-sm">Observações</label>
              <textarea className="input-field resize-none" rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
            </div>
            <div>
              <label className="label-sm">Status</label>
              <select className="input-field" value={form.status} onChange={e => set('status', e.target.value as any)}>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4 shrink-0" />{error}
            </p>
          )}
        </form>

        {/* Footer — sticky */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 shrink-0 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
            Cancelar
          </button>
          <button type="submit" form="pf-form" disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition-colors">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Modal Pessoa Jurídica ────────────────────────────────────────────────────

interface PJModalProps {
  hotelId: string;
  initial?: Supplier;
  onClose: () => void;
  onSaved: () => void;
}

function PJModal({ hotelId, initial, onClose, onSaved }: PJModalProps) {
  const [form, setForm] = useState<Supplier>(initial ?? emptyPJ());
  const [cnpjInput, setCnpjInput] = useState(initial?.cnpj ? formatCnpj(initial.cnpj) : '');
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof Supplier, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleCnpjChange = (v: string) => {
    const formatted = formatCnpj(v);
    setCnpjInput(formatted);
    set('cnpj', formatted.replace(/\D/g, ''));
  };

  const handleLookup = async () => {
    setLookupError('');
    const clean = cnpjInput.replace(/\D/g, '');
    if (clean.length !== 14) { setLookupError('CNPJ inválido — precisa ter 14 dígitos'); return; }
    setLooking(true);
    try {
      const r: CnpjaResult = await lookupCnpj(clean);
      setForm(f => ({
        ...f,
        cnpj: r.cnpj, razao_social: r.razao_social, nome_fantasia: r.nome_fantasia,
        situacao: r.situacao, situacao_cadastral: r.situacao_cadastral,
        tipo_empresa: r.tipo_empresa, data_abertura: r.data_abertura,
        porte: r.porte, capital_social: r.capital_social,
        natureza_juridica: r.natureza_juridica,
        cnae_principal_id: r.cnae_principal_id, cnae_principal_desc: r.cnae_principal_desc,
        atividade_economica: r.atividade_economica,
        simples_nacional: r.simples_nacional, mei: r.mei,
        ibs: r.ibs, cbs: r.cbs, lista_exclusao: r.lista_exclusao,
        email: r.email, telefone: r.telefone,
        endereco_cep: r.endereco_cep, endereco_logradouro: r.endereco_logradouro,
        endereco_numero: r.endereco_numero, endereco_complemento: r.endereco_complemento,
        endereco_bairro: r.endereco_bairro, endereco_municipio: r.endereco_municipio,
        endereco_uf: r.endereco_uf,
      }));
    } catch (err: any) {
      setLookupError(err.message ?? 'Erro ao consultar CNPJ');
    } finally { setLooking(false); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.razao_social?.trim() && !form.nome_fantasia?.trim()) {
      setError('Razão Social ou Nome Fantasia é obrigatório'); return;
    }
    setSaving(true); setError('');
    try {
      await supplierService.save({ ...form, hotel_id: hotelId });
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div
        className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl flex flex-col my-4"
        style={{ maxHeight: 'calc(100dvh - 2rem)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-4 h-4 text-emerald-500 shrink-0" />
            {initial?.id ? 'Editar Fornecedor PJ' : 'Novo Fornecedor — Pessoa Jurídica'}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <form id="pj-form" onSubmit={handleSave} className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {/* CNPJ Lookup */}
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 border border-emerald-100 dark:border-emerald-800">
            <SectionTitle>Consulta de CNPJ</SectionTitle>
            <div className="flex gap-2">
              <input
                className="input-field flex-1 min-w-0"
                placeholder="00.000.000/0000-00"
                value={cnpjInput}
                onChange={e => handleCnpjChange(e.target.value)}
                maxLength={18}
              />
              <button
                type="button"
                onClick={handleLookup}
                disabled={looking}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm whitespace-nowrap shrink-0"
              >
                {looking ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
                <span className="hidden sm:inline">Consultar</span>
              </button>
            </div>
            {lookupError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />{lookupError}
              </p>
            )}
          </div>

          {/* Dados Cadastrais */}
          <div>
            <SectionTitle>Dados Cadastrais</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="label-sm">Razão Social</label>
                <input className="input-field" value={form.razao_social ?? ''} onChange={e => set('razao_social', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label-sm">Nome Fantasia</label>
                <input className="input-field" value={form.nome_fantasia ?? ''} onChange={e => set('nome_fantasia', e.target.value)} />
              </div>
              <div>
                <label className="label-sm">Situação</label>
                <input className="input-field" value={form.situacao ?? ''} onChange={e => set('situacao', e.target.value)} />
              </div>
              <div>
                <label className="label-sm">Situação Cadastral</label>
                <input className="input-field" value={form.situacao_cadastral ?? ''} onChange={e => set('situacao_cadastral', e.target.value)} />
              </div>
              <div>
                <label className="label-sm">Tipo (Matriz/Filial)</label>
                <input className="input-field" value={form.tipo_empresa ?? ''} onChange={e => set('tipo_empresa', e.target.value)} />
              </div>
              <div>
                <label className="label-sm">Data de Abertura</label>
                <input className="input-field" type="date" value={form.data_abertura ?? ''} onChange={e => set('data_abertura', e.target.value)} />
              </div>
              <div>
                <label className="label-sm">Porte</label>
                <input className="input-field" value={form.porte ?? ''} onChange={e => set('porte', e.target.value)} />
              </div>
              <div>
                <label className="label-sm">Capital Social (R$)</label>
                <input className="input-field" type="number" step="0.01" min="0" value={form.capital_social ?? ''} onChange={e => set('capital_social', parseFloat(e.target.value) || undefined)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label-sm">Natureza Jurídica</label>
                <input className="input-field" value={form.natureza_juridica ?? ''} onChange={e => set('natureza_juridica', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Atividade Econômica */}
          <div>
            <SectionTitle>Atividade Econômica</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label-sm">CNAE Principal (código)</label>
                <input className="input-field" value={form.cnae_principal_id ?? ''} onChange={e => set('cnae_principal_id', e.target.value)} />
              </div>
              <div>
                <label className="label-sm">CNAE Principal (descrição)</label>
                <input className="input-field" value={form.cnae_principal_desc ?? ''} onChange={e => set('cnae_principal_desc', e.target.value)} />
              </div>
            </div>
            {(form.atividade_economica ?? []).length > 0 && (
              <div className="mt-3 border dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[320px]">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="text-left px-3 py-2 text-gray-500 whitespace-nowrap">Código</th>
                        <th className="text-left px-3 py-2 text-gray-500">Descrição</th>
                        <th className="px-3 py-2 text-gray-500 w-16 text-center">Principal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(form.atividade_economica ?? []).map((a, i) => (
                        <tr key={i} className="border-t dark:border-gray-700">
                          <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{a.id}</td>
                          <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{a.text}</td>
                          <td className="px-3 py-2 text-center">
                            {a.principal && <Check className="w-3.5 h-3.5 text-emerald-500 mx-auto" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Regime Tributário */}
          <div>
            <SectionTitle>Regime Tributário</SectionTitle>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <label className="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <input type="checkbox" checked={!!form.simples_nacional} onChange={e => set('simples_nacional', e.target.checked)} className="rounded border-gray-300 text-blue-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Simples Nacional</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <input type="checkbox" checked={!!form.mei} onChange={e => set('mei', e.target.checked)} className="rounded border-gray-300 text-blue-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">MEI</span>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-sm">IBS</label>
                <input className="input-field" value={form.ibs ?? ''} onChange={e => set('ibs', e.target.value)} />
              </div>
              <div>
                <label className="label-sm">CBS</label>
                <input className="input-field" value={form.cbs ?? ''} onChange={e => set('cbs', e.target.value)} />
              </div>
            </div>
            {(form.lista_exclusao ?? []).length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs text-gray-500 font-medium">Lista de Exclusão do Simples Nacional</p>
                {(form.lista_exclusao ?? []).map((ex, i) => (
                  <div key={i} className="text-xs px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg">
                    {ex.date && <span className="font-medium mr-2">{ex.date}</span>}{ex.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Contato */}
          <div>
            <SectionTitle>Contato</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label-sm">E-mail</label>
                <input className="input-field" type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)} />
              </div>
              <div>
                <label className="label-sm">Telefone</label>
                <input className="input-field" value={form.telefone ?? ''} onChange={e => set('telefone', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Endereço */}
          <div>
            <SectionTitle>Endereço</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-1 sm:col-span-2">
                <label className="label-sm">CEP</label>
                <input className="input-field" value={form.endereco_cep ?? ''} onChange={e => set('endereco_cep', e.target.value)} maxLength={9} />
              </div>
              <div className="col-span-1">
                <label className="label-sm">UF</label>
                <input className="input-field" placeholder="SP" value={form.endereco_uf ?? ''} onChange={e => set('endereco_uf', e.target.value.toUpperCase())} maxLength={2} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="label-sm">Município</label>
                <input className="input-field" value={form.endereco_municipio ?? ''} onChange={e => set('endereco_municipio', e.target.value)} />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className="label-sm">Logradouro</label>
                <input className="input-field" value={form.endereco_logradouro ?? ''} onChange={e => set('endereco_logradouro', e.target.value)} />
              </div>
              <div className="col-span-1">
                <label className="label-sm">Nº</label>
                <input className="input-field" value={form.endereco_numero ?? ''} onChange={e => set('endereco_numero', e.target.value)} />
              </div>
              <div className="col-span-2 sm:col-span-2">
                <label className="label-sm">Complemento</label>
                <input className="input-field" value={form.endereco_complemento ?? ''} onChange={e => set('endereco_complemento', e.target.value)} />
              </div>
              <div className="col-span-2 sm:col-span-2">
                <label className="label-sm">Bairro</label>
                <input className="input-field" value={form.endereco_bairro ?? ''} onChange={e => set('endereco_bairro', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Status + Obs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label-sm">Status</label>
              <select className="input-field" value={form.status} onChange={e => set('status', e.target.value as any)}>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
            <div>
              <label className="label-sm">Observações</label>
              <textarea className="input-field resize-none" rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4 shrink-0" />{error}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 shrink-0 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
            Cancelar
          </button>
          <button type="submit" form="pj-form" disabled={saving} className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 transition-colors">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Fornecedores() {
  const { selectedHotel } = useHotel();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [typeTab, setTypeTab] = useState<SupplierType>('juridica');
  const [search, setSearch] = useState('');
  const [modalPF, setModalPF] = useState<{ open: boolean; data?: Supplier }>({ open: false });
  const [modalPJ, setModalPJ] = useState<{ open: boolean; data?: Supplier }>({ open: false });
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true); setError('');
    try {
      setSuppliers(await supplierService.list(selectedHotel.id));
    } catch (err: any) {
      setError(err.message ?? 'Erro ao carregar fornecedores');
    } finally { setLoading(false); }
  }, [selectedHotel?.id]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remover este fornecedor?')) return;
    setDeleting(id);
    try {
      await supplierService.delete(id);
      setSuppliers(s => s.filter(x => x.id !== id));
    } catch (err: any) { setError(err.message); }
    finally { setDeleting(null); }
  };

  const filtered = suppliers.filter(s => {
    if (s.type !== typeTab) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (s.nome ?? '').toLowerCase().includes(q) ||
      (s.razao_social ?? '').toLowerCase().includes(q) ||
      (s.nome_fantasia ?? '').toLowerCase().includes(q) ||
      (s.cnpj ?? '').includes(q) ||
      (s.cpf ?? '').includes(q)
    );
  });

  const pfCount = suppliers.filter(s => s.type === 'fisica').length;
  const pjCount = suppliers.filter(s => s.type === 'juridica').length;

  if (!selectedHotel?.id) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Selecione um hotel para gerenciar fornecedores.</p>
        </div>
      </div>
    );
  }

  const openNew = () => typeTab === 'juridica' ? setModalPJ({ open: true }) : setModalPF({ open: true });

  return (
    <div>
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 mb-6">
        {/* Type tabs + New button row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => setTypeTab('juridica')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                typeTab === 'juridica'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <Building2 className="w-4 h-4 shrink-0" />
              <span className="hidden xs:inline">Pessoa </span>Jurídica
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${typeTab === 'juridica' ? 'bg-white/20' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                {pjCount}
              </span>
            </button>
            <button
              onClick={() => setTypeTab('fisica')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                typeTab === 'fisica'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <User className="w-4 h-4 shrink-0" />
              <span className="hidden xs:inline">Pessoa </span>Física
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${typeTab === 'fisica' ? 'bg-white/20' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                {pfCount}
              </span>
            </button>
          </div>

          <button
            onClick={openNew}
            className={`flex items-center gap-2 px-4 py-2 text-sm text-white rounded-lg transition-colors shrink-0 ${
              typeTab === 'juridica' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Novo </span>Fornecedor
          </button>
        </div>

        {/* Search row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar fornecedor..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button onClick={load} disabled={loading} className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors shrink-0">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {/* ── List ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          {typeTab === 'juridica'
            ? <Building2 className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            : <User className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          }
          <p className="text-gray-500 dark:text-gray-400">Nenhum fornecedor cadastrado.</p>
          <button onClick={openNew} className="mt-3 text-sm text-blue-600 hover:underline">
            Cadastrar agora
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map(s => (
            <div key={s.id} className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
              {s.type === 'juridica' ? (
                <PJCard
                  supplier={s}
                  onEdit={() => setModalPJ({ open: true, data: s })}
                  onDelete={() => handleDelete(s.id!)}
                  deleting={deleting === s.id}
                />
              ) : (
                <PFCard
                  supplier={s}
                  onEdit={() => setModalPF({ open: true, data: s })}
                  onDelete={() => handleDelete(s.id!)}
                  deleting={deleting === s.id}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {modalPF.open && (
        <PFModal
          hotelId={selectedHotel.id}
          initial={modalPF.data}
          onClose={() => setModalPF({ open: false })}
          onSaved={() => { setModalPF({ open: false }); load(); }}
        />
      )}
      {modalPJ.open && (
        <PJModal
          hotelId={selectedHotel.id}
          initial={modalPJ.data}
          onClose={() => setModalPJ({ open: false })}
          onSaved={() => { setModalPJ({ open: false }); load(); }}
        />
      )}
    </div>
  );
}

// ─── Cards ────────────────────────────────────────────────────────────────────

interface CardProps {
  supplier: Supplier;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}

function PJCard({ supplier: s, onEdit, onDelete, deleting }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="bg-emerald-100 dark:bg-emerald-900/30 p-2 rounded-lg shrink-0">
            <Building2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900 dark:text-white truncate">
              {s.razao_social || s.nome_fantasia || '—'}
            </p>
            {s.nome_fantasia && s.razao_social && (
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{s.nome_fantasia}</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {s.cnpj && <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{formatCnpj(s.cnpj)}</span>}
              <StatusBadge ok={s.situacao_cadastral || s.status} />
              {s.simples_nacional && <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full">Simples</span>}
              {s.mei && <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs rounded-full">MEI</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setExpanded(p => !p)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <Edit2 className="w-4 h-4" />
          </button>
          <button onClick={onDelete} disabled={deleting} className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t dark:border-gray-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {s.natureza_juridica && <InfoRow icon={<Briefcase className="w-3.5 h-3.5" />} label="Natureza Jurídica" value={s.natureza_juridica} />}
          {s.tipo_empresa && <InfoRow icon={<Building2 className="w-3.5 h-3.5" />} label="Tipo" value={s.tipo_empresa} />}
          {s.data_abertura && <InfoRow icon={null} label="Abertura" value={s.data_abertura} />}
          {s.porte && <InfoRow icon={null} label="Porte" value={s.porte} />}
          {s.capital_social != null && <InfoRow icon={null} label="Capital Social" value={fmtCurrency(s.capital_social)} />}
          {s.cnae_principal_desc && <InfoRow icon={null} label="CNAE Principal" value={`${s.cnae_principal_id} — ${s.cnae_principal_desc}`} />}
          {s.email && <InfoRow icon={<Mail className="w-3.5 h-3.5" />} label="E-mail" value={s.email} />}
          {s.telefone && <InfoRow icon={<Phone className="w-3.5 h-3.5" />} label="Telefone" value={s.telefone} />}
          {(s.endereco_logradouro || s.endereco_municipio) && (
            <InfoRow
              icon={<MapPin className="w-3.5 h-3.5" />}
              label="Endereço"
              value={[s.endereco_logradouro, s.endereco_numero, s.endereco_bairro, s.endereco_municipio, s.endereco_uf].filter(Boolean).join(', ')}
            />
          )}
          {s.ibs && <InfoRow icon={null} label="IBS" value={s.ibs} />}
          {s.cbs && <InfoRow icon={null} label="CBS" value={s.cbs} />}
          {(s.lista_exclusao ?? []).length > 0 && (
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="text-xs text-gray-500 mb-1">Lista de Exclusão</p>
              <div className="flex flex-wrap gap-1">
                {(s.lista_exclusao ?? []).map((ex, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded">
                    {ex.date} {ex.text}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PFCard({ supplier: s, onEdit, onDelete, deleting }: CardProps) {
  return (
    <div className="p-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg shrink-0">
          <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 dark:text-white truncate">{s.nome || '—'}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {s.cpf && <span className="text-xs font-mono text-gray-500">{formatCpf(s.cpf)}</span>}
            {s.employee_id && <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">DP</span>}
            <StatusBadge ok={s.status} />
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
            {s.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{s.email}</span></span>}
            {s.telefone && <span className="flex items-center gap-1 shrink-0"><Phone className="w-3 h-3" />{s.telefone}</span>}
            {s.endereco_municipio && (
              <span className="flex items-center gap-1 shrink-0">
                <MapPin className="w-3 h-3" />{s.endereco_municipio}{s.endereco_uf ? `/${s.endereco_uf}` : ''}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
          <Edit2 className="w-4 h-4" />
        </button>
        <button onClick={onDelete} disabled={deleting} className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 mb-0.5">
        {icon}{label}
      </p>
      <p className="text-gray-700 dark:text-gray-300 text-sm break-words">{value}</p>
    </div>
  );
}
