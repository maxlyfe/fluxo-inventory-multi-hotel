// src/pages/webcheckin/WCIHotelSelection.tsx
// Lista de hotéis com config Erbon ativa, vindos do Supabase
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWCI } from './WebCheckinLayout';
import { fetchWebCheckinHotels, WebCheckinHotel } from './webCheckinService';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';

// Glassmorphism card style
const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.25)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  borderRadius: 20,
  padding: '2rem',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  display: 'flex',
  alignItems: 'center',
  gap: '1.5rem',
  color: '#fff',
  textAlign: 'left',
};

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
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: 700 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <img src="/lyfe_logo.svg" alt="LyFe Hotels"
            style={{ height: 56, marginBottom: '1.5rem', filter: 'brightness(0) invert(1)', opacity: 0.95 }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 2rem)', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
            {t('selectHotel')}
          </h1>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '3rem' }}>
            <Loader2 size={40} color="#0085ae" style={{ animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div style={{ ...glassCard, background: 'rgba(220,38,38,0.2)', cursor: 'default', flexDirection: 'column', textAlign: 'center' }}>
            <p>{t('errorGeneral')}</p>
            <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>{error}</p>
          </div>
        ) : hotels.length === 0 ? (
          <div style={{ ...glassCard, cursor: 'default', flexDirection: 'column', textAlign: 'center' }}>
            <Building2 size={40} style={{ opacity: 0.4, marginBottom: '1rem' }} />
            <p>Nenhum hotel disponível para check-in online.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {hotels.map(hotel => (
              <div
                key={hotel.id}
                style={glassCard}
                onClick={() => navigate(`/web-checkin/${hotel.id}/search`)}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.18)';
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.10)';
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
                }}
                onTouchStart={e => {
                  (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.18)';
                }}
                onTouchEnd={e => {
                  (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.10)';
                }}
              >
                {/* Hotel icon / logo */}
                <div style={{
                  width: 64, height: 64, borderRadius: 16, flexShrink: 0,
                  background: 'rgba(0,133,174,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  {hotel.logo_url ? (
                    <img src={hotel.logo_url} alt={hotel.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <Building2 size={32} color="rgba(0,133,174,0.9)" />
                  )}
                </div>

                {/* Name */}
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>{hotel.name}</h2>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>
                    Check-in online disponível
                  </p>
                </div>

                <ChevronRight size={24} style={{ opacity: 0.6 }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
