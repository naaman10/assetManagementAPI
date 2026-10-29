CREATE TABLE IF NOT EXISTS "survey_record_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_record_id" uuid NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_record_photos" ADD CONSTRAINT "survey_record_photos_survey_record_id_survey_records_id_fk" FOREIGN KEY ("survey_record_id") REFERENCES "public"."survey_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "survey_record_photos_storage_key_unique" ON "survey_record_photos" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "survey_record_photos_survey_record_id_idx" ON "survey_record_photos" USING btree ("survey_record_id");
--> statement-breakpoint
INSERT INTO "project_type_field_definitions" ("source", "field_key", "label", "field_type", "description")
VALUES
	('survey_record', 'photos', 'Photos', 'media', NULL)
ON CONFLICT ("source", "field_key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "field_type" = EXCLUDED."field_type",
  "description" = EXCLUDED."description";
