// src/pages/webcheckin/WCICompanionEntry.tsx
// Fluxo mobile completo: FNRH → Upload docs → Termos + Assinatura → Sucesso
// :hotelId  = wci_code opaco   :bookingId = session token opaco
// Rota: /web-checkin/:hotelId/companion/:bookingId           (novo acompanhante)
// Rota: /web-checkin/:hotelId/companion/:bookingId/:guestId  (editar/assinar)

import React, { useEffect, useRef, useState } from 'react';

function AutoReturn({ delay, to, navigate }: { delay: number; to: string; navigate: (p: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => navigate(to), delay);
    return () => clearTimeout(t);
  }, [delay, to, navigate]);
  return null;
}

import { useNavigate, useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import {
  ClipboardList, PenLine, CheckCircle,
  Loader2, RotateCcw, ChevronRight,
  FileText, Shield, Home,
  Camera, Upload, X as XIcon, ImagePlus,
} from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import {
  resolveHotelByCode,
  resolveSession,
  fetchHotelPolicies,
  loadGuestsFromStorage,
  loadGuestsFromServer,
  saveGuestsToStorage,
  saveGuestFNRH,
  fetchFreshBookingGuests,
  submitSignature,
  submitAttachment,
  saveFichaToDatabase,
  uploadBase64ToStorage,
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

// ── Termos ────────────────────────────────────────────────────────────────────

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

// ── Geração de documentos como JPEG via html2canvas ──────────────────────────

interface DocParams {
  hotelName: string;
  documentTitle: string;
  documentSubtitle: string;
  content: string;
  declaration: string;
  guestName: string;
  guestDoc?: string;
  bookingRef: string;
  signatureDataUrl: string;
  signedAt: string;
}

async function buildDocumentJpeg(p: DocParams): Promise<string> {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'left:-9999px', 'top:0',
    'width:794px', 'background:#fff',
    'font-family:Arial,Helvetica,sans-serif',
    'font-size:13px', 'color:#222', 'line-height:1.65',
  ].join(';');

  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  el.innerHTML = `
    <div style="background:#0085ae;padding:14px 28px;display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#fff;font-size:16px;font-weight:bold;">${esc(p.hotelName)}</span>
      <span style="color:rgba(255,255,255,.85);font-size:11px;">${esc(p.documentSubtitle)}</span>
    </div>
    <div style="padding:28px 36px;">
      <h2 style="color:#006688;font-size:14px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.04em;">${esc(p.documentTitle)}</h2>
      <p style="color:#888;font-size:11px;margin:0 0 16px;">
        Hóspede: <strong>${esc(p.guestName)}</strong>${p.guestDoc ? ` &nbsp;|&nbsp; ${esc(p.guestDoc)}` : ''}
        ${p.bookingRef ? `&nbsp;|&nbsp; Reserva: ${esc(p.bookingRef)}` : ''}
      </p>
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:0 0 18px;">
      <div style="font-size:12px;color:#333;line-height:1.75;">${esc(p.content)}</div>
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:22px 0 16px;">
      <h3 style="color:#006688;font-size:12px;text-transform:uppercase;margin:0 0 10px;letter-spacing:.04em;">Declaração de Aceite</h3>
      <p style="font-size:12px;color:#333;line-height:1.7;margin:0 0 22px;">${esc(p.declaration)}</p>
      <h3 style="color:#006688;font-size:12px;text-transform:uppercase;margin:0 0 12px;letter-spacing:.04em;">Assinatura Digital</h3>
      <img src="${p.signatureDataUrl}" style="max-width:300px;height:100px;border:1px solid #eee;background:#fff;display:block;object-fit:contain;" crossorigin="anonymous">
      <div style="width:300px;border-top:1px solid #999;margin-top:8px;padding-top:6px;">
        <p style="font-size:11px;color:#555;margin:0;">${esc(p.guestName)}</p>
        <p style="font-size:11px;color:#555;margin:3px 0 0;">${esc(p.signedAt)}</p>
      </div>
    </div>
    <div style="padding:10px 28px;background:#f7f7f7;border-top:1px solid #e8e8e8;">
      <p style="font-size:10px;color:#bbb;margin:0;text-align:center;">
        ${esc(p.hotelName)} — Documento eletrônico gerado em ${esc(p.signedAt)}
      </p>
    </div>
  `;

  document.body.appendChild(el);
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(el, {
      scale: 1.5, useCORS: true, allowTaint: true,
      backgroundColor: '#ffffff', logging: false,
    });
    return canvas.toDataURL('image/jpeg', 0.88).replace(/^data:image\/jpeg;base64,/, '');
  } finally {
    document.body.removeChild(el);
  }
}

function buildHotelRulesJpeg(
  p: Omit<DocParams, 'documentTitle' | 'documentSubtitle' | 'content' | 'declaration'>,
  customContent?: string
): Promise<string> {
  return buildDocumentJpeg({
    ...p,
    documentTitle: 'Regulamento Interno e Políticas do Hotel',
    documentSubtitle: 'Regulamento Interno',
    content: customContent || HOTEL_TERMS,
    declaration: `Eu, ${p.guestName}, declaro que li, compreendi e aceito integralmente o presente Regulamento Interno do hotel acima transcrito. Data e hora: ${p.signedAt}.`,
  });
}

function buildLGPDJpeg(
  p: Omit<DocParams, 'documentTitle' | 'documentSubtitle' | 'content' | 'declaration'>,
  customContent?: string
): Promise<string> {
  return buildDocumentJpeg({
    ...p,
    documentTitle: 'Política de Privacidade e Proteção de Dados (LGPD)',
    documentSubtitle: 'Política LGPD — Lei nº 13.709/2018',
    content: customContent || LGPD_TERMS,
    declaration: `Eu, ${p.guestName}, declaro que fui informado(a) sobre o tratamento dos meus dados pessoais conforme a Lei nº 13.709/2018 (LGPD) e consinto com a coleta e uso das informações descritas neste documento exclusivamente para os fins de hospedagem. Data e hora: ${p.signedAt}.`,
  });
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Step = 'fnrh' | 'documents' | 'signature' | 'done';
type QueueStatus = 'pending' | 'sending' | 'done' | 'error';
interface QueueItem { label: string; status: QueueStatus; detail?: string }

function SendQueue({ items }: { items: QueueItem[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{
      background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 14, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem',
    }}>
      <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', fontWeight: 600, letterSpacing: '0.05em' }}>
        FILA DE ENVIO
      </p>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.1rem', width: 22, textAlign: 'center' }}>
            {item.status === 'pending' ? '⏳' : item.status === 'sending' ? '🔄' : item.status === 'done' ? '✅' : '❌'}
          </span>
          <div style={{ flex: 1 }}>
            <span style={{
              fontSize: '0.88rem', fontWeight: 600,
              color: item.status === 'done' ? '#4ade80' : item.status === 'error' ? '#f87171' : item.status === 'sending' ? '#7dd3ee' : 'rgba(255,255,255,0.55)',
            }}>
              {item.label}
            </span>
            {item.detail && (
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginLeft: '0.5rem' }}>
                {item.detail}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

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

// ── Helper: calcula idade ─────────────────────────────────────────────────────

function calcAge(birthDateStr: string): number | null {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function WCICompanionEntry() {
  // URL params: wciCode e sessionToken são opacos (não expõem IDs reais)
  const { hotelId: wciCode, bookingId: sessionToken, guestId: guestIdParam } = useParams<{
    hotelId: string; bookingId: string; guestId?: string;
  }>();
  const navigate = useNavigate();
  const { t, lang } = useWCI();
  const sigRef = useRef<SignatureCanvas>(null);

  const isNew = !guestIdParam || guestIdParam === '0';
  const existingGuestId = isNew ? null : Number(guestIdParam);

  // IDs reais (resolvidos a partir dos tokens)
  const [realHotelId, setRealHotelId]     = useState<string | null>(null);
  const [realBookingId, setRealBookingId] = useState<number | null>(null);
  const [hasErbon, setHasErbon]           = useState(false);
  const [resolving, setResolving]         = useState(true);

  // Políticas do hotel por idioma — 6 variantes (PT/EN/ES × regulamento/LGPD)
  const [policies, setPolicies] = useState<{
    hotel: { pt: string | null; en: string | null; es: string | null };
    lgpd:  { pt: string | null; en: string | null; es: string | null };
  }>({ hotel: { pt: null, en: null, es: null }, lgpd: { pt: null, en: null, es: null } });

  const [step, setStep]           = useState<Step>('fnrh');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [savedGuestId, setSavedGuestId] = useState<number | null>(existingGuestId);
  const [sendQueue, setSendQueue] = useState<QueueItem[]>([]);
  const [activeTab, setActiveTab] = useState<'hotel' | 'lgpd'>('hotel');
  const [docUploads, setDocUploads] = useState<Array<{ preview: string; base64: string; name: string }>>([]);
  const [docUploading, setDocUploading] = useState(false);
  const [hotelAccepted, setHotelAccepted] = useState(false);
  const [lgpdAccepted, setLgpdAccepted]   = useState(false);

  // FNRH fields
  const [name, setName]                     = useState('');
  const [email, setEmail]                   = useState('');
  const [phone, setPhone]                   = useState('');
  const [birthDate, setBirthDate]           = useState('');
  const [genderID, setGenderID]             = useState(0);
  const [nationality, setNationality]       = useState('BR');
  const [profession, setProfession]         = useState('');
  const [vehicleRegistration, setVehicleRegistration] = useState('');
  const [documentType, setDocumentType]     = useState('CPF');
  const [documentNumber, setDocumentNumber] = useState('');
  const [country, setCountry]               = useState('BR');
  const [state, setState]                   = useState('');
  const [city, setCity]                     = useState('');
  const [street, setStreet]                 = useState('');
  const [zipcode, setZipcode]               = useState('');
  const [neighborhood, setNeighborhood]     = useState('');
  const [cepLoading, setCepLoading]         = useState(false);
  const [birthDateDisplay, setBirthDateDisplay] = useState(''); // DD/MM/AAAA

  // ── Campos FNRH Gov ───────────────────────────────────────────────────────
  const [racaId,             setRacaId]            = useState('NAOINFORMAR');
  const [deficienciaId,      setDeficienciaId]      = useState('NAO');
  const [tipoDeficienciaId,  setTipoDeficienciaId]  = useState('');
  const [motivoViagemId,     setMotivoViagemId]     = useState('LAZER_FERIAS');
  const [meioTransporteId,   setMeioTransporteId]   = useState('AUTOMOVEL');
  // Menor de idade
  const [grauParentescoId,     setGrauParentescoId]     = useState('');
  const [responsavelGuestId,   setResponsavelGuestId]   = useState('');
  const [responsavelDocumento, setResponsavelDocumento] = useState('');
  const [responsavelDocTipo,   setResponsavelDocTipo]   = useState('CPF');
  const [adultGuests,          setAdultGuests]          = useState<WebCheckinGuest[]>([]);

  // isMinor é derivado em tempo real da birthDate
  const isMinorGuest = calcAge(birthDate) !== null && (calcAge(birthDate) as number) < 18;

  // ── Máscara de data DD/MM/AAAA ────────────────────────────────────────────
  const handleDateInput = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) formatted = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
    else if (digits.length > 2) formatted = `${digits.slice(0,2)}/${digits.slice(2)}`;
    setBirthDateDisplay(formatted);
    if (digits.length === 8) {
      const d = digits.slice(0,2), m = digits.slice(2,4), y = digits.slice(4,8);
      setBirthDate(`${y}-${m}-${d}`);
    } else {
      setBirthDate('');
    }
  };

  // Converte YYYY-MM-DD → DD/MM/AAAA para exibição
  const isoToDisplay = (iso: string) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  // ── Busca automática de endereço por CEP (ViaCEP) ────────────────────────
  const lookupCep = async (digits: string) => {
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.erro) return; // CEP inválido — não sobrescreve nada
      if (data.logradouro) setStreet(data.logradouro);
      if (data.bairro)     setNeighborhood(data.bairro);
      if (data.localidade) setCity(data.localidade);
      if (data.uf)         { setState(data.uf); setCountry('BR'); }
    } catch { /* usuário preenche manualmente */ }
    finally  { setCepLoading(false); }
  };

  const handleZipcodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    const formatted = digits.length > 5 ? `${digits.slice(0,5)}-${digits.slice(5)}` : digits;
    setZipcode(formatted);
    if (digits.length === 8) lookupCep(digits);
  };

  const handleZipcodeBlur = () => {
    // Dispara lookup ao perder foco (útil quando usuário cola o CEP inteiro)
    const digits = zipcode.replace(/\D/g, '');
    if (digits.length === 8) lookupCep(digits);
  };

  // Auto-preenche documento do responsável ao selecionar hóspede adulto da reserva
  const handleResponsavelGuestSelect = (guestIdStr: string) => {
    setResponsavelGuestId(guestIdStr);
    if (!guestIdStr) { setResponsavelDocumento(''); return; }
    const g = adultGuests.find(ag => String(ag.id) === guestIdStr);
    if (g?.documents?.length) {
      setResponsavelDocumento(g.documents[0].number || '');
      setResponsavelDocTipo(g.documents[0].documentType === 'PASSPORT' ? 'PASSAPORTE' : 'CPF');
    }
  };

  // ── Resolver tokens + pré-carregar dados (efeito único) ──────────────────
  // O formulário só aparece quando tokens E dados do hóspede estão prontos,
  // evitando o flash de formulário vazio.
  useEffect(() => {
    if (!wciCode || !sessionToken) return;

    const init = async () => {
      const [hotel, session] = await Promise.all([
        resolveHotelByCode(wciCode),
        resolveSession(sessionToken),
      ]);

      if (hotel) {
        setRealHotelId(hotel.id);
        setHasErbon(hotel.hasErbon);
        // Carregar políticas em paralelo (não bloqueia o formulário)
        fetchHotelPolicies(hotel.id).then(p => {
          setPolicies({
            hotel: { pt: p.wci_hotel_terms, en: p.wci_hotel_terms_en, es: p.wci_hotel_terms_es },
            lgpd:  { pt: p.wci_lgpd_terms,  en: p.wci_lgpd_terms_en,  es: p.wci_lgpd_terms_es  },
          });
        }).catch(() => { /* usa defaults hardcoded */ });
      }

      if (session) {
        setRealBookingId(session.bookingId);

        // Pré-preencher campos se estiver editando um hóspede existente
        // (feito ANTES de setResolving(false) → formulário já aparece preenchido)
        if (!isNew && existingGuestId && hotel) {
          // 1. Dados frescos da Erbon (inclui nationality, birthDate, address via in-house)
          const fresh = await fetchFreshBookingGuests(hotel.id, session.bookingId);
          let g: WebCheckinGuest | undefined = fresh?.find(x => x.id === existingGuestId);

          // 2. Fallback: cache Supabase / localStorage
          if (!g) {
            const stored = await loadGuestsFromServer(session.bookingId)
              || loadGuestsFromStorage(session.bookingId);
            g = stored?.find(x => x.id === existingGuestId);
          }

          if (g) {
            setName(g.name || '');
            setEmail(g.email || '');
            setPhone(g.phone || '');

            // Documento
            if (g.documents?.length) {
              setDocumentType(g.documents[0].documentType || 'CPF');
              setDocumentNumber(g.documents[0].number || '');
            }

            // Perfil completo (da Erbon in-house ou payload raw)
            if (g.nationality) setNationality(g.nationality);
            if (g.birthDate)   { setBirthDate(g.birthDate); setBirthDateDisplay(isoToDisplay(g.birthDate)); }
            if (g.genderID)    setGenderID(g.genderID);

            // Endereço
            if (g.address) {
              if (g.address.country)      setCountry(g.address.country);
              if (g.address.state)        setState(g.address.state);
              if (g.address.city)         setCity(g.address.city);
              if (g.address.street)       setStreet(g.address.street);
              if (g.address.zipcode)      setZipcode(g.address.zipcode);
              if (g.address.neighborhood) setNeighborhood(g.address.neighborhood);
            }

            if (g.fnrhCompleted) setStep('signature');

            // Pré-preenche campos FNRH se já preenchidos
            if (g.fnrh_extra) {
              if (g.fnrh_extra.raca_id)              setRacaId(g.fnrh_extra.raca_id);
              if (g.fnrh_extra.deficiencia_id)       setDeficienciaId(g.fnrh_extra.deficiencia_id);
              if (g.fnrh_extra.tipo_deficiencia_id)  setTipoDeficienciaId(g.fnrh_extra.tipo_deficiencia_id);
              if (g.fnrh_extra.motivo_viagem_id)     setMotivoViagemId(g.fnrh_extra.motivo_viagem_id);
              if (g.fnrh_extra.meio_transporte_id)   setMeioTransporteId(g.fnrh_extra.meio_transporte_id);
              if (g.fnrh_extra.grau_parentesco_id)   setGrauParentescoId(g.fnrh_extra.grau_parentesco_id);
              if (g.fnrh_extra.responsavel_documento) setResponsavelDocumento(g.fnrh_extra.responsavel_documento);
              if (g.fnrh_extra.responsavel_doc_tipo)  setResponsavelDocTipo(g.fnrh_extra.responsavel_doc_tipo);
            }
          }
        }
      }

      // Carrega hóspedes adultos para dropdown de responsável de menor
      if (session) {
        const allG = session.guests || [];
        const adults = allG.filter((g: WebCheckinGuest) => {
          if (!g.birthDate) return true;
          const age = calcAge(g.birthDate);
          return age === null || age >= 18;
        }).filter((g: WebCheckinGuest) => g.id !== existingGuestId);
        setAdultGuests(adults);
      }

      setResolving(false); // formulário aparece apenas aqui (já preenchido)
    };

    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wciCode, sessionToken]);

  // Termos ativos no idioma selecionado (fallback PT → constante hardcoded)
  const activeHotelTerms = (
    lang === 'en' ? policies.hotel.en :
    lang === 'es' ? policies.hotel.es :
    policies.hotel.pt
  ) ?? HOTEL_TERMS;

  const activeLgpdTerms = (
    lang === 'en' ? policies.lgpd.en :
    lang === 'es' ? policies.lgpd.es :
    policies.lgpd.pt
  ) ?? LGPD_TERMS;

  // ── Passo 1: Salvar FNRH ─────────────────────────────────────────────────

  const handleSaveFNRH = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!realHotelId || !realBookingId) return;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const domName = ((fd.get('name') as string) || name).trim();
    if (!domName)               { setError('Nome completo é obrigatório.'); return; }
    if (!email.trim())          { setError('E-mail é obrigatório.'); return; }
    if (!documentNumber.trim()) { setError('Número do documento é obrigatório.'); return; }

    // Validação de menor de idade
    if (isMinorGuest) {
      if (!grauParentescoId) {
        setError(t('errorMinorRelationship'));
        return;
      }
      if (!responsavelDocumento.trim()) {
        setError(t('errorMinorDocument'));
        return;
      }
    }

    setSaving(true);
    setError('');
    try {
      const payload: ErbonGuestPayload = {
        id: existingGuestId ?? 0,
        name: domName,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        birthDate: birthDate || undefined,
        genderID: genderID || undefined,
        nationality: nationality || undefined,
        profession: profession.trim() || undefined,
        vehicleRegistration: vehicleRegistration.trim() || undefined,
        documents: documentNumber.trim() ? [{ documentType, number: documentNumber.trim(), country: country || 'BR' }] : [],
        address: {
          country: country || 'BR',
          state:        state        || undefined,
          city:         city         || undefined,
          street:       street       || undefined,
          zipcode:      zipcode      || undefined,
          neighborhood: neighborhood || undefined,
        },
      };

      let newId: number;
      if (hasErbon && realBookingId) {
        newId = await saveGuestFNRH(realHotelId, realBookingId, existingGuestId, payload);
      } else {
        newId = existingGuestId && existingGuestId > 0 ? existingGuestId : (savedGuestId ?? 0);
      }
      setSavedGuestId(newId);

      // Monta fnrh_extra para persistir na sessão
      const fnrhExtra: WebCheckinGuest['fnrh_extra'] = {
        raca_id:               racaId,
        deficiencia_id:        deficienciaId,
        tipo_deficiencia_id:   deficienciaId === 'SIM' ? tipoDeficienciaId : undefined,
        motivo_viagem_id:      motivoViagemId,
        meio_transporte_id:    meioTransporteId,
        grau_parentesco_id:    isMinorGuest ? grauParentescoId   || undefined : undefined,
        responsavel_documento: isMinorGuest ? responsavelDocumento.replace(/[\.\-\/\s]/g, '') || undefined : undefined,
        responsavel_doc_tipo:  isMinorGuest ? responsavelDocTipo  || undefined : undefined,
      };

      const stored = (await loadGuestsFromServer(realBookingId)) || loadGuestsFromStorage(realBookingId) || [];
      if (isNew) {
        const newGuest: WebCheckinGuest = {
          id: newId, name: domName, email: email.trim(), phone: phone.trim(),
          documents: payload.documents, fnrhCompleted: true, isMainGuest: false,
          birthDate: birthDate || undefined,
          genderID: genderID || undefined,
          nationality: nationality || undefined,
          address: payload.address,
          fnrh_extra: fnrhExtra,
        };
        await saveGuestsToStorage(realBookingId, [...stored, newGuest], realHotelId);
      } else {
        await saveGuestsToStorage(realBookingId, stored.map(g =>
          g.id === existingGuestId
            ? { ...g, id: newId, name: domName, email: email.trim(), phone: phone.trim(),
                birthDate: birthDate || g.birthDate,
                genderID: genderID || g.genderID,
                nationality: nationality || g.nationality,
                address: payload.address,
                fnrhCompleted: true, fnrh_extra: fnrhExtra }
            : g
        ), realHotelId);
      }

      setStep('documents');
    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setSaving(false);
    }
  };

  // ── Passo 3: Assinatura + envio de documentos ─────────────────────────────

  const handleSign = async () => {
    if (!hotelAccepted || !lgpdAccepted) { setError('Aceite os dois termos para prosseguir.'); return; }
    if (sigRef.current?.isEmpty())       { setError('Por favor, assine no campo de assinatura.'); return; }
    if (!realHotelId || !realBookingId)  return;

    setSaving(true);
    setError('');

    const hasDocUploads = docUploads.length > 0;
    const queue: QueueItem[] = [
      { label: '✍️  Assinatura digital',            status: 'sending' },
      { label: '📋 Regulamento do Hotel',            status: 'pending' },
      { label: '🔒 Política de Privacidade (LGPD)', status: 'pending' },
      ...(hasDocUploads ? [{ label: `📎 Documentos (${docUploads.length})`, status: 'pending' as QueueStatus }] : []),
    ];
    setSendQueue([...queue]);

    const upd = (idx: number, status: QueueStatus, detail?: string) => {
      queue[idx] = { ...queue[idx], status, detail };
      setSendQueue([...queue]);
    };

    try {
      const sigDataUrl = sigRef.current!.getTrimmedCanvas().toDataURL('image/png');
      const signedAt   = new Date().toLocaleString('pt-BR');
      const sigBase64  = sigDataUrl.replace(/^data:image\/png;base64,/, '');

      const stored    = loadGuestsFromStorage(realBookingId) || [];
      const guest     = savedGuestId ? stored.find(g => g.id === savedGuestId) : null;
      const guestDoc  = guest?.documents?.[0]
        ? `${guest.documents[0].documentType} — ${guest.documents[0].number}`
        : undefined;
      const guestName = name || guest?.name || 'Hóspede';
      const safeName  = guestName.replace(/[^a-zA-Z0-9]/g, '_');
      const ts        = Date.now();

      const docBase = {
        hotelName: 'Meridiana Hoteles',
        bookingRef: '',    // não expõe ID real na URL; omite do documento
        guestName,
        guestDoc,
        signatureDataUrl: sigDataUrl,
        signedAt,
      };

      // URLs dos documentos assinados (para salvar no banco)
      let hotelRulesDocUrl: string | undefined;
      let lgpdDocUrl: string | undefined;
      let docFrontUrl: string | undefined;
      let docBackUrl: string | undefined;

      // ── 1. Assinatura PNG ──────────────────────────────────────────────────
      upd(0, 'sending');
      if (hasErbon && realBookingId) {
        try {
          await submitSignature(realHotelId, realBookingId, sigBase64, savedGuestId ?? undefined);
          upd(0, 'done', 'OK');
        } catch {
          upd(0, 'error', 'não foi possível salvar');
        }
      } else {
        upd(0, 'done', 'salvo');
      }

      // ── 2. Regulamento do Hotel (JPEG) ────────────────────────────────────
      upd(1, 'sending', 'gerando imagem...');
      try {
        const jpegB64 = await buildHotelRulesJpeg(docBase, activeHotelTerms);
        upd(1, 'sending', 'salvando...');
        const storageUpload = uploadBase64ToStorage(jpegB64, realHotelId, `regulamento_${safeName}_${ts}.jpg`);
        if (hasErbon && realBookingId) {
          const [storageUrl] = await Promise.all([
            storageUpload,
            submitAttachment(realHotelId, realBookingId, jpegB64, `Regulamento_${safeName}_${ts}.jpg`, 'image/jpeg'),
          ]);
          if (storageUrl) hotelRulesDocUrl = storageUrl;
        } else {
          const storageUrl = await storageUpload;
          if (storageUrl) hotelRulesDocUrl = storageUrl;
        }
        upd(1, 'done', 'salvo');
      } catch {
        upd(1, 'error', 'erro ao gerar');
      }

      // ── 3. LGPD (JPEG) ────────────────────────────────────────────────────
      upd(2, 'sending', 'gerando imagem...');
      try {
        const jpegB64 = await buildLGPDJpeg(docBase, activeLgpdTerms);
        upd(2, 'sending', 'salvando...');
        const storageUpload = uploadBase64ToStorage(jpegB64, realHotelId, `lgpd_${safeName}_${ts}.jpg`);
        if (hasErbon && realBookingId) {
          const [storageUrl] = await Promise.all([
            storageUpload,
            submitAttachment(realHotelId, realBookingId, jpegB64, `LGPD_${safeName}_${ts}.jpg`, 'image/jpeg'),
          ]);
          if (storageUrl) lgpdDocUrl = storageUrl;
        } else {
          const storageUrl = await storageUpload;
          if (storageUrl) lgpdDocUrl = storageUrl;
        }
        upd(2, 'done', 'salvo');
      } catch {
        upd(2, 'error', 'erro ao gerar');
      }

      // ── 4. Documentos de identificação ────────────────────────────────────
      if (hasDocUploads) {
        const docIdx = 3;
        upd(docIdx, 'sending', 'salvando...');
        let docsSaved = 0;
        for (let i = 0; i < docUploads.length; i++) {
          const doc = docUploads[i];
          upd(docIdx, 'sending', `${i + 1}/${docUploads.length}...`);
          const docFileName = `doc_${safeName}_${ts}_${i + 1}.jpg`;
          const storageUpload = uploadBase64ToStorage(doc.base64, realHotelId, docFileName);
          let storageUrl: string | null = null;
          if (hasErbon && realBookingId) {
            [storageUrl] = await Promise.all([
              storageUpload,
              submitAttachment(realHotelId, realBookingId, doc.base64, docFileName, 'image/jpeg'),
            ]);
          } else {
            storageUrl = await storageUpload;
          }
          if (storageUrl) {
            if (i === 0) docFrontUrl = storageUrl;
            else if (i === 1) docBackUrl = storageUrl;
            docsSaved++;
          }
        }
        upd(docIdx, docsSaved > 0 ? 'done' : 'error', `${docsSaved}/${docUploads.length} salvo(s)`);
      }

      // ── 5. Salvar ficha no banco de dados (Supabase) ─────────────────────
      try {
        const session = await resolveSession(sessionToken!).catch(() => null);
        const allGuests = session?.guests?.length
          ? session.guests
          : (loadGuestsFromStorage(realBookingId) || []);

        // Dados completos do hóspede atual (do formulário, não da sessão que é incompleta)
        const currentGuestData = {
          isMainGuest:    !existingGuestId,
          erbonGuestId:   savedGuestId,
          name:           name.trim(),
          email:          email.trim() || undefined,
          phone:          phone.trim() || undefined,
          documentType,
          documentNumber: documentNumber.trim() || undefined,
          birthDate:      birthDate || undefined,
          genderId:       genderID || undefined,
          nationality:    nationality || undefined,
          profession:     profession.trim() || undefined,
          vehicleRegistration: vehicleRegistration.trim() || undefined,
          addressCountry: country   || undefined,
          addressState:   state     || undefined,
          addressCity:    city      || undefined,
          addressStreet:  street    || undefined,
          addressZipcode: zipcode   || undefined,
          addressNeighborhood: neighborhood || undefined,
          documentFrontUrl: docFrontUrl,
          documentBackUrl:  docBackUrl,
          // Campos FNRH Gov
          fnrhRacaId:            racaId,
          fnrhDeficienciaId:     deficienciaId,
          fnrhTipoDeficienciaId: deficienciaId === 'SIM' ? tipoDeficienciaId : undefined,
          fnrhMotivoViagemId:    motivoViagemId,
          fnrhMeioTransporteId:  meioTransporteId,
          fnrhGrauParentescoId:    isMinorGuest ? grauParentescoId                                        || undefined : undefined,
          fnrhResponsavelDocumento: isMinorGuest ? responsavelDocumento.replace(/[\.\-\/\s]/g, '') || undefined : undefined,
          fnrhResponsavelDocTipo:   isMinorGuest ? responsavelDocTipo                                     || undefined : undefined,
        };

        // Monta lista: outros hóspedes da sessão + hóspede atual com dados completos
        const othersForDb = allGuests
          .filter(g => g.id !== savedGuestId)
          .map(g => ({
            isMainGuest:    g.isMainGuest,
            erbonGuestId:   typeof g.id === 'number' && g.id > 0 ? g.id : null,
            name:           g.name,
            email:          g.email,
            phone:          g.phone,
            documentType:   g.documents?.[0]?.documentType,
            documentNumber: g.documents?.[0]?.number,
            birthDate:      g.birthDate,
            genderId:       g.genderID,
            nationality:    g.nationality,
            addressCountry: g.address?.country,
            addressState:   g.address?.state,
            addressCity:    g.address?.city,
            addressStreet:  g.address?.street,
            addressZipcode: g.address?.zipcode,
            addressNeighborhood: g.address?.neighborhood,
            documentFrontUrl:    g.documentFrontUrl,
            documentBackUrl:     g.documentBackUrl,
            fnrhRacaId:            g.fnrh_extra?.raca_id,
            fnrhDeficienciaId:     g.fnrh_extra?.deficiencia_id,
            fnrhTipoDeficienciaId: g.fnrh_extra?.tipo_deficiencia_id,
            fnrhMotivoViagemId:    g.fnrh_extra?.motivo_viagem_id,
            fnrhMeioTransporteId:  g.fnrh_extra?.meio_transporte_id,
            fnrhGrauParentescoId:    g.fnrh_extra?.grau_parentesco_id,
            fnrhResponsavelDocumento: g.fnrh_extra?.responsavel_documento,
            fnrhResponsavelDocTipo:   g.fnrh_extra?.responsavel_doc_tipo,
          }));

        const guestsForDb = [...othersForDb, currentGuestData];
        await saveFichaToDatabase({
          hotelId:            realHotelId!,
          bookingNumber:      session?.bookingNumber || undefined,
          guests:             guestsForDb,
          hotelTermsAccepted: hotelAccepted,
          lgpdAccepted,
          signatureData:      sigDataUrl,
          hotelTermsText:     activeHotelTerms || undefined,
          lgpdTermsText:      activeLgpdTerms  || undefined,
          hotelRulesDocUrl,
          lgpdDocUrl,
          source:             'web',
        });
      } catch (dbErr: any) {
      }

      await new Promise(r => setTimeout(r, 900));
      setStep('done');
    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setSaving(false);
    }
  };

  // ── Loader enquanto resolve tokens ────────────────────────────────────────

  if (resolving) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        <Loader2 size={40} color="#0085ae" style={{ animation: 'spin 1s linear infinite' }} />
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', margin: 0 }}>
          {!isNew ? 'Carregando dados da reserva...' : 'Aguarde...'}
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Tela de sucesso ───────────────────────────────────────────────────────

  if (step === 'done') {
    const backUrl = wciCode && sessionToken
      ? `/web-checkin/${wciCode}/guests/${sessionToken}`
      : '/web-checkin';

    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '2rem' }}>
        <CheckCircle size={72} color="#22c55e" style={{ marginBottom: '1.25rem' }} />
        <h1 style={{ fontSize: 'clamp(1.4rem,5vw,2rem)', fontWeight: 800, color: '#fff', marginBottom: '0.75rem' }}>
          Ficha Assinada!
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1rem', maxWidth: 400, lineHeight: 1.6, marginBottom: '2rem' }}>
          {wciCode && sessionToken
            ? 'Ficha registrada e assinada com sucesso. Retornando para a lista de hóspedes...'
            : 'Sua ficha foi registrada e assinada com sucesso. Dirija-se à recepção para concluir o check-in.'
          }
        </p>
        <button
          onClick={() => navigate(backUrl)}
          style={{ padding: '0.875rem 2rem', borderRadius: 50, border: 'none', cursor: 'pointer', background: '#0085ae', color: '#fff', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Home size={18} />
          {wciCode && sessionToken ? 'Voltar à Lista' : 'Voltar ao Início'}
        </button>
        {wciCode && sessionToken && (
          <AutoReturn delay={3000} to={backUrl} navigate={navigate} />
        )}
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
              <p style={{ margin: 0, fontWeight: 700, color: 'rgba(255,255,255,0.8)', fontSize: '0.88rem', borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: '0.4rem' }}>
                Dados Pessoais
              </p>
              <div>
                <label style={labelStyle}>{t('nameField')}</label>
                <input style={inputStyle} type="text" name="name" value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo" required autoFocus />
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
                  <input
                    style={inputStyle}
                    type="text"
                    inputMode="numeric"
                    value={birthDateDisplay}
                    onChange={e => handleDateInput(e.target.value)}
                    placeholder="DD/MM/AAAA"
                    maxLength={10}
                  />
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
                  <label style={labelStyle}>
                    {t('zipcodeField')}
                    {cepLoading && (
                      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', marginLeft: '0.4rem', display: 'inline-block', verticalAlign: 'middle', color: '#0085ae' }} />
                    )}
                  </label>
                  <input
                    style={{ ...inputStyle, borderColor: cepLoading ? '#0085ae' : undefined }}
                    type="text"
                    inputMode="numeric"
                    value={zipcode}
                    onChange={e => handleZipcodeChange(e.target.value)}
                    onBlur={handleZipcodeBlur}
                    placeholder="00000-000"
                    maxLength={9}
                  />
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

              {/* ── Informações da Viagem (FNRH Gov) ── */}
              <p style={{ margin: '0.5rem 0 0', fontWeight: 700, color: 'rgba(255,255,255,0.8)', fontSize: '0.88rem', borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: '0.4rem' }}>
                {t('travelInfoSection')}
              </p>

              {/* Raça / Etnia */}
              <div>
                <label style={labelStyle}>{t('racaLabel')}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {[
                    { value: 'BRANCA',      key: 'racaBranca' },
                    { value: 'PRETA',       key: 'racaPreta' },
                    { value: 'PARDA',       key: 'racaParda' },
                    { value: 'AMARELA',     key: 'racaAmarela' },
                    { value: 'INDIGENA',    key: 'racaIndigena' },
                    { value: 'NAOINFORMAR', key: 'racaNaoInformar' },
                  ].map(op => (
                    <button key={op.value} type="button" onClick={() => setRacaId(op.value)} style={{
                      padding: '0.4rem 0.8rem', borderRadius: 50, border: '1px solid',
                      borderColor: racaId === op.value ? '#0085ae' : 'rgba(255,255,255,0.2)',
                      background: racaId === op.value ? 'rgba(0,133,174,0.35)' : 'rgba(255,255,255,0.07)',
                      color: racaId === op.value ? '#fff' : 'rgba(255,255,255,0.6)',
                      fontSize: '0.8rem', fontWeight: racaId === op.value ? 700 : 400,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}>{t(op.key)}</button>
                  ))}
                </div>
              </div>

              {/* Deficiência */}
              <div>
                <label style={labelStyle}>{t('deficienciaLabel')}</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: deficienciaId === 'SIM' ? '0.5rem' : 0 }}>
                  {[
                    { value: 'NAO',         key: 'defNao' },
                    { value: 'SIM',         key: 'defSim' },
                    { value: 'NAOINFORMAR', key: 'defNaoInformar' },
                  ].map(op => (
                    <button key={op.value} type="button" onClick={() => { setDeficienciaId(op.value); if (op.value !== 'SIM') setTipoDeficienciaId(''); }} style={{
                      padding: '0.4rem 0.8rem', borderRadius: 50, border: '1px solid',
                      borderColor: deficienciaId === op.value ? '#0085ae' : 'rgba(255,255,255,0.2)',
                      background: deficienciaId === op.value ? 'rgba(0,133,174,0.35)' : 'rgba(255,255,255,0.07)',
                      color: deficienciaId === op.value ? '#fff' : 'rgba(255,255,255,0.6)',
                      fontSize: '0.8rem', fontWeight: deficienciaId === op.value ? 700 : 400,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}>{t(op.key)}</button>
                  ))}
                </div>
                {deficienciaId === 'SIM' && (
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={tipoDeficienciaId} onChange={e => setTipoDeficienciaId(e.target.value)}>
                    <option value=""                style={{ color: '#000' }}>— {t('tipoDefLabel')}</option>
                    <option value="FISICA"          style={{ color: '#000' }}>{t('tipoDefFisica')}</option>
                    <option value="AUDITIVA_SURDEZ" style={{ color: '#000' }}>{t('tipoDefAuditiva')}</option>
                    <option value="VISUAL"          style={{ color: '#000' }}>{t('tipoDefVisual')}</option>
                    <option value="INTELECTUAL"     style={{ color: '#000' }}>{t('tipoDefIntelectual')}</option>
                    <option value="MULTIPLA"        style={{ color: '#000' }}>{t('tipoDefMultipla')}</option>
                  </select>
                )}
              </div>

              {/* Motivo viagem + Meio transporte */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>{t('motivoViagemLabel')}</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={motivoViagemId} onChange={e => setMotivoViagemId(e.target.value)}>
                    <option value="LAZER_FERIAS"    style={{ color: '#000' }}>{t('motivoLazer')}</option>
                    <option value="NEGOCIOS"        style={{ color: '#000' }}>{t('motivoNegocios')}</option>
                    <option value="COMPRAS"         style={{ color: '#000' }}>{t('motivoCompras')}</option>
                    <option value="CONGRESSO_FEIRA" style={{ color: '#000' }}>{t('motivoCongresso')}</option>
                    <option value="ESTUDOS_CURSOS"  style={{ color: '#000' }}>{t('motivoEstudos')}</option>
                    <option value="PARENTES_AMIGOS" style={{ color: '#000' }}>{t('motivoParentes')}</option>
                    <option value="RELIGIAO"        style={{ color: '#000' }}>{t('motivoReligiao')}</option>
                    <option value="SAUDE"           style={{ color: '#000' }}>{t('motivoSaude')}</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t('meioTransporteLabel')}</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={meioTransporteId} onChange={e => setMeioTransporteId(e.target.value)}>
                    <option value="AUTOMOVEL"   style={{ color: '#000' }}>{t('transAutomovel')}</option>
                    <option value="AVIAO"       style={{ color: '#000' }}>{t('transAviao')}</option>
                    <option value="ONIBUS"      style={{ color: '#000' }}>{t('transOnibus')}</option>
                    <option value="MOTO"        style={{ color: '#000' }}>{t('transMoto')}</option>
                    <option value="NAVIO_BARCO" style={{ color: '#000' }}>{t('transNavio')}</option>
                    <option value="TREM"        style={{ color: '#000' }}>{t('transTrem')}</option>
                    <option value="BICICLETA"   style={{ color: '#000' }}>{t('transBicicleta')}</option>
                    <option value="PE"          style={{ color: '#000' }}>{t('transPe')}</option>
                  </select>
                </div>
              </div>

              {/* ── Menor de Idade ── aparece automaticamente quando age < 18 */}
              {isMinorGuest && (
                <>
                  {/* Banner */}
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.65rem',
                    background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)',
                    borderRadius: 12, padding: '0.75rem 1rem',
                  }}>
                    <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>⚠️</span>
                    <div>
                      <p style={{ margin: 0, color: '#fbbf24', fontWeight: 700, fontSize: '0.85rem' }}>{t('minorBannerTitle')}</p>
                      <p style={{ margin: '0.2rem 0 0', color: 'rgba(255,255,255,0.65)', fontSize: '0.78rem', lineHeight: 1.5 }}>
                        {t('minorBannerDesc')}
                      </p>
                    </div>
                  </div>

                  <p style={{ margin: 0, fontWeight: 700, color: 'rgba(255,255,255,0.8)', fontSize: '0.88rem', borderBottom: '1px solid rgba(251,191,36,0.25)', paddingBottom: '0.4rem' }}>
                    {t('minorSection')}
                  </p>

                  {/* Grau de parentesco */}
                  <div>
                    <label style={labelStyle}>{t('grauParentescoLabel')}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {[
                        { value: 'PAI',               key: 'grauPai' },
                        { value: 'MAE',               key: 'grauMae' },
                        { value: 'AVO',               key: 'grauAvo' },
                        { value: 'IRMAO',             key: 'grauIrmao' },
                        { value: 'TIO',               key: 'grauTio' },
                        { value: 'RESPONSAVEL_LEGAL', key: 'grauRespLegal' },
                        { value: 'TUTOR',             key: 'grauTutor' },
                        { value: 'OUTRO',             key: 'grauOutro' },
                      ].map(op => (
                        <button key={op.value} type="button" onClick={() => setGrauParentescoId(op.value)} style={{
                          padding: '0.4rem 0.8rem', borderRadius: 50, border: '1px solid',
                          borderColor: grauParentescoId === op.value ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                          background: grauParentescoId === op.value ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.07)',
                          color: grauParentescoId === op.value ? '#fff' : 'rgba(255,255,255,0.6)',
                          fontSize: '0.8rem', fontWeight: grauParentescoId === op.value ? 700 : 400,
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}>{t(op.key)}</button>
                      ))}
                    </div>
                  </div>

                  {/* Selecionar responsável da reserva */}
                  {adultGuests.length > 0 && (
                    <div>
                      <label style={labelStyle}>{t('responsavelReservaLabel')}</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={responsavelGuestId} onChange={e => handleResponsavelGuestSelect(e.target.value)}>
                        <option value="" style={{ color: '#000' }}>{t('responsavelReservaPlaceholder')}</option>
                        {adultGuests.map(ag => (
                          <option key={ag.id} value={String(ag.id)} style={{ color: '#000' }}>
                            {ag.name}{ag.documents?.[0]?.number ? ` — ${ag.documents[0].number}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Documento do responsável */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label style={labelStyle}>{t('responsavelDocTipoLabel')}</label>
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={responsavelDocTipo} onChange={e => setResponsavelDocTipo(e.target.value)}>
                        <option value="CPF"        style={{ color: '#000' }}>CPF</option>
                        <option value="PASSAPORTE" style={{ color: '#000' }}>{t('passport')}</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>{t('responsavelDocNumeroLabel')}</label>
                      <input style={inputStyle} type="text" value={responsavelDocumento} onChange={e => setResponsavelDocumento(e.target.value)} placeholder="000.000.000-00" autoComplete="off" />
                    </div>
                  </div>
                </>
              )}

              {error && (
                <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '0.75rem 1rem' }}>
                  <span style={{ color: '#fca5a5', fontSize: '0.88rem' }}>{error}</span>
                </div>
              )}

              <button type="submit" disabled={saving} style={{
                padding: '1rem', borderRadius: 50, border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? 'rgba(0,133,174,0.5)' : '#0085ae',
                color: '#fff', fontWeight: 700, fontSize: '1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              }}>
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

  // ── Upload de Documentos (opcional) ──────────────────────────────────────

  if (step === 'documents') {
    /** Converte imagem para JPEG normalizado (max 1600px) */
    const imageToJpeg = async (file: File): Promise<{ preview: string; base64: string; name: string }> => {
      const dataUrl = await new Promise<string>(res => {
        const reader = new FileReader();
        reader.onload = e => res(e.target?.result as string);
        reader.readAsDataURL(file);
      });
      const cvs = document.createElement('canvas');
      const img = new Image();
      await new Promise<void>(r => { img.onload = () => r(); img.src = dataUrl; });
      const MAX_W = 1600;
      const scale = img.width > MAX_W ? MAX_W / img.width : 1;
      cvs.width = img.width * scale; cvs.height = img.height * scale;
      cvs.getContext('2d')!.drawImage(img, 0, 0, cvs.width, cvs.height);
      const jpegDataUrl = cvs.toDataURL('image/jpeg', 0.82);
      return { preview: jpegDataUrl, base64: jpegDataUrl.replace(/^data:image\/jpeg;base64,/, ''), name: file.name.replace(/\.[^.]+$/, '.jpg') };
    };

    /** Carrega PDF.js do CDN (uma vez) e converte cada página em JPEG */
    const pdfToJpegs = async (file: File): Promise<Array<{ preview: string; base64: string; name: string }>> => {
      // Carrega PDF.js via CDN se ainda não disponível
      if (!(window as any).pdfjsLib) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Falha ao carregar PDF.js'));
          document.head.appendChild(script);
        });
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      const pdfLib = (window as any).pdfjsLib;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfLib.getDocument({ data: arrayBuffer }).promise;
      const results: Array<{ preview: string; base64: string; name: string }> = [];
      const numPages = Math.min(pdf.numPages, 6); // máx 6 páginas
      const baseName = file.name.replace(/\.pdf$/i, '');
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const cvs = document.createElement('canvas');
        cvs.width = viewport.width; cvs.height = viewport.height;
        await page.render({ canvasContext: cvs.getContext('2d')!, viewport }).promise;
        const jpegDataUrl = cvs.toDataURL('image/jpeg', 0.82);
        results.push({
          preview: jpegDataUrl,
          base64: jpegDataUrl.replace(/^data:image\/jpeg;base64,/, ''),
          name: numPages > 1 ? `${baseName}_p${i}.jpg` : `${baseName}.jpg`,
        });
      }
      return results;
    };

    const handleFileInput = async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setDocUploading(true);
      const toAdd: typeof docUploads = [];
      for (const file of Array.from(files)) {
        if (file.type === 'application/pdf') {
          try {
            const pages = await pdfToJpegs(file);
            toAdd.push(...pages);
          } catch { /* PDF inválido ou erro de rede — ignorar */ }
        } else if (file.type.startsWith('image/')) {
          try {
            const jpeg = await imageToJpeg(file);
            toAdd.push(jpeg);
          } catch { /* ignorar */ }
        }
      }
      setDocUploads(prev => [...prev, ...toAdd]);
      setDocUploading(false);
    };

    return (
      <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem' }}>
        <div style={{ width: '100%', maxWidth: 680 }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <ImagePlus size={38} color="#0085ae" style={{ marginBottom: '0.6rem' }} />
            <h1 style={{ fontSize: 'clamp(1.1rem,3.5vw,1.5rem)', fontWeight: 800, color: '#fff', margin: 0 }}>
              Documentos de Identificação
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.83rem', margin: '0.4rem 0 0' }}>
              Opcional — fotografe ou faça upload do seu documento.
            </p>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1.25rem', background: 'rgba(0,133,174,0.15)', border: '2px dashed rgba(0,133,174,0.5)', borderRadius: 14, cursor: 'pointer', color: '#7dd3ee', fontWeight: 600, fontSize: '0.88rem' }}>
                <Camera size={28} />
                Usar Câmera
                <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={e => handleFileInput(e.target.files)} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1.25rem', background: 'rgba(255,255,255,0.08)', border: '2px dashed rgba(255,255,255,0.25)', borderRadius: 14, cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontWeight: 600, fontSize: '0.88rem' }}>
                <Upload size={28} />
                Galeria / Arquivo / PDF
                <input type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }} onChange={e => handleFileInput(e.target.files)} />
              </label>
            </div>

            {docUploading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: 'rgba(255,255,255,0.6)' }}>
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '0.85rem' }}>Processando imagem...</span>
              </div>
            )}

            {docUploads.length > 0 && (
              <div>
                <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.75rem' }}>
                  {docUploads.length} documento(s) adicionado(s)
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem' }}>
                  {docUploads.map((doc, i) => (
                    <div key={i} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden' }}>
                      <img src={doc.preview} alt={doc.name} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                      <button onClick={() => setDocUploads(prev => prev.filter((_, j) => j !== i))} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.65)', border: 'none', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <XIcon size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', textAlign: 'center', margin: 0 }}>
              Aceitos: fotos (RG, passaporte) e PDFs (CNH digital, passaporte digital).
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button onClick={() => setStep('signature')} style={{ padding: '1rem', borderRadius: 50, border: 'none', cursor: 'pointer', background: '#0085ae', color: '#fff', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              {docUploads.length > 0 ? `Continuar com ${docUploads.length} documento(s)` : 'Continuar sem documentos'}
              <ChevronRight size={18} />
            </button>
            <button onClick={() => setStep('fnrh')} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline' }}>
              ← Voltar ao formulário
            </button>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Assinatura ────────────────────────────────────────────────────────────

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

            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: '0.875rem', maxHeight: 200, overflowY: 'auto', fontSize: '0.77rem', lineHeight: 1.75, color: 'rgba(255,255,255,0.72)', whiteSpace: 'pre-wrap' }}>
              {activeTab === 'hotel' ? activeHotelTerms : activeLgpdTerms}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '1.1rem' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={hotelAccepted} onChange={e => { setHotelAccepted(e.target.checked); setError(''); }}
                  style={{ width: 20, height: 20, marginTop: 2, cursor: 'pointer', accentColor: '#0085ae', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.86rem', lineHeight: 1.5 }}>
                  Li e aceito o <strong>Regulamento Interno e as Políticas do Hotel</strong>.
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={lgpdAccepted} onChange={e => { setLgpdAccepted(e.target.checked); setError(''); }}
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
              <h3 style={{ color: '#fff', fontWeight: 700, margin: 0, fontSize: '0.95rem' }}>{t('digitalSignature')}</h3>
              <button onClick={() => sigRef.current?.clear()} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8, padding: '0.35rem 0.7rem', cursor: 'pointer', color: 'rgba(255,255,255,0.65)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <RotateCcw size={12} /> {t('clearSignature')}
              </button>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.97)', borderRadius: 12, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.3)' }}>
              <SignatureCanvas ref={sigRef} penColor="#1a1a2e"
                canvasProps={{ style: { width: '100%', height: 160, display: 'block', touchAction: 'none' } }}
              />
            </div>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.73rem', margin: '0.4rem 0 0', textAlign: 'center' }}>
              Assine com o dedo ou mouse
            </p>
          </div>

          {sendQueue.length > 0 && <SendQueue items={sendQueue} />}

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '0.75rem 1rem' }}>
              <span style={{ color: '#fca5a5', fontSize: '0.86rem' }}>{error}</span>
            </div>
          )}

          <button onClick={handleSign} disabled={saving || !hotelAccepted || !lgpdAccepted} style={{
            padding: '1rem', borderRadius: 50, border: 'none',
            cursor: (saving || !hotelAccepted || !lgpdAccepted) ? 'not-allowed' : 'pointer',
            background: (saving || !hotelAccepted || !lgpdAccepted) ? 'rgba(0,133,174,0.35)' : '#0085ae',
            color: '#fff', fontWeight: 700, fontSize: '1rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
          }}>
            {saving
              ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> {t('sending')}</>
              : t('finishCheckin')
            }
          </button>

          <button onClick={() => { setStep('fnrh'); setError(''); setHotelAccepted(false); setLgpdAccepted(false); setSendQueue([]); }}
            style={{ display: 'block', margin: '0 auto', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline' }}>
            ← Corrigir dados
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
