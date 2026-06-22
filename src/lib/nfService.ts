// nfService.ts — CRUD de configuração e notas fiscais (NF-e / NFS-e)

import { supabase } from './supabase';
import type {
  NFHotelConfig,
  NFInvoice,
  NFInvoiceItem,
  NFEmittedEntry,
  NFTipo,
} from '../types/nf';

const NF_PROXY = import.meta.env.PROD
  ? '/.netlify/functions/nf-proxy'
  : '/.netlify/functions/nf-proxy';

// ─── Config CRUD ─────────────────────────────────────────────────────────────

async function getConfig(hotelId: string): Promise<NFHotelConfig | null> {
  const { data, error } = await supabase
    .from('nf_hotel_config')
    .select('*')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  if (error) throw error;
  return data as NFHotelConfig | null;
}

async function saveConfig(hotelId: string, config: Partial<NFHotelConfig>): Promise<NFHotelConfig> {
  const payload = { ...config, hotel_id: hotelId, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('nf_hotel_config')
    .upsert(payload, { onConflict: 'hotel_id' })
    .select()
    .single();
  if (error) throw error;
  return data as NFHotelConfig;
}

// ─── Invoices CRUD ───────────────────────────────────────────────────────────

async function getInvoices(
  hotelId: string,
  filters?: { tipo?: NFTipo; bookingId?: number; status?: string },
): Promise<NFInvoice[]> {
  let query = supabase
    .from('nf_invoices')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false });

  if (filters?.tipo) query = query.eq('tipo', filters.tipo);
  if (filters?.bookingId) query = query.eq('erbon_booking_id', filters.bookingId);
  if (filters?.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as NFInvoice[];
}

async function getInvoiceItems(invoiceId: string): Promise<NFInvoiceItem[]> {
  const { data, error } = await supabase
    .from('nf_invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as NFInvoiceItem[];
}

// ─── Emitted Entries (rastreio de itens já faturados) ────────────────────────

async function getEmittedEntries(hotelId: string): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from('nf_emitted_entries')
    .select('erbon_entry_id, invoice_id')
    .eq('hotel_id', hotelId);
  if (error) throw error;
  const map = new Map<number, string>();
  (data ?? []).forEach((row: NFEmittedEntry) => map.set(row.erbon_entry_id, row.invoice_id));
  return map;
}

async function markEntriesAsEmitted(
  hotelId: string,
  entryIds: number[],
  invoiceId: string,
): Promise<void> {
  const rows = entryIds.map((eid) => ({
    hotel_id: hotelId,
    erbon_entry_id: eid,
    invoice_id: invoiceId,
  }));
  const { error } = await supabase.from('nf_emitted_entries').insert(rows);
  if (error) throw error;
}

// ─── Draft + Emit ────────────────────────────────────────────────────────────

interface CreateInvoiceInput {
  hotel_id: string;
  tipo: NFTipo;
  erbon_booking_id: number | null;
  booking_number: string | null;
  room_description: string | null;
  tomador_nome: string;
  tomador_cpf_cnpj: string | null;
  tomador_email: string | null;
  tomador_endereco: string | null;
  items: Array<{
    erbon_entry_id: number;
    descricao: string;
    quantidade: number;
    valor_unitario: number;
    valor_total: number;
  }>;
  emitido_por: string | null;
}

async function createDraftInvoice(input: CreateInvoiceInput): Promise<NFInvoice> {
  const valorTotal = input.items.reduce((sum, i) => sum + i.valor_total, 0);

  const { data: invoice, error: invErr } = await supabase
    .from('nf_invoices')
    .insert({
      hotel_id: input.hotel_id,
      tipo: input.tipo,
      erbon_booking_id: input.erbon_booking_id,
      booking_number: input.booking_number,
      room_description: input.room_description,
      tomador_nome: input.tomador_nome,
      tomador_cpf_cnpj: input.tomador_cpf_cnpj,
      tomador_email: input.tomador_email,
      tomador_endereco: input.tomador_endereco,
      valor_total: valorTotal,
      status: 'rascunho',
      emitido_por: input.emitido_por,
    })
    .select()
    .single();
  if (invErr) throw invErr;

  const itemRows = input.items.map((it) => ({
    invoice_id: invoice.id,
    erbon_entry_id: it.erbon_entry_id,
    descricao: it.descricao,
    quantidade: it.quantidade,
    valor_unitario: it.valor_unitario,
    valor_total: it.valor_total,
  }));

  const { error: itemsErr } = await supabase.from('nf_invoice_items').insert(itemRows);
  if (itemsErr) throw itemsErr;

  return invoice as NFInvoice;
}

async function emitInvoice(invoiceId: string, hotelId: string): Promise<{ success: boolean; message: string; invoice?: NFInvoice }> {
  try {
    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nf-action': 'emit',
      },
      body: JSON.stringify({ invoiceId, hotelId }),
    });

    const result = await res.json();

    if (!res.ok) {
      await supabase
        .from('nf_invoices')
        .update({ status: 'rejeitada' })
        .eq('id', invoiceId);
      return { success: false, message: result.error || 'Erro ao emitir nota fiscal' };
    }

    const { data: updated, error } = await supabase
      .from('nf_invoices')
      .update({
        status: 'autorizada',
        numero_nf: result.numero_nf || null,
        serie: result.serie || null,
        chave_acesso: result.chave_acesso || null,
        numero_protocolo: result.numero_protocolo || null,
        codigo_verificacao: result.codigo_verificacao || null,
        xml_retorno: result.xml_retorno || null,
        pdf_url: result.pdf_url || null,
      })
      .eq('id', invoiceId)
      .select()
      .single();
    if (error) throw error;

    // Marcar entries como emitidas
    const { data: items } = await supabase
      .from('nf_invoice_items')
      .select('erbon_entry_id')
      .eq('invoice_id', invoiceId);

    if (items?.length) {
      const entryIds = items
        .map((i: { erbon_entry_id: number | null }) => i.erbon_entry_id)
        .filter((id): id is number => id != null);
      if (entryIds.length > 0) {
        await markEntriesAsEmitted(hotelId, entryIds, invoiceId);
      }
    }

    return { success: true, message: 'Nota fiscal autorizada com sucesso', invoice: updated as NFInvoice };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, message };
  }
}

async function cancelInvoice(
  invoiceId: string,
  motivo: string,
  canceladoPor: string | null,
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nf-action': 'cancel',
      },
      body: JSON.stringify({ invoiceId, motivo }),
    });

    const result = await res.json();

    if (!res.ok) {
      return { success: false, message: result.error || 'Erro ao cancelar nota fiscal' };
    }

    await supabase
      .from('nf_invoices')
      .update({
        status: 'cancelada',
        cancelada_em: new Date().toISOString(),
        motivo_cancelamento: motivo,
        xml_cancelamento: result.xml_cancelamento || null,
        cancelado_por: canceladoPor,
      })
      .eq('id', invoiceId);

    // Remover rastreio das entries emitidas
    await supabase
      .from('nf_emitted_entries')
      .delete()
      .eq('invoice_id', invoiceId);

    return { success: true, message: 'Nota fiscal cancelada com sucesso' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, message };
  }
}

// ─── Test Connection ─────────────────────────────────────────────────────────

async function testConnection(
  tipo: NFTipo,
  config: Partial<NFHotelConfig>,
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(NF_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nf-action': tipo === 'nfse' ? 'test-nfse' : 'test-nfe',
      },
      body: JSON.stringify(config),
    });
    const result = await res.json();
    return {
      success: res.ok,
      message: result.message || (res.ok ? 'Conexão bem-sucedida' : 'Falha na conexão'),
    };
  } catch {
    return { success: false, message: 'Erro de rede ao testar conexão' };
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const nfService = {
  getConfig,
  saveConfig,
  getInvoices,
  getInvoiceItems,
  getEmittedEntries,
  markEntriesAsEmitted,
  createDraftInvoice,
  emitInvoice,
  cancelInvoice,
  testConnection,
};

export type { CreateInvoiceInput };
