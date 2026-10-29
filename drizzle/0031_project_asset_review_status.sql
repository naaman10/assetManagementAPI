ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "review_status" varchar(30) DEFAULT 'todo' NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_review_status_check" CHECK ("review_status" IN ('todo', 'in_progress', 'done'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_assets_project_review_status_idx" ON "project_assets" USING btree ("project_id","review_status");
