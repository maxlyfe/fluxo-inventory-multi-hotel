// src/pages/SupplierContacts.tsx
// CRUD de contatos de fornecedores — integração WhatsApp

import React, { useState, useEffect } from 'react';
import {
  Phone, Plus, Search, Loader2, Trash2, Edit3, X, Building2, User, Mail, MessageSquare, Check,
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import {
  whatsappService,
  SupplierContact,
  isValidWhatsAppNumber,
  formatWhatsAppNumber,
} from '../lib/whatsappService';

// ── CSS helpers ──────────────────────────────────────────────────────────────
const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors';
const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';
const btnPrimary = 'flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';

// ── Modal de contato ────────────────────────────────────────────────────────

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  contact: SupplierContact | null;
  hotelId: string;
}

const ContactModal: React.FC<ContactModalProps> = ({ isOpen, onClose, onSave, contact, hotelId }) => {
  const { addNotification } = useNotification();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    whatsapp_number: '',
    email: '',
    notes: '',
  });

  useEffect(() => {
    if (contact) {
      setForm({
        company_name: contact.company_name,
        contact_name: contact.contact_name || '',
        whatsapp_number: contact.whatsapp_number,
        email: contact.email || '',
        notes: contact.notes || '',
      });
    } else {
      setForm({ company_name: '', contact_name: '', whatsapp_number: '', email: '', notes: '' });
    }
  }, [contact, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company_name.trim()) return;

    if (!isValidWhatsAppNumber(form.whatsapp_number)) {
      addNotification('Número WhatsApp inválido. Use formato: +55 11 99999-9999', 'error');
      return;
    }

    setSaving(true);
    try {
      await whatsappService.saveContact({
        id: contact?.id,
        hotel_id: hotelId,
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim() || null,
        whatsapp_number: formatWhatsAppNumber(form.whatsapp_number),
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      });
      addNotification(contact ? 'Contato atualizado!' : 'Contato criado!', 'success');
      onSave();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar';
      addNotification(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full">
        <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Phone className="w-5 h-5 text-green-500" />
            {contact ? 'Editar Contato' : 'Novo Contato'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Empresa *</label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={form.company_name} onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))}
                className={`${inputCls} pl-10`} placeholder="Nome da empresa" required />
            </div>
          </div>

          <div>
            <label className={labelCls}>Contato (pessoa)</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={form.contact_name} onChange={e => setForm(p => ({ ...p, contact_name: e.target.value }))}
                className={`${inputCls} pl-10`} placeholder="Nome do contato" />
            </div>
          </div>

          <div>
            <label className={labelCls}>WhatsApp *</label>
            <div className="relative">
              <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
              <input value={form.whatsapp_number} onChange={e => setForm(p => ({ ...p, whatsapp_number: e.target.value }))}
                className={`${inputCls} pl-10`} placeholder="+55 11 99999-9999" required />
            </div>
          </div>

          <div>
            <label className={labelCls}>E-mail</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                type="email" className={`${inputCls} pl-10`} placeholder="email@empresa.com" />
            </div>
          </div>

          <div>
            <label className={labelCls}>Observações</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              className={inputCls} rows={2} placeholder="Notas sobre o fornecedor..." />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {contact ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Página principal ────────────────────────────────────────────────────────

const SupplierContacts: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<SupplierContact | null>(null);

  const loadContacts = async () => {
    if (!selectedHotel) return;
    setLoading(true);
    try {
      const data = await whatsappService.getContacts(selectedHotel.id);
      setContacts(data);
    } catch {
      addNotification('Erro ao carregar contatos', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadContacts(); }, [selectedHotel]);

  const handleDelete = async (contact: SupplierContact) => {
    if (!confirm(`Desativar contato "${contact.company_name}"?`)) return;
    try {
      await whatsappService.deleteContact(contact.id);
      addNotification('Contato removido', 'success');
      loadContacts();
    } catch {
      addNotification('Erro ao remover contato', 'error');
    }
  };

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    return c.company_name.toLowerCase().includes(q)
      || (c.contact_name || '').toLowerCase().includes(q)
      || c.whatsapp_number.includes(q);
  });

  if (!selectedHotel) {
    return <div className="p-8 text-center text-gray-500">Selecione um hotel para gerenciar contatos.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Phone className="w-7 h-7 text-green-500" />
            Contatos de Fornecedores
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Gerencie os contatos WhatsApp dos fornecedores para envio automático.
          </p>
        </div>
        <button onClick={() => { setEditingContact(null); setModalOpen(true); }} className={btnPrimary}>
          <Plus className="w-4 h-4" /> Novo Contato
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          className={`${inputCls} pl-10`} placeholder="Buscar por empresa, contato ou número..." />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Phone className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            {search ? 'Nenhum contato encontrado.' : 'Nenhum contato cadastrado. Clique em "Novo Contato" para começar.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(contact => (
            <div key={contact.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
              {/* Avatar */}
              <div className="flex-shrink-0 w-11 h-11 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate">{contact.company_name}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {contact.contact_name && (
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{contact.contact_name}</span>
                  )}
                  <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                    <MessageSquare className="w-3 h-3" />{contact.whatsapp_number}
                  </span>
                  {contact.email && (
                    <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{contact.email}</span>
                  )}
                </div>
                {contact.notes && (
                  <p className="text-xs text-gray-400 mt-1 truncate">{contact.notes}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5">
                <button onClick={() => { setEditingContact(contact); setModalOpen(true); }}
                  className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                  title="Editar">
                  <Edit3 className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(contact)}
                  className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title="Remover">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <ContactModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={loadContacts}
        contact={editingContact}
        hotelId={selectedHotel.id}
      />
    </div>
  );
};

export default SupplierContacts;
