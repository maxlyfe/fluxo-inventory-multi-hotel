-- ============================================================
-- Filtro de notificações por horário de trabalho (opt-in)
-- ============================================================

-- Preferência por usuário: ativar filtro de horário de trabalho
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_work_hours_only boolean DEFAULT false;

-- Flag de push diferido: push não foi enviado pois usuário estava fora do turno
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS push_deferred boolean DEFAULT false;

-- Índice parcial para buscar eficientemente os pushes pendentes por usuário
CREATE INDEX IF NOT EXISTS idx_notifications_deferred
  ON public.notifications(user_id, push_deferred)
  WHERE push_deferred = true;
