-- Phase 8a Task 1: the sqlite/0009_results_and_delivery.sql sibling. Same
-- defaults, same two additions, so the dialects agree: `webhook_delivery`
-- for 8d's drain (K22), and the `response(workspace_id, question_id)` index
-- for 8b and 8c (K42). See the sqlite migration's header for the full
-- reasoning, including why K43 dropped the broadcast columns.
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"event" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"attempt_count" integer NOT NULL,
	"next_attempt_at" bigint NOT NULL,
	"last_status" integer,
	"last_error" text,
	"delivered_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_delivery_workspace_idx" ON "webhook_delivery" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_next_attempt_idx" ON "webhook_delivery" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "response_workspace_question_idx" ON "response" USING btree ("workspace_id","question_id");
