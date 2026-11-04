ALTER TABLE "project_types" ADD COLUMN IF NOT EXISTS "focus" varchar(30);
--> statement-breakpoint
UPDATE "project_types" SET "focus" = 'assets' WHERE "focus" IS NULL;
--> statement-breakpoint
ALTER TABLE "project_types" ALTER COLUMN "focus" SET DEFAULT 'assets';
--> statement-breakpoint
ALTER TABLE "project_types" ALTER COLUMN "focus" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_types" ADD CONSTRAINT "project_types_focus_check"
    CHECK ("focus" IN ('assets', 'sites_locations'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_sites" (
	"project_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	CONSTRAINT "project_sites_project_id_site_id_pk" PRIMARY KEY("project_id","site_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_locations" (
	"project_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"review_status" varchar(30) DEFAULT 'todo' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_locations_project_id_location_id_pk" PRIMARY KEY("project_id","location_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_location_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"parent_location_id" uuid,
	"location_code" varchar(100),
	"name" varchar(255),
	"location_type" varchar(30),
	"description" text,
	"department" varchar(150),
	"uprn" varchar(12),
	"address" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_site_id_sites_id_fk"
    FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_locations" ADD CONSTRAINT "project_locations_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_locations" ADD CONSTRAINT "project_locations_location_id_locations_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_location_records" ADD CONSTRAINT "project_location_records_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_location_records" ADD CONSTRAINT "project_location_records_location_id_locations_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_location_records" ADD CONSTRAINT "project_location_records_site_id_sites_id_fk"
    FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_locations" ADD CONSTRAINT "project_locations_review_status_check"
    CHECK ("review_status" IN ('todo', 'in_progress', 'done'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_location_records" ADD CONSTRAINT "project_location_records_location_type_check"
    CHECK ("location_type" IS NULL OR "location_type" IN ('building', 'floor', 'room', 'area'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_location_records" ADD CONSTRAINT "project_location_records_status_check"
    CHECK ("status" IN ('active', 'inactive', 'demolished'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sites_site_id_idx" ON "project_sites" USING btree ("site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_locations_location_id_idx" ON "project_locations" USING btree ("location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_locations_project_review_status_idx" ON "project_locations" USING btree ("project_id","review_status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_location_records_project_location_unique" ON "project_location_records" USING btree ("project_id","location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_location_records_location_id_idx" ON "project_location_records" USING btree ("location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_location_records_site_id_idx" ON "project_location_records" USING btree ("site_id");
