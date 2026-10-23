-- Phase 8a Task 1 (K10, K42, K43): this phase's only migration, and it is
-- 0009 — verified free on main before writing it: Phase 7e is out of scope
-- and never created a 0009. A future 7e takes 0009 or later.
--
-- `webhook_delivery` is 8d's drain queue (K22): one row per delivery attempt
-- of one webhook event. The drain's only query is "deliveries due before
-- now", which is what `webhook_delivery_next_attempt_idx` is for.
--
-- K43 dropped two columns a draft of this table carried:
-- `attempt.proctor_message` and `.proctor_message_at` were 8g's broadcast
-- columns alone, and 8g is deferred together with 7e — shipping schema no
-- code reads yet is #186's defect in table form. They return with 8g.
--
-- The index on `response(workspace_id, question_id)` is here rather than in
-- 8b or 8c because both need it and both run in parallel (K42) — one of them
-- discovering mid-plan that it needs schema is the renumbering K10 exists to
-- prevent.
--
-- Both additions are a CREATE TABLE and CREATE INDEX statements, so the
-- "one ADD COLUMN per ALTER TABLE" rule (0004-0008) does not apply here —
-- there is no ALTER TABLE in this file. No PRAGMA of any kind either way:
-- D1 ignores every one but `defer_foreign_keys` and `no-d1-hostile-sql.test.ts`
-- refuses the rest.
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`payload_json` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_status` integer,
	`last_error` text,
	`delivered_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_workspace_idx` ON `webhook_delivery` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_next_attempt_idx` ON `webhook_delivery` (`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `response_workspace_question_idx` ON `response` (`workspace_id`,`question_id`);
