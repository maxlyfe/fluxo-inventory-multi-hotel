-- Desconto incondicional por item da nota.
--
-- Motivo: nao havia como emitir nota com item de cortesia. A tela exigia valor
-- maior que zero ("Informe o valor de ..."), e zerar o valor unitario tambem nao
-- serve: alem de a SEFAZ recusar produto com valor zero, isso apagaria da nota o
-- preco real do item.
--
-- A forma fiscal correta e o desconto incondicional: o item sai na nota com o
-- valor cheio em <vProd> e o mesmo valor em <vDesc>. A saida do produto fica
-- registrada, e o valor cobrado e zero.
--
-- Desconto incondicional NAO compoe base de calculo, entao o builder tambem
-- reduz as bases de ICMS, PIS/COFINS e IBS/CBS na mesma proporcao. Um item de
-- cortesia gera tributo zero.
--
-- Serve igualmente para desconto parcial: o campo guarda o valor em reais, e a
-- tela permite informar em percentual, convertendo antes de salvar.

ALTER TABLE nf_invoice_items
  ADD COLUMN IF NOT EXISTS desconto numeric(12,2);

COMMENT ON COLUMN nf_invoice_items.desconto IS
  'Desconto incondicional do item em R$. Vira <vDesc> no XML, reduz o total da nota e nao compoe base de calculo de tributo. Igual ao valor total do item = cortesia.';
