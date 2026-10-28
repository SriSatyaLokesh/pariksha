CREATE TABLE IF NOT EXISTS "team" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_workspace_idx" ON "team" USING btree ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_member" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "team_member_pkey" PRIMARY KEY ("team_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_member_user_idx" ON "team_member" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"team_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_grant_resource_uq" ON "team_grant" USING btree ("team_id", "resource_type", "resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_grant_workspace_resource_idx" ON "team_grant" USING btree ("workspace_id", "resource_type", "resource_id");
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN IF NOT EXISTS "created_by" text;
