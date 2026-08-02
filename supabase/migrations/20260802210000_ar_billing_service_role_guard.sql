-- ============================================================================
-- CORREÇÃO DE BUG: a consolidação da cobrança nunca acontecia quando o e-mail
-- era enviado pela Netlify Function.
--
-- O QUE ACONTECIA
-- rpc_ar_mark_billing_sent abre com `IF NOT can_read_hotel(p_hotel_id) THEN
-- RAISE EXCEPTION`, e can_read_hotel resolve auth.uid(). A function de envio usa
-- a chave de SERVICE ROLE, onde não existe usuário: auth.uid() é NULL, o guarda
-- reprovava e a RPC lançava exceção. A chamada em ar-billing.ts não checava o
-- erro (supabase-js devolve {error} em vez de lançar), então a exceção era
-- engolida.
--
-- Resultado observado em produção (reserva 7385, 02/08/2026): o e-mail SAIU, o
-- Gmail devolveu message-id, o disparo virou 'enviado' — e o recebível ficou em
-- 'aguardando_cobranca' com expected_date NULL. Ou seja: cobrança feita, prazo
-- nunca começou a contar, e o valor invisível na previsão de caixa, aparecendo
-- para sempre na aba "A disparar" como se nada tivesse acontecido.
--
-- A CORREÇÃO
-- fn_is_service_role() lê o claim 'role' do JWT da requisição. A chave de service
-- role já contorna toda a RLS por definição, então aceitá-la aqui não afrouxa
-- nada: só reconhece o chamador legítimo do servidor.
--
-- Por que não usar current_user/session_user: dentro de uma função SECURITY
-- DEFINER, current_user é o OWNER da função, não o chamador. A checagem tem que
-- ser pelo claim, que é uma configuração de sessão e sobrevive ao SECURITY
-- DEFINER.
--
-- IDEMPOTENTE.
-- ============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Reconhece o chamador de servidor
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  -- current_setting(..., true) devolve NULL em vez de erro quando o parâmetro não
  -- existe (chamada fora do PostgREST, como no SQL Editor).
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    ''
  ) = 'service_role';
$$;

COMMENT ON FUNCTION public.fn_is_service_role() IS
  'true quando a chamada vem com a chave de service role (Netlify Function). '
  'Usar em guarda de RPC que também é chamada pelo servidor, onde auth.uid() e '
  'NULL. Nao usar current_user: em SECURITY DEFINER ele e o owner, nao o chamador.';

GRANT EXECUTE ON FUNCTION public.fn_is_service_role() TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. rpc_ar_mark_billing_sent com o guarda corrigido
-- ──────────────────────────────────────────────────────────────────────────────
-- Corpo idêntico ao de 20260802130000, exceto a linha do guarda. Replicado
-- inteiro porque CREATE OR REPLACE FUNCTION exige o corpo completo.
CREATE OR REPLACE FUNCTION public.rpc_ar_mark_billing_sent(
  p_hotel_id     uuid,
  p_billed_on    date,
  p_ar_title_ids uuid[] DEFAULT NULL,
  p_booking_refs text[] DEFAULT NULL,
  p_manual       boolean DEFAULT true,
  p_note         text    DEFAULT NULL,
  p_force        boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated  uuid[]  := '{}';
  v_skipped  jsonb   := '[]'::jsonb;
  v_notfound text[]  := '{}';
  v_days     integer;
  r record;
BEGIN
  -- AQUI ESTAVA O BUG: só can_read_hotel, que reprova a chave de service role
  -- porque auth.uid() é NULL nela.
  IF NOT (fn_is_service_role() OR can_read_hotel(p_hotel_id)) THEN
    RAISE EXCEPTION 'Sem acesso a este hotel';
  END IF;
  IF p_billed_on IS NULL THEN RAISE EXCEPTION 'Informe a data do envio da cobrança'; END IF;
  IF p_billed_on > CURRENT_DATE THEN RAISE EXCEPTION 'A data da cobrança não pode ser futura'; END IF;

  -- Refs que o operador colou e que não casam com nenhum título do hotel.
  SELECT COALESCE(array_agg(x), '{}') INTO v_notfound
    FROM unnest(COALESCE(p_booking_refs, '{}')) AS x
   WHERE btrim(x) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM ar_titles t
        WHERE t.hotel_id = p_hotel_id
          AND lower(btrim(t.booking_ref)) = lower(btrim(x)));

  FOR r IN
    SELECT t.*, cr.days_to_receive AS rule_days
      FROM ar_titles t
      LEFT JOIN channel_receiving_rules cr ON cr.id = t.channel_rule_id
     WHERE t.hotel_id = p_hotel_id
       AND ( t.id = ANY(COALESCE(p_ar_title_ids, '{}'))
             OR lower(btrim(t.booking_ref)) = ANY (
                  SELECT lower(btrim(x)) FROM unnest(COALESCE(p_booking_refs, '{}')) x) )
     FOR UPDATE OF t
  LOOP
    IF r.status = 'cancelado' THEN
      v_skipped := v_skipped || jsonb_build_object(
        'id', r.id, 'booking_ref', r.booking_ref, 'reason', 'cancelado');
      CONTINUE;
    END IF;
    IF r.billing_status = 'nao_aplicavel' AND NOT p_force THEN
      v_skipped := v_skipped || jsonb_build_object(
        'id', r.id, 'booking_ref', r.booking_ref, 'reason', 'nao_e_faturamento');
      CONTINUE;
    END IF;
    IF r.billing_status = 'cobranca_enviada' AND NOT p_force THEN
      v_skipped := v_skipped || jsonb_build_object(
        'id', r.id, 'booking_ref', r.booking_ref, 'reason', 'ja_cobrado');
      CONTINUE;
    END IF;

    v_days := COALESCE(r.rule_days, 0);

    UPDATE ar_titles SET
      billing_status = 'cobranca_enviada',
      billed_at      = p_billed_on,
      -- Título com recebimento mantém a data original: recalcular mudaria o
      -- histórico de algo que já foi liquidado.
      expected_date  = CASE WHEN amount_received > 0 AND expected_date IS NOT NULL
                            THEN expected_date ELSE p_billed_on + v_days END,
      notes          = COALESCE(notes, '') || COALESCE(chr(10) || p_note, ''),
      updated_at     = now()
     WHERE id = r.id;

    INSERT INTO ar_billing_dispatches (
      hotel_id, ar_title_id, supplier_id, channel_rule_id,
      status, billed_on, marked_manually, notes, sent_at, created_by
    ) VALUES (
      p_hotel_id, r.id, r.supplier_id, r.channel_rule_id,
      CASE WHEN p_manual THEN 'manual' ELSE 'enviado' END,
      p_billed_on, p_manual, p_note, now(), auth.uid()
    )
    ON CONFLICT (ar_title_id) DO UPDATE SET
      status          = CASE WHEN p_manual THEN 'manual' ELSE 'enviado' END,
      billed_on       = p_billed_on,
      marked_manually = p_manual,
      sent_at         = COALESCE(ar_billing_dispatches.sent_at, now()),
      next_retry_at   = NULL,
      error           = NULL,
      notes           = COALESCE(EXCLUDED.notes, ar_billing_dispatches.notes),
      updated_at      = now();

    v_updated := v_updated || r.id;
  END LOOP;

  RETURN jsonb_build_object(
    'updated_count', cardinality(v_updated),
    'updated', v_updated,
    'skipped', v_skipped,
    'refs_nao_encontradas', v_notfound
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ar_mark_billing_sent(uuid, date, uuid[], text[], boolean, text, boolean)
  TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. REPARO do dado já corrompido pelo bug
-- ──────────────────────────────────────────────────────────────────────────────
-- Qualquer disparo com status 'enviado' e sent_at preenchido cujo título ficou
-- em 'aguardando_cobranca': o e-mail saiu, então a cobrança É válida e o prazo
-- deve contar da data do envio que está gravada. Roda uma vez; depois da
-- correção acima o caso não volta a acontecer.
DO $$
DECLARE
  r record;
  v_days integer;
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT d.id AS dispatch_id, d.sent_at::date AS enviado_em,
           t.id AS title_id, t.amount_received, t.expected_date,
           COALESCE(cr.days_to_receive, 0) AS days
      FROM ar_billing_dispatches d
      JOIN ar_titles t ON t.id = d.ar_title_id
      LEFT JOIN channel_receiving_rules cr ON cr.id = t.channel_rule_id
     WHERE d.status = 'enviado'
       AND d.sent_at IS NOT NULL
       AND t.billing_status = 'aguardando_cobranca'
       AND t.status <> 'cancelado'
  LOOP
    v_days := r.days;

    UPDATE ar_titles SET
      billing_status = 'cobranca_enviada',
      billed_at      = r.enviado_em,
      expected_date  = CASE WHEN r.amount_received > 0 AND r.expected_date IS NOT NULL
                            THEN r.expected_date ELSE r.enviado_em + v_days END,
      notes          = COALESCE(notes, '')
                       || chr(10) || 'Consolidacao corrigida em ' || CURRENT_DATE::text
                       || ' (bug do guarda de service role: e-mail enviado em '
                       || r.enviado_em::text || ' sem consolidar o prazo).',
      updated_at     = now()
     WHERE id = r.title_id;

    UPDATE ar_billing_dispatches SET
      billed_on  = COALESCE(billed_on, r.enviado_em),
      error      = NULL,
      updated_at = now()
     WHERE id = r.dispatch_id;

    v_n := v_n + 1;
    RAISE NOTICE 'Consolidado titulo % (enviado em %, previsao %)',
      r.title_id, r.enviado_em, r.enviado_em + v_days;
  END LOOP;

  RAISE NOTICE '=== % titulo(s) consolidado(s) retroativamente ===', v_n;
END $$;

COMMIT;

-- ============================================================================
-- CONFERÊNCIA (tem que voltar VAZIO)
--   SELECT d.id, d.status, d.sent_at, t.billing_status, t.expected_date
--     FROM ar_billing_dispatches d JOIN ar_titles t ON t.id = d.ar_title_id
--    WHERE d.status = 'enviado' AND d.sent_at IS NOT NULL
--      AND t.billing_status <> 'cobranca_enviada' AND t.status <> 'cancelado';
--
-- E o teste do guarda, que antes falhava (auth.uid() é NULL no SQL Editor e o
-- claim de service_role não está setado, então deve continuar recusando aqui):
--   SELECT fn_is_service_role();  -- false no SQL Editor, true na Function
-- ============================================================================
