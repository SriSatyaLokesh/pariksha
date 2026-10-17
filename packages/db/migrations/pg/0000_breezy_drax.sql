CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes_json" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint
);
--> statement-breakpoint
CREATE TABLE "attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"test_version_id" text NOT NULL,
	"set_no" integer NOT NULL,
	"layout_json" jsonb NOT NULL,
	"started_at" bigint NOT NULL,
	"deadline_at" bigint NOT NULL,
	"submitted_at" bigint,
	"submit_reason" text,
	"score_json" jsonb,
	"flag" text NOT NULL,
	"token_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"detail_json" jsonb,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"test_id" text NOT NULL,
	"form_values_json" jsonb NOT NULL,
	"consent_version" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"type" text NOT NULL,
	"detail_json" jsonb,
	"client_ts" bigint NOT NULL,
	"server_ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"test_grants_json" jsonb,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"bank_id" text NOT NULL,
	"type" text NOT NULL,
	"prompt_md" text NOT NULL,
	"media_json" jsonb,
	"options_json" jsonb,
	"key_json" jsonb,
	"scoring_json" jsonb,
	"points" integer NOT NULL,
	"difficulty" text,
	"tags_json" jsonb NOT NULL,
	"explanation_md" text,
	"version" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_bank" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"tags_json" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"saved_at" bigint NOT NULL,
	"client_seq" integer NOT NULL,
	"points" integer,
	"graded_by" text
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"reviewer" text NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "set" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"test_version_id" text NOT NULL,
	"set_no" integer NOT NULL,
	"question_ids_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"taken_at" bigint NOT NULL,
	"reason" text NOT NULL,
	"face_count" integer
);
--> statement-breakpoint
CREATE TABLE "test" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"current_version" integer,
	"tags_json" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"test_id" text NOT NULL,
	"version" integer NOT NULL,
	"settings_json" jsonb NOT NULL,
	"sections_json" jsonb NOT NULL,
	"published_at" bigint
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"auth_provider" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"url" text NOT NULL,
	"events_json" jsonb NOT NULL,
	"signing_secret" text NOT NULL,
	"active" boolean NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"branding_json" jsonb,
	"settings_json" jsonb,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_key_workspace_idx" ON "api_key" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_secret_hash_uq" ON "api_key" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "attempt_workspace_idx" ON "attempt" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "attempt_candidate_idx" ON "attempt" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "attempt_test_version_idx" ON "attempt" USING btree ("test_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_token_hash_uq" ON "attempt" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_idx" ON "audit_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "candidate_workspace_idx" ON "candidate" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "candidate_test_idx" ON "candidate" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "event_workspace_idx" ON "event" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "event_attempt_idx" ON "event" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "membership_workspace_idx" ON "membership" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "membership" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_workspace_user_uq" ON "membership" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "question_workspace_idx" ON "question" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "question_bank_idx" ON "question" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "question_bank_workspace_idx" ON "question_bank" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "response_workspace_idx" ON "response" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "response_attempt_idx" ON "response" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "response_attempt_question_uq" ON "response" USING btree ("attempt_id","question_id");--> statement-breakpoint
CREATE INDEX "review_workspace_idx" ON "review" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "review_attempt_idx" ON "review" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "set_workspace_idx" ON "set" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "set_test_version_idx" ON "set" USING btree ("test_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "set_test_version_no_uq" ON "set" USING btree ("test_version_id","set_no");--> statement-breakpoint
CREATE INDEX "snapshot_workspace_idx" ON "snapshot" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "snapshot_attempt_idx" ON "snapshot" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "test_workspace_idx" ON "test" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "test_status_idx" ON "test" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "test_workspace_slug_uq" ON "test" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "test_version_workspace_idx" ON "test_version" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "test_version_test_idx" ON "test_version" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_version_test_version_uq" ON "test_version" USING btree ("test_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_uq" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "webhook_workspace_idx" ON "webhook" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_slug_uq" ON "workspace" USING btree ("slug");