-- Adicionar entry_type_key para mapear occurrence_types ao comportamento do sistema
ALTER TABLE occurrence_types
  ADD COLUMN IF NOT EXISTS entry_type_key text;

-- Índice único por hotel para evitar duplicatas de tipos do sistema
CREATE UNIQUE INDEX IF NOT EXISTS uq_occurrence_types_hotel_entry_key
  ON occurrence_types (hotel_id, entry_type_key)
  WHERE entry_type_key IS NOT NULL;

-- Backfill: tipos do sistema existentes (falta/atestado) que já tinham slug mas não entry_type_key
UPDATE occurrence_types SET entry_type_key = 'falta'
  WHERE is_system = true AND slug = 'falta' AND entry_type_key IS NULL;
UPDATE occurrence_types SET entry_type_key = 'atestado'
  WHERE is_system = true AND slug = 'atestado' AND entry_type_key IS NULL;
