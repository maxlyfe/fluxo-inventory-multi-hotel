-- Add LGPD consent fields to candidates
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS terms_accepted     boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_accepted_at  timestamptz;
