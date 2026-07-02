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
  ArrowRightLeft, FileText, Check, Trash2,
} from 'lucide-react';
import EmployeesReportModal from '../../components/EmployeesReportModal';
import { format, differenceInDays, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { whatsappService, formatWhatsAppNumber, isValidWhatsAppNumber } from '../../lib/whatsappService';

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
  address_cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
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
  birth_date: '', address: '',
  address_cep: '', address_street: '', address_number: '',
  address_neighborhood: '', address_city: '', address_state: '',
  role: '', sector: SECTORS[0],
  admission_date: '', contract_type: 'clt', experience_end: '',
  status: 'active',
  work_schedule: '', default_shift_start: '', default_shift_end: '',
  shirt_size: '', pants_size: '', shoe_size: '', hat_size: '',
  apron_size: '', raincoat_size: '', epi_items: [] as string[], notes: '',
};

const UF_OPTIONS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
  'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

// ---------------------------------------------------------------------------
// Calcula datas automáticas para contrato de experiência
// Retorna { fase1: Date (30 dias), fase2: Date (90 dias = 30+60) }
// ---------------------------------------------------------------------------
function calcExperienceDates(admissionDate: string): { fase1: Date; fase2: Date } | null {
  if (!admissionDate) return null;
  const base = new Date(admissionDate);
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
    const days = differenceInDays(new Date(emp.experience_end), new Date());
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
        <CheckCircle className="h-3 w-3" />Até {format(new Date(emp.experience_end), 'dd/MM/yy')}
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
  const [showReport, setShowReport] = useState(false);
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
  const [cepLoading, setCepLoading] = useState(false);

  const lookupCep = async (digits: string) => {
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.erro) return;
      setForm(f => ({
        ...f,
        address_street: data.logradouro || f.address_street,
        address_neighborhood: data.bairro || f.address_neighborhood,
        address_city: data.localidade || f.address_city,
        address_state: data.uf || f.address_state,
      }));
    } catch { /* manual */ }
    finally { setCepLoading(false); }
  };

  const handleCepChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    const formatted = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
    setForm(f => ({ ...f, address_cep: formatted }));
    if (digits.length === 8) lookupCep(digits);
  };

  // Dismissal form state
  const [showDismissalModal, setShowDismissalModal] = useState(false);
  const [pendingSavePayload, setPendingSavePayload] = useState<any>(null);
  const [dismissalForm, setDismissalForm] = useState({
    dismissal_date: '',
    type: 'voluntary', // 'voluntary' | 'involuntary'
    voluntary_reasons: [] as string[],
    involuntary_type: '', // 'justa_causa' | 'sem_justa_causa'
    involuntary_reasons: [] as string[],
    notes: '',
  });

  // Transfer modal
  const [transferEmp,    setTransferEmp]    = useState<Employee | null>(null);
  const [transferHotel,  setTransferHotel]  = useState('');
  const [transferDate,   setTransferDate]   = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError,  setTransferError]  = useState('');

  // Exclusão (soft-delete) — oculta o cadastro de todo o sistema sem apagá-lo
  const [deleteEmp,   setDeleteEmp]   = useState<Employee | null>(null);
  const [deleting,    setDeleting]    = useState(false);
  const [deleteError, setDeleteError] = useState('');

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
        .neq('status', 'deleted')
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
      const days = differenceInDays(new Date(e.experience_end), new Date());
      return days >= 0 && days <= 30;
    }).length,
    expired: employees.filter(e => {
      if (e.contract_type === 'experiencia' && e.admission_date) {
        const d = calcExperienceDates(e.admission_date);
        return d ? isAfter(new Date(), d.fase2) : false;
      }
      if (!e.experience_end) return false;
      return differenceInDays(new Date(e.experience_end), new Date()) < 0;
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

  const openTransfer = (emp: Employee) => {
    setTransferEmp(emp);
    setTransferHotel('');
    setTransferDate(new Date().toISOString().slice(0, 10));
    setTransferReason('');
    setTransferError('');
  };

  const handleTransfer = async () => {
    if (!transferEmp || !transferHotel || !transferDate) {
      setTransferError('Selecione o hotel destino e a data.');
      return;
    }
    if (transferHotel === transferEmp.hotel_id) {
      setTransferError('Hotel destino é igual ao hotel atual.');
      return;
    }
    setTransferSaving(true);
    setTransferError('');
    try {
      const { error: histErr } = await supabase.from('employee_transfers').insert({
        employee_id:   transferEmp.id,
        from_hotel_id: transferEmp.hotel_id,
        to_hotel_id:   transferHotel,
        transfer_date: transferDate,
        reason:        transferReason || null,
        created_by:    user?.id,
      });
      if (histErr) throw histErr;
      const { error: updErr } = await supabase
        .from('employees')
        .update({ hotel_id: transferHotel })
        .eq('id', transferEmp.id);
      if (updErr) throw updErr;
      setTransferEmp(null);
      await fetchEmployees();
    } catch (err: any) {
      setTransferError(err.message || 'Erro ao transferir colaborador.');
    } finally {
      setTransferSaving(false);
    }
  };

  const handleSoftDelete = async () => {
    if (!deleteEmp) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const { error } = await supabase.from('employees').update({ status: 'deleted' }).eq('id', deleteEmp.id);
      if (error) throw error;
      setDeleteEmp(null);
      await fetchEmployees();
    } catch (err: any) {
      setDeleteError(err.message || 'Erro ao excluir colaborador.');
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = (emp: Employee) => {
    setEditId(emp.id);
    setForm({
      hotel_id: emp.hotel_id, user_id: emp.user_id || '',
      name: emp.name, cpf: emp.cpf || '', rg: emp.rg || '',
      phone: emp.phone || '', email: emp.email || '',
      birth_date: emp.birth_date || '', address: emp.address || '',
      address_cep: (emp as any).address_cep || '',
      address_street: (emp as any).address_street || emp.address || '',
      address_number: (emp as any).address_number || '',
      address_neighborhood: (emp as any).address_neighborhood || '',
      address_city: (emp as any).address_city || '',
      address_state: (emp as any).address_state || '',
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
      const cleanCpf = form.cpf?.replace(/\D/g, '');
      
      // Verifica CPF duplicado (exceto se for o próprio editando)
      if (cleanCpf) {
        const { data: existing } = await supabase
          .from('employees')
          .select('id, name')
          .eq('cpf', cleanCpf)
          .maybeSingle();
        
        if (existing && existing.id !== editId) {
          throw new Error(`Este CPF já está cadastrado para o colaborador: ${existing.name}`);
        }
      }

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
        address_cep:          form.address_cep || null,
        address_street:       form.address_street || null,
        address_number:       form.address_number || null,
        address_neighborhood: form.address_neighborhood || null,
        address_city:         form.address_city || null,
        address_state:        form.address_state || null,
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

      // Intercepta se o colaborador era ATIVO e passa a ser DESLIGADO (dismissed)
      const originalEmployee = editId ? employees.find(emp => emp.id === editId) : null;
      const isTransitionToDismissed = originalEmployee && originalEmployee.status === 'active' && form.status === 'dismissed';

      if (isTransitionToDismissed) {
        setDismissalForm({
          dismissal_date: new Date().toISOString().split('T')[0],
          type: 'voluntary',
          voluntary_reasons: [],
          involuntary_type: '',
          involuntary_reasons: [],
          notes: '',
        });
        setPendingSavePayload(payload);
        setShowDismissalModal(true);
        setSaving(false);
        return;
      }

      if (editId) {
        const { error } = await supabase.from('employees').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employees').insert(payload);
        if (error) throw error;
      }

      // ── Sync contato na agenda ──────────────────────────────
      if (form.phone && isValidWhatsAppNumber(form.phone)) {
        try {
          const formatted = formatWhatsAppNumber(form.phone);
          // Buscar se já existe contato com esse número
          const existing = (await whatsappService.getContacts()).find(c => c.whatsapp_number === formatted);
          // Buscar categoria "Colaborador"
          const cats = await whatsappService.getCategories();
          const colabCat = cats.find(c => c.name === 'Colaborador');

          if (existing) {
            // Vincular employee_id se não vinculado
            if (!existing.employee_id) {
              const empId = editId || (await supabase.from('employees').select('id').eq('phone', form.phone).order('created_at', { ascending: false }).limit(1).single()).data?.id;
              if (empId) {
                await supabase.from('supplier_contacts').update({
                  employee_id: empId,
                  category_id: colabCat?.id || existing.category_id,
                  contact_name: form.name.trim(),
                  email: form.email || existing.email,
                  updated_at: new Date().toISOString(),
                }).eq('id', existing.id);
              }
            }
          } else {
            // Criar contato novo
            const empId = editId || (await supabase.from('employees').select('id').eq('phone', form.phone).order('created_at', { ascending: false }).limit(1).single()).data?.id;
            await whatsappService.saveContact({
              company_name: form.name.trim(),
              contact_name: form.name.trim(),
              whatsapp_number: formatted,
              email: form.email || null,
              category_id: colabCat?.id || null,
              employee_id: empId || null,
              notes: `${form.role} — ${form.sector}`,
            });
          }
        } catch {
          // Não bloqueia o save do colaborador se falhar sync do contato
        }
      }

      setShowForm(false);
      await fetchEmployees();
    } catch (err: any) {
      setFormError(err.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const [dismissalError, setDismissalError] = useState('');

  const handleConfirmDismissal = async (e: React.FormEvent) => {
    e.preventDefault();
    setDismissalError('');
    if (!pendingSavePayload || !editId) return;

    if (!dismissalForm.dismissal_date) {
      setDismissalError('Por favor, informe a data do desligamento.');
      return;
    }
    if (dismissalForm.type === 'involuntary') {
      if (!dismissalForm.involuntary_type) {
        setDismissalError('Por favor, selecione se é com ou sem justa causa.');
        return;
      }
      if (dismissalForm.involuntary_reasons.length === 0) {
        setDismissalError('Por favor, selecione pelo menos uma das opções de motivo.');
        return;
      }
    }
    if (!dismissalForm.notes.trim()) {
      setDismissalError('Por favor, preencha o campo de observações com o motivo detalhado.');
      return;
    }

    setSaving(true);
    try {
      // 1. Grava na tabela employee_dismissals
      const { error: dismError } = await supabase.from('employee_dismissals').insert({
        hotel_id: pendingSavePayload.hotel_id,
        employee_id: editId,
        dismissal_date: dismissalForm.dismissal_date,
        type: dismissalForm.type,
        voluntary_reasons: dismissalForm.type === 'voluntary' ? dismissalForm.voluntary_reasons : [],
        involuntary_type: dismissalForm.type === 'involuntary' ? dismissalForm.involuntary_type : null,
        involuntary_reason: dismissalForm.type === 'involuntary' ? dismissalForm.involuntary_reasons : null,
        notes: dismissalForm.notes.trim(),
      });
      if (dismError) throw dismError;

      // 2. Grava a atualização do colaborador (muda status para dismissed)
      const { error: empError } = await supabase.from('employees').update(pendingSavePayload).eq('id', editId);
      if (empError) throw empError;

      // ── Sync contato na agenda ──────────────────────────────
      if (pendingSavePayload.phone && isValidWhatsAppNumber(pendingSavePayload.phone)) {
        try {
          const formatted = formatWhatsAppNumber(pendingSavePayload.phone);
          const existing = (await whatsappService.getContacts()).find(c => c.whatsapp_number === formatted);
          const cats = await whatsappService.getCategories();
          const colabCat = cats.find(c => c.name === 'Colaborador');

          if (existing) {
            if (!existing.employee_id) {
              await supabase.from('supplier_contacts').update({
                employee_id: editId,
                category_id: colabCat?.id || existing.category_id,
                contact_name: pendingSavePayload.name,
                email: pendingSavePayload.email || existing.email,
                updated_at: new Date().toISOString(),
              }).eq('id', existing.id);
            }
          } else {
            await whatsappService.saveContact({
              company_name: pendingSavePayload.name,
              contact_name: pendingSavePayload.name,
              whatsapp_number: formatted,
              email: pendingSavePayload.email || null,
              category_id: colabCat?.id || null,
              employee_id: editId,
              notes: `${pendingSavePayload.role} — ${pendingSavePayload.sector}`,
            });
          }
        } catch {
          // Não bloqueia
        }
      }

      setShowDismissalModal(false);
      setPendingSavePayload(null);
      setShowForm(false);
      await fetchEmployees();
    } catch (err: any) {
      setDismissalError(err.message || 'Erro ao realizar desligamento.');
    } finally {
      setSaving(false);
    }
  };

  const renderDismissalModal = () => {
    if (!showDismissalModal) return null;

    const voluntaryOptions = [
      { id: 'proposta_externa', label: 'Proposta Externa' },
      { id: 'nao_se_adaptou', label: 'Não se adaptou' },
      { id: 'problemas_pessoais', label: 'Problemas Pessoais' },
      { id: 'desacordo_regras', label: 'Desacordo com regras' },
      { id: 'salario_abaixo_expectativa', label: 'Salário abaixo da expectativa' },
      { id: 'falta_oportunidade', label: 'Falta de oportunidade e crescimento' },
      { id: 'mudanca_cidade_pais', label: 'Mudança de cidade ou país' },
      { id: 'mudanca_carreira', label: 'Mudança de carreira' },
    ];

    const justaCausaOptions = [
      'Assédio Moral',
      'Assédio Sexual',
      'Roubo ou Furto',
      'Violência',
      'Acúmulo de Suspensão',
      'Outros',
    ];

    const semJustaCausaOptions = [
      'Fora do perfil',
      'Insubordinação',
      'Mal comportamento',
      'Indisciplina',
      'Acúmulo de advertências recorrentes',
      'Acordo Legal',
      'Acordo individual',
      'Outros',
    ];

    const toggleVoluntaryReason = (reasonId: string) => {
      setDismissalForm(f => {
        const reasons = f.voluntary_reasons.includes(reasonId)
          ? f.voluntary_reasons.filter(r => r !== reasonId)
          : [...f.voluntary_reasons, reasonId];
        return { ...f, voluntary_reasons: reasons };
      });
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => {
          setShowDismissalModal(false);
          setPendingSavePayload(null);
        }} />

        {/* Modal Content */}
        <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-150 dark:border-gray-800 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 bg-red-50 dark:bg-red-950/20 border-b border-red-100 dark:border-red-900/30 flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="text-lg font-bold">Questionário de Desligamento</h2>
            </div>
            <button onClick={() => {
              setShowDismissalModal(false);
              setPendingSavePayload(null);
            }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleConfirmDismissal} className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Nome do Colaborador (informativo) */}
            <div className="bg-gray-50 dark:bg-gray-850 p-3.5 rounded-xl border border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-450 dark:text-gray-500 uppercase tracking-wider block font-semibold">Desligando Colaborador</span>
              <span className="text-sm font-bold text-gray-800 dark:text-white">{pendingSavePayload?.name}</span>
            </div>

            {/* Data de Desligamento */}
            <div>
              <label className={labelCls}>Data do desligamento *</label>
              <input 
                type="date" 
                value={dismissalForm.dismissal_date} 
                onChange={e => setDismissalForm(f => ({ ...f, dismissal_date: e.target.value }))}
                className={inputCls} 
                required 
              />
            </div>

            {/* Tipo de Desligamento (Voluntário ou Involuntário) */}
            <div>
              <label className={labelCls}>Tipo de desligamento *</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => setDismissalForm(f => ({ ...f, type: 'voluntary' }))}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                    dismissalForm.type === 'voluntary'
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-600 dark:text-blue-400 font-bold'
                      : 'border-gray-200 dark:border-gray-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <span className="text-sm">Voluntário</span>
                  <span className="text-3xs text-gray-400 dark:text-gray-500 mt-0.5">Colaborador pede para sair</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDismissalForm(f => ({ ...f, type: 'involuntary' }))}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                    dismissalForm.type === 'involuntary'
                      ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500 text-purple-600 dark:text-purple-400 font-bold'
                      : 'border-gray-200 dark:border-gray-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <span className="text-sm">Involuntário</span>
                  <span className="text-3xs text-gray-400 dark:text-gray-500 mt-0.5">Empresa pede desligamento</span>
                </button>
              </div>
            </div>

            {/* Questionário Voluntário */}
            {dismissalForm.type === 'voluntary' && (
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Motivos de Saída (Opcionais)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                    {voluntaryOptions.map(opt => {
                      const checked = dismissalForm.voluntary_reasons.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => toggleVoluntaryReason(opt.id)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                            checked
                              ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                              : 'border-gray-250 dark:border-gray-800 text-gray-600 dark:text-gray-450 hover:bg-gray-50 dark:hover:bg-gray-800/30'
                          }`}
                        >
                          <span className={`w-4 h-4 rounded flex items-center justify-center border text-3xs transition-all ${
                            checked ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300 dark:border-gray-600'
                          }`}>
                            {checked && '✓'}
                          </span>
                          <span className="text-xs font-semibold">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Questionário Involuntário */}
            {dismissalForm.type === 'involuntary' && (
              <div className="space-y-4">
                {/* Justa Causa vs Sem Justa Causa */}
                <div>
                  <label className={labelCls}>Vertente do Desligamento *</label>
                  <div className="flex gap-6 mt-1.5">
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-gray-305 cursor-pointer">
                      <input
                        type="radio"
                        name="involuntary_type"
                        value="justa_causa"
                        checked={dismissalForm.involuntary_type === 'justa_causa'}
                        onChange={() => setDismissalForm(f => ({ ...f, involuntary_type: 'justa_causa', involuntary_reasons: [] }))}
                        className="text-purple-650 focus:ring-purple-500 dark:bg-gray-800 dark:border-gray-700"
                        required
                      />
                      Justa Causa
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-gray-305 cursor-pointer">
                      <input
                        type="radio"
                        name="involuntary_type"
                        value="sem_justa_causa"
                        checked={dismissalForm.involuntary_type === 'sem_justa_causa'}
                        onChange={() => setDismissalForm(f => ({ ...f, involuntary_type: 'sem_justa_causa', involuntary_reasons: [] }))}
                        className="text-purple-655 focus:ring-purple-500 dark:bg-gray-800 dark:border-gray-700"
                        required
                      />
                      Sem Justa Causa
                    </label>
                  </div>
                </div>

                {/* Opções de Justa Causa (multi-select) */}
                {dismissalForm.involuntary_type === 'justa_causa' && (
                  <div>
                    <label className={labelCls}>Motivo da Justa Causa * <span className="font-normal text-gray-400">(selecione um ou mais)</span></label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                      {justaCausaOptions.map(opt => {
                        const checked = dismissalForm.involuntary_reasons.includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setDismissalForm(f => ({
                              ...f,
                              involuntary_reasons: checked
                                ? f.involuntary_reasons.filter(r => r !== opt)
                                : [...f.involuntary_reasons, opt],
                            }))}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                              checked
                                ? 'bg-purple-50/55 dark:bg-purple-900/10 border-purple-300 dark:border-purple-800 text-purple-750 dark:text-purple-350'
                                : 'border-gray-250 dark:border-gray-800 text-gray-650 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/30'
                            }`}
                          >
                            <span className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                              checked ? 'bg-purple-500 border-purple-500 text-white' : 'border-gray-300 dark:border-gray-600'
                            }`}>
                              {checked && <Check className="w-3 h-3" />}
                            </span>
                            <span className="text-xs font-semibold">{opt}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Opções Sem Justa Causa (multi-select) */}
                {dismissalForm.involuntary_type === 'sem_justa_causa' && (
                  <div>
                    <label className={labelCls}>Motivo da demissão sem justa causa * <span className="font-normal text-gray-400">(selecione um ou mais)</span></label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                      {semJustaCausaOptions.map(opt => {
                        const checked = dismissalForm.involuntary_reasons.includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setDismissalForm(f => ({
                              ...f,
                              involuntary_reasons: checked
                                ? f.involuntary_reasons.filter(r => r !== opt)
                                : [...f.involuntary_reasons, opt],
                            }))}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                              checked
                                ? 'bg-purple-50/55 dark:bg-purple-900/10 border-purple-300 dark:border-purple-800 text-purple-750 dark:text-purple-350'
                                : 'border-gray-250 dark:border-gray-800 text-gray-655 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/30'
                            }`}
                          >
                            <span className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                              checked ? 'bg-purple-500 border-purple-500 text-white' : 'border-gray-300 dark:border-gray-600'
                            }`}>
                              {checked && <Check className="w-3 h-3" />}
                            </span>
                            <span className="text-xs font-semibold">{opt}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Observações / Descrição Livre (Obrigatória em todos) */}
            <div>
              <label className={labelCls}>Observações (Descreva em detalhes o motivo) *</label>
              <textarea
                value={dismissalForm.notes}
                onChange={e => setDismissalForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Descreva aqui o motivo detalhado..."
                rows={3}
                className={inputCls}
                required
              />
            </div>

            {dismissalError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p className="font-semibold">{dismissalError}</p>
              </div>
            )}

            {/* Footer / Ações */}
            <div className="pt-4 border-t border-gray-150 dark:border-gray-800 flex justify-end gap-3 sticky bottom-0 bg-white dark:bg-gray-900 z-10 pb-2">
              <button
                type="button"
                onClick={() => {
                  setShowDismissalModal(false);
                  setPendingSavePayload(null);
                }}
                className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-md hover:shadow-lg disabled:opacity-50 transition-all cursor-pointer"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar Desligamento
              </button>
            </div>
          </form>
        </div>
      </div>
    );
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
            </div>
          </section>

          {/* ── Endereço ── */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center text-cyan-600 dark:text-cyan-400 text-xs font-bold">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              </span>
              Endereço
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>CEP</label>
                <div className="relative">
                  <input type="text" value={form.address_cep}
                    onChange={e => handleCepChange(e.target.value)}
                    onBlur={() => { const d = form.address_cep.replace(/\D/g, ''); if (d.length === 8) lookupCep(d); }}
                    placeholder="00000-000" className={inputCls} />
                  {cepLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-cyan-500" />}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Rua</label>
                <input type="text" value={form.address_street} onChange={e => setForm(f => ({ ...f, address_street: e.target.value }))}
                  placeholder="Nome da rua" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Nº</label>
                <input type="text" value={form.address_number} onChange={e => setForm(f => ({ ...f, address_number: e.target.value }))}
                  placeholder="Nº" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Bairro</label>
                <input type="text" value={form.address_neighborhood} onChange={e => setForm(f => ({ ...f, address_neighborhood: e.target.value }))}
                  placeholder="Bairro" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Cidade</label>
                <input type="text" value={form.address_city} onChange={e => setForm(f => ({ ...f, address_city: e.target.value }))}
                  placeholder="Cidade" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Estado</label>
                <select value={form.address_state} onChange={e => setForm(f => ({ ...f, address_state: e.target.value }))}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Selecione</option>
                  {UF_OPTIONS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
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
                    const days = differenceInDays(new Date(form.experience_end), new Date());
                    return (
                      <p className={`text-xs mt-1.5 font-medium ${days < 0 ? 'text-red-500' : days <= 30 ? 'text-amber-500' : 'text-gray-400'}`}>
                        {days < 0 ? `Vencido há ${Math.abs(days)} dias` : `Vence em ${days} dias — ${format(new Date(form.experience_end), 'dd/MM/yyyy')}`}
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

        {/* Report button */}
        <button onClick={() => setShowReport(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-indigo-200 dark:shadow-indigo-900/30 ml-auto"
          title="Gerar relatório de colaboradores">
          <FileText className="h-4 w-4" />
          <span className="hidden sm:inline">Relatório</span>
        </button>

        {/* Add button */}
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-blue-200 dark:shadow-blue-900/30">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Novo colaborador</span>
          <span className="sm:hidden">Novo</span>
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
                    <span>Desde {format(new Date(emp.admission_date), 'dd/MM/yyyy')}</span>
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
                  <button onClick={() => openTransfer(emp)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-xl transition-colors">
                    <ArrowRightLeft className="h-3.5 w-3.5" />Transferir
                  </button>
                  {emp.status === 'inactive' && (
                    <button onClick={() => { setDeleteError(''); setDeleteEmp(emp); }}
                      title="Excluir cadastro"
                      className="flex items-center justify-center px-2.5 py-2 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* ── Modal de Transferência ─────────────────────────────────── */}
      {transferEmp && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                  <ArrowRightLeft className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 dark:text-white">Transferir Colaborador</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{transferEmp.name}</p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Unidade atual</label>
                <div className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700 text-sm text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-600">
                  {(transferEmp as any).hotel?.name || hotels.find(h => h.id === transferEmp.hotel_id)?.name || '—'}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Transferir para *</label>
                <select value={transferHotel} onChange={e => setTransferHotel(e.target.value)}
                  className="w-full rounded-xl border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm">
                  <option value="">Selecione a unidade destino...</option>
                  {hotels.filter(h => h.id !== transferEmp.hotel_id).map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Data da transferência *</label>
                <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)}
                  className="w-full rounded-xl border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Motivo (opcional)</label>
                <textarea value={transferReason} onChange={e => setTransferReason(e.target.value)}
                  placeholder="Ex.: necessidade operacional, pedido do colaborador..."
                  rows={2} className="w-full rounded-xl border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm resize-none" />
              </div>
              <div className="flex items-start gap-2 p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-900/40 text-xs text-violet-700 dark:text-violet-300">
                <ArrowRightLeft className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <p>O histórico de faltas, atestados, escala e uniformes <strong>permanece vinculado ao colaborador</strong> e segue visível na ficha independente da unidade.</p>
              </div>
              {transferError && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{transferError}</p>}
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button onClick={() => setTransferEmp(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Cancelar
              </button>
              <button onClick={handleTransfer} disabled={transferSaving || !transferHotel || !transferDate}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                {transferSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                {transferSaving ? 'Transferindo...' : 'Confirmar transferência'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de Exclusão (soft-delete) ─────────────────────────── */}
      {deleteEmp && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 dark:text-white">Excluir Cadastro</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{deleteEmp.name}</p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Este cadastro deixará de aparecer em qualquer lista, relatório ou tela do sistema.
              </p>
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <p>
                  <strong>Os dados não são apagados do banco de dados.</strong> A única forma de recuperar este
                  cadastro é acessando o sistema diretamente e alterando o status manualmente.
                </p>
              </div>
              {deleteError && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{deleteError}</p>}
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button onClick={() => setDeleteEmp(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={handleSoftDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {deleting ? 'Excluindo...' : 'Confirmar exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de desligamento */}
      {showDismissalModal && renderDismissalModal()}

      {/* Relatório de colaboradores */}
      <EmployeesReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        employees={employees as any}
        hotelName={selectedHotel?.name || 'Hotel'}
      />
    </div>
  );
}