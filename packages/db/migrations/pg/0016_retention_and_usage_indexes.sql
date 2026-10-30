CREATE INDEX IF NOT EXISTS "snapshot_workspace_taken_idx" ON "snapshot" USING btree ("workspace_id", "taken_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attempt_workspace_started_idx" ON "attempt" USING btree ("workspace_id", "started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_workspace_ts_idx" ON "event" USING btree ("workspace_id", "server_ts");
