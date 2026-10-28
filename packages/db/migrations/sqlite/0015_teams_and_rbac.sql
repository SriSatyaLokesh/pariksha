CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_workspace_idx` ON `team` (`workspace_id`);
--> statement-breakpoint
CREATE TABLE `team_member` (
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`team_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `team_member_user_idx` ON `team_member` (`user_id`);
--> statement-breakpoint
CREATE TABLE `team_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`team_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_grant_resource_uq` ON `team_grant` (`team_id`, `resource_type`, `resource_id`);
--> statement-breakpoint
CREATE INDEX `team_grant_workspace_resource_idx` ON `team_grant` (`workspace_id`, `resource_type`, `resource_id`);
--> statement-breakpoint
ALTER TABLE `api_key` ADD `created_by` text;
