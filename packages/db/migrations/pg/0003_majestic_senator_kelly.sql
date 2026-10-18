ALTER TABLE "question" ADD COLUMN "ref_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "group_ref" text;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "extra_json" jsonb;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "updated_at" bigint;--> statement-breakpoint
ALTER TABLE "question_bank" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "question_bank" ADD COLUMN "license" text;--> statement-breakpoint
ALTER TABLE "question_bank" ADD COLUMN "groups_json" jsonb;--> statement-breakpoint
ALTER TABLE "question_bank" ADD COLUMN "updated_at" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "question_bank_ref_uq" ON "question" USING btree ("bank_id","ref_id");