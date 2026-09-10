-- ============================================================================
-- DOCUMENTOS DO COLABORADOR: onde estampar a assinatura no proprio documento
-- ============================================================================
-- A assinatura passa a ser estampada NA linha "ASSINATURA DO FUNCIONARIO" do
-- proprio contracheque, em vez de numa folha adicional no fim do PDF.
--
-- A posicao e descoberta na LEITURA do arquivo (o parser acha o rotulo pelas
-- coordenadas, como ja faz com as colunas de vencimentos) e precisa ser
-- guardada, porque quem assina e o colaborador, depois, no Portal — e naquele
-- momento so existe o JPEG da pagina, sem camada de texto para consultar.
--
-- Normalizada (0 a 1 da pagina), nao em pixel: o PDF final e A4 e o documento
-- original nao necessariamente e. Fracao da pagina sobrevive a qualquer escala.
--
-- DEPENDE de 20260909120000_employee_documents.sql.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard -> SQL Editor -> cole e rode.
-- ============================================================================

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'employee_documents'
  ) THEN
    RAISE EXCEPTION 'Pre-requisito ausente: aplique supabase/migrations/20260909120000_employee_documents.sql antes desta migration.';
  END IF;
END $guard$;

ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS signature_anchor_x NUMERIC;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS signature_anchor_y NUMERIC;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS date_anchor_x NUMERIC;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS date_anchor_y NUMERIC;

COMMENT ON COLUMN employee_documents.signature_anchor_x IS 'Centro horizontal da linha de assinatura, 0 a 1 da largura da pagina. NULL = layout nao reconhecido; a rubrica vai num bloco ao pe da pagina.';
COMMENT ON COLUMN employee_documents.signature_anchor_y IS 'Linha de base do rotulo de assinatura, 0 (topo) a 1 (rodape).';
COMMENT ON COLUMN employee_documents.date_anchor_x IS 'Centro horizontal do campo DATA do recibo, quando o layout tem um.';

-- Guarda de faixa: uma ancora fora de [0,1] estamparia a assinatura fora da
-- pagina, e o erro apareceria so no PDF gerado — depois de o colaborador ter
-- assinado. Melhor recusar na escrita.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_employee_documents_anchor_range'
  ) THEN
    ALTER TABLE employee_documents ADD CONSTRAINT chk_employee_documents_anchor_range
      CHECK (
        (signature_anchor_x IS NULL OR (signature_anchor_x >= 0 AND signature_anchor_x <= 1))
        AND (signature_anchor_y IS NULL OR (signature_anchor_y >= 0 AND signature_anchor_y <= 1))
        AND (date_anchor_x IS NULL OR (date_anchor_x >= 0 AND date_anchor_x <= 1))
        AND (date_anchor_y IS NULL OR (date_anchor_y >= 0 AND date_anchor_y <= 1))
      );
  END IF;
END $$;

-- A RPC de assinatura devolve `employee_documents` inteiro (RETURNS
-- employee_documents), entao ela precisa ser recriada para o tipo de retorno
-- passar a enxergar as colunas novas. Corpo identico ao de 20260909120000.
CREATE OR REPLACE FUNCTION public.sign_employee_document(
  p_document_id      UUID,
  p_signature        TEXT,
  p_signed_file_path TEXT DEFAULT NULL,
  p_user_agent       TEXT DEFAULT NULL
)
RETURNS public.employee_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_doc public.employee_documents;
BEGIN
  IF p_signature IS NULL OR length(btrim(p_signature)) = 0 THEN
    RAISE EXCEPTION 'Assinatura vazia.';
  END IF;

  SELECT d.* INTO v_doc
    FROM public.employee_documents d
    JOIN public.employees e ON e.id = d.employee_id
   WHERE d.id = p_document_id
     AND e.user_id = auth.uid()
   FOR UPDATE OF d;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Documento nao encontrado para este colaborador.';
  END IF;

  IF v_doc.signature_status = 'signed' THEN
    RETURN v_doc;
  END IF;

  UPDATE public.employee_documents
     SET signature_status  = 'signed',
         signature_data    = p_signature,
         signed_file_path  = COALESCE(p_signed_file_path, signed_file_path),
         signed_user_agent = p_user_agent,
         signed_at         = now(),
         signed_by         = auth.uid(),
         updated_at        = now()
   WHERE id = p_document_id
  RETURNING * INTO v_doc;

  RETURN v_doc;
END $fn$;

GRANT EXECUTE ON FUNCTION public.sign_employee_document(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- CONFERENCIA (um SELECT consolidado — o SQL Editor mostra so o ultimo)
-- ============================================================================
SELECT 'colunas de ancora' AS verificacao,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'FALHA' END AS status,
       count(*)::text AS detalhe
  FROM information_schema.columns
 WHERE table_name = 'employee_documents'
   AND column_name IN ('signature_anchor_x', 'signature_anchor_y', 'date_anchor_x', 'date_anchor_y')
UNION ALL
SELECT 'check de faixa 0..1',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALHA' END,
       count(*)::text
  FROM pg_constraint WHERE conname = 'chk_employee_documents_anchor_range'
UNION ALL
SELECT 'rpc de assinatura',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALHA' END,
       count(*)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'sign_employee_document';
