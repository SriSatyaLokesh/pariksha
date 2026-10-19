-- Phase 5 Task 2 (#54): test gains description, short_code, review_requested
-- and updated_at; test_version gains created_at, so a draft version (no
-- published_at yet) has something to order by.
--
-- Hand-corrected after `drizzle-kit generate`, which emitted
-- `ALTER TABLE test ADD short_code text NOT NULL` and the same for
-- `review_requested` — SQLite only allows a NOT NULL column added by ALTER
-- TABLE when the table is empty or the column carries a literal DEFAULT, and
-- `short_code` has no single default that could ever be unique across more
-- than one row. `test` is rebuilt instead, the same twelve-step shape 0003
-- used for `question.ref_id`. No route writes a `test` row before this phase
-- ships, so in practice the rebuild moves no data; the backfilled
-- `short_code` (a slice of the row's own `id`, itself unique) and
-- `review_requested = false` below exist only to keep the rebuilt table
-- consistent with its own NOT NULL and UNIQUE constraints for that case.
--
-- `short_code` is unique **bare**, not composite with `workspace_id` like
-- every other unique in this manifest — Review Focus 5: `/t/<code>` names no
-- workspace, so two workspaces sharing one code would make the short link
-- ambiguous.
CREATE TABLE `__new_test` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`short_code` text NOT NULL,
	`status` text NOT NULL,
	`review_requested` integer NOT NULL,
	`current_version` integer,
	`tags_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_test` ("id", "workspace_id", "slug", "name", "short_code", "status", "review_requested", "current_version", "tags_json", "created_at") SELECT "id", "workspace_id", "slug", "name", substr("id", 5, 6), "status", 0, "current_version", "tags_json", "created_at" FROM `test`;--> statement-breakpoint
DROP TABLE `test`;--> statement-breakpoint
ALTER TABLE `__new_test` RENAME TO `test`;--> statement-breakpoint
CREATE INDEX `test_workspace_idx` ON `test` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `test_status_idx` ON `test` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `test_workspace_slug_uq` ON `test` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `test_short_code_uq` ON `test` (`short_code`);--> statement-breakpoint
ALTER TABLE `test_version` ADD `created_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `test_version` SET `created_at` = `published_at` WHERE `published_at` IS NOT NULL;
