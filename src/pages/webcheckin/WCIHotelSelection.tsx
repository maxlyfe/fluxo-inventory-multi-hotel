// src/pages/webcheckin/WCIHotelSelection.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWCI } from './WebCheckinLayout';
import { fetchWebCheckinHotels, WebCheckinHotel } from './webCheckinService';
import { Building2, MapPin, Check } from 'lucide-react';

// ── CSS injetado — hover/active/selected não funcionam via inline styles ─────

const CSS = `
  @keyframes wci-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.45; }
  }
  @keyframes wci-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes wci-glow-ring {
    0%   { box-shadow: 0 0 0 0   rgba(0,200,255,0.45), 0 24px 64px rgba(0,133,174,0.30); }
    100% { box-shadow: 0 0 0 6px rgba(0,200,255,0),    0 24px 64px rgba(0,133,174,0.30); }
  }
  @keyframes wci-enter {
    from { opacity: 0; transform: translateY(20px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0)    scale(1);    }
  }
  @keyframes wci-selected-pulse {
    0%   { box-shadow: 0 0 0 0   rgba(0,200,255,0.8),  0 28px 72px rgba(0,133,174,0.55); }
    70%  { box-shadow: 0 0 0 10px rgba(0,200,255,0),   0 28px 72px rgba(0,133,174,0.55); }
    100% { box-shadow: 0 0 0 0   rgba(0,200,255,0),    0 28px 72px rgba(0,133,174,0.55); }
  }

  /* ── Card base ── */
  .wci-hotel-card {
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    border-radius: 24px;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    background: rgba(255,255,255,0.08);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    outline: 1.5px solid rgba(255,255,255,0.13);
    box-shadow: 0 12px 40px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2);
    transition:
      transform      0.28s cubic-bezier(0.34,1.3,0.64,1),
      box-shadow     0.28s ease,
      outline-color  0.22s ease;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    position: relative;
  }

  /* ── Hover (desktop) ── */
  .wci-hotel-card:hover {
    transform: translateY(-10px) scale(1.015);
    outline: 1.5px solid rgba(0,200,255,0.55);
    box-shadow:
      0 28px 72px rgba(0,133,174,0.38),
      0 8px  24px rgba(0,0,0,0.40),
      0 0   0 1px rgba(0,200,255,0.3);
    animation: wci-glow-ring 1.4s ease-out infinite;
  }
  .wci-hotel-card:hover .wci-card-image {
    transform: scale(1.07);
  }
  .wci-hotel-card:hover .wci-card-arrow {
    background: rgba(0,133,174,0.75);
    transform: translateX(4px);
    box-shadow: 0 0 16px rgba(0,200,255,0.5);
  }
  .wci-hotel-card:hover .wci-card-footer {
    background: rgba(0,30,50,0.65);
  }

  /* ── Active / press ── */
  .wci-hotel-card:active {
    transform: translateY(-3px) scale(0.975);
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    animation: none;
    transition: transform 0.08s ease, box-shadow 0.08s ease;
  }

  /* ── Selected state ── */
  .wci-hotel-card.selected {
    outline: 2px solid rgba(0,220,255,0.85);
    transform: translateY(-6px) scale(1.01);
    box-shadow:
      0 28px 72px rgba(0,133,174,0.55),
      0 0 0 1px rgba(0,220,255,0.6);
    animation: wci-selected-pulse 0.7s ease-out;
  }
  .wci-hotel-card.selected .wci-card-image {
    transform: scale(1.05);
  }

  /* ── Image ── */
  .wci-card-image {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    object-fit: cover;
    transition: transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94);
  }

  /* ── Arrow ── */
  .wci-card-arrow {
    width: 36px; height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    background: rgba(0,133,174,0.22);
    border: 1px solid rgba(0,133,174,0.45);
    display: flex; align-items: center; justify-content: center;
    transition: background 0.2s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease;
  }

  /* ── Footer ── */
  .wci-card-footer {
    padding: 0.9rem 1.2rem;
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    background: rgba(0,10,20,0.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    transition: background 0.2s ease;
  }

  /* ── Skeleton ── */
  .wci-skeleton {
    border-radius: 24px;
    overflow: hidden;
    background: rgba(255,255,255,0.06);
    outline: 1px solid rgba(255,255,255,0.08);
    animation: wci-pulse 1.6s ease-in-out infinite;
  }

  /* ── Entrance animation via stagger class ── */
  .wci-card-enter {
    animation: wci-enter 0.4s cubic-bezier(0.34,1.2,0.64,1) both;
  }
`;

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="wci-skeleton">
      <div style={{ paddingTop: '58%', background: 'rgba(255,255,255,0.09)' }} />
      <div style={{ padding: '0.9rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ height: 17, width: '55%', borderRadius: 8, background: 'rgba(255,255,255,0.11)' }} />
        <div style={{ height: 12, width: '38%', borderRadius: 8, background: 'rgba(255,255,255,0.07)' }} />
      </div>
    </div>
  );
}

// ── Hotel card ────────────────────────────────────────────────────────────────

function HotelCard({
  hotel, selected, onClick, enterDelay,
}: {
  hotel: WebCheckinHotel;
  selected: boolean;
  onClick: () => void;
  enterDelay: number;
}) {
  const placeholder = `https://placehold.co/800x400/0a2540/4db8d4?text=${encodeURIComponent(hotel.name)}`;

  return (
    <button
      className={`wci-hotel-card wci-card-enter${selected ? ' selected' : ''}`}
      style={{ animationDelay: `${enterDelay}ms` }}
      onClick={onClick}
      aria-label={`Selecionar ${hotel.name}`}
      aria-pressed={selected}
    >
      {/* Imagem hero */}
      <div style={{ position: 'relative', paddingTop: '58%', overflow: 'hidden' }}>
        <img
          className="wci-card-image"
          src={hotel.image_url || placeholder}
          alt={hotel.name}
          loading="lazy"
          onError={e => { (e.target as HTMLImageElement).src = placeholder; }}
        />

        {/* Gradiente de leitura */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(170deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.78) 100%)',
          pointerEvents: 'none',
        }} />

        {/* Badge check-in */}
        <div style={{
          position: 'absolute', top: 13, right: 13,
          background: 'rgba(0,133,174,0.92)',
          backdropFilter: 'blur(10px)',
          borderRadius: 20, padding: '4px 12px',
          fontSize: '0.63rem', fontWeight: 700,
          color: '#fff', letterSpacing: '0.07em',
          textTransform: 'uppercase',
          boxShadow: '0 2px 12px rgba(0,133,174,0.5)',
        }}>
          Check-in Online
        </div>

        {/* Ícone de seleção */}
        {selected && (
          <div style={{
            position: 'absolute', top: 13, left: 13,
            width: 32, height: 32,
            borderRadius: '50%',
            background: 'rgba(0,200,120,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(0,200,120,0.6)',
          }}>
            <Check size={17} color="#fff" strokeWidth={3} />
          </div>
        )}

        {/* Nome sobre a foto */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '1.75rem 1.2rem 0.9rem',
          pointerEvents: 'none',
        }}>
          <h2 style={{
            margin: 0,
            fontSize: 'clamp(1rem, 2.8vw, 1.25rem)',
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1.2,
            textShadow: '0 2px 10px rgba(0,0,0,0.6)',
            letterSpacing: '-0.01em',
          }}>
            {hotel.name}
          </h2>
        </div>
      </div>

      {/* Rodapé */}
      <div className="wci-card-footer">
        <p style={{
          margin: 0,
          fontSize: '0.79rem',
          color: selected ? 'rgba(100,230,255,0.85)' : 'rgba(255,255,255,0.5)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          transition: 'color 0.2s ease',
          flex: 1, minWidth: 0,
        }}>
          <MapPin size={11} style={{ flexShrink: 0, opacity: 0.7 }} />
          {hotel.description || 'Toque para iniciar o check-in'}
        </p>

        <div className="wci-card-arrow">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="rgba(100,210,240,0.9)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round">
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
  const [hotels, setHotels]       = useState<WebCheckinHotel[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetchWebCheckinHotels()
      .then(setHotels)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (hotel: WebCheckinHotel) => {
    setSelectedId(hotel.id);
    // Delay para o usuário ver o feedback de seleção antes de navegar
    setTimeout(() => navigate(`/web-checkin/${hotel.wci_code}/search`), 260);
  };

  return (
    <>
      <style>{CSS}</style>

      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <header style={{ textAlign: 'center', padding: '2rem 1.5rem 1rem', flexShrink: 0 }}>
          <button
            onClick={() => navigate('/web-checkin')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-block', marginBottom: '1rem' }}
            aria-label="Voltar ao início"
          >
            <div style={{
              fontSize: 'clamp(1.5rem, 5vw, 2.1rem)', fontWeight: 900, color: '#fff',
              letterSpacing: '-0.02em', lineHeight: 1,
              textShadow: '0 2px 24px rgba(0,133,174,0.65)',
            }}>
              Meridiana
            </div>
            <div style={{
              fontSize: '0.68rem', color: 'rgba(255,255,255,0.38)',
              letterSpacing: '0.35em', textTransform: 'uppercase', marginTop: '0.2rem',
            }}>
              Hoteles
            </div>
          </button>

          <h1 style={{
            margin: 0,
            fontSize: 'clamp(1.1rem, 3.5vw, 1.5rem)',
            fontWeight: 700, color: '#fff',
            textShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}>
            {t('selectHotel')}
          </h1>
          <p style={{
            margin: '0.4rem 0 0', fontSize: '0.84rem',
            color: 'rgba(255,255,255,0.42)', lineHeight: 1.5,
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
          padding: '0.75rem 1.25rem 2.5rem',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: !loading && hotels.length <= 2 ? 'center' : 'flex-start',
        }}>
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '1rem' }}>
              <SkeletonCard /><SkeletonCard />
            </div>

          ) : error ? (
            <div style={{
              background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.35)',
              borderRadius: 20, padding: '2rem', textAlign: 'center', color: '#fff',
            }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{t('errorGeneral')}</p>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.83rem', opacity: 0.6 }}>{error}</p>
            </div>

          ) : hotels.length === 0 ? (
            <div style={{
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.13)',
              borderRadius: 24, padding: '3rem 2rem', textAlign: 'center', color: '#fff',
            }}>
              <Building2 size={44} style={{ opacity: 0.28, display: 'block', margin: '0 auto 1rem' }} />
              <p style={{ margin: 0, fontWeight: 600 }}>Nenhum hotel disponível</p>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.83rem', color: 'rgba(255,255,255,0.4)' }}>
                Nenhum hotel está disponível para check-in online no momento.
              </p>
            </div>

          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: hotels.length === 1
                ? 'minmax(min(100%, 420px), 480px)'
                : 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
              justifyContent: hotels.length === 1 ? 'center' : 'stretch',
              gap: '1.1rem',
              width: '100%',
            }}>
              {hotels.map((hotel, i) => (
                <HotelCard
                  key={hotel.id}
                  hotel={hotel}
                  selected={selectedId === hotel.id}
                  onClick={() => handleSelect(hotel)}
                  enterDelay={i * 70}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
