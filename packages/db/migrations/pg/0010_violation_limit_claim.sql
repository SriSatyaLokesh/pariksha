-- Phase 7e Task 1 fix round (F2, Major, code review of #213): the
-- sqlite/0010_violation_limit_claim.sql sibling. Postgres supports the same
-- partial unique index and the same `ON CONFLICT (attempt_id) WHERE type =
-- 'violation_limit_reached' DO NOTHING` conflict target.
-- Branch-review C1: the sqlite/0010_violation_limit_claim.sql sibling's own
-- comment — issue #227 left this marker candidate-submittable on `main`
-- since Phase 7a, so live data may already hold duplicates for one
-- `attempt_id`, which a unique index would abort against. This delete keeps
-- the earliest `server_ts` per `attempt_id` (tie-broken by `id`) and is
-- correct whether or not duplicates exist. Accepted trade: it also erases
-- the forensic signal that #227 was ever exercised in production.
DELETE FROM "event"
WHERE "type" = 'violation_limit_reached'
  AND EXISTS (
    SELECT 1 FROM "event" AS "keep"
    WHERE "keep"."type" = 'violation_limit_reached'
      AND "keep"."attempt_id" = "event"."attempt_id"
      AND ("keep"."server_ts" < "event"."server_ts"
           OR ("keep"."server_ts" = "event"."server_ts" AND "keep"."id" < "event"."id"))
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "event_violation_limit_uq" ON "event" USING btree ("attempt_id") WHERE "type" = 'violation_limit_reached';
