// src/pages/webcheckin/WCIHotelSelection.tsx
// Lista de hotéis com config Erbon ativa — cards com imagem, oculta wci_visible=false
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWCI } from './WebCheckinLayout';
import { fetchWebCheckinHotels, WebCheckinHotel } from './webCheckinService';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';

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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 800 }}>

        {/* Header — clicável volta à tela idle */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <button
            onClick={() => navigate('/web-checkin')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-block' }}
          >
            <div style={{ fontSize: 'clamp(1.6rem,5vw,2.4rem)', fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', textShadow: '0 2px 16px rgba(0,133,174,0.5)', lineHeight: 1 }}>
              Meridiana
            </div>
            <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.3em', textTransform: 'uppercase' }}>
              Hoteles
            </div>
          </button>
          <h1 style={{ fontSize: 'clamp(1.3rem,4vw,1.9rem)', fontWeight: 800, color: '#fff', margin: '1rem 0 0', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
            {t('selectHotel')}
          </h1>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '3rem' }}>
            <Loader2 size={40} color="#0085ae" style={{ animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div style={{ background: 'rgba(220,38,38,0.2)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 20, padding: '2rem', textAlign: 'center', color: '#fff' }}>
            <p>{t('errorGeneral')}</p>
            <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>{error}</p>
          </div>
        ) : hotels.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, padding: '2rem', textAlign: 'center', color: '#fff' }}>
            <Building2 size={40} style={{ opacity: 0.4, marginBottom: '1rem' }} />
            <p>Nenhum hotel disponível para check-in online.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '1.25rem' }}>
            {hotels.map(hotel => (
              <div key={hotel.id} style={{ flexBasis: 330, flexGrow: 0, flexShrink: 0, maxWidth: '100%' }}>
                <HotelCard hotel={hotel} onClick={() => navigate(`/web-checkin/${hotel.wci_code}/search`)} />
              </div>
            ))}
          </div>

        )}
      </div>
    </div>
  );
}

function HotelCard({ hotel, onClick }: { hotel: WebCheckinHotel; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const placeholder = `https://placehold.co/600x280/0a2540/4db8d4?text=${encodeURIComponent(hotel.name)}`;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: `1px solid ${hovered ? 'rgba(0,133,174,0.6)' : 'rgba(255,255,255,0.18)'}`,
        boxShadow: hovered ? '0 12px 40px rgba(0,133,174,0.25)' : '0 8px 32px rgba(0,0,0,0.25)',
        borderRadius: 20,
        cursor: 'pointer',
        transition: 'all 0.22s ease',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        overflow: 'hidden',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        color: '#fff',
        width: '100%',
        padding: 0,
      }}
    >
      {/* Imagem */}
      <div style={{ position: 'relative', height: 160, flexShrink: 0, overflow: 'hidden' }}>
        <img
          src={hotel.image_url || placeholder}
          alt={hotel.name}
          onError={e => { (e.target as HTMLImageElement).src = placeholder; }}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease', transform: hovered ? 'scale(1.04)' : 'scale(1)' }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.5) 100%)' }} />
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: 'rgba(0,133,174,0.9)', backdropFilter: 'blur(8px)',
          borderRadius: 20, padding: '3px 10px',
          fontSize: '0.68rem', fontWeight: 700, color: '#fff', letterSpacing: '0.04em',
        }}>
          CHECK-IN ONLINE
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#fff' }}>{hotel.name}</h2>
          {hotel.description && (
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hotel.description}
            </p>
          )}
        </div>
        <ChevronRight size={20} style={{ opacity: 0.55, flexShrink: 0 }} />
      </div>
    </button>
  );
}
