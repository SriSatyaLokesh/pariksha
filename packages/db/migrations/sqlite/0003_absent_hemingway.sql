-- Hand-corrected after `drizzle-kit generate`, which emitted
-- `ALTER TABLE question ADD ref_id text NOT NULL` for the new column.
-- SQLite rejects that outright — a NOT NULL column added without a default
-- has no value for existing rows, and it refuses even when the table is
-- empty — so `question` is rebuilt instead, the same twelve-step shape
-- drizzle-kit emitted itself in 0002. Keep this edit when regenerating.
-- Existing rows take their row id as `ref_id`: nothing has ever written this
-- table (no repository function or route touches it before Phase 4), so in
-- practice the copy moves no rows, but a question with no in-file id has
-- nothing else to be called.
--
-- No `PRAGMA foreign_keys` here, unlike drizzle-kit's own output: D1 runs
-- every statement inside an implicit transaction and documents that a user
-- query cannot change that setting during a migration, so the pragma would
-- fail on the one target this project deploys to. The schema declares no
-- foreign keys at all, so the rebuild needs no deferral — but if one is ever
-- added, the D1-safe form is `PRAGMA defer_foreign_keys = on`.
CREATE TABLE `__new_question` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`bank_id` text NOT NULL,
	`ref_id` text NOT NULL,
	`group_ref` text,
	`type` text NOT NULL,
	`prompt_md` text NOT NULL,
	`media_json` text,
	`options_json` text,
	`key_json` text,
	`scoring_json` text,
	`points` real NOT NULL,
	`difficulty` text,
	`tags_json` text NOT NULL,
	`explanation_md` text,
	`extra_json` text,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_question`("id", "workspace_id", "bank_id", "ref_id", "type", "prompt_md", "media_json", "options_json", "key_json", "scoring_json", "points", "difficulty", "tags_json", "explanation_md", "version", "created_at") SELECT "id", "workspace_id", "bank_id", "id", "type", "prompt_md", "media_json", "options_json", "key_json", "scoring_json", "points", "difficulty", "tags_json", "explanation_md", "version", "created_at" FROM `question`;--> statement-breakpoint
DROP TABLE `question`;--> statement-breakpoint
ALTER TABLE `__new_question` RENAME TO `question`;--> statement-breakpoint
CREATE INDEX `question_workspace_idx` ON `question` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `question_bank_idx` ON `question` (`bank_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_bank_ref_uq` ON `question` (`bank_id`,`ref_id`);--> statement-breakpoint
ALTER TABLE `question_bank` ADD `description` text;--> statement-breakpoint
ALTER TABLE `question_bank` ADD `license` text;--> statement-breakpoint
ALTER TABLE `question_bank` ADD `groups_json` text;--> statement-breakpoint
ALTER TABLE `question_bank` ADD `updated_at` integer;
