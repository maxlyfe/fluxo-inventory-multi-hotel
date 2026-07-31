// src/pages/webcheckin/webCheckinService.ts
// Serviço isolado para o Web Check-in — não usa useHotel() nem auth
// Opera como cliente público (anon key) — reutiliza o singleton de lib/supabase
// para evitar múltiplas instâncias GoTrueClient no mesmo contexto.

import { supabase as anonClient } from '../../lib/supabase';
import { isRateLimit, SlugRateLimitError } from '../../lib/rateLimit';
import { erbonService, ErbonBooking, ErbonGuest, ErbonGuestPayload } from '../../lib/erbonService';

// ── Grupo do app de Web Check-in (multi-tenant) ─────────────────────────────
// O APK de check-in (com.lyfe.webcheckin) carrega /web-checkin sem grupo. Na
// 1ª abertura o operador informa o slug do grupo; ele fica salvo e o app passa
// a mostrar SÓ os hotéis daquele grupo.

export interface WciGroup { id: string; name: string; slug: string; }

const WCI_GROUP_KEY = 'wci_group';

export function getStoredWciGroup(): WciGroup | null {
  try {
    const raw = localStorage.getItem(WCI_GROUP_KEY);
    return raw ? (JSON.parse(raw) as WciGroup) : null;
  } catch { return null; }
}

export function setStoredWciGroup(group: WciGroup | null): void {
  try {
    if (group) localStorage.setItem(WCI_GROUP_KEY, JSON.stringify(group));
    else localStorage.removeItem(WCI_GROUP_KEY);
  } catch { /* ignore */ }
}

/**
 * Resolve um grupo ativo pelo slug (RPC pública get_group_by_slug).
 * Lança SlugRateLimitError quando a guarda anti-enumeração do banco responde
 * 429 (5 códigos inexistentes em 30s vindos do mesmo IP).
 */
export async function resolveWciGroupBySlug(slug: string): Promise<WciGroup | null> {
  const clean = (slug || '').trim().toLowerCase();
  if (!clean) return null;
  const { data, error } = await anonClient.rpc('get_group_by_slug', { p_slug: clean });
  if (isRateLimit(error)) throw new SlugRateLimitError();
  const g = Array.isArray(data) ? data[0] : data;
  return g ? { id: g.id, name: g.name, slug: g.slug } : null;
}

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
  documents?: Array<{ documentType: string; number: string; expirationDate?: string }>;
  fnrhCompleted: boolean;
  isMainGuest: boolean;
  // false quando a ficha foi salva localmente mas a Erbon rejeitou/falhou o envio
  erbonSynced?: boolean;
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
    number?: string;
    complement?: string;
    zipcode?: string;
    neighborhood?: string;
    cityIbge?: string;    // código IBGE do município (ViaCEP.ibge)
  };
  profession?: string;
  vehicleRegistration?: string;
  documentFrontUrl?: string;
  documentBackUrl?: string;
  // Campos exclusivos FNRH Gov (não enviados à Erbon)
  fnrh_extra?: {
    raca_id?:                string;  // AMARELA|BRANCA|INDIGENA|PARDA|PRETA|NAOINFORMAR
    deficiencia_id?:         string;  // SIM|NAO|NAOINFORMAR
    tipo_deficiencia_id?:    string;  // FISICA|AUDITIVA_SURDEZ|VISUAL|INTELECTUAL|MULTIPLA
    motivo_viagem_id?:       string;  // LAZER_FERIAS|NEGOCIOS|COMPRAS|...
    meio_transporte_id?:     string;  // AUTOMOVEL|AVIAO|ONIBUS|...
    // Menores de idade
    grau_parentesco_id?:     string;  // PAI|MAE|AVO|IRMAO|TIO|RESPONSAVEL_LEGAL|TUTOR|OUTRO
    responsavel_documento?:  string;  // Nº do documento do responsável adulto
    responsavel_doc_tipo?:   string;  // CPF | PASSAPORTE
  };
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

export async function fetchWebCheckinHotels(groupId?: string | null): Promise<WebCheckinHotel[]> {
  let query = anonClient
    .from('hotels')
    .select(`
      id, name, image_url, description, wci_code,
      wci_visible, wci_hotel_terms, wci_lgpd_terms,
      erbon_hotel_config(erbon_hotel_id, is_active)
    `)
    .eq('wci_visible', true);

  // Multi-tenant: o app de check-in é configurado por grupo (slug). Mostra
  // apenas os hotéis do grupo configurado.
  if (groupId) query = query.eq('group_id', groupId);

  const { data, error } = await query.order('name');

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
  // 1. Se informou número de reserva, tenta achar uma sessão ATIVA no hotel para este número
  if (bookingNumber) {
    const { data: existing } = await anonClient
      .from('wci_sessions')
      .select('booking_id, session_token, guests')
      .eq('hotel_id', hotelId)
      .eq('booking_number', bookingNumber.trim())
      .maybeSingle();

    if (existing) {
      const guests = (existing.guests as WebCheckinGuest[]) || [];
      const exists = guests.some(g => g.name.toLowerCase() === guestName.trim().toLowerCase());
      
      // Se o hóspede ainda não está na lista, adiciona como acompanhante
      if (!exists) {
        guests.push({
          id: guests.length, // ID sequencial simples para manual
          name: guestName.trim(),
          fnrhCompleted: false,
          isMainGuest: false,
        });
        await saveGuestsToStorage(existing.booking_id, guests, hotelId, bookingNumber.trim());
      }
      
      _sessionCache.set(existing.session_token, { 
        bookingId: Number(existing.booking_id) || 0, 
        guests, 
        bookingNumber: bookingNumber.trim() 
      });
      return existing.session_token;
    }
  }

  // 2. Senão encontrou, cria uma nova sessão normalmente
  const syntheticBookingId = Date.now();
  const token = generateToken();
  const guests: WebCheckinGuest[] = guestName.trim() ? [{
    id: 0,
    name: guestName.trim(),
    fnrhCompleted: false,
    isMainGuest: true,
  }] : [];
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
  _sessionCache.set(token, { bookingId: syntheticBookingId, guests, bookingNumber: bookingNumber || null });
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
  documentExpiration?: string;   // validade do documento (estrangeiros), 'YYYY-MM-DD'
  addressCountry?: string;
  addressState?: string;
  addressCity?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  addressZipcode?: string;
  addressNeighborhood?: string;
  addressCityIbge?: string;
  documentFrontUrl?: string;
  documentBackUrl?: string;
  // Campos FNRH Gov
  fnrhRacaId?:               string;
  fnrhDeficienciaId?:        string;
  fnrhTipoDeficienciaId?:    string;
  fnrhMotivoViagemId?:       string;
  fnrhMeioTransporteId?:     string;
  // Menor de idade
  fnrhGrauParentescoId?:     string;
  fnrhResponsavelDocumento?:  string;
  fnrhResponsavelDocTipo?:    string;
}

/**
 * Chave que identifica o hóspede dentro da reserva. Espelha
 * public.wci_normalize_name / wci_upsert_guest_ficha no banco: o id da Erbon
 * quando existe, senão o nome normalizado. Usada para finalizar a ficha certa.
 */
export function buildGuestKey(erbonGuestId: number | null | undefined, name: string): string {
  if (erbonGuestId && erbonGuestId > 0) return `erbon:${erbonGuestId}`;
  return `name:${(name || '').trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/**
 * Grava (ou atualiza) a ficha de UM hóspede, assim que ele conclui o
 * preenchimento — sem esperar a assinatura. É o que faz o dado aparecer em
 * /reception/wci-fichas e alimentar o tomador da NF.
 *
 * Vai por RPC SECURITY DEFINER porque o hotel e a reserva são resolvidos a
 * partir do session_token no banco: a chave anon não tem (nem deve ter)
 * permissão de UPDATE nessas tabelas.
 *
 * Retorna o UUID da ficha do hóspede.
 */
export async function upsertGuestFicha(
  sessionToken: string,
  guest: SaveFichaGuestParams,
  meta?: { roomNumber?: string; checkinDate?: string; checkoutDate?: string; source?: 'web' | 'totem' | 'manual' },
): Promise<string> {
  const { data, error } = await anonClient.rpc('wci_upsert_guest_ficha', {
    p_session_token: sessionToken,
    p_guest: {
      is_main_guest:        guest.isMainGuest,
      erbon_guest_id:       guest.erbonGuestId ?? null,
      name:                 guest.name,
      email:                guest.email                ?? null,
      phone:                guest.phone                ?? null,
      birth_date:           guest.birthDate            ?? null,
      gender_id:            guest.genderId             ?? null,
      nationality:          guest.nationality          ?? null,
      profession:           guest.profession           ?? null,
      vehicle_registration: guest.vehicleRegistration  ?? null,
      document_type:        guest.documentType         ?? null,
      document_number:      guest.documentNumber       ?? null,
      document_expiration:  guest.documentExpiration   ?? null,
      address_country:      guest.addressCountry       ?? null,
      address_state:        guest.addressState         ?? null,
      address_city:         guest.addressCity          ?? null,
      address_street:       guest.addressStreet        ?? null,
      address_number:       guest.addressNumber        ?? null,
      address_complement:   guest.addressComplement    ?? null,
      address_neighborhood: guest.addressNeighborhood  ?? null,
      address_zipcode:      guest.addressZipcode       ?? null,
      address_city_ibge:    guest.addressCityIbge      ?? null,
      document_front_url:   guest.documentFrontUrl     ?? null,
      document_back_url:    guest.documentBackUrl      ?? null,
      fnrh_raca_id:               guest.fnrhRacaId              ?? null,
      fnrh_deficiencia_id:        guest.fnrhDeficienciaId       ?? null,
      fnrh_tipo_deficiencia_id:   guest.fnrhTipoDeficienciaId   ?? null,
      fnrh_motivo_viagem_id:      guest.fnrhMotivoViagemId      ?? null,
      fnrh_meio_transporte_id:    guest.fnrhMeioTransporteId    ?? null,
      fnrh_grau_parentesco_id:    guest.fnrhGrauParentescoId    ?? null,
      fnrh_responsavel_documento: guest.fnrhResponsavelDocumento ?? null,
      fnrh_responsavel_doc_tipo:  guest.fnrhResponsavelDocTipo   ?? null,
    },
    p_room_number:   meta?.roomNumber   ?? null,
    p_checkin_date:  meta?.checkinDate  ?? null,
    p_checkout_date: meta?.checkoutDate ?? null,
    p_source:        meta?.source       ?? 'web',
  });
  if (error) throw error;
  return data as string;
}

/**
 * Fecha a ficha: grava assinatura e aceite de termos e marca status
 * 'completed'. Sem guestKey finaliza todas as fichas da reserva (totem, onde o
 * titular assina por todos); com guestKey finaliza só a do hóspede no aparelho.
 *
 * Retorna quantas fichas foram finalizadas — 0 significa que nenhum hóspede
 * chegou a salvar o preenchimento, e o chamador deve tratar como erro.
 */
export async function finalizeFicha(params: {
  sessionToken: string;
  guestKey?: string | null;
  signatureData?: string;
  hotelTermsAccepted: boolean;
  lgpdAccepted: boolean;
  hotelTermsText?: string;
  lgpdTermsText?: string;
  hotelRulesDocUrl?: string;
  lgpdDocUrl?: string;
}): Promise<number> {
  const { data, error } = await anonClient.rpc('wci_finalize_ficha', {
    p_session_token:        params.sessionToken,
    p_signature:            params.signatureData    ?? null,
    p_hotel_terms_accepted: params.hotelTermsAccepted,
    p_lgpd_accepted:        params.lgpdAccepted,
    p_hotel_terms_text:     params.hotelTermsText   ?? null,
    p_lgpd_terms_text:      params.lgpdTermsText    ?? null,
    p_hotel_rules_doc_url:  params.hotelRulesDocUrl ?? null,
    p_lgpd_doc_url:         params.lgpdDocUrl       ?? null,
    p_guest_key:            params.guestKey         ?? null,
  });
  if (error) throw error;
  return (data as number) ?? 0;
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

// Dois modos independentes de busca:
//   1. byBooking: recepcionista informa o número da reserva (busca direta)
//   2. byGuest:   hóspede informa sobrenome + check-in + check-out
//                 (busca por intervalo de datas e filtra por sobrenome)
export type SearchReservationInput =
  | { mode: 'byBooking'; bookingNumber: string }
  | { mode: 'byGuest';   surname: string; checkin: string; checkout: string };

export async function searchReservation(
  hotelId: string,
  input: SearchReservationInput
): Promise<{ booking: ErbonBooking; guests: WebCheckinGuest[] } | null> {
  const params: Record<string, string> = {};
  let surnameFilter: string | null = null;

  if (input.mode === 'byBooking') {
    const trimmed = input.bookingNumber.trim();
    if (!trimmed) return null;
    params.bookingNumber = trimmed;
  } else {
    surnameFilter = input.surname.trim().toLowerCase();
    if (!surnameFilter || !input.checkin || !input.checkout) return null;
    params.checkin  = input.checkin;   // formato ISO 'yyyy-MM-dd'
    params.checkout = input.checkout;
  }

  const results = await erbonService.searchBookings(hotelId, params);
  if (!results.length) return null;

  let booking: ErbonBooking;
  if (surnameFilter) {
    // Match: qualquer hóspede da reserva cujo nome contenha o sobrenome informado
    const match = results.find(b =>
      b.guestList?.some(g => (g.name || '').toLowerCase().includes(surnameFilter!))
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
  hotelId?: string,
  bookingNumber?: string | null
): Promise<void> {
  localStorage.setItem(STORAGE_KEY(bookingId), JSON.stringify(guests));
  try {
    const updates: any = {
      booking_id: String(bookingId),
      hotel_id: hotelId || '',
      guests,
      updated_at: new Date().toISOString(),
    };
    if (bookingNumber) updates.booking_number = bookingNumber;

    await anonClient.from('wci_sessions').upsert(updates, { onConflict: 'booking_id' });
    
    // Atualiza guests e bookingNumber em qualquer entrada do cache de sessão para este booking
    for (const [tkn, session] of _sessionCache.entries()) {
      if (session && session.bookingId === Number(bookingId)) {
        _sessionCache.set(tkn, { 
          ...session, 
          guests, 
          bookingNumber: bookingNumber || session.bookingNumber 
        });
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
