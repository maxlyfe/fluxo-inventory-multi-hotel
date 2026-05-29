-- ============================================================================
-- Diagnóstico: encontra produtos DUPLICADOS criados acidentalmente por
-- transferências passadas (quando o match de nome falhou).
-- ============================================================================
-- ESTE SCRIPT É APENAS DIAGNÓSTICO — não altera nada.
-- Rode no SQL Editor do Supabase Dashboard para ver os pares de duplicados.
--
-- Cenário: trigger antigo criou um produto NOVO no hotel destino quando o
-- match por nome falhou. O resultado é geralmente um par de produtos com
-- nomes muito parecidos (diferença sutil de espaço/acento/caixa) no mesmo
-- hotel — ambos válidos do ponto de vista do banco.
--
-- Esta query lista pares onde:
--   - Existem ≥ 2 produtos no mesmo hotel cujos nomes normalizados são iguais
--   - Mostra qual tem mais estoque (provavelmente o "antigo") e qual tem
--     o created_at mais recente (provavelmente o "novo" criado pelo trigger)
--
-- Após identificar os pares: faça MERGE manual via /inventory na UI,
-- transferindo o estoque do duplicado para o original e desativando o duplicado,
-- OU use o ProductLinkModal pra criar o vínculo correto antes de fazer o merge.
-- ============================================================================

SELECT
  p1.hotel_id,
  h.name      AS hotel_name,
  p1.id       AS produto_a_id,
  p1.name     AS produto_a_nome,
  p1.quantity AS produto_a_qtd,
  p1.created_at AS produto_a_criado,
  p2.id       AS produto_b_id,
  p2.name     AS produto_b_nome,
  p2.quantity AS produto_b_qtd,
  p2.created_at AS produto_b_criado
FROM products p1
JOIN products p2
  ON  p1.hotel_id = p2.hotel_id
  AND p1.id < p2.id
  AND LOWER(TRIM(p1.name)) = LOWER(TRIM(p2.name))
JOIN hotels h ON h.id = p1.hotel_id
ORDER BY h.name, p1.name;

-- ============================================================================
-- Para investigar a transferência específica recente (BRV → CDS), rode
-- esta query separadamente substituindo as datas:
--
-- SELECT
--   ht.id,
--   ht.created_at,
--   ht.completed_at,
--   ht.status,
--   sh.name AS hotel_origem,
--   dh.name AS hotel_destino,
--   sp.name AS produto_origem,
--   ht.quantity,
--   ht.unit_cost
-- FROM hotel_transfers ht
-- JOIN hotels sh   ON sh.id = ht.source_hotel_id
-- JOIN hotels dh   ON dh.id = ht.destination_hotel_id
-- JOIN products sp ON sp.id = ht.product_id
-- WHERE ht.created_at >= now() - interval '7 days'
-- ORDER BY ht.created_at DESC;
-- ============================================================================
