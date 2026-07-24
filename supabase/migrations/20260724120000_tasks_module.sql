-- ============================================================================
-- Módulo de Tarefas + Anotações (Todo List)
-- ============================================================================
-- Tarefas pessoais e compartilhadas com recorrência (diária, semanal, mensal,
-- anual, personalizada). Recorrência = template (tasks) + instâncias
-- materializadas (task_occurrences) numa janela rolante de 60 dias.
--
-- Compartilhamento por convite (task_assignees, pendente/aceito/recusado).
-- Conclusão: modo 'any' (qualquer um conclui) ou 'all' (todos concluem),
-- gravando quem/quando em task_completions.
--
-- Anotações (notes) individuais ou compartilhadas com flag allow_edit.
-- Comentários polimórficos (task_comments) em tarefas e anotações.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- 1. Tarefas (template) ------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              UUID REFERENCES hotels(id), -- NULL = rede toda
  created_by            UUID NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  due_date              DATE NOT NULL,               -- primeira/única data
  due_time              TIME,
  completion_mode       TEXT NOT NULL DEFAULT 'any' CHECK (completion_mode IN ('any','all')),
  -- Recorrência (RRULE simplificado)
  recurrence_freq       TEXT NOT NULL DEFAULT 'none' CHECK (recurrence_freq IN ('none','daily','weekly','monthly','yearly','custom')),
  recurrence_interval   INT  NOT NULL DEFAULT 1,     -- a cada N dias/semanas/meses/anos
  recurrence_byweekday  INT[],                       -- 0=Dom .. 6=Sáb (weekly/custom)
  recurrence_bymonthday INT[],                       -- dias do mês (monthly/custom)
  recurrence_until      DATE,                        -- fim da recorrência (opcional)
  recurrence_count      INT,                         -- nº máximo de ocorrências (opcional)
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Colaboradores anexados à tarefa (convite) --------------------------------
CREATE TABLE IF NOT EXISTS task_assignees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  responded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id)
);

-- 3. Instâncias (ocorrências) materializadas ---------------------------------
CREATE TABLE IF NOT EXISTS task_occurrences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  due_date     DATE NOT NULL,
  due_time     TIME,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, due_date)
);
CREATE INDEX IF NOT EXISTS idx_task_occurrences_due ON task_occurrences (due_date);

-- 4. Quem concluiu cada ocorrência (modo 'all' grava todos) -------------------
CREATE TABLE IF NOT EXISTS task_completions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id UUID NOT NULL REFERENCES task_occurrences(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (occurrence_id, user_id)
);

-- 5. Anotações ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   UUID REFERENCES hotels(id), -- NULL = rede toda
  created_by UUID NOT NULL,
  title      TEXT,
  content    TEXT,
  is_shared  BOOLEAN NOT NULL DEFAULT false,
  allow_edit BOOLEAN NOT NULL DEFAULT false, -- colaboradores podem editar?
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_collaborators (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id    UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (note_id, user_id)
);

-- 6. Comentários (tarefas e anotações) ----------------------------------------
CREATE TABLE IF NOT EXISTS task_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('task','note')),
  entity_id     UUID NOT NULL,
  occurrence_id UUID REFERENCES task_occurrences(id) ON DELETE CASCADE, -- opcional: comentar a instância
  user_id       UUID NOT NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_entity ON task_comments (entity_type, entity_id);

-- 7. Idempotência dos lembretes -------------------------------------------------
CREATE TABLE IF NOT EXISTS task_reminders_sent (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id UUID NOT NULL REFERENCES task_occurrences(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  kind          TEXT NOT NULL, -- '24h' | 'morning' | '1h'
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (occurrence_id, user_id, kind)
);

-- ============================================================================
-- Funções auxiliares (SECURITY DEFINER)
-- ============================================================================

-- Participantes de uma tarefa: criador + assignees não recusados
CREATE OR REPLACE FUNCTION task_participant_ids(p_task_id UUID)
RETURNS TABLE(user_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.created_by FROM tasks t WHERE t.id = p_task_id
  UNION
  SELECT a.user_id FROM task_assignees a
   WHERE a.task_id = p_task_id AND a.status <> 'declined';
$$;

CREATE OR REPLACE FUNCTION is_task_participant(p_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IN (SELECT user_id FROM task_participant_ids(p_task_id));
$$;

CREATE OR REPLACE FUNCTION is_note_participant(p_note_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM notes n WHERE n.id = p_note_id AND n.created_by = auth.uid()
    UNION
    SELECT 1 FROM note_collaborators c WHERE c.note_id = p_note_id AND c.user_id = auth.uid()
  );
$$;

-- Pode editar a nota? Dono sempre; colaborador só se allow_edit
CREATE OR REPLACE FUNCTION can_edit_note(p_note_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM notes n
     WHERE n.id = p_note_id
       AND ( n.created_by = auth.uid()
             OR ( n.allow_edit AND EXISTS (
                    SELECT 1 FROM note_collaborators c
                     WHERE c.note_id = n.id AND c.user_id = auth.uid())) )
  );
$$;

-- ============================================================================
-- Geração de ocorrências (materialização da recorrência)
-- ============================================================================
-- Expande a regra numa janela [due_date .. hoje + p_horizon_days].
-- Ao editar a regra, remove ocorrências futuras pendentes que não batem mais.
-- Mensal em dia inexistente (ex.: 31 em fevereiro) → usa o último dia do mês.
CREATE OR REPLACE FUNCTION generate_task_occurrences(p_task_id UUID, p_horizon_days INT DEFAULT 60)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t          tasks%ROWTYPE;
  v_end      DATE;
  v_dates    DATE[];
  v_d        DATE;
  v_base     DATE;
  v_i        INT;
  v_md       INT;
  v_inserted INT := 0;
BEGIN
  SELECT * INTO t FROM tasks WHERE id = p_task_id;
  IF NOT FOUND OR NOT t.is_active THEN RETURN 0; END IF;

  v_end := CURRENT_DATE + p_horizon_days;
  IF t.recurrence_until IS NOT NULL AND t.recurrence_until < v_end THEN
    v_end := t.recurrence_until;
  END IF;

  IF t.recurrence_freq = 'none' THEN
    v_dates := ARRAY[t.due_date];
  ELSE
    v_dates := ARRAY[]::DATE[];
    v_i := 0;

    IF t.recurrence_freq = 'daily' THEN
      v_d := t.due_date;
      WHILE v_d <= v_end LOOP
        v_dates := v_dates || v_d;
        v_i := v_i + 1;
        EXIT WHEN t.recurrence_count IS NOT NULL AND v_i >= t.recurrence_count;
        v_d := v_d + (GREATEST(t.recurrence_interval,1) || ' days')::interval;
      END LOOP;

    ELSIF t.recurrence_freq IN ('weekly','custom') AND t.recurrence_byweekday IS NOT NULL
          AND array_length(t.recurrence_byweekday,1) > 0 THEN
      -- Semanas a cada N, nos dias da semana marcados
      v_base := date_trunc('week', t.due_date + 1)::date - 1; -- domingo da semana da 1ª data
      WHILE v_base <= v_end LOOP
        FOR v_md IN SELECT x FROM unnest(t.recurrence_byweekday) x ORDER BY x LOOP
          v_d := v_base + v_md;
          IF v_d >= t.due_date AND v_d <= v_end THEN
            v_dates := v_dates || v_d;
            v_i := v_i + 1;
            EXIT WHEN t.recurrence_count IS NOT NULL AND v_i >= t.recurrence_count;
          END IF;
        END LOOP;
        EXIT WHEN t.recurrence_count IS NOT NULL AND v_i >= t.recurrence_count;
        v_base := v_base + (GREATEST(t.recurrence_interval,1) * 7);
      END LOOP;

    ELSIF t.recurrence_freq = 'weekly' THEN
      -- Semanal simples: mesmo dia da semana da 1ª data
      v_d := t.due_date;
      WHILE v_d <= v_end LOOP
        v_dates := v_dates || v_d;
        v_i := v_i + 1;
        EXIT WHEN t.recurrence_count IS NOT NULL AND v_i >= t.recurrence_count;
        v_d := v_d + (GREATEST(t.recurrence_interval,1) * 7);
      END LOOP;

    ELSIF t.recurrence_freq IN ('monthly','custom') AND t.recurrence_bymonthday IS NOT NULL
          AND array_length(t.recurrence_bymonthday,1) > 0 THEN
      -- Mensal a cada N meses, nos dias do mês marcados
      v_base := date_trunc('month', t.due_date)::date;
      WHILE v_base <= v_end LOOP
        FOR v_md IN SELECT x FROM unnest(t.recurrence_bymonthday) x ORDER BY x LOOP
          -- dia inexistente → último dia do mês
          v_d := LEAST(v_base + (v_md - 1),
                       (v_base + interval '1 month' - interval '1 day')::date);
          IF v_d >= t.due_date AND v_d <= v_end THEN
            v_dates := v_dates || v_d;
            v_i := v_i + 1;
            EXIT WHEN t.recurrence_count IS NOT NULL AND v_i >= t.recurrence_count;
          END IF;
        END LOOP;
        EXIT WHEN t.recurrence_count IS NOT NULL AND v_i >= t.recurrence_count;
        v_base := (v_base + (GREATEST(t.recurrence_interval,1) || ' months')::interval)::date;
      END LOOP;

    ELSIF t.recurrence_freq = 'monthly' THEN
      -- Mensal simples: mesmo dia da 1ª data (ajustando mês curto)
      v_md := EXTRACT(DAY FROM t.due_date)::int;
      v_base := date_trunc('month', t.due_date)::date;
      WHILE v_base <= v_end LOOP
        v_d := LEAST(v_base + (v_md - 1),
                     (v_base + interval '1 month' - interval '1 day')::date);
        IF v_d >= t.due_date AND v_d <= v_end THEN
          v_dates := v_dates || v_d;
          v_i := v_i + 1;
          EXIT WHEN t.recurrence_count IS NOT NULL AND v_i >= t.recurrence_count;
        END IF;
        v_base := (v_base + (GREATEST(t.recurrence_interval,1) || ' months')::interval)::date;
      END LOOP;

    ELSIF t.recurrence_freq = 'yearly' THEN
      v_d := t.due_date;
      v_base := t.due_date;
      WHILE v_d <= v_end LOOP
        v_dates := v_dates || v_d;
        v_i := v_i + 1;
        EXIT WHEN t.recurrence_count IS NOT NULL AND v_i >= t.recurrence_count;
        v_base := (v_base + (GREATEST(t.recurrence_interval,1) || ' years')::interval)::date;
        -- 29/02 em ano não bissexto → 28/02 (comportamento do interval do Postgres)
        v_d := v_base;
      END LOOP;

    ELSE
      -- custom sem byweekday/bymonthday: cai no diário com intervalo
      v_d := t.due_date;
      WHILE v_d <= v_end LOOP
        v_dates := v_dates || v_d;
        v_i := v_i + 1;
        EXIT WHEN t.recurrence_count IS NOT NULL AND v_i >= t.recurrence_count;
        v_d := v_d + GREATEST(t.recurrence_interval,1);
      END LOOP;
    END IF;
  END IF;

  -- Remove ocorrências futuras pendentes que saíram da regra (edição)
  DELETE FROM task_occurrences o
   WHERE o.task_id = p_task_id
     AND o.status = 'pending'
     AND o.due_date >= CURRENT_DATE
     AND o.due_date <> ALL (COALESCE(v_dates, ARRAY[]::DATE[]));

  -- Insere as que faltam
  INSERT INTO task_occurrences (task_id, due_date, due_time)
  SELECT p_task_id, d, t.due_time FROM unnest(v_dates) d
  ON CONFLICT (task_id, due_date) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted;
END;
$$;

-- ============================================================================
-- Conclusão de ocorrência (evita corrida de RLS e centraliza a regra any/all)
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

-- Desfazer conclusão (remove meu registro e reabre a ocorrência)
CREATE OR REPLACE FUNCTION uncomplete_task_occurrence(p_occurrence_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_task_id UUID;
BEGIN
  SELECT o.task_id INTO v_task_id FROM task_occurrences o WHERE o.id = p_occurrence_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
  IF NOT is_task_participant(v_task_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  DELETE FROM task_completions
   WHERE occurrence_id = p_occurrence_id AND user_id = auth.uid();

  UPDATE task_occurrences SET status = 'pending', completed_at = NULL
   WHERE id = p_occurrence_id;
END;
$$;

-- ============================================================================
-- Ocorrências visíveis para o usuário logado no período (calendário/lista)
-- ============================================================================
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
  my_assignee_status TEXT,      -- NULL = sou o criador sem convite
  is_shared       BOOLEAN,
  assignees       JSONB,        -- [{user_id, status}]
  completions     JSONB,        -- [{user_id, completed_at}]
  i_completed     BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    o.id, t.id, t.title, t.description, o.due_date, o.due_time, o.status,
    o.completed_at, t.completion_mode, t.recurrence_freq, t.hotel_id, t.created_by,
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

GRANT EXECUTE ON FUNCTION task_participant_ids(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_task_participant(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_note_participant(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_edit_note(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_task_occurrences(UUID, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION complete_task_occurrence(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION uncomplete_task_occurrence(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_task_occurrences(UUID, DATE, DATE) TO authenticated;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_occurrences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_completions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_collaborators  ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_reminders_sent ENABLE ROW LEVEL SECURITY;

-- tasks: participante vê; só o criador altera/apaga
DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated
  USING (is_task_participant(id));
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated
  USING (created_by = auth.uid());
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- task_assignees: participante vê; criador gerencia; convidado responde o próprio
DROP POLICY IF EXISTS "ta_select" ON task_assignees;
CREATE POLICY "ta_select" ON task_assignees FOR SELECT TO authenticated
  USING (is_task_participant(task_id) OR user_id = auth.uid());
DROP POLICY IF EXISTS "ta_insert" ON task_assignees;
CREATE POLICY "ta_insert" ON task_assignees FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.created_by = auth.uid()));
DROP POLICY IF EXISTS "ta_update" ON task_assignees;
CREATE POLICY "ta_update" ON task_assignees FOR UPDATE TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.created_by = auth.uid()));
DROP POLICY IF EXISTS "ta_delete" ON task_assignees;
CREATE POLICY "ta_delete" ON task_assignees FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.created_by = auth.uid()));

-- task_occurrences: participante vê; escrita via RPCs (mas criador pode 'skipped')
DROP POLICY IF EXISTS "to_select" ON task_occurrences;
CREATE POLICY "to_select" ON task_occurrences FOR SELECT TO authenticated
  USING (is_task_participant(task_id));
DROP POLICY IF EXISTS "to_update" ON task_occurrences;
CREATE POLICY "to_update" ON task_occurrences FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.created_by = auth.uid()));

-- task_completions: participante vê (escrita só via RPC SECURITY DEFINER)
DROP POLICY IF EXISTS "tc_select" ON task_completions;
CREATE POLICY "tc_select" ON task_completions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM task_occurrences o
                  WHERE o.id = occurrence_id AND is_task_participant(o.task_id)));

-- notes: dono + colaboradores veem; edição conforme allow_edit; só dono apaga
DROP POLICY IF EXISTS "notes_select" ON notes;
CREATE POLICY "notes_select" ON notes FOR SELECT TO authenticated
  USING (is_note_participant(id));
DROP POLICY IF EXISTS "notes_insert" ON notes;
CREATE POLICY "notes_insert" ON notes FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
DROP POLICY IF EXISTS "notes_update" ON notes;
CREATE POLICY "notes_update" ON notes FOR UPDATE TO authenticated
  USING (can_edit_note(id));
DROP POLICY IF EXISTS "notes_delete" ON notes;
CREATE POLICY "notes_delete" ON notes FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- note_collaborators: dono gerencia; colaborador vê os da nota
DROP POLICY IF EXISTS "nc_select" ON note_collaborators;
CREATE POLICY "nc_select" ON note_collaborators FOR SELECT TO authenticated
  USING (is_note_participant(note_id));
DROP POLICY IF EXISTS "nc_insert" ON note_collaborators;
CREATE POLICY "nc_insert" ON note_collaborators FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.created_by = auth.uid()));
DROP POLICY IF EXISTS "nc_delete" ON note_collaborators;
CREATE POLICY "nc_delete" ON note_collaborators FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.created_by = auth.uid())
         OR user_id = auth.uid());

-- task_comments: participante da entidade vê e comenta; autor apaga o próprio
DROP POLICY IF EXISTS "tcm_select" ON task_comments;
CREATE POLICY "tcm_select" ON task_comments FOR SELECT TO authenticated
  USING (
    (entity_type = 'task' AND is_task_participant(entity_id))
    OR (entity_type = 'note' AND is_note_participant(entity_id))
  );
DROP POLICY IF EXISTS "tcm_insert" ON task_comments;
CREATE POLICY "tcm_insert" ON task_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND ( (entity_type = 'task' AND is_task_participant(entity_id))
       OR (entity_type = 'note' AND is_note_participant(entity_id)) )
  );
DROP POLICY IF EXISTS "tcm_delete" ON task_comments;
CREATE POLICY "tcm_delete" ON task_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- task_reminders_sent: uso interno (CRON com service_role); leitura liberada
DROP POLICY IF EXISTS "trs_select" ON task_reminders_sent;
CREATE POLICY "trs_select" ON task_reminders_sent FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- Tipos de notificação
-- ============================================================================
INSERT INTO notification_types (event_key, description, default_message_template, target_path_template, icon)
VALUES
  ('TASK_ASSIGNED',  'Convite de tarefa',       '{title}', '/portal/tasks', '✅'),
  ('TASK_DUE',       'Lembrete de tarefa',      '{title}', '/portal/tasks', '⏰'),
  ('TASK_COMPLETED', 'Tarefa concluída',        '{title}', '/portal/tasks', '🎉'),
  ('TASK_COMMENT',   'Comentário em tarefa',    '{title}', '/portal/tasks', '💬'),
  ('NOTE_SHARED',    'Anotação compartilhada',  '{title}', '/portal/tasks', '📝')
ON CONFLICT (event_key) DO UPDATE
  SET description = EXCLUDED.description,
      target_path_template = EXCLUDED.target_path_template,
      icon = EXCLUDED.icon;

-- ============================================================================
-- Conferir:
--   SELECT generate_task_occurrences('<task_id>');
--   SELECT * FROM get_my_task_occurrences('<hotel_id>', CURRENT_DATE, CURRENT_DATE + 30);
-- ============================================================================
