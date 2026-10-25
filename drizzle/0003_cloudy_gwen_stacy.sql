CREATE TABLE "account_update_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_fields" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_ledger_id" uuid NOT NULL,
	"compliance_region" text NOT NULL,
	"rule_code" text NOT NULL,
	"status" text DEFAULT 'flagged' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_limits" (
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
--> statement-breakpoint
CREATE TABLE "webhook_events" (
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
--> statement-breakpoint
ALTER TABLE "telecom_transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(20, 8);--> statement-breakpoint
ALTER TABLE "wallet_ledger" ALTER COLUMN "amount" SET DATA TYPE numeric(20, 8);--> statement-breakpoint
ALTER TABLE "wallet_ledger" ALTER COLUMN "balance_before" SET DATA TYPE numeric(20, 8);--> statement-breakpoint
ALTER TABLE "wallet_ledger" ALTER COLUMN "balance_after" SET DATA TYPE numeric(20, 8);--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "available_balance" SET DATA TYPE numeric(20, 8);--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "available_balance" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "locked_balance" SET DATA TYPE numeric(20, 8);--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "locked_balance" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_currency" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "compliance_region" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "data_localization_region" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "compliance_tier" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telecom_reloadly_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD COLUMN "currency_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "account_update_requests" ADD CONSTRAINT "account_update_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_flags" ADD CONSTRAINT "compliance_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_flags" ADD CONSTRAINT "compliance_flags_wallet_ledger_id_wallet_ledger_id_fk" FOREIGN KEY ("wallet_ledger_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_update_requests_user_id_idx" ON "account_update_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_update_requests_status_idx" ON "account_update_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "account_update_requests_created_at_idx" ON "account_update_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "compliance_flags_user_id_idx" ON "compliance_flags" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_flags_ledger_id_unique" ON "compliance_flags" USING btree ("wallet_ledger_id","rule_code");--> statement-breakpoint
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_tickets_created_at_idx" ON "support_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_limits_region_tier_unique" ON "transaction_limits" USING btree ("compliance_region","compliance_tier","currency_code");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_ref_unique" ON "webhook_events" USING btree ("provider","reference","event_type");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events" USING btree ("created_at");