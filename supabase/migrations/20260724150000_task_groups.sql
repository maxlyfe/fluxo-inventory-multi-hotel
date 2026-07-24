-- ============================================================================
-- Grupos (listas) para Tarefas e Anotações — estilo Microsoft To Do
-- ============================================================================
-- Cada usuário cria seus próprios grupos (ex.: "CNPJs", "Compras Pendentes")
-- e organiza tarefas e anotações dentro deles. Grupos são pessoais: outros
-- participantes de um item compartilhado veem o item, não o grupo.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6366f1',
  position   INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES task_groups(id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES task_groups(id) ON DELETE SET NULL;

ALTER TABLE task_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tg_all" ON task_groups;
CREATE POLICY "tg_all" ON task_groups FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- ============================================================================
-- get_my_task_occurrences agora retorna group_id (mudança de retorno → DROP)
-- ============================================================================
DROP FUNCTION IF EXISTS get_my_task_occurrences(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION get_my_task_occurrences(p_hotel_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (
  occurrence_id   UUID,
  task_id         UUID,
  title           TEXT,
  description     TEXT,
  due_date        DATE,
  due_time        TIME,
  status          TEXT,
  completed_at    TIMESTAMPTZ,
  completion_mode TEXT,
  recurrence_freq TEXT,
  hotel_id        UUID,
  created_by      UUID,
  group_id        UUID,
  my_assignee_status TEXT,
  is_shared       BOOLEAN,
  assignees       JSONB,
  completions     JSONB,
  i_completed     BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    o.id, t.id, t.title, t.description, o.due_date, o.due_time, o.status,
    o.completed_at, t.completion_mode, t.recurrence_freq, t.hotel_id, t.created_by,
    t.group_id,
    (SELECT a.status FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = auth.uid()),
    EXISTS (SELECT 1 FROM task_assignees a2 WHERE a2.task_id = t.id),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', a3.user_id, 'status', a3.status))
                FROM task_assignees a3 WHERE a3.task_id = t.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', c.user_id, 'completed_at', c.completed_at))
                FROM task_completions c WHERE c.occurrence_id = o.id), '[]'::jsonb),
    EXISTS (SELECT 1 FROM task_completions c2 WHERE c2.occurrence_id = o.id AND c2.user_id = auth.uid())
  FROM task_occurrences o
  JOIN tasks t ON t.id = o.task_id
  WHERE o.due_date >= p_from AND o.due_date <= p_to
    AND t.is_active
    AND (t.hotel_id = p_hotel_id OR t.hotel_id IS NULL)
    AND (
      t.created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM task_assignees a4
                  WHERE a4.task_id = t.id AND a4.user_id = auth.uid()
                    AND a4.status <> 'declined')
    )
  ORDER BY o.due_date, o.due_time NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_my_task_occurrences(UUID, DATE, DATE) TO authenticated;
