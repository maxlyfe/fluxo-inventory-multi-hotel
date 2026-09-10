-- ============================================================================
-- TESTE DE ISOLAMENTO DA RLS DE `employee_documents` (contracheques)
-- ============================================================================
-- ONDE RODAR: Supabase Dashboard -> SQL Editor.
-- COMO RODAR: cole o arquivo inteiro e rode -- a PARTE 1 ja esta descomentada
--             e devolve os uuids das cobaias. Depois descomente as partes 2 a
--             6, UMA POR VEZ, trocando os <UUID_...> pelos valores da parte 1.
--
--             As partes 2 a 6 vem comentadas porque cada uma depende de um
--             uuid que so sai da parte 1, e porque o editor mostra apenas o
--             resultado do ULTIMO statement: rodar duas partes juntas
--             esconderia o resultado da primeira.
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
-- PARTE 1 -- Escolher as cobaias. JA DESCOMENTADA: colar o arquivo roda ISTO.
-- ============================================================================
-- As partes 2 a 6 estao comentadas de proposito, porque cada uma precisa de um
-- uuid que so sai daqui. Descomente uma por vez.
--
-- Um SELECT unico consolidado, e nao tres consultas soltas: o SQL Editor mostra
-- apenas o resultado do ULTIMO statement, entao consulta solta esconde as
-- anteriores. (Armadilha ja registrada no cofre, em 04-Banco-de-Dados.)
--
-- Do resultado, anote:
--   * um `uuid` de linha `COLABORADOR (use na parte 2, 3 e 6)`;
--   * um `uuid` de linha `OUTRO GRUPO (use na parte 4)`;
--   * um `uuid` de linha `MESMO GRUPO SEM PERMISSAO (use na parte 5)`.
--
-- Se a coluna `atencao` disser algo, leia: conta admin/dev invalida o teste.

-- Nenhuma funcao nova e criada aqui: a deteccao de admin/dev vai inline, no
-- CTE `contas`, replicando o critério de `is_admin()`. Criar helper no banco
-- para um diagnostico deixaria residuo permanente por um teste de uma tarde.

WITH contas AS (
  SELECT p.id,
         coalesce(p.full_name, '(sem nome)') AS nome,
         p.group_id,
         coalesce(r.name, p.role, '(nenhum)') AS papel_nome,
         -- Mesmo critério de public.is_admin(): admin e dev passam por cima da
         -- RLS de proposito, e impersonar uma dessas contas invalida o teste.
         (r.name ILIKE '%admin%' OR r.name ILIKE '%dev%' OR p.role IN ('admin', 'dev')) AS e_admin,
         -- `custom_roles.permissions` e JSONB: operador de containment, nao ANY.
         coalesce(r.permissions ? 'personnel.payslips.view', false)
           OR coalesce(r.permissions ? 'personnel_department', false) AS tem_permissao
    FROM profiles p
    LEFT JOIN custom_roles r ON r.id = p.custom_role_id
),
grupo_alvo AS (
  -- Onde estao os contracheques hoje. Roda como postgres (sem RLS), de
  -- proposito: e a referencia contra a qual os testes vao comparar.
  SELECT h.group_id
    FROM employee_documents d
    JOIN hotels h ON h.id = d.hotel_id
   GROUP BY h.group_id
   ORDER BY count(*) DESC
   LIMIT 1
),
colaboradores AS (
  SELECT 1 AS ord,
         'COLABORADOR (partes 2, 3 e 6)' AS papel,
         e.user_id AS uuid,
         e.name AS quem,
         coalesce(g.name, '(sem grupo)') AS grupo,
         count(d.id)::text || ' doc(s) proprios' AS contexto,
         CASE WHEN bool_or(c.e_admin) THEN 'e admin/dev: escolha outro' ELSE '' END AS atencao
    FROM employees e
    JOIN employee_documents d ON d.employee_id = e.id
    LEFT JOIN hotels h ON h.id = e.hotel_id
    LEFT JOIN groups g ON g.id = h.group_id
    LEFT JOIN contas c ON c.id = e.user_id
   WHERE e.user_id IS NOT NULL
   GROUP BY e.user_id, e.name, g.name
),
fora_do_grupo AS (
  SELECT 2 AS ord,
         'OUTRO GRUPO (parte 4)' AS papel,
         c.id AS uuid,
         c.nome AS quem,
         coalesce(g.name, '(sem grupo)') AS grupo,
         'papel: ' || c.papel_nome AS contexto,
         CASE WHEN c.e_admin THEN 'e admin/dev: escolha outro' ELSE '' END AS atencao
    FROM contas c
    LEFT JOIN groups g ON g.id = c.group_id
   WHERE c.group_id IS DISTINCT FROM (SELECT group_id FROM grupo_alvo)
),
mesmo_grupo AS (
  SELECT 3 AS ord,
         'MESMO GRUPO SEM PERMISSAO (parte 5)' AS papel,
         c.id AS uuid,
         c.nome AS quem,
         coalesce(g.name, '(sem grupo)') AS grupo,
         'papel: ' || c.papel_nome AS contexto,
         CASE
           WHEN c.e_admin THEN 'e admin/dev: escolha outro'
           WHEN c.tem_permissao THEN 'tem a permissao: escolha outro'
           ELSE ''
         END AS atencao
    FROM contas c
    LEFT JOIN groups g ON g.id = c.group_id
   WHERE c.group_id = (SELECT group_id FROM grupo_alvo)
     AND NOT EXISTS (
       SELECT 1 FROM employees e
        JOIN employee_documents d ON d.employee_id = e.id
        WHERE e.user_id = c.id
     )
),
referencia AS (
  SELECT 0 AS ord,
         'REFERENCIA (visto como postgres, sem RLS)' AS papel,
         NULL::uuid AS uuid,
         count(*)::text || ' documento(s) na rede' AS quem,
         '' AS grupo,
         'os testes devem ver MENOS que isto' AS contexto,
         '' AS atencao
    FROM employee_documents
)
SELECT papel, uuid, quem, grupo, contexto, atencao FROM (
  SELECT * FROM referencia
  UNION ALL SELECT * FROM colaboradores
  UNION ALL SELECT * FROM fora_do_grupo
  UNION ALL SELECT * FROM mesmo_grupo
) t
ORDER BY ord, atencao, quem
LIMIT 40;


-- ============================================================================
-- PARTE 2 -- O colaborador ve SO os documentos dele.
-- ============================================================================
-- Troque <UUID_COLABORADOR> pelo uuid da linha `COLABORADOR` da parte 1.
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
-- Troque <UUID_OUTRO_GRUPO> pelo uuid de uma linha `OUTRO GRUPO` da parte 1,
-- cuja coluna `atencao` esteja vazia. Conta `dev`/`admin` passa por
-- `is_admin()` de proposito e veria tudo: o teste ficaria sem sentido.
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
-- Use o uuid de uma linha `MESMO GRUPO SEM PERMISSAO` da parte 1, com a coluna
-- `atencao` vazia. Confirma que a permissao, e nao so o grupo, decide o acesso.
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
