// src/pages/webcheckin/WCIReservationSearch.tsx
// Busca de reserva por número, e-mail ou nome via API Erbon.
// Para hotéis sem Erbon: formulário manual com número de reserva.
// URL param :hotelId é agora o wci_code opaco (não o UUID real).
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import {
  resolveHotelByCode,
  searchReservation,
  createWCISession,
  createManualSession,
  WebCheckinGuest,
} from './webCheckinService';

// Statuses Erbon que bloqueiam o web check-in
const BLOCKED_STATUSES = ['CHECKIN', 'CANCELLED', 'CHECKOUT', 'CHECKOUTDONE'];
const BLOCKED_LABELS: Record<string, string> = {
  CHECKIN:     'Check-in já realizado. Dirija-se à recepção se precisar de ajuda.',
  CANCELLED:   'Esta reserva está cancelada.',
  CHECKOUT:    'Check-out já realizado para esta reserva.',
  CHECKOUTDONE:'Check-out já realizado para esta reserva.',
};

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.25)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  borderRadius: 20,
  padding: '2.5rem',
};

export default function WCIReservationSearch() {
  // hotelId do params é o wci_code opaco
  const { hotelId: wciCode } = useParams<{ hotelId: string }>();
  const navigate = useNavigate();
  const { t } = useWCI();

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(true);
  const [error, setError] = useState('');
  const [realHotelId, setRealHotelId] = useState<string | null>(null);
  const [hasErbon, setHasErbon] = useState(true);
  const [bookingNumber, setBookingNumber] = useState('');

  // Resolver wci_code → UUID real antes de permitir a busca
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

  // Formulário Erbon: busca por número/email/nome
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !realHotelId || !wciCode) return;
    setLoading(true);
    setError('');
    try {
      const result = await searchReservation(realHotelId, query);
      if (!result) {
        setError(t('notFound'));
        return;
      }

      // Bloquear reservas com status que impedem novo check-in
      const rawStatus = result.booking.status?.toUpperCase() || '';
      if (BLOCKED_STATUSES.includes(rawStatus)) {
        setError(BLOCKED_LABELS[rawStatus] || 'Esta reserva não está disponível para web check-in.');
        return;
      }

      // Criar sessão opaca e navegar com token (sem expor IDs reais)
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

  // Formulário manual (não-Erbon): apenas número de reserva
  const handleManualCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingNumber.trim() || !realHotelId || !wciCode) return;
    setLoading(true);
    setError('');
    try {
      const token = await createManualSession(
        realHotelId,
        '', // Nome vazio inicialmente, o hóspede se cadastrará na lista
        bookingNumber.trim()
      );
      navigate(`/web-checkin/${wciCode}/guests/${token}`);
    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setLoading(false);
    }
  };

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
          <h1 style={{ fontSize: 'clamp(1.3rem, 4vw, 1.9rem)', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            {t('searchReservation')}
          </h1>
        </div>

        <div style={glassCard}>
          {resolving ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
              <Loader2 size={32} color="#0085ae" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : (
            <form onSubmit={hasErbon ? handleSearch : handleManualCheckin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                  {t('searchPlaceholder')}
                </label>
                <input
                  type="text"
                  value={hasErbon ? query : bookingNumber}
                  onChange={e => { 
                    if (hasErbon) setQuery(e.target.value); 
                    else setBookingNumber(e.target.value);
                    setError(''); 
                  }}
                  placeholder={hasErbon ? "Ex: 12345 / email@hotel.com" : "Digite o nº da sua reserva"}
                  autoFocus
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '1rem 1.25rem',
                    fontSize: '1.1rem',
                    background: 'rgba(255,255,255,0.12)',
                    border: error ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.3)',
                    borderRadius: 12,
                    color: '#fff',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#0085ae')}
                  onBlur={e => (e.target.style.borderColor = error ? '#ef4444' : 'rgba(255,255,255,0.3)')}
                />
              </div>

              {error && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '0.75rem 1rem' }}>
                  <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ color: '#fca5a5', fontSize: '0.9rem' }}>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (hasErbon ? !query.trim() : !bookingNumber.trim()) || !realHotelId}
                style={{
                  padding: '1rem', borderRadius: 50, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  background: loading ? 'rgba(0,133,174,0.5)' : '#0085ae',
                  color: '#fff', fontWeight: 700, fontSize: '1.05rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                  transition: 'all 0.2s', opacity: (hasErbon ? !query.trim() : !bookingNumber.trim()) ? 0.5 : 1,
                }}
              >
                {loading
                  ? <><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> {t('searching')}</>
                  : <><Search size={20} /> {hasErbon ? t('search') : 'Iniciar Check-in'}</>
                }
              </button>
            </form>
          )}
        </div>

        <button
          onClick={() => navigate('/web-checkin/hotels')}
          style={{ display: 'block', margin: '1.5rem auto 0', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}>
          ← Voltar
        </button>
      </div>
      <style>{` @keyframes spin { to { transform: rotate(360deg); } } `}</style>
    </div>
  );
}
