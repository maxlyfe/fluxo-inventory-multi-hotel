-- =====================================================
-- Catálogo de Serviços — cadastro próprio com tributação
-- NFS-e por serviço, compartilhamento entre unidades do
-- grupo (share_key) e lançamentos em reservas internas
-- =====================================================

-- 1. Serviços do hotel
CREATE TABLE IF NOT EXISTS services (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  -- Identidade lógica no grupo: cópias do mesmo serviço em outras unidades
  -- mantêm o mesmo share_key (base do copiar/empurrar edição)
  share_key           UUID NOT NULL DEFAULT gen_random_uuid(),

  name                TEXT NOT NULL,
  description         TEXT,               -- discriminação padrão na NFS-e
  category            TEXT,

  -- Preço: 'fixed' exige price; 'variable' = valor definido no lançamento
  pricing_mode        TEXT NOT NULL DEFAULT 'fixed'
                        CHECK (pricing_mode IN ('fixed', 'variable')),
  price               NUMERIC(12,2),

  -- Tributação NFS-e (ABRASF)
  lc116_code          TEXT,               -- item da lista de serviços LC 116 (ex.: 9.01)
  municipal_tax_code  TEXT,               -- código de tributação do município (CTISS)
  cnae                TEXT,
  iss_rate            NUMERIC(5,2),       -- alíquota ISS %
  iss_retained        BOOLEAN NOT NULL DEFAULT false,
  iss_exigibilidade   TEXT NOT NULL DEFAULT '1',  -- 1=Exigível, 2=Não incidência, 3=Isenção, 4=Exportação, 5=Imunidade, 6=Susp. judicial, 7=Susp. adm.
  nbs_code            TEXT,

  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_services_share UNIQUE (hotel_id, share_key)
);

CREATE INDEX IF NOT EXISTS idx_services_hotel ON services(hotel_id, is_active);

-- 2. Mapeamento Erbon → serviço do catálogo (terceiro alvo, além de
--    product_id e dish_id)
ALTER TABLE erbon_product_mappings
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;

-- 3. Lançamentos de consumo/serviço em reservas internas/Omnibees
CREATE TABLE IF NOT EXISTS internal_booking_charges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  booking_id   UUID NOT NULL REFERENCES internal_bookings(id) ON DELETE CASCADE,
  service_id   UUID REFERENCES services(id) ON DELETE SET NULL,

  description  TEXT NOT NULL,
  quantity     NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total        NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- NF vinculada após emissão (evita faturar duas vezes)
  invoice_id   UUID REFERENCES nf_invoices(id) ON DELETE SET NULL,

  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ib_charges_booking ON internal_booking_charges(booking_id);
CREATE INDEX IF NOT EXISTS idx_ib_charges_hotel   ON internal_booking_charges(hotel_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE services                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_booking_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "services: auth full access" ON services;
CREATE POLICY "services: auth full access"
  ON services FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "internal_booking_charges: auth full access" ON internal_booking_charges;
CREATE POLICY "internal_booking_charges: auth full access"
  ON internal_booking_charges FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
