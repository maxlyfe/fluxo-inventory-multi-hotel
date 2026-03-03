// src/pages/dp/DPEmployees.tsx
// Lista e cadastro de colaboradores do Departamento Pessoal

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import {
  Users, Plus, Search, X, Loader2, AlertTriangle, ChevronDown,
  Building2, Phone, Calendar, Briefcase, UserCheck, UserX,
  Filter, Edit2, Eye, CheckCircle, Clock, AlertCircle,
} from 'lucide-react';
import { format, differenceInDays, isAfter } from 'date-fns';

// Converte "YYYY-MM-DD" para Date LOCAL — evita bug de -1 dia por fuso UTC
const parseLocalDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

import { ptBR } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Employee {
  id: string;
  hotel_id: string;
  user_id: string | null;
  name: string;
  cpf: string | null;
  rg: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  address: string | null;
  role: string;
  sector: string;
  admission_date: string;
  contract_type: string;
  experience_end: string | null;
  shirt_size: string | null;
  pants_size: string | null;
  shoe_size: string | null;
  hat_size: string | null;
  apron_size: string | null;
  raincoat_size: string | null;
  epi_items: string[];
  notes: string | null;
  photo_url: string | null;
  created_at: string;
  hotels?: { name: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SECTORS = [
  'Recepção', 'Governança', 'Manutenção', 'Cozinha', 'Salão',
  'Reservas', 'Administrativo', 'Lavanderia', 'Segurança', 'Outro',
];

const CONTRACT_TYPES = [
  { value: 'experiencia',  label: 'Contrato de Experiência', hasEndDate: false },
  { value: 'determinado',  label: 'Contrato Determinado',    hasEndDate: true  },
  { value: 'clt',          label: 'CLT (Indeterminado)',      hasEndDate: false },
  { value: 'pj',           label: 'PJ',                       hasEndDate: false },
  { value: 'estagio',      label: 'Estágio',                  hasEndDate: true  },
  { value: 'temporario',   label: 'Temporário',               hasEndDate: true  },
];

const SHIRT_SIZES  = ['PP', 'P', 'M', 'G', 'GG', 'XGG', 'XXXG'];
const PANTS_SIZES  = ['34','36','38','40','42','44','46','48','50','52','54','56'];
const SHOE_SIZES   = ['33','34','35','36','37','38','39','40','41','42','43','44','45','46'];
const GENERIC_SIZES = ['P', 'M', 'G', 'GG', 'Único'];

const EPI_OPTIONS = [
  'Luva de borracha', 'Luva de malha de aço', 'Óculos de proteção',
  'Protetor auricular', 'Bota de segurança', 'Capacete',
  'Máscara respiratória', 'Cinto de segurança', 'Colete refletivo',
];

const STATUS_CONFIG = {
  active:    { label: 'Ativo',      color: 'text-green-700 dark:text-green-400',  bg: 'bg-green-50 dark:bg-green-900/20',  dot: 'bg-green-500',  icon: UserCheck },
  inactive:  { label: 'Inativo',    color: 'text-gray-500 dark:text-gray-400',    bg: 'bg-gray-50 dark:bg-gray-800',       dot: 'bg-gray-400',   icon: UserX     },
  dismissed: { label: 'Desligado',  color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-50 dark:bg-red-900/20',      dot: 'bg-red-500',    icon: UserX     },
};

const inputCls = `w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
  placeholder:text-gray-400 transition-all`;
const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

const WORK_SCHEDULES = [
  { value: '',      label: 'Não definido' },
  { value: '12x36', label: '12×36 — 12h trabalho / 36h folga' },
  { value: '6x1',   label: '6×1 — 6 dias trabalho / 1 folga (8h15m)' },
  { value: '5x2',   label: '5×2 — 5 dias trabalho / 2 folgas (10h)' },
  { value: '4x2',   label: '4×2 — 4 dias trabalho / 2 folgas' },
  { value: 'custom', label: 'Personalizado' },
];

const EMPTY_FORM = {
  hotel_id: '', user_id: '', name: '', cpf: '', rg: '', phone: '', email: '',
  birth_date: '', address: '', role: '', sector: SECTORS[0],
  admission_date: '', contract_type: 'clt', experience_end: '',
  status: 'active',
  work_schedule: '', default_shift_start: '', default_shift_end: '',
  shirt_size: '', pants_size: '', shoe_size: '', hat_size: '',
  apron_size: '', raincoat_size: '', epi_items: [] as string[], notes: '',
};

// ---------------------------------------------------------------------------
// Calcula datas automáticas para contrato de experiência
// Retorna { fase1: Date (30 dias), fase2: Date (90 dias = 30+60) }
// ---------------------------------------------------------------------------
function calcExperienceDates(admissionDate: string): { fase1: Date; fase2: Date } | null {
  if (!admissionDate) return null;
  const base = parseLocalDate(admissionDate);
  const fase1 = new Date(base); fase1.setDate(fase1.getDate() + 30);
  const fase2 = new Date(base); fase2.setDate(fase2.getDate() + 90);
  return { fase1, fase2 };
}

// ---------------------------------------------------------------------------
// Contract expiry badge — mostra fase relevante do contrato
// ---------------------------------------------------------------------------
function ContractBadge({ emp }: { emp: Employee }) {
  // Contrato de experiência — calcula automaticamente
  if (emp.contract_type === 'experiencia' && emp.admission_date) {
    const dates = calcExperienceDates(emp.admission_date);
    if (!dates) return null;
    const now = new Date();

    // Já passou as duas fases
    if (isAfter(now, dates.fase2)) return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
        <AlertCircle className="h-3 w-3" />Exp. encerrada
      </span>
    );

    // Está na fase 2 (entre 30 e 90 dias)
    if (isAfter(now, dates.fase1)) {
      const days = differenceInDays(dates.fase2, now);
      return (
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
          days <= 15
            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
        }`}>
          <Clock className="h-3 w-3" />2ª fase vence em {days}d
        </span>
      );
    }

    // Ainda na fase 1
    const days = differenceInDays(dates.fase1, now);
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
        days <= 5
          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
      }`}>
        <Clock className="h-3 w-3" />1ª fase vence em {days}d
      </span>
    );
  }

  // Contrato com data fim explícita (determinado, estágio, temporário)
  if (emp.experience_end) {
    const days = differenceInDays(parseLocalDate(emp.experience_end), new Date());
    if (days < 0) return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
        <AlertCircle className="h-3 w-3" />Contrato vencido
      </span>
    );
    if (days <= 15) return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
        <AlertTriangle className="h-3 w-3" />Vence em {days}d
      </span>
    );
    if (days <= 30) return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
        <Clock className="h-3 w-3" />Vence em {days}d
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
        <CheckCircle className="h-3 w-3" />Até {format(parseLocalDate(emp.experience_end), 'dd/MM/yy')}
      </span>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function DPEmployees() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();
  const navigate = useNavigate();

  const canChangeHotel = ['admin', 'management'].includes(user?.role || '');
  const defaultHotelId = selectedHotel?.id || '';

  // List state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [hotels, setHotels]       = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading]     = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [search, setSearch]       = useState('');
  const [filterHotel, setFilterHotel]   = useState(defaultHotelId);
  const [filterSector, setFilterSector] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');

  // Form state
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [form, setForm]           = useState({ ...EMPTY_FORM, hotel_id: defaultHotelId });
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState('');

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------
  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      let q = supabase
        .from('employees')
        .select('*, hotels:hotel_id(name)')
        .order('name');

      const hotelFilter = canChangeHotel ? filterHotel : defaultHotelId;
      if (hotelFilter)    q = q.eq('hotel_id', hotelFilter);
      if (filterSector)   q = q.eq('sector', filterSector);
      if (filterStatus)   q = q.eq('status', filterStatus);

      const { data, error } = await q;
      if (error) throw error;
      setEmployees((data || []) as Employee[]);
    } catch (err: any) {
      setFetchError(err.message || 'Erro ao carregar colaboradores.');
    } finally {
      setLoading(false);
    }
  }, [filterHotel, filterSector, filterStatus, canChangeHotel, defaultHotelId]);

  useEffect(() => {
    supabase.from('hotels').select('id, name').order('name').then(({ data }) => setHotels(data || []));
  }, []);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  useEffect(() => {
    if (!canChangeHotel && selectedHotel?.id) setFilterHotel(selectedHotel.id);
  }, [selectedHotel?.id]);

  // ---------------------------------------------------------------------------
  // Filtered list (client-side search)
  // ---------------------------------------------------------------------------
  const filtered = employees.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.name.toLowerCase().includes(q) ||
      (e.role || '').toLowerCase().includes(q) ||
      (e.cpf || '').includes(q) ||
      (e.phone || '').includes(q)
    );
  });

  // Stats
  const stats = {
    total:    employees.length,
    active:   employees.filter(e => e.status === 'active').length,
    expiring: employees.filter(e => {
      if (e.contract_type === 'experiencia' && e.admission_date) {
        const d = calcExperienceDates(e.admission_date);
        if (!d) return false;
        const days2 = differenceInDays(d.fase2, new Date());
        return days2 >= 0 && days2 <= 30;
      }
      if (!e.experience_end) return false;
      const days = differenceInDays(parseLocalDate(e.experience_end), new Date());
      return days >= 0 && days <= 30;
    }).length,
    expired: employees.filter(e => {
      if (e.contract_type === 'experiencia' && e.admission_date) {
        const d = calcExperienceDates(e.admission_date);
        return d ? isAfter(new Date(), d.fase2) : false;
      }
      if (!e.experience_end) return false;
      return differenceInDays(parseLocalDate(e.experience_end), new Date()) < 0;
    }).length,
  };

  // ---------------------------------------------------------------------------
  // Form helpers
  // ---------------------------------------------------------------------------
  const openNew = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM, hotel_id: filterHotel || defaultHotelId });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (emp: Employee) => {
    setEditId(emp.id);
    setForm({
      hotel_id: emp.hotel_id, user_id: emp.user_id || '',
      name: emp.name, cpf: emp.cpf || '', rg: emp.rg || '',
      phone: emp.phone || '', email: emp.email || '',
      birth_date: emp.birth_date || '', address: emp.address || '',
      role: emp.role, sector: emp.sector,
      admission_date: emp.admission_date,
      contract_type: emp.contract_type, experience_end: emp.experience_end || '',
      status: emp.status,
      work_schedule: (emp as any).work_schedule || '',
      default_shift_start: (emp as any).default_shift_start || '',
      default_shift_end: (emp as any).default_shift_end || '',
      shirt_size: emp.shirt_size || '', pants_size: emp.pants_size || '',
      shoe_size: emp.shoe_size || '', hat_size: emp.hat_size || '',
      apron_size: emp.apron_size || '', raincoat_size: emp.raincoat_size || '',
      epi_items: emp.epi_items || [], notes: emp.notes || '',
    });
    setFormError('');
    setShowForm(true);
  };

  const toggleEpi = (epi: string) => {
    setForm(f => ({
      ...f,
      epi_items: f.epi_items.includes(epi)
        ? f.epi_items.filter(e => e !== epi)
        : [...f.epi_items, epi],
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.hotel_id)        { setFormError('Selecione o hotel.'); return; }
    if (!form.name.trim())     { setFormError('Informe o nome.'); return; }
    if (!form.role.trim())     { setFormError('Informe o cargo.'); return; }
    if (!form.admission_date)  { setFormError('Informe a data de admissão.'); return; }

    setSaving(true);
    try {
      const payload = {
        hotel_id:       form.hotel_id,
        user_id:        form.user_id || null,
        name:           form.name.trim(),
        cpf:            form.cpf || null,
        rg:             form.rg || null,
        phone:          form.phone || null,
        email:          form.email || null,
        birth_date:     form.birth_date || null,
        address:        form.address || null,
        role:           form.role.trim(),
        sector:         form.sector,
        admission_date: form.admission_date,
        contract_type:  form.contract_type,
        experience_end: form.experience_end || null,
        status:         form.status,
        shirt_size:     form.shirt_size || null,
        pants_size:     form.pants_size || null,
        shoe_size:      form.shoe_size || null,
        hat_size:       form.hat_size || null,
        apron_size:     form.apron_size || null,
        raincoat_size:  form.raincoat_size || null,
        epi_items:      form.epi_items,
        notes:          form.notes || null,
        work_schedule:  form.work_schedule || null,
        default_shift_start: form.default_shift_start || null,
        default_shift_end:   form.default_shift_end   || null,
        created_by:     user?.id,
      };

      if (editId) {
        const { error } = await supabase.from('employees').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employees').insert(payload);
        if (error) throw error;
      }

      setShowForm(false);
      await fetchEmployees();
    } catch (err: any) {
      setFormError(err.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render — Form (slide-over)
  // ---------------------------------------------------------------------------
  const renderForm = () => (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />

      {/* Panel */}
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 h-full overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {editId ? 'Editar Colaborador' : 'Novo Colaborador'}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {editId ? 'Atualize os dados do colaborador' : 'Preencha os dados do novo colaborador'}
            </p>
          </div>
          <button onClick={() => setShowForm(false)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 p-6 space-y-8">

          {/* ── Dados Pessoais ── */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs font-bold">1</span>
              Dados Pessoais
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Hotel */}
              {canChangeHotel && hotels.length > 1 ? (
                <div className="sm:col-span-2">
                  <label className={labelCls}>Hotel *</label>
                  <select value={form.hotel_id} onChange={e => setForm(f => ({ ...f, hotel_id: e.target.value }))}
                    className={`${inputCls} appearance-none`} required>
                    <option value="">Selecione...</option>
                    {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              ) : selectedHotel && (
                <div className="sm:col-span-2 flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/50 rounded-xl">
                  <Building2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
                  <span className="text-sm font-semibold text-blue-800 dark:text-blue-200">{selectedHotel.name}</span>
                </div>
              )}

              <div className="sm:col-span-2">
                <label className={labelCls}>Nome completo *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome do colaborador..." className={inputCls} required />
              </div>

              <div>
                <label className={labelCls}>CPF</label>
                <input type="text" value={form.cpf} onChange={e => setForm(f => ({ ...f, cpf: e.target.value }))}
                  placeholder="000.000.000-00" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>RG</label>
                <input type="text" value={form.rg} onChange={e => setForm(f => ({ ...f, rg: e.target.value }))}
                  placeholder="00.000.000-0" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Telefone</label>
                <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="(21) 99999-9999" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>E-mail</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@exemplo.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Data de nascimento</label>
                <input type="date" value={form.birth_date} onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Endereço</label>
                <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="Rua, número, bairro, cidade..." className={inputCls} />
              </div>
            </div>
          </section>

          {/* ── Dados Funcionais ── */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-purple-600 dark:text-purple-400 text-xs font-bold">2</span>
              Dados Funcionais
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Cargo *</label>
                <input type="text" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  placeholder="Ex: Recepcionista, Camareira..." className={inputCls} required />
              </div>
              <div>
                <label className={labelCls}>Setor *</label>
                <select value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}
                  className={`${inputCls} appearance-none`}>
                  {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Admissão *</label>
                <input type="date" value={form.admission_date} onChange={e => setForm(f => ({ ...f, admission_date: e.target.value }))}
                  className={inputCls} required />
              </div>
              <div>
                <label className={labelCls}>Tipo de contrato</label>
                <select value={form.contract_type} onChange={e => setForm(f => ({ ...f, contract_type: e.target.value, experience_end: '' }))}
                  className={`${inputCls} appearance-none`}>
                  {CONTRACT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              {/* Contrato de experiência → datas calculadas automaticamente */}
              {form.contract_type === 'experiencia' && (() => {
                const dates = calcExperienceDates(form.admission_date);
                return dates ? (
                  <div className="sm:col-span-2 grid grid-cols-2 gap-3 p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-2xl">
                    <div>
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">1ª fase (30 dias)</p>
                      <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                        {format(dates.fase1, 'dd/MM/yyyy')}
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                        {differenceInDays(dates.fase1, new Date()) < 0
                          ? 'Vencida'
                          : `Em ${differenceInDays(dates.fase1, new Date())} dias`}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">2ª fase (+60 dias)</p>
                      <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                        {format(dates.fase2, 'dd/MM/yyyy')}
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                        {differenceInDays(dates.fase2, new Date()) < 0
                          ? 'Vencida'
                          : `Em ${differenceInDays(dates.fase2, new Date())} dias`}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="sm:col-span-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-xl px-4 py-3">
                    ⚠️ Informe a data de admissão para calcular automaticamente as fases do contrato de experiência.
                  </div>
                );
              })()}

              {/* Contrato determinado / estágio / temporário → pede data de fim */}
              {CONTRACT_TYPES.find(c => c.value === form.contract_type)?.hasEndDate && form.contract_type !== 'experiencia' && (
                <div className="sm:col-span-2">
                  <label className={labelCls}>Fim do contrato *</label>
                  <input type="date" value={form.experience_end} onChange={e => setForm(f => ({ ...f, experience_end: e.target.value }))}
                    className={inputCls} />
                  {form.experience_end && (() => {
                    const days = differenceInDays(parseLocalDate(form.experience_end), new Date());
                    return (
                      <p className={`text-xs mt-1.5 font-medium ${days < 0 ? 'text-red-500' : days <= 30 ? 'text-amber-500' : 'text-gray-400'}`}>
                        {days < 0 ? `Vencido há ${Math.abs(days)} dias` : `Vence em ${days} dias — ${format(parseLocalDate(form.experience_end), 'dd/MM/yyyy')}`}
                      </p>
                    );
                  })()}
                </div>
              )}
              <div>
                <label className={labelCls}>Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className={`${inputCls} appearance-none`}>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) =>
                    <option key={k} value={k}>{v.label}</option>
                  )}
                </select>
              </div>
            </div>
          </section>

          {/* ── Escala Padrão ── */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center text-teal-600 dark:text-teal-400 text-xs font-bold">3</span>
              Escala Padrão
              <span className="text-xs font-normal text-gray-400 ml-1">— usado para auto-preencher a escala semanal</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-3">
                <label className={labelCls}>Tipo de escala</label>
                <select value={form.work_schedule} onChange={e => {
                  // Auto-preenche horários padrão ao selecionar tipo
                  const ws = e.target.value;
                  let start = form.default_shift_start;
                  let end   = form.default_shift_end;
                  if (ws === '12x36' && !start) { start = '07:00'; end = '19:00'; }
                  if (ws === '6x1'   && !start) { start = '07:00'; end = '15:15'; }
                  if (ws === '5x2'   && !start) { start = '07:00'; end = '17:00'; }
                  if (ws === '4x2'   && !start) { start = '07:00'; end = '19:00'; }
                  setForm(f => ({ ...f, work_schedule: ws, default_shift_start: start, default_shift_end: end }));
                }}
                  className={`${inputCls} appearance-none`}>
                  {WORK_SCHEDULES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </div>
              {form.work_schedule && (
                <>
                  <div>
                    <label className={labelCls}>Entrada padrão</label>
                    <input type="time" value={form.default_shift_start}
                      onChange={e => setForm(f => ({ ...f, default_shift_start: e.target.value }))}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Saída padrão</label>
                    <input type="time" value={form.default_shift_end}
                      onChange={e => setForm(f => ({ ...f, default_shift_end: e.target.value }))}
                      className={inputCls} />
                  </div>
                  {form.default_shift_start && form.default_shift_end && (
                    <div className="flex items-center">
                      <div className="px-4 py-3 bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-800 rounded-xl text-sm text-teal-700 dark:text-teal-300 font-semibold">
                        {form.default_shift_start} AS {form.default_shift_end}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ── Uniformes ── */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center text-orange-600 dark:text-orange-400 text-xs font-bold">4</span>
              Tamanhos de Uniforme
              <span className="text-xs font-normal text-gray-400 ml-1">— deixe em branco se não recebe</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Blusa / Camiseta</label>
                <select value={form.shirt_size} onChange={e => setForm(f => ({ ...f, shirt_size: e.target.value }))}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Não recebe</option>
                  {SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Calça</label>
                <select value={form.pants_size} onChange={e => setForm(f => ({ ...f, pants_size: e.target.value }))}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Não recebe</option>
                  {PANTS_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Sapato / Bota</label>
                <select value={form.shoe_size} onChange={e => setForm(f => ({ ...f, shoe_size: e.target.value }))}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Não recebe</option>
                  {SHOE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Touca</label>
                <select value={form.hat_size} onChange={e => setForm(f => ({ ...f, hat_size: e.target.value }))}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Não recebe</option>
                  {GENERIC_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Avental</label>
                <select value={form.apron_size} onChange={e => setForm(f => ({ ...f, apron_size: e.target.value }))}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Não recebe</option>
                  {GENERIC_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Capa de chuva</label>
                <select value={form.raincoat_size} onChange={e => setForm(f => ({ ...f, raincoat_size: e.target.value }))}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Não recebe</option>
                  {GENERIC_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* EPIs */}
            <div className="mt-4">
              <label className={labelCls}>EPIs</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {EPI_OPTIONS.map(epi => {
                  const active = form.epi_items.includes(epi);
                  return (
                    <button key={epi} type="button" onClick={() => toggleEpi(epi)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-all ${
                        active
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-300'
                      }`}>
                      {epi}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ── Observações ── */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 text-xs font-bold">5</span>
              Observações
            </h3>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3} placeholder="Anotações gerais sobre o colaborador..."
              className={`${inputCls} resize-none`} />
          </section>

          {/* Error */}
          {formError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />{formError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pb-6">
            <button type="button" onClick={() => setShowForm(false)}
              className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : editId ? 'Salvar alterações' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render — Main
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-5">

      {/* Form slide-over */}
      {showForm && renderForm()}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',         value: stats.total,    color: 'text-gray-900 dark:text-white',         bg: 'bg-white dark:bg-gray-800' },
          { label: 'Ativos',        value: stats.active,   color: 'text-green-700 dark:text-green-400',    bg: 'bg-green-50 dark:bg-green-900/20' },
          { label: 'Exp. a vencer', value: stats.expiring, color: 'text-amber-700 dark:text-amber-400',    bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { label: 'Exp. vencida',  value: stats.expired,  color: 'text-red-700 dark:text-red-400',        bg: 'bg-red-50 dark:bg-red-900/20' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl border border-gray-100 dark:border-gray-700 p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters + Add */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, cargo, CPF..."
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400 transition-all" />
        </div>

        {/* Status filter */}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none">
          <option value="">Todos os status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        {/* Sector filter */}
        <select value={filterSector} onChange={e => setFilterSector(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none">
          <option value="">Todos os setores</option>
          {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Hotel filter (admin only) */}
        {canChangeHotel && hotels.length > 1 && (
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <select value={filterHotel} onChange={e => setFilterHotel(e.target.value)}
              className="pl-9 pr-8 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none">
              <option value="">Todas as unidades</option>
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}

        {/* Clear filters */}
        {(search || filterSector || filterStatus !== 'active' || (canChangeHotel && filterHotel !== defaultHotelId)) && (
          <button onClick={() => { setSearch(''); setFilterSector(''); setFilterStatus('active'); if (canChangeHotel) setFilterHotel(defaultHotelId); }}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-gray-500 hover:text-red-500 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors">
            <X className="h-3.5 w-3.5" />Limpar
          </button>
        )}

        {/* Add button */}
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-blue-200 dark:shadow-blue-900/30 ml-auto">
          <Plus className="h-4 w-4" />Novo colaborador
        </button>
      </div>

      {/* Error banner */}
      {fetchError && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{fetchError}</span>
          <button onClick={fetchEmployees} className="text-xs underline">Tentar novamente</button>
        </div>
      )}

      {/* Employee list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Carregando colaboradores...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Users className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhum colaborador encontrado.</p>
          <button onClick={openNew} className="text-sm text-blue-500 hover:underline">Cadastrar o primeiro</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(emp => {
            const sCfg = STATUS_CONFIG[emp.status] ?? STATUS_CONFIG.active;
            const StatusIcon = sCfg.icon;
            const initials = emp.name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();

            return (
              <div key={emp.id}
                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-all group">

                <div className="flex items-start gap-3 mb-3">
                  {/* Avatar */}
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm">
                    {initials}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{emp.name}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{emp.role} · {emp.sector}</p>
                  </div>

                  {/* Status badge */}
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${sCfg.bg} ${sCfg.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sCfg.dot}`} />
                    {sCfg.label}
                  </span>
                </div>

                {/* Info */}
                <div className="space-y-1.5 mb-3">
                  {emp.phone && (
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <Phone className="h-3 w-3 flex-shrink-0" />
                      <span>{emp.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Calendar className="h-3 w-3 flex-shrink-0" />
                    <span>Desde {format(parseLocalDate(emp.admission_date), 'dd/MM/yyyy')}</span>
                  </div>
                  {emp.hotels && (
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <Building2 className="h-3 w-3 flex-shrink-0" />
                      <span>{(emp.hotels as any).name}</span>
                    </div>
                  )}
                </div>

                {/* Contract badge */}
                {(emp.contract_type === 'experiencia' || emp.experience_end) && (
                  <div className="mb-3">
                    <ContractBadge emp={emp} />
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-3 border-t border-gray-50 dark:border-gray-700">
                  <button onClick={() => navigate(`/dp/employee/${emp.id}`)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-colors">
                    <Eye className="h-3.5 w-3.5" />Ver ficha
                  </button>
                  <button onClick={() => openEdit(emp)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition-colors">
                    <Edit2 className="h-3.5 w-3.5" />Editar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}