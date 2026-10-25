-- Create tables for account update requests and support tickets if missing

CREATE TABLE IF NOT EXISTS "account_update_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "requested_fields" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "admin_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_update_requests_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "account_update_requests"
    ADD CONSTRAINT "account_update_requests_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "account_update_requests_user_id_idx"
  ON "account_update_requests" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "account_update_requests_status_idx"
  ON "account_update_requests" USING btree ("status");
CREATE INDEX IF NOT EXISTS "account_update_requests_created_at_idx"
  ON "account_update_requests" USING btree ("created_at");


CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "subject" text NOT NULL,
  "message" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "support_tickets_user_id_idx"
  ON "support_tickets" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "support_tickets_status_idx"
  ON "support_tickets" USING btree ("status");
CREATE INDEX IF NOT EXISTS "support_tickets_created_at_idx"
  ON "support_tickets" USING btree ("created_at");
