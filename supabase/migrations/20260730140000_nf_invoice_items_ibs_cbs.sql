-- Reforma Tributária (IBS/CBS) — completa o pipeline de propagação até a NFC-e/NF-e.
-- `nf_invoice_items` persiste o rascunho da nota entre a resolução fiscal
-- (dishes.ibs_cbs_cst/ibs_cbs_cclasstrib) e a emissão real (nf-proxy →
-- nfce-sefaz.ts), então precisa carregar esses dois campos como as demais
-- colunas fiscais (pis_cst, cofins_cst etc.) já fazem.

ALTER TABLE nf_invoice_items
  ADD COLUMN IF NOT EXISTS ibs_cbs_cst        text,
  ADD COLUMN IF NOT EXISTS ibs_cbs_cclasstrib text;
