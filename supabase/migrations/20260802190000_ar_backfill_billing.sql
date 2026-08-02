-- ============================================================================
-- rpc_ar_backfill_billing_for_period — traz para a fila de cobranças as NFs que
-- JÁ FORAM EMITIDAS antes de o parceiro existir.
--
-- POR QUE PRECISA EXISTIR
-- rpc_ar_prepare_billing_for_nf roda no momento da autorização da nota, dentro
-- do nfService. Isso cobre o fluxo normal, mas deixa de fora o caso mais comum
-- na adoção do módulo: a nota foi emitida ANTES de alguém cadastrar a regra do
-- parceiro. Nessas notas a RPC devolveu 'sem_regra_faturamento' (ou nem chegou a
-- rodar, se a nota é anterior à migration), o título ficou em 'nao_aplicavel' e
-- nada aparece na fila — não há como nem testar o envio.
--
-- Reprocessar em lote é seguro porque a RPC de preparação é idempotente: o
-- INSERT do vínculo é ON CONFLICT DO NOTHING, e o do disparo é ON CONFLICT
-- (ar_title_id) DO UPDATE que preserva assunto, corpo e status de qualquer
-- cobrança já enviada ou marcada à mão. Rodar duas vezes no mesmo período não
-- duplica nada nem reescreve o que o parceiro já recebeu.
--
-- Resultado ITEM A ITEM, com o motivo de cada nota que ficou de fora: sem isso
-- o operador vê "0 encontradas" e não sabe se o problema é a regra, o CNPJ do
-- tomador ou o período escolhido.
--
-- IDEMPOTENTE.
-- ============================================================================

BEGIN;

-- ── Guarda de dependência ───────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.rpc_ar_prepare_billing_for_nf(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Falta rpc_ar_prepare_billing_for_nf. Aplique primeiro '
      'supabase/migrations/20260802130000_ar_billing_rpcs.sql.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_ar_backfill_billing_for_period(
  p_hotel_id uuid,
  p_from     date,
  p_to       date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nf          record;
  v_res         jsonb;
  v_had         boolean;
  v_scanned     int := 0;
  v_prepared    int := 0;
  v_already     int := 0;
  v_skipped     int := 0;
  v_reasons     jsonb := '{}'::jsonb;
  v_details     jsonb := '[]'::jsonb;
  v_reason      text;
  -- Detalhe é para a tela: cortar em 200 evita devolver payload gigante quando
  -- alguém escolhe "últimos 2 anos" num hotel com muita nota.
  c_max_details constant int := 200;
BEGIN
  IF NOT can_read_hotel(p_hotel_id) THEN
    RAISE EXCEPTION 'Sem acesso a este hotel';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Periodo invalido';
  END IF;

  -- Só nota que vale no fisco e que tem CNPJ no tomador: NF de hóspede pessoa
  -- física nunca vira cobrança de parceiro, e nem faz sentido reportar como
  -- "ignorada" (poluiria a tela com centenas de linhas irrelevantes).
  FOR v_nf IN
    SELECT i.id, i.numero_nf, i.booking_number, i.tomador_nome, i.valor_total,
           i.created_at::date AS emitida_em
      FROM nf_invoices i
     WHERE i.hotel_id = p_hotel_id
       AND i.status IN ('autorizada', 'emitida', 'contingencia')
       AND i.created_at::date BETWEEN p_from AND p_to
       AND length(regexp_replace(COALESCE(i.tomador_cpf_cnpj, ''), '\D', '', 'g')) = 14
     ORDER BY i.created_at
  LOOP
    v_scanned := v_scanned + 1;

    -- Já estava na fila? Precisa ser medido ANTES da chamada, senão a RPC
    -- idempotente faz tudo parecer "preparado agora".
    SELECT EXISTS (
      SELECT 1 FROM ar_billing_dispatches d WHERE d.nf_invoice_id = v_nf.id
    ) INTO v_had;

    v_res := rpc_ar_prepare_billing_for_nf(v_nf.id);

    IF COALESCE((v_res->>'ok')::boolean, false) THEN
      IF v_had THEN v_already := v_already + 1;
      ELSE v_prepared := v_prepared + 1;
      END IF;
    ELSE
      v_skipped := v_skipped + 1;
      v_reason  := COALESCE(v_res->>'reason', 'desconhecido');
      v_reasons := jsonb_set(
        v_reasons, ARRAY[v_reason],
        to_jsonb(COALESCE((v_reasons->>v_reason)::int, 0) + 1), true);

      IF jsonb_array_length(v_details) < c_max_details THEN
        v_details := v_details || jsonb_build_object(
          'nf_invoice_id', v_nf.id,
          'numero_nf',     v_nf.numero_nf,
          'booking_ref',   v_nf.booking_number,
          'tomador',       v_nf.tomador_nome,
          'valor',         v_nf.valor_total,
          'emitida_em',    v_nf.emitida_em,
          'reason',        v_reason);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'scanned',  v_scanned,
    'prepared', v_prepared,
    'already',  v_already,
    'skipped',  v_skipped,
    'reasons',  v_reasons,
    'details',  v_details,
    'details_truncated', v_skipped > c_max_details,
    'from', p_from, 'to', p_to
  );
END $$;

COMMENT ON FUNCTION public.rpc_ar_backfill_billing_for_period(uuid, date, date) IS
  'Reprocessa NFs já emitidas no período e traz para a fila de cobranças as que '
  'casam com regra de parceiro faturado. Idempotente: preserva cobrança já '
  'enviada ou marcada à mão. Usada pelo botão "Buscar NFs emitidas".';

GRANT EXECUTE ON FUNCTION public.rpc_ar_backfill_billing_for_period(uuid, date, date)
  TO authenticated;

COMMIT;

-- ============================================================================
-- TESTE
--   SELECT public.rpc_ar_backfill_billing_for_period(
--     '<hotel_id>'::uuid, CURRENT_DATE - 90, CURRENT_DATE);
--
-- Rodar duas vezes: na segunda, "prepared" tem que vir 0 e "already" com o
-- número da primeira. Se "prepared" repetir, a idempotência quebrou.
-- ============================================================================
