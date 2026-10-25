CREATE TABLE "otp_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" numeric(10, 0) DEFAULT '0' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pin_security" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pin_type" text NOT NULL,
	"failed_attempts" numeric(10, 0) DEFAULT '0' NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "passcode_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "transaction_pin_hash" text;--> statement-breakpoint
ALTER TABLE "otp_requests" ADD CONSTRAINT "otp_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_security" ADD CONSTRAINT "pin_security_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_requests_user_id_idx" ON "otp_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otp_requests_purpose_idx" ON "otp_requests" USING btree ("purpose");--> statement-breakpoint
CREATE INDEX "otp_requests_expires_at_idx" ON "otp_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pin_security_user_type_unique" ON "pin_security" USING btree ("user_id","pin_type");--> statement-breakpoint
CREATE INDEX "pin_security_user_id_idx" ON "pin_security" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_device_id_idx" ON "sessions" USING btree ("device_id");