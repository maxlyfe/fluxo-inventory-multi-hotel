-- ============================================================================
-- DOCUMENTOS DO COLABORADOR — contracheque digital com assinatura no Portal
-- ============================================================================
-- Cria o modulo de documentos do colaborador: tipos editaveis, documento por
-- colaborador, verbas linha a linha, bucket PRIVADO e RPC de assinatura.
--
-- POR QUE O PADRAO DA CASA NAO SERVE AQUI:
--   As tabelas de DP existentes usam RLS `USING (true)` e os buckets do projeto
--   sao todos `public = true` com policy `TO public`. Contracheque carrega
--   salario, verbas e CPF: com esse padrao qualquer autenticado da rede leria a
--   folha inteira, e qualquer pessoa com a URL leria o arquivo sem login.
--   Esta tabela nasce fechada por permissao, e o bucket e privado (URL assinada).
--
-- DEPENDE de 20260730120000_rls_helpers.sql (hotel_in_my_group, is_admin).
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard -> SQL Editor -> cole e rode.
-- ============================================================================

-- ── 0. Guarda de dependencia ────────────────────────────────────────────────
-- Corpo de funcao plpgsql nao e resolvido na criacao: sem esta guarda as
-- policies seriam criadas com sucesso e so falhariam no primeiro acesso real.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'hotel_in_my_group'
  ) THEN
    RAISE EXCEPTION 'Pre-requisito ausente: aplique supabase/migrations/20260730120000_rls_helpers.sql antes desta migration (funcao hotel_in_my_group nao existe).';
  END IF;
END $guard$;

-- ── 1. Matricula da folha em employees ──────────────────────────────────────
-- `employees` foi criada direto no SQL Editor e nao tem CREATE TABLE no repo:
-- toda coluna nova entra como ADD COLUMN IF NOT EXISTS.
--
-- Por que precisa existir: o contracheque identifica a pessoa por matricula +
-- nome (o layout da folha nao traz CPF). Sem a matricula sobra apenas o nome,
-- que erra em homonimo e em nome abreviado.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_code TEXT;
COMMENT ON COLUMN employees.payroll_code IS 'Matricula do colaborador no sistema de folha. Chave primaria de casamento do contracheque enviado em lote.';
CREATE INDEX IF NOT EXISTS idx_employees_payroll_code ON employees(payroll_code) WHERE payroll_code IS NOT NULL;

-- ── 2. Helper de RLS: has_permission ────────────────────────────────────────
-- Espelho no banco do `can()` de src/hooks/usePermissions.ts. Mesma ordem de
-- prioridade: dev/admin passam por is_admin(), o resto depende de
-- custom_roles.permissions.
--
-- `permissions` e JSONB (array de strings), nao text[] — por isso o operador de
-- containment `?` e nao `= ANY(...)`. Ver 20260802160000, que faz
-- `permissions ? 'finances'`.
CREATE OR REPLACE FUNCTION public.has_permission(pkey text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.custom_roles r ON r.id = p.custom_role_id
     WHERE p.id = auth.uid()
       AND r.permissions ? pkey
  );
$fn$;

GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;

-- ── 3. Tipos de documento (editaveis por admin, nada hardcoded) ─────────────
CREATE TABLE IF NOT EXISTS employee_document_types (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           UUID REFERENCES groups(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  requires_signature BOOLEAN NOT NULL DEFAULT true,
  visible_in_portal  BOOLEAN NOT NULL DEFAULT true,
  is_payslip         BOOLEAN NOT NULL DEFAULT false,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN employee_document_types.is_payslip IS 'Liga a leitura automatica de contracheque (parser de verbas) na tela de envio em lote.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_document_types_group_slug
  ON employee_document_types(group_id, slug);

ALTER TABLE employee_document_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_document_types_select ON employee_document_types;
CREATE POLICY employee_document_types_select ON employee_document_types
  FOR SELECT TO authenticated
  USING (group_id IS NULL OR group_id = (SELECT public.my_group_id()));

DROP POLICY IF EXISTS employee_document_types_write ON employee_document_types;
CREATE POLICY employee_document_types_write ON employee_document_types
  FOR ALL TO authenticated
  USING (group_id = (SELECT public.my_group_id()) AND (SELECT public.has_permission('personnel.doctypes.manage')))
  WITH CHECK (group_id = (SELECT public.my_group_id()) AND (SELECT public.has_permission('personnel.doctypes.manage')));

-- Seed: um tipo "Contracheque" por grupo existente
INSERT INTO employee_document_types (group_id, name, slug, requires_signature, visible_in_portal, is_payslip, sort_order)
SELECT g.id, 'Contracheque', 'contracheque', true, true, true, 0
  FROM groups g
 WHERE NOT EXISTS (
   SELECT 1 FROM employee_document_types t
    WHERE t.group_id = g.id AND t.slug = 'contracheque'
 );

-- ── 4. Documento do colaborador ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vinculo. hotel_id e a unidade do colaborador NO LYFE (chave de RLS), que
  -- pode divergir do CNPJ que emitiu o contracheque.
  employee_id        UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type_id        UUID NOT NULL REFERENCES employee_document_types(id) ON DELETE RESTRICT,
  hotel_id           UUID REFERENCES hotels(id) ON DELETE CASCADE,
  group_id           UUID REFERENCES groups(id) ON DELETE CASCADE,

  -- Competencia
  reference_month    DATE,
  period_start       DATE,
  period_end         DATE,

  -- Arquivo (caminho no bucket privado, NUNCA URL publica)
  file_path          TEXT NOT NULL,
  file_name          TEXT NOT NULL,
  file_size          BIGINT,
  content_type       TEXT,
  original_sha256    TEXT,

  -- Rastro do lote de origem. O arquivo do lote NAO e persistido: ele contem o
  -- salario de todos, e guardar so as paginas separadas elimina essa superficie.
  source_file_name   TEXT,
  source_page        INTEGER,
  parse_status       TEXT NOT NULL DEFAULT 'manual' CHECK (parse_status IN ('auto', 'manual')),
  parse_confidence   NUMERIC,

  -- Lido do proprio arquivo
  employer_cnpj      TEXT,
  employer_name      TEXT,
  payroll_code       TEXT,

  -- Totais e bases
  total_earnings     NUMERIC,
  total_deductions   NUMERIC,
  net_pay            NUMERIC,
  base_salary        NUMERIC,
  base_inss          NUMERIC,
  base_fgts          NUMERIC,
  fgts_month         NUMERIC,
  base_irrf          NUMERIC,
  irrf_bracket       TEXT,

  -- Assinatura
  requires_signature BOOLEAN NOT NULL DEFAULT true,
  signature_status   TEXT NOT NULL DEFAULT 'pending' CHECK (signature_status IN ('pending', 'signed')),
  signature_data     TEXT,
  signed_at          TIMESTAMPTZ,
  signed_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_user_agent  TEXT,
  signed_file_path   TEXT,

  -- Auditoria
  uploaded_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE employee_documents IS 'Documentos do colaborador (contracheque, ferias, advertencia...). Dado sensivel: RLS por permissao, nao USING(true), e arquivos em bucket privado.';
COMMENT ON COLUMN employee_documents.employer_cnpj IS 'CNPJ que emitiu o documento, lido do arquivo. Pode divergir da unidade do colaborador no LyFe — a tela de conciliacao mostra isso como informacao, nao como erro.';

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee   ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_hotel      ON employee_documents(hotel_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_group      ON employee_documents(group_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_competence ON employee_documents(employee_id, reference_month);
CREATE INDEX IF NOT EXISTS idx_employee_documents_signature  ON employee_documents(signature_status);

-- Duplicidade de lote tem que falhar visivelmente, nao empilhar em silencio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_documents_competence
  ON employee_documents(employee_id, doc_type_id, reference_month)
  WHERE reference_month IS NOT NULL;

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

-- SELECT: o proprio colaborador OU alguem do grupo COM a permissao de ver.
-- Predicado embrulhado em SELECT pela nota de perf do rls_helpers.sql.
DROP POLICY IF EXISTS employee_documents_select ON employee_documents;
CREATE POLICY employee_documents_select ON employee_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
       WHERE e.id = employee_documents.employee_id AND e.user_id = auth.uid()
    )
    OR (
      (SELECT public.hotel_in_my_group(employee_documents.hotel_id))
      AND (SELECT public.has_permission('personnel.payslips.view'))
    )
  );

DROP POLICY IF EXISTS employee_documents_insert ON employee_documents;
CREATE POLICY employee_documents_insert ON employee_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.hotel_in_my_group(hotel_id))
    AND (SELECT public.has_permission('personnel.payslips.upload'))
  );

DROP POLICY IF EXISTS employee_documents_delete ON employee_documents;
CREATE POLICY employee_documents_delete ON employee_documents
  FOR DELETE TO authenticated
  USING (
    (SELECT public.hotel_in_my_group(hotel_id))
    AND (SELECT public.has_permission('personnel.payslips.delete'))
  );

-- Sem policy de UPDATE de proposito: assinar passa pela RPC do item 6. Sem
-- UPDATE direto, ninguem adultera rubrica nem valor de verba pelo cliente.
DROP POLICY IF EXISTS employee_documents_update ON employee_documents;

-- ── 5. Verbas linha a linha ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_document_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES employee_documents(id) ON DELETE CASCADE,
  code        TEXT,
  description TEXT NOT NULL,
  reference   TEXT,
  earning     NUMERIC,
  deduction   NUMERIC,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN employee_document_lines.reference IS 'Coluna "Referencia" do contracheque, texto cru (ex. "220:00", "8,97") — nao e numero em todos os casos.';

CREATE INDEX IF NOT EXISTS idx_employee_document_lines_document ON employee_document_lines(document_id, sort_order);

ALTER TABLE employee_document_lines ENABLE ROW LEVEL SECURITY;

-- Herda o acesso do documento pai: uma unica fonte de verdade para a regra.
-- O EXISTS ja passa pela RLS de employee_documents, entao quem nao ve o
-- documento tambem nao ve as verbas.
DROP POLICY IF EXISTS employee_document_lines_select ON employee_document_lines;
CREATE POLICY employee_document_lines_select ON employee_document_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employee_documents d WHERE d.id = employee_document_lines.document_id));

DROP POLICY IF EXISTS employee_document_lines_insert ON employee_document_lines;
CREATE POLICY employee_document_lines_insert ON employee_document_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employee_documents d
       WHERE d.id = document_id
         AND (SELECT public.hotel_in_my_group(d.hotel_id))
         AND (SELECT public.has_permission('personnel.payslips.upload'))
    )
  );

DROP POLICY IF EXISTS employee_document_lines_delete ON employee_document_lines;
CREATE POLICY employee_document_lines_delete ON employee_document_lines
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_documents d
       WHERE d.id = employee_document_lines.document_id
         AND (SELECT public.hotel_in_my_group(d.hotel_id))
         AND (SELECT public.has_permission('personnel.payslips.delete'))
    )
  );

-- ── 6. RPC de assinatura (unico caminho de escrita da rubrica) ──────────────
-- Mesma postura de wci_finalize_ficha: SECURITY DEFINER, dono resolvido no
-- banco, e idempotente — reassinar nao sobrescreve a assinatura existente.
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
    -- Mesma mensagem para "nao existe" e "nao e seu": nao vaza a existencia
    -- do documento de outra pessoa.
    RAISE EXCEPTION 'Documento nao encontrado para este colaborador.';
  END IF;

  IF v_doc.signature_status = 'signed' THEN
    RETURN v_doc;  -- idempotente: ja assinado, devolve como esta
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

-- ── 7. Bucket PRIVADO ───────────────────────────────────────────────────────
-- Primeiro bucket privado do projeto. Leitura sempre por createSignedUrl.
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-documents', 'employee-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- A propria linha da tabela e a autoridade sobre quem le o arquivo: nao ha
-- regra duplicada entre o caminho do objeto e a permissao.
DROP POLICY IF EXISTS employee_documents_storage_select ON storage.objects;
CREATE POLICY employee_documents_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND EXISTS (
      SELECT 1 FROM public.employee_documents d
       WHERE storage.objects.name IN (d.file_path, d.signed_file_path)
         AND (
           EXISTS (
             SELECT 1 FROM public.employees e
              WHERE e.id = d.employee_id AND e.user_id = auth.uid()
           )
           OR (
             (SELECT public.hotel_in_my_group(d.hotel_id))
             AND (SELECT public.has_permission('personnel.payslips.view'))
           )
         )
    )
  );

-- INSERT: a linha em employee_documents e gravada ANTES do upload, senao esta
-- policy nao acha o dono do caminho. O colaborador tambem insere, porque e ele
-- quem sobe o PDF assinado.
DROP POLICY IF EXISTS employee_documents_storage_insert ON storage.objects;
CREATE POLICY employee_documents_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'employee-documents'
    AND EXISTS (
      SELECT 1 FROM public.employee_documents d
       WHERE storage.objects.name IN (d.file_path, d.signed_file_path)
         AND (
           EXISTS (
             SELECT 1 FROM public.employees e
              WHERE e.id = d.employee_id AND e.user_id = auth.uid()
           )
           OR (
             (SELECT public.hotel_in_my_group(d.hotel_id))
             AND (SELECT public.has_permission('personnel.payslips.upload'))
           )
         )
    )
  );

DROP POLICY IF EXISTS employee_documents_storage_delete ON storage.objects;
CREATE POLICY employee_documents_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND (SELECT public.has_permission('personnel.payslips.delete'))
  );

-- ============================================================================
-- CONFERENCIA (um SELECT consolidado — o SQL Editor mostra so o ultimo)
-- ============================================================================
SELECT 'bucket privado' AS verificacao,
       CASE WHEN public IS FALSE THEN 'OK' ELSE 'FALHA' END AS status,
       id AS detalhe
  FROM storage.buckets WHERE id = 'employee-documents'
UNION ALL
SELECT 'policies employee_documents', CASE WHEN count(*) = 3 THEN 'OK' ELSE 'FALHA' END, count(*)::text
  FROM pg_policies WHERE tablename = 'employee_documents'
UNION ALL
SELECT 'policies storage.objects', CASE WHEN count(*) = 3 THEN 'OK' ELSE 'FALHA' END, count(*)::text
  FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'employee_documents_storage%'
UNION ALL
SELECT 'tipo contracheque por grupo', CASE WHEN count(*) = (SELECT count(*) FROM groups) THEN 'OK' ELSE 'CONFERIR' END, count(*)::text
  FROM employee_document_types WHERE slug = 'contracheque'
UNION ALL
SELECT 'employees.payroll_code', CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALHA' END, count(*)::text
  FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'payroll_code';
