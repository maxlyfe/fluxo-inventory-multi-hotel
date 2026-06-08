-- ============================================================================
-- CRON de lembretes de eventos — roda a cada 5 minutos.
-- Chama a Edge Function `event-reminders` (modo cron) que dispara os lembretes
-- 24h antes, manhã (07:00 BRT) e 10 min antes de cada evento.
--
-- PRÉ-REQUISITO: a função deve estar deployada:
--   npx supabase functions deploy event-reminders --project-ref bnmyflgyrlskhljrbyfc
--
-- COMO USAR (SQL Editor):
--   1. Pegue a SERVICE ROLE KEY: Settings → API → service_role (Reveal).
--   2. Substitua <SERVICE_ROLE_KEY> abaixo.
--   3. Rode o script.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('event-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'event-reminders');

SELECT cron.schedule(
  'event-reminders',
  '*/5 * * * *',  -- a cada 5 minutos
  $$
  SELECT net.http_post(
    url     := 'https://bnmyflgyrlskhljrbyfc.supabase.co/functions/v1/event-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'event-reminders';

-- Histórico de execuções:
--   SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='event-reminders')
--   ORDER BY start_time DESC LIMIT 10;
-- ============================================================================
