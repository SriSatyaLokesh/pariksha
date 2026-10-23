-- Phase 7e Task 1 fix round (F2, Major, code review of #213): the atomic
-- claim that makes "the violation limit fires once" true under concurrency,
-- not just in sequence.
--
-- `claimViolationLimit` (packages/db/src/repo/attempts.ts) used to be a
-- `SELECT COUNT(*)` read, several lines before a conditional `INSERT` in the
-- ingest route — a plain read-then-write race. Two concurrent posts for the
-- same attempt, both past the limit, could both read "not yet fired" and
-- both fire the configured action, which auto-submits or locks a candidate
-- twice once Tasks 2 and 3 wire those actions to this outcome.
--
-- This partial unique index is the conflict target `INSERT … ON CONFLICT
-- (attempt_id) WHERE type = 'violation_limit_reached' DO NOTHING` names:
-- whichever of two concurrent inserts the database serialises first is the
-- only one that ever gets a row back.
--
-- Filtered to this one event type on purpose, not a plain unique on
-- `(attempt_id, type)`: an attempt can carry many rows of every other type
-- (`window_blur`, `camera_lost`, …) and a non-partial unique would refuse
-- every one of those after the first.
-- Branch-review C1: issue #227 left `violation_limit_reached` candidate-
-- submittable on `main` since Phase 7a (the event schema was the whole
-- 17-member union, not just the proctoring-engine-only subset), so live D1
-- may already hold two or more rows of this type for the same `attempt_id`.
-- A `CREATE UNIQUE INDEX` over that state aborts outright — `migrate()`
-- records a migration only after its statements succeed, so the ledger
-- would stay at 10, `0011` would never run, and the auto-deploy would ship
-- a Drizzle schema declaring `attempt.locked_at` against a table that does
-- not have it (the `0008` scar, reproduced). This delete makes the
-- migration correct whether or not duplicates exist, so no production read
-- is needed first: zero duplicates makes it a no-op scan; any duplicates
-- are resolved by keeping the earliest `server_ts` per `attempt_id`
-- (tie-broken by `id`, which is 60 random bits with no time component and
-- would otherwise keep an arbitrary row) and deleting the rest.
-- Accepted trade: deleting duplicates also erases the forensic signal that
-- #227 was ever exercised in production — the markers are indistinguishable
-- from each other as evidence, so "did a candidate actually forge markers?"
-- becomes permanently unanswerable after this runs.
DELETE FROM `event`
WHERE `type` = 'violation_limit_reached'
  AND EXISTS (
    SELECT 1 FROM `event` AS `keep`
    WHERE `keep`.`type` = 'violation_limit_reached'
      AND `keep`.`attempt_id` = `event`.`attempt_id`
      AND (`keep`.`server_ts` < `event`.`server_ts`
           OR (`keep`.`server_ts` = `event`.`server_ts` AND `keep`.`id` < `event`.`id`))
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `event_violation_limit_uq` ON `event` (`attempt_id`) WHERE `type` = 'violation_limit_reached';
