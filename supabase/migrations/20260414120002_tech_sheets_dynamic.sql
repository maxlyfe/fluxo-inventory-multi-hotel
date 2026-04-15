-- =====================================================
-- FASE 3: Fichas Técnicas Dinâmicas
-- =====================================================

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE;
ALTER TABLE sides ADD COLUMN IF NOT EXISTS hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS production_sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingredients_product ON ingredients(product_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_hotel ON ingredients(hotel_id);
CREATE INDEX IF NOT EXISTS idx_sides_hotel ON sides(hotel_id);
CREATE INDEX IF NOT EXISTS idx_dishes_hotel ON dishes(hotel_id);

CREATE OR REPLACE FUNCTION cascade_product_price_to_ingredient()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.average_price IS DISTINCT FROM OLD.average_price THEN
    UPDATE ingredients
    SET price_per_unit = COALESCE(NEW.average_price, 0)
    WHERE product_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cascade_price_to_ingredient'
  ) THEN
    CREATE TRIGGER trg_cascade_price_to_ingredient
      AFTER UPDATE OF average_price ON products
      FOR EACH ROW
      EXECUTE FUNCTION cascade_product_price_to_ingredient();
  END IF;
END $$;
