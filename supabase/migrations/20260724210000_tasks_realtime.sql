-- ============================================================================
-- Realtime para o módulo de Tarefas + Anotações
-- ============================================================================
-- Adiciona as tabelas do módulo à publicação supabase_realtime para que o
-- front receba INSERT/UPDATE/DELETE instantaneamente (ex.: remover o
-- compartilhamento some da tela do outro usuário na hora).
--
-- INSERT/UPDATE respeitam RLS (cada usuário só recebe o que pode ver).
-- DELETE envia apenas a chave primária, o que basta para recarregar a lista.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tasks', 'task_occurrences', 'task_assignees', 'task_completions',
    'notes', 'note_collaborators', 'task_comments', 'task_item_groups', 'task_groups'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- DELETE precisa da identidade da linha antiga no WAL
ALTER TABLE tasks              REPLICA IDENTITY FULL;
ALTER TABLE task_occurrences   REPLICA IDENTITY FULL;
ALTER TABLE task_assignees     REPLICA IDENTITY FULL;
ALTER TABLE task_completions   REPLICA IDENTITY FULL;
ALTER TABLE notes              REPLICA IDENTITY FULL;
ALTER TABLE note_collaborators REPLICA IDENTITY FULL;
ALTER TABLE task_comments      REPLICA IDENTITY FULL;
ALTER TABLE task_item_groups   REPLICA IDENTITY FULL;
ALTER TABLE task_groups        REPLICA IDENTITY FULL;
