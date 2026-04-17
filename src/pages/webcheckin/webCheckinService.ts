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
}

// ── Cache em memória (evita chamadas Supabase repetidas por navegação) ─────

const _hotelCache = new Map<string, { id: string; erbonHotelId: string } | null>();
const _sessionCache = new Map<string, { bookingId: number; guests: WebCheckinGuest[] } | null>();

// ── Hotéis disponíveis ─────────────────────────────────────────────────────

export async function fetchWebCheckinHotels(): Promise<WebCheckinHotel[]> {
  const { data, error } = await anonClient
    .from('hotels')
    .select(`
      id, name, image_url, description, wci_code,
      wci_visible, wci_hotel_terms, wci_lgpd_terms,
      erbon_hotel_config!inner(erbon_hotel_id, is_active)
    `)
    .eq('erbon_hotel_config.is_active', true)
    .neq('wci_visible', false)
    .order('name');

  if (error) throw error;

  return (data || []).map((h: any) => ({
    id: h.id,
    wci_code: h.wci_code || h.id,   // fallback ao UUID se code não definido
    name: h.name,
    image_url: h.image_url || null,
    logo_url: null,
    description: h.description || null,
    erbonHotelId: h.erbon_hotel_config?.[0]?.erbon_hotel_id || h.erbon_hotel_config?.erbon_hotel_id || '',
    hasErbon: true,
    wci_hotel_terms: h.wci_hotel_terms || null,
    wci_lgpd_terms: h.wci_lgpd_terms || null,
  }));
}

/**
 * Resolve wci_code → { id (UUID Supabase), erbonHotelId }.
 * Resultado em cache de memória por sessão de página.
 */
export async function resolveHotelByCode(
  wciCode: string
): Promise<{ id: string; erbonHotelId: string } | null> {
  if (_hotelCache.has(wciCode)) return _hotelCache.get(wciCode)!;
  const { data } = await anonClient
    .from('hotels')
    .select('id, erbon_hotel_config!inner(erbon_hotel_id, is_active)')
    .eq('wci_code', wciCode)
    .single();
  if (!data) { _hotelCache.set(wciCode, null); return null; }
  const result = {
    id: data.id,
    erbonHotelId: (data as any).erbon_hotel_config?.[0]?.erbon_hotel_id
      || (data as any).erbon_hotel_config?.erbon_hotel_id || '',
  };
  _hotelCache.set(wciCode, result);
  return result;
}

/** Busca políticas de um hotel específico (management). */
export async function fetchHotelPolicies(hotelId: string): Promise<{
  wci_hotel_terms: string | null;
  wci_lgpd_terms: string | null;
  wci_visible: boolean;
}> {
  const { data, error } = await anonClient
    .from('hotels')
    .select('wci_hotel_terms, wci_lgpd_terms, wci_visible')
    .eq('id', hotelId)
    .single();
  if (error) throw error;
  return {
    wci_hotel_terms: data?.wci_hotel_terms ?? null,
    wci_lgpd_terms: data?.wci_lgpd_terms ?? null,
    wci_visible: data?.wci_visible ?? true,
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
    const result = await erbonService.updateGuest(hotelId, guestId, payload);
    return result?.id ?? guestId;
  } else {
    const result = await erbonService.addGuestToBooking(hotelId, bookingInternalId, payload);
    return result?.id ?? 0;
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

const STORAGE_KEY = (bookingId: string | number) => `wci_guests_${bookingId}`;

/** Gera token URL-safe aleatório (12 chars, a-z0-9). */
function generateToken(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, b => chars[b % chars.length]).join('');
}

/**
 * Cria uma nova sessão WCI com token opaco.
 * Armazena em Supabase e localStorage.
 * Retorna o token para uso nas URLs públicas.
 */
export async function createWCISession(
  bookingId: number,
  hotelId: string,
  guests: WebCheckinGuest[]
): Promise<string> {
  const token = generateToken();
  localStorage.setItem(STORAGE_KEY(bookingId), JSON.stringify(guests));
  try {
    await anonClient.from('wci_sessions').upsert({
      booking_id: String(bookingId),
      hotel_id: hotelId,
      guests,
      session_token: token,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'booking_id' });
  } catch { /* best-effort */ }
  _sessionCache.set(token, { bookingId, guests });
  return token;
}

/**
 * Resolve token de sessão → { bookingId (Erbon internal ID), guests }.
 * Busca em Supabase, resultado cacheado em memória.
 */
export async function resolveSession(
  sessionToken: string
): Promise<{ bookingId: number; guests: WebCheckinGuest[] } | null> {
  if (_sessionCache.has(sessionToken)) return _sessionCache.get(sessionToken)!;
  try {
    const { data } = await anonClient
      .from('wci_sessions')
      .select('booking_id, guests')
      .eq('session_token', sessionToken)
      .single();
    if (!data) { _sessionCache.set(sessionToken, null); return null; }
    const result = {
      bookingId: Number(data.booking_id),
      guests: (data.guests as WebCheckinGuest[]) || [],
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
