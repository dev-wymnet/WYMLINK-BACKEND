-- Create payouts table
CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  reference text NOT NULL,
  amount numeric(20,8) NOT NULL,
  currency_code text NOT NULL,
  destination_bank_code text NOT NULL,
  destination_account_number text NOT NULL,
  destination_account_name text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  provider text NULL,
  provider_reference text NULL,
  last_error text NULL,
  attempts numeric(10,0) NOT NULL DEFAULT 0,
  next_retry_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payouts_reference_unique ON payouts(reference);
CREATE INDEX IF NOT EXISTS payouts_user_id_idx ON payouts(user_id);
CREATE INDEX IF NOT EXISTS payouts_wallet_id_idx ON payouts(wallet_id);
CREATE INDEX IF NOT EXISTS payouts_status_idx ON payouts(status);
CREATE INDEX IF NOT EXISTS payouts_created_at_idx ON payouts(created_at);

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payouts_set_updated_at ON payouts;
CREATE TRIGGER payouts_set_updated_at
BEFORE UPDATE ON payouts
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
