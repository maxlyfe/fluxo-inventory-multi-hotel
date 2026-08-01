-- ============================================================================
-- suppliers: um CNPJ por hotel
--
-- Migration SEPARADA de propósito. Ela é a única do conjunto que depende de o
-- dado legado estar limpo: se houver CNPJ duplicado, o CREATE UNIQUE INDEX
-- falha. Mantida fora de 20260802120000 para que um dado antigo não derrube a
-- fundação inteira (aquela migration é uma transação única).
--
-- ORDEM:
--   1. docs/sql-scripts/ar_partner_billing_diagnostics.sql → item 4 tem que dar OK
--   2. se não der, docs/sql-scripts/suppliers_dedup_cnpj.sql
--   3. só então esta migration
--
-- POR QUE O ÍNDICE IMPORTA
-- Sem ele, dois cliques rápidos em "Buscar e vincular" criam dois fornecedores
-- com o mesmo CNPJ, e aí `uq_channel_rules_partner` barra a segunda regra com
-- uma mensagem que não diz nada ao operador. O índice também é o que permite a
-- replicação entre unidades usar ON CONFLICT em vez de select-então-insert.
--
-- IDEMPOTENTE.
-- ============================================================================

-- Falha explícita e legível, em vez do erro cru de violação de unicidade.
DO $$
DECLARE v_dup int;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT hotel_id, cnpj FROM suppliers
     WHERE type = 'juridica' AND cnpj IS NOT NULL AND btrim(cnpj) <> ''
     GROUP BY 1, 2 HAVING count(*) > 1
  ) x;

  IF v_dup > 0 THEN
    RAISE EXCEPTION
      'Existem % grupo(s) de CNPJ duplicado em suppliers. Rode '
      'docs/sql-scripts/suppliers_dedup_cnpj.sql antes desta migration: apagar '
      'duplicado sem repontar as FKs (purchases, ap_titles, recurring_expenses '
      'sao ON DELETE SET NULL) DESVINCULA compras e titulos em silencio.', v_dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_hotel_cnpj
  ON suppliers (hotel_id, cnpj)
  WHERE cnpj IS NOT NULL AND type = 'juridica';

-- ============================================================================
-- CONFERÊNCIA
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'suppliers' AND indexname = 'uq_suppliers_hotel_cnpj';
-- ============================================================================
