ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "parent_asset_id" uuid;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "manufacturer" text;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "model" varchar(150);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "serial_number" varchar(150);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "year_of_manufacture" integer;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "tag" varchar(150);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_asset_id_assets_id_fk" FOREIGN KEY ("parent_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_year_of_manufacture_check" CHECK (("year_of_manufacture" IS NULL) OR (("year_of_manufacture" >= 1000) AND ("year_of_manufacture" <= 9999)));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_asset_id_check" CHECK (("parent_asset_id" IS NULL) OR ("parent_asset_id" <> "id"));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_parent_asset_id_idx" ON "assets" USING btree ("parent_asset_id");
