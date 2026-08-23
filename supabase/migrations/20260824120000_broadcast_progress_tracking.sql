-- Disparo com estado persistido.
--
-- Ate agora a linha de whatsapp_broadcasts so era gravada DEPOIS do ultimo
-- envio. Como o loop roda no navegador, atualizar a pagina no meio de um
-- disparo longo matava o envio e nao deixava rastro nenhum: nem quantos
-- foram, nem para quem. Com 400 contatos e intervalo de 3-8s o disparo leva
-- mais de meia hora, entao a janela para isso acontecer e enorme.
--
-- Agora a linha nasce junto com o disparo e e atualizada a cada envio.

ALTER TABLE whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Linhas antigas so existem porque chegaram ao fim.
UPDATE whatsapp_broadcasts SET status = 'completed' WHERE status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_broadcast_status') THEN
    ALTER TABLE whatsapp_broadcasts
      ADD CONSTRAINT chk_broadcast_status
      CHECK (status IN ('running', 'completed', 'canceled', 'interrupted'));
  END IF;
END $$;

-- Busca do disparo em andamento ao abrir a tela.
CREATE INDEX IF NOT EXISTS idx_broadcast_running
  ON whatsapp_broadcasts (hotel_id, updated_at DESC)
  WHERE status = 'running';

COMMENT ON COLUMN whatsapp_broadcasts.status IS
  'running = em andamento; completed = terminou; canceled = parado pelo operador; interrupted = a aba morreu no meio (updated_at parado).';
COMMENT ON COLUMN whatsapp_broadcasts.updated_at IS
  'Batimento do disparo: atualizado a cada envio. Se status = running e isto esta parado ha mais de 1 minuto, a aba que enviava morreu.';
