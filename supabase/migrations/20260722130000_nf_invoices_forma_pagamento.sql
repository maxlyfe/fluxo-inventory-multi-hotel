-- Forma de pagamento (tPag) informada na emissão de NFC-e/NF-e, para exibir no
-- cupom e na reimpressão. NFS-e (ABRASF) não tem forma de pagamento.
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS forma_pagamento text;
