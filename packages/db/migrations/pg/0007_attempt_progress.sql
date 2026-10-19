-- Phase 6 Task 5 (#69, P6.5): the sqlite/0007_attempt_progress.sql sibling.
-- Postgres needs no DEFAULT to add a NOT NULL column to a populated table,
-- but it carries the same one so the two dialects agree on what an attempt
-- written before this migration has reached.
ALTER TABLE "attempt" ADD COLUMN "max_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "section_started_at" bigint;
