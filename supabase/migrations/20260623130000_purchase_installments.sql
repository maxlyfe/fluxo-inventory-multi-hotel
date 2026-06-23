-- Add installment fields to purchases
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS is_installment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS installment_count integer;

-- Create purchase_installments table
CREATE TABLE IF NOT EXISTS purchase_installments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id        uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  installment_number integer NOT NULL,
  due_date           date,
  amount             decimal(10,2) NOT NULL,
  is_paid            boolean NOT NULL DEFAULT false,
  paid_at            timestamptz,
  notes              text,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_installments_purchase ON purchase_installments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_installments_due      ON purchase_installments(due_date);
CREATE INDEX IF NOT EXISTS idx_purchase_installments_paid     ON purchase_installments(is_paid);

ALTER TABLE purchase_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchase_installments_all_authenticated"
  ON purchase_installments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
