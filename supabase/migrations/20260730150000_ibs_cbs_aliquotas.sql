-- Reforma Tributária (IBS/CBS) — alíquotas explícitas por item.
--
-- CST/cClassTrib (já adicionados em 20260720120000_ibs_cbs_reform_fields.sql e
-- 20260730130000_ibs_cbs_nfse_nacional_prep.sql) são códigos de classificação
-- tributária exigidos pelo layout da NFC-e/NFS-e, mas não expressam a alíquota
-- em si — por isso o cadastro precisa de campos numéricos próprios, no mesmo
-- padrão já usado para ICMS/PIS/COFINS (CST + Alíquota).
--
-- 2026 é o "ano teste" da reforma: todo item, sem exceção, usa as mesmas
-- alíquotas de transição (0,10% IBS + 0,90% CBS — já hardcoded como
-- IBS_UF_RATE/CBS_RATE em netlify/functions/lib/nfce-sefaz.ts). Por isso os
-- defaults abaixo já vêm preenchidos com esses valores — editável por item
-- para quando as alíquotas plenas da reforma passarem a variar por produto.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ibs_aliquota numeric DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS cbs_aliquota numeric DEFAULT 0.90;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS ibs_aliquota numeric DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS cbs_aliquota numeric DEFAULT 0.90;

ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS ibs_aliquota numeric DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS cbs_aliquota numeric DEFAULT 0.90;

UPDATE products SET ibs_aliquota = COALESCE(ibs_aliquota, 0.10),
                    cbs_aliquota = COALESCE(cbs_aliquota, 0.90);
UPDATE services SET ibs_aliquota = COALESCE(ibs_aliquota, 0.10),
                    cbs_aliquota = COALESCE(cbs_aliquota, 0.90);
UPDATE dishes   SET ibs_aliquota = COALESCE(ibs_aliquota, 0.10),
                    cbs_aliquota = COALESCE(cbs_aliquota, 0.90);

-- Pipeline NFC-e: nf_invoice_items precisa carregar o valor entre a resolução
-- fiscal e a emissão real, igual ao que já existe para ibs_cbs_cst/cclasstrib.
ALTER TABLE nf_invoice_items
  ADD COLUMN IF NOT EXISTS ibs_aliquota numeric,
  ADD COLUMN IF NOT EXISTS cbs_aliquota numeric;
