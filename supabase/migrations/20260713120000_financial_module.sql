-- Financial Module Migration
-- Creates: bank_accounts, card_acquirers, card_acquirer_rules, channel_receiving_rules,
--          ap_titles, ap_payments, ar_titles, ar_receipts, money_inflows,
--          payroll_entries, recurring_expenses
-- Adds: suppliers.default_chart_account_sub_id

-- 1. Bank accounts
CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name text NOT NULL,
  bank_name text,
  account_type text NOT NULL DEFAULT 'corrente' CHECK (account_type IN ('corrente','poupanca','caixa')),
  initial_balance numeric(14,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_hotel ON bank_accounts(hotel_id);

-- 2. Card acquirers (Cielo, Stone, ...)
CREATE TABLE IF NOT EXISTS card_acquirers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_card_acquirers_hotel ON card_acquirers(hotel_id);

-- 3. Fee/settlement rules per acquirer + brand + modality + installment range
CREATE TABLE IF NOT EXISTS card_acquirer_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acquirer_id uuid NOT NULL REFERENCES card_acquirers(id) ON DELETE CASCADE,
  card_brand text NOT NULL DEFAULT 'outros' CHECK (card_brand IN ('visa','master','elo','amex','hipercard','outros')),
  modality text NOT NULL DEFAULT 'credito' CHECK (modality IN ('debito','credito')),
  installment_from integer NOT NULL DEFAULT 1,
  installment_to integer NOT NULL DEFAULT 1,
  fee_percent numeric(6,3) NOT NULL DEFAULT 0,
  settlement_days integer NOT NULL DEFAULT 30,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_card_acquirer_rules_acquirer ON card_acquirer_rules(acquirer_id);

-- 4. Receiving rules per sales channel
CREATE TABLE IF NOT EXISTS channel_receiving_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  channel text NOT NULL,
  trigger_event text NOT NULL DEFAULT 'checkout' CHECK (trigger_event IN ('checkout','checkin','faturamento')),
  days_to_receive integer NOT NULL DEFAULT 0,
  receiving_method text NOT NULL DEFAULT 'deposito' CHECK (receiving_method IN ('deposito','cartao')),
  acquirer_id uuid REFERENCES card_acquirers(id) ON DELETE SET NULL,
  default_fee_percent numeric(6,3) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (hotel_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_channel_rules_hotel ON channel_receiving_rules(hotel_id);

-- 5. Accounts payable titles (1 row = 1 installment)
CREATE TABLE IF NOT EXISTS ap_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  description text NOT NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  chart_account_sub_id uuid REFERENCES chart_of_accounts_sub(id) ON DELETE SET NULL,
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('purchase','manual','payroll','recurring','loan')),
  origin_id uuid,
  installment_number integer NOT NULL DEFAULT 1,
  installment_total integer NOT NULL DEFAULT 1,
  amount numeric(14,2) NOT NULL,
  amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  issue_date date,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','parcial','pago','cancelado')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
-- NULL origin_id rows are always distinct (Postgres treats NULLs as unequal)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_titles_origin
  ON ap_titles(origin, origin_id, installment_number);
CREATE INDEX IF NOT EXISTS idx_ap_titles_hotel_due ON ap_titles(hotel_id, due_date);
CREATE INDEX IF NOT EXISTS idx_ap_titles_hotel_status ON ap_titles(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_ap_titles_supplier ON ap_titles(supplier_id);

-- 6. AP payments
CREATE TABLE IF NOT EXISTS ap_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ap_title_id uuid NOT NULL REFERENCES ap_titles(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'pix' CHECK (payment_method IN ('pix','boleto','transferencia','cartao','dinheiro','cheque')),
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ap_payments_title ON ap_payments(ap_title_id);
CREATE INDEX IF NOT EXISTS idx_ap_payments_hotel_date ON ap_payments(hotel_id, payment_date);

-- Trigger: recalc ap_titles.amount_paid + status on payment insert/delete
CREATE OR REPLACE FUNCTION fn_recalc_ap_title()
RETURNS trigger AS $$
DECLARE
  v_title_id uuid;
  v_paid numeric(14,2);
  v_amount numeric(14,2);
  v_status text;
BEGIN
  v_title_id := COALESCE(NEW.ap_title_id, OLD.ap_title_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM ap_payments WHERE ap_title_id = v_title_id;
  SELECT amount, status INTO v_amount, v_status FROM ap_titles WHERE id = v_title_id;
  IF v_status IS DISTINCT FROM 'cancelado' THEN
    UPDATE ap_titles SET
      amount_paid = v_paid,
      status = CASE WHEN v_paid >= v_amount THEN 'pago' WHEN v_paid > 0 THEN 'parcial' ELSE 'aberto' END,
      updated_at = now()
    WHERE id = v_title_id;
  ELSE
    UPDATE ap_titles SET amount_paid = v_paid, updated_at = now() WHERE id = v_title_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalc_ap_title ON ap_payments;
CREATE TRIGGER trg_recalc_ap_title
  AFTER INSERT OR DELETE ON ap_payments
  FOR EACH ROW EXECUTE FUNCTION fn_recalc_ap_title();

-- 7. Accounts receivable titles
CREATE TABLE IF NOT EXISTS ar_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  description text,
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('erbon','omnibees','manual','inflow')),
  origin_ref text,
  channel text,
  gross_amount numeric(14,2) NOT NULL,
  fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_amount numeric(14,2) NOT NULL,
  amount_received numeric(14,2) NOT NULL DEFAULT 0,
  expected_date date NOT NULL,
  status text NOT NULL DEFAULT 'previsto' CHECK (status IN ('previsto','parcial','recebido','cancelado')),
  acquirer_id uuid REFERENCES card_acquirers(id) ON DELETE SET NULL,
  card_brand text,
  installments integer,
  installment_number integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_titles_origin
  ON ar_titles(origin, origin_ref, installment_number);
CREATE INDEX IF NOT EXISTS idx_ar_titles_hotel_expected ON ar_titles(hotel_id, expected_date);
CREATE INDEX IF NOT EXISTS idx_ar_titles_hotel_status ON ar_titles(hotel_id, status);

-- 8. AR receipts
CREATE TABLE IF NOT EXISTS ar_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ar_title_id uuid NOT NULL REFERENCES ar_titles(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'pix' CHECK (payment_method IN ('pix','boleto','transferencia','cartao','dinheiro','cheque')),
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ar_receipts_title ON ar_receipts(ar_title_id);
CREATE INDEX IF NOT EXISTS idx_ar_receipts_hotel_date ON ar_receipts(hotel_id, receipt_date);

CREATE OR REPLACE FUNCTION fn_recalc_ar_title()
RETURNS trigger AS $$
DECLARE
  v_title_id uuid;
  v_received numeric(14,2);
  v_net numeric(14,2);
  v_status text;
BEGIN
  v_title_id := COALESCE(NEW.ar_title_id, OLD.ar_title_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_received FROM ar_receipts WHERE ar_title_id = v_title_id;
  SELECT net_amount, status INTO v_net, v_status FROM ar_titles WHERE id = v_title_id;
  IF v_status IS DISTINCT FROM 'cancelado' THEN
    UPDATE ar_titles SET
      amount_received = v_received,
      status = CASE WHEN v_received >= v_net THEN 'recebido' WHEN v_received > 0 THEN 'parcial' ELSE 'previsto' END,
      updated_at = now()
    WHERE id = v_title_id;
  ELSE
    UPDATE ar_titles SET amount_received = v_received, updated_at = now() WHERE id = v_title_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalc_ar_title ON ar_receipts;
CREATE TRIGGER trg_recalc_ar_title
  AFTER INSERT OR DELETE ON ar_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_recalc_ar_title();

-- 9. Other money inflows (external income, capital injection, loans)
CREATE TABLE IF NOT EXISTS money_inflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'ingresso_externo' CHECK (type IN ('ingresso_externo','aporte','emprestimo','outros')),
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  inflow_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text CHECK (payment_method IN ('pix','boleto','transferencia','cartao','dinheiro','cheque')),
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  -- loan repayment fields
  repayment_installments integer,
  first_due_date date,
  installment_amount numeric(14,2),
  interest_percent numeric(6,3),
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_money_inflows_hotel_date ON money_inflows(hotel_id, inflow_date);

-- 10. Payroll per employee per month
CREATE TABLE IF NOT EXISTS payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  competence date NOT NULL, -- first day of month
  base_salary numeric(14,2) NOT NULL DEFAULT 0,
  encargos numeric(14,2) NOT NULL DEFAULT 0,
  beneficios numeric(14,2) NOT NULL DEFAULT 0,
  descontos numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) GENERATED ALWAYS AS (base_salary + encargos + beneficios - descontos) STORED,
  due_date date NOT NULL,
  chart_account_sub_id uuid REFERENCES chart_of_accounts_sub(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'previsto' CHECK (status IN ('previsto','lancado')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (hotel_id, employee_id, competence)
);
CREATE INDEX IF NOT EXISTS idx_payroll_hotel_competence ON payroll_entries(hotel_id, competence);

-- 11. Recurring expense templates
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  frequency text NOT NULL DEFAULT 'mensal' CHECK (frequency IN ('semanal','quinzenal','mensal','anual')),
  due_day integer NOT NULL DEFAULT 5 CHECK (due_day BETWEEN 1 AND 31),
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  chart_account_sub_id uuid REFERENCES chart_of_accounts_sub(id) ON DELETE SET NULL,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurring_hotel ON recurring_expenses(hotel_id);

-- 12. Supplier default chart of accounts
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS default_chart_account_sub_id uuid REFERENCES chart_of_accounts_sub(id) ON DELETE SET NULL;

-- 13. RLS (same pattern as other financial tables: all authenticated)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bank_accounts','card_acquirers','card_acquirer_rules','channel_receiving_rules',
    'ap_titles','ap_payments','ar_titles','ar_receipts','money_inflows',
    'payroll_entries','recurring_expenses'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_all_authenticated" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%s_all_authenticated" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;
