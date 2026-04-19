// src/lib/erbonService.ts
// Serviço de integração com a API Erbon PMS

import { supabase } from './supabase';

// Em dev, usa proxy do Vite. Em prod, usa Netlify Function para evitar CORS.
const ERBON_PROXY_PREFIX = '/erbon-api';
const NETLIFY_PROXY = '/.netlify/functions/erbon-proxy';
const isDev = import.meta.env.DEV;

/** Remove /swagger/index.html que o usuário pode colar por engano */
function sanitizeBaseUrl(raw: string): string {
  return raw.replace(/\/swagger(\/index\.html)?$/i, '').replace(/\/+$/, '');
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
  erbon_service_id: number;
  erbon_service_description: string | null;
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
  netFBRevenueTransient: number;
  netOtherRevenueTransient: number;
}

export interface ErbonOccupancyPension {
  date: string;
  occupancy: number;
  roomSalledConfirmed: number;
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

export interface ErbonAccountReceivable {
  [key: string]: any; // Estrutura a validar com dados reais
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
  name: string;                        // Nome completo (campo único na API)
  email?: string | null;
  phone?: string | null;
  birthDate?: string | null;           // ISO 8601 date-time
  genderID?: number | null;            // ID de gênero (inteiro)
  nationality?: string | null;
  professionID?: number | null;
  profession?: string | null;          // Descrição textual
  vehicleRegistration?: string | null;
  isClient?: boolean;
  isProvider?: boolean;
  address?: ErbonGuestAddress | null;
  documents?: ErbonGuestDocument[];
}

/**
 * Monta o body exato que a API Erbon espera em POST /guest/new e PUT /guests/update.
 * Garante campos obrigatórios e tipos corretos. Valores ausentes viram null/[]
 * para evitar 400 Bad Request por campo faltando.
 */
function buildGuestBody(data: ErbonGuestPayload, existingId: number | null): Record<string, any> {
  // Fallback chain para country em documentos (campo obrigatório pela API):
  // doc.country → address.country → nationality → 'BR'
  const docCountryFallback =
    data.address?.country?.trim() || data.nationality?.trim() || 'BR';

  // birthDate: Erbon exige ISO datetime completo. O input HTML date retorna
  // "YYYY-MM-DD"; precisamos garantir "YYYY-MM-DDTHH:mm:ss".
  const birthDateFormatted = data.birthDate
    ? (data.birthDate.includes('T') ? data.birthDate : `${data.birthDate}T00:00:00`)
    : null;

  return {
    id: existingId ?? 0,
    name: data.name?.trim() || '',
    email: data.email?.trim() || null,
    phone: data.phone?.trim() || null,
    birthDate: birthDateFormatted,
    genderID: data.genderID || null,
    nationality: data.nationality?.trim() || null,
    // professionID e profession: omitir se ausentes (Erbon rejeita null explícito)
    ...(data.professionID ? { professionID: data.professionID } : {}),
    ...(data.profession?.trim() ? { profession: data.profession.trim() } : {}),
    vehicleRegistration: data.vehicleRegistration?.trim() || null,
    isClient: data.isClient ?? true,
    isProvider: data.isProvider ?? false,
    address: data.address
      ? {
          country: data.address.country?.trim() || 'BR',
          state: data.address.state?.trim() || null,
          city: data.address.city?.trim() || null,
          street: data.address.street?.trim() || null,
          zipcode: data.address.zipcode?.trim() || null,
          neighborhood: data.address.neighborhood?.trim() || null,
        }
      : null,
    documents: (data.documents || []).map(d => ({
      documentType: d.documentType,
      number: d.number,
      expirationDate: d.expirationDate || null,
      country: (d.country && d.country.trim()) || docCountryFallback,
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

  async getToken(hotelId: string): Promise<string> {
    const cached = tokenCache.get(hotelId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada para este hotel');
    if (!config.is_active) throw new Error('Integração Erbon desativada para este hotel');

    const token = await this.authenticate(config);
    tokenCache.set(hotelId, {
      token,
      expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    });

    return token;
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
        const errText = await authRes.text().catch(() => '');
        console.error('[Erbon] Auth failed:', authRes.status, errText);
        return { success: false, error: `Autenticação falhou (${authRes.status}): ${errText}` };
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
        return { success: false, error: `Hotel não encontrado (${hotelRes.status})` };
      }

      const hotelData = await hotelRes.json();
      return { success: true, hotelName: hotelData.hotelName || 'Hotel conectado' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão' };
    }
  },

  // ── Fetch Erbon Products ────────────────────────────────────────────────

  async fetchErbonProducts(hotelId: string): Promise<ErbonProduct[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');

    const token = await this.getToken(hotelId);

    const productsPath = `/hotel/${config.erbon_hotel_id}/mapping/serviceproducts`;
    const res = await fetch(
      resolveErbonUrl(config.erbon_base_url, productsPath),
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'onlyProducts': 'true',
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

    // Busca departamentos das transações dos últimos 7 dias
    // ErbonTransaction já contém idDepartment (número) + department (nome)
    try {
      const today = new Date();
      for (let daysBack = 0; daysBack < 7; daysBack++) {
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
        // Se já encontrou bastante, pode parar
        if (departments.size >= 5) break;
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
        console.error('[Erbon] Fallback de departamentos via produtos falhou:', err);
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

    // 3) Buscar mapeamentos de produtos
    const { data: productMappings, error: pmError } = await supabase
      .from('erbon_product_mappings')
      .select('product_id, erbon_service_id')
      .eq('hotel_id', hotelId);
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
    erbon_service_id: number;
    erbon_service_description?: string;
  }): Promise<void> {
    const { error } = await supabase
      .from('erbon_product_mappings')
      .upsert(mapping, { onConflict: 'hotel_id,erbon_service_id' });
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
    const token = await this.getToken(hotelId);
    const path = `/hotel/${config.erbon_hotel_id}/booking/${bookingInternalId}/guest/new`;

    const guestBody = buildGuestBody(guestData, null);
    // POST /guest/new espera o objeto dentro da chave "guest": { guest: {...} }
    const body = { guest: guestBody };
    console.log('[Erbon] addGuest payload:', JSON.stringify(body));

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
      const txt = await res.text().catch(() => '');
      console.error('[Erbon] addGuest response:', res.status, txt);
      throw new Error(`Erro ao adicionar hóspede (${res.status}): ${txt}`);
    }

    const created = await res.json().catch(() => ({} as any));
    console.log('[Erbon] addGuest created:', JSON.stringify(created));

    // Extrair ID do hóspede recém-criado (pode vir como `id`, `guestID`, `idGuest`)
    const newGuestId: number | undefined =
      created?.id ?? created?.guestID ?? created?.idGuest ?? created?.Id;

    if (!newGuestId) {
      console.warn('[Erbon] addGuest: ID não retornado, não foi possível anexar à reserva', created);
      return created;
    }

    // Agora anexa à reserva
    try {
      await this.attachGuestToBooking(hotelId, bookingInternalId, newGuestId, options?.isMainGuest);
    } catch (err: any) {
      console.error('[Erbon] Falha ao anexar hóspede recém-criado à reserva:', err.message);
      throw new Error(`Hóspede criado (id=${newGuestId}), mas falhou ao vincular à reserva: ${err.message}`);
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
    console.log('[Erbon] updateGuest payload:', JSON.stringify(body));

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
      const txt = await res.text().catch(() => '');
      console.error('[Erbon] updateGuest response:', res.status, txt);
      throw new Error(`Erro ao atualizar hóspede (${res.status}): ${txt}`);
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
      console.warn(`[Erbon] fetchBookingByInternalId ${bookingInternalId} → ${res.status}`);
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
    console.log('[Erbon] AccountsReceivable raw (first 3):', JSON.stringify(Array.isArray(data) ? data.slice(0, 3) : data));
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
      console.log(`[Erbon] BookingAccount ${path} → ${res.status}`);
      return [];
    }
    const data = await res.json();
    console.log(`[Erbon] BookingAccount (${Array.isArray(data) ? data.length : 0} items):`, JSON.stringify(Array.isArray(data) ? data.slice(0, 3) : data));
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
      console.log('[Erbon] postCharge payload:', JSON.stringify(body));

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
        const txt = await res.text().catch(() => '');
        console.error(`[Erbon] postCharge booking=${bookingInternalId} → ${res.status}`, txt);
        return { success: false, error: `Erbon ${res.status}: ${txt}` };
      }

      console.log(`[Erbon] postCharge OK → booking=${bookingInternalId} service=${charge.idService}`);
      return { success: true };
    } catch (err: any) {
      console.error('[Erbon] postCharge exception:', err.message);
      return { success: false, error: err.message };
    }
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
