// src/pages/reception/WCIFichasView.tsx
import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck, ChevronDown, ChevronUp, Search, X,
  FileImage, Check, AlertCircle, Loader2, User, Users,
  MapPin, Car, Briefcase, Globe, CalendarDays, FileText, Shield,
  Copy, ExternalLink,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FichaGuest {
  id: string;
  is_main_guest: boolean;
  name: string;
  email: string | null;
  phone: string | null;
  document_type: string | null;
  document_number: string | null;
  birth_date: string | null;
  gender_id: number | null;
  nationality: string | null;
  profession: string | null;
  vehicle_registration: string | null;
  address_street: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zipcode: string | null;
  address_country: string | null;
  document_front_url: string | null;
  document_back_url: string | null;
}

interface Ficha {
  id: string;
  booking_number: string | null;
  room_number: string | null;
  guest_name: string;
  hotel_terms_accepted: boolean;
  lgpd_accepted: boolean;
  hotel_terms_text: string | null;
  lgpd_terms_text: string | null;
  hotel_rules_doc_url: string | null;
  lgpd_doc_url: string | null;
  signature_data: string | null;
  source: string;
  status: string;
  created_at: string;
  checkin_date: string | null;
  checkout_date: string | null;
  wci_checkin_guests: FichaGuest[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GUEST_QUERY = `
  id, is_main_guest, name, email, phone,
  document_type, document_number,
  birth_date, gender_id, nationality, profession, vehicle_registration,
  address_street, address_neighborhood, address_city, address_state,
  address_zipcode, address_country,
  document_front_url, document_back_url
`;

const FICHA_QUERY = `
  id, booking_number, room_number, guest_name,
  hotel_terms_accepted, lgpd_accepted, hotel_terms_text, lgpd_terms_text,
  hotel_rules_doc_url, lgpd_doc_url,
  signature_data, source, status, created_at, checkin_date, checkout_date,
  wci_checkin_guests ( ${GUEST_QUERY} )
`;

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 ' +
  'bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 transition-colors';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd/MM/yyyy', { locale: ptBR }); } catch { return d; }
}

const GENDER: Record<number, string> = { 1: 'Masculino', 2: 'Feminino', 3: 'Outro' };

// ── Source badge ──────────────────────────────────────────────────────────────

const SOURCE_STYLE: Record<string, string> = {
  web:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  totem:  'bg-purple-100 text-purple-700',
  manual: 'bg-slate-100 text-slate-600',
};
const SOURCE_LABEL: Record<string, string> = { web: 'Web', totem: 'Totem', manual: 'Manual' };

function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_STYLE[source] ?? 'bg-slate-100 text-slate-600'}`}>
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  partial:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};
const STATUS_LABEL: Record<string, string> = { completed: 'Completo', partial: 'Parcial', cancelled: 'Cancelado' };
const STATUS_ICON: Record<string, React.ReactNode> = {
  completed: <Check className="w-3 h-3" />,
  partial:   <AlertCircle className="w-3 h-3" />,
  cancelled: <X className="w-3 h-3" />,
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {STATUS_ICON[status]}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function BoolIcon({ value, label }: { value: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${value ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
      {value ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}

// ── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      title="Copiar"
      className="ml-1 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors shrink-0 cursor-pointer"
    >
      {copied
        ? <Check className="w-3 h-3 text-green-500" />
        : <Copy className="w-3 h-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" />
      }
    </button>
  );
}

// ── Field helper ─────────────────────────────────────────────────────────────

function Field({ label, value, icon }: { label: string; value: string | null | undefined; icon?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wide text-[10px] flex items-center gap-1">
        {icon}
        {label}
      </span>
      <div className="flex items-center gap-0.5 mt-0.5">
        <p className="font-medium text-xs text-slate-700 dark:text-slate-200">{value}</p>
        <CopyBtn value={value} />
      </div>
    </div>
  );
}

// ── Guest card ────────────────────────────────────────────────────────────────

function GuestCard({ guest }: { guest: FichaGuest }) {
  const address = [
    guest.address_street,
    guest.address_neighborhood,
    guest.address_city && guest.address_state ? `${guest.address_city} / ${guest.address_state}` : (guest.address_city || guest.address_state),
    guest.address_zipcode ? `CEP ${guest.address_zipcode}` : null,
    guest.address_country !== 'BR' ? guest.address_country : null,
  ].filter(Boolean).join(' — ');

  return (
    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <User className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{guest.name || '—'}</span>
        {guest.is_main_guest && (
          <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
            Principal
          </span>
        )}
      </div>

      {/* Dados pessoais */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
        <Field label="Documento" value={guest.document_type && guest.document_number ? `${guest.document_type}: ${guest.document_number}` : null} />
        <Field label="E-mail"    value={guest.email} />
        <Field label="Telefone"  value={guest.phone} />
        <Field label="Nascimento" value={fmtDate(guest.birth_date)} icon={<CalendarDays className="w-2.5 h-2.5" />} />
        <Field label="Gênero"    value={guest.gender_id ? GENDER[guest.gender_id] ?? String(guest.gender_id) : null} />
        <Field label="Nacionalidade" value={guest.nationality} icon={<Globe className="w-2.5 h-2.5" />} />
        <Field label="Profissão" value={guest.profession} icon={<Briefcase className="w-2.5 h-2.5" />} />
        <Field label="Placa do veículo" value={guest.vehicle_registration} icon={<Car className="w-2.5 h-2.5" />} />
      </div>

      {/* Endereço */}
      {address && (
        <div>
          <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wide text-[10px] flex items-center gap-1">
            <MapPin className="w-2.5 h-2.5" /> Endereço
          </span>
          <div className="flex items-center gap-0.5 mt-0.5">
            <p className="font-medium text-xs text-slate-700 dark:text-slate-200">{address}</p>
            <CopyBtn value={address} />
          </div>
        </div>
      )}

      {/* Fotos de documento */}
      {(guest.document_front_url || guest.document_back_url) && (
        <div className="flex gap-2">
          {guest.document_front_url && (
            <a href={guest.document_front_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition-colors">
              <FileImage className="w-3.5 h-3.5 text-teal-500" /> Frente do doc.
            </a>
          )}
          {guest.document_back_url && (
            <a href={guest.document_back_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition-colors">
              <FileImage className="w-3.5 h-3.5 text-teal-500" /> Verso do doc.
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Signed document section ──────────────────────────────────────────────────

function SignedDocSection({
  label, docUrl, text, icon,
}: { label: string; docUrl: string | null; text: string | null; icon: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left"
      >
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          {icon} {label}
          {docUrl && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
              Doc. assinado
            </span>
          )}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3">
          {docUrl ? (
            <>
              <a href={docUrl} target="_blank" rel="noopener noreferrer" className="block hover:opacity-90 transition-opacity">
                <img src={docUrl} alt={label} className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white" />
              </a>
              <a href={docUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-teal-600 dark:text-teal-400 hover:underline">
                <ExternalLink className="w-3 h-3" /> Abrir documento completo
              </a>
            </>
          ) : text ? (
            <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{text}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Ficha row ─────────────────────────────────────────────────────────────────

function FichaRow({ ficha, expanded, onToggle }: { ficha: Ficha; expanded: boolean; onToggle: () => void }) {
  const dateLabel = (() => {
    try { return format(parseISO(ficha.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }); } catch { return ficha.created_at; }
  })();
  const guestCount = ficha.wci_checkin_guests.length;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full text-left px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap w-32 shrink-0">{dateLabel}</span>
          {ficha.room_number && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Apt {ficha.room_number}</span>
          )}
          <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm flex-1 min-w-[140px] truncate">{ficha.guest_name}</span>
          {ficha.booking_number && (
            <span className="text-xs text-slate-500 dark:text-slate-400">Res. #{ficha.booking_number}</span>
          )}
          {guestCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
              <Users className="w-3.5 h-3.5" /> {guestCount} hósp.
            </span>
          )}
          <SourceBadge source={ficha.source} />
          <StatusBadge status={ficha.status} />
          <BoolIcon value={ficha.hotel_terms_accepted} label="Regulamento" />
          <BoolIcon value={ficha.lgpd_accepted} label="LGPD" />
          <span className="ml-auto text-slate-400 dark:text-slate-500 shrink-0">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-4 space-y-5">
          {/* Datas previstas */}
          {(ficha.checkin_date || ficha.checkout_date) && (
            <div className="flex gap-6 text-xs text-slate-500 dark:text-slate-400">
              {ficha.checkin_date && <span>Check-in previsto: <strong className="text-slate-700 dark:text-slate-200">{fmtDate(ficha.checkin_date)}</strong></span>}
              {ficha.checkout_date && <span>Check-out previsto: <strong className="text-slate-700 dark:text-slate-200">{fmtDate(ficha.checkout_date)}</strong></span>}
            </div>
          )}

          {/* Hóspedes */}
          {ficha.wci_checkin_guests.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Hóspedes ({ficha.wci_checkin_guests.length})
              </p>
              {ficha.wci_checkin_guests.map(g => <GuestCard key={g.id} guest={g} />)}
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">Nenhum hóspede cadastrado nesta ficha.</p>
          )}

          {/* Assinatura */}
          {ficha.signature_data && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Assinatura</p>
              <img src={ficha.signature_data} alt="Assinatura" className="max-h-24 border border-slate-200 dark:border-slate-600 rounded-xl bg-white" />
            </div>
          )}

          {/* Termos aceitos */}
          {(ficha.hotel_rules_doc_url || ficha.hotel_terms_text || ficha.lgpd_doc_url || ficha.lgpd_terms_text) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Documentos Assinados</p>
              {(ficha.hotel_rules_doc_url || ficha.hotel_terms_text) && (
                <SignedDocSection
                  label="Regulamento do Hotel"
                  docUrl={ficha.hotel_rules_doc_url}
                  text={ficha.hotel_terms_text}
                  icon={<FileText className="w-3.5 h-3.5 text-teal-500" />}
                />
              )}
              {(ficha.lgpd_doc_url || ficha.lgpd_terms_text) && (
                <SignedDocSection
                  label="Política de Privacidade (LGPD)"
                  docUrl={ficha.lgpd_doc_url}
                  text={ficha.lgpd_terms_text}
                  icon={<Shield className="w-3.5 h-3.5 text-teal-500" />}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function WCIFichasView() {
  const { selectedHotel } = useHotel();
  const [fichas, setFichas]     = useState<Ficha[]>([]);
  const [loading, setLoading]   = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchName, setSearchName]         = useState('');
  const [searchDocument, setSearchDocument] = useState('');
  const [searchBooking, setSearchBooking]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  async function loadFichas(overrides?: Partial<{ name: string; doc: string; booking: string; from: string; to: string }>) {
    if (!selectedHotel) return;
    setLoading(true);
    const name    = overrides?.name    ?? searchName;
    const doc     = overrides?.doc     ?? searchDocument;
    const booking = overrides?.booking ?? searchBooking;
    const from    = overrides?.from    ?? dateFrom;
    const to      = overrides?.to      ?? dateTo;

    let q = supabase.from('wci_checkin_fichas').select(FICHA_QUERY)
      .eq('hotel_id', selectedHotel.id)
      .order('created_at', { ascending: false });

    if (name.trim())    q = q.ilike('guest_name', `%${name.trim()}%`);
    if (booking.trim()) q = q.ilike('booking_number', `%${booking.trim()}%`);
    if (from)           q = q.gte('created_at', from);
    if (to)             q = q.lte('created_at', to + 'T23:59:59');

    const { data } = await q;
    let results = (data || []) as Ficha[];
    if (doc.trim()) {
      const d = doc.trim().toLowerCase();
      results = results.filter(f => f.wci_checkin_guests.some(g => g.document_number?.toLowerCase().includes(d)));
    }
    setFichas(results);
    setLoading(false);
  }

  useEffect(() => {
    if (selectedHotel?.id) {
      setSearchName(''); setSearchDocument(''); setSearchBooking(''); setDateFrom(''); setDateTo('');
      loadFichas({ name: '', doc: '', booking: '', from: '', to: '' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHotel?.id]);

  function handleClear() {
    setSearchName(''); setSearchDocument(''); setSearchBooking(''); setDateFrom(''); setDateTo('');
    loadFichas({ name: '', doc: '', booking: '', from: '', to: '' });
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl bg-teal-50 dark:bg-teal-900/20 shrink-0">
          <ClipboardCheck className="w-7 h-7 text-teal-600 dark:text-teal-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-slate-800 dark:text-white">Fichas de Web Check-in</h1>
            {!loading && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                {fichas.length} {fichas.length === 1 ? 'ficha' : 'fichas'}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Registros de check-in preenchidos pelos hóspedes</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2 md:col-span-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Nome do hóspede</label>
            <input type="text" value={searchName} onChange={e => setSearchName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadFichas()} placeholder="Pesquisar..." className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Nº do documento</label>
            <input type="text" value={searchDocument} onChange={e => setSearchDocument(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadFichas()} placeholder="CPF, passaporte..." className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Nº da reserva</label>
            <input type="text" value={searchBooking} onChange={e => setSearchBooking(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadFichas()} placeholder="Ex: 12345" className={inputCls} />
          </div>
          <div className="col-span-2 md:col-span-1 grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">De</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Até</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={() => loadFichas()} disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-medium transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Buscar
          </button>
          <button type="button" onClick={handleClear}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 text-sm font-medium transition-colors">
            <X className="w-4 h-4" /> Limpar
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse" />)}
        </div>
      ) : fichas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-4">
            <ClipboardCheck className="w-10 h-10 text-slate-300 dark:text-slate-600" />
          </div>
          <p className="text-slate-600 dark:text-slate-300 font-medium">Nenhuma ficha encontrada</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Tente outros filtros ou verifique se há check-ins realizados.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {fichas.map(f => (
            <FichaRow key={f.id} ficha={f} expanded={expandedId === f.id} onToggle={() => setExpandedId(p => p === f.id ? null : f.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
