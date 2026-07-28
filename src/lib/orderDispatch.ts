// src/lib/orderDispatch.ts
// Disparo da imagem do pedido para os fornecedores, na aprovação do orçamento.
//
// Fluxo completo:
//   /purchases/dynamic-budget/analysis → escolhe o que comprar de cada fornecedor
//   /purchases/list                    → operador vincula um contato por fornecedor
//   /authorizations                    → na aprovação, dispara um envio por fornecedor
//   /budget-history                    → 'approved' vira 'on_the_way' se houve envio
//
// Um envio por fornecedor, com a imagem filtrada nos itens dele, para não expor
// preço de concorrente.

import { supabase } from './supabase';
import { whatsappService } from './whatsappService';
import {
  generateOrderImageBase64,
  buildOrderMessageText,
  distinctSuppliers,
  sameSupplier,
  type OrderHotel,
  type OrderItem,
} from './orderImage';

export interface OrderRecipient {
  id: string;
  budget_id: string;
  supplier_name: string;
  contact_id: string | null;
  whatsapp_number: string | null;
  sent_at: string | null;
  sent_message_id: string | null;
  send_error: string | null;
  send_attempts: number;
  // joined
  contact?: { id: string; company_name: string; whatsapp_number: string } | null;
}

export interface DispatchResult {
  supplierName: string;
  phone: string | null;
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface DispatchSummary {
  results: DispatchResult[];
  sent: number;
  failed: number;
  /** Fornecedores da lista que ficaram sem contato vinculado */
  withoutContact: string[];
  /** true quando houve pelo menos um envio bem sucedido */
  anySent: boolean;
}

// ── Persistência dos destinatários ───────────────────────────────────────────

export async function getOrderRecipients(budgetId: string): Promise<OrderRecipient[]> {
  const { data, error } = await supabase
    .from('budget_order_recipients')
    .select('*, contact:supplier_contacts(id, company_name, whatsapp_number)')
    .eq('budget_id', budgetId)
    .order('supplier_name');
  if (error) throw error;
  return (data || []) as OrderRecipient[];
}

/**
 * Grava os vínculos fornecedor → contato de um orçamento.
 * Substitui o conjunto anterior, porque a tela edita a lista inteira de uma vez.
 */
export async function saveOrderRecipients(
  budgetId: string,
  entries: Array<{ supplierName: string; contactId?: string | null; whatsappNumber?: string | null }>,
): Promise<void> {
  const validas = entries.filter(
    e => e.contactId || (e.whatsappNumber && e.whatsappNumber.trim()),
  );

  await supabase.from('budget_order_recipients').delete().eq('budget_id', budgetId);

  if (validas.length === 0) return;

  const { error } = await supabase.from('budget_order_recipients').insert(
    validas.map(e => ({
      budget_id: budgetId,
      supplier_name: e.supplierName,
      contact_id: e.contactId || null,
      whatsapp_number: e.whatsappNumber?.trim() || null,
    })),
  );
  if (error) throw error;
}

// ── Disparo ──────────────────────────────────────────────────────────────────

/** Número de destino: o do contato cadastrado, ou o digitado direto */
function resolvePhone(r: OrderRecipient): string | null {
  const doContato = r.contact?.whatsapp_number?.trim();
  if (doContato) return doContato;
  const direto = r.whatsapp_number?.trim();
  return direto || null;
}

/**
 * Gera e envia a imagem do pedido para cada fornecedor com contato vinculado.
 *
 * Não lança: uma falha de envio para um fornecedor não deve impedir os outros nem
 * derrubar a aprovação, que já aconteceu no banco. Cada resultado é gravado em
 * budget_order_recipients para permitir reenvio manual em /budget-history.
 */
export async function dispatchOrderToSuppliers(params: {
  budgetId: string;
  hotelId: string;
  hotel: OrderHotel;
  items: OrderItem[];
  /** Reenvia inclusive quem já foi enviado. Padrão: só os pendentes. */
  includeAlreadySent?: boolean;
  /** Restringe a um fornecedor, usado pelo reenvio individual */
  onlySupplier?: string;
}): Promise<DispatchSummary> {
  const { budgetId, hotelId, hotel, items } = params;

  const todos = await getOrderRecipients(budgetId);

  const alvos = todos.filter(r => {
    if (params.onlySupplier && !sameSupplier(r.supplier_name, params.onlySupplier)) return false;
    if (!params.includeAlreadySent && r.sent_at) return false;
    return true;
  });

  const comContato = distinctSuppliers(items).filter(s =>
    todos.some(r => sameSupplier(r.supplier_name, s)),
  );
  const withoutContact = distinctSuppliers(items).filter(
    s => !comContato.some(c => sameSupplier(c, s)),
  );

  const results: DispatchResult[] = [];

  for (const r of alvos) {
    const phone = resolvePhone(r);

    if (!phone) {
      results.push({
        supplierName: r.supplier_name,
        phone: null,
        success: false,
        error: 'Destinatário sem número de WhatsApp.',
      });
      continue;
    }

    const doFornecedor = items.filter(i => sameSupplier(i.supplier, r.supplier_name));
    if (doFornecedor.length === 0) {
      results.push({
        supplierName: r.supplier_name,
        phone,
        success: false,
        error: 'Nenhum item deste fornecedor no orçamento.',
      });
      continue;
    }

    let resultado: { success: boolean; messageId?: string; error?: string };

    try {
      const imageBase64 = await generateOrderImageBase64({
        hotel,
        supplierName: r.supplier_name,
        items: doFornecedor,
      });

      resultado = await whatsappService.sendImageBase64({
        hotelId,
        recipientPhone: phone,
        imageBase64,
        caption: buildOrderMessageText(hotel, r.supplier_name),
        fileName: `pedido-${r.supplier_name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.png`,
      });
    } catch (err: unknown) {
      resultado = {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao gerar a imagem do pedido.',
      };
    }

    results.push({
      supplierName: r.supplier_name,
      phone,
      success: resultado.success,
      messageId: resultado.messageId,
      error: resultado.error,
    });

    // Registra o resultado por destinatário, para o reenvio manual saber o estado
    await supabase
      .from('budget_order_recipients')
      .update({
        sent_at: resultado.success ? new Date().toISOString() : null,
        sent_message_id: resultado.messageId || null,
        send_error: resultado.success ? null : (resultado.error || 'Erro desconhecido'),
        send_attempts: (r.send_attempts || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', r.id);

    // Auditoria no log geral de mensagens
    try {
      await whatsappService.logMessage({
        hotel_id: hotelId,
        contact_id: r.contact_id || undefined,
        template_key: 'order_image',
        whatsapp_message_id: resultado.messageId,
        status: resultado.success ? 'sent' : 'failed',
        error_message: resultado.error,
        metadata: { budget_id: budgetId, supplier: r.supplier_name },
      });
    } catch {
      // Falha de auditoria não invalida o envio
    }
  }

  const sent = results.filter(r => r.success).length;

  return {
    results,
    sent,
    failed: results.length - sent,
    withoutContact,
    anySent: sent > 0,
  };
}

/**
 * Marca o orçamento como despachado. Chamado só quando houve envio, porque é o
 * que diferencia 'on_the_way' (fornecedor avisado) de 'approved' (tratamento
 * manual pendente).
 */
export async function markOrderDispatched(budgetId: string): Promise<void> {
  await supabase
    .from('budgets')
    .update({ order_dispatched_at: new Date().toISOString() })
    .eq('id', budgetId);
}

/** Dados fiscais da unidade compradora, que vão na imagem e no texto */
export async function getOrderHotel(hotelId: string): Promise<OrderHotel> {
  const { data } = await supabase
    .from('hotels')
    .select('name, fantasy_name, corporate_name, cnpj')
    .eq('id', hotelId)
    .maybeSingle();
  return (data as OrderHotel) || { name: 'Hotel' };
}

/** Itens aprovados do orçamento, no formato que a imagem consome */
export async function getOrderItems(budgetId: string): Promise<OrderItem[]> {
  const { data, error } = await supabase
    .from('budget_items')
    .select('custom_item_name, quantity, unit, supplier, unit_price, item_status, product:products(name)')
    .eq('budget_id', budgetId);
  if (error) throw error;

  return (data || [])
    // Item rejeitado na autorização não entra no pedido enviado ao fornecedor
    .filter((i: any) => i.item_status !== 'rejected')
    .map((i: any) => ({
      name: i.custom_item_name || i.product?.name || 'Item',
      quantity: i.quantity ?? 0,
      unit: i.unit || 'und',
      supplier: i.supplier,
      unitPrice: i.unit_price,
    }));
}

/**
 * Ponto de entrada usado pela aprovação e pelo reenvio manual: carrega hotel,
 * itens e destinatários do banco, dispara, e atualiza o status do orçamento.
 *
 * O status só vai para 'on_the_way' quando algum envio deu certo. Sem contato
 * vinculado, ou com todas as tentativas falhando, o orçamento fica em 'approved'
 * para tratamento manual, que é o comportamento pedido.
 */
export async function dispatchOrderForBudget(params: {
  budgetId: string;
  hotelId: string;
  includeAlreadySent?: boolean;
  onlySupplier?: string;
  /** Não mexe no status. Usado no reenvio de um fornecedor isolado. */
  skipStatusChange?: boolean;
}): Promise<DispatchSummary> {
  const [hotel, items] = await Promise.all([
    getOrderHotel(params.hotelId),
    getOrderItems(params.budgetId),
  ]);

  const summary = await dispatchOrderToSuppliers({
    budgetId: params.budgetId,
    hotelId: params.hotelId,
    hotel,
    items,
    includeAlreadySent: params.includeAlreadySent,
    onlySupplier: params.onlySupplier,
  });

  if (summary.anySent && !params.skipStatusChange) {
    await markOrderDispatched(params.budgetId);
    await supabase
      .from('budgets')
      .update({ status: 'on_the_way' })
      .eq('id', params.budgetId)
      // Só avança de approved: não rebaixa um pedido já entregue nem revive cancelado
      .eq('status', 'approved');
  }

  return summary;
}

/** Resumo legível do disparo, para a notificação na tela */
export function describeDispatch(summary: DispatchSummary): { message: string; kind: 'success' | 'warning' | 'info' } {
  const partes: string[] = [];
  if (summary.sent > 0) partes.push(`${summary.sent} pedido${summary.sent > 1 ? 's' : ''} enviado${summary.sent > 1 ? 's' : ''}`);
  if (summary.failed > 0) partes.push(`${summary.failed} falha${summary.failed > 1 ? 's' : ''}`);
  if (summary.withoutContact.length > 0) {
    partes.push(`${summary.withoutContact.length} fornecedor${summary.withoutContact.length > 1 ? 'es' : ''} sem contato`);
  }

  if (partes.length === 0) {
    return { message: 'Nenhum fornecedor com contato vinculado. O pedido segue como aprovado.', kind: 'info' };
  }

  return {
    message: partes.join(', ') + '.',
    kind: summary.failed > 0 || summary.withoutContact.length > 0
      ? (summary.sent > 0 ? 'warning' : 'info')
      : 'success',
  };
}
