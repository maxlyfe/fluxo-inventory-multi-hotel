// src/pages/dp/DPEmployeeDetail.tsx
// Ficha completa do colaborador: dados, contratos, uniformes, histórico de entregas e Termo PDF

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useGroup } from '../../context/GroupContext';
import {
  ArrowLeft, Loader2, AlertTriangle, User, Phone, Mail, MapPin,
  Calendar, Briefcase, Building2, FileText, Plus, Clock, CheckCircle,
  AlertCircle, Shirt, Package, Edit2, X, Printer, Hash, Trash2,
  Link2, UserCheck, UserX, Search, ShieldOff, GraduationCap, Stethoscope,
} from 'lucide-react';
import { format, differenceInDays, differenceInMonths, differenceInYears, formatDistanceToNow } from 'date-fns';
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
  address: string | null;
  address_cep: string | null; address_street: string | null;
  address_number: string | null; address_neighborhood: string | null;
  address_city: string | null; address_state: string | null;
  role: string; sector: string;
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
function generateTermoPDF(emp: Employee, item: DeliveryItem, deliveryDate: string, hotelName: string, groupName: string) {
  const itemDesc = `${item.qty}x ${item.item}${item.size ? ` (${item.size})` : ''}`;
  const dateFormatted = format(parseLocalDate(deliveryDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  const locality = 'Armação dos Búzios';

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
      line-height: 1.8;
    }
    h1 {
      text-align: center;
      font-size: 14pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 48px;
    }
    .underline-field {
      display: inline-block;
      border-bottom: 1px solid #000;
      min-width: 300px;
      vertical-align: bottom;
      margin: 0 4px;
      padding-bottom: 1px;
    }
    p { margin-bottom: 18px; }
    .items-section { margin: 24px 0; }
    .items-label { font-weight: bold; margin-bottom: 8px; }
    .item-box {
      border: 1px solid #ccc;
      padding: 8px 14px;
      margin-bottom: 6px;
      font-size: 12pt;
    }
    .declaration { text-align: justify; margin-top: 24px; }
    .meta { margin-top: 24px; }
    .meta p { margin-bottom: 4px; }
    .signatures {
      margin-top: 100px;
      display: flex;
      justify-content: space-between;
    }
    .sig-block { text-align: center; width: 44%; }
    .sig-line { border-bottom: 1px solid #000; margin-bottom: 10px; width: 100%; }
    .sig-label { font-size: 10pt; line-height: 1.5; }
    @media print {
      @page { size: A4; margin: 20mm 25mm; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <h1>Termo de Responsabilidade e Recebimento de Itens</h1>

  <p>
    Eu,&nbsp;<span class="underline-field">${emp.name}</span>,&nbsp;recebi do ${groupName} os seguintes itens:
  </p>

  <div class="items-section">
    <p class="items-label">Itens Recebidos:</p>
    <div class="item-box">${itemDesc}</div>
  </div>

  <p class="declaration">
    Declaro estar ciente de que os itens fornecidos são de propriedade da empresa e devem
    ser utilizados adequadamente no desempenho das minhas funções. Comprometo-me a
    zelar pela sua conservação e devolvê-los nas mesmas condições em que foram
    recebidos, salvo desgaste natural decorrente do uso regular.
  </p>

  <div class="meta">
    <p><strong>Data:</strong>&nbsp;${dateFormatted}&nbsp;&nbsp;&nbsp;&nbsp;<strong>Localidade:</strong>&nbsp;${locality}</p>
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-label">Assinatura do Colaborador</div>
    </div>
    <div class="sig-block">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-label">Responsável pela Entrega<br>${groupName}</div>
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) { alert('Permita popups para gerar o documento.'); return; }
  win.addEventListener('afterprint', () => URL.revokeObjectURL(url));
  setTimeout(() => win.print(), 600);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function DPEmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const navigate  = useNavigate();

  const [employee,   setEmployee]   = useState<Employee | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [dismissals, setDismissals] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState<'info' | 'uniforms' | 'history' | 'trainings' | 'exams' | 'dismissal'>('info');
  const [trainings, setTrainings] = useState<any[]>([]);
  const [medExams, setMedExams]   = useState<any[]>([]);

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
  const [deletingDeliveryId, setDeletingDeliveryId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [empRes, delRes, dismRes] = await Promise.all([
        supabase.from('employees').select('*, hotels:hotel_id(name)').eq('id', id).single(),
        supabase.from('uniform_deliveries').select('*').eq('employee_id', id).order('delivery_date', { ascending: false }),
        supabase.from('employee_dismissals').select('*').eq('employee_id', id).order('dismissal_date', { ascending: false }),
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
      setDismissals(dismRes.data || []);

      // Load trainings and exams
      const [trRes, exRes] = await Promise.all([
        supabase.from('nr1_training_records').select('*').eq('employee_id', id).order('training_date', { ascending: false }),
        supabase.from('medical_exams').select('*').eq('employee_id', id).order('exam_date', { ascending: false }),
      ]);
      setTrainings(trRes.data || []);
      setMedExams(exRes.data || []);
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
    setDeliveryItems(prev => [...prev, { item: '', qty: 1, size: '' }]);

  const updateDeliveryItem = (i: number, field: keyof DeliveryItem, value: string | number) => {
    setDeliveryItems(prev => prev.map((it, idx) => {
      if (idx !== i) return it;
      const updated = { ...it, [field]: value };
      if (field === 'item' && employee) {
        const match = UNIFORM_ITEMS.find(u => u.label === value);
        if (match) {
          const size = getEmployeeUniformSize(employee, match.key);
          if (size) updated.size = size;
        }
      }
      return updated;
    }));
  };

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
    if (deliveryItems.some(it => !it.item)) { setDeliveryError('Selecione o tipo de cada item.'); return; }

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

  const handleDeleteDeliveryItem = async (deliveryId: string, itemIndex: number) => {
    if (!confirm('Tem certeza que deseja excluir este item?')) return;
    setDeletingDeliveryId(`${deliveryId}-${itemIndex}`);
    try {
      const delivery = deliveries.find(d => d.id === deliveryId);
      if (!delivery) return;
      if (delivery.items.length <= 1) {
        const { error } = await supabase.from('uniform_deliveries').delete().eq('id', deliveryId);
        if (error) throw error;
      } else {
        const updatedItems = delivery.items.filter((_: any, i: number) => i !== itemIndex);
        const { error } = await supabase.from('uniform_deliveries').update({ items: updatedItems }).eq('id', deliveryId);
        if (error) throw error;
      }
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir item.');
    } finally {
      setDeletingDeliveryId(null);
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
  const groupName    = currentGroup?.name || hotelName;
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
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-5 py-4 flex items-center justify-between rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <Package className="h-4.5 w-4.5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Nova Entrega de Uniforme</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">{employee.name}</p>
            </div>
          </div>
          <button onClick={() => setShowDelivery(false)}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSaveDelivery} className="p-5 space-y-4">
          {/* Data da entrega */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700/50">
            <div className="w-9 h-9 rounded-xl bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
              <Calendar className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Data da entrega</label>
              <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                className="w-full bg-transparent text-sm font-semibold text-gray-900 dark:text-white border-none p-0 focus:outline-none focus:ring-0" required />
            </div>
          </div>

          {/* Prefill */}
          {(employee.shirt_size || employee.pants_size || employee.shoe_size || employee.hat_size || employee.apron_size || employee.raincoat_size || (employee.epi_items?.length ?? 0) > 0) && deliveryItems.length === 0 && (
            <button type="button" onClick={prefillFromEmployee}
              className="w-full flex items-center gap-2.5 p-3 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-2xl text-sm font-semibold text-blue-600 dark:text-blue-400 transition-colors">
              <Shirt className="h-4 w-4" />Pré-preencher com tamanhos cadastrados
            </button>
          )}

          {/* Itens */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Itens entregues</label>
              <button type="button" onClick={addDeliveryItem}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors">
                <Plus className="h-3 w-3" />Item
              </button>
            </div>

            {deliveryItems.length === 0 ? (
              <button type="button" onClick={addDeliveryItem}
                className="w-full py-8 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all group">
                <Package className="h-7 w-7 text-gray-300 dark:text-gray-600 group-hover:text-blue-400 mx-auto mb-1.5 transition-colors" />
                <p className="text-xs text-gray-400 group-hover:text-blue-500 font-medium transition-colors">Clique para adicionar um item</p>
              </button>
            ) : (
              <div className="space-y-2">
                {deliveryItems.map((it, i) => (
                  <div key={i} className="flex gap-2 items-start p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700/50">
                    <div className="flex-1 min-w-0 space-y-2">
                      <select value={it.item}
                        onChange={e => updateDeliveryItem(i, 'item', e.target.value)}
                        className={`w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${!it.item ? 'text-gray-400' : ''}`}>
                        <option value="">Selecione o item...</option>
                        <optgroup label="Uniforme">
                          {UNIFORM_ITEMS.map(u => <option key={u.key} value={u.label}>{u.label}</option>)}
                        </optgroup>
                        <optgroup label="EPI">
                          {EPI_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
                        </optgroup>
                      </select>
                      <div className="flex gap-2">
                        <div className="w-20">
                          <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5 ml-1">Qtd</label>
                          <input type="number" min="1" value={it.qty}
                            onChange={e => updateDeliveryItem(i, 'qty', parseInt(e.target.value) || 1)}
                            className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-center" />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5 ml-1">Tamanho</label>
                          <input type="text" value={it.size}
                            onChange={e => updateDeliveryItem(i, 'size', e.target.value)}
                            placeholder="P, M, G, 40..."
                            className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300" />
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={() => removeDeliveryItem(i)}
                      className="mt-1 w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg flex-shrink-0 transition-all">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Observações */}
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Observações</label>
            <textarea value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)}
              rows={2} placeholder="Notas adicionais (opcional)..."
              className={`${inputCls} resize-none text-sm`} />
          </div>

          {/* Error */}
          {deliveryError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />{deliveryError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1 pb-2">
            <button type="button" onClick={() => setShowDelivery(false)}
              className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm">
              Cancelar
            </button>
            <button type="submit" disabled={savingDelivery}
              className="flex-[1.5] flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-bold rounded-xl transition-colors text-sm shadow-sm shadow-blue-500/20">
              {savingDelivery ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : <><CheckCircle className="h-4 w-4" />Registrar entrega</>}
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
            (employee.address_street || employee.address) && { icon: MapPin, label: 'Endereço', value: employee.address_street
              ? [employee.address_street, employee.address_number].filter(Boolean).join(', ')
                + (employee.address_neighborhood ? ` — ${employee.address_neighborhood}` : '')
                + (employee.address_city ? `, ${employee.address_city}` : '')
                + (employee.address_state ? `/${employee.address_state}` : '')
                + (employee.address_cep ? ` (${employee.address_cep})` : '')
              : employee.address },
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
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 uppercase tracking-wide flex-shrink-0">
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
  const TabHistory = () => {
    const allItems = deliveries.flatMap(del =>
      del.items.map((it: DeliveryItem, idx: number) => ({
        ...it, deliveryId: del.id, itemIndex: idx,
        delivery_date: del.delivery_date, registered_at: del.registered_at,
        notes: del.notes,
      }))
    );

    return (
      <div className="space-y-2">
        {allItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
            <Package className="h-10 w-10 opacity-30" />
            <p className="text-sm">Nenhuma entrega registrada.</p>
            <button onClick={() => setShowDelivery(true)} className="text-sm text-blue-500 hover:underline">
              Registrar primeira entrega
            </button>
          </div>
        ) : allItems.map((it, i) => {
          const deleteKey = `${it.deliveryId}-${it.itemIndex}`;
          return (
            <div key={`${it.deliveryId}-${it.itemIndex}-${i}`}
              className="flex items-center gap-3 p-3 sm:p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                <Shirt className="h-4.5 w-4.5 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                  {it.qty}x {it.item}{it.size ? <span className="font-normal text-gray-400"> — {it.size}</span> : ''}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {format(parseLocalDate(it.delivery_date), "dd/MM/yyyy", { locale: ptBR })}
                  {it.notes ? <span className="ml-1.5">· {it.notes}</span> : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => generateTermoPDF(employee, it, it.delivery_date, hotelName, groupName)}
                  title="Emitir termo"
                  className="w-8 h-8 flex items-center justify-center bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-gray-200 dark:border-gray-600 hover:border-blue-300 text-gray-500 hover:text-blue-600 rounded-lg transition-all">
                  <Printer className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDeleteDeliveryItem(it.deliveryId, it.itemIndex)}
                  disabled={deletingDeliveryId === deleteKey}
                  title="Excluir item"
                  className="w-8 h-8 flex items-center justify-center bg-gray-50 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 border border-gray-200 dark:border-gray-600 hover:border-red-300 text-gray-400 hover:text-red-500 rounded-lg transition-all disabled:opacity-50">
                  {deletingDeliveryId === deleteKey
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const VOLUNTARY_REASON_LABELS: Record<string, string> = {
    proposta_externa: 'Proposta Externa',
    nao_se_adaptou: 'Não se adaptou',
    problemas_pessoais: 'Problemas Pessoais',
    desacordo_regras: 'Desacordo com regras',
    salario_abaixo_expectativa: 'Salário abaixo da expectativa',
    falta_oportunidade: 'Falta de oportunidade e crescimento',
    mudanca_cidade_pais: 'Mudança de cidade ou país',
    mudanca_carreira: 'Mudança de carreira',
  };

  const TabDismissal = () => {
    if (dismissals.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 dark:text-gray-500">
          <UserX className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhum registro de desligamento encontrado.</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {dismissals.map(dism => {
          const isVoluntary = dism.type === 'voluntary';
          const displayType = isVoluntary ? 'Voluntário' : 'Involuntário';
          const isJustaCausa = dism.involuntary_type === 'justa_causa';
          
          return (
            <div key={dism.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-700 pb-4 mb-4">
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    Registro de Desligamento
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Cadastrado em {format(new Date(dism.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                    isVoluntary 
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-800' 
                      : 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border border-purple-100 dark:border-purple-800'
                  }`}>
                    {displayType}
                  </span>
                  {!isVoluntary && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/30">
                      {isJustaCausa ? 'Justa Causa' : 'Sem Justa Causa'}
                    </span>
                  )}
                </div>
              </div>

              {/* Resumo: Admissão → Tempo de casa → Desligamento */}
              {employee && (
                <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
                  <div>
                    <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                      Data de Admissão
                    </span>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5 mt-1">
                      <Calendar className="h-4 w-4 text-green-500" />
                      {format(parseLocalDate(employee.admission_date), 'dd/MM/yyyy')}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                      Tempo de Casa
                    </span>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5 mt-1">
                      <Clock className="h-4 w-4 text-blue-500" />
                      {(() => {
                        const admDate = parseLocalDate(employee.admission_date);
                        const dismDate = parseLocalDate(dism.dismissal_date);
                        const years = differenceInYears(dismDate, admDate);
                        const months = differenceInMonths(dismDate, admDate) % 12;
                        const parts: string[] = [];
                        if (years > 0) parts.push(`${years} ano${years > 1 ? 's' : ''}`);
                        if (months > 0) parts.push(`${months} ${months > 1 ? 'meses' : 'mês'}`);
                        if (parts.length === 0) {
                          const days = differenceInDays(dismDate, admDate);
                          parts.push(`${days} dia${days !== 1 ? 's' : ''}`);
                        }
                        return parts.join(' e ');
                      })()}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                      Data de Desligamento
                    </span>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5 mt-1">
                      <Calendar className="h-4 w-4 text-red-500" />
                      {format(parseLocalDate(dism.dismissal_date), 'dd/MM/yyyy')}
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  {isVoluntary ? (
                    <div>
                      <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                        Motivos Indicados
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {dism.voluntary_reasons && dism.voluntary_reasons.length > 0 ? (
                          dism.voluntary_reasons.map((r: string) => (
                            <span key={r} className="inline-flex items-center text-xs font-semibold px-2.5 py-1 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-600">
                              {VOLUNTARY_REASON_LABELS[r] || r}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500 italic">Nenhum motivo específico assinalado.</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                        {Array.isArray(dism.involuntary_reason) && dism.involuntary_reason.length > 1 ? 'Motivos' : 'Motivo Principal'}
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {Array.isArray(dism.involuntary_reason) ? (
                          dism.involuntary_reason.map((r: string) => (
                            <span key={r} className="inline-flex items-center text-xs font-semibold px-2.5 py-1 bg-red-50/40 dark:bg-red-950/20 text-red-700 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-900/30">
                              {r}
                            </span>
                          ))
                        ) : dism.involuntary_reason ? (
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 bg-red-50/20 dark:bg-red-950/10 border border-red-200 dark:border-red-900/20 px-3 py-1.5 rounded-lg">
                            {dism.involuntary_reason}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
                    Observações e Justificativa
                  </span>
                  <div className="text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-700 min-h-[80px] whitespace-pre-wrap">
                    {dism.notes}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

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
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-2xl mb-5 overflow-x-auto">
        {([
          { id: 'info',      label: 'Informações',          icon: User    },
          { id: 'uniforms',  label: 'Uniformes',            icon: Shirt   },
          { id: 'history',   label: `Entregas (${deliveries.length})`, icon: Package },
          { id: 'trainings', label: `Treinamentos (${trainings.length})`, icon: GraduationCap },
          { id: 'exams',     label: `Exames (${medExams.length})`, icon: Stethoscope },
          ...(employee?.status === 'dismissed' || dismissals.length > 0
            ? [{ id: 'dismissal', label: 'Desligamento', icon: UserX }]
            : []
          )
        ] as { id: 'info' | 'uniforms' | 'history' | 'trainings' | 'exams' | 'dismissal'; label: string; icon: any }[]).map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all flex-1 justify-center whitespace-nowrap ${
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
      {activeTab === 'trainings' && (
        <div className="space-y-3">
          {trainings.length === 0 ? (
            <p className="text-center text-gray-400 dark:text-gray-500 py-8">Nenhum treinamento registrado</p>
          ) : trainings.map((t: any) => {
            const days = t.valid_until ? differenceInDays(parseLocalDate(t.valid_until), new Date()) : null;
            const isExpired = days !== null && days < 0;
            const isExpiring = days !== null && days >= 0 && days <= 30;
            const TRAINING_TYPES: Record<string, string> = {
              integracao: 'Integração', reciclagem: 'Reciclagem', especifico: 'Específico',
              nr: 'NR Obrigatório', brigada: 'Brigada', cipa: 'CIPA',
            };
            return (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white">{t.topic}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {TRAINING_TYPES[t.training_type] || t.training_type} · {format(parseLocalDate(t.training_date), 'dd/MM/yyyy')}
                      {t.hours && ` · ${t.hours}h`}
                      {t.trainer && ` · ${t.trainer}`}
                    </p>
                  </div>
                  <div>
                    {t.valid_until ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        isExpired ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300' :
                        isExpiring ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300' :
                        'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300'
                      }`}>
                        {isExpired ? 'Vencido' : isExpiring ? `${days}d` : `Até ${format(parseLocalDate(t.valid_until), 'dd/MM/yy')}`}
                      </span>
                    ) : <span className="text-xs text-gray-400">Sem validade</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {activeTab === 'exams' && (
        <div className="space-y-3">
          {medExams.length === 0 ? (
            <p className="text-center text-gray-400 dark:text-gray-500 py-8">Nenhum exame registrado</p>
          ) : medExams.map((e: any) => {
            const days = e.valid_until ? differenceInDays(parseLocalDate(e.valid_until), new Date()) : null;
            const isExpired = days !== null && days < 0;
            const isExpiring = days !== null && days >= 0 && days <= 30;
            const EXAM_TYPES: Record<string, string> = {
              admissional: 'Admissional', periodico: 'Periódico', retorno: 'Retorno',
              mudanca_funcao: 'Mudança Função', demissional: 'Demissional',
            };
            const RESULT_LABELS: Record<string, { label: string; color: string }> = {
              apto: { label: 'Apto', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
              inapto: { label: 'Inapto', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
              apto_restricao: { label: 'Apto c/ Restrição', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
            };
            const rl = e.result ? RESULT_LABELS[e.result] : null;
            return (
              <div key={e.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white">
                      {EXAM_TYPES[e.exam_type] || e.exam_type}
                      {rl && <span className={`ml-2 text-xs px-2 py-0.5 rounded font-medium ${rl.color}`}>{rl.label}</span>}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {format(parseLocalDate(e.exam_date), 'dd/MM/yyyy')}
                      {e.clinic && ` · ${e.clinic}`}
                      {e.doctor_name && ` · Dr. ${e.doctor_name}`}
                    </p>
                    {e.restrictions && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Restrições: {e.restrictions}</p>}
                  </div>
                  <div>
                    {e.valid_until ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        isExpired ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300' :
                        isExpiring ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300' :
                        'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300'
                      }`}>
                        {isExpired ? 'Vencido' : isExpiring ? `${days}d` : `Até ${format(parseLocalDate(e.valid_until), 'dd/MM/yy')}`}
                      </span>
                    ) : <span className="text-xs text-gray-400">Sem validade</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'dismissal' && <TabDismissal />}

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