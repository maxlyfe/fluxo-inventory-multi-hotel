// src/pages/webcheckin/webCheckinService.ts
// Serviço isolado para o Web Check-in — não usa useHotel() nem auth
// Opera como cliente público (sem sessão Supabase autenticada).

import { createClient } from '@supabase/supabase-js';
import { erbonService, ErbonBooking, ErbonGuest, ErbonGuestPayload } from '../../lib/erbonService';

// Usa as mesmas env vars do projeto principal
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const anonClient   = createClient(supabaseUrl, supabaseAnon);

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface WebCheckinHotel {
  id: string;               // UUID do hotel no LyFe
  name: string;
  logo_url?: string | null;
  erbonHotelId: string;     // ID do hotel no Erbon (erbon_hotel_id)
  hasErbon: boolean;
}

export interface WebCheckinGuest {
  id: number;               // ID no Erbon (guestId)
  name: string;
  email?: string;
  phone?: string;
  documents?: Array<{ documentType: string; number: string }>;
  fnrhCompleted: boolean;
  isMainGuest: boolean;
  inHouseData?: ErbonGuest;
}

// ── Hotéis disponíveis (todos com config Erbon ativa) ─────────────────────

export async function fetchWebCheckinHotels(): Promise<WebCheckinHotel[]> {
  const { data, error } = await anonClient
    .from('hotels')
    .select(`
      id, name,
      erbon_hotel_config!inner(erbon_hotel_id, is_active)
    `)
    .eq('erbon_hotel_config.is_active', true)
    .order('name');

  if (error) throw error;

  return (data || []).map((h: any) => ({
    id: h.id,
    name: h.name,
    logo_url: null,
    erbonHotelId: h.erbon_hotel_config?.[0]?.erbon_hotel_id || h.erbon_hotel_config?.erbon_hotel_id || '',
    hasErbon: true,
  }));
}

// ── Buscar reserva (retorna booking + guests mesclados) ───────────────────

export async function searchReservation(
  hotelId: string,
  query: string
): Promise<{ booking: ErbonBooking; guests: WebCheckinGuest[] } | null> {
  const trimmed = query.trim();

  // Tenta por bookingNumber (numérico) ou mainguestEmail (contém @)
  const params: Record<string, string> = {};
  if (trimmed.includes('@')) {
    params.guestEmail = trimmed;
  } else if (/^\d+$/.test(trimmed)) {
    params.bookingNumber = trimmed;
  } else {
    // Fallback: tenta por checkin de hoje/próximos 7 dias filtrando por nome no resultado
    const today = new Date().toISOString().split('T')[0];
    const next7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    params.checkin  = today;
    params.checkout = next7;
  }

  const results = await erbonService.searchBookings(hotelId, params);
  if (!results.length) return null;

  // Se buscou por nome (não numérico, não email) — filtrar no lado cliente
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

  // Montar lista de hóspedes a partir do guestList da reserva
  const guests: WebCheckinGuest[] = (booking.guestList || []).map((g, idx) => ({
    id: g.id,
    name: g.name || 'Hóspede',
    email: g.email,
    phone: g.phone,
    documents: g.documents,
    fnrhCompleted: false, // será atualizado via localStorage
    isMainGuest: idx === 0,
  }));

  return { booking, guests };
}

// ── Adicionar / atualizar hóspede via Erbon (cria + attach) ─────────────

export async function saveGuestFNRH(
  hotelId: string,
  bookingInternalId: number,
  guestId: number | null,
  payload: ErbonGuestPayload
): Promise<number> {
  if (guestId && guestId > 0) {
    // Hóspede já existe → atualiza
    const result = await erbonService.updateGuest(hotelId, guestId, payload);
    return result?.id ?? guestId;
  } else {
    // Novo hóspede → cria e anexa
    const result = await erbonService.addGuestToBooking(hotelId, bookingInternalId, payload);
    return result?.id ?? 0;
  }
}

// ── Enviar assinatura e PDF ───────────────────────────────────────────────

export async function submitSignature(
  hotelId: string,
  bookingInternalId: number,
  signatureBase64: string // sem prefixo data:
): Promise<void> {
  const config = await erbonService.getConfig(hotelId);
  if (!config) throw new Error('Configuração Erbon não encontrada');
  const token = await erbonService.getToken(hotelId);

  const isDev = import.meta.env.DEV;
  const proxyBase = isDev ? '/erbon-api' : '/.netlify/functions/erbon-proxy';
  const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/signature`;

  const res = await fetch(isDev ? `${proxyBase}${path}` : proxyBase, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(isDev ? {} : { 'x-erbon-base-url': config.erbon_base_url, 'x-erbon-path': path }),
    },
    body: JSON.stringify(signatureBase64),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.warn(`[WebCheckin] submitSignature ${res.status}: ${txt}`);
    // Não lança erro — assinatura é best-effort
  }
}

export async function submitAttachment(
  hotelId: string,
  bookingInternalId: number,
  pdfBase64: string
): Promise<void> {
  const config = await erbonService.getConfig(hotelId);
  if (!config) throw new Error('Configuração Erbon não encontrada');
  const token = await erbonService.getToken(hotelId);

  const isDev = import.meta.env.DEV;
  const proxyBase = isDev ? '/erbon-api' : '/.netlify/functions/erbon-proxy';
  const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/attachment`;

  const res = await fetch(isDev ? `${proxyBase}${path}` : proxyBase, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(isDev ? {} : { 'x-erbon-base-url': config.erbon_base_url, 'x-erbon-path': path }),
    },
    body: JSON.stringify(pdfBase64),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.warn(`[WebCheckin] submitAttachment ${res.status}: ${txt}`);
  }
}

// ── localStorage helpers ──────────────────────────────────────────────────

const STORAGE_KEY = (bookingId: string | number) => `wci_guests_${bookingId}`;

export function loadGuestsFromStorage(bookingId: string | number): WebCheckinGuest[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(bookingId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveGuestsToStorage(bookingId: string | number, guests: WebCheckinGuest[]): void {
  localStorage.setItem(STORAGE_KEY(bookingId), JSON.stringify(guests));
}

export function clearGuestsFromStorage(bookingId: string | number): void {
  localStorage.removeItem(STORAGE_KEY(bookingId));
}
