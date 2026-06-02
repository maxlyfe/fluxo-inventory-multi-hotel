-- ============================================================================
-- Backfill: preenche unit_value das transferências antigas (estavam NULL)
-- ============================================================================
-- O modal não enviava unit_value, então transferências antigas ficaram NULL
-- e o relatório /inventory/transfers mostrava tudo R$ 0,00.
--
-- Estratégia: usa o preço ATUAL do produto na origem
-- (average_price → fallback last_purchase_price) como base para o passado.
-- Transferências NOVAS já salvam o valor correto da data (corrigido no app).
--
-- COMO USAR (Supabase Dashboard → SQL Editor):
--   PASSO 1: rode o bloco "DIAGNÓSTICO ANTES" — veja o que será preenchido.
--   PASSO 2: rode o bloco "APLICAR" — preenche os valores.
--   PASSO 3: rode o bloco "CONFERIR DEPOIS" — confirma que ficou R$ correto.
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 1 — DIAGNÓSTICO ANTES (somente leitura)                          ║
-- ╚══════════════════════════════════════════════════════════════════════╝
SELECT
  ht.created_at::date                                  AS data,
  sp.name                                              AS produto,
  ht.quantity                                          AS qtd,
  ht.unit_value                                        AS valor_atual,
  COALESCE(p.average_price, p.last_purchase_price, 0)  AS valor_sugerido,
  ht.quantity * COALESCE(p.average_price, p.last_purchase_price, 0) AS total_sugerido,
  sh.name                                              AS origem,
  dh.name                                              AS destino
FROM hotel_transfers ht
JOIN products p   ON p.id  = ht.product_id
LEFT JOIN products sp ON sp.id = ht.product_id
LEFT JOIN hotels sh ON sh.id = ht.source_hotel_id
LEFT JOIN hotels dh ON dh.id = ht.destination_hotel_id
WHERE ht.unit_value IS NULL
  AND ht.status = 'completed'
ORDER BY ht.created_at DESC;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 2 — APLICAR (preenche unit_value)                                ║
-- ║ Selecione daqui até o ";" e rode.                                      ║
-- ╚══════════════════════════════════════════════════════════════════════╝
UPDATE hotel_transfers ht
SET unit_value = COALESCE(p.average_price, p.last_purchase_price, 0)
FROM products p
WHERE p.id = ht.product_id
  AND ht.unit_value IS NULL
  AND ht.status = 'completed'
  AND COALESCE(p.average_price, p.last_purchase_price, 0) > 0;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 3 — CONFERIR DEPOIS (deve voltar 0 linhas com problema)          ║
-- ╚══════════════════════════════════════════════════════════════════════╝
SELECT COUNT(*) AS transferencias_ainda_sem_valor
FROM hotel_transfers
WHERE unit_value IS NULL
  AND status = 'completed';

-- Lista as que continuaram NULL (produto sem preço cadastrado em nenhum lugar):
SELECT
  ht.created_at::date AS data,
  sp.name             AS produto,
  ht.quantity         AS qtd
FROM hotel_transfers ht
LEFT JOIN products sp ON sp.id = ht.product_id
WHERE ht.unit_value IS NULL
  AND ht.status = 'completed'
ORDER BY ht.created_at DESC;
-- (Se aparecer algo aqui, é produto sem average_price nem last_purchase_price.
--  Cadastre um preço no produto em /inventory e rode o PASSO 2 de novo.)
-- ============================================================================
