// src/pages/webcheckin/WCISignatureAndTerms.tsx
// Tela de confirmação final — exibe resumo de hóspedes que assinaram
// e encerra o processo de web check-in no totem.
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle, Clock, Home, Users } from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import { loadGuestsFromStorage, clearGuestsFromStorage, WebCheckinGuest } from './webCheckinService';

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.25)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  borderRadius: 20,
  padding: '1.5rem',
};

export default function WCISignatureAndTerms() {
  const { hotelId, bookingId } = useParams<{ hotelId: string; bookingId: string }>();
  const navigate = useNavigate();
  const { t } = useWCI();

  const [guests, setGuests] = useState<WebCheckinGuest[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    const stored = loadGuestsFromStorage(bookingId) || [];
    setGuests(stored);
  }, [bookingId]);

  const pending = guests.filter(g => !g.fnrhCompleted);
  const signed  = guests.filter(g => g.fnrhCompleted);

  const handleConfirm = () => {
    if (bookingId) clearGuestsFromStorage(bookingId);
    setConfirmed(true);
    setTimeout(() => navigate('/web-checkin'), 8000);
  };

  // ── Tela de sucesso final ────────────────────────────────────────────────
  if (confirmed) {
    return (
      <div style={{
        minHeight: 'calc(100vh - 70px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '2rem',
      }}>
        <CheckCircle size={80} color="#22c55e" style={{ marginBottom: '1.5rem' }} />
        <h1 style={{ fontSize: 'clamp(1.5rem,5vw,2.5rem)', fontWeight: 800, color: '#fff', marginBottom: '0.75rem', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
          {t('successTitle')}
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '1.05rem', maxWidth: 480, lineHeight: 1.7, marginBottom: '0.5rem' }}>
          {t('successDesc')}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: '2rem' }}>
          {signed.length} ficha{signed.length !== 1 ? 's' : ''} assinada{signed.length !== 1 ? 's' : ''} digitalmente.
        </p>
        <button
          onClick={() => navigate('/web-checkin')}
          style={{
            padding: '0.875rem 2rem', borderRadius: 50, border: 'none', cursor: 'pointer',
            background: '#0085ae', color: '#fff', fontWeight: 700, fontSize: '1rem',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}
        >
          <Home size={18} /> {t('backStart')}
        </button>
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.78rem', marginTop: '1.5rem' }}>
          Retornando automaticamente...
        </p>
      </div>
    );
  }

  // ── Resumo de hóspedes ───────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: 'calc(100vh - 70px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: 640 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <Users size={44} color="#0085ae" style={{ marginBottom: '0.75rem' }} />
          <h1 style={{ fontSize: 'clamp(1.2rem,4vw,1.8rem)', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            Resumo do Check-in
          </h1>
          {bookingId && (
            <p style={{ color: 'rgba(255,255,255,0.55)', margin: '0.4rem 0 0', fontSize: '0.88rem' }}>
              {t('bookingId')} #{bookingId}
            </p>
          )}
        </div>

        {/* Fichas pendentes */}
        {pending.length > 0 && (
          <div style={{ ...glassCard, marginBottom: '1rem', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)' }}>
            <p style={{ color: 'rgba(251,191,36,0.9)', fontWeight: 700, margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
              ⚠️ {pending.length} hóspede{pending.length > 1 ? 's' : ''} ainda não {pending.length > 1 ? 'assinaram' : 'assinou'}:
            </p>
            {pending.map((g, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                <Clock size={16} color="rgba(251,191,36,0.7)" />
                <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.88rem' }}>{g.name}</span>
                <button
                  onClick={() => navigate(`/web-checkin/${hotelId}/companion/${bookingId}/${g.id}`)}
                  style={{
                    marginLeft: 'auto', background: 'rgba(251,191,36,0.2)', border: '1px solid rgba(251,191,36,0.4)',
                    borderRadius: 8, padding: '0.25rem 0.75rem', cursor: 'pointer',
                    color: 'rgba(251,191,36,0.9)', fontSize: '0.78rem', fontWeight: 600,
                  }}
                >
                  Assinar agora
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Fichas assinadas */}
        <div style={{ ...glassCard, marginBottom: '1.25rem' }}>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700, margin: '0 0 0.75rem', fontSize: '0.88rem' }}>
            {signed.length > 0 ? `✓ ${signed.length} ficha${signed.length > 1 ? 's' : ''} assinada${signed.length > 1 ? 's':''} digitalmente:` : 'Nenhuma ficha assinada ainda.'}
          </p>
          {signed.map((g, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
              <CheckCircle size={16} color="#22c55e" />
              <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.88rem' }}>{g.name}</span>
              {g.isMainGuest && (
                <span style={{ fontSize: '0.7rem', background: 'rgba(0,133,174,0.4)', color: '#7dd3ee', borderRadius: 5, padding: '1px 7px', fontWeight: 600 }}>
                  Principal
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Botões */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button
            onClick={handleConfirm}
            disabled={signed.length === 0}
            style={{
              padding: '1.05rem', borderRadius: 50, border: 'none',
              cursor: signed.length === 0 ? 'not-allowed' : 'pointer',
              background: signed.length === 0 ? 'rgba(0,133,174,0.3)' : '#0085ae',
              color: '#fff', fontWeight: 700, fontSize: '1.05rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}
          >
            <CheckCircle size={20} />
            {pending.length > 0
              ? `Finalizar mesmo assim (${pending.length} pendente${pending.length > 1 ? 's':''} )`
              : t('finishCheckin')
            }
          </button>

          <button
            onClick={() => navigate(`/web-checkin/${hotelId}/guests/${bookingId}`)}
            style={{
              display: 'block', margin: '0 auto', background: 'transparent',
              border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer',
              fontSize: '0.88rem', textDecoration: 'underline',
            }}
          >
            {t('back')}
          </button>
        </div>
      </div>
    </div>
  );
}
