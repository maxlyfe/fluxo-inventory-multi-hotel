-- ============================================================================
-- CRON de lembretes de eventos — roda de hora em hora (economia de recursos).
-- Chama a Edge Function `event-reminders` (modo cron) que dispara os lembretes
-- 24h antes, manhã (07:00 BRT) e ~1h antes de cada evento.
-- (A notificação de "novo evento" é disparada na hora da criação pelo app.)
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
  '0 * * * *',  -- de hora em hora (no minuto 0)
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
