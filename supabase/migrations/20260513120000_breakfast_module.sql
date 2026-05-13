-- Breakfast Configuration per Hotel
CREATE TABLE IF NOT EXISTS breakfast_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  start_time TIME NOT NULL DEFAULT '07:00',
  end_time TIME NOT NULL DEFAULT '10:00',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(hotel_id)
);

-- Breakfast Records (Daily guest tracking)
CREATE TABLE IF NOT EXISTS breakfast_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  id_booking INTEGER NOT NULL,
  id_guest INTEGER NOT NULL,
  guest_name TEXT,
  room_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'checked_in', 'kit_requested')),
  adults INTEGER DEFAULT 1,
  children INTEGER DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(hotel_id, date, id_guest)
);

-- Enable RLS
ALTER TABLE breakfast_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE breakfast_records ENABLE ROW LEVEL SECURITY;

-- Policies for breakfast_configs
CREATE POLICY "breakfast_configs_read" ON breakfast_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "breakfast_configs_insert" ON breakfast_configs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "breakfast_configs_update" ON breakfast_configs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "breakfast_configs_delete" ON breakfast_configs FOR DELETE TO authenticated USING (true);

-- Policies for breakfast_records
CREATE POLICY "breakfast_records_read" ON breakfast_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "breakfast_records_insert" ON breakfast_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "breakfast_records_update" ON breakfast_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "breakfast_records_delete" ON breakfast_records FOR DELETE TO authenticated USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_breakfast_records_hotel_date ON breakfast_records(hotel_id, date);
CREATE INDEX IF NOT EXISTS idx_breakfast_records_status ON breakfast_records(status);
