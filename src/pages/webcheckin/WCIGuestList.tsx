// src/pages/webcheckin/WCIGuestList.tsx
// :hotelId = wci_code opaco   :bookingId = session token opaco
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Users, CheckCircle, Clock, QrCode, UserPlus,
  ChevronRight, Loader2, X, Smartphone, Edit3,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useWCI } from './WebCheckinLayout';
import {
  loadGuestsFromServer,
  saveGuestsToStorage,
  resolveHotelByCode,
  resolveSession,
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

// ── Modal de QR ──────────────────────────────────────────────────────────────

function QRModal({ url, title, subtitle, onClose }: {
  url: string; title: string; subtitle: string; onClose: () => void;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem',
    }} onClick={onClose}>
      <div style={{
        ...glassCard, maxWidth: 380, width: '100%', textAlign: 'center',
        background: 'rgba(10,10,20,0.95)', position: 'relative',
      }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 12, right: 12,
          background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)',
        }}>
          <X size={20} />
        </button>
        <QrCode size={32} color="#0085ae" style={{ marginBottom: '0.75rem' }} />
        <h3 style={{ color: '#fff', fontWeight: 700, margin: '0 0 0.3rem', fontSize: '1.05rem' }}>
          {title}
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.82rem', margin: '0 0 1.25rem', lineHeight: 1.5 }}>
          {subtitle}
        </p>
        <div style={{ background: '#fff', borderRadius: 16, padding: '1rem', display: 'inline-block', marginBottom: '1rem' }}>
          <QRCodeSVG value={url} size={200} level="M" />
        </div>
      </div>
    </div>
  );
}

// ── Modal adicionar acompanhante ─────────────────────────────────────────────

function AddCompanionModal({ wciCode, sessionToken, onFillHere, onClose }: {
  wciCode: string; sessionToken: string;
  onFillHere: () => void; onClose: () => void;
}) {
  const [showQR, setShowQR] = useState(false);
  const companionUrl = `${window.location.origin}/web-checkin/${wciCode}/companion/${sessionToken}`;

  if (showQR) {
    return (
      <QRModal
        url={companionUrl}
        title="QR para Acompanhante"
        subtitle="Qualquer acompanhante pode escanear este QR com o celular para preencher a própria ficha e assinar."
        onClose={onClose}
      />
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem',
    }} onClick={onClose}>
      <div style={{
        ...glassCard, maxWidth: 400, width: '100%',
        background: 'rgba(10,10,20,0.95)', position: 'relative',
      }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 12, right: 12,
          background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)',
        }}>
          <X size={20} />
        </button>

        <UserPlus size={32} color="#0085ae" style={{ marginBottom: '0.75rem' }} />
        <h3 style={{ color: '#fff', fontWeight: 800, margin: '0 0 0.4rem', fontSize: '1.15rem' }}>
          Adicionar Acompanhante
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.85rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          Como o acompanhante vai preencher a ficha?
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button onClick={onFillHere} style={{
            background: '#0085ae', border: 'none', borderRadius: 14, padding: '1rem 1.25rem',
            cursor: 'pointer', color: '#fff', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: '1rem',
          }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Edit3 size={22} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Preencher aqui</div>
              <div style={{ fontSize: '0.78rem', opacity: 0.8, marginTop: '0.15rem' }}>
                Usar este dispositivo para cadastrar o acompanhante
              </div>
            </div>
          </button>

          <button onClick={() => setShowQR(true)} style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 14, padding: '1rem 1.25rem',
            cursor: 'pointer', color: '#fff', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: '1rem',
          }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(0,133,174,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Smartphone size={22} color="#7dd3ee" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>QR Code para o celular</div>
              <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)', marginTop: '0.15rem' }}>
                O acompanhante escaneia e preenche no próprio celular
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function WCIGuestList() {
  // URL params: wciCode = slug opaco do hotel, sessionToken = token da sessão
  const { hotelId: wciCode, bookingId: sessionToken } = useParams<{ hotelId: string; bookingId: string }>();
  const navigate = useNavigate();
  const { t } = useWCI();

  // IDs reais (resolvidos a partir dos tokens)
  const [realHotelId, setRealHotelId]     = useState<string | null>(null);
  const [realBookingId, setRealBookingId] = useState<number | null>(null);
  const [resolveError, setResolveError]   = useState(false);

  const [guests, setGuests]       = useState<WebCheckinGuest[]>([]);
  const [bookingRef, setBookingRef] = useState('');
  const [loading, setLoading]     = useState(true);
  const [qrGuest, setQrGuest]     = useState<WebCheckinGuest | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // ── Resolver tokens → IDs reais ──────────────────────────────────────────
  useEffect(() => {
    if (!wciCode || !sessionToken) return;
    Promise.all([
      resolveHotelByCode(wciCode),
      resolveSession(sessionToken),
    ]).then(([hotel, session]) => {
      if (hotel) setRealHotelId(hotel.id);
      if (session) setRealBookingId(session.bookingId);
      if (!hotel || !session) setResolveError(true);
    });
  }, [wciCode, sessionToken]);

  // ── Carregar hóspedes — Erbon é sempre a fonte de verdade ───────────────
  // Hóspedes excluídos da Erbon desaparecem automaticamente;
  // o status fnrhCompleted é preservado via merge com a sessão local.
  const loadGuests = useCallback(async (showSpinner = true) => {
    if (!realHotelId || !realBookingId) return;
    if (showSpinner) setLoading(true);
    try {
      // Busca em paralelo: Erbon (fonte de verdade) + sessão (status fnrhCompleted)
      const [booking, sessionGuests] = await Promise.all([
        erbonService.fetchBookingByInternalId(realHotelId, realBookingId),
        loadGuestsFromServer(realBookingId),
      ]);

      if (booking) {
        const erbonGuests: WebCheckinGuest[] = (booking.guestList || []).map((g: any, idx: number) => ({
          id:            g.id,
          name:          g.name  || 'Hóspede',
          email:         g.email,
          phone:         g.phone,
          documents:     g.documents,
          fnrhCompleted: false,
          isMainGuest:   idx === 0,
        }));

        // Mescla: mantém fnrhCompleted do cache (preenchido no web check-in)
        const merged: WebCheckinGuest[] = erbonGuests.map(eg => {
          const cached = sessionGuests?.find(sg => sg.id === eg.id);
          return cached ? { ...eg, fnrhCompleted: cached.fnrhCompleted } : eg;
        });

        await saveGuestsToStorage(realBookingId, merged, realHotelId);
        setGuests(merged);
        // Exibe bookingNumber (cliente-facing), nunca o internal ID
        const ref = (booking as any).bookingNumber || booking.erbonNumber;
        setBookingRef(ref ? String(ref) : '');
      } else {
        // Fallback: cache local (Erbon offline / erro de rede)
        if (sessionGuests && sessionGuests.length > 0) {
          setGuests(sessionGuests);
        }
      }
    } catch { /* silencioso */ } finally {
      if (showSpinner) setLoading(false);
    }
  }, [realHotelId, realBookingId]);

  // Carregar quando IDs reais estiverem disponíveis
  useEffect(() => {
    if (realHotelId && realBookingId) loadGuests();
  }, [realHotelId, realBookingId, loadGuests]);

  // Polling 8s — detecta quando celular completa assinatura
  useEffect(() => {
    const interval = setInterval(() => loadGuests(false), 8000);
    return () => clearInterval(interval);
  }, [loadGuests]);

  // Recarregar ao recuperar foco
  useEffect(() => {
    const onFocus = () => loadGuests(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadGuests]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleFillGuest = (guest: WebCheckinGuest) => {
    navigate(`/web-checkin/${wciCode}/companion/${sessionToken}/${guest.id}`);
  };

  const handleFillHere = () => {
    setShowAddModal(false);
    navigate(`/web-checkin/${wciCode}/companion/${sessionToken}`);
  };

  const handleContinue = () => {
    navigate(`/web-checkin/${wciCode}/signature/${sessionToken}`);
  };

  const anyDone = guests.some(g => g.fnrhCompleted);
  const allDone = guests.length > 0 && guests.every(g => g.fnrhCompleted);

  // Erro de resolução — token inválido ou expirado
  if (resolveError) {
    return (
      <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <div>
          <p style={{ color: '#fca5a5', fontSize: '1rem', marginBottom: '1.5rem' }}>
            Sessão não encontrada. Por favor, realize uma nova busca.
          </p>
          <button onClick={() => navigate('/web-checkin/hotels')}
            style={{ background: '#0085ae', border: 'none', borderRadius: 50, padding: '0.875rem 2rem', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Voltar ao início
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: 'calc(100vh - 70px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: 680 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <Users size={44} color="#0085ae" style={{ marginBottom: '1rem' }} />
          <h1 style={{ fontSize: 'clamp(1.2rem,4vw,1.8rem)', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            {t('guestList')}
          </h1>
        </div>

        {/* Info */}
        <div style={{ ...glassCard, marginBottom: '1.25rem', background: 'rgba(0,133,174,0.15)', border: '1px solid rgba(0,133,174,0.4)', padding: '1rem 1.25rem' }}>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.88rem', margin: 0 }}>
            {t('fillFNRHHelp')}
          </p>
        </div>

        {/* Lista */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <Loader2 size={36} color="#0085ae" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {guests.map((guest, idx) => (
              <div key={`${guest.id}_${idx}`} style={glassCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>

                  <div style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                    background: guest.fnrhCompleted ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {guest.fnrhCompleted
                      ? <CheckCircle size={22} color="#22c55e" />
                      : <Clock size={22} color="rgba(255,255,255,0.5)" />}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: '#fff', fontSize: '1rem' }}>{guest.name}</span>
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

                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    {/* QR — token opaco, sem expor IDs reais */}
                    <button
                      onClick={() => setQrGuest(guest)}
                      title="QR Code para preencher/assinar pelo celular"
                      style={{
                        background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)',
                        borderRadius: 10, padding: '0.5rem', cursor: 'pointer', color: '#fff',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <QrCode size={18} />
                    </button>

                    {/* Preencher/editar no totem */}
                    <button
                      onClick={() => handleFillGuest(guest)}
                      style={{
                        background: guest.fnrhCompleted ? 'rgba(34,197,94,0.15)' : '#0085ae',
                        border: guest.fnrhCompleted ? '1px solid rgba(34,197,94,0.4)' : 'none',
                        borderRadius: 10, padding: '0.5rem 0.9rem', cursor: 'pointer',
                        color: guest.fnrhCompleted ? '#4ade80' : '#fff',
                        fontWeight: 600, fontSize: '0.85rem',
                        display: 'flex', alignItems: 'center', gap: '0.3rem',
                      }}
                    >
                      {guest.fnrhCompleted ? 'Editar' : <>{t('fillHere')} <ChevronRight size={16} /></>}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Adicionar acompanhante */}
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                ...glassCard as any,
                border: '1px dashed rgba(255,255,255,0.35)',
                background: 'rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.75rem', cursor: 'pointer', color: 'rgba(255,255,255,0.75)',
                fontWeight: 600, fontSize: '0.95rem', width: '100%',
                transition: 'all 0.2s',
              }}
            >
              <UserPlus size={20} />
              {t('addGuest')}
            </button>
          </div>
        )}

        {/* Continuar */}
        {anyDone && (
          <button
            onClick={handleContinue}
            style={{
              marginTop: '1.5rem', width: '100%', padding: '1rem',
              background: allDone ? '#0085ae' : 'rgba(0,133,174,0.65)',
              border: 'none', borderRadius: 50, cursor: 'pointer',
              color: '#fff', fontWeight: 700, fontSize: '1.05rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}
          >
            {t('continueCheckin')}
          </button>
        )}

        <button
          onClick={() => navigate(`/web-checkin/${wciCode}/search`)}
          style={{ display: 'block', margin: '1.25rem auto 0', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}
        >
          {t('newSearch')}
        </button>
      </div>

      {/* QR Modal — URL usa tokens opacos, sem IDs reais */}
      {qrGuest && wciCode && sessionToken && (
        <QRModal
          url={`${window.location.origin}/web-checkin/${wciCode}/companion/${sessionToken}/${qrGuest.id}`}
          title={qrGuest.name}
          subtitle={
            qrGuest.fnrhCompleted
              ? 'Escanear para revisar os dados e assinar digitalmente pelo celular.'
              : 'Escanear para preencher a ficha e assinar digitalmente pelo celular.'
          }
          onClose={() => setQrGuest(null)}
        />
      )}

      {/* Modal adicionar acompanhante */}
      {showAddModal && wciCode && sessionToken && (
        <AddCompanionModal
          wciCode={wciCode}
          sessionToken={sessionToken}
          onFillHere={handleFillHere}
          onClose={() => setShowAddModal(false)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
