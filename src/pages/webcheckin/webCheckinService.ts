// src/pages/webcheckin/webCheckinService.ts
// Serviço isolado para o Web Check-in — não usa useHotel() nem auth
// Opera como cliente público (sem sessão Supabase autenticada).

import { createClient } from '@supabase/supabase-js';
import { erbonService, ErbonBooking, ErbonGuest, ErbonGuestPayload } from '../../lib/erbonService';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const anonClient   = createClient(supabaseUrl, supabaseAnon);

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface WebCheckinHotel {
  id: string;               // UUID do hotel no Supabase
  wci_code: string;         // Slug opaco para URLs públicas (ex: "costa-do-sol")
  name: string;
  image_url?: string | null;
  logo_url?: string | null;
  description?: string | null;
  erbonHotelId: string;
  hasErbon: boolean;
  wci_hotel_terms?: string | null;
  wci_lgpd_terms?: string | null;
}

export interface WebCheckinGuest {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  documents?: Array<{ documentType: string; number: string }>;
  fnrhCompleted: boolean;
  isMainGuest: boolean;
  inHouseData?: ErbonGuest;
  // Perfil completo (do in-house ou do guest payload da Erbon)
  nationality?: string;   // ISO country code, ex: 'AR', 'BR'
  birthDate?: string;     // 'YYYY-MM-DD'
  genderID?: number;
  address?: {
    country?: string;
    state?: string;
    city?: string;
    street?: string;
    zipcode?: string;
    neighborhood?: string;
  };
  documentFrontUrl?: string;
  documentBackUrl?: string;
}

// ── Cache em memória (evita chamadas Supabase repetidas por navegação) ─────

const _hotelCache = new Map<string, { id: string; erbonHotelId: string; hasErbon: boolean } | null>();
const _sessionCache = new Map<string, { bookingId: number; guests: WebCheckinGuest[]; bookingNumber?: string | null } | null>();

// ── Utilitários de sessão (usados por createManualSession e createWCISession) ─

const STORAGE_KEY = (bookingId: string | number) => `wci_guests_${bookingId}`;

/** Gera token URL-safe aleatório (12 chars, a-z0-9). */
function generateToken(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, b => chars[b % chars.length]).join('');
}

// ── Hotéis disponíveis ─────────────────────────────────────────────────────

export async function fetchWebCheckinHotels(): Promise<WebCheckinHotel[]> {
  const { data, error } = await anonClient
    .from('hotels')
    .select(`
      id, name, image_url, description, wci_code,
      wci_visible, wci_hotel_terms, wci_lgpd_terms,
      erbon_hotel_config(erbon_hotel_id, is_active)
    `)
    .eq('wci_visible', true)
    .order('name');

  if (error) throw error;

  return (data || []).map((h: any) => {
    const erbonCfg = Array.isArray(h.erbon_hotel_config)
      ? h.erbon_hotel_config[0]
      : h.erbon_hotel_config;
    const erbonHotelId = erbonCfg?.erbon_hotel_id || '';
    const hasErbon = !!(erbonHotelId && erbonCfg?.is_active === true);
    return {
      id: h.id,
      wci_code: h.wci_code || h.id,   // fallback ao UUID se code não definido
      name: h.name,
      image_url: h.image_url || null,
      logo_url: null,
      description: h.description || null,
      erbonHotelId,
      hasErbon,
      wci_hotel_terms: h.wci_hotel_terms || null,
      wci_lgpd_terms: h.wci_lgpd_terms || null,
    };
  });
}

/**
 * Resolve wci_code → { id (UUID Supabase), erbonHotelId, hasErbon }.
 * Resultado em cache de memória por sessão de página.
 */
export async function resolveHotelByCode(
  wciCode: string
): Promise<{ id: string; erbonHotelId: string; hasErbon: boolean } | null> {
  if (_hotelCache.has(wciCode)) return _hotelCache.get(wciCode)!;
  const { data } = await anonClient
    .from('hotels')
    .select('id, erbon_hotel_config(erbon_hotel_id, is_active)')
    .eq('wci_code', wciCode)
    .single();
  if (!data) { _hotelCache.set(wciCode, null); return null; }
  const erbonCfg = Array.isArray((data as any).erbon_hotel_config)
    ? (data as any).erbon_hotel_config[0]
    : (data as any).erbon_hotel_config;
  const erbonHotelId = erbonCfg?.erbon_hotel_id || '';
  const hasErbon = !!(erbonHotelId && erbonCfg?.is_active === true);
  const result = { id: data.id, erbonHotelId, hasErbon };
  _hotelCache.set(wciCode, result);
  return result;
}

/**
 * Cria sessão manual para hotéis sem integração Erbon.
 * Gera um bookingId sintético (timestamp), cria a sessão em wci_sessions e
 * retorna o token opaco para uso nas URLs públicas.
 */
export async function createManualSession(
  hotelId: string,
  guestName: string,
  bookingNumber?: string
): Promise<string> {
  const syntheticBookingId = Date.now();
  const token = generateToken();
  const guests: WebCheckinGuest[] = [{
    id: 0,
    name: guestName.trim(),
    fnrhCompleted: false,
    isMainGuest: true,
  }];
  localStorage.setItem(STORAGE_KEY(syntheticBookingId), JSON.stringify(guests));
  try {
    await anonClient.from('wci_sessions').upsert({
      booking_id: String(syntheticBookingId),
      hotel_id: hotelId,
      guests,
      session_token: token,
      booking_number: bookingNumber || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'booking_id' });
  } catch { /* best-effort */ }
  _sessionCache.set(token, { bookingId: syntheticBookingId, guests });
  return token;
}

// ── Tipos para fichas ──────────────────────────────────────────────────────

export interface SaveFichaGuestParams {
  isMainGuest: boolean;
  erbonGuestId?: number | null;
  name: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  genderId?: number;
  nationality?: string;
  profession?: string;
  vehicleRegistration?: string;
  documentType?: string;
  documentNumber?: string;
  addressCountry?: string;
  addressState?: string;
  addressCity?: string;
  addressStreet?: string;
  addressZipcode?: string;
  addressNeighborhood?: string;
  documentFrontUrl?: string;
  documentBackUrl?: string;
}

export interface SaveFichaParams {
  hotelId: string;
  bookingNumber?: string;
  bookingInternalId?: number | null;
  roomNumber?: string;
  checkinDate?: string;
  checkoutDate?: string;
  guests: SaveFichaGuestParams[];
  hotelTermsAccepted: boolean;
  lgpdAccepted: boolean;
  signatureData?: string;
  hotelTermsText?: string;
  lgpdTermsText?: string;
  hotelRulesDocUrl?: string;
  lgpdDocUrl?: string;
  source?: 'web' | 'totem' | 'manual';
}

/**
 * Persiste uma ficha de check-in completa no banco.
 * INSERT em wci_checkin_fichas, depois INSERT de todos os hóspedes em wci_checkin_guests.
 * Retorna o UUID da ficha criada.
 */
export async function saveFichaToDatabase(params: SaveFichaParams): Promise<string> {
  const mainGuest = params.guests.find(g => g.isMainGuest) || params.guests[0];

  const { data: fichaData, error: fichaError } = await anonClient
    .from('wci_checkin_fichas')
    .insert({
      hotel_id: params.hotelId,
      booking_number: params.bookingNumber || null,
      booking_internal_id: params.bookingInternalId || null,
      room_number: params.roomNumber || null,
      checkin_date: params.checkinDate || null,
      checkout_date: params.checkoutDate || null,
      guest_name: mainGuest?.name || '',
      hotel_terms_accepted: params.hotelTermsAccepted,
      lgpd_accepted: params.lgpdAccepted,
      signature_data: params.signatureData || null,
      hotel_terms_text: params.hotelTermsText || null,
      lgpd_terms_text: params.lgpdTermsText || null,
      hotel_rules_doc_url: params.hotelRulesDocUrl || null,
      lgpd_doc_url: params.lgpdDocUrl || null,
      source: params.source || 'web',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (fichaError) throw fichaError;
  const fichaId: string = fichaData.id;

  const guestRows = params.guests.map(g => ({
    ficha_id: fichaId,
    is_main_guest: g.isMainGuest,
    erbon_guest_id: g.erbonGuestId || null,
    name: g.name,
    email: g.email || null,
    phone: g.phone || null,
    birth_date: g.birthDate || null,
    gender_id: g.genderId || null,
    nationality: g.nationality || null,
    profession: g.profession || null,
    vehicle_registration: g.vehicleRegistration || null,
    document_type: g.documentType || null,
    document_number: g.documentNumber || null,
    address_country: g.addressCountry || null,
    address_state: g.addressState || null,
    address_city: g.addressCity || null,
    address_street: g.addressStreet || null,
    address_zipcode: g.addressZipcode || null,
    address_neighborhood: g.addressNeighborhood || null,
    document_front_url: g.documentFrontUrl || null,
    document_back_url: g.documentBackUrl || null,
  }));

  const { error: guestsError } = await anonClient
    .from('wci_checkin_guests')
    .insert(guestRows);

  if (guestsError) throw guestsError;

  return fichaId;
}

/**
 * Faz upload de base64 (JPEG/PNG) para o bucket `wci-documents`.
 * Retorna a URL pública ou null em caso de erro.
 */
export async function uploadBase64ToStorage(
  base64: string,
  hotelId: string,
  filename: string,
  contentType = 'image/jpeg'
): Promise<string | null> {
  try {
    const byteChars = atob(base64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArray], { type: contentType });
    const path = `${hotelId}/${filename}`;
    const { error } = await anonClient.storage
      .from('wci-documents')
      .upload(path, blob, { upsert: true, contentType });
    if (error) return null;
    const { data } = anonClient.storage.from('wci-documents').getPublicUrl(path);
    return data.publicUrl;
  } catch { return null; }
}

/**
 * Faz upload de foto de documento para o bucket `wci-documents`.
 * Retorna a URL pública do arquivo.
 */
export async function uploadDocumentPhoto(
  file: File,
  hotelId: string,
  side: 'front' | 'back'
): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${hotelId}/${Date.now()}_${side}.${ext}`;

  const { error: uploadError } = await anonClient.storage
    .from('wci-documents')
    .upload(path, file, { upsert: false });

  if (uploadError) throw uploadError;

  const { data } = anonClient.storage
    .from('wci-documents')
    .getPublicUrl(path);

  return data.publicUrl;
}

/** Busca políticas de um hotel específico (todas as línguas). */
export async function fetchHotelPolicies(hotelId: string): Promise<{
  wci_hotel_terms: string | null;
  wci_lgpd_terms: string | null;
  wci_hotel_terms_en: string | null;
  wci_lgpd_terms_en: string | null;
  wci_hotel_terms_es: string | null;
  wci_lgpd_terms_es: string | null;
  wci_visible: boolean;
}> {
  const { data, error } = await anonClient
    .from('hotels')
    .select('wci_hotel_terms, wci_lgpd_terms, wci_hotel_terms_en, wci_lgpd_terms_en, wci_hotel_terms_es, wci_lgpd_terms_es, wci_visible')
    .eq('id', hotelId)
    .single();
  if (error) throw error;
  return {
    wci_hotel_terms:    data?.wci_hotel_terms    ?? null,
    wci_lgpd_terms:     data?.wci_lgpd_terms     ?? null,
    wci_hotel_terms_en: data?.wci_hotel_terms_en ?? null,
    wci_lgpd_terms_en:  data?.wci_lgpd_terms_en  ?? null,
    wci_hotel_terms_es: data?.wci_hotel_terms_es ?? null,
    wci_lgpd_terms_es:  data?.wci_lgpd_terms_es  ?? null,
    wci_visible:        data?.wci_visible         ?? true,
  };
}

// ── Buscar reserva ─────────────────────────────────────────────────────────

export async function searchReservation(
  hotelId: string,
  query: string
): Promise<{ booking: ErbonBooking; guests: WebCheckinGuest[] } | null> {
  const trimmed = query.trim();
  const params: Record<string, string> = {};

  if (trimmed.includes('@')) {
    params.guestEmail = trimmed;
  } else if (/^\d+$/.test(trimmed)) {
    params.bookingNumber = trimmed;
  } else {
    const today = new Date().toISOString().split('T')[0];
    const next7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    params.checkin  = today;
    params.checkout = next7;
  }

  const results = await erbonService.searchBookings(hotelId, params);
  if (!results.length) return null;

  let booking: ErbonBooking;
  if (!trimmed.includes('@') && !/^\d+$/.test(trimmed)) {
    const match = results.find(b =>
      b.guestList?.some(g => g.name?.toLowerCase().includes(trimmed.toLowerCase()))
    );
    if (!match) return null;
    booking = match;
  } else {
    booking = results[0];
  }

  const guests: WebCheckinGuest[] = (booking.guestList || []).map((g, idx) => ({
    id: g.id,
    name: g.name || 'Hóspede',
    email: g.email,
    phone: g.phone,
    documents: g.documents,
    fnrhCompleted: false,
    isMainGuest: idx === 0,
  }));

  return { booking, guests };
}

// ── Adicionar / atualizar hóspede via Erbon ───────────────────────────────

export async function saveGuestFNRH(
  hotelId: string,
  bookingInternalId: number,
  guestId: number | null,
  payload: ErbonGuestPayload
): Promise<number> {
  if (guestId && guestId > 0) {
    try {
      const result = await erbonService.updateGuest(hotelId, guestId, payload);
      return result?.id ?? guestId;
    } catch {
      // Hóspede pode ter sido excluído e recriado na Erbon (id inválido → 400).
      // Fallback: criar novo hóspede e vincular à reserva.
      const result = await erbonService.addGuestToBooking(hotelId, bookingInternalId, payload);
      return result?.id ?? 0;
    }
  } else {
    const result = await erbonService.addGuestToBooking(hotelId, bookingInternalId, payload);
    return result?.id ?? 0;
  }
}

/**
 * Busca hóspedes frescos da Erbon para uma reserva (por bookingInternalID).
 * Também busca o perfil completo via /guest/inhouse e /guest/todaycheckout
 * para cruzar nationality, birthDate, address — campos não retornados no guestList
 * da busca de reservas.
 * Retorna null se não encontrar a reserva.
 */
export async function fetchFreshBookingGuests(
  hotelId: string,
  bookingInternalId: number
): Promise<WebCheckinGuest[] | null> {
  try {
    // Busca direta por ID interno + perfis in-house em paralelo
    const [booking, inHouseGuests] = await Promise.all([
      erbonService.fetchBookingByInternalId(hotelId, bookingInternalId),
      erbonService.fetchInHouseGuests(hotelId).catch(() => [] as ErbonGuest[]),
    ]);

    if (!booking) return null;

    // Mapa rápido idGuest → ErbonGuest (perfil completo)
    const inHouseMap = new Map<number, ErbonGuest>();
    for (const ih of inHouseGuests) {
      if (ih.idGuest) inHouseMap.set(ih.idGuest, ih);
    }

    return (booking.guestList || []).map((g: any, idx) => {
      const ih = inHouseMap.get(g.id);

      // Extrair campos extras se a Erbon os retornar no guestList (fields extras via 'any')
      const rawNationality = g.nationality || g.countryISO || g.nationalityISO;
      const rawBirth       = g.birthDate   || g.birthdate  || g.birth_date;
      const rawGender      = g.genderID    || g.gender;
      const rawAddr        = g.address     || {};

      // Preferir perfil in-house (mais completo); fallback aos campos raw do guestList
      const nationality = ih?.countryGuestISO || rawNationality || undefined;
      const birthDate   = ih?.birthDate
        ? ih.birthDate.split('T')[0]
        : (rawBirth ? String(rawBirth).split('T')[0] : undefined);

      return {
        id:            g.id,
        name:          g.name  || 'Hóspede',
        email:         g.email,
        phone:         g.phone,
        documents:     g.documents,
        fnrhCompleted: false,
        isMainGuest:   idx === 0,
        inHouseData:   ih,
        nationality,
        birthDate,
        genderID: rawGender || undefined,
        address: {
          country:      ih?.countryGuestISO || rawAddr.country || nationality || undefined,
          state:        ih?.stateGuest      || rawAddr.state   || rawAddr.uf  || undefined,
          city:         ih?.localityGuest   || rawAddr.city    || undefined,
          street:       rawAddr.street      || rawAddr.logradouro || undefined,
          zipcode:      rawAddr.zipcode     || rawAddr.cep     || undefined,
          neighborhood: rawAddr.neighborhood|| rawAddr.bairro  || undefined,
        },
      } satisfies WebCheckinGuest;
    });
  } catch {
    return null;
  }
}

// ── Envio de dados para o Erbon ────────────────────────────────────────────

async function erbonPost(
  hotelId: string,
  path: string,
  body: string,
  extraHeaders?: Record<string, string>
): Promise<{ ok: boolean; status: number; text: string }> {
  const config = await erbonService.getConfig(hotelId);
  if (!config) throw new Error('Configuração Erbon não encontrada');
  const token = await erbonService.getToken(hotelId);

  const isDev = import.meta.env.DEV;
  const proxyBase = isDev ? '/erbon-api' : '/.netlify/functions/erbon-proxy';
  const url = isDev ? `${proxyBase}${path}` : proxyBase;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(isDev ? {} : {
        'x-erbon-base-url': config.erbon_base_url,
        'x-erbon-path': path,
      }),
      ...(extraHeaders || {}),
    },
    body,
  });

  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}

export async function submitSignature(
  hotelId: string,
  bookingInternalId: number,
  signatureBase64: string,
  guestId?: number
): Promise<void> {
  const config = await erbonService.getConfig(hotelId);
  if (!config) throw new Error('Configuração Erbon não encontrada');
  const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/signature`;
  const extraHeaders: Record<string, string> = {};
  if (guestId && guestId > 0) extraHeaders['idGuest'] = String(guestId);
  await erbonPost(hotelId, path, JSON.stringify(signatureBase64), extraHeaders);
}

export async function submitAttachment(
  hotelId: string,
  bookingInternalId: number,
  fileBase64: string,
  fileName?: string,
  fileType = 'pdf'
): Promise<boolean> {
  try {
    const config = await erbonService.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/attachment`;
    const safeFileName = fileName || `fnrh_${bookingInternalId}_${Date.now()}.${fileType.split('/').pop() || 'pdf'}`;
    const body = JSON.stringify({ fileName: safeFileName, fileType, fileBase64 });
    const result = await erbonPost(hotelId, path, body);
    return result.ok;
  } catch {
    return false;
  }
}

// ── Sessões WCI — URL protection + cross-device sync ──────────────────────
//
// Cada sessão de check-in tem um token opaco (12 chars aleatórios) que
// substitui o bookingInternalID (inteiro Erbon) nas URLs públicas.
// O token é armazenado na coluna wci_sessions.session_token.

/**
 * Cria uma nova sessão WCI com token opaco.
 * Armazena em Supabase e localStorage.
 * Retorna o token para uso nas URLs públicas.
 */
export async function createWCISession(
  bookingId: number,
  hotelId: string,
  guests: WebCheckinGuest[],
  bookingNumber?: string | null
): Promise<string> {
  const token = generateToken();
  localStorage.setItem(STORAGE_KEY(bookingId), JSON.stringify(guests));
  try {
    await anonClient.from('wci_sessions').upsert({
      booking_id: String(bookingId),
      hotel_id: hotelId,
      guests,
      session_token: token,
      booking_number: bookingNumber || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'booking_id' });
  } catch { /* best-effort */ }
  _sessionCache.set(token, { bookingId, guests, bookingNumber });
  return token;
}

/**
 * Resolve token de sessão → { bookingId (Erbon internal ID), guests, bookingNumber }.
 * Busca em Supabase, resultado cacheado em memória.
 */
export async function resolveSession(
  sessionToken: string
): Promise<{ bookingId: number; guests: WebCheckinGuest[]; bookingNumber?: string | null } | null> {
  if (_sessionCache.has(sessionToken)) return _sessionCache.get(sessionToken)!;
  try {
    const { data } = await anonClient
      .from('wci_sessions')
      .select('booking_id, guests, booking_number')
      .eq('session_token', sessionToken)
      .single();
    if (!data) { _sessionCache.set(sessionToken, null); return null; }
    const result = {
      bookingId: Number(data.booking_id),
      guests: (data.guests as WebCheckinGuest[]) || [],
      bookingNumber: (data as any).booking_number || null,
    };
    _sessionCache.set(sessionToken, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Atualiza hóspedes localmente e no Supabase.
 * Não toca o session_token existente (apenas guests + updated_at).
 */
export async function saveGuestsToStorage(
  bookingId: string | number,
  guests: WebCheckinGuest[],
  hotelId?: string
): Promise<void> {
  localStorage.setItem(STORAGE_KEY(bookingId), JSON.stringify(guests));
  try {
    await anonClient.from('wci_sessions').upsert({
      booking_id: String(bookingId),
      hotel_id: hotelId || '',
      guests,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'booking_id' });
    // Atualiza guests em qualquer entrada do cache de sessão para este booking
    for (const [tkn, session] of _sessionCache.entries()) {
      if (session && session.bookingId === Number(bookingId)) {
        _sessionCache.set(tkn, { ...session, guests });
      }
    }
  } catch { /* best-effort */ }
}

/** Carrega hóspedes: Supabase primeiro (cross-device), fallback localStorage. */
export async function loadGuestsFromServer(
  bookingId: string | number
): Promise<WebCheckinGuest[] | null> {
  try {
    const { data } = await anonClient
      .from('wci_sessions')
      .select('guests')
      .eq('booking_id', String(bookingId))
      .single();
    if (data?.guests && Array.isArray(data.guests) && data.guests.length > 0) {
      localStorage.setItem(STORAGE_KEY(bookingId), JSON.stringify(data.guests));
      return data.guests as WebCheckinGuest[];
    }
  } catch { /* fallback */ }
  return loadGuestsFromStorage(bookingId);
}

/** Síncrono — lê apenas do localStorage (sem await). */
export function loadGuestsFromStorage(bookingId: string | number): WebCheckinGuest[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(bookingId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearGuestsFromStorage(bookingId: string | number): void {
  localStorage.removeItem(STORAGE_KEY(bookingId));
  anonClient.from('wci_sessions').delete().eq('booking_id', String(bookingId)).then(() => {});
}
