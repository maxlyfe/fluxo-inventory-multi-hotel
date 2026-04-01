// src/pages/commercial/CorporateClients.tsx
// CRUD de clientes corporativos com contratos e tarifas

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { format, parseISO, differenceInDays } from 'date-fns';
import {
  Building2, Search, Loader2, Plus, Edit2, Trash2, Save, X,
  Phone, Mail, User, DollarSign, Calendar, CheckCircle, XCircle,
} from 'lucide-react';

interface CorporateClient {
  id: string;
  company_name: string;
  cnpj: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contracted_rate: number | null;
  rate_type: string | null;
  contract_start: string | null;
  contract_end: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

const RATE_TYPES: Record<string, string> = {
  fixo: 'Tarifa Fixa',
  desconto_percentual: 'Desconto %',
  last_room: 'Last Room Value',
};

export default function CorporateClients() {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();

  const [clients, setClients] = useState<CorporateClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form
  const [formName, setFormName] = useState('');
  const [formCnpj, setFormCnpj] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formContactPhone, setFormContactPhone] = useState('');
  const [formContactEmail, setFormContactEmail] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formRateType, setFormRateType] = useState('fixo');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (selectedHotel?.id) loadData();
  }, [selectedHotel?.id]);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase
      .from('corporate_clients')
      .select('*')
      .eq('hotel_id', selectedHotel!.id)
      .order('company_name');
    setClients(data || []);
    setLoading(false);
  }

  function resetForm() {
    setFormName(''); setFormCnpj(''); setFormContactName(''); setFormContactPhone('');
    setFormContactEmail(''); setFormRate(''); setFormRateType('fixo');
    setFormStart(''); setFormEnd(''); setFormNotes('');
    setEditingId(null); setShowForm(false);
  }

  function startEdit(c: CorporateClient) {
    setFormName(c.company_name);
    setFormCnpj(c.cnpj || '');
    setFormContactName(c.contact_name || '');
    setFormContactPhone(c.contact_phone || '');
    setFormContactEmail(c.contact_email || '');
    setFormRate(c.contracted_rate?.toString() || '');
    setFormRateType(c.rate_type || 'fixo');
    setFormStart(c.contract_start || '');
    setFormEnd(c.contract_end || '');
    setFormNotes(c.notes || '');
    setEditingId(c.id); setShowForm(true);
  }

  async function saveClient() {
    if (!formName.trim() || !selectedHotel) return;
    setSaving(true);
    const payload = {
      hotel_id: selectedHotel.id,
      company_name: formName.trim(),
      cnpj: formCnpj.trim() || null,
      contact_name: formContactName.trim() || null,
      contact_phone: formContactPhone.trim() || null,
      contact_email: formContactEmail.trim() || null,
      contracted_rate: formRate ? parseFloat(formRate) : null,
      rate_type: formRateType || null,
      contract_start: formStart || null,
      contract_end: formEnd || null,
      notes: formNotes.trim() || null,
    };
    if (editingId) {
      await supabase.from('corporate_clients').update(payload).eq('id', editingId);
    } else {
      await supabase.from('corporate_clients').insert({ ...payload, created_by: user?.id });
    }
    setSaving(false); resetForm(); loadData();
  }

  async function toggleActive(c: CorporateClient) {
    await supabase.from('corporate_clients').update({ is_active: !c.is_active }).eq('id', c.id);
    loadData();
  }

  async function deleteClient(id: string) {
    if (!confirm('Remover este cliente corporativo?')) return;
    await supabase.from('corporate_clients').delete().eq('id', id);
    loadData();
  }

  const filtered = useMemo(() => {
    return clients.filter(c => {
      if (search && !c.company_name.toLowerCase().includes(search.toLowerCase()) && !(c.cnpj || '').includes(search)) return false;
      if (filterActive === 'active' && !c.is_active) return false;
      if (filterActive === 'inactive' && c.is_active) return false;
      return true;
    });
  }, [clients, search, filterActive]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Clientes Corporativos</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{clients.filter(c => c.is_active).length} ativos de {clients.length}</p>
          </div>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm font-medium">
          <Plus className="w-4 h-4" /> Novo Cliente
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar empresa ou CNPJ..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
        </div>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && <p className="text-center text-gray-400 py-12">Nenhum cliente encontrado</p>}
        {filtered.map(c => {
          const contractExpiring = c.contract_end && differenceInDays(parseISO(c.contract_end), new Date()) <= 30 && differenceInDays(parseISO(c.contract_end), new Date()) >= 0;
          const contractExpired = c.contract_end && parseISO(c.contract_end) < new Date();
          return (
            <div key={c.id} className={`bg-white dark:bg-gray-800 rounded-xl border p-4 ${!c.is_active ? 'opacity-60 border-gray-200 dark:border-gray-700' : 'border-gray-200 dark:border-gray-700'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800 dark:text-white">{c.company_name}</h3>
                    {!c.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-700">Inativo</span>}
                    {contractExpired && <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">Contrato vencido</span>}
                    {contractExpiring && !contractExpired && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">Contrato vencendo</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {c.cnpj && <span>{c.cnpj}</span>}
                    {c.contact_name && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {c.contact_name}</span>}
                    {c.contact_phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.contact_phone}</span>}
                    {c.contact_email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {c.contact_email}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {c.contracted_rate && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> R$ {c.contracted_rate.toLocaleString('pt-BR')} ({RATE_TYPES[c.rate_type || ''] || c.rate_type})</span>}
                    {c.contract_start && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(parseISO(c.contract_start), 'dd/MM/yy')} — {c.contract_end ? format(parseISO(c.contract_end), 'dd/MM/yy') : 'Indeterminado'}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button onClick={() => toggleActive(c)} title={c.is_active ? 'Desativar' : 'Ativar'}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    {c.is_active ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-400" />}
                  </button>
                  <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    <Edit2 className="w-4 h-4 text-gray-400" />
                  </button>
                  <button onClick={() => deleteClient(c.id)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    <Trash2 className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{editingId ? 'Editar Cliente' : 'Novo Cliente Corporativo'}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Empresa *</label>
                  <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">CNPJ</label>
                  <input type="text" value={formCnpj} onChange={e => setFormCnpj(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Contato</label>
                  <input type="text" value={formContactName} onChange={e => setFormContactName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Telefone</label>
                  <input type="tel" value={formContactPhone} onChange={e => setFormContactPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">E-mail</label>
                  <input type="email" value={formContactEmail} onChange={e => setFormContactEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tarifa Negociada</label>
                  <input type="number" value={formRate} onChange={e => setFormRate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo de Tarifa</label>
                  <select value={formRateType} onChange={e => setFormRateType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                    {Object.entries(RATE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Início Contrato</label>
                  <input type="date" value={formStart} onChange={e => setFormStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Fim Contrato</label>
                  <input type="date" value={formEnd} onChange={e => setFormEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Observações</label>
                <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetForm} className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
              <button onClick={saveClient} disabled={saving || !formName.trim()}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm font-medium disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
