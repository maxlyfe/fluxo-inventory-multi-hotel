// src/pages/webcheckin/WCISignatureAndTerms.tsx
// Termos do hotel + LGPD + assinatura digital individual por hóspede
// Gera PDF por hóspede (políticas + termos LGPD + assinatura PNG) e envia ao Erbon
import React, { useRef, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { jsPDF } from 'jspdf';
import {
  CheckCircle, Loader2, RotateCcw, Home,
  FileText, Shield, PenLine, ChevronRight, Users,
} from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import {
  loadGuestsFromStorage,
  clearGuestsFromStorage,
  submitSignature,
  submitAttachment,
  WebCheckinGuest,
} from './webCheckinService';

// ── Estilos ──────────────────────────────────────────────────────────────────

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.25)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  borderRadius: 20,
  padding: '1.75rem',
};

// ── Textos de termos (português) ─────────────────────────────────────────────

const HOTEL_TERMS = `REGULAMENTO INTERNO E POLÍTICAS DO HOTEL

1. CHECK-IN E CHECK-OUT
O horário de check-in é a partir das 14h00 e o check-out até as 12h00. Check-in antecipado ou late check-out estão sujeitos à disponibilidade e podem gerar cobrança adicional.

2. RESPONSABILIDADE POR DANOS
O hóspede é responsável por quaisquer danos causados às instalações, móveis, equipamentos e utensílios do hotel durante o período de hospedagem. Os danos serão avaliados e cobrados no ato do check-out.

3. SILÊNCIO E CONVIVÊNCIA
O horário de silêncio é entre 22h00 e 08h00. São proibidos barulhos excessivos, festas ou reuniões que perturbem os demais hóspedes. O descumprimento poderá resultar no encerramento imediato da hospedagem sem direito a reembolso.

4. TABAGISMO
É estritamente proibido fumar nas áreas internas do hotel, incluindo quartos, corredores e áreas comuns cobertas. O descumprimento sujeita o hóspede a multa conforme legislação vigente (Lei nº 12.546/2011).

5. ANIMAIS DE ESTIMAÇÃO
A entrada de animais de estimação é permitida somente nas acomodações indicadas como pet-friendly, mediante declaração prévia e taxa adicional. O hóspede é integralmente responsável pelos danos ou incidentes causados pelo animal.

6. SEGURANÇA
Não é permitida a entrada de pessoas não hospedadas nas acomodações sem autorização prévia da recepção. O hotel não se responsabiliza por objetos de valor deixados fora do cofre disponibilizado no quarto.

7. ESTACIONAMENTO
O hotel não se responsabiliza por danos, furtos ou roubos de veículos e/ou objetos deixados no estacionamento.

8. CANCELAMENTO E REEMBOLSO
As políticas de cancelamento e reembolso são informadas no momento da reserva e fazem parte integrante do contrato de hospedagem.`;

const LGPD_TERMS = `POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS (LGPD)

Em conformidade com a Lei Geral de Proteção de Dados Pessoais — LGPD (Lei nº 13.709/2018), informamos:

DADOS COLETADOS
Nome completo, data de nascimento, gênero, documento de identidade, e-mail, telefone, endereço, veículo e demais informações fornecidas neste formulário de registro de hóspede (FNRH — Ficha Nacional de Registro de Hóspedes).

FINALIDADE DO TRATAMENTO
Os dados são coletados exclusivamente para: (a) cumprimento de obrigação legal de registro de hóspedes exigida pela Portaria MTur 217/2020; (b) prestação dos serviços de hospedagem; (c) comunicações relacionadas à estadia; (d) segurança das instalações.

BASE LEGAL
Obrigação legal (Art. 7º, II), execução de contrato (Art. 7º, V) e legítimo interesse do controlador (Art. 7º, IX) da Lei nº 13.709/2018.

COMPARTILHAMENTO
Os dados poderão ser compartilhados com autoridades públicas competentes quando exigido por lei ou ordem judicial. Não comercializamos dados pessoais de hóspedes.

ARMAZENAMENTO E SEGURANÇA
Os dados são armazenados em ambiente seguro com acesso restrito, pelo prazo mínimo de 5 (cinco) anos conforme legislação hoteleira aplicável.

DIREITOS DO TITULAR
O hóspede tem direito a: confirmar a existência de tratamento; acessar, corrigir ou solicitar a exclusão de seus dados; revogar o consentimento; e solicitar portabilidade. Para exercer esses direitos, dirija-se à recepção do hotel ou envie e-mail ao encarregado de dados.

VALIDADE DA ASSINATURA DIGITAL
A assinatura digital aposta neste documento tem validade jurídica plena nos termos do Marco Civil da Internet (Lei nº 12.965/2014) e da MP 2.200-2/2001, constituindo aceite eletrônico dos termos acima.`;

// ── Geração do PDF por hóspede ───────────────────────────────────────────────

async function generateGuestPDF(params: {
  hotelName: string;
  bookingId: string;
  guest: WebCheckinGuest;
  signatureDataUrl: string;
  signedAt: string;
}): Promise<string> {
  const { hotelName, bookingId, guest, signatureDataUrl, signedAt } = params;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = 210;
  const marginL = 18;
  const marginR = 18;
  const contentW = pageW - marginL - marginR;
  let y = 20;

  const addText = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; align?: 'left' | 'center' | 'right' } = {}
  ) => {
    const { size = 10, bold = false, color = [30, 30, 30], align = 'left' } = opts;
    pdf.setFontSize(size);
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(text, contentW);
    lines.forEach((line: string) => {
      if (y > 270) { pdf.addPage(); y = 20; }
      const x = align === 'center' ? pageW / 2 : align === 'right' ? pageW - marginR : marginL;
      pdf.text(line, x, y, { align });
      y += size * 0.45;
    });
  };

  const addSpacer = (mm = 5) => { y += mm; };
  const addLine = () => {
    pdf.setDrawColor(200, 200, 200);
    pdf.line(marginL, y, pageW - marginR, y);
    addSpacer(4);
  };

  // ── Cabeçalho ──
  pdf.setFillColor(0, 133, 174);
  pdf.rect(0, 0, pageW, 14, 'F');
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  pdf.text(hotelName, marginL, 9);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Ficha Nacional de Registro de Hóspedes — FNRH', pageW - marginR, 9, { align: 'right' });
  y = 22;

  // ── Identificação ──
  addText('DADOS DA HOSPEDAGEM', { size: 11, bold: true, color: [0, 100, 140] });
  addSpacer(2);
  addText(`Reserva #${bookingId}  |  Data/Hora: ${signedAt}`);
  addSpacer(2);
  addText(`Hóspede: ${guest.name}${guest.isMainGuest ? ' — TITULAR DA RESERVA' : ''}`, { bold: true });
  if (guest.documents?.length) {
    addText(`Documento: ${guest.documents[0].documentType} — ${guest.documents[0].number}`);
  }
  if (guest.email) addText(`E-mail: ${guest.email}`);
  if (guest.phone) addText(`Telefone: ${guest.phone}`);
  addSpacer(4);
  addLine();

  // ── Regulamento do Hotel ──
  addText('REGULAMENTO INTERNO E POLÍTICAS DO HOTEL', { size: 11, bold: true, color: [0, 100, 140] });
  addSpacer(3);
  HOTEL_TERMS.split('\n').forEach(line => {
    if (line.match(/^\d+\./)) {
      addSpacer(2);
      addText(line, { bold: true, size: 9 });
    } else if (line.trim()) {
      addText(line, { size: 8.5, color: [60, 60, 60] });
    }
  });
  addSpacer(4);
  addLine();

  // ── LGPD ──
  addText('POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS (LGPD)', { size: 11, bold: true, color: [0, 100, 140] });
  addSpacer(3);
  LGPD_TERMS.split('\n').forEach(line => {
    if (line.match(/^[A-ZÁÉÍÓÚ]{2,}/)) {
      addSpacer(2);
      addText(line, { bold: true, size: 9 });
    } else if (line.trim()) {
      addText(line, { size: 8.5, color: [60, 60, 60] });
    }
  });
  addSpacer(6);
  addLine();

  // ── Declaração de aceite ──
  addText('DECLARAÇÃO DO HÓSPEDE', { size: 11, bold: true, color: [0, 100, 140] });
  addSpacer(3);
  addText(
    `Eu, ${guest.name}, declaro que li, compreendi e aceito integralmente o Regulamento ` +
    `Interno do hotel e a Política de Privacidade (LGPD) acima, e que todas as informações ` +
    `prestadas nesta ficha são verdadeiras. Assino digitalmente em ${signedAt}.`,
    { size: 9 }
  );
  addSpacer(8);

  // ── Assinatura ──
  addText('ASSINATURA DIGITAL DO HÓSPEDE', { size: 10, bold: true });
  addSpacer(3);

  if (y > 230) { pdf.addPage(); y = 20; }

  try {
    pdf.addImage(signatureDataUrl, 'PNG', marginL, y, 80, 32);
    pdf.setDrawColor(150, 150, 150);
    pdf.line(marginL, y + 34, marginL + 80, y + 34);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(120, 120, 120);
    pdf.text(guest.name, marginL, y + 38);
    pdf.text(signedAt, marginL, y + 42);
  } catch {
    addText('[Assinatura digital registrada eletronicamente]', { size: 9, color: [100, 100, 100] });
    addText(signedAt, { size: 8, color: [130, 130, 130] });
  }

  // ── Rodapé ──
  const totalPages = (pdf as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(7.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(160, 160, 160);
    pdf.text(`${hotelName} — Documento gerado eletronicamente em ${signedAt} — Página ${i}/${totalPages}`, pageW / 2, 290, { align: 'center' });
  }

  return pdf.output('datauristring').replace(/^data:application\/pdf;base64,/, '');
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function WCISignatureAndTerms() {
  const { hotelId, bookingId } = useParams<{ hotelId: string; bookingId: string }>();
  const navigate = useNavigate();
  const { t } = useWCI();

  const sigRef = useRef<SignatureCanvas>(null);

  const [guests, setGuests] = useState<WebCheckinGuest[]>([]);
  const [step, setStep] = useState(0);              // índice do hóspede atual
  const [hotelAccepted, setHotelAccepted] = useState(false);
  const [lgpdAccepted, setLgpdAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [collectedSigs, setCollectedSigs] = useState<string[]>([]);  // dataURL por hóspede
  const [activeTab, setActiveTab] = useState<'hotel' | 'lgpd'>('hotel');

  // Derivados
  const currentGuest = guests[step];
  const isLastGuest = step === guests.length - 1;
  const hotelName = 'Meridiana Hoteles';

  useEffect(() => {
    if (!bookingId) return;
    const stored = loadGuestsFromStorage(bookingId);
    // Mostrar apenas hóspedes com FNRH preenchida
    const completed = (stored || []).filter(g => g.fnrhCompleted);
    if (completed.length === 0) {
      navigate(`/web-checkin/${hotelId}/guests/${bookingId}`);
      return;
    }
    setGuests(completed);
  }, [bookingId, hotelId, navigate]);

  const clearSig = () => sigRef.current?.clear();

  const handleConfirmGuest = async () => {
    if (!hotelAccepted || !lgpdAccepted) {
      setError('Aceite os dois termos para prosseguir.');
      return;
    }
    if (sigRef.current?.isEmpty()) {
      setError('Por favor, assine no campo de assinatura.');
      return;
    }
    setError('');

    const sigDataUrl = sigRef.current!.getTrimmedCanvas().toDataURL('image/png');
    const updatedSigs = [...collectedSigs, sigDataUrl];
    setCollectedSigs(updatedSigs);

    if (!isLastGuest) {
      // Próximo hóspede — resetar estado
      setStep(s => s + 1);
      setHotelAccepted(false);
      setLgpdAccepted(false);
      setActiveTab('hotel');
      setTimeout(() => sigRef.current?.clear(), 50);
    } else {
      // Último hóspede → finalizar
      await finalize(updatedSigs);
    }
  };

  const finalize = async (allSigs: string[]) => {
    if (!hotelId || !bookingId) return;
    setSending(true);
    setError('');

    try {
      const now = new Date();
      const signedAt = now.toLocaleString('pt-BR');

      // Gerar e enviar PDF de cada hóspede
      for (let i = 0; i < guests.length; i++) {
        const guest = guests[i];
        const sigDataUrl = allSigs[i];

        const pdfBase64 = await generateGuestPDF({
          hotelName,
          bookingId: bookingId!,
          guest,
          signatureDataUrl: sigDataUrl,
          signedAt,
        });

        await submitAttachment(hotelId, Number(bookingId), pdfBase64);
      }

      // Enviar PNG da assinatura do hóspede principal (best-effort)
      const mainSig = allSigs[0].replace(/^data:image\/png;base64,/, '');
      await submitSignature(hotelId, Number(bookingId), mainSig).catch(() => {});

      // Limpar localStorage da reserva
      clearGuestsFromStorage(bookingId!);

      setDone(true);
      setTimeout(() => navigate('/web-checkin'), 10000);

    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setSending(false);
    }
  };

  // ── Tela de sucesso ──────────────────────────────────────────────────────
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
        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '1.05rem', maxWidth: 480, lineHeight: 1.7, marginBottom: '0.5rem' }}>
          {t('successDesc')}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: '2rem' }}>
          {guests.length} ficha{guests.length !== 1 ? 's' : ''} enviada{guests.length !== 1 ? 's' : ''} com assinatura digital.
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
          Retornando automaticamente em instantes...
        </p>
      </div>
    );
  }

  if (!currentGuest) return null;

  // ── Formulário por hóspede ────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: 'calc(100vh - 70px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: 720 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <PenLine size={38} color="#0085ae" style={{ marginBottom: '0.75rem' }} />
          <h1 style={{ fontSize: 'clamp(1.1rem,3.5vw,1.6rem)', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            {t('signatureTitle')}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.55)', margin: '0.4rem 0 0', fontSize: '0.85rem' }}>
            {t('signatureDesc')}
          </p>
        </div>

        {/* Progresso por hóspede */}
        {guests.length > 1 && (
          <div style={{ ...glassCard, marginBottom: '1rem', padding: '1rem 1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <Users size={16} color="rgba(255,255,255,0.6)" />
              {guests.map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: i < step ? '#22c55e' : i === step ? '#0085ae' : 'rgba(255,255,255,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.72rem', fontWeight: 700, color: '#fff',
                    flexShrink: 0,
                  }}>
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: '0.8rem', color: i === step ? '#fff' : 'rgba(255,255,255,0.5)', fontWeight: i === step ? 600 : 400 }}>
                    {g.name.split(' ')[0]}
                  </span>
                  {i < guests.length - 1 && <ChevronRight size={14} color="rgba(255,255,255,0.3)" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Card do hóspede atual */}
        <div style={{ ...glassCard, marginBottom: '1rem', background: 'rgba(0,133,174,0.18)', border: '1px solid rgba(0,133,174,0.4)', padding: '1rem 1.5rem' }}>
          <p style={{ margin: 0, color: '#7dd3ee', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Assinando como
          </p>
          <p style={{ margin: '0.2rem 0 0', color: '#fff', fontWeight: 700, fontSize: '1.05rem' }}>
            {currentGuest.name}
            {currentGuest.isMainGuest && <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', background: 'rgba(0,133,174,0.5)', borderRadius: 6, padding: '2px 8px' }}>Principal</span>}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Tabs de termos */}
          <div style={glassCard}>
            {/* Tab buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              {([
                { key: 'hotel', icon: <FileText size={15} />, label: 'Regulamento do Hotel' },
                { key: 'lgpd',  icon: <Shield size={15} />,   label: 'LGPD / Privacidade' },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    flex: 1, padding: '0.6rem', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: activeTab === tab.key ? '#0085ae' : 'rgba(255,255,255,0.1)',
                    color: activeTab === tab.key ? '#fff' : 'rgba(255,255,255,0.6)',
                    fontWeight: activeTab === tab.key ? 700 : 400,
                    fontSize: '0.82rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                    transition: 'all 0.2s',
                  }}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* Texto dos termos */}
            <div style={{
              background: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: '1rem',
              maxHeight: 220, overflowY: 'auto',
              fontSize: '0.78rem', lineHeight: 1.75,
              color: 'rgba(255,255,255,0.75)',
              whiteSpace: 'pre-wrap',
            }}>
              {activeTab === 'hotel' ? HOTEL_TERMS : LGPD_TERMS}
            </div>

            {/* Checkboxes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={hotelAccepted}
                  onChange={e => { setHotelAccepted(e.target.checked); setError(''); }}
                  style={{ width: 20, height: 20, marginTop: 2, cursor: 'pointer', accentColor: '#0085ae', flexShrink: 0 }}
                />
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.88rem', lineHeight: 1.5 }}>
                  Li e aceito o <strong>Regulamento Interno e as Políticas do Hotel</strong>, comprometendo-me a respeitá-los durante minha estadia.
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={lgpdAccepted}
                  onChange={e => { setLgpdAccepted(e.target.checked); setError(''); }}
                  style={{ width: 20, height: 20, marginTop: 2, cursor: 'pointer', accentColor: '#0085ae', flexShrink: 0 }}
                />
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.88rem', lineHeight: 1.5 }}>
                  Li e autorizo o tratamento dos meus dados pessoais conforme a <strong>Política de Privacidade (LGPD)</strong>, Lei nº 13.709/2018.
                </span>
              </label>
            </div>
          </div>

          {/* Assinatura digital */}
          <div style={glassCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h3 style={{ color: '#fff', fontWeight: 700, margin: 0, fontSize: '0.95rem' }}>
                {t('digitalSignature')}
              </h3>
              <button
                onClick={clearSig}
                style={{
                  background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: 8, padding: '0.35rem 0.75rem', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.65)', fontSize: '0.8rem',
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                }}
              >
                <RotateCcw size={13} /> {t('clearSignature')}
              </button>
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.97)', borderRadius: 12,
              border: '2px solid rgba(255,255,255,0.35)',
              overflow: 'hidden',
            }}>
              <SignatureCanvas
                ref={sigRef}
                penColor="#1a1a2e"
                canvasProps={{
                  style: { width: '100%', height: 170, display: 'block', touchAction: 'none' },
                }}
              />
            </div>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', margin: '0.4rem 0 0', textAlign: 'center' }}>
              Assine com o dedo ou mouse
            </p>
          </div>

          {/* Erro */}
          {error && (
            <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '0.75rem 1rem' }}>
              <span style={{ color: '#fca5a5', fontSize: '0.88rem' }}>{error}</span>
            </div>
          )}

          {/* Botão de confirmação */}
          <button
            onClick={handleConfirmGuest}
            disabled={sending || !hotelAccepted || !lgpdAccepted}
            style={{
              padding: '1.1rem', borderRadius: 50, border: 'none',
              cursor: (sending || !hotelAccepted || !lgpdAccepted) ? 'not-allowed' : 'pointer',
              background: (sending || !hotelAccepted || !lgpdAccepted) ? 'rgba(0,133,174,0.35)' : '#0085ae',
              color: '#fff', fontWeight: 700, fontSize: '1.05rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              transition: 'all 0.2s',
            }}
          >
            {sending ? (
              <><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> {t('sending')}</>
            ) : isLastGuest ? (
              t('finishCheckin')
            ) : (
              <>Confirmar e Próximo Hóspede <ChevronRight size={18} /></>
            )}
          </button>
        </div>

        {/* Voltar */}
        <button
          onClick={() => navigate(`/web-checkin/${hotelId}/guests/${bookingId}`)}
          style={{ display: 'block', margin: '1.25rem auto 0', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}
        >
          {t('back')}
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
