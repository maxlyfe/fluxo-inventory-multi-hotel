-- Adiciona suporte ao ADN (Ambiente de Dados Nacional) para emissão de NFS-e
-- e campo de logo por unidade hoteleira para impressão na NF.

-- ─── nf_hotel_config: provider toggle + logo ───────────────────────────────

ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS nfse_provider TEXT NOT NULL DEFAULT 'prefeitura',
  ADD COLUMN IF NOT EXISTS adn_ambiente  TEXT NOT NULL DEFAULT 'homologacao',
  ADD COLUMN IF NOT EXISTS logo_url      TEXT;

ALTER TABLE nf_hotel_config
  ADD CONSTRAINT nf_hotel_config_nfse_provider_check
    CHECK (nfse_provider IN ('prefeitura', 'adn'));

ALTER TABLE nf_hotel_config
  ADD CONSTRAINT nf_hotel_config_adn_ambiente_check
    CHECK (adn_ambiente IN ('homologacao', 'producao'));

-- ─── nf_invoices: registrar provider usado + DPS/DANFSE ────────────────────

ALTER TABLE nf_invoices
  ADD COLUMN IF NOT EXISTS nfse_provider TEXT,
  ADD COLUMN IF NOT EXISTS xml_dps       TEXT,
  ADD COLUMN IF NOT EXISTS danfse_url    TEXT;

-- ─── Storage bucket para logos (executar via dashboard se não suportado) ────

INSERT INTO storage.buckets (id, name, public)
VALUES ('nf-logos', 'nf-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "nf_logos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'nf-logos');

CREATE POLICY "nf_logos_auth_write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'nf-logos' AND auth.role() = 'authenticated');

CREATE POLICY "nf_logos_auth_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'nf-logos' AND auth.role() = 'authenticated');

CREATE POLICY "nf_logos_auth_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'nf-logos' AND auth.role() = 'authenticated');
