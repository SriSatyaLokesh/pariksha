-- Phase 6 Task 3 (#67, P6.3): the sqlite/0006_candid_registration.sql
-- sibling. Every column added is nullable or on a new table, so there is no
-- backfill-then-promote step here.
ALTER TABLE "candidate" ADD COLUMN "consent_at" bigint;--> statement-breakpoint
CREATE TABLE "candidate_unique" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"test_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value_hash" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "candidate_unique_workspace_idx" ON "candidate_unique" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "candidate_unique_test_idx" ON "candidate_unique" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "candidate_unique_candidate_idx" ON "candidate_unique" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_unique_value_uq" ON "candidate_unique" USING btree ("test_id","field_id","value_hash");--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_window_idx" ON "rate_limit" USING btree ("window_start");
