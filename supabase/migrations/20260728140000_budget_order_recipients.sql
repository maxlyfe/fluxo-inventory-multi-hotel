-- ─────────────────────────────────────────────────────────────────────────────
-- Destinatários do pedido, um por fornecedor dentro do orçamento
--
-- Uma lista de compras pode ter itens de vários fornecedores, porque a análise
-- em /purchases/dynamic-budget/analysis manda todos os produtos escolhidos de
-- uma vez para /purchases/list. Enviar a imagem completa para um fornecedor
-- exporia o preço dos concorrentes, então o pedido é dividido: um envio por
-- fornecedor, com a imagem filtrada nos itens dele.
--
-- O vínculo é feito manualmente pelo operador em /purchases/list, não derivado
-- do nome digitado na cotação pública, que é texto livre e não confiável.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_order_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,

  -- Casa com budget_items.supplier, que é texto livre por item
  supplier_name   text NOT NULL,

  -- Destino: contato cadastrado OU número digitado direto. Pelo menos um.
  contact_id      uuid REFERENCES supplier_contacts(id) ON DELETE SET NULL,
  whatsapp_number text,

  -- Resultado do disparo automático na aprovação
  sent_at         timestamptz,
  sent_message_id text,
  send_error      text,
  send_attempts   integer NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (budget_id, supplier_name)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bor_has_destination') THEN
    ALTER TABLE budget_order_recipients
      ADD CONSTRAINT chk_bor_has_destination CHECK (
        contact_id IS NOT NULL OR nullif(btrim(whatsapp_number), '') IS NOT NULL
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bor_budget ON budget_order_recipients (budget_id);
CREATE INDEX IF NOT EXISTS idx_bor_contact ON budget_order_recipients (contact_id);
-- Pendentes de envio, usado pelo reenvio manual em /budget-history
CREATE INDEX IF NOT EXISTS idx_bor_unsent
  ON budget_order_recipients (budget_id)
  WHERE sent_at IS NULL;

ALTER TABLE budget_order_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_budget_order_recipients"
  ON budget_order_recipients FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Rastro no orçamento ─────────────────────────────────────────────────────
-- Permite saber, sem varrer os destinatários, se o pedido já foi disparado.
-- É o que decide se o status vai de 'approved' para 'on_the_way'.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS order_dispatched_at timestamptz;

-- Uma linha só de propósito: concatenação implícita de literais em linhas
-- separadas quebra quando o editor SQL junta as linhas antes de enviar.
COMMENT ON COLUMN budgets.order_dispatched_at IS 'Momento em que a imagem do pedido foi enviada aos fornecedores com contato. Preenchido no disparo automatico da aprovacao. NULL significa que o pedido segue em approved para tratamento manual.';
