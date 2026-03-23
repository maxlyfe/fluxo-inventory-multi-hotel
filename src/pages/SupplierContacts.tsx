// src/pages/SupplierContacts.tsx
// Agenda de contatos compartilhada — com categorias dinâmicas

import React, { useState, useEffect } from 'react';
import {
  Phone, Plus, Search, Loader2, Trash2, Edit3, X, Building2, User, Mail,
  MessageSquare, Check, Tag, Settings2, Palette,
} from 'lucide-react';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { usePermissions } from '../hooks/usePermissions';
import {
  whatsappService,
  SupplierContact,
  ContactCategory,
  isValidWhatsAppNumber,
  formatWhatsAppNumber,
} from '../lib/whatsappService';

// ── CSS helpers ──────────────────────────────────────────────────────────────
const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors';
const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';
const btnPrimary = 'flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';

// ── Cores disponíveis para categorias ────────────────────────────────────────
const CATEGORY_COLORS = [
  '#16A34A', '#3B82F6', '#F59E0B', '#8B5CF6', '#EF4444',
  '#EC4899', '#06B6D4', '#F97316', '#6B7280', '#14B8A6',
];

// ── Modal de Categoria ───────────────────────────────────────────────────────

interface CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  category: ContactCategory | null;
}

const CategoryModal: React.FC<CategoryModalProps> = ({ isOpen, onClose, onSave, category }) => {
  const { addNotification } = useNotification();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6B7280');

  useEffect(() => {
    if (category) {
      setName(category.name);
      setColor(category.color);
    } else {
      setName('');
      setColor('#6B7280');
    }
  }, [category, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await whatsappService.saveCategory({ id: category?.id, name: name.trim(), color });
      addNotification(category ? 'Categoria atualizada!' : 'Categoria criada!', 'success');
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
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full">
        <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Tag className="w-5 h-5" style={{ color }} />
            {category ? 'Editar Categoria' : 'Nova Categoria'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Nome *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className={inputCls} placeholder="Ex: Fornecedor, Colaborador..." required />
          </div>
          <div>
            <label className={labelCls}>Cor</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${color === c ? 'border-gray-900 dark:border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {category ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Modal de Contato ─────────────────────────────────────────────────────────

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  contact: SupplierContact | null;
  hotelId: string | null;
  categories: ContactCategory[];
}

const ContactModal: React.FC<ContactModalProps> = ({ isOpen, onClose, onSave, contact, hotelId, categories }) => {
  const { addNotification } = useNotification();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    whatsapp_number: '',
    email: '',
    notes: '',
    category_id: '',
  });

  useEffect(() => {
    if (contact) {
      setForm({
        company_name: contact.company_name,
        contact_name: contact.contact_name || '',
        whatsapp_number: contact.whatsapp_number,
        email: contact.email || '',
        notes: contact.notes || '',
        category_id: contact.category_id || '',
      });
    } else {
      setForm({ company_name: '', contact_name: '', whatsapp_number: '', email: '', notes: '', category_id: categories[0]?.id || '' });
    }
  }, [contact, isOpen, categories]);

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
        hotel_id: hotelId || undefined,
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim() || null,
        whatsapp_number: formatWhatsAppNumber(form.whatsapp_number),
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
        category_id: form.category_id || null,
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
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
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
          {/* Categoria */}
          <div>
            <label className={labelCls}>Categoria</label>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button key={cat.id} type="button"
                  onClick={() => setForm(p => ({ ...p, category_id: cat.id }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${
                    form.category_id === cat.id
                      ? 'text-white border-transparent'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
                  }`}
                  style={form.category_id === cat.id ? { backgroundColor: cat.color, borderColor: cat.color } : {}}>
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Nome / Empresa *</label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={form.company_name} onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))}
                className={`${inputCls} pl-10`} placeholder="Nome da empresa ou contato" required />
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
              className={inputCls} rows={2} placeholder="Notas sobre o contato..." />
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
  const { isAdmin, allowedContactCategories } = usePermissions();

  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [categories, setCategories] = useState<ContactCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<SupplierContact | null>(null);

  // Categorias
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ContactCategory | null>(null);
  const [showCatManager, setShowCatManager] = useState(false);

  // Categorias visíveis (filtradas por permissão do usuário)
  const visibleCategories = isAdmin
    ? categories
    : categories.filter(c => allowedContactCategories.includes(c.id));

  const loadData = async () => {
    setLoading(true);
    try {
      const [contactsData, catsData] = await Promise.all([
        whatsappService.getContacts(),
        whatsappService.getCategories(),
      ]);
      setContacts(contactsData);
      setCategories(catsData);
    } catch {
      addNotification('Erro ao carregar dados', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleDelete = async (contact: SupplierContact) => {
    if (!confirm(`Desativar contato "${contact.company_name}"?`)) return;
    try {
      await whatsappService.deleteContact(contact.id);
      addNotification('Contato removido', 'success');
      loadData();
    } catch {
      addNotification('Erro ao remover contato', 'error');
    }
  };

  const handleDeleteCategory = async (cat: ContactCategory) => {
    if (!confirm(`Remover categoria "${cat.name}"? Os contatos serão desvinculados.`)) return;
    try {
      await whatsappService.deleteCategory(cat.id);
      addNotification('Categoria removida', 'success');
      if (filterCategory === cat.id) setFilterCategory(null);
      loadData();
    } catch {
      addNotification('Erro ao remover categoria', 'error');
    }
  };

  // Contatos filtrados por permissão de categoria do usuário
  const permissionFiltered = isAdmin
    ? contacts
    : contacts.filter(c => {
        if (!c.category_id) return allowedContactCategories.length > 0; // sem categoria: visível se tem alguma permissão
        return allowedContactCategories.includes(c.category_id);
      });

  const filtered = permissionFiltered.filter(c => {
    const q = search.toLowerCase();
    const matchText = c.company_name.toLowerCase().includes(q)
      || (c.contact_name || '').toLowerCase().includes(q)
      || c.whatsapp_number.includes(q);
    const matchCat = !filterCategory
      || (filterCategory === '__none' ? !c.category_id : c.category_id === filterCategory);
    return matchText && matchCat;
  });

  // Contagem por categoria (apenas categorias visíveis)
  const catCounts = visibleCategories.map(cat => ({
    ...cat,
    count: permissionFiltered.filter(c => c.category_id === cat.id).length,
  }));
  const uncategorizedCount = permissionFiltered.filter(c => !c.category_id).length;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Phone className="w-7 h-7 text-green-500" />
            Agenda de Contatos
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Agenda compartilhada entre todos os hotéis — {contacts.length} contato{contacts.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button onClick={() => setShowCatManager(!showCatManager)}
              className="flex items-center gap-2 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              title="Gerenciar categorias">
              <Settings2 className="w-4 h-4" /> Categorias
            </button>
          )}
          <button onClick={() => { setEditingContact(null); setModalOpen(true); }} className={btnPrimary}>
            <Plus className="w-4 h-4" /> Novo Contato
          </button>
        </div>
      </div>

      {/* Category Manager (collapsible) */}
      {showCatManager && (
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Palette className="w-4 h-4" /> Gerenciar Categorias
            </h3>
            <button onClick={() => { setEditingCategory(null); setCatModalOpen(true); }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all">
              <Plus className="w-3 h-3" /> Nova
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <div key={cat.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{cat.name}</span>
                <button onClick={() => { setEditingCategory(cat); setCatModalOpen(true); }}
                  className="text-gray-400 hover:text-blue-500 transition-colors ml-1">
                  <Edit3 className="w-3 h-3" />
                </button>
                <button onClick={() => handleDeleteCategory(cat)}
                  className="text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            {categories.length === 0 && (
              <p className="text-xs text-gray-400">Nenhuma categoria. Crie uma para organizar seus contatos.</p>
            )}
          </div>
        </div>
      )}

      {/* Search + Category Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className={`${inputCls} pl-10`} placeholder="Buscar por empresa, contato ou número..." />
        </div>
      </div>

      {/* Category filter chips */}
      {visibleCategories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setFilterCategory(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
              !filterCategory
                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent'
                : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
            }`}>
            Todos ({permissionFiltered.length})
          </button>
          {catCounts.map(cat => (
            <button key={cat.id} onClick={() => setFilterCategory(filterCategory === cat.id ? null : cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${
                filterCategory === cat.id
                  ? 'text-white border-transparent'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
              }`}
              style={filterCategory === cat.id ? { backgroundColor: cat.color, borderColor: cat.color } : {}}>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: filterCategory === cat.id ? '#fff' : cat.color }} />
                {cat.name} ({cat.count})
              </span>
            </button>
          ))}
          {uncategorizedCount > 0 && (
            <button onClick={() => setFilterCategory(filterCategory === '__none' ? null : '__none')}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                filterCategory === '__none'
                  ? 'bg-gray-500 text-white border-transparent'
                  : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400'
              }`}>
              Sem categoria ({uncategorizedCount})
            </button>
          )}
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Phone className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            {search || filterCategory ? 'Nenhum contato encontrado.' : 'Nenhum contato cadastrado. Clique em "Novo Contato" para começar.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(contact => {
            const cat = contact.contact_categories;
            return (
              <div key={contact.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                {/* Avatar with category color */}
                <div className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: cat ? `${cat.color}20` : '#dcfce720' }}>
                  <Building2 className="w-5 h-5" style={{ color: cat?.color || '#16A34A' }} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 dark:text-white truncate">{contact.company_name}</p>
                    {cat && (
                      <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: cat.color }}>
                        {cat.name}
                      </span>
                    )}
                  </div>
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
            );
          })}
        </div>
      )}

      {/* Modals */}
      <ContactModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={loadData}
        contact={editingContact}
        hotelId={selectedHotel?.id || null}
        categories={isAdmin ? categories : visibleCategories}
      />
      <CategoryModal
        isOpen={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        onSave={loadData}
        category={editingCategory}
      />
    </div>
  );
};

export default SupplierContacts;
