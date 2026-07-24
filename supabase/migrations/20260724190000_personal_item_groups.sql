-- ============================================================================
-- Organização pessoal em grupos: cada usuário agrupa qualquer item
-- ============================================================================
-- O group_id direto em tasks/notes valia só para o dono. Agora o vínculo
-- item→grupo é POR USUÁRIO (task_item_groups): cada participante organiza
-- tarefas e anotações (próprias ou compartilhadas) nos próprios grupos,
-- sem interferir na organização dos demais.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_item_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('task','note')),
  entity_id   UUID NOT NULL,
  group_id    UUID NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, entity_type, entity_id)
);

ALTER TABLE task_item_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tig_all" ON task_item_groups;
CREATE POLICY "tig_all" ON task_item_groups FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Migrar os vínculos existentes (group_id do item → mapeamento do dono)
INSERT INTO task_item_groups (user_id, entity_type, entity_id, group_id)
SELECT t.created_by, 'task', t.id, t.group_id FROM tasks t WHERE t.group_id IS NOT NULL
ON CONFLICT (user_id, entity_type, entity_id) DO NOTHING;

INSERT INTO task_item_groups (user_id, entity_type, entity_id, group_id)
SELECT n.created_by, 'note', n.id, n.group_id FROM notes n WHERE n.group_id IS NOT NULL
ON CONFLICT (user_id, entity_type, entity_id) DO NOTHING;

-- ============================================================================
-- get_my_task_occurrences: group_id agora vem do mapeamento do usuário logado
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
    (SELECT g.group_id FROM task_item_groups g
      WHERE g.user_id = auth.uid() AND g.entity_type = 'task' AND g.entity_id = t.id),
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
