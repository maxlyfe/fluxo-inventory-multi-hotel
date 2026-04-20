// src/pages/webcheckin/WCIFNRHForm.tsx
// Formulário FNRH completo — campos do ErbonGuestPayload
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

export default function WCIFNRHForm() {
  const { hotelId, bookingId, guestId: guestIdParam } = useParams<{
    hotelId: string; bookingId: string; guestId: string;
  }>();
  const navigate = useNavigate();
  const { t } = useWCI();

  const isNew = !guestIdParam || guestIdParam.startsWith('new_') || guestIdParam === '0';
  const guestId = isNew ? null : Number(guestIdParam);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [genderID, setGenderID] = useState<number>(0);
  const [nationality, setNationality] = useState('BR');
  const [profession, setProfession] = useState('');

  // Document
  const [documentType, setDocumentType] = useState('CPF');
  const [documentNumber, setDocumentNumber] = useState('');

  // Address
  const [country, setCountry] = useState('BR');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [neighborhood, setNeighborhood] = useState('');

  // Pre-fill from localStorage if editing existing guest
  useEffect(() => {
    if (!bookingId) return;
    const stored = loadGuestsFromStorage(bookingId);
    if (!stored) return;
    const guest = stored.find(g => g.id === guestId);
    if (!guest) return;

    setName(guest.name || '');
    setEmail(guest.email || '');
    setPhone(guest.phone || '');

    if (guest.documents?.length) {
      setDocumentType(guest.documents[0].documentType || 'CPF');
      setDocumentNumber(guest.documents[0].number || '');
    }
  }, [bookingId, guestId]);

  // Ref para controlar visibilidade do bloco CEP+UF diretamente no DOM
  // (garante ocultação imediata sem depender do ciclo de render do React)
  const cepUfRef = useRef<HTMLDivElement>(null);
  // Ref no select de País — lemos o valor real do DOM no submit para
  // garantir o país correto independente de qualquer problema de state
  const countrySelectRef = useRef<HTMLSelectElement>(null);

  const handleCountryChange = (value: string) => {
    setCountry(value);
    if (value !== 'BR') {
      setState('');
      setZipcode('');
      if (cepUfRef.current) cepUfRef.current.style.display = 'none';
    } else {
      if (cepUfRef.current) cepUfRef.current.style.display = 'grid';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotelId || !bookingId) return;

    if (!name.trim()) { setError('Nome completo é obrigatório.'); return; }
    if (!email.trim()) { setError('E-mail é obrigatório.'); return; }
    if (!documentNumber.trim()) { setError('Número do documento é obrigatório.'); return; }

    // Remove máscaras antes de enviar à Erbon
    const cleanDocNumber = documentNumber.trim().replace(/[\.\-\/\s]/g, '');
    const cleanZipcode = zipcode.replace(/\D/g, '');

    // Gênero: API Erbon espera INTEGER (1=Masc, 2=Fem).
    // 0, 3, 99 → omitir (API trata ausência como "não informado")
    const erbonGender = (genderID === 1 || genderID === 2) ? genderID : undefined;

    // País do endereço: lemos DIRETAMENTE do DOM para garantir o valor
    // real mesmo que o React state não tenha atualizado a tempo
    const domCountry = countrySelectRef.current?.value || country || 'BR';
    const addressCountry = (domCountry && domCountry !== 'OTHER') ? domCountry : 'OTHER';
    // CEP e UF: APENAS para Brasil — nunca enviados para estrangeiros
    const isBR = addressCountry === 'BR';

    setSaving(true);
    setError('');

    try {
      // Schema Erbon: { id, name, email, telephone, gender, birthDate, address, documents }
      // additionalProperties: false → campos extras causam 400!
      const payload: ErbonGuestPayload = {
        name: name.trim(),
        email: email.trim() || undefined,
        telephone: phone.trim() || undefined,   // campo se chama "telephone" na API, não "phone"
        birthDate: birthDate || undefined,
        gender: erbonGender,                    // integer, omitido quando não informado
        documents: cleanDocNumber ? [{
          documentType,
          number: cleanDocNumber,
          country: addressCountry,
        }] : [],
        address: {
          country: addressCountry,
          state:   isBR ? (state.trim()  || undefined) : undefined,
          zipcode: isBR ? (cleanZipcode  || undefined) : undefined,
          city:         city.trim()         || undefined,
          street:       street.trim()       || undefined,
          neighborhood: neighborhood.trim() || undefined,
        },
      };

      const savedId = await saveGuestFNRH(
        hotelId,
        Number(bookingId),
        guestId,
        payload
      );

      // Atualizar localStorage
      const stored = loadGuestsFromStorage(bookingId) || [];
      if (isNew) {
        // Adicionar novo hóspede
        const newGuest: WebCheckinGuest = {
          id: savedId,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          documents: payload.documents,
          fnrhCompleted: true,
          isMainGuest: false,
        };
        saveGuestsToStorage(bookingId, [...stored, newGuest]);
      } else {
        // Atualizar hóspede existente
        const updated = stored.map(g =>
          g.id === guestId
            ? { ...g, name: name.trim(), email: email.trim(), phone: phone.trim(), fnrhCompleted: true }
            : g
        );
        saveGuestsToStorage(bookingId, updated);
      }

      setSaved(true);
      // Voltar para lista após 1.5s
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
          <h2 style={{ color: '#fff', fontWeight: 800, fontSize: '1.5rem' }}>
            {t('fnrhDone')}
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: 'calc(100vh - 70px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: 720 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <ClipboardList size={40} color="#0085ae" style={{ marginBottom: '0.75rem' }} />
          <h1 style={{ fontSize: 'clamp(1.1rem,3.5vw,1.6rem)', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            {t('fillFNRHTitle')}
          </h1>
        </div>

        <div style={glassCard}>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Dados Pessoais */}
            <div>
              <p style={sectionTitle}>Dados Pessoais</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label={t('nameField')}>
                  <input
                    style={inputStyle} type="text"
                    value={name} onChange={e => setName(e.target.value)}
                    placeholder="Nome completo como no documento"
                    required autoFocus
                  />
                </Field>
                <Row>
                  <Field label={t('emailField')}>
                    <input style={inputStyle} type="email" value={email}
                      onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com" required />
                  </Field>
                  <Field label={t('phoneField')}>
                    <input style={inputStyle} type="tel" value={phone}
                      onChange={e => setPhone(e.target.value)} placeholder="+55 (11) 9 0000-0000" />
                  </Field>
                </Row>
                <Row>
                  <Field label={t('birthField')}>
                    <input style={inputStyle} type="date" value={birthDate}
                      onChange={e => setBirthDate(e.target.value)} />
                  </Field>
                  <Field label={t('genderField')}>
                    <select style={{ ...inputStyle, cursor: 'pointer' }}
                      value={genderID} onChange={e => setGenderID(Number(e.target.value))}>
                      <option value={0} style={{ color: '#000' }}>— Selecione</option>
                      <option value={1} style={{ color: '#000' }}>{t('male')}</option>
                      <option value={2} style={{ color: '#000' }}>{t('female')}</option>
                      <option value={3} style={{ color: '#000' }}>{t('other')}</option>
                      <option value={99} style={{ color: '#000' }}>Prefiro não informar</option>
                    </select>
                  </Field>
                </Row>
                <Row>
                  <Field label={t('nationalityField')}>
                    <select style={{ ...inputStyle, cursor: 'pointer' }}
                      value={nationality} onChange={e => setNationality(e.target.value)}>
                      <option value="BR" style={{ color: '#000' }}>🇧🇷 Brasileiro(a)</option>
                      <option value="AR" style={{ color: '#000' }}>🇦🇷 Argentino(a)</option>
                      <option value="UY" style={{ color: '#000' }}>🇺🇾 Uruguaio(a)</option>
                      <option value="PY" style={{ color: '#000' }}>🇵🇾 Paraguaio(a)</option>
                      <option value="CL" style={{ color: '#000' }}>🇨🇱 Chileno(a)</option>
                      <option value="BO" style={{ color: '#000' }}>🇧🇴 Boliviano(a)</option>
                      <option value="PE" style={{ color: '#000' }}>🇵🇪 Peruano(a)</option>
                      <option value="CO" style={{ color: '#000' }}>🇨🇴 Colombiano(a)</option>
                      <option value="VE" style={{ color: '#000' }}>🇻🇪 Venezuelano(a)</option>
                      <option value="US" style={{ color: '#000' }}>🇺🇸 Americano(a)</option>
                      <option value="DE" style={{ color: '#000' }}>🇩🇪 Alemão/ã</option>
                      <option value="FR" style={{ color: '#000' }}>🇫🇷 Francês/esa</option>
                      <option value="IT" style={{ color: '#000' }}>🇮🇹 Italiano(a)</option>
                      <option value="ES" style={{ color: '#000' }}>🇪🇸 Espanhol(a)</option>
                      <option value="PT" style={{ color: '#000' }}>🇵🇹 Português(a)</option>
                      <option value="GB" style={{ color: '#000' }}>🇬🇧 Britânico(a)</option>
                      <option value="OTHER" style={{ color: '#000' }}>Outro</option>
                    </select>
                  </Field>
                  <Field label={t('professionField')}>
                    <input style={inputStyle} type="text" value={profession}
                      onChange={e => setProfession(e.target.value)} placeholder="Opcional" />
                  </Field>
                </Row>
              </div>
            </div>

            {/* Documento */}
            <div>
              <p style={sectionTitle}>Documento de Identidade</p>
              <Row>
                <Field label={t('documentTypeField')}>
                  <select style={{ ...inputStyle, cursor: 'pointer' }}
                    value={documentType} onChange={e => setDocumentType(e.target.value)}>
                    <option value="CPF" style={{ color: '#000' }}>{t('cpf')}</option>
                    <option value="RG" style={{ color: '#000' }}>{t('rg')}</option>
                    <option value="PASSPORT" style={{ color: '#000' }}>{t('passport')}</option>
                    <option value="CNH" style={{ color: '#000' }}>{t('cnh')}</option>
                  </select>
                </Field>
                <Field label={t('documentField')}>
                  <input style={inputStyle} type="text" value={documentNumber}
                    onChange={e => setDocumentNumber(e.target.value)} placeholder="000.000.000-00" required />
                </Field>
              </Row>
            </div>

            {/* Endereço */}
            <div>
              <p style={sectionTitle}>{t('addressSection')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* País — sempre visível */}
                <Field label={t('countryField')}>
                  <select
                    ref={countrySelectRef}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                    value={country} onChange={e => handleCountryChange(e.target.value)}>
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

                {/* CEP e Estado/UF — APENAS para Brasil
                    Controlado por ref DOM para garantir ocultação imediata
                    independente do ciclo de render do React */}
                <div
                  ref={cepUfRef}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: '1rem',
                  }}
                >
                  <Field label={t('zipcodeField')}>
                    <input style={inputStyle} type="text" value={zipcode}
                      onChange={e => setZipcode(e.target.value)} placeholder="00000-000" />
                  </Field>
                  <Field label={t('stateField')}>
                    <input style={inputStyle} type="text" value={state}
                      onChange={e => setState(e.target.value)} placeholder="RJ" maxLength={2} />
                  </Field>
                </div>

                {/* Cidade, Bairro, Rua — todos os países */}
                <Row>
                  <Field label={t('cityField')}>
                    <input style={inputStyle} type="text" value={city}
                      onChange={e => setCity(e.target.value)} placeholder="Cidade" />
                  </Field>
                  <Field label={t('neighborhoodField')}>
                    <input style={inputStyle} type="text" value={neighborhood}
                      onChange={e => setNeighborhood(e.target.value)} placeholder="Bairro" />
                  </Field>
                </Row>
                <Field label={t('streetField')}>
                  <input style={inputStyle} type="text" value={street}
                    onChange={e => setStreet(e.target.value)} placeholder="Rua, número" />
                </Field>
              </div>
            </div>

            {/* Error */}
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

        {/* Back */}
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
