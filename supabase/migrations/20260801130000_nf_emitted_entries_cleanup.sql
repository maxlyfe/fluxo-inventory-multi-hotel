-- Rastreio de lançamentos faturados: limpeza de registros órfãos
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
-- Esta migration limpa o que ficou para trás.

DELETE FROM nf_emitted_entries e
USING nf_invoices i
WHERE e.invoice_id = i.id
  AND i.status IN ('rejeitada', 'cancelada');
