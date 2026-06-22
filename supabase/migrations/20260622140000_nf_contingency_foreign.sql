-- =====================================================
-- NF-e / NFS-e — Contingência + Suporte a Estrangeiros
-- =====================================================

-- 1. Adicionar status 'contingencia' ao check constraint de nf_invoices
ALTER TABLE nf_invoices DROP CONSTRAINT IF EXISTS nf_invoices_status_check;
ALTER TABLE nf_invoices ADD CONSTRAINT nf_invoices_status_check
  CHECK (status IN ('rascunho','emitida','autorizada','rejeitada','cancelada','contingencia'));

-- 2. Campos para documento estrangeiro no tomador
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS tomador_doc_tipo TEXT DEFAULT 'cpf'
  CHECK (tomador_doc_tipo IN ('cpf','cnpj','passaporte'));
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS tomador_nacionalidade TEXT;

-- 3. Campos de contingência
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS contingencia_motivo TEXT;
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS numero_rps TEXT;
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS contingencia_protocolo TEXT;
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS contingencia_em TIMESTAMPTZ;
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS retransmitido_em TIMESTAMPTZ;
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
