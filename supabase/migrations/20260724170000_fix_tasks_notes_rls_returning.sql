-- ============================================================================
-- FIX: INSERT ... RETURNING barrado pela policy de SELECT em tasks/notes
-- ============================================================================
-- O PostgREST usa RETURNING no insert (.select('id')), e o Postgres valida a
-- linha nova contra as policies de SELECT. As policies usavam funções que
-- consultam a própria tabela (is_task_participant / is_note_participant), mas
-- a linha recém-inserida ainda não é visível dentro do mesmo comando, então a
-- checagem falhava com "new row violates row-level security policy".
--
-- Correção: checar created_by = auth.uid() direto na linha antes da função.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR is_task_participant(id));

DROP POLICY IF EXISTS "notes_select" ON notes;
CREATE POLICY "notes_select" ON notes FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR is_note_participant(id));
