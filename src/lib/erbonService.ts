// src/lib/erbonService.ts
// Serviço de integração com a API Erbon PMS

import { supabase } from './supabase';

// Em dev, usa proxy do Vite para evitar CORS. Em prod, chama direto.
const ERBON_PROXY_PREFIX = '/erbon-api';
const isDev = import.meta.env.DEV;

function resolveErbonUrl(baseUrl: string, path: string): string {
  if (isDev) {
    // Proxy: /erbon-api/auth/login → Vite reescreve para https://api.erbonsoftware.com/auth/login
    return `${ERBON_PROXY_PREFIX}${path}`;
  }
  return `${baseUrl}${path}`;
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
  product_id: string;
  erbon_service_id: number;
  erbon_service_description: string | null;
}

export interface ErbonSectorMapping {
  id: string;
  hotel_id: string;
  sector_id: string;
  erbon_department: string;
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
          erbon_base_url: config.erbon_base_url || 'https://api.erbonsoftware.com',
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
          erbon_base_url: config.erbon_base_url || 'https://api.erbonsoftware.com',
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
    const res = await fetch(resolveErbonUrl(config.erbon_base_url, '/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      const baseUrl = config.erbon_base_url || 'https://api.erbonsoftware.com';

      // 1) Auth
      const authRes = await fetch(resolveErbonUrl(baseUrl, '/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      console.log('[Erbon] Auth response status:', authRes.status);
      console.log('[Erbon] Auth response type:', authRes.headers.get('content-type'));
      console.log('[Erbon] Auth raw response (first 200 chars):', raw.substring(0, 200));
      console.log('[Erbon] Auth raw length:', raw.length);

      let token: string;
      try {
        const parsed = JSON.parse(raw);
        console.log('[Erbon] Parsed type:', typeof parsed);
        console.log('[Erbon] Parsed keys:', typeof parsed === 'object' && parsed !== null ? Object.keys(parsed) : 'N/A');
        if (typeof parsed === 'object' && parsed !== null) {
          token = parsed.bearerToken || parsed.token || parsed.access_token || '';
        } else {
          token = String(parsed);
        }
      } catch {
        token = raw;
      }
      token = token.replace(/^["']|["']$/g, '').trim();
      console.log('[Erbon] Final token (first 50 chars):', token.substring(0, 50));
      console.log('[Erbon] Token empty?', !token);

      if (!token) {
        return { success: false, error: `Token vazio. Raw response: ${raw.substring(0, 100)}` };
      }

      // 2) Fetch hotel info
      const hotelRes = await fetch(resolveErbonUrl(baseUrl, `/hotel/${config.erbon_hotel_id}`), {
        headers: { 'Authorization': `Bearer ${token}` },
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

    const res = await fetch(
      resolveErbonUrl(config.erbon_base_url, `/hotel/${config.erbon_hotel_id}/mapping/serviceproducts`),
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'onlyProducts': 'true',
        },
      }
    );

    if (!res.ok) throw new Error(`Erro ao buscar produtos Erbon (${res.status})`);
    return await res.json();
  },

  // ── Fetch Erbon Departments (extracted from products) ───────────────────

  async fetchErbonDepartments(hotelId: string): Promise<string[]> {
    const products = await this.fetchErbonProducts(hotelId);
    const departments = new Set<string>();
    products.forEach(p => {
      if (p.stocksGroupDescription) departments.add(p.stocksGroupDescription);
    });
    return Array.from(departments).sort();
  },

  // ── Fetch Transactions for a single date ────────────────────────────────

  async fetchTransactionsForDate(hotelId: string, date: string): Promise<ErbonTransaction[]> {
    const config = await this.getConfig(hotelId);
    if (!config) throw new Error('Configuração Erbon não encontrada');

    const token = await this.getToken(hotelId);

    const res = await fetch(
      resolveErbonUrl(config.erbon_base_url, `/hotel/${config.erbon_hotel_id}/sales/transactions`),
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'transactionDate': date,
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
    product_id: string;
    erbon_service_id: number;
    erbon_service_description?: string;
  }): Promise<void> {
    const { error } = await supabase
      .from('erbon_product_mappings')
      .upsert(mapping, { onConflict: 'hotel_id,product_id' });
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
