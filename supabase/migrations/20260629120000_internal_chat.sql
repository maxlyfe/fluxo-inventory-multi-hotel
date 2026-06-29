-- ============================================================
-- Sistema de Mensagens Internas (Chat)
-- ============================================================

-- conversations: DM (type='direct') ou grupo (type='group')
CREATE TABLE public.conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('direct', 'group')),
  name          text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- conversation_members: quem participa de cada conversa
CREATE TABLE public.conversation_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz,
  UNIQUE(conversation_id, user_id)
);

-- messages
CREATE TABLE public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES auth.users(id),
  content         text,
  type            text NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'audio')),
  media_url       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- message_reads: confirmação de leitura por mensagem
CREATE TABLE public.message_reads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

-- ============================================================
-- Índices
-- ============================================================
CREATE INDEX idx_conversations_group_id   ON public.conversations(group_id);
CREATE INDEX idx_conversations_updated_at ON public.conversations(updated_at DESC);
CREATE INDEX idx_conv_members_user_id     ON public.conversation_members(user_id);
CREATE INDEX idx_conv_members_conv_id     ON public.conversation_members(conversation_id);
CREATE INDEX idx_messages_conv_created    ON public.messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender_id       ON public.messages(sender_id);
CREATE INDEX idx_msg_reads_message_id     ON public.message_reads(message_id);
CREATE INDEX idx_msg_reads_user_id        ON public.message_reads(user_id);

-- ============================================================
-- Trigger: atualiza conversations.updated_at a cada nova mensagem
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_conversation_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_messages_touch_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_updated_at();

-- ============================================================
-- Funções auxiliares para RLS
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_conversation_member(conv_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = conv_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.my_group_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT group_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ============================================================
-- RPC: cria ou retorna conversa direta entre dois usuários (idempotente)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(other_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_group_id   uuid;
  v_conv_id    uuid;
BEGIN
  -- Grupo do usuário atual
  SELECT group_id INTO v_group_id FROM public.profiles WHERE id = auth.uid();

  -- Buscar conversa direta existente entre os dois usuários
  SELECT c.id INTO v_conv_id
  FROM public.conversations c
  WHERE c.type = 'direct'
    AND c.group_id = v_group_id
    AND EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = c.id AND user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = c.id AND user_id = other_user_id)
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  -- Criar nova conversa direta
  INSERT INTO public.conversations (group_id, type, created_by)
  VALUES (v_group_id, 'direct', auth.uid())
  RETURNING id INTO v_conv_id;

  -- Inserir ambos como membros
  INSERT INTO public.conversation_members (conversation_id, user_id)
  VALUES (v_conv_id, auth.uid()), (v_conv_id, other_user_id);

  RETURN v_conv_id;
END;
$$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads        ENABLE ROW LEVEL SECURITY;

-- conversations
CREATE POLICY "membros veem suas conversas"
  ON public.conversations FOR SELECT
  USING (is_conversation_member(id));

CREATE POLICY "membros do grupo criam conversas"
  ON public.conversations FOR INSERT
  WITH CHECK (group_id = my_group_id());

CREATE POLICY "membros atualizam conversas"
  ON public.conversations FOR UPDATE
  USING (is_conversation_member(id));

-- conversation_members
CREATE POLICY "membros veem participantes"
  ON public.conversation_members FOR SELECT
  USING (is_conversation_member(conversation_id));

CREATE POLICY "membros adicionam participantes"
  ON public.conversation_members FOR INSERT
  WITH CHECK (is_conversation_member(conversation_id) OR user_id = auth.uid());

-- messages
CREATE POLICY "membros leem mensagens"
  ON public.messages FOR SELECT
  USING (is_conversation_member(conversation_id) AND deleted_at IS NULL);

CREATE POLICY "membros enviam mensagens"
  ON public.messages FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND is_conversation_member(conversation_id));

CREATE POLICY "remetente exclui mensagem"
  ON public.messages FOR UPDATE
  USING (sender_id = auth.uid());

-- message_reads
CREATE POLICY "usuarios gerenciam proprias leituras"
  ON public.message_reads FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
