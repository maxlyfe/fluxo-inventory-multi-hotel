-- ============================================================================
-- Reenvio de cobrança já enviada, com o texto regerado pelo modelo ATUAL.
--
-- MOTIVAÇÃO
-- Cobrança que caiu no spam, e-mail do parceiro que mudou, template corrigido
-- depois do primeiro envio: em todos esses casos é preciso mandar de novo. Até
-- aqui não havia caminho para isso — `processDispatches` só age em status
-- 'pendente' ou 'falha', então um disparo 'enviado' saía sempre em `skipped`.
--
-- DECISÃO 1 — o texto é REGERADO pelo modelo atual no reenvio.
-- Era o oposto: o `ON CONFLICT` de rpc_ar_prepare_billing_for_nf preserva
-- subject/body de disparo já enviado, de propósito, para auditar o que o parceiro
-- recebeu. Só que isso deixava o reenvio preso a um texto velho (inclusive ao
-- valor mal formatado que a 20260802200000 corrigiu). A auditoria continua
-- garantida porque o texto passa a ser gravado POR TENTATIVA (item 1 abaixo).
--
-- DECISÃO 2 — o reenvio NÃO reinicia o prazo de recebimento.
-- Mexer em expected_date silenciosamente moveria dinheiro na previsão de caixa
-- sem ninguém pedir. `rpc_ar_mark_billing_sent` já devolve 'ja_cobrado' para
-- título consolidado, então o reenvio passa por lá sem efeito. Quem precisa
-- mesmo mudar a data (o parceiro nunca recebeu a primeira) usa a marcação manual
-- com a data nova, que é explícita e fica registrada.
--
-- DECISÃO 3 — uma linha por título continua valendo.
-- `ar_billing_dispatches` tem UNIQUE (ar_title_id) e isso não muda: o reenvio
-- reaproveita a linha e incrementa `attempts`. O histórico mora na tabela filha.
--
-- IDEMPOTENTE.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.fn_is_service_role()') IS NULL THEN
    RAISE EXCEPTION
      'Falta fn_is_service_role(). Aplique primeiro '
      'supabase/migrations/20260802210000_ar_billing_service_role_guard.sql.';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. O texto enviado passa a ser gravado POR TENTATIVA
-- ──────────────────────────────────────────────────────────────────────────────
-- Sem isto, regerar o texto no reenvio apagaria o que foi enviado antes, e seis
-- meses depois não haveria como provar o que o parceiro recebeu na primeira vez.
ALTER TABLE ar_billing_dispatch_attempts
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS body    text,
  ADD COLUMN IF NOT EXISTS to_email text;

COMMENT ON COLUMN ar_billing_dispatch_attempts.body IS
  'Corpo exatamente como saiu NESTA tentativa. O disparo guarda o texto atual; '
  'a tentativa guarda o historico, porque o reenvio regera pelo modelo vigente.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. As variáveis do template em UM lugar só
-- ──────────────────────────────────────────────────────────────────────────────
-- Antes a lista vivia dentro de rpc_ar_prepare_billing_for_nf. Com o reenvio
-- precisando montar o mesmo jsonb, virariam duas cópias — e cópia de lista de
-- variáveis divergem na primeira tag nova. Extraída para função própria.
CREATE OR REPLACE FUNCTION public.fn_ar_billing_vars(
  p_nf_invoice_id uuid,
  p_rule_id       uuid,
  p_title_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nf       nf_invoices%ROWTYPE;
  v_rule     channel_receiving_rules%ROWTYPE;
  v_supplier suppliers%ROWTYPE;
  v_title    ar_titles%ROWTYPE;
  v_gross    numeric(14,2);
  v_fee      numeric(14,2);
  v_net      numeric(14,2);
  v_cnpj     text;
BEGIN
  SELECT * INTO v_nf    FROM nf_invoices             WHERE id = p_nf_invoice_id;
  SELECT * INTO v_rule  FROM channel_receiving_rules WHERE id = p_rule_id;
  SELECT * INTO v_title FROM ar_titles               WHERE id = p_title_id;
  IF v_rule.supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier FROM suppliers WHERE id = v_rule.supplier_id;
  END IF;

  v_cnpj  := regexp_replace(COALESCE(v_nf.tomador_cpf_cnpj, v_rule.partner_cnpj, ''), '\D', '', 'g');
  v_gross := COALESCE(v_nf.valor_total, v_title.gross_amount, 0);
  v_fee   := round(v_gross * COALESCE(v_rule.default_fee_percent, 0) / 100, 2);
  v_net   := v_gross - v_fee;

  RETURN jsonb_build_object(
    'parceiro',      COALESCE(v_supplier.nome_fantasia, v_supplier.razao_social, v_nf.tomador_nome, ''),
    'razao_social',  COALESCE(v_supplier.razao_social, v_nf.tomador_nome, ''),
    'cnpj',          v_cnpj,
    'numero_nf',     COALESCE(v_nf.numero_nf, ''),
    'chave_nf',      COALESCE(v_nf.chave_acesso, ''),
    'link_nf',       COALESCE(v_nf.danfse_url, v_nf.pdf_url, ''),
    'valor',         fn_fmt_brl(v_gross),
    'valor_bruto',   fn_fmt_brl(v_gross),
    'valor_taxa',    fn_fmt_brl(v_fee),
    'valor_liquido', fn_fmt_brl(v_net),
    'taxa_percent',  fn_fmt_percent(v_rule.default_fee_percent),
    'reserva',       COALESCE(NULLIF(btrim(v_nf.booking_number), ''), v_title.booking_ref, ''),
    'hospede',       COALESCE(v_nf.tomador_nome, v_title.guest_name, ''),
    'checkin',       COALESCE(to_char(v_title.checkin_date,  'DD/MM/YYYY'), ''),
    'checkout',      COALESCE(to_char(v_title.checkout_date, 'DD/MM/YYYY'), ''),
    -- No reenvio o vencimento reflete a previsão JÁ consolidada, quando existe.
    -- Recalcular de CURRENT_DATE mandaria ao parceiro uma data diferente da que
    -- está no contas a receber.
    'vencimento',    to_char(COALESCE(v_title.expected_date,
                                      CURRENT_DATE + COALESCE(v_rule.days_to_receive, 0)),
                             'DD/MM/YYYY'),
    'hotel',         COALESCE((SELECT name FROM hotels WHERE id = COALESCE(v_nf.hotel_id, v_title.hotel_id)), ''),
    'dias_prazo',    COALESCE(v_rule.days_to_receive, 0)::text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_ar_billing_vars(uuid, uuid, uuid) TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Regerar o texto de um disparo pelo modelo atual
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_ar_rebuild_billing_text(p_dispatch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_d       ar_billing_dispatches%ROWTYPE;
  v_rule    channel_receiving_rules%ROWTYPE;
  v_sup     suppliers%ROWTYPE;
  v_nf      nf_invoices%ROWTYPE;
  v_vars    jsonb;
  v_subject text;
  v_body    text;
  v_email   text;
BEGIN
  SELECT * INTO v_d FROM ar_billing_dispatches WHERE id = p_dispatch_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'disparo_nao_encontrado'); END IF;
  IF NOT (fn_is_service_role() OR can_read_hotel(v_d.hotel_id)) THEN
    RAISE EXCEPTION 'Sem acesso a este hotel';
  END IF;

  SELECT * INTO v_rule FROM channel_receiving_rules WHERE id = v_d.channel_rule_id;
  IF v_rule.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'regra_do_parceiro_removida');
  END IF;
  IF v_rule.supplier_id IS NOT NULL THEN
    SELECT * INTO v_sup FROM suppliers WHERE id = v_rule.supplier_id;
  END IF;
  IF v_d.nf_invoice_id IS NOT NULL THEN
    SELECT * INTO v_nf FROM nf_invoices WHERE id = v_d.nf_invoice_id;
  END IF;

  v_vars := fn_ar_billing_vars(v_d.nf_invoice_id, v_rule.id, v_d.ar_title_id);

  v_subject := fn_render_billing_template(
    COALESCE(NULLIF(v_rule.billing_subject_template, ''), 'Cobrança NF {{numero_nf}} - {{hotel}}'), v_vars);
  v_body := fn_render_billing_template(
    COALESCE(NULLIF(v_rule.billing_body_template, ''),
      'Prezados {{parceiro}},' || chr(10) || chr(10) ||
      'Segue a nota fiscal {{numero_nf}} no valor de R$ {{valor_bruto}}, referente à reserva {{reserva}}.' || chr(10) ||
      'Vencimento: {{vencimento}} ({{dias_prazo}} dias).' || chr(10) || chr(10) ||
      'Documento: {{link_nf}}'), v_vars);

  -- Destino também é reavaliado: e-mail de cobrança do parceiro pode ter mudado,
  -- e reenviar para o endereço velho não resolveria nada.
  v_email := COALESCE(NULLIF(v_rule.billing_email, ''), NULLIF(v_sup.email, ''),
                      NULLIF(v_nf.tomador_email, ''), v_d.to_email);

  UPDATE ar_billing_dispatches SET
    subject        = v_subject,
    body           = v_body,
    to_email       = v_email,
    cc_emails      = COALESCE(v_rule.billing_cc_emails, cc_emails),
    attachment_url = CASE WHEN COALESCE(v_rule.billing_attach_nf, true)
                          THEN COALESCE(v_nf.danfse_url, v_nf.pdf_url, attachment_url)
                          ELSE NULL END,
    updated_at     = now()
   WHERE id = p_dispatch_id;

  RETURN jsonb_build_object(
    'ok', true, 'to_email', v_email, 'subject', v_subject,
    'has_email', v_email IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ar_rebuild_billing_text(uuid) TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Preparar o reenvio
-- ──────────────────────────────────────────────────────────────────────────────
-- Devolve o status para 'pendente' (é o que processDispatches aceita) sem tocar
-- em billing_status, billed_at nem expected_date. Preserva sent_at: a data do
-- PRIMEIRO envio é o que vale para o prazo, e o histórico de tentativas registra
-- os demais.
CREATE OR REPLACE FUNCTION public.rpc_ar_prepare_resend(
  p_dispatch_id  uuid,
  p_refresh_text boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_d      ar_billing_dispatches%ROWTYPE;
  v_rebuild jsonb := NULL;
BEGIN
  SELECT * INTO v_d FROM ar_billing_dispatches WHERE id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'disparo_nao_encontrado'); END IF;
  IF NOT (fn_is_service_role() OR can_read_hotel(v_d.hotel_id)) THEN
    RAISE EXCEPTION 'Sem acesso a este hotel';
  END IF;

  IF p_refresh_text THEN
    v_rebuild := rpc_ar_rebuild_billing_text(p_dispatch_id);
    IF NOT COALESCE((v_rebuild->>'ok')::boolean, false) THEN
      RETURN v_rebuild;   -- ex.: regra do parceiro foi removida
    END IF;
    SELECT * INTO v_d FROM ar_billing_dispatches WHERE id = p_dispatch_id;
  END IF;

  IF v_d.to_email IS NULL OR btrim(v_d.to_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_email');
  END IF;

  -- `attempts` NÃO é zerado. Ele alimenta attempt_no na tabela filha, que tem
  -- UNIQUE (dispatch_id, attempt_no): zerar faria a próxima tentativa gravar
  -- attempt_no = 1 de novo e violar a unicidade, perdendo o registro do envio.
  -- O contador é monotônico e o teto AR_BILLING_MAX_ATTEMPTS só governa o job
  -- automático (listRetryable), nunca o reenvio manual, que é ação explícita.
  UPDATE ar_billing_dispatches SET
    status        = 'pendente',
    error         = NULL,
    next_retry_at = now(),
    updated_at    = now()
   WHERE id = p_dispatch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'to_email', v_d.to_email,
    'subject', v_d.subject,
    'texto_regerado', p_refresh_text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ar_prepare_resend(uuid, boolean) TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. A fila expõe quantas vezes já foi enviada
-- ──────────────────────────────────────────────────────────────────────────────
-- Sem isso a tela não distingue "enviada uma vez" de "enviada quatro vezes", e o
-- operador reenvia para um parceiro que já recebeu três cobranças iguais.
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
  (SELECT count(*) FROM ar_billing_dispatch_attempts a
    WHERE a.dispatch_id = d.id AND a.status = 'enviado')::int AS envios_ok,
  (SELECT max(a.created_at) FROM ar_billing_dispatch_attempts a
    WHERE a.dispatch_id = d.id AND a.status = 'enviado') AS ultimo_envio_em,
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

COMMIT;

-- ============================================================================
-- TESTE
--   -- Prepara o reenvio de uma cobrança já enviada e confere que o prazo NÃO mudou:
--   SELECT billing_status, billed_at, expected_date FROM ar_titles
--    WHERE id = (SELECT ar_title_id FROM ar_billing_dispatches WHERE id = '<dispatch_id>');
--   SELECT public.rpc_ar_prepare_resend('<dispatch_id>'::uuid, true);
--   -- billing_status/billed_at/expected_date têm que estar IDÊNTICOS acima e abaixo.
--
--   -- E o texto tem que refletir o modelo atual, com valor no formato brasileiro:
--   SELECT subject, body FROM ar_billing_dispatches WHERE id = '<dispatch_id>';
-- ============================================================================
