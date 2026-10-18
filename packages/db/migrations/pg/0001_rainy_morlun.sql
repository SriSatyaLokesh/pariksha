CREATE TABLE "auth_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint
);
--> statement-breakpoint
CREATE INDEX "auth_token_expires_idx" ON "auth_token" USING btree ("expires_at");