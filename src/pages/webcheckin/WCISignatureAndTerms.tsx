// src/pages/webcheckin/WCISignatureAndTerms.tsx
// Termos LGPD + assinatura digital + finalização do check-in
import React, { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { jsPDF } from 'jspdf';
import { CheckCircle, Loader2, RotateCcw, Home } from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import {
  loadGuestsFromStorage,
  clearGuestsFromStorage,
  submitSignature,
  submitAttachment,
} from './webCheckinService';

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.25)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  borderRadius: 20,
  padding: '2rem',
};

export default function WCISignatureAndTerms() {
  const { hotelId, bookingId } = useParams<{ hotelId: string; bookingId: string }>();
  const navigate = useNavigate();
  const { t } = useWCI();

  const sigRef = useRef<SignatureCanvas>(null);
  const [lgpdAccepted, setLgpdAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const clearSig = () => sigRef.current?.clear();

  const handleFinish = async () => {
    if (!hotelId || !bookingId) return;
    if (!lgpdAccepted) { setError('Aceite os termos para continuar.'); return; }
    if (sigRef.current?.isEmpty()) { setError('Por favor, assine o campo de assinatura.'); return; }

    setSending(true);
    setError('');

    try {
      // 1. Capturar assinatura como PNG base64 (sem prefixo)
      const sigDataURL = sigRef.current!.getTrimmedCanvas().toDataURL('image/png');
      const sigBase64 = sigDataURL.replace(/^data:image\/png;base64,/, '');

      // 2. Gerar PDF simples com lista de hóspedes + assinatura
      const guests = loadGuestsFromStorage(bookingId) || [];
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // Cabeçalho
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Web Check-in — Ficha FNRH', 20, 24);

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Reserva #${bookingId}`, 20, 33);
      pdf.text(`Data: ${new Date().toLocaleDateString('pt-BR')}  ${new Date().toLocaleTimeString('pt-BR')}`, 20, 40);

      // Lista de hóspedes
      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Hóspedes', 20, 54);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);

      let y = 62;
      guests.forEach((g, i) => {
        pdf.text(`${i + 1}. ${g.name}${g.isMainGuest ? ' (Principal)' : ''} — ${g.fnrhCompleted ? '✓ FNRH OK' : 'Pendente'}`, 20, y);
        y += 8;
      });

      // Termos
      y += 6;
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'italic');
      pdf.text('O hóspede declara que as informações prestadas são verdadeiras e consente com o', 20, y);
      y += 5;
      pdf.text('tratamento de dados conforme a LGPD (Lei 13.709/2018).', 20, y);

      // Assinatura
      y += 14;
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Assinatura Digital', 20, y);

      try {
        const sigImg = sigRef.current!.getTrimmedCanvas().toDataURL('image/png');
        pdf.addImage(sigImg, 'PNG', 20, y + 4, 80, 28);
      } catch {
        pdf.text('[Assinatura capturada digitalmente]', 20, y + 10);
      }

      const pdfBase64 = pdf.output('datauristring').replace(/^data:application\/pdf;base64,/, '');

      // 3. Enviar em paralelo (best-effort)
      await Promise.allSettled([
        submitSignature(hotelId, Number(bookingId), sigBase64),
        submitAttachment(hotelId, Number(bookingId), pdfBase64),
      ]);

      // 4. Limpar localStorage desta reserva
      clearGuestsFromStorage(bookingId);

      setDone(true);
      // Auto-reset para tela inicial após 8s
      setTimeout(() => navigate('/web-checkin'), 8000);

    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setSending(false);
    }
  };

  if (done) {
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
        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '1.1rem', maxWidth: 480, lineHeight: 1.6, marginBottom: '2rem' }}>
          {t('successDesc')}
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
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.8rem', marginTop: '1.5rem' }}>
          Retornando automaticamente...
        </p>
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
          <h1 style={{ fontSize: 'clamp(1.2rem,4vw,1.7rem)', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            {t('signatureTitle')}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.65)', margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            {t('signatureDesc')}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Termos */}
          <div style={glassCard}>
            <h3 style={{ color: '#fff', fontWeight: 700, margin: '0 0 1rem', fontSize: '1rem' }}>
              Termos de Uso e Privacidade (LGPD)
            </h3>
            <div style={{
              background: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: '1rem',
              maxHeight: 180, overflowY: 'auto', marginBottom: '1.25rem',
            }}>
              <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.82rem', lineHeight: 1.7, margin: 0 }}>
                O hóspede autoriza o estabelecimento hoteleiro a coletar, armazenar e utilizar os dados
                pessoais fornecidos neste formulário para fins de registro de hospedagem, conforme
                exigência do Ministério do Turismo (Portaria MTur 217/2020) e em conformidade com a
                Lei Geral de Proteção de Dados Pessoais — LGPD (Lei nº 13.709/2018).
                <br /><br />
                Os dados poderão ser compartilhados com autoridades competentes quando exigido por lei.
                O titular tem o direito de acessar, corrigir ou solicitar a exclusão de seus dados a
                qualquer momento, mediante solicitação na recepção do hotel.
                <br /><br />
                A assinatura digital abaixo constitui aceite eletrônico com validade jurídica nos
                termos do Marco Civil da Internet (Lei nº 12.965/2014) e da MP 2.200-2/2001.
              </p>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={lgpdAccepted}
                onChange={e => { setLgpdAccepted(e.target.checked); setError(''); }}
                style={{ width: 20, height: 20, marginTop: 2, cursor: 'pointer', accentColor: '#0085ae' }}
              />
              <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                {t('lgpdAccept')}
              </span>
            </label>
          </div>

          {/* Assinatura */}
          <div style={glassCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ color: '#fff', fontWeight: 700, margin: 0, fontSize: '1rem' }}>
                {t('digitalSignature')}
              </h3>
              <button
                onClick={clearSig}
                style={{
                  background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 8, padding: '0.4rem 0.8rem', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.7)', fontSize: '0.82rem',
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                }}
              >
                <RotateCcw size={14} /> {t('clearSignature')}
              </button>
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.95)', borderRadius: 12, overflow: 'hidden',
              border: '2px solid rgba(255,255,255,0.3)',
            }}>
              <SignatureCanvas
                ref={sigRef}
                penColor="#1a1a2e"
                canvasProps={{
                  style: { width: '100%', height: 180, display: 'block', touchAction: 'none' },
                }}
              />
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', margin: '0.5rem 0 0', textAlign: 'center' }}>
              Assine dentro do campo acima com o dedo ou mouse
            </p>
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '0.75rem 1rem' }}>
              <span style={{ color: '#fca5a5', fontSize: '0.9rem' }}>{error}</span>
            </div>
          )}

          {/* Finish */}
          <button
            onClick={handleFinish}
            disabled={sending || !lgpdAccepted}
            style={{
              padding: '1.1rem', borderRadius: 50, border: 'none',
              cursor: (sending || !lgpdAccepted) ? 'not-allowed' : 'pointer',
              background: (sending || !lgpdAccepted) ? 'rgba(0,133,174,0.4)' : '#0085ae',
              color: '#fff', fontWeight: 700, fontSize: '1.1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              transition: 'all 0.2s',
            }}
          >
            {sending
              ? <><Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /> {t('sending')}</>
              : t('finishCheckin')
            }
          </button>
        </div>

        {/* Back */}
        <button
          onClick={() => navigate(`/web-checkin/${hotelId}/guests/${bookingId}`)}
          style={{ display: 'block', margin: '1.25rem auto 0', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}
        >
          {t('back')}
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
