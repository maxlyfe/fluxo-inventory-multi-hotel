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
  image_url?: string | null;
  logo_url?: string | null;
  description?: string | null;
  erbonHotelId: string;     // ID do hotel no Erbon (erbon_hotel_id)
  hasErbon: boolean;
  wci_hotel_terms?: string | null;
  wci_lgpd_terms?: string | null;
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
      id, name, image_url, description,
      wci_visible, wci_hotel_terms, wci_lgpd_terms,
      erbon_hotel_config!inner(erbon_hotel_id, is_active)
    `)
    .eq('erbon_hotel_config.is_active', true)
    .neq('wci_visible', false)
    .order('name');

  if (error) throw error;

  return (data || []).map((h: any) => ({
    id: h.id,
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

/** Busca as políticas de um hotel específico (para o web check-in e management). */
export async function fetchHotelPolicies(hotelId: string): Promise<{ wci_hotel_terms: string | null; wci_lgpd_terms: string | null; wci_visible: boolean }> {
  const { data, error } = await anonClient
    .from('hotels')
    .select('wci_hotel_terms, wci_lgpd_terms, wci_visible')
    .eq('id', hotelId)
    .single();
  if (error) throw error;
  return { wci_hotel_terms: data?.wci_hotel_terms ?? null, wci_lgpd_terms: data?.wci_lgpd_terms ?? null, wci_visible: data?.wci_visible ?? true };
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
// O Erbon espera o base64 como string JSON pura (sem double-encode).
// Testado: body = JSON.stringify(base64string) → envia "\"abc...\"" (errado)
//          body = base64string, Content-Type: text/plain → correto

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

/**
 * Envia a assinatura PNG de um hóspede para a reserva no Erbon.
 * Swagger: POST /hotel/{hotelID}/booking/{bookingInternalID}/signature
 *   Body: string (base64 da imagem, como JSON string)
 *   Header opcional: idGuest (int64) — vincula ao hóspede específico
 */
export async function submitSignature(
  hotelId: string,
  bookingInternalId: number,
  signatureBase64: string, // sem prefixo data:image/...
  guestId?: number
): Promise<void> {
  const config = await erbonService.getConfig(hotelId);
  if (!config) throw new Error('Configuração Erbon não encontrada');
  const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/signature`;

  const extraHeaders: Record<string, string> = {};
  if (guestId && guestId > 0) extraHeaders['idGuest'] = String(guestId);

  const result = await erbonPost(
    hotelId,
    path,
    JSON.stringify(signatureBase64), // JSON string → "\"base64...\""
    extraHeaders
  );

  if (!result.ok) {
    console.warn(`[WebCheckin] submitSignature ${result.status}: ${result.text}`);
  } else {
    console.log(`[WebCheckin] submitSignature OK (guest ${guestId ?? 'main'})`);
  }
}

/**
 * Envia um PDF como anexo da reserva no Erbon.
 * Swagger: POST /hotel/{hotelID}/booking/{bookingInternalID}/attachment
 *   Body: BookingAttachmentModel { fileName: string, fileType: string, fileBase64: string }
 *   Retorna: integer (attachmentId)
 */
/**
 * Tenta enviar um arquivo como anexo da reserva no Erbon.
 * Retorna true se enviado com sucesso, false caso contrário (nunca lança).
 *
 * O campo `fileType` é enviado exatamente como fornecido — use para testar
 * diferentes valores aceitos pelo Erbon (ex: 'pdf', 'application/pdf', 'image/jpeg').
 */
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

    const body = JSON.stringify({
      fileName: safeFileName,
      fileType,
      fileBase64,
    });

    const result = await erbonPost(hotelId, path, body);

    if (!result.ok) {
      console.warn(`[WebCheckin] submitAttachment [${fileType}] ${result.status}: ${result.text}`);
      return false;
    }
    console.log(`[WebCheckin] submitAttachment [${fileType}] OK — id: ${result.text}`);
    return true;
  } catch (err: any) {
    console.warn('[WebCheckin] submitAttachment error:', err.message);
    return false;
  }
}

// ── Sincronização cross-device via Supabase (wci_sessions) ───────────────
// localStorage é por dispositivo — para sincronizar celular ↔ totem
// usamos a tabela wci_sessions no Supabase (leitura/escrita pública).

const STORAGE_KEY = (bookingId: string | number) => `wci_guests_${bookingId}`;

/** Salva localmente E sincroniza para o Supabase (cross-device). */
export async function saveGuestsToStorage(
  bookingId: string | number,
  guests: WebCheckinGuest[],
  hotelId?: string
): Promise<void> {
  // 1. Sempre salvar local (rápido / offline)
  localStorage.setItem(STORAGE_KEY(bookingId), JSON.stringify(guests));

  // 2. Sincronizar para Supabase (best-effort — não bloqueia o fluxo)
  try {
    await anonClient.from('wci_sessions').upsert({
      booking_id: String(bookingId),
      hotel_id: hotelId || '',
      guests,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'booking_id' });
  } catch (e) {
    console.warn('[WCI] Supabase sync failed:', e);
  }
}

/** Carrega hóspedes: Supabase primeiro (cross-device), fallback para localStorage. */
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
      // Atualizar localStorage com dado do servidor
      localStorage.setItem(STORAGE_KEY(bookingId), JSON.stringify(data.guests));
      return data.guests as WebCheckinGuest[];
    }
  } catch { /* fallback */ }

  // Fallback: localStorage
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
  // Limpar do Supabase também (best-effort)
  anonClient.from('wci_sessions').delete().eq('booking_id', String(bookingId)).then(() => {});
}
