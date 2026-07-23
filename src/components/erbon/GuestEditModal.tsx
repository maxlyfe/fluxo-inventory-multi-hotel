// src/components/erbon/GuestEditModal.tsx
// Formulário de adição/edição manual de hóspede na Erbon.
// Usado pelo modal universal de reserva (BookingDetailModal).
import React, { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { erbonService, ErbonGuest, ErbonGuestPayload } from '../../lib/erbonService';
import { useNotification } from '../../context/NotificationContext';
import Modal from '../Modal';

export interface UnifiedGuest {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  documents?: Array<{ documentType: string; number: string }>;
  inHouseData?: ErbonGuest;
}

const FormField: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string }> = ({ label, value, onChange, type = 'text' }) => (
  <div>
    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
  </div>
);

const GuestEditModal: React.FC<{
  hotelId: string;
  bookingId: number;
  guest: UnifiedGuest | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ hotelId, bookingId, guest, onClose, onSaved }) => {
  const { addNotification } = useNotification();
  const isEditing = !!guest;
  const ih = guest?.inHouseData;
  const doc = guest?.documents?.[0];

  const [form, setForm] = useState({
    name: guest?.name || [ih?.guestName, ih?.lastName].filter(Boolean).join(' ').trim() || '',
    email: guest?.email || ih?.contactEmail || '',
    phone: guest?.phone || '',
    birthDate: ih?.birthDate ? ih.birthDate.split('T')[0] : '',
    genderID: '',
    nationality: ih?.countryGuestISO || 'BR',
    profession: '',
    vehicleRegistration: '',
    documentType: doc?.documentType || 'CPF',
    documentNumber: doc?.number || '',
    country: ih?.countryGuestISO || 'BR',
    state: ih?.stateGuest || '',
    city: ih?.localityGuest || '',
    street: '', zipcode: '', neighborhood: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) { addNotification('Nome é obrigatório', 'error'); return; }
    setSaving(true);
    try {
      const payload: ErbonGuestPayload = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        birthDate: form.birthDate ? new Date(form.birthDate).toISOString() : null,
        genderID: form.genderID ? parseInt(form.genderID, 10) : null,
        nationality: form.nationality.trim() || null,
        profession: form.profession.trim() || null,
        vehicleRegistration: form.vehicleRegistration.trim() || null,
        isClient: true, isProvider: false,
        address: { country: form.country || null, state: form.state || null, city: form.city || null, street: form.street || null, zipcode: form.zipcode || null, neighborhood: form.neighborhood || null },
        documents: form.documentNumber.trim() ? [{ documentType: form.documentType, number: form.documentNumber.trim() }] : [],
      };
      if (isEditing && guest?.id) {
        await erbonService.updateGuest(hotelId, guest.id, payload);
        addNotification(`Hóspede ${payload.name} atualizado`, 'success');
      } else {
        await erbonService.addGuestToBooking(hotelId, bookingId, payload);
        addNotification(`Hóspede ${payload.name} adicionado`, 'success');
      }
      onSaved();
    } catch (err: any) {
      addNotification(`Erro: ${err.message}`, 'error');
    } finally { setSaving(false); }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={isEditing ? 'Editar Hóspede' : 'Adicionar Hóspede'} size="2xl">
      <div className="space-y-5">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Dados Pessoais</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><FormField label="Nome Completo *" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} /></div>
            <FormField label="E-mail" type="email" value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} />
            <FormField label="Telefone" value={form.phone} onChange={v => setForm(p => ({ ...p, phone: v }))} />
            <FormField label="Data de Nascimento" type="date" value={form.birthDate} onChange={v => setForm(p => ({ ...p, birthDate: v }))} />
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Gênero</label>
              <select value={form.genderID} onChange={e => setForm(p => ({ ...p, genderID: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-800 dark:text-white">
                <option value="">— não informado —</option>
                <option value="1">Masculino</option>
                <option value="2">Feminino</option>
                <option value="3">Outro</option>
              </select>
            </div>
            <FormField label="Profissão" value={form.profession} onChange={v => setForm(p => ({ ...p, profession: v }))} />
            <FormField label="Nacionalidade (ISO)" value={form.nationality} onChange={v => setForm(p => ({ ...p, nationality: v.toUpperCase() }))} />
            <FormField label="Placa Veículo" value={form.vehicleRegistration} onChange={v => setForm(p => ({ ...p, vehicleRegistration: v.toUpperCase() }))} />
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Documento</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
              <select value={form.documentType} onChange={e => setForm(p => ({ ...p, documentType: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-800 dark:text-white">
                <option value="CPF">CPF</option><option value="RG">RG</option>
                <option value="PASSPORT">Passaporte</option><option value="CNH">CNH</option><option value="OTHER">Outro</option>
              </select>
            </div>
            <FormField label="Número" value={form.documentNumber} onChange={v => setForm(p => ({ ...p, documentNumber: v }))} />
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Endereço</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="País" value={form.country} onChange={v => setForm(p => ({ ...p, country: v.toUpperCase() }))} />
            <FormField label="Estado" value={form.state} onChange={v => setForm(p => ({ ...p, state: v.toUpperCase() }))} />
            <FormField label="Cidade" value={form.city} onChange={v => setForm(p => ({ ...p, city: v }))} />
            <FormField label="Bairro" value={form.neighborhood} onChange={v => setForm(p => ({ ...p, neighborhood: v }))} />
            <FormField label="Rua" value={form.street} onChange={v => setForm(p => ({ ...p, street: v }))} />
            <FormField label="CEP" value={form.zipcode} onChange={v => setForm(p => ({ ...p, zipcode: v }))} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 rounded-lg transition">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg shadow-sm transition disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEditing ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default GuestEditModal;
