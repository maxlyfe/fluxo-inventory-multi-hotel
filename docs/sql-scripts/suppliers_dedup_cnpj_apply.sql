-- ============================================================================
-- APLICA a deduplicação de fornecedores PJ com CNPJ repetido no mesmo hotel.
--
-- Rode ANTES: docs/sql-scripts/suppliers_dedup_cnpj.sql (PASSO 1), para ver os
-- grupos e conferir que o vencedor sugerido faz sentido. Este arquivo usa
-- EXATAMENTE a mesma regra de escolha, então o resultado é o que você já viu na
-- coluna "sugestao":
--
--   1º mais vínculos (compras + títulos + recorrentes)
--   2º mais campos preenchidos
--   3º status 'ativo'
--   4º mais antigo
--
-- O QUE ELE FAZ, por grupo:
--   1. Reponta purchases, ap_titles e recurring_expenses do descartado para o
--      vencedor. Isso vem PRIMEIRO porque as três FKs são ON DELETE SET NULL:
--      apagar antes desvincularia compra e título em silêncio, sem erro.
--   2. Completa os campos VAZIOS do vencedor com o que o descartado tinha
--      (COALESCE: nunca sobrescreve dado bom). É assim que um cadastro sem
--      razão social herda o nome do duplicado que tinha.
--   3. Registra em notes qual id foi mesclado e quando.
--   4. Confere que não sobrou vínculo e só então apaga. Se sobrou, ABORTA tudo
--      (é sinal de FK nova que não está na lista do passo 1).
--
-- Roda inteiro em UMA transação: qualquer problema e nada muda.
-- IDEMPOTENTE: rodar de novo depois de limpo não faz nada.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  g            record;
  v_ficar      uuid;
  v_apagar     uuid;
  v_n          int;
  v_grupos     int := 0;
  v_apagados   int := 0;
  v_repontados int := 0;
BEGIN
  -- Um laço por grupo (hotel + CNPJ) que tem mais de um cadastro.
  FOR g IN
    SELECT hotel_id, cnpj
      FROM suppliers
     WHERE type = 'juridica' AND cnpj IS NOT NULL AND btrim(cnpj) <> ''
     GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    v_grupos := v_grupos + 1;

    -- Vencedor do grupo, pela mesma regra do PASSO 1.
    SELECT s.id INTO v_ficar
      FROM suppliers s
     WHERE s.hotel_id = g.hotel_id AND s.cnpj = g.cnpj AND s.type = 'juridica'
     ORDER BY (
                (SELECT count(*) FROM purchases          p WHERE p.supplier_id = s.id)
              + (SELECT count(*) FROM ap_titles          t WHERE t.supplier_id = s.id)
              + (SELECT count(*) FROM recurring_expenses r WHERE r.supplier_id = s.id)
              ) DESC,
              ( (s.email               IS NOT NULL AND btrim(s.email) <> '')::int
              + (s.telefone            IS NOT NULL AND btrim(s.telefone) <> '')::int
              + (s.endereco_cep        IS NOT NULL AND btrim(s.endereco_cep) <> '')::int
              + (s.endereco_logradouro IS NOT NULL AND btrim(s.endereco_logradouro) <> '')::int
              + (s.endereco_municipio  IS NOT NULL AND btrim(s.endereco_municipio) <> '')::int
              + (s.razao_social        IS NOT NULL AND btrim(s.razao_social) <> '')::int
              + (s.nome_fantasia       IS NOT NULL AND btrim(s.nome_fantasia) <> '')::int
              + (s.cnae_principal_id   IS NOT NULL AND btrim(s.cnae_principal_id) <> '')::int
              + (s.ibs                 IS NOT NULL AND btrim(s.ibs) <> '')::int
              + (s.cbs                 IS NOT NULL AND btrim(s.cbs) <> '')::int
              + (s.default_chart_account_sub_id IS NOT NULL)::int
              ) DESC,
              (s.status = 'ativo') DESC,
              s.created_at ASC
     LIMIT 1;

    RAISE NOTICE 'CNPJ % (hotel %) -> vencedor %', g.cnpj, g.hotel_id, v_ficar;

    -- Cada descartado do grupo, um por vez (grupo pode ter 3 ou mais).
    FOR v_apagar IN
      SELECT s.id FROM suppliers s
       WHERE s.hotel_id = g.hotel_id AND s.cnpj = g.cnpj
         AND s.type = 'juridica' AND s.id <> v_ficar
    LOOP
      -- 1. Repontar as FKs
      UPDATE purchases SET supplier_id = v_ficar WHERE supplier_id = v_apagar;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_repontados := v_repontados + v_n;
      IF v_n > 0 THEN RAISE NOTICE '  % compras repontadas de %', v_n, v_apagar; END IF;

      UPDATE ap_titles SET supplier_id = v_ficar WHERE supplier_id = v_apagar;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_repontados := v_repontados + v_n;
      IF v_n > 0 THEN RAISE NOTICE '  % titulos repontados de %', v_n, v_apagar; END IF;

      UPDATE recurring_expenses SET supplier_id = v_ficar WHERE supplier_id = v_apagar;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_repontados := v_repontados + v_n;
      IF v_n > 0 THEN RAISE NOTICE '  % recorrentes repontados de %', v_n, v_apagar; END IF;

      -- 2. Preencher só os buracos do vencedor
      UPDATE suppliers f SET
        email                = COALESCE(NULLIF(btrim(f.email), ''),                NULLIF(btrim(a.email), '')),
        telefone             = COALESCE(NULLIF(btrim(f.telefone), ''),             NULLIF(btrim(a.telefone), '')),
        razao_social         = COALESCE(NULLIF(btrim(f.razao_social), ''),         NULLIF(btrim(a.razao_social), '')),
        nome_fantasia        = COALESCE(NULLIF(btrim(f.nome_fantasia), ''),        NULLIF(btrim(a.nome_fantasia), '')),
        situacao             = COALESCE(NULLIF(btrim(f.situacao), ''),             NULLIF(btrim(a.situacao), '')),
        situacao_cadastral   = COALESCE(NULLIF(btrim(f.situacao_cadastral), ''),   NULLIF(btrim(a.situacao_cadastral), '')),
        tipo_empresa         = COALESCE(NULLIF(btrim(f.tipo_empresa), ''),         NULLIF(btrim(a.tipo_empresa), '')),
        porte                = COALESCE(NULLIF(btrim(f.porte), ''),               NULLIF(btrim(a.porte), '')),
        natureza_juridica    = COALESCE(NULLIF(btrim(f.natureza_juridica), ''),    NULLIF(btrim(a.natureza_juridica), '')),
        endereco_cep         = COALESCE(NULLIF(btrim(f.endereco_cep), ''),         NULLIF(btrim(a.endereco_cep), '')),
        endereco_logradouro  = COALESCE(NULLIF(btrim(f.endereco_logradouro), ''),  NULLIF(btrim(a.endereco_logradouro), '')),
        endereco_numero      = COALESCE(NULLIF(btrim(f.endereco_numero), ''),      NULLIF(btrim(a.endereco_numero), '')),
        endereco_complemento = COALESCE(NULLIF(btrim(f.endereco_complemento), ''), NULLIF(btrim(a.endereco_complemento), '')),
        endereco_bairro      = COALESCE(NULLIF(btrim(f.endereco_bairro), ''),      NULLIF(btrim(a.endereco_bairro), '')),
        endereco_municipio   = COALESCE(NULLIF(btrim(f.endereco_municipio), ''),   NULLIF(btrim(a.endereco_municipio), '')),
        endereco_uf          = COALESCE(NULLIF(btrim(f.endereco_uf), ''),          NULLIF(btrim(a.endereco_uf), '')),
        ibs                  = COALESCE(NULLIF(btrim(f.ibs), ''),                  NULLIF(btrim(a.ibs), '')),
        cbs                  = COALESCE(NULLIF(btrim(f.cbs), ''),                  NULLIF(btrim(a.cbs), '')),
        cnae_principal_id    = COALESCE(NULLIF(btrim(f.cnae_principal_id), ''),    NULLIF(btrim(a.cnae_principal_id), '')),
        cnae_principal_desc  = COALESCE(NULLIF(btrim(f.cnae_principal_desc), ''),  NULLIF(btrim(a.cnae_principal_desc), '')),
        data_abertura        = COALESCE(f.data_abertura,        a.data_abertura),
        capital_social       = COALESCE(f.capital_social,       a.capital_social),
        atividade_economica  = COALESCE(f.atividade_economica,  a.atividade_economica),
        lista_exclusao       = COALESCE(f.lista_exclusao,       a.lista_exclusao),
        default_chart_account_sub_id = COALESCE(f.default_chart_account_sub_id, a.default_chart_account_sub_id),
        notes = concat_ws(chr(10),
                  NULLIF(btrim(f.notes), ''),
                  'Cadastro duplicado ' || v_apagar::text || ' mesclado em ' || CURRENT_DATE::text,
                  NULLIF(btrim(a.notes), '')),
        updated_at = now()
        FROM suppliers a
       WHERE f.id = v_ficar AND a.id = v_apagar;

      -- 3. Trava de segurança antes de apagar
      SELECT (SELECT count(*) FROM purchases          WHERE supplier_id = v_apagar)
           + (SELECT count(*) FROM ap_titles          WHERE supplier_id = v_apagar)
           + (SELECT count(*) FROM recurring_expenses WHERE supplier_id = v_apagar)
        INTO v_n;
      IF v_n > 0 THEN
        RAISE EXCEPTION
          'Ainda ha % vinculo(s) apontando para %. Existe FK para suppliers que '
          'nao esta na lista deste script. NADA foi alterado.', v_n, v_apagar;
      END IF;

      DELETE FROM suppliers WHERE id = v_apagar;
      v_apagados := v_apagados + 1;
      RAISE NOTICE '  duplicado % apagado', v_apagar;
    END LOOP;
  END LOOP;

  RAISE NOTICE '=== % grupo(s), % duplicado(s) apagado(s), % vinculo(s) repontado(s) ===',
    v_grupos, v_apagados, v_repontados;
END $$;

COMMIT;

-- ============================================================================
-- CONFERÊNCIA (tem que voltar VAZIO)
-- ============================================================================
SELECT hotel_id, cnpj, count(*) FROM suppliers
 WHERE type = 'juridica' AND cnpj IS NOT NULL AND btrim(cnpj) <> ''
 GROUP BY 1, 2 HAVING count(*) > 1;

-- Nenhuma compra ou título deve ter ficado sem fornecedor:
-- SELECT 'purchases' AS tabela, count(*) FROM purchases WHERE supplier_id IS NULL
--  UNION ALL SELECT 'ap_titles', count(*) FROM ap_titles
--   WHERE supplier_id IS NULL AND origin = 'purchase';

-- Depois disso, aplicar 20260802180000_suppliers_unique_cnpj.sql.
