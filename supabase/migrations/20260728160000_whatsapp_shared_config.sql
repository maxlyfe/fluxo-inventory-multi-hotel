-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp compartilhado entre unidades do mesmo grupo
--
-- Costa do Sol e Brava Club compram pelo mesmo número. Maria Maria e Vila
-- Pitanga também, por outro. Antes só existiam dois níveis: configuração por
-- hotel, ou uma global valendo para todos.
--
-- Agora um hotel pode se anexar ao WhatsApp de outra unidade: ele não guarda
-- credencial nenhuma e passa a usar a do hotel de origem, tanto no envio quanto
-- no inbox.
--
-- Por que o inbox é necessariamente compartilhado: a resposta do fornecedor
-- chega em um único número. Não há informação no protocolo que diga para qual
-- unidade era. Então a conversa pertence ao hotel dono da configuração, e as
-- unidades anexadas veem as mesmas conversas.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE hotels
  ADD COLUMN IF NOT EXISTS whatsapp_source_hotel_id uuid REFERENCES hotels(id) ON DELETE SET NULL;

COMMENT ON COLUMN hotels.whatsapp_source_hotel_id IS 'Quando preenchido, este hotel usa a configuracao de WhatsApp do hotel apontado, em vez de ter a sua propria. Um nivel apenas: o hotel de origem nao pode delegar para outro.';

-- Um hotel não pode apontar para si mesmo
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_hotels_wa_source_not_self') THEN
    ALTER TABLE hotels
      ADD CONSTRAINT chk_hotels_wa_source_not_self
      CHECK (whatsapp_source_hotel_id IS NULL OR whatsapp_source_hotel_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotels_wa_source
  ON hotels (whatsapp_source_hotel_id)
  WHERE whatsapp_source_hotel_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Impede cadeia de delegação (A → B → C).
--
-- Resolver cadeia exigiria recursão em todo lugar que lê a configuração, com
-- risco de laço infinito. Um nível só cobre o caso real e é verificável aqui,
-- em vez de depender de disciplina na aplicação.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_whatsapp_source_depth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.whatsapp_source_hotel_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- O hotel de origem não pode ele mesmo estar delegando
  IF EXISTS (
    SELECT 1 FROM hotels
    WHERE id = NEW.whatsapp_source_hotel_id
      AND whatsapp_source_hotel_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'O hotel de origem ja usa o WhatsApp de outra unidade. Aponte direto para quem tem a configuracao.';
  END IF;

  -- Ninguém pode estar delegando para este hotel, senão ele viraria intermediário
  IF EXISTS (
    SELECT 1 FROM hotels
    WHERE whatsapp_source_hotel_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Outras unidades usam o WhatsApp deste hotel. Reaponte-as antes de anexar este a outro.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_check_whatsapp_source_depth ON hotels;

CREATE TRIGGER trg_check_whatsapp_source_depth
  BEFORE INSERT OR UPDATE OF whatsapp_source_hotel_id ON hotels
  FOR EACH ROW
  EXECUTE FUNCTION check_whatsapp_source_depth();
