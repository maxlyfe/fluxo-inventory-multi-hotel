-- ============================================================================
-- Conclusão do DONO prevalece
-- ============================================================================
-- Quando o criador da tarefa conclui uma ocorrência, ela fecha para todos os
-- participantes, mesmo no modo 'all' (todos concluem). As conclusões
-- individuais já registradas continuam gravadas em task_completions.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

CREATE OR REPLACE FUNCTION complete_task_occurrence(p_occurrence_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_occ  task_occurrences%ROWTYPE;
  v_total_assignees INT;
  v_total_completions INT;
  v_done BOOLEAN := false;
BEGIN
  SELECT o.* INTO v_occ FROM task_occurrences o WHERE o.id = p_occurrence_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;

  SELECT t.* INTO v_task FROM tasks t WHERE t.id = v_occ.task_id;

  IF NOT is_task_participant(v_task.id) THEN
    RAISE EXCEPTION 'Sem permissão para concluir esta tarefa';
  END IF;

  INSERT INTO task_completions (occurrence_id, user_id)
  VALUES (p_occurrence_id, auth.uid())
  ON CONFLICT (occurrence_id, user_id) DO NOTHING;

  IF v_task.completion_mode = 'any' THEN
    v_done := true;
  ELSIF auth.uid() = v_task.created_by THEN
    -- Dono concluiu → fecha para todos, mesmo no modo 'all'
    v_done := true;
  ELSE
    -- 'all': criador + assignees aceitos precisam concluir
    SELECT COUNT(*) INTO v_total_assignees FROM (
      SELECT v_task.created_by AS uid
      UNION
      SELECT a.user_id FROM task_assignees a
       WHERE a.task_id = v_task.id AND a.status = 'accepted'
    ) q;
    SELECT COUNT(*) INTO v_total_completions
      FROM task_completions c WHERE c.occurrence_id = p_occurrence_id;
    v_done := v_total_completions >= v_total_assignees;
  END IF;

  IF v_done AND v_occ.status <> 'done' THEN
    UPDATE task_occurrences SET status = 'done', completed_at = now()
     WHERE id = p_occurrence_id;
  END IF;

  RETURN jsonb_build_object('done', v_done);
END;
$$;

GRANT EXECUTE ON FUNCTION complete_task_occurrence(UUID) TO authenticated;
