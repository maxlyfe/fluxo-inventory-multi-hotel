// src/lib/erbonService.ts
// Serviço de integração com a API Erbon PMS

import { supabase } from './supabase';
import { sanitizeError } from '../utils/errorHandler';

// Em dev, usa proxy do Vite. Em prod, usa Netlify Function para evitar CORS.
const ERBON_PROXY_PREFIX = '/erbon-api';
const NETLIFY_PROXY = '/.netlify/functions/erbon-proxy';
const isDev = import.meta.env.DEV;

/** Remove /swagger/index.html que o usuário pode colar por engano e garante protocolo */
function sanitizeBaseUrl(raw: string): string {
  const url = raw.trim().replace(/\/swagger(\/index\.html)?$/i, '').replace(/\/+$/, '');
  if (!url) return url;
  // Sem protocolo o proxy não consegue montar a URL e devolve 400
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function resolveErbonUrl(baseUrl: string, path: string): string {
  if (isDev) {
    return `${ERBON_PROXY_PREFIX}${path}`;
  }
  // Em produção: usa Netlify Function como proxy server-side
  return NETLIFY_PROXY;
}

/** Headers extras para o proxy em produção saber qual URL chamar */
function proxyHeaders(baseUrl: string, path: string): Record<string, string> {
  if (isDev) return {};
  return {
    'x-erbon-base-url': sanitizeBaseUrl(baseUrl),
    'x-erbon-path': path,
  };
}

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ErbonConfig {
  id: string;
  hotel_id: string;
  erbon_hotel_id: string;
  erbon_username: string;
  erbon_password: string;
  erbon_base_url: string;
  is_active: boolean;
  last_sync_at: string | null;
}

export interface ErbonProduct {
  id: number;
  code: string;
  description: string;
  isProduct: boolean;
  isService: boolean;
  priceSale: number;
  stocksGroupDescription: string | null;
  stocksFamily: string | null;
  mensureUnite: string | null;
}

export interface ErbonTransaction {
  idSource: string | null;
  idCurrentAccount: number;
  idDepartment: number;
  department: string;
  serviceDescription: string;
  idService: number;
  quantity: number;
  valueTotal: number;
  isCanceled: boolean;
}

export interface ErbonProductMapping {
  id: string;
  hotel_id: string;
  product_id: string | null;
  dish_id?: string | null;
  service_id?: string | null;
  erbon_service_id: number;
  erbon_service_description: string | null;
  /** 0 = mapeamento padrão (todos os departamentos); >0 = override específico */
  erbon_department_id: number;
  erbon_department?: string | null;
}

export interface ErbonSectorMapping {
  id: string;
  hotel_id: string;
  sector_id: string;
  erbon_department: string;
  erbon_department_id?: number | null;
}

// ── Interfaces Recepção / Reservas ──────────────────────────────────────────

export interface ErbonRoom {
  idRoomType: number;
  roomTypeDescription: string;
  idRoom: number;
  roomName: string;
  numberFloor: number;
  idHousekeepingStatus: 'CLEAN' | 'DIRTY';
  descriptionHousekeepingStatus: string;
  currentlyOccupiedOrAvailable: string;
  hasCheckinToday: boolean;
  adultCount: number | null;
  childrenCount: number | null;
  babyCount: number | null;
  bookingHolderName: string | null;
  currentBookingID: number | null;
  inMaintenance: boolean;
}

export interface ErbonGuest {
  roomDescription: string;
  guestName: string;
  lastName: string;
  contactEmail: string;
  checkInDate: string;
  checkOutDate: string;
  bookingNumber: string;
  idBooking: number;
  idGuest: number;
  mealPlan: string;
  localityGuest: string;
  stateGuest: string;
  countryGuestISO: string;
  birthDate: string;
}

export interface ErbonBooking {
  hotelID: string;
  bookingInternalID: number;
  erbonNumber: number;
  status: string;
  confirmedStatus: string;
  roomTypeID: number;
  roomTypeDescription: string;
  roomID: number;
  roomDescription: string;
  checkInDateTime: string;
  checkOutDateTime: string;
  adultQuantity: number;
  childQuantity?: number;
  babyQuantity?: number;
  totalBookingRate: number;
  totalBookingRateWithTax: number;
  rateDesc: string | null;
  segmentDesc: string;
  sourceDesc: string;
  guestList: Array<{
    id: number;
    name: string;
    email: string;
    phone: string;
    documents: Array<{ documentType: string; number: string }>;
  }>;
  createdAt: string;
}

export interface ErbonRoomType {
  id: number;
  code: string;
  description: string;
  minPax: number;
  maxPax: number;
  roomCount: number;
  roomCountOccupied: number;
}

export interface ErbonOTB {
  stayDate: string;
  totalInventory: number;
  totalRoomsDeductedTransient: number;
  totalRoomsDeductedBlocks: number;
  netRoomRevenueTransient: number;
  grossRoomRevenueTransient: number;
  netRoomRevenueBlocks?: number;
  grossRoomRevenueBlocks?: number;
  netFBRevenueTransient: number;
  netOtherRevenueTransient: number;
}

/** Uma linha por reserva por dia de estadia (GET /hotel/{id}/hospedagem) */
export interface ErbonHospedagemDia {
  iD_EMPRESA: number;
  iD_RESERVA: number;
  datA_HOSPEDAGEM: string;  // dia da diária
  datA_ENTRADA: string;
  datA_SAIDA: string;
  diaria: number;           // valor da diária deste dia
  iD_UH: number | null;
  iD_TIPO_UH: number | null;
  tipO_UH: string | null;
  qtD_ADL: number;
  qtD_CHD: number;
  qtD_CHD_FREE: number;
  cidade: string | null;
  estado: string | null;
  pais: string | null;
  iD_CANAL: number | null;
  canal: string | null;
  iD_AGENTE: number | null;
  agente: string | null;
  datA_CRIACAO: string | null;
  datA_CONFIRMACAO: string | null;
  datA_CANCELAMENTO: string | null;
  motivO_CANCELAMENTO: string | null;
  status: string;           // BOOKING | CHECKIN | CHECKOUT | CANCELED ...
  tipO_PENSAO: string | null;
  valoR_PENSAO: number | null;
  tipO_RESERVA: string | null;
  iD_GRUPO: number | null;
  grupo: string | null;
  iD_USUARIO: number | null;
  usuario: string | null;
  iD_HOSPEDE: number | null;
}

/** Uma linha por reserva por dia com segmento/origem (GET /hotel/{id}/booking/segmentsview) */
export interface ErbonSegmentsViewDia {
  bookingID: number;
  bookingNumber: number;
  stayDate: string;
  checkInDate: string;
  checkOutDate: string;
  dailyRate: number;
  segment: string | null;
  source: string | null;
  adultQuantity: number;
  childrenQuantity: number;
  babyQuantity: number;
}

export interface ErbonOccupancyPension {
  date: string;
  occupancy: number;
  roomSalledConfirmed: number;
  roomSalledRateDefault?: number;
  roomSalledPending?: number;
  roomSalledInvited?: number;
  roomSalledHouseUse?: number;
  roomSalledPermut?: number;
  roomSalledCrewMember?: number;
  roomSalledDayUse?: number;
  roomMaintenance?: number;
  roomAvailable: number;
  totalGuestByType: string;
  totalCheckInsSingleDay: number;
  totalCheckOutsSingleDay: number;
  totalDailyRate: number;
  totalBreakfast: number;
  totalLunch: number;
  totalDinner: number;
  totalRevenue: number;
  adr: number;
}

export interface ErbonAvailabilityDay {
  [key: string]: any; // Estrutura a validar com dados reais
}

/**
 * Faz o parse do campo `totalGuestByType` retornado pelo endpoint
 * /occupancy/withpension. O campo pode vir em dois formatos:
 *   - Número puro: "47"
 *   - String com pares "tipo:quantidade" separados por vírgula:
 *       "ADT:30, CHD:12, INF:5"  (somamos 47)
 * Retorna 0 se vazio/inválido.
 */
export function parseErbonGuests(raw: string | null | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  return trimmed.split(',').reduce((sum, part) => {
    const segments = part.split(':');
    const valStr = segments.length > 1 ? segments[1] : segments[0];
    const val = parseInt((valStr || '').trim() || '0', 10);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
}

export interface ErbonAccountReceivable {
  [key: string]: any; // Estrutura a validar com dados reais
}

// ── Point of Sale (POS) ───────────────────────────────────────────────────

export interface ErbonPointOfSaleTable {
  id: number;
  description: string;
}

export interface ErbonPointOfSale {
  id: number;
  description: string;
  tables: ErbonPointOfSaleTable[];
}

export interface ErbonPOSAccountLine {
  idService: number;
  quantity: number;
}

export interface ErbonPOSAccountPayload {
  idPointOfSale: number;
  idPointOfSaleTable?: number;
  comments?: string;
  passerbyName?: string;
  lines: ErbonPOSAccountLine[];
}

// ── Employee / Funcionário ─────────────────────────────────────────────────
// Retornado por GET /pmsuser/hotel/{hotelID}/userlist
// Estrutura real a ser confirmada com resposta da API.
export interface ErbonEmployee {
  [key: string]: any;
}

// ── PDV Charge Payload (para POST /booking/{id}/currentaccount) ────────────
// Lança um item de consumo na conta corrente da reserva (UH) no Erbon PMS.
// ⚠️  Validar body shape real contra swagger antes de produção:
//      POST /hotel/{hotelID}/booking/{bookingInternalID}/currentaccount
export interface ErbonChargePayload {
  idService:            number;   // erbon_product_mappings.erbon_service_id
  idDepartment:         number;   // erbon_sector_mappings.erbon_department_id
  quantity:             number;
  valueUnit:            number;   // preço unitário de venda
  serviceDescription?:  string;   // snapshot do nome do produto
  idSource?:            string;   // 'PDV' — identifica a origem do lançamento
}

// ── Guest Payload (para POST /guest/new e PUT /guests/update) ──────────────
// Schema exato conforme swagger v1: /definitions/Guest
// https://api.erbonsoftware.com/swagger/v1/swagger.json

export interface ErbonGuestDocument {
  documentType: string;           // ex: 'RG', 'CPF', 'PASSPORT'
  number: string;
  expirationDate?: string | null; // ISO 8601 (date-time)
  country?: string | null;        // ISO country code
}

export interface ErbonGuestAddress {
  country?: string | null;
  state?: string | null;
  city?: string | null;
  street?: string | null;
  zipcode?: string | null;
  neighborhood?: string | null;
}

export interface ErbonGuestPayload {
  // Schema real conforme swagger UI: https://api.erbonsoftware.com/swagger/index.html
  id?: number;                    // 0 para novo hóspede
  name?: string;                  // nome completo
  email?: string;
  phone?: string;
  birthDate?: string;             // ISO datetime
  genderID?: number;              // 1=Masculino, 2=Feminino, 3=Outros, 0=Não informado
  nationality?: string;           // código de país, ex: "BR"
  professionID?: number;
  profession?: string;
  vehicleRegistration?: string;
  isClient?: boolean;
  isProvider?: boolean;
  address?: ErbonGuestAddress | null;
  documents?: ErbonGuestDocument[];
}

/**
 * Monta o body exato que a API Erbon espera para POST/PUT de hóspede.
 * Schema real conforme swagger UI da Erbon.
 */
function buildGuestBody(data: ErbonGuestPayload, existingId: number | null): Record<string, any> {
  const birthDateFormatted = data.birthDate
    ? (data.birthDate.includes('T') ? data.birthDate : `${data.birthDate}T00:00:00`)
    : null;

  const country = data.address?.country?.trim() || 'BR';
  const isBrazil = country.toUpperCase() === 'BR';

  const addressObj = data.address
    ? {
        country,
        ...(isBrazil && data.address.state?.trim()        ? { state:        data.address.state.trim() }        : {}),
        ...(data.address.city?.trim()         ? { city:         data.address.city.trim() }         : {}),
        ...(data.address.street?.trim()       ? { street:       data.address.street.trim() }       : {}),
        ...(data.address.neighborhood?.trim() ? { neighborhood: data.address.neighborhood.trim() } : {}),
        ...(isBrazil && data.address.zipcode?.replace(/\D/g, '') ? { zipcode: data.address.zipcode!.replace(/\D/g, '') } : {}),
      }
    : {};

  return {
    id: existingId ?? 0,
    ...(data.name?.trim()                  ? { name:                data.name.trim() }                : {}),
    ...(data.email?.trim()                 ? { email:               data.email.trim() }               : {}),
    ...(data.phone?.trim()                 ? { phone:               data.phone.trim() }               : {}),
    ...(data.genderID                      ? { genderID:            data.genderID }                   : {}),
    ...(data.nationality?.trim()           ? { nationality:         data.nationality.trim() }         : {}),
    ...(data.profession?.trim()            ? { profession:          data.profession.trim() }          : {}),
    ...(data.professionID                  ? { professionID:        data.professionID }               : {}),
    ...(data.vehicleRegistration?.trim()   ? { vehicleRegistration: data.vehicleRegistration.trim() } : {}),
    ...(birthDateFormatted                 ? { birthDate:           birthDateFormatted }              : {}),
    isClient:   data.isClient   ?? false,
    isProvider: data.isProvider ?? false,
    address: addressObj,
    documents: (data.documents || []).map(d => ({
      documentType: d.documentType,
      number: d.number?.replace(/[\.\-\/\s]/g, '') || d.number,
      ...(d.expirationDate ? { expirationDate: d.expirationDate } : {}),
      country: (d.country && d.country.trim()) || country,
    })),
  };
}

// ── Token cache (in-memory) ────────────────────────────────────────────────

interface TokenEntry {
  token: string;
  expiresAt: number; // timestamp ms
}

const tokenCache = new Map<string, TokenEntry>();
const TOKEN_LIFETIME_MS = 23 * 60 * 60 * 1000; // 23h safety margin (tokens last 24h)

// ── Service ─────────────────────────────────────────────────────────────────

export const erbonService = {

  // ── Config ──────────────────────────────────────────────────────────────

  async getConfig(hotelId: string): Promise<ErbonConfig | null> {
    const { data, error } = await supabase
      .from('erbon_hotel_config')
      .select('*')
      .eq('hotel_id', hotelId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async saveConfig(config: Partial<ErbonConfig> & { hotel_id: string }): Promise<ErbonConfig> {
    const existing = await this.getConfig(config.hotel_id);

    if (existing) {
      const { data, error } = await supabase
        .from('erbon_hotel_config')
        .update({
          erbon_hotel_id: config.erbon_hotel_id,
          erbon_username: config.erbon_username,
          erbon_password: config.erbon_password,
          erbon_base_url: sanitizeBaseUrl(config.erbon_base_url || 'https://api.erbonsoftware.com'),
          is_active: config.is_active ?? true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      // Limpar cache de token ao atualizar credenciais
      tokenCache.delete(config.hotel_id);
      return data;
    } else {
      const { data, error } = await supabase
        .from('erbon_hotel_config')
        .insert({
          hotel_id: config.hotel_id,
          erbon_hotel_id: config.erbon_hotel_id,
          erbon_username: config.erbon_username,
          erbon_password: config.erbon_password,
          erbon_base_url: sanitizeBaseUrl(config.erbon_base_url || 'https://api.erbonsoftware.com'),
          is_active: config.is_active ?? true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  },

  // ── Authentication ──────────────────────────────────────────────────────

  async authenticate(config: ErbonConfig): Promise<string> {
    const authPath = '/auth/login';
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, authPath), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...proxyHeaders(config.erbon_base_url, authPath),
      },
      body: JSON.stringify({
        username: config.erbon_username,
        password: config.erbon_password,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Erbon auth failed (${res.status}): ${text}`);
    }

    // A API Erbon pode retornar o token como string pura ou como JSON
    const raw = await res.text();
    let token: string;

    try {
      const parsed = JSON.parse(raw);
      // Se é objeto com campo token/access_token
      if (typeof parsed === 'object' && parsed !== null) {
        token = parsed.bearerToken || parsed.token || parsed.access_token || '';
      } else {
        // É uma string JSON (com aspas)
        token = String(parsed);
      }
    } catch {
      // Não é JSON - é texto puro
      token = raw;
    }

    // Limpar aspas extras se houver
    token = token.replace(/^["']|["']$/g, '').trim();

    if (!token) {
      throw new Error('Token inválido retornado pela API Erbon');
    }

    return token;
  },

  async getToken(hotelId: string, forceRefresh = false): Promise<string> {
    try {
      if (!forceRefresh) {
        const cached = tokenCache.get(hotelId);
        if (cached && Date.now() < cached.expiresAt) {
          return cached.token;
        }
      }

      const config = await this.getConfig(hotelId);
      if (!config) throw new Error('Configuração Erbon não encontrada para este hotel');
      if (!config.is_active) throw new Error('Integração Erbon desativada para este hotel');

      const token = await this.authenticate(config);

      // Extrair exp real do JWT para não cachear além da validade do token
      let expiresAt = Date.now() + TOKEN_LIFETIME_MS;
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp) expiresAt = (payload.exp * 1000) - (5 * 60 * 1000); // 5min antes do exp real
      } catch { /* usa o padrão 23h se não conseguir decodificar */ }

      tokenCache.set(hotelId, { token, expiresAt });
      return token;
    } catch (err: any) {
      throw new Error(sanitizeError(err));
    }
  },

  // ── Test Connection ─────────────────────────────────────────────────────

  async testConnection(config: Partial<ErbonConfig>): Promise<{ success: boolean; hotelName?: string; error?: string }> {
    try {
      const baseUrl = sanitizeBaseUrl(config.erbon_base_url || 'https://api.erbonsoftware.com');

      // 1) Auth
      const authPath = '/auth/login';
      const authRes = await fetch(resolveErbonUrl(baseUrl, authPath), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...proxyHeaders(baseUrl, authPath),
        },
        body: JSON.stringify({
          username: config.erbon_username,
          password: config.erbon_password,
        }),
      });

      if (!authRes.ok) {
        // A Erbon devolve 400 com o motivo em texto puro (ex.: "#2# - Wrong username or password").
        // Sem isso a tela mostra só o status e parece problema de conexão.
        const detail = (await authRes.text().catch(() => '')).trim().slice(0, 200);
        return {
          success: false,
          error: detail
            ? `Autenticação falhou (${authRes.status}): ${detail}`
            : `Autenticação falhou (${authRes.status})`,
        };
      }

      // Parse token (pode vir como string pura, JSON string, ou objeto)
      const raw = await authRes.text();
      let token: string;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          token = parsed.bearerToken || parsed.token || parsed.access_token || '';
        } else {
          token = String(parsed);
        }
      } catch {
        token = raw;
      }
      token = token.replace(/^["']|["']$/g, '').trim();

      if (!token) {
        return { success: false, error: `Token vazio. Raw response: ${raw.substring(0, 100)}` };
      }

      // 2) Fetch hotel info
      const hotelPath = `/hotel/${config.erbon_hotel_id}`;
      const hotelRes = await fetch(resolveErbonUrl(baseUrl, hotelPath), {
        headers: {
          'Authorization': `Bearer ${token}`,
          ...proxyHeaders(baseUrl, hotelPath),
        },
      });

      if (!hotelRes.ok) {
        const detail = (await hotelRes.text().catch(() => '')).trim().slice(0, 200);
        return {
          success: false,
          error: detail
            ? `Hotel não encontrado (${hotelRes.status}): ${detail}`
            : `Hotel não encontrado (${hotelRes.status})`,
        };
      }

      const hotelData = await hotelRes.json();
      return { success: true, hotelName: hotelData.hotelName || 'Hotel conectado' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão' };
    }
  },

  // ── Fetch Erbon Products ────────────────────────────────────────────────

  async fetchErbonProducts(hotelId: string, onlyProducts = true): Promise<ErbonProduct[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');

    const token = await this.getToken(hotelId);

    const productsPath = `/hotel/${config.erbon_hotel_id}/mapping/serviceproducts`;
    const res = await fetch(
      resolveErbonUrl(config.erbon_base_url, productsPath),
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          // false = inclui também SERVIÇOS (diárias, taxas…), não só produtos
          'onlyProducts': onlyProducts ? 'true' : 'false',
          ...proxyHeaders(config.erbon_base_url, productsPath),
        },
      }
    );

    if (!res.ok) throw new Error(`Erro ao buscar produtos Erbon (${res.status})`);
    return await res.json();
  },

  // ── Fetch Erbon Departments (pontos de venda reais) ─────────────────────

  async fetchErbonDepartments(hotelId: string): Promise<{ name: string; id: number }[]> {
    // name → numeric id (idDepartment from transactions)
    const departments = new Map<string, number>();

    // Busca departamentos das transações dos últimos 30 dias.
    // ErbonTransaction já contém idDepartment (número) + department (nome).
    // IMPORTANTE: não paramos cedo ao achar "poucos" departamentos — um ponto
    // de venda esporádico (ex.: MAP/FAP, que só lança quando um hóspede com
    // esse plano consome) pode só aparecer num dia mais distante, depois que
    // outros departamentos mais movimentados (Restaurante, Bar, Loja...) já
    // tiverem sido encontrados nos primeiros dias.
    try {
      const today = new Date();
      for (let daysBack = 0; daysBack < 30; daysBack++) {
        const d = new Date(today);
        d.setDate(d.getDate() - daysBack);
        const dateStr = d.toISOString().split('T')[0];
        try {
          const txs = await this.fetchTransactionsForDate(hotelId, dateStr);
          txs.forEach(tx => {
            if (tx.department && !departments.has(tx.department)) {
              departments.set(tx.department, tx.idDepartment);
            }
          });
        } catch {
          // Dia sem transações, continua
        }
      }
    } catch (err) {
      console.error('[Erbon] Erro ao buscar departamentos via transações:', err);
    }

    // Fallback: se não encontrou transações, extrai stocksGroupDescription dos produtos
    // (sem idDepartment disponível — id ficará como 0)
    if (departments.size === 0) {
      try {
        const products = await this.fetchErbonProducts(hotelId);
        products.forEach(p => {
          if (p.stocksGroupDescription && !departments.has(p.stocksGroupDescription)) {
            departments.set(p.stocksGroupDescription, 0);
          }
        });
      } catch (err) {
        // Fallback falhou silenciadamente
      }
    }

    return Array.from(departments.entries())
      .map(([name, id]) => ({ name, id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  // ── Fetch Transactions for a single date ────────────────────────────────

  async fetchTransactionsForDate(hotelId: string, date: string): Promise<ErbonTransaction[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');

    const token = await this.getToken(hotelId);

    const txPath = `/hotel/${config.erbon_hotel_id}/sales/transactions`;
    const res = await fetch(
      resolveErbonUrl(config.erbon_base_url, txPath),
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'transactionDate': date,
          ...proxyHeaders(config.erbon_base_url, txPath),
        },
      }
    );

    if (!res.ok) {
      if (res.status === 404) return []; // Sem transações nesta data
      throw new Error(`Erro ao buscar transações Erbon (${res.status})`);
    }

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  // ── Fetch & Cache Transactions for a Range ──────────────────────────────

  async fetchTransactionsForRange(
    hotelId: string,
    startDate: string,
    endDate: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    // Gerar lista de datas no range
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    // Verificar quais datas já estão no cache
    const { data: cached } = await supabase
      .from('erbon_transaction_cache')
      .select('transaction_date')
      .eq('hotel_id', hotelId)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate);

    const cachedDates = new Set((cached || []).map((c: any) => c.transaction_date));
    const datesToFetch = dates.filter(d => !cachedDates.has(d));

    // Buscar transações para datas não cacheadas
    for (let i = 0; i < datesToFetch.length; i++) {
      const date = datesToFetch[i];
      if (onProgress) onProgress(i + 1, datesToFetch.length);

      try {
        const transactions = await this.fetchTransactionsForDate(hotelId, date);

        if (transactions.length > 0) {
          // Filtrar apenas transações de PDV (POS ou comanda)
          const pdvTransactions = transactions.filter(
            t => t.idSource === 'POS' || t.idSource === null
          );

          if (pdvTransactions.length > 0) {
            const rows = pdvTransactions.map(t => ({
              hotel_id: hotelId,
              transaction_date: date,
              erbon_service_id: t.idService,
              erbon_department: t.department,
              id_source: t.idSource,
              quantity: t.quantity,
              value_total: t.valueTotal,
              is_canceled: t.isCanceled,
              fetched_at: new Date().toISOString(),
            }));

            const { error } = await supabase
              .from('erbon_transaction_cache')
              .insert(rows);
            if (error) console.error(`Erro ao cachear transações de ${date}:`, error);
          }
        }
      } catch (err) {
        console.error(`Erro ao buscar transações de ${date}:`, err);
      }
    }

    // Atualizar last_sync_at
    await supabase
      .from('erbon_hotel_config')
      .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('hotel_id', hotelId);
  },

  // ── Get Aggregated Sales ────────────────────────────────────────────────
  // Retorna Map<sectorId, Map<productId, qty>> cruzando cache + mappings

  async getAggregatedSales(
    hotelId: string,
    startDate: string,
    endDate: string
  ): Promise<Record<string, Record<string, number>>> {
    // 1) Buscar e cachear transações do período
    await this.fetchTransactionsForRange(hotelId, startDate, endDate);

    // 2) Buscar transações do cache (não canceladas)
    const { data: txCache, error: txError } = await supabase
      .from('erbon_transaction_cache')
      .select('erbon_service_id, erbon_department, quantity')
      .eq('hotel_id', hotelId)
      .eq('is_canceled', false)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate);

    if (txError) throw txError;

    // 3) Buscar mapeamentos de produtos — só a linha default (dept=0):
    //    overrides por departamento (product_id/dish_id sempre nulos nessas
    //    linhas) não devem entrar aqui, senão o forEach abaixo pode
    //    sobrescrever o product_id correto com null.
    const { data: productMappings, error: pmError } = await supabase
      .from('erbon_product_mappings')
      .select('product_id, erbon_service_id')
      .eq('hotel_id', hotelId)
      .eq('erbon_department_id', 0);
    if (pmError) throw pmError;

    // 4) Buscar mapeamentos de setores
    const { data: sectorMappings, error: smError } = await supabase
      .from('erbon_sector_mappings')
      .select('sector_id, erbon_department')
      .eq('hotel_id', hotelId);
    if (smError) throw smError;

    // Criar lookups
    const serviceToProduct = new Map<number, string>();
    (productMappings || []).forEach(m => serviceToProduct.set(m.erbon_service_id, m.product_id));

    const deptToSector = new Map<string, string>();
    (sectorMappings || []).forEach(m => deptToSector.set(m.erbon_department, m.sector_id));

    // Agregar: sectorId → productId → totalQty
    const result: Record<string, Record<string, number>> = {};

    (txCache || []).forEach(tx => {
      const productId = serviceToProduct.get(tx.erbon_service_id);
      const sectorId = deptToSector.get(tx.erbon_department);

      if (!productId || !sectorId) return; // Sem mapeamento, ignorar

      if (!result[sectorId]) result[sectorId] = {};
      result[sectorId][productId] = (result[sectorId][productId] || 0) + (tx.quantity || 0);
    });

    return result;
  },

  // ── Product Mappings CRUD ───────────────────────────────────────────────

  async getProductMappings(hotelId: string): Promise<ErbonProductMapping[]> {
    const { data, error } = await supabase
      .from('erbon_product_mappings')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('erbon_service_description');
    if (error) throw error;
    return data || [];
  },

  async saveProductMapping(mapping: {
    hotel_id: string;
    product_id?: string | null;
    dish_id?: string | null;
    service_id?: string | null;
    erbon_service_id: number;
    erbon_service_description?: string;
    /** 0 (default) = mapeamento vale para qualquer departamento; >0 = override específico */
    erbon_department_id?: number;
    erbon_department?: string | null;
  }): Promise<void> {
    // Alvos mutuamente exclusivos: produto OU ficha técnica OU serviço.
    // Overrides por departamento (erbon_department_id > 0) só podem apontar
    // service_id — a baixa de estoque sempre usa a linha default (dept=0).
    const payload = {
      ...mapping,
      product_id: mapping.product_id ?? null,
      dish_id: mapping.dish_id ?? null,
      service_id: mapping.service_id ?? null,
      erbon_department_id: mapping.erbon_department_id ?? 0,
      erbon_department: mapping.erbon_department ?? null,
    };
    const { error } = await supabase
      .from('erbon_product_mappings')
      .upsert(payload, { onConflict: 'hotel_id,erbon_service_id,erbon_department_id' });
    if (error) throw error;
  },

  async deleteProductMapping(id: string): Promise<void> {
    const { error } = await supabase
      .from('erbon_product_mappings')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ── Sector Mappings CRUD ────────────────────────────────────────────────

  async getSectorMappings(hotelId: string): Promise<ErbonSectorMapping[]> {
    const { data, error } = await supabase
      .from('erbon_sector_mappings')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('erbon_department');
    if (error) throw error;
    return data || [];
  },

  async saveSectorMapping(mapping: {
    hotel_id: string;
    sector_id: string;
    erbon_department: string;
    erbon_department_id?: number | null;
  }): Promise<void> {
    const { error } = await supabase
      .from('erbon_sector_mappings')
      .upsert(mapping, { onConflict: 'hotel_id,sector_id,erbon_department' });
    if (error) throw error;
  },

  async deleteSectorMapping(id: string): Promise<void> {
    const { error } = await supabase
      .from('erbon_sector_mappings')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ── Housekeeping (Rack de UH's) ─────────────────────────────────────────

  async fetchHousekeeping(hotelId: string): Promise<ErbonRoom[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/housekeeping/get`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) throw new Error(`Erro ao buscar housekeeping (${res.status})`);
    return await res.json();
  },

  async updateHousekeepingStatus(hotelId: string, roomId: number, newStatus: string): Promise<void> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/housekeeping/update`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'roomID': String(roomId),
        'newStatus': newStatus,
        ...proxyHeaders(config.erbon_base_url, path),
      },
    });
    if (!res.ok) throw new Error(`Erro ao atualizar housekeeping (${res.status})`);
  },

  // ── Guests ─────────────────────────────────────────────────────────────

  async fetchInHouseGuests(hotelId: string): Promise<ErbonGuest[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/guest/inhouse`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) throw new Error(`Erro ao buscar hóspedes in-house (${res.status})`);
    return await res.json();
  },

  async fetchHallGuests(hotelId: string): Promise<ErbonGuest[]> {
    try {
      // Retorna apenas hóspedes in-house (que já fizeram check-in)
      // Conforme solicitado, chegadas futuras não aparecem pois não têm direito a café
      // e os dados de pensão (MAP/FAP) só são confiáveis após o check-in.
      const guests = await this.fetchInHouseGuests(hotelId);

      // DEDUPE por hóspede: o endpoint /guest/inhouse devolve o MESMO hóspede em
      // várias linhas (uma por diária/segmento da reserva). Nas telas de café
      // (Salão/Cozinha) o consumo é 1 por pessoa, então colapsamos por idGuest.
      // Para idGuest inválido (0/nulo), usa nome+UH+reserva como chave de fallback.
      const seen = new Map<string, ErbonGuest>();
      for (const g of guests) {
        const key = (g.idGuest && g.idGuest > 0)
          ? `id:${g.idGuest}`
          : `c:${g.guestName || ''}|${g.roomDescription || ''}|${g.idBooking || ''}`;
        if (!seen.has(key)) seen.set(key, g);
      }
      return Array.from(seen.values());
    } catch (err: any) {
      console.error('[Erbon] fetchHallGuests error:', err);
      return [];
    }
  },

  async fetchTodayCheckouts(hotelId: string): Promise<ErbonGuest[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/guest/todaycheckout`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) throw new Error(`Erro ao buscar checkouts do dia (${res.status})`);
    return await res.json();
  },

  async fetchBreakfastGuests(hotelId: string): Promise<ErbonGuest[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/guest/breakfast`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) throw new Error(`Erro ao buscar hóspedes café da manhã (${res.status})`);
    return await res.json();
  },

  // ── Guest CRUD (adicionar / editar / excluir) ───────────────────────────
  // Endpoints validados via swagger: https://api.erbonsoftware.com/swagger/v1/swagger.json

  /**
   * POST /hotel/{hotelID}/booking/{bookingInternalID}/guest/new
   * Cria um novo hóspede no cadastro geral do hotel.
   *
   * IMPORTANTE: apesar do endpoint estar sob /booking/{id}/, na prática
   * ele APENAS cria o hóspede no cadastro — não vincula automaticamente à
   * reserva. É necessário chamar PUT /attach em seguida.
   * Esta função faz o fluxo completo: cria → extrai ID retornado → anexa.
   */
  async addGuestToBooking(
    hotelId: string,
    bookingInternalId: number,
    guestData: ErbonGuestPayload,
    options?: { isMainGuest?: boolean }
  ): Promise<any> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    // forceRefresh=true: operação de escrita sempre usa token fresco
    const token = await this.getToken(hotelId, true);

    const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/guest/new`;

    const body = buildGuestBody(guestData, null);
    // Logging removido por segurança
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...proxyHeaders(config.erbon_base_url, path),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      throw new Error(`Erro ao adicionar hóspede (${res.status}): ${errTxt}`);
    }

    const created = await res.json().catch(() => ({} as any));

    // Extrair ID do hóspede recém-criado (pode vir como `id`, `guestID`, `idGuest`)
    const newGuestId: number | undefined =
      created?.id ?? created?.guestID ?? created?.idGuest ?? created?.Id;

    if (!newGuestId) {
      console.warn('[Erbon] addGuest: ID não retornado, não foi possível anexar à reserva', created);
      return created;
    }

    // Vincular à reserva
    try {
      await this.attachGuestToBooking(hotelId, bookingInternalId, newGuestId, options?.isMainGuest);
    } catch (err: any) {
      console.error('[Erbon] Falha ao anexar hóspede recém-criado à reserva:', err.message);
      // Não lançar erro — hóspede foi criado com sucesso, só o vínculo falhou
      console.warn('[Erbon] Hóspede criado mas não vinculado. id=', newGuestId);
    }

    return { ...created, id: newGuestId };
  },

  /**
   * PUT /hotel/{hotelID}/booking/{bookingInternalID}/guest/{guestID}/attach
   * Vincula um hóspede existente (que já está no cadastro geral) a uma reserva.
   * Header opcional: isMainGuest (boolean)
   */
  async attachGuestToBooking(
    hotelId: string,
    bookingInternalId: number,
    guestId: number,
    isMainGuest?: boolean
  ): Promise<void> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/guest/${guestId}/attach`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      ...proxyHeaders(config.erbon_base_url, path),
    };
    if (typeof isMainGuest === 'boolean') {
      headers['isMainGuest'] = String(isMainGuest);
    }

    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'PUT',
      headers,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[Erbon] attachGuest response:', res.status, txt);
      throw new Error(`Erro ao vincular hóspede (${res.status}): ${txt}`);
    }
  },

  /**
   * PUT /hotel/{hotelID}/guests/update
   * Atualiza os dados de um hóspede (id no body).
   */
  async updateGuest(hotelId: string, guestId: number, guestData: ErbonGuestPayload): Promise<any> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/guests/update`;

    const body = buildGuestBody(guestData, guestId);
    // Logging removido por segurança
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...proxyHeaders(config.erbon_base_url, path),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Erro ao atualizar hóspede (${res.status})`);
    }
    return await res.json().catch(() => ({}));
  },

  /**
   * DELETE /hotel/{hotelID}/booking/{bookingInternalID}/guest/{guestID}/remove
   */
  async removeGuestFromBooking(hotelId: string, bookingInternalId: number, guestId: number): Promise<void> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/guest/${guestId}/remove`;

    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...proxyHeaders(config.erbon_base_url, path),
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Erro ao remover hóspede (${res.status}): ${txt}`);
    }
  },

  // ── Check-in / Check-out ────────────────────────────────────────────────

  /**
   * PUT /hotel/{hotelID}/booking/{bookingInternalID}/checkin
   */
  async checkInBooking(hotelId: string, bookingInternalId: number, options?: {
    generateDoorKey?: string;
    guestExternalId?: string;
    guestContact?: string;
  }): Promise<any> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/checkin`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...proxyHeaders(config.erbon_base_url, path),
    };
    if (options?.generateDoorKey) headers['generateDoorKey'] = options.generateDoorKey;
    if (options?.guestExternalId) headers['guestExternalId'] = options.guestExternalId;
    if (options?.guestContact) headers['guestContact'] = options.guestContact;

    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'PUT',
      headers,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Erro ao realizar check-in (${res.status}): ${txt}`);
    }
    return await res.json().catch(() => ({}));
  },

  /**
   * PUT /hotel/{hotelID}/booking/{bookingInternalID}/checkout
   */
  async checkOutBooking(hotelId: string, bookingInternalId: number): Promise<any> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/checkout`;

    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...proxyHeaders(config.erbon_base_url, path),
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Erro ao realizar check-out (${res.status}): ${txt}`);
    }
    return await res.json().catch(() => ({}));
  },

  // ── Bookings ───────────────────────────────────────────────────────────

  /**
   * GET /hotel/{hotelID}/booking/{bookingInternalID}
   * Busca UMA reserva pelo ID interno (mais confiável que search).
   */
  async fetchBookingByInternalId(hotelId: string, bookingInternalId: number): Promise<ErbonBooking | null> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return data || null;
  },

  async searchBookings(hotelId: string, params: {
    checkin?: string;
    checkout?: string;
    status?: string;
    bookingNumber?: string;
    guestEmail?: string;
  }): Promise<ErbonBooking[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/booking/search`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...proxyHeaders(config.erbon_base_url, path),
    };
    if (params.checkin) headers['checkin'] = params.checkin;
    if (params.checkout) headers['checkout'] = params.checkout;
    if (params.status) headers['status'] = params.status;
    if (params.bookingNumber) headers['bookingNumber'] = params.bookingNumber;
    if (params.guestEmail) headers['mainguestEmail'] = params.guestEmail;

    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'POST',
      headers,
    });
    if (!res.ok) throw new Error(`Erro ao buscar reservas (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  // ── Room Types ─────────────────────────────────────────────────────────

  async fetchRoomTypes(hotelId: string): Promise<ErbonRoomType[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/mapping/roomtype`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) throw new Error(`Erro ao buscar tipos de quarto (${res.status})`);
    return await res.json();
  },

  // ── OTB (On The Books) ────────────────────────────────────────────────

  async fetchOTB(hotelId: string, dateFrom: string, dateTo: string): Promise<ErbonOTB[]> {
    try {
      const config = await this.getConfig(hotelId);
      if (!config) throw new Error('Configuração Erbon não encontrada');
      const token = await this.getToken(hotelId);
      const path = `/hotel/${config.erbon_hotel_id}/sales/otb`;
      const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'dateFrom': dateFrom,
          'dateTo': dateTo,
          ...proxyHeaders(config.erbon_base_url, path),
        },
      });
      if (!res.ok) throw new Error(`Erro ao buscar OTB (${res.status})`);
      return await res.json();
    } catch (err: any) {
      throw new Error(sanitizeError(err));
    }
  },

  // ── Occupancy with Pension ────────────────────────────────────────────

  async fetchOccupancyWithPension(hotelId: string, dateFrom: string, dateTo: string): Promise<ErbonOccupancyPension[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/occupancy/withpension`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'dateFrom': dateFrom,
        'dateTo': dateTo,
        'currency': '0',
        ...proxyHeaders(config.erbon_base_url, path),
      },
    });
    if (!res.ok) throw new Error(`Erro ao buscar ocupação (${res.status})`);
    return await res.json();
  },

  // ── Hospedagem (diária a diária de cada reserva) ──────────────────────

  /**
   * GET /hotel/{hotelID}/hospedagem
   * Uma linha por reserva por dia de estadia, com o valor da diária
   * (`diaria`), canal, agente, pensão e status — inclusive datas FUTURAS.
   * Headers: stayDateStart / stayDateEnd (+ status opcional).
   */
  async fetchHospedagem(hotelId: string, stayDateStart: string, stayDateEnd: string): Promise<ErbonHospedagemDia[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/hospedagem`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'stayDateStart': stayDateStart,
        'stayDateEnd': stayDateEnd,
        ...proxyHeaders(config.erbon_base_url, path),
      },
    });
    if (!res.ok) throw new Error(`Erro ao buscar hospedagem (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  // ── Segments View (diária + segmento/origem por dia) ──────────────────

  /**
   * GET /hotel/{hotelID}/booking/segmentsview
   * Uma linha por reserva por dia com dailyRate, segment e source.
   * Headers: startDate / endDate.
   */
  async fetchSegmentsView(hotelId: string, startDate: string, endDate: string): Promise<ErbonSegmentsViewDia[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/booking/segmentsview`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'startDate': startDate,
        'endDate': endDate,
        ...proxyHeaders(config.erbon_base_url, path),
      },
    });
    if (!res.ok) throw new Error(`Erro ao buscar segments view (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  // ── Availability Inventory ────────────────────────────────────────────

  async fetchAvailabilityInventory(hotelId: string, dateFrom: string, dateTo: string): Promise<ErbonAvailabilityDay[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/availability/inventory`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'dateFrom': dateFrom,
        'dateTo': dateTo,
        ...proxyHeaders(config.erbon_base_url, path),
      },
    });
    if (!res.ok) throw new Error(`Erro ao buscar disponibilidade (${res.status})`);
    return await res.json();
  },

  // ── Accounts Receivable (Financeiro) ──────────────────────────────────

  async fetchAccountsReceivable(hotelId: string): Promise<ErbonAccountReceivable[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/sales/financialaccountreceive`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) throw new Error(`Erro ao buscar contas a receber (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  /**
   * GET /hotel/{hotelID}/booking/{bookingInternalID}/currentaccount
   * Busca conta corrente / extrato de uma reserva específica.
   * Retorno: Array de CurrentAccountModel { id, description, amount, isDebit, isCredit, currency, isInvoiced, idDepartment }
   */
  async fetchBookingAccount(hotelId: string, bookingInternalId: number): Promise<any[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/currentaccount`;

    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : data ? [data] : [];
  },

  // ── PDV: Lançar consumo na conta corrente da UH ────────────────────────

  /**
   * POST /hotel/{hotelID}/booking/{bookingInternalID}/currentaccount
   * Registra um item de consumo (A&B, minibar, etc.) diretamente na conta
   * corrente da reserva no Erbon PMS. Retorna { success, error? } — nunca lança
   * exceção — permitindo tratamento local-first no pdvService.
   *
   * ⚠️  Body shape inferido de ErbonTransaction + padrão swagger. Validar
   *     contra a API real antes de usar em produção. Pode precisar de wrapping
   *     { "currentAccount": {...} } como foi necessário em /guest/new.
   */
  async postChargeToBooking(
    hotelId: string,
    bookingInternalId: number,
    charge: ErbonChargePayload
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const config = await this.getConfig(hotelId);
      if (!config) throw new Error('Configuração Erbon não encontrada');
      const token = await this.getToken(hotelId);
      const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/currentaccount`;

    const body = { ...charge, idSource: charge.idSource ?? 'PDV' };
    // Logging removido por segurança
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...proxyHeaders(config.erbon_base_url, path),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Erro ao lançar consumo (${res.status})`);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
},

  // ── Employees / Funcionários ────────────────────────────────────────────

  async fetchEmployees(hotelId: string): Promise<ErbonEmployee[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/pmsuser/hotel/${config.erbon_hotel_id}/userlist`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) throw new Error(`Erro ao buscar funcionários Erbon (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  // ── Point of Sale (POS) — AE67, AE68, AE69 ─────────────────────────────

  /**
   * AE69 — GET /hotel/{hotelID}/sales/pointofsale
   * Lista os pontos de venda ativos do hotel e suas mesas.
   */
  async fetchPointsOfSale(hotelId: string): Promise<ErbonPointOfSale[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/sales/pointofsale`;
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      headers: { 'Authorization': `Bearer ${token}`, ...proxyHeaders(config.erbon_base_url, path) },
    });
    if (!res.ok) throw new Error(`Erro ao buscar pontos de venda (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  /**
   * AE68 — POST /hotel/{hotelID}/sales/pointofsale/account
   * Cria uma comanda aberta no POS com as linhas de serviço.
   * Preços vêm do banco do hotel (preço do departamento POS ou preço do serviço).
   * Retorna o ID da nova conta, que pode ser debitada no quarto com AE67.
   */
  async createPointOfSaleAccount(hotelId: string, account: ErbonPOSAccountPayload): Promise<number> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId, true);
    const path = `/hotel/${config.erbon_hotel_id}/sales/pointofsale/account`;

    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...proxyHeaders(config.erbon_base_url, path),
      },
      body: JSON.stringify(account),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Erro ao criar comanda POS (${res.status}): ${txt}`);
    }

    const data = await res.json();
    return typeof data === 'number' ? data : Number(data);
  },

  /**
   * AE67 — POST /hotel/{hotelID}/sales/pointofsale/debitroom
   * Fecha a conta POS, cria o documento TICKET e debita todas as linhas
   * ativas na conta corrente da reserva (UH).
   * A reserva deve estar em estado checkin e não marcada como no-post.
   */
  async debitPointOfSaleToRoom(hotelId: string, idPointOfSaleAccount: number, bookingInternalID: number): Promise<boolean> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');
    const token = await this.getToken(hotelId, true);
    const path = `/hotel/${config.erbon_hotel_id}/sales/pointofsale/debitroom`;

    const res = await fetch(resolveErbonUrl(config.erbon_base_url, path), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...proxyHeaders(config.erbon_base_url, path),
      },
      body: JSON.stringify({ idPointOfSaleAccount, bookingInternalID }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Erro ao debitar comanda na UH (${res.status}): ${txt}`);
    }

    const data = await res.json().catch(() => true);
    return !!data;
  },

  // ── Clear cache for re-fetch ────────────────────────────────────────────

  async clearCache(hotelId: string, startDate?: string, endDate?: string): Promise<void> {
    let query = supabase
      .from('erbon_transaction_cache')
      .delete()
      .eq('hotel_id', hotelId);

    if (startDate) query = query.gte('transaction_date', startDate);
    if (endDate) query = query.lte('transaction_date', endDate);

    const { error } = await query;
    if (error) throw error;
  },
};


