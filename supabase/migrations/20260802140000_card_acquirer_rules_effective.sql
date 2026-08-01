-- ============================================================================
-- Contas a Receber — Fase 4: card_acquirer_rules deixa de ser dado morto
--
-- A tela deixava cadastrar bandeira, modalidade, faixa de parcelas, taxa e prazo
-- de liquidação desde 13/07/2026, e NADA disso entrava no cálculo:
-- arService.buildTitle usava apenas rule.default_fee_percent e
-- rule.days_to_receive da regra de canal. O operador configurava a Cielo com
-- 3,5% em 30 dias e a previsão saía com a taxa do canal na data do check-out.
--
-- Além de ligar o cálculo, esta migration conserta dois defeitos estruturais:
--   * sem hotel_id, a policy escopada precisaria de EXISTS no acquirer por linha
--   * sem trava de sobreposição, 1..6 e 3..12 conviviam e a taxa de 4x ficava
--     indeterminada (dependia da ordem de retorno do SELECT)
--
-- ATENÇÃO: rodar docs/sql-scripts/ar_partner_billing_diagnostics.sql (seções 2)
-- ANTES. EXCLUDE não aceita NOT VALID: se houver faixa sobreposta em produção,
-- esta migration falha e precisa do saneamento manual primeiro.
--
-- IDEMPOTENTE.
-- ============================================================================

BEGIN;

-- ── Guarda de dependência ───────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.can_read_hotel(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Falta a funcao can_read_hotel(uuid). Aplique primeiro '
      'supabase/migrations/20260730120000_rls_helpers.sql (Lote 0 de RLS: '
      'aditiva, cria apenas funcoes, nao altera policy nenhuma).';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE card_acquirer_rules
  ADD COLUMN IF NOT EXISTS hotel_id uuid REFERENCES hotels(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS installment_interval_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN card_acquirer_rules.installment_interval_days IS
  'Intervalo entre as parcelas do mesmo pagamento. A parcela k cai em '
  'evento + settlement_days + (k-1) * installment_interval_days.';

-- hotel_id herdado do adquirente
UPDATE card_acquirer_rules r
   SET hotel_id = a.hotel_id
  FROM card_acquirers a
 WHERE a.id = r.acquirer_id AND r.hotel_id IS NULL;

-- Órfãs (adquirente apagado antes de existir o ON DELETE CASCADE efetivo).
-- Conferidas no diagnóstico; não têm como ser reaproveitadas sem adquirente.
DELETE FROM card_acquirer_rules WHERE hotel_id IS NULL;

ALTER TABLE card_acquirer_rules ALTER COLUMN hotel_id SET NOT NULL;

ALTER TABLE card_acquirer_rules DROP CONSTRAINT IF EXISTS chk_car_installment_range;
ALTER TABLE card_acquirer_rules ADD  CONSTRAINT chk_car_installment_range
  CHECK (installment_from >= 1 AND installment_to >= installment_from);

ALTER TABLE card_acquirer_rules DROP CONSTRAINT IF EXISTS chk_car_interval_days;
ALTER TABLE card_acquirer_rules ADD  CONSTRAINT chk_car_interval_days
  CHECK (installment_interval_days >= 0 AND settlement_days >= 0);

-- Coluna gerada + EXCLUDE: faixas sobrepostas passam a ser recusadas pelo banco.
ALTER TABLE card_acquirer_rules
  ADD COLUMN IF NOT EXISTS installment_range int4range
  GENERATED ALWAYS AS (int4range(installment_from, installment_to, '[]')) STORED;

ALTER TABLE card_acquirer_rules DROP CONSTRAINT IF EXISTS ex_car_no_overlap;
ALTER TABLE card_acquirer_rules ADD  CONSTRAINT ex_car_no_overlap
  EXCLUDE USING gist (
    acquirer_id WITH =, card_brand WITH =, modality WITH =, installment_range WITH &&
  ) WHERE (active);

CREATE INDEX IF NOT EXISTS idx_car_lookup
  ON card_acquirer_rules(acquirer_id, modality, card_brand) WHERE active;
CREATE INDEX IF NOT EXISTS idx_car_hotel ON card_acquirer_rules(hotel_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- Resolução da faixa, com fallback para a bandeira 'outros'
-- ──────────────────────────────────────────────────────────────────────────────
-- Ordena preferindo a bandeira exata e, dentro dela, a faixa mais específica
-- (a mais estreita), para "1..1" ganhar de "1..12" se as duas existirem em
-- bandeiras diferentes.
CREATE OR REPLACE FUNCTION public.fn_card_acquirer_rule(
  p_acquirer_id  uuid,
  p_brand        text,
  p_modality     text,
  p_installments integer
)
RETURNS card_acquirer_rules
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT r.*
    FROM card_acquirer_rules r
   WHERE r.acquirer_id = p_acquirer_id
     AND r.active
     AND r.modality = COALESCE(NULLIF(p_modality, ''), 'credito')
     AND r.card_brand IN (COALESCE(NULLIF(lower(p_brand), ''), 'outros'), 'outros')
     AND COALESCE(p_installments, 1) BETWEEN r.installment_from AND r.installment_to
   ORDER BY (r.card_brand = COALESCE(NULLIF(lower(p_brand), ''), 'outros')) DESC,
            (r.installment_to - r.installment_from) ASC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.fn_card_acquirer_rule(uuid, text, text, integer) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS escopada por hotel — agora que a tabela tem hotel_id
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE card_acquirer_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "card_acquirer_rules_all_authenticated" ON card_acquirer_rules;
DROP POLICY IF EXISTS "card_acquirer_rules_hotel_scoped"      ON card_acquirer_rules;
CREATE POLICY "card_acquirer_rules_hotel_scoped" ON card_acquirer_rules
  FOR ALL TO authenticated
  USING ((SELECT can_read_hotel(hotel_id)))
  WITH CHECK ((SELECT can_read_hotel(hotel_id)));

COMMIT;
