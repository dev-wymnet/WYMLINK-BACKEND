CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency_code" text NOT NULL,
	"destination_bank_code" text NOT NULL,
	"destination_account_number" text NOT NULL,
	"destination_account_name" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider" text,
	"provider_reference" text,
	"last_error" text,
	"attempts" numeric(10, 0) DEFAULT '0' NOT NULL,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bvn" text,
	"bvn_suffix" text,
	"bvn_status" text DEFAULT 'PENDING' NOT NULL,
	"bvn_verified_at" timestamp with time zone,
	"bvn_provider_reference" text,
	"bvn_failure_reason" text,
	"nin" text,
	"nin_suffix" text,
	"nin_status" text DEFAULT 'PENDING' NOT NULL,
	"nin_verified_at" timestamp with time zone,
	"nin_provider_reference" text,
	"nin_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_verifications" ADD CONSTRAINT "user_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_reference_unique" ON "payouts" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "payouts_user_id_idx" ON "payouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payouts_wallet_id_idx" ON "payouts" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payouts_created_at_idx" ON "payouts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_verifications_user_unique" ON "user_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_verifications_user_id_idx" ON "user_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_verifications_bvn_status_idx" ON "user_verifications" USING btree ("bvn_status");--> statement-breakpoint
CREATE INDEX "user_verifications_nin_status_idx" ON "user_verifications" USING btree ("nin_status");