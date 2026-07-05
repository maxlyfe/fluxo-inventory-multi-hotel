-- ============================================================
-- Chat: Responder mensagens + Editar com histórico de versões
-- ============================================================

-- 1. reply_to_id: referência à mensagem sendo respondida
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

-- 2. edited_at: timestamp da última edição (NULL = nunca editada)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- 3. Histórico de edições — cada UPDATE salva a versão anterior
CREATE TABLE IF NOT EXISTS public.message_edits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  old_content TEXT NOT NULL,
  edited_by   UUID NOT NULL REFERENCES auth.users(id),
  edited_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_edits_message
  ON public.message_edits(message_id, edited_at DESC);

-- 4. RLS para message_edits
ALTER TABLE public.message_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "membros veem edições"
  ON public.message_edits FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_edits.message_id
      AND public.is_conversation_member(m.conversation_id)
  ));

CREATE POLICY "remetente insere edição"
  ON public.message_edits FOR INSERT
  WITH CHECK (edited_by = auth.uid());

-- 5. Índice para buscas de reply
CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON public.messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- 6. Realtime para edições
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_edits;
