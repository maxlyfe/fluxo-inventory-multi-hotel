-- ============================================================================
-- CANDIDATOS: SUPORTE A UPLOAD DE CURRÍCULO
-- ============================================================================
-- Adiciona campo resume_url à tabela candidates e cria bucket de storage
-- para armazenamento de PDFs e imagens enviadas pelo candidato.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- 1. Coluna resume_url na tabela candidates
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_url TEXT;

-- 2. Bucket "candidates" no Supabase Storage (público para leitura)
INSERT INTO storage.buckets (id, name, public)
VALUES ('candidates', 'candidates', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Policy: anon pode fazer upload (para o formulário público /jobs/:token)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'anon_upload_candidate_files'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "anon_upload_candidate_files"
        ON storage.objects
        FOR INSERT
        TO anon
        WITH CHECK (bucket_id = 'candidates')
    $p$;
  END IF;
END $$;

-- 4. Policy: qualquer um pode ler arquivos do bucket candidates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'public_read_candidate_files'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "public_read_candidate_files"
        ON storage.objects
        FOR SELECT
        TO public
        USING (bucket_id = 'candidates')
    $p$;
  END IF;
END $$;

-- 5. Policy: authenticated pode deletar arquivos (gestão pelo RH)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'auth_delete_candidate_files'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "auth_delete_candidate_files"
        ON storage.objects
        FOR DELETE
        TO authenticated
        USING (bucket_id = 'candidates')
    $p$;
  END IF;
END $$;

-- ============================================================================
