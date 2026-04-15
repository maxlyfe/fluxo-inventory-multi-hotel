-- =====================================================
-- FASE 5: Min/Max Sazonal
-- =====================================================

ALTER TABLE sector_stock ADD COLUMN IF NOT EXISTS min_quantity_low NUMERIC;
ALTER TABLE sector_stock ADD COLUMN IF NOT EXISTS max_quantity_low NUMERIC;
ALTER TABLE sector_stock ADD COLUMN IF NOT EXISTS min_quantity_high NUMERIC;
ALTER TABLE sector_stock ADD COLUMN IF NOT EXISTS max_quantity_high NUMERIC;

ALTER TABLE erbon_hotel_config ADD COLUMN IF NOT EXISTS high_season_occupancy_threshold NUMERIC DEFAULT 40;
ALTER TABLE erbon_hotel_config ADD COLUMN IF NOT EXISTS season_mode TEXT DEFAULT 'auto' CHECK (season_mode IN ('auto', 'alta', 'baixa'));
