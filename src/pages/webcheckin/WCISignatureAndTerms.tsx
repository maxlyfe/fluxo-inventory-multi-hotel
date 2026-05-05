// src/pages/webcheckin/WCISignatureAndTerms.tsx
// Tela final do web check-in — termos, assinatura digital e envio ao banco.
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle, Home, PenLine, Trash2 } from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import {
  saveFichaToDatabase,
  fetchHotelPolicies,
  resolveHotelByCode,
  resolveSession,
  loadGuestsFromStorage,
  clearGuestsFromStorage,
  WebCheckinGuest,
} from './webCheckinService';

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

  // wciCode is the opaque hotel slug from URL; bookingId is the opaque session token
  const wciCode = hotelId ?? '';
  const sessionToken = bookingId ?? '';

  // ── State ──────────────────────────────────────────────────────────────────
  const [guests, setGuests] = useState<WebCheckinGuest[]>([]);
  const [hotelTerms, setHotelTerms] = useState('');
  const [lgpdTerms, setLgpdTerms] = useState('');
  const [hotelTermsAccepted, setHotelTermsAccepted] = useState(false);
  const [lgpdAccepted, setLgpdAccepted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [realHotelId, setRealHotelId] = useState<string | null>(null);
  const [bookingRef, setBookingRef] = useState('');

  // Signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  // ── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wciCode || !sessionToken) return;

    // Resolve hotel code → real UUID + fetch policies
    resolveHotelByCode(wciCode).then(resolved => {
      if (!resolved) return;
      setRealHotelId(resolved.id);
      fetchHotelPolicies(resolved.id).then(policies => {
        setHotelTerms(policies.wci_hotel_terms || '');
        setLgpdTerms(policies.wci_lgpd_terms || '');
      }).catch(() => {});
    }).catch(() => {});

    // Carregar guests e booking number da sessão no servidor (fonte confiável)
    // Guests ficam em wci_sessions.guests sob o numeric booking ID,
    // mas resolveSession busca pelo session_token, então retorna a sessão correta.
    resolveSession(sessionToken).then(session => {
      if (session?.guests?.length) setGuests(session.guests);
      if (session?.bookingNumber) setBookingRef(session.bookingNumber);
    }).catch(() => {
      // fallback ao localStorage se o servidor falhar
      const stored = loadGuestsFromStorage(sessionToken) || [];
      if (stored.length) setGuests(stored);
    });
  }, [wciCode, sessionToken]);

  // ── Canvas helpers ─────────────────────────────────────────────────────────
  function getPosFromEvent(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: (e as React.MouseEvent<HTMLCanvasElement>).clientX - rect.left,
      y: (e as React.MouseEvent<HTMLCanvasElement>).clientY - rect.top,
    };
  }

  const handleDrawStart = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if ('touches' in e) e.preventDefault();
      const pos = getPosFromEvent(e);
      setIsDrawing(true);
      setLastPos(pos);
    },
    []
  );

  const handleDrawMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if ('touches' in e) e.preventDefault();
      if (!isDrawing) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pos = getPosFromEvent(e);
      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = '#0085ae';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      setLastPos(pos);
      setHasSignature(true);
    },
    [isDrawing, lastPos]
  );

  const handleDrawEnd = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if ('touches' in e) e.preventDefault();
      setIsDrawing(false);
    },
    []
  );

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  function getSignatureBase64(): string {
    return canvasRef.current?.toDataURL('image/png') || '';
  }

  // ── Finalizar ──────────────────────────────────────────────────────────────
  async function handleConfirm() {
    setError('');

    if (!hotelTermsAccepted && hotelTerms) {
      setError('Aceite os termos para continuar.');
      return;
    }
    if (!lgpdAccepted) {
      setError('Aceite os termos para continuar.');
      return;
    }
    if (!hasSignature) {
      setError('Por favor, assine no campo acima.');
      return;
    }

    setSaving(true);
    try {
      const signatureData = getSignatureBase64();

      // Resolve hotel UUID on-demand (don't rely on async state)
      const hotelUUID = realHotelId || (await resolveHotelByCode(wciCode))?.id;
      if (!hotelUUID) throw new Error('Hotel não identificado. Tente novamente.');

      // Resolve session on-demand to get latest guests + booking number
      const session = await resolveSession(sessionToken).catch(() => null);
      const latestGuests = (session?.guests?.length ? session.guests : guests);

      // Resolve booking number on-demand if not yet populated
      let finalBookingRef = bookingRef || session?.bookingNumber || '';

      const guestsForDb = latestGuests.map(g => ({
        isMainGuest: g.isMainGuest,
        erbonGuestId: typeof g.id === 'number' && g.id > 0 ? g.id : null,
        name: g.name,
        email: g.email,
        phone: g.phone,
        documentType: g.documents?.[0]?.documentType,
        documentNumber: g.documents?.[0]?.number,
        birthDate: g.birthDate,
        genderId: g.genderID,
        nationality: g.nationality,
        addressCountry: g.address?.country,
        addressState: g.address?.state,
        addressCity: g.address?.city,
        addressStreet: g.address?.street,
        addressZipcode: g.address?.zipcode,
        addressNeighborhood: g.address?.neighborhood,
        documentFrontUrl: g.documentFrontUrl,
        documentBackUrl: g.documentBackUrl,
        // Campos FNRH Gov — passados da sessão para o banco permanente
        fnrhRacaId:             g.fnrh_extra?.raca_id,
        fnrhDeficienciaId:      g.fnrh_extra?.deficiencia_id,
        fnrhTipoDeficienciaId:  g.fnrh_extra?.tipo_deficiencia_id,
        fnrhMotivoViagemId:     g.fnrh_extra?.motivo_viagem_id,
        fnrhMeioTransporteId:   g.fnrh_extra?.meio_transporte_id,
        fnrhGrauParentescoId:   g.fnrh_extra?.grau_parentesco_id,
        fnrhResponsavelDocumento: g.fnrh_extra?.responsavel_documento,
        fnrhResponsavelDocTipo:  g.fnrh_extra?.responsavel_doc_tipo,
      }));

      const fichaId = await saveFichaToDatabase({
        hotelId: hotelUUID,
        bookingNumber: finalBookingRef || undefined,
        guests: guestsForDb,
        hotelTermsAccepted,
        lgpdAccepted,
        signatureData,
        source: 'web',
      });

      if (sessionToken) clearGuestsFromStorage(sessionToken);
      setConfirmed(true);
      setTimeout(() => navigate('/web-checkin'), 8000);
    } catch (err: any) {
      setError(err.message || `Erro ao salvar (${String(err)}). Tente novamente.`);
    } finally {
      setSaving(false);
    }
  }

  // ── Tela de sucesso ────────────────────────────────────────────────────────
  if (confirmed) {
    return (
      <div style={{
        minHeight: 'calc(100vh - 70px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '2rem',
      }}>
        <CheckCircle size={80} color="#22c55e" style={{ marginBottom: '1.5rem' }} />
        <h1 style={{
          fontSize: 'clamp(1.5rem,5vw,2.5rem)', fontWeight: 800, color: '#fff',
          marginBottom: '0.75rem', textShadow: '0 2px 12px rgba(0,0,0,0.5)',
        }}>
          {t('successTitle')}
        </h1>
        <p style={{
          color: 'rgba(255,255,255,0.75)', fontSize: '1.05rem',
          maxWidth: 480, lineHeight: 1.7, marginBottom: '0.5rem',
        }}>
          {t('successDesc')}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: '2rem' }}>
          Check-in realizado com sucesso!
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
          Retornando automaticamente em alguns segundos...
        </p>
      </div>
    );
  }

  // ── Tela principal ─────────────────────────────────────────────────────────
  const canFinish =
    (!hotelTerms || hotelTermsAccepted) &&
    lgpdAccepted &&
    hasSignature &&
    !saving;

  return (
    <div style={{
      minHeight: 'calc(100vh - 70px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: 640 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <PenLine size={44} color="#0085ae" style={{ marginBottom: '0.75rem' }} />
          <h1 style={{
            fontSize: 'clamp(1.2rem,4vw,1.8rem)', fontWeight: 800, color: '#fff',
            margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}>
            Termos e Assinatura
          </h1>
        </div>

        {/* Termos do Hotel */}
        {hotelTerms ? (
          <div style={{ ...glassCard, marginBottom: '1rem' }}>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.6rem' }}>
              Regulamento do Hotel
            </p>
            <div style={{
              maxHeight: 180, overflowY: 'auto', color: 'rgba(255,255,255,0.8)',
              fontSize: '0.85rem', lineHeight: 1.65, whiteSpace: 'pre-wrap',
            }}>
              {hotelTerms}
            </div>
          </div>
        ) : null}

        {/* Termos LGPD */}
        {lgpdTerms ? (
          <div style={{ ...glassCard, marginBottom: '1rem' }}>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.6rem' }}>
              Política de Privacidade (LGPD)
            </p>
            <div style={{
              maxHeight: 120, overflowY: 'auto', color: 'rgba(255,255,255,0.8)',
              fontSize: '0.85rem', lineHeight: 1.65, whiteSpace: 'pre-wrap',
            }}>
              {lgpdTerms}
            </div>
          </div>
        ) : null}

        {/* Checkboxes */}
        <div style={{ ...glassCard, marginBottom: '1rem' }}>
          {hotelTerms && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
              cursor: 'pointer', marginBottom: '0.85rem',
            }}>
              <input
                type="checkbox"
                checked={hotelTermsAccepted}
                onChange={e => { setHotelTermsAccepted(e.target.checked); setError(''); }}
                style={{ width: 18, height: 18, marginTop: 2, accentColor: '#0085ae', flexShrink: 0, cursor: 'pointer' }}
              />
              <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                Li e aceito o <strong style={{ color: '#fff' }}>Regulamento do Hotel</strong>
              </span>
            </label>
          )}

          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={lgpdAccepted}
              onChange={e => { setLgpdAccepted(e.target.checked); setError(''); }}
              style={{ width: 18, height: 18, marginTop: 2, accentColor: '#0085ae', flexShrink: 0, cursor: 'pointer' }}
            />
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Li e aceito a <strong style={{ color: '#fff' }}>Política de Privacidade (LGPD)</strong> e autorizo o tratamento dos meus dados pessoais para fins de hospedagem.
            </span>
          </label>
        </div>

        {/* Canvas de assinatura */}
        <div style={{ ...glassCard, marginBottom: '1.25rem', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.88rem', fontWeight: 700, margin: 0 }}>
              Assinatura Digital
            </p>
            <button
              onClick={clearCanvas}
              title="Limpar assinatura"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.35rem',
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8, padding: '0.3rem 0.75rem', cursor: 'pointer',
                color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem', fontWeight: 600,
              }}
            >
              <Trash2 size={13} /> Limpar
            </button>
          </div>

          <div style={{
            border: hasSignature
              ? '1px solid rgba(0,133,174,0.55)'
              : '1px dashed rgba(255,255,255,0.25)',
            borderRadius: 12, overflow: 'hidden', position: 'relative',
          }}>
            <canvas
              ref={canvasRef}
              width={600}
              height={150}
              onMouseDown={handleDrawStart}
              onMouseMove={handleDrawMove}
              onMouseUp={handleDrawEnd}
              onMouseLeave={handleDrawEnd}
              onTouchStart={handleDrawStart}
              onTouchMove={handleDrawMove}
              onTouchEnd={handleDrawEnd}
              style={{
                display: 'block',
                width: '100%',
                height: 150,
                background: 'rgba(255,255,255,0.08)',
                cursor: 'crosshair',
                touchAction: 'none',
              }}
            />
            {!hasSignature && (
              <p style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'rgba(255,255,255,0.25)', fontSize: '0.85rem',
                pointerEvents: 'none', margin: 0, userSelect: 'none',
              }}>
                Assine aqui com o dedo ou mouse
              </p>
            )}
          </div>
        </div>

        {/* Erro */}
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 12, padding: '0.75rem 1rem', marginBottom: '1rem',
            color: 'rgba(255,180,180,0.95)', fontSize: '0.88rem', textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        {/* Botões */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button
            onClick={handleConfirm}
            disabled={!canFinish}
            style={{
              padding: '1.05rem', borderRadius: 50, border: 'none',
              cursor: canFinish ? 'pointer' : 'not-allowed',
              background: canFinish ? '#0085ae' : 'rgba(0,133,174,0.3)',
              color: '#fff', fontWeight: 700, fontSize: '1.05rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              transition: 'background 0.2s',
            }}
          >
            <CheckCircle size={20} />
            {saving ? 'Salvando...' : t('finishCheckin')}
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
