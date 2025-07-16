-- Tabela para armazenar os tokens FCM dos usuários
CREATE TABLE public.user_fcm_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fcm_token TEXT NOT NULL,
    device_info TEXT, -- Opcional: informações sobre o dispositivo (ex: user agent)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT user_fcm_tokens_user_id_fcm_token_key UNIQUE (user_id, fcm_token) -- Evitar tokens duplicados para o mesmo usuário
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.user_fcm_tokens ENABLE ROW LEVEL SECURITY;

-- Política: Usuários podem ver e gerenciar seus próprios tokens
CREATE POLICY "Users can manage their own FCM tokens"
ON public.user_fcm_tokens
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Função para atualizar 'updated_at' automaticamente
CREATE OR REPLACE FUNCTION public.update_fcm_token_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_fcm_tokens_updated_at
BEFORE UPDATE ON public.user_fcm_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_fcm_token_updated_at_column();

-- Índices
CREATE INDEX idx_user_fcm_tokens_user_id ON public.user_fcm_tokens(user_id);

