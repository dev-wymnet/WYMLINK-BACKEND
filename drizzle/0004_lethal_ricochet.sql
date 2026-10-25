CREATE TABLE "training_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "training_registrations_email_phone_unique" ON "training_registrations" USING btree ("email","phone");--> statement-breakpoint
CREATE INDEX "training_registrations_created_at_idx" ON "training_registrations" USING btree ("created_at");