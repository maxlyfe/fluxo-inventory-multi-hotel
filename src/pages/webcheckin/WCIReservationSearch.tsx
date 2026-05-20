// src/pages/webcheckin/WCIReservationSearch.tsx
// Busca de reserva — DOIS MODOS independentes para hotéis com Erbon:
//   1. Por Reserva: Nº da reserva (uso da recepcionista, busca direta)
//   2. Por Dados:   Sobrenome + Check-in + Check-out (uso do hóspede via link)
// Hotéis SEM Erbon: formulário manual simples (Nº da reserva), comportamento legado.
// URL param :hotelId é o wci_code opaco (não o UUID real).

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, Loader2, AlertCircle, Calendar, User, Hash } from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import {
  resolveHotelByCode,
  searchReservation,
  createWCISession,
  createManualSession,
  WebCheckinGuest,
} from './webCheckinService';
import { supabase } from '../../lib/supabase';
import { getErbonStatusInfo, resolveErbonStatus } from '../../lib/erbonStatuses';

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.25)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  borderRadius: 20,
  padding: '2.5rem',
};

// ─── Helpers de data (dd/mm/aaaa ↔ ISO yyyy-MM-dd) ────────────────────────

/** Aplica máscara dd/mm/aaaa enquanto o usuário digita. */
function maskDateBR(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const parts: string[] = [];
  if (digits.length > 0) parts.push(digits.slice(0, 2));
  if (digits.length > 2) parts.push(digits.slice(2, 4));
  if (digits.length > 4) parts.push(digits.slice(4, 8));
  return parts.join('/');
}

/** Converte dd/mm/aaaa → ISO yyyy-MM-dd. Retorna null se inválido. */
function brToISO(br: string): string | null {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = parseInt(d, 10);
  const mon = parseInt(mo, 10);
  const year = parseInt(y, 10);
  if (mon < 1 || mon > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  // Valida data real (ex: 31/02 não existe)
  const date = new Date(year, mon - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== mon - 1 || date.getDate() !== day) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

/** Converte ISO yyyy-MM-dd → dd/mm/aaaa. */
function isoToBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ─── Componente DateBR — input dd/mm/aaaa + ícone de calendário ───────────

interface DateBRProps {
  value: string;                              // estado interno em dd/mm/aaaa
  onChange: (brValue: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

function DateBR({ value, onChange, placeholder = 'dd/mm/aaaa', ariaLabel }: DateBRProps) {
  const hiddenDateRef = useRef<HTMLInputElement>(null);

  const handleIconClick = () => {
    const el = hiddenDateRef.current;
    if (!el) return;
    // showPicker é o jeito moderno (Chrome 99+, Safari 16+) de abrir o calendário
    // nativo. Fallback: focar o input que em alguns browsers já abre.
    try {
      (el as any).showPicker?.();
    } catch { /* ignora */ }
    el.focus();
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(maskDateBR(e.target.value))}
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={10}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '0.875rem 3rem 0.875rem 1rem',
          fontSize: '1rem',
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: 12,
          color: '#fff',
          outline: 'none',
          transition: 'border-color 0.2s',
        }}
        onFocus={e => (e.target.style.borderColor = '#0085ae')}
        onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.3)')}
      />
      <button
        type="button"
        onClick={handleIconClick}
        aria-label="Abrir calendário"
        style={{
          position: 'absolute',
          right: 8, top: '50%', transform: 'translateY(-50%)',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 8,
          width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          color: '#fff',
        }}
      >
        <Calendar size={16} />
      </button>
      {/* Date picker nativo, invisível — disparado via showPicker() pelo botão */}
      <input
        ref={hiddenDateRef}
        type="date"
        value={brToISO(value) || ''}
        onChange={e => onChange(e.target.value ? isoToBR(e.target.value) : '')}
        style={{
          position: 'absolute',
          right: 8, top: '50%', transform: 'translateY(-50%)',
          width: 36, height: 36,
          opacity: 0, pointerEvents: 'none',
        }}
        tabIndex={-1}
      />
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────

type SearchMode = 'byBooking' | 'byGuest';

export default function WCIReservationSearch() {
  const { hotelId: wciCode } = useParams<{ hotelId: string }>();
  const navigate = useNavigate();
  const { t } = useWCI();

  // Modo da busca (só relevante quando hasErbon = true)
  const [mode, setMode] = useState<SearchMode>('byBooking');

  // Campos do formulário
  const [bookingNumberErbon, setBookingNumberErbon] = useState('');
  const [surname, setSurname]   = useState('');
  const [checkinBR, setCheckinBR]   = useState('');
  const [checkoutBR, setCheckoutBR] = useState('');

  // Campo do formulário manual (hotéis sem Erbon)
  const [bookingNumber, setBookingNumber] = useState('');

  // Estado UI
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(true);
  const [error, setError] = useState('');
  const [realHotelId, setRealHotelId] = useState<string | null>(null);
  const [hasErbon, setHasErbon] = useState(true);

  // Resolver wci_code → UUID real
  useEffect(() => {
    if (!wciCode) return;
    resolveHotelByCode(wciCode).then(hotel => {
      if (hotel) {
        setRealHotelId(hotel.id);
        setHasErbon(hotel.hasErbon);
      } else {
        setError('Hotel não encontrado.');
      }
      setResolving(false);
    });
  }, [wciCode]);

  // ── Handler: busca Erbon (modo byBooking ou byGuest) ────────────────────
  const handleErbonSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!realHotelId || !wciCode) return;
    setError('');

    let input: Parameters<typeof searchReservation>[1];

    if (mode === 'byBooking') {
      const num = bookingNumberErbon.trim();
      if (!num) return;
      input = { mode: 'byBooking', bookingNumber: num };
    } else {
      // byGuest — valida sobrenome + datas
      const surnameTrim = surname.trim();
      if (!surnameTrim) return;
      const checkinISO  = brToISO(checkinBR);
      const checkoutISO = brToISO(checkoutBR);
      if (!checkinISO || !checkoutISO) {
        setError(t('invalidDate'));
        return;
      }
      if (checkoutISO < checkinISO) {
        setError(t('invalidDateRange'));
        return;
      }
      input = {
        mode: 'byGuest',
        surname:  surnameTrim,
        checkin:  checkinISO,
        checkout: checkoutISO,
      };
    }

    setLoading(true);
    try {
      const result = await searchReservation(realHotelId, input);
      if (!result) {
        setError(mode === 'byBooking' ? t('notFound') : t('notFoundByGuest'));
        return;
      }

      const effectiveStatus = resolveErbonStatus(result.booking.status, result.booking.confirmedStatus);
      const statusInfo = getErbonStatusInfo(effectiveStatus);
      if (!statusInfo.allowWCI) {
        setError(statusInfo.wciError!);
        return;
      }

      const token = await createWCISession(
        result.booking.bookingInternalID,
        realHotelId,
        result.guests as WebCheckinGuest[],
        result.booking.bookingNumber || (result.booking as any).erbonNumber?.toString() || null
      );
      navigate(`/web-checkin/${wciCode}/guests/${token}`);
    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setLoading(false);
    }
  };

  // ── Handler: busca manual (hotéis sem Erbon) ────────────────────────────
  const handleManualCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingNumber.trim() || !realHotelId || !wciCode) return;
    setLoading(true);
    setError('');
    try {
      const { data: lockData } = await supabase
        .from('wci_booking_locks')
        .select('id')
        .eq('hotel_id', realHotelId)
        .eq('booking_number', bookingNumber.trim())
        .maybeSingle();

      if (lockData) {
        setError('Esta reserva está bloqueada para edição. Por favor, dirija-se à recepção.');
        return;
      }

      const token = await createManualSession(realHotelId, '', bookingNumber.trim());
      navigate(`/web-checkin/${wciCode}/guests/${token}`);
    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setLoading(false);
    }
  };

  // ── Estilos comuns dos inputs ───────────────────────────────────────────
  const inputBase: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.875rem 1rem',
    fontSize: '1rem',
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 12,
    color: '#fff',
    outline: 'none',
    transition: 'border-color 0.2s',
  };
  const labelStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 600,
    color: 'rgba(255,255,255,0.92)',
  };

  const isFormValid = (() => {
    if (!hasErbon) return !!bookingNumber.trim();
    if (mode === 'byBooking') return !!bookingNumberErbon.trim();
    return !!surname.trim() && checkinBR.length === 10 && checkoutBR.length === 10;
  })();

  return (
    <div style={{
      minHeight: 'calc(100vh - 70px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: 600 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Search size={48} color="#0085ae" style={{ marginBottom: '1rem' }} />
          <h1 style={{
            fontSize: 'clamp(1.3rem, 4vw, 1.9rem)',
            fontWeight: 800, color: '#fff', margin: 0,
            textShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}>
            {t('searchReservation')}
          </h1>
        </div>

        <div style={glassCard}>
          {resolving ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
              <Loader2 size={32} color="#0085ae" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : !hasErbon ? (
            // ── Formulário manual: hotel SEM Erbon ──────────────────────
            <form onSubmit={handleManualCheckin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={labelStyle}>
                  <Hash size={14} /> {t('bookingNumberLabel')}
                </label>
                <input
                  type="text"
                  value={bookingNumber}
                  onChange={e => { setBookingNumber(e.target.value); setError(''); }}
                  placeholder={t('bookingNumberPlaceholder')}
                  autoFocus
                  style={{ ...inputBase, borderColor: error ? '#ef4444' : inputBase.border as string }}
                  onFocus={e => (e.target.style.borderColor = '#0085ae')}
                  onBlur={e => (e.target.style.borderColor = error ? '#ef4444' : 'rgba(255,255,255,0.3)')}
                />
              </div>

              {error && <ErrorBox text={error} />}

              <SubmitButton loading={loading} disabled={!isFormValid || !realHotelId} label="Iniciar Check-in" t={t} />
            </form>
          ) : (
            // ── Formulário Erbon: 2 modos com tabs ──────────────────────
            <>
              {/* Tabs */}
              <div style={{
                display: 'flex',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 12,
                padding: 4,
                marginBottom: '1.5rem',
              }}>
                <TabBtn
                  active={mode === 'byBooking'}
                  onClick={() => { setMode('byBooking'); setError(''); }}
                  icon={<Hash size={14} />}
                  label={t('searchByBookingTab')}
                />
                <TabBtn
                  active={mode === 'byGuest'}
                  onClick={() => { setMode('byGuest'); setError(''); }}
                  icon={<User size={14} />}
                  label={t('searchByGuestTab')}
                />
              </div>

              <form onSubmit={handleErbonSearch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {mode === 'byBooking' ? (
                  <div>
                    <label style={labelStyle}>
                      <Hash size={14} /> {t('bookingNumberLabel')}
                    </label>
                    <input
                      type="text"
                      value={bookingNumberErbon}
                      onChange={e => { setBookingNumberErbon(e.target.value); setError(''); }}
                      placeholder={t('bookingNumberPlaceholder')}
                      autoFocus
                      style={inputBase}
                      onFocus={e => (e.target.style.borderColor = '#0085ae')}
                      onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.3)')}
                    />
                    <p style={{ marginTop: 6, fontSize: '0.75rem', color: 'rgba(255,255,255,0.55)' }}>
                      {t('bookingNumberHelp')}
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label style={labelStyle}>
                        <User size={14} /> {t('surnameLabel')}
                      </label>
                      <input
                        type="text"
                        value={surname}
                        onChange={e => { setSurname(e.target.value); setError(''); }}
                        placeholder={t('surnamePlaceholder')}
                        autoFocus
                        style={inputBase}
                        onFocus={e => (e.target.style.borderColor = '#0085ae')}
                        onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.3)')}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div>
                        <label style={labelStyle}>
                          <Calendar size={14} /> {t('checkinLabel')}
                        </label>
                        <DateBR
                          value={checkinBR}
                          onChange={v => { setCheckinBR(v); setError(''); }}
                          placeholder={t('datePlaceholder')}
                          ariaLabel={t('checkinLabel')}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>
                          <Calendar size={14} /> {t('checkoutLabel')}
                        </label>
                        <DateBR
                          value={checkoutBR}
                          onChange={v => { setCheckoutBR(v); setError(''); }}
                          placeholder={t('datePlaceholder')}
                          ariaLabel={t('checkoutLabel')}
                        />
                      </div>
                    </div>
                  </>
                )}

                {error && <ErrorBox text={error} />}

                <SubmitButton loading={loading} disabled={!isFormValid || !realHotelId} label={t('search')} t={t} />
              </form>
            </>
          )}
        </div>

        <button
          onClick={() => navigate('/web-checkin/hotels')}
          style={{
            display: 'block', margin: '1.5rem auto 0',
            background: 'transparent', border: 'none',
            color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
            fontSize: '0.9rem', textDecoration: 'underline',
          }}>
          ← Voltar
        </button>
      </div>
      <style>{` @keyframes spin { to { transform: rotate(360deg); } } `}</style>
    </div>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '0.6rem 0.75rem',
        background: active ? '#0085ae' : 'transparent',
        color: '#fff',
        border: 'none',
        borderRadius: 10,
        cursor: 'pointer',
        fontSize: '0.85rem',
        fontWeight: 700,
        transition: 'background 0.2s',
        opacity: active ? 1 : 0.7,
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
      background: 'rgba(239,68,68,0.15)',
      border: '1px solid rgba(239,68,68,0.4)',
      borderRadius: 10, padding: '0.75rem 1rem',
    }}>
      <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ color: '#fca5a5', fontSize: '0.9rem' }}>{text}</span>
    </div>
  );
}

function SubmitButton({ loading, disabled, label, t }: {
  loading: boolean; disabled: boolean; label: string; t: (k: string) => string;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      style={{
        padding: '1rem', borderRadius: 50, border: 'none',
        cursor: loading || disabled ? 'not-allowed' : 'pointer',
        background: loading || disabled ? 'rgba(0,133,174,0.5)' : '#0085ae',
        color: '#fff', fontWeight: 700, fontSize: '1.05rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
        transition: 'all 0.2s', opacity: disabled ? 0.5 : 1,
      }}
    >
      {loading
        ? <><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> {t('searching')}</>
        : <><Search size={20} /> {label}</>
      }
    </button>
  );
}
