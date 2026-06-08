-- ============================================================================
-- Eventos com participantes (audiência dinâmica) + lembretes agendados
-- ============================================================================
-- Audiência dinâmica: o evento guarda o ALVO (rede/hotel/setores/individuais)
-- e os participantes são resolvidos na hora (quem entrar no grupo depois passa
-- a ver o evento e a receber lembretes).
--
-- Visibilidade: eventos COM audiência definida só aparecem para participantes
-- (+ criador). Eventos SEM audiência continuam "públicos do hotel" (legado).
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- 1. Novas colunas em events ------------------------------------------------
ALTER TABLE events ADD COLUMN IF NOT EXISTS audience_all_network BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS audience_all_hotel   BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS target_user_ids      UUID[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS notify_on_create     BOOLEAN DEFAULT false;
-- target_sectors TEXT[] já existe (setores do DP)

-- 2. Tabela de idempotência dos lembretes -----------------------------------
CREATE TABLE IF NOT EXISTS event_reminders_sent (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL, -- 'created' | '24h' | 'morning' | '10min'
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, kind)
);
ALTER TABLE event_reminders_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rrs_all" ON event_reminders_sent;
CREATE POLICY "rrs_all" ON event_reminders_sent FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Resolve os user_ids participantes de um evento (audiência dinâmica) -----
CREATE OR REPLACE FUNCTION event_participant_ids(p_event_id UUID)
RETURNS TABLE(user_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH e AS (SELECT * FROM events WHERE id = p_event_id)
  SELECT DISTINCT uid FROM (
    -- Toda a rede
    SELECT em.user_id AS uid
      FROM employees em, e
     WHERE e.audience_all_network AND em.user_id IS NOT NULL
    UNION
    -- Todo o hotel do evento
    SELECT em.user_id
      FROM employees em, e
     WHERE e.audience_all_hotel AND em.hotel_id = e.hotel_id AND em.user_id IS NOT NULL
    UNION
    -- Por setor (setores do DP). Se o evento é da rede (hotel_id null) considera todos os hotéis.
    SELECT em.user_id
      FROM employees em, e
     WHERE e.target_sectors IS NOT NULL
       AND em.sector = ANY(e.target_sectors)
       AND (e.hotel_id IS NULL OR em.hotel_id = e.hotel_id)
       AND em.user_id IS NOT NULL
    UNION
    -- Individuais
    SELECT unnest(e.target_user_ids) FROM e WHERE e.target_user_ids IS NOT NULL
    UNION
    -- Criador sempre participa
    SELECT e.created_by FROM e WHERE e.created_by IS NOT NULL
  ) q
  WHERE uid IS NOT NULL;
$$;

-- 4. True se o evento tem audiência definida (privado) -----------------------
CREATE OR REPLACE FUNCTION event_has_audience(e events)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(e.audience_all_network, false)
      OR COALESCE(e.audience_all_hotel, false)
      OR (e.target_sectors  IS NOT NULL AND array_length(e.target_sectors, 1)  > 0)
      OR (e.target_user_ids IS NOT NULL AND array_length(e.target_user_ids, 1) > 0);
$$;

-- 5. Eventos visíveis para o usuário logado no período -----------------------
-- Público (sem audiência) do hotel/rede OU eventos onde sou participante.
CREATE OR REPLACE FUNCTION get_my_events(p_hotel_id UUID, p_from DATE, p_to DATE)
RETURNS SETOF events
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.* FROM events e
  WHERE e.event_date >= p_from AND e.event_date <= p_to
    AND (
      -- Públicos (legado): sem audiência, do hotel selecionado ou da rede
      ( NOT event_has_audience(e) AND (e.hotel_id = p_hotel_id OR e.hotel_id IS NULL) )
      OR
      -- Sou o criador
      ( e.created_by = auth.uid() )
      OR
      -- Sou participante (audiência dinâmica)
      ( auth.uid() IN (SELECT user_id FROM event_participant_ids(e.id)) )
    )
  ORDER BY e.event_date;
$$;

GRANT EXECUTE ON FUNCTION get_my_events(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION event_participant_ids(UUID) TO authenticated, service_role;

-- 6. Tipo de notificação de evento (não aparece em /users — é automático) ----
INSERT INTO notification_types (event_key, description, default_message_template, target_path_template, icon)
VALUES ('EVENT_REMINDER', 'Lembrete de evento', '{title}', '/portal/events', '📅')
ON CONFLICT (event_key) DO UPDATE
  SET description = EXCLUDED.description, target_path_template = EXCLUDED.target_path_template, icon = EXCLUDED.icon;

-- ============================================================================
-- Conferir:
--   SELECT * FROM get_my_events('<hotel_id>', date_trunc('month', now())::date,
--                               (date_trunc('month', now()) + interval '1 month')::date);
-- ============================================================================
