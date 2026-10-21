-- Phase 7a Task 3 (Q6): the sqlite/0008_attempt_integrity.sql sibling.
-- Postgres needs no DEFAULT to add a NOT NULL column to a populated table,
-- but it carries the same ones so an attempt written before this migration
-- reads back "clean" and watched on both dialects, not just SQLite.
ALTER TABLE "attempt" ADD COLUMN "integrity_flag" text DEFAULT 'clean' NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "observed" boolean DEFAULT true NOT NULL;
