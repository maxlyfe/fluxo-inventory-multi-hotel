-- Migration: Create employee_dismissals table
-- Date: 2026-06-19

CREATE TABLE employee_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  dismissal_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('voluntary', 'involuntary')),
  voluntary_reasons TEXT[] DEFAULT '{}',
  involuntary_type TEXT CHECK (involuntary_type IN ('justa_causa', 'sem_justa_causa')),
  involuntary_reason TEXT,
  notes TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE employee_dismissals ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
CREATE POLICY "read" ON employee_dismissals FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert" ON employee_dismissals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update" ON employee_dismissals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete" ON employee_dismissals FOR DELETE TO authenticated USING (true);

-- Criar índices
CREATE INDEX idx_employee_dismissals_hotel_id ON employee_dismissals(hotel_id);
CREATE INDEX idx_employee_dismissals_employee_id ON employee_dismissals(employee_id);
