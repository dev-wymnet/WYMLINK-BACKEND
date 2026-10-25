-- Create user_verifications table
CREATE TABLE IF NOT EXISTS user_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  bvn text NULL,
  bvn_suffix text NULL,
  bvn_status text NOT NULL DEFAULT 'PENDING',
  bvn_verified_at timestamptz NULL,
  bvn_provider_reference text NULL,
  bvn_failure_reason text NULL,

  nin text NULL,
  nin_suffix text NULL,
  nin_status text NOT NULL DEFAULT 'PENDING',
  nin_verified_at timestamptz NULL,
  nin_provider_reference text NULL,
  nin_failure_reason text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique one row per user
CREATE UNIQUE INDEX IF NOT EXISTS user_verifications_user_unique
  ON user_verifications(user_id);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS user_verifications_user_id_idx
  ON user_verifications(user_id);
CREATE INDEX IF NOT EXISTS user_verifications_bvn_status_idx
  ON user_verifications(bvn_status);
CREATE INDEX IF NOT EXISTS user_verifications_nin_status_idx
  ON user_verifications(nin_status);

-- Updated-at trigger to keep timestamps fresh
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_verifications_set_updated_at ON user_verifications;
CREATE TRIGGER user_verifications_set_updated_at
BEFORE UPDATE ON user_verifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
