-- ============================================================================
-- Documentos do colaborador — backfill das permissoes granulares
--
-- Quem ja tem a chave grossa 'personnel_department' recebe as chaves de LEITURA
-- e de ENVIO, para ninguem perder acesso no deploy. Mesmo padrao (e mesma
-- sintaxe jsonb) de 20260802160000_roles_finances_ar_backfill.sql.
--
-- 'personnel.payslips.delete' NAO entra no backfill de proposito: apagar
-- comprovante assinado e destrutivo e irreversivel, e tem que ser concedido a
-- mao em /admin/roles. Admin e dev seguem com bypass pelo can()/is_admin().
--
-- 'personnel.doctypes.manage' tambem fica de fora: mexer nos tipos muda o
-- comportamento do modulo inteiro (o que exige assinatura, o que aparece no
-- Portal), entao e concessao explicita.
--
-- O codigo tambem gateia com canAny(['personnel_department', '<subchave>']),
-- entao este backfill e cinto e suspensorio: o canAny cobre papel criado antes
-- do deploy, e o backfill deixa as chaves visiveis e editaveis em /admin/roles,
-- para o admin poder REMOVER o que nao quer conceder.
--
-- IDEMPOTENTE: a condicao NOT (... ?& ...) impede reaplicacao.
-- ============================================================================

UPDATE custom_roles
SET permissions = (
  SELECT jsonb_agg(DISTINCT elem)
  FROM jsonb_array_elements(
    permissions || '[
      "personnel.payslips.view",
      "personnel.payslips.upload"
    ]'::jsonb
  ) AS elem
)
WHERE permissions ? 'personnel_department'
  AND NOT (permissions ?& array[
    'personnel.payslips.view',
    'personnel.payslips.upload'
  ]);

-- ============================================================================
-- CONFERENCIA
--   SELECT name,
--          permissions ? 'personnel.payslips.view'   AS ve,
--          permissions ? 'personnel.payslips.upload' AS envia,
--          permissions ? 'personnel.payslips.delete' AS apaga
--     FROM custom_roles
--    WHERE permissions ? 'personnel_department';
--
-- Para conceder a exclusao a um papel especifico:
--   UPDATE custom_roles
--      SET permissions = permissions || '["personnel.payslips.delete"]'::jsonb
--    WHERE name = '<papel>';
-- ============================================================================
