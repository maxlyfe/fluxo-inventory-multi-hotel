-- ============================================================================
-- Deduplicação de fornecedores PJ com o mesmo CNPJ no mesmo hotel.
--
-- Necessário antes de 20260802180000_suppliers_unique_cnpj.sql.
--
-- ⚠️ A ARMADILHA: as três FKs que apontam para suppliers
--      purchases.supplier_id, ap_titles.supplier_id, recurring_expenses.supplier_id
--    são todas ON DELETE SET NULL. Apagar um duplicado NÃO dá erro: ele
--    DESVINCULA a compra ou o título em silêncio, e ninguém percebe até alguém
--    procurar de quem foi aquela compra. Por isso a ordem é sempre
--    REPONTAR primeiro, APAGAR depois.
--
-- COMO USAR: rode o PASSO 1 (só leitura) para ver os grupos e onde cada registro
-- é usado. Decida o "ficar" de cada grupo. Depois rode o PASSO 2 uma vez por
-- grupo, trocando os dois UUIDs. O PASSO 3 confere.
--
-- Nada aqui é automático de propósito: escolher qual cadastro sobrevive é
-- decisão de negócio (qual tem e-mail certo, endereço completo, IBS/CBS).
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — Diagnóstico: grupos, completude e uso de cada registro
-- ──────────────────────────────────────────────────────────────────────────────
-- Leia a coluna `sugestao`: o registro com mais campos preenchidos e mais
-- vínculos é o candidato natural a "ficar". Confira à mão antes de decidir.

WITH dups AS (
  SELECT hotel_id, cnpj
    FROM suppliers
   WHERE type = 'juridica' AND cnpj IS NOT NULL AND btrim(cnpj) <> ''
   GROUP BY 1, 2
  HAVING count(*) > 1
),
detalhe AS (
  SELECT s.id,
         s.hotel_id,
         h.name AS hotel,
         s.cnpj,
         s.razao_social,
         s.nome_fantasia,
         s.status,
         s.created_at,
         -- Completude: quantos campos que importam estão preenchidos
         ( (s.email              IS NOT NULL AND btrim(s.email) <> '')::int
         + (s.telefone           IS NOT NULL AND btrim(s.telefone) <> '')::int
         + (s.endereco_cep       IS NOT NULL AND btrim(s.endereco_cep) <> '')::int
         + (s.endereco_logradouro IS NOT NULL AND btrim(s.endereco_logradouro) <> '')::int
         + (s.endereco_municipio IS NOT NULL AND btrim(s.endereco_municipio) <> '')::int
         + (s.razao_social       IS NOT NULL AND btrim(s.razao_social) <> '')::int
         + (s.nome_fantasia      IS NOT NULL AND btrim(s.nome_fantasia) <> '')::int
         + (s.cnae_principal_id  IS NOT NULL AND btrim(s.cnae_principal_id) <> '')::int
         + (s.ibs                IS NOT NULL AND btrim(s.ibs) <> '')::int
         + (s.cbs                IS NOT NULL AND btrim(s.cbs) <> '')::int
         + (s.default_chart_account_sub_id IS NOT NULL)::int
         ) AS campos_preenchidos,
         (SELECT count(*) FROM purchases          p WHERE p.supplier_id = s.id) AS compras,
         (SELECT count(*) FROM ap_titles          t WHERE t.supplier_id = s.id) AS titulos_pagar,
         (SELECT count(*) FROM recurring_expenses r WHERE r.supplier_id = s.id) AS recorrentes
    FROM suppliers s
    JOIN dups d ON d.hotel_id = s.hotel_id AND d.cnpj = s.cnpj
    LEFT JOIN hotels h ON h.id = s.hotel_id
   WHERE s.type = 'juridica'
)
SELECT hotel,
       cnpj,
       id,
       COALESCE(nome_fantasia, razao_social) AS nome,
       status,
       campos_preenchidos,
       compras,
       titulos_pagar,
       recorrentes,
       (compras + titulos_pagar + recorrentes) AS vinculos_total,
       created_at::date AS criado_em,
       CASE WHEN row_number() OVER (
              PARTITION BY hotel_id, cnpj
              ORDER BY (compras + titulos_pagar + recorrentes) DESC,
                       campos_preenchidos DESC,
                       (status = 'ativo') DESC,
                       created_at ASC
            ) = 1
            THEN '>>> FICAR (sugestao)'
            ELSE 'apagar depois de repontar' END AS sugestao
  FROM detalhe
 ORDER BY hotel, cnpj, sugestao, vinculos_total DESC;

-- ============================================================================
-- PASSO 2 — Repontar e apagar UM grupo
--
-- Descomente, troque :ficar e :apagar pelos UUIDs do PASSO 1, e rode. Repita
-- para cada grupo. Está em transação única: se qualquer coisa falhar, nada muda.
--
-- Os dois UUIDs precisam ser do MESMO hotel e do MESMO CNPJ — a checagem no
-- começo garante isso, para não repontar compra de uma unidade para outra.
-- ============================================================================

-- BEGIN;
--
-- DO $$
-- DECLARE
--   v_ficar  uuid := '00000000-0000-0000-0000-000000000000';  -- <<< TROCAR
--   v_apagar uuid := '00000000-0000-0000-0000-000000000000';  -- <<< TROCAR
--   v_a record; v_b record;
--   v_n int;
-- BEGIN
--   IF v_ficar = v_apagar THEN
--     RAISE EXCEPTION 'v_ficar e v_apagar sao o mesmo registro';
--   END IF;
--
--   SELECT hotel_id, cnpj, type INTO v_a FROM suppliers WHERE id = v_ficar;
--   SELECT hotel_id, cnpj, type INTO v_b FROM suppliers WHERE id = v_apagar;
--   IF v_a IS NULL OR v_b IS NULL THEN
--     RAISE EXCEPTION 'Um dos ids nao existe em suppliers';
--   END IF;
--   IF v_a.hotel_id <> v_b.hotel_id OR v_a.cnpj IS DISTINCT FROM v_b.cnpj THEN
--     RAISE EXCEPTION 'Os dois registros nao sao do mesmo hotel/CNPJ (% vs %)',
--       v_a.hotel_id, v_b.hotel_id;
--   END IF;
--
--   -- 1. Repontar TODAS as FKs. Se aparecer tabela nova apontando para
--   --    suppliers, ela precisa entrar aqui.
--   UPDATE purchases          SET supplier_id = v_ficar WHERE supplier_id = v_apagar;
--   GET DIAGNOSTICS v_n = ROW_COUNT; RAISE NOTICE 'purchases repontadas: %', v_n;
--
--   UPDATE ap_titles          SET supplier_id = v_ficar WHERE supplier_id = v_apagar;
--   GET DIAGNOSTICS v_n = ROW_COUNT; RAISE NOTICE 'ap_titles repontados: %', v_n;
--
--   UPDATE recurring_expenses SET supplier_id = v_ficar WHERE supplier_id = v_apagar;
--   GET DIAGNOSTICS v_n = ROW_COUNT; RAISE NOTICE 'recurring_expenses repontados: %', v_n;
--
--   -- 2. Completar o que ficar está sem, aproveitando o que o duplicado tinha.
--   --    COALESCE só preenche buraco: nunca sobrescreve dado bom.
--   UPDATE suppliers f SET
--     email                = COALESCE(NULLIF(btrim(f.email), ''),                a.email),
--     telefone             = COALESCE(NULLIF(btrim(f.telefone), ''),             a.telefone),
--     razao_social         = COALESCE(NULLIF(btrim(f.razao_social), ''),         a.razao_social),
--     nome_fantasia        = COALESCE(NULLIF(btrim(f.nome_fantasia), ''),        a.nome_fantasia),
--     endereco_cep         = COALESCE(NULLIF(btrim(f.endereco_cep), ''),         a.endereco_cep),
--     endereco_logradouro  = COALESCE(NULLIF(btrim(f.endereco_logradouro), ''),  a.endereco_logradouro),
--     endereco_numero      = COALESCE(NULLIF(btrim(f.endereco_numero), ''),      a.endereco_numero),
--     endereco_complemento = COALESCE(NULLIF(btrim(f.endereco_complemento), ''), a.endereco_complemento),
--     endereco_bairro      = COALESCE(NULLIF(btrim(f.endereco_bairro), ''),      a.endereco_bairro),
--     endereco_municipio   = COALESCE(NULLIF(btrim(f.endereco_municipio), ''),   a.endereco_municipio),
--     endereco_uf          = COALESCE(NULLIF(btrim(f.endereco_uf), ''),          a.endereco_uf),
--     ibs                  = COALESCE(NULLIF(btrim(f.ibs), ''),                  a.ibs),
--     cbs                  = COALESCE(NULLIF(btrim(f.cbs), ''),                  a.cbs),
--     cnae_principal_id    = COALESCE(NULLIF(btrim(f.cnae_principal_id), ''),    a.cnae_principal_id),
--     cnae_principal_desc  = COALESCE(NULLIF(btrim(f.cnae_principal_desc), ''),  a.cnae_principal_desc),
--     default_chart_account_sub_id = COALESCE(f.default_chart_account_sub_id, a.default_chart_account_sub_id),
--     notes = concat_ws(chr(10), NULLIF(btrim(f.notes), ''),
--                       'Cadastro duplicado ' || v_apagar::text || ' mesclado em ' || CURRENT_DATE::text,
--                       NULLIF(btrim(a.notes), '')),
--     updated_at = now()
--     FROM suppliers a
--    WHERE f.id = v_ficar AND a.id = v_apagar;
--
--   -- 3. Conferir que não sobrou vínculo antes de apagar. Se sobrou, é FK que
--   --    não está na lista do passo 1: PARE e adicione.
--   SELECT (SELECT count(*) FROM purchases          WHERE supplier_id = v_apagar)
--        + (SELECT count(*) FROM ap_titles          WHERE supplier_id = v_apagar)
--        + (SELECT count(*) FROM recurring_expenses WHERE supplier_id = v_apagar)
--     INTO v_n;
--   IF v_n > 0 THEN
--     RAISE EXCEPTION 'Ainda ha % vinculo(s) apontando para o duplicado. NAO apaguei.', v_n;
--   END IF;
--
--   DELETE FROM suppliers WHERE id = v_apagar;
--   RAISE NOTICE 'Duplicado % apagado. Vencedor: %', v_apagar, v_ficar;
-- END $$;
--
-- COMMIT;
-- Em caso de dúvida no meio: ROLLBACK;

-- ============================================================================
-- PASSO 3 — Conferência final
-- ============================================================================
-- Tem que voltar VAZIO antes de aplicar 20260802180000_suppliers_unique_cnpj.sql:
-- SELECT hotel_id, cnpj, count(*) FROM suppliers
--  WHERE type = 'juridica' AND cnpj IS NOT NULL AND btrim(cnpj) <> ''
--  GROUP BY 1, 2 HAVING count(*) > 1;
--
-- E nenhuma compra/título deve ter ficado órfão pelo caminho:
-- SELECT 'purchases' AS tabela, count(*) FROM purchases
--   WHERE supplier_id IS NULL AND created_at > CURRENT_DATE - 1
--  UNION ALL SELECT 'ap_titles', count(*) FROM ap_titles
--   WHERE supplier_id IS NULL AND origin = 'purchase';
