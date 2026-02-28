/*
  # Add Value Tracking to Hotel Transfers

  1. Changes
    - Add unit_value and total_value columns to hotel_transfers table
    - Add indexes for value-based queries
    - Update comments for documentation
*/

-- Add value tracking columns
ALTER TABLE hotel_transfers
ADD COLUMN IF NOT EXISTS unit_value decimal(10,2),
ADD COLUMN IF NOT EXISTS total_value decimal(10,2) GENERATED ALWAYS AS (quantity * unit_value) STORED;

-- Add index for value queries
CREATE INDEX IF NOT EXISTS idx_hotel_transfers_values
ON hotel_transfers(unit_value, total_value);

-- Add comments
COMMENT ON COLUMN hotel_transfers.unit_value IS 'Unit value of the product being transferred';
COMMENT ON COLUMN hotel_transfers.total_value IS 'Total value of the transfer (quantity * unit_value)';