// src/pages/dp/DPEmployeeDetail.tsx
// Ficha completa do colaborador: dados, contratos, uniformes, histórico de entregas e Termo PDF

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowLeft, Loader2, AlertTriangle, User, Phone, Mail, MapPin,
  Calendar, Briefcase, Building2, FileText, Plus, Clock, CheckCircle,
  AlertCircle, Shirt, Package, Edit2, X, Printer, Hash,
  Link2, UserCheck, UserX, Search, ShieldOff,
} from 'lucide-react';
import { format, differenceInDays, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Converte "YYYY-MM-DD" → Date LOCAL, sem conversão UTC (evita bug de -1 dia)
const parseLocalDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Employee {
  id: string; hotel_id: string; user_id: string | null;
  name: string; cpf: string | null; rg: string | null;
  phone: string | null; email: string | null; birth_date: string | null;
  address: string | null; role: string; sector: string;
  admission_date: string; contract_type: string; experience_end: string | null;
  status: string;
  shirt_size: string | null; pants_size: string | null; shoe_size: string | null;
  hat_size: string | null; apron_size: string | null; raincoat_size: string | null;
  epi_items: string[]; notes: string | null; photo_url: string | null;
  hotels?: { name: string };
}

interface DeliveryItem { item: string; qty: number; size: string; }

interface Delivery {
  id: string; employee_id: string; hotel_id: string;
  delivery_date: string; items: DeliveryItem[]; notes: string | null;
  doc_generated: boolean; doc_url: string | null; registered_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const UNIFORM_ITEMS = [
  { key: 'blusa',      label: 'Blusa / Camiseta' },
  { key: 'calca',      label: 'Calça' },
  { key: 'sapato',     label: 'Sapato / Bota' },
  { key: 'touca',      label: 'Touca' },
  { key: 'avental',    label: 'Avental' },
  { key: 'capa_chuva', label: 'Capa de chuva' },
];

const EPI_OPTIONS = [
  'Luva de borracha', 'Luva de malha de aço', 'Óculos de proteção',
  'Protetor auricular', 'Bota de segurança', 'Capacete',
  'Máscara respiratória', 'Cinto de segurança', 'Colete refletivo',
];

const CONTRACT_LABELS: Record<string, string> = {
  experiencia: 'Contrato de Experiência',
  determinado: 'Contrato Determinado',
  clt:         'CLT (Indeterminado)',
  pj:          'PJ',
  estagio:     'Estágio',
  temporario:  'Temporário',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  active:    { label: 'Ativo',     color: 'text-green-700 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', dot: 'bg-green-500' },
  inactive:  { label: 'Inativo',   color: 'text-gray-500',                      bg: 'bg-gray-50 dark:bg-gray-800',      dot: 'bg-gray-400'  },
  dismissed: { label: 'Desligado', color: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-900/20',     dot: 'bg-red-500'   },
};

const inputCls = `w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
  placeholder:text-gray-400 transition-all`;
const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function calcExperienceDates(admissionDate: string) {
  const base  = parseLocalDate(admissionDate);
  const fase1 = new Date(base); fase1.setDate(fase1.getDate() + 30);
  const fase2 = new Date(base); fase2.setDate(fase2.getDate() + 90);
  return { fase1, fase2 };
}

function getEmployeeUniformSize(emp: Employee, itemKey: string): string | null {
  const map: Record<string, string | null> = {
    blusa:      emp.shirt_size,
    calca:      emp.pants_size,
    sapato:     emp.shoe_size,
    touca:      emp.hat_size,
    avental:    emp.apron_size,
    capa_chuva: emp.raincoat_size,
  };
  return map[itemKey] || null;
}

function needsUniformRenewal(deliveries: Delivery[]): boolean {
  if (!deliveries.length) return true;
  const last = new Date(deliveries[0].delivery_date);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return last <= sixMonthsAgo;
}

// ---------------------------------------------------------------------------
// PDF — Termo de Responsabilidade (abre janela de impressão)
// ---------------------------------------------------------------------------
function generateTermoPDF(emp: Employee, delivery: Delivery, hotelName: string) {
  const itemsList = delivery.items
    .map(i => `${i.qty}x ${i.item}${i.size ? ` (${i.size})` : ''}`)
    .join(', ');

  const dateFormatted = format(
    new Date(delivery.delivery_date),
    "dd 'de' MMMM 'de' yyyy",
    { locale: ptBR }
  );

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Termo — ${emp.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      color: #000;
      background: #fff;
      padding: 60px 80px;
      line-height: 1.7;
    }
    h1 {
      text-align: center;
      font-size: 13pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 48px;
    }
    .underline-field {
      display: inline-block;
      border-bottom: 1px solid #000;
      min-width: 280px;
      vertical-align: bottom;
      margin: 0 4px;
      padding-bottom: 1px;
    }
    p { margin-bottom: 18px; }
    .items-label { font-weight: bold; }
    .declaration { text-align: justify; }
    .meta { margin-top: 8px; }
    .signatures {
      margin-top: 90px;
      display: flex;
      justify-content: space-between;
    }
    .sig-block { text-align: center; width: 44%; }
    .sig-line { border-bottom: 1px solid #000; margin-bottom: 10px; width: 100%; }
    .sig-label { font-size: 10pt; line-height: 1.5; }
    @media print {
      @page { size: A4; margin: 20mm 25mm; }
    }
  </style>
</head>
<body>
  <h1>Termo de Responsabilidade e Recebimento de Itens</h1>

  <p>
    Eu,&nbsp;<span class="underline-field">${emp.name}</span>,&nbsp;recebi do ${hotelName} os seguintes itens:
  </p>

  <p class="items-label">Itens Recebidos: ${itemsList}</p>

  <p class="declaration">
    Declaro estar ciente de que os itens fornecidos são de propriedade da empresa e devem
    ser utilizados adequadamente no desempenho das minhas funções. Comprometo-me a
    zelar pela sua conservação e devolvê-los nas mesmas condições em que foram
    recebidos, salvo desgaste natural decorrente do uso regular.
  </p>

  <div class="meta">
    <p><strong>Data:</strong>&nbsp;${dateFormatted}</p>
    <p><strong>Localidade:</strong>&nbsp;${hotelName}</p>
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-label">Assinatura do Colaborador</div>
    </div>
    <div class="sig-block">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-label">Responsável pela Entrega<br>${hotelName}</div>
    </div>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=850,height=950');
  if (!win) { alert('Permita popups para gerar o documento.'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function DPEmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate  = useNavigate();

  const [employee,   setEmployee]   = useState<Employee | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState<'info' | 'uniforms' | 'history'>('info');

  // Vinculação de usuário do sistema
  const [linkedUser,        setLinkedUser]        = useState<{ id: string; email: string; full_name: string | null } | null>(null);
  const [showLinkModal,     setShowLinkModal]     = useState(false);
  const [userSearchTerm,    setUserSearchTerm]    = useState('');
  const [userSearchResults, setUserSearchResults] = useState<{ id: string; email: string; full_name: string | null }[]>([]);
  const [searchingUsers,    setSearchingUsers]    = useState(false);
  const [linkingUser,       setLinkingUser]       = useState(false);
  const [linkError,         setLinkError]         = useState('');

  // Delivery form
  const [showDelivery,   setShowDelivery]   = useState(false);
  const [deliveryDate,   setDeliveryDate]   = useState(format(new Date(), 'yyyy-MM-dd'));
  const [deliveryItems,  setDeliveryItems]  = useState<DeliveryItem[]>([]);
  const [deliveryNotes,  setDeliveryNotes]  = useState('');
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [deliveryError,  setDeliveryError]  = useState('');

  // ---------------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [empRes, delRes] = await Promise.all([
        supabase.from('employees').select('*, hotels:hotel_id(name)').eq('id', id).single(),
        supabase.from('uniform_deliveries').select('*').eq('employee_id', id).order('delivery_date', { ascending: false }),
      ]);
      if (empRes.data) {
        setEmployee(empRes.data as Employee);
        // Se tem user_id vinculado, busca os dados do perfil
        if (empRes.data.user_id) {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('id, full_name')
            .eq('id', empRes.data.user_id)
            .maybeSingle();
          // Busca email via auth_users_safe (view segura)
          const { data: authData } = await supabase
            .from('auth_users_safe')
            .select('id, email')
            .eq('id', empRes.data.user_id)
            .maybeSingle();
          if (authData) {
            setLinkedUser({
              id:        authData.id,
              email:     authData.email,
              full_name: profileData?.full_name || null,
            });
          }
        } else {
          setLinkedUser(null);
        }
      }
      setDeliveries((delRes.data || []) as Delivery[]);
    } catch (err) {
      console.error('Erro ao carregar colaborador:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ---------------------------------------------------------------------------
  // Delivery helpers
  // ---------------------------------------------------------------------------
  const addDeliveryItem = () =>
    setDeliveryItems(prev => [...prev, { item: UNIFORM_ITEMS[0].label, qty: 1, size: '' }]);

  const updateDeliveryItem = (i: number, field: keyof DeliveryItem, value: string | number) =>
    setDeliveryItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it));

  const removeDeliveryItem = (i: number) =>
    setDeliveryItems(prev => prev.filter((_, idx) => idx !== i));

  const prefillFromEmployee = () => {
    if (!employee) return;
    const items: DeliveryItem[] = [];
    UNIFORM_ITEMS.forEach(u => {
      const size = getEmployeeUniformSize(employee, u.key);
      if (size) items.push({ item: u.label, qty: 1, size });
    });
    employee.epi_items?.forEach(epi => items.push({ item: epi, qty: 1, size: '' }));
    setDeliveryItems(items);
  };

  const handleSaveDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeliveryError('');
    if (!employee)          { setDeliveryError('Colaborador inválido.'); return; }
    if (!deliveryDate)      { setDeliveryError('Informe a data da entrega.'); return; }
    if (!deliveryItems.length) { setDeliveryError('Adicione ao menos um item.'); return; }

    setSavingDelivery(true);
    try {
      const { error } = await supabase.from('uniform_deliveries').insert({
        employee_id:   employee.id,
        hotel_id:      employee.hotel_id,
        delivery_date: deliveryDate,
        items:         deliveryItems,
        notes:         deliveryNotes || null,
        registered_by: user?.id,
      });
      if (error) throw error;
      setShowDelivery(false);
      setDeliveryItems([]);
      setDeliveryNotes('');
      setDeliveryDate(format(new Date(), 'yyyy-MM-dd'));
      await fetchData();
      setActiveTab('history');
    } catch (err: any) {
      setDeliveryError(err.message || 'Erro ao salvar entrega.');
    } finally {
      setSavingDelivery(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Buscar usuários do sistema para vincular
  // ---------------------------------------------------------------------------
  const handleUserSearch = async (term: string) => {
    setUserSearchTerm(term);
    if (term.trim().length < 2) { setUserSearchResults([]); return; }
    setSearchingUsers(true);
    try {
      // Busca por email na view auth_users_safe
      const { data: authData } = await supabase
        .from('auth_users_safe')
        .select('id, email')
        .ilike('email', `%${term}%`)
        .limit(8);

      if (!authData?.length) { setUserSearchResults([]); setSearchingUsers(false); return; }

      // Busca full_name dos profiles
      const ids = authData.map(u => u.id);
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', ids);

      const profileMap = Object.fromEntries((profileData || []).map(p => [p.id, p.full_name]));
      setUserSearchResults(authData.map(u => ({
        id:        u.id,
        email:     u.email,
        full_name: profileMap[u.id] || null,
      })));
    } catch (err) {
      console.error('Erro ao buscar usuários:', err);
    } finally {
      setSearchingUsers(false);
    }
  };

  // Vincular usuário ao colaborador
  const handleLinkUser = async (userId: string, userEmail: string, userFullName: string | null) => {
    if (!employee) return;
    setLinkingUser(true);
    setLinkError('');
    try {
      const { error } = await supabase
        .from('employees')
        .update({ user_id: userId })
        .eq('id', employee.id);
      if (error) throw error;
      setEmployee(prev => prev ? { ...prev, user_id: userId } : prev);
      setLinkedUser({ id: userId, email: userEmail, full_name: userFullName });
      setShowLinkModal(false);
      setUserSearchTerm('');
      setUserSearchResults([]);
    } catch (err: any) {
      setLinkError(err.message || 'Erro ao vincular usuário.');
    } finally {
      setLinkingUser(false);
    }
  };

  // Desvincular usuário
  const handleUnlinkUser = async () => {
    if (!employee || !linkedUser) return;
    if (!confirm(`Desvincular ${linkedUser.email} deste colaborador?`)) return;
    setLinkingUser(true);
    try {
      const { error } = await supabase
        .from('employees')
        .update({ user_id: null })
        .eq('id', employee.id);
      if (error) throw error;
      setEmployee(prev => prev ? { ...prev, user_id: null } : prev);
      setLinkedUser(null);
    } catch (err: any) {
      console.error('Erro ao desvincular:', err);
    } finally {
      setLinkingUser(false);
    }
  };

  // ---------------------------------------------------------------------------
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  );

  if (!employee) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-gray-400">
      <AlertTriangle className="h-10 w-10 opacity-30" />
      <p className="text-sm">Colaborador não encontrado.</p>
      <button onClick={() => navigate('/personnel-department')} className="text-blue-500 hover:underline text-sm">Voltar</button>
    </div>
  );

  const hotelName    = (employee.hotels as any)?.name || 'Hotel';
  const initials     = employee.name.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase();
  const sCfg         = STATUS_CONFIG[employee.status] ?? STATUS_CONFIG.active;
  const renewal      = needsUniformRenewal(deliveries);
  const lastDelivery = deliveries[0] || null;
  const isExp        = employee.contract_type === 'experiencia';
  const expDates     = isExp && employee.admission_date ? calcExperienceDates(employee.admission_date) : null;
  const hasEndDate   = ['determinado', 'estagio', 'temporario'].includes(employee.contract_type);

  // ---------------------------------------------------------------------------
  // Delivery modal
  // ---------------------------------------------------------------------------
  const DeliveryModal = () => (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDelivery(false)} />
      <div className="relative w-full sm:max-w-2xl bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto">

        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-3xl">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Registrar Entrega de Uniforme</h2>
            <p className="text-xs text-gray-500 mt-0.5">{employee.name}</p>
          </div>
          <button onClick={() => setShowDelivery(false)}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSaveDelivery} className="p-6 space-y-5">
          <div>
            <label className={labelCls}>Data da entrega *</label>
            <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
              className={inputCls} required />
            <p className="text-xs text-gray-400 mt-1.5">Pode ser uma data retroativa.</p>
          </div>

          {(employee.shirt_size || employee.pants_size || employee.shoe_size || employee.hat_size || employee.apron_size || employee.raincoat_size || employee.epi_items?.length > 0) && (
            <button type="button" onClick={prefillFromEmployee}
              className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
              <Shirt className="h-4 w-4" />Pré-preencher com os tamanhos cadastrados
            </button>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls}>Itens entregues *</label>
              <button type="button" onClick={addDeliveryItem}
                className="flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                <Plus className="h-3.5 w-3.5" />Adicionar item
              </button>
            </div>

            {deliveryItems.length === 0 && (
              <div className="text-center py-6 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
                <Package className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-xs text-gray-400">Nenhum item adicionado ainda.</p>
              </div>
            )}

            <div className="space-y-2">
              {deliveryItems.map((it, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input type="text" value={it.item}
                    onChange={e => updateDeliveryItem(i, 'item', e.target.value)}
                    list="uniform-items-list" placeholder="Item..." className={`${inputCls} flex-1`} />
                  <input type="number" min="1" value={it.qty}
                    onChange={e => updateDeliveryItem(i, 'qty', parseInt(e.target.value) || 1)}
                    className={`${inputCls} w-16`} placeholder="Qtd" />
                  <input type="text" value={it.size}
                    onChange={e => updateDeliveryItem(i, 'size', e.target.value)}
                    className={`${inputCls} w-20`} placeholder="Tam." />
                  <button type="button" onClick={() => removeDeliveryItem(i)}
                    className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-red-500 flex-shrink-0 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <datalist id="uniform-items-list">
              {UNIFORM_ITEMS.map(u => <option key={u.key} value={u.label} />)}
              {EPI_OPTIONS.map(e => <option key={e} value={e} />)}
            </datalist>
          </div>

          <div>
            <label className={labelCls}>Observações</label>
            <textarea value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)}
              rows={2} placeholder="Notas adicionais..." className={`${inputCls} resize-none`} />
          </div>

          {deliveryError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />{deliveryError}
            </div>
          )}

          <div className="flex gap-3 pb-2">
            <button type="button" onClick={() => setShowDelivery(false)}
              className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={savingDelivery}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors">
              {savingDelivery ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : 'Registrar entrega'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Tab: Informações
  // ---------------------------------------------------------------------------
  const TabInfo = () => (
    <div className="space-y-4">
      {/* Dados pessoais */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Dados Pessoais</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([
            employee.phone      && { icon: Phone,    label: 'Telefone',    value: employee.phone },
            employee.email      && { icon: Mail,     label: 'E-mail',      value: employee.email },
            employee.cpf        && { icon: Hash,     label: 'CPF',         value: employee.cpf },
            employee.rg         && { icon: Hash,     label: 'RG',          value: employee.rg },
            employee.birth_date && { icon: Calendar, label: 'Nascimento',  value: format(parseLocalDate(employee.birth_date), 'dd/MM/yyyy') },
            employee.address    && { icon: MapPin,   label: 'Endereço',    value: employee.address },
          ] as any[]).filter(Boolean).map((item: any, i: number) => {
            const Icon = item.icon;
            return (
              <div key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-3.5 w-3.5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">{item.label}</p>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200 break-all">{item.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dados funcionais */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Dados Funcionais</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { icon: Briefcase, label: 'Cargo',    value: employee.role },
            { icon: Building2, label: 'Setor',    value: employee.sector },
            { icon: Building2, label: 'Hotel',    value: hotelName },
            { icon: Calendar,  label: 'Admissão', value: format(parseLocalDate(employee.admission_date), 'dd/MM/yyyy') },
          ].map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-3.5 w-3.5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">{item.label}</p>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{item.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Contrato */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Contrato</h3>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
            <FileText className="h-3.5 w-3.5 text-gray-400" />
          </div>
          <div>
            <p className="text-xs text-gray-400">Tipo</p>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {CONTRACT_LABELS[employee.contract_type] || employee.contract_type}
            </p>
          </div>
        </div>

        {/* Experiência — 2 fases automáticas */}
        {isExp && expDates && (
          <div className="grid grid-cols-2 gap-3">
            {([
              { label: '1ª fase (30 dias)', date: expDates.fase1 },
              { label: '2ª fase (+60 dias)', date: expDates.fase2 },
            ] as { label: string; date: Date }[]).map(({ label, date }) => {
              const days    = differenceInDays(date, new Date());
              const isPast  = days < 0;
              const isAlert = !isPast && days <= 15;
              const isWarn  = !isPast && days > 15 && days <= 30;
              const cls = isPast || isAlert
                ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                : isWarn
                ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800';
              const txtCls = isPast || isAlert ? 'text-red-600 dark:text-red-400'
                : isWarn ? 'text-amber-600 dark:text-amber-400'
                : 'text-blue-600 dark:text-blue-400';
              return (
                <div key={label} className={`p-4 rounded-2xl border ${cls}`}>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                  <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{format(date, 'dd/MM/yyyy')}</p>
                  <p className={`text-xs mt-1 font-medium ${txtCls}`}>
                    {isPast ? `Vencida há ${Math.abs(days)}d` : `Em ${days} dias`}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Determinado / estágio / temporário */}
        {hasEndDate && employee.experience_end && (() => {
          const days   = differenceInDays(parseLocalDate(employee.experience_end), new Date());
          const isPast = days < 0;
          const isWarn = !isPast && days <= 30;
          return (
            <div className={`p-4 rounded-2xl border ${isPast ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : isWarn ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800'}`}>
              <p className="text-xs font-semibold text-gray-500 mb-1">Fim do contrato</p>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{format(parseLocalDate(employee.experience_end), 'dd/MM/yyyy')}</p>
              <p className={`text-xs mt-1 font-medium ${isPast ? 'text-red-600' : isWarn ? 'text-amber-600' : 'text-blue-600'}`}>
                {isPast ? `Vencido há ${Math.abs(days)}d` : `Em ${days} dias`}
              </p>
            </div>
          );
        })()}
      </div>

      {/* Observações */}
      {employee.notes && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Observações</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{employee.notes}</p>
        </div>
      )}

      {/* ── Acesso ao Sistema ──────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Acesso ao Sistema</h3>
          {linkedUser ? (
            <button
              onClick={handleUnlinkUser}
              disabled={linkingUser}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 disabled:opacity-50 transition-colors"
            >
              <UserX className="h-3.5 w-3.5" />
              Desvincular
            </button>
          ) : (
            <button
              onClick={() => { setShowLinkModal(true); setLinkError(''); setUserSearchTerm(''); setUserSearchResults([]); }}
              className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
            >
              <Link2 className="h-3.5 w-3.5" />
              Vincular usuário
            </button>
          )}
        </div>

        {linkedUser ? (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
            <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
              <UserCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
                {linkedUser.full_name || linkedUser.email}
              </p>
              {linkedUser.full_name && (
                <p className="text-xs text-gray-400 truncate">{linkedUser.email}</p>
              )}
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 uppercase tracking-wide flex-shrink-0">
              Ativo
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/40 border border-dashed border-gray-200 dark:border-gray-600">
            <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
              <ShieldOff className="h-4 w-4 text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Sem acesso vinculado</p>
              <p className="text-xs text-gray-400 mt-0.5">Vincule uma conta para registrar ações no nome deste colaborador</p>
            </div>
          </div>
        )}

        {/* Status warning se demitido/inativo */}
        {employee.status !== 'active' && linkedUser && (
          <div className="flex items-center gap-2 mt-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Colaborador inativo — acesso do sistema rebaixado para Convidado automaticamente.
            </p>
          </div>
        )}
      </div>

      {/* ── Modal de busca de usuário ──────────────────────────────────── */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLinkModal(false)} />
          <div className="relative w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] overflow-hidden flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Vincular Usuário do Sistema</h2>
                <p className="text-xs text-gray-400 mt-0.5">Busque pelo e-mail da conta Google</p>
              </div>
              <button onClick={() => setShowLinkModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Busca */}
            <div className="px-5 pt-4 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  autoFocus
                  value={userSearchTerm}
                  onChange={e => handleUserSearch(e.target.value)}
                  placeholder="Digite o e-mail do colaborador..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400"
                />
              </div>
              {linkError && (
                <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {linkError}
                </p>
              )}
            </div>

            {/* Resultados */}
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {searchingUsers ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                </div>
              ) : userSearchResults.length > 0 ? (
                <div className="space-y-2 mt-2">
                  {userSearchResults.map(u => (
                    <button
                      key={u.id}
                      onClick={() => handleLinkUser(u.id, u.email, u.full_name)}
                      disabled={linkingUser}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all text-left disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-white">
                          {(u.full_name || u.email)[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        {u.full_name && (
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{u.full_name}</p>
                        )}
                        <p className="text-xs text-gray-400 truncate">{u.email}</p>
                      </div>
                      {linkingUser ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500 flex-shrink-0" />
                      ) : (
                        <Link2 className="h-4 w-4 text-blue-400 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ) : userSearchTerm.length >= 2 ? (
                <div className="text-center py-8 text-gray-400">
                  <User className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma conta encontrada</p>
                  <p className="text-xs mt-1">O colaborador precisa fazer login via Google primeiro</p>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-300 dark:text-gray-600">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Digite o e-mail para buscar</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Tab: Uniformes
  // ---------------------------------------------------------------------------
  const TabUniforms = () => (
    <div className="space-y-4">
      {/* Alerta renovação */}
      {renewal && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl">
          <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Renovação necessária</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              {lastDelivery
                ? `Última entrega ${formatDistanceToNow(new Date(lastDelivery.delivery_date), { locale: ptBR, addSuffix: true })}. Política: troca a cada 6 meses.`
                : 'Nenhuma entrega registrada ainda.'}
            </p>
          </div>
          <button onClick={() => setShowDelivery(true)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-colors">
            <Plus className="h-3.5 w-3.5" />Registrar
          </button>
        </div>
      )}

      {/* Tamanhos */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Tamanhos Cadastrados</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {UNIFORM_ITEMS.map(u => {
            const size = getEmployeeUniformSize(employee, u.key);
            return (
              <div key={u.key} className={`p-3 rounded-xl border text-center transition-opacity ${size ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-40'}`}>
                <p className="text-xs text-gray-400 mb-1">{u.label}</p>
                <p className={`text-lg font-bold ${size ? 'text-blue-700 dark:text-blue-300' : 'text-gray-400'}`}>
                  {size || '—'}
                </p>
              </div>
            );
          })}
        </div>

        {employee.epi_items?.length > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">EPIs</p>
            <div className="flex flex-wrap gap-2">
              {employee.epi_items.map(epi => (
                <span key={epi} className="px-3 py-1.5 text-xs font-medium bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 rounded-xl">
                  {epi}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Tab: Histórico
  // ---------------------------------------------------------------------------
  const TabHistory = () => (
    <div className="space-y-3">
      {deliveries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Package className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhuma entrega registrada.</p>
          <button onClick={() => setShowDelivery(true)} className="text-sm text-blue-500 hover:underline">
            Registrar primeira entrega
          </button>
        </div>
      ) : deliveries.map(del => (
        <div key={del.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                {format(new Date(del.delivery_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Registrado {formatDistanceToNow(new Date(del.registered_at), { locale: ptBR, addSuffix: true })}
              </p>
            </div>
            <button
              onClick={() => generateTermoPDF(employee, del, hotelName)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-gray-200 dark:border-gray-600 hover:border-blue-300 text-gray-600 dark:text-gray-300 hover:text-blue-600 text-xs font-semibold rounded-xl transition-all">
              <Printer className="h-3.5 w-3.5" />Emitir Termo
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-2">
            {del.items.map((it, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg border border-blue-100 dark:border-blue-800">
                {it.qty}x {it.item}{it.size ? ` (${it.size})` : ''}
              </span>
            ))}
          </div>

          {del.notes && <p className="text-xs text-gray-400 italic">{del.notes}</p>}
        </div>
      ))}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-24">

      {showDelivery && <DeliveryModal />}

      <button onClick={() => navigate('/personnel-department')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" />Voltar ao DP
      </button>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-6 mb-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0 shadow-md">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{employee.name}</h1>
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${sCfg.bg} ${sCfg.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sCfg.dot}`} />{sCfg.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{employee.role} · {employee.sector}</p>
            <p className="text-xs text-gray-400 mt-0.5">{hotelName}</p>
          </div>
          <button onClick={() => navigate('/personnel-department')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-500 hover:text-blue-600 border border-gray-200 dark:border-gray-700 hover:border-blue-300 rounded-xl transition-all flex-shrink-0">
            <Edit2 className="h-3.5 w-3.5" />Editar
          </button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-gray-100 dark:border-gray-700">
          {[
            { label: 'Entregas', value: deliveries.length.toString(), color: 'text-gray-900 dark:text-white' },
            {
              label: 'Última entrega',
              value: lastDelivery ? formatDistanceToNow(new Date(lastDelivery.delivery_date), { locale: ptBR }) : '—',
              color: 'text-gray-900 dark:text-white',
            },
            {
              label: 'Uniforme',
              value: renewal ? 'Pendente' : 'OK',
              color: renewal ? 'text-amber-500' : 'text-green-600 dark:text-green-400',
            },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className={`text-base font-bold leading-tight ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-2xl mb-5">
        {([
          { id: 'info',     label: 'Informações',          icon: User    },
          { id: 'uniforms', label: 'Uniformes',            icon: Shirt   },
          { id: 'history',  label: `Histórico (${deliveries.length})`, icon: Package },
        ] as { id: 'info' | 'uniforms' | 'history'; label: string; icon: any }[]).map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all flex-1 justify-center ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
              }`}>
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === 'info'     && <TabInfo />}
      {activeTab === 'uniforms' && <TabUniforms />}
      {activeTab === 'history'  && <TabHistory />}

      {/* FAB */}
      <div className="fixed bottom-6 right-6 z-40">
        <button onClick={() => setShowDelivery(true)}
          className="flex items-center gap-2 px-5 py-3.5 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-2xl shadow-xl shadow-blue-200 dark:shadow-blue-900/40 transition-all hover:scale-105 active:scale-95">
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Registrar entrega</span>
          <span className="sm:hidden">Entrega</span>
        </button>
      </div>
    </div>
  );
}