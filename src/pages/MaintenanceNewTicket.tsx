// src/pages/MaintenanceNewTicket.tsx
// Página PÚBLICA — funciona com e sem login
// Usuário logado: dados preenchidos automaticamente
// Usuário anônimo: pede nome e cargo

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';
import {
  Wrench, MapPin, Camera, AlertTriangle, CheckCircle,
  ChevronDown, X, Upload, Loader2, ArrowLeft, Building2,
  Hash, Layers, Edit3, User, Briefcase, Tag, AlignLeft,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Hotel { id: string; name: string; }

const PRIORITY_CONFIG = {
  low:    { label: 'Baixa',   color: 'text-blue-600',  bg: 'bg-blue-50  dark:bg-blue-900/20',  border: 'border-blue-200 dark:border-blue-800',  dot: 'bg-blue-500'  },
  medium: { label: 'Média',   color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', dot: 'bg-amber-500' },
  high:   { label: 'Alta',    color: 'text-orange-600',bg: 'bg-orange-50 dark:bg-orange-900/20',border: 'border-orange-200 dark:border-orange-800',dot: 'bg-orange-500'},
  urgent: { label: 'Urgente', color: 'text-red-600',   bg: 'bg-red-50   dark:bg-red-900/20',   border: 'border-red-200 dark:border-red-800',   dot: 'bg-red-500'   },
};

const LOCATION_TYPES = [
  { value: 'room',   label: 'Quarto',        icon: Hash,     placeholder: 'Ex: 201, 305...' },
  { value: 'common', label: 'Área Comum',    icon: Building2,placeholder: 'Ex: Piscina, Lobby, Jardim...' },
  { value: 'sector', label: 'Setor Interno', icon: Layers,   placeholder: 'Ex: Cozinha, Lavanderia, Recepção...' },
  { value: 'free',   label: 'Outro Local',   icon: Edit3,    placeholder: 'Descreva o local...' },
];

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/maintenance-public`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inputCls = `w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent
  placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-all`;

const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function MaintenanceNewTicket() {
  const { user, loading: authLoading } = useAuth();
  const { selectedHotel } = useHotel();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const equipmentId = searchParams.get('equipment_id');
  const hotelIdParam = searchParams.get('hotel_id');

  // Prioridade: param URL > selectedHotel > vazio
  const defaultHotelId = hotelIdParam || selectedHotel?.id || '';
  const canChangeHotel = ['admin', 'management'].includes(user?.role || '');

  // Form state
  const [hotels, setHotels]               = useState<Hotel[]>([]);
  const [hotelId, setHotelId]             = useState(defaultHotelId);
  const [locationType, setLocationType]   = useState<'room'|'common'|'sector'|'free'>('room');
  const [locationDetail, setLocationDetail] = useState('');
  const [title, setTitle]                 = useState('');
  const [description, setDescription]     = useState('');
  const [priority, setPriority]           = useState<'low'|'medium'|'high'|'urgent'>('medium');
  const [guestName, setGuestName]         = useState('');
  const [guestRole, setGuestRole]         = useState('');
  const [photos, setPhotos]               = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  // UI state
  const [submitting, setSubmitting]       = useState(false);
  const [submitted, setSubmitted]         = useState(false);
  const [ticketId, setTicketId]           = useState('');
  const [error, setError]                 = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Load hotels
  // ---------------------------------------------------------------------------
  useEffect(() => {
    supabase.from('hotels').select('id, name').order('name').then(({ data }) => {
      setHotels(data || []);
      // Só auto-seleciona o único hotel se não há hotel já definido
      if (!hotelId && data && data.length === 1) setHotelId(data[0].id);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Photo handling
  // ---------------------------------------------------------------------------
  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const combined = [...photos, ...files].slice(0, 3); // máx 3 fotos
    setPhotos(combined);
    combined.forEach(f => {
      const reader = new FileReader();
      reader.onload = ev => setPhotoPreviews(prev => [...prev.filter((_, i) => i < combined.length - 1), ev.target?.result as string]);
      reader.readAsDataURL(f);
    });
    // rebuild previews
    Promise.all(combined.map(f => new Promise<string>(res => {
      const r = new FileReader();
      r.onload = e => res(e.target?.result as string);
      r.readAsDataURL(f);
    }))).then(setPhotoPreviews);
    e.target.value = '';
  };

  const removePhoto = (i: number) => {
    setPhotos(prev => prev.filter((_, idx) => idx !== i));
    setPhotoPreviews(prev => prev.filter((_, idx) => idx !== i));
  };

  // ---------------------------------------------------------------------------
  // Upload photos to Supabase Storage
  // ---------------------------------------------------------------------------
  const uploadPhotos = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const file of photos) {
      const ext  = file.name.split('.').pop();
      const path = `tickets/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('maintenance').upload(path, file, { upsert: true });
      if (!error) {
        const { data } = supabase.storage.from('maintenance').getPublicUrl(path);
        urls.push(data.publicUrl);
      }
    }
    return urls;
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const name = user ? (user.email || 'Usuário') : guestName.trim();
    const role = user ? (user.role || 'Usuário') : guestRole.trim();

    if (!hotelId)         { setError('Selecione o hotel.'); return; }
    if (!locationDetail.trim()) { setError('Informe a localização.'); return; }
    if (!title.trim())    { setError('Informe o título do problema.'); return; }
    if (!description.trim()) { setError('Descreva o problema.'); return; }
    if (!user && !name)   { setError('Informe seu nome.'); return; }
    if (!user && !role)   { setError('Informe seu cargo.'); return; }

    setSubmitting(true);
    try {
      // Upload fotos
      const photoUrls = photos.length > 0 ? await uploadPhotos() : [];

      // Chama Edge Function pública
      const res = await fetch(`${EDGE_URL}?action=open_ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotel_id:        hotelId,
          equipment_id:    equipmentId || null,
          location_type:   locationType,
          location_detail: locationDetail.trim(),
          title:           title.trim(),
          description:     description.trim(),
          priority,
          opened_by_user:  user?.id || null,
          opened_by_name:  name,
          opened_by_role:  role,
          photo_urls:      photoUrls,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao abrir ticket.');

      setTicketId(data.ticket_id);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Success screen
  // ---------------------------------------------------------------------------
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 rounded-3xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-green-100 dark:shadow-green-900/20">
            <CheckCircle className="h-10 w-10 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Ticket aberto!</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-2">Sua solicitação foi registrada com sucesso.</p>
          <p className="text-xs font-mono bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 inline-block text-gray-600 dark:text-gray-300 mb-8">
            #{ticketId.slice(0, 8).toUpperCase()}
          </p>
          <div className="flex flex-col gap-3">
            {user && (
              <button onClick={() => navigate('/maintenance')}
                className="w-full py-3 px-6 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-2xl transition-colors shadow-lg shadow-orange-200 dark:shadow-orange-900/30">
                Ver painel de manutenções
              </button>
            )}
            <button onClick={() => { setSubmitted(false); setTitle(''); setDescription(''); setLocationDetail(''); setPhotos([]); setPhotoPreviews([]); }}
              className="w-full py-3 px-6 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Abrir outro ticket
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selectedLocType = LOCATION_TYPES.find(l => l.value === locationType)!;
  const LocIcon = selectedLocType.icon;

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {user && (
              <button onClick={() => navigate(-1)} className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shadow-lg shadow-orange-200 dark:shadow-orange-900/30">
              <Wrench className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 dark:text-white leading-tight">Chamado de Manutenção</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">Reporte um problema</p>
            </div>
          </div>
          {!user && !authLoading && (
            <Link to="/login" className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline">
              Entrar com minha conta
            </Link>
          )}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-6 space-y-5 pb-24">

        {/* Hotel: admin/management podem trocar; outros veem fixo */}
        {canChangeHotel && hotels.length > 1 ? (
          <div>
            <label className={labelCls}>Hotel / Unidade</label>
            <div className="relative">
              <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <select value={hotelId} onChange={e => setHotelId(e.target.value)} className={`${inputCls} pl-10 appearance-none`} required>
                <option value="">Selecione o hotel...</option>
                {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
        ) : selectedHotel ? (
          <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/50 rounded-2xl">
            <Building2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-blue-500 font-medium">Unidade</p>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">{selectedHotel.name}</p>
            </div>
          </div>
        ) : null}

        {/* Localização — tipo */}
        <div>
          <label className={labelCls}>Tipo de localização</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {LOCATION_TYPES.map(lt => {
              const Icon = lt.icon;
              const active = locationType === lt.value;
              return (
                <button key={lt.value} type="button" onClick={() => { setLocationType(lt.value as any); setLocationDetail(''); }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    active
                      ? 'bg-orange-500 border-orange-500 text-white shadow-lg shadow-orange-200 dark:shadow-orange-900/30'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-orange-300'
                  }`}>
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{lt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Localização — detalhe */}
        <div>
          <label className={labelCls}>
            {locationType === 'room' ? 'Número do quarto' :
             locationType === 'common' ? 'Nome da área' :
             locationType === 'sector' ? 'Nome do setor' : 'Descrição do local'}
          </label>
          <div className="relative">
            <LocIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input type="text" value={locationDetail} onChange={e => setLocationDetail(e.target.value)}
              placeholder={selectedLocType.placeholder}
              className={`${inputCls} pl-10`} required />
          </div>
        </div>

        {/* Título */}
        <div>
          <label className={labelCls}>Título do problema</label>
          <div className="relative">
            <Tag className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Ar condicionado não liga, Torneira pingando..."
              className={`${inputCls} pl-10`} required maxLength={100} />
          </div>
        </div>

        {/* Descrição */}
        <div>
          <label className={labelCls}>Descrição detalhada</label>
          <div className="relative">
            <AlignLeft className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-400 pointer-events-none" />
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Descreva o problema com o máximo de detalhes possível..."
              rows={4} className={`${inputCls} pl-10 resize-none`} required />
          </div>
        </div>

        {/* Prioridade */}
        <div>
          <label className={labelCls}>Prioridade</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.entries(PRIORITY_CONFIG) as [string, typeof PRIORITY_CONFIG.low][]).map(([key, cfg]) => {
              const active = priority === key;
              return (
                <button key={key} type="button" onClick={() => setPriority(key as any)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    active ? `${cfg.bg} ${cfg.border} ${cfg.color} border-2` : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                  }`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fotos */}
        <div>
          <label className={labelCls}>Fotos (opcional, máx. 3)</label>
          <div className="flex gap-3 flex-wrap">
            {photoPreviews.map((src, i) => (
              <div key={i} className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-orange-200 dark:border-orange-800 flex-shrink-0">
                <img src={src} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow">
                  <X className="h-3 w-3 text-white" />
                </button>
              </div>
            ))}
            {photos.length < 3 && (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center gap-1 text-gray-400 dark:text-gray-500 hover:border-orange-400 hover:text-orange-500 transition-colors flex-shrink-0">
                <Camera className="h-6 w-6" />
                <span className="text-xs">Adicionar</span>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handlePhotoAdd} />
        </div>

        {/* Identificação (somente se não logado) */}
        {!user && !authLoading && (
          <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4 space-y-4">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-2">
              <User className="h-3.5 w-3.5" />Sua identificação
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Nome completo</label>
                <input type="text" value={guestName} onChange={e => setGuestName(e.target.value)}
                  placeholder="Seu nome..." className={inputCls} required />
              </div>
              <div>
                <label className={labelCls}>Cargo / Função</label>
                <div className="relative">
                  <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  <input type="text" value={guestRole} onChange={e => setGuestRole(e.target.value)}
                    placeholder="Ex: Camareira, Recepcionista..." className={`${inputCls} pl-10`} required />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Usuário logado — identificação automática */}
        {user && (
          <div className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/50 rounded-2xl">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {user.email?.[0].toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{user.email}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Ticket aberto em seu nome automaticamente</p>
            </div>
          </div>
        )}

        {/* Erro */}
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/50 rounded-2xl text-red-700 dark:text-red-400">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Submit */}
        <div className="fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border-t border-gray-100 dark:border-gray-800 p-4 z-10">
          <div className="max-w-2xl mx-auto">
            <button type="submit" disabled={submitting}
              className="w-full flex items-center justify-center gap-3 py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold text-base rounded-2xl transition-colors shadow-xl shadow-orange-200 dark:shadow-orange-900/30">
              {submitting
                ? <><Loader2 className="h-5 w-5 animate-spin" />Enviando...</>
                : <><Wrench className="h-5 w-5" />Abrir Chamado</>
              }
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}