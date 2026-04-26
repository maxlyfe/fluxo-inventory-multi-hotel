-- Migração para o sistema de Dashboard dinâmico baseado em Widgets
-- Cria a tabela de preferências de cada usuário

CREATE TABLE IF NOT EXISTS public.user_dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    widget_id TEXT NOT NULL,
    position_x INT NOT NULL DEFAULT 0,
    position_y INT NOT NULL DEFAULT 0,
    size_w INT NOT NULL DEFAULT 3, -- 3 colunas de 12 por padrão
    size_h INT NOT NULL DEFAULT 1,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.user_dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso
CREATE POLICY "Users can view their own dashboard widgets"
ON public.user_dashboard_widgets FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own dashboard widgets"
ON public.user_dashboard_widgets FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own dashboard widgets"
ON public.user_dashboard_widgets FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own dashboard widgets"
ON public.user_dashboard_widgets FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Índices
CREATE INDEX idx_dashboard_widgets_user_id ON public.user_dashboard_widgets(user_id);
