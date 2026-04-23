// src/pages/webcheckin/WCIFNRHForm.tsx
// Formulário FNRH — leitura via FormData (bulletproof contra autofill e timing React)
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClipboardList, Loader2, CheckCircle } from 'lucide-react';
import { useWCI } from './WebCheckinLayout';
import {
  loadGuestsFromStorage,
  saveGuestsToStorage,
  saveGuestFNRH,
  WebCheckinGuest,
} from './webCheckinService';
import type { ErbonGuestPayload } from '../../lib/erbonService';

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

  // Ref para controle DOM do bloco CEP/UF
  const cepUfRef = useRef<HTMLDivElement>(null);

  // Pré-preencher de localStorage se estiver editando hóspede existente
  useEffect(() => {
    if (!bookingId) return;
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
  }, [bookingId, guestId]);

  const handleCountryChange = (value: string) => {
    setCountry(value);
    if (value !== 'BR') {
      setState(''); setZipcode('');
      if (cepUfRef.current) cepUfRef.current.style.display = 'none';
    } else {
      if (cepUfRef.current) cepUfRef.current.style.display = 'grid';
    }
  };

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

    // Validação
    if (!domName)       { setError('Nome completo é obrigatório.');        return; }
    if (!domEmail)      { setError('E-mail é obrigatório.');               return; }
    if (!domDocNumber)  { setError('Número do documento é obrigatório.');  return; }

    const addressCountry = (domCountry && domCountry !== 'OTHER') ? domCountry : 'BR';
    const isBR           = addressCountry === 'BR';

    setSaving(true);
    setError('');

    try {
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

      console.log('[FNRH] payload enviado:', JSON.stringify(payload));

      const savedId = await saveGuestFNRH(
        hotelId,
        Number(bookingId),
        guestId,
        payload
      );

      const fullName = domName;
      const stored   = loadGuestsFromStorage(bookingId) || [];

      if (isNew) {
        const newGuest: WebCheckinGuest = {
          id: savedId,
          name:  fullName,
          email: domEmail,
          phone: domPhone,
          documents: payload.documents,
          fnrhCompleted: true,
          isMainGuest:  false,
        };
        saveGuestsToStorage(bookingId, [...stored, newGuest]);
      } else {
        const updated = stored.map(g =>
          g.id === guestId
            ? { ...g, name: fullName, email: domEmail, phone: domPhone, fnrhCompleted: true }
            : g
        );
        saveGuestsToStorage(bookingId, updated);
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
              disabled={saving}
              style={{
                padding: '1rem', borderRadius: 50, border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? 'rgba(0,133,174,0.5)' : '#0085ae',
                color: '#fff', fontWeight: 700, fontSize: '1.05rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              }}
            >
              {saving
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
