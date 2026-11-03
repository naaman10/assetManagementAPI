ALTER TABLE "location_plans" ADD COLUMN IF NOT EXISTS "aps_object_key" varchar(512);
--> statement-breakpoint
ALTER TABLE "location_plans" ADD COLUMN IF NOT EXISTS "aps_urn" varchar(512);
--> statement-breakpoint
ALTER TABLE "location_plans" ADD COLUMN IF NOT EXISTS "aps_translation_status" varchar(32);
--> statement-breakpoint
ALTER TABLE "location_plans" ADD COLUMN IF NOT EXISTS "aps_translation_error" varchar(1000);
