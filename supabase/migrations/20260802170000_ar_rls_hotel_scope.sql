-- ============================================================================
-- Contas a Receber — Fase 6: escopo por hotel nas tabelas AR EXISTENTES
--
-- Hoje as tabelas financeiras têm policy `FOR ALL TO authenticated USING (true)`:
-- qualquer usuário autenticado lê e escreve título, regra e conta bancária de
-- QUALQUER hotel via API direta. O isolamento multi-tenant do financeiro é
-- exclusivamente client-side (o .eq('hotel_id', ...) dos services).
--
-- As tabelas criadas nas Fases 0 a 5 já nasceram escopadas. Deixar as antigas
-- permissivas seria proteção de fachada: a fila de cobranças faz join de
-- ar_titles e channel_receiving_rules (que carrega o CNPJ do parceiro) com as
-- tabelas novas.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RODAR SEPARADO, E POR ÚLTIMO
-- Esta é a única migration do conjunto capaz de ESVAZIAR TELA em produção:
-- can_read_hotel depende de user_can_access_hotel, que depende de
-- profiles.group_id e de user_hotel_access. Usuário sem acesso preenchido para
-- de ver os dados.
--
-- ANTES de aplicar, conferir com um usuário comum de cada perfil:
--   SELECT public.can_read_hotel('<hotel-do-usuario>');  -- precisa dar true
--
-- Para reverter, basta recriar a policy permissiva:
--   DROP POLICY "ar_titles_hotel_scoped" ON ar_titles;
--   CREATE POLICY "ar_titles_all_authenticated" ON ar_titles
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- ─────────────────────────────────────────────────────────────────────────────
--
-- FORA DO ESCOPO, deliberadamente: ap_titles, ap_payments, bank_accounts,
-- money_inflows, payroll_entries, recurring_expenses. Têm o mesmo problema, mas
-- são outro módulo e outra superfície de teste, e payroll_entries exige decisão
-- de negócio sobre quem pode ver folha de pagamento.
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

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ar_titles', 'ar_receipts', 'channel_receiving_rules', 'card_acquirers']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_all_authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_hotel_scoped', t);
    -- (SELECT ...) em volta do helper: initplan, avalia uma vez por statement em
    -- vez de uma vez por linha. Sem isso, tabela grande fica lenta.
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated '
      'USING ((SELECT can_read_hotel(hotel_id))) WITH CHECK ((SELECT can_read_hotel(hotel_id)))',
      t || '_hotel_scoped', t);
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- TESTE (logado como usuário comum no SQL Editor, com o JWT do app)
--   SELECT count(*) FROM ar_titles;              -- só do(s) hotel(is) dele
--   SELECT count(*) FROM channel_receiving_rules;
-- E na aplicação: abrir /finances/contas-a-receber e confirmar que a tela NÃO
-- esvaziou para nenhum perfil antes de considerar a migration concluída.
-- ============================================================================
