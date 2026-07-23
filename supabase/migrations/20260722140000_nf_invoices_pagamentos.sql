-- Múltiplas formas de pagamento na NFC-e/NF-e: array [{tPag, vPag}] (grupo <pag>
-- com vários <detPag>). Mantém forma_pagamento (código único) para compat/legado.
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS pagamentos jsonb;
