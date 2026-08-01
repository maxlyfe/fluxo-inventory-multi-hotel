-- ============================================================================
-- Contas a Receber — Fase 0: fundação do faturamento por parceiro
--
-- Cria a estrutura para:
--   * vincular uma regra de canal a um parceiro (CNPJ / suppliers)
--   * ligar NF emitida a título a receber (N:N)
--   * fila e log de disparo de cobrança
--   * remetente de e-mail por unidade (colunas usadas na Fase 5)
--
-- ADITIVA E NEUTRA: nenhum título existente muda de comportamento.
--   billing_status nasce 'nao_aplicavel' em 100% das linhas, expected_date
--   segue preenchida, nenhuma policy existente é alterada aqui.
--
-- DEPENDÊNCIA: exige can_read_hotel(uuid), de
-- 20260730120000_rls_helpers.sql (Lote 0). Ver o bloco de guarda abaixo.
--
-- IDEMPOTENTE. Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

BEGIN;

-- ── Guarda de dependência ───────────────────────────────────────────────────
-- can_read_hotel(uuid) nasce em 20260730120000_rls_helpers.sql, que estava
-- escrita e commitada mas NÃO APLICADA no banco (registrado em
-- NOTA_SEGURANCA_2026-07-29.md). Aquela migration é aditiva: cria só funções e
-- não altera nenhuma policy, então pode ser aplicada com segurança antes desta.
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
-- 1. channel_receiving_rules: parceiro + template de cobrança
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE channel_receiving_rules
  ADD COLUMN IF NOT EXISTS supplier_id               uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_cnpj              text,
  ADD COLUMN IF NOT EXISTS billing_email             text,
  ADD COLUMN IF NOT EXISTS billing_cc_emails         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS billing_subject_template  text,
  ADD COLUMN IF NOT EXISTS billing_body_template     text,
  ADD COLUMN IF NOT EXISTS billing_attach_nf         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS billing_dispatch_mode     text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS card_default_brand        text,
  ADD COLUMN IF NOT EXISTS card_default_modality     text,
  ADD COLUMN IF NOT EXISTS card_default_installments integer;

COMMENT ON COLUMN channel_receiving_rules.partner_cnpj IS
  'Somente dígitos (14). Denormalizado de suppliers.cnpj DE PROPÓSITO: é a chave '
  'de resolução usada no engate da NF (nf_invoices.tomador_cpf_cnpj) e precisa '
  'sobreviver à exclusão ou duplicação do supplier.';

COMMENT ON COLUMN channel_receiving_rules.billing_dispatch_mode IS
  'manual = cai na fila /finances/cobrancas para o operador disparar. '
  'automatico = a cobrança sai sozinha quando a NF é autorizada.';

ALTER TABLE channel_receiving_rules DROP CONSTRAINT IF EXISTS chk_channel_rules_partner_cnpj;
ALTER TABLE channel_receiving_rules ADD  CONSTRAINT chk_channel_rules_partner_cnpj
  CHECK (partner_cnpj IS NULL OR partner_cnpj ~ '^[0-9]{14}$');

ALTER TABLE channel_receiving_rules DROP CONSTRAINT IF EXISTS chk_channel_rules_dispatch_mode;
ALTER TABLE channel_receiving_rules ADD  CONSTRAINT chk_channel_rules_dispatch_mode
  CHECK (billing_dispatch_mode IN ('manual','automatico'));

ALTER TABLE channel_receiving_rules DROP CONSTRAINT IF EXISTS chk_channel_rules_card_defaults;
ALTER TABLE channel_receiving_rules ADD  CONSTRAINT chk_channel_rules_card_defaults CHECK (
      (card_default_brand    IS NULL OR card_default_brand    IN ('visa','master','elo','amex','hipercard','outros'))
  AND (card_default_modality IS NULL OR card_default_modality IN ('debito','credito'))
  AND (card_default_installments IS NULL OR card_default_installments BETWEEN 1 AND 24)
);

-- Faturamento exige parceiro identificado: sem CNPJ não há como casar a NF nem
-- saber para quem cobrar. NOT VALID para não travar o deploy se houver regra
-- legada 'faturamento' sem CNPJ — o saneamento e o VALIDATE ficam em
-- docs/sql-scripts/ar_partner_billing_post_migration.sql (seção 2).
ALTER TABLE channel_receiving_rules DROP CONSTRAINT IF EXISTS chk_channel_rules_faturamento_partner;
ALTER TABLE channel_receiving_rules ADD  CONSTRAINT chk_channel_rules_faturamento_partner
  CHECK (trigger_event <> 'faturamento' OR partner_cnpj IS NOT NULL) NOT VALID;

-- A UNIQUE (hotel_id, channel) original impedia duas regras no mesmo rótulo de
-- canal para parceiros diferentes, e era case sensitive enquanto o match no app
-- (arService.findRule) é case insensitive: 'BOOKING' e 'Booking' conviviam no
-- banco e o vencedor era indeterminado.
DO $$
DECLARE v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'channel_receiving_rules'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE channel_receiving_rules DROP CONSTRAINT %I', v_conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_rules_generic
  ON channel_receiving_rules (hotel_id, lower(btrim(channel)))
  WHERE partner_cnpj IS NULL;

-- Um parceiro = uma regra por hotel. Elimina ambiguidade na resolução por CNPJ,
-- que é o caminho crítico do engate automático da NF.
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_rules_partner
  ON channel_receiving_rules (hotel_id, partner_cnpj)
  WHERE partner_cnpj IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_rules_supplier ON channel_receiving_rules(supplier_id);
-- Busca cross-hotel: "este parceiro já tem regra em outra unidade do grupo?"
CREATE INDEX IF NOT EXISTS idx_channel_rules_cnpj ON channel_receiving_rules(partner_cnpj)
  WHERE partner_cnpj IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. suppliers: o unique por CNPJ ficou em migration SEPARADA
-- ──────────────────────────────────────────────────────────────────────────────
-- O índice uq_suppliers_hotel_cnpj (que impede dois cliques rápidos no botão
-- "Buscar e vincular" criarem dois fornecedores) vive em
-- 20260802180000_suppliers_unique_cnpj.sql, e NÃO aqui.
--
-- Motivo: se já existir CNPJ duplicado em produção, o CREATE UNIQUE INDEX falha,
-- e como esta migration é uma transação única, TUDO voltaria atrás por causa de
-- um dado legado. A deduplicação exige repontar `purchases`, `ap_titles` e
-- `recurring_expenses` antes de apagar (as três FKs são ON DELETE SET NULL, ou
-- seja, apagar sem repontar desvincula em silêncio em vez de dar erro).
--
-- Procedimento: docs/sql-scripts/suppliers_dedup_cnpj.sql.
-- Até o índice existir, supplierService.findByCnpj tolera duplicata.

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. ar_titles: parceiro, faturamento, reserva, cartão
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE ar_titles
  ADD COLUMN IF NOT EXISTS supplier_id      uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channel_rule_id  uuid REFERENCES channel_receiving_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_status   text NOT NULL DEFAULT 'nao_aplicavel',
  ADD COLUMN IF NOT EXISTS billed_at        date,
  ADD COLUMN IF NOT EXISTS booking_ref      text,
  ADD COLUMN IF NOT EXISTS guest_name       text,
  ADD COLUMN IF NOT EXISTS checkin_date     date,
  ADD COLUMN IF NOT EXISTS checkout_date    date,
  ADD COLUMN IF NOT EXISTS card_modality    text,
  ADD COLUMN IF NOT EXISTS card_data_source text,
  ADD COLUMN IF NOT EXISTS installment_total integer,
  ADD COLUMN IF NOT EXISTS acquirer_rule_id uuid REFERENCES card_acquirer_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_override  boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ar_titles.booking_ref IS
  'Número da reserva CRU, sem prefixo. origin_ref é erbon-<hotel>-<id>, o que '
  'obrigaria LIKE para pesquisar por reserva na fila de cobranças.';

COMMENT ON COLUMN ar_titles.manual_override IS
  'true = o título foi ajustado à mão. rpc_ar_upsert_generated nunca o sobrescreve.';

COMMENT ON COLUMN ar_titles.card_data_source IS
  'De onde veio bandeira/modalidade/parcelas. A Erbon devolve rótulo livre, '
  'não dado estruturado: a UI mostra a origem e permite corrigir.';

ALTER TABLE ar_titles DROP CONSTRAINT IF EXISTS chk_ar_titles_billing_status;
ALTER TABLE ar_titles ADD  CONSTRAINT chk_ar_titles_billing_status
  CHECK (billing_status IN ('nao_aplicavel','aguardando_nf','aguardando_cobranca','cobranca_enviada'));

ALTER TABLE ar_titles DROP CONSTRAINT IF EXISTS chk_ar_titles_card_meta;
ALTER TABLE ar_titles ADD  CONSTRAINT chk_ar_titles_card_meta CHECK (
      (card_modality    IS NULL OR card_modality    IN ('debito','credito'))
  AND (card_data_source IS NULL OR card_data_source IN ('erbon','manual','regra_default','indefinido'))
);

-- origin ganha 'faturado': título nascido de NF sem reserva identificável.
-- origin_ref = 'nf-' || nf_invoice_id mantém uq_ar_titles_origin válido.
DO $$
DECLARE v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'ar_titles'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%origin%'
       AND pg_get_constraintdef(oid) LIKE '%inflow%'
  LOOP
    EXECUTE format('ALTER TABLE ar_titles DROP CONSTRAINT %I', v_conname);
  END LOOP;
END $$;

ALTER TABLE ar_titles DROP CONSTRAINT IF EXISTS ar_titles_origin_check;
ALTER TABLE ar_titles ADD  CONSTRAINT ar_titles_origin_check
  CHECK (origin IN ('erbon','omnibees','manual','inflow','faturado'));

-- expected_date NULL = "não tem data firme ainda".
-- cashflowService.summary/projection filtram com gte/lte, e NULL não satisfaz
-- nenhum dos dois: o título sai da previsão de caixa automaticamente, sem
-- precisar tocar em cashflowService.
ALTER TABLE ar_titles ALTER COLUMN expected_date DROP NOT NULL;

ALTER TABLE ar_titles DROP CONSTRAINT IF EXISTS chk_ar_titles_expected_date;
ALTER TABLE ar_titles ADD  CONSTRAINT chk_ar_titles_expected_date
  CHECK (expected_date IS NOT NULL OR billing_status IN ('aguardando_nf','aguardando_cobranca'));

CREATE INDEX IF NOT EXISTS idx_ar_titles_billing
  ON ar_titles(hotel_id, billing_status) WHERE billing_status <> 'nao_aplicavel';
CREATE INDEX IF NOT EXISTS idx_ar_titles_supplier    ON ar_titles(hotel_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_ar_titles_booking_ref ON ar_titles(hotel_id, booking_ref);

-- Backfill do booking_ref para os títulos já existentes (idempotente).
UPDATE ar_titles
   SET booking_ref = split_part(origin_ref, '-', 3)
 WHERE booking_ref IS NULL
   AND origin = 'erbon'
   AND origin_ref LIKE 'erbon-%';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Ligação N:N entre NF emitida e título a receber
-- ──────────────────────────────────────────────────────────────────────────────
-- Não é coluna escalar em ar_titles porque uma NFS-e agrupa itens de várias
-- reservas (nfService.markEntriesAsEmitted opera sobre lista de erbon_entry_id)
-- e um faturamento consolidado junta várias NFs.

CREATE TABLE IF NOT EXISTS ar_title_nf_invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid NOT NULL REFERENCES hotels(id)      ON DELETE CASCADE,
  ar_title_id   uuid NOT NULL REFERENCES ar_titles(id)   ON DELETE CASCADE,
  nf_invoice_id uuid NOT NULL REFERENCES nf_invoices(id) ON DELETE CASCADE,
  amount        numeric(14,2),
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ar_title_id, nf_invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_ar_title_nf_title ON ar_title_nf_invoices(ar_title_id);
CREATE INDEX IF NOT EXISTS idx_ar_title_nf_nf    ON ar_title_nf_invoices(nf_invoice_id);
CREATE INDEX IF NOT EXISTS idx_ar_title_nf_hotel ON ar_title_nf_invoices(hotel_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Disparo de cobrança: 1 linha por título + log de tentativas
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ar_billing_dispatches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  ar_title_id         uuid NOT NULL REFERENCES ar_titles(id) ON DELETE CASCADE,
  nf_invoice_id       uuid REFERENCES nf_invoices(id) ON DELETE SET NULL,
  supplier_id         uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  channel_rule_id     uuid REFERENCES channel_receiving_rules(id) ON DELETE SET NULL,

  to_email            text,
  cc_emails           text[] NOT NULL DEFAULT '{}',
  from_email          text,
  subject             text,
  body                text,
  attachment_url      text,

  status              text NOT NULL DEFAULT 'pendente',
  -- Data que conta para o prazo. Pode ser RETROATIVA (tratativa manual).
  billed_on           date NOT NULL DEFAULT CURRENT_DATE,
  marked_manually     boolean NOT NULL DEFAULT false,

  attempts            integer NOT NULL DEFAULT 0,
  last_attempt_at     timestamptz,
  next_retry_at       timestamptz,
  sent_at             timestamptz,
  provider            text,
  provider_message_id text,
  error               text,

  notes               text,
  created_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Idempotência: um título tem no máximo UM disparo. Retentativa incrementa
  -- attempts, não cria linha. O histórico fica na tabela filha.
  UNIQUE (ar_title_id)
);

COMMENT ON COLUMN ar_billing_dispatches.from_email IS
  'Remetente efetivamente usado. Cada unidade tem o seu (hotel_email_config), '
  'e seis meses depois saber de qual caixa a cobrança saiu é a única forma de '
  'responder ao parceiro.';

ALTER TABLE ar_billing_dispatches DROP CONSTRAINT IF EXISTS chk_ar_dispatch_status;
ALTER TABLE ar_billing_dispatches ADD  CONSTRAINT chk_ar_dispatch_status
  CHECK (status IN ('pendente','enviado','falha','manual','cancelado'));

ALTER TABLE ar_billing_dispatches DROP CONSTRAINT IF EXISTS chk_ar_dispatch_sent_at;
ALTER TABLE ar_billing_dispatches ADD  CONSTRAINT chk_ar_dispatch_sent_at
  CHECK (status <> 'enviado' OR sent_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ar_dispatch_hotel_status ON ar_billing_dispatches(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_ar_dispatch_retry
  ON ar_billing_dispatches(next_retry_at) WHERE status IN ('pendente','falha');
CREATE INDEX IF NOT EXISTS idx_ar_dispatch_nf ON ar_billing_dispatches(nf_invoice_id);

CREATE TABLE IF NOT EXISTS ar_billing_dispatch_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  dispatch_id         uuid NOT NULL REFERENCES ar_billing_dispatches(id) ON DELETE CASCADE,
  attempt_no          integer NOT NULL,
  status              text NOT NULL CHECK (status IN ('enviado','falha')),
  provider            text,
  provider_message_id text,
  error               text,
  http_status         integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispatch_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS idx_ar_dispatch_attempt_dispatch
  ON ar_billing_dispatch_attempts(dispatch_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. Render de template de cobrança
-- ──────────────────────────────────────────────────────────────────────────────
-- Implementação única, usada pela RPC do engate e pela function agendada. O que
-- foi enviado fica auditado literalmente na linha do dispatch.
--
-- Variáveis: {{parceiro}} {{razao_social}} {{cnpj}} {{numero_nf}} {{chave_nf}}
--            {{link_nf}} {{valor}} {{reserva}} {{hospede}} {{checkin}}
--            {{checkout}} {{vencimento}} {{hotel}} {{dias_prazo}}

CREATE OR REPLACE FUNCTION public.fn_render_billing_template(p_template text, p_vars jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_result text := COALESCE(p_template, '');
  v_key    text;
  v_val    text;
BEGIN
  FOR v_key, v_val IN
    SELECT key, COALESCE(value #>> '{}', '') FROM jsonb_each(COALESCE(p_vars, '{}'::jsonb))
  LOOP
    v_result := replace(v_result, '{{' || v_key || '}}', v_val);
  END LOOP;
  RETURN v_result;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. Resolução de parceiro por CNPJ
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_ar_partner_rule(p_hotel_id uuid, p_cnpj text)
RETURNS channel_receiving_rules
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT r.*
    FROM channel_receiving_rules r
   WHERE r.hotel_id = p_hotel_id
     AND r.active
     AND r.partner_cnpj = regexp_replace(COALESCE(p_cnpj, ''), '\D', '', 'g')
   LIMIT 1;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. RLS das tabelas NOVAS — escopada por hotel desde o nascimento
-- ──────────────────────────────────────────────────────────────────────────────
-- O (SELECT ...) em volta do helper é obrigatório: faz o planner avaliar uma vez
-- por statement (initplan) em vez de uma vez por linha.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ar_title_nf_invoices','ar_billing_dispatches','ar_billing_dispatch_attempts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_hotel_scoped', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated '
      'USING ((SELECT can_read_hotel(hotel_id))) WITH CHECK ((SELECT can_read_hotel(hotel_id)))',
      t || '_hotel_scoped', t);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. Hardening de fn_recalc_ar_title (lógica idêntica)
-- ──────────────────────────────────────────────────────────────────────────────
-- Estava sem SET search_path e sem SECURITY DEFINER, mesmo achado
-- (function_search_path_mutable) que 20260730120000_rls_helpers.sql corrigiu
-- para as outras funções.

CREATE OR REPLACE FUNCTION public.fn_recalc_ar_title()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_title_id uuid;
  v_received numeric(14,2);
  v_net      numeric(14,2);
  v_status   text;
BEGIN
  v_title_id := COALESCE(NEW.ar_title_id, OLD.ar_title_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_received FROM ar_receipts WHERE ar_title_id = v_title_id;
  SELECT net_amount, status INTO v_net, v_status FROM ar_titles WHERE id = v_title_id;
  IF v_status IS DISTINCT FROM 'cancelado' THEN
    UPDATE ar_titles SET
      amount_received = v_received,
      status = CASE WHEN v_received >= v_net THEN 'recebido'
                    WHEN v_received > 0     THEN 'parcial'
                    ELSE 'previsto' END,
      updated_at = now()
    WHERE id = v_title_id;
  ELSE
    UPDATE ar_titles SET amount_received = v_received, updated_at = now() WHERE id = v_title_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_render_billing_template(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ar_partner_rule(uuid, text)          TO authenticated;

COMMIT;

-- ============================================================================
-- PENDÊNCIA REGISTRADA
-- Depois de sanear as regras 'faturamento' sem CNPJ, validar a constraint:
--   ALTER TABLE channel_receiving_rules
--     VALIDATE CONSTRAINT chk_channel_rules_faturamento_partner;
-- Sem isso ela fica NOT VALID para sempre e um UPDATE direto no painel
-- consegue criar regra de faturamento sem parceiro.
--
-- A consulta que lista as regras pendentes está em
-- docs/sql-scripts/ar_partner_billing_post_migration.sql (seção 2).
-- ============================================================================
