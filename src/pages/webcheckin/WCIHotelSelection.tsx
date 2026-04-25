// src/pages/webcheckin/WCIHotelSelection.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWCI } from './WebCheckinLayout';
import { fetchWebCheckinHotels, WebCheckinHotel } from './webCheckinService';
import { Building2, MapPin } from 'lucide-react';

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div style={{
      borderRadius: 24,
      overflow: 'hidden',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.10)',
      animation: 'pulse 1.6s ease-in-out infinite',
    }}>
      <div style={{ height: 220, background: 'rgba(255,255,255,0.08)' }} />
      <div style={{ padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ height: 18, width: '60%', borderRadius: 8, background: 'rgba(255,255,255,0.10)' }} />
        <div style={{ height: 13, width: '40%', borderRadius: 8, background: 'rgba(255,255,255,0.07)' }} />
      </div>
    </div>
  );
}

// ── Hotel card ────────────────────────────────────────────────────────────────

function HotelCard({
  hotel, onClick, delay,
}: { hotel: WebCheckinHotel; onClick: () => void; delay: number }) {
  const [pressed, setPressed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const placeholder = `https://placehold.co/800x400/0a2540/4db8d4?text=${encodeURIComponent(hotel.name)}`;

  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      aria-label={`Selecionar ${hotel.name}`}
      style={{
        display: 'block',
        width: '100%',
        padding: 0,
        border: 'none',
        borderRadius: 24,
        overflow: 'hidden',
        cursor: 'pointer',
        textAlign: 'left',
        background: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: pressed
          ? '0 4px 16px rgba(0,0,0,0.3)'
          : '0 12px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.12)',
        transform: pressed
          ? 'scale(0.97)'
          : visible ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(16px)',
        opacity: visible ? 1 : 0,
        transition: pressed
          ? 'transform 0.08s ease, box-shadow 0.08s ease'
          : 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.35s ease, box-shadow 0.25s ease',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
      }}
    >
      {/* Imagem hero */}
      <div style={{ position: 'relative', paddingTop: '58%', overflow: 'hidden' }}>
        <img
          src={hotel.image_url || placeholder}
          alt={hotel.name}
          loading="lazy"
          onError={e => { (e.target as HTMLImageElement).src = placeholder; }}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            transform: pressed ? 'scale(1)' : 'scale(1.03)',
            transition: 'transform 0.4s ease',
          }}
        />
        {/* Gradiente de leitura */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(160deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.72) 100%)',
        }} />

        {/* Badge */}
        <div style={{
          position: 'absolute', top: 12, right: 12,
          background: 'rgba(0,133,174,0.92)',
          backdropFilter: 'blur(8px)',
          borderRadius: 20, padding: '4px 11px',
          fontSize: '0.66rem', fontWeight: 700,
          color: '#fff', letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Check-in Online
        </div>

        {/* Nome sobre a imagem */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '1.5rem 1.25rem 1rem',
        }}>
          <h2 style={{
            margin: 0,
            fontSize: 'clamp(1rem, 2.5vw, 1.2rem)',
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1.2,
            textShadow: '0 1px 8px rgba(0,0,0,0.5)',
          }}>
            {hotel.name}
          </h2>
        </div>
      </div>

      {/* Rodapé do card */}
      <div style={{
        padding: '0.9rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
      }}>
        <div style={{ minWidth: 0 }}>
          {hotel.description ? (
            <p style={{
              margin: 0,
              fontSize: '0.8rem',
              color: 'rgba(255,255,255,0.55)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}>
              <MapPin size={11} style={{ flexShrink: 0, opacity: 0.7 }} />
              {hotel.description}
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
              Toque para iniciar o check-in
            </p>
          )}
        </div>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: pressed ? 'rgba(0,133,174,0.5)' : 'rgba(0,133,174,0.22)',
          border: '1px solid rgba(0,133,174,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s ease',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="rgba(100,210,240,0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function WCIHotelSelection() {
  const navigate = useNavigate();
  const { t } = useWCI();
  const [hotels, setHotels] = useState<WebCheckinHotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchWebCheckinHotels()
      .then(setHotels)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Grid columns: 1 col mobile, 2 col ≥540px, 3 col ≥900px (máx 3)
  const gridCols = hotels.length === 1
    ? '1fr'
    : 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))';

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      padding: 'env(safe-area-inset-top, 0) env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0)',
    }}>
      {/* Header compacto */}
      <header style={{
        textAlign: 'center',
        padding: '2rem 1.5rem 1.25rem',
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate('/web-checkin')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-block', marginBottom: '1rem' }}
          aria-label="Voltar ao início"
        >
          <div style={{
            fontSize: 'clamp(1.5rem, 5vw, 2.1rem)',
            fontWeight: 900,
            color: '#fff',
            letterSpacing: '-0.02em',
            lineHeight: 1,
            textShadow: '0 2px 20px rgba(0,133,174,0.6)',
          }}>
            Meridiana
          </div>
          <div style={{
            fontSize: '0.68rem',
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            marginTop: '0.2rem',
          }}>
            Hoteles
          </div>
        </button>

        <h1 style={{
          margin: 0,
          fontSize: 'clamp(1.1rem, 3.5vw, 1.5rem)',
          fontWeight: 700,
          color: '#fff',
          textShadow: '0 2px 12px rgba(0,0,0,0.4)',
          lineHeight: 1.3,
        }}>
          {t('selectHotel')}
        </h1>
        <p style={{
          margin: '0.4rem 0 0',
          fontSize: '0.85rem',
          color: 'rgba(255,255,255,0.45)',
          lineHeight: 1.5,
        }}>
          Selecione o hotel para iniciar seu check-in online
        </p>
      </header>

      {/* Conteúdo */}
      <main style={{
        flex: 1,
        width: '100%',
        maxWidth: 960,
        margin: '0 auto',
        padding: '0.5rem 1.25rem 2rem',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: hotels.length <= 2 ? 'center' : 'flex-start',
      }}>
        {loading ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            gap: '1rem',
          }}>
            {[1, 2].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div style={{
            background: 'rgba(220,38,38,0.15)',
            border: '1px solid rgba(220,38,38,0.35)',
            borderRadius: 20,
            padding: '2rem',
            textAlign: 'center',
            color: '#fff',
          }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{t('errorGeneral')}</p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.83rem', opacity: 0.6 }}>{error}</p>
          </div>
        ) : hotels.length === 0 ? (
          <div style={{
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 24,
            padding: '3rem 2rem',
            textAlign: 'center',
            color: '#fff',
          }}>
            <Building2 size={44} style={{ opacity: 0.3, marginBottom: '1rem', display: 'block', margin: '0 auto 1rem' }} />
            <p style={{ margin: 0, fontWeight: 600, fontSize: '1rem' }}>Nenhum hotel disponível</p>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.83rem', color: 'rgba(255,255,255,0.45)' }}>
              Nenhum hotel está disponível para check-in online no momento.
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            gap: '1rem',
            width: '100%',
          }}>
            {hotels.map((hotel, i) => (
              <HotelCard
                key={hotel.id}
                hotel={hotel}
                delay={i * 60}
                onClick={() => navigate(`/web-checkin/${hotel.wci_code}/search`)}
              />
            ))}
          </div>
        )}
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
