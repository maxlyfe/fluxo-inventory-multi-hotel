// src/pages/webcheckin/WCIGuestList.tsx
// Lista de hóspedes da reserva com status da FNRH e botão de QR Code
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users, CheckCircle, Clock, QrCode, UserPlus, ChevronRight, Loader2, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useWCI } from './WebCheckinLayout';
import {
  loadGuestsFromStorage,
  saveGuestsToStorage,
  WebCheckinGuest,
} from './webCheckinService';
import { erbonService } from '../../lib/erbonService';

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.25)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  borderRadius: 20,
  padding: '1.5rem',
};

interface QRModalProps {
  url: string;
  guestName: string;
  onClose: () => void;
  t: (k: string) => string;
}

function QRModal({ url, guestName, onClose, t }: QRModalProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem',
    }} onClick={onClose}>
      <div style={{
        ...glassCard,
        maxWidth: 360, width: '100%', textAlign: 'center',
        background: 'rgba(10,10,20,0.92)',
      }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          position: 'absolute' as any, top: 12, right: 12,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.6)',
        }}>
          <X size={20} />
        </button>
        <QrCode size={32} color="#0085ae" style={{ marginBottom: '0.75rem' }} />
        <h3 style={{ color: '#fff', fontWeight: 700, margin: '0 0 0.25rem', fontSize: '1rem' }}>
          {guestName}
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', margin: '0 0 1.25rem' }}>
          {t('pointCameraDesc')}
        </p>
        <div style={{
          background: '#fff', borderRadius: 16, padding: '1rem',
          display: 'inline-block', marginBottom: '1rem',
        }}>
          <QRCodeSVG value={url} size={200} level="M" />
        </div>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', wordBreak: 'break-all' }}>
          {url}
        </p>
      </div>
    </div>
  );
}

export default function WCIGuestList() {
  const { hotelId, bookingId } = useParams<{ hotelId: string; bookingId: string }>();
  const navigate = useNavigate();
  const { t } = useWCI();

  const [guests, setGuests] = useState<WebCheckinGuest[]>([]);
  const [bookingRef, setBookingRef] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [qrGuest, setQrGuest] = useState<WebCheckinGuest | null>(null);

  const loadGuests = useCallback(async () => {
    if (!hotelId || !bookingId) return;
    setLoading(true);
    try {
      // Preferir localStorage (persistência entre telas)
      const stored = loadGuestsFromStorage(bookingId);
      if (stored && stored.length > 0) {
        setGuests(stored);
        setBookingRef(bookingId);
      } else {
        // Fallback: re-buscar via Erbon
        const booking = await erbonService.fetchBookingByInternalId(hotelId, Number(bookingId));
        if (booking) {
          const gs: WebCheckinGuest[] = (booking.guestList || []).map((g, idx) => ({
            id: g.id,
            name: g.name || 'Hóspede',
            email: g.email,
            phone: g.phone,
            documents: g.documents,
            fnrhCompleted: false,
            isMainGuest: idx === 0,
          }));
          saveGuestsToStorage(bookingId, gs);
          setGuests(gs);
          setBookingRef(booking.bookingNumber || bookingId);
        }
      }
    } catch (err) {
      console.error('[WCIGuestList]', err);
    } finally {
      setLoading(false);
    }
  }, [hotelId, bookingId]);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  const handleFillGuest = (guest: WebCheckinGuest) => {
    navigate(`/web-checkin/${hotelId}/fnrh/${bookingId}/${guest.id}`);
  };

  const handleQR = (guest: WebCheckinGuest) => {
    setQrGuest(guest);
  };

  const handleAddGuest = () => {
    // Criar placeholder de novo hóspede (id=0 → será criado na API)
    const newGuest: WebCheckinGuest = {
      id: 0,
      name: t('newGuest'),
      fnrhCompleted: false,
      isMainGuest: false,
    };
    // Navegamos diretamente para o formulário com id=0 (novo)
    const tempId = `new_${Date.now()}`;
    navigate(`/web-checkin/${hotelId}/fnrh/${bookingId}/${tempId}`);
  };

  const handleContinue = () => {
    navigate(`/web-checkin/${hotelId}/signature/${bookingId}`);
  };

  const allDone = guests.length > 0 && guests.every(g => g.fnrhCompleted);
  const anyDone = guests.some(g => g.fnrhCompleted);

  const qrBase = window.location.origin;

  return (
    <div style={{
      minHeight: 'calc(100vh - 70px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: 680 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Users size={44} color="#0085ae" style={{ marginBottom: '1rem' }} />
          <h1 style={{ fontSize: 'clamp(1.2rem,4vw,1.8rem)', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            {t('guestList')}
          </h1>
          {bookingRef && (
            <p style={{ color: 'rgba(255,255,255,0.6)', margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
              {t('bookingId')} #{bookingRef}
            </p>
          )}
        </div>

        {/* Helper text */}
        <div style={{ ...glassCard, marginBottom: '1.25rem', background: 'rgba(0,133,174,0.15)', border: '1px solid rgba(0,133,174,0.4)' }}>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', margin: 0 }}>
            {t('fillFNRHHelp')}
          </p>
        </div>

        {/* Guest list */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <Loader2 size={36} color="#0085ae" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {guests.map((guest, idx) => (
              <div key={`${guest.id}_${idx}`} style={glassCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {/* Status icon */}
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                    background: guest.fnrhCompleted ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {guest.fnrhCompleted
                      ? <CheckCircle size={22} color="#22c55e" />
                      : <Clock size={22} color="rgba(255,255,255,0.5)" />
                    }
                  </div>

                  {/* Name + badges */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: '#fff', fontSize: '1rem' }}>
                        {guest.name}
                      </span>
                      {guest.isMainGuest && (
                        <span style={{ fontSize: '0.7rem', background: 'rgba(0,133,174,0.5)', color: '#7dd3ee', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                          {t('mainGuest')}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: guest.fnrhCompleted ? '#4ade80' : 'rgba(255,180,70,0.9)', fontWeight: 500 }}>
                      {guest.fnrhCompleted ? t('fnrhDone') : t('fnrhPending')}
                    </p>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    {/* QR */}
                    <button
                      onClick={() => handleQR(guest)}
                      title={t('fillQR')}
                      style={{
                        background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)',
                        borderRadius: 10, padding: '0.5rem', cursor: 'pointer', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <QrCode size={18} />
                    </button>

                    {/* Fill FNRH */}
                    {!guest.fnrhCompleted && (
                      <button
                        onClick={() => handleFillGuest(guest)}
                        style={{
                          background: '#0085ae', border: 'none', borderRadius: 10,
                          padding: '0.5rem 0.9rem', cursor: 'pointer', color: '#fff',
                          fontWeight: 600, fontSize: '0.85rem',
                          display: 'flex', alignItems: 'center', gap: '0.3rem',
                        }}
                      >
                        {t('fillHere')} <ChevronRight size={16} />
                      </button>
                    )}
                    {guest.fnrhCompleted && (
                      <button
                        onClick={() => handleFillGuest(guest)}
                        style={{
                          background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
                          borderRadius: 10, padding: '0.5rem 0.9rem', cursor: 'pointer',
                          color: '#4ade80', fontWeight: 600, fontSize: '0.85rem',
                        }}
                      >
                        Editar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Add companion */}
            <button
              onClick={handleAddGuest}
              style={{
                ...glassCard as any,
                border: '1px dashed rgba(255,255,255,0.35)',
                background: 'rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.75rem', cursor: 'pointer', color: 'rgba(255,255,255,0.7)',
                fontWeight: 600, fontSize: '0.95rem',
                width: '100%',
              }}
            >
              <UserPlus size={20} />
              {t('addGuest')}
            </button>
          </div>
        )}

        {/* Continue button */}
        {anyDone && (
          <button
            onClick={handleContinue}
            style={{
              marginTop: '1.5rem', width: '100%', padding: '1rem',
              background: allDone ? '#0085ae' : 'rgba(0,133,174,0.6)',
              border: 'none', borderRadius: 50, cursor: 'pointer',
              color: '#fff', fontWeight: 700, fontSize: '1.05rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              transition: 'all 0.2s',
            }}
          >
            {t('continueCheckin')}
          </button>
        )}

        {/* Back */}
        <button
          onClick={() => navigate(`/web-checkin/${hotelId}/search`)}
          style={{ display: 'block', margin: '1.25rem auto 0', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}
        >
          {t('newSearch')}
        </button>
      </div>

      {/* QR Modal */}
      {qrGuest && (
        <QRModal
          url={`${qrBase}/web-checkin/${hotelId}/fnrh/${bookingId}/${qrGuest.id}`}
          guestName={qrGuest.name}
          onClose={() => setQrGuest(null)}
          t={t}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
