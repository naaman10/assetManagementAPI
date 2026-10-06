CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"asset_type_id" uuid NOT NULL,
	"asset_ref" varchar(100) NOT NULL,
	"asset_name" text,
	"description" text,
	"quantity" numeric(12, 2),
	"unit_of_measure" varchar(30),
	"installation_date" date,
	"estimated_age_years" integer,
	"expected_life_years" integer,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_status_check" CHECK ("assets"."status" IN ('active', 'inactive', 'out_of_service', 'decommissioned', 'disposed', 'proposed', 'under_installation', 'awaiting_commissioning', 'deleted')),
	CONSTRAINT "assets_estimated_age_years_check" CHECK ("assets"."estimated_age_years" IS NULL OR "assets"."estimated_age_years" >= 0),
	CONSTRAINT "assets_expected_life_years_check" CHECK ("assets"."expected_life_years" IS NULL OR "assets"."expected_life_years" >= 0)
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_asset_type_id_asset_types_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_location_id_idx" ON "assets" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "assets_asset_type_id_idx" ON "assets" USING btree ("asset_type_id");