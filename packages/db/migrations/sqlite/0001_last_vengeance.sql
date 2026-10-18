CREATE TABLE `auth_token` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `auth_token_expires_idx` ON `auth_token` (`expires_at`);