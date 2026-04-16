// src/pages/webcheckin/WCICompanionEntry.tsx
// Fluxo mobile completo para acompanhantes: FNRH → Termos + Assinatura → Sucesso
// Acessado via QR Code pelo celular do hóspede.
// Rota: /web-checkin/:hotelId/companion/:bookingId          (novo acompanhante)
// Rota: /web-checkin/:hotelId/companion/:bookingId/:guestId  (editar/assinar existente)

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { jsPDF } from 'jspdf';
import {
  ClipboardList, PenLine, CheckCircle,
  Loader2, RotateCcw, ChevronRight,
  FileText, Shield, Home,
} from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import {
  loadGuestsFromStorage,
  saveGuestsToStorage,
  saveGuestFNRH,
  submitSignature,
  submitAttachment,
  WebCheckinGuest,
} from './webCheckinService';
import type { ErbonGuestPayload } from '../../lib/erbonService';

// ── Estilos ──────────────────────────────────────────────────────────────────

const glass: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.25)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  borderRadius: 20,
  padding: '1.5rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '0.75rem 1rem', fontSize: '1rem',
  background: 'rgba(255,255,255,0.10)',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: 10, color: '#fff', outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: '0.35rem',
  fontSize: '0.82rem', fontWeight: 600,
  color: 'rgba(255,255,255,0.75)',
};

// ── Termos (replicados aqui para independência do módulo) ─────────────────────

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
Nome completo, data de nascimento, gênero, documento de identidade, e-mail, telefone, endereço, veículo e demais informações fornecidas neste formulário de registro de hóspede (FNRH).

FINALIDADE DO TRATAMENTO
Os dados são coletados exclusivamente para: (a) cumprimento de obrigação legal de registro de hóspedes exigida pela Portaria MTur 217/2020; (b) prestação dos serviços de hospedagem; (c) comunicações relacionadas à estadia.

BASE LEGAL
Obrigação legal (Art. 7º, II), execução de contrato (Art. 7º, V) e legítimo interesse do controlador (Art. 7º, IX) da Lei nº 13.709/2018.

DIREITOS DO TITULAR
O hóspede tem direito a: confirmar a existência de tratamento; acessar, corrigir ou solicitar a exclusão de seus dados; revogar o consentimento. Para exercer esses direitos, dirija-se à recepção do hotel.

VALIDADE DA ASSINATURA DIGITAL
A assinatura digital aposta neste documento tem validade jurídica plena nos termos do Marco Civil da Internet (Lei nº 12.965/2014) e da MP 2.200-2/2001.`;

// ── PDF por hóspede ──────────────────────────────────────────────────────────

async function buildGuestPDF(params: {
  hotelName: string;
  bookingId: string;
  guestName: string;
  guestDoc?: string;
  signatureDataUrl: string;
  signedAt: string;
}): Promise<string> {
  const { hotelName, bookingId, guestName, guestDoc, signatureDataUrl, signedAt } = params;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const mL = 18;
  const cW = pageW - mL - 18;
  let y = 20;

  const write = (text: string, size = 10, bold = false, color: [number,number,number] = [30,30,30]) => {
    pdf.setFontSize(size);
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setTextColor(...color);
    pdf.splitTextToSize(text, cW).forEach((l: string) => {
      if (y > 270) { pdf.addPage(); y = 20; }
      pdf.text(l, mL, y);
      y += size * 0.45;
    });
  };
  const sp = (n = 4) => { y += n; };
  const hr = () => { pdf.setDrawColor(200,200,200); pdf.line(mL, y, 192, y); sp(4); };

  // Cabeçalho
  pdf.setFillColor(0, 133, 174);
  pdf.rect(0, 0, pageW, 14, 'F');
  pdf.setFontSize(13); pdf.setFont('helvetica','bold'); pdf.setTextColor(255,255,255);
  pdf.text(hotelName, mL, 9);
  pdf.setFontSize(9); pdf.setFont('helvetica','normal');
  pdf.text('Ficha de Registro — FNRH', 192, 9, { align: 'right' });
  y = 22;

  write('DADOS DO HÓSPEDE', 11, true, [0,100,140]); sp(2);
  write(`Reserva #${bookingId}  |  ${signedAt}`);
  sp(1); write(guestName, 11, true);
  if (guestDoc) { sp(1); write(`Documento: ${guestDoc}`); }
  sp(4); hr();

  write('REGULAMENTO INTERNO E POLÍTICAS DO HOTEL', 11, true, [0,100,140]); sp(3);
  HOTEL_TERMS.split('\n').forEach(l => {
    if (/^\d+\./.test(l)) { sp(2); write(l, 9, true); }
    else if (l.trim()) write(l, 8.5, false, [60,60,60]);
  });
  sp(4); hr();

  write('POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS (LGPD)', 11, true, [0,100,140]); sp(3);
  LGPD_TERMS.split('\n').forEach(l => {
    if (/^[A-ZÁÉÍÓÚ]{3,}/.test(l) && l.length < 60) { sp(2); write(l, 9, true); }
    else if (l.trim()) write(l, 8.5, false, [60,60,60]);
  });
  sp(6); hr();

  write('DECLARAÇÃO E ASSINATURA DIGITAL', 11, true, [0,100,140]); sp(3);
  write(
    `Eu, ${guestName}, declaro que li, compreendi e aceito integralmente o Regulamento Interno ` +
    `do hotel e a Política de Privacidade (LGPD) acima, e que todas as informações prestadas ` +
    `são verdadeiras. Assino digitalmente em ${signedAt}.`,
    9
  );
  sp(8);

  write('Assinatura Digital', 10, true);
  sp(3);
  if (y > 230) { pdf.addPage(); y = 20; }
  try {
    pdf.addImage(signatureDataUrl, 'PNG', mL, y, 80, 32);
    pdf.setDrawColor(160,160,160);
    pdf.line(mL, y + 34, mL + 80, y + 34);
    pdf.setFontSize(8); pdf.setFont('helvetica','normal'); pdf.setTextColor(120,120,120);
    pdf.text(guestName, mL, y + 38);
    pdf.text(signedAt, mL, y + 42);
  } catch {
    write('[Assinatura digital registrada eletronicamente]', 9, false, [100,100,100]);
  }

  const total = (pdf as any).internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFontSize(7.5); pdf.setFont('helvetica','normal'); pdf.setTextColor(160,160,160);
    pdf.text(`${hotelName} — Documento gerado eletronicamente em ${signedAt} — Página ${i}/${total}`, pageW / 2, 290, { align: 'center' });
  }

  return pdf.output('datauristring').replace(/^data:application\/pdf;base64,/, '');
}

// ── Componente principal ─────────────────────────────────────────────────────

type Step = 'fnrh' | 'signature' | 'done';

const COUNTRIES = [
  { code: 'BR', label: '🇧🇷 Brasileiro(a)' }, { code: 'AR', label: '🇦🇷 Argentino(a)' },
  { code: 'UY', label: '🇺🇾 Uruguaio(a)' },  { code: 'PY', label: '🇵🇾 Paraguaio(a)' },
  { code: 'CL', label: '🇨🇱 Chileno(a)' },   { code: 'BO', label: '🇧🇴 Boliviano(a)' },
  { code: 'PE', label: '🇵🇪 Peruano(a)' },   { code: 'CO', label: '🇨🇴 Colombiano(a)' },
  { code: 'VE', label: '🇻🇪 Venezuelano(a)' },{ code: 'US', label: '🇺🇸 Americano(a)' },
  { code: 'DE', label: '🇩🇪 Alemão/ã' },     { code: 'FR', label: '🇫🇷 Francês/esa' },
  { code: 'IT', label: '🇮🇹 Italiano(a)' },  { code: 'ES', label: '🇪🇸 Espanhol(a)' },
  { code: 'PT', label: '🇵🇹 Português(a)' }, { code: 'GB', label: '🇬🇧 Britânico(a)' },
  { code: 'OTHER', label: 'Outro' },
];

const COUNTRY_FLAGS = [
  { code: 'BR', label: '🇧🇷 Brasil (BR)' }, { code: 'AR', label: '🇦🇷 Argentina (AR)' },
  { code: 'UY', label: '🇺🇾 Uruguay (UY)' },{ code: 'PY', label: '🇵🇾 Paraguay (PY)' },
  { code: 'CL', label: '🇨🇱 Chile (CL)' },  { code: 'BO', label: '🇧🇴 Bolivia (BO)' },
  { code: 'PE', label: '🇵🇪 Peru (PE)' },   { code: 'CO', label: '🇨🇴 Colombia (CO)' },
  { code: 'VE', label: '🇻🇪 Venezuela (VE)' },{ code: 'US', label: '🇺🇸 United States (US)' },
  { code: 'DE', label: '🇩🇪 Germany (DE)' },{ code: 'FR', label: '🇫🇷 France (FR)' },
  { code: 'IT', label: '🇮🇹 Italy (IT)' },  { code: 'ES', label: '🇪🇸 Spain (ES)' },
  { code: 'PT', label: '🇵🇹 Portugal (PT)' },{ code: 'GB', label: '🇬🇧 United Kingdom (GB)' },
  { code: 'OTHER', label: 'Outro' },
];

export default function WCICompanionEntry() {
  const { hotelId, bookingId, guestId: guestIdParam } = useParams<{
    hotelId: string; bookingId: string; guestId?: string;
  }>();
  const navigate = useNavigate();
  const { t } = useWCI();
  const sigRef = useRef<SignatureCanvas>(null);

  const isNew = !guestIdParam || guestIdParam === '0';
  const existingGuestId = isNew ? null : Number(guestIdParam);

  const [step, setStep] = useState<Step>('fnrh');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedGuestId, setSavedGuestId] = useState<number | null>(existingGuestId);
  const [activeTab, setActiveTab] = useState<'hotel' | 'lgpd'>('hotel');
  const [hotelAccepted, setHotelAccepted] = useState(false);
  const [lgpdAccepted, setLgpdAccepted] = useState(false);

  // FNRH fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [genderID, setGenderID] = useState(0);
  const [nationality, setNationality] = useState('BR');
  const [profession, setProfession] = useState('');
  const [vehicleRegistration, setVehicleRegistration] = useState('');
  const [documentType, setDocumentType] = useState('CPF');
  const [documentNumber, setDocumentNumber] = useState('');
  const [country, setCountry] = useState('BR');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [neighborhood, setNeighborhood] = useState('');

  // Pre-fill se editando hóspede existente
  useEffect(() => {
    if (!bookingId || isNew) return;
    const stored = loadGuestsFromStorage(bookingId);
    if (!stored) return;
    const g = stored.find(x => x.id === existingGuestId);
    if (!g) return;
    setName(g.name || '');
    setEmail(g.email || '');
    setPhone(g.phone || '');
    if (g.documents?.length) {
      setDocumentType(g.documents[0].documentType || 'CPF');
      setDocumentNumber(g.documents[0].number || '');
    }
    // Se a FNRH já está completa, pular direto para assinatura
    if (g.fnrhCompleted) setStep('signature');
  }, [bookingId, isNew, existingGuestId]);

  // ── Passo 1: Salvar FNRH ──────────────────────────────────────────────────

  const handleSaveFNRH = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotelId || !bookingId) return;
    if (!name.trim()) { setError('Nome completo é obrigatório.'); return; }
    if (!email.trim()) { setError('E-mail é obrigatório.'); return; }
    if (!documentNumber.trim()) { setError('Número do documento é obrigatório.'); return; }

    setSaving(true);
    setError('');
    try {
      const payload: ErbonGuestPayload = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        birthDate: birthDate || undefined,
        genderID: genderID || undefined,
        nationality: nationality || 'BR',
        profession: profession || undefined,
        vehicleRegistration: vehicleRegistration || undefined,
        documents: documentNumber.trim() ? [{
          documentType, number: documentNumber.trim(), country: country || 'BR',
        }] : [],
        address: {
          country: country || 'BR',
          state: state || undefined, city: city || undefined,
          street: street || undefined, zipcode: zipcode || undefined,
          neighborhood: neighborhood || undefined,
        },
      };

      const newId = await saveGuestFNRH(hotelId, Number(bookingId), existingGuestId, payload);
      setSavedGuestId(newId);

      // Atualizar localStorage para o totem ver também
      const stored = loadGuestsFromStorage(bookingId) || [];
      if (isNew) {
        const newGuest: WebCheckinGuest = {
          id: newId, name: name.trim(), email: email.trim(), phone: phone.trim(),
          documents: payload.documents, fnrhCompleted: true, isMainGuest: false,
        };
        saveGuestsToStorage(bookingId, [...stored, newGuest]);
      } else {
        saveGuestsToStorage(bookingId, stored.map(g =>
          g.id === existingGuestId
            ? { ...g, name: name.trim(), email: email.trim(), phone: phone.trim(), fnrhCompleted: true }
            : g
        ));
      }

      setStep('signature');
    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setSaving(false);
    }
  };

  // ── Passo 2: Enviar assinatura ────────────────────────────────────────────

  const handleSign = async () => {
    if (!hotelAccepted || !lgpdAccepted) { setError('Aceite os dois termos para prosseguir.'); return; }
    if (sigRef.current?.isEmpty()) { setError('Por favor, assine no campo de assinatura.'); return; }
    if (!hotelId || !bookingId) return;

    setSaving(true);
    setError('');
    try {
      const sigDataUrl = sigRef.current!.getTrimmedCanvas().toDataURL('image/png');
      const signedAt = new Date().toLocaleString('pt-BR');

      const stored = loadGuestsFromStorage(bookingId) || [];
      const guest = savedGuestId ? stored.find(g => g.id === savedGuestId) : null;
      const guestDoc = guest?.documents?.[0]
        ? `${guest.documents[0].documentType} — ${guest.documents[0].number}`
        : undefined;

      const pdfBase64 = await buildGuestPDF({
        hotelName: 'Meridiana Hoteles',
        bookingId: bookingId!,
        guestName: name || guest?.name || 'Hóspede',
        guestDoc,
        signatureDataUrl: sigDataUrl,
        signedAt,
      });

      const sigBase64 = sigDataUrl.replace(/^data:image\/png;base64,/, '');

      await Promise.allSettled([
        submitAttachment(hotelId, Number(bookingId), pdfBase64),
        submitSignature(hotelId, Number(bookingId), sigBase64),
      ]);

      setStep('done');
    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setSaving(false);
    }
  };

  // ── Tela de sucesso ──────────────────────────────────────────────────────

  if (step === 'done') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '2rem',
      }}>
        <CheckCircle size={72} color="#22c55e" style={{ marginBottom: '1.25rem' }} />
        <h1 style={{ fontSize: 'clamp(1.4rem,5vw,2rem)', fontWeight: 800, color: '#fff', marginBottom: '0.75rem' }}>
          {t('successTitle')}
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1rem', maxWidth: 400, lineHeight: 1.6, marginBottom: '2rem' }}>
          Sua ficha foi registrada e assinada com sucesso. Dirija-se à recepção para concluir o check-in.
        </p>
        <button
          onClick={() => navigate('/web-checkin')}
          style={{
            padding: '0.875rem 2rem', borderRadius: 50, border: 'none', cursor: 'pointer',
            background: '#0085ae', color: '#fff', fontWeight: 700, fontSize: '1rem',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}
        >
          <Home size={18} /> Voltar ao Início
        </button>
      </div>
    );
  }

  // ── FNRH ─────────────────────────────────────────────────────────────────

  if (step === 'fnrh') {
    return (
      <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem' }}>
        <div style={{ width: '100%', maxWidth: 680 }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <ClipboardList size={38} color="#0085ae" style={{ marginBottom: '0.6rem' }} />
            <h1 style={{ fontSize: 'clamp(1.1rem,3.5vw,1.5rem)', fontWeight: 800, color: '#fff', margin: 0 }}>
              {isNew ? 'Cadastro de Acompanhante' : 'Atualizar Dados'}
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.83rem', margin: '0.4rem 0 0' }}>
              {t('fillFNRHTitle')}
            </p>
          </div>

          <div style={glass}>
            <form onSubmit={handleSaveFNRH} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* Dados pessoais */}
              <p style={{ margin: 0, fontWeight: 700, color: 'rgba(255,255,255,0.8)', fontSize: '0.88rem', borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: '0.4rem' }}>
                Dados Pessoais
              </p>

              <div>
                <label style={labelStyle}>{t('nameField')}</label>
                <input style={inputStyle} type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo" required autoFocus />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>{t('emailField')}</label>
                  <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@..." required />
                </div>
                <div>
                  <label style={labelStyle}>{t('phoneField')}</label>
                  <input style={inputStyle} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+55..." />
                </div>
                <div>
                  <label style={labelStyle}>{t('birthField')}</label>
                  <input style={inputStyle} type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>{t('genderField')}</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={genderID} onChange={e => setGenderID(Number(e.target.value))}>
                    <option value={0} style={{ color: '#000' }}>—</option>
                    <option value={1} style={{ color: '#000' }}>{t('male')}</option>
                    <option value={2} style={{ color: '#000' }}>{t('female')}</option>
                    <option value={3} style={{ color: '#000' }}>{t('other')}</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t('nationalityField')}</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={nationality} onChange={e => setNationality(e.target.value)}>
                    {COUNTRIES.map(c => <option key={c.code} value={c.code} style={{ color: '#000' }}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t('professionField')}</label>
                  <input style={inputStyle} type="text" value={profession} onChange={e => setProfession(e.target.value)} placeholder="Opcional" />
                </div>
              </div>

              <div>
                <label style={labelStyle}>{t('vehicleField')}</label>
                <input style={inputStyle} type="text" value={vehicleRegistration} onChange={e => setVehicleRegistration(e.target.value.toUpperCase())} placeholder="ABC-1234 (opcional)" />
              </div>

              {/* Documento */}
              <p style={{ margin: '0.5rem 0 0', fontWeight: 700, color: 'rgba(255,255,255,0.8)', fontSize: '0.88rem', borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: '0.4rem' }}>
                Documento de Identidade
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>{t('documentTypeField')}</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={documentType} onChange={e => setDocumentType(e.target.value)}>
                    <option value="CPF" style={{ color: '#000' }}>{t('cpf')}</option>
                    <option value="RG" style={{ color: '#000' }}>{t('rg')}</option>
                    <option value="PASSPORT" style={{ color: '#000' }}>{t('passport')}</option>
                    <option value="CNH" style={{ color: '#000' }}>{t('cnh')}</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t('documentField')}</label>
                  <input style={inputStyle} type="text" value={documentNumber} onChange={e => setDocumentNumber(e.target.value)} placeholder="000.000.000-00" required />
                </div>
              </div>

              {/* Endereço */}
              <p style={{ margin: '0.5rem 0 0', fontWeight: 700, color: 'rgba(255,255,255,0.8)', fontSize: '0.88rem', borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: '0.4rem' }}>
                {t('addressSection')}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>{t('countryField')}</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={country} onChange={e => setCountry(e.target.value)}>
                    {COUNTRY_FLAGS.map(c => <option key={c.code} value={c.code} style={{ color: '#000' }}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t('zipcodeField')}</label>
                  <input style={inputStyle} type="text" value={zipcode} onChange={e => setZipcode(e.target.value)} placeholder="00000-000" />
                </div>
                <div>
                  <label style={labelStyle}>{t('stateField')}</label>
                  <input style={inputStyle} type="text" value={state} onChange={e => setState(e.target.value)} placeholder="RJ" />
                </div>
                <div>
                  <label style={labelStyle}>{t('cityField')}</label>
                  <input style={inputStyle} type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="Cidade" />
                </div>
                <div>
                  <label style={labelStyle}>{t('neighborhoodField')}</label>
                  <input style={inputStyle} type="text" value={neighborhood} onChange={e => setNeighborhood(e.target.value)} placeholder="Bairro" />
                </div>
                <div>
                  <label style={labelStyle}>{t('streetField')}</label>
                  <input style={inputStyle} type="text" value={street} onChange={e => setStreet(e.target.value)} placeholder="Rua, número" />
                </div>
              </div>

              {error && (
                <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '0.75rem 1rem' }}>
                  <span style={{ color: '#fca5a5', fontSize: '0.88rem' }}>{error}</span>
                </div>
              )}

              <button
                type="submit" disabled={saving}
                style={{
                  padding: '1rem', borderRadius: 50, border: 'none',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  background: saving ? 'rgba(0,133,174,0.5)' : '#0085ae',
                  color: '#fff', fontWeight: 700, fontSize: '1rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                }}
              >
                {saving
                  ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> {t('saving')}</>
                  : <>{t('saveData')} <ChevronRight size={18} /></>
                }
              </button>
            </form>
          </div>
        </div>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          input::placeholder { color: rgba(255,255,255,0.3); }
          input:focus, select:focus { border-color: #0085ae !important; }
        `}</style>
      </div>
    );
  }

  // ── Assinatura ───────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 680 }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <PenLine size={38} color="#0085ae" style={{ marginBottom: '0.6rem' }} />
          <h1 style={{ fontSize: 'clamp(1.1rem,3.5vw,1.5rem)', fontWeight: 800, color: '#fff', margin: 0 }}>
            {t('signatureTitle')}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.83rem', margin: '0.4rem 0 0' }}>
            {name && <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{name} — </strong>}
            {t('signatureDesc')}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Tabs termos */}
          <div style={glass}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              {([
                { key: 'hotel', icon: <FileText size={14} />, label: 'Regulamento' },
                { key: 'lgpd',  icon: <Shield size={14} />,   label: 'LGPD' },
              ] as const).map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                  flex: 1, padding: '0.55rem', borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: activeTab === tab.key ? '#0085ae' : 'rgba(255,255,255,0.1)',
                  color: activeTab === tab.key ? '#fff' : 'rgba(255,255,255,0.6)',
                  fontWeight: activeTab === tab.key ? 700 : 400, fontSize: '0.8rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                  transition: 'all 0.2s',
                }}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            <div style={{
              background: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: '0.875rem',
              maxHeight: 200, overflowY: 'auto', fontSize: '0.77rem',
              lineHeight: 1.75, color: 'rgba(255,255,255,0.72)', whiteSpace: 'pre-wrap',
            }}>
              {activeTab === 'hotel' ? HOTEL_TERMS : LGPD_TERMS}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '1.1rem' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={hotelAccepted}
                  onChange={e => { setHotelAccepted(e.target.checked); setError(''); }}
                  style={{ width: 20, height: 20, marginTop: 2, cursor: 'pointer', accentColor: '#0085ae', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.86rem', lineHeight: 1.5 }}>
                  Li e aceito o <strong>Regulamento Interno e as Políticas do Hotel</strong>.
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={lgpdAccepted}
                  onChange={e => { setLgpdAccepted(e.target.checked); setError(''); }}
                  style={{ width: 20, height: 20, marginTop: 2, cursor: 'pointer', accentColor: '#0085ae', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.86rem', lineHeight: 1.5 }}>
                  Li e autorizo o tratamento dos meus dados conforme a <strong>LGPD</strong>.
                </span>
              </label>
            </div>
          </div>

          {/* Canvas de assinatura */}
          <div style={glass}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h3 style={{ color: '#fff', fontWeight: 700, margin: 0, fontSize: '0.95rem' }}>
                {t('digitalSignature')}
              </h3>
              <button onClick={() => sigRef.current?.clear()} style={{
                background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 8, padding: '0.35rem 0.7rem', cursor: 'pointer',
                color: 'rgba(255,255,255,0.65)', fontSize: '0.78rem',
                display: 'flex', alignItems: 'center', gap: '0.3rem',
              }}>
                <RotateCcw size={12} /> {t('clearSignature')}
              </button>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.97)', borderRadius: 12, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.3)' }}>
              <SignatureCanvas
                ref={sigRef} penColor="#1a1a2e"
                canvasProps={{ style: { width: '100%', height: 160, display: 'block', touchAction: 'none' } }}
              />
            </div>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.73rem', margin: '0.4rem 0 0', textAlign: 'center' }}>
              Assine com o dedo ou mouse
            </p>
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '0.75rem 1rem' }}>
              <span style={{ color: '#fca5a5', fontSize: '0.86rem' }}>{error}</span>
            </div>
          )}

          <button
            onClick={handleSign}
            disabled={saving || !hotelAccepted || !lgpdAccepted}
            style={{
              padding: '1rem', borderRadius: 50, border: 'none',
              cursor: (saving || !hotelAccepted || !lgpdAccepted) ? 'not-allowed' : 'pointer',
              background: (saving || !hotelAccepted || !lgpdAccepted) ? 'rgba(0,133,174,0.35)' : '#0085ae',
              color: '#fff', fontWeight: 700, fontSize: '1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}
          >
            {saving
              ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> {t('sending')}</>
              : t('finishCheckin')
            }
          </button>

          {/* Voltar para FNRH */}
          <button onClick={() => { setStep('fnrh'); setError(''); setHotelAccepted(false); setLgpdAccepted(false); }}
            style={{ display: 'block', margin: '0 auto', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline' }}>
            ← Corrigir dados
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
