// src/pages/webcheckin/WCIRestScreen.tsx
// Tela de espera (idle/attract) — toque para iniciar
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWCI } from './WebCheckinLayout';

export default function WCIRestScreen() {
  const navigate = useNavigate();
  const { t } = useWCI();

  // Toque/click em qualquer lugar → ir para seleção de hotel
  // Guard de 500 ms: evita que o mesmo clique que navegou até esta tela
  // (ex: botão "Meridiana" no top bar) dispare imediatamente o handler.
  useEffect(() => {
    let ready = false;
    const guard = setTimeout(() => { ready = true; }, 500);
    const handler = () => { if (ready) navigate('/web-checkin/hotels'); };
    window.addEventListener('click', handler);
    window.addEventListener('touchstart', handler);
    return () => {
      clearTimeout(guard);
      window.removeEventListener('click', handler);
      window.removeEventListener('touchstart', handler);
    };
  }, [navigate]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '2rem',
      userSelect: 'none',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
        <div style={{
          fontSize: 'clamp(2rem, 6vw, 3.2rem)',
          fontWeight: 900,
          color: '#fff',
          letterSpacing: '-0.02em',
          textShadow: '0 2px 20px rgba(0,133,174,0.6)',
          lineHeight: 1,
        }}>
          Meridiana
        </div>
        <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.3em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
          Hoteles
        </div>
      </div>

      {/* Animated touchpad icon */}
      <div style={{ marginBottom: '2rem' }}>
        <svg width="80" height="80" viewBox="0 0 100 100" style={{ animation: 'wci-pulse 2s ease-in-out infinite' }}>
          <circle cx="50" cy="50" r="40" fill="rgba(0,133,174,0.25)" stroke="rgba(0,133,174,0.8)" strokeWidth="2" />
          <circle cx="50" cy="50" r="25" fill="rgba(0,133,174,0.4)" />
          <circle cx="50" cy="50" r="10" fill="#0085ae" />
        </svg>
      </div>

      <h1 style={{
        fontSize: 'clamp(1.5rem, 5vw, 2.5rem)',
        fontWeight: 800,
        color: '#fff',
        marginBottom: '0.75rem',
        textShadow: '0 2px 12px rgba(0,0,0,0.5)',
        letterSpacing: '-0.02em',
      }}>
        Web Check-in
      </h1>
      <p style={{
        fontSize: 'clamp(1rem, 3vw, 1.4rem)',
        color: 'rgba(255,255,255,0.8)',
        fontWeight: 400,
        animation: 'wci-bounce 1.5s ease-in-out infinite',
      }}>
        {t('tapToStart')}
      </p>

      <style>{`
        @keyframes wci-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
        @keyframes wci-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
