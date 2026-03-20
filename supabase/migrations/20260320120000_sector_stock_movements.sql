CREATE TABLE IF NOT EXISTS sector_stock_movements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  sector_id uuid NOT NULL REFERENCES sectors(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity numeric NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('entrada', 'saida')),
  -- For saida: where it went; For entrada: where it came from
  destination_sector_id uuid REFERENCES sectors(id),
  destination_hotel_id uuid REFERENCES hotels(id),
  destination_label text, -- human readable like "Cozinha" or "Brava Club > Restaurante"
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX idx_sector_stock_movements_lookup
  ON sector_stock_movements(hotel_id, sector_id, product_id, created_at);

CREATE INDEX idx_sector_stock_movements_type
  ON sector_stock_movements(movement_type, created_at);

-- Enable RLS
ALTER TABLE sector_stock_movements ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can do everything (same pattern as other tables)
CREATE POLICY "Authenticated users can manage sector_stock_movements"
  ON sector_stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
