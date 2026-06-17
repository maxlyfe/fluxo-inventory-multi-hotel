-- ============================================================================
-- EQUIPAMENTOS: ARQUIVAR + Nº DE SÉRIE ÚNICO POR GRUPO
-- ============================================================================
-- 1. Coluna "archived" — equipamentos arquivados saem da lista padrão (mas o
--    histórico é preservado e a ação é reversível).
-- 2. Trigger: impede cadastrar 2 equipamentos com o MESMO número de série
--    dentro do MESMO grupo hoteleiro (não bloqueia entre grupos diferentes).
--    Equipamentos arquivados e S/N vazio são ignorados na verificação.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- ── 1. Coluna archived ───────────────────────────────────────────────────────
ALTER TABLE maintenance_equipment
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;

-- ── 2. S/N único por grupo (trigger) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_equipment_serial_unique_per_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_group   UUID;
  v_serial  TEXT;
  conflict  BOOLEAN;
BEGIN
  v_serial := NULLIF(btrim(COALESCE(NEW.serial_number, '')), '');
  -- Sem S/N → nada a validar
  IF v_serial IS NULL THEN RETURN NEW; END IF;
  -- Arquivado não participa da verificação (equipamento aposentado)
  IF COALESCE(NEW.archived, false) = true THEN RETURN NEW; END IF;

  SELECT group_id INTO v_group FROM hotels WHERE id = NEW.hotel_id;

  SELECT EXISTS (
    SELECT 1
    FROM maintenance_equipment e
    JOIN hotels h ON h.id = e.hotel_id
    WHERE e.id <> NEW.id
      AND COALESCE(e.archived, false) = false
      AND lower(btrim(e.serial_number)) = lower(v_serial)
      AND h.group_id IS NOT DISTINCT FROM v_group
  ) INTO conflict;

  IF conflict THEN
    RAISE EXCEPTION 'DUPLICATE_SERIAL: Já existe um equipamento com este número de série neste grupo.'
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_equipment_serial_unique ON maintenance_equipment;
CREATE TRIGGER trg_equipment_serial_unique
  BEFORE INSERT OR UPDATE ON maintenance_equipment
  FOR EACH ROW EXECUTE FUNCTION check_equipment_serial_unique_per_group();

-- TESTE: tentar inserir 2 equipamentos com o mesmo serial_number em hotéis do
-- mesmo grupo → o segundo falha com "DUPLICATE_SERIAL".
-- ============================================================================
