-- ============================================================
-- Alterar default de notify_work_hours_only para TRUE
-- Colaboradores só recebem push no horário de trabalho por padrão
-- ============================================================

-- 1. Alterar o default da coluna
ALTER TABLE public.profiles
  ALTER COLUMN notify_work_hours_only SET DEFAULT true;

-- 2. Atualizar registros existentes que ainda estão no default antigo (false/null)
UPDATE public.profiles
  SET notify_work_hours_only = true
  WHERE notify_work_hours_only IS NULL OR notify_work_hours_only = false;
