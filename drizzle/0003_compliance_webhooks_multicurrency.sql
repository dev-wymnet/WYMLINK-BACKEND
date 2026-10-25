ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "region" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferred_currency" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "compliance_region" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "data_localization_region" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "compliance_tier" text;

ALTER TABLE "wallets" ALTER COLUMN "available_balance" TYPE numeric(20, 8);
ALTER TABLE "wallets" ALTER COLUMN "locked_balance" TYPE numeric(20, 8);

ALTER TABLE "wallet_ledger" ADD COLUMN IF NOT EXISTS "currency_code" text;
UPDATE "wallet_ledger" wl
SET "currency_code" = w."currency_code"
FROM "wallets" w
WHERE wl."wallet_id" = w."id" AND wl."currency_code" IS NULL;
ALTER TABLE "wallet_ledger" ALTER COLUMN "currency_code" SET NOT NULL;

ALTER TABLE "wallet_ledger" ALTER COLUMN "amount" TYPE numeric(20, 8);
ALTER TABLE "wallet_ledger" ALTER COLUMN "balance_before" TYPE numeric(20, 8);
ALTER TABLE "wallet_ledger" ALTER COLUMN "balance_after" TYPE numeric(20, 8);

ALTER TABLE "telecom_transactions" ALTER COLUMN "amount" TYPE numeric(20, 8);

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "event_type" text NOT NULL,
  "reference" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "retry_count" numeric(10, 0) DEFAULT '0' NOT NULL,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_ref_unique" ON "webhook_events" USING btree ("provider","reference","event_type");
CREATE INDEX IF NOT EXISTS "webhook_events_status_idx" ON "webhook_events" USING btree ("status");
CREATE INDEX IF NOT EXISTS "webhook_events_created_at_idx" ON "webhook_events" USING btree ("created_at");

CREATE TABLE IF NOT EXISTS "compliance_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "wallet_ledger_id" uuid NOT NULL,
  "compliance_region" text NOT NULL,
  "rule_code" text NOT NULL,
  "status" text DEFAULT 'flagged' NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'compliance_flags_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "compliance_flags"
    ADD CONSTRAINT "compliance_flags_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'compliance_flags_wallet_ledger_id_wallet_ledger_id_fk'
  ) THEN
    ALTER TABLE "compliance_flags"
    ADD CONSTRAINT "compliance_flags_wallet_ledger_id_wallet_ledger_id_fk"
    FOREIGN KEY ("wallet_ledger_id") REFERENCES "public"."wallet_ledger"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "compliance_flags_user_id_idx" ON "compliance_flags" USING btree ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_flags_ledger_id_unique" ON "compliance_flags" USING btree ("wallet_ledger_id","rule_code");

CREATE TABLE IF NOT EXISTS "transaction_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "compliance_region" text NOT NULL,
  "compliance_tier" text NOT NULL,
  "currency_code" text NOT NULL,
  "daily_limit" numeric(20, 8) NOT NULL,
  "monthly_limit" numeric(20, 8) NOT NULL,
  "transaction_limit" numeric(20, 8) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "transaction_limits_region_tier_unique" ON "transaction_limits" USING btree ("compliance_region","compliance_tier","currency_code");

INSERT INTO "transaction_limits" ("compliance_region", "compliance_tier", "currency_code", "daily_limit", "monthly_limit", "transaction_limit")
VALUES
  ('CBN', 'tier_1', 'NGN', 50000.00, 200000.00, 10000.00),
  ('CBN', 'tier_2', 'NGN', 200000.00, 1000000.00, 50000.00),
  ('CBN', 'tier_3', 'NGN', 1000000.00, 10000000.00, 500000.00)
ON CONFLICT DO NOTHING;
