-- ============================================================================
-- EXPANSÃO MÓDULO CAFÉ DA MANHÃ: MAP/FAP E CONFIGURAÇÕES DE RELÓGIO
-- Data: 14/05/2026
-- ============================================================================

-- 1. Atualizar breakfast_configs para incluir horários de almoço e jantar + transição de relógio
ALTER TABLE breakfast_configs 
  ADD COLUMN IF NOT EXISTS lunch_start_time TIME DEFAULT '12:00',
  ADD COLUMN IF NOT EXISTS lunch_end_time TIME DEFAULT '14:30',
  ADD COLUMN IF NOT EXISTS dinner_start_time TIME DEFAULT '19:00',
  ADD COLUMN IF NOT EXISTS dinner_end_time TIME DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS clock_transition_minutes INTEGER DEFAULT 30;

-- 2. Atualizar breakfast_records para incluir o tipo de refeição (Pensão)
-- Tipos: 'breakfast', 'map' (Meia Pensão), 'fap' (Pensão Completa)
-- Nota: 'breakfast' é o padrão para manter compatibilidade com registros atuais.
ALTER TABLE breakfast_records 
  ADD COLUMN IF NOT EXISTS meal_type TEXT DEFAULT 'breakfast' CHECK (meal_type IN ('breakfast', 'map', 'fap'));

-- 3. Ajustar UNIQUE constraint para permitir o mesmo hóspede em diferentes tipos de refeição no mesmo dia
-- Primeiro removemos a antiga se existir
ALTER TABLE breakfast_records DROP CONSTRAINT IF EXISTS breakfast_records_hotel_id_date_id_guest_key;
-- Criamos a nova composta por hotel, data, hospede e tipo de refeição
ALTER TABLE breakfast_records ADD CONSTRAINT breakfast_records_composite_key UNIQUE(hotel_id, date, id_guest, meal_type);

-- 4. Adicionar índices para performance nas novas consultas
CREATE INDEX IF NOT EXISTS idx_breakfast_records_meal_type ON breakfast_records(meal_type);
