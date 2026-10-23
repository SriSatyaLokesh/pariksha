-- Phase 7e Task 1 fix round (F2, Major, code review of #213): the
-- sqlite/0010_violation_limit_claim.sql sibling. Postgres supports the same
-- partial unique index and the same `ON CONFLICT (attempt_id) WHERE type =
-- 'violation_limit_reached' DO NOTHING` conflict target.
CREATE UNIQUE INDEX "event_violation_limit_uq" ON "event" USING btree ("attempt_id") WHERE "type" = 'violation_limit_reached';
