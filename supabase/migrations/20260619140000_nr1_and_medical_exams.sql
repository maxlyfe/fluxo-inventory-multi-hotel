-- Migration: Create medical_exams and nr1_training_records tables
-- Date: 2026-06-19

-- 1. Create medical_exams table
CREATE TABLE IF NOT EXISTS medical_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL,
  exam_date DATE NOT NULL,
  valid_until DATE,
  result TEXT,
  restrictions TEXT,
  clinic TEXT,
  doctor_name TEXT,
  crm TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create nr1_training_records table
CREATE TABLE IF NOT EXISTS nr1_training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  training_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  trainer TEXT,
  training_date DATE NOT NULL,
  valid_until DATE,
  hours NUMERIC,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for medical_exams
ALTER TABLE medical_exams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read" ON medical_exams FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert" ON medical_exams FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update" ON medical_exams FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete" ON medical_exams FOR DELETE TO authenticated USING (true);

-- Enable RLS for nr1_training_records
ALTER TABLE nr1_training_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read" ON nr1_training_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert" ON nr1_training_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update" ON nr1_training_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete" ON nr1_training_records FOR DELETE TO authenticated USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_medical_exams_hotel_id ON medical_exams(hotel_id);
CREATE INDEX IF NOT EXISTS idx_medical_exams_employee_id ON medical_exams(employee_id);
CREATE INDEX IF NOT EXISTS idx_nr1_training_records_hotel_id ON nr1_training_records(hotel_id);
CREATE INDEX IF NOT EXISTS idx_nr1_training_records_employee_id ON nr1_training_records(employee_id);
