-- Phase 12: BYOK encrypted provider credentials and usage telemetry (S-15).
CREATE TABLE IF NOT EXISTS "byok_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hint" text NOT NULL,
	"spend_limit_cents" integer,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"last_used_at" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "byok_credential_workspace_idx" ON "byok_credential" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "byok_credential_workspace_provider_uq" ON "byok_credential" USING btree ("workspace_id", "provider");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "byok_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"estimated_cost_cents" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "byok_usage_workspace_idx" ON "byok_usage" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "byok_usage_workspace_created_idx" ON "byok_usage" USING btree ("workspace_id", "created_at");
