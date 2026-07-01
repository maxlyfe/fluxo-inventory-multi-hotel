-- ============================================================================
-- DOCUMENTOS & LICENÇAS: UPLOAD DE ARQUIVOS
-- ============================================================================
-- Permite anexar múltiplos arquivos (PDF, imagens, etc.) a cada documento
-- cadastrado em hotel_documents. Cria tabela de anexos e bucket de storage.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- 1. Tabela de arquivos anexados a um documento
CREATE TABLE IF NOT EXISTS hotel_document_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES hotel_documents(id) ON DELETE CASCADE,
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  file_size     BIGINT,
  content_type  TEXT,
  uploaded_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hotel_document_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hotel_document_files_select" ON hotel_document_files;
CREATE POLICY "hotel_document_files_select" ON hotel_document_files FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "hotel_document_files_insert" ON hotel_document_files;
CREATE POLICY "hotel_document_files_insert" ON hotel_document_files FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "hotel_document_files_delete" ON hotel_document_files;
CREATE POLICY "hotel_document_files_delete" ON hotel_document_files FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_hotel_document_files_document_id ON hotel_document_files(document_id);
CREATE INDEX IF NOT EXISTS idx_hotel_document_files_hotel_id    ON hotel_document_files(hotel_id);

-- 2. Bucket "hotel-documents" no Supabase Storage (público para leitura)
INSERT INTO storage.buckets (id, name, public)
VALUES ('hotel-documents', 'hotel-documents', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Policy: usuários autenticados podem enviar arquivos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'auth_upload_hotel_documents'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "auth_upload_hotel_documents"
        ON storage.objects
        FOR INSERT
        TO authenticated
        WITH CHECK (bucket_id = 'hotel-documents')
    $p$;
  END IF;
END $$;

-- 4. Policy: leitura pública dos arquivos (bucket público)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'public_read_hotel_documents'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "public_read_hotel_documents"
        ON storage.objects
        FOR SELECT
        TO public
        USING (bucket_id = 'hotel-documents')
    $p$;
  END IF;
END $$;

-- 5. Policy: usuários autenticados podem remover arquivos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'auth_delete_hotel_documents'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "auth_delete_hotel_documents"
        ON storage.objects
        FOR DELETE
        TO authenticated
        USING (bucket_id = 'hotel-documents')
    $p$;
  END IF;
END $$;

-- ============================================================================
