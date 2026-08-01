-- ============================================================================
-- PÓS-MIGRATION: conferência do faturamento por parceiro.
--
-- ⚠️ RODAR SOMENTE DEPOIS de aplicar as migrations 20260802120000 em diante.
-- Antes disso as colunas não existem. O bloco de guarda abaixo aborta com uma
-- mensagem em português em vez do ERROR 42703 cru do Postgres.
--
-- COMO USAR: cole o arquivo inteiro e rode. Sai UMA tabela com o resultado de
-- todas as verificações (o SQL Editor do Supabase mostra só o último statement,
-- por isso o relatório é consolidado).
-- ============================================================================

-- ── Guarda: as migrations foram aplicadas? ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ar_titles'
       AND column_name = 'billing_status'
  ) THEN
    RAISE EXCEPTION
      'As migrations do faturamento por parceiro ainda NAO foram aplicadas. '
      'Rode primeiro ar_partner_billing_diagnostics.sql, sane o que aparecer, '
      'aplique 20260802120000 ate 20260802160000 (e 20260802170000 por ultimo, '
      'sozinha), e so entao volte a este arquivo.';
  END IF;
END $$;

-- ── Relatório ───────────────────────────────────────────────────────────────
WITH
neutra AS (
  SELECT count(*)::int                                                     AS total,
         count(*) FILTER (WHERE billing_status = 'nao_aplicavel')::int      AS nao_aplicavel,
         count(*) FILTER (WHERE billing_status = 'aguardando_nf')::int      AS aguardando_nf,
         count(*) FILTER (WHERE billing_status = 'aguardando_cobranca')::int AS aguardando_cob,
         count(*) FILTER (WHERE billing_status = 'cobranca_enviada')::int   AS cobrado,
         count(*) FILTER (WHERE expected_date IS NULL)::int                 AS sem_data
    FROM ar_titles
),
backfill_ref AS (
  SELECT count(*) FILTER (WHERE origin = 'erbon')::int                      AS erbon,
         count(*) FILTER (WHERE origin = 'erbon' AND booking_ref IS NOT NULL)::int AS com_ref
    FROM ar_titles
),
fat_sem_cnpj AS (
  SELECT count(*)::int AS n FROM channel_receiving_rules
   WHERE trigger_event = 'faturamento' AND partner_cnpj IS NULL
),
constraint_validada AS (
  SELECT COALESCE(bool_and(convalidated), false) AS ok
    FROM pg_constraint
   WHERE conrelid = 'channel_receiving_rules'::regclass
     AND conname = 'chk_channel_rules_faturamento_partner'
),
objetos AS (
  SELECT
    (SELECT count(*)::int FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (
        'ar_title_nf_invoices', 'ar_billing_dispatches',
        'ar_billing_dispatch_attempts', 'hotel_email_config')) AS tabelas,
    (SELECT count(*)::int FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name IN (
        'fn_render_billing_template', 'fn_ar_partner_rule', 'fn_card_acquirer_rule',
        'rpc_ar_upsert_generated', 'rpc_ar_prepare_billing_for_nf',
        'rpc_ar_revert_billing_for_nf', 'rpc_ar_mark_billing_sent',
        'rpc_ar_resolve_booking_refs')) AS funcoes,
    (SELECT count(*)::int FROM information_schema.views
      WHERE table_schema = 'public'
        AND table_name IN ('v_ar_billing_queue', 'v_hotel_email_config')) AS views
),
views_invoker AS (
  SELECT count(*)::int AS ok
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('v_ar_billing_queue', 'v_hotel_email_config')
     AND 'security_invoker=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))
),
rls AS (
  SELECT
    count(*) FILTER (WHERE qual ILIKE '%can_read_hotel%')::int AS escopadas,
    count(*) FILTER (WHERE qual = 'true' OR qual IS NULL)::int AS permissivas
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('ar_titles', 'ar_receipts', 'channel_receiving_rules',
                       'card_acquirers', 'card_acquirer_rules',
                       'ar_title_nf_invoices', 'ar_billing_dispatches',
                       'ar_billing_dispatch_attempts', 'hotel_email_config')
),
perms AS (
  SELECT count(*) FILTER (WHERE permissions ? 'finances')::int              AS com_finances,
         count(*) FILTER (WHERE permissions ? 'finances.billing.view')::int AS com_granular
    FROM custom_roles
),
nf_match AS (
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM ar_titles t
            WHERE t.hotel_id = i.hotel_id
              AND lower(btrim(t.booking_ref)) = lower(btrim(i.booking_number))
         ))::int AS casados
    FROM nf_invoices i
   WHERE i.booking_number IS NOT NULL AND btrim(i.booking_number) <> ''
)

SELECT ord, verificacao, status, qtd, detalhe FROM (
  SELECT 1 AS ord, 'Objetos criados (4 tabelas + 8 funcoes + 2 views)' AS verificacao,
         CASE WHEN tabelas = 4 AND funcoes = 8 AND views = 2 THEN 'OK' ELSE 'INCOMPLETO' END AS status,
         (tabelas + funcoes + views) AS qtd,
         tabelas || '/4 tabelas, ' || funcoes || '/8 funcoes, ' || views || '/2 views' AS detalhe
    FROM objetos

  UNION ALL
  SELECT 2, 'security_invoker ativo nas views',
         CASE WHEN ok = 2 THEN 'OK' ELSE 'BLOQUEIA' END, ok,
         CASE WHEN ok = 2 THEN 'As duas herdam a RLS das tabelas base'
              ELSE 'View SEM security_invoker roda com privilegio do owner e VAZA dado de todos os hoteis' END
    FROM views_invoker

  UNION ALL
  SELECT 3, 'Migration entrou neutra (nada mudou de estado)',
         CASE WHEN total = nao_aplicavel THEN 'OK' ELSE 'JA HOUVE MOVIMENTO' END,
         nao_aplicavel,
         nao_aplicavel || ' de ' || total || ' em nao_aplicavel · aguardando_nf: ' || aguardando_nf
           || ' · aguardando_cobranca: ' || aguardando_cob || ' · cobrado: ' || cobrado
    FROM neutra

  UNION ALL
  SELECT 4, 'Titulos sem data firme (fora da previsao de caixa)',
         'INFO', sem_data,
         CASE WHEN sem_data = 0 THEN 'Nenhum: previsao de caixa inalterada'
              ELSE 'Estes NAO entram no total "A receber" ate a cobranca ser marcada' END
    FROM neutra

  UNION ALL
  SELECT 5, 'Backfill de booking_ref nos titulos do Erbon',
         CASE WHEN erbon = 0 THEN 'N/A' WHEN com_ref = erbon THEN 'OK' ELSE 'PARCIAL' END,
         com_ref,
         CASE WHEN erbon = 0 THEN 'Nenhum titulo do Erbon ainda'
              ELSE com_ref || ' de ' || erbon || ' com numero de reserva preenchido' END
    FROM backfill_ref

  UNION ALL
  SELECT 6, 'Regras de faturamento sem CNPJ (travam o VALIDATE)',
         CASE WHEN n = 0 THEN 'OK' ELSE 'SANEAR' END, n,
         CASE WHEN n = 0 THEN 'Pode rodar o VALIDATE CONSTRAINT (ver rodape)'
              ELSE 'Rodar DETALHE 6 e corrigir antes do VALIDATE' END
    FROM fat_sem_cnpj

  UNION ALL
  SELECT 7, 'chk_channel_rules_faturamento_partner validada',
         CASE WHEN ok THEN 'OK' ELSE 'PENDENTE' END, CASE WHEN ok THEN 1 ELSE 0 END,
         CASE WHEN ok THEN 'Constraint valendo para linha antiga e nova'
              ELSE 'NOT VALID: um UPDATE direto no painel ainda cria faturamento sem parceiro' END
    FROM constraint_validada

  UNION ALL
  SELECT 8, 'Policies escopadas por hotel vs permissivas',
         CASE WHEN permissivas = 0 THEN 'OK' ELSE 'PARCIAL' END, escopadas,
         escopadas || ' escopadas, ' || permissivas || ' ainda com USING(true)'
           || CASE WHEN permissivas > 0 THEN ' — falta aplicar 20260802170000' ELSE '' END
    FROM rls

  UNION ALL
  SELECT 9, 'Papeis com as permissoes granulares',
         CASE WHEN com_finances = 0 THEN 'N/A'
              WHEN com_granular >= com_finances THEN 'OK' ELSE 'PARCIAL' END,
         com_granular,
         com_granular || ' de ' || com_finances || ' papeis com "finances" receberam as chaves novas'
    FROM perms

  UNION ALL
  -- Com ar_titles vazia não existe casamento possível: acusar ATENCAO aqui seria
  -- alarme falso, e alarme falso treina o operador a ignorar o relatório.
  SELECT 10, 'NFs cujo booking_number casa com um recebivel',
         CASE WHEN (SELECT total FROM neutra) = 0 THEN 'N/A'
              WHEN total = 0                      THEN 'N/A'
              WHEN casados = 0                    THEN 'ATENCAO'
              WHEN casados < total / 2            THEN 'ATENCAO'
              ELSE 'OK' END,
         casados,
         CASE WHEN (SELECT total FROM neutra) = 0
                THEN 'Sem recebiveis gerados ainda: refazer esta checagem depois do primeiro "Gerar das reservas"'
              WHEN total = 0 THEN 'Nenhuma NF com numero de reserva'
              WHEN casados = 0
                THEN 'ZERO casamentos: a RPC vai criar titulo faturado novo em vez de reaproveitar o da reserva'
              ELSE casados || ' de ' || total || ' casaram' END
    FROM nf_match
) t
ORDER BY ord;

-- ============================================================================
-- DETALHE 6: regras de faturamento sem parceiro
-- ============================================================================
-- SELECT id, hotel_id, channel, days_to_receive, active
--   FROM channel_receiving_rules
--  WHERE trigger_event = 'faturamento' AND partner_cnpj IS NULL;
--
-- Quando a consulta acima voltar vazia:
-- ALTER TABLE channel_receiving_rules
--   VALIDATE CONSTRAINT chk_channel_rules_faturamento_partner;

-- ============================================================================
-- DETALHE 8: mapa de policies por tabela
-- ============================================================================
-- SELECT tablename, policyname,
--        CASE WHEN qual ILIKE '%can_read_hotel%' THEN 'escopado por hotel'
--             WHEN qual = 'true' OR qual IS NULL  THEN 'PERMISSIVO (USING true)'
--             ELSE 'outro' END AS escopo
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('ar_titles','ar_receipts','channel_receiving_rules',
--                      'card_acquirers','card_acquirer_rules','ar_title_nf_invoices',
--                      'ar_billing_dispatches','ar_billing_dispatch_attempts',
--                      'hotel_email_config','ap_titles','bank_accounts')
--  ORDER BY 3 DESC, 1;

-- ============================================================================
-- DETALHE 9: permissões por papel
-- ============================================================================
-- SELECT name,
--        permissions ? 'finances'                AS tem_chave_grossa,
--        permissions ? 'finances.billing.view'   AS ve_cobrancas,
--        permissions ? 'finances.billing.mark'   AS marca_cobranca,
--        permissions ? 'finances.billing.send'   AS envia_email,
--        permissions ? 'finances.billing.sender' AS configura_remetente
--   FROM custom_roles WHERE permissions ? 'finances' ORDER BY 1;
--
-- Para tirar de um papel o direito de MANDAR e-mail, mantendo o de registrar:
-- UPDATE custom_roles SET permissions = permissions - 'finances.billing.send'
--  WHERE name = '<papel>';

-- ============================================================================
-- TESTE DE IDEMPOTÊNCIA DA MARCAÇÃO EM LOTE
-- Rodar duas vezes com um ar_title_id que esteja em aguardando_cobranca.
-- A SEGUNDA chamada tem que devolver skipped com reason 'ja_cobrado' — é o que
-- impede dois operadores marcando o mesmo lote de gravarem duas vezes.
-- ============================================================================
-- SELECT public.rpc_ar_mark_billing_sent(
--   '<hotel_id>'::uuid, CURRENT_DATE - 5,
--   ARRAY['<ar_title_id>']::uuid[], NULL, true, 'teste', false);

-- Estado da fila:
-- SELECT billing_status, dispatch_status, count(*)
--   FROM v_ar_billing_queue GROUP BY 1, 2 ORDER BY 3 DESC;
