-- ============================================================================
-- TESTE DE ISOLAMENTO DA RLS DE `employee_documents` (contracheques)
-- ============================================================================
-- ONDE RODAR: Supabase Dashboard -> SQL Editor.
-- COMO RODAR: uma PARTE por vez. O editor mostra so o resultado do ultimo
--             statement, e as partes de impersonacao precisam de transacao.
--
-- ============================================================================
-- POR QUE ESTE SCRIPT EXISTE (leia antes de confiar em qualquer resultado)
-- ============================================================================
-- O SQL Editor conecta como `postgres`, que e superusuario e **ignora RLS por
-- completo**. Rodar `select count(*) from employee_documents` ali devolve TODAS
-- as linhas da rede, com a RLS perfeita ou sem nenhuma RLS. E o teste que
-- parece passar sempre e nao prova nada.
--
-- Para testar de verdade e preciso IMPERSONAR: assumir o papel `authenticated`
-- e injetar o `sub` (o uuid do usuario) nas claims do JWT, que e de onde
-- `auth.uid()` le. Sem os dois, as policies nao se aplicam.
--
-- `SET LOCAL` so vale dentro de transacao, e por isso cada teste vem embrulhado
-- em BEGIN/ROLLBACK. O ROLLBACK e deliberado: nenhum teste aqui deve deixar
-- rastro, nem quando escreve.
--
-- Esta tabela guarda salario, verbas e CPF. Vale a pena conferir de verdade.
-- ============================================================================


-- ============================================================================
-- PARTE 1 -- Escolher as cobaias. Rode sozinho e anote os uuids.
-- ============================================================================
-- Precisamos de:
--   (a) um COLABORADOR com conta vinculada e documento proprio;
--   (b) um usuario de OUTRO GRUPO, para o teste cross-tenant.
/*
-- (a) colaboradores com conta vinculada e documento
SELECT e.user_id                AS uuid_para_impersonar,
       e.name                   AS colaborador,
       h.name                   AS unidade,
       g.name                   AS grupo,
       count(d.id)              AS documentos
  FROM employees e
  JOIN employee_documents d ON d.employee_id = e.id
  LEFT JOIN hotels h ON h.id = e.hotel_id
  LEFT JOIN groups g ON g.id = h.group_id
 WHERE e.user_id IS NOT NULL
 GROUP BY e.user_id, e.name, h.name, g.name
 ORDER BY documentos DESC
 LIMIT 10;
*/

/*
-- (b) um usuario por grupo, para achar alguem de fora
SELECT p.id AS uuid_para_impersonar, p.full_name, g.name AS grupo, p.role
  FROM profiles p
  LEFT JOIN groups g ON g.id = p.group_id
 ORDER BY g.name, p.full_name
 LIMIT 30;
*/

/*
-- (c) total real de documentos, visto como postgres (a referencia de comparacao)
SELECT count(*) AS total_na_rede FROM employee_documents;
*/


-- ============================================================================
-- PARTE 2 -- O colaborador ve SO os documentos dele.
-- ============================================================================
-- Troque <UUID_COLABORADOR> pelo uuid da consulta (a) da parte 1.
-- ESPERADO: `visiveis` = `proprios`, e `de_outros` = 0.
/*
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<UUID_COLABORADOR>","role":"authenticated"}';

  SELECT 'auth.uid() resolveu'            AS verificacao,
         CASE WHEN auth.uid() IS NOT NULL THEN 'OK' ELSE 'FALHA: claims nao aplicadas' END AS status,
         coalesce(auth.uid()::text, '(nulo)') AS detalhe
  UNION ALL
  SELECT 'documentos visiveis',
         'informativo',
         count(*)::text
    FROM employee_documents
  UNION ALL
  SELECT 'documentos proprios',
         'informativo',
         count(*)::text
    FROM employee_documents d
   WHERE d.employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  UNION ALL
  SELECT 'documentos DE OUTROS visiveis',
         CASE WHEN count(*) = 0 THEN 'OK' ELSE 'VAZAMENTO' END,
         count(*)::text
    FROM employee_documents d
   WHERE d.employee_id NOT IN (SELECT id FROM employees WHERE user_id = auth.uid())
  UNION ALL
  SELECT 'verbas de outros visiveis',
         CASE WHEN count(*) = 0 THEN 'OK' ELSE 'VAZAMENTO' END,
         count(*)::text
    FROM employee_document_lines l
   WHERE l.document_id NOT IN (
     SELECT d.id FROM employee_documents d
      WHERE d.employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
   );
ROLLBACK;
*/


-- ============================================================================
-- PARTE 3 -- O colaborador nao consegue ESCREVER.
-- ============================================================================
-- `employee_documents` nasceu sem policy de UPDATE de proposito: assinar passa
-- pela RPC. Se algum UPDATE aqui afetar linha, alguem pode adulterar o proprio
-- valor de verba pelo cliente.
-- ESPERADO: todos 'OK'. Rodando em transacao com ROLLBACK, nada persiste
-- mesmo se algo passar.
/*
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<UUID_COLABORADOR>","role":"authenticated"}';

  CREATE TEMP TABLE _r(verificacao text, status text, detalhe text) ON COMMIT DROP;

  -- UPDATE no proprio documento (adulterar o liquido)
  WITH x AS (UPDATE employee_documents SET net_pay = 1 WHERE true RETURNING 1)
  INSERT INTO _r SELECT 'UPDATE em employee_documents',
                        CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FALHA: escreveu' END,
                        count(*)::text FROM x;

  -- INSERT de visualizacao forjada (dizer que viu sem ter visto)
  BEGIN
    INSERT INTO employee_document_views (document_id, user_id, source)
    SELECT d.id, auth.uid(), 'portal' FROM employee_documents d LIMIT 1;
    INSERT INTO _r VALUES ('INSERT em employee_document_views', 'FALHA: escreveu', 'inseriu');
  EXCEPTION WHEN insufficient_privilege OR others THEN
    INSERT INTO _r VALUES ('INSERT em employee_document_views', 'OK', SQLERRM);
  END;

  -- DELETE do proprio documento (apagar o contracheque)
  WITH x AS (DELETE FROM employee_documents WHERE true RETURNING 1)
  INSERT INTO _r SELECT 'DELETE em employee_documents',
                        CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FALHA: apagou' END,
                        count(*)::text FROM x;

  SELECT * FROM _r;
ROLLBACK;
*/


-- ============================================================================
-- PARTE 4 -- Usuario de OUTRO GRUPO nao ve nada.
-- ============================================================================
-- Troque <UUID_OUTRO_GRUPO> por alguem da consulta (b) cujo grupo NAO seja o
-- dos documentos. Evite conta `dev` ou `admin`: as duas passam por `is_admin()`
-- de propósito e veriam tudo — o teste ficaria sem sentido.
-- ESPERADO: 0 documentos visiveis.
/*
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<UUID_OUTRO_GRUPO>","role":"authenticated"}';

  SELECT 'grupo do usuario impersonado' AS verificacao,
         'informativo'                  AS status,
         coalesce(my_group_id()::text, '(nulo)') AS detalhe
  UNION ALL
  SELECT 'e admin/dev? (invalida o teste)',
         CASE WHEN is_admin() THEN 'ESCOLHA OUTRO USUARIO' ELSE 'OK' END,
         is_admin()::text
  UNION ALL
  SELECT 'documentos visiveis',
         CASE WHEN count(*) = 0 THEN 'OK' ELSE 'VAZAMENTO CROSS-TENANT' END,
         count(*)::text
    FROM employee_documents;
ROLLBACK;
*/


-- ============================================================================
-- PARTE 5 -- Sem a permissao, ninguem do grupo ve documento alheio.
-- ============================================================================
-- Pegue alguem do MESMO grupo dos documentos, que NAO seja colaborador com
-- documento proprio, e confira se a permissao decide o acesso.
-- ESPERADO: `has_permission` = false -> 0 documentos.
/*
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<UUID_MESMO_GRUPO_SEM_PERMISSAO>","role":"authenticated"}';

  SELECT 'e admin/dev? (invalida o teste)' AS verificacao,
         CASE WHEN is_admin() THEN 'ESCOLHA OUTRO USUARIO' ELSE 'OK' END AS status,
         is_admin()::text AS detalhe
  UNION ALL
  SELECT 'tem personnel.payslips.view?',
         'informativo',
         has_permission('personnel.payslips.view')::text
  UNION ALL
  SELECT 'documentos visiveis',
         CASE
           WHEN has_permission('personnel.payslips.view') THEN 'informativo (tem a permissao)'
           WHEN count(*) = 0 THEN 'OK'
           ELSE 'VAZAMENTO: ve sem ter a permissao'
         END,
         count(*)::text
    FROM employee_documents;
ROLLBACK;
*/


-- ============================================================================
-- PARTE 6 -- Os arquivos no storage seguem a mesma regra.
-- ============================================================================
-- A policy do bucket usa a linha da tabela como autoridade. Se ela divergisse
-- da RLS da tabela, o arquivo vazaria mesmo com a linha protegida.
-- ESPERADO: o colaborador ve so os objetos dos documentos dele.
/*
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<UUID_COLABORADOR>","role":"authenticated"}';

  SELECT 'bucket e privado' AS verificacao,
         CASE WHEN bool_and(public IS FALSE) THEN 'OK' ELSE 'FALHA: bucket publico' END AS status,
         count(*)::text AS detalhe
    FROM storage.buckets WHERE id = 'employee-documents'
  UNION ALL
  SELECT 'objetos visiveis no bucket',
         'informativo',
         count(*)::text
    FROM storage.objects WHERE bucket_id = 'employee-documents'
  UNION ALL
  SELECT 'objetos DE OUTROS visiveis',
         CASE WHEN count(*) = 0 THEN 'OK' ELSE 'VAZAMENTO DE ARQUIVO' END,
         count(*)::text
    FROM storage.objects o
   WHERE o.bucket_id = 'employee-documents'
     AND NOT EXISTS (
       SELECT 1 FROM employee_documents d
        WHERE o.name IN (d.file_path, d.signed_file_path)
          AND d.employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
     );
ROLLBACK;
*/


-- ============================================================================
-- PARTE 7 -- A URL assinada de um nao serve para outro.
-- ============================================================================
-- Este NAO da para testar em SQL: a URL assinada e verificada pelo servico de
-- storage, nao pelo Postgres. Teste no navegador:
--
--   1. Logado como colaborador A, abra um contracheque e copie a URL da aba.
--   2. Numa janela anonima logada como colaborador B, cole a URL.
--
-- ESPERADO: nega (ou expira em 120s, o TTL configurado). ATENCAO: enquanto
-- valida, a URL assinada dispensa autenticacao por desenho — quem tiver o link
-- abre. E por isso que ela e curta e nunca e gravada em banco.


-- ============================================================================
-- SE ALGUMA LINHA VIER 'VAZAMENTO' OU 'FALHA'
-- ============================================================================
-- Nao mexa na policy no dashboard: escreva uma migration. Policy alterada a mao
-- no painel nao esta no repositorio e volta a divergir no proximo deploy.
--
-- Para ver as policies em vigor:
/*
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE tablename IN ('employee_documents', 'employee_document_lines', 'employee_document_views')
    OR (tablename = 'objects' AND policyname LIKE 'employee_documents_storage%')
 ORDER BY tablename, cmd, policyname;
*/
