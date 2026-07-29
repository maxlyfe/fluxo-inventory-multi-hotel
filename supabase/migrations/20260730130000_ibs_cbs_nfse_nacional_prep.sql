-- Reforma Tributária (EC 132/2023 · NT 2025.002) — preparação para IBS/CBS na
-- emissão de NFS-e (Nacional DPS) e na ficha técnica (pratos vendidos via PDV).
--
-- Contexto:
--   1. O CHECK de nfse_provider só permitia 'prefeitura'/'adn' — a UI já oferece
--      a opção 'el-nacional' (DPS Nacional) mas salvar essa escolha quebrava por
--      violação de constraint. As colunas el_token/el_ambiente/
--      codigo_servico_municipal já existiam no banco (criadas fora de migration
--      — schema drift), por isso aqui só formalizamos o constraint que faltava
--      em el_ambiente e usamos ADD COLUMN IF NOT EXISTS por segurança.
--   2. `dishes` (fichas técnicas / itens vendidos no PDV via NFC-e) não tinha os
--      campos de IBS/CBS que `products`/`services` já ganharam em
--      20260720120000_ibs_cbs_reform_fields.sql.
--   3. O builder da DPS Nacional (el-nacional-nfse.ts) precisa de config extra
--      por hotel para montar o bloco <IBSCBS> (finNFSe/indFinal/cIndOp/indDest
--      + CST/cClassTrib), hoje inexistente.

-- ─── nf_hotel_config: liberar 'el-nacional' e formalizar el_ambiente ───────

ALTER TABLE nf_hotel_config
  DROP CONSTRAINT IF EXISTS nf_hotel_config_nfse_provider_check;

ALTER TABLE nf_hotel_config
  ADD CONSTRAINT nf_hotel_config_nfse_provider_check
    CHECK (nfse_provider IN ('prefeitura', 'adn', 'el-nacional'));

ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS el_token                 TEXT,
  ADD COLUMN IF NOT EXISTS el_ambiente               TEXT NOT NULL DEFAULT 'homologacao',
  ADD COLUMN IF NOT EXISTS codigo_servico_municipal  TEXT;

ALTER TABLE nf_hotel_config
  DROP CONSTRAINT IF EXISTS nf_hotel_config_el_ambiente_check;

ALTER TABLE nf_hotel_config
  ADD CONSTRAINT nf_hotel_config_el_ambiente_check
    CHECK (el_ambiente IN ('homologacao', 'producao'));

-- ─── nf_hotel_config: config do bloco <IBSCBS> da DPS Nacional (por hotel) ──
-- O exemplo oficial de DPS com IBSCBS mostra um único bloco por nota, não por
-- item (nf_invoice_items hoje não tem vínculo com services.id) — por isso o
-- CST/cClassTrib e os indicadores de operação ficam aqui, não em `services`.
-- Defaults replicam o exemplo de referência (finNFSe=0, indFinal=1,
-- cIndOp=100301, indDest=0, CST=000, cClassTrib=000001) — cIndOp deve ser
-- validado com o contador/prefeitura antes de ir a produção, pois varia por
-- natureza da operação.

ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS nfse_ibs_cbs_cst        text DEFAULT '000',
  ADD COLUMN IF NOT EXISTS nfse_ibs_cbs_cclasstrib text DEFAULT '000001',
  ADD COLUMN IF NOT EXISTS nfse_fin_nfse           smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nfse_ind_final          smallint DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nfse_c_ind_op           text DEFAULT '100301',
  ADD COLUMN IF NOT EXISTS nfse_ind_dest           smallint DEFAULT 0;

UPDATE nf_hotel_config
   SET nfse_ibs_cbs_cst        = COALESCE(nfse_ibs_cbs_cst, '000'),
       nfse_ibs_cbs_cclasstrib = COALESCE(nfse_ibs_cbs_cclasstrib, '000001'),
       nfse_fin_nfse           = COALESCE(nfse_fin_nfse, 0),
       nfse_ind_final          = COALESCE(nfse_ind_final, 1),
       nfse_c_ind_op           = COALESCE(nfse_c_ind_op, '100301'),
       nfse_ind_dest           = COALESCE(nfse_ind_dest, 0);

-- ─── dishes: campos de IBS/CBS (fonte real dos itens vendidos via NFC-e) ───

ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS ibs_cbs_cst        text DEFAULT '000',
  ADD COLUMN IF NOT EXISTS ibs_cbs_cclasstrib text DEFAULT '000001';

UPDATE dishes
   SET ibs_cbs_cst        = COALESCE(ibs_cbs_cst, '000'),
       ibs_cbs_cclasstrib = COALESCE(ibs_cbs_cclasstrib, '000001');
