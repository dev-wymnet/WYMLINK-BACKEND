CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_admin_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip" text,
	"user_agent" text,
	"success" boolean DEFAULT true NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "session_type" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revoked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_admin_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_type_idx" ON "sessions" USING btree ("session_type");--> statement-breakpoint
CREATE INDEX "sessions_revoked_idx" ON "sessions" USING btree ("revoked");