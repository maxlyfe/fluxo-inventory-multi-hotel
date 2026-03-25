// src/lib/whatsappService.ts
// Serviço de integração com WhatsApp Business Cloud API (Meta)

import { supabase } from './supabase';

const WHATSAPP_PROXY = '/.netlify/functions/whatsapp-proxy';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface WhatsAppConfig {
  id: string;
  hotel_id: string | null;
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  display_phone: string | null;
  is_active: boolean;
}

export interface ContactCategory {
  id: string;
  name: string;
  color: string;
  icon: string;
  is_active: boolean;
}

export interface SupplierContact {
  id: string;
  hotel_id: string;
  company_name: string;
  contact_name: string | null;
  whatsapp_number: string;
  email: string | null;
  notes: string | null;
  category_id: string | null;
  employee_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  contact_categories?: ContactCategory | null;
}

export interface WhatsAppMessageTemplate {
  id: string;
  template_key: string;
  template_name: string;
  description: string | null;
  language_code: string;
  parameter_mappings: Record<string, string>;
  is_active: boolean;
}

export interface WhatsAppMessageLog {
  id: string;
  hotel_id: string | null;
  contact_id: string | null;
  template_key: string;
  whatsapp_message_id: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  error_message: string | null;
  sent_at: string;
  sent_by: string | null;
}

export interface SendTemplateParams {
  hotelId: string;
  recipientPhone: string;
  templateName: string;
  languageCode?: string;
  bodyParams?: string[];
  headerImageUrl?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Formata número para padrão WhatsApp: apenas dígitos com código do país */
export function formatWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Números brasileiros: 10-11 dígitos (DDD + número) — SEMPRE adicionar 55
  // Isso cobre inclusive DDD 55 (Santa Maria, RS) que começaria com "55..."
  if (digits.length >= 10 && digits.length <= 11) {
    return `55${digits}`;
  }
  // 12-13 dígitos começando com 55: já tem código de país
  if (digits.length >= 12 && digits.length <= 13 && digits.startsWith('55')) {
    return digits;
  }
  // Fallback: retorna como está (números internacionais)
  return digits;
}

/** Valida formato de número WhatsApp */
export function isValidWhatsAppNumber(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  // Aceita com ou sem código do país (mínimo 10, máximo 15 dígitos)
  return digits.length >= 10 && digits.length <= 15;
}

// ── Service ─────────────────────────────────────────────────────────────────

export const whatsappService = {

  // ── Config ──────────────────────────────────────────────────────────────

  /** Busca config do hotel, com fallback para config global (hotel_id IS NULL) */
  async getConfig(hotelId: string): Promise<WhatsAppConfig | null> {
    // Primeiro tenta config específica do hotel
    const { data: hotelConfig } = await supabase
      .from('whatsapp_configs')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('is_active', true)
      .maybeSingle();

    if (hotelConfig) return hotelConfig;

    // Fallback: config global
    const { data: globalConfig } = await supabase
      .from('whatsapp_configs')
      .select('*')
      .is('hotel_id', null)
      .eq('is_active', true)
      .maybeSingle();

    return globalConfig;
  },

  async saveConfig(config: Partial<WhatsAppConfig> & { phone_number_id: string; waba_id: string; access_token: string }): Promise<WhatsAppConfig> {
    const hotelId = config.hotel_id || null;

    // Buscar existente
    let query = supabase.from('whatsapp_configs').select('*');
    if (hotelId) {
      query = query.eq('hotel_id', hotelId);
    } else {
      query = query.is('hotel_id', null);
    }
    const { data: existing } = await query.maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from('whatsapp_configs')
        .update({
          phone_number_id: config.phone_number_id,
          waba_id: config.waba_id,
          access_token: config.access_token,
          display_phone: config.display_phone || null,
          is_active: config.is_active ?? true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('whatsapp_configs')
        .insert({
          hotel_id: hotelId,
          phone_number_id: config.phone_number_id,
          waba_id: config.waba_id,
          access_token: config.access_token,
          display_phone: config.display_phone || null,
          is_active: config.is_active ?? true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  },

  // ── Test Connection ────────────────────────────────────────────────────

  async testConnection(config: Pick<WhatsAppConfig, 'phone_number_id' | 'access_token'>): Promise<{ success: boolean; phoneName?: string; error?: string }> {
    try {
      const res = await fetch(WHATSAPP_PROXY, {
        method: 'GET',
        headers: {
          'x-wa-phone-number-id': config.phone_number_id,
          'x-wa-access-token': config.access_token,
          'x-wa-action': 'verify',
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return { success: false, error: errData?.error?.message || `HTTP ${res.status}` };
      }

      const data = await res.json();
      return { success: true, phoneName: data.verified_name || data.display_phone_number || 'Conectado' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro de conexão';
      return { success: false, error: message };
    }
  },

  // ── Send Template Message ─────────────────────────────────────────────

  async sendTemplate(params: SendTemplateParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const config = await this.getConfig(params.hotelId);
    if (!config) return { success: false, error: 'WhatsApp não configurado para este hotel' };

    // Montar payload Meta Cloud API
    const components: any[] = [];

    // Header com imagem (se houver)
    if (params.headerImageUrl) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: params.headerImageUrl } }],
      });
    }

    // Body params
    if (params.bodyParams && params.bodyParams.length > 0) {
      components.push({
        type: 'body',
        parameters: params.bodyParams.map(text => ({ type: 'text', text })),
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: formatWhatsAppNumber(params.recipientPhone),
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.languageCode || 'pt_BR' },
        components: components.length > 0 ? components : undefined,
      },
    };

    try {
      const res = await fetch(WHATSAPP_PROXY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wa-phone-number-id': config.phone_number_id,
          'x-wa-access-token': config.access_token,
          'x-wa-action': 'send',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data?.error?.message || `HTTP ${res.status}` };
      }

      const messageId = data?.messages?.[0]?.id || null;
      return { success: true, messageId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao enviar';
      return { success: false, error: message };
    }
  },

  // ── Log ────────────────────────────────────────────────────────────────

  async logMessage(entry: {
    hotel_id: string;
    contact_id?: string;
    template_key: string;
    whatsapp_message_id?: string;
    status: string;
    metadata?: Record<string, unknown>;
    error_message?: string;
    sent_by?: string;
  }): Promise<void> {
    await supabase.from('whatsapp_message_log').insert({
      hotel_id: entry.hotel_id,
      contact_id: entry.contact_id || null,
      template_key: entry.template_key,
      whatsapp_message_id: entry.whatsapp_message_id || null,
      status: entry.status,
      metadata: entry.metadata || null,
      error_message: entry.error_message || null,
      sent_by: entry.sent_by || null,
    });
  },

  // ── Contacts CRUD ─────────────────────────────────────────────────────

  // ── Categories CRUD ──────────────────────────────────────────────────

  async getCategories(): Promise<ContactCategory[]> {
    const { data, error } = await supabase
      .from('contact_categories')
      .select('*')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return data || [];
  },

  async saveCategory(cat: Partial<ContactCategory> & { name: string }): Promise<ContactCategory> {
    if (cat.id) {
      const { data, error } = await supabase
        .from('contact_categories')
        .update({ name: cat.name, color: cat.color || '#6B7280', icon: cat.icon || 'Tag', updated_at: new Date().toISOString() })
        .eq('id', cat.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await supabase
      .from('contact_categories')
      .insert({ name: cat.name, color: cat.color || '#6B7280', icon: cat.icon || 'Tag' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteCategory(categoryId: string): Promise<void> {
    // Desvincula contatos dessa categoria antes de desativar
    await supabase.from('supplier_contacts').update({ category_id: null }).eq('category_id', categoryId);
    const { error } = await supabase
      .from('contact_categories')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', categoryId);
    if (error) throw error;
  },

  // ── Contacts CRUD ─────────────────────────────────────────────────────

  /** Busca todos os contatos ativos (compartilhados entre hotéis) com categoria */
  async getContacts(): Promise<SupplierContact[]> {
    const { data, error } = await supabase
      .from('supplier_contacts')
      .select('*, contact_categories(*)')
      .eq('is_active', true)
      .order('company_name');
    if (error) throw error;
    return data || [];
  },

  async saveContact(contact: Partial<SupplierContact> & { company_name: string; whatsapp_number: string }): Promise<SupplierContact> {
    if (contact.id) {
      const { data, error } = await supabase
        .from('supplier_contacts')
        .update({
          company_name: contact.company_name,
          contact_name: contact.contact_name || null,
          whatsapp_number: contact.whatsapp_number,
          email: contact.email || null,
          notes: contact.notes || null,
          category_id: contact.category_id || null,
          is_active: contact.is_active ?? true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contact.id)
        .select('*, contact_categories(*)')
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('supplier_contacts')
        .insert({
          hotel_id: contact.hotel_id || null,
          company_name: contact.company_name,
          contact_name: contact.contact_name || null,
          whatsapp_number: contact.whatsapp_number,
          email: contact.email || null,
          notes: contact.notes || null,
          category_id: contact.category_id || null,
          employee_id: contact.employee_id || null,
        })
        .select('*, contact_categories(*)')
        .single();
      if (error) throw error;
      return data;
    }
  },

  async deleteContact(contactId: string): Promise<void> {
    const { error } = await supabase
      .from('supplier_contacts')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', contactId);
    if (error) throw error;
  },

  // ── Product-Contact Links ─────────────────────────────────────────────

  async getProductContacts(productId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('product_supplier_contacts')
      .select('contact_id')
      .eq('product_id', productId);
    if (error) throw error;
    return (data || []).map(d => d.contact_id);
  },

  async syncProductContacts(productId: string, contactIds: string[]): Promise<void> {
    // Deletar todos os vínculos existentes
    await supabase
      .from('product_supplier_contacts')
      .delete()
      .eq('product_id', productId);

    // Inserir novos
    if (contactIds.length > 0) {
      const rows = contactIds.map(contactId => ({
        product_id: productId,
        contact_id: contactId,
      }));
      const { error } = await supabase
        .from('product_supplier_contacts')
        .insert(rows);
      if (error) throw error;
    }
  },

  // ── Budget Contacts (buscar contatos vinculados a um orçamento) ───────

  async getBudgetContacts(budgetId: string): Promise<SupplierContact[]> {
    // 1. Buscar product_ids do orçamento
    const { data: items, error: itemsErr } = await supabase
      .from('dynamic_budget_items')
      .select('product_id')
      .eq('budget_id', budgetId);
    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) return [];

    const productIds = items.map(i => i.product_id).filter(Boolean);
    if (productIds.length === 0) return [];

    // 2. Buscar contact_ids vinculados a esses produtos
    const { data: links, error: linksErr } = await supabase
      .from('product_supplier_contacts')
      .select('contact_id')
      .in('product_id', productIds);
    if (linksErr) throw linksErr;
    if (!links || links.length === 0) return [];

    const contactIds = [...new Set(links.map(l => l.contact_id))];

    // 3. Buscar dados dos contatos
    const { data: contacts, error: contactsErr } = await supabase
      .from('supplier_contacts')
      .select('*')
      .in('id', contactIds)
      .eq('is_active', true)
      .order('company_name');
    if (contactsErr) throw contactsErr;
    return contacts || [];
  },

  // ── Templates ─────────────────────────────────────────────────────────

  async getTemplates(): Promise<WhatsAppMessageTemplate[]> {
    const { data, error } = await supabase
      .from('whatsapp_message_templates')
      .select('*')
      .eq('is_active', true)
      .order('template_key');
    if (error) throw error;
    return data || [];
  },

  // ── Message Log ───────────────────────────────────────────────────────

  async getMessageLog(hotelId: string, limit = 50): Promise<WhatsAppMessageLog[]> {
    const { data, error } = await supabase
      .from('whatsapp_message_log')
      .select('*, supplier_contacts(company_name, contact_name)')
      .eq('hotel_id', hotelId)
      .order('sent_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },
};
