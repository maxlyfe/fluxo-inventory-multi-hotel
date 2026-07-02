-- ============================================================================
-- COLABORADORES: EXCLUSÃO (SOFT-DELETE)
-- ============================================================================
-- Permite "excluir" um cadastro de colaborador sem removê-lo do banco de
-- dados: o registro passa a ter status = 'deleted' e some de todas as
-- listagens, filtros e relatórios do sistema. A única forma de recuperar é
-- alterando o status manualmente (Supabase Dashboard → Table Editor).
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- Garante que 'deleted' seja um valor aceito pelo constraint de status da
-- tabela employees, independente de como o constraint atual foi nomeado
-- (ou se nem existe um constraint ainda).
DO $$
DECLARE
  con_rec record;
BEGIN
  FOR con_rec IN
    SELECT DISTINCT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'employees'
      AND con.contype = 'c'
      AND att.attname = 'status'
  LOOP
    EXECUTE format('ALTER TABLE employees DROP CONSTRAINT %I', con_rec.conname);
  END LOOP;
END $$;

ALTER TABLE employees ADD CONSTRAINT employees_status_check
  CHECK (status IN ('active', 'inactive', 'dismissed', 'deleted'));

-- ============================================================================
