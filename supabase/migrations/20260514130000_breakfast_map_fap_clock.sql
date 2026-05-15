-- ============================================================================
-- EXPANSÃO MÓDULO CAFÉ DA MANHÃ: MAP/FAP E CONFIGURAÇÕES DE RELÓGIO (FORCE APPLY)
-- Data: 14/05/2026
-- ============================================================================

-- 1. Atualizar breakfast_configs para incluir horários de almoço e jantar + transição de relógio
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='breakfast_configs' AND column_name='lunch_start_time') THEN
        ALTER TABLE breakfast_configs ADD COLUMN lunch_start_time TIME DEFAULT '12:00';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='breakfast_configs' AND column_name='lunch_end_time') THEN
        ALTER TABLE breakfast_configs ADD COLUMN lunch_end_time TIME DEFAULT '14:30';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='breakfast_configs' AND column_name='dinner_start_time') THEN
        ALTER TABLE breakfast_configs ADD COLUMN dinner_start_time TIME DEFAULT '19:00';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='breakfast_configs' AND column_name='dinner_end_time') THEN
        ALTER TABLE breakfast_configs ADD COLUMN dinner_end_time TIME DEFAULT '22:00';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='breakfast_configs' AND column_name='clock_transition_minutes') THEN
        ALTER TABLE breakfast_configs ADD COLUMN clock_transition_minutes INTEGER DEFAULT 30;
    END IF;
END $$;

-- 2. Atualizar breakfast_records para incluir o tipo de refeição (Pensão)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='breakfast_records' AND column_name='meal_type') THEN
        ALTER TABLE breakfast_records ADD COLUMN meal_type TEXT DEFAULT 'breakfast' CHECK (meal_type IN ('breakfast', 'map', 'fap'));
    END IF;
END $$;

-- 3. Ajustar UNIQUE constraint para permitir o mesmo hóspede em diferentes tipos de refeição no mesmo dia
ALTER TABLE breakfast_records DROP CONSTRAINT IF EXISTS breakfast_records_hotel_id_date_id_guest_key;
ALTER TABLE breakfast_records DROP CONSTRAINT IF EXISTS breakfast_records_composite_key;
ALTER TABLE breakfast_records ADD CONSTRAINT breakfast_records_composite_key UNIQUE(hotel_id, date, id_guest, meal_type);

-- 4. Adicionar índices para performance nas novas consultas
CREATE INDEX IF NOT EXISTS idx_breakfast_records_meal_type ON breakfast_records(meal_type);
