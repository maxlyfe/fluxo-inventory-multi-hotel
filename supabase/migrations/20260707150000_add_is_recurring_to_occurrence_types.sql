-- Migration: tipos de ocorrência recorrentes (ex.: Férias, INSS)
-- Quando is_recurring = true, ao lançar na escala o modal pergunta "até quando"
-- e preenche todos os dias do intervalo com uma única ação.

ALTER TABLE public.occurrence_types
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;

-- Férias e INSS costumam ser períodos — marca como recorrentes por padrão
UPDATE public.occurrence_types
  SET is_recurring = true
  WHERE entry_type_key IN ('ferias', 'inss');
