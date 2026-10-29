CREATE TABLE IF NOT EXISTS "location_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "location_plan_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"geometry" jsonb NOT NULL,
	"label_override" varchar(255),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_plans" ADD CONSTRAINT "location_plans_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_plan_features" ADD CONSTRAINT "location_plan_features_plan_id_location_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."location_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_plan_features" ADD CONSTRAINT "location_plan_features_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "location_plans_location_id_unique" ON "location_plans" USING btree ("location_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "location_plans_storage_key_unique" ON "location_plans" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_plan_features_plan_id_idx" ON "location_plan_features" USING btree ("plan_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_plan_features_location_id_idx" ON "location_plan_features" USING btree ("location_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "location_plan_features_plan_location_unique" ON "location_plan_features" USING btree ("plan_id","location_id");
--> statement-breakpoint
-- Experiment fixture: attach existing Neon PDF to the first floor for this client (no-op if none).
INSERT INTO "location_plans" ("location_id", "storage_key", "content_type")
SELECT l.id,
	'clients/c4994b41-b1c0-43d5-853e-96b71734d6ca/site-plans/Office Floor Plan.pdf',
	'application/pdf'
FROM "locations" l
INNER JOIN "sites" s ON s.id = l.site_id
WHERE s.client_id = 'c4994b41-b1c0-43d5-853e-96b71734d6ca'
	AND l.location_type = 'floor'
	AND NOT EXISTS (
		SELECT 1 FROM "location_plans" p
		WHERE p.location_id = l.id
			OR p.storage_key = 'clients/c4994b41-b1c0-43d5-853e-96b71734d6ca/site-plans/Office Floor Plan.pdf'
	)
ORDER BY l.created_at
LIMIT 1;
