-- ============================================================================
-- Tags de valor no template de cobrança: bruto, taxa e líquido.
--
-- 1. fn_fmt_brl(numeric) — formata em Real SEM depender do locale do banco.
--    O template antigo usava to_char(x, 'FM999G999G990D00'), e em to_char os
--    caracteres G e D seguem lc_numeric. No Supabase o lc_numeric costuma ser
--    en_US/C, então {{valor}} saía "2,400.00" em vez de "2.400,00" — enquanto a
--    pré-visualização na tela mostrava o formato brasileiro. Já `,` e `.` no
--    padrão são literais e NÃO dependem de locale, então formatamos no padrão
--    americano e trocamos os separadores com translate. Determinístico.
--
-- 2. rpc_ar_prepare_billing_for_nf ganha as variáveis:
--      {{valor_bruto}}    valor da NF
--      {{valor_taxa}}     comissão retida, conforme a taxa da regra
--      {{valor_liquido}}  o que o hotel espera receber
--      {{taxa_percent}}   a taxa em si (uma linha de comissão sem a alíquota
--                         gera pergunta do parceiro)
--    {{valor}} continua funcionando como apelido de {{valor_bruto}}: há template
--    já salvo usando ele.
--
-- DECISÃO: as três derivam do MESMO base, o valor da NF, com a taxa da regra.
-- Tentador seria puxar gross/fee/net do ar_title, mas quando o título vem da
-- reserva o gross é o total da reserva, que pode divergir do valor faturado
-- naquela nota — e aí o e-mail mostraria bruto de um lugar e taxa de outro, sem
-- fechar a conta na frente do parceiro.
--
-- IDEMPOTENTE.
-- ============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Formatação de moeda independente de locale
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_fmt_brl(p_value numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  -- 'FM999,999,999,990.00': FM tira o espaço à esquerda; ',' e '.' são literais
  -- no padrão de to_char, logo o resultado não varia com lc_numeric.
  -- translate troca os separadores para o formato brasileiro.
  SELECT translate(to_char(COALESCE(p_value, 0), 'FM999,999,999,990.00'), '.,', ',.');
$$;

COMMENT ON FUNCTION public.fn_fmt_brl(numeric) IS
  'Formata numeric como moeda brasileira (1.234,56) sem depender de lc_numeric. '
  'Usar em template de e-mail: to_char com G/D varia por locale do servidor.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Percentual: 15 → "15", 15.5 → "15,5" (sem zeros à direita inúteis)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_fmt_percent(p_value numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT translate(
           rtrim(rtrim(to_char(COALESCE(p_value, 0), 'FM990.000'), '0'), '.'),
           '.', ',');
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. A RPC, com as variáveis novas
-- ──────────────────────────────────────────────────────────────────────────────
-- Corpo idêntico ao de 20260802130000, exceto o bloco v_vars e o uso de
-- fn_fmt_brl. Replicado inteiro porque CREATE OR REPLACE FUNCTION exige o corpo
-- completo.
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
  v_gross    numeric(14,2);
  v_net      numeric(14,2);
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

  v_gross := COALESCE(v_nf.valor_total, 0);
  v_fee   := round(v_gross * COALESCE(v_rule.default_fee_percent, 0) / 100, 2);
  v_net   := v_gross - v_fee;

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
      v_gross, v_fee, v_net,
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
    'parceiro',      COALESCE(v_supplier.nome_fantasia, v_supplier.razao_social, v_nf.tomador_nome, ''),
    'razao_social',  COALESCE(v_supplier.razao_social, v_nf.tomador_nome, ''),
    'cnpj',          v_cnpj,
    'numero_nf',     COALESCE(v_nf.numero_nf, ''),
    'chave_nf',      COALESCE(v_nf.chave_acesso, ''),
    'link_nf',       COALESCE(v_nf.danfse_url, v_nf.pdf_url, ''),
    -- Os três valores vêm do MESMO base (o valor da NF) para a conta fechar na
    -- frente do parceiro: bruto - taxa = líquido.
    'valor',         fn_fmt_brl(v_gross),   -- apelido histórico de valor_bruto
    'valor_bruto',   fn_fmt_brl(v_gross),
    'valor_taxa',    fn_fmt_brl(v_fee),
    'valor_liquido', fn_fmt_brl(v_net),
    'taxa_percent',  fn_fmt_percent(v_rule.default_fee_percent),
    'reserva',       COALESCE(v_ref, ''),
    'hospede',       COALESCE(v_nf.tomador_nome, ''),
    'checkin',       COALESCE(to_char(v_title.checkin_date,  'DD/MM/YYYY'), ''),
    'checkout',      COALESCE(to_char(v_title.checkout_date, 'DD/MM/YYYY'), ''),
    'vencimento',    to_char(CURRENT_DATE + COALESCE(v_rule.days_to_receive, 0), 'DD/MM/YYYY'),
    'hotel',         COALESCE((SELECT name FROM hotels WHERE id = v_nf.hotel_id), ''),
    'dias_prazo',    COALESCE(v_rule.days_to_receive, 0)::text
  );

  v_subject := fn_render_billing_template(
    COALESCE(NULLIF(v_rule.billing_subject_template, ''), 'Cobrança NF {{numero_nf}} - {{hotel}}'), v_vars);
  v_body := fn_render_billing_template(
    COALESCE(NULLIF(v_rule.billing_body_template, ''),
      'Prezados {{parceiro}},' || chr(10) || chr(10) ||
      'Segue a nota fiscal {{numero_nf}} no valor de R$ {{valor_bruto}}, referente à reserva {{reserva}}.' || chr(10) ||
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

GRANT EXECUTE ON FUNCTION public.fn_fmt_brl(numeric)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_fmt_percent(numeric) TO authenticated;

COMMIT;

-- ============================================================================
-- TESTE DA FORMATAÇÃO (não depende do locale do servidor)
--   SELECT fn_fmt_brl(754)        AS a,  -- 754,00
--          fn_fmt_brl(2400.5)     AS b,  -- 2.400,50
--          fn_fmt_brl(1234567.89) AS c,  -- 1.234.567,89
--          fn_fmt_brl(0)          AS d,  -- 0,00
--          fn_fmt_brl(NULL)       AS e,  -- 0,00
--          fn_fmt_percent(15)     AS f,  -- 15
--          fn_fmt_percent(15.5)   AS g;  -- 15,5
--
-- REGERAR O TEXTO de uma cobrança pendente já criada (o texto fica gravado no
-- disparo, então cobrança montada antes desta migration continua com o formato
-- antigo). Só reescreve pendente: enviada e marcada à mão são preservadas.
--   SELECT public.rpc_ar_prepare_billing_for_nf(nf_invoice_id)
--     FROM ar_billing_dispatches WHERE status = 'pendente' AND nf_invoice_id IS NOT NULL;
-- ============================================================================
