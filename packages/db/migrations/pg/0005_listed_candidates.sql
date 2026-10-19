-- Phase 5 Task 9 (#60 / #56, P5.7b): the sqlite/0005_cold_list.sql sibling.
-- Postgres needs no table rebuild — it can drop a NOT NULL in place, and a
-- NOT NULL column is added nullable, backfilled, then promoted, exactly the
-- shape 0004 used for `test.short_code`. No DEFAULT is left behind, so the
-- column matches `schema/pg.ts`, which declares none.
ALTER TABLE "candidate" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "set_label" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "source" text;--> statement-breakpoint
UPDATE "candidate" SET "source" = 'registration' WHERE "source" IS NULL;--> statement-breakpoint
ALTER TABLE "candidate" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate" ALTER COLUMN "consent_version" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_test_external_uq" ON "candidate" USING btree ("test_id","external_id");
