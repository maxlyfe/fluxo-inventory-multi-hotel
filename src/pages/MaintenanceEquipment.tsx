// src/pages/MaintenanceEquipment.tsx
// Catálogo de equipamentos + geração de QR Codes

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { usePermissions } from '../hooks/usePermissions';
import QRCode from 'qrcode';
import {
  Settings, Plus, Search, Filter, Download, QrCode,
  Wrench, X, Loader2, ChevronDown, Building2, AlertTriangle,
  Shield, ArrowUpDown, CheckCircle, Package, Pencil, History, Save,
  Archive, ArchiveRestore, Printer, Check, CheckSquare, Square,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Equipment {
  id: string; hotel_id: string; name: string; category: string;
  brand: string | null; model: string | null; serial_number: string | null;
  purchase_date: string | null; warranty_months: number | null;
  location_detail: string | null; status: string;
  loaned_to_hotel: string | null; notes: string | null; qr_code_id: string;
  archived?: boolean;
  created_at: string;
  hotels?: { name: string };
  loaned_hotel?: { name: string } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  active:    { label: 'Ativo',       color: 'text-green-600 dark:text-green-400',  bg: 'bg-green-50 dark:bg-green-900/20',   dot: 'bg-green-500'  },
  available: { label: 'Disponível',  color: 'text-blue-600 dark:text-blue-400',    bg: 'bg-blue-50 dark:bg-blue-900/20',     dot: 'bg-blue-500'   },
  loaned:    { label: 'Emprestado',  color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-900/20',   dot: 'bg-amber-500'  },
  inactive:  { label: 'Inativo',     color: 'text-gray-500 dark:text-gray-400',    bg: 'bg-gray-50 dark:bg-gray-800',        dot: 'bg-gray-400'   },
};

const CATEGORIES = ['Climatização','Eletrodoméstico','Hidráulica','Elétrica','Telefonia','TV/Entretenimento','Segurança','Limpeza','Cozinha','Outro'];

const inputCls = `w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent
  placeholder:text-gray-400 transition-all`;
const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

// ---------------------------------------------------------------------------
// QR Helper
// ---------------------------------------------------------------------------

const generateQR = async (qrId: string): Promise<string> => {
  const url = `${window.location.origin}/maintenance/equipment/${qrId}`;
  return QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: '#111', light: '#fff' } });
};

// ---------------------------------------------------------------------------
// Warranty helper
// ---------------------------------------------------------------------------

const warrantyExpires = (purchaseDate: string | null, months: number | null): Date | null => {
  if (!purchaseDate || !months) return null;
  const d = new Date(purchaseDate);
  d.setMonth(d.getMonth() + months);
  return d;
};

const warrantyStatus = (eq: Equipment): 'active' | 'expiring' | 'expired' | 'none' => {
  const exp = warrantyExpires(eq.purchase_date, eq.warranty_months);
  if (!exp) return 'none';
  const now = new Date();
  const days = (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'active';
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function MaintenanceEquipment() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();
  const { can } = usePermissions();
  const { addNotification } = useNotification();
  const navigate  = useNavigate();

  // Quem pode CADASTRAR/EDITAR equipamentos — configurável por perfil em /admin/roles
  // (dev e admin têm bypass total via usePermissions).
  const isManager = can('maintenance_equipment_manage');
  // Quem pode alternar/filtrar entre hotéis — quem tem acesso ao módulo de manutenção.
  const canChangeHotel = can('maintenance');

  // hotel_id inicial = hotel selecionado no contexto (ou vazio se admin sem seleção)
  const defaultHotelId = selectedHotel?.id || '';

  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [hotels, setHotels]       = useState<{id:string;name:string}[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filterHotel, setFilterHotel]   = useState(defaultHotelId);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [qrModal, setQrModal]     = useState<{ qrId: string; name: string; dataUrl: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);   // null = criando
  const [statusMenuId, setStatusMenuId] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [historyModal, setHistoryModal] = useState<{ eq: Equipment; rows: any[]; loading: boolean } | null>(null);

  // QR Report mode
  const [qrReportMode, setQrReportMode] = useState(false);
  const [selectedForQR, setSelectedForQR] = useState<Set<string>>(new Set());
  const [generatingQR, setGeneratingQR] = useState(false);

  // Form: hotel_id sempre inicializado com hotel selecionado no contexto
  const emptyForm = () => ({
    name:'', category:'Climatização', brand:'', model:'', serial_number:'',
    purchase_date:'', warranty_months:'', location_detail:'', status:'active',
    hotel_id: selectedHotel?.id || '', notes:''
  });
  const [form, setForm] = useState(emptyForm);

  // ---------------------------------------------------------------------------
  const [fetchError, setFetchError] = useState('');

  const fetchEquipment = async () => {
    setLoading(true);
    setFetchError('');
    try {
      // Não usar hotels(name) via join pois pode falhar se a FK não estiver
      // no schema cache do Supabase — buscamos o nome pelo array hotels já carregado
      let q = supabase
        .from('maintenance_equipment')
        .select('*')
        .order('name');

      const effectiveHotelFilter = canChangeHotel ? filterHotel : defaultHotelId;
      if (effectiveHotelFilter) q = q.eq('hotel_id', effectiveHotelFilter);
      if (filterStatus)         q = q.eq('status', filterStatus);
      if (filterCategory)       q = q.eq('category', filterCategory);
      // Arquivados ficam ocultos por padrão (histórico preservado).
      if (showArchived)         q = q.eq('archived', true);
      else                      q = q.eq('archived', false);

      const { data, error: fetchErr } = await q;

      if (fetchErr) {
        console.error('Erro ao buscar equipamentos:', fetchErr);
        setFetchError(`Erro ao carregar equipamentos: ${fetchErr.message}`);
        return;
      }
      setEquipment((data || []) as Equipment[]);
    } catch (err: any) {
      console.error('Erro inesperado:', err);
      setFetchError(err.message || 'Erro inesperado ao buscar equipamentos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    supabase.from('hotels').select('id, name').order('name').then(({ data }) => {
      setHotels(data || []);
    });
  }, []);

  // Quando selectedHotel muda (troca de unidade), atualiza form e filtro
  useEffect(() => {
    if (selectedHotel?.id) {
      setForm(f => ({ ...f, hotel_id: selectedHotel.id }));
      if (!canChangeHotel) setFilterHotel(selectedHotel.id);
    }
  }, [selectedHotel?.id]);

  useEffect(() => { fetchEquipment(); }, [filterHotel, filterStatus, filterCategory, showArchived]);

  // Helper: nome do hotel pelo id (usa array já carregado, sem join)
  const getHotelName = (hotelId: string) =>
    hotels.find(h => h.id === hotelId)?.name || '—';

  // ---------------------------------------------------------------------------
  // QR Code modal
  // ---------------------------------------------------------------------------
  const openQR = async (eq: Equipment) => {
    const dataUrl = await generateQR(eq.qr_code_id);
    setQrModal({ qrId: eq.qr_code_id, name: eq.name, dataUrl });
  };

  const downloadQR = () => {
    if (!qrModal) return;
    const a = document.createElement('a');
    a.href = qrModal.dataUrl;
    a.download = `QR-${qrModal.name.replace(/\s+/g, '-')}.png`;
    a.click();
  };

  // ---------------------------------------------------------------------------
  // Histórico
  // ---------------------------------------------------------------------------
  const logHistory = async (eq: { id: string; hotel_id: string }, change_type: string, old_status: string | null, new_status: string | null, note?: string) => {
    await supabase.from('maintenance_equipment_history').insert({
      equipment_id: eq.id, hotel_id: eq.hotel_id, change_type,
      old_status, new_status, note: note || null,
      changed_by: user?.id, changed_by_name: user?.full_name || user?.email?.split('@')[0] || 'Usuário',
    });
  };

  const openHistory = async (eq: Equipment) => {
    setHistoryModal({ eq, rows: [], loading: true });
    const { data } = await supabase.from('maintenance_equipment_history')
      .select('*').eq('equipment_id', eq.id).order('created_at', { ascending: false });
    setHistoryModal({ eq, rows: data || [], loading: false });
  };

  // ---------------------------------------------------------------------------
  // Editar
  // ---------------------------------------------------------------------------
  const handleEditEquipment = (eq: Equipment) => {
    setEditingId(eq.id);
    setError('');
    setForm({
      name: eq.name, category: eq.category, brand: eq.brand || '', model: eq.model || '',
      serial_number: eq.serial_number || '', purchase_date: eq.purchase_date || '',
      warranty_months: eq.warranty_months != null ? String(eq.warranty_months) : '',
      location_detail: eq.location_detail || '', status: eq.status,
      hotel_id: eq.hotel_id, notes: eq.notes || '',
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm()); setError(''); };

  // Troca rápida de status (cria histórico)
  const changeStatus = async (eq: Equipment, newStatus: string) => {
    setStatusMenuId(null);
    if (newStatus === eq.status) return;
    setSavingStatus(true);
    try {
      const { error: upErr } = await supabase.from('maintenance_equipment')
        .update({ status: newStatus }).eq('id', eq.id);
      if (upErr) throw upErr;
      await logHistory(eq, 'status', eq.status, newStatus);
      setEquipment(prev => prev.map(e => e.id === eq.id ? { ...e, status: newStatus } : e));
      addNotification?.('success', `Status de "${eq.name}" alterado para ${STATUS_CONFIG[newStatus]?.label || newStatus}.`);
    } catch (err: any) {
      addNotification?.('error', 'Erro ao alterar status: ' + err.message);
    } finally {
      setSavingStatus(false);
    }
  };

  // Arquivar / desarquivar (reversível, com histórico)
  const toggleArchive = async (eq: Equipment) => {
    const next = !eq.archived;
    setSavingStatus(true);
    try {
      const { error: upErr } = await supabase.from('maintenance_equipment')
        .update({ archived: next }).eq('id', eq.id);
      if (upErr) throw upErr;
      await logHistory({ id: eq.id, hotel_id: eq.hotel_id }, next ? 'archived' : 'unarchived', null, null,
        next ? 'Equipamento arquivado' : 'Equipamento desarquivado');
      addNotification?.('success', next ? `"${eq.name}" arquivado.` : `"${eq.name}" desarquivado.`);
      await fetchEquipment();
    } catch (err: any) {
      addNotification?.('error', 'Erro ao arquivar: ' + err.message);
    } finally {
      setSavingStatus(false);
    }
  };

  // Mensagem amigável para o erro de S/N duplicado (trigger no banco)
  const friendlySaveError = (msg: string): string => {
    if (/DUPLICATE_SERIAL/i.test(msg) || (/s[ée]rie/i.test(msg) && /existe/i.test(msg)))
      return 'Já existe um equipamento com este número de série neste grupo.';
    return msg || 'Erro ao salvar. Tente novamente.';
  };

  // ---------------------------------------------------------------------------
  // Save equipment (criar OU editar)
  // ---------------------------------------------------------------------------
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const hotelToSave = form.hotel_id || defaultHotelId;
    if (!hotelToSave) { setError('Selecione o hotel.'); return; }
    if (!form.name.trim()) { setError('Informe o nome do equipamento.'); return; }

    setSaving(true);
    try {
      const payload = {
        hotel_id:        hotelToSave,
        name:            form.name.trim(),
        category:        form.category,
        brand:           form.brand || null,
        model:           form.model || null,
        serial_number:   form.serial_number || null,
        purchase_date:   form.purchase_date || null,
        warranty_months: form.warranty_months ? parseInt(form.warranty_months) : null,
        location_detail: form.location_detail || null,
        status:          form.status,
        notes:           form.notes || null,
      };

      if (editingId) {
        const original = equipment.find(e => e.id === editingId);
        const { error: saveErr } = await supabase.from('maintenance_equipment').update(payload).eq('id', editingId);
        if (saveErr) throw saveErr;
        // Registra histórico: mudança de status (se houve) + edição geral
        if (original && original.status !== form.status) {
          await logHistory({ id: editingId, hotel_id: hotelToSave }, 'status', original.status, form.status);
        }
        await logHistory({ id: editingId, hotel_id: hotelToSave }, 'edit', null, null, 'Dados do equipamento editados');
        addNotification?.('success', 'Equipamento atualizado.');
      } else {
        const { data: created, error: saveErr } = await supabase.from('maintenance_equipment')
          .insert({ ...payload, created_by: user?.id }).select('id').single();
        if (saveErr) throw saveErr;
        if (created?.id) await logHistory({ id: created.id, hotel_id: hotelToSave }, 'created', null, form.status, 'Equipamento cadastrado');
        addNotification?.('success', 'Equipamento cadastrado.');
      }

      closeForm();
      await fetchEquipment();
    } catch (err: any) {
      console.error('Erro ao salvar equipamento:', err);
      setError(friendlySaveError(err.message || ''));
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // QR Report
  // ---------------------------------------------------------------------------
  const toggleQRSelect = (id: string) => {
    setSelectedForQR(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const generateQRReport = async () => {
    const selected = equipment.filter(eq => selectedForQR.has(eq.id));
    if (selected.length === 0) return;
    setGeneratingQR(true);
    try {
      const items = await Promise.all(
        selected.map(async eq => ({
          name: eq.name,
          location: eq.location_detail || '',
          hotel: getHotelName(eq.hotel_id),
          serial: eq.serial_number || '',
          dataUrl: await QRCode.toDataURL(
            `${window.location.origin}/maintenance/equipment/${eq.qr_code_id}`,
            { width: 400, margin: 1, color: { dark: '#000', light: '#fff' } },
          ),
        })),
      );

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>QR Codes - Equipamentos</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; }
  .grid { display: flex; flex-wrap: wrap; gap: 4mm; justify-content: center; }
  .card {
    width: 48mm; height: 52mm;
    border: 0.5px dashed #ccc; border-radius: 2mm;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 2mm; page-break-inside: avoid;
  }
  .card img { width: 36mm; height: 36mm; }
  .card .name { font-size: 7pt; font-weight: 700; text-align: center;
    margin-top: 1.5mm; line-height: 1.2; max-height: 3.5em;
    overflow: hidden; word-break: break-word; }
  .card .sub { font-size: 5.5pt; color: #666; text-align: center;
    line-height: 1.2; margin-top: 0.5mm; max-height: 2.4em; overflow: hidden; }
  @media print {
    .card { border-color: #ddd; }
  }
</style></head><body>
<div class="grid">
${items.map(it => `  <div class="card">
    <img src="${it.dataUrl}" alt="QR">
    <div class="name">${it.name.replace(/</g, '&lt;')}</div>
    <div class="sub">${it.location ? it.location.replace(/</g, '&lt;') + ' · ' : ''}${it.hotel.replace(/</g, '&lt;')}${it.serial ? ' · S/N ' + it.serial.replace(/</g, '&lt;') : ''}</div>
  </div>`).join('\n')}
</div>
</body></html>`;

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setQrReportMode(false);
      setSelectedForQR(new Set());
    } catch (err: any) {
      addNotification?.('error', 'Erro ao gerar relatório: ' + (err.message || ''));
    } finally {
      setGeneratingQR(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtered
  // ---------------------------------------------------------------------------
  const filtered = equipment.filter(eq => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      eq.name.toLowerCase().includes(q) ||
      (eq.brand || '').toLowerCase().includes(q) ||
      (eq.model || '').toLowerCase().includes(q) ||
      (eq.serial_number || '').toLowerCase().includes(q) ||
      (eq.location_detail || '').toLowerCase().includes(q)
    );
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-orange-500 flex items-center justify-center shadow-lg shadow-orange-200 dark:shadow-orange-900/40">
              <Settings className="h-5 w-5 text-white" />
            </div>
            Equipamentos
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[52px]">{equipment.length} equipamento{equipment.length !== 1 ? 's' : ''} cadastrado{equipment.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/maintenance')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:border-orange-300 hover:text-orange-600 transition-all">
            <Wrench className="h-4 w-4" />
            <span className="hidden sm:inline">Tickets</span>
          </button>
          {equipment.length > 0 && (
            <button
              onClick={() => { setQrReportMode(!qrReportMode); setSelectedForQR(new Set()); }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                qrReportMode
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-orange-300 hover:text-orange-600'
              }`}>
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">{qrReportMode ? 'Cancelar' : 'Imprimir QR'}</span>
            </button>
          )}
          {isManager && (
            <button onClick={() => { if (showForm && !editingId) { closeForm(); } else { setEditingId(null); setForm(emptyForm()); setError(''); setShowForm(true); } }}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Novo Equipamento</span>
              <span className="sm:hidden">Novo</span>
            </button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && isManager && (
        <form onSubmit={handleSave} className="bg-white dark:bg-gray-800 rounded-3xl border border-orange-200 dark:border-orange-800/50 p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">{editingId ? 'Editar Equipamento' : 'Novo Equipamento'}</h2>
            <button type="button" onClick={closeForm} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Hotel: admin/management podem trocar; outros veem o hotel fixo */}
            {canChangeHotel && hotels.length > 1 ? (
              <div className="sm:col-span-2">
                <label className={labelCls}>Hotel *</label>
                <select value={form.hotel_id} onChange={e => setForm(f => ({ ...f, hotel_id: e.target.value }))} className={`${inputCls} appearance-none`} required>
                  <option value="">Selecione...</option>
                  {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            ) : selectedHotel ? (
              <div className="sm:col-span-2 flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/50 rounded-xl">
                <Building2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
                <span className="text-sm font-medium text-blue-800 dark:text-blue-300">{selectedHotel.name}</span>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <label className={labelCls}>Nome do equipamento *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Ar condicionado split, TV 40'..." className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>Categoria</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={`${inputCls} appearance-none`}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={`${inputCls} appearance-none`}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Marca</label>
              <input type="text" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="Ex: Samsung, LG..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Modelo</label>
              <input type="text" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="Modelo do equipamento..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nº de série</label>
              <input type="text" value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} placeholder="Serial number..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Localização atual</label>
              <input type="text" value={form.location_detail} onChange={e => setForm(f => ({ ...f, location_detail: e.target.value }))} placeholder="Ex: Quarto 201, Lobby..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Data de compra</label>
              <input type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Garantia (meses)</label>
              <input type="number" min="0" value={form.warranty_months} onChange={e => setForm(f => ({ ...f, warranty_months: e.target.value }))} placeholder="Ex: 12, 24..." className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Observações</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Notas adicionais..." className={`${inputCls} resize-none`} />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 mt-3 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
            </div>
          )}
          <div className="flex gap-3 mt-5">
            <button type="button" onClick={closeForm}
              className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold rounded-2xl transition-colors text-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />)}
              {editingId ? 'Salvar alterações' : 'Cadastrar'}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar equipamentos..."
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent placeholder:text-gray-400 transition-all" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none">
          <option value="">Todos os status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {canChangeHotel && hotels.length > 1 && (
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <select value={filterHotel} onChange={e => setFilterHotel(e.target.value)}
              className="pl-9 pr-8 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none">
              <option value="">Todas as unidades</option>
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}
        <button onClick={() => setShowArchived(v => !v)}
          title={showArchived ? 'Mostrar ativos' : 'Mostrar arquivados'}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-sm rounded-xl border transition-colors ${
            showArchived
              ? 'bg-slate-700 text-white border-slate-700'
              : 'text-gray-500 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-slate-400'
          }`}>
          <Archive className="h-3.5 w-3.5" />{showArchived ? 'Arquivados' : 'Ver arquivados'}
        </button>
        {(search || filterStatus || (canChangeHotel && filterHotel !== defaultHotelId)) && (
          <button onClick={() => { setSearch(''); setFilterStatus(''); if (canChangeHotel) setFilterHotel(defaultHotelId); setFilterCategory(''); }}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-gray-500 hover:text-red-500 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors">
            <X className="h-3.5 w-3.5" />Limpar
          </button>
        )}
      </div>

      {/* Banner de erro — exibido quando fetchEquipment falha */}
      {fetchError && (
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Erro ao carregar equipamentos</p>
            <p className="mt-0.5 font-mono text-xs">{fetchError}</p>
          </div>
          <button onClick={fetchEquipment} className="text-xs underline whitespace-nowrap">Tentar novamente</button>
        </div>
      )}

      {/* Equipment grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Carregando equipamentos...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Settings className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhum equipamento encontrado.</p>
          {isManager && (
            <button onClick={() => { setEditingId(null); setForm(emptyForm()); setError(''); setShowForm(true); }} className="text-sm text-orange-500 hover:underline">Cadastrar o primeiro</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(eq => {
            const wStatus = warrantyStatus(eq);
            const wExp    = warrantyExpires(eq.purchase_date, eq.warranty_months);
            const sCfg    = STATUS_CONFIG[eq.status] ?? STATUS_CONFIG.active;
            return (
              <div key={eq.id}
                onClick={qrReportMode ? () => toggleQRSelect(eq.id) : undefined}
                className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 transition-all group ${
                  qrReportMode
                    ? `cursor-pointer ${selectedForQR.has(eq.id) ? 'border-orange-400 dark:border-orange-500 ring-2 ring-orange-200 dark:ring-orange-800/40' : 'border-gray-100 dark:border-gray-700 hover:border-orange-200'}`
                    : 'border-gray-100 dark:border-gray-700 hover:shadow-md'
                }`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0 flex items-start gap-2">
                    {qrReportMode && (
                      <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-all ${
                        selectedForQR.has(eq.id)
                          ? 'bg-orange-500 border-orange-500 text-white'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}>
                        {selectedForQR.has(eq.id) && <Check className="w-3.5 h-3.5" />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                    {/* Status — clicável para alterar (gera histórico) */}
                    <div className="relative inline-block mb-2">
                      <button
                        onClick={e => { if (qrReportMode) { e.stopPropagation(); return; } isManager && setStatusMenuId(statusMenuId === eq.id ? null : eq.id); }}
                        disabled={!isManager || savingStatus || qrReportMode}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${sCfg.bg} ${sCfg.color} ${isManager ? 'hover:ring-1 hover:ring-current cursor-pointer' : 'cursor-default'}`}
                        title={isManager ? 'Clique para alterar o status' : undefined}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sCfg.dot}`} />{sCfg.label}
                        {isManager && <ChevronDown className="h-3 w-3 opacity-60" />}
                      </button>
                      {statusMenuId === eq.id && (
                        <div className="absolute z-20 top-full left-0 mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1">
                          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                            <button key={k} onClick={() => changeStatus(eq, k)}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50 ${k === eq.status ? 'font-bold' : ''}`}>
                              <span className={`w-2 h-2 rounded-full ${v.dot}`} />
                              <span className="text-gray-700 dark:text-gray-200">{v.label}</span>
                              {k === eq.status && <CheckCircle className="h-3.5 w-3.5 ml-auto text-emerald-500" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{eq.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{eq.category}</p>
                    </div>
                  </div>
                  {!qrReportMode && <div className="flex gap-1">
                    {isManager && (
                      <button onClick={() => handleEditEquipment(eq)} title="Editar equipamento"
                        className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all">
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {isManager && (
                      <button onClick={() => toggleArchive(eq)} disabled={savingStatus}
                        title={eq.archived ? 'Desarquivar' : 'Arquivar'}
                        className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/40 transition-all">
                        {eq.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      </button>
                    )}
                    <button onClick={() => openHistory(eq)} title="Histórico"
                      className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all">
                      <History className="h-4 w-4" />
                    </button>
                    <button onClick={() => openQR(eq)} title="Gerar QR Code"
                      className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all">
                      <QrCode className="h-4 w-4" />
                    </button>
                  </div>}
                </div>

                <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  {eq.brand && <p>{eq.brand} {eq.model}</p>}
                  {eq.serial_number && <p className="font-mono truncate">S/N: {eq.serial_number}</p>}
                  {eq.location_detail && <p className="flex items-center gap-1"><Package className="h-3 w-3" />{eq.location_detail}</p>}
                  {eq.hotel_id && <p className="flex items-center gap-1"><Building2 className="h-3 w-3" />{getHotelName(eq.hotel_id)}</p>}
                </div>

                {wExp && (
                  <div className={`mt-3 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl
                    ${wStatus === 'active'   ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' :
                      wStatus === 'expiring' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600' :
                      'bg-red-50 dark:bg-red-900/20 text-red-600'}`}>
                    <Shield className="h-3 w-3" />
                    Garantia {wStatus === 'active' ? 'até' : wStatus === 'expiring' ? 'expira em' : 'expirou em'}{' '}
                    {wExp.toLocaleDateString('pt-BR')}
                  </div>
                )}

                {!qrReportMode && (
                  <button onClick={() => navigate(`/maintenance/equipment/${eq.qr_code_id}`)}
                    className="w-full mt-3 py-2 text-xs font-medium text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800/50 rounded-xl hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors">
                    Ver ficha completa →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Histórico Modal */}
      {historyModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setHistoryModal(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 max-w-md w-full shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><History className="h-4 w-4 text-violet-500" />Histórico</h2>
              <button onClick={() => setHistoryModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 truncate">{historyModal.eq.name}</p>
            {historyModal.loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>
            ) : historyModal.rows.length === 0 ? (
              <p className="text-sm text-gray-400 italic text-center py-8">Sem histórico registrado ainda.</p>
            ) : (
              <div className="overflow-y-auto space-y-2 pr-1">
                {historyModal.rows.map(r => (
                  <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${STATUS_CONFIG[r.new_status]?.dot || 'bg-gray-400'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">
                        {r.change_type === 'status'
                          ? <>Status: {STATUS_CONFIG[r.old_status]?.label || r.old_status || '—'} → <span className="text-emerald-600 dark:text-emerald-400">{STATUS_CONFIG[r.new_status]?.label || r.new_status}</span></>
                          : r.change_type === 'created' ? 'Equipamento cadastrado'
                          : 'Dados editados'}
                      </p>
                      {r.note && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{r.note}</p>}
                      <p className="text-[10px] text-gray-400 mt-1">
                        {new Date(r.created_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {r.changed_by_name && ` · ${r.changed_by_name}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* QR Report floating bar */}
      {qrReportMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center gap-4">
          <button
            onClick={() => {
              if (selectedForQR.size === filtered.length) setSelectedForQR(new Set());
              else setSelectedForQR(new Set(filtered.map(e => e.id)));
            }}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-orange-600 transition-colors">
            {selectedForQR.size === filtered.length
              ? <><CheckSquare className="h-4 w-4" />Desmarcar todos</>
              : <><Square className="h-4 w-4" />Selecionar todos</>
            }
          </button>
          <span className="text-xs text-gray-400 dark:text-gray-500">{selectedForQR.size} selecionado{selectedForQR.size !== 1 ? 's' : ''}</span>
          <button
            onClick={generateQRReport}
            disabled={selectedForQR.size === 0 || generatingQR}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
            {generatingQR ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Gerar Relatório
          </button>
          <button
            onClick={() => { setQrReportMode(false); setSelectedForQR(new Set()); }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* QR Modal */}
      {qrModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setQrModal(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 max-w-xs w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">QR Code</h2>
              <button onClick={() => setQrModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 truncate">{qrModal.name}</p>
            <img src={qrModal.dataUrl} alt="QR Code" className="w-full rounded-2xl border border-gray-100 dark:border-gray-700" />
            <p className="text-xs text-gray-400 text-center mt-3 font-mono break-all">{qrModal.qrId}</p>
            <button onClick={downloadQR}
              className="w-full mt-4 flex items-center justify-center gap-2 py-3 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-2xl transition-colors">
              <Download className="h-4 w-4" />Baixar QR Code
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
