// src/pages/webcheckin/WebCheckinLayout.tsx
// Layout isolado para o Web Check-in — sem Navbar, sem sidebar.
// Fundo: imagem dark_marble com overlay, design glassmorphism.

import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Globe, Sun, Moon } from 'lucide-react';

type Lang = 'pt' | 'en' | 'es';
type Theme = 'dark' | 'light';

interface WebCheckinContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  t: (key: string) => string;
}

export const WebCheckinContext = React.createContext<WebCheckinContextValue>({
  lang: 'pt', setLang: () => {}, theme: 'dark', setTheme: () => {}, t: k => k,
});

export function useWCI() { return React.useContext(WebCheckinContext); }

// ── Translations ────────────────────────────────────────────────────────────

const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  pt: {
    tapToStart: 'Toque para iniciar',
    selectHotel: 'Selecione seu hotel',
    searchReservation: 'Buscar Reserva',
    searchPlaceholder: 'Número da reserva, e-mail ou nome do hóspede',
    searching: 'Buscando...',
    search: 'Buscar',
    notFound: 'Reserva não encontrada. Tente o e-mail ou procure a recepção.',
    guestList: 'Hóspedes da Reserva',
    bookingId: 'Reserva',
    fillFNRHHelp: 'Cada hóspede precisa preencher a Ficha Nacional de Registro (FNRH)',
    fillHere: 'Preencher',
    fnrhDone: '✓ Ficha preenchida',
    fnrhPending: 'Pendente',
    mainGuest: 'Principal',
    addGuest: 'Adicionar Acompanhante',
    continueCheckin: 'Continuar Check-in',
    fillQR: 'Preencher pelo celular (QR)',
    pointCamera: 'Aponte a câmera',
    pointCameraDesc: 'Escaneie o QR com seu celular para preencher sua ficha',
    newSearch: '← Nova Busca',
    back: '← Voltar',
    fillFNRHTitle: 'Ficha Nacional de Registro de Hóspedes',
    // Form fields
    nameField: 'Nome Completo *',
    emailField: 'E-mail *',
    phoneField: 'Telefone / WhatsApp *',
    documentTypeField: 'Tipo de Documento *',
    documentField: 'Número do Documento *',
    birthField: 'Data de Nascimento *',
    nationalityField: 'Nacionalidade *',
    professionField: 'Profissão',
    genderField: 'Gênero',
    vehicleField: 'Placa do Veículo',
    addressSection: 'Endereço',
    countryField: 'País',
    stateField: 'Estado / UF',
    cityField: 'Cidade',
    streetField: 'Rua / Logradouro',
    zipcodeField: 'CEP',
    neighborhoodField: 'Bairro',
    saveData: 'Salvar Ficha',
    saving: 'Salvando...',
    // Signature
    signatureTitle: 'Termos e Assinatura',
    signatureDesc: 'Leia os termos, aceite e assine digitalmente para concluir.',
    lgpdAccept: 'Li e aceito os termos de uso e política de privacidade (LGPD)',
    digitalSignature: 'Assinatura Digital',
    clearSignature: 'Limpar',
    sending: 'Finalizando...',
    finishCheckin: 'Finalizar Check-in',
    successTitle: 'Check-in Realizado!',
    successDesc: 'Suas fichas foram registradas com sucesso. Dirija-se à recepção para pegar as chaves.',
    backStart: 'Voltar ao Início',
    newGuest: 'Novo Hóspede',
    male: 'Masculino', female: 'Feminino', other: 'Outro',
    cpf: 'CPF', rg: 'RG', passport: 'Passaporte', cnh: 'CNH',
    errorGeneral: 'Ocorreu um erro. Por favor, tente novamente.',
  },
  en: {
    tapToStart: 'Tap to start',
    selectHotel: 'Select your hotel',
    searchReservation: 'Search Reservation',
    searchPlaceholder: 'Booking number, email or guest name',
    searching: 'Searching...', search: 'Search',
    notFound: 'Reservation not found. Try email or visit the front desk.',
    guestList: 'Reservation Guests', bookingId: 'Booking',
    fillFNRHHelp: 'Each guest must fill in the National Guest Registration Form (FNRH)',
    fillHere: 'Fill In', fnrhDone: '✓ Completed', fnrhPending: 'Pending',
    mainGuest: 'Main', addGuest: 'Add Companion', continueCheckin: 'Continue Check-in',
    fillQR: 'Fill on mobile (QR)', pointCamera: 'Point your camera', pointCameraDesc: 'Scan the QR with your phone',
    newSearch: '← New Search', back: '← Back', fillFNRHTitle: 'National Guest Registration',
    nameField: 'Full Name *', emailField: 'Email *', phoneField: 'Phone / WhatsApp *',
    documentTypeField: 'Document Type *', documentField: 'Document Number *',
    birthField: 'Date of Birth *', nationalityField: 'Nationality *', professionField: 'Profession',
    genderField: 'Gender', vehicleField: 'Vehicle Plate',
    addressSection: 'Address', countryField: 'Country', stateField: 'State', cityField: 'City',
    streetField: 'Street', zipcodeField: 'Zip Code', neighborhoodField: 'Neighborhood',
    saveData: 'Save Form', saving: 'Saving...',
    signatureTitle: 'Terms & Signature', signatureDesc: 'Read, accept and sign digitally.',
    lgpdAccept: 'I accept the terms and privacy policy (LGPD)', digitalSignature: 'Digital Signature',
    clearSignature: 'Clear', sending: 'Finalizing...', finishCheckin: 'Finalize Check-in',
    successTitle: 'Check-in Complete!', successDesc: 'Your forms have been registered. Please go to the front desk for your keys.',
    backStart: 'Back to Start', newGuest: 'New Guest',
    male: 'Male', female: 'Female', other: 'Other',
    cpf: 'CPF', rg: 'ID', passport: 'Passport', cnh: 'Driver License',
    errorGeneral: 'An error occurred. Please try again.',
  },
  es: {
    tapToStart: 'Toque para comenzar',
    selectHotel: 'Seleccione su hotel',
    searchReservation: 'Buscar Reserva', searchPlaceholder: 'Número de reserva, email o nombre',
    searching: 'Buscando...', search: 'Buscar',
    notFound: 'Reserva no encontrada. Intente con email o visite recepción.',
    guestList: 'Huéspedes de la Reserva', bookingId: 'Reserva',
    fillFNRHHelp: 'Cada huésped debe completar la Ficha Nacional de Registro',
    fillHere: 'Completar', fnrhDone: '✓ Completado', fnrhPending: 'Pendiente',
    mainGuest: 'Principal', addGuest: 'Agregar Acompañante', continueCheckin: 'Continuar Check-in',
    fillQR: 'Completar por móvil (QR)', pointCamera: 'Apunte la cámara', pointCameraDesc: 'Escanee el QR con su teléfono',
    newSearch: '← Nueva Búsqueda', back: '← Volver', fillFNRHTitle: 'Ficha Nacional de Registro',
    nameField: 'Nombre Completo *', emailField: 'Email *', phoneField: 'Teléfono / WhatsApp *',
    documentTypeField: 'Tipo de Documento *', documentField: 'Número de Documento *',
    birthField: 'Fecha de Nacimiento *', nationalityField: 'Nacionalidad *', professionField: 'Profesión',
    genderField: 'Género', vehicleField: 'Matrícula del Vehículo',
    addressSection: 'Dirección', countryField: 'País', stateField: 'Estado', cityField: 'Ciudad',
    streetField: 'Calle', zipcodeField: 'Código Postal', neighborhoodField: 'Barrio',
    saveData: 'Guardar Ficha', saving: 'Guardando...',
    signatureTitle: 'Términos y Firma', signatureDesc: 'Lea, acepte y firme digitalmente.',
    lgpdAccept: 'Acepto los términos y política de privacidad (LGPD)', digitalSignature: 'Firma Digital',
    clearSignature: 'Limpiar', sending: 'Finalizando...', finishCheckin: 'Finalizar Check-in',
    successTitle: '¡Check-in Realizado!', successDesc: 'Sus fichas han sido registradas. Diríjase a recepción para las llaves.',
    backStart: 'Volver al Inicio', newGuest: 'Nuevo Huésped',
    male: 'Masculino', female: 'Femenino', other: 'Otro',
    cpf: 'CPF', rg: 'DNI', passport: 'Pasaporte', cnh: 'Licencia',
    errorGeneral: 'Ocurrió un error. Intente nuevamente.',
  },
};

// ── Provider + Layout ────────────────────────────────────────────────────────

export default function WebCheckinLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isRoot = location.pathname === '/web-checkin' || location.pathname === '/web-checkin/';

  const [lang, setLangState] = React.useState<Lang>(() =>
    (localStorage.getItem('wci_lang') as Lang) || 'pt'
  );
  const [theme, setThemeState] = React.useState<Theme>(() =>
    (localStorage.getItem('wci_theme') as Theme) || 'dark'
  );

  const setLang = (l: Lang) => { setLangState(l); localStorage.setItem('wci_lang', l); };
  const setTheme = (t: Theme) => { setThemeState(t); localStorage.setItem('wci_theme', t); };
  const t = (key: string) => TRANSLATIONS[lang][key] ?? key;

  return (
    <WebCheckinContext.Provider value={{ lang, setLang, theme, setTheme, t }}>
      <div
        className="wci-root"
        style={{
          minHeight: '100vh',
          backgroundImage: `url('/dark_marble.png')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
          position: 'relative',
          color: theme === 'dark' ? '#fdfdfd' : '#1e1e1e',
        }}
      >
        {/* Overlay */}
        <div style={{
          position: 'fixed', inset: 0,
          background: theme === 'dark'
            ? 'rgba(0,0,0,0.65)'
            : 'rgba(255,255,255,0.45)',
          pointerEvents: 'none', zIndex: 0,
        }} />

        {/* Top bar — oculta na tela de idle */}
        {!isRoot && (
          <div style={{
            position: 'relative', zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '1rem 2rem',
            background: 'rgba(0,0,0,0.3)',
            backdropFilter: 'blur(8px)',
          }}>
            <button
              onClick={() => navigate('/web-checkin')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: 0 }}
              title="Voltar à tela inicial"
            >
              <span style={{ fontSize: '1.3rem', fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', display: 'block' }}>
                Meridiana
              </span>
              <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.2em', textTransform: 'uppercase', display: 'block' }}>
                Hoteles
              </span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Globe size={16} style={{ opacity: 0.7 }} />
              <select value={lang} onChange={e => setLang(e.target.value as Lang)}
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: 8, padding: '4px 8px', fontSize: 13, cursor: 'pointer' }}>
                <option value="pt" style={{ color: '#000' }}>Português</option>
                <option value="en" style={{ color: '#000' }}>English</option>
                <option value="es" style={{ color: '#000' }}>Español</option>
              </select>
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
        )}

        {/* Page content */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Outlet />
        </div>
      </div>
    </WebCheckinContext.Provider>
  );
}
