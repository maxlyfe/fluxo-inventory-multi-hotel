-- ============================================================================
-- DOCUMENTOS DO COLABORADOR: registro de visualizacao
-- ============================================================================
-- Registra que o colaborador ABRIU o documento, mesmo sem assinar. Nao
-- substitui a assinatura: separa dois estados que antes eram um so ("pendente")
-- e que pedem cobranca diferente do DP --
--
--   nao viu           -> cobrar que abra (talvez nem saiba que existe)
--   viu e nao assinou -> cobrar a assinatura (ou entender a recusa)
--
-- Duas camadas, mesmo desenho de `employee_documents` + `employee_document_lines`:
--   * agregado na propria linha do documento, para o indicador da lista do DP
--     ser uma consulta sem join e entrar no realtime que ja existe na tabela;
--   * `employee_document_views`, uma linha por evento, para o historico com
--     data, hora e dispositivo.
--
-- DEPENDE de 20260909120000_employee_documents.sql e 20260909130000.
--
-- ============================================================================
-- ATENCAO: RODE UMA PARTE POR VEZ. NAO COLE O ARQUIVO INTEIRO.
-- ============================================================================
-- Motivo, aprendido na marra em 10/09/2026: a primeira tentativa colou tudo de
-- uma vez e morreu com `ERROR 40P01: deadlock detected`.
--
-- `employee_documents` esta na publicacao `supabase_realtime` desde a migration
-- 20260909130000, e o worker de replicacao le a tabela e o catalogo dela sem
-- parar. O SQL Editor envolve o script inteiro numa transacao unica, entao o
-- `ALTER TABLE` da parte 1 segurava AccessExclusiveLock na tabela durante TODO
-- o resto do script -- o CREATE TABLE com a FK, as policies e as duas funcoes.
-- Nessa janela de segundos, o worker pediu um lock compartilhado na tabela
-- enquanto segurava um lock de catalogo que o nosso DDL precisava: deadlock.
--
-- Rodando parte por parte, o lock na tabela publicada dura milissegundos. Cada
-- parte abre com `lock_timeout` proprio: se ainda houver contencao, ela FALHA
-- RAPIDO com mensagem clara em vez de travar a espera ate o deadlock.
--
-- Tudo aqui e IDEMPOTENTE: se a tentativa anterior aplicou algo antes de
-- abortar, rodar de novo nao quebra nada. Comece pela PARTE 0 para saber o
-- estado atual.
-- ============================================================================


-- ============================================================================
-- PARTE 0 -- Diagnostico. Rode isto primeiro, sozinho. Nao altera nada.
-- ============================================================================
-- Diz o que ja existe e o que falta. Se todas as linhas vierem 'OK', a
-- migration ja esta aplicada e nao ha nada a fazer.
/*
SELECT 'pre-requisito: employee_documents' AS item,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALTA 20260909120000' END AS status
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'employee_documents'
UNION ALL
SELECT 'parte 1: colunas de visualizacao',
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'FALTA (' || count(*) || ' de 3)' END
  FROM information_schema.columns
 WHERE table_name = 'employee_documents'
   AND column_name IN ('first_viewed_at', 'last_viewed_at', 'view_count')
UNION ALL
SELECT 'parte 2: indice do indicador',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALTA' END
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'idx_employee_documents_pending_view'
UNION ALL
SELECT 'parte 3: tabela de historico',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALTA' END
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'employee_document_views'
UNION ALL
SELECT 'parte 3: policy de leitura (e so ela)',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CONFERIR (' || count(*) || ')' END
  FROM pg_policies WHERE tablename = 'employee_document_views'
UNION ALL
SELECT 'parte 4: rpc de visualizacao',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALTA' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'register_employee_document_view'
UNION ALL
SELECT 'parte 5: assinar marca visualizacao',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FALTA' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'sign_employee_document'
   AND pg_get_functiondef(p.oid) LIKE '%first_viewed_at%'
UNION ALL
SELECT 'contexto: quem esta segurando lock agora',
       CASE WHEN count(*) = 0 THEN 'nenhum (bom momento para rodar)'
            ELSE count(*) || ' consulta(s) ativa(s) na tabela' END
  FROM pg_locks l
  JOIN pg_stat_activity a ON a.pid = l.pid
 WHERE l.relation = 'public.employee_documents'::regclass
   AND a.pid <> pg_backend_pid();
*/


-- ============================================================================
-- PARTE 1 -- Agregado no documento. Rode sozinho.
-- ============================================================================
-- E a unica parte que pega AccessExclusiveLock na tabela publicada. Sozinha,
-- dura milissegundos.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS last_viewed_at  TIMESTAMPTZ;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS view_count      INTEGER NOT NULL DEFAULT 0;

COMMIT;

COMMENT ON COLUMN employee_documents.first_viewed_at IS 'Primeira vez que o colaborador abriu o documento. NULL = nunca abriu.';
COMMENT ON COLUMN employee_documents.last_viewed_at IS 'Ultima abertura. Avanca mesmo dentro da janela de deduplicacao.';
COMMENT ON COLUMN employee_documents.view_count IS 'Sessoes de visualizacao distintas (janela de 30 min), nao aberturas de tela.';


-- ============================================================================
-- PARTE 2 -- Indice do indicador. Rode sozinho.
-- ============================================================================
-- Indice parcial: a consulta do indicador filtra por pendencia e le a coluna de
-- visualizacao. Sem ele, a lista de colaboradores faz seq scan a cada evento de
-- realtime.
--
-- Nao usa CONCURRENTLY porque a tabela e pequena e CONCURRENTLY nao roda dentro
-- de transacao. Se algum dia a tabela crescer, troque por CONCURRENTLY e rode
-- FORA de BEGIN/COMMIT.
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_employee_documents_pending_view
  ON employee_documents(employee_id, first_viewed_at)
  WHERE requires_signature = true AND signature_status = 'pending';

COMMIT;


-- ============================================================================
-- PARTE 3 -- Historico de visualizacoes. Rode sozinho.
-- ============================================================================
-- A FK para `employee_documents` pega ShareRowExclusiveLock, mais leve que o
-- AccessExclusive da parte 1, mas ainda vale rodar isolado.
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee_document_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES employee_documents(id) ON DELETE CASCADE,
  -- Quem abriu. E sempre o proprio colaborador (a RPC recusa outro), mas fica
  -- gravado porque `employees.user_id` pode mudar de conta depois.
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- User agent cru. A leitura humana ("Android . Chrome") e derivada no front:
  -- guardar o texto original preserva a auditoria se a heuristica de leitura
  -- mudar depois.
  user_agent  TEXT,
  -- Onde a pessoa estava quando abriu: no Portal, ou baixando o arquivo.
  source      TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'download', 'signature')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_document_views_document
  ON employee_document_views(document_id, viewed_at DESC);

ALTER TABLE employee_document_views ENABLE ROW LEVEL SECURITY;

-- Herda o acesso do documento pai, como `employee_document_lines`: o EXISTS
-- passa pela RLS de `employee_documents`, entao quem nao ve o documento nao ve
-- quando ele foi aberto.
DROP POLICY IF EXISTS employee_document_views_select ON employee_document_views;
CREATE POLICY employee_document_views_select ON employee_document_views
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employee_documents d WHERE d.id = employee_document_views.document_id));

-- Sem policy de INSERT/UPDATE/DELETE de proposito: registrar visualizacao passa
-- pela RPC da parte 4. Se o cliente pudesse inserir aqui, o registro de "o
-- colaborador viu" viraria algo que qualquer um forja -- e o valor dele e
-- justamente ser um fato do servidor.

COMMIT;

COMMENT ON TABLE employee_document_views IS 'Uma linha por sessao de visualizacao do documento pelo colaborador. Complementa, nao substitui, a assinatura.';


-- ============================================================================
-- PARTE 4 -- RPC de registro. Rode sozinho.
-- ============================================================================
-- Nao pega lock de tabela (so cria funcao), mas fica separada para o arquivo
-- ter uma parte por passo.
CREATE OR REPLACE FUNCTION public.register_employee_document_view(
  p_document_id UUID,
  p_user_agent  TEXT DEFAULT NULL,
  p_source      TEXT DEFAULT 'portal'
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  -- Janela de deduplicacao. Sem ela, abrir e fechar o modal tres vezes viraria
  -- tres linhas e o historico deixaria de dizer algo.
  v_window  CONSTANT INTERVAL := INTERVAL '30 minutes';
  v_doc_id  UUID;
  v_last    TIMESTAMPTZ;
  v_now     TIMESTAMPTZ := now();
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('portal', 'download', 'signature') THEN
    p_source := 'portal';
  END IF;

  -- O dono e resolvido no banco. Registrar visualizacao em nome de outra
  -- pessoa seria pior que nao registrar nada: o DP cobraria a assinatura de
  -- quem, segundo o sistema, ja teria visto.
  SELECT d.id INTO v_doc_id
    FROM public.employee_documents d
    JOIN public.employees e ON e.id = d.employee_id
   WHERE d.id = p_document_id
     AND e.user_id = auth.uid()
   FOR UPDATE OF d;

  IF v_doc_id IS NULL THEN
    -- Mesma mensagem de `sign_employee_document`: nao vaza a existencia do
    -- documento de outra pessoa.
    RAISE EXCEPTION 'Documento nao encontrado para este colaborador.';
  END IF;

  SELECT max(v.viewed_at) INTO v_last
    FROM public.employee_document_views v
   WHERE v.document_id = v_doc_id
     AND v.user_id = auth.uid();

  IF v_last IS NULL OR v_now - v_last > v_window THEN
    INSERT INTO public.employee_document_views (document_id, user_id, user_agent, source)
    VALUES (v_doc_id, auth.uid(), left(coalesce(p_user_agent, ''), 400), p_source);

    UPDATE public.employee_documents
       SET first_viewed_at = COALESCE(first_viewed_at, v_now),
           last_viewed_at  = v_now,
           view_count      = view_count + 1,
           updated_at      = v_now
     WHERE id = v_doc_id;
  ELSE
    -- Mesma sessao: nao cria linha nova, so move o "visto por ultimo".
    UPDATE public.employee_documents
       SET last_viewed_at = v_now,
           updated_at     = v_now
     WHERE id = v_doc_id;
  END IF;

  RETURN v_now;
END $fn$;

GRANT EXECUTE ON FUNCTION public.register_employee_document_view(UUID, TEXT, TEXT) TO authenticated;


-- ============================================================================
-- PARTE 5 -- Assinar implica ter visto. Rode sozinho.
-- ============================================================================
-- Recriada por dois motivos: `RETURNS employee_documents` precisa reconhecer as
-- colunas novas da parte 1, e assinar sem registro de visualizacao seria
-- incoerente -- se a pessoa assinou, ela viu. Cobre o caso de a imagem falhar
-- ao carregar no modal e o registro de visualizacao nao ter saido.
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
    RETURN v_doc;  -- idempotente: ja assinado, devolve como esta
  END IF;

  UPDATE public.employee_documents
     SET signature_status  = 'signed',
         signature_data    = p_signature,
         signed_file_path  = COALESCE(p_signed_file_path, signed_file_path),
         signed_user_agent = p_user_agent,
         signed_at         = now(),
         signed_by         = auth.uid(),
         -- Quem assina, viu.
         first_viewed_at   = COALESCE(first_viewed_at, now()),
         last_viewed_at    = now(),
         updated_at        = now()
   WHERE id = p_document_id
  RETURNING * INTO v_doc;

  RETURN v_doc;
END $fn$;

GRANT EXECUTE ON FUNCTION public.sign_employee_document(UUID, TEXT, TEXT, TEXT) TO authenticated;


-- ============================================================================
-- Realtime: nada a fazer aqui.
-- ============================================================================
-- `employee_documents` ja esta na publicacao desde 20260909130000, e o
-- indicador de visualizacao le o agregado dela -- entao o olho abre na tela do
-- DP no instante em que o colaborador abre o documento, sem nada a mais.
-- O historico detalhado nao precisa de realtime: e consultado sob demanda.
--
-- ============================================================================
-- CONFERENCIA FINAL: rode a PARTE 0 de novo. Tudo deve vir 'OK'.
-- ============================================================================
