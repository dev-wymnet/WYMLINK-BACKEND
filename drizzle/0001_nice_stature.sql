CREATE TABLE "monnify_reserved_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"account_reference" text NOT NULL,
	"reservation_reference" text,
	"status" text,
	"bank_code" text,
	"bank_name" text,
	"account_number" text,
	"account_name" text,
	"raw_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_type" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_before" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"reference_code" text NOT NULL,
	"related_order_id" text,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"currency_code" text NOT NULL,
	"available_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"locked_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monnify_reserved_accounts" ADD CONSTRAINT "monnify_reserved_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monnify_reserved_accounts" ADD CONSTRAINT "monnify_reserved_accounts_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monnify_reserved_accounts_user_id_idx" ON "monnify_reserved_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monnify_reserved_accounts_wallet_id_unique" ON "monnify_reserved_accounts" USING btree ("wallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monnify_reserved_accounts_account_reference_unique" ON "monnify_reserved_accounts" USING btree ("account_reference");--> statement-breakpoint
CREATE INDEX "wallet_ledger_wallet_id_idx" ON "wallet_ledger" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_user_id_idx" ON "wallet_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_ledger_reference_unique" ON "wallet_ledger" USING btree ("reference_code");--> statement-breakpoint
CREATE INDEX "wallet_ledger_created_at_idx" ON "wallet_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wallets_user_id_idx" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_currency_unique" ON "wallets" USING btree ("user_id","currency_code");