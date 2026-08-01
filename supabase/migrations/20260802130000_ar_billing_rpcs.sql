-- ============================================================================
-- Contas a Receber — Fase 3: faturamento por parceiro (RPCs + fila)
--
-- Quatro RPCs e uma view:
--   rpc_ar_prepare_billing_for_nf  → NF autorizada vira título + disparo pendente
--   rpc_ar_revert_billing_for_nf   → NF cancelada não deixa recebível fantasma
--   rpc_ar_mark_billing_sent       → marca cobrança efetuada (LOTE, retroativa)
--   rpc_ar_resolve_booking_refs    → pré-visualização da colagem de reservas
--   v_ar_billing_queue             → a fila de "Cobranças a disparar"
--
-- Todas: SECURITY DEFINER + SET search_path + guarda can_read_hotel, e
-- resultado ITEM A ITEM. Lote que falha em 1 de 8 nunca sai como "deu erro".
--
-- IDEMPOTENTE.
-- ============================================================================

BEGIN;

-- ── Guarda de dependência ───────────────────────────────────────────────────
-- can_read_hotel(uuid) vem de 20260730120000_rls_helpers.sql (Lote 0), que
-- estava commitada mas não aplicada no banco. As funções plpgsql daqui só
-- falhariam em tempo de execução sem esta guarda.
DO $$
BEGIN
  IF to_regprocedure('public.can_read_hotel(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Falta a funcao can_read_hotel(uuid). Aplique primeiro '
      'supabase/migrations/20260730120000_rls_helpers.sql (Lote 0 de RLS: '
      'aditiva, cria apenas funcoes, nao altera policy nenhuma).';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- A. NF autorizada → título faturado + disparo pendente
-- ──────────────────────────────────────────────────────────────────────────────
-- Chamada uma vez por nfService depois da autorização, em try/catch: a nota já
-- está autorizada no fisco, então falhar aqui NUNCA pode ser reportado como
-- falha de emissão (levaria o operador a emitir de novo). O que escapar aparece
-- na fila de cobranças, que é a rede de segurança.
CREATE OR REPLACE FUNCTION public.rpc_ar_prepare_billing_for_nf(p_nf_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nf       nf_invoices%ROWTYPE;
  v_rule     channel_receiving_rules%ROWTYPE;
  v_supplier suppliers%ROWTYPE;
  v_title    ar_titles%ROWTYPE;
  v_cnpj     text;
  v_ref      text;
  v_email    text;
  v_vars     jsonb;
  v_subject  text;
  v_body     text;
  v_fee      numeric(14,2);
BEGIN
  SELECT * INTO v_nf FROM nf_invoices WHERE id = p_nf_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'nf_nao_encontrada'); END IF;
  IF NOT can_read_hotel(v_nf.hotel_id) THEN RAISE EXCEPTION 'Sem acesso a este hotel'; END IF;

  -- Mesma régua de "nota que vale no fisco" usada por nfService.isNFValida.
  IF v_nf.status NOT IN ('autorizada','emitida','contingencia') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nf_sem_status_valido');
  END IF;

  v_cnpj := regexp_replace(COALESCE(v_nf.tomador_cpf_cnpj, ''), '\D', '', 'g');
  IF length(v_cnpj) <> 14 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tomador_nao_e_cnpj');
  END IF;

  SELECT * INTO v_rule FROM fn_ar_partner_rule(v_nf.hotel_id, v_cnpj);
  IF v_rule.id IS NULL OR v_rule.trigger_event <> 'faturamento' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_regra_faturamento');
  END IF;

  SELECT * INTO v_supplier FROM suppliers WHERE id = v_rule.supplier_id;

  -- 1) Localiza o título pela reserva. Se a NF não tem reserva (faturamento
  --    consolidado), cria um título origin='faturado'.
  v_ref := NULLIF(btrim(COALESCE(v_nf.booking_number, '')), '');

  IF v_ref IS NOT NULL THEN
    SELECT * INTO v_title FROM ar_titles
     WHERE hotel_id = v_nf.hotel_id
       AND lower(btrim(booking_ref)) = lower(v_ref)
       AND status <> 'cancelado'
     ORDER BY installment_number
     LIMIT 1;
  END IF;

  v_fee := round(COALESCE(v_nf.valor_total, 0) * COALESCE(v_rule.default_fee_percent, 0) / 100, 2);

  IF v_title.id IS NULL THEN
    INSERT INTO ar_titles (
      hotel_id, description, origin, origin_ref, channel, booking_ref,
      gross_amount, fee_amount, net_amount, expected_date,
      supplier_id, channel_rule_id, billing_status
    ) VALUES (
      v_nf.hotel_id,
      'Faturamento ' || COALESCE(v_supplier.nome_fantasia, v_supplier.razao_social, v_nf.tomador_nome)
        || COALESCE(' · NF ' || v_nf.numero_nf, ''),
      'faturado', 'nf-' || p_nf_invoice_id::text, v_rule.channel, v_ref,
      COALESCE(v_nf.valor_total, 0), v_fee, COALESCE(v_nf.valor_total, 0) - v_fee,
      NULL,   -- sem data firme até o disparo da cobrança
      v_rule.supplier_id, v_rule.id, 'aguardando_cobranca'
    )
    ON CONFLICT (origin, origin_ref, installment_number) DO NOTHING
    RETURNING * INTO v_title;

    IF v_title.id IS NULL THEN
      SELECT * INTO v_title FROM ar_titles
       WHERE origin = 'faturado'
         AND origin_ref = 'nf-' || p_nf_invoice_id::text
         AND installment_number = 1;
    END IF;
  ELSE
    -- Título veio da reserva: promove para aguardando_cobranca e solta a data.
    -- NUNCA se já houve recebimento ou se a cobrança já saiu (padrão
    -- fn_sync_purchase_ap: dado com movimento financeiro é intocável).
    UPDATE ar_titles SET
      supplier_id     = COALESCE(supplier_id, v_rule.supplier_id),
      channel_rule_id = COALESCE(channel_rule_id, v_rule.id),
      billing_status  = CASE WHEN billing_status = 'cobranca_enviada'
                             THEN billing_status ELSE 'aguardando_cobranca' END,
      expected_date   = CASE WHEN amount_received > 0 OR billing_status = 'cobranca_enviada'
                             THEN expected_date ELSE NULL END,
      updated_at      = now()
     WHERE id = v_title.id
    RETURNING * INTO v_title;
  END IF;

  IF v_title.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'titulo_nao_resolvido');
  END IF;

  -- 2) Liga a NF ao título (N:N, idempotente)
  INSERT INTO ar_title_nf_invoices (hotel_id, ar_title_id, nf_invoice_id, amount, created_by)
  VALUES (v_nf.hotel_id, v_title.id, p_nf_invoice_id, v_nf.valor_total, auth.uid())
  ON CONFLICT (ar_title_id, nf_invoice_id) DO NOTHING;

  -- 3) Dispatch pendente, com assunto e corpo JÁ RENDERIZADOS. Gravar renderizado
  --    é o que permite auditar meses depois o texto exato que o parceiro recebeu.
  v_email := COALESCE(NULLIF(v_rule.billing_email, ''), NULLIF(v_supplier.email, ''),
                      NULLIF(v_nf.tomador_email, ''));

  v_vars := jsonb_build_object(
    'parceiro',     COALESCE(v_supplier.nome_fantasia, v_supplier.razao_social, v_nf.tomador_nome, ''),
    'razao_social', COALESCE(v_supplier.razao_social, v_nf.tomador_nome, ''),
    'cnpj',         v_cnpj,
    'numero_nf',    COALESCE(v_nf.numero_nf, ''),
    'chave_nf',     COALESCE(v_nf.chave_acesso, ''),
    'link_nf',      COALESCE(v_nf.danfse_url, v_nf.pdf_url, ''),
    'valor',        to_char(COALESCE(v_nf.valor_total, 0), 'FM999G999G990D00'),
    'reserva',      COALESCE(v_ref, ''),
    'hospede',      COALESCE(v_nf.tomador_nome, ''),
    'checkin',      COALESCE(to_char(v_title.checkin_date,  'DD/MM/YYYY'), ''),
    'checkout',     COALESCE(to_char(v_title.checkout_date, 'DD/MM/YYYY'), ''),
    'vencimento',   to_char(CURRENT_DATE + COALESCE(v_rule.days_to_receive, 0), 'DD/MM/YYYY'),
    'hotel',        COALESCE((SELECT name FROM hotels WHERE id = v_nf.hotel_id), ''),
    'dias_prazo',   COALESCE(v_rule.days_to_receive, 0)::text
  );

  v_subject := fn_render_billing_template(
    COALESCE(NULLIF(v_rule.billing_subject_template, ''), 'Cobrança NF {{numero_nf}} - {{hotel}}'), v_vars);
  v_body := fn_render_billing_template(
    COALESCE(NULLIF(v_rule.billing_body_template, ''),
      'Prezados {{parceiro}},' || chr(10) || chr(10) ||
      'Segue a nota fiscal {{numero_nf}} no valor de R$ {{valor}}, referente à reserva {{reserva}}.' || chr(10) ||
      'Vencimento: {{vencimento}} ({{dias_prazo}} dias).' || chr(10) || chr(10) ||
      'Documento: {{link_nf}}'), v_vars);

  INSERT INTO ar_billing_dispatches (
    hotel_id, ar_title_id, nf_invoice_id, supplier_id, channel_rule_id,
    to_email, cc_emails, subject, body, attachment_url,
    status, billed_on, next_retry_at, created_by
  ) VALUES (
    v_nf.hotel_id, v_title.id, p_nf_invoice_id, v_rule.supplier_id, v_rule.id,
    v_email, COALESCE(v_rule.billing_cc_emails, '{}'), v_subject, v_body,
    CASE WHEN COALESCE(v_rule.billing_attach_nf, true)
         THEN COALESCE(v_nf.danfse_url, v_nf.pdf_url) END,
    'pendente', CURRENT_DATE, now(), auth.uid()
  )
  ON CONFLICT (ar_title_id) DO UPDATE SET
    nf_invoice_id  = COALESCE(ar_billing_dispatches.nf_invoice_id, EXCLUDED.nf_invoice_id),
    to_email       = COALESCE(ar_billing_dispatches.to_email, EXCLUDED.to_email),
    -- Disparo já enviado ou marcado à mão não tem o texto reescrito: o que foi
    -- enviado tem que continuar sendo o que está gravado.
    subject        = CASE WHEN ar_billing_dispatches.status IN ('enviado','manual')
                          THEN ar_billing_dispatches.subject ELSE EXCLUDED.subject END,
    body           = CASE WHEN ar_billing_dispatches.status IN ('enviado','manual')
                          THEN ar_billing_dispatches.body ELSE EXCLUDED.body END,
    attachment_url = COALESCE(EXCLUDED.attachment_url, ar_billing_dispatches.attachment_url),
    status         = CASE WHEN ar_billing_dispatches.status = 'cancelado'
                          THEN 'pendente' ELSE ar_billing_dispatches.status END,
    updated_at     = now();

  RETURN jsonb_build_object(
    'ok', true,
    'ar_title_id', v_title.id,
    'rule_id', v_rule.id,
    'dispatch_mode', COALESCE(v_rule.billing_dispatch_mode, 'manual'),
    'to_email', v_email,
    'has_email', v_email IS NOT NULL
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- B. NF cancelada → desfaz a preparação
-- ──────────────────────────────────────────────────────────────────────────────
-- Sem isto, cancelar a nota deixava recebível fantasma com data firme na
-- previsão de caixa.
CREATE OR REPLACE FUNCTION public.rpc_ar_revert_billing_for_nf(p_nf_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hotel uuid;
  v_reverted uuid[] := '{}';
  v_kept     uuid[] := '{}';
  r record;
BEGIN
  SELECT hotel_id INTO v_hotel FROM nf_invoices WHERE id = p_nf_invoice_id;
  IF v_hotel IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'nf_nao_encontrada'); END IF;
  IF NOT can_read_hotel(v_hotel) THEN RAISE EXCEPTION 'Sem acesso a este hotel'; END IF;

  FOR r IN
    SELECT t.* FROM ar_titles t
      JOIN ar_title_nf_invoices l ON l.ar_title_id = t.id
     WHERE l.nf_invoice_id = p_nf_invoice_id
     FOR UPDATE OF t
  LOOP
    -- Título com recebimento fica como está: o dinheiro entrou, cancelar a nota
    -- não desfaz isso, e mexer aqui é que criaria inconsistência.
    IF r.amount_received > 0 THEN
      v_kept := v_kept || r.id;
      CONTINUE;
    END IF;

    UPDATE ar_titles SET
      billing_status = 'aguardando_nf',
      billed_at      = NULL,
      expected_date  = NULL,
      updated_at     = now()
     WHERE id = r.id;

    UPDATE ar_billing_dispatches SET
      status = 'cancelado', next_retry_at = NULL, updated_at = now()
     WHERE ar_title_id = r.id;

    v_reverted := v_reverted || r.id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'reverted', v_reverted, 'kept_with_receipts', v_kept);
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- C. Marcar cobrança efetuada — LOTE, com data retroativa
-- ──────────────────────────────────────────────────────────────────────────────
-- O coração do requisito antifalha: o operador mandou a cobrança por fora (ou o
-- envio automático falhou) e precisa registrar isso, inclusive semanas depois,
-- selecionando por número de reserva.
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
  IF NOT can_read_hotel(p_hotel_id) THEN RAISE EXCEPTION 'Sem acesso a este hotel'; END IF;
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

-- ──────────────────────────────────────────────────────────────────────────────
-- D. Resolver números de reserva colados
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_ar_resolve_booking_refs(p_hotel_id uuid, p_refs text[])
RETURNS TABLE (
  booking_ref     text,
  ar_title_id     uuid,
  description     text,
  gross_amount    numeric,
  net_amount      numeric,
  billing_status  text,
  expected_date   date,
  numero_nf       text,
  nf_status       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.booking_ref, t.id, t.description, t.gross_amount, t.net_amount,
         t.billing_status, t.expected_date, nf.numero_nf, nf.status
    FROM ar_titles t
    LEFT JOIN LATERAL (
      SELECT i.numero_nf, i.status
        FROM ar_title_nf_invoices l
        JOIN nf_invoices i ON i.id = l.nf_invoice_id
       WHERE l.ar_title_id = t.id
       ORDER BY i.created_at DESC
       LIMIT 1
    ) nf ON true
   WHERE can_read_hotel(p_hotel_id)
     AND t.hotel_id = p_hotel_id
     AND t.status <> 'cancelado'
     AND lower(btrim(t.booking_ref)) = ANY (SELECT lower(btrim(x)) FROM unnest(p_refs) x);
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- E. A fila de cobranças
-- ──────────────────────────────────────────────────────────────────────────────
-- security_invoker faz a view herdar a RLS das tabelas base. É PG15+.
-- ATENÇÃO: em PG14 esta cláusula não existe e a view rodaria com os privilégios
-- do owner, IGNORANDO a RLS — ou seja, vazaria dados de todos os hotéis. Rodar
-- docs/sql-scripts/ar_partner_billing_diagnostics.sql (seção 5) antes.
CREATE OR REPLACE VIEW public.v_ar_billing_queue
WITH (security_invoker = true) AS
SELECT
  t.id AS ar_title_id, t.hotel_id, t.booking_ref, t.description, t.channel,
  t.guest_name, t.checkin_date, t.checkout_date,
  t.gross_amount, t.net_amount, t.amount_received,
  t.billing_status, t.billed_at, t.expected_date, t.status AS ar_status,
  t.supplier_id, s.razao_social, s.nome_fantasia, s.cnpj AS supplier_cnpj,
  s.email AS supplier_email,
  r.id AS channel_rule_id, r.days_to_receive, r.billing_email,
  r.billing_attach_nf, r.billing_dispatch_mode,
  nf.id AS nf_invoice_id, nf.numero_nf, nf.status AS nf_status,
  nf.pdf_url, nf.danfse_url, nf.created_at AS nf_created_at,
  d.id AS dispatch_id, d.status AS dispatch_status, d.to_email AS dispatch_to_email,
  d.from_email, d.attempts, d.error AS dispatch_error, d.sent_at, d.marked_manually,
  (CURRENT_DATE - COALESCE(nf.created_at::date, t.created_at::date)) AS dias_parado
FROM ar_titles t
LEFT JOIN suppliers s               ON s.id = t.supplier_id
LEFT JOIN channel_receiving_rules r ON r.id = t.channel_rule_id
LEFT JOIN ar_billing_dispatches d   ON d.ar_title_id = t.id
LEFT JOIN LATERAL (
  SELECT i.*
    FROM ar_title_nf_invoices l
    JOIN nf_invoices i ON i.id = l.nf_invoice_id
   WHERE l.ar_title_id = t.id
     AND i.status IN ('autorizada','emitida','contingencia')
   ORDER BY i.created_at DESC
   LIMIT 1
) nf ON true
WHERE t.status <> 'cancelado'
  AND t.billing_status IN ('aguardando_nf','aguardando_cobranca','cobranca_enviada');

GRANT SELECT ON public.v_ar_billing_queue TO authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_ar_prepare_billing_for_nf(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_ar_revert_billing_for_nf(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_ar_mark_billing_sent(uuid, date, uuid[], text[], boolean, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_ar_resolve_booking_refs(uuid, text[]) TO authenticated;

COMMIT;
