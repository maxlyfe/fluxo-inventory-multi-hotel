-- ============================================================================
-- CRON diário de notificações automáticas (aniversários + contratos)
-- Chama a Edge Function `daily-notifications` todo dia às 08:00 (Brasília).
--
-- PRÉ-REQUISITO: a função já deve estar deployada:
--   npx supabase functions deploy daily-notifications --project-ref bnmyflgyrlskhljrbyfc
--
-- COMO USAR (Supabase Dashboard → SQL Editor):
--   1. Pegue a SERVICE ROLE KEY em:
--        Settings → API → Project API keys → service_role  (clique em "Reveal")
--   2. Substitua <SERVICE_ROLE_KEY> abaixo pela chave real.
--   3. Rode este script inteiro.
--
-- Brasília = UTC-3 (sem horário de verão desde 2019) → 08:00 BRT = 11:00 UTC.
-- ============================================================================

-- 1. Extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Remover agendamento anterior (se existir) para evitar duplicação
SELECT cron.unschedule('daily-notifications')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-notifications');

-- 3. Agendar: todo dia às 11:00 UTC (08:00 Brasília)
SELECT cron.schedule(
  'daily-notifications',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://SEU_PROJETO.supabase.co/functions/v1/daily-notifications',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- 4. Conferir que ficou agendado
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'daily-notifications';

-- ============================================================================
-- TESTE MANUAL (opcional) — dispara a função agora, sem esperar as 08:00:
--   SELECT net.http_post(
--     url     := 'https://SEU_PROJETO.supabase.co/functions/v1/daily-notifications',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
--     body    := '{}'::jsonb
--   );
--
-- Ver histórico de execuções do cron:
--   SELECT * FROM cron.job_run_details WHERE jobid =
--     (SELECT jobid FROM cron.job WHERE jobname='daily-notifications')
--   ORDER BY start_time DESC LIMIT 10;
-- ============================================================================
