// src/pages/webcheckin/WCIFNRHForm.tsx
// Formulário FNRH — leitura via FormData (bulletproof contra autofill e timing React)
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClipboardList, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import {
  loadGuestsFromStorage,
  saveGuestsToStorage,
  saveGuestFNRH,
  uploadDocumentPhoto,
  resolveHotelByCode,
  resolveSession,
  WebCheckinGuest,
} from './webCheckinService';
import type { ErbonGuestPayload } from '../../lib/erbonService';

// ── Helper ────────────────────────────────────────────────────────────────────
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

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.25)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  borderRadius: 20,
  padding: '2rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '0.75rem 1rem',
  fontSize: '1rem',
  background: 'rgba(255,255,255,0.10)',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: 10,
  color: '#fff',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: '0.35rem',
  fontSize: '0.82rem', fontWeight: 600,
  color: 'rgba(255,255,255,0.75)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '0.95rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)',
  borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: '0.5rem',
  marginBottom: '1rem',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
      {children}
    </div>
  );
}

// Helper: lê string de FormData
const fd = (data: FormData, key: string) => ((data.get(key) as string) || '').trim();

export default function WCIFNRHForm() {
  const { hotelId, bookingId, guestId: guestIdParam } = useParams<{
    hotelId: string; bookingId: string; guestId: string;
  }>();
  const navigate = useNavigate();
  const { t } = useWCI();

  const isNew = !guestIdParam || guestIdParam.startsWith('new_') || guestIdParam === '0';
  const guestId = isNew ? null : Number(guestIdParam);

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');
  const [docFrontFile, setDocFrontFile] = useState<File | null>(null);
  const [docBackFile,  setDocBackFile]  = useState<File | null>(null);
  const [docFrontPreview, setDocFrontPreview] = useState<string>('');
  const [docBackPreview,  setDocBackPreview]  = useState<string>('');
  const [uploading, setUploading] = useState(false);

  // Estado React — usado apenas para pré-preenchimento e controle de CEP/UF
  const [name,          setName]          = useState('');
  const [email,         setEmail]         = useState('');
  const [phone,         setPhone]         = useState('');
  const [birthDate,     setBirthDate]     = useState('');
  const [genderID,      setGenderID]      = useState(0);
  const [nationality,   setNationality]   = useState('BR');
  const [profession,    setProfession]    = useState('');
  const [vehicleRegistration, setVehicleRegistration] = useState('');
  const [documentType,  setDocumentType]  = useState('CPF');
  const [documentNumber,setDocumentNumber]= useState('');
  const [country,       setCountry]       = useState('BR');
  const [state,         setState]         = useState('');
  const [city,          setCity]          = useState('');
  const [street,        setStreet]        = useState('');
  const [zipcode,       setZipcode]       = useState('');
  const [neighborhood,  setNeighborhood]  = useState('');

  // ── Campos FNRH Gov (adicionais) ───────────────────────────────────────────
  const [racaId,             setRacaId]            = useState('NAOINFORMAR');
  const [deficienciaId,      setDeficienciaId]      = useState('NAO');
  const [tipoDeficienciaId,  setTipoDeficienciaId]  = useState('');
  const [motivoViagemId,     setMotivoViagemId]     = useState('LAZER_FERIAS');
  const [meioTransporteId,   setMeioTransporteId]   = useState('AUTOMOVEL');

  // ── Menor de idade ──────────────────────────────────────────────────────────
  const [grauParentescoId,     setGrauParentescoId]     = useState('');
  const [responsavelGuestId,   setResponsavelGuestId]   = useState('');   // id do hóspede adulto selecionado
  const [responsavelDocumento, setResponsavelDocumento] = useState('');
  const [responsavelDocTipo,   setResponsavelDocTipo]   = useState('CPF');
  const [adultGuests,          setAdultGuests]          = useState<WebCheckinGuest[]>([]);

  const isMinor = calcAge(birthDate) !== null && (calcAge(birthDate) as number) < 18;

  // Ref para controle DOM do bloco CEP/UF
  const cepUfRef = useRef<HTMLDivElement>(null);

  // Pré-preencher de localStorage se estiver editando hóspede existente
  // + carrega hóspedes adultos da sessão para seleção de responsável
  useEffect(() => {
    if (!bookingId) return;

    // Carrega hóspedes adultos (para dropdown de responsável de menor)
    resolveSession(bookingId).then(session => {
      const guests = session?.guests || loadGuestsFromStorage(bookingId) || [];
      const adults = guests.filter(g => {
        if (!g.birthDate) return true; // sem data → assume adulto
        const age = calcAge(g.birthDate);
        return age === null || age >= 18;
      }).filter(g => g.id !== guestId); // exclui o próprio hóspede
      setAdultGuests(adults);
    }).catch(() => {
      // fallback: carrega do storage local
      const stored = loadGuestsFromStorage(bookingId) || [];
      const adults = stored.filter(g => {
        if (!g.birthDate) return true;
        const age = calcAge(g.birthDate);
        return age === null || age >= 18;
      }).filter(g => g.id !== guestId);
      setAdultGuests(adults);
    });

    const stored = loadGuestsFromStorage(bookingId);
    if (!stored) return;
    const guest = stored.find(g => g.id === guestId);
    if (!guest) return;

    setName(guest.name || '');
    setEmail(guest.email || '');
    setPhone(guest.phone || '');
    if (guest.genderID) setGenderID(guest.genderID);
    if (guest.nationality) setNationality(guest.nationality);

    if (guest.documents?.length) {
      setDocumentType(guest.documents[0].documentType || 'CPF');
      setDocumentNumber(guest.documents[0].number || '');
    }

    // Pré-preenche campos FNRH se já preenchidos anteriormente
    if (guest.fnrh_extra) {
      if (guest.fnrh_extra.raca_id)             setRacaId(guest.fnrh_extra.raca_id);
      if (guest.fnrh_extra.deficiencia_id)      setDeficienciaId(guest.fnrh_extra.deficiencia_id);
      if (guest.fnrh_extra.tipo_deficiencia_id) setTipoDeficienciaId(guest.fnrh_extra.tipo_deficiencia_id);
      if (guest.fnrh_extra.motivo_viagem_id)    setMotivoViagemId(guest.fnrh_extra.motivo_viagem_id);
      if (guest.fnrh_extra.meio_transporte_id)  setMeioTransporteId(guest.fnrh_extra.meio_transporte_id);
      if (guest.fnrh_extra.grau_parentesco_id)  setGrauParentescoId(guest.fnrh_extra.grau_parentesco_id);
      if (guest.fnrh_extra.responsavel_documento) setResponsavelDocumento(guest.fnrh_extra.responsavel_documento);
      if (guest.fnrh_extra.responsavel_doc_tipo)  setResponsavelDocTipo(guest.fnrh_extra.responsavel_doc_tipo);
    }
  }, [bookingId, guestId]);

  // Quando usuário seleciona um adulto da reserva como responsável → auto-preenche documento
  const handleResponsavelGuestSelect = (guestIdStr: string) => {
    setResponsavelGuestId(guestIdStr);
    if (!guestIdStr) {
      setResponsavelDocumento('');
      return;
    }
    const g = adultGuests.find(ag => String(ag.id) === guestIdStr);
    if (g?.documents?.length) {
      setResponsavelDocumento(g.documents[0].number || '');
      setResponsavelDocTipo(g.documents[0].documentType === 'PASSPORT' ? 'PASSAPORTE' : 'CPF');
    }
  };

  const handleCountryChange = (value: string) => {
    setCountry(value);
    if (value !== 'BR') {
      setState(''); setZipcode('');
      if (cepUfRef.current) cepUfRef.current.style.display = 'none';
    } else {
      if (cepUfRef.current) cepUfRef.current.style.display = 'grid';
    }
  };

  function handleFileSelect(file: File | null, side: 'front' | 'back') {
    if (!file) return;
    if (side === 'front') { setDocFrontFile(file); setDocFrontPreview(URL.createObjectURL(file)); }
    else { setDocBackFile(file); setDocBackPreview(URL.createObjectURL(file)); }
  }

  // ── Submit via FormData ─────────────────────────────────────────────────────
  // FormData lê os valores REAIS do DOM (name= attribute) no momento do submit.
  // Isso é imune a: autofill sem onChange, timing do React state, refs nulos.
  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!hotelId || !bookingId) return;

    // Lê TODOS os valores direto do formulário HTML
    const data = new FormData(e.currentTarget);

    const domName         = fd(data, 'name');
    const domEmail        = fd(data, 'email');
    const domPhone        = fd(data, 'phone');
    const domBirthDate    = fd(data, 'birthDate');
    const domGenderID     = Number(fd(data, 'genderID') || '0');
    const domNationality  = fd(data, 'nationality') || 'BR';
    const domProfession   = fd(data, 'profession');
    const domVehicle      = fd(data, 'vehicleRegistration');
    const domDocType      = fd(data, 'documentType')  || 'CPF';
    const domDocNumber    = fd(data, 'documentNumber').replace(/[\.\-\/\s]/g, '');
    const domCountry      = fd(data, 'country')       || 'BR';
    const domState        = fd(data, 'state');
    const domCity         = fd(data, 'city');
    const domStreet       = fd(data, 'street');
    const domZipcode      = fd(data, 'zipcode').replace(/\D/g, '');
    const domNeighborhood = fd(data, 'neighborhood');

    // Campos FNRH Gov
    const domRacaId            = fd(data, 'raca_id')             || 'NAOINFORMAR';
    const domDeficienciaId     = fd(data, 'deficiencia_id')      || 'NAO';
    const domTipoDeficienciaId = fd(data, 'tipo_deficiencia_id') || '';
    const domMotivoViagemId    = fd(data, 'motivo_viagem_id')    || 'LAZER_FERIAS';
    const domMeioTransporteId  = fd(data, 'meio_transporte_id')  || 'AUTOMOVEL';

    // Campos de menor de idade
    const domGrauParentesco    = fd(data, 'grau_parentesco_id')      || grauParentescoId;
    const domRespDoc           = fd(data, 'responsavel_documento').replace(/[\.\-\/\s]/g, '') || responsavelDocumento.replace(/[\.\-\/\s]/g, '');
    const domRespDocTipo       = fd(data, 'responsavel_doc_tipo')     || responsavelDocTipo || 'CPF';

    // Validação — campos obrigatórios
    if (!domName)       { setError('Nome completo é obrigatório.');        return; }
    if (!domEmail)      { setError('E-mail é obrigatório.');               return; }
    if (!domDocNumber)  { setError('Número do documento é obrigatório.');  return; }

    // Validação — menor de idade
    const ageNow = calcAge(domBirthDate);
    const guestIsMinor = ageNow !== null && ageNow < 18;
    if (guestIsMinor) {
      if (!domGrauParentesco) {
        setError('Para hóspedes menores de idade, informe o grau de parentesco com o responsável.');
        return;
      }
      if (!domRespDoc) {
        setError('Para hóspedes menores de idade, informe o documento do responsável.');
        return;
      }
    }

    const addressCountry = (domCountry && domCountry !== 'OTHER') ? domCountry : (domNationality !== 'BR' ? domNationality : 'BR');
    const isBR           = addressCountry === 'BR';

    setSaving(true);
    setError('');

    try {
      // Resolve hotel UUID and hasErbon flag
      const hotelInfo = await resolveHotelByCode(hotelId!);
      const hotelUUID = hotelInfo?.id || hotelId!;
      const hasErbon  = hotelInfo?.hasErbon ?? false;

      // Upload photos if selected
      let docFrontUrl: string | undefined;
      let docBackUrl:  string | undefined;
      if (docFrontFile || docBackFile) {
        setUploading(true);
        try {
          if (docFrontFile) docFrontUrl = await uploadDocumentPhoto(docFrontFile, hotelUUID, 'front');
          if (docBackFile)  docBackUrl  = await uploadDocumentPhoto(docBackFile,  hotelUUID, 'back');
        } catch { /* best-effort: continue even if upload fails */ }
        setUploading(false);
      }

      const payload: ErbonGuestPayload = {
        id:                  guestId ?? 0,
        name:                domName,
        email:               domEmail      || undefined,
        phone:               domPhone      || undefined,
        birthDate:           domBirthDate  || undefined,
        genderID:            domGenderID   || undefined,
        nationality:         domNationality || undefined,
        profession:          domProfession || undefined,
        vehicleRegistration: domVehicle    || undefined,
        documents: domDocNumber ? [{
          documentType: domDocType,
          number:       domDocNumber,
          country:      addressCountry,
        }] : [],
        address: {
          country:      addressCountry,
          state:        isBR ? (domState        || undefined) : undefined,
          zipcode:      isBR ? (domZipcode      || undefined) : undefined,
          city:         domCity         || undefined,
          street:       domStreet       || undefined,
          neighborhood: domNeighborhood || undefined,
        },
      };

      // Resolve o numeric booking ID real (bookingId do param é o token opaco)
      const session = await resolveSession(bookingId!).catch(() => null);
      const numericBookingId = session?.bookingId ?? 0;

      let savedId: number;
      if (hasErbon) {
        savedId = await saveGuestFNRH(hotelUUID, numericBookingId, guestId, payload);
      } else {
        savedId = guestId ?? Date.now();
      }

      const fullName = domName;
      // Guests ficam no storage sob o booking ID numérico (chave correta da sessão)
      const stored = session?.guests || loadGuestsFromStorage(numericBookingId) || [];

      const guestProfile: Partial<WebCheckinGuest> = {
        name:        fullName,
        email:       domEmail,
        phone:       domPhone,
        documents:   payload.documents,
        birthDate:   domBirthDate  || undefined,
        genderID:    domGenderID   || undefined,
        nationality: domNationality || undefined,
        address: {
          country:      addressCountry,
          state:        domState        || undefined,
          city:         domCity         || undefined,
          street:       domStreet       || undefined,
          zipcode:      domZipcode      || undefined,
          neighborhood: domNeighborhood || undefined,
        },
        fnrhCompleted:    true,
        documentFrontUrl: docFrontUrl,
        documentBackUrl:  docBackUrl,
        // Campos FNRH Gov
        fnrh_extra: {
          raca_id:               domRacaId,
          deficiencia_id:        domDeficienciaId,
          tipo_deficiencia_id:   domTipoDeficienciaId  || undefined,
          motivo_viagem_id:      domMotivoViagemId,
          meio_transporte_id:    domMeioTransporteId,
          grau_parentesco_id:    guestIsMinor ? (domGrauParentesco || undefined) : undefined,
          responsavel_documento: guestIsMinor ? (domRespDoc        || undefined) : undefined,
          responsavel_doc_tipo:  guestIsMinor ? (domRespDocTipo    || undefined) : undefined,
        },
      };

      if (isNew) {
        const newGuest: WebCheckinGuest = {
          id: savedId,
          isMainGuest: false,
          ...guestProfile,
        } as WebCheckinGuest;
        saveGuestsToStorage(numericBookingId, [...stored, newGuest], hotelUUID);
      } else {
        const updated = stored.map(g =>
          g.id === guestId ? { ...g, ...guestProfile } : g
        );
        saveGuestsToStorage(numericBookingId, updated, hotelUUID);
      }

      setSaved(true);
      setTimeout(() => navigate(`/web-checkin/${hotelId}/guests/${bookingId}`), 1500);

    } catch (err: any) {
      setError(err.message || t('errorGeneral'));
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <CheckCircle size={64} color="#22c55e" style={{ marginBottom: '1rem' }} />
          <h2 style={{ color: '#fff', fontWeight: 800, fontSize: '1.5rem' }}>{t('fnrhDone')}</h2>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 720 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <ClipboardList size={40} color="#0085ae" style={{ marginBottom: '0.75rem' }} />
          <h1 style={{ fontSize: 'clamp(1.1rem,3.5vw,1.6rem)', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            {t('fillFNRHTitle')}
          </h1>
        </div>

        <div style={glassCard}>
          {/* name= em TODOS os inputs — obrigatório para FormData funcionar */}
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* ── Dados Pessoais ── */}
            <div>
              <p style={sectionTitle}>Dados Pessoais</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                <Field label={`${t('nameField')} *`}>
                  <input
                    name="name"
                    style={inputStyle} type="text"
                    value={name} onChange={e => setName(e.target.value)}
                    placeholder="Nome completo como no documento"
                    autoComplete="name"
                    autoFocus
                  />
                </Field>

                <Row>
                  <Field label={t('emailField')}>
                    <input
                      name="email"
                      style={inputStyle} type="email"
                      value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="email@exemplo.com"
                      autoComplete="email"
                    />
                  </Field>
                  <Field label={t('phoneField')}>
                    <input
                      name="phone"
                      style={inputStyle} type="tel"
                      value={phone} onChange={e => setPhone(e.target.value)}
                      placeholder="+55 (11) 9 0000-0000"
                      autoComplete="tel"
                    />
                  </Field>
                </Row>

                <Row>
                  <Field label={t('birthField')}>
                    <input
                      name="birthDate"
                      style={inputStyle} type="date"
                      value={birthDate} onChange={e => setBirthDate(e.target.value)}
                    />
                  </Field>
                  <Field label={t('genderField')}>
                    <select
                      name="genderID"
                      style={{ ...inputStyle, cursor: 'pointer' }}
                      value={genderID} onChange={e => setGenderID(Number(e.target.value))}
                    >
                      <option value={0} style={{ color: '#000' }}>— Selecione</option>
                      <option value={1} style={{ color: '#000' }}>{t('male')}</option>
                      <option value={2} style={{ color: '#000' }}>{t('female')}</option>
                      <option value={3} style={{ color: '#000' }}>{t('other')}</option>
                    </select>
                  </Field>
                </Row>

                <Field label={t('professionField')}>
                  <input
                    name="profession"
                    style={inputStyle} type="text"
                    value={profession} onChange={e => setProfession(e.target.value)}
                    placeholder="Opcional"
                  />
                </Field>

              </div>
            </div>

            {/* ── Documento ── */}
            <div>
              <p style={sectionTitle}>Documento de Identidade</p>
              <Row>
                <Field label={t('documentTypeField')}>
                  <select
                    name="documentType"
                    style={{ ...inputStyle, cursor: 'pointer' }}
                    value={documentType} onChange={e => setDocumentType(e.target.value)}
                  >
                    <option value="CPF"      style={{ color: '#000' }}>{t('cpf')}</option>
                    <option value="RG"       style={{ color: '#000' }}>{t('rg')}</option>
                    <option value="PASSPORT" style={{ color: '#000' }}>{t('passport')}</option>
                    <option value="CNH"      style={{ color: '#000' }}>{t('cnh')}</option>
                  </select>
                </Field>
                <Field label={t('documentField')}>
                  <input
                    name="documentNumber"
                    style={inputStyle} type="text"
                    value={documentNumber} onChange={e => setDocumentNumber(e.target.value)}
                    placeholder="000.000.000-00"
                  />
                </Field>
              </Row>
            </div>

            {/* ── Foto do Documento ── */}
            <div>
              <p style={sectionTitle}>Foto do Documento (Opcional)</p>
              <Row>
                {/* Frente */}
                <div>
                  <label style={labelStyle}>Frente do Documento</label>
                  <div
                    style={{
                      ...inputStyle,
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      cursor: 'pointer', minHeight: '3rem',
                    }}
                    onClick={() => document.getElementById('docFrontInput')?.click()}
                  >
                    {docFrontPreview
                      ? <img src={docFrontPreview} alt="Frente" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }} />
                      : <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>Tirar foto / selecionar</span>
                    }
                  </div>
                  <input
                    id="docFrontInput"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={e => handleFileSelect(e.target.files?.[0] ?? null, 'front')}
                  />
                </div>
                {/* Verso */}
                <div>
                  <label style={labelStyle}>Verso do Documento</label>
                  <div
                    style={{
                      ...inputStyle,
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      cursor: 'pointer', minHeight: '3rem',
                    }}
                    onClick={() => document.getElementById('docBackInput')?.click()}
                  >
                    {docBackPreview
                      ? <img src={docBackPreview} alt="Verso" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }} />
                      : <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>Tirar foto / selecionar</span>
                    }
                  </div>
                  <input
                    id="docBackInput"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={e => handleFileSelect(e.target.files?.[0] ?? null, 'back')}
                  />
                </div>
              </Row>
            </div>

            {/* ── Nacionalidade ── */}
            <div>
              <p style={sectionTitle}>Origem</p>
              <Row>
                <Field label="Nacionalidade">
                  <select
                    name="nationality"
                    style={{ ...inputStyle, cursor: 'pointer' }}
                    value={nationality} onChange={e => setNationality(e.target.value)}
                  >
                    <option value="BR" style={{ color: '#000' }}>🇧🇷 Brasil (BR)</option>
                    <option value="AR" style={{ color: '#000' }}>🇦🇷 Argentina (AR)</option>
                    <option value="UY" style={{ color: '#000' }}>🇺🇾 Uruguay (UY)</option>
                    <option value="PY" style={{ color: '#000' }}>🇵🇾 Paraguay (PY)</option>
                    <option value="CL" style={{ color: '#000' }}>🇨🇱 Chile (CL)</option>
                    <option value="BO" style={{ color: '#000' }}>🇧🇴 Bolivia (BO)</option>
                    <option value="PE" style={{ color: '#000' }}>🇵🇪 Peru (PE)</option>
                    <option value="CO" style={{ color: '#000' }}>🇨🇴 Colombia (CO)</option>
                    <option value="VE" style={{ color: '#000' }}>🇻🇪 Venezuela (VE)</option>
                    <option value="US" style={{ color: '#000' }}>🇺🇸 United States (US)</option>
                    <option value="DE" style={{ color: '#000' }}>🇩🇪 Germany (DE)</option>
                    <option value="FR" style={{ color: '#000' }}>🇫🇷 France (FR)</option>
                    <option value="IT" style={{ color: '#000' }}>🇮🇹 Italy (IT)</option>
                    <option value="ES" style={{ color: '#000' }}>🇪🇸 Spain (ES)</option>
                    <option value="PT" style={{ color: '#000' }}>🇵🇹 Portugal (PT)</option>
                    <option value="GB" style={{ color: '#000' }}>🇬🇧 United Kingdom (GB)</option>
                    <option value="OTHER" style={{ color: '#000' }}>Outro</option>
                  </select>
                </Field>
              </Row>
            </div>

            {/* ── Ficha FNRH Gov ── */}
            <div>
              <p style={sectionTitle}>Informações da Viagem</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                {/* Raça / Etnia */}
                <Field label="Raça / Etnia">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {[
                      { value: 'BRANCA',      label: 'Branca' },
                      { value: 'PRETA',       label: 'Preta' },
                      { value: 'PARDA',       label: 'Parda' },
                      { value: 'AMARELA',     label: 'Amarela' },
                      { value: 'INDIGENA',    label: 'Indígena' },
                      { value: 'NAOINFORMAR', label: 'Prefiro não informar' },
                    ].map(op => (
                      <button
                        key={op.value}
                        type="button"
                        onClick={() => setRacaId(op.value)}
                        style={{
                          padding: '0.45rem 0.9rem',
                          borderRadius: 50,
                          border: '1px solid',
                          borderColor: racaId === op.value ? '#0085ae' : 'rgba(255,255,255,0.25)',
                          background: racaId === op.value ? 'rgba(0,133,174,0.35)' : 'rgba(255,255,255,0.08)',
                          color: racaId === op.value ? '#fff' : 'rgba(255,255,255,0.65)',
                          fontSize: '0.82rem', fontWeight: racaId === op.value ? 700 : 400, cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >{op.label}</button>
                    ))}
                  </div>
                  <input type="hidden" name="raca_id" value={racaId} />
                </Field>

                {/* Deficiência */}
                <Field label="Deficiência">
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    {[
                      { value: 'NAO',         label: 'Não' },
                      { value: 'SIM',         label: 'Sim' },
                      { value: 'NAOINFORMAR', label: 'Prefiro não informar' },
                    ].map(op => (
                      <button
                        key={op.value}
                        type="button"
                        onClick={() => { setDeficienciaId(op.value); if (op.value !== 'SIM') setTipoDeficienciaId(''); }}
                        style={{
                          padding: '0.45rem 0.9rem',
                          borderRadius: 50,
                          border: '1px solid',
                          borderColor: deficienciaId === op.value ? '#0085ae' : 'rgba(255,255,255,0.25)',
                          background: deficienciaId === op.value ? 'rgba(0,133,174,0.35)' : 'rgba(255,255,255,0.08)',
                          color: deficienciaId === op.value ? '#fff' : 'rgba(255,255,255,0.65)',
                          fontSize: '0.82rem', fontWeight: deficienciaId === op.value ? 700 : 400, cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >{op.label}</button>
                    ))}
                  </div>
                  <input type="hidden" name="deficiencia_id" value={deficienciaId} />
                  {deficienciaId === 'SIM' && (
                    <select
                      name="tipo_deficiencia_id"
                      style={{ ...inputStyle, marginTop: '0.5rem', cursor: 'pointer' }}
                      value={tipoDeficienciaId}
                      onChange={e => setTipoDeficienciaId(e.target.value)}
                    >
                      <option value=""      style={{ color: '#000' }}>— Tipo de deficiência</option>
                      <option value="FISICA"           style={{ color: '#000' }}>Física</option>
                      <option value="AUDITIVA_SURDEZ"  style={{ color: '#000' }}>Auditiva / Surdez</option>
                      <option value="VISUAL"           style={{ color: '#000' }}>Visual</option>
                      <option value="INTELECTUAL"      style={{ color: '#000' }}>Intelectual</option>
                      <option value="MULTIPLA"         style={{ color: '#000' }}>Múltipla</option>
                    </select>
                  )}
                  {deficienciaId !== 'SIM' && <input type="hidden" name="tipo_deficiencia_id" value="" />}
                </Field>

                <Row>
                  {/* Motivo da Viagem */}
                  <Field label="Motivo da Viagem">
                    <select
                      name="motivo_viagem_id"
                      style={{ ...inputStyle, cursor: 'pointer' }}
                      value={motivoViagemId} onChange={e => setMotivoViagemId(e.target.value)}
                    >
                      <option value="LAZER_FERIAS"       style={{ color: '#000' }}>Lazer / Férias</option>
                      <option value="NEGOCIOS"           style={{ color: '#000' }}>Negócios</option>
                      <option value="COMPRAS"            style={{ color: '#000' }}>Compras</option>
                      <option value="CONGRESSO_FEIRA"    style={{ color: '#000' }}>Congresso / Feira</option>
                      <option value="ESTUDOS_CURSOS"     style={{ color: '#000' }}>Estudos / Cursos</option>
                      <option value="PARENTES_AMIGOS"    style={{ color: '#000' }}>Visitar Parentes / Amigos</option>
                      <option value="RELIGIAO"           style={{ color: '#000' }}>Religião</option>
                      <option value="SAUDE"              style={{ color: '#000' }}>Saúde</option>
                    </select>
                  </Field>

                  {/* Meio de Transporte */}
                  <Field label="Como vai chegar">
                    <select
                      name="meio_transporte_id"
                      style={{ ...inputStyle, cursor: 'pointer' }}
                      value={meioTransporteId} onChange={e => setMeioTransporteId(e.target.value)}
                    >
                      <option value="AUTOMOVEL"   style={{ color: '#000' }}>Automóvel</option>
                      <option value="AVIAO"        style={{ color: '#000' }}>Avião</option>
                      <option value="ONIBUS"       style={{ color: '#000' }}>Ônibus</option>
                      <option value="MOTO"         style={{ color: '#000' }}>Moto</option>
                      <option value="NAVIO_BARCO"  style={{ color: '#000' }}>Navio / Barco</option>
                      <option value="TREM"         style={{ color: '#000' }}>Trem</option>
                      <option value="BICICLETA"    style={{ color: '#000' }}>Bicicleta</option>
                      <option value="PE"           style={{ color: '#000' }}>A pé</option>
                    </select>
                  </Field>
                </Row>

              </div>
            </div>

            {/* ── Menor de Idade ── (visível apenas se age < 18 e data de nascimento preenchida) */}
            {isMinor && (
              <div>
                {/* Banner de aviso */}
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)',
                  borderRadius: 12, padding: '0.9rem 1rem', marginBottom: '1.25rem',
                }}>
                  <AlertTriangle size={20} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <p style={{ margin: 0, color: '#fbbf24', fontWeight: 700, fontSize: '0.9rem' }}>
                      Hóspede Menor de Idade
                    </p>
                    <p style={{ margin: '0.25rem 0 0', color: 'rgba(255,255,255,0.7)', fontSize: '0.82rem' }}>
                      A legislação brasileira exige a identificação do responsável legal para hóspedes com menos de 18 anos. Preencha os dados abaixo.
                    </p>
                  </div>
                </div>

                <p style={sectionTitle}>Responsável pelo Menor</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                  {/* Grau de parentesco */}
                  <Field label="Grau de Parentesco / Relação com o Responsável *">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {[
                        { value: 'PAI',               label: 'Pai' },
                        { value: 'MAE',               label: 'Mãe' },
                        { value: 'AVO',               label: 'Avô / Avó' },
                        { value: 'IRMAO',             label: 'Irmão / Irmã' },
                        { value: 'TIO',               label: 'Tio / Tia' },
                        { value: 'RESPONSAVEL_LEGAL', label: 'Responsável Legal' },
                        { value: 'TUTOR',             label: 'Tutor' },
                        { value: 'OUTRO',             label: 'Outro' },
                      ].map(op => (
                        <button
                          key={op.value}
                          type="button"
                          onClick={() => setGrauParentescoId(op.value)}
                          style={{
                            padding: '0.45rem 0.9rem',
                            borderRadius: 50,
                            border: '1px solid',
                            borderColor: grauParentescoId === op.value ? '#fbbf24' : 'rgba(255,255,255,0.25)',
                            background: grauParentescoId === op.value ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.08)',
                            color: grauParentescoId === op.value ? '#fff' : 'rgba(255,255,255,0.65)',
                            fontSize: '0.82rem', fontWeight: grauParentescoId === op.value ? 700 : 400,
                            cursor: 'pointer', transition: 'all 0.15s',
                          }}
                        >{op.label}</button>
                      ))}
                    </div>
                    <input type="hidden" name="grau_parentesco_id" value={grauParentescoId} />
                  </Field>

                  {/* Selecionar responsável da reserva ou digitar manualmente */}
                  {adultGuests.length > 0 && (
                    <Field label="Selecionar Responsável da Reserva">
                      <select
                        style={{ ...inputStyle, cursor: 'pointer' }}
                        value={responsavelGuestId}
                        onChange={e => handleResponsavelGuestSelect(e.target.value)}
                      >
                        <option value="" style={{ color: '#000' }}>— Digitar manualmente</option>
                        {adultGuests.map(ag => (
                          <option key={ag.id} value={String(ag.id)} style={{ color: '#000' }}>
                            {ag.name} {ag.documents?.[0]?.number ? `— ${ag.documents[0].documentType}: ${ag.documents[0].number}` : ''}
                          </option>
                        ))}
                      </select>
                      <p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>
                        Outros hóspedes adultos desta reserva. Ao selecionar, o documento é preenchido automaticamente.
                      </p>
                    </Field>
                  )}

                  {/* Documento do responsável */}
                  <Row>
                    <Field label="Tipo do Documento do Responsável *">
                      <select
                        name="responsavel_doc_tipo"
                        style={{ ...inputStyle, cursor: 'pointer' }}
                        value={responsavelDocTipo}
                        onChange={e => setResponsavelDocTipo(e.target.value)}
                      >
                        <option value="CPF"       style={{ color: '#000' }}>CPF</option>
                        <option value="PASSAPORTE" style={{ color: '#000' }}>Passaporte</option>
                      </select>
                    </Field>
                    <Field label="Número do Documento do Responsável *">
                      <input
                        name="responsavel_documento"
                        style={inputStyle} type="text"
                        value={responsavelDocumento}
                        onChange={e => setResponsavelDocumento(e.target.value)}
                        placeholder="000.000.000-00"
                        autoComplete="off"
                      />
                    </Field>
                  </Row>

                </div>
              </div>
            )}

            {/* hidden inputs when NOT minor — ensures FormData keys are always present */}
            {!isMinor && (
              <>
                <input type="hidden" name="grau_parentesco_id"    value="" />
                <input type="hidden" name="responsavel_documento" value="" />
                <input type="hidden" name="responsavel_doc_tipo"  value="" />
              </>
            )}

            {/* ── Endereço ── */}
            <div>
              <p style={sectionTitle}>{t('addressSection')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                <Field label={t('countryField')}>
                  <select
                    name="country"
                    style={{ ...inputStyle, cursor: 'pointer' }}
                    value={country} onChange={e => handleCountryChange(e.target.value)}
                  >
                    <option value="BR"    style={{ color: '#000' }}>🇧🇷 Brasil (BR)</option>
                    <option value="AR"    style={{ color: '#000' }}>🇦🇷 Argentina (AR)</option>
                    <option value="UY"    style={{ color: '#000' }}>🇺🇾 Uruguay (UY)</option>
                    <option value="PY"    style={{ color: '#000' }}>🇵🇾 Paraguay (PY)</option>
                    <option value="CL"    style={{ color: '#000' }}>🇨🇱 Chile (CL)</option>
                    <option value="BO"    style={{ color: '#000' }}>🇧🇴 Bolivia (BO)</option>
                    <option value="PE"    style={{ color: '#000' }}>🇵🇪 Peru (PE)</option>
                    <option value="CO"    style={{ color: '#000' }}>🇨🇴 Colombia (CO)</option>
                    <option value="VE"    style={{ color: '#000' }}>🇻🇪 Venezuela (VE)</option>
                    <option value="US"    style={{ color: '#000' }}>🇺🇸 United States (US)</option>
                    <option value="DE"    style={{ color: '#000' }}>🇩🇪 Germany (DE)</option>
                    <option value="FR"    style={{ color: '#000' }}>🇫🇷 France (FR)</option>
                    <option value="IT"    style={{ color: '#000' }}>🇮🇹 Italy (IT)</option>
                    <option value="ES"    style={{ color: '#000' }}>🇪🇸 Spain (ES)</option>
                    <option value="PT"    style={{ color: '#000' }}>🇵🇹 Portugal (PT)</option>
                    <option value="GB"    style={{ color: '#000' }}>🇬🇧 United Kingdom (GB)</option>
                    <option value="OTHER" style={{ color: '#000' }}>Outro</option>
                  </select>
                </Field>

                {/* CEP e UF — visível apenas para BR (controlado via DOM ref) */}
                <div
                  ref={cepUfRef}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}
                >
                  <Field label={t('zipcodeField')}>
                    <input
                      name="zipcode"
                      style={inputStyle} type="text"
                      value={zipcode} onChange={e => setZipcode(e.target.value)}
                      placeholder="00000-000"
                    />
                  </Field>
                  <Field label={t('stateField')}>
                    <input
                      name="state"
                      style={inputStyle} type="text"
                      value={state} onChange={e => setState(e.target.value)}
                      placeholder="RJ" maxLength={2}
                    />
                  </Field>
                </div>

                <Row>
                  <Field label={t('cityField')}>
                    <input
                      name="city"
                      style={inputStyle} type="text"
                      value={city} onChange={e => setCity(e.target.value)}
                      placeholder="Cidade"
                    />
                  </Field>
                  <Field label={t('neighborhoodField')}>
                    <input
                      name="neighborhood"
                      style={inputStyle} type="text"
                      value={neighborhood} onChange={e => setNeighborhood(e.target.value)}
                      placeholder="Bairro"
                    />
                  </Field>
                </Row>

                <Field label={t('streetField')}>
                  <input
                    name="street"
                    style={inputStyle} type="text"
                    value={street} onChange={e => setStreet(e.target.value)}
                    placeholder="Rua, número"
                  />
                </Field>

              </div>
            </div>

            {/* Erro */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '0.75rem 1rem' }}>
                <span style={{ color: '#fca5a5', fontSize: '0.9rem' }}>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={saving || uploading}
              style={{
                padding: '1rem', borderRadius: 50, border: 'none',
                cursor: (saving || uploading) ? 'not-allowed' : 'pointer',
                background: (saving || uploading) ? 'rgba(0,133,174,0.5)' : '#0085ae',
                color: '#fff', fontWeight: 700, fontSize: '1.05rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              }}
            >
              {uploading
                ? <><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Enviando fotos...</>
                : saving
                  ? <><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> {t('saving')}</>
                  : t('saveData')
              }
            </button>
          </form>
        </div>

        <button
          onClick={() => navigate(`/web-checkin/${hotelId}/guests/${bookingId}`)}
          style={{ display: 'block', margin: '1.25rem auto 0', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}
        >
          {t('back')}
        </button>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(255,255,255,0.35); }
        input:focus, select:focus { border-color: #0085ae !important; }
        option { background: #1e1e2e; }
      `}</style>
    </div>
  );
}
