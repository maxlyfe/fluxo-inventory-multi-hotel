-- Migration: setor de destino na transferência de colaborador entre hotéis
-- Ao escalar um colaborador em outra unidade (entry_type = 'transfer'),
-- registra em qual SETOR do hotel destino ele vai atuar. O hotel destino
-- renderiza o visitante dentro do bloco desse setor na escala.

ALTER TABLE public.schedule_entries
  ADD COLUMN IF NOT EXISTS transfer_sector text;
