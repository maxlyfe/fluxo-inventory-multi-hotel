-- ============================================================================
-- Backfill: preenche unit_value das transferências antigas (estavam NULL)
-- ============================================================================
-- Contexto: o modal de transferência não enviava unit_value, então todas as
-- transferências criadas antes do fix ficaram com unit_value = NULL, e o
-- relatório /inventory/transfers mostrava tudo R$ 0,00.
--
-- Este script preenche o unit_value das transferências NULL usando o preço
-- ATUAL do produto na ORIGEM (average_price → fallback last_purchase_price).
--
-- ⚠️ ATENÇÃO: usa o preço ATUAL do produto, não o preço histórico da data da
--    transferência (esse dado não foi salvo). Para transferências antigas é
--    a melhor aproximação possível. Transferências NOVAS já salvam o valor
--    correto da data.
--
-- 1. PRIMEIRO rode a query de DIAGNÓSTICO (SELECT) para ver o que será afetado.
-- 2. Se estiver OK, rode o UPDATE.
-- ============================================================================

-- ── DIAGNÓSTICO (somente leitura) ───────────────────────────────────────────
SELECT
  ht.id,
  ht.created_at::date           AS data,
  sp.name                       AS produto,
  ht.quantity                   AS qtd,
  ht.unit_value                 AS valor_atual,
  COALESCE(p.average_price, p.last_purchase_price, 0) AS valor_sugerido,
  sh.name                       AS origem,
  dh.name                       AS destino
FROM hotel_transfers ht
JOIN products p  ON p.id = ht.product_id
LEFT JOIN products sp ON sp.id = ht.product_id
LEFT JOIN hotels sh ON sh.id = ht.source_hotel_id
LEFT JOIN hotels dh ON dh.id = ht.destination_hotel_id
WHERE ht.unit_value IS NULL
  AND ht.status = 'completed'
ORDER BY ht.created_at DESC;

-- ── UPDATE (descomente para aplicar) ────────────────────────────────────────
-- Preenche unit_value com o preço atual do produto na origem.
--
-- UPDATE hotel_transfers ht
-- SET unit_value = COALESCE(p.average_price, p.last_purchase_price, 0)
-- FROM products p
-- WHERE p.id = ht.product_id
--   AND ht.unit_value IS NULL
--   AND ht.status = 'completed'
--   AND COALESCE(p.average_price, p.last_purchase_price, 0) > 0;
-- ============================================================================
