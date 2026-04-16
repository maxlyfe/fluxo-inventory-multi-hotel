// src/pages/webcheckin/WCIFNRHForm.tsx
// Formulário FNRH completo — campos do ErbonGuestPayload
import React, { useEffect, useState } from 'react';
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
  const [vehicleRegistration, setVehicleRegistration] = useState('');

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

  const handleSave = async (e: React.FormEvent) => {
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
        phone: phone.trim(),
        birthDate: birthDate || undefined,
        genderID: genderID || undefined,
        nationality: nationality || 'BR',
        profession: profession || undefined,
        vehicleRegistration: vehicleRegistration || undefined,
        documents: documentNumber.trim() ? [{
          documentType,
          number: documentNumber.trim(),
          country: country || 'BR',
        }] : [],
        address: {
          country: country || 'BR',
          state: state || undefined,
          city: city || undefined,
          street: street || undefined,
          zipcode: zipcode || undefined,
          neighborhood: neighborhood || undefined,
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
                      <option value={0} style={{ color: '#000' }}>—</option>
                      <option value={1} style={{ color: '#000' }}>{t('male')}</option>
                      <option value={2} style={{ color: '#000' }}>{t('female')}</option>
                      <option value={3} style={{ color: '#000' }}>{t('other')}</option>
                    </select>
                  </Field>
                </Row>
                <Row>
                  <Field label={t('nationalityField')}>
                    <input style={inputStyle} type="text" value={nationality}
                      onChange={e => setNationality(e.target.value)} placeholder="BR" />
                  </Field>
                  <Field label={t('professionField')}>
                    <input style={inputStyle} type="text" value={profession}
                      onChange={e => setProfession(e.target.value)} placeholder="Opcional" />
                  </Field>
                </Row>
                <Field label={t('vehicleField')}>
                  <input style={inputStyle} type="text" value={vehicleRegistration}
                    onChange={e => setVehicleRegistration(e.target.value.toUpperCase())}
                    placeholder="ABC-1234 (opcional)" />
                </Field>
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
                <Row>
                  <Field label={t('countryField')}>
                    <input style={inputStyle} type="text" value={country}
                      onChange={e => setCountry(e.target.value)} placeholder="BR" />
                  </Field>
                  <Field label={t('zipcodeField')}>
                    <input style={inputStyle} type="text" value={zipcode}
                      onChange={e => setZipcode(e.target.value)} placeholder="00000-000" />
                  </Field>
                </Row>
                <Row>
                  <Field label={t('stateField')}>
                    <input style={inputStyle} type="text" value={state}
                      onChange={e => setState(e.target.value)} placeholder="SP" />
                  </Field>
                  <Field label={t('cityField')}>
                    <input style={inputStyle} type="text" value={city}
                      onChange={e => setCity(e.target.value)} placeholder="São Paulo" />
                  </Field>
                </Row>
                <Row>
                  <Field label={t('neighborhoodField')}>
                    <input style={inputStyle} type="text" value={neighborhood}
                      onChange={e => setNeighborhood(e.target.value)} placeholder="Centro" />
                  </Field>
                  <Field label={t('streetField')}>
                    <input style={inputStyle} type="text" value={street}
                      onChange={e => setStreet(e.target.value)} placeholder="Rua das Flores, 100" />
                  </Field>
                </Row>
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
