/*
  # Update timestamps and status tracking

  1. Changes
    - Add trigger to automatically update updated_at timestamp
    - Add index on status column for faster filtering
    - Add index on sector_id and status for faster sector-specific queries
    - Add index on updated_at for faster sorting

  2. Security
    - No changes to RLS policies needed
*/

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for requisitions table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_requisitions_updated_at'
  ) THEN
    CREATE TRIGGER update_requisitions_updated_at
      BEFORE UPDATE ON requisitions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Add indexes for better performance
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'requisitions' AND indexname = 'idx_requisitions_status'
  ) THEN
    CREATE INDEX idx_requisitions_status ON requisitions(status);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'requisitions' AND indexname = 'idx_requisitions_sector_status'
  ) THEN
    CREATE INDEX idx_requisitions_sector_status ON requisitions(sector_id, status);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'requisitions' AND indexname = 'idx_requisitions_updated_at'
  ) THEN
    CREATE INDEX idx_requisitions_updated_at ON requisitions(updated_at DESC);
  END IF;
END $$;