CREATE TABLE "telecom_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"internal_reference" text NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"product_type" text NOT NULL,
	"network" text NOT NULL,
	"mobile_number" text NOT NULL,
	"plan_code" text,
	"amount" numeric(18, 2) NOT NULL,
	"status" text NOT NULL,
	"request_payload" jsonb,
	"provider_response" jsonb,
	"last_error" text,
	"attempts" numeric(10, 0) DEFAULT '0' NOT NULL,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telecom_transactions" ADD CONSTRAINT "telecom_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telecom_transactions" ADD CONSTRAINT "telecom_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telecom_transactions_internal_reference_unique" ON "telecom_transactions" USING btree ("internal_reference");--> statement-breakpoint
CREATE INDEX "telecom_transactions_user_id_idx" ON "telecom_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telecom_transactions_wallet_id_idx" ON "telecom_transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "telecom_transactions_status_idx" ON "telecom_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "telecom_transactions_next_retry_at_idx" ON "telecom_transactions" USING btree ("next_retry_at");