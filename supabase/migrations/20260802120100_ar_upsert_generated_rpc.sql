-- ============================================================================
-- Contas a Receber — Fase 0: geração idempotente de títulos
--
-- Substitui o upsertTitles do arService, que usava
--   .upsert(..., { onConflict: 'origin,origin_ref,installment_number',
--                  ignoreDuplicates: true })
-- e por isso NUNCA corrigia um título já existente. Consequência real: o
-- operador ajustava days_to_receive ou a taxa da regra, clicava em "Gerar das
-- reservas", a tela dizia "nenhum recebível novo", e a previsão continuava
-- errada para sempre. Não existia caminho de recálculo.
--
-- Aqui apaga e reinsere, mas NUNCA toca em título que:
--   * já teve recebimento (amount_received > 0)
--   * está cancelado
--   * já teve cobrança enviada (billing_status = 'cobranca_enviada')
--   * foi ajustado à mão (manual_override = true)
--
-- Mesma disciplina de fn_sync_purchase_ap (20260713120001_ap_purchase_sync.sql).
-- Tudo dentro de uma transação: ou o grupo inteiro é regravado, ou nada muda.
--
-- IDEMPOTENTE.
-- ============================================================================

BEGIN;

-- ── Guarda de dependência ───────────────────────────────────────────────────
-- can_read_hotel(uuid) vem de 20260730120000_rls_helpers.sql (Lote 0), que
-- estava commitada mas não aplicada no banco.
-- Aqui a guarda é essencial: o corpo de uma função plpgsql NÃO é resolvido na
-- criação, então sem ela a função seria criada com sucesso e só falharia em
-- produção, na primeira vez que alguém clicasse em "Gerar das reservas".
DO $$
BEGIN
  IF to_regprocedure('public.can_read_hotel(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Falta a funcao can_read_hotel(uuid). Aplique primeiro '
      'supabase/migrations/20260730120000_rls_helpers.sql (Lote 0 de RLS: '
      'aditiva, cria apenas funcoes, nao altera policy nenhuma).';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_ar_upsert_generated(p_hotel_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group     record;
  v_inserted  integer := 0;
  v_preserved integer := 0;
  v_deleted   integer := 0;
  v_n         integer;
BEGIN
  IF NOT can_read_hotel(p_hotel_id) THEN
    RAISE EXCEPTION 'Sem acesso a este hotel';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('inserted', 0, 'preserved', 0, 'deleted', 0);
  END IF;

  -- Limpa apenas o que está intocado, grupo por grupo (origin + origin_ref).
  FOR v_group IN
    SELECT (e ->> 'origin') AS origin, (e ->> 'origin_ref') AS origin_ref
      FROM jsonb_array_elements(p_rows) e
     GROUP BY 1, 2
  LOOP
    SELECT count(*) INTO v_n
      FROM ar_titles
     WHERE hotel_id = p_hotel_id
       AND origin = v_group.origin
       AND origin_ref = v_group.origin_ref
       AND (amount_received > 0
            OR status = 'cancelado'
            OR billing_status = 'cobranca_enviada'
            OR manual_override);
    v_preserved := v_preserved + COALESCE(v_n, 0);

    WITH del AS (
      DELETE FROM ar_titles
       WHERE hotel_id = p_hotel_id
         AND origin = v_group.origin
         AND origin_ref = v_group.origin_ref
         AND amount_received = 0
         AND status <> 'cancelado'
         AND billing_status <> 'cobranca_enviada'
         AND NOT manual_override
      RETURNING 1
    ) SELECT count(*) INTO v_n FROM del;
    v_deleted := v_deleted + COALESCE(v_n, 0);
  END LOOP;

  -- hotel_id vem SEMPRE do parâmetro, nunca do payload: senão o cliente poderia
  -- gravar título no hotel de outro grupo passando hotel_id na linha.
  WITH ins AS (
    INSERT INTO ar_titles (
      hotel_id, description, origin, origin_ref, channel, booking_ref,
      guest_name, checkin_date, checkout_date,
      gross_amount, fee_amount, net_amount, expected_date,
      acquirer_id, acquirer_rule_id, card_brand, card_modality, card_data_source,
      installments, installment_number, installment_total,
      supplier_id, channel_rule_id, billing_status, notes
    )
    SELECT
      p_hotel_id,
      e ->> 'description',
      e ->> 'origin',
      e ->> 'origin_ref',
      e ->> 'channel',
      NULLIF(e ->> 'booking_ref', ''),
      NULLIF(e ->> 'guest_name', ''),
      NULLIF(e ->> 'checkin_date', '')::date,
      NULLIF(e ->> 'checkout_date', '')::date,
      (e ->> 'gross_amount')::numeric,
      (e ->> 'fee_amount')::numeric,
      (e ->> 'net_amount')::numeric,
      NULLIF(e ->> 'expected_date', '')::date,
      NULLIF(e ->> 'acquirer_id', '')::uuid,
      NULLIF(e ->> 'acquirer_rule_id', '')::uuid,
      NULLIF(e ->> 'card_brand', ''),
      NULLIF(e ->> 'card_modality', ''),
      NULLIF(e ->> 'card_data_source', ''),
      NULLIF(e ->> 'installments', '')::int,
      COALESCE((e ->> 'installment_number')::int, 1),
      NULLIF(e ->> 'installment_total', '')::int,
      NULLIF(e ->> 'supplier_id', '')::uuid,
      NULLIF(e ->> 'channel_rule_id', '')::uuid,
      COALESCE(NULLIF(e ->> 'billing_status', ''), 'nao_aplicavel'),
      NULLIF(e ->> 'notes', '')
    FROM jsonb_array_elements(p_rows) e
    -- Conflito = a linha preservada acima (recebida, cancelada, cobrada ou
    -- ajustada à mão). Preservar é exatamente o comportamento desejado.
    ON CONFLICT (origin, origin_ref, installment_number) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'inserted',  COALESCE(v_inserted, 0),
    'preserved', v_preserved,
    'deleted',   v_deleted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ar_upsert_generated(uuid, jsonb) TO authenticated;

COMMIT;
