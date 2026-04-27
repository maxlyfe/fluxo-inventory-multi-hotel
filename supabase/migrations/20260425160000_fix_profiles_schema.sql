-- Corrige a tabela de perfis e adiciona colunas faltantes
-- Se a tabela se chamar auth_users, vamos renomear ou garantir a existência de 'profiles'

DO $$ 
BEGIN
    -- Se a tabela auth_users existir e profiles não, renomeia
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'auth_users') 
       AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
        ALTER TABLE public.auth_users RENAME TO profiles;
    END IF;
END $$;

-- Garante que as colunas necessárias existam na tabela profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS cpf TEXT,
ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Cria índice para busca rápida de CPF
CREATE INDEX IF NOT EXISTS idx_profiles_cpf ON public.profiles(cpf);

-- Se houver coluna avatar_url antiga, migra os dados para photo_url e remove
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'avatar_url') THEN
        UPDATE public.profiles SET photo_url = avatar_url WHERE photo_url IS NULL;
        -- ALTER TABLE public.profiles DROP COLUMN avatar_url; -- Opcional: remover apenas após verificar estabilidade
    END IF;
END $$;
