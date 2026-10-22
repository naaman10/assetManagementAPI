CREATE TABLE IF NOT EXISTS "nrm3_classifications" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"level" smallint NOT NULL,
	"parent_code" text,
	"maintainable_asset_description" text,
	"renewal_uom" text,
	"maintenance_uom" text,
	"product_material_type" text,
	"work_package" text,
	"source_version" text DEFAULT '2026-01' NOT NULL,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nrm3_classifications" ADD CONSTRAINT "nrm3_classifications_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "public"."nrm3_classifications"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nrm3_classifications" ADD CONSTRAINT "nrm3_classifications_check" CHECK (((parent_code IS NULL) OR (parent_code <> code)));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nrm3_classifications" ADD CONSTRAINT "nrm3_classifications_level_check" CHECK (((level >= 1) AND (level <= 5)));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_nrm3_level" ON "nrm3_classifications" USING btree ("level");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_nrm3_parent_code" ON "nrm3_classifications" USING btree ("parent_code");
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "nrm3_code" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_nrm3_code_nrm3_classifications_code_fk" FOREIGN KEY ("nrm3_code") REFERENCES "public"."nrm3_classifications"("code") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_nrm3_code_idx" ON "assets" USING btree ("nrm3_code");
