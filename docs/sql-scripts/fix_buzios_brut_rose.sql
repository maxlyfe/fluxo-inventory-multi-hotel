-- ============================================================================
-- Preenche unit_value da transferência do Espumante Búzios Brut Rosé
-- Valor informado: R$ 67,30
-- ============================================================================
-- Os demais produtos sem preço (Martini, Teclado, Mouse, Comanda) ficam
-- propositalmente sem valor.
--
-- COMO USAR (Supabase Dashboard → SQL Editor):
--   PASSO 1: rode o SELECT para confirmar QUAL transferência será afetada.
--   PASSO 2: rode o UPDATE.
-- ============================================================================

-- ── PASSO 1 — Conferir antes (deve mostrar a transferência do Búzios) ───────
SELECT
  ht.id,
  ht.created_at::date AS data,
  p.name              AS produto,
  ht.quantity         AS qtd,
  ht.unit_value       AS valor_atual
FROM hotel_transfers ht
JOIN products p ON p.id = ht.product_id
WHERE TRIM(p.name) ILIKE 'Espumante Búzios Brut Rose'
  AND ht.unit_value IS NULL
  AND ht.status = 'completed';

-- ── PASSO 2 — Aplicar (R$ 67,30) ────────────────────────────────────────────
UPDATE hotel_transfers ht
SET unit_value = 67.30
FROM products p
WHERE p.id = ht.product_id
  AND TRIM(p.name) ILIKE 'Espumante Búzios Brut Rose'
  AND ht.unit_value IS NULL
  AND ht.status = 'completed';
-- ============================================================================
