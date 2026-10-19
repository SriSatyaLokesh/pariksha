-- Phase 6 Task 3 (#67, P6.3): consent capture, unique registration fields
-- and the rate-limit window.
--
-- `candidate.consent_at` is the moment the candidate accepted (`S-12`), and
-- is also the definition of *registered* now that a registration fills the
-- matched `source = 'list'` row in place rather than inserting beside it —
-- see the comment on the table in `src/schema/columns.ts`.
--
-- `candidate_unique` is `T-17`'s "a second registration with the same value
-- is refused": a JSON column cannot carry a portable unique index, so the
-- claim is a row, and the value is a SHA-256 of the normalised value so the
-- table does not become a second plaintext copy of every candidate's email
-- (`S-15`).
--
-- `rate_limit` is untenanted, like `auth_token`: the `/t/:code` miss bucket
-- is a six-character code with no workspace behind it.
--
-- Hand-written rather than taken from `drizzle-kit generate` verbatim, for
-- the reason 0004 and 0005 record: SQLite refuses `ALTER TABLE … ADD … NOT
-- NULL` without a literal DEFAULT. Every column added here is nullable, so
-- no table rebuild is needed this time.
--
-- No PRAGMA foreign_keys: D1 ignores it silently and
-- `no-d1-hostile-sql.test.ts` refuses it.
ALTER TABLE `candidate` ADD `consent_at` integer;--> statement-breakpoint
CREATE TABLE `candidate_unique` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`test_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`field_id` text NOT NULL,
	`value_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `candidate_unique_workspace_idx` ON `candidate_unique` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `candidate_unique_test_idx` ON `candidate_unique` (`test_id`);--> statement-breakpoint
CREATE INDEX `candidate_unique_candidate_idx` ON `candidate_unique` (`candidate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_unique_value_uq` ON `candidate_unique` (`test_id`,`field_id`,`value_hash`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`bucket` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_window_idx` ON `rate_limit` (`window_start`);
