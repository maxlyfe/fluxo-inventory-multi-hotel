-- ============================================================================
-- PRÉ-MIGRATION: relatório de prontidão para as migrations do faturamento por
-- parceiro (20260802120000 em diante).
--
-- COMO USAR: cole o arquivo inteiro no SQL Editor e rode. O resultado é UMA
-- tabela com todas as verificações.
--
-- Por que é um statement só: o SQL Editor do Supabase exibe apenas o resultado
-- do ÚLTIMO comando do arquivo. Script com várias consultas soltas devolve só a
-- última e esconde justamente os diagnósticos que interessam.
--
-- As consultas de detalhe ficam comentadas no fim: descomente e rode
-- INDIVIDUALMENTE apenas as dos itens que acusarem problema.
--
-- Tudo aqui roda no schema ATUAL, sem nenhuma coluna nova. As conferências que
-- dependem das colunas novas estão em ar_partner_billing_post_migration.sql.
-- ============================================================================

WITH
-- 0. Helpers de RLS aplicados? can_read_hotel(uuid) vem de
--    20260730120000_rls_helpers.sql (Lote 0), que está commitada há tempos mas
--    pode nunca ter sido APLICADA no banco — foi exatamente o que aconteceu na
--    primeira tentativa (ERROR 42883). Todas as migrations do faturamento
--    dependem dela.
helpers_rls AS (
  SELECT to_regprocedure('public.can_read_hotel(uuid)')      IS NOT NULL AS can_read_hotel,
         to_regprocedure('public.user_can_access_hotel(uuid,uuid)') IS NOT NULL AS user_can_access,
         to_regprocedure('public.my_group_id()')             IS NOT NULL AS my_group_id
),

-- 1. Regras de canal que colidem sob lower(btrim(channel)).
--    A UNIQUE atual é case sensitive e o match no app é case insensitive, então
--    'BOOKING' e 'Booking' podem conviver com vencedor indeterminado.
canais_colidindo AS (
  SELECT count(*)::int AS n FROM (
    SELECT hotel_id, lower(btrim(channel))
      FROM channel_receiving_rules
     GROUP BY 1, 2 HAVING count(*) > 1
  ) x
),

-- 2. Faixas de parcela sobrepostas (ex.: 1..6 e 3..12 na mesma bandeira).
--    Hoje a taxa de 4x fica indeterminada. O EXCLUDE da Fase 4 recusa, e
--    EXCLUDE não aceita NOT VALID: tem que sanear antes.
faixas_sobrepostas AS (
  SELECT count(*)::int AS n
    FROM card_acquirer_rules a
    JOIN card_acquirer_rules b
      ON a.id < b.id
     AND a.acquirer_id = b.acquirer_id
     AND a.card_brand  = b.card_brand
     AND a.modality    = b.modality
     AND int4range(a.installment_from, a.installment_to, '[]')
      && int4range(b.installment_from, b.installment_to, '[]')
),

-- 3. Faixas órfãs (adquirente apagado). A Fase 4 as REMOVE ao tornar hotel_id
--    NOT NULL — conferir que não há nada aproveitável.
faixas_orfas AS (
  SELECT count(*)::int AS n FROM card_acquirer_rules r
   WHERE NOT EXISTS (SELECT 1 FROM card_acquirers a WHERE a.id = r.acquirer_id)
),

-- 4. Fornecedores PJ duplicados por CNPJ no mesmo hotel.
--    O índice uq_suppliers_hotel_cnpj não aceita duplicata.
forn_duplicados AS (
  SELECT count(*)::int AS n FROM (
    SELECT hotel_id, cnpj FROM suppliers
     WHERE type = 'juridica' AND cnpj IS NOT NULL AND btrim(cnpj) <> ''
     GROUP BY 1, 2 HAVING count(*) > 1
  ) x
),

-- 5. Versão do Postgres. As views usam WITH (security_invoker = true), que só
--    existe no PG15+. Em PG14 a view roda com privilégio do owner e IGNORA a
--    RLS das bases: vazaria dado de todos os hotéis.
pg_versao AS (
  SELECT current_setting('server_version_num')::int AS v,
         current_setting('server_version')          AS txt
),

-- 6. Volume atual de recebíveis. Muda a leitura do item 8: com ar_titles vazia,
--    "0 casados" não é divergência de formato, é ausência de dado.
ar_volume AS (
  SELECT count(*)::int                                          AS total,
         count(*) FILTER (WHERE origin = 'erbon')::int           AS erbon,
         count(*) FILTER (WHERE origin_ref LIKE 'erbon-%')::int  AS com_ref_erbon
    FROM ar_titles
),

-- Número da reserva derivado de origin_ref ('erbon-<hotel>-<idReserva>').
-- É exatamente o valor que o backfill da migration vai gravar em booking_ref.
refs_ar AS (
  SELECT hotel_id, lower(btrim(split_part(origin_ref, '-', 3))) AS ref
    FROM ar_titles
   WHERE origin = 'erbon' AND origin_ref LIKE 'erbon-%'
),

-- 7 e 8. NFs com número de reserva e quantas casam com algum título.
--    Se o formato divergir (zero à esquerda, prefixo), a RPC não acha o título
--    da reserva e cria um título 'faturado' novo: dois títulos para a mesma
--    reserva na tela do gerente.
nf_match AS (
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM refs_ar r
            WHERE r.hotel_id = i.hotel_id
              AND r.ref = lower(btrim(i.booking_number))
         ))::int AS casados
    FROM nf_invoices i
   WHERE i.booking_number IS NOT NULL AND btrim(i.booking_number) <> ''
)

SELECT ord, verificacao, status, qtd, detalhe FROM (
  SELECT 0 AS ord,
         'Helpers de RLS aplicados (can_read_hotel)' AS verificacao,
         CASE WHEN can_read_hotel THEN 'OK' ELSE 'BLOQUEIA' END AS status,
         can_read_hotel::int AS qtd,
         CASE WHEN can_read_hotel
              THEN 'Lote 0 de RLS ja esta no banco'
              ELSE 'PARE: aplique supabase/migrations/20260730120000_rls_helpers.sql '
                   || 'antes de qualquer migration do faturamento. E aditiva (so cria '
                   || 'funcoes, nao altera policy). Sem ela: ERROR 42883.' END AS detalhe
    FROM helpers_rls

  UNION ALL
  SELECT 1,
         'Canais colidindo sob lower(btrim(channel))',
         CASE WHEN n = 0 THEN 'OK' ELSE 'SANEAR ANTES' END AS status,
         n AS qtd,
         CASE WHEN n = 0 THEN 'Nenhuma duplicata'
              ELSE 'uq_channel_rules_generic vai falhar. Rodar DETALHE 1' END AS detalhe
    FROM canais_colidindo

  UNION ALL
  SELECT 2, 'Faixas de parcela sobrepostas',
         CASE WHEN n = 0 THEN 'OK' ELSE 'SANEAR ANTES' END, n,
         CASE WHEN n = 0 THEN 'Nenhuma sobreposicao'
              ELSE 'EXCLUDE da Fase 4 vai falhar. Rodar DETALHE 2' END
    FROM faixas_sobrepostas

  UNION ALL
  SELECT 3, 'Faixas de adquirente orfas (serao APAGADAS)',
         CASE WHEN n = 0 THEN 'OK' ELSE 'CONFERIR' END, n,
         CASE WHEN n = 0 THEN 'Nenhuma orfa'
              ELSE 'A Fase 4 apaga estas linhas. Rodar DETALHE 3' END
    FROM faixas_orfas

  UNION ALL
  SELECT 4, 'Fornecedores PJ duplicados por CNPJ no hotel',
         CASE WHEN n = 0 THEN 'OK' ELSE 'NAO BLOQUEIA' END, n,
         CASE WHEN n = 0 THEN 'Nenhuma duplicata: 20260802180000 pode ser aplicada junto'
              ELSE 'NAO impede as migrations 120000..170000. Bloqueia apenas '
                   || '20260802180000 (unique de CNPJ), que fica para depois de '
                   || 'rodar suppliers_dedup_cnpj.sql' END
    FROM forn_duplicados

  UNION ALL
  SELECT 5, 'Postgres 15+ (security_invoker nas views)',
         CASE WHEN v >= 150000 THEN 'OK' ELSE 'BLOQUEIA' END, v,
         CASE WHEN v >= 150000 THEN txt
              ELSE txt || ' — PARE: as views precisam virar funcao SECURITY DEFINER' END
    FROM pg_versao

  UNION ALL
  SELECT 6, 'Recebiveis ja gerados (ar_titles)',
         'INFO', total,
         CASE WHEN total = 0
              THEN 'Tabela vazia: ninguem usou "Gerar das reservas" ainda. O item 8 nao tem o que comparar'
              ELSE erbon || ' do Erbon, ' || com_ref_erbon || ' com origin_ref no formato esperado' END
    FROM ar_volume

  UNION ALL
  SELECT 7, 'NFs emitidas com numero de reserva',
         'INFO', total,
         'Universo da comparacao do item 8'
    FROM nf_match

  UNION ALL
  SELECT 8, 'NFs cujo booking_number casa com um recebivel',
         CASE WHEN (SELECT total FROM ar_volume) = 0        THEN 'N/A'
              WHEN (SELECT total FROM nf_match) = 0          THEN 'N/A'
              WHEN casados = 0                               THEN 'ATENCAO'
              WHEN casados < (SELECT total FROM nf_match) / 2 THEN 'ATENCAO'
              ELSE 'OK' END,
         casados,
         CASE WHEN (SELECT total FROM ar_volume) = 0
                THEN 'Sem recebiveis gerados: refazer esta checagem depois do primeiro "Gerar das reservas"'
              WHEN (SELECT total FROM nf_match) = 0
                THEN 'Nenhuma NF com numero de reserva'
              WHEN casados = 0
                THEN 'ZERO casamentos: formato divergente. Rodar DETALHE 8 antes de confiar no engate'
              ELSE casados || ' de ' || (SELECT total FROM nf_match) || ' casaram' END
    FROM nf_match
) t
ORDER BY ord;

-- ============================================================================
-- CONSULTAS DE DETALHE
-- Rodar INDIVIDUALMENTE (selecione o bloco e execute) apenas as dos itens que
-- acusaram problema. Deixadas comentadas para não roubarem o resultado do
-- relatório acima.
-- ============================================================================

-- ── DETALHE 1: canais colidindo ─────────────────────────────────────────────
-- SELECT hotel_id, lower(btrim(channel)) AS canal_normalizado, count(*) AS qtd,
--        array_agg(channel) AS variacoes, array_agg(id) AS ids
--   FROM channel_receiving_rules
--  GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 3 DESC;

-- ── DETALHE 2: faixas sobrepostas ───────────────────────────────────────────
-- SELECT ac.name AS adquirente, a.card_brand, a.modality,
--        a.installment_from || '..' || a.installment_to AS faixa_a,
--        b.installment_from || '..' || b.installment_to AS faixa_b,
--        a.id AS id_a, b.id AS id_b
--   FROM card_acquirer_rules a
--   JOIN card_acquirer_rules b
--     ON a.id < b.id AND a.acquirer_id = b.acquirer_id
--    AND a.card_brand = b.card_brand AND a.modality = b.modality
--    AND int4range(a.installment_from, a.installment_to, '[]')
--     && int4range(b.installment_from, b.installment_to, '[]')
--   LEFT JOIN card_acquirers ac ON ac.id = a.acquirer_id
--  ORDER BY 1, 2, 3;

-- ── DETALHE 3: faixas órfãs ─────────────────────────────────────────────────
-- SELECT r.* FROM card_acquirer_rules r
--  WHERE NOT EXISTS (SELECT 1 FROM card_acquirers a WHERE a.id = r.acquirer_id);

-- ── DETALHE 4: fornecedores duplicados ──────────────────────────────────────
-- Não use a consulta rápida aqui: use docs/sql-scripts/suppliers_dedup_cnpj.sql,
-- que já traz completude e contagem de vínculos por registro, e sugere qual
-- cadastro deve sobreviver. Apagar duplicado sem repontar antes DESVINCULA
-- compras e títulos em silêncio (as FKs são ON DELETE SET NULL).

-- ── DETALHE 8: formato dos números de reserva, lado a lado ──────────────────
-- Só faz sentido se ar_titles NÃO estiver vazia. Compara os dois formatos para
-- decidir se a RPC precisa normalizar (zero à esquerda, prefixo, etc.).
-- WITH refs_ar AS (
--   SELECT hotel_id, split_part(origin_ref, '-', 3) AS ref
--     FROM ar_titles WHERE origin = 'erbon' AND origin_ref LIKE 'erbon-%')
-- SELECT (SELECT array_agg(DISTINCT ref) FROM (
--           SELECT ref FROM refs_ar ORDER BY ref DESC LIMIT 10) x
--        ) AS amostra_refs_recebiveis,
--        (SELECT array_agg(DISTINCT booking_number) FROM (
--           SELECT booking_number FROM nf_invoices
--            WHERE booking_number IS NOT NULL AND btrim(booking_number) <> ''
--            ORDER BY created_at DESC LIMIT 10) y
--        ) AS amostra_booking_number_nf;

-- ============================================================================
-- ORDEM DE APLICAÇÃO
--
-- Bloco 0 — PRÉ-REQUISITO. Se o item 0 do relatório acusar BLOQUEIA:
--   20260730120000_rls_helpers.sql
-- É o "Lote 0" de RLS: cria só as funções (can_read_hotel, my_group_id,
-- hotel_in_my_group, is_admin) e NÃO altera nenhuma policy, então não muda
-- acesso a nada por si. Está commitada desde julho, mas pode nunca ter sido
-- aplicada no banco — ver NOTA_SEGURANCA_2026-07-29.md.
--
-- Bloco 1 — depende dos itens 0, 1, 2, 3 e 5 estarem OK. Aplicar uma por vez,
-- na ordem, colando o conteúdo do arquivo no SQL Editor:
--   20260802120000_ar_partner_billing_foundation.sql
--   20260802120100_ar_upsert_generated_rpc.sql
--   20260802130000_ar_billing_rpcs.sql
--   20260802140000_card_acquirer_rules_effective.sql
--   20260802150000_hotel_email_config.sql
--   20260802160000_roles_finances_ar_backfill.sql
--
-- Bloco 2 — depois de rodar ar_partner_billing_post_migration.sql e conferir
-- que a tela continua funcionando:
--   20260802170000_ar_rls_hotel_scope.sql   (sozinha: única capaz de esvaziar
--                                            tela; rollback documentado dentro)
--
-- Bloco 3 — quando o item 4 do relatório estiver OK (depois de
-- suppliers_dedup_cnpj.sql). Pode ficar para outro dia sem prejuízo:
--   20260802180000_suppliers_unique_cnpj.sql
-- ============================================================================
