// src/lib/whatsappService.ts
// Serviço de integração com WhatsApp Business Cloud API (Meta)

import { supabase } from './supabase';
import { differenceInHours } from 'date-fns';

const WHATSAPP_PROXY = '/.netlify/functions/whatsapp-proxy';

// ── Inbox Interfaces ─────────────────────────────────────────────────────────

export interface WaConversation {
  id: string;
  hotel_id: string;
  contact_phone: string;
  contact_name: string | null;
  contact_id: string | null;
  status: 'open' | 'closed' | 'bot';
  assigned_to: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  last_customer_message_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  labels?: WaLabel[];
  assignee?: { full_name: string | null; id: string } | null;
}

export interface WaMessage {
  id: string;
  conversation_id: string;
  hotel_id: string | null;
  whatsapp_message_id: string | null;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'template' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'interactive' | 'unknown';
  content: {
    text?: string;
    template_name?: string;
    media_url?: string;
    caption?: string;
    filename?: string;
    [key: string]: unknown;
  };
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  sent_by: string | null;
  sent_at: string;
  created_at: string;
}

export interface WaLabel {
  id: string;
  hotel_id: string | null;
  name: string;
  color: string;
  is_active: boolean;
}

export interface WaAutoResponse {
  id: string;
  hotel_id: string | null;
  name: string;
  trigger_type: 'first_message' | 'keyword' | 'out_of_hours' | 'always';
  trigger_keywords: string[] | null;
  response_text: string;
  is_active: boolean;
  priority: number;
  created_at: string;
}

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
        return { success: false, error: 'Falha ao verificar número do WhatsApp' };
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

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return { success: false, error: 'O WhatsApp recusou o envio do template. Verifique o cadastro na Meta.' };
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

// ── Inbox Service ─────────────────────────────────────────────────────────────

export const waInboxService = {

  // ── Conversations ───────────────────────────────────────────────────────

  async getConversations(hotelId: string, opts?: {
    status?: string;
    labelId?: string;
    search?: string;
  }): Promise<WaConversation[]> {
    let q = supabase
      .from('whatsapp_conversations')
      .select(`
        *,
        assignee:profiles!assigned_to(id, full_name),
        labels:whatsapp_conversation_labels(
          label:whatsapp_labels(id, name, color, is_active)
        )
      `)
      .eq('hotel_id', hotelId)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (opts?.status && opts.status !== 'all') {
      q = q.eq('status', opts.status);
    }
    if (opts?.search) {
      q = q.or(`contact_name.ilike.%${opts.search}%,contact_phone.ilike.%${opts.search}%,last_message_preview.ilike.%${opts.search}%`);
    }

    const { data, error } = await q;
    if (error) throw error;

    // flatten labels
    const convs = (data || []).map((c: any) => ({
      ...c,
      labels: (c.labels || []).map((l: any) => l.label).filter(Boolean),
    })) as WaConversation[];

    // client-side label filter (join table makes server filtering complex)
    if (opts?.labelId) {
      return convs.filter(c => c.labels?.some(l => l.id === opts.labelId));
    }
    return convs;
  },

  async getConversation(id: string): Promise<WaConversation | null> {
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select(`
        *,
        assignee:profiles!assigned_to(id, full_name),
        labels:whatsapp_conversation_labels(
          label:whatsapp_labels(id, name, color, is_active)
        )
      `)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { ...data, labels: (data.labels || []).map((l: any) => l.label).filter(Boolean) } as WaConversation;
  },

  async updateConversation(id: string, updates: Partial<Pick<WaConversation, 'status' | 'assigned_to' | 'contact_name'>>): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_conversations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async markConversationRead(id: string): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_conversations')
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // ── Messages ────────────────────────────────────────────────────────────

  async getMessages(conversationId: string, limit = 60): Promise<WaMessage[]> {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data || []) as WaMessage[];
  },

  /** Envia texto livre (só válido dentro da janela de 24h) */
  async sendText(params: {
    conversationId: string;
    hotelId: string;
    recipientPhone: string;
    text: string;
    sentBy?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const cfg = await whatsappService.getConfig(params.hotelId);
    if (!cfg) return { success: false, error: 'WhatsApp não configurado para este hotel' };

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formatWhatsAppNumber(params.recipientPhone),
      type: 'text',
      text: { preview_url: false, body: params.text },
    };

    try {
      const res = await fetch(WHATSAPP_PROXY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wa-phone-number-id': cfg.phone_number_id,
          'x-wa-access-token': cfg.access_token,
          'x-wa-action': 'send',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.error?.message || 'Erro ao enviar' };

      const waMessageId = data?.messages?.[0]?.id || null;

      // persist locally
      await supabase.from('whatsapp_messages').insert({
        conversation_id: params.conversationId,
        hotel_id: params.hotelId,
        whatsapp_message_id: waMessageId,
        direction: 'outbound',
        type: 'text',
        content: { text: params.text },
        status: 'sent',
        sent_by: params.sentBy || null,
        sent_at: new Date().toISOString(),
      });

      // update conversation preview
      await supabase.from('whatsapp_conversations').update({
        last_message_at: new Date().toISOString(),
        last_message_preview: params.text.slice(0, 80),
        updated_at: new Date().toISOString(),
      }).eq('id', params.conversationId);

      return { success: true, messageId: waMessageId };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  /** Envia template (qualquer momento) */
  async sendTemplateFromInbox(params: {
    conversationId: string;
    hotelId: string;
    recipientPhone: string;
    templateName: string;
    languageCode?: string;
    bodyParams?: string[];
    sentBy?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const result = await whatsappService.sendTemplate({
      hotelId: params.hotelId,
      recipientPhone: params.recipientPhone,
      templateName: params.templateName,
      languageCode: params.languageCode,
      bodyParams: params.bodyParams,
    });
    if (!result.success) return result;

    await supabase.from('whatsapp_messages').insert({
      conversation_id: params.conversationId,
      hotel_id: params.hotelId,
      whatsapp_message_id: result.messageId || null,
      direction: 'outbound',
      type: 'template',
      content: { template_name: params.templateName, params: params.bodyParams },
      status: 'sent',
      sent_by: params.sentBy || null,
      sent_at: new Date().toISOString(),
    });

    await supabase.from('whatsapp_conversations').update({
      last_message_at: new Date().toISOString(),
      last_message_preview: `[Template: ${params.templateName}]`,
      updated_at: new Date().toISOString(),
    }).eq('id', params.conversationId);

    return result;
  },

  // ── Labels ───────────────────────────────────────────────────────────────

  async getLabels(hotelId: string): Promise<WaLabel[]> {
    const { data, error } = await supabase
      .from('whatsapp_labels')
      .select('*')
      .or(`hotel_id.eq.${hotelId},hotel_id.is.null`)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return (data || []) as WaLabel[];
  },

  async saveLabel(label: Partial<WaLabel> & { name: string; hotel_id: string }): Promise<WaLabel> {
    if (label.id) {
      const { data, error } = await supabase.from('whatsapp_labels')
        .update({ name: label.name, color: label.color || '#6B7280' })
        .eq('id', label.id).select().single();
      if (error) throw error;
      return data as WaLabel;
    }
    const { data, error } = await supabase.from('whatsapp_labels')
      .insert({ hotel_id: label.hotel_id, name: label.name, color: label.color || '#6B7280' })
      .select().single();
    if (error) throw error;
    return data as WaLabel;
  },

  async deleteLabel(id: string): Promise<void> {
    const { error } = await supabase.from('whatsapp_labels').update({ is_active: false }).eq('id', id);
    if (error) throw error;
  },

  async addLabelToConversation(conversationId: string, labelId: string): Promise<void> {
    await supabase.from('whatsapp_conversation_labels')
      .upsert({ conversation_id: conversationId, label_id: labelId });
  },

  async removeLabelFromConversation(conversationId: string, labelId: string): Promise<void> {
    await supabase.from('whatsapp_conversation_labels')
      .delete().eq('conversation_id', conversationId).eq('label_id', labelId);
  },

  // ── Auto-Responses ───────────────────────────────────────────────────────

  async getAutoResponses(hotelId: string): Promise<WaAutoResponse[]> {
    const { data, error } = await supabase
      .from('whatsapp_auto_responses')
      .select('*')
      .or(`hotel_id.eq.${hotelId},hotel_id.is.null`)
      .order('priority', { ascending: false });
    if (error) throw error;
    return (data || []) as WaAutoResponse[];
  },

  async saveAutoResponse(rule: Partial<WaAutoResponse> & { name: string; trigger_type: string; response_text: string; hotel_id: string }): Promise<WaAutoResponse> {
    const payload = {
      hotel_id: rule.hotel_id,
      name: rule.name,
      trigger_type: rule.trigger_type,
      trigger_keywords: rule.trigger_keywords || null,
      response_text: rule.response_text,
      is_active: rule.is_active ?? true,
      priority: rule.priority ?? 0,
      updated_at: new Date().toISOString(),
    };
    if (rule.id) {
      const { data, error } = await supabase.from('whatsapp_auto_responses').update(payload).eq('id', rule.id).select().single();
      if (error) throw error;
      return data as WaAutoResponse;
    }
    const { data, error } = await supabase.from('whatsapp_auto_responses').insert(payload).select().single();
    if (error) throw error;
    return data as WaAutoResponse;
  },

  async toggleAutoResponse(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.from('whatsapp_auto_responses').update({ is_active: isActive }).eq('id', id);
    if (error) throw error;
  },

  async deleteAutoResponse(id: string): Promise<void> {
    const { error } = await supabase.from('whatsapp_auto_responses').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Helpers ──────────────────────────────────────────────────────────────

  isWithin24hWindow(conv: WaConversation): boolean {
    if (!conv.last_customer_message_at) return false;
    return differenceInHours(new Date(), new Date(conv.last_customer_message_at)) < 24;
  },
};
