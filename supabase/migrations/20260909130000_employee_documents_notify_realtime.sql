-- ============================================================================
-- DOCUMENTOS DO COLABORADOR: notificacao de assinatura pendente + realtime
-- ============================================================================
-- 1. Tipo de notificacao disparado ao publicar um documento que exige
--    assinatura, para o colaborador saber que tem contracheque esperando.
-- 2. Realtime em `employee_documents`, para o indicador de pendencia na lista
--    de colaboradores do DP se atualizar sem recarregar a tela.
--
-- DEPENDE de 20260909120000_employee_documents.sql.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard -> SQL Editor -> cole e rode.
-- ============================================================================

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'employee_documents'
  ) THEN
    RAISE EXCEPTION 'Pre-requisito ausente: aplique supabase/migrations/20260909120000_employee_documents.sql antes desta migration.';
  END IF;
END $guard$;

-- ── 1. Tipo de notificacao ──────────────────────────────────────────────────
-- `target_path_template` leva ao Portal, nao ao DP: o destinatario e o
-- colaborador, e e la que ele assina.
INSERT INTO notification_types (event_key, description, default_message_template, target_path_template, icon)
VALUES (
  'EMPLOYEE_DOCUMENT_PENDING_SIGNATURE',
  'Documento aguardando assinatura',
  'Seu contracheque esta disponivel para assinatura',
  '/portal/my-payslips',
  '🖊️'
)
ON CONFLICT (event_key) DO UPDATE
  SET description              = EXCLUDED.description,
      default_message_template = EXCLUDED.default_message_template,
      target_path_template     = EXCLUDED.target_path_template,
      icon                     = EXCLUDED.icon;

-- ── 2. Realtime ─────────────────────────────────────────────────────────────
-- REPLICA IDENTITY FULL e necessario para o payload de DELETE trazer a linha
-- antiga: sem isso, apagar um documento pendente nao diria de qual colaborador
-- era, e o indicador ficaria aceso para sempre.
ALTER TABLE employee_documents REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'employee_documents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE employee_documents;
  END IF;
END $$;

-- ============================================================================
-- CONFERENCIA (um SELECT consolidado — o SQL Editor mostra so o ultimo)
-- ============================================================================
SELECT 'tipo de notificacao' AS verificacao,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALHA' END AS status,
       coalesce(max(default_message_template), '(ausente)') AS detalhe
  FROM notification_types
 WHERE event_key = 'EMPLOYEE_DOCUMENT_PENDING_SIGNATURE'
UNION ALL
SELECT 'realtime na publicacao',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALHA' END,
       count(*)::text
  FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'employee_documents'
UNION ALL
SELECT 'replica identity full',
       CASE WHEN max(relreplident::text) = 'f' THEN 'OK' ELSE 'FALHA' END,
       max(relreplident::text)
  FROM pg_class
 WHERE oid = 'public.employee_documents'::regclass;
