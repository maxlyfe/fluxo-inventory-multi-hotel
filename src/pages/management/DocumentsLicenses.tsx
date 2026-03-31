// src/pages/management/DocumentsLicenses.tsx
// Dashboard de documentos e licenças do hotel com CRUD, tipos editáveis e renovações

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { format, parseISO, differenceInDays } from 'date-fns';
import {
  FileText, Shield, Search, Loader2, Plus, Edit2, Trash2, Save, X,
  AlertTriangle, CheckCircle, Clock, Filter, RefreshCw, Settings,
  FileWarning, ChevronDown, ChevronUp,
} from 'lucide-react';

interface DocumentType {
  id: string;
  name: string;
  category: string | null;
  renewal_period_months: number | null;
  is_mandatory: boolean;
}

interface HotelDocument {
  id: string;
  hotel_id: string;
  document_type_id: string | null;
  title: string;
  description: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  alert_days_before: number;
  status: string;
  file_url: string | null;
  responsible: string | null;
  notes: string | null;
  created_at: string;
  document_types?: { name: string; category: string | null } | null;
}

interface Renewal {
  id: string;
  document_id: string;
  action: string;
  notes: string | null;
  created_at: string;
}

const CATEGORIES: Record<string, { label: string; color: string }> = {
  legal:     { label: 'Legal',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  sanitario: { label: 'Sanitário',  color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  seguranca: { label: 'Segurança',  color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  ambiental: { label: 'Ambiental',  color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<any>; color: string }> = {
  valid:    { label: 'Válido',   icon: CheckCircle,  color: 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-300' },
  expiring: { label: 'Vencendo', icon: Clock,         color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300' },
  expired:  { label: 'Vencido',  icon: AlertTriangle, color: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-300' },
  renewing: { label: 'Renovando', icon: RefreshCw,    color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300' },
};

export default function DocumentsLicenses() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();

  const [documents, setDocuments] = useState<HotelDocument[]>([]);
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [renewals, setRenewals] = useState<Record<string, Renewal[]>>({});

  // Form
  const [formTypeId, setFormTypeId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIssueDate, setFormIssueDate] = useState('');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formAlertDays, setFormAlertDays] = useState('30');
  const [formResponsible, setFormResponsible] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (selectedHotel?.id) loadData();
  }, [selectedHotel?.id]);

  async function loadData() {
    setLoading(true);
    const [docsRes, typesRes] = await Promise.all([
      supabase
        .from('hotel_documents')
        .select('*, document_types(name, category)')
        .eq('hotel_id', selectedHotel!.id)
        .order('expiry_date', { ascending: true }),
      supabase
        .from('document_types')
        .select('*')
        .or(`hotel_id.eq.${selectedHotel!.id},hotel_id.is.null`)
        .order('name'),
    ]);
    setDocuments(docsRes.data || []);
    setDocTypes(typesRes.data || []);
    setLoading(false);
  }

  function resetForm() {
    setFormTypeId('');
    setFormTitle('');
    setFormDescription('');
    setFormIssueDate('');
    setFormExpiryDate('');
    setFormAlertDays('30');
    setFormResponsible('');
    setFormNotes('');
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(d: HotelDocument) {
    setFormTypeId(d.document_type_id || '');
    setFormTitle(d.title);
    setFormDescription(d.description || '');
    setFormIssueDate(d.issue_date || '');
    setFormExpiryDate(d.expiry_date || '');
    setFormAlertDays(d.alert_days_before.toString());
    setFormResponsible(d.responsible || '');
    setFormNotes(d.notes || '');
    setEditingId(d.id);
    setShowForm(true);
  }

  async function saveDocument() {
    if (!formTitle.trim() || !selectedHotel) return;
    setSaving(true);

    const today = new Date();
    let status = 'valid';
    if (formExpiryDate) {
      const expiry = parseISO(formExpiryDate);
      const days = differenceInDays(expiry, today);
      if (days < 0) status = 'expired';
      else if (days <= parseInt(formAlertDays || '30')) status = 'expiring';
    }

    const payload = {
      hotel_id: selectedHotel.id,
      document_type_id: formTypeId || null,
      title: formTitle.trim(),
      description: formDescription.trim() || null,
      issue_date: formIssueDate || null,
      expiry_date: formExpiryDate || null,
      alert_days_before: parseInt(formAlertDays || '30'),
      status,
      responsible: formResponsible.trim() || null,
      notes: formNotes.trim() || null,
    };

    if (editingId) {
      await supabase.from('hotel_documents').update(payload).eq('id', editingId);
    } else {
      await supabase.from('hotel_documents').insert({ ...payload, created_by: user?.id });
    }

    setSaving(false);
    resetForm();
    loadData();
  }

  async function deleteDocument(id: string) {
    if (!confirm('Remover este documento?')) return;
    await supabase.from('hotel_documents').delete().eq('id', id);
    loadData();
  }

  async function toggleExpand(docId: string) {
    if (expandedDoc === docId) {
      setExpandedDoc(null);
      return;
    }
    setExpandedDoc(docId);
    if (!renewals[docId]) {
      const { data } = await supabase
        .from('document_renewals')
        .select('*')
        .eq('document_id', docId)
        .order('created_at', { ascending: false });
      setRenewals(prev => ({ ...prev, [docId]: data || [] }));
    }
  }

  async function addRenewalAction(docId: string, action: string) {
    const notes = prompt('Observações:');
    await supabase.from('document_renewals').insert({
      document_id: docId,
      action,
      notes: notes?.trim() || null,
      created_by: user?.id,
    });

    if (action === 'renewal_started') {
      await supabase.from('hotel_documents').update({ status: 'renewing' }).eq('id', docId);
    } else if (action === 'approved') {
      await supabase.from('hotel_documents').update({ status: 'valid' }).eq('id', docId);
    }

    setRenewals(prev => ({ ...prev, [docId]: undefined as any }));
    setExpandedDoc(null);
    loadData();
  }

  const today = new Date();

  const computedDocs = useMemo(() => {
    return documents.map(d => {
      let computedStatus = d.status;
      if (d.expiry_date && d.status !== 'renewing') {
        const days = differenceInDays(parseISO(d.expiry_date), today);
        if (days < 0) computedStatus = 'expired';
        else if (days <= d.alert_days_before) computedStatus = 'expiring';
        else computedStatus = 'valid';
      }
      return { ...d, computedStatus };
    });
  }, [documents]);

  const filtered = useMemo(() => {
    return computedDocs.filter(d => {
      if (search) {
        const q = search.toLowerCase();
        if (!d.title.toLowerCase().includes(q) && !(d.responsible || '').toLowerCase().includes(q)) return false;
      }
      if (filterStatus && d.computedStatus !== filterStatus) return false;
      if (filterCategory && d.document_types?.category !== filterCategory) return false;
      return true;
    });
  }, [computedDocs, search, filterStatus, filterCategory]);

  // Summary
  const summary = useMemo(() => {
    const valid = computedDocs.filter(d => d.computedStatus === 'valid').length;
    const expiring = computedDocs.filter(d => d.computedStatus === 'expiring').length;
    const expired = computedDocs.filter(d => d.computedStatus === 'expired').length;
    const renewing = computedDocs.filter(d => d.computedStatus === 'renewing').length;
    return { valid, expiring, expired, renewing, total: computedDocs.length };
  }, [computedDocs]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
            <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Documentos & Licenças</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{summary.total} documentos</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTypeManager(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm">
            <Settings className="w-4 h-4" /> Tipos
          </button>
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
            <Plus className="w-4 h-4" /> Novo Documento
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {(['valid', 'expiring', 'expired', 'renewing'] as const).map(s => {
          const cfg = STATUS_CONFIG[s];
          const Icon = cfg.icon;
          const count = summary[s];
          return (
            <button key={s} onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={`bg-white dark:bg-gray-800 rounded-xl border p-3 text-left transition-all ${
                filterStatus === s ? 'border-indigo-400 dark:border-indigo-500 ring-1 ring-indigo-200' : 'border-gray-200 dark:border-gray-700'
              }`}>
              <Icon className={`w-5 h-5 mb-1 ${cfg.color.split(' ')[0]}`} />
              <p className="text-xl font-bold text-gray-900 dark:text-white">{count}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{cfg.label}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título ou responsável..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
          <option value="">Todas categorias</option>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Documents List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 dark:text-gray-500 py-12">Nenhum documento encontrado</p>
        )}
        {filtered.map(d => {
          const st = STATUS_CONFIG[d.computedStatus] || STATUS_CONFIG.valid;
          const StIcon = st.icon;
          const days = d.expiry_date ? differenceInDays(parseISO(d.expiry_date), today) : null;
          const cat = d.document_types?.category ? CATEGORIES[d.document_types.category] : null;
          const isExpanded = expandedDoc === d.id;

          return (
            <div key={d.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${st.color}`}>
                  <StIcon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800 dark:text-white truncate">{d.title}</h3>
                    {cat && <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cat.color}`}>{cat.label}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {d.expiry_date && (
                      <span className={days !== null && days < 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                        Vence: {format(parseISO(d.expiry_date), 'dd/MM/yyyy')}
                        {days !== null && (days < 0 ? ` (${Math.abs(days)}d atraso)` : days <= 30 ? ` (${days}d)` : '')}
                      </span>
                    )}
                    {d.responsible && <span>Resp: {d.responsible}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => startEdit(d)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    <Edit2 className="w-4 h-4 text-gray-400" />
                  </button>
                  <button onClick={() => toggleExpand(d.id)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>
                  <button onClick={() => deleteDocument(d.id)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    <Trash2 className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
                  {d.description && <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{d.description}</p>}
                  {d.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Obs: {d.notes}</p>}

                  <div className="flex gap-2 mb-3">
                    <button onClick={() => addRenewalAction(d.id, 'renewal_started')}
                      className="text-xs px-2.5 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-lg font-medium hover:bg-blue-200">
                      Iniciar Renovação
                    </button>
                    <button onClick={() => addRenewalAction(d.id, 'submitted')}
                      className="text-xs px-2.5 py-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 rounded-lg font-medium hover:bg-amber-200">
                      Protocolar
                    </button>
                    <button onClick={() => addRenewalAction(d.id, 'approved')}
                      className="text-xs px-2.5 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded-lg font-medium hover:bg-green-200">
                      Aprovado
                    </button>
                  </div>

                  {/* Renewal History */}
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Histórico de Renovações</h4>
                  {renewals[d.id]?.length === 0 && <p className="text-xs text-gray-400">Sem registros</p>}
                  <div className="space-y-1.5">
                    {(renewals[d.id] || []).map(r => {
                      const actionLabels: Record<string, string> = {
                        renewal_started: 'Renovação iniciada', submitted: 'Protocolado', approved: 'Aprovado', rejected: 'Rejeitado',
                      };
                      return (
                        <div key={r.id} className="flex items-center gap-2 text-xs">
                          <span className="text-gray-400">{format(parseISO(r.created_at), 'dd/MM/yy HH:mm')}</span>
                          <span className="font-medium text-gray-700 dark:text-gray-200">{actionLabels[r.action] || r.action}</span>
                          {r.notes && <span className="text-gray-500">— {r.notes}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Document Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingId ? 'Editar Documento' : 'Novo Documento'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo de Documento</label>
                <select value={formTypeId} onChange={e => {
                  setFormTypeId(e.target.value);
                  const dt = docTypes.find(t => t.id === e.target.value);
                  if (dt && !formTitle) setFormTitle(dt.name);
                }}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                  <option value="">Personalizado...</option>
                  {docTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Título *</label>
                <input type="text" value={formTitle} onChange={e => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Descrição</label>
                <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Emissão</label>
                  <input type="date" value={formIssueDate} onChange={e => setFormIssueDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Vencimento</label>
                  <input type="date" value={formExpiryDate} onChange={e => setFormExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Alerta (dias)</label>
                  <input type="number" value={formAlertDays} onChange={e => setFormAlertDays(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Responsável</label>
                <input type="text" value={formResponsible} onChange={e => setFormResponsible(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Observações</label>
                <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetForm}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
              <button onClick={saveDocument} disabled={saving || !formTitle.trim()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Type Manager Modal */}
      {showTypeManager && (
        <DocumentTypeManager
          hotelId={selectedHotel?.id}
          types={docTypes}
          onClose={() => { setShowTypeManager(false); loadData(); }}
        />
      )}
    </div>
  );
}

// ─── Document Type Manager ──────────────────────────────────────────────────
function DocumentTypeManager({ hotelId, types, onClose }: {
  hotelId?: string; types: DocumentType[]; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('legal');
  const [months, setMonths] = useState('12');
  const [mandatory, setMandatory] = useState(true);
  const [saving, setSaving] = useState(false);

  async function addType() {
    if (!name.trim() || !hotelId) return;
    setSaving(true);
    await supabase.from('document_types').insert({
      hotel_id: hotelId,
      name: name.trim(),
      category,
      renewal_period_months: parseInt(months) || null,
      is_mandatory: mandatory,
    });
    setSaving(false);
    setName('');
    onClose();
  }

  async function deleteType(id: string) {
    if (!confirm('Remover este tipo de documento?')) return;
    await supabase.from('document_types').delete().eq('id', id);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Tipos de Documento</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="space-y-2 mb-4">
          {types.map(t => {
            const cat = t.category ? CATEGORIES[t.category] : null;
            return (
              <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t.name}</span>
                  {cat && <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${cat.color}`}>{cat.label}</span>}
                  {t.is_mandatory && <span className="ml-1 text-xs text-red-500">*</span>}
                </div>
                <button onClick={() => deleteType(t.id)} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
                  <Trash2 className="w-3.5 h-3.5 text-gray-400" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nome do tipo..."
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
          <div className="flex gap-2">
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input type="number" value={months} onChange={e => setMonths(e.target.value)} placeholder="Meses"
              className="w-20 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={mandatory} onChange={e => setMandatory(e.target.checked)} className="rounded" />
              Obrigatório
            </label>
            <button onClick={addType} disabled={saving || !name.trim()}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm disabled:opacity-50">
              Adicionar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
