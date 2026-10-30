CREATE INDEX `snapshot_workspace_taken_idx` ON `snapshot` (`workspace_id`, `taken_at`);--> statement-breakpoint
CREATE INDEX `attempt_workspace_started_idx` ON `attempt` (`workspace_id`, `started_at`);--> statement-breakpoint
CREATE INDEX `event_workspace_ts_idx` ON `event` (`workspace_id`, `server_ts`);
