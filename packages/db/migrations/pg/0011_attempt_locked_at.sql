-- Phase 7e Task 3 (`E-R1`): the sqlite/0011_attempt_locked_at.sql sibling.
-- Nullable, so Postgres needs no DEFAULT either — every attempt written
-- before this migration reads back "not locked" on both dialects.
ALTER TABLE "attempt" ADD COLUMN "locked_at" bigint;
