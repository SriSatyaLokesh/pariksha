-- Phase 12: BYOK encrypted provider credentials and usage telemetry (S-15).
CREATE TABLE `byok_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_hint` text NOT NULL,
	`spend_limit_cents` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE INDEX `byok_credential_workspace_idx` ON `byok_credential` (`workspace_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `byok_credential_workspace_provider_uq` ON `byok_credential` (`workspace_id`, `provider`);
--> statement-breakpoint
CREATE TABLE `byok_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`estimated_cost_cents` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `byok_usage_workspace_idx` ON `byok_usage` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `byok_usage_workspace_created_idx` ON `byok_usage` (`workspace_id`, `created_at`);
