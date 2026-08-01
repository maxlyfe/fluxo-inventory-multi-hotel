// src/lib/arBilling.test.ts
// Testes dos helpers puros do faturamento por parceiro e dos recebíveis de
// cartão. São as duas partes onde um erro silencioso custa dinheiro: a inferência
// de cartão é heurística sobre texto livre da Erbon, e a colagem de números de
// reserva é a porta de entrada da marcação em lote.
//
// O client Supabase é mockado porque src/lib/supabase.ts lança se as env vars
// não existirem, e estes helpers não tocam no banco.

import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { parseCardInfo } from './arService';
import { parseBookingRefsInput, previewExpectedDates, partnerName } from './billingService';
import type { BillingQueueRow } from './billingService';

describe('parseCardInfo', () => {
  it('reconhece bandeira e modalidade em rótulo da Erbon', () => {
    expect(parseCardInfo('Cartão de Débito')).toMatchObject({ modality: 'debito', source: 'erbon' });
    expect(parseCardInfo('Cartão de Crédito Visa')).toMatchObject({
      brand: 'visa', modality: 'credito', source: 'erbon',
    });
  });

  it('reconhece bandeira dentro de texto de integração', () => {
    expect(parseCardInfo(null, 'Integrado via Bee2Pay Rede Master Card')).toMatchObject({ brand: 'master' });
    expect(parseCardInfo('MC crédito')).toMatchObject({ brand: 'master' });
    expect(parseCardInfo('Hiper Card')).toMatchObject({ brand: 'hipercard' });
    expect(parseCardInfo('AMERICAN EXPRESS')).toMatchObject({ brand: 'amex' });
  });

  it('extrai o número de parcelas em vários formatos', () => {
    expect(parseCardInfo('Crédito 3x').installments).toBe(3);
    expect(parseCardInfo('Crédito em 6 vezes').installments).toBe(6);
    expect(parseCardInfo('Crédito 12 parcelas').installments).toBe(12);
  });

  it('limita as parcelas ao intervalo aceito pelo banco', () => {
    expect(parseCardInfo('Crédito 99x').installments).toBe(24);
  });

  it('marca como indefinido o que não dá para inferir', () => {
    // Este é o ponto crítico: sem bandeira nem parcelas, o cálculo tem que cair
    // no fallback da regra do canal em vez de assumir crédito à vista.
    expect(parseCardInfo('Pagamento na recepção')).toEqual({
      brand: null, modality: null, installments: null, source: 'indefinido',
    });
    expect(parseCardInfo('')).toMatchObject({ source: 'indefinido' });
    expect(parseCardInfo(null, null)).toMatchObject({ source: 'indefinido' });
  });
});

describe('parseBookingRefsInput', () => {
  it('aceita quebra de linha, vírgula, ponto e vírgula e espaço', () => {
    expect(parseBookingRefsInput('88123\n88124, 88125 88126;88127'))
      .toEqual(['88123', '88124', '88125', '88126', '88127']);
  });

  it('remove duplicatas sem diferenciar caixa', () => {
    expect(parseBookingRefsInput('AB12\nab12\n88123\n88123')).toEqual(['AB12', '88123']);
  });

  it('ignora espaços e linhas vazias', () => {
    expect(parseBookingRefsInput('  88123  \n\n\t 88124 \n')).toEqual(['88123', '88124']);
    expect(parseBookingRefsInput('   ')).toEqual([]);
    expect(parseBookingRefsInput('')).toEqual([]);
  });
});

describe('previewExpectedDates', () => {
  const row = (over: Partial<BillingQueueRow>): BillingQueueRow => ({
    ar_title_id: 't1', hotel_id: 'h1', booking_ref: '1', description: null, channel: null,
    guest_name: null, checkin_date: null, checkout_date: null,
    gross_amount: 100, net_amount: 100, amount_received: 0,
    billing_status: 'aguardando_cobranca', billed_at: null, expected_date: null, ar_status: 'previsto',
    supplier_id: 's1', razao_social: 'ACME LTDA', nome_fantasia: null, supplier_cnpj: null,
    supplier_email: null, channel_rule_id: 'r1', days_to_receive: 30, billing_email: null,
    billing_attach_nf: true, billing_dispatch_mode: 'manual',
    nf_invoice_id: null, numero_nf: null, nf_status: null, pdf_url: null, danfse_url: null,
    nf_created_at: null, dispatch_id: null, dispatch_status: null, dispatch_to_email: null,
    from_email: null, attempts: null, dispatch_error: null, sent_at: null, marked_manually: null,
    dias_parado: null, ...over,
  });

  it('agrupa por parceiro e prazo, somando o valor em aberto', () => {
    const groups = previewExpectedDates(
      [
        row({ ar_title_id: 'a', net_amount: 100 }),
        row({ ar_title_id: 'b', net_amount: 200 }),
        row({ ar_title_id: 'c', nome_fantasia: 'XPTO', days_to_receive: 15, net_amount: 50 }),
      ],
      '2026-07-12',
    );

    expect(groups).toHaveLength(2);
    const acme = groups.find(g => g.partner === 'ACME LTDA')!;
    expect(acme).toMatchObject({ days: 30, count: 2, amount: 300, expected: '2026-08-11' });
    expect(groups.find(g => g.partner === 'XPTO')).toMatchObject({ days: 15, expected: '2026-07-27' });
  });

  it('desconta o que já foi recebido do valor previsto', () => {
    const [g] = previewExpectedDates([row({ net_amount: 100, amount_received: 40 })], '2026-07-12');
    expect(g.amount).toBe(60);
  });

  it('atravessa a virada de mês sem errar a data', () => {
    const [g] = previewExpectedDates([row({ days_to_receive: 30 })], '2026-12-15');
    expect(g.expected).toBe('2027-01-14');
  });

  it('prazo zero devolve a própria data da cobrança', () => {
    const [g] = previewExpectedDates([row({ days_to_receive: 0 })], '2026-07-12');
    expect(g.expected).toBe('2026-07-12');
  });
});

describe('partnerName', () => {
  it('prefere fantasia, cai para razão social e por fim avisa que não há parceiro', () => {
    expect(partnerName({ nome_fantasia: 'ACME', razao_social: 'ACME LTDA' } as BillingQueueRow)).toBe('ACME');
    expect(partnerName({ nome_fantasia: null, razao_social: 'ACME LTDA' } as BillingQueueRow)).toBe('ACME LTDA');
    expect(partnerName({ nome_fantasia: null, razao_social: null } as BillingQueueRow)).toBe('Sem parceiro');
  });
});
