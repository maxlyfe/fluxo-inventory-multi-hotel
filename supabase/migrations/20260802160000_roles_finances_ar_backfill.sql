-- ============================================================================
-- Contas a Receber — Fase 6: backfill das permissões granulares
--
-- Quem já tem a chave grossa 'finances' recebe as sete subchaves novas, para
-- ninguém perder acesso no deploy. Mesmo padrão (e mesma sintaxe jsonb) de
-- 20260721150000_roles_nf_emit_granular_backfill.sql.
--
-- O código também gateia com canAny(['finances', '<subchave>']), então este
-- backfill é cinto e suspensório: o canAny cobre papel criado antes do deploy, e
-- o backfill deixa as chaves visíveis e editáveis em /admin/roles, para o admin
-- poder REMOVER o que não quer conceder (o que o canAny sozinho impediria).
--
-- IDEMPOTENTE: a condição NOT (... ?& ...) impede reaplicação.
-- ============================================================================

UPDATE custom_roles
SET permissions = (
  SELECT jsonb_agg(DISTINCT elem)
  FROM jsonb_array_elements(
    permissions || '[
      "finances.ar.manage",
      "finances.ar.rules",
      "finances.billing.view",
      "finances.billing.mark",
      "finances.billing.send",
      "finances.billing.template",
      "finances.billing.sender"
    ]'::jsonb
  ) AS elem
)
WHERE permissions ? 'finances'
  AND NOT (permissions ?& array[
    'finances.ar.manage',
    'finances.ar.rules',
    'finances.billing.view',
    'finances.billing.mark',
    'finances.billing.send',
    'finances.billing.template',
    'finances.billing.sender'
  ]);

-- ============================================================================
-- CONFERÊNCIA
--   SELECT name, permissions FROM custom_roles WHERE permissions ? 'finances';
--
-- Para tirar de um papel o direito de MANDAR e-mail ao parceiro, mantendo o de
-- registrar cobrança internamente:
--   UPDATE custom_roles
--      SET permissions = permissions - 'finances.billing.send'
--    WHERE name = '<papel>';
-- ============================================================================
