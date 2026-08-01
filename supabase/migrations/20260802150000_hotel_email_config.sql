-- ============================================================================
-- Contas a Receber — Fase 5: remetente de e-mail POR UNIDADE
--
-- Cada hotel cadastra a própria conta de envio. Não existe remetente global:
-- mandar a cobrança do Costa do Sol saindo da caixa do Brava Club seria um CNPJ
-- falando pelo outro com o mesmo parceiro.
--
-- ONDE A SENHA DE APP FICA
-- Não em coluna de texto. O certificado A1 e a senha da prefeitura em texto puro
-- em nf_hotel_config são achado crítico de 06-Seguranca.md, e repetir o padrão
-- aqui seria criar o próximo achado de propósito.
--
-- A senha é cifrada com AES-256-GCM DENTRO da Netlify Function
-- (netlify/functions/lib/crypto.ts), com a chave em EMAIL_CONFIG_KEY, que existe
-- só no ambiente do servidor. O Postgres guarda apenas o texto cifrado e NUNCA
-- vê a chave nem o valor em claro. O browser também não: a gravação passa pela
-- function email-config-save e a leitura usa a view v_hotel_email_config, que
-- expõe apenas has_password.
--
-- Alternativa considerada: Supabase Vault (vault.create_secret). Ficou de fora
-- porque a decifragem aconteceria no banco, ou seja, uma policy mal escrita
-- passaria a expor o segredo. Com AES no servidor, nem service_role no SQL
-- Editor consegue ler a senha sem a chave da Netlify.
--
-- IDEMPOTENTE.
-- ============================================================================

BEGIN;

-- ── Guarda de dependência ───────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.can_read_hotel(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Falta a funcao can_read_hotel(uuid). Aplique primeiro '
      'supabase/migrations/20260730120000_rls_helpers.sql (Lote 0 de RLS: '
      'aditiva, cria apenas funcoes, nao altera policy nenhuma).';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hotel_email_config (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id           uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  -- Transporte
  smtp_host          text NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port          integer NOT NULL DEFAULT 587,
  -- false = STARTTLS na 587 (padrão do Workspace); true = TLS direto na 465
  smtp_secure        boolean NOT NULL DEFAULT false,
  smtp_user          text,

  -- Senha de app cifrada (AES-256-GCM, base64 de iv||tag||ciphertext).
  -- Gravada e lida SOMENTE pelas Netlify Functions.
  smtp_password_enc  text,

  -- Remetente
  from_name          text,
  from_email         text,
  reply_to           text,

  active             boolean NOT NULL DEFAULT false,

  -- Último teste, para a tela dizer se está de pé sem mandar e-mail de novo
  last_test_at       timestamptz,
  last_test_ok       boolean,
  last_test_error    text,

  updated_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (hotel_id)
);

COMMENT ON TABLE hotel_email_config IS
  'Remetente de e-mail por unidade. smtp_password_enc é cifrado na Netlify '
  'Function com a chave EMAIL_CONFIG_KEY; o banco nunca tem a chave.';

ALTER TABLE hotel_email_config DROP CONSTRAINT IF EXISTS chk_hotel_email_port;
ALTER TABLE hotel_email_config ADD  CONSTRAINT chk_hotel_email_port
  CHECK (smtp_port BETWEEN 1 AND 65535);

-- Config ativa precisa do mínimo para funcionar. Sem isto, o operador ativaria
-- uma configuração pela metade e descobriria só quando a cobrança não saísse.
ALTER TABLE hotel_email_config DROP CONSTRAINT IF EXISTS chk_hotel_email_active_complete;
ALTER TABLE hotel_email_config ADD  CONSTRAINT chk_hotel_email_active_complete
  CHECK (
    NOT active
    OR (smtp_host IS NOT NULL AND smtp_user IS NOT NULL
        AND smtp_password_enc IS NOT NULL AND from_email IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_hotel_email_config_hotel ON hotel_email_config(hotel_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS: escopada por hotel. A senha cifrada nunca vai para o browser porque o
-- front lê a VIEW abaixo, não a tabela.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE hotel_email_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hotel_email_config_hotel_scoped" ON hotel_email_config;
CREATE POLICY "hotel_email_config_hotel_scoped" ON hotel_email_config
  FOR ALL TO authenticated
  USING ((SELECT can_read_hotel(hotel_id)))
  WITH CHECK ((SELECT can_read_hotel(hotel_id)));

-- ──────────────────────────────────────────────────────────────────────────────
-- View de leitura para o front: tudo menos o segredo
-- ──────────────────────────────────────────────────────────────────────────────
-- security_invoker (PG15+) faz a view herdar a RLS da tabela base.
CREATE OR REPLACE VIEW public.v_hotel_email_config
WITH (security_invoker = true) AS
SELECT
  id, hotel_id, smtp_host, smtp_port, smtp_secure, smtp_user,
  from_name, from_email, reply_to, active,
  last_test_at, last_test_ok, last_test_error,
  updated_by, created_at, updated_at,
  (smtp_password_enc IS NOT NULL) AS has_password
FROM hotel_email_config;

GRANT SELECT ON public.v_hotel_email_config TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- Auditoria: qual remetente foi usado em cada cobrança
-- ──────────────────────────────────────────────────────────────────────────────
-- from_email já foi criado na Fase 0 (20260802120000). Este índice serve para
-- responder "quais cobranças saíram desta caixa?" quando o parceiro reclama.
CREATE INDEX IF NOT EXISTS idx_ar_dispatch_from_email
  ON ar_billing_dispatches(hotel_id, from_email) WHERE from_email IS NOT NULL;

COMMIT;
