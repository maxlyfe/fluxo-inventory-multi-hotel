// src/pages/erbon/CheckInList.tsx
import React, { useState, useCallback } from 'react';
import {
  LogIn, LogOut, RefreshCw, Loader2, Calendar, BedDouble, Users,
  UserCheck, Search, FileText, User, DollarSign,
  UserPlus, Edit2, Trash2, Save, Plus, MapPin, Mail, Phone,
  CreditCard, Star, Clock, X, ChevronRight,
} from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  erbonService, ErbonBooking, ErbonGuest, ErbonGuestPayload
} from '../../lib/erbonService';
import { useErbonData } from '../../hooks/useErbonData';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import ErbonNotConfigured from '../../components/erbon/ErbonNotConfigured';
import Modal from '../../components/Modal';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd/MM/yyyy', { locale: ptBR }); } catch { return d; }
}
function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  try { return format(parseISO(d), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); } catch { return d; }
}
function fmtBRL(v?: number | null) {
  if (v == null) return 'R$ 0,00';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function getNights(a?: string, b?: string) {
  if (!a || !b) return 0;
  try { return differenceInDays(parseISO(b), parseISO(a)); } catch { return 0; }
}

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED:  'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  PENDING:    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  CHECKIN:    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  CANCELLED:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};
const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmada',
  PENDING:   'Pendente',
  CHECKIN:   'Check-in Feito',
  CANCELLED: 'Cancelada',
};

// ── Small shared UI ───────────────────────────────────────────────────────────

const DetailCard: React.FC<{ icon: React.ComponentType<any>; label: string; value: string; valueColor?: string }> = ({ icon: Icon, label, value, valueColor }) => (
  <div className="bg-white dark:bg-gray-800/60 rounded-xl px-3 py-2.5 border border-gray-100 dark:border-gray-700/50 flex items-center gap-2.5">
    <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-sm font-semibold truncate ${valueColor || 'text-gray-800 dark:text-white'}`}>{value}</p>
    </div>
  </div>
);

const InfoRow: React.FC<{ icon: React.ComponentType<any>; value: string }> = ({ icon: Icon, value }) => (
  <div className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700/50">
    <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" /><span className="truncate">{value}</span>
  </div>
);

const FormField: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string }> = ({ label, value, onChange, type = 'text' }) => (
  <div>
    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
  </div>
);

// ── GuestEditModal ────────────────────────────────────────────────────────────

interface UnifiedGuest {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  documents?: Array<{ documentType: string; number: string }>;
  inHouseData?: ErbonGuest;
}

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

// ── Booking Detail Modal (Check-in) ──────────────────────────────────────────

const BookingModal: React.FC<{
  hotelId: string;
  booking: ErbonBooking;
  onClose: () => void;
  onDone: () => void;
}> = ({ hotelId, booking, onClose, onDone }) => {
  const { addNotification } = useNotification();
  const [activeTab, setActiveTab] = useState<'reserva' | 'hospede' | 'conta'>('reserva');
  const [inHouseGuests, setInHouseGuests] = useState<ErbonGuest[]>([]);
  const [accountEntries, setAccountEntries] = useState<any[]>([]);
  const [loadingGuests, setLoadingGuests] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [editingGuest, setEditingGuest] = useState<UnifiedGuest | null>(null);
  const [addingGuest, setAddingGuest] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [deletingGuestId, setDeletingGuestId] = useState<number | null>(null);

  const nights = getNights(booking.checkInDateTime, booking.checkOutDateTime);
  const isPending = booking.status !== 'CHECKIN';

  // Merge guestList + in-house
  const allGuests: UnifiedGuest[] = React.useMemo(() => {
    const map = new Map<number, UnifiedGuest>();
    (booking.guestList || []).forEach(g => map.set(g.id, { id: g.id, name: g.name, email: g.email, phone: g.phone, documents: g.documents }));
    inHouseGuests.forEach(g => {
      if (!map.has(g.idGuest)) {
        map.set(g.idGuest, { id: g.idGuest, name: g.guestName, email: g.contactEmail, inHouseData: g });
      } else {
        const ex = map.get(g.idGuest)!;
        ex.inHouseData = g;
        map.set(g.idGuest, ex);
      }
    });
    return Array.from(map.values());
  }, [booking.guestList, inHouseGuests]);

  const loadGuests = useCallback(async () => {
    setLoadingGuests(true);
    try {
      const all = await erbonService.fetchInHouseGuests(hotelId);
      setInHouseGuests(all.filter(g => g.idBooking === booking.bookingInternalID));
    } catch { } finally { setLoadingGuests(false); }
  }, [hotelId, booking.bookingInternalID]);

  const loadAccount = useCallback(async () => {
    setLoadingAccount(true);
    try {
      const data = await erbonService.fetchBookingAccount(hotelId, booking.bookingInternalID);
      setAccountEntries(data);
    } catch { } finally { setLoadingAccount(false); }
  }, [hotelId, booking.bookingInternalID]);

  React.useEffect(() => { loadGuests(); }, [loadGuests]);
  React.useEffect(() => { if (activeTab === 'conta') loadAccount(); }, [activeTab, loadAccount]);

  const handleDeleteGuest = async (guestId: number) => {
    if (!window.confirm('Remover este hóspede da reserva?')) return;
    setDeletingGuestId(guestId);
    try {
      await erbonService.removeGuestFromBooking(hotelId, booking.bookingInternalID, guestId);
      addNotification('Hóspede removido', 'success');
      loadGuests();
    } catch (err: any) { addNotification('Erro: ' + err.message, 'error'); }
    finally { setDeletingGuestId(null); }
  };

  const handleCheckIn = async () => {
    if (!window.confirm(`Confirmar check-in da reserva #${booking.erbonNumber}?`)) return;
    setCheckingIn(true);
    try {
      await erbonService.checkInBooking(hotelId, booking.bookingInternalID);
      addNotification(`✅ Check-in realizado — Reserva #${booking.erbonNumber}`, 'success');
      onDone();
    } catch (err: any) { addNotification('Erro no check-in: ' + err.message, 'error'); }
    finally { setCheckingIn(false); }
  };

  const totalDebit = accountEntries.filter(e => e.isDebit).reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalCredit = accountEntries.filter(e => e.isCredit).reduce((s, e) => s + Number(e.amount || 0), 0);

  return (
    <Modal isOpen={true} onClose={onClose} title="" size="4xl">
      {/* Hero */}
      <div className="-mt-4 -mx-4 mb-5">
        <div className={`relative overflow-hidden rounded-t-lg ${isPending ? 'bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600' : 'bg-gradient-to-r from-sky-700 via-sky-600 to-cyan-600'}`}>
          <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-white/10" />
          <div className="relative px-6 py-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-lg">
                <span className="text-lg font-black text-white">{booking.roomDescription || '—'}</span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{booking.guestList?.[0]?.name || 'Hóspede'}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs bg-white/20 text-white/90 px-2 py-0.5 rounded-full font-medium">{booking.roomTypeDescription}</span>
                  <span className="text-xs text-white/60">· #{booking.erbonNumber}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[booking.status] || 'bg-white/20 text-white/80'}`}>
                    {STATUS_LABEL[booking.status] || booking.status}
                  </span>
                </div>
              </div>
            </div>
            {isPending && (
              <button onClick={handleCheckIn} disabled={checkingIn}
                className="flex items-center gap-2 px-4 py-2 bg-white text-emerald-700 hover:bg-emerald-50 font-semibold rounded-xl shadow-lg transition disabled:opacity-50">
                {checkingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                {checkingIn ? 'Processando...' : 'Fazer Check-in'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl mb-5">
        {([
          { key: 'reserva' as const, label: 'Reserva', icon: FileText },
          { key: 'hospede' as const, label: 'Hóspede', icon: User },
          { key: 'conta' as const, label: 'Financeiro', icon: DollarSign },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === tab.key ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <tab.icon className="w-4 h-4" />{tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Reserva */}
      {activeTab === 'reserva' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <DetailCard icon={FileText} label="Reserva" value={`#${booking.erbonNumber}`} />
            <DetailCard icon={BedDouble} label="UH / Tipo" value={`${booking.roomDescription || '—'} · ${booking.roomTypeDescription}`} />
            <DetailCard icon={LogIn} label="Check-in" value={fmtDate(booking.checkInDateTime)} />
            <DetailCard icon={LogOut} label="Check-out" value={fmtDate(booking.checkOutDateTime)} />
            <DetailCard icon={Clock} label="Noites" value={`${nights}`} />
            <DetailCard icon={Users} label="Adultos" value={`${booking.adultQuantity}`} />
            <DetailCard icon={Star} label="Status" value={STATUS_LABEL[booking.status] || booking.status || '—'} />
            {booking.rateDesc && <DetailCard icon={DollarSign} label="Tarifa" value={booking.rateDesc} />}
          </div>
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-5 border border-gray-200 dark:border-gray-700/50">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-500" /> Resumo Financeiro
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Diária Média</p>
                <p className="text-lg font-bold text-gray-800 dark:text-white">{nights > 0 ? fmtBRL(booking.totalBookingRate / nights) : '—'}</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Total s/ Taxa</p>
                <p className="text-lg font-bold text-gray-800 dark:text-white">{fmtBRL(booking.totalBookingRate)}</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-200 dark:border-emerald-800/50">
                <p className="text-[10px] uppercase tracking-wide text-emerald-600 mb-1">Total c/ Taxa</p>
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{fmtBRL(booking.totalBookingRateWithTax)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
              {booking.segmentDesc && <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">Segmento: <b>{booking.segmentDesc}</b></span>}
              {booking.sourceDesc && <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">Origem: <b>{booking.sourceDesc}</b></span>}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Hóspede */}
      {activeTab === 'hospede' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Hóspedes da Reserva ({allGuests.length})</h3>
            <button onClick={() => setAddingGuest(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition shadow-sm">
              <UserPlus className="w-3.5 h-3.5" /> Adicionar Hóspede
            </button>
          </div>
          {loadingGuests ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>
          ) : allGuests.length === 0 ? (
            <div className="text-center py-10 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              <User className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Nenhum hóspede cadastrado nesta reserva.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {allGuests.map(g => {
                const ih = g.inHouseData;
                return (
                  <div key={g.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                          <User className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800 dark:text-white">{g.name || ih?.guestName}</p>
                          <p className="text-xs text-gray-400">ID #{g.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditingGuest(g)} className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteGuest(g.id)} disabled={deletingGuestId === g.id}
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50">
                          {deletingGuestId === g.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(g.email || ih?.contactEmail) && <InfoRow icon={Mail} value={g.email || ih!.contactEmail} />}
                      {g.phone && <InfoRow icon={Phone} value={g.phone} />}
                      {(g.documents || []).map((d, i) => <InfoRow key={i} icon={CreditCard} value={`${d.documentType}: ${d.number}`} />)}
                      {ih?.localityGuest && <InfoRow icon={MapPin} value={`${ih.localityGuest}${ih.stateGuest ? `, ${ih.stateGuest}` : ''}`} />}
                      {ih?.checkInDate && <InfoRow icon={Calendar} value={`Check-in: ${fmtDateTime(ih.checkInDate)}`} />}
                      {ih?.mealPlan && <InfoRow icon={FileText} value={`Regime: ${ih.mealPlan}`} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(editingGuest || addingGuest) && (
            <GuestEditModal
              hotelId={hotelId} bookingId={booking.bookingInternalID}
              guest={editingGuest}
              onClose={() => { setEditingGuest(null); setAddingGuest(false); }}
              onSaved={() => { setEditingGuest(null); setAddingGuest(false); loadGuests(); }}
            />
          )}
        </div>
      )}

      {/* Tab: Financeiro */}
      {activeTab === 'conta' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-rose-50 dark:bg-rose-900/15 rounded-xl p-4 border border-rose-200 dark:border-rose-800/40">
              <p className="text-[10px] uppercase tracking-wide text-rose-500 mb-1">Débitos</p>
              <p className="text-lg font-bold text-rose-700 dark:text-rose-300">{fmtBRL(totalDebit)}</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/15 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800/40">
              <p className="text-[10px] uppercase tracking-wide text-emerald-500 mb-1">Créditos</p>
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{fmtBRL(totalCredit)}</p>
            </div>
            <div className={`rounded-xl p-4 border ${(totalDebit - totalCredit) > 0 ? 'bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800/40' : 'bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800/40'}`}>
              <p className={`text-[10px] uppercase tracking-wide mb-1 ${(totalDebit - totalCredit) > 0 ? 'text-amber-500' : 'text-green-500'}`}>Saldo</p>
              <p className={`text-lg font-bold ${(totalDebit - totalCredit) > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}`}>{fmtBRL(totalDebit - totalCredit)}</p>
            </div>
          </div>
          {loadingAccount ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-sky-500" /></div>
          ) : accountEntries.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700/50">
              <DollarSign className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Nenhum lançamento nesta reserva.</p>
            </div>
          ) : (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800 text-[10px] uppercase tracking-wide text-gray-400 sticky top-0">
                      <th className="text-left px-4 py-2.5">Descrição</th>
                      <th className="text-right px-4 py-2.5">Débito</th>
                      <th className="text-right px-4 py-2.5">Crédito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountEntries.map((e: any, i: number) => (
                      <tr key={e.id ?? i} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 truncate max-w-[280px]" title={e.description}>{e.description || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-red-600 dark:text-red-400">{e.isDebit ? fmtBRL(e.amount) : ''}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400">{e.isCredit ? fmtBRL(e.amount) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const CheckInList: React.FC = () => {
  const { selectedHotel } = useHotel();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ErbonBooking | null>(null);

  const { data: bookings, loading, error, refetch, erbonConfigured } = useErbonData<ErbonBooking[]>(
    (hotelId) => erbonService.searchBookings(hotelId, { checkin: today }),
  );

  // Only bookings pending check-in
  const pending = (bookings || []).filter(b => b.status !== 'CHECKIN' && b.status !== 'CANCELLED');

  const filtered = search.trim()
    ? pending.filter(b =>
        b.guestList?.some(g => g.name?.toLowerCase().includes(search.toLowerCase())) ||
        String(b.erbonNumber).includes(search) ||
        b.roomDescription?.toLowerCase().includes(search.toLowerCase())
      )
    : pending;

  const totalGuests = filtered.reduce((sum, b) => sum + (b.guestList?.length || 0), 0);

  if (!erbonConfigured && !loading) return <ErbonNotConfigured hotelName={selectedHotel?.name} />;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <LogIn className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Check-ins Pendentes</h1>
          </div>
          {!loading && (
            <div className="flex items-center gap-2 ml-13 pl-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                <BedDouble className="w-3.5 h-3.5" /> {filtered.length} reservas
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                <Users className="w-3.5 h-3.5" /> {totalGuests} hóspedes
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar hóspede, UH ou reserva..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent w-72 shadow-sm"
            />
          </div>
          <button
            onClick={refetch}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition font-medium text-gray-600 dark:text-gray-300"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-700">
          <UserCheck className="w-14 h-14 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-600 dark:text-gray-400 font-semibold text-lg">Nenhum check-in pendente</p>
          <p className="text-sm text-gray-400 mt-1">Todos os hóspedes já realizaram check-in ou não há reservas para hoje.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {filtered.map((booking, idx) => {
            const mainGuest = booking.guestList?.[0];
            const guestCount = booking.guestList?.length || 0;
            const nights = getNights(booking.checkInDateTime, booking.checkOutDateTime);
            const isLast = idx === filtered.length - 1;
            return (
              <button
                key={booking.bookingInternalID}
                onClick={() => setSelected(booking)}
                className={`w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors group border-l-4 border-transparent hover:border-emerald-500 ${!isLast ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}
              >
                {/* Room badge */}
                <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shadow-sm">
                  <span className="text-xl font-black text-emerald-700 dark:text-emerald-300 leading-none text-center px-1">{booking.roomDescription || '—'}</span>
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs text-gray-400 font-medium">#{booking.erbonNumber}</span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="font-bold text-gray-800 dark:text-white truncate">{mainGuest?.name || 'Hóspede'}</span>
                  </div>
                  {guestCount > 1 && (
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      <Users className="w-3 h-3" /> +{guestCount - 1} hóspede{guestCount > 2 ? 's' : ''}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <LogIn className="w-3 h-3 text-emerald-500" />
                      {fmtDate(booking.checkInDateTime)}
                    </span>
                    <span className="text-gray-300">→</span>
                    <span className="flex items-center gap-1">
                      <LogOut className="w-3 h-3 text-gray-400" />
                      {fmtDate(booking.checkOutDateTime)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold">
                      {nights}N
                    </span>
                  </div>
                </div>

                {/* Right side */}
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${STATUS_STYLE[booking.status] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[booking.status] || booking.status}
                  </span>
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-200">
                    {fmtBRL(booking.totalBookingRateWithTax)}
                  </span>
                </div>

                {/* Arrow */}
                <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-emerald-500 transition-colors flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <BookingModal
          hotelId={selectedHotel!.id}
          booking={selected}
          onClose={() => setSelected(null)}
          onDone={() => { setSelected(null); refetch(); }}
        />
      )}
    </div>
  );
};

export default CheckInList;
