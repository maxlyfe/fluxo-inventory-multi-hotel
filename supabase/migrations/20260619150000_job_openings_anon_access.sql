-- ============================================================================
-- VAGAS: ACESSO ANÔNIMO PARA PÁGINA PÚBLICA DE CANDIDATURA
-- ============================================================================
-- A página /jobs/:token é pública (sem login). O Supabase client envia a
-- requisição como role "anon", que precisa de uma policy de SELECT para
-- conseguir ler a vaga pelo public_token.
--
-- Também libera INSERT em "candidates" para anon, permitindo a inscrição.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- SELECT em job_openings: anon pode ler vagas pelo public_token
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'job_openings' AND policyname = 'anon_read_by_token'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "anon_read_by_token"
        ON job_openings
        FOR SELECT
        TO anon
        USING (true)
    $p$;
  END IF;
END $$;

-- SELECT em hotels: anon precisa ler o nome do hotel (join na query)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hotels' AND policyname = 'anon_read_hotels'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "anon_read_hotels"
        ON hotels
        FOR SELECT
        TO anon
        USING (is_active = true)
    $p$;
  END IF;
END $$;

-- INSERT em candidates: anon pode se candidatar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'candidates' AND policyname = 'anon_insert_candidate'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "anon_insert_candidate"
        ON candidates
        FOR INSERT
        TO anon
        WITH CHECK (true)
    $p$;
  END IF;
END $$;

-- ============================================================================
