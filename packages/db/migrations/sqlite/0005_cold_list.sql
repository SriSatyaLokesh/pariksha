-- Phase 5 Task 9 (#60 / #56, P5.7b): the candidate list. `candidate` gains
-- `external_id` (the value of the test's first `unique: true` registration
-- field), `set_label` (T-09's set *name*, not `attempt.set_no`) and `source`
-- ("list" or "registration", so a re-upload replaces only what it owns), and
-- `consent_version` stops being NOT NULL — a listed candidate has not
-- consented yet, and null is exactly that.
--
-- Hand-written rather than taken from `drizzle-kit generate` verbatim, for
-- the reason 0004 records: SQLite cannot drop a NOT NULL constraint with
-- ALTER TABLE at all, and cannot add a NOT NULL column (`source`) without a
-- literal DEFAULT. The table is rebuilt instead, the same twelve-step shape
-- 0003 used for `question.ref_id` and 0004 for `test`. Nothing writes a
-- `candidate` row before this phase ships — Phase 6 registers candidates and
-- this task uploads lists — so in practice the rebuild moves no rows; the
-- backfilled `source = 'registration'` below exists only to keep the rebuilt
-- table consistent with its own NOT NULL for the case where one exists.
--
-- `(test_id, external_id)` is unique, following `question`'s
-- `(bank_id, ref_id)`: a duplicate identity in an uploaded file is a
-- positioned error, and a re-upload is idempotent. Null external_ids do not
-- collide in either dialect, which is what lets Phase 6's self-registrations
-- sit in the same table unkeyed.
--
-- No PRAGMA foreign_keys here: D1 ignores it silently and
-- `no-d1-hostile-sql.test.ts` refuses it.
CREATE TABLE `__new_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`test_id` text NOT NULL,
	`external_id` text,
	`set_label` text,
	`source` text NOT NULL,
	`form_values_json` text NOT NULL,
	`consent_version` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_candidate` ("id", "workspace_id", "test_id", "source", "form_values_json", "consent_version", "created_at") SELECT "id", "workspace_id", "test_id", 'registration', "form_values_json", "consent_version", "created_at" FROM `candidate`;--> statement-breakpoint
DROP TABLE `candidate`;--> statement-breakpoint
ALTER TABLE `__new_candidate` RENAME TO `candidate`;--> statement-breakpoint
CREATE INDEX `candidate_workspace_idx` ON `candidate` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `candidate_test_idx` ON `candidate` (`test_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_test_external_uq` ON `candidate` (`test_id`,`external_id`);
