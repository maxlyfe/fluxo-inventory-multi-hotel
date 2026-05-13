-- Adjust breakfast_records to support string IDs for Day Use
-- and ensure columns like adults have defaults to avoid 400 errors

ALTER TABLE public.breakfast_records 
  ALTER COLUMN id_guest TYPE TEXT,
  ALTER COLUMN adults SET DEFAULT 1,
  ALTER COLUMN children SET DEFAULT 0;

-- Update types if they were integer in previous migration
-- (Supabase might need a cast if there's data, but for new tables it's fine)
-- If data exists: 
-- ALTER TABLE public.breakfast_records ALTER COLUMN id_guest TYPE TEXT USING id_guest::text;

COMMENT ON COLUMN public.breakfast_records.id_guest IS 'Supports integer IDs from Erbon and string IDs (DU-...) for visitors';
