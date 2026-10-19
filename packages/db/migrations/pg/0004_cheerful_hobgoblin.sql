-- Phase 5 Task 2 (#54): the sqlite.ts/0004_cold_blob.sql sibling. Postgres
-- needs no table rebuild — unlike SQLite it allows a column added nullable,
-- backfilled, then promoted to NOT NULL in separate statements, so
-- `short_code` is corrected that way instead of drizzle-kit's own
-- `ADD COLUMN short_code text NOT NULL` (which Postgres rejects on any row
-- already present, same restriction SQLite has). `review_requested` and
-- `test_version.created_at` only need a literal DEFAULT, which Postgres does
-- accept straight through `ADD COLUMN`.
ALTER TABLE "test" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "test" ADD COLUMN "short_code" text;--> statement-breakpoint
UPDATE "test" SET "short_code" = substr("id", 5, 6) WHERE "short_code" IS NULL;--> statement-breakpoint
ALTER TABLE "test" ALTER COLUMN "short_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "test" ADD COLUMN "review_requested" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "test" ADD COLUMN "updated_at" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "test_short_code_uq" ON "test" USING btree ("short_code");--> statement-breakpoint
ALTER TABLE "test_version" ADD COLUMN "created_at" bigint NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE "test_version" SET "created_at" = "published_at" WHERE "published_at" IS NOT NULL;
