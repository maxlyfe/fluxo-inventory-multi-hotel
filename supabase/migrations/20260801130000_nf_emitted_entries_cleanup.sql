-- Rastreio de lançamentos faturados: conserto dos registros órfãos
--
-- nf_emitted_entries guarda qual lançamento da Erbon já foi para uma nota.
-- Quando a NFS-e Nacional aceitava a DPS e depois era recusada na reconsulta,
-- a nota virava 'rejeitada' mas o rastreio ficava. A leitura ignora registro de
-- nota não autorizada (o lançamento volta para a fila), então a emissão
-- seguinte batia no UNIQUE (hotel_id, erbon_entry_id) e devolvia 409 DEPOIS de
-- a nota já ter sido autorizada no fisco — a tela mostrava falha e o operador
-- emitia de novo, gerando nota duplicada.
--
-- O código passou a apagar o rastreio na rejeição e a usar upsert na marcação.
-- Falta acertar o passado, e apagar tudo seria errado: parte desses lançamentos
-- JÁ foi para uma nota válida emitida depois (a marcação dela é que falhou no
-- 409). Então primeiro o rastreio é reapontado para a nota válida que contém o
-- mesmo lançamento, e só o que sobrar sem dono é apagado.

-- 1) Reaponta para a nota VÁLIDA mais recente que contém o mesmo lançamento.
UPDATE nf_emitted_entries e
SET invoice_id = sub.invoice_id
FROM (
  SELECT DISTINCT ON (i.hotel_id, it.erbon_entry_id)
         i.hotel_id,
         it.erbon_entry_id,
         i.id AS invoice_id
  FROM nf_invoice_items it
  JOIN nf_invoices i ON i.id = it.invoice_id
  WHERE it.erbon_entry_id IS NOT NULL
    AND i.status IN ('autorizada', 'contingencia', 'emitida')
  ORDER BY i.hotel_id, it.erbon_entry_id, i.created_at DESC
) sub
WHERE e.hotel_id = sub.hotel_id
  AND e.erbon_entry_id = sub.erbon_entry_id
  AND e.invoice_id <> sub.invoice_id
  AND EXISTS (
    SELECT 1 FROM nf_invoices i
    WHERE i.id = e.invoice_id
      AND i.status IN ('rejeitada', 'cancelada')
  );

-- 2) O que continuou preso a uma nota que não vale mais volta para a fila.
DELETE FROM nf_emitted_entries e
USING nf_invoices i
WHERE e.invoice_id = i.id
  AND i.status IN ('rejeitada', 'cancelada');
