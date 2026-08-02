-- ============================================================================
-- Roda o reprocessamento de cobranças DIRETO no banco, separando problema de
-- banco de problema de tela.
--
-- POR QUE NÃO DÁ PARA SÓ CHAMAR A RPC
-- rpc_ar_backfill_billing_for_period e rpc_ar_prepare_billing_for_nf começam com
-- `IF NOT can_read_hotel(...) THEN RAISE EXCEPTION 'Sem acesso a este hotel'`, e
-- can_read_hotel resolve auth.uid(). No SQL Editor auth.uid() é NULL, então a
-- chamada crua falha com "sem acesso" mesmo quando tudo está certo — erro que
-- manda investigar o lugar errado. Este script assume a identidade do usuário
-- antes de chamar, dentro de uma transação (set_config local só vale nela).
--
-- NOTA DE SCHEMA: o e-mail do usuário vive em auth.users, NÃO em profiles
-- (profiles tem id, role, full_name, photo_url, cpf, group_id, custom_role_id).
--
-- COMO USAR: troque o e-mail e o número da NF nos dois lugares marcados
-- <<< TROCAR, e rode PARTE 1, depois PARTE 2, depois PARTE 3.
-- ============================================================================

-- ── PARTE 1: pré-checagens (só leitura) ─────────────────────────────────────
WITH eu AS (
  SELECT id FROM auth.users
   WHERE lower(email) = lower('compras@meridianahoteles.com')   -- <<< TROCAR
   LIMIT 1
),
a_nf AS (
  SELECT id, hotel_id, numero_nf, created_at::date AS emitida_em
    FROM nf_invoices
   WHERE numero_nf = '202600876'                                -- <<< TROCAR
   ORDER BY created_at DESC LIMIT 1
)
SELECT
  to_regprocedure('public.rpc_ar_backfill_billing_for_period(uuid,date,date)') IS NOT NULL
    AS migration_190000_aplicada,
  (SELECT id FROM eu)                          AS meu_user_id,
  (SELECT role FROM profiles WHERE id = (SELECT id FROM eu)) AS meu_role,
  (SELECT hotel_id   FROM a_nf)                AS hotel_da_nf,
  (SELECT emitida_em FROM a_nf)                AS nf_emitida_em,
  -- A função real usada pela RLS: cobre dev, admin do grupo e acesso explícito.
  user_can_access_hotel((SELECT id FROM eu), (SELECT hotel_id FROM a_nf))
    AS posso_acessar_o_hotel,
  EXISTS (SELECT 1 FROM user_hotel_access ua
           WHERE ua.user_id = (SELECT id FROM eu)
             AND ua.hotel_id = (SELECT hotel_id FROM a_nf)) AS acesso_explicito;

-- Como ler:
--   migration_190000_aplicada = false → aplique
--     supabase/migrations/20260802190000_ar_backfill_billing.sql e pare aqui.
--   meu_user_id NULL → e-mail errado. Liste os seus com:
--     SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 20;
--   posso_acessar_o_hotel = false → é AQUI que a tela morre: can_read_hotel
--     devolve false no navegador e a fila fica vazia mesmo com a cobrança
--     gravada. Corrija o acesso (user_hotel_access) antes de seguir.

-- ============================================================================
-- PARTE 2: executa o reprocessamento assumindo sua identidade
-- Rode este bloco INTEIRO de uma vez: o set_config é local à transação.
-- ============================================================================

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  (SELECT id FROM auth.users
              WHERE lower(email) = lower('compras@meridianahoteles.com')  -- <<< TROCAR
              LIMIT 1),
    'role', 'authenticated'
  )::text,
  true
);

-- Confirma a impersonação: uid_efetivo tem que vir preenchido e
-- can_read_hotel tem que vir true. Se não, a PARTE 2 vai falhar com "sem acesso".
SELECT auth.uid() AS uid_efetivo,
       can_read_hotel((SELECT hotel_id FROM nf_invoices
                        WHERE numero_nf = '202600876'                     -- <<< TROCAR
                        ORDER BY created_at DESC LIMIT 1)) AS can_read_hotel;

SELECT public.rpc_ar_backfill_billing_for_period(
  (SELECT hotel_id FROM nf_invoices
    WHERE numero_nf = '202600876'                                         -- <<< TROCAR
    ORDER BY created_at DESC LIMIT 1),
  DATE '2026-07-01',
  CURRENT_DATE
) AS resultado;

COMMIT;

-- Se algo parecer errado no meio: ROLLBACK;
--
-- Esperado em resultado: prepared = 1. Se vier skipped = 1, o campo "reasons"
-- traz o motivo exato, e "details" a nota correspondente.

-- ============================================================================
-- PARTE 3: a cobrança apareceu?
-- ============================================================================
-- Consulta a tabela base, não a view: v_ar_billing_queue tem security_invoker e
-- no SQL Editor (auth.uid() NULL) devolveria vazio, o que pareceria falha do
-- reprocessamento.
SELECT d.id AS dispatch_id, d.status, d.to_email, d.subject,
       d.billed_on, d.sent_at, d.attempts, d.error,
       t.id AS ar_title_id, t.billing_status, t.net_amount, t.expected_date,
       t.origin, t.booking_ref
  FROM ar_billing_dispatches d
  JOIN ar_titles t ON t.id = d.ar_title_id
 WHERE d.nf_invoice_id = (SELECT id FROM nf_invoices
                           WHERE numero_nf = '202600876'                  -- <<< TROCAR
                           ORDER BY created_at DESC LIMIT 1);

-- Esperado: uma linha com status 'pendente', billing_status
-- 'aguardando_cobranca', expected_date NULL (sem data firme até a cobrança sair)
-- e to_email com o e-mail de cobrança da regra.
--
-- Vazio com prepared = 1 na PARTE 2 → o COMMIT não passou.
-- Linha aqui e tela vazia → o problema é a tela: confira o período do filtro
-- (é pela data de EMISSÃO, 27/07 neste caso) e se o deploy com o botão
-- "Buscar NFs emitidas" já subiu.
