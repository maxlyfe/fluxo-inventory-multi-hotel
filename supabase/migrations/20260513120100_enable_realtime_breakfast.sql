-- Enable Realtime for the breakfast_records table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'breakfast_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE breakfast_records;
  END IF;
END $$;

-- Also for breakfast_configs just in case
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'breakfast_configs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE breakfast_configs;
  END IF;
END $$;
