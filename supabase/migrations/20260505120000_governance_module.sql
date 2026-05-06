-- Migration: Governance Module
-- Create tables for room management and integrated workflow

-- 1. Room Categories (Manual Hotels)
CREATE TABLE IF NOT EXISTS hotel_room_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Rooms (Manual Hotels)
CREATE TABLE IF NOT EXISTS hotel_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
    category_id UUID REFERENCES hotel_room_categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    floor INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Room Workflow (Central state tracking)
-- room_id: Can be the Local UUID (hotel_rooms.id) or the Erbon Room ID (string)
CREATE TABLE IF NOT EXISTS hotel_room_workflow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL, 
    room_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_maint', -- pending_maint, maint_ok, cleaning, clean, contested
    last_user_id UUID REFERENCES auth.users(id),
    last_user_name TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(hotel_id, room_id)
);

-- 4. Status Logs (Audit Trail & Timeline)
CREATE TABLE IF NOT EXISTS hotel_room_status_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    notes TEXT,
    duration_seconds INTEGER, -- Seconds spent in the previous status
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies
ALTER TABLE hotel_room_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_room_workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_room_status_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_room_categories" ON hotel_room_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage_room_categories" ON hotel_room_categories FOR ALL TO authenticated USING (true);

CREATE POLICY "read_rooms" ON hotel_rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage_rooms" ON hotel_rooms FOR ALL TO authenticated USING (true);

CREATE POLICY "read_room_workflow" ON hotel_room_workflow FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage_room_workflow" ON hotel_room_workflow FOR ALL TO authenticated USING (true);

CREATE POLICY "read_room_status_logs" ON hotel_room_status_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_room_status_logs" ON hotel_room_status_logs FOR INSERT TO authenticated WITH CHECK (true);

-- Insert Notification Types
INSERT INTO notification_types (event_key, description, icon)
VALUES 
    ('room_ready_for_governance', 'UH liberada pela manutenção para limpeza', 'Sparkles'),
    ('room_ready_for_checkin', 'UH limpa e disponível para check-in', 'CheckCircle'),
    ('room_maint_contested', 'Limpeza contestada pela governança', 'AlertTriangle')
ON CONFLICT (event_key) DO NOTHING;
