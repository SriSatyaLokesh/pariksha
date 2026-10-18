PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_question` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`bank_id` text NOT NULL,
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
	`version` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_question`("id", "workspace_id", "bank_id", "type", "prompt_md", "media_json", "options_json", "key_json", "scoring_json", "points", "difficulty", "tags_json", "explanation_md", "version", "created_at") SELECT "id", "workspace_id", "bank_id", "type", "prompt_md", "media_json", "options_json", "key_json", "scoring_json", "points", "difficulty", "tags_json", "explanation_md", "version", "created_at" FROM `question`;--> statement-breakpoint
DROP TABLE `question`;--> statement-breakpoint
ALTER TABLE `__new_question` RENAME TO `question`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `question_workspace_idx` ON `question` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `question_bank_idx` ON `question` (`bank_id`);--> statement-breakpoint
CREATE TABLE `__new_response` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`value_json` text NOT NULL,
	`saved_at` integer NOT NULL,
	`client_seq` integer NOT NULL,
	`points` real,
	`graded_by` text
);
--> statement-breakpoint
INSERT INTO `__new_response`("id", "workspace_id", "attempt_id", "question_id", "value_json", "saved_at", "client_seq", "points", "graded_by") SELECT "id", "workspace_id", "attempt_id", "question_id", "value_json", "saved_at", "client_seq", "points", "graded_by" FROM `response`;--> statement-breakpoint
DROP TABLE `response`;--> statement-breakpoint
ALTER TABLE `__new_response` RENAME TO `response`;--> statement-breakpoint
CREATE INDEX `response_workspace_idx` ON `response` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `response_attempt_idx` ON `response` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `response_attempt_question_uq` ON `response` (`attempt_id`,`question_id`);