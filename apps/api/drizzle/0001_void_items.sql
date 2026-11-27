ALTER TABLE "answers" ADD COLUMN "manual_adjustment" numeric(10, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "working_adjustment" numeric(10, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt_items" ADD COLUMN "void_reason" text;