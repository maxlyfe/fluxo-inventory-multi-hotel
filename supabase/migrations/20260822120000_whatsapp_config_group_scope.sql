-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp: configuração isolada por GRUPO
--
-- Princípio do sistema (01-Visao-Geral): "um grupo nunca vê nem interconecta
-- com outro". `whatsapp_configs` violava isso em dois pontos:
--
--   1. RLS: sobrou a policy permissiva original
--      ("Authenticated users manage whatsapp_configs" FOR ALL USING true
--      WITH CHECK true). Policies permissivas se somam com OR, então as
--      policies restritas criadas depois em 20260429000000 nunca tiveram
--      efeito: qualquer usuário autenticado, de qualquer grupo, lia e
--      escrevia access_token / api_key de qualquer hotel.
--
--   2. "Configuração global" era global do SISTEMA (hotel_id IS NULL), sem
--      dono. Um grupo podia editá-la e mudar o comportamento de todos os
--      outros. Passa a ser global DO GRUPO: (hotel_id IS NULL, group_id = X).
--
-- O que NÃO muda: instance_name continua único no banco inteiro. Não é
-- preferência — o webhook do Evolution identifica a origem só pelo campo
-- "instance" do payload; dois grupos com o mesmo nome de instância fariam
-- mensagem de um cair no inbox do outro, que é um vazamento pior. O que muda é
-- a mensagem de erro, que não revela mais o hotel de outro grupo (ver
-- whatsappService.saveConfig).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Coluna de grupo ──────────────────────────────────────────────────────

ALTER TABLE whatsapp_configs
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id) ON DELETE CASCADE;

-- Config de hotel: o grupo é o do hotel, sempre.
UPDATE whatsapp_configs c
   SET group_id = h.group_id
  FROM hotels h
 WHERE h.id = c.hotel_id
   AND c.group_id IS DISTINCT FROM h.group_id;

-- Mantém group_id coerente com o hotel automaticamente, inclusive se o hotel
-- for movido de grupo. Sem isto, a coluna vira uma segunda fonte de verdade.
CREATE OR REPLACE FUNCTION public.wa_config_sync_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.hotel_id IS NOT NULL THEN
    SELECT group_id INTO NEW.group_id FROM public.hotels WHERE id = NEW.hotel_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_config_sync_group ON whatsapp_configs;
CREATE TRIGGER trg_wa_config_sync_group
  BEFORE INSERT OR UPDATE OF hotel_id ON whatsapp_configs
  FOR EACH ROW EXECUTE FUNCTION public.wa_config_sync_group();

-- ── 2. Unicidade: 1 config por hotel, 1 config global por GRUPO ─────────────
-- O índice antigo tratava todo hotel_id NULL como uma única linha global do
-- sistema, o que impedia dois grupos de terem sua própria config global.

DROP INDEX IF EXISTS idx_wa_config_hotel;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_config_hotel
  ON whatsapp_configs (hotel_id)
  WHERE hotel_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_config_group_global
  ON whatsapp_configs (group_id)
  WHERE hotel_id IS NULL;

-- Config global sem dono não pode mais existir: seria "global do sistema" de
-- novo. A linha legada (hotel_id e group_id nulos) fica marcada como inativa
-- em vez de apagada, para não perder credencial por engano.
UPDATE whatsapp_configs
   SET is_active = false
 WHERE hotel_id IS NULL
   AND group_id IS NULL;

-- ── 3. RLS por grupo ───────────────────────────────────────────────────────

ALTER TABLE whatsapp_configs ENABLE ROW LEVEL SECURITY;

-- A policy que anulava todas as outras.
DROP POLICY IF EXISTS "Authenticated users manage whatsapp_configs" ON whatsapp_configs;
DROP POLICY IF EXISTS "authenticated_read_whatsapp" ON whatsapp_configs;
DROP POLICY IF EXISTS "admin_manage_whatsapp"      ON whatsapp_configs;

-- Leitura: hotel do meu grupo, ou a config global do meu grupo.
-- (SELECT ...) envolvendo o helper para o planner avaliar uma vez por statement.
CREATE POLICY "wa_config_read_own_group" ON whatsapp_configs
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN hotel_id IS NOT NULL THEN (SELECT public.hotel_in_my_group(hotel_id))
      ELSE group_id IS NOT NULL AND group_id = (SELECT public.my_group_id())
    END
  );

-- Escrita: admin, e só dentro do próprio grupo.
CREATE POLICY "wa_config_admin_write_own_group" ON whatsapp_configs
  FOR ALL TO authenticated
  USING (
    (SELECT public.is_admin())
    AND CASE
      WHEN hotel_id IS NOT NULL THEN (SELECT public.hotel_in_my_group(hotel_id))
      ELSE group_id IS NOT NULL AND group_id = (SELECT public.my_group_id())
    END
  )
  WITH CHECK (
    (SELECT public.is_admin())
    AND CASE
      WHEN hotel_id IS NOT NULL THEN (SELECT public.hotel_in_my_group(hotel_id))
      ELSE group_id IS NOT NULL AND group_id = (SELECT public.my_group_id())
    END
  );

-- A policy de dev (dev_full_access_whatsapp_configs) continua como está: é o
-- acesso do painel /lyfe-dev, que por definição atravessa grupos.

COMMENT ON COLUMN whatsapp_configs.group_id IS
  'Grupo dono da config. Espelha hotels.group_id via trigger quando hotel_id existe; quando hotel_id é NULL, define de qual grupo é a config global.';
